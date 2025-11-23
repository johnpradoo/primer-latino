// index.js – PRIMERLATINO.COM OFICIAL (funciona con y sin www + token limpio)
const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

// Permitir tanto primerlatino.com como www.primerlatino.com
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "*");
  next();
});

// Cargar JSONs
let movies = [], seriesList = [], episodes = [];
try {
  movies = JSON.parse(fs.readFileSync(path.join(__dirname, "movies.json"))).movies || [];
  seriesList = JSON.parse(fs.readFileSync(path.join(__dirname, "series.json"))).series || [];
  episodes = JSON.parse(fs.readFileSync(path.join(__dirname, "episodes.json"))).episodes || [];
} catch (e) {
  console.error("Error cargando JSON:", e.message);
}

// TU MANIFEST (el mismo de siempre)
const manifest = {
  id: "org.primerlatino.addon",
  version: "10.0.0",
  name: "Primer Latino",
  description: "Real-Debrid • AllDebrid • TorBox – by @johnpradoo",
  logo: "https://primerlatino.com/logo.png",
  background: "https://primerlatino.com/banner.jpg",
  resources: ["catalog", "meta", "stream"],
  types: ["movie", "series"],
  catalogs: [
    { type: "movie", id: "primerlatino_movies", name: "Películas Latino" },
    { type: "series", id: "primerlatino_series", name: "Series Latino" }
  ],
  idPrefixes: ["tt"]
};

// ====== RUTA MÁGICA QUE LEE TODO ======
// Esta única ruta detecta automáticamente token y servicio
app.use((req, res, next) => {
  const fullPath = req.path; // ej: /018302/manifest.json o /realdebrid=ABC123/stream/...
  const parts = fullPath.split("/").filter(Boolean);

  let token = "";
  let service = "realdebrid";

  // Si el primer segmento tiene "=" → es servicio=token
  // Si no → es solo token (modo limpio)
  if (parts.length > 0) {
    const first = parts[0];
    if (first.includes("=")) {
      const [s, t] = first.split("=");
      service = s.toLowerCase();
      token = t;
      parts.shift(); // quita el primer segmento
    } else if (!first.includes("manifest") && !first.includes("catalog") && !first.includes("stream") && !first.includes("meta")) {
      token = first;
      parts.shift();
    }
  }

  // Guardamos token y servicio para usarlos en todas las rutas
  req.token = token;
  req.service = service;
  req.cleanPath = "/" + parts.join("/");

  next();
});

// ====== RUTAS NORMALES (usando req.token y req.service) ======
app.get(/manifest\.json$/, (req, res) => res.json(manifest));

app.get(/catalog\/movie|series\/.+/, (req, res) => {
  // tu código de catálogo actual
});

app.get(/meta\/.+/, (req, res) => {
  // tu código de meta actual
});

app.get(/stream\/.+/, async (req, res) => {
  const token = req.token;
  const service = req.service;
  // aquí pegas todo tu código de Real-Debrid, AllDebrid, TorBox
  // usando token y service
});

// Ruta raíz → landing page (te la paso después)
app.get("/", (req, res) => {
  res.send(`
    <h1 style="text-align:center;margin-top:100px;font-family:Arial">
      Primer Latino 2025<br>
      <small>El addon más rápido de Latinoamérica</small>
    </h1>
  `);
});

module.exports = app;
