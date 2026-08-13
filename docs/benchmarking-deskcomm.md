# Benchmark — DeskcommCRM (melgarafael/DeskcommCRM)

Estudo do CRM open-source indicado pela usuária, para otimizar o nosso. Licença MIT.
**Aprendemos padrões — não copiamos código.**

## O que valida nossas escolhas ✅
- **Stack**: Supabase (Postgres + RLS + Realtime + Storage) + Next/React + IA com provedor
  trocável. É exatamente o nosso desenho.
- **RBAC de 4 papéis**, RLS, auditoria append-only, LGPD (anonimização/consentimento), schema
  idempotente, IA como "assignee" com handoff humano auditado. Tudo já contemplado aqui.

## Padrões maduros que vamos incorporar (otimizações)
| Ideia do DeskcommCRM | Como aplicamos no nosso |
|---|---|
| **Anti-ban de WhatsApp** (throttling, jitter, janelas de envio, STOP) | Utilitário de envio com limite/atraso + respeito a `do_not_contact` (§48/§49). Crítico para Campanhas (Fase 8) e automações. WaScript é gateway não-oficial → risco de ban real. |
| **Fila via `event_log` + workers** (drenados por cron) | Já temos a tabela `jobs`. Falta o **worker** = Netlify Scheduled Function que drena a fila (follow-ups, campanhas, IA). Fase 4/8. |
| **Radar de conversas paradas / follow-up adaptativo** | Nova tela **Agenda/Radar**: follow-ups vencidos, conversas sem resposta, tarefas do dia. (entregue agora) |
| **RAG com pgvector** para a base de conhecimento | Hoje injetamos a KB ativa inteira no prompt (ok p/ ateliê pequeno). Quando a KB crescer, migrar para embeddings pgvector (busca semântica). Futuro. |
| **Automação WHEN/IF/THEN** disparada por eventos + webhooks | Modelo do nosso Automation Builder (grafo de nós) já cobre; adotar gatilhos por evento interno (novo lead, pagamento, etc.). Fase 4. |
| **Alert center** (decisões que exigem humano) | Encaixa na nossa tabela `approvals` (§66) + `notifications` (§33). Expor numa tela. |
| **Cost capping por organização (IA)** | Adicionar teto de uso/custo da IA nas configurações. Futuro. |

## Diferenças de escopo (não copiar cegamente)
- DeskcommCRM é **multi-tenant** (várias empresas) e **self-hosted em VPS com Docker**. O nosso é
  **single-tenant** (só o Ateliê da Lili) e **serverless (Netlify + Supabase)** — mais simples e
  barato, sem VPS para administrar. Não vamos adicionar multi-tenancy/Docker sem necessidade.
- Eles usam WAHA/Meta Cloud API; nós usamos WaScript (já contratado). Mantemos a camada
  desacoplada — dá para trocar o driver depois sem reescrever o Inbox.

## Prioridades incorporadas ao roadmap
1. **Agenda/Radar operacional** — entregue.
2. **Worker de fila (Scheduled Function)** — habilita follow-ups/campanhas/automação real.
3. **Guarda de envio (anti-ban + opt-out)** — antes de Campanhas.
4. **pgvector na KB** — quando a base crescer.
