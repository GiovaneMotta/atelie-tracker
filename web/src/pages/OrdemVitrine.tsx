import { useCallback, useEffect, useMemo, useState, type DragEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowDown, ArrowUp, Check, ExternalLink, RefreshCw, RotateCcw } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { SITE_BASE, displaySrc, formatBRL, thumbSrc } from '../lib/format';
import { moverNoRecorte } from '../lib/ordemVitrine';

/* ================================================================
   Ordem da vitrine — a Lili define em que ordem as peças aparecem no
   site, arrastando as fotos (ou pelas setas / número da posição).

   O site ordena por UMA lista só (products.sort_order). Esta tela
   guarda essa lista inteira e mostra um pedaço dela por categoria:
   reordenar "Menino" troca as peças de Menino de lugar ENTRE SI, nas
   mesmas casas que já ocupavam — Menina, Luxo etc. não se mexem.
   Salvar manda a lista completa (ver /api/catalog-order).
   ================================================================ */

interface Peca {
  id: string; sku: string; name: string; price_cash: number | null;
  status: string; featured: boolean; sort_order: number | null;
  image: string | null; categories: string[];
}

const TODAS = 'todas';

/* Mesmos rótulos e mesma ordem da barra de categorias do site (js/categorybar.js). */
const ROTULO: Record<string, string> = {
  menina: 'Menina', menino: 'Menino', unissex: 'Unissex', gemeos: 'Gêmeos', enxoval: 'Enxoval',
  batizado: 'Batizado', mamae: 'Mamãe', fralda: 'Fraldas', cueiro: 'Cueiros', manta: 'Mantas',
  'toalha-fralda': 'Toalha Fralda', 'toalha-capuz': 'Toalha c/ Capuz', 'kit-leito': 'Kit Leito',
  acessorios: 'Acessórios', kit: 'Kits', luxo: 'Luxo', promocao: 'Promoção',
};
const ORDEM_CAT = ['menina', 'menino', 'unissex', 'gemeos', 'enxoval', 'batizado', 'mamae', 'fralda',
  'cueiro', 'manta', 'toalha-fralda', 'toalha-capuz', 'kit-leito', 'acessorios', 'kit', 'luxo', 'promocao'];
/* Subcategorias moram dentro de Acessórios; "modelo:"/"pecas:" só agrupam irmãs. Nenhuma é vitrine própria. */
const SUB = new Set(['sapato-faixa', 'sapatinho-menina', 'sapatinho-menino', 'touca']);
const ehVitrine = (c: string) => !c.startsWith('modelo:') && !c.startsWith('pecas:') && !SUB.has(c);
/* O "serviço de personalização" é produto no banco, mas o site não o mostra na vitrine. */
const ehServico = (p: Peca) => /servi[çc]o de personaliza/i.test(p.name || '');
/* "Saída Maternidade Menino Tricô – Davi Verde, 3 peças" -> "Davi Verde, 3 peças" */
const nomeCurto = (n: string) => n.replace(/^Sa[ií]da (de )?Maternidade\b.*?\s[–—-]\s+/i, '') || n;
const rotulo = (c: string) => (c === TODAS ? 'Todas' : ROTULO[c] || c.charAt(0).toUpperCase() + c.slice(1));

type Controle = 'sobe' | 'desce' | 'pos';

export default function OrdemVitrine() {
  const { can } = useAuth();
  const writable = can('products.write');
  const [params, setParams] = useSearchParams();

  const [pecas, setPecas] = useState<Peca[]>([]);
  const [salva, setSalva] = useState<string[]>([]);       // ids na ordem gravada no banco
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [savedOk, setSavedOk] = useState(false);
  const [arrastando, setArrastando] = useState<number | null>(null);
  const [sobre, setSobre] = useState<number | null>(null);
  const [destaque, setDestaque] = useState<string | null>(null);
  const [focar, setFocar] = useState<{ id: string; ctrl: Controle; longe: boolean } | null>(null);

  async function load() {
    setLoading(true); setError('');
    try {
      const data = await apiFetch<{ items: Peca[] }>('/api/catalog-order');
      setPecas(data.items); setSalva(data.items.map((p) => p.id)); setSavedOk(false);
    } catch (err) { setError(err instanceof Error ? err.message : 'Erro ao carregar a vitrine.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  /* categorias que têm vitrine no site (2+ peças, como no site) */
  const categorias = useMemo(() => {
    const cont: Record<string, number> = {};
    pecas.filter((p) => !ehServico(p)).forEach((p) =>
      p.categories.filter(ehVitrine).forEach((c) => { cont[c] = (cont[c] || 0) + 1; }));
    const conhecidas = ORDEM_CAT.filter((c) => (cont[c] || 0) >= 2);
    const outras = Object.keys(cont).filter((c) => !ORDEM_CAT.includes(c) && cont[c] >= 2).sort();
    return [...conhecidas, ...outras].map((slug) => ({ slug, n: cont[slug] }));
  }, [pecas]);
  const totalVisivel = useMemo(() => pecas.filter((p) => !ehServico(p)).length, [pecas]);

  const pedida = params.get('cat') || '';
  const cat = pedida === TODAS || categorias.some((c) => c.slug === pedida) ? pedida : (categorias[0]?.slug || TODAS);

  const noRecorte = useCallback(
    (p: Peca) => !ehServico(p) && (cat === TODAS || p.categories.includes(cat)), [cat]);
  const vitrine = useMemo(() => pecas.filter(noRecorte), [pecas, noRecorte]);
  const dirty = useMemo(() => pecas.map((p) => p.id).join('|') !== salva.join('|'), [pecas, salva]);
  /* depois do 1º salvamento toda peça tem posição; daí em diante, "sem posição" = peça nova */
  const ordenada = useMemo(() => pecas.length > 0 && pecas.filter((p) => p.sort_order != null).length >= pecas.length / 2, [pecas]);
  /* peça desta vitrine que também está em outra (ex.: Menina + Luxo) muda de lugar nas duas */
  const compartilha = useMemo(() => cat !== TODAS
    && vitrine.some((p) => p.categories.some((c) => ehVitrine(c) && c !== cat)), [vitrine, cat]);

  /* fechar/recarregar a aba com mudança não salva: o navegador pergunta antes */
  useEffect(() => {
    if (!dirty) return;
    const aviso = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', aviso);
    return () => window.removeEventListener('beforeunload', aviso);
  }, [dirty]);

  /* depois de mover, devolve o foco ao mesmo controle e leva a peça para a vista */
  useEffect(() => {
    if (!focar) return;
    const card = document.querySelector<HTMLElement>(`[data-ov="${focar.id}"]`);
    card?.scrollIntoView({ block: focar.longe ? 'center' : 'nearest', behavior: 'smooth' });
    card?.querySelector<HTMLElement>(`[data-ctrl="${focar.ctrl}"]`)?.focus({ preventScroll: true });
    setFocar(null);
  }, [focar, pecas]);
  useEffect(() => {
    if (!destaque) return;
    const t = setTimeout(() => setDestaque(null), 1400);
    return () => clearTimeout(t);
  }, [destaque]);

  function mover(de: number, para: number, ctrl?: Controle) {
    if (!writable || busy) return;
    const id = vitrine[de]?.id;
    if (!id) return;
    setPecas((atual) => moverNoRecorte(atual, noRecorte, de, para));
    setSavedOk(false);
    setDestaque(id);
    if (ctrl) setFocar({ id, ctrl, longe: Math.abs(para - de) > 3 });
  }

  function irPara(i: number, valor: string) {
    const n = parseInt(valor, 10);
    if (!Number.isFinite(n)) return;
    mover(i, Math.max(1, Math.min(vitrine.length, n)) - 1, 'pos');
  }

  function escolher(slug: string) {
    setParams({ cat: slug }, { replace: true });
    setArrastando(null); setSobre(null);
  }

  function desfazer() {
    const pos = new Map(salva.map((id, i) => [id, i]));
    setPecas((atual) => [...atual].sort((a, b) => (pos.get(a.id) ?? 0) - (pos.get(b.id) ?? 0)));
    setSavedOk(false);
    setError('');   /* o aviso era sobre as mudanças que acabaram de ser descartadas */
  }

  function recarregar() {
    if (dirty && !window.confirm('Descartar as mudanças que ainda não foram salvas?')) return;
    load();
  }

  async function salvar() {
    setBusy(true); setError('');
    const ordem = pecas.map((p) => p.id);
    try {
      await apiFetch('/api/catalog-order', { method: 'POST', body: JSON.stringify({ order: ordem }) });
      /* o banco gravou exatamente esta lista: posição = lugar + 1 */
      setPecas((atual) => atual.map((p, i) => ({ ...p, sort_order: i + 1 })));
      setSalva(ordem);
      setSavedOk(true);
    } catch (err) { setError(err instanceof Error ? err.message : 'Erro ao salvar a ordem.'); }
    finally { setBusy(false); }
  }

  /* arrastar e soltar (mouse). No celular o navegador não arrasta: setas e número cobrem. */
  function onDragStart(e: DragEvent, i: number) {
    if (!writable || busy) { e.preventDefault(); return; }
    setArrastando(i);
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', String(i)); } catch { /* Firefox exige algum dado */ }
  }
  function onDragOver(e: DragEvent, i: number) {
    if (arrastando === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (sobre !== i) setSobre(i);
  }
  function onDrop(e: DragEvent, i: number) {
    e.preventDefault();
    if (arrastando !== null && arrastando !== i) mover(arrastando, i);
    setArrastando(null); setSobre(null);
  }
  function onDragEnd() { setArrastando(null); setSobre(null); }

  const linkSite = `${SITE_BASE}/catalogo${cat !== TODAS ? `?cat=${encodeURIComponent(cat)}` : ''}`;

  return (
    <div className="page ov-page">
      <div className="page-head">
        <div>
          <div className="dash-ov">Catálogo</div>
          <h1>Ordem da vitrine</h1>
          <p className="dash-sub">Defina em que ordem as peças aparecem no site, categoria por categoria.</p>
        </div>
        <div className="page-actions">
          <button type="button" className="btn btn-ghost" onClick={recarregar} disabled={loading || busy}>
            <RefreshCw size={16} /> Recarregar
          </button>
          <a className="btn btn-ghost" href={linkSite} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={16} /> Ver no site
          </a>
        </div>
      </div>

      {error && <div className="alert-error">{error}</div>}
      {!writable && (
        <div className="ov-readonly">Você pode ver a ordem da vitrine, mas não tem permissão para alterá-la.</div>
      )}

      <div className="ov-toolbar">
        <div className="chips" role="tablist" aria-label="Categoria">
          {categorias.map((c) => (
            <button key={c.slug} type="button" role="tab" aria-selected={cat === c.slug}
              className={`chip${cat === c.slug ? ' chip-on' : ''}`} onClick={() => escolher(c.slug)}>
              {rotulo(c.slug)} <span className="ov-chip-n">{c.n}</span>
            </button>
          ))}
          {categorias.length > 0 && (
            <button type="button" role="tab" aria-selected={cat === TODAS}
              className={`chip${cat === TODAS ? ' chip-on' : ''}`} onClick={() => escolher(TODAS)}>
              Todas <span className="ov-chip-n">{totalVisivel}</span>
            </button>
          )}
        </div>
      </div>

      {writable && (
        <p className="ov-hint">
          Arraste as fotos para mudar a ordem. Para levar uma peça longe, digite a posição no campo dela
          (ex.: <b>1</b> leva para o topo). No celular, use as setas ou o número. Nada muda no site até você clicar em <b>Salvar ordem</b>.
          {compartilha && <> Peças que também estão em outra categoria (ex.: Menina e Luxo) mudam de lugar nas duas.</>}
        </p>
      )}

      {loading ? (
        <p className="muted">Carregando a vitrine…</p>
      ) : vitrine.length === 0 ? (
        <p className="muted">Nenhuma peça visível no site nesta categoria.</p>
      ) : (
        <>
          <div className="ov-count">
            {vitrine.length} {vitrine.length === 1 ? 'peça' : 'peças'} em <b>{rotulo(cat)}</b>, na ordem em que aparecem no site
          </div>
          <div className="ov-grid">
            {vitrine.map((p, i) => {
              const curto = nomeCurto(p.name);
              const nova = ordenada && p.sort_order == null;
              const cls = ['ov-card',
                sobre === i && arrastando !== null && arrastando !== i ? 'ov-over' : '',
                arrastando === i ? 'ov-dragging' : '',
                destaque === p.id ? 'ov-moved' : '',
                writable ? '' : 'ro'].filter(Boolean).join(' ');
              return (
                <div key={p.id} className={cls} data-ov={p.id}
                  onDragOver={(e) => onDragOver(e, i)} onDrop={(e) => onDrop(e, i)}>
                  <div className="ov-drag" draggable={writable && !busy}
                    onDragStart={(e) => onDragStart(e, i)} onDragEnd={onDragEnd}>
                    <div className="ov-img">
                      {p.image ? (
                        <img src={thumbSrc(p.image)} alt="" draggable={false} loading="lazy"
                          onError={(e) => { const full = displaySrc(p.image as string); if (e.currentTarget.src !== full) e.currentTarget.src = full; }} />
                      ) : <span className="ov-noimg">Sem foto</span>}
                      <span className="ov-pos" aria-hidden="true">{i + 1}</span>
                      {p.status === 'esgotado' && <span className="ov-flag pill pill-bad">Esgotado</span>}
                    </div>
                    <div className="ov-body">
                      <div className="ov-name" title={p.name}>{curto}</div>
                      <div className="ov-meta">{p.sku}{p.price_cash != null ? ` · ${formatBRL(p.price_cash)}` : ''}</div>
                      {nova && <span className="ov-new" title="Ainda sem posição: aparece no fim da vitrine até você posicioná-la e salvar.">Nova</span>}
                    </div>
                  </div>
                  {writable && (
                    <div className="ov-ctrl">
                      <button type="button" data-ctrl="sobe" onClick={() => mover(i, i - 1, 'sobe')}
                        disabled={busy || i === 0} aria-label={`Subir ${curto}`} title="Subir uma posição">
                        <ArrowUp size={15} />
                      </button>
                      <input key={`${p.id}:${i}`} data-ctrl="pos" type="number" inputMode="numeric"
                        min={1} max={vitrine.length} defaultValue={i + 1} disabled={busy}
                        aria-label={`Posição de ${curto}`} title="Digite a posição e tecle Enter"
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); irPara(i, e.currentTarget.value); } }}
                        onBlur={(e) => { if (e.currentTarget.value !== String(i + 1)) irPara(i, e.currentTarget.value); }} />
                      <button type="button" data-ctrl="desce" onClick={() => mover(i, i + 1, 'desce')}
                        disabled={busy || i === vitrine.length - 1} aria-label={`Descer ${curto}`} title="Descer uma posição">
                        <ArrowDown size={15} />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {writable && (
        <div className="savebar">
          <div className="savebar-state" aria-live="polite">
            {busy ? <><RefreshCw size={15} className="spin" /> Salvando…</>
              : savedOk ? <span className="saved-ok"><Check size={15} /> Ordem salva — já vale no site</span>
                : dirty ? <><span className="dirty-dot" /> Alterações não salvas</>
                  : <span className="muted">Tudo salvo</span>}
          </div>
          <span className="savebar-spacer" />
          <button type="button" className="btn btn-ghost" onClick={desfazer} disabled={!dirty || busy}>
            <RotateCcw size={15} /> Desfazer
          </button>
          <button type="button" className="btn btn-primary" onClick={salvar} disabled={!dirty || busy}>
            Salvar ordem
          </button>
        </div>
      )}
    </div>
  );
}
