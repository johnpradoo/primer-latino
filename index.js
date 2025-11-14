const express = require("express");
const axios = require("axios");
const fs = require("fs");

const app = express();
app.use(express.json());

// ✅ CORS y JSON
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  res.type("application/json");
  next();
});

// 🧩 Prueba rápida
app.get("/", (req, res) => {
  res.json({ status: "OK", message: "Servidor activo de Primer Latino Addon" });
});

// Leer catálogo local
const data = JSON.parse(fs.readFileSync("./movies.json", "utf-8"));
const { movies = [], series = [] } = data;

// Manifest base
const manifest = {
  id: "org.primerlatino.addon",
  version: "2.0.2",
  name: "Primer Latino",
  description: "Películas y series LATINO desde Real-Debrid (token en URL).",
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

// Catálogo
app.get("/realdebrid=:token/catalog/:type/:id.json", (req, res) => {
  const { type } = req.params;
  const items = type === "movie" ? movies : series;
  const metas = items.map(item => ({
    id: item.id,
    type: item.type,
    name: `${item.title} (${item.quality})`,
    poster: item.poster,
    description: `Idioma: ${item.language} • ${item.codec}`
  }));
  res.json({ metas });
});

// 🎬 STREAM HANDLER CON TOKEN DEL USUARIO
app.get("/realdebrid=:token/stream/:type/:id.json", async (req, res) => {
  const { id, token } = req.params;
  const RD_TOKEN = token.trim();

  console.log(`🛰️ Stream request para: ${id} con token ${RD_TOKEN.slice(0, 6)}...`);

  if (!RD_TOKEN) {
    return res.json({
      streams: [
        {
          title: "⚠️ Falta token de Real-Debrid",
          url: "https://stremio-addons-demo.vercel.app/no-stream.mp4"
        }
      ]
    });
  }

  const found = movies.find((m) => m.id === id) || series.find((s) => s.id === id);
  if (!found) {
    return res.json({
      streams: [
        {
          title: "❌ No encontrado en catálogo",
          url: "https://stremio-addons-demo.vercel.app/no-stream.mp4"
        }
      ]
    });
  }

  const magnet = `magnet:?xt=urn:btih:${found.hash}`;

  try {
    // Paso 1: subir magnet al usuario
    const addMag = await axios.post(
      "https://api.real-debrid.com/rest/1.0/torrents/addMagnet",
      new URLSearchParams({ magnet }),
      { headers: { Authorization: `Bearer ${RD_TOKEN}` } }
    );

    // Paso 2: obtener info del torrent
    const info = await axios.get(
      `https://api.real-debrid.com/rest/1.0/torrents/info/${addMag.data.id}`,
      { headers: { Authorization: `Bearer ${RD_TOKEN}` } }
    );

    const file = info.data.files.find((f) => /\.(mp4|mkv|avi)$/i.test(f.path));
    if (!file) throw new Error("No se encontró archivo reproducible");

    // Paso 3: seleccionar archivo
    await axios.post(
      `https://api.real-debrid.com/rest/1.0/torrents/selectFiles/${addMag.data.id}`,
      new URLSearchParams({ files: file.id }),
      { headers: { Authorization: `Bearer ${RD_TOKEN}` } }
    );

    // Paso 4: obtener link liberado
    const dl = await axios.get(
      `https://api.real-debrid.com/rest/1.0/torrents/info/${addMag.data.id}`,
      { headers: { Authorization: `Bearer ${RD_TOKEN}` } }
    );

    if (!dl.data.links || !dl.data.links[0]) throw new Error("No se generó link de descarga");

    const unrestricted = await axios.post(
      "https://api.real-debrid.com/rest/1.0/unrestrict/link",
      new URLSearchParams({ link: dl.data.links[0] }),
      { headers: { Authorization: `Bearer ${RD_TOKEN}` } }
    );

    const streamUrl = unrestricted.data.download;

    console.log("✅ Stream liberado:", streamUrl);

    res.json({
      streams: [
        {
          title: `🍿 ${found.title} • ${found.quality}`,
          url: streamUrl
        }
      ]
    });
  } catch (err) {
    console.error("❌ Error en Real-Debrid:", err.response?.data || err.message);
    res.json({
      streams: [
        {
          title: "❌ Error al liberar stream",
          url: "https://stremio-addons-demo.vercel.app/no-stream.mp4"
        }
      ]
    });
  }
});

// Meta simple
app.get("/realdebrid=:token/meta/:type/:id.json", (req, res) => {
  const { id } = req.params;
  res.json({
    meta: {
      id,
      name: "Película LATINO",
      type: "movie",
      poster: "https://i.imgur.com/lE2FQIk.png"
    }
  });
});

// Iniciar servidor
const PORT = process.env.PORT || 7000;
app.listen(PORT, () => console.log(`✅ Addon activo en puerto ${PORT}`));