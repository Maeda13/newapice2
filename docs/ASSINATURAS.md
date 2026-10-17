# Assinaturas recorrentes (Mercado Pago)

Os planos pagos do Ápice (**PRO** para devs, **Básico** e **Premium** para empresas) são cobrados todo mês, automaticamente, no cartão de crédito, pelas **Assinaturas do Mercado Pago** (`preapproval_plan` + `preapproval`).

O código já está pronto. Para funcionar, falta só:

1. colar as credenciais do Mercado Pago no `.env` (local) e nas Environment Variables do Render;
2. rodar `npm run mp:sync-plans`;
3. cadastrar a URL do webhook no painel do Mercado Pago.

Sem as credenciais o site funciona normalmente: as telas de assinatura mostram "Assinaturas temporariamente indisponíveis" e o console avisa o que falta.

---

## 1. Variáveis de ambiente

| Variável | Obrigatória | Para que serve | Onde pegar |
|---|---|---|---|
| `MP_ACCESS_TOKEN` | sim | Chave privada usada pelo backend (criar planos e assinaturas, consultar pagamentos). **Nunca vai para o front nem para o git.** | Painel → Suas integrações → *sua aplicação* → **Credenciais** → *Access Token* |
| `MP_PUBLIC_KEY` | sim | Chave pública usada pelo Card Payment Brick no navegador | Mesmo lugar → *Public Key* |
| `MP_WEBHOOK_SECRET` | sim em produção | Valida o header `x-signature` dos webhooks | Painel → *sua aplicação* → **Webhooks** → Configurar notificações → **Assinatura secreta** (revelar) |
| `APP_BASE_URL` | não | URL pública do site, sem barra no final. Se ficar vazia, usa `APP_URL`, que já existe no projeto | — |
| `MP_TEST_PAYER_EMAIL` | não, só testes | Força o e-mail do pagador para o de um usuário de teste comprador. **Ignorada com `NODE_ENV=production`.** | E-mail do usuário de teste comprador |

Painel do Mercado Pago: <https://www.mercadopago.com.br/developers/panel/app> (se ainda não existir, crie uma aplicação com o produto **Assinaturas**).

### Onde colar

**Local (`.env`, na raiz do projeto; ele já está no `.gitignore`):**

```env
MP_ACCESS_TOKEN=APP_USR-...
MP_PUBLIC_KEY=APP_USR-...
MP_WEBHOOK_SECRET=...
# opcional; sem ela vale o APP_URL
APP_BASE_URL=http://localhost:3000
```

**Render:** Dashboard → serviço do Ápice → **Environment** → *Add Environment Variable*. Adicione `MP_ACCESS_TOKEN`, `MP_PUBLIC_KEY` e `MP_WEBHOOK_SECRET` e salve com *Save, rebuild and deploy*. O `APP_URL` de produção (`https://newapice22.onrender.com`) já é usado como URL base. Confira também se `NODE_ENV=production` está definida.

> Credenciais de **teste** e de **produção** usam os mesmos nomes de variável. Para trocar de modo, troque os valores e rode o sync de novo. Não é preciso mudar código.

---

## 2. Sincronizar os planos: `npm run mp:sync-plans`

Cria (ou atualiza) no Mercado Pago um plano de assinatura para cada plano pago de `config/plans.js`:

- mensal: `frequency: 1`, `frequency_type: "months"`;
- `currency_id: "BRL"` e valor de `price_cents`;
- só cartão de crédito;
- `back_url = <APP_BASE_URL>/assinatura/retorno`.

O `mp_plan_id` retornado fica salvo na tabela `mp_plans`, **separado por conta do Mercado Pago**. Assim os planos de teste e os de produção convivem, mesmo com o banco compartilhado entre local e Render.

```bash
npm run mp:sync-plans
```

Saída esperada:

```
🔑 Conta do Mercado Pago: 123456789 (usuário de teste)
↩️  back_url dos planos: http://localhost:3000/assinatura/retorno
✅ dev_pro          R$  19.90  2c93808...  — criado
✅ empresa_basico   R$  49.90  2c93808...  — criado
✅ empresa_premium  R$  99.90  2c93808...  — criado
```

- **Idempotente.** Rodar de novo não duplica nada: o script reaproveita o plano salvo (ou um plano ativo com o mesmo nome no MP) e só atualiza o que mudou.
- **Quando rodar de novo:** ao trocar as credenciais (teste → produção), ao mudar preço ou nome em `config/plans.js`, ou ao mudar a URL base.
- **Mudou o preço e não rodou o sync?** O checkout daquele plano fica "indisponível" e o log avisa. O site nunca vende por um valor diferente do que mostra.
- **`back_url` local recusada?** Se o Mercado Pago recusar `http://localhost`, rode com `APP_BASE_URL=https://newapice22.onrender.com`. Essa URL só é usada por quem assina pelo link do plano no próprio Mercado Pago; o checkout do Ápice não depende dela.

### Rodar o sync para produção

O banco é o mesmo, então dá para rodar **da sua máquina** com as credenciais de produção. Troque temporariamente no `.env`:

```env
MP_ACCESS_TOKEN=<token de produção>
MP_PUBLIC_KEY=<public key de produção>
APP_BASE_URL=https://newapice22.onrender.com
```

Depois rode `npm run mp:sync-plans` e volte o `.env` para as credenciais de teste. Os planos de produção ficam salvos para a conta de produção, e o Render passa a usá-los na hora.

Outras opções:
- se o seu plano do Render tiver **Shell**, rode `npm run mp:sync-plans` lá;
- ou deixe o Start Command como `npm run mp:sync-plans; npm start`. É seguro porque o sync é idempotente.

### Limpar assinaturas de teste antes de ir para produção

As assinaturas de teste ficam no banco compartilhado e continuam dando acesso premium. Ao rodar o sync com as credenciais de produção, o script avisa quantas existem. Para encerrá-las (só no banco, já que são de outra conta do MP):

```bash
npm run mp:sync-plans -- --encerrar-assinaturas-de-outra-conta
```

---

## 3. Webhook

1. Painel → *sua aplicação* → **Webhooks** → **Configurar notificações**.
2. URL: `https://newapice22.onrender.com/webhooks/mercadopago`. Preencha a URL tanto no modo de teste quanto no de produção, se o painel separar os dois.
3. Eventos:
   - **Planos e assinaturas**: assinatura (`subscription_preapproval`), pagamento recorrente (`subscription_authorized_payment`) e plano (`subscription_preapproval_plan`);
   - **Pagamentos** (`payment`).
4. Salve, revele a **Assinatura secreta** e cole em `MP_WEBHOOK_SECRET` no Render (e no `.env`, se for testar webhooks localmente).
5. Opcional: use **Simular notificação** no painel. Uma resposta `200` indica que a URL e o segredo estão certos. A simulação usa IDs falsos, então o log mostra "recurso não encontrado (notificação de teste do painel?)", o que é esperado.

Como o webhook trata cada notificação:

- valida `x-signature`/`x-request-id` com o `MP_WEBHOOK_SECRET` e responde `401` se a assinatura for inválida;
- responde `200` na hora e processa em segundo plano;
- **nunca confia no corpo**: busca a assinatura, a fatura ou o pagamento na API do MP pelo ID;
- grava com upsert pelo ID do Mercado Pago, então notificações repetidas ou fora de ordem não duplicam nada.

**Localmente o webhook não é obrigatório.** O Mercado Pago não alcança `localhost`, mas as telas "Minha assinatura" e o retorno do checkout consultam a API do MP e se atualizam sozinhas. Para testar o webhook local, use um túnel (ngrok, cloudflared) e cadastre a URL do túnel.

---

## 4. Testar com usuários e cartões de teste

Assinaturas exigem que **vendedor e comprador sejam do mesmo tipo**: os dois de teste, ou os dois reais. Misturar dá erros como "Both payer and collector must be real or test users".

### 4.1 Criar as contas de teste

Painel → *sua aplicação* → **Contas de teste** → *+ Criar conta de teste*:

- uma conta **Vendedor** e uma **Comprador**, ambas no país **Brasil**;
- anote o usuário, a senha e o e-mail de cada uma. O código de verificação de login aparece na mesma tela.

### 4.2 Credenciais para o modo teste

Recomendado pela documentação de Assinaturas: em uma janela anônima, entre no painel com a **conta de teste vendedora**, crie uma aplicação e copie as **credenciais de produção dela** (`APP_USR-...`). Elas são as credenciais "de teste" do fluxo. Cole no `.env`, rode `npm run mp:sync-plans` e confira se o log diz "(usuário de teste)".

As credenciais da aba **Credenciais de teste** (`TEST-...`) da sua conta real também funcionam no código. Se o Mercado Pago recusar a assinatura por "test users", use a opção recomendada acima.

### 4.3 O pagador precisa ser o comprador de teste

O e-mail enviado como pagador é o da conta logada no Ápice. Para testar, faça uma destas:

- crie no Ápice uma conta (dev ou empresa, por e-mail e senha) com o **e-mail do comprador de teste**; ou
- defina `MP_TEST_PAYER_EMAIL=<e-mail do comprador de teste>` no `.env` local e use qualquer conta (só funciona fora de produção).

Não use o e-mail da conta vendedora: o MP recusa com "Payer and collector cannot be the same user".

### 4.4 Cartões de teste (Brasil)

| Bandeira | Número | CVV | Validade |
|---|---|---|---|
| Mastercard | 5480 8328 0103 3311 | 123 | 11/30 |
| Visa | 4235 6477 2802 5682 | 123 | 11/30 |
| American Express | 3753 651535 56885 | 1234 | 11/30 |

No **nome do titular**, escolha o resultado:

| Nome | Resultado |
|---|---|
| `APRO` | aprovado (CPF `12345678909`) |
| `OTHE` | recusado por erro geral (CPF `12345678909`) |
| `FUND` | recusado por limite insuficiente |
| `SECU` | recusado por CVV inválido |
| `EXPI` | recusado por validade |
| `CONT` | pendente |

### 4.5 Roteiro de teste

1. `npm start`. O console **não** deve mostrar "Assinaturas desativadas".
2. Entre com a conta de teste e abra **Planos** (menu do usuário → Planos).
3. Clique em **Assinar** no PRO. Você vai para `/planos/dev_pro/assinar`, com o resumo do plano e o formulário do Mercado Pago.
4. Pague com `APRO`. Deve aparecer **"Assinatura ativa!"**. Em **Minha assinatura**, confira o status *Ativa*, o valor, a próxima cobrança e o histórico. A primeira cobrança pode levar alguns minutos para aparecer.
5. Confira que o mentor e o simulador de entrevista (PRO) foram liberados.
6. **Trocar cartão:** em Minha assinatura → *Trocar cartão* → salve outro cartão de teste.
7. **Trocar de plano** (conta empresa): Básico → *Trocar de plano* → Premium.
8. **Cancelar:** *Cancelar assinatura* → confirme. O status vira *Cancelada (acesso ativo)* e o acesso continua até o fim do período pago.
9. **Recusa:** em outra conta, assine com `FUND` ou `OTHE`. Deve aparecer a página "Pagamento recusado" com o motivo traduzido e o botão "Tentar novamente".

Erros comuns:

| Mensagem / sintoma | Causa provável |
|---|---|
| "Assinaturas temporariamente indisponíveis" | Faltam `MP_ACCESS_TOKEN`/`MP_PUBLIC_KEY`, o sync não foi rodado para esta conta, ou o preço mudou sem sync. O log diz qual dos casos é. |
| "Both payer and collector must be real or test users" / "Invalid users involved" | Pagador e vendedor de tipos diferentes (um de teste e outro real). Veja 4.2 e 4.3. |
| "Payer and collector cannot be the same user" | Assinou com o e-mail da conta vendedora. |
| `CC_VAL_433 Credit card validation has failed` | Cartão recusado na validação: dados do cartão de teste errados, ou contas de teste trocadas. |
| Webhook com `401` no painel do MP | `MP_WEBHOOK_SECRET` diferente da "Assinatura secreta" do painel. |

---

## 5. Checklist de produção

- [ ] Credenciais de produção ativadas: Painel → *sua aplicação* → Credenciais de produção → informar indústria e site → *Ativar*.
- [ ] No Render: `MP_ACCESS_TOKEN` e `MP_PUBLIC_KEY` de **produção**, `MP_WEBHOOK_SECRET`, `NODE_ENV=production` e `APP_URL=https://newapice22.onrender.com`. **Sem** `MP_TEST_PAYER_EMAIL`.
- [ ] `npm run mp:sync-plans` rodado com as credenciais de produção e `APP_BASE_URL=https://newapice22.onrender.com` (ver seção 2). Os 3 planos devem aparecer como criados ou em dia.
- [ ] Assinaturas de teste encerradas (`--encerrar-assinaturas-de-outra-conta`), se você testou no mesmo banco.
- [ ] Webhook de **produção** cadastrado com os eventos de *Planos e assinaturas* e *Pagamentos*, e a simulação respondendo `200`.
- [ ] Assinatura real de ponta a ponta com um cartão de verdade (pode cancelar logo depois em Minha assinatura).
- [ ] O `.env` não foi commitado (`git status` não deve listá-lo).

---

## 6. Como funciona por dentro

**Arquivos**

| Arquivo | Papel |
|---|---|
| `config/plans.js` | Planos: código, nome, `price_cents`, benefícios, limites. **Fonte única do preço.** |
| `config/mercadopago.js` | Lê as credenciais do ambiente e degrada sem elas. |
| `services/mercadoPago.js` | Única camada que fala com o SDK oficial (`mercadopago` v3: `MercadoPagoConfig`, `PreApprovalPlan`, `PreApproval`, `Payment`, `Invoice`, `User`). |
| `services/mpSubscriptions.js` | Ciclo de vida: criar, cancelar, trocar cartão ou plano, sincronizar, processar webhook. |
| `services/subscriptionService.js` | Quem pode o quê: o plano efetivo de cada usuário. |
| `services/mpMessages.js` | Tradução de `status_detail` e dos erros do MP para mensagens amigáveis. |
| `middlewares/requirePlan.js` | `requirePlan("empresa_premium")`, que protege rotas premium. |
| `middlewares/mpCheckoutCsp.js` | CSP que libera os domínios do MP **só** nas telas com o Brick. |
| `controllers/assinaturasController.js`, `routes/assinaturas.js`, `routes/webhooks.js` | API, páginas e webhook. |
| `views/assinar.ejs`, `views/assinatura-resultado.ejs`, `views/minha-assinatura.ejs`, `public/js/assinatura-checkout.js`, `public/css/assinatura.css` | Telas e o Card Payment Brick. |
| `scripts/mp-sync-plans.js` | `npm run mp:sync-plans`. |

**Rotas**

| Rota | Acesso | O que faz |
|---|---|---|
| `GET /planos/:id/assinar` | login (volta para cá depois) | Resumo do plano e Card Payment Brick (só crédito, à vista) |
| `GET /assinatura/retorno` | login | Resultado: ativa, pendente (atualiza sozinha) ou recusada |
| `GET /minha-assinatura` | login | Plano, status, valor, próxima cobrança, histórico e ações |
| `POST /api/assinaturas` | login | `{ plan_id, card_token_id }`: cria a assinatura |
| `GET /api/assinaturas/minha[?sync=1]` | login | Estado atual (com `sync=1`, consulta o MP antes) |
| `PUT /api/assinaturas/cancelar` | login | Cancela no MP; o acesso vai até o fim do período pago |
| `PUT /api/assinaturas/cartao` | login | `{ card_token_id }`: troca o cartão da assinatura |
| `PUT /api/assinaturas/plano` | login | `{ plan_id, card_token_id }`: troca de plano |
| `POST /webhooks/mercadopago` | público (assinado) | Notificações do Mercado Pago |

Todas as rotas usam o usuário da sessão; nenhuma recebe ID de assinatura do cliente. Por isso cada pessoa só mexe na própria assinatura.

**Tabelas** (criadas automaticamente por `database/db.js`, datas em UTC)

- `subscriptions`: `user_id`, `plan_id`, `mp_preapproval_id` (único), `status` (`pending`, `authorized`, `paused` ou `cancelled`), `next_payment_date`, `paid_until` (fim do período pago), `payment_issue` (motivo da última cobrança recusada), `cancelled_at`, `created_at`, `updated_at`.
- `subscription_payments`: `subscription_id`, `mp_payment_id` (único), `status`, `status_detail`, `amount`, `paid_at`, `created_at`.
- `mp_plans`: `plan_code` + conta do MP → `mp_plan_id` e valor sincronizado.

**Regras de acesso**

- **Ativo:** se `status = authorized`. Se a assinatura estiver `cancelled` ou `paused`, o acesso vale até `paid_until`, que é o último pagamento aprovado mais 1 mês.
- **Cobrança recusada:** o Mercado Pago faz até 4 novas tentativas em cerca de 10 dias. Durante esse tempo o acesso continua e as telas mostram um aviso pedindo a troca do cartão, com a data-limite.
- **Fim da carência:** se a cobrança continuar recusada **10 dias depois do fim do período pago**, o acesso premium é suspenso, mesmo que a assinatura siga `authorized` no MP. A documentação do MP não garante que ele cancele sozinho no Brasil. Uma cobrança aprovada (por exemplo, depois de trocar o cartão) libera o acesso de novo na hora.
- **Melhor plano vale:** entre a assinatura paga, o plano manual do admin (que continua funcionando) e o plano gratuito, vale o melhor.
- **Troca de plano:** o Mercado Pago não move uma assinatura para outro plano. A troca cria a nova (cobrada no ato) e cancela a antiga. Quem desce de Premium para Básico continua Premium até o fim do período já pago. Não há reembolso proporcional.
- Uma assinatura aberta por usuário, garantida por lock no MySQL contra cliques duplos. Se sobrar alguma duplicada, a sincronização cancela a mais antiga no MP.

**Segurança**

- O `MP_ACCESS_TOKEN` fica só no servidor. O front recebe apenas a Public Key.
- Nenhum dado de cartão passa pelo servidor do Ápice: o Brick tokeniza nos iframes do Mercado Pago e o backend recebe só o token, que é de uso único.
- O preço sempre sai de `config/plans.js` ou do plano no MP, nunca do front. O antigo "checkout" que ativava qualquer plano sem pagamento (`POST /api/plans/subscribe`) foi removido.
- Webhook validado por `x-signature`, e dados sempre relidos na API do MP.
- CSRF: o site não usa token de CSRF. O cookie de sessão é `sameSite=lax` e as rotas que alteram estado são `POST`/`PUT` com JSON, que não são enviadas a partir de outros sites. O webhook não depende de sessão.
- Os logs nunca incluem token, corpo da requisição ou dados de cartão; registram só o tipo e a mensagem de erro do MP.

**Testes automatizados:** `npx jest tests/assinaturas` (o Mercado Pago é mockado e o banco é em memória).
