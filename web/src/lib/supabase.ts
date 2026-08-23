import { createClient } from '@supabase/supabase-js';

// URL do projeto + chave pública "anon" (são PÚBLICAS por design — ficam no
// bundle do navegador de qualquer forma). Usadas como padrão caso as VITE_*
// não estejam no ambiente de build (ex.: quando o wrangler.toml gerencia vars).
const FALLBACK_URL = 'https://cfwyrzvnodaqgfutbcph.supabase.co';
const FALLBACK_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNmd3lyenZub2RhcWdmdXRiY3BoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY2MzUzNDEsImV4cCI6MjEwMjIxMTM0MX0.pNkEe502VXg0c4_7F9OMpF2Z_zpLYDOcvZP4MYnb_uI';

const url = import.meta.env.VITE_SUPABASE_URL || FALLBACK_URL;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY || FALLBACK_ANON;

export const supabase = createClient(url, anon);
