// Testes de ponta a ponta da API. Rodar com: npm test
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vz-test-'));
process.env.ADMIN_EMAILS = 'dona@teste.com,socia@teste.com';
process.env.ADMIN_HOST = 'adm.teste.com';
process.env.PUBLIC_URL = 'http://localhost';
delete process.env.MP_ACCESS_TOKEN;
const app = require('../server');
const { crc16, pixPayload } = require('../lib/pix');

let base, server;
test.before(() => new Promise(r => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; r(); }); }));
test.after(() => server.close());

function client() {
  let cookie = '';
  return async (method, url, body, headers = {}) => {
    const isBuf = Buffer.isBuffer(body);
    const r = await fetch(base + url, { method, redirect: 'manual', headers: { ...(body && !isBuf ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: isBuf ? body : body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch (e) {}
    return { status: r.status, json, text, headers: r.headers };
  };
}
const state = (n, extra = {}) => ({ v: 4, store: { name: 'Loja Teste', phone: '5511999999999', pixKey: 'loja@teste.com', pixName: 'Loja Teste', pixCity: 'São Paulo', ...extra },
  colors: {}, links: [], cats: ['A'], catImgs: {}, testimonials: [], products: Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `Produto ${i + 1}`, price: 10, active: true, media: [] })) });
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test('Pix: CRC16 e código copia e cola', () => {
  assert.strictEqual(crc16('123456789'), '29B1');
  const code = pixPayload({ key: 'loja@teste.com', name: 'Loja Ação', city: 'São Paulo', amount: 49.9 });
  assert.match(code, /^000201/); assert.match(code, /br\.gov\.bcb\.pix/); assert.match(code, /540549\.90/); assert.match(code, /5909Loja Acao/);
  assert.strictEqual(code.slice(-4), crc16(code.slice(0, -4)));
});

test('fluxo completo da lojista', async () => {
  const c = client();
  let r = await c('POST', '/api/signup', { name: 'Ana', storeName: 'Ateliê da Ana', email: 'ana@teste.com', password: 'curta', terms: true });
  assert.strictEqual(r.status, 400);
  r = await c('POST', '/api/signup', { name: 'Ana', storeName: 'Ateliê da Ana', email: 'ana@teste.com', password: 'senha-forte', terms: false });
  assert.strictEqual(r.status, 400);
  r = await c('POST', '/api/signup', { name: 'Ana', storeName: 'Ateliê da Ana', email: 'ana@teste.com', password: 'senha-forte', terms: true });
  assert.strictEqual(r.status, 200);
  r = await c('GET', '/api/me');
  assert.strictEqual(r.json.store.slug, 'atelie-da-ana'); assert.strictEqual(r.json.store.plan, 'expired');
  // sem teste grátis: com a cobrança ligada, a vitrine só entra no ar depois de pagar
  r = await client()('GET', '/atelie-da-ana'); assert.strictEqual(r.status, 402);
  r = await c('POST', '/api/billing/checkout'); assert.strictEqual(r.status, 200); assert.strictEqual(r.json.simulated, true); assert.strictEqual(r.json.store.plan, 'pro'); assert.strictEqual(r.json.store.proPrice, 47);

  // vitrine sem dados mostra "em preparação"
  r = await c('GET', '/atelie-da-ana'); assert.strictEqual(r.status, 200); assert.match(r.text, /"state":null/);

  // painel abre com os dados da conta
  r = await c('GET', '/painel'); assert.strictEqual(r.status, 200); assert.match(r.text, /"mode":"panel"/);

  // salvar: imagem em data: vira arquivo no servidor
  const st = state(3, { bannerImg: 'data:image/png;base64,' + PNG.toString('base64') });
  r = await c('PUT', '/api/store', { state: st }); assert.strictEqual(r.status, 200);
  assert.match(r.json.state.store.bannerImg, /^\/u\/\d+-[0-9a-f]{16}\.png$/);
  r = await c('GET', r.json.state.store.bannerImg); assert.strictEqual(r.status, 200);

  // envio de foto
  r = await c('POST', '/api/media', PNG, { 'Content-Type': 'image/png' }); assert.strictEqual(r.status, 200); assert.strictEqual(r.json.type, 'img');
  r = await c('POST', '/api/media', Buffer.from('x'), { 'Content-Type': 'application/pdf' }); assert.notStrictEqual(r.status, 200);

  // vitrine pública com dados, sem cookie
  const pub = client();
  r = await pub('GET', '/atelie-da-ana'); assert.match(r.text, /"mode":"store"/); assert.match(r.text, /<title>Loja Teste<\/title>/);
  assert.doesNotMatch(r.text, /"mode":"panel"/);
  assert.match(r.headers.get('content-security-policy'), /script-src 'nonce-/); assert.match(r.text, /<script nonce="/);

  // link perigoso no produto é removido
  const bad = state(1); bad.products[0].link = 'javascript:alert(1)';
  r = await c('PUT', '/api/store', { state: bad }); assert.strictEqual(r.json.state.products[0].link, '');
  r = await c('PUT', '/api/store', { state: st }); assert.strictEqual(r.status, 200);

  assert.strictEqual((r.text.match(/"name":"Produto \d"/g) || []).length, 3);

  // link: reservado, inválido e válido
  r = await c('PUT', '/api/slug', { slug: 'admin' }); assert.strictEqual(r.status, 400);
  r = await c('PUT', '/api/slug', { slug: 'ana-modas' }); assert.strictEqual(r.status, 200);
  r = await pub('GET', '/ana-modas'); assert.strictEqual(r.status, 200);
  r = await pub('GET', '/atelie-da-ana'); assert.strictEqual(r.status, 404);

  // Pix com valor
  r = await pub('GET', '/api/pix?s=ana-modas&v=59.80'); assert.strictEqual(r.status, 200); assert.match(r.json.code, /540559\.80/); assert.match(r.json.svg, /^<svg/);

  // métricas
  for (const t of ['view', 'view', 'pview', 'click', 'order', 'hack']) await pub('POST', '/api/e', Buffer.from(JSON.stringify({ s: 'ana-modas', t, p: t === 'view' ? '' : 2 })), { 'Content-Type': 'text/plain' });
  r = await c('GET', '/api/stats?days=7');
  assert.deepStrictEqual(r.json.totals, { view: 2, pview: 1, click: 1, order: 1 }); assert.strictEqual(r.json.top[0].id, '2'); assert.strictEqual(r.json.series.length, 7);


  // domínio próprio (Pro) e acesso pelo domínio
  r = await c('PUT', '/api/domain', { domain: 'https://www.anamodas.com.br/' }); assert.strictEqual(r.status, 200); assert.strictEqual(r.json.store.customDomain, 'anamodas.com.br');
  r = await pub('GET', '/', null, { 'X-Forwarded-Host': 'www.anamodas.com.br' }); assert.match(r.text, /"slug":"ana-modas"/);

  // painel da dona: bloqueado para lojista
  r = await c('GET', '/api/admin/overview'); assert.strictEqual(r.status, 403);

  // senha errada
  const other = client();
  r = await other('POST', '/api/login', { email: 'ana@teste.com', password: 'errada123' }); assert.strictEqual(r.status, 401);
  r = await other('POST', '/api/login', { email: 'ana@teste.com', password: 'senha-forte' }); assert.strictEqual(r.status, 200);
});

test('painel da dona da plataforma', async () => {
  const dona = client();
  await dona('POST', '/api/signup', { name: 'Dona', storeName: 'Loja da Dona', email: 'dona@teste.com', password: 'senha-forte', terms: true });
  let r = await dona('GET', '/api/admin/overview'); assert.strictEqual(r.status, 200);
  const ana = r.json.stores.find(s => s.slug === 'ana-modas'); assert.ok(ana); assert.strictEqual(ana.plan, 'pro');
  assert.ok(r.json.metrics.mrr > 0); assert.strictEqual(r.json.payments.length, 1);

  // encerrar acesso: vitrine e domínio saem do ar; liberar 30 dias volta
  r = await dona('POST', `/api/admin/stores/${ana.id}`, { action: 'expire' }); assert.strictEqual(r.status, 200);
  const pub = client();
  r = await pub('GET', '/ana-modas'); assert.strictEqual(r.status, 402); assert.doesNotMatch(r.text, /Produto 1/);
  r = await pub('GET', '/', null, { 'X-Forwarded-Host': 'anamodas.com.br' }); assert.strictEqual(r.status, 402);
  r = await dona('POST', `/api/admin/stores/${ana.id}`, { action: 'givePro', days: 30 }); assert.strictEqual(r.status, 200);

  // bloquear tira a vitrine do ar
  r = await dona('POST', `/api/admin/stores/${ana.id}`, { action: 'block', reason: 'teste' }); assert.strictEqual(r.status, 200);
  r = await pub('GET', '/ana-modas'); assert.strictEqual(r.status, 403);
  await dona('POST', `/api/admin/stores/${ana.id}`, { action: 'unblock' });
  r = await pub('GET', '/ana-modas'); assert.strictEqual(r.status, 200);

  // entrada separada da administração
  const anon = client();
  r = await anon('GET', '/admin'); assert.strictEqual(r.status, 200); assert.match(r.text, /Administração da plataforma/);
  r = await anon('POST', '/api/admin/setup', { name: 'X', email: 'ana@teste.com', password: 'senha-muito-forte' }); assert.strictEqual(r.status, 403);
  r = await anon('POST', '/api/admin/setup', { name: 'Dona', email: 'dona@teste.com', password: 'senha-muito-forte' }); assert.strictEqual(r.status, 409);
  r = await anon('POST', '/api/login', { email: 'ana@teste.com', password: 'senha-forte', admin: true }); assert.strictEqual(r.status, 403);
  r = await anon('GET', '/api/admin/overview'); assert.notStrictEqual(r.status, 200);
  r = await anon('POST', '/api/login', { email: 'dona@teste.com', password: 'senha-forte', admin: true }); assert.strictEqual(r.json.redirect, '/admin');
  r = await anon('GET', '/admin'); assert.match(r.text, /id="brand"/);

  // senha nova gerada pela dona
  r = await dona('POST', `/api/admin/stores/${ana.id}`, { action: 'resetPassword' }); assert.ok(r.json.tempPassword);
  const a = client();
  r = await a('POST', '/api/login', { email: 'ana@teste.com', password: r.json.tempPassword }); assert.strictEqual(r.status, 200);
  // link de senha nova gerado pela administração
  r = await dona('POST', `/api/admin/stores/${ana.id}`, { action: 'resetLink' }); const tk = new URL(r.json.link).searchParams.get('t'); assert.ok(tk);
  const lojista = client();
  r = await lojista('POST', '/api/password/reset', { token: tk, password: 'curta' }); assert.strictEqual(r.status, 400);
  r = await lojista('POST', '/api/password/reset', { token: tk, password: 'nova-senha-123' }); assert.strictEqual(r.status, 200); assert.strictEqual(r.json.redirect, '/painel');
  r = await lojista('GET', '/api/me'); assert.strictEqual(r.json.store.slug, 'ana-modas');
  r = await client()('POST', '/api/password/reset', { token: tk, password: 'outra-senha-123' }); assert.strictEqual(r.status, 400); // uso único
  r = await client()('POST', '/api/login', { email: 'ana@teste.com', password: 'nova-senha-123' }); assert.strictEqual(r.status, 200);
  // esqueci minha senha: mesma resposta com ou sem conta
  r = await client()('POST', '/api/password/forgot', { email: 'ninguem@teste.com' }); assert.strictEqual(r.status, 200); assert.strictEqual(r.json.ok, true);
  r = await client()('GET', '/esqueci'); assert.match(r.text, /Esqueceu a senha/);
  r = await client()('GET', '/manifest.webmanifest'); assert.strictEqual(JSON.parse(r.text).start_url, '/painel');
});

test('primeiro acesso da administração, sem loja, e endereço só da administração', async () => {
  const c = client();
  let r = await c('POST', '/api/admin/setup', { name: 'Sócia', email: 'socia@teste.com', password: 'curta' }); assert.strictEqual(r.status, 400);
  r = await c('POST', '/api/admin/setup', { name: 'Sócia', email: 'socia@teste.com', password: 'senha-muito-forte' }); assert.strictEqual(r.status, 200);
  r = await c('GET', '/api/admin/overview'); assert.strictEqual(r.status, 200);
  r = await c('GET', '/painel'); assert.strictEqual(r.headers.get('location'), '/admin');
  r = await c('GET', '/', null, { 'X-Forwarded-Host': 'adm.teste.com' }); assert.match(r.text, /id="brand"/);
  r = await c('GET', '/sair?para=admin'); assert.strictEqual(r.headers.get('location'), '/admin');
  r = await client()('GET', '/', null, { 'X-Forwarded-Host': 'adm.teste.com' }); assert.match(r.text, /Primeiro acesso/);
});

test('páginas públicas da plataforma', async () => {
  const c = client();
  for (const p of ['/', '/termos', '/privacidade', '/entrar', '/cadastro']) { const r = await c('GET', p); assert.strictEqual(r.status, 200, p); }
  let r = await c('GET', '/painel'); assert.strictEqual(r.status, 302);
  r = await c('GET', '/nao-existe'); assert.strictEqual(r.status, 404);
});
