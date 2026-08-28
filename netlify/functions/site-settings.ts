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
  metaPixelId: '',
  ga4Id: '',
  gtmId: '',
  payment: { pixDiscountPct: 5, installmentsMax: 6, freeShippingFrom: '' },
  // Hero + Sobre (conteúdo editável do site). Semente = conteúdo atual.
  content: {
    heroEyebrow: '✦ Saídas Maternidade Premium',
    heroTitle: 'As primeiras\nmemórias merecem\n*ser inesquecíveis*',
    heroSubtitle: 'Saídas maternidade artesanais, em tecidos nobres e acabamento à mão — feitas com amor para o momento mais especial da sua vida.',
    heroImage: 'images/acessorios/banner-1781096829384.webp',
    sobreEyebrow: 'Nossa história',
    sobreTitle: 'Feito com amor\n*e carinho*',
    sobreBody1: '',
    sobreBody2: '',
  },
  banners: [] as any[],        // vazio = site usa o hero acima (fallback do próprio site)
  testimonials: [] as any[],   // vazio = site usa os depoimentos embutidos (fallback)
  // SEO editável (global + por página). Semente = valores atuais do HTML.
  seo: {
    metaTitle: 'Ateliê da Lili — Saídas Maternidade Premium Personalizadas',
    metaDescription: 'Saídas maternidade premium do Ateliê da Lili: tricô artesanal, bordado à mão e personalização com o nome do bebê. Frete para todo o Brasil, Pix com desconto e até 6x sem juros.',
    keywords: 'saída maternidade, saída maternidade menina, saída maternidade personalizada, enxoval bebê, tricô bebê, Ateliê da Lili',
    ogImage: 'images/og-cover.jpg',
    catalogoTitle: 'Catálogo Completo — Ateliê da Lili',
    catalogoDescription: 'Todas as saídas maternidade do Ateliê da Lili: tricô artesanal, bordado à mão e personalização com o nome do bebê. Filtre e escolha a sua.',
  },
};
const CONTENT_KEYS = ['heroEyebrow', 'heroTitle', 'heroSubtitle', 'heroImage', 'sobreEyebrow', 'sobreTitle', 'sobreBody1', 'sobreBody2'] as const;
const SEO_KEYS = ['metaTitle', 'metaDescription', 'keywords', 'ogImage', 'catalogoTitle', 'catalogoDescription'] as const;

async function loadConfig(): Promise<Record<string, any>> {
  const { data } = await admin().from('app_settings').select('value').eq('key', KEY).maybeSingle();
  const cur = (data?.value as any) || {};
  return {
    ...DEFAULTS, ...cur,
    payment: { ...DEFAULTS.payment, ...(cur.payment || {}) },
    content: { ...DEFAULTS.content, ...(cur.content || {}) },
    banners: Array.isArray(cur.banners) ? cur.banners : DEFAULTS.banners,
    testimonials: Array.isArray(cur.testimonials) ? cur.testimonials : DEFAULTS.testimonials,
    seo: { ...DEFAULTS.seo, ...(cur.seo || {}) },
  };
}

/** Aceita só os campos conhecidos (whitelist). Mantém o resto do value intacto. */
function sanitize(body: any, current: Record<string, any>): Record<string, any> {
  const next: Record<string, any> = { ...current };
  if (typeof body.atelieName === 'string') next.atelieName = body.atelieName.trim();
  if (typeof body.whatsappNumber === 'string') next.whatsappNumber = digits(body.whatsappNumber);
  if (typeof body.instagram === 'string') next.instagram = body.instagram.trim();
  if (typeof body.whatsappMessage === 'string') next.whatsappMessage = body.whatsappMessage;
  if (typeof body.siteUrl === 'string') next.siteUrl = body.siteUrl.trim();
  if (typeof body.metaPixelId === 'string') next.metaPixelId = body.metaPixelId.trim();
  if (typeof body.ga4Id === 'string') next.ga4Id = body.ga4Id.trim();
  if (typeof body.gtmId === 'string') next.gtmId = body.gtmId.trim();
  if (body.payment && typeof body.payment === 'object') {
    next.payment = {
      ...(current.payment || {}),
      pixDiscountPct: Math.max(0, Number(body.payment.pixDiscountPct) || 0),
      installmentsMax: Math.max(0, Math.trunc(Number(body.payment.installmentsMax) || 0)),
      freeShippingFrom: String(body.payment.freeShippingFrom ?? '').trim(),
    };
  }
  if (body.content && typeof body.content === 'object') {
    next.content = { ...(current.content || {}) };
    for (const k of CONTENT_KEYS) if (typeof body.content[k] === 'string') next.content[k] = body.content[k];
  }
  if (body.seo && typeof body.seo === 'object') {
    next.seo = { ...(current.seo || {}) };
    for (const k of SEO_KEYS) if (typeof body.seo[k] === 'string') next.seo[k] = body.seo[k].trim().slice(0, 400);
  }
  if (Array.isArray(body.banners)) {
    next.banners = body.banners.slice(0, 12).map((b: any) => ({
      eyebrow: String(b.eyebrow ?? '').slice(0, 120),
      title: String(b.title ?? '').slice(0, 240),
      subtitle: String(b.subtitle ?? '').slice(0, 400),
      image: String(b.image ?? '').slice(0, 600),
      buttonText: String(b.buttonText ?? '').slice(0, 60),
      buttonLink: String(b.buttonLink ?? '').slice(0, 400),
    })).filter((b) => b.title || b.image || b.subtitle);
  }
  if (Array.isArray(body.testimonials)) {
    next.testimonials = body.testimonials.slice(0, 30).map((t: any) => ({
      name: String(t.name ?? '').slice(0, 80),
      local: String(t.local ?? '').slice(0, 80),
      text: String(t.text ?? '').slice(0, 500),
    })).filter((t) => t.name || t.text);
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
