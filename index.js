const express = require("express");
const axios = require("axios");
const fs = require("fs");

const app = express();
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "*");
  res.type("application/json");
  next();
});

// ==================== MANIFEST ====================
const manifest = {
  id: "org.primerlatino.addon",
  version: "9.3.5",
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

app.get("/manifest.json", (req, res) => res.json(manifest));
app.get("/*/manifest.json", (req, res) => res.json(manifest));

// ==================== CARGAR JSONs ====================
let movies = [], seriesList = [], episodes = [];
try {
  movies = JSON.parse(fs.readFileSync("movies.json", "utf-8")).movies || [];
  seriesList = JSON.parse(fs.readFileSync("series.json", "utf-8")).series || [];
  episodes = JSON.parse(fs.readFileSync("episodes.json", "utf-8")).episodes || [];
  console.log(`Cargados → ${movies.length} películas | ${seriesList.length} series | ${episodes.length} episodios`);
} catch (e) {
  console.error("ERROR leyendo JSONs:", e.message);
}

// ==================== CATÁLOGO Y META ====================
app.get("/*/catalog/:type/:id.json", (req, res) => {
  const { type } = req.params;
  const metas = type === "movie"
    ? movies.map(m => ({ id: m.id, type: "movie", name: m.title, poster: m.poster }))
    : seriesList.map(s => ({ id: s.id, type: "series", name: s.title, poster: s.poster }));
  res.json({ metas });
});

app.get("/*/meta/:type/:id.json", (req, res) => {
  const { type, id } = req.params;
  const item = type === "movie" ? movies.find(m => m.id === id) : seriesList.find(s => s.id === id);
  if (!item) return res.json({});
  res.json({ meta: { id: item.id, type, name: item.title, poster: item.poster, background: item.poster } });
});

// ==================== CACHÉ RAYO ====================
const cache = new Map();
function crearTitulo(item, rayo = false) {
  const q = item.quality || "";
  const l = item.language || "";
  return {
    title: `${q} ${l}${rayo ? " RAYO" : ""} Primer Latino`.trim(),
    infoTitle: rayo ? "Caché instantáneo" : "Primer Latino 2025"
  };
}

// ==================== STREAM – DETECCIÓN PERFECTA ====================
app.get("/*/stream/:type/:id.json", async (req, res) => {
  // DETECCIÓN 100% CORRECTA DEL SERVICE Y TOKEN
  const rawPath = req.path;
  let service = "p2p";
  let token = "";

  if (rawPath.includes("=")) {
    const firstPart = rawPath.split("/")[1]; // "realdebrid=TOKEN123..."
    const [detectedService, detectedToken] = firstPart.split("=");
    service = detectedService.toLowerCase();
    token = detectedToken || "";
  }

  const { type, id } = req.params;
  console.log(`\nSTREAM → ${service.toUpperCase()} | ${type} ${id}`);

  const item = type === "movie" ? movies.find(m => m.id === id) : episodes.find(e => e.id === id);
  if (!item || !item.hash) return res.json({ streams: [] });

  const hash = item.hash.trim().toUpperCase();

  // CACHÉ RAYO
  if (cache.has(hash) && Date.now() < cache.get(hash).expires) {
    const t = crearTitulo(item, true);
    console.log(`RAYO CACHÉ → ${t.title}`);
    return res.json({ streams: [{ title: t.title, infoTitle: t.infoTitle, url: cache.get(hash).url }] });
  }

  // P2P SOLO SI NO HAY TOKEN (o si explícitamente es p2p)
  if (service === "p2p" || !token) {
    const magnet = `magnet:?xt=urn:btih:${hash}&dn=Primer+Latino&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337%2Fannounce&tr=udp%3A%2F%2Fopen.tracker.cl%3A1337%2Fannounce&tr=udp%3A%2F%2Ftracker.openbittorrent.com%3A80%2Fannounce`;
    const t = crearTitulo(item);
    return res.json({ streams: [{
      title: `${t.title} P2P`,
      infoTitle: "P2P Latino curado • Primer Latino",
      url: magnet,
      behaviorHints: { p2p: true }
    }] });
  }

  // PREMIUM – NUNCA MUESTRA P2P
  try {
    if (service === "realdebrid") {
      const auth = { headers: { Authorization: `Bearer ${token}` }, timeout: 30000 };
      let t = (await axios.post("https://api.real-debrid.com/rest/1.0/torrents/addMagnet",
        new URLSearchParams({ magnet: `magnet:?xt=urn:btih:${hash}` }), auth)).data;

      let attempts = 0;
      while (attempts < 80 && !t.links) {
        await new Promise(r => setTimeout(r, 3000));
        t = (await axios.get(`https://api.real-debrid.com/rest/1.0/torrents/info/${t.id}`, auth)).data;
        attempts++;
      }
      if (!t.links?.[0]) return res.json({ streams: [] });

      const video = t.files?.find(f => /\.(mkv|mp4)$/i.test(f.path)) || t.files[0];
      if (video && video.selected !== 1) {
        await axios.post(`https://api.real-debrid.com/rest/1.0/torrents/selectFiles/${t.id}`,
          new URLSearchParams({ files: video.id }), auth);
      }
      const link = await axios.post("https://api.real-debrid.com/rest/1.0/unrestrict/link",
        new URLSearchParams({ link: t.links[0] }), auth);
      const url = link.data.download;
      cache.set(hash, { url, expires: Date.now() + 86400000 });
      const titulo = crearTitulo(item);
      return res.json({ streams: [{ title: titulo.title, infoTitle: titulo.infoTitle, url }] });
    }

    if (service === "alldebrid") {
      const magnet = `magnet:?xt=urn:btih:${hash}`;
      const add = await axios.get(`https://api.alldebrid.com/v4/magnet/upload?agent=PrimerLatino&token=${token}&magnets[]=${encodeURIComponent(magnet)}`);
      const id = add.data.data.magnets[0].id;

      let status;
      let attempts = 0;
      do {
        await new Promise(r => setTimeout(r, 4000));
        status = (await axios.get(`https://api.alldebrid.com/v4/magnet/status?agent=PrimerLatino&token=${token}&id=${id}`)).data.data.magnets[0];
        attempts++;
      } while (status.status !== "Ready" && attempts < 70);

      if (status.status !== "Ready") return res.json({ streams: [] });

      const videoLink = status.links.find(l => /\.(mkv|mp4)$/i.test(l.filename)) || status.links[0];
      const unrestrict = await axios.get(`https://api.alldebrid.com/v4/link/unlock?agent=PrimerLatino&token=${token}&link=${encodeURIComponent(videoLink.link)}`);
      const url = unrestrict.data.data.link;

      cache.set(hash, { url, expires: Date.now() + 86400000 });
      const titulo = crearTitulo(item);
      return res.json({ streams: [{ title: titulo.title, infoTitle: titulo.infoTitle, url }] });
    }

    if (service === "torbox") {
      const add = await axios.post("https://api.torbox.app/v1/torrents/add", { token, magnet: `magnet:?xt=urn:btih:${hash}` });
      const torrentId = add.data.detail.id;

      let info;
      let attempts = 0;
      do {
        await new Promise(r => setTimeout(r, 4000));
        info = (await axios.get(`https://api.torbox.app/v1/torrents/info/${torrentId}?token=${token}`)).data.detail;
        attempts++;
      } while (info.status !== "completed" && attempts < 70);

      if (info.status !== "completed") return res.json({ streams: [] });

      const file = info.files.find(f => /\.(mkv|mp4)$/i.test(f.name)) || info.files[0];
      const url = `https://tbx.sx/dl/${file.hash}/${encodeURIComponent(file.name)}?token=${token}`;

      cache.set(hash, { url, expires: Date.now() + 86400000 });
      const titulo = crearTitulo(item);
      return res.json({ streams: [{ title: titulo.title, infoTitle: titulo.infoTitle, url }] });
    }

  } catch (e) {
    console.log(`Error en ${service}:`, e.message);
  }

  return res.json({ streams: [] });
});

// ==================== INICIO ====================
const PORT = process.env.PORT || 7000;
app.listen(PORT, () => {
  console.log(`\nPRIMER LATINO v9.3.5 CORRIENDO PERFECTO`);
  console.log(`@johnpradooo – EL REY DE LATAM 2025`);
  console.log(`Sube esto y ya nadie te para.\n`);
});