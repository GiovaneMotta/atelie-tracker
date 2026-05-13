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

// ================================================================
//  MAPEAMENTO DDD -> ANUNCIO
//
//  ADS_MA_PA   = Maranhao e Para
//  ADS_NE      = CE, PI, BA, PB, RN, PE
//  ADS_SP_MG   = SP, MG, GO, Sul
// ================================================================
const ANUNCIOS_DDD = {

  // ── Anuncio 1: Maranhao e Para ──────────────────────────────
  98: "ADS_MA_PA", 99: "ADS_MA_PA",   // Maranhao
  91: "ADS_MA_PA", 93: "ADS_MA_PA",   // Para (Belem, Santarem)
  94: "ADS_MA_PA",                     // Para (Maraba)

  // ── Anuncio 2: CE, PI, BA, PB, RN, PE ──────────────────────
  85: "ADS_NE", 88: "ADS_NE",         // Ceara (Fortaleza, Juazeiro)
  86: "ADS_NE", 89: "ADS_NE",         // Piaui (Teresina, Picos)
  71: "ADS_NE", 73: "ADS_NE",         // Bahia (Salvador, Ilheus)
  74: "ADS_NE", 75: "ADS_NE",         // Bahia (Juazeiro, Feira de Santana)
  77: "ADS_NE",                        // Bahia (Vitoria da Conquista)
  83: "ADS_NE",                        // Paraiba (Joao Pessoa, Campina Grande)
  84: "ADS_NE",                        // Rio Grande do Norte (Natal)
  81: "ADS_NE", 87: "ADS_NE",         // Pernambuco (Recife, Petrolina)

  // ── Anuncio 3: SP, MG, GO e Sul ────────────────────────────
  // Sao Paulo
  11: "ADS_SP_MG", 12: "ADS_SP_MG", 13: "ADS_SP_MG", 14: "ADS_SP_MG",
  15: "ADS_SP_MG", 16: "ADS_SP_MG", 17: "ADS_SP_MG", 18: "ADS_SP_MG",
  19: "ADS_SP_MG",
  // Minas Gerais
  31: "ADS_SP_MG", 32: "ADS_SP_MG", 33: "ADS_SP_MG", 34: "ADS_SP_MG",
  35: "ADS_SP_MG", 37: "ADS_SP_MG", 38: "ADS_SP_MG",
  // Goias e DF
  61: "ADS_SP_MG", 62: "ADS_SP_MG", 64: "ADS_SP_MG",
  // Rio de Janeiro (bonus — proximo ao anuncio SP/MG)
  21: "ADS_SP_MG", 22: "ADS_SP_MG", 24: "ADS_SP_MG",
  // Espirito Santo
  27: "ADS_SP_MG", 28: "ADS_SP_MG",
  // Parana
  41: "ADS_SP_MG", 42: "ADS_SP_MG", 43: "ADS_SP_MG", 44: "ADS_SP_MG",
  45: "ADS_SP_MG", 46: "ADS_SP_MG",
  // Santa Catarina
  47: "ADS_SP_MG", 48: "ADS_SP_MG", 49: "ADS_SP_MG",
  // Rio Grande do Sul
  51: "ADS_SP_MG", 53: "ADS_SP_MG", 54: "ADS_SP_MG", 55: "ADS_SP_MG",
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

function extrairValor(etiquetas) {
  for (var i = 0; i < etiquetas.length; i++) {
    var texto = typeof etiquetas[i] === "object" ? String(etiquetas[i].name || "") : String(etiquetas[i]);
    var match = texto.toUpperCase().match(/^VALOR[_-](\d+(?:[.,]\d+)?)$/);
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

    // Etiqueta disparada neste momento (campo correto do WaSpeed)
    var etiquetaDisparada = "";
    if (body.eventDetails && body.eventDetails.name) {
      etiquetaDisparada = String(body.eventDetails.name).trim();
    } else if (body.event && body.event.details && body.event.details.name) {
      etiquetaDisparada = String(body.event.details.name).trim();
    }

    log("Etiqueta disparada: " + etiquetaDisparada);

    var temVenda = etiquetaDisparada.toUpperCase() === CONFIG.ETIQUETA_VENDA.toUpperCase();

    if (!temVenda) {
      log("Nao e etiqueta de venda — ignorando");
      return res.json({ ok: true, acao: "ignorado", etiqueta: etiquetaDisparada });
    }

    var phone = body.number || body.phone || body.numero ||
      (body.contact && body.contact.phone) || "";

    if (!phone) {
      return res.status(400).json({ ok: false, erro: "Telefone ausente", body: body });
    }

    var nome = body.name || body.nome ||
      (body.contact && body.contact.name) || "Cliente";

    // Pega todas as etiquetas para detectar VALOR_xxx
    var todasEtiquetas = [];
    if (Array.isArray(body.labels))    todasEtiquetas = body.labels;
    else if (Array.isArray(body.tags)) todasEtiquetas = body.tags;
    todasEtiquetas.push(etiquetaDisparada);

    var anuncio   = detectarAnuncioPorDDD(phone);
    var valor     = extrairValor(todasEtiquetas);
    var timestamp = Date.now();
    var eventId   = gerarEventId(phone, timestamp);

    log("VENDA! " + nome + " | DDD " + anuncio.ddd + " -> " + anuncio.nome + " | R$" + valor);

    var respostaMeta = await enviarParaMeta(phone, valor, anuncio, eventId, timestamp);
    log("Meta OK - eventos recebidos: " + respostaMeta.events_received);

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
