import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { apiFetch } from '../lib/api';

export interface Me {
  id: string;
  name: string;
  email: string | null;
  permissions: string[];
}

interface AuthValue {
  session: Session | null;
  me: Me | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  can: (perm: string) => boolean;
}

const AuthCtx = createContext<AuthValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (!data.session) setLoading(false);          // sem sessão: nada a carregar
    });
    // O Supabase reemite o evento de login toda vez que a aba volta ao foco.
    // Se o token NÃO mudou, mantemos a MESMA sessão (mesma referência) para o
    // efeito abaixo não rodar de novo — era isso que recarregava o painel
    // inteiro ("F5 automático") a cada troca de aba.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession((prev) => (prev?.access_token === s?.access_token ? prev : s));
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) { setMe(null); return; }
    let active = true;
    // Recarrega o "me" só quando a sessão muda de verdade (login ou refresh de
    // token). NÃO mexemos em `loading` aqui: assim o refresh silencioso de token
    // não apaga a tela com "Carregando…"; a página continua montada e o fetch
    // acontece em segundo plano. O loading inicial é resolvido uma única vez
    // (no getSession, quando não há sessão, ou neste fetch, quando há).
    apiFetch<Me>('/api/me')
      .then((data) => { if (active) setMe(data); })
      .catch(() => { if (active) setMe(null); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [session]);

  const value: AuthValue = {
    session,
    me,
    loading,
    async signIn(email, password) {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw new Error(error.message);
    },
    async signOut() {
      await supabase.auth.signOut();
      setMe(null);
    },
    can: (perm) => Boolean(me?.permissions?.includes(perm)),
  };

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth deve estar dentro de <AuthProvider>');
  return ctx;
}
