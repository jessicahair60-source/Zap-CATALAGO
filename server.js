// Zap Catálogo: servidor da plataforma (vitrines, painel da lojista, painel da dona, assinatura).
require('./lib/env');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const QRCode = require('qrcode');
const { db, DATA_DIR } = require('./lib/db');
const { pixPayload } = require('./lib/pix');
const mp = require('./lib/mercadopago');
const wa = require('./lib/whatsapp');
const { createBot, TEMPLATE: WA_TEMPLATE } = require('./lib/wabot');

const CFG = {
  brand: process.env.BRAND_NAME || 'Zap Catálogo',
  publicUrl: (process.env.PUBLIC_URL || 'http://localhost:3000').replace(/\/$/, ''),
  baseDomain: (process.env.BASE_DOMAIN || '').toLowerCase(),
  proPrice: parseFloat(process.env.PLAN_PRICE || '47.00'),
  trialDays: parseInt(process.env.TRIAL_DAYS || '7', 10),
  adminHost: (process.env.ADMIN_HOST || '').toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, ''),
  admins: (process.env.ADMIN_EMAILS || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean),
  fakePayments: !mp.enabled() && process.env.NODE_ENV !== 'production'
};
const UPLOADS = path.join(DATA_DIR, 'uploads');
const DAY = 86400000;
const now = () => Date.now();
const PUB = path.join(__dirname, 'public');
const RESERVED = new Set(['painel', 'entrar', 'cadastro', 'sair', 'api', 'u', 'admin', 'termos', 'privacidade', 'static', 'assets', 'www', 'app', 'planos', 'ajuda', 'suporte', 'login']);

const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');
app.use((req, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); res.set('Referrer-Policy', 'strict-origin-when-cross-origin'); next(); });

/* ---------- utilidades ---------- */
const slugify = t => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
const validSlug = s => /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/.test(s) && !RESERVED.has(s);
const jsonForScript = o => JSON.stringify(o).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const escHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => new Date().toISOString().slice(0, 10);

function uniqueSlug(base) {
  let s = validSlug(base) ? base : (slugify(base) || 'minha-loja');
  if (s.length < 3) s = s + '-loja';
  if (RESERVED.has(s)) s = s + '-loja';
  let candidate = s, i = 2;
  while (db.prepare('SELECT 1 FROM stores WHERE slug = ?').get(candidate)) candidate = `${s}-${i++}`;
  return candidate;
}

// Situação da assinatura: paga, em teste grátis, ou vencida (vitrine sai do ar até pagar)
function planOf(store) {
  if (store.pro_until && store.pro_until > now()) return 'pro';
  if (store.trial_until && store.trial_until > now()) return 'trial';
  return 'expired';
}
const isPro = store => planOf(store) !== 'expired';

function storeInfo(store) {
  return {
    id: store.id, slug: store.slug, name: store.name, plan: planOf(store), proUntil: store.pro_until, trialUntil: store.trial_until,
    subscribed: !!store.mp_preapproval, customDomain: store.custom_domain, blocked: !!store.blocked, blockedReason: store.blocked_reason,
    publicUrl: publicUrlOf(store), proPrice: CFG.proPrice, brand: CFG.brand, payments: mp.enabled() ? 'mercadopago' : CFG.fakePayments ? 'teste' : 'off', savedAt: store.updated_at
  };
}
function publicUrlOf(store) {
  if (store.custom_domain && isPro(store)) return `https://${store.custom_domain}`;
  if (CFG.baseDomain) return `https://${store.slug}.${CFG.baseDomain}`;
  return `${CFG.publicUrl}/${store.slug}`;
}

/* ---------- sessão ---------- */
function hashPass(p) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(p, salt, 64).toString('hex')}`;
}
function checkPass(p, stored) {
  const [salt, h] = String(stored).split(':');
  if (!salt || !h) return false;
  const a = crypto.scryptSync(p, salt, 64), b = Buffer.from(h, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const cookies = req => Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim().split('=')).filter(x => x[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
function startSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, now() + 30 * DAY);
  res.set('Set-Cookie', `vz=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 86400}${CFG.publicUrl.startsWith('https') ? '; Secure' : ''}`);
}
function currentUser(req) {
  const t = cookies(req).vz;
  if (!t) return null;
  const row = db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > ?').get(t, now());
  return row || null;
}
const isAdmin = u => !!u && CFG.admins.includes(u.email.toLowerCase());
function auth(req, res, next) {
  const u = currentUser(req);
  if (!u) return res.status(401).json({ error: 'Entre na sua conta para continuar.' });
  req.user = u; req.store = db.prepare('SELECT * FROM stores WHERE user_id = ?').get(u.id);
  next();
}
function adminOnly(req, res, next) {
  const u = currentUser(req);
  if (!isAdmin(u)) return res.status(403).json({ error: 'Acesso só para a administração.' });
  req.user = u; next();
}

// Limite simples de tentativas de login por IP (10 a cada 15 minutos)
const tries = new Map();
function tooMany(ip) {
  const t = tries.get(ip) || { n: 0, at: now() };
  if (now() - t.at > 15 * 60000) { t.n = 0; t.at = now(); }
  t.n++; tries.set(ip, t);
  return t.n > 10;
}

/* ---------- arquivos ---------- */
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm' };
function saveFile(storeId, buf, mime) {
  const ext = EXT[mime];
  if (!ext) throw new Error('Formato não aceito. Envie JPG, PNG, WEBP, MP4 ou MOV.');
  const name = `${storeId}-${crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16)}.${ext}`;
  const file = path.join(UPLOADS, name);
  if (!fs.existsSync(file)) fs.writeFileSync(file, buf);
  return name;
}
// Imagens que o painel manda como data: URL (banner, logo, categorias) viram arquivos no servidor
function externalize(storeId, value) {
  if (typeof value === 'string') {
    const m = /^data:([a-z]+\/[a-z0-9.+-]+);base64,(.+)$/i.exec(value);
    if (m && EXT[m[1].toLowerCase()]) return '/u/' + saveFile(storeId, Buffer.from(m[2], 'base64'), m[1].toLowerCase());
    return value;
  }
  if (Array.isArray(value)) return value.map(v => externalize(storeId, v));
  if (value && typeof value === 'object') { const o = {}; for (const k of Object.keys(value)) o[k] = externalize(storeId, value[k]); return o; }
  return value;
}

app.use('/u', express.static(UPLOADS, { maxAge: '30d', immutable: true, fallthrough: false }));
app.use('/static', express.static(path.join(PUB, 'static'), { maxAge: '1h' }));

/* ---------- páginas da vitrine ---------- */
const APP_HTML = () => fs.readFileSync(path.join(PUB, 'app.html'), 'utf8');

// Política de segurança: só roda script com a marca (nonce) desta resposta, o que barra links "javascript:" e scripts injetados
function sendApp(res, html, extraScriptHosts = '') {
  const nonce = crypto.randomBytes(16).toString('base64');
  res.set('Content-Security-Policy', [
    `default-src 'self'`, `script-src 'nonce-${nonce}' ${extraScriptHosts}`.trim(), `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
    `font-src https://fonts.gstatic.com`, `img-src 'self' data: blob: https:`, `media-src 'self' data: blob:`,
    `connect-src 'self' https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com https://connect.facebook.net https://www.facebook.com`,
    `frame-src 'self' https://www.facebook.com`, `object-src 'none'`, `base-uri 'none'`, `form-action 'self'`, `frame-ancestors 'self'`
  ].join('; '));
  res.type('html').send(html.replace(/<script(?=[\s>])/g, `<script nonce="${nonce}"`));
}
// Links de produto só podem ser http(s)
function safeLinks(v, key) {
  if (typeof v === 'string') return (key === 'link' || key === 'url') && v && !/^https?:\/\//i.test(v.trim()) ? '' : v;
  if (Array.isArray(v)) return v.map(x => safeLinks(x));
  if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = safeLinks(v[k], k); return o; }
  return v;
}

function publicState(store) {
  let state = null;
  try { state = JSON.parse(store.state || 'null'); } catch (e) { state = null; }
  if (!state || state.v !== 4) return null; // loja que ainda não abriu o painel
  if (state.store) {
    delete state.store.p2; delete state.store.p3; delete state.store.p4; delete state.store.p5;
  }
  return state;
}

function trackingTags(st) {
  let out = '';
  const px = String(st.metaPixel || '').replace(/\D/g, '');
  const ga = String(st.gaId || '').replace(/[^A-Za-z0-9-]/g, '');
  if (px) out += `<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${px}');fbq('track','PageView');</script>`;
  if (ga) out += `<script async src="https://www.googletagmanager.com/gtag/js?id=${ga}"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${ga}');</script>`;
  return out;
}

function renderStore(res, store) {
  if (store.blocked) return res.status(403).send(simplePage('Loja indisponível', 'Esta vitrine está temporariamente indisponível.'));
  if (!isPro(store)) return res.status(402).send(simplePage(store.name, 'Esta vitrine está indisponível no momento. Volte em breve!'));
  const state = publicState(store);
  const st = (state && state.store) || {};
  const boot = { mode: 'store', state, store: { slug: store.slug, name: store.name, publicUrl: publicUrlOf(store) }, brand: CFG.brand, home: CFG.publicUrl };
  const title = escHtml(st.name || store.name);
  const desc = escHtml(st.bio || `Catálogo de ${store.name}`);
  const img = st.bannerImgM || st.bannerImg || st.logo || '';
  const head = `<title>${title}</title><meta name="description" content="${desc}"><meta property="og:title" content="${title}"><meta property="og:description" content="${desc}">${img && img.startsWith('/u/') ? `<meta property="og:image" content="${CFG.publicUrl}${img}">` : ''}${trackingTags(st)}`;
  const html = APP_HTML().replace('<!--HEAD-->', head).replace('<!--BOOT-->', `<script>window.__BOOT__=${jsonForScript(boot)}</script>`);
  res.set('Cache-Control', 'no-cache');
  sendApp(res, html, 'https://connect.facebook.net https://www.googletagmanager.com');
}

function simplePage(title, text, extra = '') {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escHtml(title)}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,sans-serif;background:#FBF3F5;color:#2A1A22;text-align:center;padding:24px}h1{font-size:22px}p{color:#7a6670}a{color:#B9476F;font-weight:600}</style></head>
<body><main><h1>${escHtml(title)}</h1><p>${escHtml(text)}</p>${extra}</main></body></html>`;
}

// Endereço só da administração (ex.: adm.zapcatalago.com): a página inicial é o painel da dona
app.use((req, res, next) => {
  if (CFG.adminHost && (req.hostname || '').toLowerCase() === CFG.adminHost && req.path === '/') req.url = '/admin';
  next();
});

// Domínio próprio da lojista ou subdomínio (loja.seudominio.com.br) abrem direto a vitrine
app.use((req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/u/') || req.path.startsWith('/static/')) return next();
  const host = (req.hostname || '').toLowerCase();
  let store = null;
  if (host && CFG.baseDomain && host.endsWith('.' + CFG.baseDomain)) {
    const sub = host.slice(0, -(CFG.baseDomain.length + 1));
    if (sub && !RESERVED.has(sub)) store = db.prepare('SELECT * FROM stores WHERE slug = ?').get(sub);
    if (!store && sub && !RESERVED.has(sub)) return res.status(404).send(simplePage('Vitrine não encontrada', 'Confira o endereço digitado.'));
  } else if (host && !host.endsWith(new URL(CFG.publicUrl).hostname) && host !== CFG.baseDomain && host !== 'localhost' && host !== '127.0.0.1') {
    store = db.prepare('SELECT * FROM stores WHERE custom_domain = ?').get(host.replace(/^www\./, ''));
  }
  if (!store) return next();
  if (store.custom_domain && host.replace(/^www\./, '') === store.custom_domain && !isPro(store)) return res.status(402).send(simplePage('Domínio inativo', 'O domínio próprio desta loja está inativo.'));
  if (req.path === '/' || req.path === '') return renderStore(res, store);
  return next();
});

/* ---------- páginas da plataforma ---------- */
const page = name => (req, res) => res.sendFile(path.join(PUB, name));
app.get('/', page('index.html'));
app.get('/termos', page('termos.html'));
app.get('/privacidade', page('privacidade.html'));
app.get(['/entrar', '/cadastro'], (req, res) => currentUser(req) ? res.redirect('/painel') : res.sendFile(path.join(PUB, 'entrar.html')));
app.get('/sair', (req, res) => {
  const t = cookies(req).vz; if (t) db.prepare('DELETE FROM sessions WHERE token = ?').run(t);
  res.set('Set-Cookie', 'vz=; Path=/; Max-Age=0').redirect(req.query.para === 'admin' ? '/admin' : '/entrar');
});
app.get('/painel', (req, res) => {
  const u = currentUser(req);
  if (!u) return res.redirect('/entrar');
  const store = db.prepare('SELECT * FROM stores WHERE user_id = ?').get(u.id);
  if (!store) return res.redirect('/admin');
  let state = null; try { state = JSON.parse(store.state || 'null'); } catch (e) {}
  const boot = { mode: 'panel', state, store: storeInfo(store), user: { name: u.name, email: u.email, admin: isAdmin(u) }, brand: CFG.brand, home: CFG.publicUrl };
  const html = APP_HTML().replace('<!--HEAD-->', `<title>Painel · ${escHtml(store.name)}</title><meta name="robots" content="noindex">`).replace('<!--BOOT-->', `<script>window.__BOOT__=${jsonForScript(boot)}</script>`);
  res.set('Cache-Control', 'no-store');
  sendApp(res, html);
});
app.get('/admin', (req, res) => {
  const u = currentUser(req);
  if (!u) return res.set('Cache-Control', 'no-store').sendFile(path.join(PUB, 'admin-entrar.html'));
  if (!isAdmin(u)) return res.status(403).send(simplePage('Sem acesso', 'Esta área é só da administração da plataforma.', '<p><a href="/sair?para=admin">Entrar com outra conta</a> · <a href="/painel">Ir para o meu painel</a></p>'));
  res.set('Cache-Control', 'no-store').sendFile(path.join(PUB, 'admin.html'));
});

/* ---------- API: conta ---------- */
const jsonBody = express.json({ limit: '25mb' });

app.post('/api/signup', jsonBody, (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 80);
  const storeName = String(req.body.storeName || '').trim().slice(0, 80);
  const email = String(req.body.email || '').trim().toLowerCase();
  const pass = String(req.body.password || '');
  if (!name || !storeName) return res.status(400).json({ error: 'Preencha seu nome e o nome da loja.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'E-mail inválido.' });
  if (pass.length < 8) return res.status(400).json({ error: 'A senha precisa ter pelo menos 8 caracteres.' });
  if (!req.body.terms) return res.status(400).json({ error: 'Para criar a conta, aceite os termos de uso e a política de privacidade.' });
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) return res.status(409).json({ error: 'Já existe uma conta com este e-mail. Tente entrar.' });
  const t = now();
  const tx = db.transaction(() => {
    const u = db.prepare('INSERT INTO users (name, email, pass, created_at) VALUES (?, ?, ?, ?)').run(name, email, hashPass(pass), t);
    db.prepare('INSERT INTO stores (user_id, slug, name, trial_until, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(u.lastInsertRowid, uniqueSlug(slugify(storeName)), storeName, CFG.trialDays > 0 ? t + CFG.trialDays * DAY : null, t, t);
    return u.lastInsertRowid;
  });
  startSession(res, tx());
  res.json({ ok: true, redirect: '/painel' });
});

app.post('/api/login', jsonBody, (req, res) => {
  if (tooMany(req.ip)) return res.status(429).json({ error: 'Muitas tentativas. Espere 15 minutos e tente de novo.' });
  const email = String(req.body.email || '').trim().toLowerCase();
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!u || !checkPass(String(req.body.password || ''), u.pass)) return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
  if (req.body.admin && !isAdmin(u)) return res.status(403).json({ error: 'Esta conta não tem acesso à administração.' });
  startSession(res, u.id);
  if (req.body.admin) return res.json({ ok: true, redirect: '/admin' });
  const hasStore = db.prepare('SELECT 1 FROM stores WHERE user_id = ?').get(u.id);
  res.json({ ok: true, redirect: hasStore ? '/painel' : '/admin' });
});

// Primeiro acesso da dona: cria a senha sem loja, só para e-mails de ADMIN_EMAILS
app.post('/api/admin/setup', jsonBody, (req, res) => {
  if (tooMany(req.ip)) return res.status(429).json({ error: 'Muitas tentativas. Espere 15 minutos e tente de novo.' });
  const name = String(req.body.name || '').trim().slice(0, 80);
  const email = String(req.body.email || '').trim().toLowerCase();
  const pass = String(req.body.password || '');
  if (!name) return res.status(400).json({ error: 'Preencha seu nome.' });
  if (!CFG.admins.includes(email)) return res.status(403).json({ error: 'Este e-mail não está autorizado como administração.' });
  if (pass.length < 10) return res.status(400).json({ error: 'A senha precisa ter pelo menos 10 caracteres.' });
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) return res.status(409).json({ error: 'Este e-mail já tem senha. Use "Já tenho senha" para entrar.' });
  const u = db.prepare('INSERT INTO users (name, email, pass, created_at) VALUES (?, ?, ?, ?)').run(name, email, hashPass(pass), now());
  startSession(res, u.lastInsertRowid);
  res.json({ ok: true, redirect: '/admin' });
});

app.post('/api/password', jsonBody, auth, (req, res) => {
  if (!checkPass(String(req.body.current || ''), req.user.pass)) return res.status(400).json({ error: 'A senha atual está incorreta.' });
  const p = String(req.body.next || '');
  if (p.length < 8) return res.status(400).json({ error: 'A nova senha precisa ter pelo menos 8 caracteres.' });
  db.prepare('UPDATE users SET pass = ? WHERE id = ?').run(hashPass(p), req.user.id);
  res.json({ ok: true });
});

app.get('/api/me', auth, (req, res) => res.json({ user: { name: req.user.name, email: req.user.email, admin: isAdmin(req.user) }, store: req.store && storeInfo(req.store) }));

/* ---------- API: loja ---------- */
app.put('/api/store', jsonBody, auth, (req, res) => {
  const state = req.body && req.body.state;
  if (!state || typeof state !== 'object' || !Array.isArray(state.products)) return res.status(400).json({ error: 'Dados inválidos.' });
  const clean = safeLinks(externalize(req.store.id, state));
  const name = String((clean.store && clean.store.name) || req.store.name).slice(0, 80);
  const t = db.transaction(() => {
    // Produtos que o robô do WhatsApp criou depois que o painel abriu não podem sumir com este salvamento
    const base = Number(req.body.base) || 0;
    const cur = db.prepare('SELECT state FROM stores WHERE id = ?').get(req.store.id);
    let old = null; try { old = JSON.parse(cur.state || 'null'); } catch (e) {}
    const have = new Set(clean.products.map(p => String(p.id)));
    const added = ((old && old.products) || []).filter(p => p.waAt && p.waAt > base && !have.has(String(p.id)));
    if (added.length) {
      clean.products = [...added, ...clean.products];
      clean.cats = Array.isArray(clean.cats) ? clean.cats : [];
      added.forEach(p => { if (p.cat && !clean.cats.includes(p.cat)) clean.cats.push(p.cat); });
    }
    const at = now();
    db.prepare('UPDATE stores SET state = ?, name = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(clean), name, at, req.store.id);
    return at;
  });
  res.json({ ok: true, state: clean, savedAt: t() });
});

app.put('/api/slug', jsonBody, auth, (req, res) => {
  const slug = slugify(req.body.slug);
  if (!validSlug(slug)) return res.status(400).json({ error: 'Use de 3 a 40 letras minúsculas, números ou hífen. Alguns nomes são reservados.' });
  const other = db.prepare('SELECT id FROM stores WHERE slug = ?').get(slug);
  if (other && other.id !== req.store.id) return res.status(409).json({ error: 'Esse endereço já está em uso. Tente outro.' });
  db.prepare('UPDATE stores SET slug = ?, updated_at = ? WHERE id = ?').run(slug, now(), req.store.id);
  res.json({ ok: true, store: storeInfo(db.prepare('SELECT * FROM stores WHERE id = ?').get(req.store.id)) });
});

app.put('/api/domain', jsonBody, auth, (req, res) => {
  const raw = String(req.body.domain || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
  if (raw && !isPro(req.store)) return res.status(402).json({ error: 'Sua assinatura está vencida. Assine para usar o domínio próprio.' });
  if (raw && !/^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(raw)) return res.status(400).json({ error: 'Domínio inválido. Exemplo: minhaloja.com.br' });
  if (raw && (raw === CFG.baseDomain || raw.endsWith('.' + CFG.baseDomain) && CFG.baseDomain)) return res.status(400).json({ error: 'Use um domínio seu, não o da plataforma.' });
  const other = raw && db.prepare('SELECT id FROM stores WHERE custom_domain = ?').get(raw);
  if (other && other.id !== req.store.id) return res.status(409).json({ error: 'Esse domínio já está ligado a outra loja.' });
  db.prepare('UPDATE stores SET custom_domain = ?, updated_at = ? WHERE id = ?').run(raw || null, now(), req.store.id);
  res.json({ ok: true, store: storeInfo(db.prepare('SELECT * FROM stores WHERE id = ?').get(req.store.id)) });
});

app.post('/api/media', auth, express.raw({ type: ['image/*', 'video/*'], limit: '160mb' }), (req, res) => {
  const mime = String(req.headers['content-type'] || '').split(';')[0].toLowerCase();
  if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'Arquivo vazio.' });
  try {
    const id = saveFile(req.store.id, req.body, mime);
    res.json({ id, url: '/u/' + id, type: mime.startsWith('video') ? 'video' : 'img' });
  } catch (e) { res.status(415).json({ error: e.message }); }
});

/* ---------- API: relatórios ---------- */
const EVENT_TYPES = new Set(['view', 'pview', 'click', 'order']);
app.post('/api/e', express.text({ type: '*/*', limit: '2kb' }), (req, res) => {
  let b = {}; try { b = JSON.parse(req.body || '{}'); } catch (e) {}
  if (!EVENT_TYPES.has(b.t)) return res.status(204).end();
  const store = db.prepare('SELECT id FROM stores WHERE slug = ?').get(String(b.s || ''));
  if (!store) return res.status(204).end();
  db.prepare(`INSERT INTO events (store_id, day, type, product_id, n) VALUES (?, ?, ?, ?, 1)
    ON CONFLICT(store_id, day, type, product_id) DO UPDATE SET n = n + 1`).run(store.id, today(), b.t, String(b.p || '').slice(0, 40));
  res.status(204).end();
});

app.get('/api/stats', auth, (req, res) => {
  const days = Math.min(90, Math.max(1, parseInt(req.query.days, 10) || 30));
  const since = new Date(now() - (days - 1) * DAY).toISOString().slice(0, 10);
  const rows = db.prepare('SELECT day, type, product_id, n FROM events WHERE store_id = ? AND day >= ?').all(req.store.id, since);
  const totals = { view: 0, pview: 0, click: 0, order: 0 }, series = {}, byProduct = {};
  for (const r of rows) {
    totals[r.type] += r.n;
    if (r.type === 'view') series[r.day] = (series[r.day] || 0) + r.n;
    if (r.product_id && (r.type === 'click' || r.type === 'pview')) {
      const p = byProduct[r.product_id] || (byProduct[r.product_id] = { id: r.product_id, pview: 0, click: 0 });
      p[r.type] += r.n;
    }
  }
  const daysList = Array.from({ length: days }, (_, i) => new Date(now() - (days - 1 - i) * DAY).toISOString().slice(0, 10));
  res.json({ days, totals, series: daysList.map(d => ({ day: d, n: series[d] || 0 })), top: Object.values(byProduct).sort((a, b) => b.click - a.click || b.pview - a.pview).slice(0, 5) });
});

/* ---------- Pix ---------- */
app.get('/api/pix', async (req, res) => {
  const store = db.prepare('SELECT * FROM stores WHERE slug = ?').get(String(req.query.s || ''));
  let st = {}; try { st = JSON.parse(store.state).store || {}; } catch (e) {}
  if (!store || !st.pixKey) return res.status(404).json({ error: 'Esta loja não cadastrou chave Pix.' });
  const amount = Math.max(0, Math.min(1e6, parseFloat(req.query.v) || 0));
  const code = pixPayload({ key: st.pixKey, name: st.pixName || st.name || store.name, city: st.pixCity || 'BRASIL', amount, txid: 'VZ' + store.id });
  const svg = await QRCode.toString(code, { type: 'svg', margin: 1, width: 240 });
  res.json({ code, svg });
});

/* ---------- assinatura ---------- */
app.post('/api/billing/checkout', auth, async (req, res) => {
  const s = req.store;
  try {
    if (mp.enabled()) {
      const sub = await mp.createSubscription({ storeId: s.id, email: req.user.email, price: CFG.proPrice, reason: `${CFG.brand} - ${s.name}`, backUrl: `${CFG.publicUrl}/painel?assinatura=ok` });
      db.prepare('UPDATE stores SET mp_preapproval = ?, updated_at = ? WHERE id = ?').run(sub.id, now(), s.id);
      return res.json({ url: sub.init_point });
    }
    if (CFG.fakePayments) {
      const until = Math.max(now(), s.pro_until || 0) + 31 * DAY;
      db.prepare('UPDATE stores SET pro_until = ?, mp_preapproval = ?, updated_at = ? WHERE id = ?').run(until, 'teste', now(), s.id);
      db.prepare('INSERT INTO payments (store_id, mp_id, amount, status, created_at) VALUES (?, ?, ?, ?, ?)').run(s.id, 'teste', CFG.proPrice, 'approved', now());
      return res.json({ simulated: true, store: storeInfo(db.prepare('SELECT * FROM stores WHERE id = ?').get(s.id)) });
    }
    res.status(503).json({ error: 'O pagamento ainda não foi configurado na plataforma.' });
  } catch (e) { console.error(e); res.status(502).json({ error: 'Não deu para abrir o pagamento agora. Tente de novo em alguns minutos.' }); }
});

app.post('/api/billing/cancel', auth, async (req, res) => {
  const s = req.store;
  try { if (mp.enabled() && s.mp_preapproval && s.mp_preapproval !== 'teste') await mp.cancelSubscription(s.mp_preapproval); }
  catch (e) { console.error(e); return res.status(502).json({ error: 'Não deu para cancelar agora. Tente de novo em alguns minutos.' }); }
  db.prepare('UPDATE stores SET mp_preapproval = NULL, updated_at = ? WHERE id = ?').run(now(), s.id);
  res.json({ ok: true, store: storeInfo(db.prepare('SELECT * FROM stores WHERE id = ?').get(s.id)) });
});

// Avisos do Mercado Pago: sempre consultamos a API para confirmar, então um aviso falso não libera nada
function validSignature(req) {
  const secret = process.env.MP_WEBHOOK_SECRET;
  if (!secret) return true;
  const sig = String(req.headers['x-signature'] || ''), rid = String(req.headers['x-request-id'] || '');
  const parts = Object.fromEntries(sig.split(',').map(p => p.trim().split('=')));
  const id = String((req.body && req.body.data && req.body.data.id) || req.query['data.id'] || '').toLowerCase();
  const manifest = `id:${id};request-id:${rid};ts:${parts.ts};`;
  const h = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  return !!parts.v1 && h.length === parts.v1.length && crypto.timingSafeEqual(Buffer.from(h), Buffer.from(parts.v1));
}
app.post('/api/webhooks/mp', express.json(), async (req, res) => {
  res.status(200).end();
  if (!mp.enabled() || !validSignature(req)) return;
  const type = req.body.type || req.query.type, id = (req.body.data && req.body.data.id) || req.query['data.id'];
  try {
    if (type === 'subscription_preapproval') {
      const sub = await mp.getSubscription(id);
      const storeId = parseInt(String(sub.external_reference || '').replace('store:', ''), 10);
      if (!storeId) return;
      if (sub.status === 'authorized') db.prepare('UPDATE stores SET mp_preapproval = ?, pro_until = MAX(COALESCE(pro_until, 0), ?), updated_at = ? WHERE id = ?').run(sub.id, now() + 32 * DAY, now(), storeId);
      if (sub.status === 'cancelled' || sub.status === 'paused') db.prepare('UPDATE stores SET mp_preapproval = NULL, updated_at = ? WHERE id = ? AND mp_preapproval = ?').run(now(), storeId, sub.id);
    }
    if (type === 'subscription_authorized_payment') {
      const pay = await mp.getAuthorizedPayment(id);
      const store = db.prepare('SELECT * FROM stores WHERE mp_preapproval = ?').get(pay.preapproval_id);
      if (!store) return;
      const ok = pay.payment && pay.payment.status === 'approved';
      db.prepare('INSERT INTO payments (store_id, mp_id, amount, status, created_at) VALUES (?, ?, ?, ?, ?)').run(store.id, String(pay.id), pay.transaction_amount || CFG.proPrice, ok ? 'approved' : String((pay.payment && pay.payment.status) || pay.status), now());
      if (ok) db.prepare('UPDATE stores SET pro_until = ?, updated_at = ? WHERE id = ?').run(Math.max(now(), store.pro_until || 0) + 32 * DAY, now(), store.id);
    }
  } catch (e) { console.error('webhook', e.message); }
});

/* ---------- WhatsApp: cadastro de produtos pelo robô ---------- */
const bot = createBot({
  db, now, brand: CFG.brand, panelUrl: `${CFG.publicUrl}/painel`,
  send: (to, text) => wa.enabled() ? wa.sendText(to, text) : console.log(`[robô -> ${to}] ${text}`),
  download: id => wa.download(id),
  saveFile,
  storeOk: store => store.blocked ? 'Sua loja está bloqueada. Fale com o suporte.' : !isPro(store) ? `Sua assinatura está vencida. Assine no painel (${CFG.publicUrl}/painel) para voltar a cadastrar pelo WhatsApp.` : ''
});
app.get('/api/webhooks/wa', (req, res) => {
  const ok = req.query['hub.mode'] === 'subscribe' && process.env.WA_VERIFY_TOKEN && req.query['hub.verify_token'] === process.env.WA_VERIFY_TOKEN;
  ok ? res.type('text/plain').send(String(req.query['hub.challenge'] || '')) : res.sendStatus(403);
});
app.post('/api/webhooks/wa', express.raw({ type: '*/*', limit: '2mb' }), async (req, res) => {
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
  if (!wa.validSignature(raw, req.headers['x-hub-signature-256'])) return res.sendStatus(401);
  res.sendStatus(200);
  let body; try { body = JSON.parse(raw.toString('utf8')); } catch (e) { return; }
  for (const entry of body.entry || []) for (const ch of entry.changes || []) {
    for (const msg of (ch.value && ch.value.messages) || []) {
      try { await bot.handle(msg); } catch (e) { console.error('wa bot', e.message); }
    }
  }
});
function waInfo(store) {
  const phones = db.prepare('SELECT phone, created_at FROM wa_links WHERE store_id = ? ORDER BY created_at').all(store.id);
  const c = db.prepare('SELECT code, expires_at FROM wa_codes WHERE store_id = ? AND expires_at > ? ORDER BY expires_at DESC').get(store.id, now());
  return { enabled: wa.enabled() || CFG.fakePayments, number: wa.number(), phones, code: c ? c.code : null, codeUntil: c ? c.expires_at : null, template: WA_TEMPLATE };
}
app.get('/api/wa', auth, (req, res) => res.json(waInfo(req.store)));
app.post('/api/wa/code', auth, (req, res) => {
  db.prepare('DELETE FROM wa_codes WHERE store_id = ? OR expires_at < ?').run(req.store.id, now());
  let code; do { code = String(crypto.randomInt(100000, 1000000)); } while (db.prepare('SELECT 1 FROM wa_codes WHERE code = ?').get(code));
  db.prepare('INSERT INTO wa_codes (code, store_id, expires_at) VALUES (?, ?, ?)').run(code, req.store.id, now() + 30 * 60 * 1000);
  res.json(waInfo(req.store));
});
app.delete('/api/wa/phone/:phone', auth, (req, res) => {
  db.prepare('DELETE FROM wa_links WHERE store_id = ? AND phone = ?').run(req.store.id, String(req.params.phone).replace(/\D/g, ''));
  res.json(waInfo(req.store));
});
// O painel pergunta de vez em quando se o robô cadastrou algo novo
app.get('/api/wa/new', auth, (req, res) => {
  const since = Number(req.query.since) || 0;
  const row = db.prepare('SELECT state, updated_at FROM stores WHERE id = ?').get(req.store.id);
  let st = null; try { st = JSON.parse(row.state || 'null'); } catch (e) {}
  const products = ((st && st.products) || []).filter(p => p.waAt && p.waAt > since);
  res.json({ products, cats: (st && st.cats) || [], savedAt: row.updated_at });
});
/* ---------- painel da dona da plataforma ---------- */
app.get('/api/admin/overview', adminOnly, (req, res) => {
  const stores = db.prepare('SELECT s.*, u.name AS owner, u.email FROM stores s JOIN users u ON u.id = s.user_id ORDER BY s.created_at DESC').all();
  const week = now() - 7 * DAY;
  const list = stores.map(s => {
    let products = 0; try { products = (JSON.parse(s.state || '{}').products || []).length; } catch (e) {}
    let online = true; try { online = (JSON.parse(s.state || '{}').store || {}).online !== false; } catch (e) {}
    return { id: s.id, name: s.name, slug: s.slug, owner: s.owner, email: s.email, plan: planOf(s), proUntil: s.pro_until, trialUntil: s.trial_until, subscribed: !!s.mp_preapproval,
      blocked: !!s.blocked, blockedReason: s.blocked_reason, customDomain: s.custom_domain, products, online, createdAt: s.created_at, url: publicUrlOf(s) };
  });
  const paying = list.filter(s => s.plan === 'pro').length;
  const revenue30 = db.prepare("SELECT COALESCE(SUM(amount), 0) AS t FROM payments WHERE status = 'approved' AND created_at > ?").get(now() - 30 * DAY).t;
  const views30 = db.prepare("SELECT COALESCE(SUM(n), 0) AS t FROM events WHERE type = 'view' AND day >= ?").get(new Date(now() - 29 * DAY).toISOString().slice(0, 10)).t;
  res.json({
    brand: CFG.brand, proPrice: CFG.proPrice,
    metrics: { total: list.length, paying, trial: list.filter(s => s.plan === 'trial').length, expired: list.filter(s => s.plan === 'expired').length,
      blocked: list.filter(s => s.blocked).length, newWeek: stores.filter(s => s.created_at > week).length, mrr: paying * CFG.proPrice, revenue30, views30 },
    stores: list,
    payments: db.prepare('SELECT p.*, s.name FROM payments p JOIN stores s ON s.id = p.store_id ORDER BY p.created_at DESC LIMIT 30').all()
  });
});

app.post('/api/admin/stores/:id', adminOnly, jsonBody, (req, res) => {
  const s = db.prepare('SELECT * FROM stores WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Loja não encontrada.' });
  const a = req.body.action;
  if (a === 'block') db.prepare('UPDATE stores SET blocked = 1, blocked_reason = ?, updated_at = ? WHERE id = ?').run(String(req.body.reason || '').slice(0, 200) || null, now(), s.id);
  else if (a === 'unblock') db.prepare('UPDATE stores SET blocked = 0, blocked_reason = NULL, updated_at = ? WHERE id = ?').run(now(), s.id);
  else if (a === 'givePro') {
    const days = Math.min(3650, Math.max(1, parseInt(req.body.days, 10) || 30));
    db.prepare('UPDATE stores SET pro_until = ?, updated_at = ? WHERE id = ?').run(Math.max(now(), s.pro_until || 0) + days * DAY, now(), s.id);
  } else if (a === 'expire') db.prepare('UPDATE stores SET pro_until = NULL, trial_until = NULL, updated_at = ? WHERE id = ?').run(now(), s.id);
  else if (a === 'resetPassword') {
    const temp = crypto.randomBytes(5).toString('hex');
    db.prepare('UPDATE users SET pass = ? WHERE id = ?').run(hashPass(temp), s.user_id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(s.user_id);
    return res.json({ ok: true, tempPassword: temp });
  } else return res.status(400).json({ error: 'Ação desconhecida.' });
  res.json({ ok: true });
});

/* ---------- vitrine pelo endereço /nome-da-loja ---------- */
app.get('/:slug', (req, res, next) => {
  const store = db.prepare('SELECT * FROM stores WHERE slug = ?').get(String(req.params.slug).toLowerCase());
  if (!store) return res.status(404).send(simplePage('Vitrine não encontrada', 'Confira o endereço digitado.', `<p><a href="/">Conheça a ${escHtml(CFG.brand)}</a></p>`));
  renderStore(res, store);
});

app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Arquivo grande demais.' });
  if (err.status === 404) return res.status(404).end();
  console.error(err); res.status(500).json({ error: 'Algo deu errado. Tente de novo.' });
});

if (require.main === module) {
  const port = parseInt(process.env.PORT || '3000', 10);
  app.listen(port, () => console.log(`${CFG.brand} rodando em ${CFG.publicUrl} (porta ${port})${CFG.fakePayments ? ' · pagamentos em modo de teste' : ''}`));
}
module.exports = app;
