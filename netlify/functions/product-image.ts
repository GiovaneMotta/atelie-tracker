/* ================================================================
   /api/product-image — upload e exclusão de imagens de produto.
   - POST: recebe a imagem (base64, já comprimida no navegador),
     exige permissão products.write, envia pro Supabase Storage
     (bucket "catalog") via service role e devolve a URL pública.
   - DELETE: remove um objeto do Storage (products.write).
   O frontend público NÃO usa isto (exige JWT + permissão). A
   referência (URL) é gravada em products.images pelo /api/products.
   ================================================================ */
import type { Handler } from '@netlify/functions';
import { withHttp, json, parseBody, badRequest } from '../lib/http';
import { requirePermission } from '../lib/auth';
import { admin } from '../lib/supabaseAdmin';

const BUCKET = 'catalog';
const MAX_BYTES = 6 * 1024 * 1024; // 6 MB já descomprimido (client manda bem menor)

function uid(): string {
  try { return (globalThis.crypto as any).randomUUID(); }
  catch { return Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }
}

function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.includes(',') ? b64.slice(b64.indexOf(',') + 1) : b64; // aceita data URL
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export const handler: Handler = withHttp(async (event) => {
  const method = event.httpMethod;

  if (method === 'POST') {
    await requirePermission(event, 'products.write');
    const body = parseBody<{ product_id?: string; dataBase64?: string; contentType?: string }>(event);
    const productId = (body.product_id || '').trim();
    const data = body.dataBase64 || '';
    if (!productId) throw badRequest('Informe o produto (product_id).');
    if (!data) throw badRequest('Imagem vazia.');

    const bytes = base64ToBytes(data);
    if (!bytes.length) throw badRequest('Imagem inválida.');
    if (bytes.length > MAX_BYTES) throw badRequest('Imagem muito grande (máx. ~6MB após compressão).');

    const contentType = (body.contentType && body.contentType.startsWith('image/')) ? body.contentType : 'image/webp';
    const ext = contentType === 'image/webp' ? 'webp'
      : contentType === 'image/jpeg' ? 'jpg'
      : (contentType.split('/')[1] || 'bin');

    // caminho previsível e sem conflito: produtos/{id}/{uuid}.{ext}
    const path = `produtos/${productId}/${uid()}.${ext}`;

    const sb = admin();
    const { error } = await sb.storage.from(BUCKET).upload(path, bytes, {
      contentType, upsert: false, cacheControl: '31536000',
    });
    if (error) throw badRequest('Falha no upload: ' + error.message);

    const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(path);
    return json(event, 200, { url: pub.publicUrl, path });
  }

  if (method === 'DELETE') {
    await requirePermission(event, 'products.write');
    const body = parseBody<{ url?: string; path?: string }>(event);
    let path = (body.path || '').trim();
    if (!path && body.url) {
      const marker = `/object/public/${BUCKET}/`;
      const i = body.url.indexOf(marker);
      if (i >= 0) path = decodeURIComponent(body.url.slice(i + marker.length));
    }
    if (!path) throw badRequest('Caminho da imagem não informado.');
    const sb = admin();
    const { error } = await sb.storage.from(BUCKET).remove([path]);
    if (error) throw badRequest('Falha ao excluir do Storage: ' + error.message);
    return json(event, 200, { ok: true });
  }

  throw badRequest('Método não suportado.');
});
