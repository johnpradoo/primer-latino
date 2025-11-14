import express from "express";
import fs from "fs";
import { addonBuilder } from "stremio-addon-sdk";

// ---------------------------------------------------
// CONFIGURACIÓN DEL ADDON
// ---------------------------------------------------

const PORT = process.env.PORT || 10000;

const manifest = {
    id: "primer-latino-addon",
    version: "1.0.0",
    name: "Primer Latino",
    description: "Addon privado con soporte Real-Debrid por token del usuario",
    catalogs: [
        { type: "movie", id: "primerlatino_movies", name: "Películas LATINO" },
        { type: "series", id: "primerlatino_series", name: "Series LATINO" }
    ],
    resources: ["catalog", "meta", "stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"]
};

// ---------------------------------------------------
// CARGA DE ARCHIVOS JSON (tus 3 archivos manuales)
// ---------------------------------------------------

function loadJSON(path) {
    try {
        return JSON.parse(fs.readFileSync(path, "utf8"));
    } catch (e) {
        console.error("ERROR leyendo archivo:", path);
        console.error(e);
        return [];
    }
}

const movies = loadJSON("movies.json");
const series = loadJSON("series.json");
const episodes = loadJSON("episodes.json");

const builder = new addonBuilder(manifest);

// ---------------------------------------------------
// CATALOGO: MOVIES y SERIES
// ---------------------------------------------------

builder.defineCatalogHandler(args => {
    const type = args.type;

    if (type === "movie") {
        return Promise.resolve({
            metas: movies.map(m => ({
                id: m.id,
                type: "movie",
                name: m.title,
                poster: m.poster
            }))
        });
    }

    if (type === "series") {
        return Promise.resolve({
            metas: series.map(s => ({
                id: s.id,
                type: "series",
                name: s.title,
                poster: s.poster
            }))
        });
    }

    return Promise.resolve({ metas: [] });
});

// ---------------------------------------------------
// META: INFO DE PELÍCULAS Y SERIES + VIDEOS (EPS)
// ---------------------------------------------------

builder.defineMetaHandler(args => {
    const id = args.id;

    // --- Película ---
    const mov = movies.find(m => m.id === id);
    if (mov) {
        return Promise.resolve({
            meta: {
                id: mov.id,
                type: "movie",
                name: mov.title,
                poster: mov.poster,
                videos: []
            }
        });
    }

    // --- Serie ---
    const ser = series.find(s => s.id === id);
    if (ser) {
        const eps = episodes
            .filter(e => e.id === id)
            .map(e => ({
                id: `${id}:${e.season}:${e.episode}`,
                title: `S${e.season}E${e.episode}`,
                season: e.season,
                episode: e.episode
            }));

        return Promise.resolve({
            meta: {
                id: ser.id,
                type: "series",
                name: ser.title,
                poster: ser.poster,
                videos: eps
            }
        });
    }

    return Promise.resolve({ meta: {} });
});

// ---------------------------------------------------
// STREAMS: DONDE SE REPRODUCE TODO
// ---------------------------------------------------

builder.defineStreamHandler(args => {
    const { id } = args;

    // ID viene así: tt30444310:1:2
    const [imdb, seasonRaw, episodeRaw] = id.split(":");
    const season = Number(seasonRaw);
    const episode = Number(episodeRaw);

    const ep = episodes.find(e =>
        e.id === imdb &&
        e.season === season &&
        e.episode === episode
    );

    if (!ep) {
        return Promise.resolve({ streams: [] });
    }

    // Token del usuario (importantísimo)
    const userToken = args.extra && args.extra.token;
    if (!userToken) {
        return Promise.resolve({
            streams: [],
            error: "Falta token de usuario. Ingresa tu token de Real-Debrid."
        });
    }

    const magnet = `magnet:?xt=urn:btih:${ep.hash}`;

    return Promise.resolve({
        streams: [
            {
                name: "Primer Latino",
                description: `${ep.quality} | ${ep.language}`,
                url: `https://api.real-debrid.com/rest/1.0/unrestrict/link?magnet=${encodeURIComponent(
                    magnet
                )}&auth=${userToken}`
            }
        ]
    });
});

// ---------------------------------------------------
// SERVER EXPRESS PARA RENDER
// ---------------------------------------------------

const app = express();
app.use("/", builder.getInterface());
app.listen(PORT, () => console.log(`👉 Addon ejecutándose en el puerto ${PORT}`));