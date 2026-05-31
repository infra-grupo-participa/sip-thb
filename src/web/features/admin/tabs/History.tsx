import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { sipApi } from '../../../lib/api';

interface Ciclo { id: string; name: string; status: string }
interface HistoryStudent { name: string; progress_percent: number; completed_tasks?: number; total_tasks?: number }
interface HistoryData { students?: HistoryStudent[]; ciclo_name?: string }

export default function History() {
  const { data: ciclos } = useQuery({
    queryKey: ['admin-ciclos'],
    queryFn: () => sipApi<Ciclo[] | { items: Ciclo[] }>('/admin/ciclos', { throwOnError: true }),
  });
  const list: Ciclo[] = Array.isArray(ciclos) ? ciclos : (ciclos?.items ?? []);
  const encerrados = list.filter((c) => c.status === 'encerrado' || c.status === 'closed');

  const [sel, setSel] = useState('');
  const { data: hist } = useQuery({
    queryKey: ['admin-ciclo-history', sel],
    queryFn: () => sipApi<HistoryData>(`/admin/ciclos/${sel}/history`, { throwOnError: true }),
    enabled: !!sel,
  });

  const students = hist?.students ?? [];

  return (
    <div className="space-y-4">
      <div className="hb-card rounded-xl" style={{ overflow: 'hidden' }}>
        <div className="px-5 py-4 border-b flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="font-semibold">Histórico de ciclos encerrados</h2>
            <p className="text-xs mt-0.5">Visão consolidada do desempenho dos alunos por ciclo</p>
          </div>
          <select value={sel} onChange={(e) => setSel(e.target.value)} className="hb-input hb-input-sm">
            <option value="">Selecione um ciclo encerrado</option>
            {encerrados.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="p-4">
          {!sel ? (
            <div className="text-sm text-center py-8">Selecione um ciclo encerrado para ver o histórico.</div>
          ) : students.length === 0 ? (
            <div className="text-sm text-center py-8" style={{ color: 'var(--text-mute)' }}>Sem dados para este ciclo.</div>
          ) : (
            <table className="pg-table" style={{ width: '100%' }}>
              <thead><tr><th>Aluno</th><th>Progresso</th><th>Tarefas</th></tr></thead>
              <tbody>
                {students.map((s, i) => (
                  <tr key={i}>
                    <td>{s.name}</td>
                    <td>{s.progress_percent}%</td>
                    <td>{s.completed_tasks ?? 0}/{s.total_tasks ?? 0}</td>
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
