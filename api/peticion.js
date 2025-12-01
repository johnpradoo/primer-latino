import admin from "firebase-admin";

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
        return res.status(400).json({ error: "Faltan datos" });
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
      const snap = await db.collection("peticiones").orderBy("fecha", "desc").get();
      const data = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      return res.status(200).json(data);
    }

    if (req.method === "PUT") {
      const { id, estado } = req.body;

      if (!id || !estado) {
        return res.status(400).json({ error: "Datos incompletos" });
      }

      await db.collection("peticiones").doc(id).update({ estado });

      return res.status(200).json({ ok: true });
    }

    if (req.method === "DELETE") {
      const { id } = req.body;

      if (!id) return res.status(400).json({ error: "ID requerido" });

      await db.collection("peticiones").doc(id).delete();

      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "Método no permitido" });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Error interno" });
  }
}