const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");
const fs = require("fs");
require("dotenv").config();

// Leer movies.json
const data = JSON.parse(fs.readFileSync("./movies.json", "utf-8"));
const { movies, series } = data;

// 🧠 Manifest del addon
const manifest = {
  id: "org.primerlatino.addon",
  version: "1.1.1",
  name: "Primer Latino (Real-Debrid Personalizado)",
  description: "Addon LATINO que usa tu token Real-Debrid. Instálalo con ?token=<TU_TOKEN_RD>",
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

// 🧩 Función para leer el token desde la URL (?token=...)
function extractTokenFromUrl(req) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const token = url.searchParams.get("token");
  if (!token) throw new Error("❌ Falta token de Real-Debrid en la URL");
  return token.trim();
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

// 🎥 Stream Handler — versión robusta + retry + dummy
builder.defineStreamHandler(async (args, req) => {
  console.log("🛰️ Buscando stream para:", args);

  try {
    // 1️⃣ Token obligatorio
    const url = new URL(req.url, `http://${req.headers.host}`);
    const token = url.searchParams.get("token");
    if (!token) throw new Error("❌ Falta token de Real-Debrid en la URL");
    const headers = { Authorization: `Bearer ${token.trim()}` };

    // 2️⃣ JSON remoto (público y fijo)
    const DATA_URL = "https://raw.githubusercontent.com/johnpradoo/primer-latino/main/movies.json";
    const res = await axios.get(DATA_URL);
    const { movies = [], series = [] } = res.data || {};
    const streams = [];

    const rawId = args.id || "";
    const idClean = rawId.replace(/^(movie:|series:|tmdb:)/, "").trim();

    const matches =
      args.type === "movie"
        ? movies.filter(
            (m) =>
              m.id === rawId ||
              m.id === idClean ||
              m.tmdb_id === idClean ||
              m.id.endsWith(idClean)
          )
        : [];

    console.log(`👉 Coincidencias encontradas: ${matches.length}`);

    for (const movie of matches) {
      if (!movie?.hash) continue;
      const magnet = `magnet:?xt=urn:btih:${movie.hash}`;

      try {
        // Subir magnet
        const addMag = await axios.post(
          "https://api.real-debrid.com/rest/1.0/torrents/addMagnet",
          new URLSearchParams({ magnet }),
          { headers }
        );

        // Info inicial
        const info = await axios.get(
          `https://api.real-debrid.com/rest/1.0/torrents/info/${addMag.data.id}`,
          { headers }
        );

        const file = info.data.files.find((f) => /\.(mp4|mkv|avi)$/i.test(f.path));
        if (!file) continue;

        // Seleccionar archivo
        await axios.post(
          `https://api.real-debrid.com/rest/1.0/torrents/selectFiles/${addMag.data.id}`,
          new URLSearchParams({ files: file.id }),
          { headers }
        );

        // Esperar 3 segundos (para que Real-Debrid procese)
        await new Promise((r) => setTimeout(r, 3000));

        // Obtener links finales
        const dl = await axios.get(
          `https://api.real-debrid.com/rest/1.0/torrents/info/${addMag.data.id}`,
          { headers }
        );

        if (dl.data.links && dl.data.links.length > 0) {
          const unrestricted = await axios.post(
            "https://api.real-debrid.com/rest/1.0/unrestrict/link",
            new URLSearchParams({ link: dl.data.links[0] }),
            { headers }
          );

          if (unrestricted?.data?.download) {
            streams.push({
              title: `LATINOTOP • ${movie.quality} • ${movie.language}`,
              url: unrestricted.data.download,
            });
          }
        }
      } catch (err) {
        console.warn("⚠️ Real-Debrid:", err.response?.data || err.message);
      }
    }

    console.log(`✅ Streams construidos: ${streams.length}`);

    // Dummy stream para evitar crash de Stremio
    if (!streams.length) {
      console.warn("⚠️ Sin streams válidos, devolviendo dummy");
      return {
        streams: [
          {
            title: "⚠️ No se encontró enlace disponible (verifica tu token RD)",
            url: "https://stremio-addons-demo.vercel.app/no-stream.mp4",
          },
        ],
      };
    }

    return { streams };
  } catch (err) {
    console.error("❌ Error en Stream Handler:", err.message);
    return { streams: [] };
  }
});

// 🧠 Meta Handler (mínimo)
builder.defineMetaHandler(async ({ id }) => ({
  meta: { id, name: "Película / Serie LATINO", poster: "https://i.imgur.com/lE2FQIk.png" }
}));

// 🚀 Servidor
const PORT = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port: PORT });
console.log(`✅ Primer Latino activo en puerto ${PORT} (token + movies.json remoto)`);

process.on("unhandledRejection", (r) => console.error("⚠️ Unhandled:", r));
process.on("uncaughtException", (e) => console.error("⚠️ Uncaught:", e));
