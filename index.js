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

app.get("/", (req, res) => {
  res.json({ status: "OK", message: "Primer Latino Addon FINAL + LOGS activado" });
});

// Cargar JSONs
let movies = [], seriesList = [], episodes = [];
try {
  movies = JSON.parse(fs.readFileSync(path.join(__dirname, "movies.json"), "utf-8")).movies || [];
  seriesList = JSON.parse(fs.readFileSync(path.join(__dirname, "series.json"), "utf-8")).series || [];
  episodes = JSON.parse(fs.readFileSync(path.join(__dirname, "episodes.json"), "utf-8")).episodes || [];
  console.log(`Cargados: ${movies.length} películas | ${seriesList.length} series | ${episodes.length} episodios`);
} catch (err) {
  console.error("ERROR al cargar JSONs:", err.message);
}

// MANIFEST
const manifest = {
  id: "org.primerlatino.addon",
  version: "4.0.0",
  name: "Primer Latino",
  description: "Películas y series LATINO - 100% funcional",
  logo: "https://i.imgur.com/lE2FQIk.png",
  background: "https://i.imgur.com/lE2FQIk.png",
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
  console.log("Catálogo de películas solicitado");
  const metas = movies.map(m => ({
    id: m.id,
    type: "movie",
    name: m.title + (m.quality ? ` (${m.quality.split("|")[0].trim()})` : ""),
    poster: m.poster || "https://i.imgur.com/lE2FQIk.png"
  }));
  res.json({ metas });
});

// CATÁLOGO SERIES (una sola vez)
app.get("/realdebrid=:token/catalog/series/primerlatino_series.json", (req, res) => {
  console.log("Catálogo de series solicitado");
  const metas = seriesList.map(s => ({
    id: s.id,
    type: "series",
    name: s.title,
    poster: s.poster || "https://i.imgur.com/lE2FQIk.png"
  }));
  res.json({ metas });
});

// META PELÍCULAS
app.get("/realdebrid=:token/meta/movie/:id.json", (req, res) => {
  console.log(`Meta película: ${req.params.id}`);
  const m = movies.find(x => x.id === req.params.id);
  if (!m) return res.json({ meta: null });
  res.json({ meta: { id: m.id, type: "movie", name: m.title, poster: m.poster } });
});

// META SERIES (con temporadas y episodios)
app.get("/realdebrid=:token/meta/series/:id.json", (req, res) => {
  console.log(`Meta serie: ${req.params.id}`);
  const baseId = req.params.id.split(":")[0];
  const serie = seriesList.find(s => s.id === baseId);
  if (!serie) return res.json({ meta: null });

  const seasonMap = {};
  episodes.filter(e => e.id.startsWith(baseId + ":")).forEach(e => {
    const [ , seasonStr, episodeStr ] = e.id.split(":");
    const season = parseInt(seasonStr);
    const episode = parseInt(episodeStr);
    if (!seasonMap[season]) seasonMap[season] = [];
    seasonMap[season].push({ id: e.id, title: `Episodio ${episode}`, episode });
  });

  const videos = {};
  Object.keys(seasonMap).sort((a,b)=>a-b).forEach(s => {
    videos[s] = { "0": seasonMap[s].sort((a,b)=>a.episode-b.episode) };
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

// STREAMS (con logs detallados)
app.get("/realdebrid=:token/stream/:type/:id.json", async (req, res) => {
  const { token, type, id } = req.params;
  console.log(`STREAM solicitado → ${type} ${id}`);

  const item = type === "movie" 
    ? movies.find(m => m.id === id)
    : episodes.find(e => e.id === id);

  if (!item || !item.hash) {
    console.log("Item o hash no encontrado");
    return res.json({ streams: [] });
  }

  try {
    const magnet = `magnet:?xt=urn:btih:${item.hash}`;
    console.log(`Añadiendo magnet ${item.hash}...`);

    const add = await axios.post("https://api.real-debrid.com/rest/1.0/torrents/addMagnet",
      new URLSearchParams({ magnet }),
      { headers: { Authorization: `Bearer ${token}` }, timeout: 10000 }
    );

    const torrentId = add.data.id;
    let info = add.data;

    for (let i = 0; i < 20; i++) {
      if (info.status === "downloaded") break;
      await new Promise(r => setTimeout(r, 3000));
      info = (await axios.get(`https://api.real-debrid.com/rest/1.0/torrents/info/${torrentId}`,
        { headers: { Authorization: `Bearer ${token}` } }
      )).data;
      console.log(`Estado torrent: ${info.status} (${i+1}/20)`);
    }

    if (info.status !== "downloaded" || !info.links?.[0]) {
      console.log("Torrent no descargado o sin links");
      return res.json({ streams: [] });
    }

    const link = await axios.post("https://api.real-debrid.com/rest/1.0/unrestrict/link",
      new URLSearchParams({ link: info.links[0] }),
      { headers: { Authorization: `Bearer ${token}` } }
    );

    console.log(`LINK LIBERADO: ${link.data.download.substring(0, 60)}...`);
    res.json({ streams: [{ title: "LATINO • Real-Debrid", url: link.data.download }] });

  } catch (err) {
    console.error("ERROR en stream:", err.response?.data || err.message);
    res.json({ streams: [] });
  }
});

// Iniciar
const PORT = process.env.PORT || 7000;
app.listen(PORT, () => {
  console.log(`Primer Latino Addon v4.0 corriendo en puerto ${PORT} - LOGS ACTIVADOS`);
});