// E-mail (SMTP) para o "esqueci minha senha". Funciona com o e-mail da Hostinger, Gmail, Brevo etc.
const nodemailer = require('nodemailer');

let tx = null;
const enabled = () => !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
function transport() {
  if (!tx) {
    const port = parseInt(process.env.SMTP_PORT || '465', 10);
    tx = nodemailer.createTransport({ host: process.env.SMTP_HOST, port, secure: port === 465, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
  }
  return tx;
}
async function send({ to, subject, text, html }) {
  return transport().sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to, subject, text, html });
}

module.exports = { enabled, send };
