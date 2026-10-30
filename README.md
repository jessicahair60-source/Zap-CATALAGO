# Vitrine Zap

Plataforma de vitrines para o link da bio: catálogo com fotos e vídeos, pedido pronto no WhatsApp, Pix com QR Code e assinatura mensal.

## O que tem

- **Página de vendas** (`/`), **cadastro e login** (`/cadastro`, `/entrar`), **termos** e **privacidade**.
- **Vitrine de cada loja** em `/nome-da-loja`, em `nome-da-loja.SEU_DOMINIO` (com `BASE_DOMAIN`) ou no domínio próprio da lojista (plano Pro).
- **Painel da lojista** (`/painel`): link da vitrine com copiar e compartilhar, chave no ar e fora do ar, produtos, fotos e vídeos, banner, cores, Pix, relatórios, Pixel do Meta, Google Analytics, domínio próprio, assinatura e troca de senha.
- **Painel da plataforma** (`/admin`, só para os e-mails em `ADMIN_EMAILS`): receita mensal, lojas por plano, busca, ver vitrine, dar Pro, passar para Grátis, gerar senha nova, bloquear e desbloquear, e pagamentos recentes.
- **Planos**: Grátis (limite de produtos e marca no rodapé) e Pro (mensal pelo Mercado Pago). Contas novas ganham dias de teste do Pro. Quando o Pro vence ou não é pago, a loja volta para o Grátis sem perder nada.

## Rodar no computador

```bash
npm install
cp .env.example .env    # ajuste ADMIN_EMAILS com o seu e-mail
npm start               # abre em http://localhost:3000
npm test                # testes automáticos
```

Sem `MP_ACCESS_TOKEN` e fora de produção, o botão "Assinar Pro" simula o pagamento, para testar.

## Colocar no ar

Precisa de um servidor com Node.js 20 ou mais novo e um disco que não seja apagado a cada atualização (para o banco e as fotos, na pasta `DATA_DIR`).

1. Suba o código, rode `npm ci --omit=dev` e `npm start` (ou use o `Dockerfile`).
2. Preencha as variáveis do `.env.example` no painel da hospedagem. `NODE_ENV=production` é obrigatório no ar.
3. Aponte o domínio para o servidor com HTTPS.
4. Para subdomínios das lojas (`loja.seudominio.com.br`), crie um registro DNS curinga `*` para o servidor e preencha `BASE_DOMAIN`.
5. Mercado Pago:
   - Em Credenciais, copie o Access Token de produção para `MP_ACCESS_TOKEN`.
   - Em Webhooks, cadastre `https://SEU_DOMINIO/api/webhooks/mp` com os eventos de assinaturas (planos e pagamentos autorizados).
   - Copie a chave secreta do webhook para `MP_WEBHOOK_SECRET`.
6. Crie a sua conta pelo `/cadastro` com o e-mail que está em `ADMIN_EMAILS`. O link do painel da plataforma aparece em "Sua conta".

**Backup:** copie a pasta `DATA_DIR` inteira (arquivo `vitrine.db` e pasta `uploads`) todos os dias.

## Antes de vender

- Escolha o nome da marca (`BRAND_NAME`) e troque o texto "Vitrine Zap" nas páginas da pasta `public/`.
- Preencha os campos entre colchetes em `public/termos.html` e `public/privacidade.html` (razão social, CNPJ, e-mail, cidade). Vale pedir para um advogado revisar.
- Se mudar preço, limite ou dias de teste no `.env`, ajuste também os textos de `public/index.html`.

## Como o código está organizado

| Arquivo | O que faz |
|---|---|
| `server.js` | Rotas, login, planos, vitrines, painel da plataforma e webhooks |
| `lib/db.js` | Banco SQLite (tabelas criadas sozinhas na primeira vez) |
| `lib/pix.js` | Código Pix copia e cola |
| `lib/mercadopago.js` | Assinatura mensal no Mercado Pago |
| `public/app.html` | Vitrine e painel da lojista. **Gerado** por `npm run build` a partir de `tools/prototipo.html` (o protótipo aprovado) e `tools/build_app.py` |
| `public/*.html` | Página de vendas, entrar, termos, privacidade e painel da plataforma |
| `test/api.test.js` | Testes de ponta a ponta |

Para mudar o visual da vitrine ou do painel, edite `tools/prototipo.html` (ou as trocas em `tools/build_app.py`) e rode `npm run build`.

## Ainda não tem

- Recuperação de senha por e-mail. Por enquanto, a dona da plataforma gera uma senha nova no `/admin`.
- Limpeza automática de fotos que foram apagadas dos produtos.
- Verificação automática do DNS do domínio próprio e emissão do certificado HTTPS para ele. Isso depende da hospedagem: por exemplo, Caddy com certificado sob demanda, ou Cloudflare for SaaS.
