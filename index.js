const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");
require("dotenv").config();

// 📦 URL remota de tu movies.json en GitHub (RAW)
const DATA_URL = "https://raw.githubusercontent.com/johnpradoo/primer-latino/main/movies.json";

// 🧠 Manifest del addon
const manifest = {
  id: "org.primerlatino.addon",
  version: "1.1.0",
  name: "Primer Latino (Real-Debrid Personalizado)",
  description: "Películas y series LATINO desde Real-Debrid. Instálalo con ?token=<TU_TOKEN_RD>",
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

// 🧩 Utilidad para leer el token desde la URL (?token=...)
function extractTokenFromUrl(req) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const token = url.searchParams.get("token");
  if (!token) throw new Error("❌ Falta token de Real-Debrid en la URL");
  return token.trim();
}

// 🎬 Catalog Handler
builder.defineCatalogHandler(async ({ type }) => {
  try {
    const res = await axios.get(DATA_URL);
    const data = res.data;
    const items = type === "movie" ? data.movies : data.series;

    const metas = items.map((item) => ({
      id: item.id,
      type: item.type,
      name: `${item.title} (${item.quality})`,
      poster: item.poster || "https://i.imgur.com/lE2FQIk.png",
      description: `Idioma: ${item.language} | Codec: ${item.codec}`
    }));

    return { metas };
  } catch (err) {
    console.error("❌ Error cargando catálogo:", err.message);
    return { metas: [] };
  }
});

// 🎥 Stream Handler (usa token del usuario y JSON remoto)
builder.defineStreamHandler(async (args, req) => {
  console.log("🛰️ Buscando stream para:", args);
  try {
    const token = extractTokenFromUrl(req);
    const headers = { Authorization: `Bearer ${token}` };

    // 1️⃣ Cargar datos de películas/series desde GitHub
    const res = await axios.get(DATA_URL);
    const data = res.data;
    const streams = [];

    const rawId = args.id || "";
    const idClean = rawId.replace("tmdb", "").replace(":", "").trim();

    // 2️⃣ Buscar coincidencia en movies
    if (args.type === "movie") {
      const matches = data.movies.filter(
        (m) => m.id === rawId || m.id === idClean || m.tmdb_id === idClean
      );

      for (const movie of matches) {
        const magnet = `magnet:?xt=urn:btih:${movie.hash}`;
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
          if (!file) continue;

          // Paso 3: seleccionar archivo
          await axios.post(
            `https://api.real-debrid.com/rest/1.0/torrents/selectFiles/${addMag.data.id}`,
            new URLSearchParams({ files: file.id }),
            { headers }
          );

          // Paso 4: obtener links y liberar
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
              url: unrestricted.data.download
            });
          }
        } catch (err) {
          console.warn("⚠️ Real-Debrid:", err.response?.data || err.message);
        }
      }
    }

    // 3️⃣ Buscar coincidencia en series
    if (args.type === "series") {
      const matches = data.series.filter(
        (s) =>
          (s.id === rawId || s.id === idClean || s.tmdb_id === idClean) &&
          s.season == args.season &&
          s.episode == args.episode
      );

      for (const serie of matches) {
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

          const file = info.data.files.find((f) => /\.(mp4|mkv|avi)$/i.test(f.path));
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
              url: unrestricted.data.download
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

// 🧠 Meta Handler (opcional)
builder.defineMetaHandler(async ({ id }) => ({
  meta: { id, name: "Película / Serie LATINO", poster: "https://i.imgur.com/lE2FQIk.png" }
}));

// 🚀 Servidor
const PORT = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port: PORT });
console.log(`✅ Primer Latino activo en puerto ${PORT} (token + movies.json remoto)`);

process.on("unhandledRejection", (r) => console.error("⚠️ Unhandled:", r));
process.on("uncaughtException", (e) => console.error("⚠️ Uncaught:", e));
