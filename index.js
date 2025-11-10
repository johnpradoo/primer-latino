const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");
const fs = require("fs");
require("dotenv").config();

// Leer movies.json
const data = JSON.parse(fs.readFileSync("./movies.json", "utf-8"));
const { movies, series } = data;

// Manifest del addon
const manifest = {
  id: "org.primerlatino.addon",
  version: "1.0.5",
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

// 📚 Obtener datos desde IMDb (OMDb)
async function getMetaFromIMDb(imdbID) {
  try {
    const res = await axios.get(`https://www.omdbapi.com/?i=${imdbID}&apikey=${process.env.OMDB_API_KEY}`);
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
  } catch (err) {
    console.error("❌ IMDb Error:", err.message);
    return null;
  }
}

// 🎬 Catalog Handler
builder.defineCatalogHandler(async ({ type }) => {
  try {
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
  } catch (err) {
    console.error("❌ Catalog Handler:", err);
    return { metas: [] };
  }
});

// 🔗 Stream Handler (usa token del usuario, no el del servidor)
builder.defineStreamHandler(async ({ id }, req) => {
  try {
    // 1️⃣ Leer token desde la URL
    const url = new URL(req.url, `http://${req.headers.host}`);
    const token = url.searchParams.get("token");
    if (!token) {
      console.warn("⚠️ Falta token de Real-Debrid en la URL");
      return { streams: [] };
    }

    const headers = { Authorization: `Bearer ${token.trim()}` };

    // 2️⃣ Buscar película o serie
    const found = movies.find((m) => m.id === id) || series.find((s) => s.id === id);
    if (!found) {
      console.warn("⚠️ No se encontró ID:", id);
      return { streams: [] };
    }

    const magnet = `magnet:?xt=urn:btih:${found.hash}&tr=udp://tracker.opentrackr.org:1337/announce&tr=udp://tracker.openbittorrent.com:6969/announce`;
    let rdLink = null;

    try {
      // Paso 1: subir magnet
      const addMag = await axios.post(
        "https://api.real-debrid.com/rest/1.0/torrents/addMagnet",
        new URLSearchParams({ magnet }),
        { headers }
      );

      // Paso 2: obtener info del torrent
      const info = await axios.get(
        `https://api.real-debrid.com/rest/1.0/torrents/info/${addMag.data.id}`,
        { headers }
      );

      const file = info.data.files.find((f) => /\.(mp4|mkv|avi)$/i.test(f.path));
      if (file) {
        // Paso 3: seleccionar archivo
        await axios.post(
          `https://api.real-debrid.com/rest/1.0/torrents/selectFiles/${addMag.data.id}`,
          new URLSearchParams({ files: file.id }),
          { headers }
        );

        // Paso 4: obtener enlace final
        const dl = await axios.get(
          `https://api.real-debrid.com/rest/1.0/torrents/info/${addMag.data.id}`,
          { headers }
        );

        if (dl.data.links && dl.data.links[0]) {
          // Paso 5: liberar el enlace
          const unrestricted = await axios.post(
            "https://api.real-debrid.com/rest/1.0/unrestrict/link",
            new URLSearchParams({ link: dl.data.links[0] }),
            { headers }
          );
          rdLink = unrestricted.data.download;
        }
      }
    } catch (err) {
      console.warn("⚠️ Real-Debrid:", err.response?.data || err.message);
    }

    // 3️⃣ Devolver stream
    return {
      streams: [
        {
          title: `${found.language} • ${found.quality}`,
          url: rdLink || magnet
        }
      ]
    };
  } catch (err) {
    console.error("❌ Stream Handler:", err);
    return { streams: [] };
  }
});

// 🚀 Servidor
const PORT = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port: PORT });
console.log(`✅ Primer Latino Addon corriendo en puerto ${PORT}`);

// 🧱 Errores globales
process.on("unhandledRejection", (reason) => console.error("⚠️ Unhandled:", reason));
process.on("uncaughtException", (err) => console.error("⚠️ Uncaught:", err));
