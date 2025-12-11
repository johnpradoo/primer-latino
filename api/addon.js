// api/addon.js → PRIMER LATINO + POPADS ADCODE API (CUENTA 100% EN TIEMPO REAL)
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
//   POPADS ADCODE API → CUENTA AL 100% EN TIEMPO REAL
//   Site ID: 5259809
// =====================================
const POPADS_API_URL = "https://www.popads.net/api/website_code";

let totalPops = 0;
let lastPopTime = 0;
const INTERVAL = 90 * 1000; // 90 segundos entre pops (excepto stream)

async function firePopAdsAPI(event = "use", id = "none") {
  totalPops++;
  const now = Date.now();

  // Siempre disparamos en stream y manifest → máximo revenue
  if (event !== "stream" && event !== "manifest" && now - lastPopTime < INTERVAL) return;

  try {
    await axios.get(POPADS_API_URL, {
      timeout: 8000,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": "https://www.primerlatino.com/",
      },
      params: {
        key: "https://www.popads.net/api/website_code?key=APIKEY&website_id=5259809&tl=auto&of=1",
        website_id: "5259809",
        tl: "auto",
        of: "1",
        sub1: `primerlatino_${event}`,
        sub2: id || "none",
        sub3: totalPops
      }
    });

    lastPopTime = now;
    console.log(`POPADS API OK → ${event} (#${totalPops})`);
  } catch (err) {
    console.log(`POPADS API falló → ${event}`);
  }
}

// =====================================
// CARGA JSONs + MANIFEST + SERVICIOS (igual que siempre)
function loadJSON(filename) {
  const filePath = path.resolve(process.cwd(), "public", filename);
  if (!fs.existsSync(filePath)) {
    console.error(`Archivo no encontrado: ${filename}`);
    return {};
  }
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

let movies = [], seriesList = [], episodes = [];
try {
  const mData = loadJSON("movies.json");
  const sData = loadJSON("series.json");
  const eData = loadJSON("episodes.json");
  movies = mData.movies || mData || [];
  seriesList = sData.series || sData || [];
  episodes = eData.episodes || eData || [];
  console.log(`PRIMER LATINO CARGADO → ${movies.length} películas | ${seriesList.length} series | ${episodes.length} episodios`);
} catch (err) {
  console.error("ERROR CRÍTICO CARGANDO JSONs:", err.message);
}

const manifest = {
  id: "org.primerlatino.addon",
  version: "9.2.50",
  name: "Primer Latino",
  description: "Películas y Series Latino Full Premium – https://ko-fi.com/johnpradoo",
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

const realDebrid = require("./services/realDebrid");
const allDebrid = require("./services/allDebrid");
const torbox = require("./services/torbox");

// RUTAS + POPADS API
app.get("/:service(realdebrid|alldebrid|torbox)=:token/manifest.json", (req, res) => {
  firePopAdsAPI("manifest");
  res.json(manifest);
});

app.get("/:service(realdebrid|alldebrid|torbox)=:token/catalog/movie/primerlatino_movies.json", (req, res) => {
  firePopAdsAPI("catalog_movie");
  const metas = movies.map(m => ({
    id: m.id,
    type: "movie",
    name: m.title + (m.quality ? ` (${m.quality.split("|")[0].trim()})` : ""),
    poster: m.poster || manifest.logo
  }));
  res.json({ metas });
});

app.get("/:service(realdebrid|alldebrid|torbox)=:token/catalog/series/primerlatino_series.json", (req, res) => {
  firePopAdsAPI("catalog_series");
  const metas = seriesList.map(s => ({
    id: s.id,
    type: "series",
    name: s.title,
    poster: s.poster || manifest.logo
  }));
  res.json({ metas });
});

app.get("/:service(realdebrid|alldebrid|torbox)=:token/meta/movie/:id.json", (req, res) => {
  firePopAdsAPI("meta_movie", req.params.id);
  const m = movies.find(x => x.id === req.params.id);
  if (!m) return res.json({ meta: null });
  res.json({ meta: { id: m.id, type: "movie", name: m.title, poster: m.poster } });
});

app.get("/:service(realdebrid|alldebrid|torbox)=:token/meta/series/:id.json", (req, res) => {
  const baseId = req.params.id.split(":")[0];
  firePopAdsAPI("meta_series", baseId);
  // ... resto igual
});

app.get("/:service(realdebrid|alldebrid|torbox)=:token/stream/:type/:id.json", async (req, res) => {
  const { service, token, type, id } = req.params;

  firePopAdsAPI("stream", id); // EL QUE MÁS PAGA

  const item = type === "movie" ? movies.find(m => m.id === id) : episodes.find(e => e.id === id);
  if (!item || !item.hash) return res.json({ streams: [] });

  try {
    let streams = [];
    if (service === "realdebrid") streams = await realDebrid.getStream(token, item.hash, item);
    else if (service === "alldebrid") streams = await allDebrid.getStream(token, item.hash, item);
    else if (service === "torbox") streams = await torbox.getStream(token, item.hash, item);
    res.json({ streams });
  } catch (err) {
    console.error("ERROR STREAM:", err.response?.data || err.message);
    res.json({ streams: [] });
  }
});

module.exports = app;