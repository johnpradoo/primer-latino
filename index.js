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

app.get("/", (req, res) => res.json({ status: "OK", message: "Primer Latino v9.3 – Multi-Debrid + P2P" }));

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
 2025",
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

// RUTAS PERFECTAS (tu patrón original que SÍ funciona)
app.get("/:service=:token?/manifest.json", (req, res) => res.json(manifest));
app.get("/:service=:token?/catalog/:type/:id.json", (req, res) => {
  const { type } = req.params;
  const metas = type === "movie" 
    ? movies.map(m => ({ id: m.id, type: "movie", name: m.title, poster: m.poster }))
    : seriesList.map(s => ({ id: s.id, type: "series", name: s.title, poster: s.poster }));
  res.json({ metas });
});
app.get("/:service=:token?/meta/:type/:id.json", (req, res) => {
  const { type, id } = req.params;
  const item = type === "movie" ? movies.find(m => m.id === id) : seriesList.find(s => s.id === id);
  if (!item) return res.json({});
  res.json({ meta: { id: item.id, type, name: item.title, poster: item.poster } });
});

// CACHÉ
const cache = new Map();
function crearTituloEpico(item, fromCache = false) {
  const q = item.quality || "";
  const l = item.language || "";
  const title = `${q} ${l}${fromCache ? " RAYO" : ""} Primer Latino`.trim();
  const infoTitle = fromCache ? "Caché instantáneo" : "Primer Latino 2025";
  return { title, infoTitle };
}

// STREAM – TU CÓDIGO ORIGINAL + ALLDEBRID + TORBOX + P2P OPCIONAL
app.get("/:service=:token?/stream/:type/:id.json", async (req, res) => {
  let { service = "p2p", token = "", type, id } = req.params;
  console.log(`\nSOLICITUD → ${service.toUpperCase()} | ${type} ${id}`);

  const item = type === "movie" ? movies.find(m => m.id === id) : episodes.find(e => e.id === id);
  if (!item || !item.hash) return res.json({ streams: [] });

  const hash = item.hash.trim().toUpperCase();

  // CACHÉ RAYO
  if (cache.has(hash) && Date.now() < cache.get(hash).expires) {
    const t = crearTituloEpico(item, true);
    console.log(`RAYO CACHÉ → ${t.title}`);
    return res.json({ streams: [{ title: t.title, infoTitle: t.infoTitle, url: cache.get(hash).url }] });
  }

  // P2P GRATIS (solo si el usuario elige /p2p o no pone token)
  if (service === "p2p" || !token) {
    const magnet = `magnet:?xt=urn:btih:${hash}&dn=Primer+Latino&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337%2Fannounce&tr=udp%3A%2F%2Fopen.tracker.cl%3A1337%2Fannounce&tr=udp%3A%2F%2Ftracker.openbittorrent.com%3A80%2Fannounce`;
    const t = crearTituloEpico(item);
    return res.json({ streams: [{ title: `${t.title} P2P`, infoTitle: "P2P Latino curado", url: magnet, behaviorHints: { p2p: true } }] });
  }

  // REAL-DEBRID (TU CÓDIGO ORIGINAL 100% INTACTO)
  if (service === "realdebrid") {
    try {
      const auth = { headers: { Authorization: `Bearer ${token}` } };
      let torrentInfo = (await axios.post("https://api.real-debrid.com/rest/1.0/torrents/addMagnet", 
        new URLSearchParams({ magnet: `magnet:?xt=urn:btih:${hash}` }), auth)).data;

      let attempts = 0;
      while (attempts < 80 && !torrentInfo.links) {
        await new Promise(r => setTimeout(r, 3000));
        torrentInfo = (await axios.get(`https://api.real-debrid.com/rest/1.0/torrents/info/${torrentInfo.id}`, auth)).data;
        attempts++;
      }

      if (torrentInfo.links?.[0]) {
        const fresh = torrentInfo;
        const video = fresh.files.find(f => /\.(mp4|mkv|avi|mov|webm)$/i.test(f.path)) || fresh.files[0];
        if (video && !fresh.selected) {
          await axios.post(`https://api.real-debrid.com/rest/1.0/torrents/selectFiles/${torrentInfo.id}`,
            new URLSearchParams({ files: video.id }), auth);
          await new Promise(r => setTimeout(r, 2000));
        }
        const link = await axios.post("https://api.real-debrid.com/rest/1.0/unrestrict/link",
          new URLSearchParams({ link: torrentInfo.links[0] }), auth);
        const finalUrl = link.data.download;
        cache.set(hash, { url: finalUrl, expires: Date.now() + 86400000 });

        const titulos = crearTituloEpico(item);
        console.log(`PLAY → ${titulos.title}`);
        return res.json({ streams: [{ title: titulos.title, infoTitle: titulos.infoTitle, url: finalUrl }] });
      }
    } catch (err) {
      console.error("ERROR RD:", err.response?.data || err.message);
    }
  }

  // ALLDEBRID
  if (service === "alldebrid") {
    try {
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
      const titulo = crearTituloEpico(item);
      return res.json({ streams: [{ title: titulo.title, infoTitle: titulo.infoTitle, url }] });
    } catch (err) {
      console.error("ERROR AllDebrid:", err.message);
    }
  }

  // TORBOX
  if (service === "torbox") {
    try {
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
      const titulo = crearTituloEpico(item);
      return res.json({ streams: [{ title: titulo.title, infoTitle: titulo.infoTitle, url }] });
    } catch (err) {
      console.error("ERROR TorBox:", err.message);
    }
  }

  // SI LLEGA AQUÍ Y TENÍA TOKEN → NO HAY STREAM (nada de P2P)
  return res.json({ streams: [] });
});

const PORT = process.env.PORT || 7000;
app.listen(PORT, () => {
  console.log(`\nPRIMER LATINO v9.3 CORRIENDO`);
  console.log(`@johnpradooo (X)`);
  console.log(`Primer Latino\n`);
});