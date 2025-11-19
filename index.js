const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

// CORS
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  res.type("application/json");
  next();
});

// Ruta raíz (para saber que está vivo)
app.get("/", (req, res) => {
  res.json({ status: "OK", message: "Primer Latino Addon v5 – FUNCIONANDO 100%" });
});

// CARGAR LOS JSON
let movies = [], seriesList = [], episodes = [];
try {
  movies = JSON.parse(fs.readFileSync(path.join(__dirname, "movies.json"), "utf-8")).movies || [];
  seriesList = JSON.parse(fs.readFileSync(path.join(__dirname, "series.json"), "utf-8")).series || [];
  episodes = JSON.parse(fs.readFileSync(path.join(__dirname, "episodes.json"), "utf-8")).episodes || [];
  console.log(`Cargados → ${movies.length} películas | ${seriesList.length} series | ${episodes.length} episodios`);
} catch (e) {
  console.error("ERROR leyendo JSONs:", e.message);
}

// MANIFEST
const manifest = {
  id: "org.primerlatino.addon",
  version: "5.1.3",
  name: "Primer Latino",
  description: "Addon Latino, Uselo solo con (Real Debrid) by: @johnpradoo",
  logo: "https://github.com/johnpradoo/primer-latino/blob/main/logo/icon.png?raw=true",
  background: "https://github.com/johnpradoo/primer-latino/blob/main/logo/banner.jpg?raw=true",
  types: ["movie", "series"],
  resources: ["catalog", "meta", "stream"],
  catalogs: [
    { type: "movie", id: "primerlatino_movies", name: "Películas Latino" },
    { type: "series", id: "primerlatino_series", name: "Series Latino" }
  ],
  idPrefixes: ["tt"]
};

app.get("/realdebrid=:token/manifest.json", (req, res) => res.json(manifest));

// CATÁLOGO PELÍCULAS
app.get("/realdebrid=:token/catalog/movie/primerlatino_movies.json", (req, res) => {
  console.log("Catálogo películas solicitado");
  const metas = movies.map(m => ({
    id: m.id,
    type: "movie",
    name: m.title + (m.quality ? ` (${m.quality.split("|")[0].trim()})` : ""),
    poster: m.poster || "https://github.com/johnpradoo/primer-latino/blob/main/logo/icon.png?raw=true"
  }));
  res.json({ metas });
});

// CATÁLOGO SERIES (una sola vez)
app.get("/realdebrid=:token/catalog/series/primerlatino_series.json", (req, res) => {
  console.log("Catálogo series solicitado");
  const metas = seriesList.map(s => ({
    id: s.id,
    type: "series",
    name: s.title,
    poster: s.poster || "https://github.com/johnpradoo/primer-latino/blob/main/logo/icon.png?raw=true"
  }));
  res.json({ metas });
});

// META PELÍCULAS
app.get("/realdebrid=:token/meta/movie/:id.json", (req, res) => {
  console.log(`Meta película → ${req.params.id}`);
  const m = movies.find(x => x.id === req.params.id);
  if (!m) return res.json({ meta: null });
  res.json({ meta: { id: m.id, type: "movie", name: m.title, poster: m.poster } });
});

// META SERIES (temporadas y episodios)
app.get("/realdebrid=:token/meta/series/:id.json", (req, res) => {
  console.log(`Meta serie → ${req.params.id}`);
  const baseId = req.params.id.split(":")[0];
  const serie = seriesList.find(s => s.id === baseId);
  if (!serie) return res.json({ meta: null });

  const seasonMap = {};
  episodes
    .filter(e => e.id.startsWith(baseId + ":"))
    .forEach(e => {
      const [, seasonStr, episodeStr] = e.id.split(":");
      const season = parseInt(seasonStr);
      const episode = parseInt(episodeStr);
      if (!seasonMap[season]) seasonMap[season] = [];
      seasonMap[season].push({ id: e.id, title: `Episodio ${episode}`, episode });
    });

  const videos = {};
  Object.keys(seasonMap)
    .sort((a, b) => a - b)
    .forEach(s => {
      videos[s] = { "0": seasonMap[s].sort((a, b) => a.episode - b.episode) };
    });

  res.json({
    meta: {
      id: baseId,
      type: "series",
      name: serie.title,
      poster: serie.poster,
      videos
    }
  });
});

// STREAMS – VERSIÓN QUE NUNCA SE QUEDA EN waiting_files_selection
app.get("/realdebrid=:token/stream/:type/:id.json", async (req, res) => {
  const { token, type, id } = req.params;
  console.log(`STREAM → ${type} ${id}`);

  const item = type === "movie" 
    ? movies.find(m => m.id === id)
    : episodes.find(e => e.id === id);

  if (!item || !item.hash) {
    console.log("Ítem o hash no encontrado");
    return res.json({ streams: [] });
  }

  try {
    const magnet = `magnet:?xt=urn:btih:${item.hash}`;
    console.log(`Añadiendo torrent ${item.hash}`);

    // 1. Añadir magnet
    const addRes = await axios.post(
      "https://api.real-debrid.com/rest/1.0/torrents/addMagnet",
      new URLSearchParams({ magnet }),
      { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 }
    );

    const torrentId = addRes.data.id;
    console.log(`Torrent ID: ${torrentId}`);

    // 2. Polling + selección automática de archivo
    let info;
    for (let i = 0; i < 30; i++) {
      info = (await axios.get(`https://api.real-debrid.com/rest/1.0/torrents/info/${torrentId}`, {
        headers: { Authorization: `Bearer ${token}` }
      })).data;

      console.log(`Estado: ${info.status}`);

      if (info.status === "downloaded") break;

      if (info.status === "waiting_files_selection" && info.files) {
        const videoFile = info.files.find(f => /\.(mp4|mkv|avi|mov|webm)$/i.test(f.path)) || info.files[0];
        console.log(`Seleccionando archivo: ${videoFile.path}`);
        await axios.post(
          `https://api.real-debrid.com/rest/1.0/torrents/selectFiles/${torrentId}`,
          new URLSearchParams({ files: videoFile.id }),
          { headers: { Authorization: `Bearer ${token}` } }
        );
      }

      await new Promise(r => setTimeout(r, 3000));
    }

    // Refresh final
    info = (await axios.get(`https://api.real-debrid.com/rest/1.0/torrents/info/${torrentId}`, {
      headers: { Authorization: `Bearer ${token}` }
    })).data;

    if (info.status !== "downloaded" || !info.links?.[0]) {
      console.log("No se pudo descargar completamente");
      return res.json({ streams: [] });
    }

    // 3. Unrestrict link
    const linkRes = await axios.post(
      "https://api.real-debrid.com/rest/1.0/unrestrict/link",
      new URLSearchParams({ link: info.links[0] }),
      { headers: { Authorization: `Bearer ${token}` } }
    );

    console.log("LINK LIBERADO Y ENVIADO A STREMIO");
    res.json({
      streams: [{
        title: `${item.quality || "LATINO HD"} • Primer Latino`,
        url: linkRes.data.download
      }]
    });

  } catch (err) {
    console.error("ERROR EN STREAM:", err.response?.data || err.message);
    res.json({ streams: [] });
  }
});

// ARRANCAR SERVIDOR
const PORT = process.env.PORT || 7000;
app.listen(PORT, () => {
  console.log(`Primer Latino Addon v5.1 Pro, corriendo en puerto ${PORT} – TODO FUNCIONA`);
});