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
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    let active = true;
    async function loadMe() {
      if (!session) { setMe(null); setLoading(false); return; }
      setLoading(true);
      try {
        const data = await apiFetch<Me>('/api/me');
        if (active) setMe(data);
      } catch {
        if (active) setMe(null);
      } finally {
        if (active) setLoading(false);
      }
    }
    loadMe();
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
