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
  idPrefixes: ["tt"],
  behaviorHints: {
    configurable: true,
    configurationRequired: true
  }
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

// 🔗 Stream Handler con token de usuario + debug detallado
builder.defineStreamHandler(async ({ id }, req) => {
  try {
    console.log("🛰️ Stream request para:", id);

    // 1️⃣ Obtener token de forma segura, incluso si req no existe
    let token = null;
    try {
      const fullUrl =
        req?.url && req?.headers?.host
          ? new URL(req.url, `http://${req.headers.host}`)
          : new URL(request?.url || "http://localhost"); // fallback
      token = fullUrl.searchParams.get("token");
    } catch {
      // fallback si viene directo desde navegador
      const raw = id.includes("?token=") ? id.split("?token=")[1] : null;
      token = raw ? raw.trim() : null;
    }

    if (!token) {
      console.warn("⚠️ Falta token de Real-Debrid");
      return {
        streams: [
          {
            title: "⚠️ Falta token Real-Debrid (?token=...)",
            url: "https://stremio-addons-demo.vercel.app/no-stream.mp4"
          }
        ]
      };
    }

    const headers = { Authorization: `Bearer ${token}` };
    console.log("🧩 Token activo recibido:", token.slice(-6));

    // 2️⃣ Buscar la película/serie en el JSON
    const found =
      movies.find((m) => m.id === id) || series.find((s) => s.id === id);
    if (!found) {
      console.warn("⚠️ No se encontró ID:", id);
      return { streams: [] };
    }

    console.log("🎬 Encontrado en catálogo:", found.title, "HASH:", found.hash);

    const magnet = `magnet:?xt=urn:btih:${found.hash}`;
    let rdLink = null;

    // 3️⃣ Intentar generar enlace Real-Debrid
    try {
      console.log("📡 Enviando magnet a RD...");
      const addMag = await axios.post(
        "https://api.real-debrid.com/rest/1.0/torrents/addMagnet",
        new URLSearchParams({ magnet }),
        { headers }
      );

      console.log("✅ Torrent agregado, ID:", addMag.data.id);

      const info = await axios.get(
        `https://api.real-debrid.com/rest/1.0/torrents/info/${addMag.data.id}`,
        { headers }
      );

      const file = info.data.files?.find((f) =>
        /\.(mp4|mkv|avi)$/i.test(f.path)
      );
      if (!file) throw new Error("⚠️ No se encontró archivo reproducible");

      console.log("🎞️ Archivo seleccionado:", file.path);

      await axios.post(
        `https://api.real-debrid.com/rest/1.0/torrents/selectFiles/${addMag.data.id}`,
        new URLSearchParams({ files: file.id }),
        { headers }
      );

      console.log("✅ Archivos seleccionados, obteniendo enlaces...");

      const dl = await axios.get(
        `https://api.real-debrid.com/rest/1.0/torrents/info/${addMag.data.id}`,
        { headers }
      );

      const link = dl.data?.links?.[0];
      if (!link) throw new Error("⚠️ Real-Debrid no devolvió enlaces válidos");

      console.log("🔗 Link RD encontrado, liberando...");

      const unrestricted = await axios.post(
        "https://api.real-debrid.com/rest/1.0/unrestrict/link",
        new URLSearchParams({ link }),
        { headers }
      );

      rdLink = unrestricted?.data?.download || null;

      console.log("✅ Link final obtenido:", rdLink);
    } catch (err) {
      console.error("💥 Error en flujo Real-Debrid:", err.response?.data || err.message);
    }

    // 4️⃣ Devolver stream
    if (!rdLink) {
      console.warn("⚠️ No se generó enlace válido (posible token o hash inválido)");
      return {
        streams: [
          {
            title: "⚠️ No se generó enlace válido (verifica token o hash)",
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
    console.error("❌ Stream Handler (Error general):", err.message);
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
