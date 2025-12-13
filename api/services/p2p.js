// services/p2p.js → Versión mejorada para máxima compatibilidad con Stremio
const getStream = async (token, infoHash, item) => {
  if (!infoHash) return [];

  // Calidad e idioma para el título
  let qualities = item.quality || item.q || [];
  qualities = Array.isArray(qualities) ? qualities : (qualities ? qualities.split("|").map(q => q.trim()) : []);
  const manualQuality = qualities[0] || "Unknown";

  const langRaw = (item.language || item.l || "").replace(/\|/g, "·").trim();

  // Trackers fuertes (más seeders)
  const trackers = [
    "udp://tracker.opentrackr.org:1337/announce",
    "udp://open.tracker.cl:1337/announce",
    "udp://tracker.openbittorrent.com:80/announce",
    "udp://exodus.desync.com:6969/announce",
    "udp://tracker.torrent.eu.org:451/announce",
    "udp://tracker.moeking.me:6969/announce",
    "udp://open.stealth.si:80/announce",
    "udp://tracker.cyberia.is:6969/announce"
  ].map(t => `&tr=${encodeURIComponent(t)}`).join("");

  const title = langRaw
    ? `Primer Latino ${manualQuality} · ${langRaw} [P2P - VPN RECOMENDADA]`
    : `Primer Latino ${manualQuality} [P2P - VPN RECOMENDADA]`;

  // MEJOR FORMA: Stremio prefiere infoHash + type: "torrent"
  return [{
    title: title.trim(),
    infoHash: infoHash.toUpperCase(),  // <-- Clave para mejor soporte
    // fileIdx: 0,  // <-- Descomenta si quieres forzar el archivo principal (útil si el torrent tiene varios)
    // sources: trackers.split("&tr=").slice(1).map(t => "udp://" + t)  // Opcional
  }];
};

module.exports = { getStream };