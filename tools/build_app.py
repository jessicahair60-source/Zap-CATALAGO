# Gera public/app.html (vitrine + painel ligados ao servidor) a partir do protótipo aprovado.
# Uso: python3 tools/build_app.py
import os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
s = open(os.path.join(ROOT, 'tools', 'prototipo.html'), encoding='utf-8').read()

def rep(a, b, cnt=1):
    global s
    assert s.count(a) == cnt, (a[:100], s.count(a))
    s = s.replace(a, b)

# ---------- documento completo ----------
rep('<title>Vitrine Zap</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n',
    '<!doctype html>\n<html lang="pt-BR">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<!--HEAD-->\n')
i = s.index('</style>') + len('</style>')
s = s[:i] + '\n</head>\n<body>\n<!--BOOT-->' + s[i:] + '\n</body>\n</html>\n'

# ---------- barra do topo (só no painel) ----------
rep('<span class="demo-tag">Protótipo</span>', '<span class="demo-tag" id="brandtag">Protótipo</span><span class="savest" id="savest" hidden></span>')
rep('<button id="tab-loja" aria-pressed="true">Vitrine da cliente</button>', '<button id="tab-loja" aria-pressed="true">Ver como cliente</button>')
rep('<button id="tab-painel" aria-pressed="false">Painel da lojista</button>\n  </div>', '<button id="tab-painel" aria-pressed="false">Painel</button>\n  </div>\n  <a class="tlink" id="logout" href="/sair" hidden>Sair</a>')

# ---------- dados: vêm do servidor ----------
rep("""const KEY = 'vitrinezap5';
let S;
try { S = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { S = null; }
if (!S || S.v !== 4) S = JSON.parse(JSON.stringify(DEFAULT));""",
"""const BOOT = window.__BOOT__ || { mode: 'demo' };
const MODE = BOOT.mode; // 'store' = vitrine pública, 'panel' = painel da lojista, 'demo' = protótipo offline
document.body.classList.add('m-' + MODE);
const KEY = 'vitrinezap5';
let S = null, FRESH = false;
if (MODE === 'demo') { try { S = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { S = null; } }
else S = BOOT.state;
const EMPTY_STORE = MODE === 'store' && !S;
if (!S || S.v !== 4) {
  S = JSON.parse(JSON.stringify(DEFAULT)); FRESH = MODE === 'panel';
  if (FRESH) { // loja nova: nome dela, sem produtos nem depoimentos de exemplo
    Object.assign(S.store, { name: BOOT.store.name, bannerKicker: 'Bem-vinda', bannerTitle: BOOT.store.name, bio: 'Escreva aqui uma frase sobre a sua loja', phone: '', coupon: '', footer: '', layout: 'list' });
    S.cats = ['Novidades']; S.products = []; S.testimonials = [];
    S.links.forEach(l => { l.value = ''; l.on = l.type === 'zap'; });
  }
}""")
rep("""if (!S.testimonials) S.testimonials = JSON.parse(JSON.stringify(DEFAULT_TESTI));""",
    """if (!S.testimonials) S.testimonials = FRESH ? [] : JSON.parse(JSON.stringify(DEFAULT_TESTI));""")

# salvar: no painel vai para o servidor (com espera curta para juntar várias mudanças)
rep("""function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { toast('Não deu para salvar neste navegador. A imagem do banner pode estar grande demais.'); } }""",
"""function save() {
  if (MODE === 'panel') return scheduleSync();
  if (MODE === 'demo') try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { toast('Não deu para salvar neste navegador. A imagem do banner pode estar grande demais.'); }
}
const sync = { t: 0, busy: false, dirty: false };
function setSaveState(st) { const el = document.getElementById('savest'); if (!el) return; el.hidden = false; el.dataset.st = st;
  el.textContent = st === 'ok' ? 'Salvo' : st === 'err' ? 'Não salvou' : 'Salvando...'; }
function scheduleSync() { sync.dirty = true; setSaveState('pending'); clearTimeout(sync.t); sync.t = setTimeout(runSync, 700); }
// Troca as imagens enviadas como data: pelos endereços que o servidor guardou
function swapUrls(a, b) { if (!a || !b || typeof a !== 'object') return;
  for (const k of Object.keys(a)) { const x = a[k], y = b[k];
    if (typeof x === 'string' && x.startsWith('data:') && typeof y === 'string' && y.startsWith('/u/')) a[k] = y; else if (x && typeof x === 'object') swapUrls(x, y); } }
async function runSync() {
  if (sync.busy) return scheduleSync();
  sync.busy = true; sync.dirty = false;
  try {
    const r = await fetch('/api/store', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: S }) });
    if (r.status === 401) { location.href = '/entrar'; return; }
    const j = await r.json(); if (!r.ok) throw new Error(j.error);
    swapUrls(S, j.state); setSaveState(sync.dirty ? 'pending' : 'ok');
  } catch (e) { setSaveState('err'); toast('Não deu para salvar. Confira a internet e tente de novo.'); }
  sync.busy = false; if (sync.dirty) scheduleSync();
}
window.addEventListener('beforeunload', e => { if (MODE === 'panel' && (sync.dirty || sync.busy)) { e.preventDefault(); e.returnValue = ''; } });
// Métricas da vitrine (visitas, produtos vistos, cliques no Eu quero, pedidos)
function track(t, p) {
  if (MODE !== 'store') return;
  try { navigator.sendBeacon('/api/e', JSON.stringify({ s: BOOT.store.slug, t, p: p ? String(p) : '' })); } catch (e) {}
  try { if (window.fbq) { if (t === 'click') fbq('track', 'AddToCart'); if (t === 'order') fbq('track', 'Lead'); if (t === 'pview') fbq('track', 'ViewContent'); } } catch (e) {}
  try { if (window.gtag) gtag('event', { view: 'page_view_store', pview: 'view_item', click: 'add_to_cart', order: 'generate_lead' }[t] || t); } catch (e) {}
}""")

# fotos e vídeos: no painel sobem para o servidor
rep("""  const id = 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  MEDIA[id] = URL.createObjectURL(blob); idb.put(id, blob);
  return { id, type };""",
"""  if (MODE === 'panel') {
    try {
      const r = await fetch('/api/media', { method: 'POST', headers: { 'Content-Type': blob.type || file.type || (type === 'video' ? 'video/mp4' : 'image/jpeg') }, body: blob });
      const j = await r.json(); if (!r.ok) { toast(j.error || 'Não deu para enviar o arquivo.'); return null; }
      MEDIA[j.id] = j.url; return { id: j.id, type: j.type };
    } catch (e) { toast('Não deu para enviar o arquivo. Confira a internet.'); return null; }
  }
  const id = 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  MEDIA[id] = URL.createObjectURL(blob); idb.put(id, blob);
  return { id, type };""")
rep("""let cart = [];""", """function hydrateMedia() { if (MODE === 'demo') return; S.products.forEach(p => (p.media || []).forEach(m => { if (m.id !== 'demo' && !MEDIA[m.id]) MEDIA[m.id] = '/u/' + m.id; })); }
hydrateMedia();
let cart = [];""")

# ---------- vitrine pública ----------
rep("""  if (s.online === false) { $('#view-loja').innerHTML = `<div class="offbar">Só você vê esta faixa: sua vitrine está fora do ar. <button class="more" id="goon">Ligar no painel</button></div>""",
    """  if (EMPTY_STORE) { $('#view-loja').innerHTML = `<div class="offpage"><h1 class="store-name">${esc(BOOT.store.name)}</h1><p>Esta vitrine está sendo preparada. Volte em breve!</p></div>`; return; }
  if (s.online === false) { $('#view-loja').innerHTML = `${MODE === 'store' ? '' : '<div class="offbar">Só você vê esta faixa: sua vitrine está fora do ar. <button class="more" id="goon">Ligar no painel</button></div>'}""")
rep("""    $('#goon').onclick = () => show('painel'); return; }""", """    if ($('#goon')) $('#goon').onclick = () => show('painel'); return; }""")
rep("""    ${s.footer ? `<p class="foot">${esc(s.footer)}</p>` : ''}`;""",
    """    ${s.footer ? `<p class="foot">${esc(s.footer)}</p>` : ''}
    `;""")
rep("""function openProduct(id) {
  const p = prod(id);""", """function openProduct(id) {
  const p = prod(id); track('pview', id);""")
rep("""  $('#buyn').onclick = () => { if (add()) openCart(); };""", """  $('#buyn').onclick = () => { if (add()) { track('click', id); openCart(); } };""")

# Pix no pedido: QR Code e copia e cola com o valor do pedido
rep("""    <div class="opt-label">Mensagem que será enviada</div>
    <div class="msg" id="msg"></div>""", """    <div class="pixbox" id="pixbox" hidden></div>
    <div class="opt-label">Mensagem que será enviada</div>
    <div class="msg" id="msg"></div>""")
rep("""  const upd = () => { const m = buildMsg(); $('#msg').textContent = m; $('#send').href = `https://wa.me/${S.store.phone.replace(/\\D/g,'')}?text=${encodeURIComponent(m)}`; };""",
"""  const upd = () => { const m = buildMsg(); $('#msg').textContent = m; $('#send').href = `https://wa.me/${S.store.phone.replace(/\\D/g,'')}?text=${encodeURIComponent(m)}`; showPix(); };
  $('#send').addEventListener('click', () => track('order'));""")
rep("""/* ---------- Painel ---------- */""", """let pixFor = null;
async function showPix() {
  const box = $('#pixbox'); if (!box) return;
  const t = totals().total; const want = /pix/i.test(co.pag || '') && S.store.pixKey && MODE !== 'demo' && t > 0;
  if (!want) { box.hidden = true; pixFor = null; return; }
  if (pixFor === t) return; pixFor = t; box.hidden = false; box.innerHTML = '<p class="note">Gerando o Pix...</p>';
  try {
    const r = await fetch(`/api/pix?s=${encodeURIComponent(BOOT.store.slug)}&v=${t.toFixed(2)}`); const j = await r.json(); if (!r.ok) throw new Error(j.error);
    if (pixFor !== t) return;
    box.innerHTML = `<div class="opt-label">Pague com Pix: ${brl(t)}</div><div class="pixqr">${j.svg}</div>
      <div class="pixcode"><code>${esc(j.code)}</code><button class="btn btn-soft" id="pixcopy">Copiar código Pix</button></div>
      <p class="note" style="margin:6px 0 0">Depois de pagar, envie o pedido e o comprovante no WhatsApp.</p>`;
    $('#pixcopy').onclick = () => copyText(j.code).then(ok => toast(ok ? 'Código Pix copiado' : 'Segure o código para copiar'));
  } catch (e) { box.innerHTML = '<p class="note">Não deu para gerar o Pix agora. Combine o pagamento pelo WhatsApp.</p>'; }
}

/* ---------- Painel ---------- */""")

# ---------- painel: link real, ligar/desligar ----------
rep("""const storeUrl = () => `${STORE_DOMAIN}/${slugOf()}`;""",
    """const fullUrl = () => MODE === 'demo' ? `https://${STORE_DOMAIN}/${slugOf()}` : BOOT.store.publicUrl;
const storeUrl = () => fullUrl().replace(/^https?:\\/\\//, '');""")
rep("""      <div class="slugbox" id="slugbox" hidden><label for="sslug">Final do link (só letras minúsculas, números e hífen)</label>
        <div class="slugrow"><span>${esc(STORE_DOMAIN)}/</span><input class="in" id="sslug" value="${esc(slugOf())}" autocomplete="off"></div></div>""",
"""      <div class="slugbox" id="slugbox" hidden><label for="sslug">Nome no link (só letras minúsculas, números e hífen)</label>
        <div class="slugrow"><input class="in" id="sslug" value="${esc(MODE === 'demo' ? slugOf() : BOOT.store.slug)}" autocomplete="off"><button class="tg" id="saveslug">Salvar</button></div>
        <p class="err" id="slugerr" hidden></p></div>""")
rep("""  $('#copylink').onclick = async () => { const ok = await copyText('https://' + storeUrl());""", """  $('#copylink').onclick = async () => { const ok = await copyText(fullUrl());""")
rep("""  $('#sharelink').onclick = async () => { const url = 'https://' + storeUrl();""", """  $('#sharelink').onclick = async () => { const url = fullUrl();""")
rep("""  $('#sslug').oninput = e => { const v = slugify(e.target.value); s.slug = v; $('#surl').textContent = storeUrl(); save(); };
  $('#sslug').onblur = e => { e.target.value = slugOf(); };""",
"""  $('#saveslug').onclick = async () => { const v = slugify($('#sslug').value); $('#slugerr').hidden = true;
    if (MODE === 'demo') { s.slug = v; save(); renderPainel(); return; }
    const r = await fetch('/api/slug', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug: v }) }); const j = await r.json();
    if (!r.ok) { $('#slugerr').textContent = j.error; $('#slugerr').hidden = false; return; }
    BOOT.store = { ...BOOT.store, ...j.store }; renderPainel(); toast('Link atualizado. O endereço antigo deixou de funcionar.'); };""")

# ---------- painel: plano, relatórios, Pix, marketing, domínio, conta ----------
rep("""    <div class="stats">""", """    ${MODE === 'panel' ? planCard() : ''}
    <div class="stats">""")
rep("""    <h3 class="pgroup">Vendas e contato<small>WhatsApp, links e depoimentos</small></h3>""",
"""    ${MODE === 'panel' ? `<h3 class="pgroup">Relatórios<small>Visitas, cliques e pedidos da sua vitrine</small></h3>
    ${sec('relatorio', 'Desempenho da vitrine', 'Últimos 30 dias', '<div id="statsbox"><p class="note">Carregando...</p></div>')}` : ''}
    <h3 class="pgroup">Vendas e contato<small>WhatsApp, Pix, links e depoimentos</small></h3>
    ${sec('pix', 'Pix no pedido', s.pixKey ? 'Chave cadastrada: QR Code no pedido' : 'Mostre o QR Code com o valor do pedido', `
      <p class="note" style="margin:0 0 4px">Quando a cliente escolhe Pix, aparece o QR Code e o código copia e cola já com o valor do pedido. O dinheiro cai direto na sua conta.</p>
      ${f('spixkey', 'Chave Pix (CPF, CNPJ, e-mail, celular com +55 ou chave aleatória)', s.pixKey || '')}
      <div class="two">${f('spixname', 'Nome do recebedor', s.pixName || '')}${f('spixcity', 'Cidade', s.pixCity || '')}</div>
      <p class="note">A forma de pagamento precisa ter a palavra Pix (veja em Carrinho e pedido no WhatsApp).</p>`)}""")
rep("""    <h3 class="pgroup">Ajuda<small>Tamanhos ideais e exemplos prontos</small></h3>""",
"""    ${MODE === 'panel' ? `<h3 class="pgroup">Divulgação<small>Anúncios e endereço próprio</small></h3>
    ${sec('marketing', 'Pixel do Meta e Google Analytics', proOk() ? (s.metaPixel || s.gaId ? 'Ativo' : 'Meça os resultados dos seus anúncios') : 'Disponível com a assinatura ativa', `
      ${proOk() ? '' : '<p class="pronote">Assine para medir visitas e vendas dos seus anúncios no Instagram, Facebook e Google.</p>'}
      ${f('spixel', 'ID do Pixel do Meta (só números)', s.metaPixel || '', proOk() ? 'inputmode="numeric" placeholder="123456789012345"' : 'disabled')}
      ${f('sga', 'ID do Google Analytics (começa com G-)', s.gaId || '', proOk() ? 'placeholder="G-XXXXXXXXXX"' : 'disabled')}
      <p class="note">A vitrine envia visita, produto visto, clique no Eu quero e pedido enviado.</p>`)}
    ${sec('dominio', 'Domínio próprio', proOk() ? (BOOT.store.customDomain ? esc(BOOT.store.customDomain) : 'Use o endereço da sua marca') : 'Disponível com a assinatura ativa', `
      ${proOk() ? '' : '<p class="pronote">Com a assinatura ativa, sua vitrine pode abrir em www.sualoja.com.br.</p>'}
      <div class="field"><label for="sdomain">Seu domínio</label><div class="slugrow"><input class="in" id="sdomain" value="${esc(BOOT.store.customDomain || '')}" placeholder="minhaloja.com.br" ${proOk() ? '' : 'disabled'}><button class="tg" id="savedomain" ${proOk() ? '' : 'disabled'}>Salvar</button></div></div>
      <p class="err" id="domerr" hidden></p>
      <ol class="steps"><li>Compre o domínio (Registro.br, Hostinger, GoDaddy...).</li><li>No painel de onde comprou, crie um registro <b>CNAME</b> com nome <b>www</b> apontando para <b>${esc(new URL(BOOT.home).hostname)}</b>.</li><li>Salve o domínio aqui. A mudança pode levar algumas horas para valer.</li></ol>`)}` : ''}
    <h3 class="pgroup">Ajuda<small>Tamanhos ideais e exemplos prontos</small></h3>""")
rep("""    <button class="pbtn ghost" id="reset">Voltar ao exemplo original</button>`;""",
"""    ${MODE === 'panel' ? `<h3 class="pgroup">Sua conta</h3>
    ${sec('conta', esc(BOOT.user.name), esc(BOOT.user.email), `
      <div class="two"><div class="field"><label for="pwcur">Senha atual</label><input class="in" id="pwcur" type="password" autocomplete="current-password"></div>
        <div class="field"><label for="pwnew">Nova senha</label><input class="in" id="pwnew" type="password" autocomplete="new-password" placeholder="4 caracteres ou mais"></div></div>
      <button class="pbtn" id="pwsave">Trocar senha</button><p class="err" id="pwerr" hidden></p>
      ${BOOT.user.admin ? '<a class="pbtn ghost" href="/admin" style="display:block;text-align:center;text-decoration:none;margin-top:8px">Abrir o painel da plataforma</a>' : ''}
      <a class="pbtn ghost" href="/sair" style="display:block;text-align:center;text-decoration:none;margin-top:8px">Sair da conta</a>`)}
    <p class="legal"><a href="/termos" target="_blank">Termos de uso</a> · <a href="/privacidade" target="_blank">Privacidade</a></p>`
    : '<button class="pbtn ghost" id="reset">Voltar ao exemplo original</button>'}`;""")
rep("""  $('#reset').onclick = () =>""", """  if ($('#reset')) $('#reset').onclick = () =>""")
rep("""  document.querySelectorAll('details[data-sec]').forEach(el => el.ontoggle""", """  if (MODE === 'panel') bindPanelExtras(s);
  document.querySelectorAll('details[data-sec]').forEach(el => el.ontoggle""")
rep("""function show(view) {""", """const proOk = () => MODE === 'demo' || BOOT.store.plan !== 'expired';
const fmtDate = t => new Date(t).toLocaleDateString('pt-BR');
function planCard() {
  const st = BOOT.store;
  if (st.plan === 'open') return ''; // cobrança ainda não ligada: nada de assinatura no painel
  const label = st.plan === 'pro' ? 'Assinatura ativa' : st.plan === 'trial' ? 'Teste grátis' : 'Assinatura vencida';
  const sub = st.plan === 'pro' ? `${st.subscribed ? 'Renova' : 'Vale'} até ${fmtDate(st.proUntil)}` : st.plan === 'trial' ? `Termina em ${fmtDate(st.trialUntil)}. Assine para a vitrine continuar no ar.` : 'Sua vitrine está fora do ar para as clientes.';
  return `<section class="plan plan-${st.plan}"><div class="plan-top"><div><b>${label}</b><small>${sub}</small></div>
    ${st.plan === 'pro' && st.subscribed ? '<button class="tg" id="plancancel">Cancelar</button>' : `<button class="hcopy" id="planbuy" data-plan="mensal">${st.plan === 'pro' ? 'Renovar' : 'Assinar'} · ${brl(st.proPrice)}/mês</button>`}</div>
    ${st.yearPrice && !(st.plan === 'pro' && st.subscribed) ? `<button class="hcopy" id="planyear" data-plan="anual" style="margin-top:8px;width:100%">Plano anual · ${brl(st.yearPrice)}/ano (sai ${brl(st.yearPrice / 12)} por mês)</button>` : ''}
    ${st.plan === 'pro' && !st.subscribed && st.proUntil - Date.now() < 5 * 864e5 ? `<p class="plan-warn">Sua assinatura vence em ${Math.max(0, Math.ceil((st.proUntil - Date.now()) / 864e5))} dia(s). Renove para a vitrine não sair do ar.</p>` : ''}
    ${st.lastPayment && st.lastPayment !== 'approved' ? `<p class="plan-warn">O último pagamento não foi aprovado. Confira o cartão ${st.payments === 'kiwify' ? 'no e-mail da compra da Kiwify' : 'no Mercado Pago'} para a assinatura continuar.</p>` : ''}
    ${st.plan === 'expired' ? '<p class="plan-warn">Assine para colocar a vitrine de volta no ar. Seus produtos e configurações continuam salvos.</p>' : ''}
    ${st.payments === 'kiwify' && st.plan !== 'pro' ? '<p class="note" style="margin:6px 0 0">O pagamento é pela Kiwify. Use na compra o mesmo e-mail da sua conta: assim a loja é liberada sozinha.</p>' : ''}
    ${st.payments === 'teste' ? '<p class="note" style="margin:6px 0 0">Modo de teste: o pagamento é simulado.</p>' : ''}</section>`;
}
async function api(method, url, body) {
  const r = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 401) { location.href = '/entrar'; throw new Error('sessão'); }
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Algo deu errado.'); return j;
}
function bindPanelExtras(s) {
  const bindS = (id, key) => { const el = $('#' + id); if (el) el.oninput = () => { s[key] = el.value.trim(); save(); }; };
  bindS('spixkey', 'pixKey'); bindS('spixname', 'pixName'); bindS('spixcity', 'pixCity'); bindS('spixel', 'metaPixel'); bindS('sga', 'gaId');
  const buy = async b => { b.disabled = true;
    try { const j = await api('POST', '/api/billing/checkout', { plan: b.dataset.plan }); if (j.url) { location.href = j.url; return; } if (j.store) { BOOT.store = { ...BOOT.store, ...j.store }; renderPainel(); renderLoja(); toast('Assinatura ativada'); } }
    catch (e) { toast(e.message); b.disabled = false; } };
  ['#planbuy', '#planyear'].forEach(id => { if ($(id)) $(id).onclick = () => buy($(id)); });
  // Veio da página de vendas com um plano escolhido: abre o pagamento dele uma vez
  const want = new URLSearchParams(location.search).get('plano');
  if (want && BOOT.store.plan !== 'pro') { history.replaceState(null, '', location.pathname); const b = want === 'anual' && $('#planyear') ? $('#planyear') : $('#planbuy'); if (b) buy(b); }
  if ($('#plancancel')) $('#plancancel').onclick = async () => { if (!confirm('Cancelar a assinatura? A vitrine continua no ar até o fim do período já pago e depois sai do ar.')) return;
    try { const j = await api('POST', '/api/billing/cancel'); BOOT.store = { ...BOOT.store, ...j.store }; renderPainel(); toast('Assinatura cancelada'); } catch (e) { toast(e.message); } };
  if ($('#savedomain')) $('#savedomain').onclick = async () => { $('#domerr').hidden = true;
    try { const j = await api('PUT', '/api/domain', { domain: $('#sdomain').value }); BOOT.store = { ...BOOT.store, ...j.store }; renderPainel(); toast('Domínio salvo'); }
    catch (e) { $('#domerr').textContent = e.message; $('#domerr').hidden = false; } };
  $('#pwsave').onclick = async () => { $('#pwerr').hidden = true;
    try { await api('POST', '/api/password', { current: $('#pwcur').value, next: $('#pwnew').value }); $('#pwcur').value = $('#pwnew').value = ''; toast('Senha trocada'); }
    catch (e) { $('#pwerr').textContent = e.message; $('#pwerr').hidden = false; } };
  const rel = document.querySelector('details[data-sec="relatorio"]');
  const load = () => loadStats(); rel.addEventListener('toggle', () => { if (rel.open) load(); }); if (rel.open) load();
}
async function loadStats() {
  const box = $('#statsbox'); if (!box) return;
  try {
    const j = await api('GET', '/api/stats?days=30'); const max = Math.max(1, ...j.series.map(d => d.n));
    const nameOf = id => (S.products.find(p => String(p.id) === String(id)) || {}).name || 'Produto removido';
    box.innerHTML = `<div class="kpis">${[['view', 'Visitas'], ['pview', 'Produtos vistos'], ['click', 'Cliques no Eu quero'], ['order', 'Pedidos enviados']].map(([k, l]) => `<div class="kpi"><b>${j.totals[k].toLocaleString('pt-BR')}</b><span>${l}</span></div>`).join('')}</div>
      <div class="bars" role="img" aria-label="Visitas por dia nos últimos 30 dias">${j.series.map(d => `<i style="height:${Math.round(d.n / max * 100)}%" title="${d.day.split('-').reverse().join('/')}: ${d.n} visitas"></i>`).join('')}</div>
      <div class="bars-x"><span>${j.series[0].day.split('-').reverse().slice(0, 2).join('/')}</span><span>hoje</span></div>
      ${j.top.length ? `<div class="opt-label" style="margin-top:14px">Produtos mais procurados</div><ol class="toplist">${j.top.map(t => `<li><span>${esc(nameOf(t.id))}</span><small>${t.pview} vistas · ${t.click} cliques</small></li>`).join('')}</ol>` : ''}
      ${j.totals.view ? `<p class="note">Conversão: ${((j.totals.order / j.totals.view) * 100).toFixed(1).replace('.', ',')}% das visitas viraram pedido no WhatsApp.</p>` : '<p class="note">Ainda sem visitas. Compartilhe o link da vitrine no Instagram e no WhatsApp.</p>'}`;
  } catch (e) { box.innerHTML = `<p class="note">${esc(e.message)}</p>`; }
}

function show(view) {""")

# assinatura vencida: o cartão do topo avisa que a vitrine está fora do ar
rep("""<b>${s.online === false ? 'Vitrine fora do ar' : 'Vitrine no ar'}</b><small>${s.online === false ? 'As clientes veem um aviso de pausa' : 'Suas clientes já podem ver e pedir'}</small>""",
    """<b>${expired() ? 'Vitrine fora do ar' : s.online === false ? 'Vitrine fora do ar' : 'Vitrine no ar'}</b><small>${expired() ? 'Assinatura vencida: assine para voltar' : s.online === false ? 'As clientes veem um aviso de pausa' : 'Suas clientes já podem ver e pedir'}</small>""")
rep("""<section class="hero ${s.online === false ? 'is-off' : ''}">""", """<section class="hero ${s.online === false || expired() ? 'is-off' : ''}">""")
rep("""const proOk = () =>""", """const expired = () => MODE === 'panel' && BOOT.store.plan === 'expired';
const proOk = () =>""")

# ---------- inicialização ----------
rep("""applyColors(); show('loja');
idb.loadAll().then(() => { if (!$('#view-loja').hidden) renderLoja(); else renderPainel(); });""",
"""if (MODE === 'panel') { $('#brandtag').innerHTML = `<img src="/static/logo.svg" alt=""><span>${esc(BOOT.brand)}</span>`; $('#logout').hidden = false; }
applyColors(); show(MODE === 'panel' && !PV ? 'painel' : 'loja');
if (MODE === 'demo') idb.loadAll().then(() => { if (!$('#view-loja').hidden) renderLoja(); else renderPainel(); });
if (MODE === 'store') track('view');
if (MODE === 'panel' && FRESH && !PV) save();
// App no celular: instalar na tela inicial (Android mostra o botão; no iPhone, explica o caminho)
if (MODE === 'panel' && !PV) {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  let bip = null; let hideInst = false; try { hideInst = localStorage.getItem('vz-noinst') === '1'; } catch (e) {}
  const addInstall = () => {
    if (standalone || hideInst || (!bip && !ios)) return;
    const st = document.querySelector('#view-painel > .stats'); if (!st || $('#instcard')) return;
    const d = document.createElement('section'); d.className = 'inst'; d.id = 'instcard'; d.dataset.tab = 'inicio';
    if (pui.tab && pui.tab !== 'inicio') d.classList.add('offtab');
    d.innerHTML = `<img src="/static/icon-192.png" alt=""><div><b>Use como aplicativo</b><small>${bip ? 'Coloque o painel na tela inicial do celular' : 'No Safari, toque em Compartilhar e depois em <b>Adicionar à Tela de Início</b>'}</small></div>
      ${bip ? '<button class="hcopy" id="instgo">Instalar</button>' : ''}<button class="instx" id="instx" aria-label="Fechar">×</button>`;
    st.after(d);
    if (bip) $('#instgo').onclick = async () => { bip.prompt(); const c = await bip.userChoice.catch(() => ({})); if (c.outcome === 'accepted') { bip = null; d.remove(); } };
    $('#instx').onclick = () => { hideInst = true; try { localStorage.setItem('vz-noinst', '1'); } catch (e) {} d.remove(); };
  };
  addEventListener('beforeinstallprompt', e => { e.preventDefault(); bip = e; addInstall(); });
  addEventListener('appinstalled', () => { bip = null; const d = $('#instcard'); if (d) d.remove(); });
  const rp1 = renderPainel; renderPainel = function () { rp1.apply(this, arguments); addInstall(); };
  addInstall();
}
if (MODE === 'panel' && /assinatura=ok/.test(location.search)) { toast('Pagamento recebido. Assim que o Mercado Pago confirmar, o Pro é ativado.'); history.replaceState(null, '', '/painel'); }""")

# exemplo carregado: liga as mídias
rep("""S.products = e.products.map(normP); applyColors();""", """S.products = e.products.map(normP); hydrateMedia(); applyColors();""")

# ---------- estilos novos ----------
rep("""/* Cards sem moldura */""", """.inst { display: flex; align-items: center; gap: 12px; margin-top: 12px; background: var(--p-surface); border: 1px solid var(--p-line); border-radius: 18px; padding: 12px 14px; position: relative; }
.inst img { width: 44px; height: 44px; border-radius: 12px; flex: none; }
.inst div { flex: 1; min-width: 0; } .inst b { display: block; font-size: 14.5px; } .inst small { display: block; color: var(--p-muted); font-size: 12px; }
.inst .instx { border: 0; background: none; color: var(--p-muted); font-size: 20px; width: 28px; height: 28px; flex: none; }
/* Versão com servidor */
.m-store .topbar, .m-store.painel .topbar { display: none; }
.m-store::before { display: none; }
.tlink { font-size: 13px; font-weight: 600; color: var(--p-muted); text-decoration: none; padding: 6px 4px 6px 8px; }
.m-panel .demo-tag { white-space: nowrap; font-weight: 700; letter-spacing: .06em; }
.m-panel .demo-tag { display: inline-flex; align-items: center; gap: 7px; } .m-panel .demo-tag img { width: 24px; height: 24px; }
@media (max-width: 480px) { .m-panel .demo-tag span { display: none; } }
.savest { white-space: nowrap; font-size: 11.5px; color: var(--p-muted); margin-right: 6px; }
.savest[data-st="ok"]::before { content: "✓ "; color: #1FA855; }
.savest[data-st="err"] { color: #C0392B; font-weight: 700; }
.madewith { text-align: center; margin: 18px 0 0; font-size: 12px; } .madewith a { color: var(--c-muted); text-decoration: none; }
.plan { margin-top: 14px; background: var(--p-surface); border: 1px solid var(--p-line); border-radius: 18px; padding: 14px 16px; }
.plan-pro { border-color: #1FA855; } .plan-expired { border-color: #C0392B; }
.plan-top { display: flex; align-items: center; gap: 12px; justify-content: space-between; }
.plan-top b { display: block; font-size: 15px; } .plan-top small { color: var(--p-muted); font-size: 12px; }
.plan-list { margin: 10px 0 0; padding: 0; list-style: none; display: grid; grid-template-columns: 1fr 1fr; gap: 4px 10px; font-size: 12px; color: var(--p-muted); }
.plan-list li::before { content: "✓ "; color: var(--p-acc); font-weight: 700; }
.plan-warn { margin: 10px 0 0; font-size: 12.5px; background: #FFF4E5; color: #8A4B00; border-radius: 10px; padding: 8px 10px; }
.pronote { margin: 0 0 6px; font-size: 12.5px; background: var(--p-soft); border-radius: 10px; padding: 8px 10px; }
.steps { margin: 12px 0 0; padding-left: 18px; font-size: 12.5px; color: var(--p-muted); display: grid; gap: 4px; }
.kpis { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.kpi { background: var(--p-soft); border-radius: 12px; padding: 10px 12px; } .kpi b { display: block; font-size: 20px; font-variant-numeric: tabular-nums; } .kpi span { font-size: 11.5px; color: var(--p-muted); }
.bars { display: flex; align-items: flex-end; gap: 2px; height: 70px; margin-top: 14px; }
.bars i { flex: 1; min-height: 2px; background: var(--p-acc); border-radius: 3px 3px 0 0; opacity: .85; }
.bars-x { display: flex; justify-content: space-between; font-size: 10.5px; color: var(--p-muted); margin-top: 4px; }
.toplist { margin: 6px 0 0; padding-left: 18px; display: grid; gap: 6px; font-size: 13px; } .toplist small { display: block; color: var(--p-muted); font-size: 11.5px; }
.legal { text-align: center; font-size: 12px; margin: 22px 0 0; } .legal a { color: var(--p-muted); }
.pixbox { margin-top: 12px; border: 1px solid var(--c-cardBorder); border-radius: 14px; padding: 12px; }
.pixqr { display: grid; place-items: center; margin: 8px 0; } .pixqr svg { width: 200px; height: 200px; }
.pixcode { display: grid; gap: 8px; } .pixcode code { font-size: 10.5px; word-break: break-all; background: var(--c-bg); padding: 8px; border-radius: 8px; max-height: 64px; overflow: auto; }
/* Cards sem moldura */""")

# ---------- robô do WhatsApp: seção no painel e produtos que chegam enquanto o painel está aberto ----------
rep("""const sync = { t: 0, busy: false, dirty: false };""", """const sync = { t: 0, busy: false, dirty: false, base: (BOOT.store && BOOT.store.savedAt) || 0 };""")
rep("""body: JSON.stringify({ state: S }) });""", """body: JSON.stringify({ state: S, base: sync.base }) });""")
rep("""    swapUrls(S, j.state); setSaveState""", """    swapUrls(S, j.state); mergeWa(j.state.products, j.state.cats); sync.base = j.savedAt || sync.base; setSaveState""")
rep("""    <h3 class="pgroup">Produtos<small>Cadastre, organize e controle o estoque</small></h3>""",
"""    <h3 class="pgroup">Produtos<small>Cadastre, organize e controle o estoque</small></h3>
    ${MODE === 'panel' && BOOT.wa ? sec('whats', 'Cadastrar pelo WhatsApp', 'Mande foto e texto, o produto entra sozinho', '<div id="wabox"><p class="note">Carregando...</p></div>') : ''}""")
rep("""  const rel = document.querySelector('details[data-sec="relatorio"]');""", """  const wsec = document.querySelector('details[data-sec="whats"]');
  if (wsec) { wsec.addEventListener('toggle', () => { if (wsec.open) loadWa(); }); if (wsec.open) loadWa(); }
  const rel = document.querySelector('details[data-sec="relatorio"]');""")
rep("""async function loadStats() {""", """// Produtos que o robô do WhatsApp cadastrou entram no painel sem recarregar a página
function mergeWa(list, cats) {
  let added = [];
  (list || []).forEach(p => { if (!p.waAt) return;
    const cur = S.products.find(x => String(x.id) === String(p.id));
    if (!cur) { if (p.waAt > sync.base) { S.products.unshift(normP(p)); added.push(p.name); } }
    else if (p.waAt > (cur.waAt || 0)) { cur.media = p.media; cur.waAt = p.waAt; } });
  (cats || []).forEach(c => { if (!S.cats.includes(c) && S.products.some(p => p.cat === c)) S.cats.push(c); });
  if (!added.length) return;
  hydrateMedia();
  toast(added.length === 1 ? `Chegou pelo WhatsApp: ${added[0]}` : `${added.length} produtos chegaram pelo WhatsApp`);
  const a = document.activeElement;
  if (!(a && a.closest && a.closest('#view-painel') && a.matches('input, textarea, select'))) { if ($('#view-painel').hidden) renderLoja(); else renderPainel(); }
  if (typeof pvPush === 'function') pvPush();
}
async function pollWa() {
  if (document.hidden || sync.busy) return;
  try { const j = await api('GET', '/api/wa/new?since=' + sync.base); mergeWa(j.products, j.cats); j.products.forEach(p => { sync.base = Math.max(sync.base, p.waAt); }); } catch (e) {}
}
if (MODE === 'panel' && !PV) setInterval(pollWa, 20000);
let WA = null;
async function loadWa(force) {
  const box = $('#wabox'); if (!box) return;
  try { if (!WA || force) WA = await api('GET', '/api/wa'); renderWa(); } catch (e) { box.innerHTML = `<p class="note">${esc(e.message)}</p>`; }
}
const fmtPhone = p => '+' + String(p).replace(/^(\\d{2})(\\d{2})(\\d{4,5})(\\d{4})$/, '$1 ($2) $3-$4');
function renderWa() {
  const box = $('#wabox'); if (!box || !WA) return;
  if (!WA.enabled) { const d = box.closest('details'); if (d) d.hidden = true; return; } // robô desligado na plataforma: a opção nem aparece
  const link = WA.code && WA.number ? `https://wa.me/${WA.number}?text=${encodeURIComponent('ZAP-' + WA.code)}` : '';
  box.innerHTML = `<p class="note" style="margin:0 0 12px">Mande a foto do produto com o texto no modelo para o WhatsApp ${WA.number ? `<b>${fmtPhone(WA.number)}</b>` : 'da plataforma'}. O produto aparece na sua vitrine na hora.</p>
    ${WA.phones.length ? `<div class="opt-label">Números ligados à sua loja</div><div class="walist">${WA.phones.map(p => `<div class="warow"><span>${fmtPhone(p.phone)}</span><button class="tg danger" data-waoff="${esc(p.phone)}">Desligar</button></div>`).join('')}</div>` : ''}
    ${WA.code ? `<div class="wacode"><small>Seu código</small><b>ZAP-${esc(WA.code)}</b><span>Mande este código, do seu celular, para o WhatsApp do robô. Vale por 30 minutos.</span>
        ${link ? `<a class="pbtn" href="${link}" target="_blank" rel="noopener">Abrir o WhatsApp com o código</a>` : ''}<button class="tg" id="wacheck">Já mandei</button></div>`
      : `<button class="pbtn ${WA.phones.length ? 'ghost' : ''}" id="wacode">${WA.phones.length ? 'Ligar outro número' : 'Ligar meu WhatsApp'}</button>`}
    <div class="opt-label" style="margin-top:16px">Modelo da mensagem</div>
    <pre class="watpl">${esc(WA.template)}</pre>
    <button class="tg" id="watplcopy">Copiar modelo</button>
    <p class="note">Nome e Preço são obrigatórios. Pode mandar várias fotos antes do texto. Fotos sem legenda logo depois do cadastro entram no mesmo produto.</p>`;
  if ($('#wacode')) $('#wacode').onclick = async () => { try { WA = await api('POST', '/api/wa/code'); renderWa(); } catch (e) { toast(e.message); } };
  if ($('#wacheck')) $('#wacheck').onclick = async () => { const n = WA.phones.length; await loadWa(true); toast(WA.phones.length > n ? 'WhatsApp ligado!' : 'Ainda não chegou. Confira se mandou o código certinho.'); };
  $('#watplcopy').onclick = async () => toast(await copyText(WA.template) ? 'Modelo copiado' : 'Não deu para copiar');
  box.querySelectorAll('[data-waoff]').forEach(b => b.onclick = async () => { if (!confirm('Desligar este número? Ele não vai mais cadastrar produtos na sua loja.')) return;
    try { WA = await api('DELETE', '/api/wa/phone/' + b.dataset.waoff); renderWa(); toast('Número desligado'); } catch (e) { toast(e.message); } });
}
async function loadStats() {""")
rep("""/* Cards sem moldura */""", """.walist { display: grid; gap: 6px; margin: 6px 0 12px; }
.warow { display: flex; align-items: center; justify-content: space-between; gap: 10px; background: var(--p-soft); border-radius: 12px; padding: 8px 10px 8px 12px; font-size: 14px; font-variant-numeric: tabular-nums; }
.wacode { display: grid; gap: 8px; text-align: center; background: var(--p-soft); border-radius: 16px; padding: 14px; }
.wacode small { font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--p-muted); }
.wacode b { font-size: 28px; letter-spacing: .08em; font-variant-numeric: tabular-nums; }
.wacode span { font-size: 12.5px; color: var(--p-muted); }
.wacode a.pbtn { text-decoration: none; display: block; }
.watpl { margin: 6px 0 8px; background: var(--p-soft); border-radius: 12px; padding: 10px 12px; font: 12.5px/1.5 ui-monospace, Menlo, Consolas, monospace; white-space: pre-wrap; }
/* Cards sem moldura */""")

open(os.path.join(ROOT, 'public', 'app.html'), 'w', encoding='utf-8').write(s)
print('public/app.html gerado')
