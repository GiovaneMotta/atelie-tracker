/* ================================================================
   /api/frenet-settings — configurações da integração (§5).
     GET   -> config NÃO-secreta + STATUS dos tokens (nunca os tokens)
     PATCH -> salva config não-secreta (CEP origem, ambiente, base URLs,
              formato, caixa, remetente). Tokens NUNCA passam por aqui.
   Permissões: settings.read (ler) / settings.write (salvar).
   ================================================================ */
import type { Handler } from '@netlify/functions';
import { withHttp, json, parseBody, badRequest } from '../lib/http';
import { requirePermission } from '../lib/auth';
import { admin } from '../lib/supabaseAdmin';
import { writeAudit } from '../lib/audit';
import { loadStoredSettings, loadFrenetConfig, publicConfigView, type FrenetStoredSettings } from '../lib/frenet';

const digits = (s: unknown) => String(s ?? '').replace(/\D/g, '');

/** Aceita só campos NÃO-secretos. Ignora qualquer coisa parecida com token. */
function sanitizeSettings(body: any, current: FrenetStoredSettings): FrenetStoredSettings {
  const next: FrenetStoredSettings = { ...current };
  if (body.environment === 'producao' || body.environment === 'homologacao') next.environment = body.environment;
  if (typeof body.cep_origem === 'string') next.cep_origem = digits(body.cep_origem);
  if (typeof body.label_format === 'string') next.label_format = body.label_format.toUpperCase() === 'A5' ? 'A5' : 'A4';
  if (typeof body.use_frenet_registration === 'boolean') next.use_frenet_registration = body.use_frenet_registration;

  if (body.box && typeof body.box === 'object') {
    next.box = {
      weight_kg: Number(body.box.weight_kg) || current.box?.weight_kg || 0.5,
      length_cm: Number(body.box.length_cm) || current.box?.length_cm || 30,
      width_cm: Number(body.box.width_cm) || current.box?.width_cm || 25,
      height_cm: Number(body.box.height_cm) || current.box?.height_cm || 10,
    };
  }
  if (body.sender && typeof body.sender === 'object') {
    const s = body.sender;
    next.sender = {
      name: String(s.name ?? current.sender?.name ?? ''),
      document: digits(s.document ?? current.sender?.document ?? ''),
      phone: digits(s.phone ?? current.sender?.phone ?? ''),
      email: String(s.email ?? current.sender?.email ?? ''),
      cep: digits(s.cep ?? current.sender?.cep ?? ''),
      street: String(s.street ?? current.sender?.street ?? ''),
      number: String(s.number ?? current.sender?.number ?? ''),
      complement: String(s.complement ?? current.sender?.complement ?? ''),
      district: String(s.district ?? current.sender?.district ?? ''),
      city: String(s.city ?? current.sender?.city ?? ''),
      state: String(s.state ?? current.sender?.state ?? '').toUpperCase().slice(0, 2),
    };
  }
  if (body.base_urls && typeof body.base_urls === 'object') {
    next.base_urls = {
      whitelabel_prod: String(body.base_urls.whitelabel_prod ?? current.base_urls?.whitelabel_prod ?? ''),
      whitelabel_hml: String(body.base_urls.whitelabel_hml ?? current.base_urls?.whitelabel_hml ?? ''),
      quote: String(body.base_urls.quote ?? current.base_urls?.quote ?? ''),
    };
  }
  return next;
}

export const handler: Handler = withHttp(async (event) => {
  if (event.httpMethod === 'GET') {
    await requirePermission(event, 'settings.read');
    const config = await loadFrenetConfig();
    const view = publicConfigView(config);
    return json(event, 200, {
      settings: view,
      webhook_secret_configured: Boolean(config.webhook.tokenValue),
    });
  }

  if (event.httpMethod === 'PATCH') {
    const ctx = await requirePermission(event, 'settings.write');
    const body = parseBody<any>(event);
    const current = await loadStoredSettings();
    const next = sanitizeSettings(body, current);

    const { error } = await admin().from('app_settings')
      .upsert({ key: 'frenet', value: next as any, updated_by: ctx.userId, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (error) throw badRequest(error.message);

    await writeAudit({
      actorId: ctx.userId, action: 'update', entity: 'settings', entityId: 'frenet',
      reason: 'Configuração Frenet', oldValue: current, newValue: next,
    });

    const config = await loadFrenetConfig(next);
    return json(event, 200, { settings: publicConfigView(config), webhook_secret_configured: Boolean(config.webhook.tokenValue) });
  }

  throw badRequest('Método não suportado.');
});
