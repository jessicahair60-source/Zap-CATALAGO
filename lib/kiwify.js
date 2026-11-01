// Kiwify: a lojista assina pelo checkout da Kiwify e o aviso (webhook) libera a loja pelo e-mail da compra.
// Guia em KIWIFY.md.
const crypto = require('crypto');

const token = () => process.env.KIWIFY_TOKEN || '';
const checkoutUrl = (plan) => (plan === 'anual' ? process.env.KIWIFY_CHECKOUT_ANUAL : process.env.KIWIFY_CHECKOUT_URL) || '';
const enabled = () => !!token();

// Link do checkout já com o e-mail e o nome da conta, para a compra cair na loja certa
function checkout({ email, name, plan }) {
  const u = new URL(checkoutUrl(plan));
  if (email) u.searchParams.set('email', email);
  if (name) u.searchParams.set('name', name);
  return u.toString();
}

// A Kiwify manda ?signature= com o HMAC-SHA1 do corpo, usando o token do webhook
function validSignature(raw, sig) {
  const h = crypto.createHmac('sha1', token()).update(raw).digest('hex');
  sig = String(sig || '').toLowerCase();
  return sig.length === h.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(h));
}

// Lê o aviso e diz o que fazer com a loja
function parse(body) {
  const c = body.Customer || body.customer || {};
  const sub = body.Subscription || body.subscription || {};
  const next = Date.parse(sub.next_payment || '');
  return {
    event: String(body.webhook_event_type || ''),
    status: String(body.order_status || ''),
    email: String(c.email || '').trim().toLowerCase(),
    name: String(c.full_name || c.first_name || c.name || ''),
    orderId: String(body.order_id || ''),
    subId: String(body.subscription_id || sub.id || ''),
    nextPayment: Number.isFinite(next) ? next : 0,
    yearly: /year|annual|anual/i.test(String((sub.plan && sub.plan.frequency) || '') + ' ' + String((sub.plan && sub.plan.name) || ''))
  };
}

module.exports = { enabled, checkoutUrl, checkout, validSignature, parse };
