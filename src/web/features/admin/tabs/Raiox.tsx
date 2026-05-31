import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { sipApi } from '../../../lib/api';
import { IconSearch } from '../icons';
import { cicloLabel, initials } from '../helpers';

type Classif = 'critico' | 'atencao' | 'ok';
interface RaioxItem {
  user_id: string;
  name: string;
  email: string;
  ciclo_type: 'aurum' | 'seminario' | null;
  is_platina?: boolean;
  percent: number;
  classificacao: Classif;
  submitted_at: string | null;
  categorias_fracas?: Array<{ categoria: string; percent: number }>;
}

function colors(c: Classif) {
  if (c === 'critico') return { fg: '#b91c1c', label: 'Crítico' };
  if (c === 'atencao') return { fg: '#d97706', label: 'Atenção' };
  return { fg: '#15803d', label: 'OK' };
}

export default function Raiox({ onOpenStudent }: { onOpenStudent: (id: string) => void }) {
  const [fCiclo, setFCiclo] = useState('');
  const { data } = useQuery({
    queryKey: ['admin-raiox-ranking', fCiclo],
    queryFn: () => sipApi<{ items: RaioxItem[] }>('/admin/raiox-ranking' + (fCiclo ? `?ciclo_type=${fCiclo}` : ''), { throwOnError: true }),
  });

  const [search, setSearch] = useState('');
  const [fClassif, setFClassif] = useState('');
  const [sortMode, setSortMode] = useState('percent_asc');

  const items = useMemo(() => data?.items ?? [], [data]);
  const totals = useMemo(() => {
    const t = { total: items.length, critico: 0, atencao: 0, ok: 0 };
    items.forEach((i) => { t[i.classificacao] = (t[i.classificacao] ?? 0) + 1; });
    return t;
  }, [items]);

  const filtered = useMemo(() => {
    let f = items.slice();
    const q = search.trim().toLowerCase();
    if (q) f = f.filter((i) => (i.name || '').toLowerCase().includes(q) || (i.email || '').toLowerCase().includes(q));
    if (fClassif) f = f.filter((i) => i.classificacao === fClassif);
    f.sort((a, b) => {
      if (sortMode === 'percent_asc') return a.percent - b.percent;
      if (sortMode === 'percent_desc') return b.percent - a.percent;
      const ad = a.submitted_at ? new Date(a.submitted_at).getTime() : 0;
      const bd = b.submitted_at ? new Date(b.submitted_at).getTime() : 0;
      return sortMode === 'recent' ? bd - ad : ad - bd;
    });
    return f;
  }, [items, search, fClassif, sortMode]);

  const kpi = (label: string, value: number, color: string) => (
    <div className="hb-card" style={{ padding: 14, borderLeft: color !== 'none' ? `3px solid ${color}` : undefined }}>
      <div style={{ fontSize: 11, color: 'var(--text-mute)', textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, marginTop: 4, color: color !== 'none' ? color : undefined, letterSpacing: '-0.02em' }}>{value}</div>
    </div>
  );

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)', margin: 0 }}>Raio-X</h2>
          <p style={{ fontSize: 13, color: 'var(--text-mute)', marginTop: 4, lineHeight: 1.5 }}>
            Diagnóstico inicial dos alunos. A lista está ordenada do mais crítico ao mais preparado — clique numa linha para ver as respostas completas.
          </p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10, marginBottom: 16 }}>
        {kpi('Total', totals.total, 'none')}
        {kpi('Críticos', totals.critico, '#b91c1c')}
        {kpi('Atenção', totals.atencao, '#d97706')}
        {kpi('OK', totals.ok, '#15803d')}
      </div>

      <div className="hb-card" style={{ padding: '12px 14px', marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10 }}>
          <div style={{ flex: 1, position: 'relative' }}>
            <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-mute)' }}>
              <IconSearch />
            </span>
            <input value={search} onChange={(e) => setSearch(e.target.value)} type="search" placeholder="Buscar por nome ou e-mail…" className="hb-input hb-input-sm" style={{ paddingLeft: 34, width: '100%' }} />
          </div>
          <span style={{ fontSize: 12, color: 'var(--text-mute)', fontWeight: 600, whiteSpace: 'nowrap' }}>
            {filtered.length === items.length ? `${items.length} aluno(s)` : `${filtered.length} de ${items.length}`}
          </span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
          <select value={fCiclo} onChange={(e) => setFCiclo(e.target.value)} className="hb-input hb-input-sm" style={{ width: '100%' }}>
            <option value="">Todos os ciclos</option>
            <option value="aurum">Aurum</option>
            <option value="seminario">Diamante</option>
            <option value="platina">Platina</option>
          </select>
          <select value={fClassif} onChange={(e) => setFClassif(e.target.value)} className="hb-input hb-input-sm" style={{ width: '100%' }}>
            <option value="">Todos os status</option>
            <option value="critico">Crítico</option>
            <option value="atencao">Atenção</option>
            <option value="ok">OK</option>
          </select>
          <select value={sortMode} onChange={(e) => setSortMode(e.target.value)} className="hb-input hb-input-sm" style={{ width: '100%' }}>
            <option value="percent_asc">% (pior → melhor)</option>
            <option value="percent_desc">% (melhor → pior)</option>
            <option value="recent">Mais recente</option>
            <option value="oldest">Mais antigo</option>
          </select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="hb-card" style={{ padding: '48px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>Nenhuma submissão encontrada</div>
          <div style={{ fontSize: 13, color: 'var(--text-mute)', marginTop: 4 }}>Os alunos preenchem o Raio-X durante o cadastro.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtered.map((i) => {
            const c = colors(i.classificacao);
            return (
              <div
                key={i.user_id}
                className="hb-card"
                onClick={() => onOpenStudent(i.user_id)}
                style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', borderLeft: `3px solid ${c.fg}` }}
              >
                <div style={{ width: 34, height: 34, borderRadius: '50%', background: c.fg + '18', color: c.fg, fontSize: 13, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  {initials(i.name)}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{i.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-mute)' }}>{i.email} · {cicloLabel(i.ciclo_type, i.is_platina)}</div>
                  {(i.categorias_fracas ?? []).length > 0 && (
                    <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                      {(i.categorias_fracas ?? []).slice(0, 2).map((cat, k) => (
                        <span key={k} style={{ padding: '2px 8px', borderRadius: 999, background: c.fg + '14', color: c.fg, fontSize: 11, fontWeight: 700 }}>
                          {cat.categoria} {cat.percent.toFixed(0)}%
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color: c.fg }}>{i.percent.toFixed(0)}%</div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: c.fg }}>{c.label}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
