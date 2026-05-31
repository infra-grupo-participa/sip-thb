import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { sipApi } from '../../../lib/api';
import { fmtDateFull, initials } from '../helpers';

interface Report {
  id: string;
  student_name: string;
  subject?: string;
  message: string;
  status: 'open' | 'in_progress' | 'resolved' | string;
  created_at?: string;
}

const STATUS_LABEL: Record<string, string> = {
  open: 'Aberto',
  in_progress: 'Em andamento',
  resolved: 'Resolvido',
};

export default function Reports() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState('');

  const { data } = useQuery({
    queryKey: ['admin-reports', filter],
    queryFn: () => sipApi<{ items: Report[] }>(filter ? `/admin/reports?status=${filter}` : '/admin/reports', { throwOnError: true }),
  });

  const setStatus = useMutation({
    mutationFn: (p: { id: string; status: string }) =>
      sipApi(`/admin/reports/${p.id}`, { method: 'PUT', body: JSON.stringify({ status: p.status }), throwOnError: true }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-reports'] });
      qc.invalidateQueries({ queryKey: ['admin-reports-count'] });
    },
  });

  const items = data?.items ?? [];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', margin: 0 }}>Chamados</h2>
          <p style={{ fontSize: 13, color: 'var(--text-mute)', marginTop: 2 }}>Solicitações e dúvidas enviadas pelos alunos</p>
        </div>
        <select value={filter} onChange={(e) => setFilter(e.target.value)} className="hb-input hb-input-sm">
          <option value="">Todos</option>
          <option value="open">Abertos</option>
          <option value="in_progress">Em andamento</option>
          <option value="resolved">Resolvidos</option>
        </select>
      </div>

      {items.length === 0 ? (
        <div className="hb-card" style={{ padding: 32, textAlign: 'center', color: 'var(--text-mute)', fontSize: 13 }}>Nenhum chamado neste filtro.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.map((r) => (
            <div key={r.id} className="hb-card" style={{ padding: '14px 16px', display: 'flex', gap: 12 }}>
              <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--brand-soft)', color: 'var(--brand)', fontSize: 13, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                {initials(r.student_name)}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{r.student_name}</span>
                  {r.subject && <span style={{ fontSize: 12, color: 'var(--text-sub)' }}>· {r.subject}</span>}
                  <span className="hb-chip">{STATUS_LABEL[r.status] ?? r.status}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-mute)', marginLeft: 'auto' }}>{fmtDateFull(r.created_at)}</span>
                </div>
                <p style={{ fontSize: 13, color: 'var(--text-sub)', marginTop: 6, whiteSpace: 'pre-wrap' }}>{r.message}</p>
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  {r.status !== 'in_progress' && (
                    <button onClick={() => setStatus.mutate({ id: r.id, status: 'in_progress' })} className="hb-btn hb-btn-secondary hb-btn-sm">Em andamento</button>
                  )}
                  {r.status !== 'resolved' && (
                    <button onClick={() => setStatus.mutate({ id: r.id, status: 'resolved' })} className="hb-btn hb-btn-primary hb-btn-sm">Resolver</button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
