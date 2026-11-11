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

// Imagem quadrada do pedido (aparece na prévia do link que vai na mensagem do WhatsApp):
// as fotos dos produtos escolhidos em grade; com mais de 4, a última mostra "+N".
const ORDER_SIZE = 400;
function orderCard({ state, ids, uploads }) {
  const c = (state && state.colors) || {};
  const bg = hex(c.bg, '#FBF3F5'), acc = hex(c.buyBg, '#B9476F'), accText = hex(c.buyText, '#FFFFFF');
  const byId = new Map(((state && state.products) || []).map(p => [String(p && p.id), p]));
  const photos = ids.map(id => byId.get(String(id))).filter(Boolean)
    .map(p => (p.media || []).find(m => m && m.type !== 'video' && m.id && m.id !== 'demo'))
    .filter(Boolean).map(m => dataUri(uploads, m.id)).filter(Boolean);
  const noPhotos = !photos.length;
  if (noPhotos) { const st0 = (state && state.store) || {}; const b = dataUri(uploads, st0.logo || st0.bannerImgM || st0.bannerImg); if (b) photos.push(b); }
  if (!photos.length) return null;
  const S = ORDER_SIZE, n = Math.min(photos.length, 4), extra = photos.length - n, g = 6;
  const cells = n === 1 ? [[0, 0, S, S]] : n === 2 ? [[0, 0, S / 2 - g / 2, S], [S / 2 + g / 2, 0, S / 2 - g / 2, S]]
    : n === 3 ? [[0, 0, S / 2 - g / 2, S], [S / 2 + g / 2, 0, S / 2 - g / 2, S / 2 - g / 2], [S / 2 + g / 2, S / 2 + g / 2, S / 2 - g / 2, S / 2 - g / 2]]
    : [[0, 0], [1, 0], [0, 1], [1, 1]].map(([i, j]) => [i * (S / 2 + g / 2), j * (S / 2 + g / 2), S / 2 - g / 2, S / 2 - g / 2]);
  const imgs = photos.slice(0, n).map((u, i) => { const [x, y, w, h] = cells[i];
    return `<clipPath id="o${i}"><rect x="${x}" y="${y}" width="${w}" height="${h}"/></clipPath><image href="${u}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice" clip-path="url(#o${i})"/>`; }).join('');
  const more = extra > 0 ? (() => { const [x, y, w, h] = cells[n - 1];
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${acc}" opacity=".78"/><text x="${x + w / 2}" y="${y + h / 2 + 22}" text-anchor="middle" font-family="DM Sans" font-weight="700" font-size="64" fill="${accText}">+${extra}</text>`; })() : '';
  // logo da loja num círculo branco no canto de baixo, à esquerda (só quando a loja usa logo em imagem)
  const st = (state && state.store) || {};
  const logo = (st.logoKind || (st.logo ? 'img' : 'text')) === 'img' ? dataUri(uploads, st.logo) : '';
  const L = 108, lx = 14, ly = S - L - 14;
  const badge = logo && !noPhotos ? `<circle cx="${lx + L / 2}" cy="${ly + L / 2}" r="${L / 2 + 4}" fill="#fff"/><clipPath id="lg"><circle cx="${lx + L / 2}" cy="${ly + L / 2}" r="${L / 2 - 6}"/></clipPath><image href="${logo}" x="${lx + 6}" y="${ly + 6}" width="${L - 12}" height="${L - 12}" preserveAspectRatio="xMidYMid meet" clip-path="url(#lg)"/>` : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}"><rect width="${S}" height="${S}" fill="${bg}"/>${imgs}${more}${badge}</svg>`;
  Resvg = Resvg || require('@resvg/resvg-js').Resvg;
  const r = new Resvg(svg, { font: { fontFiles: FONTS, loadSystemFonts: false, defaultFontFamily: 'DM Sans' }, fitTo: { mode: 'width', value: S } });
  return r.render().asPng();
}

module.exports = { shareCard, orderCard };
