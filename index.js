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

// 🎥 Stream Handler — versión estricta (requiere ?token=...)
builder.defineStreamHandler(async (args, req) => {
  console.log("🛰️ Buscando stream para:", args);

  try {
    // 1️⃣ Token del usuario (obligatorio)
    const url = new URL(req.url, `http://${req.headers.host}`);
    const token = url.searchParams.get("token");
    if (!token) throw new Error("❌ Falta token de Real-Debrid en la URL");
    const headers = { Authorization: `Bearer ${token.trim()}` };

    // 2️⃣ Cargar JSON remoto (movies/series)
    const DATA_URL =
      "https://raw.githubusercontent.com/johnpradoo/primer-latino/refs/heads/main/movies.json?token=GHSAT0AAAAAADN6F24PLXNRZ7KTVMQ25HY42ISDVBA";
    const res = await axios.get(DATA_URL);
    const { movies, series } = res.data;

    const rawId = args.id || "";
    const idClean = rawId.replace("tmdb", "").replace(":", "").trim();
    const streams = [];

    // 3️⃣ Películas
    if (args.type === "movie") {
      const matches = movies.filter(
        (m) => m.id === rawId || m.id === idClean || m.tmdb_id === idClean
      );

      for (const movie of matches) {
        if (!movie?.hash) continue;
        const magnet = `magnet:?xt=urn:btih:${movie.hash}`;

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

          const file = info.data.files.find((f) =>
            /\.(mp4|mkv|avi)$/i.test(f.path)
          );
          if (!file) continue;

          await axios.post(
            `https://api.real-debrid.com/rest/1.0/torrents/selectFiles/${addMag.data.id}`,
            new URLSearchParams({ files: file.id }),
            { headers }
          );

          const dl = await axios.get(
            `https://api.real-debrid.com/rest/1.0/torrents/info/${addMag.data.id}`,
            { headers }
          );

          if (dl.data.links?.[0]) {
            const unrestricted = await axios.post(
              "https://api.real-debrid.com/rest/1.0/unrestrict/link",
              new URLSearchParams({ link: dl.data.links[0] }),
              { headers }
            );

            streams.push({
              title: `LATINOTOP • ${movie.quality} • ${movie.language}`,
              url: unrestricted?.data?.download || magnet,
            });
          }
        } catch (err) {
          console.warn("⚠️ Real-Debrid (movie):", err.response?.data || err.message);
        }
      }
    }

    // 4️⃣ Series
    if (args.type === "series") {
      const matches = series.filter(
        (s) =>
          (s.id === rawId || s.id === idClean || s.tmdb_id === idClean) &&
          s.season == args.season &&
          s.episode == args.episode
      );

      for (const serie of matches) {
        if (!serie?.hash) continue;
        const magnet = `magnet:?xt=urn:btih:${serie.hash}`;

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

          const file = info.data.files.find((f) =>
            /\.(mp4|mkv|avi)$/i.test(f.path)
          );
          if (!file) continue;

          await axios.post(
            `https://api.real-debrid.com/rest/1.0/torrents/selectFiles/${addMag.data.id}`,
            new URLSearchParams({ files: file.id }),
            { headers }
          );

          const dl = await axios.get(
            `https://api.real-debrid.com/rest/1.0/torrents/info/${addMag.data.id}`,
            { headers }
          );

          if (dl.data.links?.[0]) {
            const unrestricted = await axios.post(
              "https://api.real-debrid.com/rest/1.0/unrestrict/link",
              new URLSearchParams({ link: dl.data.links[0] }),
              { headers }
            );

            streams.push({
              title: `LATINOTOP • ${serie.quality} • ${serie.language}`,
              url: unrestricted?.data?.download || magnet,
            });
          }
        } catch (err) {
          console.warn("⚠️ Real-Debrid (series):", err.response?.data || err.message);
        }
      }
    }

    console.log(`✅ Streams encontrados: ${streams.length}`);
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
