import { useMemo, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { sipApi } from '../../../lib/api';
import { IconRefresh } from '../icons';

interface IgRow {
  user_id: string;
  name: string;
  email: string;
  ciclo_type: 'aurum' | 'seminario' | null;
  monitor_name?: string | null;
  posts_count?: number;
  reach?: number;
  flag?: string;
  flag_label?: string;
}

const FLAG_OPTS: Array<[string, string]> = [
  ['all', 'Todas'],
  ['critical', 'Críticas (red+orange+yellow)'],
  ['not_connected', 'Não conectado'],
  ['revoked', 'Token revogado'],
  ['no_posts', 'Sem postar'],
  ['low_volume', 'Volume baixo'],
  ['reach_drop', 'Alcance em queda'],
  ['below_cohort', 'Abaixo da coorte'],
  ['ok', 'OK'],
];

export default function Instagram() {
  const [win, setWin] = useState('7d');
  const [fCiclo, setFCiclo] = useState('all');
  const [fFlag, setFFlag] = useState('all');
  const [search, setSearch] = useState('');

  const { data, refetch, isFetching } = useQuery({
    queryKey: ['admin-ig-cohort', win],
    queryFn: () => sipApi<{ items: IgRow[]; banner?: string }>(`/admin/ig/cohort?window=${encodeURIComponent(win)}`, { throwOnError: true }),
  });

  const collectAll = useMutation({
    mutationFn: () => sipApi('/admin/ig/collect-all', { method: 'POST', throwOnError: true }),
    onSuccess: () => refetch(),
  });

  const items = useMemo(() => data?.items ?? [], [data]);
  const filtered = useMemo(() => {
    let f = items.slice();
    if (fCiclo !== 'all') f = f.filter((i) => i.ciclo_type === fCiclo);
    if (fFlag !== 'all') {
      if (fFlag === 'critical') f = f.filter((i) => ['red', 'orange', 'yellow'].includes(i.flag ?? ''));
      else f = f.filter((i) => i.flag === fFlag);
    }
    const q = search.trim().toLowerCase();
    if (q) f = f.filter((i) => (i.name || '').toLowerCase().includes(q) || (i.email || '').toLowerCase().includes(q));
    return f;
  }, [items, fCiclo, fFlag, search]);

  return (
    <div className="space-y-4">
      <div className="hb-card rounded-xl" style={{ overflow: 'hidden' }}>
        <div className="px-5 py-4 border-b" style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h2 className="font-semibold">Instagram dos alunos</h2>
            <p className="text-xs mt-0.5">Identifique quem está postando vs quem precisa de atenção ao longo do ciclo.</p>
          </div>
          <button onClick={() => collectAll.mutate()} disabled={collectAll.isPending} className="pg-export-btn" type="button">
            <IconRefresh /> <span>{collectAll.isPending ? 'Coletando…' : 'Atualizar agora'}</span>
          </button>
        </div>

        {data?.banner && (
          <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', background: 'var(--bg-muted)', fontSize: 13, color: 'var(--text-sub)' }}>
            {data.banner}
          </div>
        )}

        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <label className="hb-label" style={{ margin: 0 }}>Janela</label>
          <select value={win} onChange={(e) => setWin(e.target.value)} className="hb-input hb-input-sm">
            <option value="7d">Últimos 7 dias</option>
            <option value="30d">Últimos 30 dias</option>
            <option value="since_palestra">Desde a palestra</option>
          </select>
          <label className="hb-label" style={{ margin: 0 }}>Ciclo</label>
          <select value={fCiclo} onChange={(e) => setFCiclo(e.target.value)} className="hb-input hb-input-sm">
            <option value="all">Todos</option>
            <option value="aurum">Aurum</option>
            <option value="seminario">Seminário</option>
          </select>
          <label className="hb-label" style={{ margin: 0 }}>Flag</label>
          <select value={fFlag} onChange={(e) => setFFlag(e.target.value)} className="hb-input hb-input-sm">
            {FLAG_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <input value={search} onChange={(e) => setSearch(e.target.value)} type="search" placeholder="Buscar nome ou e-mail…" className="hb-input hb-input-sm" style={{ marginLeft: 'auto', minWidth: 220 }} />
        </div>

        <div style={{ padding: '10px 20px', fontSize: 12, color: 'var(--text-mute)', borderBottom: '1px solid var(--border-soft)' }}>
          {isFetching ? 'Carregando…' : `${filtered.length} aluno(s)`}
        </div>

        <div style={{ padding: '4px 20px 18px' }}>
          {filtered.length === 0 ? (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-mute)', fontSize: 13 }}>Nenhum aluno encontrado.</div>
          ) : (
            <table className="hb-table" style={{ width: '100%' }}>
              <thead>
                <tr style={{ textAlign: 'left', fontSize: 11, color: 'var(--text-mute)', textTransform: 'uppercase' }}>
                  <th style={{ padding: '8px 6px' }}>Aluno</th>
                  <th style={{ padding: '8px 6px' }}>Monitor</th>
                  <th style={{ padding: '8px 6px' }}>Posts</th>
                  <th style={{ padding: '8px 6px' }}>Alcance</th>
                  <th style={{ padding: '8px 6px' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((i) => (
                  <tr key={i.user_id} style={{ borderTop: '1px solid var(--border-soft)' }}>
                    <td style={{ padding: '8px 6px' }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{i.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-mute)' }}>{i.email}</div>
                    </td>
                    <td style={{ padding: '8px 6px', fontSize: 12, color: 'var(--text-sub)' }}>{i.monitor_name ?? '—'}</td>
                    <td style={{ padding: '8px 6px', fontSize: 13 }}>{i.posts_count ?? 0}</td>
                    <td style={{ padding: '8px 6px', fontSize: 13 }}>{i.reach ?? '—'}</td>
                    <td style={{ padding: '8px 6px' }}><span className="hb-chip">{i.flag_label ?? i.flag ?? '—'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
