# Ligar o robô do WhatsApp

As lojistas mandam uma foto com o texto no modelo para o número do robô, e o produto entra no catálogo delas. Este guia liga o número usando a API oficial da Meta (WhatsApp Cloud API).

Os nomes dos menus da Meta mudam de vez em quando. Se algum não bater, procure pelo nome em inglês, que aparece entre parênteses.

## Antes de começar

- Uma conta no Facebook.
- O número do robô. Pode ser:
  - um chip só para o robô (recomendado: as mensagens das lojistas não enchem o seu celular);
  - ou o número do seu **WhatsApp Business** em **coexistência**: você continua usando o app, e as mensagens das lojistas também aparecem nele.
- O site já no ar em `https://zapcatalago.com`, porque a Meta testa o endereço do webhook.

## 1. Criar o app na Meta

1. Abra **developers.facebook.com** e entre com o Facebook.
2. Clique em **Meus apps (My Apps) > Criar app (Create App)**.
3. Escolha o caso de uso **Conectar com clientes pelo WhatsApp** (ou o tipo **Empresa / Business**).
4. Dê o nome `Zap Catálogo` e ligue o app ao seu **portfólio empresarial** (crie um, se pedir).

## 2. Ligar o número

1. No app, abra **WhatsApp > Configuração da API (API Setup)**.
2. Clique em **Adicionar número de telefone (Add phone number)**.
3. Preencha o nome que aparece para as lojistas (por exemplo, `Zap Catálogo`) e confirme o número com o código por SMS ou ligação.
   - **Coexistência:** se a Meta oferecer a opção de usar um número que já está no app **WhatsApp Business**, escolha essa opção e confirme pelo app no celular.
4. Na mesma tela, copie o **Identificação do número de telefone (Phone number ID)**. Ele vai em `WA_PHONE_ID`.
5. Anote o número com DDI e DDD, só números (exemplo: `5511999999999`). Ele vai em `WA_NUMBER`.

## 3. Token permanente

O token que aparece na tela de teste vence em 24 horas. Para o robô funcionar sempre, gere um permanente:

1. Abra **business.facebook.com > Configurações (Settings) > Usuários (Users) > Usuários do sistema (System users)**.
2. Clique em **Adicionar (Add)**, dê o nome `robo` e escolha a função **Administrador (Admin)**.
3. Clique em **Atribuir ativos (Assign assets)**. Marque o app `Zap Catálogo` com **controle total (Full control)** e a sua **conta do WhatsApp** com controle total.
4. Clique em **Gerar token (Generate token)**, escolha o app e a validade **Nunca (Never)**, e marque as permissões:
   - `whatsapp_business_messaging`
   - `whatsapp_business_management`
5. Copie o token. Ele vai em `WA_TOKEN`. Guarde em lugar seguro e não mande por chat.

## 4. Chave secreta do app

No app, abra **Configurações do app (App settings) > Básico (Basic)**, clique em **Mostrar (Show)** na **Chave secreta do app (App secret)** e copie. Ela vai em `WA_APP_SECRET`.

Nessa mesma tela, preencha a **URL da Política de Privacidade** com `https://zapcatalago.com/privacidade`.

## 5. Preencher no Dokploy

No aplicativo do Zap Catálogo, aba **Environment**, preencha:

```
WA_TOKEN=o token permanente
WA_PHONE_ID=o Phone number ID
WA_NUMBER=5511999999999
WA_VERIFY_TOKEN=invente-uma-palavra-secreta
WA_APP_SECRET=a chave secreta do app
```

`WA_VERIFY_TOKEN` é uma palavra que você inventa, por exemplo `zapcatalago-2026-robo`. Ela vai ser repetida no passo 6.

Clique em **Save** e depois em **Deploy**. Espere ficar verde.

## 6. Webhook (para as mensagens chegarem no sistema)

1. No app da Meta, abra **WhatsApp > Configuração (Configuration)**.
2. Em **Webhook**, clique em **Editar (Edit)**:
   - **URL de callback:** `https://zapcatalago.com/api/webhooks/wa`
   - **Token de verificação:** a mesma palavra do `WA_VERIFY_TOKEN`
3. Clique em **Verificar e salvar (Verify and save)**.
4. Em **Campos do webhook (Webhook fields)**, clique em **Gerenciar (Manage)** e assine (**Subscribe**) o campo **messages**.

## 7. Publicar o app

No topo do app, mude o modo de **Desenvolvimento (Development)** para **Ao vivo (Live)**. Sem isso, a Meta só entrega mensagens de números de teste.

## 8. Testar

1. Entre no seu painel em `https://zapcatalago.com/painel`.
2. Abra **Cadastrar pelo WhatsApp** e toque em **Ligar meu WhatsApp**.
3. Toque em **Abrir o WhatsApp com o código** e envie a mensagem com o código.
4. O robô responde "Pronto!". Mande uma foto com o texto do modelo na legenda.
5. O produto aparece no painel e na vitrine.

## Custos

A Meta cobra por algumas conversas, conforme a tabela de preços dela, que muda de tempos em tempos. As respostas do robô são enviadas dentro da janela de 24 horas aberta pela mensagem da lojista. Confira os valores atuais em **WhatsApp Manager > Visão geral (Overview)** e cadastre uma forma de pagamento lá, se a Meta pedir.

## Se der errado

- **"Verificar e salvar" falha:** o site ainda não está no ar, ou o `WA_VERIFY_TOKEN` no Dokploy está diferente do que você digitou na Meta. Confira e faça o Deploy de novo.
- **O robô não responde:** confira se o campo **messages** está assinado, se o app está **Ao vivo** e se o `WA_TOKEN` é o permanente.
- **"Este número ainda não está ligado":** a lojista precisa mandar o código do painel antes do primeiro produto.
