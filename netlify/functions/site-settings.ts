/* ================================================================
   /api/site-settings — configurações do site público (CMS · Fase D).
     GET   -> config atual (informações gerais + pagamento/frete)
     PATCH -> salva em app_settings.key='site_config'
   O site lê isso via RPC public_config() (chave anon) e faz
   Object.assign em CONFIG — então salvar aqui reflete no site.
   Permissões: settings.read (ler) / settings.write (salvar).
   ================================================================ */
import type { Handler } from '@netlify/functions';
import { withHttp, json, parseBody, badRequest } from '../lib/http';
import { requirePermission } from '../lib/auth';
import { admin } from '../lib/supabaseAdmin';
import { writeAudit } from '../lib/audit';

const KEY = 'site_config';
const digits = (s: unknown) => String(s ?? '').replace(/\D/g, '');

const DEFAULTS = {
  atelieName: 'Ateliê da Lili',
  whatsappNumber: '',
  instagram: '',
  whatsappMessage: '',
  siteUrl: '',
  payment: { pixDiscountPct: 5, installmentsMax: 6, freeShippingFrom: '' },
};

async function loadConfig(): Promise<Record<string, any>> {
  const { data } = await admin().from('app_settings').select('value').eq('key', KEY).maybeSingle();
  const cur = (data?.value as any) || {};
  return { ...DEFAULTS, ...cur, payment: { ...DEFAULTS.payment, ...(cur.payment || {}) } };
}

/** Aceita só os campos conhecidos (whitelist). Mantém o resto do value intacto. */
function sanitize(body: any, current: Record<string, any>): Record<string, any> {
  const next: Record<string, any> = { ...current };
  if (typeof body.atelieName === 'string') next.atelieName = body.atelieName.trim();
  if (typeof body.whatsappNumber === 'string') next.whatsappNumber = digits(body.whatsappNumber);
  if (typeof body.instagram === 'string') next.instagram = body.instagram.trim();
  if (typeof body.whatsappMessage === 'string') next.whatsappMessage = body.whatsappMessage;
  if (typeof body.siteUrl === 'string') next.siteUrl = body.siteUrl.trim();
  if (body.payment && typeof body.payment === 'object') {
    next.payment = {
      ...(current.payment || {}),
      pixDiscountPct: Math.max(0, Number(body.payment.pixDiscountPct) || 0),
      installmentsMax: Math.max(0, Math.trunc(Number(body.payment.installmentsMax) || 0)),
      freeShippingFrom: String(body.payment.freeShippingFrom ?? '').trim(),
    };
  }
  return next;
}

export const handler: Handler = withHttp(async (event) => {
  if (event.httpMethod === 'GET') {
    await requirePermission(event, 'settings.read');
    return json(event, 200, { settings: await loadConfig() });
  }

  if (event.httpMethod === 'PATCH') {
    const ctx = await requirePermission(event, 'settings.write');
    const body = parseBody<any>(event);
    const current = await loadConfig();
    const next = sanitize(body, current);
    const { error } = await admin().from('app_settings')
      .upsert({ key: KEY, value: next as any, updated_by: ctx.userId, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (error) throw badRequest(error.message);
    await writeAudit({ actorId: ctx.userId, action: 'update', entity: 'settings', entityId: KEY, reason: 'Configuração do site', oldValue: current, newValue: next });
    return json(event, 200, { settings: next });
  }

  throw badRequest('Método não suportado.');
});
