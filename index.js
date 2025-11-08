const { addonBuilder } = require("stremio-addon-sdk");
const axios = require("axios");
const fs = require("fs");
const http = require("http");
require("dotenv").config();

// Leer movies.json
const data = JSON.parse(fs.readFileSync("./movies.json", "utf-8"));
const { movies, series } = data;

// Manifiesto del addon
const manifest = {
  id: "org.primerlatino.addon",
  version: "1.0.1",
  name: "Primer Latino",
  description: "Películas y series LATINO desde Real-Debrid y Magnet Links.",
  logo: "https://i.imgur.com/lE2FQIk.png",
  background: "https://i.imgur.com/lE2FQIk.png",
  types: ["movie", "series"],
  resources: ["catalog", "stream", "meta"],
  catalogs: [
    { type: "movie", id: "primerlatino_movies", name: "Películas LATINO" },
    { type: "series", id: "primerlatino_series", name: "Series LATINO" }
  ],
  idPrefixes: ["tt"]
};

const builder = new addonBuilder(manifest);

// Función auxiliar IMDb (OMDb)
async function getMetaFromIMDb(imdbID) {
  try {
    const res = await axios.get(`https://www.omdbapi.com/?i=${imdbID}&apikey=8b6c8c8a`);
    const d = res.data;
    if (!d || d.Response === "False") return null;

    return {
      id: imdbID,
      type: d.Type || "movie",
      name: d.Title,
      poster: d.Poster !== "N/A" ? d.Poster : undefined,
      background: d.Poster,
      description: d.Plot,
      releaseInfo: d.Year,
      imdbRating: d.imdbRating
    };
  } catch {
    return null;
  }
}

// Catalog Handler
builder.defineCatalogHandler(async ({ type }) => {
  const items = type === "movie" ? movies : series;
  const metas = [];

  for (const item of items) {
    const meta = await getMetaFromIMDb(item.id.split(":")[0]);
    if (!meta) continue;

    metas.push({
      id: item.id,
      type: item.type,
      name: `${item.title} (${item.quality})`,
      poster: item.poster || meta.poster,
      description: `${meta.description || ""}\nIdioma: ${item.language}\nCodec: ${item.codec}`
    });
  }

  return { metas };
});

// Stream Handler
builder.defineStreamHandler(async ({ id }) => {
  const found = movies.find((m) => m.id === id) || series.find((s) => s.id === id);
  if (!found) return { streams: [] };

  const magnet = `magnet:?xt=urn:btih:${found.hash}`;
  let rdLink = null;

  if (process.env.REALDEBRID_API) {
    try {
      const res = await axios.post(
        "https://api.real-debrid.com/rest/1.0/unrestrict/link",
        new URLSearchParams({ link: magnet }),
        { headers: { Authorization: `Bearer ${process.env.REALDEBRID_API}` } }
      );
      rdLink = res.data.download;
    } catch (err) {
      console.warn("⚠️ Real-Debrid:", err.response?.data || err.message);
    }
  }

  return {
    streams: [
      {
        title: `${found.language} • ${found.quality}`,
        url: rdLink || magnet
      }
    ]
  };
});

// Meta Handler
builder.defineMetaHandler(async ({ id }) => {
  const imdbID = id.split(":")[0];
  const meta = await getMetaFromIMDb(imdbID);
  if (!meta) return { meta: { id, name: "No encontrado" } };
  return { meta };
});

// 🚀 Servidor HTTP manual (para compatibilidad total con Render)
const PORT = process.env.PORT || 7000;
const addonInterface = builder.getInterface();

http
  .createServer((req, res) => {
    // Cabeceras CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.url === "/manifest.json") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(addonInterface.manifest));
    } else if (req.url.startsWith("/catalog/")) {
      addonInterface.get(req, res);
    } else if (req.url.startsWith("/stream/")) {
      addonInterface.get(req, res);
    } else if (req.url.startsWith("/meta/")) {
      addonInterface.get(req, res);
    } else {
      res.writeHead(404);
      res.end("Not Found");
    }
  })
  .listen(PORT, () => {
    console.log(`✅ Primer Latino corriendo en el puerto ${PORT}`);
  });
