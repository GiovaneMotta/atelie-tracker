// ============================================================
//  RASTREADOR DE VENDAS — WaSpeed → Meta Ads
//  Detecção automática de anúncio por DDD
//  Registro de valor por etiqueta VALOR_XXX
// ============================================================

const express = require("express");
const crypto  = require("crypto");
const app     = express();
app.use(express.json());

// ─────────────────────────────────────────────────────────────
//  CONFIGURAÇÕES
// ─────────────────────────────────────────────────────────────
const CONFIG = {
  META_PIXEL_ID:    process.env.META_PIXEL_ID    || "SEU_PIXEL_ID_AQUI",
  META_ACCESS_TOKEN: process.env.META_ACCESS_TOKEN || "SEU_TOKEN_AQUI",
  ETIQUETA_VENDA:   process.env.ETIQUETA_VENDA   || "VENDEU",
  VALOR_PADRAO:     parseFloat(process.env.VALOR_PADRAO || 250),
  PORT:             process.env.PORT || 3000,
};

// ─────────────────────────────────────────────────────────────
//  MAPEAMENTO DE ANÚNCIOS POR DDD
// ─────────────────────────────────────────────────────────────
//
//  ANÚNCIO 1 — MA e PA
//  ANÚNCIO 2 — SP Capital, MG e outros grandes centros
//  ANÚNCIO 3 — Demais cidades / interior
//
const ANUNCIOS_DDD = {
  // ── Anúncio 1: Maranhão e Pará ──────────────────────────
  98: "ADS_MA_PA", 99: "ADS_MA_PA",   // Maranhão
  91: "ADS_MA_PA", 93: "ADS_MA_PA",   // Pará (Belém, Santarém)
  94: "ADS_MA_PA",                     // Pará (Marabá)

  // ── Anúncio 2: SP Capital, MG e grandes centros ─────────
  11: "ADS_SP_MG", 12: "ADS_SP_MG",   // SP Capital e Grande SP (Guarulhos, Santo André...)
  13: "ADS_SP_MG", 14: "ADS_SP_MG",   // SP Baixada Santista / Bauru
  15: "ADS_SP_MG", 16: "ADS_SP_MG",   // SP Sorocaba / Ribeirão Preto
  17: "ADS_SP_MG", 18: "ADS_SP_MG",   // SP São José do Rio Preto / Pres. Prudente
  19: "ADS_SP_MG",                     // SP Campinas
  31: "ADS_SP_MG", 32: "ADS_SP_MG",   // MG BH e Juiz de Fora
  33: "ADS_SP_MG", 34: "ADS_SP_MG",   // MG Ipatinga / Uberlândia
  35: "ADS_SP_MG", 37: "ADS_SP_MG",   // MG Varginha / Divinópolis
  38: "ADS_SP_MG",                     // MG Montes Claros
  21: "ADS_SP_MG", 22: "ADS_SP_MG",   // RJ Capital e interior
  24: "ADS_SP_MG",                     // RJ Volta Redonda
  27: "ADS_SP_MG", 28: "ADS_SP_MG",   // ES Vitória e Cachoeiro
  41: "ADS_SP_MG", 42: "ADS_SP_MG",   // PR Curitiba e Ponta Grossa
  43: "ADS_SP_MG", 44: "ADS_SP_MG",   // PR Londrina e Maringá
  45: "ADS_SP_MG", 46: "ADS_SP_MG",   // PR Cascavel e Francisco Beltrão
  47: "ADS_SP_MG", 48: "ADS_SP_MG",   // SC Joinville e Florianópolis
  49: "ADS_SP_MG",                     // SC Chapecó
  51: "ADS_SP_MG", 53: "ADS_SP_MG",   // RS Porto Alegre e Pelotas
  54: "ADS_SP_MG", 55: "ADS_SP_MG",   // RS Caxias e Santa Maria
  61: "ADS_SP_MG",                     // DF Brasília
  62: "ADS_SP_MG", 64: "ADS_SP_MG",   // GO Goiânia e Rio Verde
};

const NOMES_ANUNCIOS = {
  ADS_MA_PA:  "Anúncio MA e PA",
  ADS_SP_MG:  "Anúncio SP Capital / MG e grandes centros",
  ADS_OUTROS: "Anúncio outras cidades",
};

// ─────────────────────────────────────────────────────────────
//  UTILITÁRIOS
// ─────────────────────────────────────────────────────────────

function log(emoji, msg, data = "") {
  const ts = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  console.log(`[${ts}] ${emoji}  ${msg}`, data ? JSON.stringify(data, null, 2) : "");
}

function gerarEventId(phone, timestamp) {
  return crypto.createHash("sha256")
    .update(`${phone}_${timestamp}`)
    .digest("hex").slice(0, 32);
}

function hashPhone(phone) {
  const limpo = String(phone).replace(/\D/g, "");
  return crypto.createHash("sha256").update(limpo).digest("hex");
}

// Detecta anúncio pelo DDD do telefone
function detectarAnuncioPorDDD(phone) {
  const numero = String(phone).replace(/\D/g, "");

  // Remove o 55 do Brasil se vier junto
  const semPais = numero.startsWith("55") ? numero.slice(2) : numero;

  // DDD são os 2 primeiros dígitos do número local
  const ddd = parseInt(semPais.slice(0, 2), 10);

  const tag = ANUNCIOS_DDD[ddd] || "ADS_OUTROS";
  return { tag, nome: NOMES_ANUNCIOS[tag], ddd };
}

// Extrai valor da lista de etiquetas (ex: etiqueta "VALOR_320" → 320)
function extrairValor(etiquetas = []) {
  for (const etiqueta of etiquetas) {
    const match = String(etiqueta).toUpperCase().match(/^VALOR[_-](\d+(?:[.,]\d+)?)$/);
    if (match) {
      return parseFloat(match[1].replace(",", "."));
    }
  }
  return CONFIG.VALOR_PADRAO;
}

// ─────────────────────────────────────────────────────────────
//  ENVIO PARA A META
// ─────────────────────────────────────────────────────────────

async function enviarParaMeta({ phone, valor, anuncio, eventId, timestamp }) {
  const url = `https://graph.facebook.com/v19.0/${CONFIG.META_PIXEL_ID}/events?access_token=${CONFIG.META_ACCESS_TOKEN}`;

  const payload = {
    data: [{
      event_name:    "Purchase",
      event_time:    Math.floor(timestamp / 1000),
      event_id:      eventId,
      action_source: "other",
      user_data: {
        ph: [hashPhone(phone)],
      },
      custom_data: {
        currency:         "BRL",
        value:            valor,
        content_name:     anuncio.nome,
        content_category: "saida_maternidade",
        content_ids:      [anuncio.tag],
        contents:         [{ id: anuncio.tag, quantity: 1, item_price: valor }],
      },
    }],
  };

  const res = await fetch(url, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(payload),
  });

  const resposta = await res.json();
  if (!res.ok || resposta.error) throw new Error(JSON.stringify(resposta.error || resposta));
  return resposta;
}

// ─────────────────────────────────────────────────────────────
//  REGISTRO LOCAL
// ─────────────────────────────────────────────────────────────

const vendasRegistradas = [];

// ─────────────────────────────────────────────────────────────
//  ROTAS
// ─────────────────────────────────────────────────────────────

app.post("/webhook", async (req, res) => {
  try {
    const body      = req.body;
    log("📩", "Webhook recebido:", body);

    const etiquetas = body.tags || body.labels || body.etiquetas || [];
    const phone     = body.phone || body.number || body.contact?.phone || "";
    const nome      = body.name  || body.contact?.name || "Cliente";
    const timestamp = Date.now();

    // Só processa se tiver etiqueta de venda
    const temVenda = etiquetas
      .map(e => String(e).toUpperCase())
      .includes(CONFIG.ETIQUETA_VENDA.toUpperCase());

    if (!temVenda) {
      log("⏭️", "Sem etiqueta de venda — ignorando");
      return res.json({ ok: true, acao: "ignorado" });
    }

    if (!phone) {
      return res.status(400).json({ ok: false, erro: "Telefone ausente" });
    }

    const anuncio = detectarAnuncioPorDDD(phone);
    const valor   = extrairValor(etiquetas);
    const eventId = gerarEventId(phone, timestamp);

    log("🛍️", `Venda! ${nome} | DDD ${anuncio.ddd} → ${anuncio.nome} | R$${valor}`);

    const respostaMeta = await enviarParaMeta({ phone, valor, anuncio, eventId, timestamp });
    log("✅", "Enviado para Meta:", respostaMeta);

    const registro = {
      id:        eventId,
      data:      new Date(timestamp).toLocaleString("pt-BR"),
      cliente:   nome,
      phone:     "**" + String(phone).slice(-4),
      ddd:       anuncio.ddd,
      anuncio:   anuncio.nome,
      valor,
      meta_ok:   respostaMeta.events_received,
    };
    vendasRegistradas.unshift(registro);
    if (vendasRegistradas.length > 200) vendasRegistradas.pop();

    return res.json({ ok: true, registro });

  } catch (err) {
    log("❌", "Erro:", err.message);
    return res.status(500).json({ ok: false, erro: err.message });
  }
});

// Teste manual
app.post("/teste-venda", async (req, res) => {
  req.body = {
    tags:  ["VENDEU", req.body.valor_tag || "VALOR_250"],
    phone: req.body.phone || "5598999999999",
    name:  req.body.nome  || "Cliente Teste",
  };
  // Reutiliza a rota /webhook internamente
  const mockRes = {
    _status: 200, _body: null,
    status(s) { this._status = s; return this; },
    json(b)   { this._body = b; return this; },
  };
  await app._router.handle(
    { ...req, url: "/webhook", path: "/webhook", method: "POST" },
    mockRes, () => {}
  );
  return res.status(mockRes._status).json(mockRes._body);
});

app.get("/vendas", (req, res) => {
  res.json({ total: vendasRegistradas.length, vendas: vendasRegistradas });
});

app.get("/", (req, res) => {
  res.json({
    status:            "online",
    pixel:             CONFIG.META_PIXEL_ID !== "SEU_PIXEL_ID_AQUI" ? "configurado ✅" : "pendente ⚠️",
    etiqueta_venda:    CONFIG.ETIQUETA_VENDA,
    deteccao_anuncio:  "automática por DDD",
    valor:             "via etiqueta VALOR_XXX (ex: VALOR_320)",
  });
});

app.listen(CONFIG.PORT, () => {
  log("🚀", `Servidor na porta ${CONFIG.PORT}`);
});
