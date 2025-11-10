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

// 🔗 Stream Handler (token del usuario desde la URL)
builder.defineStreamHandler(async ({ id }, req) => {
  try {
    // 1️⃣ Leer token desde la URL
    const url = new URL(req.url, `http://${req.headers.host}`);
    const token = url.searchParams.get("token");

    if (!token) {
      console.warn("⚠️ Falta token Real-Debrid");
      return {
        streams: [
          {
            title: "⚠️ Falta token Real-Debrid (?token=...)",
            url: "https://stremio-addons-demo.vercel.app/no-stream.mp4"
          }
        ]
      };
    }

    const headers = { Authorization: `Bearer ${token.trim()}` };

    // 2️⃣ Buscar el contenido
    const found = movies.find((m) => m.id === id) || series.find((s) => s.id === id);
    if (!found) {
      console.warn("⚠️ ID no encontrado:", id);
      return { streams: [] };
    }

    const magnet = `magnet:?xt=urn:btih:${found.hash}`;
    let rdLink = null;

    // 3️⃣ Procesar con el token del usuario
    try {
      const addMag = await axios.post(
        "https://api.real-debrid.com/rest/1.0/torrents/addMagnet",
        new URLSearchParams({ magnet }),
        { headers }
      );

      const info = await axios.get(
        `https://api.real-debrid.com/rest/1.0/torrents/info/${addMag.data.id}`,
        { headers }
      );

      const file = info.data.files.find((f) => /\.(mp4|mkv|avi)$/i.test(f.path));
      if (file) {
        await axios.post(
          `https://api.real-debrid.com/rest/1.0/torrents/selectFiles/${addMag.data.id}`,
          new URLSearchParams({ files: file.id }),
          { headers }
        );

        const dl = await axios.get(
          `https://api.real-debrid.com/rest/1.0/torrents/info/${addMag.data.id}`,
          { headers }
        );

        if (dl.data.links && dl.data.links[0]) {
          const unrestricted = await axios.post(
            "https://api.real-debrid.com/rest/1.0/unrestrict/link",
            new URLSearchParams({ link: dl.data.links[0] }),
            { headers }
          );
          rdLink = unrestricted?.data?.download || null;
        }
      }
    } catch (err) {
      console.warn("⚠️ Real-Debrid:", err.response?.data || err.message);
    }

    // 4️⃣ Devolver stream
    if (!rdLink) {
      return {
        streams: [
          {
            title: "⚠️ No se generó enlace válido (verifica tu token RD)",
            url: "https://stremio-addons-demo.vercel.app/no-stream.mp4"
          }
        ]
      };
    }

    return {
      streams: [
        {
          title: `${found.language} • ${found.quality}`,
          url: rdLink
        }
      ]
    };
  } catch (err) {
    console.error("❌ Stream Handler:", err);
    return {
      streams: [
        {
          title: "❌ Error interno del addon",
          url: "https://stremio-addons-demo.vercel.app/no-stream.mp4"
        }
      ]
    };
  }
});

// 🧠 Meta Handler
builder.defineMetaHandler(async ({ id }) => {
  try {
    const imdbID = id.split(":")[0];
    const meta = await getMetaFromIMDb(imdbID);
    if (!meta) return { meta: { id, name: "No encontrado" } };
    return { meta };
  } catch (err) {
    console.error("❌ Meta Handler:", err);
    return { meta: { id, name: "Error al obtener metadatos" } };
  }
});

// 🚀 Servidor
const PORT = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port: PORT });
console.log(`✅ Primer Latino Addon corriendo en puerto ${PORT}`);

// 🧱 Errores globales
process.on("unhandledRejection", (reason) => console.error("⚠️ Unhandled:", reason));
process.on("uncaughtException", (err) => console.error("⚠️ Uncaught:", err));
