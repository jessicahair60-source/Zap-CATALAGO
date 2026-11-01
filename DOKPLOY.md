# Colocar no ar pelo Dokploy

O Dokploy usa o `Dockerfile` que já está no repositório. Siga os passos na ordem.

## Antes de começar

- Uma VPS com o Dokploy instalado (na Hostinger, dá para criar a VPS já com o modelo "Dokploy").
- O domínio da plataforma, por exemplo `vitrinezap.com.br`.
- O Access Token de produção do Mercado Pago (pode ser colocado depois; sem ele o botão Assinar não funciona no ar).

## 1. Apontar o domínio para a VPS

No lugar onde você comprou o domínio (Hostinger, Registro.br...), crie estes registros DNS, usando o IP da sua VPS:

| Tipo | Nome | Valor |
|---|---|---|
| A | @ | IP da VPS |
| A | www | IP da VPS |

A mudança pode levar de alguns minutos a algumas horas.

## 2. Ligar o GitHub ao Dokploy

1. No Dokploy, abra **Settings > Git > GitHub** e clique em **Create GitHub App**.
2. Autorize e, na tela do GitHub, dê acesso ao repositório **Zap-CATALAGO**.

## 3. Criar o aplicativo

1. Em **Projects**, clique em **Create Project** e dê o nome `Vitrine Zap`.
2. Dentro do projeto, clique em **Create Service > Application** e dê o nome `vitrinezap`.
3. Na aba **General**:
   - **Provider:** GitHub
   - **Repository:** Zap-CATALAGO
   - **Branch:** main
   - **Build Type:** Dockerfile (o caminho é `Dockerfile`)
   - Clique em **Save**.

## 4. Configurações (aba Environment)

Cole o texto abaixo, troque o que está em maiúsculas e clique em **Save**:

```
NODE_ENV=production
PORT=3000
DATA_DIR=/app/data
PUBLIC_URL=https://SEU-DOMINIO.com.br
BRAND_NAME=Vitrine Zap
ADMIN_EMAILS=jessicahair60@gmail.com
ADMIN_HOST=
PLAN_PRICE=47.00
KIWIFY_TOKEN=
KIWIFY_CHECKOUT_URL=
KIWIFY_CHECKOUT_ANUAL=
MP_ACCESS_TOKEN=
MP_WEBHOOK_SECRET=
BASE_DOMAIN=
WA_TOKEN=
WA_PHONE_ID=
WA_NUMBER=
WA_VERIFY_TOKEN=
WA_APP_SECRET=
```

Deixe `BASE_DOMAIN` vazio por enquanto. Assim as lojas ficam em `seu-dominio.com.br/nome-da-loja`.

## 5. Disco para não perder fotos e dados (aba Advanced > Volumes)

Este passo é obrigatório. Sem ele, cada atualização apaga as lojas e as fotos.

1. Clique em **Add Volume**.
2. Escolha **Volume Mount**.
3. **Volume Name:** `vitrinezap-data`
4. **Mount Path:** `/app/data`
5. Salve.

## 6. Domínio e HTTPS (aba Domains)

1. Clique em **Add Domain**.
2. **Host:** `seu-dominio.com.br`
3. **Path:** `/`
4. **Container Port:** `3000`
5. Ligue **HTTPS** e escolha **Let's Encrypt** como certificado.
6. Salve. Repita com `www.seu-dominio.com.br` se quiser que o www também funcione.

## 7. Publicar

1. Volte na aba **General** e clique em **Deploy**.
2. Acompanhe em **Deployments** até aparecer **Done** (leva de 2 a 5 minutos na primeira vez).
3. Abra `https://seu-dominio.com.br`. Deve aparecer a página de vendas.

Para atualizar sozinho a cada mudança no GitHub, ligue **Autodeploy** na aba General.

## 8. Entrar na administração

Abra `https://seu-dominio.com.br/admin`. Na primeira vez, toque em **Primeiro acesso? Criar minha senha** e use o e-mail que está em `ADMIN_EMAILS`. Essa conta é só da administração e não cria loja.

### Endereço só da administração (opcional)

Para abrir a administração em `adm.seu-dominio.com.br`:

1. No DNS do domínio, crie o registro **A** com nome **adm** apontando para o IP da VPS.
2. No Dokploy, aba **Domains**, adicione o host `adm.seu-dominio.com.br`, Path `/`, porta `3000`, HTTPS com Let's Encrypt.
3. Na aba **Environment**, preencha `ADMIN_HOST=adm.seu-dominio.com.br`, salve e clique em **Deploy**.

## 9. Receber as assinaturas

Pela **Kiwify**: siga o [KIWIFY.md](KIWIFY.md). Se usar a Kiwify, deixe `MP_ACCESS_TOKEN` vazio.

Pelo **Mercado Pago**:

1. No Mercado Pago, vá em **Seu negócio > Configurações > Credenciais** e copie o **Access Token de produção**.
2. Em **Suas integrações > Webhooks**, cadastre a URL `https://seu-dominio.com.br/api/webhooks/mp` e marque os eventos de **Planos e assinaturas**.
3. Copie a **assinatura secreta** do webhook.
4. No Dokploy, aba Environment, preencha `MP_ACCESS_TOKEN` e `MP_WEBHOOK_SECRET`, salve e clique em **Deploy** de novo.

## 10. Robô do WhatsApp (opcional)

Siga o [WHATSAPP.md](WHATSAPP.md), preencha as variáveis `WA_` no Environment e clique em **Deploy**.

## Lojas em subdomínio (opcional)

Para cada loja abrir em `nomedaloja.seu-dominio.com.br`:

1. Crie no DNS o registro **A** com nome `*` apontando para o IP da VPS.
2. Preencha `BASE_DOMAIN=seu-dominio.com.br` no Environment.
3. Na aba Domains, adicione o host `*.seu-dominio.com.br` na porta 3000. O certificado de curinga pede configuração extra de DNS no Traefik, então comece pelo endereço com barra (`seu-dominio.com.br/loja`), que já funciona sem isso.

## Backup

Em **Volume Backups** (ou **Backups**) do Dokploy, agende a cópia diária do volume `vitrinezap-data`. Ele guarda o banco (`vitrine.db`) e as fotos.

## Se der erro

- **Deploy falhou:** abra o deployment e veja o log. Me mande o trecho em vermelho.
- **Site não abre:** confira se o DNS já aponta para o IP da VPS e se a porta do domínio é 3000.
- **Botão Assinar dá erro:** falta o `MP_ACCESS_TOKEN`.

## 11. Esqueci minha senha

Na aba **Environment**, acrescente:

```
SUPPORT_WHATSAPP=5511999999999
```

Com isso, quem esquecer a senha vê um botão para falar com você no WhatsApp. No seu painel de administração, o botão **Link de senha nova** de cada loja gera um link seguro (vale 24 horas) para você mandar para a lojista.

Para o link chegar sozinho por e-mail, crie um e-mail (por exemplo `contato@zapcatalago.com` na Hostinger) e preencha:

```
SMTP_HOST=smtp.hostinger.com
SMTP_PORT=465
SMTP_USER=contato@zapcatalago.com
SMTP_PASS=a senha desse e-mail
SMTP_FROM=Zap Catálogo <contato@zapcatalago.com>
```

Com o robô do WhatsApp ligado (WHATSAPP.md), a tela "Esqueci minha senha" mostra o botão **Receber o link no WhatsApp**: a lojista manda "Esqueci minha senha" para o robô, do número que ela ligou na loja, e recebe o link na hora. Não precisa de e-mail.
