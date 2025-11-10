const express = require("express");
const axios = require("axios");
const fs = require("fs");
const { addonBuilder } = require("stremio-addon-sdk");
require("dotenv").config();

// 🧱 Cargar catálogo
const data = JSON.parse(fs.readFileSync("./movies.json", "utf-8"));
const { movies = [], series = [] } = data;

// 🧩 Manifest base
const manifest = {
  id: "org.primerlatino.addon",
  version: "2.0.0",
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

// 🧠 Función para obtener metadata desde IMDb
async function getMetaFromIMDb(imdbID) {
  try {
    const res = await axios.get(
      `https://www.omdbapi.com/?i=${imdbID}&apikey=${process.env.OMDB_API_KEY}`
    );
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

// 🚀 Servidor Express
const app = express();

// 📜 MANIFEST con token embebido
app.get("/realdebrid=:token/manifest.json", (req, res) => {
  const token = req.params.token.trim();
  console.log(`🧩 Manifest solicitado con token: ${token.slice(-6)}`);
  res.json(manifest);
});

// 🎬 CATALOGO
app.get("/realdebrid=:token/catalog/:type/:id.json", async (req, res) => {
  const { type } = req.params;
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

    res.json({ metas });
  } catch (err) {
    console.error("❌ Catalog Handler:", err);
    res.json({ metas: [] });
  }
});

// 🔗 STREAM
app.get("/realdebrid=:token/stream/:type/:id.json", async (req, res) => {
  const { id, token } = req.params;
  const RD_TOKEN = token.trim();

  console.log(`🛰️ Stream request para: ${id}`);
  if (!RD_TOKEN) {
    console.warn("⚠️ Falta token de Real-Debrid");
    return res.json({
      streams: [
        {
          title: "⚠️ Falta token Real-Debrid",
          url: "https://stremio-addons-demo.vercel.app/no-stream.mp4"
        }
      ]
    });
  }

  try {
    const found = movies.find((m) => m.id === id) || series.find((s) => s.id === id);
    if (!found) {
      console.warn("❌ No se encontró el hash en movies.json");
      return res.json({ streams: [] });
    }

    const magnet = `magnet:?xt=urn:btih:${found.hash}&tr=udp://tracker.opentrackr.org:1337/announce`;

    let rdLink = null;

    // Subir magnet a Real-Debrid con el token del usuario
    try {
      // Paso 1: Subir el magnet
      const addMag = await axios.post(
        "https://api.real-debrid.com/rest/1.0/torrents/addMagnet",
        new URLSearchParams({ magnet }),
        { headers: { Authorization: `Bearer ${RD_TOKEN}` } }
      );

      // Paso 2: Obtener info
      const info = await axios.get(
        `https://api.real-debrid.com/rest/1.0/torrents/info/${addMag.data.id}`,
        { headers: { Authorization: `Bearer ${RD_TOKEN}` } }
      );

      const file = info.data.files.find((f) => /\.(mp4|mkv|avi)$/i.test(f.path));
      if (!file) throw new Error("No se encontró archivo reproducible.");

      // Paso 3: Seleccionar archivo
      await axios.post(
        `https://api.real-debrid.com/rest/1.0/torrents/selectFiles/${addMag.data.id}`,
        new URLSearchParams({ files: file.id }),
        { headers: { Authorization: `Bearer ${RD_TOKEN}` } }
      );

      // Paso 4: Obtener enlace directo
      const dl = await axios.get(
        `https://api.real-debrid.com/rest/1.0/torrents/info/${addMag.data.id}`,
        { headers: { Authorization: `Bearer ${RD_TOKEN}` } }
      );

      if (dl.data.links && dl.data.links[0]) {
        const unrestricted = await axios.post(
          "https://api.real-debrid.com/rest/1.0/unrestrict/link",
          new URLSearchParams({ link: dl.data.links[0] }),
          { headers: { Authorization: `Bearer ${RD_TOKEN}` } }
        );
        rdLink = unrestricted.data.download;
      }
    } catch (err) {
      console.warn("⚠️ Real-Debrid Error:", err.response?.data || err.message);
    }

    // Si todo falla, devolver magnet
    res.json({
      streams: [
        {
          title: `${found.language} • ${found.quality}`,
          url: rdLink || magnet
        }
      ]
    });
  } catch (err) {
    console.error("❌ Stream Handler (Error general):", err.message);
    res.json({
      streams: [
        {
          title: "❌ Error interno del addon",
          url: "https://stremio-addons-demo.vercel.app/no-stream.mp4"
        }
      ]
    });
  }
});

// 🧠 META
app.get("/realdebrid=:token/meta/:type/:id.json", async (req, res) => {
  const { id } = req.params;
  try {
    const imdbID = id.split(":")[0];
    const meta = await getMetaFromIMDb(imdbID);
    if (!meta) return res.json({ meta: { id, name: "No encontrado" } });
    res.json({ meta });
  } catch (err) {
    console.error("❌ Meta Handler:", err);
    res.json({ meta: { id, name: "Error al obtener metadatos" } });
  }
});

// 🧱 Errores globales
process.on("unhandledRejection", (reason) => console.error("⚠️ Unhandled:", reason));
process.on("uncaughtException", (err) => console.error("⚠️ Uncaught:", err));

// 🚀 Iniciar servidor
const PORT = process.env.PORT || 7000;
app.listen(PORT, () =>
  console.log(`✅ Primer Latino Addon corriendo en puerto ${PORT}`)
);
