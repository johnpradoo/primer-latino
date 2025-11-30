import { db } from "../lib/firebaseAdmin.js";

export default async function handler(req, res) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Método no permitido" });

  const data = req.body;

  try {
    await db.collection("requests").add({
      ...data,
      createdAt: Date.now()
    });

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ error: "Error guardando en Firestore" });
  }
}
