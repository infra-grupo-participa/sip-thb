import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { sipApi } from '../../../lib/api';
import { fmtDateFull, initials } from '../helpers';

interface Report {
  id: string;
  // Contrato legado: a tabela reports expõe user_name/user_email; campos antigos
  // (student_name/subject) ficam como fallback tolerante.
  user_name?: string;
  user_email?: string;
  student_name?: string;
  title?: string;
  task_title?: string;
  kind?: string;
  subject?: string;
  message?: string;
  status: 'aberto' | 'em_analise' | 'resolvido' | string;
  created_at?: string;
}

// Vocabulário de status fiel ao legado (DB sip.reports): aberto/em_analise/resolvido.
const STATUS_LABEL: Record<string, string> = {
  aberto: 'Aberto',
  em_analise: 'Em análise',
  resolvido: 'Resolvido',
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
          <option value="aberto">Abertos</option>
          <option value="em_analise">Em análise</option>
          <option value="resolvido">Resolvidos</option>
        </select>
      </div>

      {items.length === 0 ? (
        <div className="hb-card" style={{ padding: 32, textAlign: 'center', color: 'var(--text-mute)', fontSize: 13 }}>Nenhum chamado neste filtro.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.map((r) => {
            const who = r.user_name ?? r.student_name ?? '—';
            const subj = r.title ?? r.task_title ?? r.kind ?? r.subject;
            return (
            <div key={r.id} className="hb-card" style={{ padding: '14px 16px', display: 'flex', gap: 12 }}>
              <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--brand-soft)', color: 'var(--brand)', fontSize: 13, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                {initials(who)}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{who}</span>
                  {subj && <span style={{ fontSize: 12, color: 'var(--text-sub)' }}>· {subj}</span>}
                  <span className="hb-chip">{STATUS_LABEL[r.status] ?? r.status}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-mute)', marginLeft: 'auto' }}>{fmtDateFull(r.created_at)}</span>
                </div>
                {r.message && <p style={{ fontSize: 13, color: 'var(--text-sub)', marginTop: 6, whiteSpace: 'pre-wrap' }}>{r.message}</p>}
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  {r.status !== 'em_analise' && r.status !== 'resolvido' && (
                    <button onClick={() => setStatus.mutate({ id: r.id, status: 'em_analise' })} className="hb-btn hb-btn-secondary hb-btn-sm">Em análise</button>
                  )}
                  {r.status !== 'resolvido' && (
                    <button onClick={() => setStatus.mutate({ id: r.id, status: 'resolvido' })} className="hb-btn hb-btn-primary hb-btn-sm">Resolver</button>
                  )}
                  {r.status === 'resolvido' && (
                    <button onClick={() => setStatus.mutate({ id: r.id, status: 'aberto' })} className="hb-btn hb-btn-secondary hb-btn-sm">Reabrir</button>
                  )}
                </div>
              </div>
            </div>
          );
          })}
        </div>
      )}
    </div>
  );
}
