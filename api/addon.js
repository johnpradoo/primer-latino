// api/addon.js → Versión compatible con nombres completos + retrocompatibilidad con iniciales
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

// FUNCIÓN QUE LEE LOS JSONs
function loadJSON(filename) {
  const filePath = path.resolve(process.cwd(), "public", filename);
  if (!fs.existsSync(filePath)) {
    console.error(`Archivo no encontrado: ${filename}`);
    return {};
  }
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

// CARGAR JSONs
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

// MANIFEST (sin cambios)
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

// IMPORTA LOS SERVICIOS
const realDebrid = require("./services/realDebrid");
const allDebrid = require("./services/allDebrid");
const torbox = require("./services/torbox");

// RUTAS
app.get("/:service(realdebrid|alldebrid|torbox)=:token/manifest.json", (req, res) => {
  res.json(manifest);
});

// Catalog movie - Muestra todas las calidades juntas en paréntesis
app.get("/:service(realdebrid|alldebrid|torbox)=:token/catalog/movie/primerlatino_movies.json", (req, res) => {
  const metas = movies.map(m => {
    // Soporte dual: quality o q (string o array)
    let qualities = [];
    if (m.quality) {
      qualities = Array.isArray(m.quality) ? m.quality : m.quality.split("|").map(q => q.trim());
    } else if (m.q) {
      qualities = Array.isArray(m.q) ? m.q : m.q.split("|").map(q => q.trim());
    }
    let qualityStr = qualities.length > 0 ? ` (${qualities.join(" / ")})` : "";
    
    const title = m.title || m.t || "";
    const poster = m.poster || m.p || manifest.logo;

    return {
      id: m.id,
      type: "movie",
      name: title + qualityStr,
      poster
    };
  });
  res.json({ metas });
});

// Catalog series
app.get("/:service(realdebrid|alldebrid|torbox)=:token/catalog/series/primerlatino_series.json", (req, res) => {
  const metas = seriesList.map(s => ({
    id: s.id,
    type: "series",
    name: s.title || s.t || "",
    poster: s.poster || s.p || manifest.logo
  }));
  res.json({ metas });
});

// Meta movie
app.get("/:service(realdebrid|aldebrid|torbox)=:token/meta/movie/:id.json", (req, res) => {
  const m = movies.find(x => x.id === req.params.id);
  if (!m) return res.json({ meta: null });
  res.json({
    meta: {
      id: m.id,
      type: "movie",
      name: m.title || m.t || "",
      poster: m.poster || m.p
    }
  });
});

// Meta series (sin cambios importantes)
app.get("/:service(realdebrid|alldebrid|torbox)=:token/meta/series/:id.json", (req, res) => {
  const baseId = req.params.id.split(":")[0];
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

  res.json({
    meta: {
      id: baseId,
      type: "series",
      name: serie.title || serie.t || "",
      poster: serie.poster || serie.p,
      videos
    }
  });
});

// STREAM - Lógica 100% mantenida, solo con soporte dual de campos
app.get("/:service(realdebrid|alldebrid|torbox)=:token/stream/:type/:id.json", async (req, res) => {
  const { service, token, type, id } = req.params;

  const item = type === "movie" ? movies.find(m => m.id === id) : episodes.find(e => e.id === id);
  if (!item) return res.json({ streams: [] });

  // Soporte dual para hash/h
  let hashes = [];
  if (item.hash) hashes = Array.isArray(item.hash) ? item.hash : item.hash.split("|").map(h => h.trim());
  else if (item.h) hashes = Array.isArray(item.h) ? item.h : item.h.split("|").map(h => h.trim());
  if (hashes.length === 0) return res.json({ streams: [] });

  // Soporte dual para quality/q
  let qualities = [];
  if (item.quality) qualities = Array.isArray(item.quality) ? item.quality : item.quality.split("|").map(q => q.trim());
  else if (item.q) qualities = Array.isArray(item.q) ? item.q : item.q.split("|").map(q => q.trim());

  // Ajustar longitudes
  while (qualities.length < hashes.length) qualities.push("Unknown");
  while (hashes.length < qualities.length) hashes.push(null);

  try {
    let streams = [];

    for (let i = 0; i < hashes.length; i++) {
      const currentHash = hashes[i];
      if (!currentHash) continue;

      const manualQuality = qualities[i] || "Unknown";

      let partialStreams = [];
      if (service === "realdebrid") {
        partialStreams = await realDebrid.getStream(token, currentHash, item);
      } else if (service === "alldebrid") {
        partialStreams = await allDebrid.getStream(token, currentHash, item);
      } else if (service === "torbox") {
        partialStreams = await torbox.getStream(token, currentHash, item);
      }

      if (!partialStreams || partialStreams.length === 0) continue;

      partialStreams = partialStreams.map(stream => {
        const filename = (stream.name || "").toLowerCase();
        let quality = manualQuality;

        // Detección automática como respaldo
        if (filename.includes("2160") || filename.includes("4k") || filename.includes("uhd")) quality = "4K";
        else if (filename.includes("1440") || filename.includes("2k")) quality = "1440p";
        else if (filename.includes("1080")) quality = "1080p";
        else if (filename.includes("720")) quality = "720p";

        // Soporte dual language/l
        const langRaw = item.language || item.l || "";
        const lang = langRaw.replace(/\|/g, "·").trim();

        const title = lang
          ? `Primer Latino 🎄 ${quality} · ${lang}`
          : `Primer Latino 🎄 ${quality}`;

        return {
          ...stream,
          title: title.trim()
        };
      });

      streams = streams.concat(partialStreams);
    }

    // Eliminar duplicados por URL
    const uniqueStreams = [];
    const seenUrls = new Set();
    for (const stream of streams) {
      if (stream.url && !seenUrls.has(stream.url)) {
        seenUrls.add(stream.url);
        uniqueStreams.push(stream);
      }
    }

    res.json({ streams: uniqueStreams });
  } catch (err) {
    console.error("ERROR STREAM:", err.response?.data || err.message);
    res.json({ streams: [] });
  }
});

module.exports = app;