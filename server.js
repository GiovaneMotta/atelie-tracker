```javascript
const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();

app.use(express.json({ limit: "10mb" }));

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

const CONFIG = {
  PORT: process.env.PORT || 3000,

  META_PIXEL_ID:
    process.env.META_PIXEL_ID || "",

  META_ACCESS_TOKEN:
    process.env.META_ACCESS_TOKEN || "",

  ETIQUETA_VENDA:
    process.env.ETIQUETA_VENDA || "VENDEU",

  VALOR_PADRAO:
    parseFloat(process.env.VALOR_PADRAO || 250),

  DEBUG:
    process.env.DEBUG === "true"
};

const ETIQUETAS_ANUNCIO = {
  ADS_MA_PA: "Anuncio 1 - MA e PA",
  ADS_NE: "Anuncio 2 - Nordeste",
  ADS_SP_MG: "Anuncio 3 - SP/MG",
  ADS_REMARKETING: "Remarketing"
};

const DB_PATH = path.join(__dirname, "db.json");

function initDB() {
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(
      DB_PATH,
      JSON.stringify({
        contatos: {},
        vendas: [],
        eventos: {}
      }, null, 2)
    );
  }
}

function readDB() {
  return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
}

function saveDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

initDB();

function log(msg, data = null) {
  const ts = new Date().toLocaleString("pt-BR");

  console.log(
    `[${ts}] ${msg}`,
    data ? JSON.stringify(data, null, 2) : ""
  );
}

function normalizarTelefone(phone) {
  return String(phone || "")
    .replace(/\D/g, "")
    .trim();
}

function sha256(value) {
  return crypto
    .createHash("sha256")
    .update(String(value))
    .digest("hex");
}

function gerarEventId(phone, valor) {
  return sha256(
    `${phone}_${valor}_${Date.now()}`
  ).slice(0, 32);
}

function extrairEtiquetas(body) {
  let etiquetas = [];

  const arrays = [
    body.labels,
    body.eventDetails?.labels
  ];

  arrays.forEach(arr => {
    if (Array.isArray(arr)) {
      arr.forEach(item => {
        if (typeof item === "string") {
          etiquetas.push(item.trim());
        }

        if (item?.name) {
          etiquetas.push(
            String(item.name).trim()
          );
        }
      });
    }
  });

  return [...new Set(etiquetas)];
}

function extrairValor(etiquetas) {
  for (const e of etiquetas) {
    const match = String(e)
      .toUpperCase()
      .match(/^VALOR[_-](\d+(?:[.,]\d+)?)$/);

    if (match) {
      return parseFloat(
        match[1].replace(",", ".")
      );
    }
  }

  return null;
}

function extrairCtwaClid(body) {

  const caminhos = [

    body.ctwa_clid,

    body.referral?.ctwa_clid,

    body.context?.referral?.ctwa_clid,

    body.metadata?.ctwa_clid,

    body.lastMessage?.ctwa_clid,

    body.message?.ctwa_clid,

    body.messages?.[0]?.referral?.ctwa_clid,

    body.entry?.[0]?.changes?.[0]?.value
      ?.messages?.[0]?.referral?.ctwa_clid

  ];

  for (const item of caminhos) {
    if (
      item &&
      typeof item === "string" &&
      item.length > 10
    ) {
      return item;
    }
  }

  return null;
}

function extrairTelefone(body) {

  const candidatos = [

    body.number,
    body.phone,
    body.numero,

    body.contact?.phone,

    body.contact?.number,

    body.from,

    body.messages?.[0]?.from,

    body.entry?.[0]?.changes?.[0]
      ?.value?.messages?.[0]?.from

  ];

  for (const item of candidatos) {
    const normalizado =
      normalizarTelefone(item);

    if (normalizado) {
      return normalizado;
    }
  }

  return null;
}

function extrairNome(body) {
  return (
    body.name ||
    body.nome ||
    body.contact?.name ||
    body.profile?.name ||
    "Cliente"
  );
}

async function enviarParaMeta({
  phone,
  nome,
  valor,
  anuncio,
  ctwaClid,
  eventId
}) {

  const url =
    `https://graph.facebook.com/v19.0/${CONFIG.META_PIXEL_ID}/events?access_token=${CONFIG.META_ACCESS_TOKEN}`;

  const user_data = {

    ph: [sha256(phone)],

    external_id: [
      sha256(phone)
    ]

  };

  if (ctwaClid) {
    user_data.ctwa_clid = ctwaClid;
  }

  const payload = {

    data: [

      {

        event_name: "Purchase",

        event_time:
          Math.floor(Date.now() / 1000),

        event_id: eventId,

        action_source:
          "business_messaging",

        user_data,

        custom_data: {

          currency: "BRL",

          value: valor,

          content_name:
            anuncio.nome,

          content_category:
            "saida_maternidade",

          content_ids: [
            anuncio.tag
          ],

          contents: [
            {
              id: anuncio.tag,
              quantity: 1,
              item_price: valor
            }
          ],

          messaging_channel:
            "whatsapp"

        }

      }

    ]

  };

  log("Payload Meta", payload);

  const response = await fetch(url, {
    method: "POST",

    headers: {
      "Content-Type":
        "application/json"
    },

    body: JSON.stringify(payload)
  });

  const json =
    await response.json();

  if (!response.ok || json.error) {
    throw new Error(
      JSON.stringify(
        json.error || json
      )
    );
  }

  return json;
}

app.post("/webhook", async (req, res) => {

  try {

    const body = req.body;

    if (CONFIG.DEBUG) {
      log("Webhook completo", body);
    }

    const db = readDB();

    const phone =
      extrairTelefone(body);

    if (!phone) {
      return res.json({
        ok: true,
        ignorado: "sem telefone"
      });
    }

    const nome =
      extrairNome(body);

    const etiquetas =
      extrairEtiquetas(body);

    const ctwaClid =
      extrairCtwaClid(body);

    if (!db.contatos[phone]) {
      db.contatos[phone] = {};
    }

    const contato =
      db.contatos[phone];

    contato.ultimo_update =
      Date.now();

    contato.nome = nome;

    if (ctwaClid) {
      contato.ctwa_clid =
        ctwaClid;

      log(
        `ctwa_clid salvo ${phone}`
      );
    }

    for (const etiqueta of etiquetas) {

      const upper =
        etiqueta.toUpperCase();

      if (
        ETIQUETAS_ANUNCIO[upper]
      ) {

        contato.anuncio = upper;

      }

      const valor =
        extrairValor([etiqueta]);

      if (valor) {
        contato.valor = valor;
      }
    }

    saveDB(db);

    const temVenda =
      etiquetas.some(
        e =>
          e.toUpperCase() ===
          CONFIG.ETIQUETA_VENDA
            .toUpperCase()
      );

    if (!temVenda) {

      return res.json({

        ok: true,

        acao: "memoria_salva",

        contato

      });

    }

    const valor =
      contato.valor ||
      CONFIG.VALOR_PADRAO;

    const anuncioTag =
      contato.anuncio ||
      "ADS_DESCONHECIDO";

    const anuncio = {

      tag: anuncioTag,

      nome:
        ETIQUETAS_ANUNCIO[
          anuncioTag
        ] ||
        "Anuncio Desconhecido"

    };

    const eventId =
      gerarEventId(
        phone,
        valor
      );

    if (
      db.eventos[eventId]
    ) {

      return res.json({

        ok: true,

        ignorado:
          "evento duplicado"

      });

    }

    const respostaMeta =
      await enviarParaMeta({

        phone,

        nome,

        valor,

        anuncio,

        ctwaClid:
          contato.ctwa_clid,

        eventId

      });

    db.eventos[eventId] = true;

    db.vendas.unshift({

      eventId,

      nome,

      phone:
        "***" +
        phone.slice(-4),

      valor,

      anuncio:
        anuncio.nome,

      ctwa_clid:
        contato.ctwa_clid
          ? "SIM"
          : "NAO",

      data:
        new Date()
          .toLocaleString(
            "pt-BR"
          )

    });

    if (
      db.vendas.length > 300
    ) {
      db.vendas.pop();
    }

    delete db.contatos[phone];

    saveDB(db);

    return res.json({

      ok: true,

      enviado_meta: true,

      resposta_meta:
        respostaMeta

    });

  } catch (err) {

    log(
      "ERRO WEBHOOK",
      err.message
    );

    return res.status(500).json({

      ok: false,

      erro: err.message

    });

  }

});

app.get("/", (req, res) => {

  res.json({

    status: "online",

    pixel:
      CONFIG.META_PIXEL_ID
        ? "ok"
        : "pendente"

  });

});

app.get("/vendas", (req, res) => {

  const db = readDB();

  res.json(db.vendas);

});

app.get("/contatos", (req, res) => {

  const db = readDB();

  res.json(db.contatos);

});

app.listen(CONFIG.PORT, () => {

  log(
    `Servidor online porta ${CONFIG.PORT}`
  );

});
