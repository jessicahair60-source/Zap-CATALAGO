// Assinatura mensal pelo Mercado Pago (API de "preapproval").
// Sem MP_ACCESS_TOKEN o sistema roda em modo de teste: o pagamento é simulado.
const API = 'https://api.mercadopago.com';
const token = () => process.env.MP_ACCESS_TOKEN || '';
const enabled = () => !!token();

async function call(method, path, body) {
  const r = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Mercado Pago ${r.status}: ${data.message || JSON.stringify(data).slice(0, 200)}`);
  return data;
}

// Cria a assinatura e devolve o link onde a lojista paga (cartão, saldo MP)
function createSubscription({ storeId, email, price, reason, backUrl }) {
  return call('POST', '/preapproval', {
    reason,
    external_reference: `store:${storeId}`,
    payer_email: email,
    back_url: backUrl,
    auto_recurring: { frequency: 1, frequency_type: 'months', transaction_amount: price, currency_id: 'BRL' },
    status: 'pending'
  });
}

const getSubscription = id => call('GET', `/preapproval/${encodeURIComponent(id)}`);
const getAuthorizedPayment = id => call('GET', `/authorized_payments/${encodeURIComponent(id)}`);
const cancelSubscription = id => call('PUT', `/preapproval/${encodeURIComponent(id)}`, { status: 'cancelled' });

module.exports = { enabled, createSubscription, getSubscription, getAuthorizedPayment, cancelSubscription };
