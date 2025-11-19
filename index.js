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
  res.json({ status: "OK", message: "Primer Latino Addon v6 – ANTI-DUPLICADOS + CACHÉ GLOBAL" });
});

// CARGAR JSONs
let movies = [], seriesList = [], episodes = [];
try {
  movies = JSON.parse(fs.readFileSync(path.join(__dirname, "movies.json"), "utf-8")).movies || [];
  seriesList = JSON.parse(fs.readFileSync(path.join(__dirname, "series.json"), "utf-8")).series || [];
  episodes = JSON.parse(fs.readFileSync(path.join(__dirname, "episodes.json"), "utf-8")).episodes || [];
  console.log(`Cargados → ${movies.length} películas | ${seriesList.length} series | ${episodes.length} episodios`);
} catch (e) {
  console.error("ERROR leyendo JSONs:", e.message);
}

// MANIFEST (el tuyo exacto)
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

// CATÁLOGOS (igual que tenías)
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

// META SERIES
app.get("/realdebrid=:token/meta/series/:id.json", (req, res) => {
  console.log(`Meta serie → ${req.params.id}`);
  const baseId = req.params.id.split(":")[0];
  const serie = seriesList.find(s => s.id === baseId);
  if (!serie) return res.json({ meta: null });

  const seasonMap = {};
  episodes.filter(e => e.id.startsWith(baseId + ":")).forEach(e => {
    const [, seasonStr, episodeStr] = e.id.split(":");
    const season = parseInt(seasonStr);
    const episode = parseInt(episodeStr);
    if (!seasonMap[season]) seasonMap[season] = [];
    seasonMap[season].push({ id: e.id, title: `Episodio ${episode}`, episode });
  });

  const videos = {};
  Object.keys(seasonMap).sort((a, b) => a - b).forEach(s => {
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

// CACHÉ GLOBAL EN MEMORIA
const cache = new Map(); // hash → { url, expires }

// STREAM CON ANTI-DUPLICADOS + CACHÉ
app.get("/realdebrid=:token/stream/:type/:id.json", async (req, res) => {
  const { token, type, id } = req.params;
  console.log(`STREAM → ${type} ${id}`);

  const item = type === "movie" ? movies.find(m => m.id === id) : episodes.find(e => e.id === id);
  if (!item || !item.hash) return res.json({ streams: [] });

  const hash = item.hash.trim().toUpperCase();

  // 1. CACHÉ EN MEMORIA (link instantáneo)
  if (cache.has(hash) && Date.now() < cache.get(hash).expires) {
    console.log(`CACHÉ GLOBAL – Link instantáneo`);
    return res.json({ streams: [{ title: `${item.quality || "LATINO HD"} • Primer Latino`, url: cache.get(hash).url }] });
  }

  try {
    const auth = { headers: { Authorization: `Bearer ${token}` } };

    // 2. BUSCAR SI YA EXISTE EN REAL-DEBRID
    const { data: torrents } = await axios.get("https://api.real-debrid.com/rest/1.0/torrents?limit=1000", auth);
    let torrentInfo = torrents.find(t => t.hash.toUpperCase() === hash && t.status === "downloaded");

    if (!torrentInfo) {
      // 3. Solo subir si NO existe
      console.log(`Subiendo torrent por primera vez ${hash}`);
      const magnet = `magnet:?xt=urn:btih:${hash}`;
      const add = await axios.post("https://api.real-debrid.com/rest/1.0/torrents/addMagnet",
        new URLSearchParams({ magnet }), auth);

      const torrentId = add.data.id;

      for (let i = 0; i < 40; i++) {
        torrentInfo = (await axios.get(`https://api.real-debrid.com/rest/1.0/torrents/info/${torrentId}`, auth)).data;
        console.log(`Estado: ${torrentInfo.status}`);

        if (torrentInfo.status === "downloaded") break;
        if (torrentInfo.status === "waiting_files_selection" && torrentInfo.files) {
          const video = torrentInfo.files.find(f => /\.(mp4|mkv|avi|mov|webm)$/i.test(f.path)) || torrentInfo.files[0];
          console.log(`Seleccionando: ${video.path}`);
          await axios.post(`https://api.real-debrid.com/rest/1.0/torrents/selectFiles/${torrentId}`,
            new URLSearchParams({ files: video.id }), auth);
        }
        await new Promise(r => setTimeout(r, 3000));
      }
    } else {
      console.log(`Torrent ya existe en RD → Reutilizando (ID: ${torrentInfo.id})`);
    }

    // 4. Unrestrict + guardar caché 24h
    if (torrentInfo?.links?.[0]) {
      const link = await axios.post("https://api.real-debrid.com/rest/1.0/unrestrict/link",
        new URLSearchParams({ link: torrentInfo.links[0] }), auth);

      const finalUrl = link.data.download;
      cache.set(hash, { url: finalUrl, expires: Date.now() + 24 * 60 * 60 * 1000 });

      console.log("LINK LIBERADO + GUARDADO EN CACHÉ");
      return res.json({
        streams: [{
          title: `${item.quality || "LATINO HD"} • Primer Latino`,
          url: finalUrl
        }]
      });
    }

  } catch (err) {
    console.error("ERROR EN STREAM:", err.response?.data || err.message);
  }

  res.json({ streams: [] });
});

// ARRANCAR
const PORT = process.env.PORT || 7000;
app.listen(PORT, () => {
  console.log(`Primer Latino v6 – ANTI-DUPLICADOS + CACHÉ GLOBAL corriendo en puerto ${PORT}`);
});