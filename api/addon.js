// api/addon.js → FUNCIONA 100% EN VERCEL 2025 (JSONs en public/)
const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

// CORS
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "*");
  res.type("application/json");
  next();
});

// FUNCIÓN QUE LEE LOS JSONs DESDE LA CARPETA public/ (esto es la magia)
function loadJSON(filename) {
  const filePath = path.resolve(process.cwd(), "public", filename);
  if (!fs.existsSync(filePath)) {
    console.error(`Archivo no encontrado: ${filename}`);
    return {};
  }
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

// CARGAR TUS JSONs DESDE public/
let movies = [], seriesList = [], episodes = [];

try {
  const mData = loadJSON("movies.json");
  const sData = loadJSON("series.json");
  const eData = loadJSON("episodes.json");

  movies = mData.movies || mData || [];
  seriesList = sData.series || sData || [];
  episodes = eData.episodes || eData || [];

  console.log(`✅ PRIMER LATINO CARGADO → ${movies.length} películas | ${seriesList.length} series | ${episodes.length} episodios`);
} catch (err) {
  console.error("ERROR CRÍTICO CARGANDO JSONs:", err.message);
}

// MANIFEST
const manifest = {
  id: "org.primerlatino.addon",
  version: "9.2.50",
  name: "Primer Latino",
  description: "Películas y Series Latino Full Premium – https://ko-fi.com/johnpradoo ☕",
  logo: "https://www.primerlatino.com/icon.png", // icon
  background: "https://www.primerlatino.com/banner.jpg",
  types: ["movie", "series"],
  resources: ["catalog", "meta", "stream"],
  catalogs: [
    { type: "movie", id: "primerlatino_movies", name: "Películas Latino" },
    { type: "series", id: "primerlatino_series", name: "Series Latino" }
  ],
  idPrefixes: ["tt"]
};

// RUTAS
app.get("/:service(realdebrid|alldebrid|torbox)=:token/manifest.json", (req, res) => {
  res.json(manifest);
});

app.get("/:service(realdebrid|alldebrid|torbox)=:token/catalog/movie/primerlatino_movies.json", (req, res) => {
  const metas = movies.map(m => ({
    id: m.id,
    type: "movie",
    name: m.title + (m.quality ? ` (${m.quality.split("|")[0].trim()})` : ""),
    poster: m.poster || manifest.logo
  }));
  res.json({ metas });
});

app.get("/:service(realdebrid|alldebrid|torbox)=:token/catalog/series/primerlatino_series.json", (req, res) => {
  const metas = seriesList.map(s => ({
    id: s.id,
    type: "series",
    name: s.title,
    poster: s.poster || manifest.logo
  }));
  res.json({ metas });
});

app.get("/:service(realdebrid|alldebrid|torbox)=:token/meta/movie/:id.json", (req, res) => {
  const m = movies.find(x => x.id === req.params.id);
  if (!m) return res.json({ meta: null });
  res.json({ meta: { id: m.id, type: "movie", name: m.title, poster: m.poster } });
});

app.get("/:service(realdebrid|alldebrid|torbox)=:token/meta/series/:id.json", (req, res) => {
  const baseId = req.params.id.split(":")[0];
  const serie = seriesList.find(s => s.id === baseId);
  if (!serie) return res.json({ meta: null });

  const seasonMap = {};
  episodes
    .filter(e => e.id.startsWith(baseId + ":"))
    .forEach(e => {
      const [, season, ep] = e.id.split(":");
      if (!seasonMap[season]) seasonMap[season] = [];
      seasonMap[season].push({ id: e.id, title: `Episodio ${ep}`, episode: +ep });
    });

  const videos = {};
  Object.keys(seasonMap).sort((a, b) => a - b).forEach(s => {
    videos[s] = { "0": seasonMap[s].sort((a, b) => a.episode - b.episode) };
  });

  res.json({ meta: { id: baseId, type: "series", name: serie.title, poster: serie.poster, videos } });
});

// CACHÉ Y STREAM REAL-DEBRID (igual que antes)
const cache = new Map();

function crearTituloEpico(item, fromCache = false) {
  const calidad = (item.quality || "1080p").trim();
  const idioma = (item.language || "LATINO").trim().replace(" 🇲🇽 ", " 🇺🇸 ");
  return {
    title: `${calidad} ${idioma}${fromCache ? " ⚡️ CACHÉ" : ""} 🍿Primer Latino`.trim(),
    infoTitle: "🍿Primer Latino"
  };
}

app.get("/:service(realdebrid)=:token/stream/:type/:id.json", async (req, res) => {
  const { token, type, id } = req.params;
  const item = type === "movie" ? movies.find(m => m.id === id) : episodes.find(e => e.id === id);
  if (!item || !item.hash) return res.json({ streams: [] });

  const hash = item.hash.trim().toUpperCase();

  if (cache.has(hash) && Date.now() < cache.get(hash).expires) {
    const t = crearTituloEpico(item, true);
    return res.json({ streams: [{ title: t.title, infoTitle: t.infoTitle, url: cache.get(hash).url }] });
  }

  try {
    const auth = { headers: { Authorization: `Bearer ${token}` } };

    let torrentInfo = (await axios.get("https://api.real-debrid.com/rest/1.0/torrents?limit=1000", auth)).data
      .find(t => t.hash.toUpperCase() === hash && t.status === "downloaded");

    if (!torrentInfo) {
      const magnet = `magnet:?xt=urn:btih:${hash}`;
      const add = await axios.post("https://api.real-debrid.com/rest/1.0/torrents/addMagnet", new URLSearchParams({ magnet }), auth);
      const torrentId = add.data.id;

      for (let i = 0; i < 40; i++) {
        await new Promise(r => setTimeout(r, 3000));
        torrentInfo = (await axios.get(`https://api.real-debrid.com/rest/1.0/torrents/info/${torrentId}`, auth)).data;
        if (torrentInfo.status === "downloaded") break;
        if (torrentInfo.status === "waiting_files_selection" && torrentInfo.files?.length) {
          const video = torrentInfo.files.find(f => /\.(mp4|mkv|avi|mov|webm)$/i.test(f.path)) || torrentInfo.files[0];
          await axios.post(`https://api.real-debrid.com/rest/1.0/torrents/selectFiles/${torrentId}`, new URLSearchParams({ files: video.id }), auth);
        }
      }
    }

    if (torrentInfo && (!torrentInfo.links || torrentInfo.links.length === 0)) {
      const fresh = (await axios.get(`https://api.real-debrid.com/rest/1.0/torrents/info/${torrentInfo.id}`, auth)).data;
      const video = fresh.files.find(f => /\.(mp4|mkv|avi|mov|webm)$/i.test(f.path)) || fresh.files[0];
      await axios.post(`https://api.real-debrid.com/rest/1.0/torrents/selectFiles/${torrentInfo.id}`, new URLSearchParams({ files: video.id }), auth);
      await new Promise(r => setTimeout(r, 3000));
      torrentInfo = (await axios.get(`https://api.real-debrid.com/rest/1.0/torrents/info/${torrentInfo.id}`, auth)).data;
    }

    if (torrentInfo?.links?.[0]) {
      const unrestricted = await axios.post("https://api.real-debrid.com/rest/1.0/unrestrict/link", new URLSearchParams({ link: torrentInfo.links[0] }), auth);
      const finalUrl = unrestricted.data.download;

      cache.set(hash, { url: finalUrl, expires: Date.now() + 24 * 60 * 60 * 1000 });

      const t = crearTituloEpico(item, false);
      return res.json({ streams: [{ title: t.title, infoTitle: t.infoTitle, url: finalUrl }] });
    }
  } catch (err) {
    console.error("ERROR STREAM:", err.response?.data || err.message);
  }

  res.json({ streams: [] });
});

module.exports = app;
