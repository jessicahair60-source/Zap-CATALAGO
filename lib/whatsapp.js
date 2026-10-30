// WhatsApp oficial da Meta (Cloud API): receber mensagens do robô e responder.
// Funciona também com número em coexistência (o mesmo número no app WhatsApp Business).
const crypto = require('crypto');

const VER = () => process.env.WA_GRAPH_VERSION || 'v21.0';
const token = () => process.env.WA_TOKEN || '';
const phoneId = () => process.env.WA_PHONE_ID || '';
const enabled = () => !!(token() && phoneId());
const number = () => String(process.env.WA_NUMBER || '').replace(/\D/g, '');

async function graph(method, path, body) {
  const r = await fetch(`https://graph.facebook.com/${VER()}/${path}`, {
    method,
    headers: { Authorization: `Bearer ${token()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`WhatsApp ${r.status}: ${(data.error && data.error.message) || JSON.stringify(data).slice(0, 200)}`);
  return data;
}

// Resposta de texto dentro da janela de 24 horas aberta pela mensagem da lojista
function sendText(to, text) {
  return graph('POST', `${phoneId()}/messages`, { messaging_product: 'whatsapp', to, type: 'text', text: { body: text.slice(0, 4000), preview_url: false } });
}

// Baixa a foto ou o vídeo que a lojista mandou
async function download(mediaId) {
  const info = await graph('GET', encodeURIComponent(mediaId));
  const r = await fetch(info.url, { headers: { Authorization: `Bearer ${token()}` } });
  if (!r.ok) throw new Error(`WhatsApp mídia ${r.status}`);
  return { buf: Buffer.from(await r.arrayBuffer()), mime: String(info.mime_type || r.headers.get('content-type') || '').split(';')[0].toLowerCase() };
}

// Confere a assinatura X-Hub-Signature-256 com a chave secreta do app da Meta
function validSignature(raw, header) {
  const secret = process.env.WA_APP_SECRET;
  if (!secret) return true;
  const sig = String(header || '').replace(/^sha256=/, '');
  const h = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  return sig.length === h.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(h));
}

module.exports = { enabled, number, sendText, download, validSignature };
