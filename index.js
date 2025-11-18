const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  res.type("application/json");
  next();
});

app.get("/", (req, res) => res.json({ status: "OK", message: "Primer Latino Addon v3 – Modo PRO activado" }));

// Cargar los 3 archivos (una sola vez al iniciar)
const movies = JSON.parse(fs.readFileSync(path.join(__dirname, "movies.json"), "utf-8")).movies || [];
const seriesList = JSON.parse(fs.readFileSync(path.join(__dirname, "series.json"), "utf-8")).series || [];
const episodes = JSON.parse(fs.readFileSync(path.join(__dirname, "episodes.json"), "utf-8")).episodes || [];

// Manifest (igual que antes)
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

// === CACHÉ + UNRESTRICT (misma función brutal que antes) ===
async function getStreamUrl(hash, token) {
  const headers = { Authorization: `Bearer ${token}` };
  const magnet = `magnet:?xt=urn:btih:${hash}`;

  let torrent = null;
  try {
    const res = await axios.get("https://api.real-debrid.com/rest/1.0/torrents?limit=200", headers);
    torrent = res.data.find(t => t.hash.toUpperCase() === hash.toUpperCase());
  } catch(e) {}

  if (!torrent) {
    const add = await axios.post("https://api.real-debrid.com/rest/1.0/torrents/addMagnet", 
      new URLSearchParams({ magnet }), headers);
    torrent = (await axios.get(`https://api.real-debrid.com/rest/1.0/torrents/info/${add.data.id}`, headers)).data;
  }

  // Esperar a que esté listo (máx 60 seg)
  let attempts = 0;
  while (torrent.status !== "downloaded" && attempts < 20) {
    await new Promise(r => setTimeout(r, 3000));
    torrent = (await axios.get(`https://api.real-debrid.com/rest/1.0/torrents/info/${torrent.id}`, headers)).data;
    attempts++;
  }

  if (torrent.status !== "downloaded") throw new Error("No descargado");

  // Seleccionar archivo si no está
  let videoFile = torrent.files.find(f => /\.(mp4|mkv|avi|mov|webm)$/i.test(f.path));
  if (!videoFile) videoFile = torrent.files[0];
  if (!torrent.links?.length) {
    await axios.post(`https://api.real-debrid.com/rest/1.0/torrents/selectFiles/${torrent.id}`,
      new URLSearchParams({ files: videoFile.id }), headers);
    await new Promise(r => setTimeout(r, 2000));
    torrent = (await axios.get(`https://api.real-debrid.com/rest/1.0/torrents/info/${torrent.id}`, headers)).data;
  }

  const link = torrent.links[0];
  const url = await axios.post("https://api.real-debrid.com/rest/1.0/unrestrict/link",
    new URLSearchParams({ link }), headers);
  return url.data.download;
}

// Manifest
app.get("/realdebrid=:token/manifest.json", (req, res) => res.json(manifest));

// CATÁLOGOS
app.get("/realdebrid=:token/catalog/movie/primerlatino_movies.json", (req, res) => {
  const metas = movies.map(m => ({
    id: m.id,
    type: "movie",
    name: `${m.title} (${m.quality})`,
    poster: m.poster,
    description: `${m.language} • ${m.codec}`
  }));
  res.json({ metas });
});

app.get("/realdebrid=:token/catalog/series/primerlatino_series.json", (req, res) => {
  const metas = seriesList.map(s => ({
    id: s.id,
    type: "series",
    name: s.title,
    poster: s.poster,
    description: "Series LATINO en múltiples calidades"
  }));
  res.json({ metas });
});

// META (para series muestra temporadas/episodios disponibles)
app.get("/realdebrid=:token/meta/:type/:id.json", (req, res) => {
  const { type, id } = req.params;
  if (type === "movie") {
    const m = movies.find(x => x.id === id);
    if (!m) return res.json({ meta: null });
    return res.json({ meta: { id, type: "movie", name: m.title, poster: m.poster } });
  }

  if (type === "series") {
    const s = seriesList.find(x => x.id === id) || episodes.find(e => e.id.split(":")[0] === id);
    if (!s) return res.json({ meta: null });

    const seasons = [...new Set(episodes.filter(e => e.id.startsWith(id + ":")).map(e => {
      const parts = e.id.split(":");
      return parseInt(parts[1]);
    }))].sort((a,b) => a-b);

    res.json({
      meta: {
        id,
        type: "series",
        name: s.title || "Serie LATINO",
        poster: s.poster,
        seasons: seasons.map(season => ({
          season,
          episodes: episodes
            .filter(e => e.id === `${id}:${season}` || e.id.startsWith(`${id}:${season}:`))
            .map(e => {
              const epNum = e.id.split(":").pop();
              return { episode: parseInt(epNum), name: `Episodio ${epNum} (${e.quality})` };
            })
            .sort((a,b) => a.episode - b.episode)
        }))
      }
    });
  }
});

// STREAMS (películas y episodios)
app.get("/realdebrid=:token/stream/:type/:id.json", async (req, res) => {
  const { id, token } = req.params;
  const RD_TOKEN = token.trim();

  let items = [];
  if (req.params.type === "movie") {
    items = movies.filter(m => m.id === id);
  } else {
    items = episodes.filter(e => e.id === id);
  }

  if (items.length === 0) return res.json({ streams: [{ title: "No encontrado", url: "https://..." }] });

  const streams = [];
  for (const item of items) {
    try {
      const url = await getStreamUrl(item.hash, RD_TOKEN);
      streams.push({
        title: `${item.quality} • ${item.codec}`,
        url
      });
    } catch (e) {
      console.error("Error calidad:", e.message);
    }
  }

  if (streams.length === 0) return res.json({ streams: [{ title: "Error en todas las calidades", url: "https://..." }] });
  res.json({ streams });
});

const PORT = process.env.PORT || 7000;
app.listen(PORT, () => console.log(`Primer Latino Addon v3 PRO corriendo en puerto ${PORT}`));