const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");
const fs = require("fs");
require("dotenv").config();

const data = JSON.parse(fs.readFileSync("./movies.json", "utf-8"));
const { movies, series } = data;

const manifest = {
  id: "org.primerlatino.addon",
  version: "1.0.9",
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

async function getMetaFromIMDb(imdbID) {
  try {
    const r = await axios.get(`https://www.omdbapi.com/?i=${imdbID}&apikey=${process.env.OMDB_API_KEY}`);
    if (r.data.Response === "False") return null;
    const d = r.data;
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
    console.error("CatalogHandler:", err);
    return { metas: [] };
  }
});

builder.defineStreamHandler(async (args) => {
  try {
    // Obtener token directamente desde la URL del manifest
    const userToken = (() => {
      if (args.extra && args.extra.token) return args.extra.token;

      // Si no viene en extra, intentar leerlo de la URL completa (args.extra?.search no existe)
      const match = args.id && args.id.includes("?token=")
        ? args.id.split("?token=")[1]
        : null;
      return match || null;
    })();

    if (!userToken) {
      console.warn("❌ Falta token de usuario. Acceso denegado a Real-Debrid.");
      return {
        streams: [
          {
            title: "🔒 Este addon requiere tu token de Real-Debrid",
            url: "https://johnpradoo.github.io/primer-latino-page/"
          }
        ]
      };
    }

    const found = movies.find((m) => m.id === args.id) || series.find((s) => s.id === args.id);
    if (!found) return { streams: [] };

    const magnet = `magnet:?xt=urn:btih:${found.hash}`;
    let rdLink = null;

    try {
      const addMag = await axios.post(
        "https://api.real-debrid.com/rest/1.0/torrents/addMagnet",
        new URLSearchParams({ magnet }),
        { headers: { Authorization: `Bearer ${userToken}` } }
      );

      const info = await axios.get(
        `https://api.real-debrid.com/rest/1.0/torrents/info/${addMag.data.id}`,
        { headers: { Authorization: `Bearer ${userToken}` } }
      );

      const file = info.data.files.find((f) => /\.(mp4|mkv|avi)$/i.test(f.path));
      if (file) {
        await axios.post(
          `https://api.real-debrid.com/rest/1.0/torrents/selectFiles/${addMag.data.id}`,
          new URLSearchParams({ files: file.id }),
          { headers: { Authorization: `Bearer ${userToken}` } }
        );

        const dl = await axios.get(
          `https://api.real-debrid.com/rest/1.0/torrents/info/${addMag.data.id}`,
          { headers: { Authorization: `Bearer ${userToken}` } }
        );

        if (dl.data.links && dl.data.links[0]) {
          const unrestricted = await axios.post(
            "https://api.real-debrid.com/rest/1.0/unrestrict/link",
            new URLSearchParams({ link: dl.data.links[0] }),
            { headers: { Authorization: `Bearer ${userToken}` } }
          );
          rdLink = unrestricted.data.download;
        }
      }
    } catch (err) {
      console.warn("⚠️ Real-Debrid:", err.response?.data || err.message);
    }

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

builder.defineMetaHandler(async ({ id }) => {
  const imdbID = id.split(":")[0];
  const meta = await getMetaFromIMDb(imdbID);
  return { meta: meta || { id, name: "No encontrado" } };
});

// 🚀 Servidor original del SDK (sin Express)
serveHTTP(builder.getInterface(), { port: process.env.PORT || 7000 });

process.on("unhandledRejection", (r) => console.error("⚠️ Unhandled:", r));
process.on("uncaughtException", (e) => console.error("⚠️ Uncaught:", e));
