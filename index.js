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

app.get("/", (req, res) => res.json({ status: "OK", message: "Primer Latino v7.5 – EMOJIS REALES + FORMATO MEDIAFUSION" }));

// CARGAR JSONs
let movies = [], seriesList = [], episodes = [];
try {
  movies = JSON.parse(fs.readFileSync(path.join(__dirname, "movies.json"), "utf-8")).movies || [];
  seriesList = JSON.parse(fs.readFileSync(path.join(__dirname, "series.json"), "utf-8")).series || [];
  episodes = JSON.parse(fs.readFileSync(path.join(__dirname, "episodes.json"), "utf-8")).episodes || [];
  console.log(`Cargados → ${movies.length} películas | ${seriesList.length} series | ${episodes.length} episodios`);
} catch (e) {
  console.error("ERROR leyendo JSONs:", e.message);
}

// MANIFEST
const manifest = {
  id: "org.primerlatino.addon",
  version: "7.5.0",
  name: "Primer Latino",
  description: "El addon latino más rápido y bonito del 2025 – by @johnpradoo",
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

// CATÁLOGOS
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

// METAS
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

// CACHÉ GLOBAL
const cache = new Map();

// TÍTULOS ÉPICOS CON EMOJIS REALES (100% IGUAL QUE MEDIAFUSION)
function crearTituloEpico(item, torrentInfo, fromCache = false) {
  const text = (torrentInfo.filename || "") + " " + (item.quality || "");
  const es4K = /4k|2160p|UHD/i.test(text);
  const esHDR = /HDR|DV|Dolby ?Vision/i.test(text);
  const esHEVC = /hevc|h\.?265|x265/i.test(text);
  const esDolby = /Dolby|Atmos|DDP|E-?AC3/i.test(text);
  const esWeb = /WEB.?DL|WEBRip/i.test(text);

  let banderas = "🇲🇽";
  if (/Dual|Latino.*Eng|Eng.*Latino/i.test(text)) banderas = "🇲🇽 | 🇺🇸";
  else if (/Castellano|Español|Spanish/i.test(text)) banderas = "🇪🇸";

  const size = torrentInfo.bytes ? (torrentInfo.bytes / 1024**3).toFixed(1) + " GB" : "?? GB";

  // TÍTULO PRINCIPAL CON EMOJIS REALES
  const title = `${es4K ? "🍿 4K" : "1080p"}${esHDR ? " 🎞️HDR" : ""}${esWeb ? " 🎥WEB-DL" : ""}${esHEVC ? " hevc" : ""}${esDolby ? " 🎬Dolby" : ""} ${banderas}${fromCache ? "⚡️" : ""}`.trim();

  // SUBTÍTULO
  const infoTitle = `${size} • ${banderas.includes("US") ? "Dual Latino+Eng" : banderas === "ES" ? "Castellano" : "Latino"} • 🧋Primer Latino`;

  return { title, infoTitle };
}

// STREAM FINAL
app.get("/realdebrid=:token/stream/:type/:id.json", async (req, res) => {
  const { token, type, id } = req.params;
  const shortToken = token.slice(0,10)+"...";
  console.log(`\nSolicitud entrante | TOKEN: ${shortToken}`);

  const item = type==="movie" ? movies.find(m=>m.id===id) : episodes.find(e=>e.id===id);
  if (!item || !item.hash) return res.json({streams:[]});

  const hash = item.hash.trim().toUpperCase();
  const shortHash = hash.substring(0,12)+"...";
  console.log(`STREAM ${type} ${id} | Hash: ${shortHash}`);

  // CACHÉ + RAYO
  if (cache.has(hash) && Date.now() < cache.get(hash).expires) {
    const titulos = crearTituloEpico(item, {}, true);
    console.log(`CACHÉ GLOBAL RAYO – Instantáneo`);
    console.log(`PLAY Enviado – ${titulos.title}\n           ${titulos.infoTitle}`);
    return res.json({ streams: [{ title: titulos.title, infoTitle: titulos.infoTitle, url: cache.get(hash).url }] });
  }

  try {
    const auth = { headers: { Authorization: `Bearer ${token}` } };

    const { data: torrents } = await axios.get("https://api.real-debrid.com/rest/1.0/torrents?limit=1000", auth);
    let torrentInfo = torrents.find(t => t.hash.toUpperCase() === hash && t.status === "downloaded");

    if (torrentInfo) {
      console.log(`REUTILIZANDO torrent (ID: ${torrentInfo.id})`);
    } else {
      console.log(`AGREGADO nuevo torrent – Subiendo ${shortHash}`);
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
      console.log(`REGENERANDO links...`);
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

      const titulos = crearTituloEpico(item, torrentInfo, false);
      console.log(`PLAY Enviado – ${titulos.title}\n           ${titulos.infoTitle}`);

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
  console.log(`\nPRIMER LATINO v7.5 🧋🍿 CORRIENDO EN PUERTO ${PORT}`);
  console.log(`¡🍿!\n`);
});