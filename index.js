// index.js — LATINOTOP (estructura limpia con frontend separado)
// Autor: @johnpradoo

const { addonBuilder, getRouter } = require("stremio-addon-sdk");
const fetch = require("node-fetch");
const express = require("express");
const path = require("path");

const manifest = require("./static/manifest.json");
const builder = new addonBuilder(manifest);
const app = express();

// URL RAW del JSON principal
const DATA_URL = "https://raw.githubusercontent.com/johnpradoo/LATINOTOP/main/data/movies.json";

// --- HANDLER PRINCIPAL STREMIO ---
builder.defineStreamHandler(async (args) => {
  console.log("🛰️ Buscando stream para:", args);

  try {
    const response = await fetch(DATA_URL);
    const data = await response.json();
    const streams = [];

    const rawId = args.id || "";
    const idClean = rawId.replace("tmdb", "").replace(":", "").trim();

    if (args.type === "movie") {
      const matches = data.movies.filter(
        (m) => m.id === rawId || m.id === idClean || m.tmdb_id === idClean
      );

      matches.forEach((movie) => {
        streams.push({
          title: `LATINOTOP • ${movie.quality} • ${movie.language} • ${movie.codec}`,
          url: movie.url,
          filename: `${sanitizeFilename(movie.title)}.${movie.quality}.${slugLang(movie.language)}.${movie.codec}.mkv`,
        });
      });
    }

    if (args.type === "series") {
      const matches = data.series.filter(
        (s) =>
          (s.id === rawId || s.id === idClean || s.tmdb_id === idClean) &&
          s.season == args.season &&
          s.episode == args.episode
      );

      matches.forEach((serie) => {
        streams.push({
          title: `LATINOTOP • ${serie.quality} • ${serie.language} • ${serie.codec}`,
          url: serie.url,
          filename: `${sanitizeFilename(serie.title)}.S${serie.season}E${serie.episode}.${serie.quality}.${slugLang(serie.language)}.${serie.codec}.mkv`,
        });
      });
    }

    console.log(`✅ Streams encontrados: ${streams.length}`);
    return { streams };
  } catch (err) {
    console.error("❌ Error cargando datos:", err);
    return { streams: [] };
  }
});

// --- FUNCIONES AUXILIARES ---
function sanitizeFilename(name) {
  return name.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "").replace(/\s+/g, "_");
}
function slugLang(lang) {
  return (lang || "").replace(/[^\w\-]/g, "_").replace(/\s+/g, "_");
}

// --------------------
// CONFIGURACIÓN EXPRESS
// --------------------
app.use(express.json());

// --- SERVIR INTERFAZ PRINCIPAL Y PANELES ---
app.use("/", express.static(path.join(__dirname, "public"))); // home.html
app.use("/admin", express.static(path.join(__dirname, "public"))); // admin.html
app.use("/community", express.static(path.join(__dirname, "public"))); // index.html si lo tienes

// --- ENDPOINTS DE LA COMUNIDAD ---
app.post("/community/submit", async (req, res) => {
  try {
    const { title, type, url, quality, language, codec } = req.body;
    if (!title || !url || !type)
      return res.status(400).json({ success: false, message: "Faltan campos obligatorios (title, type, url)." });

    const submission = {
      id: Date.now().toString(),
      title: title.trim(),
      type: type.trim(),
      quality: (quality || "").trim(),
      language: (language || "").trim(),
      codec: (codec || "").trim(),
      url: url.trim(),
      status: "pendiente",
      date: new Date().toISOString(),
    };

    const repo = "johnpradoo/LATINOTOP";
    const pathFile = "data/community_submissions.json";
    const token = process.env.GITHUB_TOKEN;
    const headers = {
      Accept: "application/vnd.github+json",
      Authorization: `token ${token}`,
      "User-Agent": "LATINOTOP-BOT",
    };

    const getRes = await fetch(`https://api.github.com/repos/${repo}/contents/${pathFile}`, { headers });
    const getData = await getRes.json();
    if (!getData.content) throw new Error("No se pudo obtener el archivo desde GitHub.");

    const content = Buffer.from(getData.content, "base64").toString("utf8");
    const data = content.trim() ? JSON.parse(content) : [];

    const existe = data.find(
      (item) =>
        item.title.toLowerCase() === submission.title.toLowerCase() ||
        item.url.trim() === submission.url.trim()
    );
    if (existe)
      return res.json({ success: false, message: "⚠️ Este archivo ya fue enviado o está en revisión." });

    data.push(submission);
    const newContent = Buffer.from(JSON.stringify(data, null, 2)).toString("base64");

    const updateRes = await fetch(`https://api.github.com/repos/${repo}/contents/${pathFile}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        message: `Nuevo envío comunitario: ${submission.title}`,
        content: newContent,
        sha: getData.sha,
      }),
    });

    const updateData = await updateRes.json();
    if (updateData.commit)
      return res.json({
        success: true,
        message: "✅ Envío guardado correctamente. Tu aporte está en revisión.",
      });

    throw new Error("No se pudo subir el archivo a GitHub.");
  } catch (err) {
    console.error("❌ Error al guardar envío:", err);
    res.status(500).json({ success: false, message: "Error al procesar el envío." });
  }
});

// --- LISTAR ENVÍOS ---
app.get("/community/list", async (req, res) => {
  try {
    const repo = "johnpradoo/LATINOTOP";
    const pathFile = "data/community_submissions.json";
    const headers = {
      Accept: "application/vnd.github+json",
      Authorization: `token ${process.env.GITHUB_TOKEN}`,
      "User-Agent": "LATINOTOP-BOT",
    };

    const getRes = await fetch(`https://api.github.com/repos/${repo}/contents/${pathFile}`, { headers });
    const getData = await getRes.json();
    if (!getData.content)
      return res.status(404).json({ success: false, message: "No se encontró el archivo de comunidad." });

    const content = Buffer.from(getData.content, "base64").toString("utf8");
    const data = content.trim() ? JSON.parse(content) : [];
    res.json({ success: true, data });
  } catch (err) {
    console.error("❌ Error al obtener lista:", err);
    res.status(500).json({ success: false, message: "Error al obtener la lista." });
  }
});

// --- APROBAR / ELIMINAR ENVÍOS ---
app.post("/community/update", async (req, res) => {
  try {
    const { id, action } = req.body;
    if (!id || !action) return res.status(400).json({ success: false, message: "Datos incompletos." });

    const repo = "johnpradoo/LATINOTOP";
    const pathFile = "data/community_submissions.json";
    const headers = {
      Accept: "application/vnd.github+json",
      Authorization: `token ${process.env.GITHUB_TOKEN}`,
      "User-Agent": "LATINOTOP-BOT",
    };

    const getRes = await fetch(`https://api.github.com/repos/${repo}/contents/${pathFile}`, { headers });
    const getData = await getRes.json();
    if (!getData.content) throw new Error("No se pudo leer el archivo.");

    const content = Buffer.from(getData.content, "base64").toString("utf8");
    let data = content.trim() ? JSON.parse(content) : [];
    const index = data.findIndex((i) => i.id === id);
    if (index === -1) return res.json({ success: false, message: "No se encontró el envío." });

    if (action === "eliminar") data.splice(index, 1);
    else data[index].status = action;

    const newContent = Buffer.from(JSON.stringify(data, null, 2)).toString("base64");
    const updateRes = await fetch(`https://api.github.com/repos/${repo}/contents/${pathFile}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        message: `Actualizado: ${action.toUpperCase()} -> ${data[index]?.title || "Eliminado"}`,
        content: newContent,
        sha: getData.sha,
      }),
    });

    const updateData = await updateRes.json();
    if (updateData.commit)
      return res.json({ success: true, message: "✅ Estado actualizado correctamente." });
    throw new Error("Error al subir a GitHub.");
  } catch (err) {
    console.error("❌ Error en update:", err);
    res.status(500).json({ success: false, message: "Error al actualizar el estado." });
  }
});

// --- RUTA DEL ADDON SDK ---
const addonInterface = builder.getInterface();
app.use("/", getRouter(addonInterface, { manifestUrl: "https://latinotop.onrender.com/manifest.json" }));

// --- PANTALLA DE CARGA AL ENTRAR A "/" ---
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "loading.html"));
});

// --- INICIAR SERVIDOR ---
const PORT = process.env.PORT || 7000;
app.listen(PORT, () => console.log(`✅ LATINOTOP corriendo en puerto ${PORT}`));
