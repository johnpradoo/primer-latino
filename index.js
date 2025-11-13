import pkg from "stremio-addon-sdk";
const { addonBuilder, serveHTTP } = pkg;
import express from "express";
import fs from "fs";
import axios from "axios";

/* ───────────────────────────────────────────────
    1. CARGAR ARCHIVOS JSON (movies, series, episodes)
─────────────────────────────────────────────── */

let movies = [];
let series = [];
let episodes = [];

function loadData() {
  try {
    movies = JSON.parse(fs.readFileSync("./movies.json"));
  } catch {
    movies = [];
  }

  try {
    series = JSON.parse(fs.readFileSync("./series.json"));
  } catch {
    series = [];
  }

  try {
    episodes = JSON.parse(fs.readFileSync("./episodes.json"));
  } catch {
    episodes = [];
  }

  console.log("📁 Datos cargados:");
  console.log("Películas:", movies.length);
  console.log("Series:", series.length);
  console.log("Episodios:", episodes.length);
}

loadData();

/* ───────────────────────────────────────────────
    2. MANIFEST
─────────────────────────────────────────────── */

const manifest = {
  id: "org.primerlatino",
  version: "3.0.0",
  name: "Primer Latino",
  description: "Addon de películas y series con soporte Real-Debrid multiusuario",
  resources: ["catalog", "meta", "stream"],
  types: ["movie", "series"],
  catalogs: [
    { type: "movie", id: "pl_movies", name: "Primer Latino • Películas" },
    { type: "series", id: "pl_series", name: "Primer Latino • Series" }
  ]
};

/* ───────────────────────────────────────────────
    3. FUNCIÓN REAL-DEBRID (SIN LIBRERÍAS EXTERNAS)
─────────────────────────────────────────────── */

async function getRDLink(token, infoHash) {
  const headers = { Authorization: `Bearer ${token}` };

  try {
    // 1) Ver si ya existe el torrent
    const list = await axios.get(
      "https://api.real-debrid.com/rest/1.0/torrents",
      { headers }
    );

    const found = list.data.find(
      (t) => t.hash.toLowerCase() === infoHash.toLowerCase()
    );

    let torrentId;

    // 2) Si existe, usarlo
    if (found) {
      torrentId = found.id;
    } else {
      // 3) Crear nuevo torrent
      const add = await axios.post(
        "https://api.real-debrid.com/rest/1.0/torrents/addMagnet",
        new URLSearchParams({
          magnet: `magnet:?xt=urn:btih:${infoHash}`
        }),
        { headers }
      );
      torrentId = add.data.id;
    }

    // 4) Obtener info
    const info = await axios.get(
      `https://api.real-debrid.com/rest/1.0/torrents/info/${torrentId}`,
      { headers }
    );

    const file = info.data.files.find((f) =>
      /\.(mp4|mkv|avi)$/i.test(f.path)
    );

    if (!file) return null;

    // 5) Seleccionar archivo
    await axios.post(
      `https://api.real-debrid.com/rest/1.0/torrents/selectFiles/${torrentId}`,
      new URLSearchParams({ files: file.id }),
      { headers }
    );

    const info2 = await axios.get(
      `https://api.real-debrid.com/rest/1.0/torrents/info/${torrentId}`,
      { headers }
    );

    const link = info2.data.links?.[0];
    if (!link) return null;

    // 6) Desbloquear link
    const unrestricted = await axios.post(
      "https://api.real-debrid.com/rest/1.0/unrestrict/link",
      new URLSearchParams({ link }),
      { headers }
    );

    return unrestricted.data.download;
  } catch (err) {
    console.log("⚠️ RD Error:", err.response?.data || err.message);
    return null;
  }
}

/* ───────────────────────────────────────────────
    4. BUILDER DEL ADDON
─────────────────────────────────────────────── */

const builder = new addonBuilder(manifest);

/* ───────────────────────────────────────────────
    5. CATALOGO (MOVIES & SERIES)
─────────────────────────────────────────────── */

builder.defineCatalogHandler(({ type }) => {
  if (type === "movie") {
    return Promise.resolve({
      metas: movies.map((m) => ({
        id: m.id,
        type: "movie",
        name: m.title,
        poster: m.poster
      }))
    });
  }

  if (type === "series") {
    return Promise.resolve({
      metas: series.map((s) => ({
        id: s.id,
        type: "series",
        name: s.title,
        poster: s.poster
      }))
    });
  }

  return Promise.resolve({ metas: [] });
});

/* ───────────────────────────────────────────────
    6. META-HANDLER (SERIES → EPISODIOS)
─────────────────────────────────────────────── */

builder.defineMetaHandler(({ type, id }) => {
  if (type === "movie") {
    const movie = movies.find((m) => m.id === id);
    if (!movie) return Promise.resolve({ meta: {} });

    return Promise.resolve({
      meta: {
        id: movie.id,
        type: "movie",
        name: movie.title,
        poster: movie.poster,
        videos: [
          {
            id: movie.id,
            title: movie.title
          }
        ]
      }
    });
  }

  if (type === "series") {
    const serie = series.find((s) => s.id === id);
    if (!serie) return Promise.resolve({ meta: {} });

    const eps = episodes
      .filter((e) => e.id === id)
      .map((e) => ({
        id: `${e.id}:${e.season}:${e.episode}`,
        title: `S${e.season} • E${e.episode} (${e.quality})`,
        season: e.season,
        episode: e.episode
      }));

    return Promise.resolve({
      meta: {
        id: serie.id,
        type: "series",
        name: serie.title,
        poster: serie.poster,
        videos: eps
      }
    });
  }

  return Promise.resolve({ meta: {} });
});

/* ───────────────────────────────────────────────
    7. STREAM HANDLER (EPISODIOS)
─────────────────────────────────────────────── */

builder.defineStreamHandler(async ({ id }) => {
  const [userToken, fullId] = id.split("/");

  if (!userToken || userToken.length < 10) {
    return {
      streams: [
        {
          title: "🔒 Debes ingresar tu token de Real-Debrid",
          url: "https://johnpradoo.github.io/primer-latino-page/"
        }
      ]
    };
  }

  const [serieId, season, episode] = fullId.split(":");

  const ep = episodes.find(
    (e) =>
      e.id === serieId &&
      e.season == season &&
      e.episode == episode
  );

  if (!ep) return { streams: [] };

  const link = await getRDLink(userToken, ep.hash);

  return {
    streams: [
      {
        title: `S${season}E${episode} • ${ep.quality}`,
        url: link
      }
    ]
  };
});

/* ───────────────────────────────────────────────
    8. SERVIDOR EXPRESS
─────────────────────────────────────────────── */

const app = express();

app.get(["/manifest.json", "/:token/manifest.json"], (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.json(manifest);
});

serveHTTP(builder.getInterface(), { app, port: process.env.PORT || 10000 });

console.log("🔥 PRIMER LATINO LISTO — PUERTO:", process.env.PORT || 10000);
