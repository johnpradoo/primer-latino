import nodemailer from "nodemailer";
import { db } from "./firebase.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  try {
    const { titulo, tipo, ano, tmdb, magnet, correo } = req.body;

    // Guardar en Firebase
    await db.collection("solicitudes").add({
      titulo,
      tipo,
      ano,
      tmdb,
      magnet,
      correo,
      fecha: new Date()
    });

    // Si el usuario dejó correo, se envía notificación
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
        from: '"Primer Latino" <admin@primerlatino.com>',
        to: correo,
        subject: "Tu solicitud ha sido recibida",
        html: `
          <h2>¡Gracias por tu solicitud!</h2>
          <p>El título <strong>${titulo}</strong> fue recibido correctamente.</p>
          <p>Te notificaremos nuevamente cuando esté disponible 🍿.</p>
        `
      });
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error("Error:", error);
    return res.status(500).json({ error: "Error en el servidor" });
  }
}
