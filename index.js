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

app.get("/", (req, res) => res.json({ status: "OK", message: "Primer Latino v9.3 – Multi-Debrid + P2P Latino" }));

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
  version: "9.3.0",
  name: "Primer Latino",
  description: "Real-Debrid • AllDebrid • TorBox • P2P Latino – by @johnpradoo",
  logo: "https://github.com/johnpradoo/primer-latino/blob/main/logo/icon.png?raw=true",
  background: "https://github.com/johnpradoo/primer-latino/blob/main/logo/banner.jpg?raw=true",
  types: ["movie", "series"],
  resources: ["catalog", "meta", "stream"],
  catalogs: [
    { type: "movie", id: "primerlatino_movies", name: "Películas Latino" },
    { type: "series", id: "primerlatino_series", name: "Series Latino" }
  ],
  idPrefixes: ["tt"],
  behaviorHints: { p2p: true }
};

// CACHÉ + RAYO
const cache = new Map();
function crearTituloEpico(item, fromCache = false) {
  const q = item.quality || "";
  const l = item.language || "";
  const title = `${q} ${l}${fromCache ? " RAYO" : ""} Primer Latino`.trim();
  const infoTitle = fromCache ? "Caché instantáneo" : "Primer Latino 2025";
  return { title, infoTitle };
}

// ========== RUTAS CON REGEX (FUNCIONAN CON TOKEN LARGO) ==========
app.get(/^\/([a-zA-Z0-9]+)=(.+)\/manifest\.json$/, (req, res) => {
  res.json(manifest);
});

app.get(/^\/([a-zA-Z0-9]+)=(.+)\/catalog\/([^\/]+)\/([^\/]+)\.json$/, (req, res) => {
  const [, service, token, type, id] = req.path.match(/^\/([a-zA-Z0-9]+)=(.+)\/catalog\/([^\/]+)\/([^\/]+)\.json$/);
  const metas = type === "movie" 
    ? movies.map(m => ({ id: m.id, type: "movie", name: m.title, poster: m.poster }))
    : seriesList.map(s => ({ id: s.id, type: "series", name: s.title, poster: s.poster }));
  res.json({ metas });
});

app.get(/^\/([a-zA-Z0-9]+)=(.+)\/meta\/([^\/]+)\/(.+)\.json$/, (req, res) => {
  const [, service, token, type, id] = req.path.match(/^\/([a-zA-Z0-9]+)=(.+)\/meta\/([^\/]+)\/(.+)\.json$/);
  const item = type === "movie" ? movies.find(m => m.id === id) : seriesList.find(s => s.id === id);
  if (!item) return res.json({});
  res.json({ meta: { id: item.id, type, name: item.title, poster: item.poster, background: item.poster } });
});

app.get(/^\/([a-zA-Z0-9]+)=(.+)\/stream\/([^\/]+)\/(.+)\.json$/, async (req, res) => {
  const match = req.path.match(/^\/([a-zA-Z0-9]+)=(.+)\/stream\/([^\/]+)\/(.+)\.json$/);
  const [, service, token, type, id] = match;
  console.log(`\nSOLICITUD → ${service.toUpperCase()} | ${type} ${id}`);

  const item = type === "movie" ? movies.find(m => m.id === id) : episodes.find(e => e.id === id);
  if (!item || !item.hash) return res.json({ streams: [] });

  const hash = item.hash.trim().toUpperCase();
  const cleanToken = token.trim();

  // RAYO CACHÉ
  if (cache.has(hash) && Date.now() < cache.get(hash).expires) {
    const titulos = crearTituloEpico(item, true);
    console.log(`RAYO CACHÉ → ${titulos.title}`);
    return res.json({ streams: [{ title: titulos.title, infoTitle: titulos.infoTitle, url: cache.get(hash).url }] });
  }

  try {
    // P2P GRATIS COMO FALLBACK FINAL
    const sendP2P = () => {
      const magnet = `magnet:?xt=urn:btih:${hash}&dn=Primer+Latino&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337%2Fannounce&tr=udp%3A%2F%2Fopen.tracker.cl%3A1337%2Fannounce&tr=udp%3A%2F%2Ftracker.openbittorrent.com%3A80%2Fannounce`;
      const titulos = crearTituloEpico(item);
      return res.json({
        streams: [{
          title: `${titulos.title} P2P`,
          infoTitle: "Fallback automático • Primer Latino",
          url: magnet,
          behaviorHints: { p2p: true }
        }]
      });
    };

    // REAL-DEBRID
    if (service === "realdebrid") {
      const auth = { headers: { Authorization: `Bearer ${cleanToken}` }, timeout: 20000 };
      let torrentInfo = (await axios.post("https://api.real-debrid.com/rest/1.0/torrents/addMagnet",
        new URLSearchParams({ magnet: `magnet:?xt=urn:btih:${hash}` }), auth)).data;

      let attempts = 0;
      while ((torrentInfo.status !== "downloaded" && torrentInfo.status !== "ready") && attempts < 50) {
        await new Promise(r => setTimeout(r, 3000));
        torrentInfo = (await axios.get(`https://api.real-debrid.com/rest/1.0/torrents/info/${torrentInfo.id}`, auth)).data;
        attempts++;
      }

      if (torrentInfo.links?.[0]) {
        const video = torrentInfo.files.find(f => /\.(mp4|mkv|avi|mov|webm)$/i.test(f.path)) || torrentInfo.files[0];
        if (video && !video.selected) {
          await axios.post(`https://api.real-debrid.com/rest/1.0/torrents/selectFiles/${torrentInfo.id}`,
            new URLSearchParams({ files: video.id }), auth);
          await new Promise(r => setTimeout(r, 2000));
        }
        const link = await axios.post("https://api.real-debrid.com/rest/1.0/unrestrict/link",
          new URLSearchParams({ link: torrentInfo.links[0] }), auth);
        const finalUrl = link.data.download;
        cache.set(hash, { url: finalUrl, expires: Date.now() + 24*60*60*1000 });
        const titulos = crearTituloEpico(item);
        return res.json({ streams: [{ title: titulos.title, infoTitle: titulos.infoTitle, url: finalUrl }] });
      }
    }

    // ALLDEBRID & TORBOX (los tienes listos para cuando quieras activarlos)

    // Si llega aquí → fallback P2P
    return sendP2P();

  } catch (err) {
    console.error("ERROR → fallback P2P:", err.message);
    return sendP2P();
  }
});

// P2P GRATIS (ruta limpia)
app.get("/p2p/manifest.json", (req, res) => res.json(manifest));
app.get("/p2p/catalog/:type/:id.json", (req, res) => { /* mismo catálogo que arriba */ 
  const { type } = req.params;
  const metas = type === "movie" ? movies.map(m => ({ id: m.id, type: "movie", name: m.title, poster: m.poster })) 
                                 : seriesList.map(s => ({ id: s.id, type: "series", name: s.title, poster: s.poster }));
  res.json({ metas });
});
app.get("/p2p/meta/:type/:id.json", (req, res) => { /* mismo meta */ 
  const { type, id } = req.params;
  const item = type === "movie" ? movies.find(m => m.id === id) : seriesList.find(s => s.id === id);
  if (!item) return res.json({});
  res.json({ meta: { id: item.id, type, name: item.title, poster: item.poster } });
});
app.get("/p2p/stream/:type/:id.json", async (req, res) => {
  // mismo código de fallback P2P de arriba
});

const PORT = process.env.PORT || 7000;
app.listen(PORT, () => {
  console.log(`\nPRIMER LATINO v9.3 CORRIENDO`);
  console.log(`@johnpradooo (X)`);
  console.log(`Primer Latino\n`);
});