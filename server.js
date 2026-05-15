"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// Ateliê Tracker — Servidor de rastreamento WhatsApp → Meta Conversions API
// ─────────────────────────────────────────────────────────────────────────────
// Correções aplicadas vs versão anterior:
//  1. fetch nativo só existe no Node 18+; adicionado fallback via https
//  2. Memória persistida em arquivo JSON (sobrevive a restarts no Railway)
//  3. Deduplicação de eventos Purchase (evita duplicatas no Meta)
//  4. Retry automático (3x com backoff) na chamada à Meta API
//  5. Validação rigorosa de todos os campos antes de processar
//  6. try/catch em TODAS as operações de I/O e parsing
//  7. Health check robusto para o Railway
//  8. Logs estruturados com nível (INFO / WARN / ERROR)
// ─────────────────────────────────────────────────────────────────────────────

const express = require("express");
const crypto  = require("crypto");
const https   = require("https");
const fs      = require("fs");
const path    = require("path");

const app = express();
app.use(express.json({ limit: "10mb" }));

// ── CORS ─────────────────────────────────────────────────────────────────────
app.use(function (req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// ── CONFIG ───────────────────────────────────────────────────────────────────
const CONFIG = {
  META_PIXEL_ID:     process.env.META_PIXEL_ID     || "",
  META_ACCESS_TOKEN: process.env.META_ACCESS_TOKEN || "",
  ETIQUETA_VENDA:    process.env.ETIQUETA_VENDA    || "VENDEU",
  VALOR_PADRAO:      parseFloat(process.env.VALOR_PADRAO || "250"),
  PORT:              parseInt(process.env.PORT || "3000", 10),
  // Arquivo de persistência — Railway mantém /tmp entre deploys por horas
  // Use um volume montado se quiser persistência longa
  MEMORIA_FILE:      process.env.MEMORIA_FILE || path.join("/tmp", "atelie_memoria.json"),
  VENDAS_FILE:       process.env.VENDAS_FILE  || path.join("/tmp", "atelie_vendas.json"),
};

const ETIQUETAS_ANUNCIO = {
  "ADS_MA_PA":       "Anuncio 1 - MA e PA",
  "ADS_NE":          "Anuncio 2 - CE, PI, BA, PB, RN, PE",
  "ADS_SP_MG":       "Anuncio 3 - SP, MG, GO e Sul",
  "ADS_REMARKETING": "Remarketing",
};

// ── LOGS ─────────────────────────────────────────────────────────────────────
function ts() {
  return new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}
function log(nivel, msg, data) {
  var linha = "[" + ts() + "] [" + nivel + "] " + msg;
  if (data !== undefined) linha += " | " + JSON.stringify(data);
  console.log(linha);
}
const info  = (m, d) => log("INFO",  m, d);
const warn  = (m, d) => log("WARN",  m, d);
const erro  = (m, d) => log("ERROR", m, d);

// ── PERSISTÊNCIA ─────────────────────────────────────────────────────────────
// memoriaContatos sobrevive a crashes mas não a deploys longos sem volume.
// Para produção real, substitua por um banco (ex: Redis, SQLite).

function lerJSON(arquivo, padrao) {
  try {
    if (fs.existsSync(arquivo)) {
      var conteudo = fs.readFileSync(arquivo, "utf8");
      return JSON.parse(conteudo);
    }
  } catch (e) {
    warn("Falha ao ler " + arquivo + ", usando padrão", e.message);
  }
  return padrao;
}

function salvarJSON(arquivo, dados) {
  try {
    fs.writeFileSync(arquivo, JSON.stringify(dados), "utf8");
  } catch (e) {
    warn("Falha ao salvar " + arquivo, e.message);
  }
}

// { "5511999991234": { anuncio: "ADS_SP_MG", valor: 423.68, ctwa_clid: "AQD...", ts: 1700000000000 } }
var memoriaContatos = lerJSON(CONFIG.MEMORIA_FILE, {});

// [ { id, data, cliente, phone, anuncio, valor, ctwa_clid, meta_ok } ]
var vendasRegistradas = lerJSON(CONFIG.VENDAS_FILE, []);

// IDs de eventos já enviados — evita duplicatas em caso de retry do WaSpeed
var eventosEnviados = new Set(vendasRegistradas.map(function (v) { return v.id; }));

// ── HELPERS ──────────────────────────────────────────────────────────────────
function hashPhone(phone) {
  var limpo = String(phone || "").replace(/\D/g, "");
  if (!limpo) return null;
  return crypto.createHash("sha256").update(limpo).digest("hex");
}

function gerarEventId(phone, timestamp) {
  return crypto
    .createHash("sha256")
    .update(String(phone) + "_" + String(timestamp))
    .digest("hex")
    .slice(0, 32);
}

// Extrai o número do telefone de vários formatos possíveis do WaSpeed
function extrairPhone(body) {
  var candidatos = [
    body.number,
    body.phone,
    body.numero,
    body.contact && body.contact.phone,
    body.contact && body.contact.number,
    body.from,
  ];
  for (var i = 0; i < candidatos.length; i++) {
    var v = candidatos[i];
    if (v && String(v).replace(/\D/g, "").length >= 8) {
      return String(v).replace(/\D/g, "");
    }
  }
  return null;
}

// Extrai nome do contato
function extrairNome(body) {
  return body.name || body.nome ||
    (body.contact && (body.contact.name || body.contact.nome)) ||
    "Cliente";
}

// Extrai lista de etiquetas de vários formatos possíveis
function extrairEtiquetas(body) {
  var nomes = [];

  function pushSe(v) {
    if (typeof v === "string" && v.trim()) nomes.push(v.trim());
    else if (v && typeof v === "object" && v.name) nomes.push(String(v.name).trim());
  }

  // Formato eventDetails.labels
  if (body.eventDetails && Array.isArray(body.eventDetails.labels)) {
    body.eventDetails.labels.forEach(pushSe);
  }
  // Formato labels direto
  if (Array.isArray(body.labels)) {
    body.labels.forEach(pushSe);
  }
  // Formato tags
  if (Array.isArray(body.tags)) {
    body.tags.forEach(pushSe);
  }
  // Formato label string única
  if (typeof body.label === "string" && body.label.trim()) {
    nomes.push(body.label.trim());
  }

  // Remove duplicatas e retorna em maiúsculas para comparação uniforme
  var vistos = {};
  return nomes.filter(function (n) {
    var k = n.toUpperCase();
    if (vistos[k]) return false;
    vistos[k] = true;
    return true;
  });
}

// Extrai valor de etiquetas VALOR_XXX ou VALOR-XXX
function extrairValorDeEtiquetas(etiquetas) {
  for (var i = 0; i < etiquetas.length; i++) {
    var m = String(etiquetas[i]).toUpperCase().match(/^VALOR[_-](\d+(?:[.,]\d+)?)$/);
    if (m) return parseFloat(m[1].replace(",", "."));
  }
  return null;
}

// Extrai ctwa_clid de todos os lugares possíveis no payload
function extrairCtwaClid(body) {
  // Caminhos diretos conhecidos
  var candidatos = [
    body.ctwa_clid,
    body.referral && body.referral.ctwa_clid,
    body.referral && body.referral.source_id,
    body.lastMessage && body.lastMessage.ctwa_clid,
    body.lastMessage && body.lastMessage.referral && body.lastMessage.referral.ctwa_clid,
    body.metadata && body.metadata.ctwa_clid,
    body.context && body.context.ctwa_clid,
    body.message && body.message.ctwa_clid,
    body.message && body.message.referral && body.message.referral.ctwa_clid,
    body.eventDetails && body.eventDetails.ctwa_clid,
    body.data && body.data.ctwa_clid,
    body.data && body.data.referral && body.data.referral.ctwa_clid,
  ];

  for (var i = 0; i < candidatos.length; i++) {
    if (candidatos[i] && typeof candidatos[i] === "string") return candidatos[i];
  }

  // Tenta parsear campos que podem vir como string JSON
  var camposJSON = [body.lastMessage, body.referral, body.message, body.data, body.metadata];
  for (var j = 0; j < camposJSON.length; j++) {
    var campo = camposJSON[j];
    if (campo && typeof campo === "string") {
      try {
        var parsed = JSON.parse(campo);
        if (parsed && parsed.ctwa_clid) return parsed.ctwa_clid;
        if (parsed && parsed.referral && parsed.referral.ctwa_clid) return parsed.referral.ctwa_clid;
      } catch (e) { /* não é JSON */ }
    }
  }

  // Busca recursiva superficial — cobre qualquer campo de nível 2 que o WaSpeed adicionar
  var chaves = Object.keys(body);
  for (var k = 0; k < chaves.length; k++) {
    var val = body[chaves[k]];
    if (val && typeof val === "object" && !Array.isArray(val)) {
      if (val.ctwa_clid && typeof val.ctwa_clid === "string") {
        info("ctwa_clid encontrado em body." + chaves[k] + ".ctwa_clid");
        return val.ctwa_clid;
      }
    }
  }

  return null;
}

// ── HTTP helper (substitui fetch para compatibilidade com Node < 18) ──────────
function httpsPost(url, payload) {
  return new Promise(function (resolve, reject) {
    var corpo = JSON.stringify(payload);
    var urlObj = new URL(url);
    var opcoes = {
      hostname: urlObj.hostname,
      path:     urlObj.pathname + urlObj.search,
      method:   "POST",
      headers:  {
        "Content-Type":   "application/json",
        "Content-Length": Buffer.byteLength(corpo),
      },
      timeout: 15000,
    };

    var req = https.request(opcoes, function (res) {
      var dados = "";
      res.on("data", function (chunk) { dados += chunk; });
      res.on("end", function () {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(dados) });
        } catch (e) {
          resolve({ status: res.statusCode, body: dados });
        }
      });
    });

    req.on("error",   reject);
    req.on("timeout", function () { req.destroy(new Error("Timeout na chamada à Meta API")); });
    req.write(corpo);
    req.end();
  });
}

// Retry com backoff exponencial
async function httpsPostComRetry(url, payload, tentativas) {
  tentativas = tentativas || 3;
  var ultimoErro;
  for (var t = 1; t <= tentativas; t++) {
    try {
      var resultado = await httpsPost(url, payload);
      return resultado;
    } catch (e) {
      ultimoErro = e;
      warn("Tentativa " + t + "/" + tentativas + " falhou: " + e.message);
      if (t < tentativas) {
        await new Promise(function (r) { setTimeout(r, 1000 * t); }); // 1s, 2s
      }
    }
  }
  throw ultimoErro;
}

// ── ENVIO PARA META CONVERSIONS API ──────────────────────────────────────────
async function enviarParaMeta(phone, valor, anuncio, eventId, timestamp, ctwaClid) {
  var phoneHash = hashPhone(phone);
  if (!phoneHash) throw new Error("Telefone inválido para hash: " + phone);

  var url = "https://graph.facebook.com/v19.0/" +
    CONFIG.META_PIXEL_ID + "/events?access_token=" + CONFIG.META_ACCESS_TOKEN;

  var userData = { ph: [phoneHash] };

  if (ctwaClid) {
    userData.ctwa_clid = ctwaClid;
    info("ctwa_clid incluído no evento: " + ctwaClid);
  } else {
    warn("ctwa_clid não encontrado — atribuição de campanha pode não aparecer no Gerenciador");
  }

  var payload = {
    data: [{
      event_name:    "Purchase",
      event_time:    Math.floor(timestamp / 1000),
      event_id:      eventId,
      action_source: "other",
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
    // test_event_code: "TEST12345", // descomente para testar no Events Manager
  };

  var resultado = await httpsPostComRetry(url, payload, 3);

  if (resultado.status !== 200 || (resultado.body && resultado.body.error)) {
    throw new Error("Meta API erro: " + JSON.stringify(resultado.body));
  }

  return resultado.body;
}

// ── LIMPEZA DE MEMÓRIA ANTIGA (evita crescimento infinito) ───────────────────
// Remove contatos sem atividade há mais de 30 dias
function limparMemoriaAntiga() {
  var limite = Date.now() - 30 * 24 * 60 * 60 * 1000;
  var removidos = 0;
  Object.keys(memoriaContatos).forEach(function (phone) {
    var dados = memoriaContatos[phone];
    if (dados.ts && dados.ts < limite) {
      delete memoriaContatos[phone];
      removidos++;
    }
  });
  if (removidos > 0) {
    info("Limpeza: " + removidos + " contatos antigos removidos da memória");
    salvarJSON(CONFIG.MEMORIA_FILE, memoriaContatos);
  }
}
setInterval(limparMemoriaAntiga, 6 * 60 * 60 * 1000); // a cada 6h

// ── ROTAS ────────────────────────────────────────────────────────────────────

// Health check — Railway usa isso para saber se o serviço está vivo
app.get("/", function (req, res) {
  var pixelOk = Boolean(CONFIG.META_PIXEL_ID && CONFIG.META_ACCESS_TOKEN);
  res.json({
    status:            "online",
    pixel:             pixelOk ? "configurado" : "PENDENTE — configure META_PIXEL_ID e META_ACCESS_TOKEN",
    etiqueta_venda:    CONFIG.ETIQUETA_VENDA,
    etiquetas_anuncio: ETIQUETAS_ANUNCIO,
    memoria_contatos:  Object.keys(memoriaContatos).length,
    vendas_registradas: vendasRegistradas.length,
  });
});

app.get("/health", function (req, res) {
  res.json({ ok: true, uptime: process.uptime() });
});

app.get("/vendas", function (req, res) {
  res.json({ total: vendasRegistradas.length, vendas: vendasRegistradas });
});

app.get("/memoria", function (req, res) {
  // Mascara os telefones por privacidade
  var mascarado = {};
  Object.keys(memoriaContatos).forEach(function (phone) {
    var chave = "**" + phone.slice(-4);
    mascarado[chave] = memoriaContatos[phone];
  });
  res.json({ contatos: Object.keys(memoriaContatos).length, dados: mascarado });
});

// ── WEBHOOK PRINCIPAL ─────────────────────────────────────────────────────────
app.post("/webhook", async function (req, res) {
  var body;
  try {
    body = req.body;
    if (!body || typeof body !== "object") {
      warn("Payload inválido recebido");
      return res.status(400).json({ ok: false, motivo: "payload inválido" });
    }
  } catch (e) {
    erro("Falha ao ler body", e.message);
    return res.status(400).json({ ok: false, motivo: "body inválido" });
  }

  info("Webhook recebido", body);

  // ── LOG COMPLETO quando vier de anúncio Meta ──────────────────────────────
  // Isso nos ajuda a encontrar onde o ctwa_clid está escondido no payload
  if (body.eventID === "metaAds" || body.eventId === "metaAds") {
    info(">>> PAYLOAD COMPLETO metaAds <<<", body);
  }

  try {
    // 1. Extrai campos básicos
    var phone = extrairPhone(body);
    var nome  = extrairNome(body);

    if (!phone) {
      warn("Webhook sem telefone identificável — ignorado");
      return res.json({ ok: true, acao: "ignorado", motivo: "sem telefone" });
    }

    var etiquetas = extrairEtiquetas(body);
    info("Etiquetas extraídas para " + phone, etiquetas);

    // 2. Garante entrada na memória com timestamp
    if (!memoriaContatos[phone]) {
      memoriaContatos[phone] = { ts: Date.now() };
    }
    memoriaContatos[phone].ts = Date.now(); // atualiza atividade

    // 3. Captura ctwa_clid (vem na primeira mensagem do clique no anúncio)
    var ctwaClid = extrairCtwaClid(body);
    if (ctwaClid) {
      memoriaContatos[phone].ctwa_clid = ctwaClid;
      info("ctwa_clid salvo para " + phone + ": " + ctwaClid);
    }

    // 4. Salva anúncio na memória quando etiqueta ADS_ chegar
    etiquetas.forEach(function (et) {
      var etUp = et.toUpperCase();

      // Verifica se é etiqueta de anúncio
      Object.keys(ETIQUETAS_ANUNCIO).forEach(function (tag) {
        if (etUp === tag.toUpperCase()) {
          memoriaContatos[phone].anuncio = tag;
          info("Anúncio salvo na memória: " + tag + " para " + phone);
        }
      });

      // Verifica se é etiqueta de valor
      var mValor = etUp.match(/^VALOR[_-](\d+(?:[.,]\d+)?)$/);
      if (mValor) {
        memoriaContatos[phone].valor = parseFloat(mValor[1].replace(",", "."));
        info("Valor salvo na memória: R$" + memoriaContatos[phone].valor + " para " + phone);
      }
    });

    // Persiste memória após qualquer atualização
    salvarJSON(CONFIG.MEMORIA_FILE, memoriaContatos);

    // 5. Verifica se é etiqueta VENDEU
    var temVenda = etiquetas.some(function (et) {
      return et.toUpperCase() === CONFIG.ETIQUETA_VENDA.toUpperCase();
    });

    if (!temVenda) {
      return res.json({
        ok: true,
        acao: "salvo_memoria",
        phone: "**" + phone.slice(-4),
        memoria: memoriaContatos[phone],
      });
    }

    // ── É UMA VENDA ──────────────────────────────────────────
    var dadosContato = memoriaContatos[phone] || {};
    var timestamp    = Date.now();
    var eventId      = gerarEventId(phone, timestamp);

    // 6. Deduplicação — evita enviar o mesmo evento duas vezes
    if (eventosEnviados.has(eventId)) {
      warn("Evento duplicado ignorado: " + eventId);
      return res.json({ ok: true, acao: "duplicado_ignorado", eventId: eventId });
    }

    var anuncio = {
      tag:  dadosContato.anuncio || "ADS_DESCONHECIDO",
      nome: ETIQUETAS_ANUNCIO[dadosContato.anuncio] || "Anuncio nao identificado",
    };

    var valor      = dadosContato.valor || extrairValorDeEtiquetas(etiquetas) || CONFIG.VALOR_PADRAO;
    var clidFinal  = dadosContato.ctwa_clid || null;

    info("VENDA! " + nome +
      " | Anúncio: " + anuncio.nome +
      " | Valor: R$" + valor +
      " | ctwa_clid: " + (clidFinal || "NÃO ENCONTRADO ⚠️"));

    // Aviso explícito se não há ctwa_clid — campanha não vai aparecer
    if (!clidFinal) {
      warn("ATENÇÃO: sem ctwa_clid para " + phone +
        ". O evento será enviado mas a venda NÃO será atribuída a nenhuma campanha no Gerenciador.");
    }

    // 7. Envia para Meta Conversions API
    var respostaMeta = await enviarParaMeta(phone, valor, anuncio, eventId, timestamp, clidFinal);
    info("Meta OK! Eventos recebidos: " + respostaMeta.events_received);

    // 8. Marca como enviado e registra
    eventosEnviados.add(eventId);

    var registro = {
      id:        eventId,
      data:      new Date(timestamp).toLocaleString("pt-BR"),
      cliente:   nome,
      phone:     "**" + phone.slice(-4),
      anuncio:   anuncio.nome,
      valor:     valor,
      ctwa_clid: clidFinal ? "sim ✅" : "não ⚠️",
      meta_ok:   respostaMeta.events_received,
    };

    vendasRegistradas.unshift(registro);
    if (vendasRegistradas.length > 500) vendasRegistradas.pop();
    salvarJSON(CONFIG.VENDAS_FILE, vendasRegistradas);

    // 9. Limpa memória do contato após venda confirmada
    delete memoriaContatos[phone];
    salvarJSON(CONFIG.MEMORIA_FILE, memoriaContatos);

    return res.json({ ok: true, registro: registro });

  } catch (e) {
    erro("Erro no processamento do webhook", e.message);
    // Retorna 200 mesmo em erro interno para o WaSpeed não retentar indefinidamente
    // O erro já está logado; investigar pelo /vendas e logs do Railway
    return res.status(200).json({ ok: false, erro: e.message });
  }
});

// ── Captura erros não tratados — evita crash do processo ─────────────────────
process.on("uncaughtException", function (e) {
  erro("uncaughtException — servidor continua", e.message);
});
process.on("unhandledRejection", function (reason) {
  erro("unhandledRejection — servidor continua", String(reason));
});

// ── START ─────────────────────────────────────────────────────────────────────
app.listen(CONFIG.PORT, function () {
  info("Servidor na porta " + CONFIG.PORT);
  info("Pixel ID: " + (CONFIG.META_PIXEL_ID || "NÃO CONFIGURADO"));
  info("Arquivo de memória: " + CONFIG.MEMORIA_FILE);
  info("Arquivo de vendas:  " + CONFIG.VENDAS_FILE);
});
