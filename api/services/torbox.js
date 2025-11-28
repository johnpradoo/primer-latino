const axios = require("axios");
const cache = new Map(); // caché global

function crearTituloEpico(item, fromCache = false) {
  const calidad = (item.quality || "1080p").trim();
  const idioma = (item.language || "MX LATINO").trim();
  const title = `${calidad} ${idioma}${fromCache ? " ⚡️ CACHÉ" : ""} Primer Latino`.trim();
  const infoTitle = "Primer Latino";
  return { title, infoTitle };
}

async function getStream(key, hash, item) {
  const hashUpper = hash.trim().toUpperCase();

  if (cache.has(hashUpper) && Date.now() < cache.get(hashUpper).expires) {
    const titulos = crearTituloEpico(item, true);
    return [{ title: titulos.title, infoTitle: titulos.infoTitle, url: cache.get(hashUpper).url }];
  }

  try {
    const auth = { headers: { "Authorization": `Bearer ${key}` } };

    // Buscar torrent
    const { data } = await axios.get("https://api.torbox.app/torrents", auth);
    let torrentInfo = data.find(t => t.hash.toUpperCase() === hashUpper && t.status === "downloaded");

    if (!torrentInfo) {
      const magnet = `magnet:?xt=urn:btih:${hashUpper}`;
      const add = await axios.post("https://api.torbox.app/torrent/add", { magnet }, auth);
      const torrentId = add.data.id;

      for (let i = 0; i < 40; i++) {
        await new Promise(r => setTimeout(r, 3000));
        const { data } = await axios.get(`https://api.torbox.app/torrent/${torrentId}`, auth);
        torrentInfo = data;
        if (torrentInfo.status === "downloaded") break;
        if (torrentInfo.status === "waiting_files_selection" && torrentInfo.files) {
          const video = torrentInfo.files.find(f => /\.(mp4|mkv|avi|mov|webm)$/i.test(f.path)) || torrentInfo.files[0];
          await axios.post(`https://api.torbox.app/torrent/${torrentId}/selectFiles`, { files: video.id }, auth);
        }
      }
    }

    if (torrentInfo.links?.[0]) {
      const { data } = await axios.post("https://api.torbox.app/link/unrestrict", { link: torrentInfo.links[0] }, auth);
      const finalUrl = data.link;
      cache.set(hashUpper, { url: finalUrl, expires: Date.now() + 24*60*60*1000 });

      const titulos = crearTituloEpico(item, false);
      return [{ title: titulos.title, infoTitle: titulos.infoTitle, url: finalUrl }];
    }
  } catch (err) {
    console.error("ERROR Torbox:", err.response?.data || err.message);
  }

  return [];
}

module.exports = { getStream };
