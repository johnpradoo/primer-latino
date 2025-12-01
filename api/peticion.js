import nodemailer from "nodemailer";
import admin from "firebase-admin";

export const config = {
  api: {
    bodyParser: true,
  },
};

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

    // Guardar en Firestore
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

    // Enviar correo al admin
  if (correo) {
    const transporter = nodemailer.createTransport({
      host: "mail.privateemail.com",
      port: 465,
      secure: true,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });

    await transporter.sendMail({
      from: `"Primer Latino" <admin@primerlatino.com>`,
      to: "admin@primerlatino.com",
      subject: "Nueva petición recibida",
      html: `
        <h2>Nueva petición recibida</h2>
        <p><strong>Título:</strong> ${titulo}</p>
        <p><strong>Tipo:</strong> ${tipo}</p>
        <p><strong>Año:</strong> ${anio || "—"}</p>
        <p><strong>ID TMDB:</strong> ${tmdb || "—"}</p>
        <p><strong>Magnet:</strong> ${magnet || "—"}</p>
        <p><strong>Correo del usuario:</strong> ${correo || "No dejó correo"}</p>
      `
    });

    return res.status(200).json({ ok: true, msg: "Petición guardada" });

  } catch (err) {
    console.error("Error API:", err);
    return res.status(500).json({ error: "Error interno" });
  }
}
