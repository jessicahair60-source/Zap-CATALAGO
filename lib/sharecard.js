// Imagem que aparece quando o link da loja é compartilhado no WhatsApp (1200 x 630):
// "CATÁLOGO", nome ou logo da loja e até 3 fotos de produtos, nas cores da loja.
const fs = require('fs');
const path = require('path');
// carregado só quando precisa: se faltar no servidor, o site continua funcionando sem a imagem
let Resvg = null;

const FONTS = ['PlayfairDisplay_700Bold.ttf', 'DMSans_500Medium.ttf', 'DMSans_700Bold.ttf'].map(f => path.join(__dirname, '..', 'assets', 'fonts', f));
const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hex = (v, d) => /^#[0-9a-f]{6}$/i.test(String(v || '')) ? v : d;

// Lê uma imagem enviada (/u/arquivo) e devolve como data: URL, se for JPG ou PNG
function dataUri(uploads, ref) {
  const name = String(ref || '').replace(/^\/u\//, '');
  if (!/^[\w.-]+$/.test(name)) return '';
  const mime = MIME[name.split('.').pop().toLowerCase()];
  const file = path.join(uploads, name);
  if (!mime || !fs.existsSync(file)) return '';
  return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
}

// Largura e altura de uma imagem JPG ou PNG (lendo só o cabeçalho), para mostrar a foto inteira sem cortar
function imgSize(uploads, ref) {
  try {
    const name = String(ref || '').replace(/^\/u\//, ''); if (!/^[\w.-]+$/.test(name)) return null;
    const b = fs.readFileSync(path.join(uploads, name));
    if (b[0] === 0x89 && b[1] === 0x50) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
    if (b[0] === 0xff && b[1] === 0xd8) {
      let i = 2;
      while (i < b.length) {
        if (b[i] !== 0xff) { i++; continue; }
        const mk = b[i + 1], len = b.readUInt16BE(i + 2);
        if (mk >= 0xc0 && mk <= 0xcf && mk !== 0xc4 && mk !== 0xc8 && mk !== 0xcc) {
          let h = b.readUInt16BE(i + 5), w = b.readUInt16BE(i + 7);
          // foto de celular deitada pela orientação (EXIF): o navegador mostra em pé
          return orient(b) >= 5 ? { w: h, h: w } : { w, h };
        }
        i += 2 + len;
      }
    }
  } catch (e) {}
  return null;
}
function orient(b) {
  const i = b.indexOf(Buffer.from('Exif\0\0')); if (i < 0) return 1;
  const t = i + 6, le = b.toString('ascii', t, t + 2) === 'II', r16 = o => le ? b.readUInt16LE(o) : b.readUInt16BE(o), r32 = o => le ? b.readUInt32LE(o) : b.readUInt32BE(o);
  try { const ifd = t + r32(t + 4), n = r16(ifd); for (let k = 0; k < n; k++) { const e = ifd + 2 + k * 12; if (r16(e) === 0x0112) return r16(e + 8); } } catch (e) {}
  return 1;
}

// Quebra o nome em até 2 linhas
function lines(text, max) {
  const words = String(text).split(/\s+/).filter(Boolean); const out = [''];
  for (const w of words) { const cur = out[out.length - 1]; if ((cur + ' ' + w).trim().length > max && cur) { if (out.length === 2) { out[1] += '…'; break; } out.push(w); } else out[out.length - 1] = (cur + ' ' + w).trim(); }
  return out;
}

function shareCard({ state, name, uploads }) {
  const st = (state && state.store) || {};
  const c = (state && state.colors) || {};
  const bg = hex(c.bg, '#FBF3F5'), title = hex(c.title, '#2A1A22'), muted = hex(c.muted, '#8C7480'), acc = hex(c.buyBg, '#B9476F'), accText = hex(c.buyText, '#FFFFFF');
  const storeName = st.name || name;
  const logoKind = st.logoKind || (st.logo ? 'img' : 'text');
  const logo = logoKind === 'img' ? dataUri(uploads, st.logo) : '';
  const photos = ((state && state.products) || []).filter(p => p && p.active !== false)
    .map(p => (p.media || []).find(m => m && m.type !== 'video' && m.id && m.id !== 'demo')).filter(Boolean)
    .map(m => dataUri(uploads, m.id)).filter(Boolean).slice(0, 3);
  if (!photos.length) { const b = dataUri(uploads, st.bannerImgM || st.bannerImg); if (b) photos.push(b); }

  const textW = photos.length ? 600 : 1040;
  const nm = lines(storeName, photos.length ? 16 : 28);
  const size = nm.length > 1 || storeName.length > 12 ? 64 : 80;
  const nameY = 300;
  const nameSvg = logo
    ? `<image href="${logo}" x="80" y="190" width="${textW - 40}" height="150" preserveAspectRatio="xMinYMid meet"/>`
    : nm.map((l, i) => `<text x="80" y="${nameY + i * (size + 8)}" font-family="Playfair Display" font-weight="700" font-size="${size}" fill="${title}">${esc(l)}</text>`).join('');
  const afterY = logo ? 400 : nameY + (nm.length - 1) * (size + 8) + 70;
  const bio = st.bio && st.bio !== 'Escreva aqui uma frase sobre a sua loja' ? lines(st.bio, photos.length ? 32 : 64) : [];
  const btnY = afterY + (bio.length ? 4 + bio.length * 38 : -10);

  // fotos em pé (9:16), lado a lado, à direita
  const n = photos.length, pw = n === 1 ? 300 : n === 2 ? 220 : 170, ph = Math.round(pw * 16 / 9 > 520 ? 520 : pw * 16 / 9), gap = 16;
  const totalW = n * pw + (n - 1) * gap, x0 = 1200 - 60 - totalW, y0 = (630 - ph) / 2;
  const photoSvg = photos.map((u, i) => {
    const x = x0 + i * (pw + gap), y = y0 + (n === 3 && i === 1 ? -14 : 0);
    return `<clipPath id="c${i}"><rect x="${x}" y="${y}" width="${pw}" height="${ph}" rx="22"/></clipPath>
      <rect x="${x - 4}" y="${y - 4}" width="${pw + 8}" height="${ph + 8}" rx="26" fill="#fff" opacity=".9"/>
      <image href="${u}" x="${x}" y="${y}" width="${pw}" height="${ph}" preserveAspectRatio="xMidYMid slice" clip-path="url(#c${i})"/>`;
  }).join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
    <rect width="1200" height="630" fill="${bg}"/>
    <circle cx="1120" cy="-40" r="260" fill="${acc}" opacity=".10"/><circle cx="-40" cy="660" r="200" fill="${acc}" opacity=".08"/>
    <rect x="80" y="150" width="56" height="5" rx="2.5" fill="${acc}"/>
    <text x="80" y="128" font-family="DM Sans" font-weight="700" font-size="26" letter-spacing="7" fill="${acc}">CATÁLOGO</text>
    ${nameSvg}
    ${bio.map((l, i) => `<text x="80" y="${afterY + i * 38}" font-family="DM Sans" font-weight="500" font-size="28" fill="${muted}">${esc(l)}</text>`).join('')}
    <rect x="80" y="${btnY}" width="${photos.length ? 400 : 440}" height="64" rx="32" fill="${acc}"/>
    <text x="${80 + (photos.length ? 200 : 220)}" y="${btnY + 42}" text-anchor="middle" font-family="DM Sans" font-weight="700" font-size="25" fill="${accText}">Ver produtos e pedir</text>
    ${photoSvg}
  </svg>`;
  Resvg = Resvg || require('@resvg/resvg-js').Resvg;
  const r = new Resvg(svg, { font: { fontFiles: FONTS, loadSystemFonts: false, defaultFontFamily: 'DM Sans' }, fitTo: { mode: 'width', value: 1200 } });
  return r.render().asPng();
}

// Imagem do pedido (prévia do link que vai na mensagem do WhatsApp), quadrada 600 x 600.
// Fotos em pé (9:16) em cards, sem cortar o formato da foto.
// 1 produto: foto à esquerda e o resumo (nome, quantidade, valor) à direita.
// 2 ou mais: título "Resumo do pedido" com o total em cima e os cards embaixo; com mais de 8, o último mostra "+N".
const ORDER_SIZE = 600;
const brl = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const firstPhoto = p => (p && p.media || []).find(m => m && m.type !== 'video' && m.id && m.id !== 'demo');
function orderCard({ state, items, ids, uploads }) {
  const c = (state && state.colors) || {};
  const st = (state && state.store) || {};
  const bg = hex(c.bg, '#FBF3F5'), title = hex(c.title, '#2A1A22'), muted = hex(c.muted, '#8C7480'), acc = hex(c.buyBg, '#B9476F'), accText = hex(c.buyText, '#FFFFFF');
  const byId = new Map(((state && state.products) || []).map(p => [String(p && p.id), p]));
  const list = (items || (ids || []).map(id => ({ id, qty: 1 }))).map(x => ({ qty: Math.max(1, +x.qty || 1), p: byId.get(String(x.id)) })).filter(x => x.p);
  const withPhoto = list.map(x => { const m = firstPhoto(x.p); const u = m ? dataUri(uploads, m.id) : ''; const z = u && imgSize(uploads, m.id);
    return { ...x, u, ar: z && z.w > 0 && z.h > 0 ? Math.min(2, Math.max(0.4, z.w / z.h)) : 9 / 16 }; }).filter(x => x.u);
  const showPrice = st.sumPrice !== false;
  const total = list.reduce((t, x) => t + (x.p.price > 0 ? x.p.price * x.qty : 0), 0);
  const count = list.reduce((t, x) => t + x.qty, 0);
  const S = ORDER_SIZE, g = 12, m = 24;
  const render = body => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}"><rect width="${S}" height="${S}" fill="${bg}"/>
      <circle cx="${S - 30}" cy="-20" r="170" fill="${acc}" opacity=".10"/><circle cx="-20" cy="${S + 10}" r="130" fill="${acc}" opacity=".08"/>${body}</svg>`;
    Resvg = Resvg || require('@resvg/resvg-js').Resvg;
    const r = new Resvg(svg, { font: { fontFiles: FONTS, loadSystemFonts: false, defaultFontFamily: 'DM Sans' }, fitTo: { mode: 'width', value: S } });
    const img = r.render();
    // JPG fica bem mais leve que PNG com fotos (o WhatsApp pode não mostrar a prévia de imagem pesada)
    try { const jpeg = require('jpeg-js'); return { type: 'image/jpeg', data: jpeg.encode({ data: img.pixels, width: img.width, height: img.height }, 82).data }; }
    catch { return { type: 'image/png', data: img.asPng() }; }
  };
  // card de foto 9:16 com borda branca e cantos redondos; selo "2x" quando leva mais de 1
  const card = (u, x, y, w, h, i, qty, more) => {
    const r = Math.max(10, Math.round(w * 0.09));
    const badge = qty > 1 && !more ? (() => { const bw = Math.max(46, Math.round(w * 0.32)), bh = Math.round(bw * 0.62);
      return `<rect x="${x + w - bw - 8}" y="${y + 8}" width="${bw}" height="${bh}" rx="${bh / 2}" fill="${acc}"/><text x="${x + w - bw / 2 - 8}" y="${y + 8 + bh * 0.7}" text-anchor="middle" font-family="DM Sans" font-weight="700" font-size="${Math.round(bh * 0.6)}" fill="${accText}">${qty}x</text>`; })() : '';
    const plus = more ? `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${acc}" opacity=".80"/><text x="${x + w / 2}" y="${y + h / 2 + w * 0.13}" text-anchor="middle" font-family="DM Sans" font-weight="700" font-size="${Math.round(w * 0.36)}" fill="${accText}">+${more}</text>` : '';
    return `<rect x="${x - 4}" y="${y - 4}" width="${w + 8}" height="${h + 8}" rx="${r + 4}" fill="#fff"/>
      <clipPath id="o${i}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}"/></clipPath>
      <image href="${u}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet" clip-path="url(#o${i})"/>${plus}${badge}`;
  };

  if (!withPhoto.length) {
    const b = dataUri(uploads, st.logo || st.bannerImgM || st.bannerImg); if (!b) return null;
    return render(`<image href="${b}" x="60" y="60" width="${S - 120}" height="${S - 120}" preserveAspectRatio="xMidYMid meet"/>`);
  }

  if (withPhoto.length === 1 && list.length === 1) {
    const x0 = list[0], ar = withPhoto[0].ar;
    const priceTxt = showPrice && total > 0 ? brl(total) : '';
    if (ar >= 0.75) {
      // foto quadrada ou deitada: foto inteira em cima e o resumo embaixo
      const infoH = 96; let w = S - 2 * m, h = Math.round(w / ar);
      if (h > S - 2 * m - infoH) { h = S - 2 * m - infoH; w = Math.round(h * ar); }
      const px = Math.round((S - w) / 2), ty = m + h + 44, nm = lines(x0.p.name, priceTxt ? 24 : 34)[0];
      return render(card(withPhoto[0].u, px, m, w, h, 0, 1, 0)
        + `<text x="${m}" y="${ty}" font-family="DM Sans" font-weight="700" font-size="28" fill="${title}">${esc(nm)}</text>`
        + `<text x="${m}" y="${ty + 32}" font-family="DM Sans" font-weight="500" font-size="20" fill="${muted}">${x0.qty} ${x0.qty === 1 ? 'unidade' : 'unidades'}</text>`
        + (priceTxt ? `<text x="${S - m}" y="${ty + 14}" text-anchor="end" font-family="DM Sans" font-weight="700" font-size="30" fill="${acc}">${esc(priceTxt)}</text>` : ''));
    }
    // foto em pé: foto inteira à esquerda e o resumo à direita
    let h = S - 2 * m, w = Math.round(h * ar); if (w > S * 0.56) { w = Math.round(S * 0.56); h = Math.round(w / ar); }
    const py = Math.round((S - h) / 2), tx = m + w + 26, tw = S - tx - m;
    const nm = lines(x0.p.name, Math.max(8, Math.floor(tw / 17))).slice(0, 3);
    let y = 130;
    const head = `<text x="${tx}" y="${y}" font-family="DM Sans" font-weight="700" font-size="14" letter-spacing="2" fill="${acc}">RESUMO DO PEDIDO</text><rect x="${tx}" y="${y + 14}" width="40" height="4" rx="2" fill="${acc}"/>`;
    y += 62;
    const name = nm.map((l, i) => `<text x="${tx}" y="${y + i * 34}" font-family="DM Sans" font-weight="700" font-size="28" fill="${title}">${esc(l)}</text>`).join('');
    y += (nm.length - 1) * 34 + 36;
    const qty = `<text x="${tx}" y="${y}" font-family="DM Sans" font-weight="500" font-size="20" fill="${muted}">${x0.qty} ${x0.qty === 1 ? 'unidade' : 'unidades'}</text>`;
    const price = priceTxt ? `<text x="${tx}" y="${y + 48}" font-family="DM Sans" font-weight="700" font-size="30" fill="${acc}">${esc(priceTxt)}</text>` : '';
    return render(card(withPhoto[0].u, m, py, w, h, 0, 1, 0) + head + name + qty + price);
  }

  // 2 ou mais: cabeçalho + grade de cards 9:16
  const H = 104, show = withPhoto.slice(0, 8), k = show.length, more = withPhoto.length - k;
  const areaW = S - 2 * m, areaH = S - H - m;
  const gg = g * 1.5;
  // divide em 1 ou 2 fileiras; em cada fileira as fotos têm a mesma altura e a largura de cada uma segue o formato dela
  let best = null;
  for (let rows = 1; rows <= 2 && rows <= k; rows++) {
    const per = Math.ceil(k / rows), rs = [];
    for (let r = 0; r < rows; r++) rs.push(show.slice(r * per, (r + 1) * per));
    const hs = rs.map(r => (areaW - (r.length - 1) * gg) / r.reduce((t, x) => t + x.ar, 0));
    const h = Math.floor(Math.min(...hs, (areaH - (rows - 1) * gg) / rows));
    if (!best || h > best.h) best = { rs, h };
  }
  const { rs, h } = best, gridH = rs.length * h + (rs.length - 1) * gg, y0 = H + (areaH - gridH) / 2;
  let idx = 0;
  const cards = rs.map((row, r) => {
    const ws = row.map(x => Math.round(h * x.ar)), rowW = ws.reduce((t, w) => t + w, 0) + (row.length - 1) * gg;
    let cx = (S - rowW) / 2; const cy = y0 + r * (h + gg);
    return row.map((x, j) => { const i = idx++; const out = card(x.u, cx, cy, ws[j], h, i, x.qty, i === k - 1 ? more : 0); cx += ws[j] + gg; return out; }).join('');
  }).join('');
  const lx = m;
  const head = `
    <text x="${lx}" y="52" font-family="Playfair Display" font-weight="700" font-size="32" fill="${title}">Resumo do pedido</text>
    <text x="${lx}" y="84" font-family="DM Sans" font-weight="500" font-size="20" fill="${muted}">${count} ${count === 1 ? 'produto' : 'produtos'}</text>
    ${showPrice && total > 0 ? `<text x="${S - m}" y="46" text-anchor="end" font-family="DM Sans" font-weight="500" font-size="17" fill="${muted}">Total</text><text x="${S - m}" y="80" text-anchor="end" font-family="DM Sans" font-weight="700" font-size="28" fill="${acc}">${esc(brl(total))}</text>` : ''}`;
  return render(head + cards);
}

module.exports = { shareCard, orderCard };
