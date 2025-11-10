const express = require("express");
const axios = require("axios");
const fs = require("fs");
require("dotenv").config();

const app = express();

// CORS y JSON correctos
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  res.type("application/json");
  next();
});

// Endpoint base (debug)
app.get("/", (req, res) => {
  res.json({
    status: "OK",
    message: "Servidor activo de Primer Latino Addon",
    usage: "Usa /realdebrid=TOKEN/manifest.json para instalar en Stremio"
  });
});

// Cargar catálogo local
const data = JSON.parse(fs.readFileSync("./movies.json", "utf-8"));
const { movies = [], series = [] } = data;

// Manifest base
const manifest = {
  id: "org.primerlatino.addon",
  version: "2.0.1",
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

// Manifest dinámico
app.get("/realdebrid=:token/manifest.json", (req, res) => {
  const token = req.params.token.trim();
  console.log(`🧩 Manifest solicitado (token: ${token.slice(0, 6)}...)`);
  res.json(manifest);
});

// Catalog Handler
app.get("/realdebrid=:token/catalog/:type/:id.json", async (req, res) => {
  const { type } = req.params;
  try {
    const items = type === "movie" ? movies : series;
    const metas = [];

    for (const item of items) {
      metas.push({
        id: item.id,
        type: item.type,
        name: `${item.title} (${item.quality})`,
        poster: item.poster,
        description: `Idioma: ${item.language}\nCodec: ${item.codec}`
      });
    }

    res.json({ metas });
  } catch (err) {
    console.error("❌ Catalog Handler:", err);
    res.json({ metas: [] });
  }
});

// Stream Handler
app.get("/realdebrid=:token/stream/:type/:id.json", async (req, res) => {
  const { id, token } = req.params;
  const RD_TOKEN = token.trim();

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

    const magnet = `magnet:?xt=urn:btih:${found.hash}`;
    res.json({
      streams: [
        {
          title: `${found.language} • ${found.quality}`,
          url: magnet
        }
      ]
    });
  } catch (err) {
    console.error("❌ Stream Handler:", err.message);
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

// Meta Handler (simple)
app.get("/realdebrid=:token/meta/:type/:id.json", (req, res) => {
  const { id } = req.params;
  res.json({
    meta: {
      id,
      name: "Película LATINO",
      type: "movie",
      poster: "https://i.imgur.com/lE2FQIk.png",
      background: "https://i.imgur.com/lE2FQIk.png",
      description: "Metadatos generados automáticamente."
    }
  });
});

// Errores globales
process.on("unhandledRejection", (r) => console.error("⚠️ Unhandled:", r));
process.on("uncaughtException", (e) => console.error("⚠️ Uncaught:", e));

// Iniciar servidor
const PORT = process.env.PORT || 7000;
app.listen(PORT, () => console.log(`✅ Primer Latino Addon activo en puerto ${PORT}`));
