import admin from "firebase-admin";

// Inicializar Firebase Admin una sola vez
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
  });
}

const db = admin.firestore();

export default async function handler(req, res) {
  try {
    if (req.method === "POST") {
      const { nombre, correo, mensaje } = req.body;

      if (!nombre || !correo || !mensaje) {
        return res.status(400).json({ error: "Faltan datos del formulario" });
      }

      await db.collection("peticiones").add({
        nombre,
        correo,
        mensaje,
        estado: "pendiente",
        fecha: new Date().toISOString()
      });

      return res.status(200).json({ ok: true });
    }

    if (req.method === "GET") {
      const snapshot = await db.collection("peticiones").orderBy("fecha", "desc").get();
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      return res.status(200).json(data);
    }

    return res.status(405).json({ error: "Método no permitido" });
  } catch (e) {
    console.error("Error:", e);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
}