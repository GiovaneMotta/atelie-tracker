const express = require("express");
const crypto  = require("crypto");
const app     = express();

app.use(express.json());

app.use(function(req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

const CONFIG = {
  META_PIXEL_ID:     process.env.META_PIXEL_ID     || "SEU_PIXEL_ID_AQUI",
  META_ACCESS_TOKEN: process.env.META_ACCESS_TOKEN || "SEU_TOKEN_AQUI",
  ETIQUETA_VENDA:    process.env.ETIQUETA_VENDA    || "VENDEU",
  VALOR_PADRAO:      parseFloat(process.env.VALOR_PADRAO || 250),
  PORT:              process.env.PORT || 3000,
};

const ANUNCIOS_DDD = {
  // Anuncio 1: MA e PA
  98: "ADS_MA_PA", 99: "ADS_MA_PA",
  91: "ADS_MA_PA", 93: "ADS_MA_PA", 94: "ADS_MA_PA",
  // Anuncio 2: CE, PI, BA, PB, RN, PE
  85: "ADS_NE", 88: "ADS_NE",
  86: "ADS_NE", 89: "ADS_NE",
  71: "ADS_NE", 73: "ADS_NE", 74: "ADS_NE", 75: "ADS_NE", 77: "ADS_NE",
  83: "ADS_NE",
  84: "ADS_NE",
  81: "ADS_NE", 87: "ADS_NE",
  // Anuncio 3: SP, MG, GO e Sul
  11: "ADS_SP_MG", 12: "ADS_SP_MG", 13: "ADS_SP_MG", 14: "ADS_SP_MG",
  15: "ADS_SP_MG", 16: "ADS_SP_MG", 17: "ADS_SP_MG", 18: "ADS_SP_MG", 19: "ADS_SP_MG",
  21: "ADS_SP_MG", 22: "ADS_SP_MG", 24: "ADS_SP_MG",
  27: "ADS_SP_MG", 28: "ADS_SP_MG",
  31: "ADS_SP_MG", 32: "ADS_SP_MG", 33: "ADS_SP_MG", 34: "ADS_SP_MG",
  35: "ADS_SP_MG", 37: "ADS_SP_MG", 38: "ADS_SP_MG",
  41: "ADS_SP_MG", 42: "ADS_SP_MG", 43: "ADS_SP_MG", 44: "ADS_SP_MG",
  45: "ADS_SP_MG", 46: "ADS_SP_MG", 47: "ADS_SP_MG", 48: "ADS_SP_MG", 49: "ADS_SP_MG",
  51: "ADS_SP_MG", 53: "ADS_SP_MG", 54: "ADS_SP_MG", 55: "ADS_SP_MG",
  61: "ADS_SP_MG", 62: "ADS_SP_MG", 64: "ADS_SP_MG",
};

const NOMES_ANUNCIOS = {
  ADS_MA_PA:  "Anuncio 1 - MA e PA",
  ADS_NE:     "Anuncio 2 - CE, PI, BA, PB, RN, PE",
  ADS_SP_MG:  "Anuncio 3 - SP, MG, GO e Sul",
  ADS_OUTROS: "Outros (fora dos anuncios)",
};

function log(msg, data) {
  var ts = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  console.log("[" + ts + "] " + msg, data ? JSON.stringify(data) : "");
}

function gerarEventId(phone, timestamp) {
  return crypto.createHash("sha256").update(phone + "_" + timestamp).digest("hex").slice(0, 32);
}

function hashPhone(phone) {
  var limpo = String(phone).replace(/\D/g, "");
  return crypto.createHash("sha256").update(limpo).digest("hex");
}

function detectarAnuncioPorDDD(phone) {
  var numero = String(phone).replace(/\D/g, "");
  if (numero.startsWith("55")) numero = numero.slice(2);
  var ddd = parseInt(numero.slice(0, 2), 10);
  var tag = ANUNCIOS_DDD[ddd] || "ADS_OUTROS";
  return { tag: tag, nome: NOMES_ANUNCIOS[tag], ddd: ddd };
}

// Extrai todas as etiquetas do payload do WaSpeed
// O WaSpeed envia em: eventDetails.labels = [{id, name, ...}]
function extrairEtiquetas(body) {
  var nomes = [];

  // Campo principal: eventDetails.labels
  if (body.eventDetails && Array.isArray(body.eventDetails.labels)) {
    body.eventDetails.labels.forEach(function(l) {
      if (l && l.name) nomes.push(String(l.name).trim());
    });
  }

  // Fallback: labels na raiz
  if (nomes.length === 0 && Array.isArray(body.labels)) {
    body.labels.forEach(function(l) {
      if (typeof l === "object" && l.name) nomes.push(String(l.name).trim());
      else if (typeof l === "string") nomes.push(l.trim());
    });
  }

  // Fallback: tags na raiz
  if (nomes.length === 0 && Array.isArray(body.tags)) {
    body.tags.forEach(function(t) {
      if (typeof t === "object" && t.name) nomes.push(String(t.name).trim());
      else if (typeof t === "string") nomes.push(t.trim());
    });
  }

  return nomes;
}

function extrairValor(etiquetas) {
  for (var i = 0; i < etiquetas.length; i++) {
    var match = String(etiquetas[i]).toUpperCase().match(/^VALOR[_-](\d+(?:[.,]\d+)?)$/);
    if (match) return parseFloat(match[1].replace(",", "."));
  }
  return CONFIG.VALOR_PADRAO;
}

async function enviarParaMeta(phone, valor, anuncio, eventId, timestamp) {
  var url = "https://graph.facebook.com/v19.0/" + CONFIG.META_PIXEL_ID + "/events?access_token=" + CONFIG.META_ACCESS_TOKEN;
  var payload = {
    data: [{
      event_name:    "Purchase",
      event_time:    Math.floor(timestamp / 1000),
      event_id:      eventId,
      action_source: "other",
      user_data: { ph: [hashPhone(phone)] },
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
  var response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  var resposta = await response.json();
  if (!response.ok || resposta.error) throw new Error(JSON.stringify(resposta.error || resposta));
  return resposta;
}

var vendasRegistradas = [];

app.post("/webhook", async function(req, res) {
  try {
    var body = req.body;
    log("Webhook recebido", body);

    var etiquetas = extrairEtiquetas(body);
    log("Etiquetas extraidas: " + JSON.stringify(etiquetas));

    // Verifica se VENDEU está nas etiquetas
    var temVenda = etiquetas.some(function(e) {
      return e.toUpperCase() === CONFIG.ETIQUETA_VENDA.toUpperCase();
    });

    if (!temVenda) {
      log("Sem etiqueta VENDEU — ignorando");
      return res.json({ ok: true, acao: "ignorado", etiquetas: etiquetas });
    }

    var phone = body.number || body.phone || body.numero ||
      (body.contact && body.contact.phone) || "";
    var nome  = body.name  || body.nome  ||
      (body.contact && body.contact.name) || "Cliente";

    log("VENDA DETECTADA! " + nome + " | Telefone: " + phone);

    if (!phone) {
      return res.status(400).json({ ok: false, erro: "Telefone ausente", body: body });
    }

    var anuncio   = detectarAnuncioPorDDD(phone);
    var valor     = extrairValor(etiquetas);
    var timestamp = Date.now();
    var eventId   = gerarEventId(phone, timestamp);

    log("Anuncio: " + anuncio.nome + " | DDD: " + anuncio.ddd + " | Valor: R$" + valor);

    var respostaMeta = await enviarParaMeta(phone, valor, anuncio, eventId, timestamp);
    log("META OK! Eventos recebidos: " + respostaMeta.events_received);

    var registro = {
      id:      eventId,
      data:    new Date(timestamp).toLocaleString("pt-BR"),
      cliente: nome,
      phone:   "**" + String(phone).slice(-4),
      ddd:     anuncio.ddd,
      anuncio: anuncio.nome,
      valor:   valor,
      meta_ok: respostaMeta.events_received,
    };
    vendasRegistradas.unshift(registro);
    if (vendasRegistradas.length > 200) vendasRegistradas.pop();

    return res.json({ ok: true, registro: registro });

  } catch (err) {
    log("ERRO: " + err.message);
    return res.status(500).json({ ok: false, erro: err.message });
  }
});

app.get("/vendas", function(req, res) {
  res.json({ total: vendasRegistradas.length, vendas: vendasRegistradas });
});

app.get("/", function(req, res) {
  res.json({
    status:           "online",
    pixel:            CONFIG.META_PIXEL_ID !== "SEU_PIXEL_ID_AQUI" ? "configurado" : "pendente",
    etiqueta_venda:   CONFIG.ETIQUETA_VENDA,
    deteccao_anuncio: "automatica por DDD",
    anuncios: {
      ADS_MA_PA:  "MA e PA",
      ADS_NE:     "CE, PI, BA, PB, RN, PE",
      ADS_SP_MG:  "SP, MG, GO e Sul",
      ADS_OUTROS: "Fora dos anuncios",
    }
  });
});

app.listen(CONFIG.PORT, function() {
  log("Servidor na porta " + CONFIG.PORT);
});
