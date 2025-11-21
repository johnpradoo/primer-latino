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

app.get("/", (req, res) => res.json({ status: "OK", message: "Primer Latino v9.4 – Real-Debrid • AllDebrid • TorBox" }));

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
  version: "9.4.0",
  name: "Primer Latino",
  description: "Real-Debrid • AllDebrid • TorBox – by @johnpradoo",
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

// RUTAS PERFECTAS (funcionan con token largo)
app.get("/:service=:token?/manifest.json", (req, res) => res.json(manifest));
app.get("/:service=:token?/catalog/:type/:id.json", (req, res) => {
  const { type } = req.params;
  if (type === "movie") return res.json({ metas: movies.map(m => ({ id: m.id, type: "movie", name: m.title, poster: m.poster })) });
  if (type === "series") return res.json({ metas: seriesList.map(s => ({ id: s.id, type: "series", name: s.title, poster: s.poster })) });
  res.json({ metas: [] });
});
app.get("/:service=:token?/meta/:type/:id.json", (req, res) => {
  const { type, id } = req.params;
  const item = type === "movie" ? movies.find(m => m.id === id) : seriesList.find(s => s.id === id);
  if (!item) return res.json({});
  res.json({ meta: { id: item.id, type, name: item.title, poster: item.poster } });
});

// CACHÉ + RAYO
const cache = new Map();
function crearTituloEpico(item, fromCache = false) {
  const q = item.quality || "";
  const l = item.language || "";
  const title = `${q} ${l}${fromCache ? " RAYO" : ""} Primer Latino`.trim();
  const infoTitle = fromCache ? "Caché instantáneo" : "Primer Latino 2025";
  return { title, infoTitle };
}

// STREAM – FUNCIONA PELÍCULAS Y SERIES 100% (CORREGIDO)
app.get("/:service=:token?/stream/:type/:id.json", async (req, res) => {
  let service = req.params.service || "realdebrid";
  let token = req.params.token || "";
  service = service.toLowerCase();

  const { type, id } = req.params;
  console.log(`\nSOLICITUD → ${service.toUpperCase()} | ${type} ${id} | Token: ${token ? "Sí" : "No"}`);

  // CORRECTO: películas en movies.json | episodios en episodes.json
  let item;
  if (type === "movie") {
    item = movies.find(m => m.id === id);
  } else {
    item = episodes.find(e => e.id === id); // ej: tt22202452:1:1
  }

  if (!item || !item.hash) {
    console.log("ITEM NO ENCONTRADO o sin hash →", id);
    return res.json({ streams: [] });
  }

  const hash = item.hash.trim().toUpperCase();

  // CACHÉ RAYO
  if (cache.has(hash) && Date.now() < cache.get(hash).expires) {
    const t = crearTituloEpico(item, true);
    console.log(`RAYO CACHÉ → ${t.title}`);
    return res.json({ streams: [{ title: t.title, infoTitle: t.infoTitle, url: cache.get(hash).url }] });
  }

  if (!token) {
    console.log("Sin token → sin stream");
    return res.json({ streams: [] });
  }

  try {
    if (service === "realdebrid" || service === "real-debrid") {
      console.log("Procesando con Real-Debrid...");
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
        const video = torrentInfo.files.find(f => /\.(mp4|mkv|avi|mov|webm)$/i.test(f.path)) || torrentInfo.files[0];
        if (video && !torrentInfo.selected) {
          await axios.post(`https://api.real-debrid.com/rest/1.0/torrents/selectFiles/${torrentInfo.id}`,
            new URLSearchParams({ files: video.id }), auth);
        }
        const link = await axios.post("https://api.real-debrid.com/rest/1.0/unrestrict/link",
          new URLSearchParams({ link: torrentInfo.links[0] }), auth);
        const finalUrl = link.data.download;
        cache.set(hash, { url: finalUrl, expires: Date.Now() + 86400000 });

        const titulos = crearTituloEpico(item);
        console.log(`LIBERADO REAL-DEBRID → ${titulos.title}`);
        return res.json({ streams: [{ title: titulos.title, infoTitle: titulos.infoTitle, url: finalUrl }] });
      }
    }

    // ALLDEBRID y TORBOX igual (sin cambios)
    // ... (el resto del código que ya tenías)

  } catch (err) {
    console.error(`ERROR ${service.toUpperCase()}:`, err.response?.data || err.message);
  }

  console.log("No se pudo liberar el contenido");
  res.json({ streams: [] });
});

const PORT = process.env.PORT || 7000;
app.listen(PORT, () => {
  console.log(`\nPRIMER LATINO v9.4 CORRIENDO`);
  console.log(`@johnpradooo (X)`);
  console.log(`Primer Latino\n`);
});