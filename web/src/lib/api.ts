import { supabase } from './supabase';

/** Chama a API interna anexando o JWT do Supabase. Lança Error com a
 *  mensagem amigável vinda do backend (§54). */
export async function apiFetch<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });

  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(body?.error || `Erro ${res.status}`);
  return body as T;
}
