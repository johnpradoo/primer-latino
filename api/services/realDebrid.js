const axios = require("axios");
const cache = new Map(); // caché global

function crearTituloEpico(item, fromCache = false) {
  const calidad = (item.quality || "1080p").trim();
  const idioma = (item.language || "MX LATINO").trim();
  const title = `${calidad} ${idioma}${fromCache ? " ⚡️| CAHE" : ""} Primer Latino`.trim();
  const infoTitle = "Primer Latino";
  return { title, infoTitle };
}

async function getStream(token, hash, item) {
  const hashUpper = hash.trim().toUpperCase();

  if (cache.has(hashUpper) && Date.now() < cache.get(hashUpper).expires) {
    const titulos = crearTituloEpico(item, true);
    return [{ title: titulos.title, infoTitle: titulos.infoTitle, url: cache.get(hashUpper).url }];
  }

  try {
    const auth = { headers: { Authorization: `Bearer ${token}` } };
    const { data: torrents } = await axios.get("https://api.real-debrid.com/rest/1.0/torrents?limit=1000", auth);
    let torrentInfo = torrents.find(t => t.hash.toUpperCase() === hashUpper && t.status === "downloaded");

    if (!torrentInfo) {
      const magnet = `magnet:?xt=urn:btih:${hashUpper}`;
      const add = await axios.post("https://api.real-debrid.com/rest/1.0/torrents/addMagnet", new URLSearchParams({magnet}), auth);
      const torrentId = add.data.id;

      for (let i = 0; i < 40; i++) {
        torrentInfo = (await axios.get(`https://api.real-debrid.com/rest/1.0/torrents/info/${torrentId}`, auth)).data;
        if (torrentInfo.status === "downloaded") break;
        if (torrentInfo.status === "waiting_files_selection" && torrentInfo.files) {
          const video = torrentInfo.files.find(f => /\.(mp4|mkv|avi|mov|webm)$/i.test(f.path)) || torrentInfo.files[0];
          await axios.post(`https://api.real-debrid.com/rest/1.0/torrents/selectFiles/${torrentId}`, new URLSearchParams({files: video.id}), auth);
        }
        await new Promise(r => setTimeout(r, 3000));
      }
    }

    if ((!torrentInfo.links || torrentInfo.links.length === 0) && torrentInfo.id) {
      const fresh = (await axios.get(`https://api.real-debrid.com/rest/1.0/torrents/info/${torrentInfo.id}`, auth)).data;
      const video = fresh.files.find(f => /\.(mp4|mkv|avi|mov|webm)$/i.test(f.path)) || fresh.files[0];
      await axios.post(`https://api.real-debrid.com/rest/1.0/torrents/selectFiles/${torrentInfo.id}`, new URLSearchParams({files: video.id}), auth);
      await new Promise(r => setTimeout(r, 2000));
      torrentInfo = (await axios.get(`https://api.real-debrid.com/rest/1.0/torrents/info/${torrentInfo.id}`, auth)).data;
    }

    if (torrentInfo.links?.[0]) {
      const link = await axios.post("https://api.real-debrid.com/rest/1.0/unrestrict/link", new URLSearchParams({link: torrentInfo.links[0]}), auth);
      const finalUrl = link.data.download;
      cache.set(hashUpper, { url: finalUrl, expires: Date.now() + 24*60*60*1000 });

      const titulos = crearTituloEpico(item, false);
      return [{ title: titulos.title, infoTitle: titulos.infoTitle, url: finalUrl }];
    }
  } catch (err) {
    console.error("ERROR Real-Debrid:", err.response?.data || err.message);
  }

  return [];
}

module.exports = { getStream };
