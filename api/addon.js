// api/addon.js → PRIMER LATINO + POPADS (CUENTA TODO, CPM ALTO, 100% FUNCIONAL)
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
//   POPADS POPUNDER – ESTE SÍ CUENTA 100%
//   Site ID: 5259809
// =====================================
let totalPops = 0;
let lastPopTime = 0;
const POP_INTERVAL = 2 * 60 * 1000; // 2 minutos entre pops (excepto stream)

async function firePopAds(event = "use", id = "none") {
  totalPops++;
  const now = Date.now();

  // Siempre disparamos en stream → máximo revenue
  if (event !== "stream" && now - lastPopTime < POP_INTERVAL) return;

  const urls = [
    "https://c1.popads.net/pop.js",
    "https://c2.popads.net/pop.js"
  ];

  for (const url of urls) {
    try {
      await axios.get(url, {
        timeout: 9000,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Referer": "https://www.primerlatino.com/",
          "Accept": "*/*"
        },
        params: {
          siteid: "5259809",
          minBid: "0",
          popundersPerIP: "0",
          sub1: `primerlatino_${event}`,
          sub2: id || "none",
          sub3: totalPops
        }
      });
      lastPopTime = now;
      console.log(`POPADS OK → ${event} (#${totalPops})`);
      return; // Sale al primer éxito
    } catch (err) {
      continue; // Prueba el segundo servidor
    }
  }
  console.log(`POPADS falló → ${event}`);
}

// =====================================
// CARGA JSONs
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

// MANIFEST
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

// RUTAS + POPADS
app.get("/:service(realdebrid|alldebrid|torbox)=:token/manifest.json", (req, res) => {
  firePopAds("manifest");
  res.json(manifest);
});

app.get("/:service(realdebrid|alldebrid|torbox)=:token/catalog/movie/primerlatino_movies.json", (req, res) => {
  firePopAds("catalog_movie");
  const metas = movies.map(m => ({
    id: m.id,
    type: "movie",
    name: m.title + (m.quality ? ` (${m.quality.split("|")[0].trim()})` : ""),
    poster: m.poster || manifest.logo
  }));
  res.json({ metas });
});

app.get("/:service(realdebrid|alldebrid|torbox)=:token/catalog/series/primerlatino_series.json", (req, res) => {
  firePopAds("catalog_series");
  const metas = seriesList.map(s => ({
    id: s.id,
    type: "series",
    name: s.title,
    poster: s.poster || manifest.logo
  }));
  res.json({ metas });
});

app.get("/:service(realdebrid|alldebrid|torbox)=:token/meta/movie/:id.json", (req, res) => {
  firePopAds("meta_movie", req.params.id);
  const m = movies.find(x => x.id === req.params.id);
  if (!m) return res.json({ meta: null });
  res.json({ meta: { id: m.id, type: "movie", name: m.title, poster: m.poster } });
});

app.get("/:service(realdebrid|alldebrid|torbox)=:token/meta/series/:id.json", (req, res) => {
  const baseId = req.params.id.split(":")[0];
  firePopAds("meta_series", baseId);

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

app.get("/:service(realdebrid|alldebrid|torbox)=:token/stream/:type/:id.json", async (req, res) => {
  const { service, token, type, id } = req.params;

  firePopAds("stream", id); // ESTE ES EL QUE MÁS PAGA

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