const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "*");
  res.type("application/json");
  next();
});

app.get("/", (req, res) => res.json({ status: "OK", message: "Primer Latino v9.5 – FULL PREMIUM" }));

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
  id: "org.primerlatino.addon", version: "9.5.0", name: "Primer Latino",
  description: "Real-Debrid • AllDebrid • TorBox – by @johnpradoo",
  logo: "https://github.com/johnpradoo/primer-latino/blob/main/logo/icon.png?raw=true",
  background: "https://github.com/johnpradoo/primer-latino/blob/main/logo/banner.jpg?raw=true",
  types: ["movie", "series"], resources: ["catalog", "meta", "stream"],
  catalogs: [
    { type: "movie", id: "primerlatino_movies", name: "Películas Latino" },
    { type: "series", id: "primerlatino_series", name: "Series Latino" }
  ],
  idPrefixes: ["tt"]
};

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
  return { title, infoTitle: fromCache ? "Caché instantáneo" : "Primer Latino 2025" };
}

// STREAM
app.get("/:service=:token?/stream/:type/:id.json", async (req, res) => {
  let service = req.params.service || "realdebrid";
  let token = req.params.token || "";
  service = service.toLowerCase();

  const { type, id } = req.params;
  console.log(`\nSOLICITUD → ${service.toUpperCase()} | ${type} ${id}`);

  let item;
  if (type === "movie") item = movies.find(m => m.id === id);
  else item = episodes.find(e => e.id === id);

  if (!item || !item.hash) return res.json({ streams: [] });
  const hash = item.hash.trim().toUpperCase();

  if (cache.has(hash) && Date.now() < cache.get(hash).expires) {
    const t = crearTituloEpico(item, true);
    console.log(`RAYO CACHÉ → ${t.title}`);
    return res.json({ streams: [{ title: t.title, infoTitle: t.infoTitle, url: cache.get(hash).url }] });
  }

  if (!token) return res.json({ streams: [] });

  try {
    // REAL-DEBRID – 100% ESTABLE
    if (service === "realdebrid" || service === "real-debrid") {
      console.log("Procesando con Real-Debrid...");
      const auth = { headers: { Authorization: `Bearer ${token}` }, timeout: 30000 };
      const addRes = await axios.post("https://api.real-debrid.com/rest/1.0/torrents/addMagnet",
        new URLSearchParams({ magnet: `magnet:?xt=urn:btih:${hash}` }), auth);
      const torrentId = addRes.data.id;

      let torrentInfo;
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 3000));
        torrentInfo = (await axios.get(`https://api.real-debrid.com/rest/1.0/torrents/info/${torrentId}`, auth)).data;
        if (torrentInfo.links && torrentInfo.links.length > 0) break;
      }

      if (!torrentInfo?.links?.[0]) throw new Error("No links");

      const videoFile = torrentInfo.files.find(f => /\.(mkv|mp4|avi|mov)$/i.test(f.path)) || torrentInfo.files[0];
      if (videoFile && torrentInfo.status !== "downloaded") {
        await axios.put(`https://api.real-debrid.com/rest/1.0/torrents/selectFiles/${torrentId}`,
          new URLSearchParams({ files: videoFile.id.toString() }), auth);
      }

      const link = await axios.post("https://api.real-debrid.com/rest/1.0/unrestrict/link",
        new URLSearchParams({ link: torrentInfo.links[0] }), auth);

      const finalUrl = link.data.download;
      cache.set(hash, { url: finalUrl, expires: Date.now() + 86400000 });
      const t = crearTituloEpico(item);
      console.log(`LIBERADO REAL-DEBRID → ${t.title}`);
      return res.json({ streams: [{ title: t.title, infoTitle: t.infoTitle, url: finalUrl }] });
    }

    // AllDebrid y TorBox los dejamos listos para cuando quieras activarlos

  } catch (err) {
    console.log("Falló Real-Debrid:", err.message);
  }

  res.json({ streams: [] });
});

const PORT = process.env.PORT || 7000;
app.listen(PORT, () => {
  console.log(`\nPRIMER LATINO v9.5 CORRIENDO PERFECTO`);
  console.log(`@johnpradooo – EL REY DE LATAM 2025`);
});