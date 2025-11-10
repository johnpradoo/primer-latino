import pkg from "stremio-addon-sdk";
const { addonBuilder, serveHTTP } = pkg;
import express from "express";
import fs from "fs";
import RealDebrid from "real-debrid-api";

// ──────────────────────────────
// MANIFEST
// ──────────────────────────────
const manifest = {
  id: "org.primerlatino",
  version: "1.1.0",
  name: "Primer Latino",
  description: "Addon de películas y series con soporte Real-Debrid (multiusuario)",
  types: ["movie", "series"],
  catalogs: [
    { type: "movie", id: "primerlatino_movies", name: "Primer Latino • Películas" },
    { type: "series", id: "primerlatino_series", name: "Primer Latino • Series" },
  ],
  resources: ["catalog", "meta", "stream"],
};

// ──────────────────────────────
// CARGA DE MOVIES.JSON
// ──────────────────────────────
let movies = [];
let series = [];

try {
  const data = fs.readFileSync("./movies.json");
  const parsed = JSON.parse(data);
  movies = parsed.filter((m) => m.type === "movie");
  series = parsed.filter((m) => m.type === "series");
  console.log(`🎬 Cargadas ${movies.length} películas y ${series.length} series.`);
} catch (err) {
  console.error("❌ Error al cargar movies.json:", err.message);
}

// ──────────────────────────────
// FUNCIÓN: Obtener enlace Real-Debrid
// ──────────────────────────────
async function getRealDebridLink(token, infoHash) {
  try {
    const rd = new RealDebrid(token);

    // 1️⃣ Revisar torrents existentes (para evitar duplicados)
    const torrents = await rd.torrents.get();
    const existing = torrents.find((t) => t.hash.toLowerCase() === infoHash.toLowerCase());

    let torrentId;
    if (existing) {
      torrentId = existing.id;
    } else {
      // 2️⃣ Subir nuevo magnet
      const added = await rd.torrents.addMagnet(`magnet:?xt=urn:btih:${infoHash}`);
      torrentId = added.id;
    }

    // 3️⃣ Obtener info del torrent
    const info = await rd.torrents.info(torrentId);

    // 4️⃣ Buscar archivo de video
    const file = info.files.find((f) => /\.(mp4|mkv|avi)$/i.test(f.path));
    if (!file) throw new Error("No se encontró archivo de video válido");

    // 5️⃣ Seleccionar archivo
    await rd.torrents.selectFiles(torrentId, file.id);

    // 6️⃣ Esperar que el link esté disponible
    const refreshed = await rd.torrents.info(torrentId);
    const link = refreshed.links && refreshed.links[0];
    if (!link) throw new Error("No se generó enlace de descarga");

    // 7️⃣ Desbloquear link final
    const unrestricted = await rd.unrestrict.link(link);
    return unrestricted.download;
  } catch (err) {
    console.warn("⚠️ Error Real-Debrid:", err.message || err);
    return null;
  }
}

// ──────────────────────────────
// ADDON BUILDER
// ──────────────────────────────
const builder = new addonBuilder(manifest);

// STREAM HANDLER
builder.defineStreamHandler(async ({ id }) => {
  try {
    const [userToken, imdbId] = id.split("/");

    if (!userToken || userToken.length < 10) {
      return {
        streams: [
          {
            title: "🔒 Este addon requiere tu token de Real-Debrid",
            url: "https://johnpradoo.github.io/primer-latino-page/",
          },
        ],
      };
    }

    const found = movies.find((m) => m.id === imdbId) || series.find((s) => s.id === imdbId);
    if (!found) return { streams: [] };

    const rdLink = await getRealDebridLink(userToken, found.hash);

    return {
      streams: [
        {
          title: `${found.language || "Latino"} • ${found.quality || "HD"}`,
          url: rdLink || `magnet:?xt=urn:btih:${found.hash}`,
        },
      ],
    };
  } catch (err) {
    console.error("❌ Stream Handler:", err.message);
    return { streams: [] };
  }
});

// ──────────────────────────────
// EXPRESS CONFIG
// ──────────────────────────────
const app = express();

// Manifest raíz o con token
app.get(["/manifest.json", "/:token/manifest.json"], (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.json(manifest);
});

// Iniciar servidor
serveHTTP(builder.getInterface(), { app, port: process.env.PORT || 10000 });
console.log("✅ Primer Latino activo en puerto", process.env.PORT || 10000);
