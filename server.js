const express = require("express");
const crypto = require("crypto");

const app = express();

app.use(express.json());

// ======================
// CORS
// ======================
app.use(function(req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }

  next();
});

// ======================
// CONFIG
// ======================
const CONFIG = {
  META_PIXEL_ID: process.env.META_PIXEL_ID || "SEU_PIXEL_ID_AQUI",
  META_ACCESS_TOKEN: process.env.META_ACCESS_TOKEN || "SEU_TOKEN_AQUI",
  ETIQUETA_VENDA: process.env.ETIQUETA_VENDA || "VENDEU",
  VALOR_PADRAO: parseFloat(process.env.VALOR_PADRAO || 250),
  PORT: process.env.PORT || 3000,
};

// ======================
// MAPA DDD -> ANÚNCIO
// ======================
const ANUNCIOS_DDD = {
  98: "ADS_MA_PA",
  99: "ADS_MA_PA",

  91: "ADS_MA_PA",
  93: "ADS_MA_PA",
  94: "ADS_MA_PA",

  11: "ADS_SP_MG",
  12: "ADS_SP_MG",
  13: "ADS_SP_MG",
  14: "ADS_SP_MG",
  15: "ADS_SP_MG",
  16: "ADS_SP_MG",
  17: "ADS_SP_MG",
  18: "ADS_SP_MG",
  19: "ADS_SP_MG",

  31: "ADS_SP_MG",
  32: "ADS_SP_MG",
  33: "ADS_SP_MG",
  34: "ADS_SP_MG",
  35: "ADS_SP_MG",
  37: "ADS_SP_MG",
  38: "ADS_SP_MG",

  21: "ADS_SP_MG",
  22: "ADS_SP_MG",
  24: "ADS_SP_MG",

  27: "ADS_SP_MG",
  28: "ADS_SP_MG",

  41: "ADS_SP_MG",
  42: "ADS_SP_MG",
  43: "ADS_SP_MG",
  44: "ADS_SP_MG",
  45: "ADS_SP_MG",
  46: "ADS_SP_MG",
  47: "ADS_SP_MG",
  48: "ADS_SP_MG",
  49: "ADS_SP_MG",

  51: "ADS_SP_MG",
  53: "ADS_SP_MG",
  54: "ADS_SP_MG",
  55: "ADS_SP_MG",

  61: "ADS_SP_MG",
  62: "ADS_SP_MG",
  64: "ADS_SP_MG",
};

const NOMES_ANUNCIOS = {
  ADS_MA_PA: "Anuncio MA e PA",
  ADS_SP_MG: "Anuncio SP Capital e MG",
  ADS_OUTROS: "Anuncio outras cidades",
};

// ======================
// FUNÇÕES
// ======================
function log(msg, data) {
  var ts = new Date().toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
  });

  console.log(
    "[" + ts + "] " + msg,
    data ? JSON.stringify(data) : ""
  );
}

function gerarEventId(phone, timestamp) {
  return crypto
    .createHash("sha256")
    .update(phone + "_" + timestamp)
    .digest("hex")
    .slice(0, 32);
}

function hashPhone(phone) {
  var limpo = String(phone).replace(/\D/g, "");

  return crypto
    .createHash("sha256")
    .update(limpo)
    .digest("hex");
}

function detectarAnuncioPorDDD(phone) {
  var numero = String(phone).replace(/\D/g, "");

  var semPais = numero.startsWith("55")
    ? numero.slice(2)
    : numero;

  var ddd = parseInt(semPais.slice(0, 2), 10);

  var tag = ANUNCIOS_DDD[ddd] || "ADS_OUTROS";

  return {
    tag: tag,
    nome: NOMES_ANUNCIOS[tag],
    ddd: ddd,
  };
}

function extrairValor(etiquetas) {

  for (var i = 0; i < etiquetas.length; i++) {

    var texto = "";

    // objeto do WaSpeed
    if (typeof etiquetas[i] === "object" && etiquetas[i] !== null) {
      texto = String(etiquetas[i].name || "");
    } else {
      texto = String(etiquetas[i]);
    }

    var match = texto
      .toUpperCase()
      .match(/^VALOR[_-](\d+(?:[.,]\d+)?)$/);

    if (match) {
      return parseFloat(match[1].replace(",", "."));
    }
  }

  return CONFIG.VALOR_PADRAO;
}

// ======================
// META API
// ======================
async function enviarParaMeta(
  phone,
  valor,
  anuncio,
  eventId,
  timestamp
) {

  var url =
    "https://graph.facebook.com/v19.0/" +
    CONFIG.META_PIXEL_ID +
    "/events?access_token=" +
    CONFIG.META_ACCESS_TOKEN;

  var payload = {
    data: [
      {
        event_name: "Purchase",
        event_time: Math.floor(timestamp / 1000),
        event_id: eventId,
        action_source: "other",

        user_data: {
          ph: [hashPhone(phone)],
        },

        custom_data: {
          currency: "BRL",
          value: valor,

          content_name: anuncio.nome,

          content_category: "saida_maternidade",

          content_ids: [anuncio.tag],

          contents: [
            {
              id: anuncio.tag,
              quantity: 1,
              item_price: valor,
            },
          ],
        },
      },
    ],
  };

  var res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  var resposta = await res.json();

  if (!res.ok || resposta.error) {
    throw new Error(
      JSON.stringify(resposta.error || resposta)
    );
  }

  return resposta;
}

// ======================
// MEMÓRIA
// ======================
var vendasRegistradas = [];

// ======================
// WEBHOOK
// ======================
app.post("/webhook", async function(req, res) {

  try {

    var body = req.body;

    log("Webhook recebido", body);

    // ======================
    // ETIQUETAS
    // ======================

    var etiquetas = [];

    if (Array.isArray(body.tags)) {
      etiquetas = body.tags;

    } else if (Array.isArray(body.labels)) {
      etiquetas = body.labels;

    } else if (Array.isArray(body.etiquetas)) {
      etiquetas = body.etiquetas;

    } else if (
      Array.isArray(body.eventDetails?.labels)
    ) {
      etiquetas = body.eventDetails.labels;

    } else if (body.tag) {
      etiquetas = [body.tag];

    } else if (body.label) {
      etiquetas = [body.label];

    } else if (body.etiqueta) {
      etiquetas = [body.etiqueta];
    }

    if (
      etiquetas.length === 0 &&
      body.event?.tag
    ) {
      etiquetas = [body.event.tag];
    }

    if (
      etiquetas.length === 0 &&
      body.data?.tag
    ) {
      etiquetas = [body.data.tag];
    }

    // ======================
    // TELEFONE / NOME
    // ======================

    var phone =
      body.phone ||
      body.number ||
      body.numero ||
      (body.contact && body.contact.phone) ||
      (body.data && body.data.phone) ||
      "";

    var nome =
      body.name ||
      body.nome ||
      (body.contact && body.contact.name) ||
      (body.data && body.data.name) ||
      "Cliente";

    var timestamp = Date.now();

    log("Etiquetas encontradas", etiquetas);
    log("Telefone: " + phone);

    // ======================
    // DETECTA VENDA
    // ======================

    var temVenda = etiquetas.some(function(e) {

      // objeto
      if (
        typeof e === "object" &&
        e !== null
      ) {

        return String(e.name || "")
          .toUpperCase()
          === CONFIG.ETIQUETA_VENDA.toUpperCase();
      }

      // string
      return String(e)
        .toUpperCase()
        === CONFIG.ETIQUETA_VENDA.toUpperCase();

    });

    if (!temVenda) {

      log("Sem etiqueta de venda — ignorando");

      return res.json({
        ok: true,
        acao: "ignorado",
        etiquetas_recebidas: etiquetas,
      });
    }

    // ======================
    // VALIDA TELEFONE
    // ======================

    if (!phone) {

      log("Telefone ausente");

      return res.status(400).json({
        ok: false,
        erro: "Telefone ausente",
        body_recebido: body,
      });
    }

    // ======================
    // PROCESSA VENDA
    // ======================

    var anuncio = detectarAnuncioPorDDD(phone);

    var valor = extrairValor(etiquetas);

    var eventId = gerarEventId(phone, timestamp);

    log(
      "Venda! " +
      nome +
      " | DDD " +
      anuncio.ddd +
      " -> " +
      anuncio.nome +
      " | R$" +
      valor
    );

    // ======================
    // ENVIA META
    // ======================

    var respostaMeta = await enviarParaMeta(
      phone,
      valor,
      anuncio,
      eventId,
      timestamp
    );

    log("Enviado para Meta OK", respostaMeta);

    // ======================
    // SALVA
    // ======================

    var registro = {
      id: eventId,
      data: new Date(timestamp).toLocaleString("pt-BR"),
      cliente: nome,
      phone: "**" + String(phone).slice(-4),
      ddd: anuncio.ddd,
      anuncio: anuncio.nome,
      valor: valor,
      meta_ok: respostaMeta.events_received,
    };

    vendasRegistradas.unshift(registro);

    if (vendasRegistradas.length > 200) {
      vendasRegistradas.pop();
    }

    return res.json({
      ok: true,
      registro: registro,
    });

  } catch (err) {

    log("Erro: " + err.message);

    return res.status(500).json({
      ok: false,
      erro: err.message,
    });
  }
});

// ======================
// ROTA VENDAS
// ======================
app.get("/vendas", function(req, res) {

  res.json({
    total: vendasRegistradas.length,
    vendas: vendasRegistradas,
  });

});

// ======================
// HOME
// ======================
app.get("/", function(req, res) {

  res.json({
    status: "online",

    pixel:
      CONFIG.META_PIXEL_ID !== "SEU_PIXEL_ID_AQUI"
        ? "configurado"
        : "pendente",

    etiqueta_venda: CONFIG.ETIQUETA_VENDA,

    deteccao_anuncio: "automatica por DDD",
  });

});

// ======================
// START
// ======================
app.listen(CONFIG.PORT, function() {

  log("Servidor na porta " + CONFIG.PORT);

});
