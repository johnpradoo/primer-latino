const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

// CORS
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  res.type("application/json");
  next();
});

// Ruta raíz
app.get("/", (req, res) => {
  res.json({ status: "OK", message: "Primer Latino Addon - Versión FINAL funcionando al 100%" });
});

// Cargar archivos JSON
const movies = JSON.parse(fs.readFileSync(path.join(__dirname, "movies.json"), "utf-8")).movies || [];
const seriesList = JSON.parse(fs.readFileSync(path.join(__dirname, "series.json"), "utf-8")).series || [];
const episodes = JSON.parse(fs.readFileSync(path.join(__dirname, "episodes.json"), "utf-8")).episodes || [];

// MANIFEST
const manifest = {
  id: "org.primerlatino.addon",
  version: "3.2.0",
  name: "Primer Latino",
  description: "Películas y series LATINO con Real-Debrid - Sin duplicados",
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

// Manifest con token
app.get("/realdebrid=:token/manifest.json", (req, res) => {
  res.json(manifest);
});

// Catálogo películas
app.get("/realdebrid=:token/catalog/movie/primerlatino_movies.json", (req, res) => {
  const metas = movies.map(m => ({
    id: m.id,
    type: "movie",
    name: m.title + (m.quality ? ` (${m.quality.split("|")[0].trim()})` : ""),
    poster: m.poster
  }));
  res.json({ metas });
});

// Catálogo series (solo una vez por serie)
app.get("/realdebrid=:token/catalog/series/primerlatino_series.json", (req, res) => {
  const metas = seriesList.map(s => ({
    id: s.id,
    type: "series",
    name: s.title,
    poster: s.poster
  }));
  res.json({ metas });
});

// Meta películas
app.get("/realdebrid=:token/meta/movie/:id.json", (req, res) => {
  const movie = movies.find(m => m.id === req.params.id);
  if (!movie) return res.json({ meta: null });
  res.json({
    meta: {
      id: movie.id,
      type: "movie",
      name: movie.title,
      poster: movie.poster
    }
  });
});

// Meta series (muestra temporadas y episodios)
app.get("/realdebrid=:token/meta/series/:id.json", (req, res) => {
  const baseId = req.params.id.split(":")[0];
  const serie = seriesList.find(s => s.id === baseId);
  if (!serie) return res.json({ meta: null });

  const seasonMap = {};
  episodes
    .filter(e => e.id.startsWith(baseId + ":"))
    .forEach(e => {
      const parts = e.id.split(":");
      const season = parseInt(parts[1]);
      const episode = parseInt(parts[2]);
      if (!seasonMap[season]) seasonMap[season] = [];
      seasonMap[season].push({
        id: e.id,
        title: `Episodio ${episode}`,
        episode: episode
      });
    });

  const videos = {};
  Object.keys(seasonMap).sort((a, b) => a - b).forEach(season => {
    seasonMap[season].sort((a, b) => a.episode - b.episode);
    videos[season] = { "0": seasonMap[season] };
  });

  res.json({
    meta: {
      id: baseId,
      type: "series",
      name: serie.title,
      poster: serie.poster,
      videos: videos
    }
  });
});

// Streams (películas y episodios)
app.get("/realdebrid=:token/stream/:type/:id.json", async (req, res) => {
  const { token, id, type } = req.params;
  const RD_TOKEN = token.trim();

  let item = null;
  if (type === "movie") {
    item = movies.find(m => m.id === id);
  } else {
    item = episodes.find(e => e.id === id);
  }

  if (!item || !item.hash) {
    return res.json({ streams: [] });
  }

  try {
    const magnet = `magnet:?xt=urn:btih:${item.hash}`;
    const addRes = await axios.post(
      "https://api.real-debrid.com/rest/1.0/torrents/addMagnet",
      new URLSearchParams({ magnet }),
      { headers: { Authorization: `Bearer ${RD_TOKEN}` } }
    );

    const torrentId = addRes.data.id;
    let info = addRes.data;

    // Esperar a que esté listo
    for (let i = 0; i < 15; i++) {
      if (info.status === "downloaded") break;
      await new Promise(r => setTimeout(r, 3000));
      info = (await axios.get(`https://api.real-debrid.com/rest/1.0/torrents/info/${torrentId}`, {
        headers: { Authorization: `Bearer ${RD_TOKEN}` }
      })).data;
    }

    if (info.status !== "downloaded" || !info.links?.[0]) {
      return res.json({ streams: [] });
    }

    // Unrestrict link
    const unrestricted = await axios.post(
      "https://api.real-debrid.com/rest/1.0/unrestrict/link",
      new URLSearchParams({ link: info.links[0] }),
      { headers: { Authorization: `Bearer ${RD_TOKEN}` } }
    );

    res.json({
      streams: [{
        title: item.title || "LATINO",
        url: unrestricted.data.download
      }]
    });

  } catch (err) {
    console.error("Error RD:", err.response?.data || err.message);
    res.json({ streams: [] });
  }
});

// Iniciar
const PORT = process.env.PORT || 7000;
app.listen(PORT, () => {
  console.log(`Primer Latino Addon FINAL activo en puerto ${PORT}`);
});