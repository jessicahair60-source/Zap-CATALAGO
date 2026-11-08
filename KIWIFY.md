# Vender a assinatura pela Kiwify

A lojista toca em **Assinar** no painel, paga no checkout da Kiwify e a loja dela é liberada sozinha. O sistema liga a compra à loja pelo **e-mail**: o checkout já abre com o e-mail da conta preenchido.

## Antes de ligar: libere as lojas que já existem

Com a Kiwify ligada, loja sem assinatura paga sai do ar (como era com o Mercado Pago). Antes de colocar o token, entre em `/admin` e toque em **Liberar 30 dias** na sua loja e nas lojas que você quer manter no ar.

## Começar só com os links (sem webhook)

Dá para começar só com os links de pagamento: coloque `KIWIFY_CHECKOUT_URL` (mensal) e `KIWIFY_CHECKOUT_ANUAL` (anual) no Dokploy, sem o `KIWIFY_TOKEN`.

- Quem cria a conta e ainda não pagou vê, ao entrar no painel, a tela para escolher o plano.
- Depois que ela pagar, a liberação é feita por você: em `/admin`, toque em **Liberar 30 dias** (mensal) ou **Liberar 1 ano** (anual).
- Coloque `SUPPORT_WHATSAPP` (seu número, só dígitos) para aparecer o botão "Avisar no WhatsApp" depois do pagamento.

Quando colocar o `KIWIFY_TOKEN` e criar o webhook (passos abaixo), a liberação passa a ser automática.

## 1. Criar o produto

1. Na Kiwify, abra **Produtos > Criar produto**.
2. Tipo de cobrança: **Assinatura**, mensal, R$ 47.
3. Salve e copie o **link do checkout** (começa com `https://pay.kiwify.com.br/`). Ele vai em `KIWIFY_CHECKOUT_URL`.

## 2. Criar o webhook

1. Abra **Apps > Webhooks > Criar webhook**.
2. **URL:** `https://zapcatalago.com/api/webhooks/kiwify`
3. **Produto:** o da assinatura.
4. **Eventos:** marque Compra aprovada, Compra recusada, Compra reembolsada, Chargeback, Assinatura renovada, Assinatura atrasada e Assinatura cancelada.
5. Copie o **token** do webhook. Ele vai em `KIWIFY_TOKEN`. Não mande por chat.

## 3. Preencher no Dokploy

Na aba **Environment** do aplicativo:

```
KIWIFY_TOKEN=o token do webhook
KIWIFY_CHECKOUT_URL=https://pay.kiwify.com.br/seu-link
```

Clique em **Save** e depois em **Deploy**.

## 4. Testar

Na tela do webhook da Kiwify, use **Testar webhook**: a Kiwify manda um aviso de exemplo. Depois faça uma compra de verdade com uma conta de teste e confira em `/admin` que a loja ficou **Paga**.

## O que cada aviso faz

| Aviso da Kiwify | Na loja |
|---|---|
| Compra aprovada, Assinatura renovada | Libera até a próxima cobrança, mais 2 dias de folga |
| Assinatura atrasada, Compra recusada | Mostra no painel "O último pagamento não foi aprovado" |
| Assinatura cancelada | Continua no ar até o fim do período pago |
| Reembolso, Chargeback | Sai do ar na hora |

- **Comprou com outro e-mail:** a loja não é liberada sozinha. Libere em `/admin` com **Liberar 30 dias**.
- **Comprou antes de criar a conta:** a compra fica guardada e a loja é liberada quando ela criar a conta com o mesmo e-mail.
- **Cancelar:** a lojista cancela pela área do cliente da Kiwify (link no e-mail da compra). O botão Cancelar do painel explica isso.

## Plano anual

Crie um segundo produto de assinatura **anual** (R$ 299,99) com o mesmo webhook marcado para ele também, e coloque o link do checkout em:

```
KIWIFY_CHECKOUT_ANUAL=https://pay.kiwify.com.br/seu-link-anual
```

Com isso, o painel mostra os dois planos e os botões da página de vendas abrem o checkout certo depois que a pessoa cria a conta.

## Oferta por tempo limitado na página de vendas (opcional)

A seção "Oferta especial" com cronômetro só aparece quando estas variáveis estão preenchidas no Environment do Dokploy:

- `OFERTA_PRECO`: o valor promocional mostrado na página, por exemplo `37,00`.
- `OFERTA_FIM`: data e hora em que a oferta acaba, com fuso. Exemplo: `2026-11-30T23:59:00-03:00`.
- `OFERTA_CHECKOUT_URL`: o link de checkout da Kiwify criado **com esse mesmo preço promocional**.
- `OFERTA_PERIODO` (opcional): o texto ao lado do preço. O padrão é `/mês`. Exemplo: `no primeiro mês`.

O cronômetro conta até `OFERTA_FIM` usando o relógio do servidor, então é o mesmo para todas as visitantes e não reinicia ao atualizar a página. Quando o prazo acaba, a seção some sozinha e o botão `/assinar/oferta` passa a levar ao plano mensal normal. O título da seção é sempre "Oferta especial somente hoje!", então coloque em `OFERTA_FIM` o fim do próprio dia (por exemplo `2026-11-30T23:59:00-03:00`) para o texto ficar verdadeiro.

O preço da assinatura normal (`PLAN_PRICE`) e os links `KIWIFY_CHECKOUT_URL` e `KIWIFY_CHECKOUT_ANUAL` não mudam.
