import { addonBuilder, serveHTTP } from "stremio-addon-sdk";
import express from "express";
import axios from "axios";
import fs from "fs";

const manifest = {
  id: "org.primerlatino",
  version: "1.0.0",
  name: "Primer Latino",
  description: "Addon de películas y series con soporte Real-Debrid",
  types: ["movie", "series"],
  catalogs: [
    {
      type: "movie",
      id: "primerlatino_movies",
      name: "Primer Latino • Películas"
    },
    {
      type: "series",
      id: "primerlatino_series",
      name: "Primer Latino • Series"
    }
  ],
  resources: ["catalog", "meta", "stream"]
};

// Cargar lista de películas y series
let movies = [];
let series = [];

try {
  const data = fs.readFileSync("./movies.json");
  movies = JSON.parse(data);
  series = movies.filter((m) => m.type === "series");
  movies = movies.filter((m) => m.type === "movie");
} catch (err) {
  console.error("❌ Error al cargar movies.json:", err.message);
}

// Crear builder
const builder = new addonBuilder(manifest);

// Handler de streams con soporte Real-Debrid
builder.defineStreamHandler(async ({ id, type }) => {
  try {
    // Extraer token desde la URL
    const tokenMatch = id.match(/realdebrid=([A-Za-z0-9]+)/);
    const userToken = tokenMatch ? tokenMatch[1] : null;

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

    // Buscar contenido
    const found =
      movies.find((m) => m.id === id) ||
      series.find((s) => s.id === id);

    if (!found) return { streams: [] };

    const magnet = `magnet:?xt=urn:btih:${found.hash}`;
    let rdLink = null;

    // Real-Debrid
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
          title: `${found.language || "Latino"} • ${found.quality || "HD"}`,
          url: rdLink || magnet
        }
      ]
    };
  } catch (err) {
    console.error("❌ Stream Handler:", err);
    return { streams: [] };
  }
});

// Crear instancia de Express
const app = express();

// Rutas para manifest
app.get(["/manifest.json", "/realdebrid=:token/manifest.json"], (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.json(manifest);
});

// Integrar addon SDK con Express
serveHTTP(builder.getInterface(), { app, port: process.env.PORT || 10000 });

console.log("✅ Primer Latino corriendo en puerto", process.env.PORT || 10000);