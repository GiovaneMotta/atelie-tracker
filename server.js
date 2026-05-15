const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");

const app = express();

app.use(express.json({ limit: "10mb" }));

app.use(function(req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }

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

  return JSON.parse(
    fs.readFileSync(DB_PATH, "utf8")
  );

}

function saveDB(data) {

  fs.writeFileSync(
    DB_PATH,
    JSON.stringify(data, null, 2)
  );

}

initDB();

function log(msg, data) {

  var ts = new Date().toLocaleString(
    "pt-BR",
    { timeZone: "America/Sao_Paulo" }
  );

  if (data) {
    console.log(
      "[" + ts + "] " + msg,
      JSON.stringify(data, null, 2)
    );
  } else {
    console.log(
      "[" + ts + "] " + msg
    );
  }

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
    phone + "_" +
    valor + "_" +
    Date.now()
  ).slice(0, 32);

}

function extrairEtiquetas(body) {

  var etiquetas = [];

  var arrays = [
    body.labels,
    body.eventDetails &&
    body.eventDetails.labels
  ];

  arrays.forEach(function(arr) {

    if (Array.isArray(arr)) {

      arr.forEach(function(item) {

        if (typeof item === "string") {
          etiquetas.push(
            item.trim()
          );
        }

        if (
          item &&
          item.name
        ) {
          etiquetas.push(
            String(item.name).trim()
          );
        }

      });

    }

  });

  return [
    ...new Set(etiquetas)
  ];

}

function extrairValor(etiquetas) {

  for (
    var i = 0;
    i < etiquetas.length;
    i++
  ) {

    var match = String(
      etiquetas[i]
    )
    .toUpperCase()
    .match(
      /^VALOR[_-](\d+(?:[.,]\d+)?)$/
    );

    if (match) {

      return parseFloat(
        match[1]
          .replace(",", ".")
      );

    }

  }

  return null;

}

function extrairCtwaClid(body) {

  var caminhos = [

    body.ctwa_clid,

    body.referral &&
    body.referral.ctwa_clid,

    body.context &&
    body.context.referral &&
    body.context.referral.ctwa_clid,

    body.metadata &&
    body.metadata.ctwa_clid,

    body.lastMessage &&
    body.lastMessage.ctwa_clid,

    body.message &&
    body.message.ctwa_clid,

    body.messages &&
    body.messages[0] &&
    body.messages[0].referral &&
    body.messages[0].referral.ctwa_clid,

    body.entry &&
    body.entry[0] &&
    body.entry[0].changes &&
    body.entry[0].changes[0] &&
    body.entry[0].changes[0].value &&
    body.entry[0].changes[0].value.messages &&
    body.entry[0].changes[0].value.messages[0] &&
    body.entry[0].changes[0].value.messages[0].referral &&
    body.entry[0].changes[0].value.messages[0].referral.ctwa_clid

  ];

  for (
    var i = 0;
    i < caminhos.length;
    i++
  ) {

    var item = caminhos[i];

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

  var candidatos = [

    body.number,
    body.phone,
    body.numero,

    body.contact &&
    body.contact.phone,

    body.contact &&
    body.contact.number,

    body.from,

    body.messages &&
    body.messages[0] &&
    body.messages[0].from,

    body.entry &&
    body.entry[0] &&
    body.entry[0].changes &&
    body.entry[0].changes[0] &&
    body.entry[0].changes[0].value &&
    body.entry[0].changes[0].value.messages &&
    body.entry[0].changes[0].value.messages[0] &&
    body.entry[0].changes[0].value.messages[0].from

  ];

  for (
    var i = 0;
    i < candidatos.length;
    i++
  ) {

    var normalizado =
      normalizarTelefone(
        candidatos[i]
      );

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

    (
      body.contact &&
      body.contact.name
    ) ||

    (
      body.profile &&
      body.profile.name
    ) ||

    "Cliente"
  );

}

async function enviarParaMeta(data) {

  var phone = data.phone;
  var valor = data.valor;
  var anuncio = data.anuncio;
  var ctwaClid = data.ctwaClid;
  var eventId = data.eventId;

  var url =
    "https://graph.facebook.com/v19.0/" +
    CONFIG.META_PIXEL_ID +
    "/events?access_token=" +
    CONFIG.META_ACCESS_TOKEN;

  var user_data = {

    ph: [
      sha256(phone)
    ],

    external_id: [
      sha256(phone)
    ]

  };

  if (ctwaClid) {

    user_data.ctwa_clid =
      ctwaClid;

  }

  var payload = {

    data: [

      {

        event_name:
          "Purchase",

        event_time:
          Math.floor(
            Date.now() / 1000
          ),

        event_id:
          eventId,

        action_source:
          "business_messaging",

        user_data:
          user_data,

        custom_data: {

          currency:
            "BRL",

          value:
            valor,

          content_name:
            anuncio.nome,

          content_category:
            "saida_maternidade",

          content_ids: [
            anuncio.tag
          ],

          contents: [

            {
              id:
                anuncio.tag,

              quantity:
                1,

              item_price:
                valor
            }

          ],

          messaging_channel:
            "whatsapp"

        }

      }

    ]

  };

  log(
    "Payload enviado Meta",
    payload
  );

  var response =
    await fetch(url, {

      method: "POST",

      headers: {
        "Content-Type":
          "application/json"
      },

      body:
        JSON.stringify(payload)

    });

  var json =
    await response.json();

  if (
    !response.ok ||
    json.error
  ) {

    throw new Error(
      JSON.stringify(
        json.error || json
      )
    );

  }

  return json;

}

app.post(
  "/webhook",
  async function(req, res) {

    try {

      var body = req.body;

      if (CONFIG.DEBUG) {

        log(
          "Webhook recebido",
          body
        );

      }

      var db = readDB();

      var phone =
        extrairTelefone(body);

      if (!phone) {

        return res.json({

          ok: true,

          ignorado:
            "sem telefone"

        });

      }

      var nome =
        extrairNome(body);

      var etiquetas =
        extrairEtiquetas(body);

      var ctwaClid =
        extrairCtwaClid(body);

      if (
        !db.contatos[phone]
      ) {

        db.contatos[phone] = {};

      }

      var contato =
        db.contatos[phone];

      contato.nome = nome;

      contato.ultimo_update =
        Date.now();

      if (ctwaClid) {

        contato.ctwa_clid =
          ctwaClid;

        log(
          "ctwa_clid salvo para " +
          phone
        );

      }

      for (
        var i = 0;
        i < etiquetas.length;
        i++
      ) {

        var etiqueta =
          etiquetas[i];

        var upper =
          etiqueta.toUpperCase();

        if (
          ETIQUETAS_ANUNCIO[
            upper
          ]
        ) {

          contato.anuncio =
            upper;

        }

        var valorExtraido =
          extrairValor([
            etiqueta
          ]);

        if (valorExtraido) {

          contato.valor =
            valorExtraido;

        }

      }

      saveDB(db);

      var temVenda =
        etiquetas.some(
          function(e) {

            return (
              e.toUpperCase() ===
              CONFIG.ETIQUETA_VENDA
                .toUpperCase()
            );

          }
        );

      if (!temVenda) {

        return res.json({

          ok: true,

          acao:
            "memoria_salva",

          contato:
            contato

        });

      }

      var valor =

        contato.valor ||

        CONFIG.VALOR_PADRAO;

      var anuncioTag =

        contato.anuncio ||

        "ADS_DESCONHECIDO";

      var anuncio = {

        tag:
          anuncioTag,

        nome:
          ETIQUETAS_ANUNCIO[
            anuncioTag
          ] ||
          "Anuncio desconhecido"

      };

      var eventId =
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
            "duplicado"

        });

      }

      var respostaMeta =
        await enviarParaMeta({

          phone:
            phone,

          valor:
            valor,

          anuncio:
            anuncio,

          ctwaClid:
            contato.ctwa_clid,

          eventId:
            eventId

        });

      db.eventos[eventId] =
        true;

      db.vendas.unshift({

        eventId:
          eventId,

        cliente:
          nome,

        phone:
          "***" +
          phone.slice(-4),

        valor:
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

        enviado_meta:
          true,

        resposta_meta:
          respostaMeta

      });

    } catch(err) {

      log(
        "ERRO WEBHOOK",
        err.message
      );

      return res.status(500)
      .json({

        ok: false,

        erro:
          err.message

      });

    }

  }
);

app.get(
  "/",
  function(req, res) {

    res.json({

      status:
        "online",

      pixel:
        CONFIG.META_PIXEL_ID
          ? "configurado"
          : "pendente"

    });

  }
);

app.get(
  "/vendas",
  function(req, res) {

    var db = readDB();

    res.json(
      db.vendas
    );

  }
);

app.get(
  "/contatos",
  function(req, res) {

    var db = readDB();

    res.json(
      db.contatos
    );

  }
);

app.listen(
  CONFIG.PORT,
  function() {

    log(
      "Servidor iniciado porta " +
      CONFIG.PORT
    );

  }
);
