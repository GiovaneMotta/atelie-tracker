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

const ETIQUETAS_ANUNCIO = {
  "ADS_MA_PA":       "Anuncio 1 - MA e PA",
  "ADS_NE":          "Anuncio 2 - CE, PI, BA, PB, RN, PE",
  "ADS_SP_MG":       "Anuncio 3 - SP, MG, GO e Sul",
  "ADS_REMARKETING": "Remarketing",
};

// ── Memória por contato ──────────────────────────────────────
// Salva anuncio e valor por número enquanto o servidor está ativo
var memoriaContatos = {};
// ex: { "77099142541401": { anuncio: "ADS_SP_MG", valor: 423.68 } }

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

function extrairEtiquetas(body) {
  var nomes = [];
  if (body.eventDetails && Array.isArray(body.eventDetails.labels)) {
    body.eventDetails.labels.forEach(function(l) {
      if (l && l.name) nomes.push(String(l.name).trim());
    });
  }
  if (nomes.length === 0 && Array.isArray(body.labels)) {
    body.labels.forEach(function(l) {
      if (typeof l === "object" && l.name) nomes.push(String(l.name).trim());
      else if (typeof l === "string") nomes.push(l.trim());
    });
  }
  return nomes;
}

function extrairValorDeEtiquetas(etiquetas) {
  for (var i = 0; i < etiquetas.length; i++) {
    var match = String(etiquetas[i]).toUpperCase().match(/^VALOR[_-](\d+(?:[.,]\d+)?)$/);
    if (match) return parseFloat(match[1].replace(",", "."));
  }
  return null;
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

    var phone = body.number || body.phone || body.numero ||
      (body.contact && body.contact.phone) || "";
    var nome  = body.name || body.nome ||
      (body.contact && body.contact.name) || "Cliente";

    if (!phone) {
      return res.json({ ok: true, acao: "ignorado", motivo: "sem telefone" });
    }

    // ── Salva anúncio na memória quando chegar etiqueta ADS_ ──
    for (var i = 0; i < etiquetas.length; i++) {
      var e = etiquetas[i].toUpperCase();
      for (var tag in ETIQUETAS_ANUNCIO) {
        if (e === tag.toUpperCase()) {
          if (!memoriaContatos[phone]) memoriaContatos[phone] = {};
          memoriaContatos[phone].anuncio = tag;
          log("Anuncio salvo na memoria: " + tag + " para " + phone);
        }
      }
      // Salva valor na memória
      var matchValor = etiquetas[i].toUpperCase().match(/^VALOR[_-](\d+(?:[.,]\d+)?)$/);
      if (matchValor) {
        if (!memoriaContatos[phone]) memoriaContatos[phone] = {};
        memoriaContatos[phone].valor = parseFloat(matchValor[1].replace(",", "."));
        log("Valor salvo na memoria: R$" + memoriaContatos[phone].valor + " para " + phone);
      }
    }

    // ── Verifica se é etiqueta VENDEU ────────────────────────
    var temVenda = etiquetas.some(function(e) {
      return e.toUpperCase() === CONFIG.ETIQUETA_VENDA.toUpperCase();
    });

    if (!temVenda) {
      log("Nao e VENDEU — salvo na memoria e ignorando");
      return res.json({ ok: true, acao: "salvo_memoria", phone: phone, memoria: memoriaContatos[phone] });
    }

    // ── Processa a venda ─────────────────────────────────────
    var dadosContato = memoriaContatos[phone] || {};

    // Pega anúncio da memória ou usa desconhecido
    var anuncio = {
      tag:  dadosContato.anuncio || "ADS_DESCONHECIDO",
      nome: ETIQUETAS_ANUNCIO[dadosContato.anuncio] || "Anuncio nao identificado",
    };

    // Pega valor da memória ou padrão
    var valor = dadosContato.valor || extrairValorDeEtiquetas(etiquetas) || CONFIG.VALOR_PADRAO;

    var timestamp = Date.now();
    var eventId   = gerarEventId(phone, timestamp);

    log("VENDA! " + nome + " | Anuncio: " + anuncio.nome + " | Valor: R$" + valor);

    var respostaMeta = await enviarParaMeta(phone, valor, anuncio, eventId, timestamp);
    log("META OK! Eventos recebidos: " + respostaMeta.events_received);

    // Limpa memória do contato após venda registrada
    delete memoriaContatos[phone];

    var registro = {
      id:      eventId,
      data:    new Date(timestamp).toLocaleString("pt-BR"),
      cliente: nome,
      phone:   "**" + String(phone).slice(-4),
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

app.get("/memoria", function(req, res) {
  res.json({ contatos: Object.keys(memoriaContatos).length, dados: memoriaContatos });
});

app.get("/", function(req, res) {
  res.json({
    status:            "online",
    pixel:             CONFIG.META_PIXEL_ID !== "SEU_PIXEL_ID_AQUI" ? "configurado" : "pendente",
    etiqueta_venda:    CONFIG.ETIQUETA_VENDA,
    etiquetas_anuncio: ETIQUETAS_ANUNCIO,
  });
});

app.listen(CONFIG.PORT, function() {
  log("Servidor na porta " + CONFIG.PORT);
});
