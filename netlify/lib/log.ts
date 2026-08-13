/* ================================================================
   log — logs estruturados de integração (§40).
   Categorias: AI|WHATSAPP|FRENET|PAYMENT|WEBHOOK|AUTOMATION|ERROR.
   Não gravar tokens/dados sensíveis desnecessários (sanitizar antes).
   ================================================================ */
import { admin } from './supabaseAdmin';

export type LogCategory =
  | 'AI' | 'WHATSAPP' | 'FRENET' | 'PAYMENT' | 'WEBHOOK' | 'AUTOMATION' | 'ERROR';
export type LogLevel = 'info' | 'warn' | 'error';

export async function logIntegration(
  category: LogCategory,
  level: LogLevel,
  message: string,
  context?: Record<string, unknown>,
): Promise<void> {
  try {
    await admin().from('integration_logs').insert({ category, level, message, context: context ?? null });
  } catch {
    // logging nunca deve derrubar a requisição
  }
}
