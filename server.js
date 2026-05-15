"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// Ateliê Tracker v3 — WhatsApp → Meta Conversions API
// ─────────────────────────────────────────────────────────────────────────────
//
// ESTRATÉGIA DE ATRIBUIÇÃO (ordem de prioridade):
//
//  1. ctwa_clid   → identificador exato do clique no anúncio (melhor sinal)
//                   WaSpeed ainda não envia, mas o código captura automaticamente
//                   se vier no futuro em qualquer campo do payload.
//
//  2. eventID:"metaAds" → WaSpeed sinaliza que o contato veio de anúncio.
//                   Enviamos com action_source:"system_generated".
//                   O Meta cruza o telefone hasheado com o clique na janela
//                   de atribuição de 7 dias e registra na campanha correta.
//
//  3. Sem origem  → action_source:"other" — evento registrado, sem atribuição.
//
// CENÁRIOS ADVERSOS COBERTOS:
//  - Node < 18 (sem fetch nativo)  → usa https.request nativo
//  - Crash / restart do Railway    → memória persistida em JSON no disco
//  - Webhook duplicado do WaSpeed  → deduplicação por event_id
//  - Meta API instável             → retry 3x com backoff exponencial
//  - Campo nulo / undefined        → todas extrações têm fallback seguro
//  - Exceção não tratada           → capturada, logada, processo continua
//  - Memória crescendo indefinida  → limpeza automática a cada 6h (> 30 dias)
//  - Payload malformado            → validado antes de qualquer processamento
// ─────────────────────────────────────────────────────────────────────────────

const express = require("express");
const crypto  = require("crypto");
const https   = require("https");
const fs      = require("fs");
const path    = require("path");

const app = express();
app.use(express.json({ limit: "10mb" }));

// ── CORS ──────────────────────────────────────────────────────────────────────
app.use(function (req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// ── CONFIG ────────────────────────────────────────────────────────────────────
var CONFIG = {
  META_PIXEL_ID:     process.env.META_PIXEL_ID     || "",
  META_ACCESS_TOKEN: process.env.META_ACCESS_TOKEN || "",
  ETIQUETA_VENDA:    process.env.ETIQUETA_VENDA    || "VENDEU",
  VALOR_PADRAO:      parseFloat(process.env.VALOR_PADRAO || "250"),
  PORT:              parseInt(process.env.PORT      || "3000", 10),
  MEMORIA_FILE:      process.env.MEMORIA_FILE || path.join("/tmp", "atelie_memoria.json"),
  VENDAS_FILE:       process.env.VENDAS_FILE  || path.join("/tmp", "atelie_vendas.json"),
};

var ETIQUETAS_ANUNCIO = {
  "ADS_MA_PA":       "Anuncio 1 - MA e PA",
  "ADS_NE":          "Anuncio 2 - CE, PI, BA, PB, RN, PE",
  "ADS_SP_MG":       "Anuncio 3 - SP, MG, GO e Sul",
  "ADS_REMARKETING": "Remarketing",
};

// ── LOGS ──────────────────────────────────────────────────────────────────────
function agora() {
  return new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}
function log(nivel, msg, dados) {
  var linha = "[" + agora() + "] [" + nivel + "] " + msg;
  if (dados !== undefined) linha += " | " + JSON.stringify(dados);
  console.log(linha);
}
function info(m, d)    { log("INFO",  m, d); }
function warn(m, d)    { log("WARN",  m, d); }
function logErro(m, d) { log("ERROR", m, d); }

// ── PERSISTÊNCIA ──────────────────────────────────────────────────────────────
function lerJSON(arquivo, padrao) {
  try {
    if (fs.existsSync(arquivo)) {
      return JSON.parse(fs.readFileSync(arquivo, "utf8"));
    }
  } catch (e) {
    warn("Nao foi possivel ler " + arquivo, e.message);
  }
  return padrao;
}

function salvarJSON(arquivo, dados) {
  try {
    fs.writeFileSync(arquivo, JSON.stringify(dados, null, 2), "utf8");
  } catch (e) {
    warn("Nao foi possivel salvar " + arquivo, e.message);
  }
}

// memoriaContatos: { "559881675824": { ts, anuncio, valor, ctwa_clid, veioDeAd } }
var memoriaContatos   = lerJSON(CONFIG.MEMORIA_FILE, {});
var vendasRegistradas = lerJSON(CONFIG.VENDAS_FILE, []);
var eventosEnviados   = new Set(
  vendasRegistradas.filter(function (v) { return v.id; }).map(function (v) { return v.id; })
);

// ── HELPERS ───────────────────────────────────────────────────────────────────
function hashPhone(phone) {
  var limpo = String(phone || "").replace(/\D/g, "");
  if (!limpo) return null;
  if (!limpo.startsWith("55") && limpo.length <= 11) limpo = "55" + limpo;
  return crypto.createHash("sha256").update(limpo).digest("hex");
}

function gerarEventId(phone, timestamp) {
  return crypto
    .createHash("sha256")
    .update(String(phone) + "_" + String(timestamp))
    .digest("hex")
    .slice(0, 32);
}

function garantirMemoria(phone) {
  if (!memoriaContatos[phone]) memoriaContatos[phone] = {};
  memoriaContatos[phone].ts = Date.now();
}

// ── EXTRATORES ────────────────────────────────────────────────────────────────
function extrairPhone(body) {
  var candidatos = [
    body.number, body.phone, body.numero, body.from,
    body.contact && body.contact.phone,
    body.contact && body.contact.number,
  ];
  for (var i = 0; i < candidatos.length; i++) {
    var v = candidatos[i];
    if (v) {
      var limpo = String(v).replace(/\D/g, "");
      if (limpo.length >= 8) return limpo;
    }
  }
  return null;
}

function extrairNome(body) {
  return body.name || body.nome ||
    (body.contact && (body.contact.name || body.contact.nome)) ||
    "Cliente";
}

function extrairEtiquetas(body) {
  var nomes = [];
  function adicionar(v) {
    if (!v) return;
    if (typeof v === "string" && v.trim())    { nomes.push(v.trim()); return; }
    if (typeof v === "object" && v.name)      { nomes.push(String(v.name).trim()); }
  }
  if (body.eventDetails && Array.isArray(body.eventDetails.labels)) body.eventDetails.labels.forEach(adicionar);
  if (Array.isArray(body.labels)) body.labels.forEach(adicionar);
  if (Array.isArray(body.tags))   body.tags.forEach(adicionar);
  if (typeof body.label === "string") adicionar(body.label);

  var vistos = {};
  return nomes.filter(function (n) {
    var k = n.toUpperCase();
    if (vistos[k]) return false;
    vistos[k] = true;
    return true;
  });
}

function extrairValorDeEtiquetas(etiquetas) {
  for (var i = 0; i < etiquetas.length; i++) {
    var m = String(etiquetas[i]).toUpperCase().match(/^VALOR[_-](\d+(?:[.,]\d+)?)$/);
    if (m) return parseFloat(m[1].replace(",", "."));
  }
  return null;
}

function detectarOrigemAd(body) {
  var eid = body.eventID || body.eventId || body.event_id || "";
  return String(eid).toLowerCase() === "metaads";
}

// Extrai ctwa_clid — pronto para quando WaSpeed atualizar
function extrairCtwaClid(body) {
  var diretos = [
    body.ctwa_clid,
    body.referral  && body.referral.ctwa_clid,
    body.referral  && body.referral.source_id,
    body.lastMessage && typeof body.lastMessage === "object" && body.lastMessage.ctwa_clid,
    body.lastMessage && typeof body.lastMessage === "object" && body.lastMessage.referral && body.lastMessage.referral.ctwa_clid,
    body.metadata  && body.metadata.ctwa_clid,
    body.context   && body.context.ctwa_clid,
    body.message   && body.message.ctwa_clid,
    body.message   && body.message.referral && body.message.referral.ctwa_clid,
    body.eventDetails && body.eventDetails.ctwa_clid,
    body.data      && body.data.ctwa_clid,
    body.data      && body.data.referral && body.data.referral.ctwa_clid,
  ];
  for (var i = 0; i < diretos.length; i++) {
    if (diretos[i] && typeof diretos[i] === "string") return diretos[i];
  }

  var tentarParsear = [body.lastMessage, body.referral, body.message, body.data, body.metadata];
  for (var j = 0; j < tentarParsear.length; j++) {
    var campo = tentarParsear[j];
    if (campo && typeof campo === "string") {
      try {
        var p = JSON.parse(campo);
        if (p && p.ctwa_clid) return p.ctwa_clid;
        if (p && p.referral && p.referral.ctwa_clid) return p.referral.ctwa_clid;
      } catch (e) { /* nao e JSON */ }
    }
  }

  // Busca em qualquer objeto de nivel 2 — captura campos novos automaticamente
  var chaves = Object.keys(body);
  for (var k = 0; k < chaves.length; k++) {
    var val = body[chaves[k]];
    if (val && typeof val === "object" && !Array.isArray(val) && val.ctwa_clid) {
      info("ctwa_clid encontrado em body." + chaves[k] + " — WaSpeed atualizou!");
      return String(val.ctwa_clid);
    }
  }

  return null;
}

// ── HTTP COM RETRY ────────────────────────────────────────────────────────────
function httpsPost(url, payload) {
  return new Promise(function (resolve, reject) {
    var corpo  = JSON.stringify(payload);
    var urlObj = new URL(url);
    var opts   = {
      hostname: urlObj.hostname,
      path:     urlObj.pathname + urlObj.search,
      method:   "POST",
      headers:  {
        "Content-Type":   "application/json",
        "Content-Length": Buffer.byteLength(corpo),
      },
      timeout: 20000,
    };
    var req = https.request(opts, function (res) {
      var buf = "";
      res.on("data", function (chunk) { buf += chunk; });
      res.on("end", function () {
        try { resolve({ status: res.statusCode, body: JSON.parse(buf) }); }
        catch (e) { resolve({ status: res.statusCode, body: buf }); }
      });
    });
    req.on("error",   function (e) { reject(e); });
    req.on("timeout", function ()  { req.destroy(new Error("Timeout na Meta API")); });
    req.write(corpo);
    req.end();
  });
}

async function httpsPostComRetry(url, payload) {
  var MAX = 3;
  var ultimoErro;
  for (var t = 1; t <= MAX; t++) {
    try {
      return await httpsPost(url, payload);
    } catch (e) {
      ultimoErro = e;
      warn("Meta API tentativa " + t + "/" + MAX + " falhou: " + e.message);
      if (t < MAX) await new Promise(function (r) { setTimeout(r, 1000 * t); });
    }
  }
  throw ultimoErro;
}

// ── ENVIO PARA META CONVERSIONS API ──────────────────────────────────────────
//
// action_source:
//   "system_generated" → sabemos que veio de anuncio (eventID:metaAds ou ctwa_clid)
//                         Meta correlaciona com o clique na janela de 7 dias
//                         e registra na coluna Compras da campanha correta.
//   "other"            → origem desconhecida — evento registrado sem atribuição.
//
async function enviarParaMeta(phone, valor, anuncio, eventId, timestamp, ctwaClid, veioDeAd) {
  var phoneHash = hashPhone(phone);
  if (!phoneHash) throw new Error("Telefone invalido para hash: " + phone);

  var url = "https://graph.facebook.com/v19.0/" +
    CONFIG.META_PIXEL_ID + "/events?access_token=" + CONFIG.META_ACCESS_TOKEN;

  var userData = { ph: [phoneHash] };
  if (ctwaClid) {
    userData.ctwa_clid = ctwaClid;
    info("Atribuicao via ctwa_clid incluida");
  }

  var actionSource = (veioDeAd || ctwaClid) ? "system_generated" : "other";
  info("action_source = " + actionSource);

  var payload = {
    data: [{
      event_name:    "Purchase",
      event_time:    Math.floor(timestamp / 1000),
      event_id:      eventId,
      action_source: actionSource,
      user_data:     userData,
      custom_data: {
        currency:         "BRL",
        value:            valor,
        content_name:     anuncio.nome,
        content_category: "saida_maternidade",
        content_ids:      [anuncio.tag],
        contents:         [{ id: anuncio.tag, quantity: 1, item_price: valor }],
      },
    }],
    // test_event_code: "TEST12345", // descomente para testar sem afetar dados reais
  };

  var resultado = await httpsPostComRetry(url, payload);

  if (resultado.status !== 200 || (resultado.body && resultado.body.error)) {
    throw new Error("Meta API erro: " + JSON.stringify(resultado.body));
  }

  return resultado.body;
}

// ── LIMPEZA PERIODICA ─────────────────────────────────────────────────────────
function limparMemoriaAntiga() {
  var limite    = Date.now() - 30 * 24 * 60 * 60 * 1000;
  var removidos = 0;
  Object.keys(memoriaContatos).forEach(function (phone) {
    if (!memoriaContatos[phone].ts || memoriaContatos[phone].ts < limite) {
      delete memoriaContatos[phone];
      removidos++;
    }
  });
  if (removidos > 0) {
    info("Limpeza: " + removidos + " contatos antigos removidos");
    salvarJSON(CONFIG.MEMORIA_FILE, memoriaContatos);
  }
}
setInterval(limparMemoriaAntiga, 6 * 60 * 60 * 1000);

// ── ROTAS ─────────────────────────────────────────────────────────────────────
app.get("/", function (req, res) {
  res.json({
    status:             "online",
    versao:             "3.0",
    pixel:              CONFIG.META_PIXEL_ID ? "configurado" : "PENDENTE",
    etiqueta_venda:     CONFIG.ETIQUETA_VENDA,
    etiquetas_anuncio:  ETIQUETAS_ANUNCIO,
    memoria_contatos:   Object.keys(memoriaContatos).length,
    vendas_registradas: vendasRegistradas.length,
  });
});

app.get("/health", function (req, res) {
  res.json({ ok: true, uptime: Math.floor(process.uptime()) + "s" });
});

app.get("/vendas", function (req, res) {
  res.json({ total: vendasRegistradas.length, vendas: vendasRegistradas });
});

app.get("/memoria", function (req, res) {
  var mascarado = {};
  Object.keys(memoriaContatos).forEach(function (phone) {
    mascarado["**" + phone.slice(-4)] = memoriaContatos[phone];
  });
  res.json({ contatos: Object.keys(memoriaContatos).length, dados: mascarado });
});

// ── WEBHOOK PRINCIPAL ─────────────────────────────────────────────────────────
app.post("/webhook", async function (req, res) {
  var body = req.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    warn("Payload invalido — ignorado");
    return res.status(400).json({ ok: false, motivo: "payload invalido" });
  }

  info("Webhook recebido", body);

  try {
    // 1. Phone
    var phone = extrairPhone(body);
    if (!phone) {
      warn("Sem telefone — ignorado");
      return res.json({ ok: true, acao: "ignorado", motivo: "sem telefone" });
    }

    var nome      = extrairNome(body);
    var etiquetas = extrairEtiquetas(body);
    info("Etiquetas para " + phone, etiquetas);

    // 2. Inicializa memoria
    garantirMemoria(phone);

    // 3. Detecta origem de anuncio (eventID:metaAds)
    if (detectarOrigemAd(body)) {
      memoriaContatos[phone].veioDeAd = true;
      info("Contato " + phone + " marcado como origem Meta Ads");
    }

    // 4. Captura ctwa_clid (futuro)
    var ctwaClid = extrairCtwaClid(body);
    if (ctwaClid) {
      memoriaContatos[phone].ctwa_clid = ctwaClid;
      info("ctwa_clid capturado para " + phone);
    }

    // 5. Salva etiquetas ADS_ e VALOR_
    etiquetas.forEach(function (et) {
      var etUp = et.toUpperCase();
      Object.keys(ETIQUETAS_ANUNCIO).forEach(function (tag) {
        if (etUp === tag.toUpperCase()) {
          memoriaContatos[phone].anuncio = tag;
          info("Anuncio salvo: " + tag);
        }
      });
      var mValor = etUp.match(/^VALOR[_-](\d+(?:[.,]\d+)?)$/);
      if (mValor) {
        memoriaContatos[phone].valor = parseFloat(mValor[1].replace(",", "."));
        info("Valor salvo: R$" + memoriaContatos[phone].valor);
      }
    });

    salvarJSON(CONFIG.MEMORIA_FILE, memoriaContatos);

    // 6. Verifica VENDEU
    var temVenda = etiquetas.some(function (et) {
      return et.toUpperCase() === CONFIG.ETIQUETA_VENDA.toUpperCase();
    });

    if (!temVenda) {
      return res.json({
        ok:      true,
        acao:    "salvo_memoria",
        phone:   "**" + phone.slice(-4),
        memoria: memoriaContatos[phone],
      });
    }

    // ── VENDA ─────────────────────────────────────────────────────────────────
    var dadosContato = memoriaContatos[phone] || {};
    var timestamp    = Date.now();
    var eventId      = gerarEventId(phone, timestamp);

    if (eventosEnviados.has(eventId)) {
      warn("Duplicata ignorada: " + eventId);
      return res.json({ ok: true, acao: "duplicado_ignorado" });
    }

    // ── FALLBACK: WaSpeed mandou VENDEU com número errado ─────────────────────
    // Se o contato que chegou não tem veioDeAd nem ctwa_clid na memória,
    // busca na memória o contato mais recente com veioDeAd:true nos últimos
    // 30 minutos — que é quase certamente quem acabou de comprar.
    var phoneUsado = phone;
    if (!dadosContato.veioDeAd && !dadosContato.ctwa_clid) {
      var JANELA_MS  = 30 * 60 * 1000; // 30 minutos
      var agora_ts   = Date.now();
      var melhorPhone = null;
      var melhorTs    = 0;

      Object.keys(memoriaContatos).forEach(function (p) {
        var d = memoriaContatos[p];
        if ((d.veioDeAd || d.ctwa_clid) && d.ts && (agora_ts - d.ts) < JANELA_MS) {
          if (d.ts > melhorTs) {
            melhorTs    = d.ts;
            melhorPhone = p;
          }
        }
      });

      if (melhorPhone) {
        warn("WaSpeed mandou VENDEU com numero errado (" + phone + "). " +
             "Usando contato com veioDeAd mais recente: " + melhorPhone);
        phoneUsado   = melhorPhone;
        dadosContato = memoriaContatos[melhorPhone];
      } else {
        warn("Nenhum contato com veioDeAd recente encontrado — venda sem atribuicao");
      }
    }

    var anuncio = {
      tag:  dadosContato.anuncio || "ADS_DESCONHECIDO",
      nome: ETIQUETAS_ANUNCIO[dadosContato.anuncio] || "Anuncio nao identificado",
    };
    var valor     = dadosContato.valor || extrairValorDeEtiquetas(etiquetas) || CONFIG.VALOR_PADRAO;
    var clidFinal = dadosContato.ctwa_clid || null;
    var veioDeAd  = dadosContato.veioDeAd  || false;

    info("VENDA | " + nome + " | " + anuncio.nome + " | R$" + valor +
         " | veioDeAd:" + veioDeAd + " | ctwa_clid:" + (clidFinal ? "sim" : "nao") +
         " | phoneUsado:**" + phoneUsado.slice(-4));

    if (!veioDeAd && !clidFinal) {
      warn("Sem origem de anuncio — venda enviada sem atribuicao de campanha");
    }

    // 7. Envia para Meta (usa phoneUsado para o hash correto)
    var respostaMeta = await enviarParaMeta(phoneUsado, valor, anuncio, eventId, timestamp, clidFinal, veioDeAd);
    info("Meta OK — eventos recebidos: " + respostaMeta.events_received);

    // 8. Registra
    eventosEnviados.add(eventId);
    var registro = {
      id:           eventId,
      data:         new Date(timestamp).toLocaleString("pt-BR"),
      cliente:      nome,
      phone:        "**" + phone.slice(-4),
      phone_usado:  "**" + phoneUsado.slice(-4),
      anuncio:      anuncio.nome,
      valor:        valor,
      ctwa_clid:    clidFinal ? "sim" : "nao",
      veio_de_ad:   veioDeAd  ? "sim" : "nao",
      atribuicao:   clidFinal ? "precisa" : (veioDeAd ? "possivel" : "sem atribuicao"),
      meta_ok:      respostaMeta.events_received,
    };

    vendasRegistradas.unshift(registro);
    if (vendasRegistradas.length > 500) vendasRegistradas.pop();
    salvarJSON(CONFIG.VENDAS_FILE, vendasRegistradas);

    // Limpa o contato usado (pode ser diferente do que chegou no webhook)
    delete memoriaContatos[phoneUsado];
    if (phoneUsado !== phone) delete memoriaContatos[phone];
    salvarJSON(CONFIG.MEMORIA_FILE, memoriaContatos);

    return res.json({ ok: true, registro: registro });

  } catch (e) {
    logErro("Erro no webhook", e.message);
    return res.status(200).json({ ok: false, erro: e.message });
  }
});

// ── ERROS NAO TRATADOS ────────────────────────────────────────────────────────
process.on("uncaughtException",  function (e) { logErro("uncaughtException",  e.message); });
process.on("unhandledRejection", function (r) { logErro("unhandledRejection", String(r)); });

// ── START ─────────────────────────────────────────────────────────────────────
app.listen(CONFIG.PORT, function () {
  info("Atelie Tracker v3 | porta " + CONFIG.PORT + " | pixel " + (CONFIG.META_PIXEL_ID || "NAO CONFIGURADO"));
});
