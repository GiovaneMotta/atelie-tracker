/* ================================================================
   /api/agenda — radar operacional do dia (inspirado no DeskcommCRM).
   Reúne o que precisa de atenção: follow-ups vencidos, conversas
   aguardando resposta e tarefas do dia/atrasadas. Só leitura.
   Acesso: qualquer membro ativo.
   ================================================================ */
import type { Handler } from '@netlify/functions';
import { withHttp, json } from '../lib/http';
import { getAuth } from '../lib/auth';
import { admin } from '../lib/supabaseAdmin';

export const handler: Handler = withHttp(async (event) => {
  await getAuth(event);
  const sb = admin();
  const now = new Date();
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString();
  const nowISO = now.toISOString();

  const [followups, conversations, tasks] = await Promise.all([
    // Follow-ups vencidos (lead com data marcada, ainda não ganho/perdido)
    sb.from('leads')
      .select('id, title, interest, value, next_followup_at, customer:customers(name), stage:pipeline_stages(name)')
      .not('next_followup_at', 'is', null).lte('next_followup_at', endOfToday)
      .is('won_at', null).is('lost_at', null)
      .order('next_followup_at', { ascending: true }).limit(50),
    // Conversas aguardando (mensagens não lidas)
    sb.from('conversations')
      .select('id, external_id, last_message_preview, last_message_at, unread_count, ai_state, customer:customers(name)')
      .gt('unread_count', 0).order('last_message_at', { ascending: false }).limit(50),
    // Tarefas atrasadas/de hoje
    sb.from('tasks')
      .select('id, title, due_at, priority, customer:customers(name), assignee:staff(name)')
      .neq('status', 'concluida').not('due_at', 'is', null).lte('due_at', endOfToday)
      .order('due_at', { ascending: true }).limit(50),
  ]);

  return json(event, 200, {
    now: nowISO,
    followups: followups.data ?? [],
    conversations: conversations.data ?? [],
    tasks: tasks.data ?? [],
  });
});
