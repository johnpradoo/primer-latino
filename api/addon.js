// api/addon.js → INTEGRADO CON ALLDEBRID Y TORBOX (modular) + CPM INTELIGENTE
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

// =====================================
//   CPM INTELIGENTE 2025 – Solo cuando Stremio realmente usa el addon
// =====================================
const CPM_URL = "https://www.effectivegatecpm.com/m5bthzhn?key=9475d4e108ce99fb600b351590a5b9cd";

let totalRequests = 0;
let lastPingTime = 0;
const MIN_INTERVAL = 4 * 60 * 1000; // 4 minutos entre pings como máximo

async function cpmPing(event = "use", id = "none") {
  totalRequests++;
  const now = Date.now();

  // Antispam: aunque haya 100 peticiones seguidas, solo hacemos 1 ping cada 4 min
  if (now - lastPingTime < MIN_INTERVAL) return;

  try {
    await axios.get(`${CPM_URL}&event=${event}&id=${id}&sub1=${totalRequests}`, {
      timeout: 6000
    });
    lastPingTime = now;
    console.log(`CPM → ${event} (#${totalRequests})`);
  } catch (err) {
    // Silencioso, no spameamos consola
  }
}
// =====================================

// FUNCIÓN QUE LEE LOS JSONs DESDE LA CARPETA public/
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
  logo: "https://www.primerlatino.com/icon.png",
  background: "https://www.primerlatino.com/banner.jpg",
  types: ["movie", "series"],
  resources: ["catalog", "meta", "stream"],
  catalogs: [
    { type: "movie", id: "primerlatino_movies", name: "Películas Latino" },
    { type: "series", id: "primerlatino_series", name: "Series Latino" }
  ],
  idPrefixes: ["tt"]
};

// IMPORTA LOS SERVICIOS (modular)
const realDebrid = require("./services/realDebrid");
const allDebrid = require("./services/allDebrid");
const torbox = require("./services/torbox");

// RUTAS (manifest para todos)
app.get("/:service(realdebrid|alldebrid|torbox)=:token/manifest.json", (req, res) => {
  cpmPing("manifest");
  res.json(manifest);
});

// Catalog movie (igual para todos)
app.get("/:service(realdebrid|alldebrid|torbox)=:token/catalog/movie/primerlatino_movies.json", (req, res) => {
  cpmPing("catalog_movie");
  const metas = movies.map(m => ({
    id: m.id,
    type: "movie",
    name: m.title + (m.quality ? ` (${m.quality.split("|")[0].trim()})` : ""),
    poster: m.poster || manifest.logo
  }));
  res.json({ metas });
});

// Catalog series (igual para todos)
app.get("/:service(realdebrid|alldebrid|torbox)=:token/catalog/series/primerlatino_series.json", (req, res) => {
  cpmPing("catalog_series");
  const metas = seriesList.map(s => ({
    id: s.id,
    type: "series",
    name: s.title,
    poster: s.poster || manifest.logo
  }));
  res.json({ metas });
});

// Meta movie (igual para todos)
app.get("/:service(realdebrid|alldebrid|torbox)=:token/meta/movie/:id.json", (req, res) => {
  cpmPing("meta_movie", req.params.id);
  const m = movies.find(x => x.id === req.params.id);
  if (!m) return res.json({ meta: null });
  res.json({ meta: { id: m.id, type: "movie", name: m.title, poster: m.poster } });
});

// Meta series (igual para todos)
app.get("/:service(realdebrid|alldebrid|torbox)=:token/meta/series/:id.json", (req, res) => {
  const baseId = req.params.id.split(":")[0];
  cpmPing("meta_series", baseId);

  const serie = seriesList.find(s => s.id === baseId);
  if (!serie) return res.json({ meta: null });

  const seasonMap = {};
  episodes.filter(e => e.id.startsWith(baseId + ":")).forEach(e => {
    const [, s, ep] = e.id.split(":");
    if (!seasonMap[s]) seasonMap[s] = [];
    seasonMap[s].push({ id: e.id, title: `Episodio ${ep}`, episode: +ep });
  });

  const videos = {};
  Object.keys(seasonMap).sort((a, b) => a - b).forEach(s => {
    videos[s] = { "0": seasonMap[s].sort((a, b) => a.episode - b.episode) };
  });

  res.json({ meta: { id: baseId, type: "series", name: serie.title, poster: serie.poster, videos } });
});

// STREAM (switch por servicio – la magia modular)
app.get("/:service(realdebrid|alldebrid|torbox)=:token/stream/:type/:id.json", async (req, res) => {
  const { service, token, type, id } = req.params;

  cpmPing("stream", id);

  const item = type === "movie" ? movies.find(m => m.id === id) : episodes.find(e => e.id === id);
  if (!item || !item.hash) return res.json({ streams: [] });

  try {
    let streams = [];
    if (service === "realdebrid") {
      streams = await realDebrid.getStream(token, item.hash, item);
    } else if (service === "alldebrid") {
      streams = await allDebrid.getStream(token, item.hash, item);
    } else if (service === "torbox") {
      streams = await torbox.getStream(token, item.hash, item);
    }

    res.json({ streams });
  } catch (err) {
    console.error("ERROR STREAM:", err.response?.data || err.message);
    res.json({ streams: [] });
  }
});

module.exports = app;