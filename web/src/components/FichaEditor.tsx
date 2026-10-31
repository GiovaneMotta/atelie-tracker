/* ================================================================
   FichaEditor — a ficha do produto sem marcação à vista.

   Antes, este campo era um textarea cru onde era preciso digitar
   "## Características" e "Rótulo: valor" de cabeça. Quem não lembrasse
   da convenção escrevia algo que o site simplesmente não exibia — e
   não havia como perceber o erro pelo painel.

   O formato de armazenamento continua exatamente o mesmo (é o que
   ficha.js lê no site, e o que os 45 produtos já cadastrados usam).
   O que muda é que ele virou detalhe interno: aqui se preenche campo,
   lista e tabela, e a marcação é montada na gravação.

   O botão "ver texto" existe porque round-trip de formato nunca é
   perfeito: se alguma ficha antiga tiver algo que o editor não
   representa, dá para ver e corrigir o original em vez de perdê-lo.
   Seções "##" desconhecidas são preservadas intactas.
   ================================================================ */
import { useEffect, useRef, useState, type CSSProperties } from 'react';

export interface Carac { k: string; v: string }
export interface Ficha {
  prosa: string;
  contem: string[];
  caracs: Carac[];
  prazo: string;
  /* seções "##" que este editor não conhece, guardadas como vieram */
  extras: string;
}

/** "Características" e "Caracteristicas" são a mesma coisa para quem digita. */
export function semAcento(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

const ROTULOS_COMUNS = ['Tecido', 'Medidas', 'Composição', 'Personalização', 'Cuidados', 'Peso'];

/* Peças mais usadas nas saídas: viram botões de 1 clique em "Itens inclusos"
   (clicou, incluiu — sem digitar). Para mudar a lista, é só editar aqui. */
const PECAS_SUGERIDAS = [
  'Vestido', 'Body', 'Macacão', 'Calça', 'Manta', 'Touca', 'Touca Personalizada',
  'Sapatinho', 'Sapato e Faixa', 'Faixa', 'Luva', 'Touca e Luva', 'Babador', 'Nome na golinha',
];

export function parseFicha(texto: string): Ficha {
  const bruto = String(texto || '').replace(/\r\n?/g, '\n');
  const linhas = bruto.split('\n');
  const prosa: string[] = [];
  const secoes: { titulo: string; linhas: string[] }[] = [];
  let atual: { titulo: string; linhas: string[] } | null = null;

  for (const linha of linhas) {
    const cab = linha.match(/^\s*##\s+(.*)$/);
    if (cab) { atual = { titulo: cab[1].trim(), linhas: [] }; secoes.push(atual); }
    else if (atual) atual.linhas.push(linha);
    else prosa.push(linha);
  }

  const f: Ficha = { prosa: prosa.join('\n').trim(), contem: [], caracs: [], prazo: '', extras: '' };
  const naoLidas: string[] = [];

  for (const s of secoes) {
    const t = semAcento(s.titulo);
    if (t === 'contem') {
      f.contem = s.linhas
        .map((l) => l.replace(/^\s*[-•]\s*/, '').trim())
        .filter(Boolean);
    } else if (t === 'caracteristicas') {
      for (const l of s.linhas) {
        const par = l.match(/^\s*([^:]{1,40}):\s*(.+)$/);
        if (!par) continue;
        const k = par[1].trim(); const v = par[2].trim();
        if (semAcento(k) === 'prazo de producao') f.prazo = v;
        else f.caracs.push({ k, v });
      }
    } else {
      naoLidas.push('## ' + s.titulo, ...s.linhas);
    }
  }
  f.extras = naoLidas.join('\n').trim();
  return f;
}

export function serializeFicha(f: Ficha): string {
  const partes: string[] = [];
  if (f.prosa.trim()) partes.push(f.prosa.trim());

  const itens = f.contem.map((i) => i.trim()).filter(Boolean);
  if (itens.length) partes.push('## Contém\n' + itens.map((i) => '- ' + i).join('\n'));

  const linhas = f.caracs
    .filter((c) => c.k.trim() && c.v.trim())
    .map((c) => `${c.k.trim()}: ${c.v.trim()}`);
  if (f.prazo.trim()) linhas.push(`Prazo de produção: ${f.prazo.trim()}`);
  if (linhas.length) partes.push('## Características\n' + linhas.join('\n'));

  if (f.extras.trim()) partes.push(f.extras.trim());
  return partes.join('\n\n');
}

const linha: CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 };

export default function FichaEditor({ value, onChange, disabled }: {
  value: string; onChange: (v: string) => void; disabled?: boolean;
}) {
  const [cru, setCru] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const [f, setF] = useState<Ficha>(() => parseFicha(value));

  /* Reparse só quando `value` muda POR FORA (ex.: outro produto carregado).
     Quando a mudança nasceu aqui, serializeFicha(f) === value e nada é
     reparseado — assim uma linha recém-adicionada ainda vazia NÃO some no
     round-trip (serializeFicha descarta itens/campos vazios de propósito,
     para não gravar "- " em branco). Era isso que fazia o "+ Item" parecer
     não funcionar: o item vazio sumia antes de dar para digitar. */
  useEffect(() => {
    if (serializeFicha(f) !== value) setF(parseFicha(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const grava = (mudanca: Partial<Ficha>) => {
    const novo = { ...f, ...mudanca };
    setF(novo);
    onChange(serializeFicha(novo));
  };

  /* Sugestões que ainda não foram incluídas (compara sem acento/maiúscula). */
  const jaIncluso = new Set(f.contem.map((x) => semAcento(x)));
  const sugestoes = PECAS_SUGERIDAS.filter((p) => !jaIncluso.has(semAcento(p)));
  const addPeca = (p: string) => grava({ contem: [...f.contem, p] });

  /* Envolve o que está selecionado. Sem seleção, deixa o cursor entre as
     marcas, para a pessoa já sair digitando dentro do negrito. */
  function envolver(marca: string) {
    const el = area.current;
    if (!el) return;
    const ini = el.selectionStart ?? 0;
    const fim = el.selectionEnd ?? 0;
    const txt = f.prosa;
    const dentro = txt.slice(ini, fim) || 'texto';
    const novo = txt.slice(0, ini) + marca + dentro + marca + txt.slice(fim);
    grava({ prosa: novo });
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(ini + marca.length, ini + marca.length + dentro.length);
    });
  }

  if (cru) {
    return (
      <div>
        <div style={{ ...linha, justifyContent: 'space-between' }}>
          <span className="muted small">Texto como fica gravado.</span>
          <button type="button" className="btn-link" onClick={() => setCru(false)}>voltar ao editor</button>
        </div>
        <textarea rows={14} value={value} disabled={disabled}
          onChange={(e) => onChange(e.target.value)} style={{ fontFamily: 'monospace', fontSize: 13 }} />
      </div>
    );
  }

  return (
    <div>
      <div style={{ ...linha, justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" className="btn btn-ghost btn-sm" disabled={disabled}
            onClick={() => envolver('**')} title="Negrito"><b>N</b></button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={disabled}
            onClick={() => envolver('*')} title="Itálico"><i>I</i></button>
        </div>
        <button type="button" className="btn-link" onClick={() => setCru(true)}>ver texto</button>
      </div>

      <label className="field">
        <span>Descrição — o texto que aparece ao lado do preço</span>
        <textarea ref={area} rows={5} value={f.prosa} disabled={disabled}
          placeholder="Tricô salmão com flores 3D aplicadas no tule e gola de renda."
          onChange={(e) => grava({ prosa: e.target.value })} />
      </label>
      <p className="muted small" style={{ marginTop: -8 }}>
        Selecione um trecho e clique em <b>N</b> para deixar em negrito. Duas ou três
        linhas bastam — o resto vai nos campos abaixo.
      </p>

      <h4 style={{ margin: '18px 0 6px' }}>Itens inclusos</h4>
      <p className="muted small" style={{ marginTop: 0 }}>Vira a aba “Itens inclusos” no site.</p>
      <datalist id="pecas-sugeridas">
        {PECAS_SUGERIDAS.map((p) => <option key={p} value={p} />)}
      </datalist>
      {f.contem.map((item, i) => (
        <div style={linha} key={i}>
          <input list="pecas-sugeridas" value={item} disabled={disabled} placeholder="01 Vestido em tricô"
            onChange={(e) => grava({ contem: f.contem.map((x, j) => j === i ? e.target.value : x) })} />
          <button type="button" className="btn-link" disabled={disabled}
            onClick={() => grava({ contem: f.contem.filter((_, j) => j !== i) })}>✕</button>
        </div>
      ))}
      {sugestoes.length > 0 && (
        <>
          <p className="muted small" style={{ margin: '2px 0 6px' }}>Toque para incluir:</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
            {sugestoes.map((p) => (
              <button type="button" key={p} className="btn btn-ghost btn-sm" disabled={disabled}
                onClick={() => addPeca(p)}>+ {p}</button>
            ))}
          </div>
        </>
      )}
      <button type="button" className="btn btn-ghost btn-sm" disabled={disabled}
        onClick={() => grava({ contem: [...f.contem, ''] })}>+ Outra peça…</button>

      <h4 style={{ margin: '18px 0 6px' }}>Características</h4>
      <datalist id="rotulos-ficha">
        {ROTULOS_COMUNS.map((r) => <option key={r} value={r} />)}
      </datalist>
      {f.caracs.map((c, i) => (
        <div style={linha} key={i}>
          <input list="rotulos-ficha" value={c.k} disabled={disabled} placeholder="Tecido"
            style={{ maxWidth: 180 }}
            onChange={(e) => grava({ caracs: f.caracs.map((x, j) => j === i ? { ...x, k: e.target.value } : x) })} />
          <input value={c.v} disabled={disabled} placeholder="Tricô 100% algodão"
            onChange={(e) => grava({ caracs: f.caracs.map((x, j) => j === i ? { ...x, v: e.target.value } : x) })} />
          <button type="button" className="btn-link" disabled={disabled}
            onClick={() => grava({ caracs: f.caracs.filter((_, j) => j !== i) })}>✕</button>
        </div>
      ))}
      <button type="button" className="btn btn-ghost btn-sm" disabled={disabled}
        onClick={() => grava({ caracs: [...f.caracs, { k: '', v: '' }] })}>+ Característica</button>

      <label className="field" style={{ marginTop: 18 }}>
        <span>Prazo de produção</span>
        <input value={f.prazo} disabled={disabled} placeholder="15 dias úteis"
          onChange={(e) => grava({ prazo: e.target.value })} />
      </label>
      <p className="muted small" style={{ marginTop: -8 }}>
        Aparece como selo ao lado dos tamanhos. Peça pronta com bordado: use o prazo do bordado.
      </p>

      {f.extras && (
        <p className="muted small" style={{ marginTop: 14 }}>
          Esta ficha tem outras seções escritas à mão. Elas continuam no texto e vão
          para o site, mas não aparecem aqui — use <b>ver texto</b> para editá-las.
        </p>
      )}
    </div>
  );
}
