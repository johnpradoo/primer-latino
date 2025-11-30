import nodemailer from "nodemailer";

export default async function handler(req, res) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Método no permitido" });

  const { title, type, year, emailUser } = req.body;

  if (!emailUser)
    return res.status(200).json({ ok: true, msg: "No tiene correo" });

  const transporter = nodemailer.createTransport({
    host: "mail.privateemail.com",
    port: 465,
    secure: true,
    auth: {
      user: "admin@primerlatino.com",
      pass: process.env.PRIMERLATINO_EMAIL_PASS
    }
  });

  const html = `
  <div style="font-family:system-ui;padding:20px;background:#fdfdfd;border-radius:12px;max-width:600px;margin:auto;">
    <h1 style="color:#ff2e7f;text-align:center;">¡Buenas noticias!</h1>
    <p style="text-align:center;font-size:1.1rem;">Tu petición ya está disponible en 🍿 <strong>Primer Latino</strong></p>

    <h2 style="color:#333;text-align:center;margin:30px 0;">${title} (${year}) – ${type}</h2>

    <p style="text-align:center;color:#555;margin-top:40px;">
      Gracias por usar PrimerLatino ❤️
    </p>

    <hr style="margin:40px 0;border:none;border-top:1px solid #eee;">

    <p style="text-align:center;color:#888;">
      Hecho por @johnpradoo<br>
      <strong>Primer Latino</strong>
    </p>
  </div>
  `;

  try {
    await transporter.sendMail({
      from: "Primer Latino <admin@primerlatino.com>",
      to: emailUser,
      subject: "🎬 Tu solicitud está lista",
      html
    });

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.log(e);
    return res.status(500).json({ error: "Error enviando correo" });
  }
}
