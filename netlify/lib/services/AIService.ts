/* ================================================================
   AIService — camada desacoplada de IA, PROVEDOR TROCÁVEL (§6).
   Interface estável (chat + tool-calling) para não prender o sistema a
   um fornecedor. Implementação default: Anthropic (Claude). A lógica de
   ferramentas controladas e regras de segurança (§58/§59) entra na Fase 3.
   Chave só no backend (env).
   ================================================================ */

export interface AITool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}
export interface AIMessage { role: 'user' | 'assistant'; content: string; }
export interface AIChatInput {
  system: string;
  messages: AIMessage[];
  tools?: AITool[];
  maxTokens?: number;
}
export interface AIChatResult {
  text: string;
  toolCalls: { name: string; input: Record<string, unknown> }[];
  raw?: unknown;
}
export interface AIProvider {
  chat(input: AIChatInput): Promise<AIChatResult>;
}

/* ---- Provedor Anthropic (Claude) ---- */
class AnthropicProvider implements AIProvider {
  async chat(input: AIChatInput): Promise<AIChatResult> {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error('IA não configurada (ANTHROPIC_API_KEY).');
    const model = process.env.AI_MODEL || 'claude-sonnet-4-5';

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: input.maxTokens ?? 1024,
        system: input.system,
        tools: input.tools,
        messages: input.messages.map((m) => ({ role: m.role, content: m.content })),
      }),
    });
    const data: any = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(`Falha na IA (${resp.status}): ${data?.error?.message || 'erro'}`);

    const blocks: any[] = Array.isArray(data.content) ? data.content : [];
    const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    const toolCalls = blocks
      .filter((b) => b.type === 'tool_use')
      .map((b) => ({ name: b.name as string, input: (b.input ?? {}) as Record<string, unknown> }));
    return { text, toolCalls, raw: data };
  }
}

export function getAIProvider(): AIProvider {
  const provider = (process.env.AI_PROVIDER || 'anthropic').toLowerCase();
  switch (provider) {
    case 'anthropic': return new AnthropicProvider();
    // TODO(Fase 3+): adicionar outros provedores mantendo esta interface.
    default: throw new Error(`Provedor de IA não suportado: ${provider}`);
  }
}
