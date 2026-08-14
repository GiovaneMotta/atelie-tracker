# Benchmark — SOA (usesoa.com.br) · Sistema de Organização de Ateliês

Referência indicada pela usuária: SaaS por assinatura feito **para ateliês** (o caso dela).
Foco 100% na **operação/back-office** — exatamente o rumo que definimos (o WhatsApp fica no
TResCRM; aqui fazemos o que ele não faz). **Estudar padrões, não copiar.**

## Módulos do SOA e o encaixe no nosso sistema

| Módulo SOA | O que faz | No nosso sistema |
|---|---|---|
| **Produção (setores)** ⭐ | Fluxo por **setores customizáveis** (nome/cor/ícone). Cada operador vê só o seu setor. Fluxo **Iniciar → Concluir → Devolver** (com motivo). **Auto-avança** de setor e dispara **expedição automática** no último. Campos por pedido (foto, cor, tema, nome). Auditoria (quem/quando). Ações em lote. | 🔨 **A CONSTRUIR** — hoje temos Pedidos, mas não a **linha de produção**. É o MAIOR diferencial. Ex. saída maternidade: Tricô → Bordado → Acabamento → Embalagem → Expedição. |
| **Precificação** ⭐ | Banco de **custos de materiais**, produto montado por componentes, **lucro exato** por canal (Shopee/ML/Elo7, taxas por marketplace). | 🔨 **A CONSTRUIR** — temos preço no produto, falta **custo/materiais + margem/lucro**. |
| **Financeiro (caixa)** | Entradas/saídas, **caixa diário**, metas mensais, gráficos de 6 meses (faturamento × lucro). | 🔨 **A CONSTRUIR** — não temos módulo financeiro. |
| **Calendário de Envios** ⭐ | Pedidos organizados por **data de envio** (mês/semana/dia) — "nunca mais atrasar entrega". | 🔨 **A CONSTRUIR** — liga com Expedição; alto valor. |
| **Orçamentos** | Orçamento com layout profissional + **link de aprovação** p/ cliente → **vira pedido num clique**. | 🔨 **A CONSTRUIR** — temos Pedidos, falta o fluxo Orçamento→aprovação→pedido. |
| **Visão Geral / Dashboard** | Métricas em tempo real, produção, financeiro, gráficos 6 meses. | 🟡 **Temos** Dashboard (expedição); ampliar com produção+financeiro. |
| **IA Consultiva** | Chat que **analisa os números** do negócio e sugere ações (Gemini). | 🟡 Temos AIService; virar "insights do negócio" depois. |
| **Clientes** | Base + histórico. | ✅ **Temos.** |
| **Fornecedores** | Cadastro de fornecedores + histórico de compras. | 🔨 A construir (simples). |
| **Catálogo Web** | Vitrine própria. | ✅ Temos (catálogo público + produtos). |
| **Tarefas** | Organização de tarefas da equipe. | ✅ **Temos.** |
| **Permissões** | Admin / Delegador / Operador (operador vê só produção). | 🟡 Temos Admin/Atendente/Expedição/Financeiro; adicionar papel **Operador (setor)**. |
| **NF-e, Import IA, Relatórios** | Planos superiores. | Futuro. |

## Fluxo end-to-end do SOA (os "passos")
1. **Setup (~10 min):** assina → escolhe o segmento (laços/costura/…) → sistema sugere **setores
   padrão** → customiza → adiciona 1º pedido → operacional.
2. **Produção diária:** pedido entra na fila por setor/canal/prioridade → operador atualiza
   (Iniciar/Concluir/Devolver) → auto-avança → último setor → **expedição automática** → auditoria.
3. **Precificação:** custo dos materiais → monta produto → escolhe canal → sistema calcula custo,
   taxas e **lucro** por canal.
4. **Financeiro:** lança entradas/saídas → caixa em tempo real → metas → tendência 6 meses.

## Dores que ele resolve (valem pra nós)
- "Trabalha o mês todo e não sabe quanto lucrou." · Preço por achismo (prejuízo escondido). ·
  Produção "na cabeça" = pedido esquecido/atrasado. · Vender muito ≠ lucrar.

## Roadmap operacional proposto (modelando o SOA), em ordem de valor
1. 🏭 **Produção por setores** (transforma Pedido em linha de produção; auto-expedição no fim).
2. 🗓️ **Calendário de Envios** (não atrasar entrega; liga com Expedição/Frenet).
3. 💰 **Precificação** (custo de materiais + margem/lucro por peça).
4. 📊 **Financeiro** (caixa, metas, gráficos).
5. 🧾 **Orçamentos** (link de aprovação → vira pedido).
6. 🚚 **Fornecedores** + papel **Operador**.

> Já temos a base (Clientes, Produtos, Pedidos, Expedição/Frenet, Tarefas, RBAC, auditoria,
> Dashboard). O SOA mostra que o **coração de um ateliê é a Produção por setores + Precificação +
> Calendário de Envios**. É por aí que crescemos.
