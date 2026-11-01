// Assinatura pela Kiwify: o aviso assinado libera, renova e tira do ar a loja do mesmo e-mail
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const os = require('os');
const fs = require('fs');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vz-kw-'));
process.env.PUBLIC_URL = 'http://localhost';
process.env.KIWIFY_TOKEN = 'token-teste';
process.env.KIWIFY_CHECKOUT_URL = 'https://pay.kiwify.com.br/teste';
delete process.env.MP_ACCESS_TOKEN;
const app = require('../server');

let base, server;
test.before(() => new Promise(r => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; r(); }); }));
test.after(() => server.close());

const hook = (body, sig) => {
  const raw = JSON.stringify(body);
  sig = sig || crypto.createHmac('sha1', 'token-teste').update(raw).digest('hex');
  return fetch(`${base}/api/webhooks/kiwify?signature=${sig}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: raw }).then(r => r.status);
};
async function signup(email) {
  const r = await fetch(base + '/api/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Ana', storeName: 'Loja ' + email, email, password: '1234', terms: true }) });
  const cookie = r.headers.get('set-cookie').split(';')[0];
  const call = (method, url) => fetch(base + url, { method, headers: { Cookie: cookie } }).then(async x => ({ status: x.status, json: await x.json().catch(() => null) }));
  return { call, plan: async () => (await call('GET', '/api/me')).json };
}
const next = new Date(Date.now() + 30 * 864e5).toISOString();
const paid = (email, order) => ({ order_id: order, order_status: 'paid', webhook_event_type: 'order_approved', subscription_id: 'sub-' + order, Customer: { email }, Subscription: { status: 'active', next_payment: next } });

test('Kiwify: checkout, aviso assinado, renovação, atraso, cancelamento e reembolso', async () => {
  const ana = await signup('ana@kw.com');
  const db = require('../lib/db').db;
  const st = () => db.prepare("SELECT s.* FROM stores s JOIN users u ON u.id = s.user_id WHERE u.email = 'ana@kw.com'").get();
  assert.ok(!(st().pro_until > Date.now()), 'loja nova começa sem assinatura');
  const co = await ana.call('POST', '/api/billing/checkout');
  assert.match(co.json.url, /^https:\/\/pay\.kiwify\.com\.br\/teste\?email=ana%40kw\.com/);

  assert.strictEqual(await hook(paid('ana@kw.com', 'o1'), 'f'.repeat(40)), 401, 'assinatura errada não libera');
  assert.ok(!(st().pro_until > Date.now()));
  assert.strictEqual(await hook(paid('ANA@kw.com', 'o1')), 200);
  assert.ok(st().pro_until > Date.now() + 29 * 864e5, 'liberada até a próxima cobrança');
  assert.strictEqual(st().mp_preapproval, 'kiwify:sub-o1');

  await hook({ order_id: 'o2', order_status: 'refused', webhook_event_type: 'subscription_late', Customer: { email: 'ana@kw.com' } });
  assert.strictEqual(db.prepare('SELECT status FROM payments WHERE store_id = ? ORDER BY id DESC').get(st().id).status, 'rejected');
  assert.strictEqual((await ana.call('POST', '/api/billing/cancel')).status, 400, 'cancelamento é pela Kiwify');
  await hook({ order_id: 'o3', order_status: 'paid', webhook_event_type: 'subscription_canceled', Customer: { email: 'ana@kw.com' }, Subscription: { status: 'canceled' } });
  assert.strictEqual(st().mp_preapproval, null); assert.ok(st().pro_until > Date.now(), 'cancelada continua no ar até o fim do período');
  await hook({ order_id: 'o4', order_status: 'refunded', webhook_event_type: 'order_refunded', Customer: { email: 'ana@kw.com' } });
  assert.ok(st().pro_until <= Date.now(), 'reembolso tira do ar');
});

test('Kiwify: compra antes de criar a conta libera quando a conta é criada', async () => {
  assert.strictEqual(await hook(paid('bia@kw.com', 'o9')), 200);
  await signup('bia@kw.com');
  const s = require('../lib/db').db.prepare("SELECT s.* FROM stores s JOIN users u ON u.id = s.user_id WHERE u.email = 'bia@kw.com'").get();
  assert.ok(s.pro_until > Date.now() + 29 * 864e5);
});
