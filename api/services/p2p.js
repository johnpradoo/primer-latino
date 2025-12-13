// services/p2p.js → Streams P2P directos (magnet) con trackers y título personalizado
const getStream = async (token, infoHash, item) => {
  // token no se usa en P2P, pero lo mantenemos por compatibilidad con la interfaz
  if (!infoHash) return [];

  // Calidad manual (soporte array o string separado por |)
  let qualities = item.quality || item.q || [];
  qualities = Array.isArray(qualities) ? qualities : (qualities ? qualities.split("|").map(q => q.trim()) : []);
  const manualQuality = qualities[0] || "Unknown"; // S

  // Idioma (soporte language o l)
  const langRaw = (item.language || item.l || "").replace(/\|/g, "·").trim();

  // Trackers populares y confiables para maximizar seeders
  const trackers = [
    "udp://tracker.opentrackr.org:1337/announce",
    "udp://open.tracker.cl:1337/announce",
    "udp://tracker.openbittorrent.com:80/announce",
    "udp://exodus.desync.com:6969/announce",
    "udp://tracker.torrent.eu.org:451/announce",
    "udp://tracker.moeking.me:6969/announce",
    "udp://open.stealth.si:80/announce"
  ].map(t => `&tr=${encodeURIComponent(t)}`).join("");

  const title = langRaw
    ? `Primer Latino ${manualQuality} · ${langRaw} [P2P - VPN RECOMENDADA]`
    : `Primer Latino ${manualQuality} [P2P - VPN RECOMENDADA]`;

  const magnet = `magnet:?xt=urn:btih:${infoHash.toUpperCase()}${trackers}`;

  return [{
    title: title.trim(),
    infoHash: infoHash.toUpperCase(),
    url: magnet
  }];
};

module.exports = { getStream };