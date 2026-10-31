// Robô do WhatsApp: a lojista manda foto + texto no modelo e o produto entra no catálogo dela.
const MAX_MEDIA = 6;
const JOIN_MS = 3 * 60 * 1000;   // fotos sem legenda logo depois de um cadastro entram no mesmo produto
const PENDING_MS = 15 * 60 * 1000; // fotos esperando o texto do produto

const TEMPLATE = `Nome: Peruca Lace Ondulada
Preço: 389,90
Categoria: Perucas
Tamanhos: 50 cm, 60 cm
Cor: Castanho
Estoque: 5
Descrição: Cabelo humano, pronta para usar`;

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
const KEYS = {
  name: ['nome', 'produto', 'titulo'],
  price: ['preco', 'valor', 'preco por', 'por'],
  old: ['preco antigo', 'de', 'preco de', 'antes'],
  cat: ['categoria', 'categorias'],
  sizes: ['tamanhos', 'tamanho', 'numeracao', 'opcoes', 'opcao', 'variacoes'],
  color: ['cor', 'cores'],
  stock: ['estoque', 'quantidade', 'qtd', 'qtde'],
  desc: ['descricao', 'desc', 'detalhes', 'obs']
};
const FIELD = {}; for (const [f, ks] of Object.entries(KEYS)) ks.forEach(k => { FIELD[k] = f; });

// "R$ 1.389,90" -> 1389.9; "389.90" -> 389.9; "consultar" -> 0
function parsePrice(v) {
  const t = String(v || '').replace(/r\$|\s/gi, '');
  if (!t) return NaN;
  if (/^(consultar|consulte|acombinar|sobconsulta)/.test(norm(v).replace(/\s/g, ''))) return 0;
  let n;
  if (t.includes(',')) n = parseFloat(t.replace(/\./g, '').replace(',', '.'));
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) n = parseFloat(t.replace(/\./g, ''));
  else n = parseFloat(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : NaN;
}

// Lê o texto no modelo. Linhas "Campo: valor"; campos desconhecidos viram características (ex.: "Comprimento: 60 cm")
function parseProduct(text) {
  const out = { specs: [], descLines: [] }; let keyed = 0;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/^[\s*•\-–]+/, '').replace(/\*/g, '').trim();
    if (!line) continue;
    const m = /^([^:=]{1,30})[:=]\s*(.*)$/.exec(line);
    if (!m) { out.descLines.push(line); continue; }
    const key = norm(m[1]), val = m[2].trim(); keyed++;
    const f = FIELD[key];
    if (!f) { if (val) out.specs.push([m[1].trim(), val]); continue; }
    if (f === 'desc') out.descLines.unshift(val); else out[f] = val;
  }
  const missing = [];
  if (!out.name) missing.push('Nome');
  const price = parsePrice(out.price);
  if (out.price === undefined) missing.push('Preço');
  else if (Number.isNaN(price)) missing.push('Preço (use por exemplo 129,90)');
  if (!keyed) return { ok: false, keyed: false, missing };
  if (missing.length) return { ok: false, keyed: true, missing };
  const old = parsePrice(out.old);
  const sizes = out.sizes ? out.sizes.split(/[,;/|]/).map(s => s.trim()).filter(Boolean).slice(0, 30) : [];
  const stockN = parseInt(String(out.stock || '').replace(/\D/g, ''), 10);
  const specs = [];
  if (out.color) specs.push(['Cor', out.color]);
  specs.push(...out.specs);
  return { ok: true, product: {
    name: out.name.slice(0, 120), price, old: old > price ? old : undefined, cat: (out.cat || '').slice(0, 40),
    sizes, optLabel: sizes.length ? 'Tamanho' : 'Opção', stock: Number.isFinite(stockN) ? stockN : 0, track: Number.isFinite(stockN),
    specs: specs.slice(0, 20), desc: out.descLines.join('\n').slice(0, 2000)
  } };
}

const isHelp = t => /^(oi|ola|ajuda|menu|modelo|help|comecar|inicio|\?)\b/.test(norm(t)) || norm(t) === '';
const codeIn = t => { const m = /\bzap[\s-]?(\d{6})\b/i.exec(String(t || '')); return m && m[1]; };

/*
  deps: { db, now, brand, panelUrl, send(to, text), download(id) -> {buf, mime}, saveFile(storeId, buf, mime) -> nome, storeOk(store) -> '' ou motivo }
*/
function createBot(deps) {
  const { db } = deps;
  const q = {
    seen: db.prepare('INSERT OR IGNORE INTO wa_seen (msg_id, at) VALUES (?, ?)'),
    code: db.prepare('SELECT * FROM wa_codes WHERE code = ?'),
    delCode: db.prepare('DELETE FROM wa_codes WHERE code = ?'),
    link: db.prepare('INSERT INTO wa_links (phone, store_id, created_at) VALUES (?, ?, ?) ON CONFLICT(phone) DO UPDATE SET store_id = excluded.store_id, created_at = excluded.created_at'),
    linkOf: db.prepare('SELECT s.* FROM wa_links l JOIN stores s ON s.id = l.store_id WHERE l.phone = ?'),
    pend: db.prepare('SELECT * FROM wa_pending WHERE phone = ?'),
    setPend: db.prepare(`INSERT INTO wa_pending (phone, media, updated_at, last_product, last_at) VALUES (@phone, @media, @updated_at, @last_product, @last_at)
      ON CONFLICT(phone) DO UPDATE SET media = @media, updated_at = @updated_at, last_product = @last_product, last_at = @last_at`),
    store: db.prepare('SELECT * FROM stores WHERE id = ?'),
    save: db.prepare('UPDATE stores SET state = ?, updated_at = ? WHERE id = ?')
  };
  const say = (to, text) => Promise.resolve(deps.send(to, text)).catch(e => console.error('wa send', e.message));
  const help = store => `Para cadastrar um produto${store ? ` na *${store.name}*` : ''}, mande a foto com este texto na legenda (ou mande as fotos e depois o texto):\n\n${TEMPLATE}\n\nNome e Preço são obrigatórios. Para "Consulte o valor", escreva Preço: consultar.`;

  function getPend(phone) {
    const r = q.pend.get(phone);
    const p = { phone, media: [], updated_at: 0, last_product: null, last_at: 0 };
    if (r) Object.assign(p, r, { media: JSON.parse(r.media || '[]') });
    if (deps.now() - p.updated_at > PENDING_MS) p.media = [];
    return p;
  }
  const putPend = p => q.setPend.run({ ...p, media: JSON.stringify(p.media), last_product: p.last_product == null ? null : String(p.last_product) });

  // Grava no catálogo; transação para não atropelar um salvamento do painel
  const addProduct = db.transaction((storeId, data, media) => {
    const store = q.store.get(storeId);
    let st = null; try { st = JSON.parse(store.state || 'null'); } catch (e) {}
    if (!st || typeof st !== 'object') st = { v: 0, products: [], cats: [] };
    st.products = Array.isArray(st.products) ? st.products : [];
    st.cats = Array.isArray(st.cats) ? st.cats : [];
    let cat = data.cat;
    if (cat) { const hit = st.cats.find(c => c.toLowerCase() === cat.toLowerCase()); if (hit) cat = hit; else st.cats.push(cat); }
    else cat = st.cats[0] || 'Novidades';
    if (!st.cats.length) st.cats.push(cat);
    const t = deps.now();
    const p = { id: t * 10 + Math.floor(Math.random() * 10), ...data, cat, kind: 'fisico', active: true, zero: 'default', media, link: '', duration: '', fromPrice: false,
      sales: 0, hue: Math.floor(Math.random() * 360), waAt: t };
    if (p.old === undefined) delete p.old;
    st.products.unshift(p);
    q.save.run(JSON.stringify(st), t, storeId);
    return p;
  });
  const addMedia = db.transaction((storeId, productId, media) => {
    const store = q.store.get(storeId); const st = JSON.parse(store.state || 'null');
    const p = st && (st.products || []).find(x => String(x.id) === String(productId));
    if (!p) return false;
    p.media = [...(p.media || []), ...media].slice(0, MAX_MEDIA); p.waAt = deps.now();
    q.save.run(JSON.stringify(st), deps.now(), storeId); return true;
  });

  async function grabMedia(store, msg) {
    const m = msg.image || msg.video;
    const { buf, mime } = await deps.download(m.id);
    const id = deps.saveFile(store.id, buf, mime);
    return { id, type: mime.startsWith('video') ? 'video' : 'img' };
  }

  async function create(phone, store, pend, parsed, media) {
    const p = addProduct(store.id, parsed.product, [...pend.media, ...media].slice(0, MAX_MEDIA));
    putPend({ ...pend, media: [], updated_at: deps.now(), last_product: p.id, last_at: deps.now() });
    const price = p.price > 0 ? `R$ ${p.price.toFixed(2).replace('.', ',')}` : 'Consulte o valor';
    const fotos = p.media.length ? `${p.media.length} ${p.media.length === 1 ? 'foto' : 'fotos'}` : 'sem foto';
    await say(phone, `✅ Cadastrado na sua vitrine!\n\n*${p.name}*\n${price} · ${p.cat} · ${fotos}\n\nQuer mais fotos nesse produto? Mande agora, sem legenda. Para mudar algo, abra o painel: ${deps.panelUrl}`);
  }

  // Uma mensagem recebida do webhook
  async function handle(msg) {
    if (!msg || !msg.from || !msg.id) return;
    if (!q.seen.run(msg.id, deps.now()).changes) return; // a Meta pode reenviar o mesmo aviso
    const phone = String(msg.from).replace(/\D/g, '');
    const text = msg.type === 'text' ? (msg.text && msg.text.body) || '' : (msg.image && msg.image.caption) || (msg.video && msg.video.caption) || '';

    const code = codeIn(text);
    if (code) {
      const c = q.code.get(code);
      if (!c || c.expires_at < deps.now()) return say(phone, 'Esse código não vale mais. No painel, abra WhatsApp e toque em "Ligar meu WhatsApp" para gerar outro.');
      q.delCode.run(code); q.link.run(phone, c.store_id, deps.now());
      const st = q.store.get(c.store_id);
      return say(phone, `Pronto! Este número agora cadastra produtos na loja *${st.name}*. 🎉\n\n${help()}`);
    }

    const store = q.linkOf.get(phone);
    if (!store) return say(phone, `Olá! Este número ainda não está ligado a nenhuma loja do ${deps.brand}. No painel da sua loja, abra a parte WhatsApp e toque em "Ligar meu WhatsApp".`);
    // "esqueci minha senha": a lojista manda a mensagem e o robô responde com o link de senha nova
    if (msg.type === 'text' && /^\W*(esqueci|senha)/i.test(text) && deps.resetLink)
      return say(phone, `🔑 Para criar uma senha nova na loja *${store.name}*, abra o link (vale 1 hora):\n${deps.resetLink(store.user_id)}\n\nSe não foi você que pediu, ignore esta mensagem.`);
    const bad = deps.storeOk(store);
    if (bad) return say(phone, bad);

    const pend = getPend(phone);
    if (msg.type === 'image' || msg.type === 'video') {
      let media;
      try { media = await grabMedia(store, msg); } catch (e) { console.error('wa media', e.message); return say(phone, 'Não consegui baixar essa foto ou vídeo. Envie em JPG, PNG ou MP4 e tente de novo.'); }
      if (text.trim()) {
        const parsed = parseProduct(text);
        if (parsed.ok) return create(phone, store, pend, parsed, [media]);
        pend.media.push(media); pend.updated_at = deps.now(); putPend(pend);
        return say(phone, parsed.keyed ? `Recebi a foto, mas faltou: ${parsed.missing.join(', ')}. Mande o texto de novo, completo:\n\n${TEMPLATE}` : `Recebi a foto. Agora mande o texto do produto neste modelo:\n\n${TEMPLATE}`);
      }
      if (pend.last_product && deps.now() - pend.last_at < JOIN_MS && !pend.media.length) {
        if (addMedia(store.id, pend.last_product, [media])) { pend.last_at = deps.now(); putPend(pend); return; }
      }
      const first = !pend.media.length;
      pend.media.push(media); pend.media = pend.media.slice(-MAX_MEDIA); pend.updated_at = deps.now(); putPend(pend);
      if (first) return say(phone, `📸 Foto recebida. Pode mandar mais fotos. Depois mande o texto do produto:\n\n${TEMPLATE}`);
      return;
    }
    if (msg.type === 'text') {
      if (isHelp(text)) return say(phone, help(store));
      const parsed = parseProduct(text);
      if (parsed.ok) return create(phone, store, pend, parsed, []);
      return say(phone, parsed.keyed ? `Quase lá! Faltou: ${parsed.missing.join(', ')}.\n\nUse este modelo:\n\n${TEMPLATE}` : help(store));
    }
    return say(phone, `Por enquanto eu entendo foto, vídeo e texto.\n\n${help(store)}`);
  }

  return { handle };
}

module.exports = { createBot, parseProduct, parsePrice, TEMPLATE };
