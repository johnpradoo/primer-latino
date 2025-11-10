import pkg from "stremio-addon-sdk";
const { addonBuilder, serveHTTP } = pkg;
import express from "express";
import fs from "fs";
import axios from "axios";

// ──────────────────────────────
// MANIFEST
// ──────────────────────────────
const manifest = {
  id: "org.primerlatino",
  version: "2.0.0",
  name: "Primer Latino",
  description: "Addon de películas y series con soporte Real-Debrid (multiusuario, sin dependencias externas)",
  types: ["movie", "series"],
  catalogs: [
    { type: "movie", id: "primerlatino_movies", name: "Primer Latino • Películas" },
    { type: "series", id: "primerlatino_series", name: "Primer Latino • Series" },
  ],
  resources: ["catalog", "meta", "stream"],
};

// ──────────────────────────────
// CARGA DE MOVIES.JSON
// ──────────────────────────────
let movies = [];
let series = [];

try {
  const data = fs.readFileSync("./movies.json");
  const parsed = JSON.parse(data);
  movies = parsed.filter((m) => m.type === "movie");
  series = parsed.filter((m) => m.type === "series");
  console.log(`🎬 Cargadas ${movies.length} películas y ${series.length} series.`);
} catch (err) {
  console.error("❌ Error al cargar movies.json:", err.message);
}

// ──────────────────────────────
// FUNCIÓN REAL-DEBRID API (sin librería externa)
// ──────────────────────────────
async function getRDLink(token, infoHash) {
  const headers = { Authorization: `Bearer ${token}` };

  try {
    // 🔍 Revisar torrents existentes
    const torrentsList = await axios.get("https://api.real-debrid.com/rest/1.0/torrents", { headers });
    const existing = torrentsList.data.find(
      (t) => t.hash.toLowerCase() === infoHash.toLowerCase()
    );

    let torrentId;

    if (existing) {
      torrentId = existing.id;
    } else {
      // ➕ Subir magnet si no existe
      const addMagnet = await axios.post(
        "https://api.real-debrid.com/rest/1.0/torrents/addMagnet",
        new URLSearchParams({ magnet: `magnet:?xt=urn:btih:${infoHash}` }),
        { headers }
      );
      torrentId = addMagnet.data.id;
    }

    // 🧩 Obtener info del torrent
    const info = await axios.get(
      `https://api.real-debrid.com/rest/1.0/torrents/info/${torrentId}`,
      { headers }
    );

    // 🎞 Buscar archivo de video válido
    const file = info.data.files.find((f) => /\.(mp4|mkv|avi)$/i.test(f.path));
    if (!file) throw new Error("No se encontró archivo de video válido en el torrent");

    // 🧠 Seleccionar archivo
    await axios.post(
      `https://api.real-debrid.com/rest/1.0/torrents/selectFiles/${torrentId}`,
      new URLSearchParams({ files: file.id }),
      { headers }
    );

    // 🔁 Obtener link de descarga
    const info2 = await axios.get(
      `https://api.real-debrid.com/rest/1.0/torrents/info/${torrentId}`,
      { headers }
    );

    const link = info2.data.links?.[0];
    if (!link) throw new Error("No se generó link de descarga");

    // 🔓 Desbloquear el link
    const unrestricted = await axios.post(
      "https://api.real-debrid.com/rest/1.0/unrestrict/link",
      new URLSearchParams({ link }),
      { headers }
    );

    return unrestricted.data.download;
  } catch (err) {
    console.warn("⚠️ Error en Real-Debrid:", err.response?.data || err.message);
    return null;
  }
}

// ──────────────────────────────
// ADDON BUILDER
// ──────────────────────────────
const builder = new addonBuilder(manifest);

// STREAM HANDLER
builder.defineStreamHandler(async ({ id }) => {
  try {
    const [userToken, imdbId] = id.split("/");

    // Validación de token
    if (!userToken || userToken.length < 10) {
      return {
        streams: [
          {
            title: "🔒 Este addon requiere tu token de Real-Debrid",
            url: "https://johnpradoo.github.io/primer-latino-page/",
          },
        ],
      };
    }

    const found = movies.find((m) => m.id === imdbId) || series.find((s) => s.id === imdbId);
    if (!found) return { streams: [] };

    const rdLink = await getRDLink(userToken, found.hash);

    return {
      streams: [
        {
          title: `${found.language || "Latino"} • ${found.quality || "HD"}`,
          url: rdLink || `magnet:?xt=urn:btih:${found.hash}`,
        },
      ],
    };
  } catch (err) {
    console.error("❌ Stream Handler:", err.message);
    return { streams: [] };
  }
});

// ──────────────────────────────
// EXPRESS + SERVIDOR
// ──────────────────────────────
const app = express();

app.get(["/manifest.json", "/:token/manifest.json"], (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.json(manifest);
});

serveHTTP(builder.getInterface(), { app, port: process.env.PORT || 10000 });
console.log("✅ Primer Latino activo en puerto", process.env.PORT || 10000);