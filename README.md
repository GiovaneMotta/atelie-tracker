# CRM Ateliê da Lili

Sistema de **CRM + atendimento WhatsApp + automação/IA + catálogo + vendas + expedição**.
Multiusuário, com banco de dados real, login por função, tempo real e integrações
(WaScript, Frenet, IA, pagamento). Construído em fases — ver [`docs/ROADMAP.md`](docs/ROADMAP.md).

> Não é protótipo. Cada fase é implantável. Nenhuma credencial no frontend; nenhuma
> operação sensível fora do backend; a IA nunca inventa preço/prazo/estoque/frete.

## Stack

- **Frontend:** React + Vite (SPA) — `web/`
- **Backend/API + integrações + webhooks:** Netlify Functions (Node/TS) — `netlify/`
- **Banco + Auth + Realtime + Storage + Cron:** Supabase (Postgres) — `supabase/`
- **Código isomórfico** (motor de fluxo, tipos, validações): `packages/shared/`

Arquitetura completa em [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Pré-requisitos (contas — criadas pela usuária)

1. **Supabase** — projeto novo (free tier). Anote `Project URL`, `anon key`, `service_role key`.
2. **Netlify** — um segundo site apontando para a pasta `atelie-crm/` (base directory).
3. **WaScript/WaSpeed** — token da API (`api-whatsapp.wascript.com.br`).
4. **Anthropic** — chave da API de IA.
5. **Frenet** — `FRENET_API_TOKEN` e `FRENET_PARTNER_TOKEN` (etiqueta/rastreio).

> O PC de desenvolvimento não tem Node/Python. Tudo é **compilado na nuvem** pelo Netlify;
> o teste acontece no deploy. As chaves ficam nas variáveis de ambiente do Netlify/Supabase.

## Setup do banco (Supabase)

As migrations em `supabase/migrations/` são a **fonte da verdade** do schema. Para aplicá-las:

- **Opção A (sem instalar nada):** abra o **SQL Editor** do Supabase e cole/execute os arquivos
  `0001_*.sql` … `0009_*.sql` **em ordem**.
- **Opção B (com Supabase CLI, quando houver Node):** `supabase db push`.

Depois de aplicar, crie o primeiro usuário admin:

```sql
-- 1) Crie o usuário no Authentication > Users (email + senha).
-- 2) Copie o UUID dele e rode (troque os valores):
insert into public.staff (id, name, email)
values ('<UUID_DO_AUTH_USER>', 'Giovane', 'giovane12motta@gmail.com');

insert into public.staff_roles (staff_id, role_id)
select '<UUID_DO_AUTH_USER>', id from public.roles where key = 'admin';
```

## Variáveis de ambiente

Copie `.env.example` para `.env` (local, ignorado pelo git) e cadastre as mesmas variáveis no
Netlify (**Site settings > Environment variables**). Só variáveis com prefixo `VITE_` chegam ao
navegador — e essas são apenas chaves públicas.

## Estrutura

```
atelie-crm/
  docs/            ARCHITECTURE.md · ROADMAP.md
  supabase/        migrations/  (schema SQL versionado)
  netlify/         functions/ (API, webhooks) · lib/ (serviços desacoplados)
  web/             app React + Vite            (Fase 1b)
  packages/shared/ tipos + motor de fluxo      (Fase 4)
```

## Expedição / Frenet (Fases 6+7)

Módulo real de **cotação → confirmação → etiqueta (OneClick) → rastreio → webhook**.
Documentação completa e passo a passo em [`docs/frenet.md`](docs/frenet.md):
como configurar homologação, testar cotação, gerar etiqueta real, registrar o webhook
e migrar para produção. Telas: **Expedição** (board), **Envios** (histórico), **Novo envio**
(assistente) e **Configurações › Frenet**.

Resumo rápido:

1. Cadastre `FRENET_API_TOKEN` (e, para etiqueta, `FRENET_PARTNER_TOKEN`) no Netlify.
2. Em **Configurações › Frenet**, defina CEP de origem, ambiente e remetente; clique **Testar conexão**.
3. **Novo envio** → dados → **Calcular frete** → escolher serviço → conferir → **gerar etiqueta**.
4. Registre o webhook `https://SEU-SITE-CRM.netlify.app/webhooks/frenet-tracking` no painel Frenet.

## Testes

Lógica da integração coberta por testes unitários (chamadas externas **mockadas**;
nunca gera etiqueta real):

```bash
npm install
npm test
```

(Rode onde houver Node — o PC de desenvolvimento não tem runtime local; o deploy é na nuvem.)

## Status

**Fases 1a–1c e 6–7 concluídas.** Fundação (banco/RLS/auth/API), clientes/produtos/pedidos e o
**módulo de expedição Frenet** (cotação, etiqueta OneClick, rastreio, webhook). Próximas fases
(Inbox/IA/automação/campanhas) em [`docs/ROADMAP.md`](docs/ROADMAP.md).
