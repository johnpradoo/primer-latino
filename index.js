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

app.get("/", (req, res) => res.json({ status: "OK", message: "Primer Latino v8.1 – LIMPIO, BONITO Y PERFECTO" }));

// CARGAR JSONs
let movies = [], seriesList = [], episodes = [];
try {
  movies = JSON.parse(fs.readFileSync(path.join(__dirname, "movies.json"), "utf-8")).movies || [];
  seriesList = JSON.parse(fs.readFileSync(path.join(__dirname, "series.json"), "utf-8")).series || [];
  episodes = JSON.parse(fs.readFileSync(path.join(__dirname, "episodes.json"), "utf-8")).episodes || [];
  console.log(`Cargados → ${movies.length} películas | ${seriesList.length} series | ${episodes.length} episodios`);
} catch (e) { console.error("ERROR JSON:", e.message); }

// MANIFEST
const manifest = {
  id: "org.primerlatino.addon",
  version: "8.1.0",
  name: "Primer Latino",
  description: "Calidad + Idioma + Primer Latino = EL MÁS BONITO",
  logo: "https://github.com/johnpradoo/primer-latino/blob/main/logo/icon.png?raw=true",
  background: "https://github.com/johnpradoo/primer-latino/blob/main/logo/banner.jpg?raw=true",
  types: ["movie", "series"],
  resources: ["catalog", "meta", "stream"],
  catalogs: [
    { type: "movie", id: "primerlatino_movies", name: "Películas Latino" },
    { type: "series", id: "primerlatino_series", name: "Series Latino" }
  ],
  idPrefixes: ["tt"]
};
app.get("/realdebrid=:token/manifest.json", (req, res) => res.json(manifest));

// CATÁLOGOS Y METAS (sin cambios, todo igual)
app.get("/realdebrid=:token/catalog/movie/primerlatino_movies.json", (req, res) => {
  const metas = movies.map(m => ({
    id: m.id, type: "movie",
    name: m.title + (m.quality ? ` (${m.quality.split("|")[0].trim()})` : ""),
    poster: m.poster || "https://github.com/johnpradoo/primer-latino/blob/main/logo/icon.png?raw=true"
  }));
  res.json({ metas });
});
app.get("/realdebrid=:token/catalog/series/primerlatino_series.json", (req, res) => {
  const metas = seriesList.map(s => ({
    id: s.id, type: "series", name: s.title,
    poster: s.poster || "https://github.com/johnpradoo/primer-latino/blob/main/logo/icon.png?raw=true"
  }));
  res.json({ metas });
});
app.get("/realdebrid=:token/meta/movie/:id.json", (req, res) => {
  const m = movies.find(x => x.id === req.params.id);
  if (!m) return res.json({ meta: null });
  res.json({ meta: { id: m.id, type: "movie", name: m.title, poster: m.poster } });
});
app.get("/realdebrid=:token/meta/series/:id.json", (req, res) => {
  const baseId = req.params.id.split(":")[0];
  const serie = seriesList.find(s => s.id === baseId);
  if (!serie) return res.json({ meta: null });
  const seasonMap = {};
  episodes.filter(e => e.id.startsWith(baseId + ":")).forEach(e => {
    const [, s, ep] = e.id.split(":");
    if (!seasonMap[s]) seasonMap[s] = [];
    seasonMap[s].push({ id: e.id, title: `Episodio ${ep}`, episode: +ep });
  });
  const videos = {};
  Object.keys(seasonMap).sort((a,b)=>a-b).forEach(s => videos[s] = { "0": seasonMap[s].sort((a,b)=>a.episode-b.episode) });
  res.json({ meta: { id: baseId, type: "series", name: serie.title, poster: serie.poster, videos } });
});

// CACHÉ
const cache = new Map();

// TÍTULOS LIMPIOS Y ÉPICOS — SOLO LO QUE TÚ QUIERES
function crearTituloEpico(item, fromCache = false) {
  const calidad = (item.quality || "1080p").toUpperCase().trim();
  const idioma = (item.language || "MX").toUpperCase().trim();

  // Detectar 4K
  const es4K = /4K|2160|UHD/i.test(calidad);

  // Banderas reales
  const banderas = idioma.includes("US") ? "MX US" : idioma.includes("ES") ? "ES" : "MX";

  // Línea superior (título principal)
  const title = `${es4K ? "4K" : "1080p"} ${calidad.replace(/4K|2160P|1080P|UHD|FHD/gi, "").trim()} ${banderas}${fromCache ? " RAYO" : ""} Primer Latino`.trim();

  // Línea inferior (subtítulo)
  const textoIdioma = idioma.includes("US") ? "Dual Latino+Eng" : idioma.includes("ES") ? "Castellano" : "Latino";
  const infoTitle = `${textoIdioma} • Primer Latino`;

  return { title, infoTitle };
}

// STREAM v8.1 — FINAL
app.get("/realdebrid=:token/stream/:type/:id.json", async (req, res) => {
  const { token, type, id } = req.params;

  const item = type === "movie" ? movies.find(m => m.id === id) : episodes.find(e => e.id === id);
  if (!item || !item.hash) return res.json({ streams: [] });

  const hash = item.hash.trim().toUpperCase();

  // CACHÉ + RAYO
  if (cache.has(hash) && Date.now() < cache.get(hash).expires) {
    const titulos = crearTituloEpico(item, true);
    return res.json({ streams: [{ title: titulos.title, infoTitle: titulos.infoTitle, url: cache.get(hash).url }] });
  }

  try {
    const auth = { headers: { Authorization: `Bearer ${token}` } };
    const { data: torrents } = await axios.get("https://api.real-debrid.com/rest/1.0/torrents?limit=1000", auth);
    let torrentInfo = torrents.find(t => t.hash.toUpperCase() === hash && t.status === "downloaded");

    if (!torrentInfo) {
      const magnet = `magnet:?xt=urn:btih:${hash}`;
      const add = await axios.post("https://api.real-debrid.com/rest/1.0/torrents/addMagnet", new URLSearchParams({magnet}), auth);
      const torrentId = add.data.id;

      for (let i = 0; i < 40; i++) {
        torrentInfo = (await axios.get(`https://api.real-debrid.com/rest/1.0/torrents/info/${torrentId}`, auth)).data;
        if (torrentInfo.status === "downloaded") break;
        if (torrentInfo.status === "waiting_files_selection" && torrentInfo.files) {
          const video = torrentInfo.files.find(f => /\.(mp4|mkv|avi|mov|webm)$/i.test(f.path)) || torrentInfo.files[0];
          await axios.post(`https://api.real-debrid.com/rest/1.0/torrents/selectFiles/${torrentId}`, new URLSearchParams({files: video.id}), auth);
        }
        await new Promise(r => setTimeout(r, 3000));
      }
    }

    if (!torrentInfo.links || torrentInfo.links.length === 0) {
      const fresh = (await axios.get(`https://api.real-debrid.com/rest/1.0/torrents/info/${torrentInfo.id}`, auth)).data;
      const video = fresh.files.find(f => /\.(mp4|mkv|avi|mov|webm)$/i.test(f.path)) || fresh.files[0];
      await axios.post(`https://api.real-debrid.com/rest/1.0/torrents/selectFiles/${torrentInfo.id}`, new URLSearchParams({files: video.id}), auth);
      await new Promise(r => setTimeout(r, 2000));
      torrentInfo = (await axios.get(`https://api.real-debrid.com/rest/1.0/torrents/info/${torrentInfo.id}`, auth)).data;
    }

    if (torrentInfo.links?.[0]) {
      const link = await axios.post("https://api.real-debrid.com/rest/1.0/unrestrict/link", new URLSearchParams({link: torrentInfo.links[0]}), auth);
      const finalUrl = link.data.download;
      cache.set(hash, { url: finalUrl, expires: Date.now() + 24*60*60*1000 });

      const titulos = crearTituloEpico(item, false);

      return res.json({
        streams: [{
          title: titulos.title,
          infoTitle: titulos.infoTitle,
          url: finalUrl
        }]
      });
    }
  } catch (err) {
    console.error("ERROR:", err.response?.data || err.message);
  }

  res.json({ streams: [] });
});

const PORT = process.env.PORT || 7000;
app.listen(PORT, () => {
  console.log(`\nPRIMER LATINO v8.1 CORRIENDO – LIMPIO, ELEGANTE Y PERFECTO`);
  console.log(`Solo calidad + idioma + Primer Latino → EN DOS LÍNEAS HERMOSAS!\n`);
});