import admin from "firebase-admin";

// Inicializar Firebase Admin una sola vez
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      project_id: process.env.FIREBASE_PROJECT_ID,
      private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
      client_email: process.env.FIREBASE_CLIENT_EMAIL
    })
  });
}

const db = admin.firestore();

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  try {
    const { titulo, tipo, anio, tmdb, magnet, correo } = req.body;

    if (!titulo || !tipo) {
      return res.status(400).json({ error: "Faltan campos obligatorios" });
    }

    // Guardar en Firestore SOLO. YA NO SE ENVÍA CORREO.
    await db.collection("peticiones").add({
      titulo,
      tipo,
      anio: anio || null,
      tmdb: tmdb || null,
      magnet: magnet || null,
      correo: correo || null,
      fecha: new Date(),
      estado: "pendiente"
    });

    return res.status(200).json({ ok: true, msg: "Petición guardada" });

  } catch (err) {
    console.error("Error API:", err);
    return res.status(500).json({ error: "Error interno" });
  }
}