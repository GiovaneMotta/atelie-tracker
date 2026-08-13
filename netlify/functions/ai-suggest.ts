/* ================================================================
   /api/ai-suggest — gera uma resposta SUGERIDA para uma conversa (§6, §60).
     POST /api/ai-suggest  body { conversation_id }
   Modo rascunho: devolve o texto para o humano revisar e enviar (§58 —
   nada é enviado automaticamente aqui). A IA é fundamentada na Base de
   Conhecimento + catálogo; instruída a NUNCA inventar preço/prazo/estoque/
   frete/desconto/política. Precisa de ANTHROPIC_API_KEY (backend).
   Permissão: conversations.write.
   ================================================================ */
import type { Handler } from '@netlify/functions';
import { withHttp, json, parseBody, badRequest, notFound } from '../lib/http';
import { requirePermission } from '../lib/auth';
import { admin } from '../lib/supabaseAdmin';
import { getAIProvider } from '../lib/services/AIService';
import { logIntegration } from '../lib/log';

export const handler: Handler = withHttp(async (event) => {
  await requirePermission(event, 'conversations.write');
  const sb = admin();
  const { conversation_id } = parseBody<{ conversation_id?: string }>(event);
  if (!conversation_id) throw badRequest('conversation_id é obrigatório.');

  const { data: conv } = await sb.from('conversations')
    .select('*, customer:customers(name)').eq('id', conversation_id).maybeSingle();
  if (!conv) throw notFound('Conversa não encontrada.');

  // Contexto mínimo necessário (§60): últimas mensagens, cliente, KB, produtos.
  const [{ data: msgs }, { data: kb }, { data: products }, { data: settings }] = await Promise.all([
    sb.from('messages').select('direction, body, sender').eq('conversation_id', conversation_id).order('created_at', { ascending: true }).limit(20),
    sb.from('knowledge_base').select('category, title, content').eq('is_active', true).limit(80),
    sb.from('products').select('name, price_cash, status, product_categories(category)').eq('status', 'ativo').limit(60),
    sb.from('ai_settings').select('*').eq('id', true).maybeSingle(),
  ]);

  const transcript = (msgs ?? [])
    .map((m) => `${m.direction === 'in' ? 'Cliente' : 'Atendente'}: ${m.body ?? ''}`)
    .join('\n') || '(sem mensagens ainda)';

  const kbText = (kb ?? []).map((k) => `- [${k.category}] ${k.title}: ${k.content}`).join('\n') || '(base de conhecimento vazia)';
  const prodText = (products ?? [])
    .map((p) => `- ${p.name}${p.price_cash != null ? ` — R$ ${Number(p.price_cash).toFixed(2)}` : ''}${(p.product_categories || []).length ? ` (${(p.product_categories as any[]).map((c) => c.category).join(', ')})` : ''}`)
    .join('\n') || '(catálogo vazio)';

  const agent = settings?.agent_name || 'Lili';
  const formality = settings?.formality || 'cordial';
  const persona = settings?.persona || 'Atendente simpática e acolhedora de um ateliê de saídas maternidade.';

  const system = [
    `Você é ${agent}, atendente virtual do Ateliê da Lili (saídas maternidade artesanais).`,
    `Personalidade/tom: ${persona} Nível de formalidade: ${formality}.`,
    `Responda em português do Brasil, de forma calorosa, curta e objetiva, como no WhatsApp.`,
    '',
    'REGRAS INVIOLÁVEIS:',
    '- NUNCA invente preço, prazo, estoque, frete, desconto, condição de pagamento ou política.',
    '- Use SOMENTE as informações da BASE DE CONHECIMENTO e do CATÁLOGO abaixo.',
    '- Se a informação não estiver disponível, diga que vai confirmar com a equipe — não chute.',
    '- Não prometa descontos nem gere etiqueta/cobrança; isso depende de aprovação humana.',
    '',
    '=== BASE DE CONHECIMENTO ===',
    kbText,
    '',
    '=== CATÁLOGO (produtos ativos) ===',
    prodText,
    '',
    conv.customer?.name ? `Cliente: ${conv.customer.name}.` : 'Cliente ainda não identificado.',
  ].join('\n');

  const userPrompt = `Histórico da conversa (mais antigo no topo):\n${transcript}\n\nEscreva APENAS a próxima mensagem da atendente (sem rótulos, sem aspas).`;

  try {
    const provider = getAIProvider();
    const result = await provider.chat({ system, messages: [{ role: 'user', content: userPrompt }], maxTokens: 500 });
    await logIntegration('AI', 'info', 'Sugestão de resposta gerada', { conversation_id });
    return json(event, 200, { suggestion: result.text.trim() });
  } catch (e) {
    await logIntegration('AI', 'error', 'Falha ao gerar sugestão', { detail: String(e) });
    throw badRequest(e instanceof Error ? e.message : 'Falha na IA.');
  }
});
