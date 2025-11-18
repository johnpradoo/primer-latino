const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

// CORS + JSON
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  res.type("application/json");
  next();
});

// Ruta de prueba
app.get("/", (req, res) => {
  res.json({ status: "Object, message: "Primer Latino Addon - Versión limpia y PRO" });
});

// Cargar los JSONs una sola vez
const movies = JSON.parse(fs.readFileSync(path.join(__dirname, "movies.json"), "utf-8")).movies || [];
const seriesList = JSON.parse(fs.readFileSync(path.join(__dirname, "series.json"), "utf-8")).series || [];
const episodes = JSON.parse(fs.readFileSync(path.join(__dirname, "episodes.json"), "utf-8")).episodes || [];

// === MANIFEST CORRECTO (esto era lo que fallaba antes) ===
const manifest = {
  id: "org.primerlatino.addon",
  version: "3.1.0",
  name: "Primer Latino",
  description: "Películas y series en LATINO con Real-Debrid. Catálogo limpio y sin duplicados.",
  logo: "https://i.imgur.com/lE2FQIk.png",
  background: "https://i.imgur.com/lE2FQIk.png",
  types: ["movie", "series"],
  resources: ["catalog", "meta", "stream"],
  catalogs: [
    { type: "movie", id: "primerlatino_movies", name: "Películas Latino" },
    { type: "series", id: "primerlatino_series", name: "Series Latino" }
  ],
  idPrefixes: ["tt"]
};

// === MANIFEST (con token en URL) ===
app.get("/realdebrid=:token/manifest.json", (req, res) => {
  res.json(manifest);
});

// === CATÁLOGO PELÍCULAS ===
app.get("/realdebrid=:token/catalog/movie/primerlatino_movies.json", (req, res) => {
  const metas = movies.map(m => ({
    id: m.id,
    type: "movie",
    name: `${m.title} (${m.quality.split("|")[0].trim()})`,
    poster: m.poster,
    description: m.language || "LATINO"
  }));
  res.json({ metas });
});

// === CATÁLOGO SERIES (solo una vez por serie) ===
app.get("/realdebrid=:token/catalog/series/primerlatino_series.json", (req, res) => {
  const metas = seriesList.map(s => ({
    id: s.id,
    type: "series",
    name: s.title,
    poster: s.poster
  }));
  res.json({ metas });
});

// === META (para que Stremio muestre temporadas y episodios) ===
app.get("/realdebrid=:token/meta/:type/:id.json", (req, res) => {
  const { type, id } = req.params;

  if (type === "movie") {
    const movie = movies.find(m => m.id === id);
    if (!movie) return res.json({ meta: null });
    return res.json({
      meta: {
        id: movie.id,
        type: "movie",
        name: movie.title,
        poster: movie.poster
      }
    });
  }

  if (type === "series") {
    const baseId = id.split(":")[0]; // solo el ttXXXX
    const serie = seriesList.find(s => s.id === baseId);
    if (!serie) return res.json({ meta: null });

    // Extraer temporadas disponibles
    const seasonNumbers = [...new Set(
      episodes
        .filter(e => e.id.startsWith(baseId + ":"))
        .map(e => {
          const parts = e.id.split(":");
          return parts.length > 1 ? parseInt(parts[1]) : 1;
        })
    )].sort((a, b) => a - b);

    const videos = {};
    seasonNumbers.forEach(season => {
      const epsInSeason = episodes
        .filter(e => {
          const parts = e.id.split(":");
          return parts[0] === baseId && parseInt(parts[1]) === season;
        })
        .map(e => {
          const episodeNum = e.id.split(":").pop();
          return {
            episode: parseInt(episodeNum),
            id: e.id,
            title: `Episodio ${episodeNum}`
          };
        })
        .sort((a, b) => a.episode - b.episode);

      if (epsInSeason.length > 0) {
        videos[season] = { "0": epsInSeason.map(ep => ({ id: ep.id, title: ep.title, episode: ep.episode })) };
      }
    });

    res.json({
      meta: {
        id: baseId,
        type: "series",
        name: serie.title,
        poster: serie   
      }
    });
  }
});

// === STREAMS (una sola calidad por ítem - simple y funcional) ===
app.get("/realdebrid=:token/stream/:type/:id.json", async (req, res) => {
  const { token } = req.params;
  const RD_TOKEN = token.trim();
  const itemId = req.params.id;

  let item = null;
  if (req.params.type === "movie") {
    item = movies.find(m => m.id === itemId);
  } else {
    item = episodes.find(e => e.id === itemId);
  }

  if (!item || !item.hash) {
    return res.json({ streams: [] });
  }

  const magnet = `magnet:?xt=urn:btih:${item.hash}`;

  try {
    // Añadir magnet
    const add = await axios.post(
      "https://api.real-debrid.com/rest/1.0/torrents/addMagnet",
      new URLSearchParams({ magnet }),
      { headers: { Authorization: `Bearer ${RD_TOKEN}` } }
    );

    const torrentId = add.data.id;

    // Esperar a que esté listo (máx 30 segundos)
    let info = add.data;
    let attempts = 0;
    while (info.status !== "downloaded" && attempts < 10) {
      await new Promise(r => setTimeout(r, 3000));
      info = (await axios.get(`https://api.real-debrid.com/rest/1.0/torrents/info/${torrentId}`, {
        headers: { Authorization: `Bearer ${RD_TOKEN}` }
      })).data;
      attempts++;
    }

    if (info.status !== "downloaded" || !info.links?.[0]) {
      throw new Error("No descargado");
    }

    // Seleccionar archivo si no está seleccionado
    if (info.links.length > 0 && !info.files.find(f => f.selected === 1)) {
      const videoFile = info.files.find(f => /\.(mp4|mkv|avi)$/i.test(f.path)) || info.files[0];
      await axios.post(
        `https://api.real-debrid.com/rest/1.0/torrents/selectFiles/${torrentId}`,
        new URLSearchParams({ files: videoFile.id }),
        { headers: { Authorization: `Bearer ${RD_TOKEN}` } }
      );
    }

    // Unrestrict
    const link = await axios.post(
      "https://api.real-debrid.com/rest/1.0/unrestrict/link",
      new URLSearchParams({ link: info.links[0] }),
      { headers: { Authorization: `Bearer ${RD_TOKEN}` } }
    );

    res.json({
      streams: [{
        title: `${item.quality || "LATINO"} • ${item.codec || "H.264"}`,
        url: link.data.download
      }]
    });

  } catch (err) {
    console.error("Error RD:", err.response?.data || err.message);
    res.json({ streams: [] });
  }
});

// Iniciar servidor
const PORT = process.env.PORT || 7000;
app.listen(PORT, () => {
  console.log(`Primer Latino Addon corriendo en puerto ${PORT} - Todo limpio y sin duplicados`);
});