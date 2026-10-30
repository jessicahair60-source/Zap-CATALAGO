// Testes do robô do WhatsApp (cadastro de produtos por mensagem). Rodar com: npm test
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vz-wa-'));
process.env.PUBLIC_URL = 'http://localhost';
process.env.WA_APP_SECRET = 'segredo-teste';
process.env.WA_VERIFY_TOKEN = 'verifica';
process.env.WA_NUMBER = '5511900000000';
delete process.env.MP_ACCESS_TOKEN;
const wa = require('../lib/whatsapp');
const { parseProduct, parsePrice } = require('../lib/wabot');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const sent = [];
wa.enabled = () => true;
wa.sendText = async (to, text) => { sent.push({ to, text }); };
wa.download = async id => ({ buf: Buffer.concat([PNG, Buffer.from(id)]), mime: 'image/png' });
const app = require('../server');

let base, server;
test.before(() => new Promise(r => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; r(); }); }));
test.after(() => server.close());

function client() {
  let cookie = '';
  return async (method, url, body) => {
    const r = await fetch(base + url, { method, redirect: 'manual', headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch (e) {}
    return { status: r.status, json, text };
  };
}
let n = 0;
async function hook(from, msg, secret = 'segredo-teste') {
  const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: { messages: [{ from, id: 'wamid.' + (++n), timestamp: '1', ...msg }] } }] }] });
  const sig = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
  const r = await fetch(base + '/api/webhooks/wa', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sig }, body });
  await new Promise(res => setTimeout(res, 60));
  return r.status;
}
const last = () => sent[sent.length - 1].text;

test('lê o modelo de texto', () => {
  assert.strictEqual(parsePrice('R$ 1.389,90'), 1389.9); assert.strictEqual(parsePrice('389.90'), 389.9); assert.strictEqual(parsePrice('1.200'), 1200); assert.strictEqual(parsePrice('consultar'), 0);
  const r = parseProduct('*Nome:* Peruca Lace\nPreço: 389,90\nPreço antigo: 450\nCategoria: Perucas\nTamanhos: 50 cm, 60 cm\nCor: Castanho\nEstoque: 5\nComprimento: 60 cm\nDescrição: Cabelo humano\nPronta para usar');
  assert.ok(r.ok);
  assert.deepStrictEqual(r.product.sizes, ['50 cm', '60 cm']); assert.strictEqual(r.product.old, 450); assert.strictEqual(r.product.stock, 5); assert.strictEqual(r.product.track, true);
  assert.deepStrictEqual(r.product.specs, [['Cor', 'Castanho'], ['Comprimento', '60 cm']]); assert.strictEqual(r.product.desc, 'Cabelo humano\nPronta para usar');
  assert.deepStrictEqual(parseProduct('Nome: X').missing, ['Preço']);
  assert.strictEqual(parseProduct('oi tudo bem').keyed, false);
});

test('robô: ligar o número e cadastrar produtos', async () => {
  const c = client();
  await c('POST', '/api/signup', { name: 'Ana', storeName: 'Ana Perucas', email: 'ana@wa.com', password: 'senha-forte', terms: true });
  const st = { v: 4, store: { name: 'Ana Perucas' }, colors: {}, links: [], cats: ['Novidades'], catImgs: {}, testimonials: [], products: [{ id: 1, name: 'Antigo', price: 10, active: true, media: [] }] };
  let r = await c('PUT', '/api/store', { state: st }); const base0 = r.json.savedAt; assert.ok(base0);

  // verificação do webhook pela Meta
  r = await fetch(base + '/api/webhooks/wa?hub.mode=subscribe&hub.verify_token=verifica&hub.challenge=123'); assert.strictEqual(await r.text(), '123');
  r = await fetch(base + '/api/webhooks/wa?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=123'); assert.strictEqual(r.status, 403);
  assert.strictEqual(await hook('5511988887777', { type: 'text', text: { body: 'oi' } }, 'outro-segredo'), 401);

  // número desconhecido
  await hook('5511988887777', { type: 'text', text: { body: 'oi' } }); assert.match(last(), /ainda não está ligado/);

  // código do painel liga o número
  r = await c('POST', '/api/wa/code'); const code = r.json.code; assert.match(code, /^\d{6}$/); assert.strictEqual(r.json.number, '5511900000000');
  await hook('5511988887777', { type: 'text', text: { body: `ZAP-${code}` } }); assert.match(last(), /Ana Perucas/);
  r = await c('GET', '/api/wa'); assert.strictEqual(r.json.phones[0].phone, '5511988887777'); assert.strictEqual(r.json.code, null);
  await hook('5511977776666', { type: 'text', text: { body: `ZAP-${code}` } }); assert.match(last(), /não vale mais/);

  // foto com legenda no modelo
  await hook('5511988887777', { type: 'image', image: { id: 'm1', caption: 'Nome: Peruca Lace\nPreço: 389,90\nCategoria: Perucas' } });
  assert.match(last(), /Cadastrado/); assert.match(last(), /R\$ 389,90/);
  // foto sem legenda logo depois: entra no mesmo produto
  await hook('5511988887777', { type: 'image', image: { id: 'm2' } });
  // fotos primeiro, texto depois
  await hook('5511988887777', { type: 'text', text: { body: 'Nome: Sem preço' } }); assert.match(last(), /Faltou: Preço/);

  r = await c('GET', `/api/wa/new?since=${base0}`);
  assert.strictEqual(r.json.products.length, 1);
  const p = r.json.products[0]; assert.strictEqual(p.name, 'Peruca Lace'); assert.strictEqual(p.media.length, 2); assert.ok(r.json.cats.includes('Perucas'));
  r = await c('GET', '/u/' + p.media[0].id); assert.strictEqual(r.status, 200);

  // o painel salva com a versão antiga (sem o produto do robô): o produto não some
  r = await c('PUT', '/api/store', { state: st, base: base0 });
  assert.deepStrictEqual(r.json.state.products.map(x => x.name), ['Peruca Lace', 'Antigo']);
  // depois que o painel conhece o produto, apagar funciona
  r = await c('PUT', '/api/store', { state: st, base: r.json.savedAt });
  assert.deepStrictEqual(r.json.state.products.map(x => x.name), ['Antigo']);

  // vitrine pública mostra o produto do robô
  await hook('5511988887777', { type: 'text', text: { body: 'Nome: Lace Lisa\nPreço: consultar' } }); assert.match(last(), /Consulte o valor/);
  r = await client()('GET', '/' + (await c('GET', '/api/me')).json.store.slug); assert.match(r.text, /Lace Lisa/);

  // a mesma mensagem reenviada pela Meta não duplica
  const body = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ from: '5511988887777', id: 'wamid.dup', type: 'text', text: { body: 'Nome: Dup\nPreço: 1' } }] } }] }] });
  const sig = 'sha256=' + crypto.createHmac('sha256', 'segredo-teste').update(body).digest('hex');
  for (let i = 0; i < 2; i++) await fetch(base + '/api/webhooks/wa', { method: 'POST', headers: { 'X-Hub-Signature-256': sig, 'Content-Type': 'application/json' }, body });
  await new Promise(res => setTimeout(res, 60));
  r = await c('GET', '/api/wa/new?since=0'); assert.strictEqual(r.json.products.filter(x => x.name === 'Dup').length, 1);

  // desligar o número
  r = await c('DELETE', '/api/wa/phone/5511988887777'); assert.strictEqual(r.json.phones.length, 0);
  await hook('5511988887777', { type: 'text', text: { body: 'Nome: X\nPreço: 1' } }); assert.match(last(), /ainda não está ligado/);
});
