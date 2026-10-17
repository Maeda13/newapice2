// POST /webhooks/mercadopago — valida x-signature (MP_WEBHOOK_SECRET),
// responde 200 na hora e processa em segundo plano só com tipo + ID.
const crypto  = require("crypto");
const express = require("express");
const request = require("supertest");

const SECRET = "segredo-webhook-teste";

function sign({ dataId, requestId, ts, secret = SECRET }) {
  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const v1 = crypto.createHmac("sha256", secret).update(manifest).digest("hex");
  return `ts=${ts},v1=${v1}`;
}

function loadApp({ secret }) {
  let app, processNotification;
  jest.isolateModules(() => {
    process.env.MP_ACCESS_TOKEN = "TEST-token";
    process.env.MP_PUBLIC_KEY   = "TEST-public";
    process.env.APP_URL         = "http://localhost:3000";
    if (secret) process.env.MP_WEBHOOK_SECRET = secret;
    else delete process.env.MP_WEBHOOK_SECRET;

    jest.doMock("../../database/db", () => ({ query: jest.fn() }));
    jest.doMock("../../services/mpSubscriptions", () => {
      const actual = jest.requireActual("../../services/mpSubscriptions");
      return { ...actual, processNotification: jest.fn().mockResolvedValue(null) };
    });
    processNotification = require("../../services/mpSubscriptions").processNotification;

    app = express();
    app.use(express.json());
    app.use("/webhooks", require("../../routes/webhooks"));
  });
  return { app, processNotification };
}

const flush = () => new Promise(resolve => setImmediate(resolve));

beforeEach(() => {
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe("webhook com MP_WEBHOOK_SECRET", () => {
  test("assinatura válida → 200 e processa o tipo + ID (nunca o corpo)", async () => {
    const { app, processNotification } = loadApp({ secret: SECRET });
    const ts = String(Math.floor(Date.now() / 1000));

    const res = await request(app)
      .post("/webhooks/mercadopago?data.id=2c938084726fca480172750000000000&type=subscription_preapproval")
      .set("x-request-id", "req-123")
      .set("x-signature", sign({ dataId: "2c938084726fca480172750000000000", requestId: "req-123", ts }))
      .send({ type: "subscription_preapproval", data: { id: "2c938084726fca480172750000000000" }, status: "authorized" });

    expect(res.status).toBe(200);
    await flush();
    expect(processNotification).toHaveBeenCalledWith({ type: "subscription_preapproval", dataId: "2c938084726fca480172750000000000" });
  });

  test("data.id alfanumérico entra em minúsculas no manifesto (regra da doc do MP)", async () => {
    const { app, processNotification } = loadApp({ secret: SECRET });
    const ts = "1704908010";
    const res = await request(app)
      .post("/webhooks/mercadopago?data.id=ABC123&type=payment")
      .set("x-request-id", "req-9")
      .set("x-signature", sign({ dataId: "abc123", requestId: "req-9", ts }))
      .send({ type: "payment", data: { id: "ABC123" } });

    expect(res.status).toBe(200);
    await flush();
    expect(processNotification).toHaveBeenCalledWith({ type: "payment", dataId: "ABC123" });
  });

  test.each([
    ["sem x-signature", {}],
    ["segredo errado", { "x-signature": sign({ dataId: "123", requestId: "r", ts: "1", secret: "outro" }), "x-request-id": "r" }],
    ["id adulterado", { "x-signature": sign({ dataId: "999", requestId: "r", ts: "1" }), "x-request-id": "r" }],
    ["header malformado", { "x-signature": "lixo", "x-request-id": "r" }],
  ])("%s → 401 e nada é processado", async (_name, headers) => {
    const { app, processNotification } = loadApp({ secret: SECRET });
    const res = await request(app)
      .post("/webhooks/mercadopago?data.id=123&type=payment")
      .set(headers)
      .send({ type: "payment", data: { id: "123" } });

    expect(res.status).toBe(401);
    await flush();
    expect(processNotification).not.toHaveBeenCalled();
  });

  test("ID com formato inválido responde 200 mas não chama a API", async () => {
    const { app, processNotification } = loadApp({ secret: SECRET });
    const dataId = "../v1/payments/1";
    const res = await request(app)
      .post(`/webhooks/mercadopago?data.id=${encodeURIComponent(dataId)}&type=payment`)
      .set("x-request-id", "r")
      .set("x-signature", sign({ dataId, requestId: "r", ts: "1" }))
      .send({});

    expect(res.status).toBe(200);
    await flush();
    expect(processNotification).not.toHaveBeenCalled();
  });

  test("responde antes de terminar o processamento", async () => {
    const { app, processNotification } = loadApp({ secret: SECRET });
    let release;
    processNotification.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const ts = "1";

    const res = await request(app)
      .post("/webhooks/mercadopago?data.id=555&type=payment")
      .set("x-request-id", "r")
      .set("x-signature", sign({ dataId: "555", requestId: "r", ts }))
      .send({ type: "payment" });

    expect(res.status).toBe(200); // ainda sem ter resolvido o processamento
    await flush();
    expect(processNotification).toHaveBeenCalled();
    release();
  });

  test("falha no processamento só gera log (o MP já recebeu 200)", async () => {
    const { app, processNotification } = loadApp({ secret: SECRET });
    processNotification.mockRejectedValue(Object.assign(new Error("not found"), { status: 404 }));
    const res = await request(app)
      .post("/webhooks/mercadopago?data.id=123456&type=payment")
      .set("x-request-id", "r")
      .set("x-signature", sign({ dataId: "123456", requestId: "r", ts: "1" }))
      .send({});

    expect(res.status).toBe(200);
    await flush(); await flush();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("notificação de teste do painel"), "not found");
  });
});

describe("webhook sem MP_WEBHOOK_SECRET", () => {
  test("aceita (com aviso na subida) — os dados vêm sempre da API do MP", async () => {
    const { app, processNotification } = loadApp({ secret: null });
    const res = await request(app)
      .post("/webhooks/mercadopago?data.id=123&type=payment")
      .send({ type: "payment", data: { id: "123" } });

    expect(res.status).toBe(200);
    await flush();
    expect(processNotification).toHaveBeenCalledWith({ type: "payment", dataId: "123" });
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("MP_WEBHOOK_SECRET não definido"));
  });
});
