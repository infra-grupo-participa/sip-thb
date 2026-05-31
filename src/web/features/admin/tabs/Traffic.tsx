import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { sipApi } from '../../../lib/api';
import { IconRefresh } from '../icons';
import { cicloLabel, fmtBRL, fmtNum } from '../helpers';

interface TrafficStudent {
  user_id: string;
  name: string;
  ciclo_type: 'aurum' | 'seminario' | null;
  is_platina?: boolean;
  spent: number;
  leads: number;
  cpl: number | null;
  vendas?: number;
  faturamento?: number;
  roi?: number | null;
  ctr?: number | null;
}
interface TrafficData {
  totals?: { spent?: number; leads?: number; cpl?: number; ctr?: number; cpm?: number };
  students?: TrafficStudent[];
}

export default function Traffic() {
  const [fCiclo, setFCiclo] = useState('');
  const [sort, setSort] = useState('spent');

  const { data, refetch } = useQuery({
    queryKey: ['admin-traffic'],
    queryFn: () => sipApi<TrafficData>('/admin/traffic', { throwOnError: true }),
  });

  const totals = data?.totals ?? {};
  const students = useMemo(() => data?.students ?? [], [data]);

  const ranking = useMemo(() => {
    let f = students.slice();
    if (fCiclo) f = f.filter((s) => (fCiclo === 'platina' ? s.is_platina : s.ciclo_type === fCiclo && !s.is_platina));
    f.sort((a, b) => {
      const key = sort as keyof TrafficStudent;
      const av = (a[key] as number) ?? 0;
      const bv = (b[key] as number) ?? 0;
      if (sort === 'cpl') return av - bv;
      return bv - av;
    });
    return f;
  }, [students, fCiclo, sort]);

  const kpi = (label: string, value: string) => (
    <div className="tx-kpi">
      <div className="tx-kpi-head"><span className="tx-kpi-label">{label}</span></div>
      <div className="tx-kpi-value-row"><span className="tx-kpi-value">{value}</span></div>
      <span className="tx-kpi-sub">vs período anterior</span>
    </div>
  );

  return (
    <div>
      <div className="tx-header">
        <div className="tx-header-l">
          <div>
            <h1>Tráfego Pago</h1>
            <p className="tx-header-sub">Desempenho de mídia dos alunos — benchmarks: CPL &lt; R$10 · CTR &gt; 1% · CPM &lt; R$25</p>
          </div>
        </div>
        <div className="tx-toolbar">
          <button onClick={() => refetch()} className="pg-export-btn" type="button"><IconRefresh /> Atualizar</button>
        </div>
      </div>

      <div className="tx-kpi-row">
        {kpi('Investimento total', fmtBRL(totals.spent))}
        {kpi('Leads gerados', fmtNum(totals.leads))}
        {kpi('CPL ponderado', fmtBRL(totals.cpl))}
        {kpi('CTR ponderado', totals.ctr != null ? totals.ctr.toFixed(2) + '%' : '—')}
        {kpi('CPM ponderado', fmtBRL(totals.cpm))}
      </div>

      <div className="tx-rank-card">
        <div className="tx-rank-head">
          <span className="tx-rank-title">Ranking de alunos por investimento</span>
          <div className="tx-rank-actions">
            <select value={fCiclo} onChange={(e) => setFCiclo(e.target.value)} className="tx-rank-chip">
              <option value="">Todos os ciclos</option>
              <option value="aurum">Aurum</option>
              <option value="seminario">Diamante</option>
              <option value="platina">Platina</option>
            </select>
            <select value={sort} onChange={(e) => setSort(e.target.value)} className="tx-rank-chip is-active">
              <option value="spent">Maior investimento</option>
              <option value="leads">Mais leads</option>
              <option value="vendas">Mais vendas</option>
              <option value="faturamento">Maior faturamento</option>
              <option value="roi">Melhor ROI</option>
              <option value="cpl">Menor CPL</option>
              <option value="ctr">Maior CTR</option>
            </select>
            <span className="tx-rank-count">{ranking.length}</span>
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="tx-rank-table">
            <thead>
              <tr>
                <th>#</th><th>Aluno</th><th>Ciclo</th><th className="num">Investido</th><th className="num">Leads</th>
                <th className="num">CPL</th><th className="num">Vendas</th><th className="num">Faturamento</th><th className="num">ROI</th>
              </tr>
            </thead>
            <tbody>
              {ranking.length === 0 ? (
                <tr><td colSpan={9} style={{ padding: 32, textAlign: 'center', color: 'var(--text-mute)', fontSize: 13 }}>Sem dados de tráfego.</td></tr>
              ) : (
                ranking.map((s, i) => (
                  <tr key={s.user_id}>
                    <td>{i + 1}</td>
                    <td>{s.name}</td>
                    <td>{cicloLabel(s.ciclo_type, s.is_platina)}</td>
                    <td className="num">{fmtBRL(s.spent)}</td>
                    <td className="num">{fmtNum(s.leads)}</td>
                    <td className="num">{fmtBRL(s.cpl)}</td>
                    <td className="num">{s.vendas ?? '—'}</td>
                    <td className="num">{fmtBRL(s.faturamento)}</td>
                    <td className="num">{s.roi != null ? s.roi.toFixed(1) + 'x' : '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
