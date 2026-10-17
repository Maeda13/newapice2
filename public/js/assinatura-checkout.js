/* assinatura-checkout.js — monta o Card Payment Brick do Mercado Pago
   (SDK JS v2, https://sdk.mercadopago.com/js/v2) só com cartão de
   crédito, à vista, e entrega o TOKEN do cartão para quem chamou.

   Os dados do cartão nunca passam pelo servidor do Ápice: o Brick
   renderiza os campos em iframes do Mercado Pago e devolve só o token
   (uso único, expira em 7 dias), que o backend usa para criar/atualizar
   a assinatura.

   Uso:
     ApiceCheckout.mountCardBrick({
       containerId, publicKey, amount, payerEmail, submitLabel,
       onReady()          — Brick pronto (esconder o "carregando")
       onToken(token)     — deve retornar uma Promise; rejeitar reabilita o formulário
       onFatalError(err)  — o formulário não pôde ser carregado
     });
*/
(function (root) {
  'use strict';

  // Com public key inválida ou API do MP fora do ar, o SDK só loga
  // "Bricks component initialization failed": não chama onError nem
  // rejeita o create(). Sem este limite, a tela ficaria em "carregando"
  // para sempre.
  var READY_TIMEOUT_MS = 20000;

  function cssVar(name, fallback) {
    var value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
  }

  function buildSettings(opts, withVisual, status) {
    var customization = {
      paymentMethods: {
        minInstallments: 1,
        maxInstallments: 1,                         // cobrança mensal, sem parcelas
        types: { excluded: ['debit_card', 'prepaid_card'] }, // só crédito
      },
    };
    if (withVisual) {
      customization.visual = {
        style: {
          theme: 'dark',
          customVariables: {
            baseColor:           cssVar('--accent', '#7C3AED'),
            formBackgroundColor: cssVar('--bg-2', '#101010'),
          },
        },
        texts: opts.submitLabel ? { formSubmit: opts.submitLabel } : {},
      };
    }

    var initialization = { amount: Number(opts.amount) };
    if (opts.payerEmail) initialization.payer = { email: opts.payerEmail };

    return {
      initialization: initialization,
      customization: customization,
      callbacks: {
        onReady: function () { status.ready(); },
        onSubmit: function (formData) {
          // formData traz token, payment_method_id, issuer_id e o
          // documento do titular — enviamos só o token.
          return Promise.resolve().then(function () { return opts.onToken(formData.token); });
        },
        onError: function (error) {
          console.error('[mercadopago-brick]', error);
          // Antes de ficar pronto, qualquer erro impede o pagamento; depois,
          // erros não críticos (ex.: validação de campo) o próprio Brick mostra.
          if (!status.isReady() || (error && error.type === 'critical')) status.fail(error);
        },
      },
    };
  }

  // Estado do carregamento: garante um único onReady/onFatalError e o
  // limite de tempo para o Brick ficar pronto.
  function createStatus(opts) {
    var ready = false;
    var failed = false;
    var timer = setTimeout(function () {
      fail(new Error('O formulário de pagamento não carregou a tempo.'));
    }, READY_TIMEOUT_MS);

    function fail(err) {
      clearTimeout(timer);
      if (failed) return;
      failed = true;
      if (opts.onFatalError) opts.onFatalError(err);
    }
    return {
      isReady: function () { return ready; },
      ready: function () {
        clearTimeout(timer);
        if (ready) return;
        ready = true;
        failed = false;
        if (opts.onReady) opts.onReady();
      },
      fail: fail,
    };
  }

  async function mountCardBrick(opts) {
    var status = createStatus(opts);
    if (!root.MercadoPago) {
      status.fail(new Error('SDK do Mercado Pago não carregou.'));
      return null;
    }
    var mp = new root.MercadoPago(opts.publicKey, { locale: 'pt-BR' });
    var builder = mp.bricks();
    try {
      return await builder.create('cardPayment', opts.containerId, buildSettings(opts, true, status));
    } catch (err) {
      // Se a personalização visual for recusada por alguma versão do SDK,
      // tenta de novo só com o essencial antes de desistir.
      console.warn('[mercadopago-brick] nova tentativa sem personalização visual:', err);
      try {
        return await builder.create('cardPayment', opts.containerId, buildSettings(opts, false, status));
      } catch (err2) {
        status.fail(err2);
        return null;
      }
    }
  }

  root.ApiceCheckout = { mountCardBrick: mountCardBrick };
})(window);
