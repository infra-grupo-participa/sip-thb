import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { sipApi } from '../../../lib/api';
import { fmtDateFull } from '../helpers';

// Contrato legado: GET /admin/clickup/handoffs devolve rows cruas de task_proofs.
// O status do handoff é DERIVADO de sent_to_clickup + clickup_target_key (não há
// coluna `status` de handoff; `status` aqui é a review status da prova).
interface Handoff {
  id: string;
  user_id?: string;
  users?: { name?: string; email?: string } | null;
  task_title?: string;
  ciclo_type?: string;
  submitted_at?: string;
  sent_to_clickup?: boolean;
  clickup_target_key?: string | null;
  clickup_error?: string | null;
  link?: string | null;
}
interface HandoffResp {
  items: Handoff[];
  summary?: { sent?: number; failed?: number; skipped?: number; total?: number };
}

type HandoffStatus = 'sent' | 'failed' | 'skipped';
function handoffStatus(h: Handoff): HandoffStatus {
  if (h.sent_to_clickup === true) return 'sent';
  if (!h.clickup_target_key) return 'skipped';
  return 'failed';
}
const STATUS_LABEL: Record<HandoffStatus, string> = { sent: 'Enviado', failed: 'Falhou', skipped: 'Sem ClickUp' };

export default function Clickup() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('failed');
  const [taskline, setTaskline] = useState('');

  const qs = new URLSearchParams();
  if (status) qs.set('status', status);
  if (taskline) qs.set('taskline', taskline);

  const { data, refetch } = useQuery({
    queryKey: ['admin-clickup', status, taskline],
    queryFn: () => sipApi<HandoffResp>('/admin/clickup/handoffs?' + qs.toString(), { throwOnError: true }),
  });

  const retryAll = useMutation({
    mutationFn: () => sipApi('/admin/clickup/handoffs/retry-failed', { method: 'POST', throwOnError: true }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-clickup'] }),
  });
  const retryOne = useMutation({
    mutationFn: (id: string) => sipApi(`/admin/clickup/handoffs/${id}/retry`, { method: 'POST', throwOnError: true }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-clickup'] }),
  });

  const items = data?.items ?? [];
  const summary = data?.summary ?? {};
  const failedCount = summary.failed ?? items.filter((i) => handoffStatus(i) === 'failed').length;

  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <h2 style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em', margin: '0 0 4px' }}>ClickUp · Saúde da integração</h2>
        <p style={{ fontSize: 13, color: 'var(--text-mute)', margin: 0 }}>Handoffs disparados pelos alunos para a equipe via ClickUp.</p>
      </div>

      {failedCount > 0 && (
        <div className="hb-card" style={{ padding: '12px 16px', marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, borderLeft: '3px solid #b91c1c' }}>
          <span style={{ fontSize: 13, color: 'var(--text)' }}>{failedCount} handoff(s) falharam e precisam de ação.</span>
          <button onClick={() => retryAll.mutate()} disabled={retryAll.isPending} className="hb-btn hb-btn-primary hb-btn-sm">
            {retryAll.isPending ? 'Reenviando…' : 'Reenviar falhados'}
          </button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 10, marginBottom: 16 }}>
        {[
          ['Enviados', summary.sent ?? 0, '#16a34a'],
          ['Falhados', failedCount, '#b91c1c'],
          ['Sem destino', summary.skipped ?? 0, 'var(--text-mute)'],
          ['Total', summary.total ?? items.length, 'var(--text)'],
        ].map(([l, v, c]) => (
          <div key={l as string} className="hb-card" style={{ padding: 14 }}>
            <div style={{ fontSize: 11, color: 'var(--text-mute)', textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 700 }}>{l}</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: c as string, marginTop: 4 }}>{v}</div>
          </div>
        ))}
      </div>

      <div className="hb-card" style={{ padding: '12px 14px', marginBottom: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 10, alignItems: 'center' }}>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="hb-input hb-input-sm">
            <option value="failed">Apenas falhados (precisam ação)</option>
            <option value="all">Todos</option>
            <option value="sent">Enviados com sucesso</option>
            <option value="skipped">Sem destino ClickUp (só link)</option>
          </select>
          <select value={taskline} onChange={(e) => setTaskline(e.target.value)} className="hb-input hb-input-sm">
            <option value="">Todos os ciclos</option>
            <option value="aurum">Aurum (novo+sênior)</option>
            <option value="seminario">Seminário (novo+sênior)</option>
          </select>
          <button onClick={() => refetch()} className="hb-btn hb-btn-secondary hb-btn-sm">Atualizar</button>
        </div>
      </div>

      <div>
        {items.length === 0 ? (
          <div className="hb-card" style={{ padding: 32, textAlign: 'center', color: 'var(--text-mute)', fontSize: 13 }}>Nenhum handoff neste filtro.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {items.map((h) => {
              const st = handoffStatus(h);
              const who = h.users?.name ?? h.user_id ?? '—';
              return (
              <div key={h.id} className="hb-card" style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{who} · {h.task_title ?? '—'}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-mute)' }}>
                    {h.ciclo_type ?? '—'} · {fmtDateFull(h.submitted_at)}
                    {h.clickup_error ? ` · ${h.clickup_error.slice(0, 120)}` : ''}
                  </div>
                </div>
                <span className="hb-chip" style={{ color: st === 'failed' ? '#b91c1c' : st === 'sent' ? '#16a34a' : 'var(--text-mute)' }}>{STATUS_LABEL[st]}</span>
                {h.link && <a href={h.link} target="_blank" rel="noopener noreferrer" className="hb-btn hb-btn-secondary hb-btn-sm">Abrir</a>}
                {st === 'failed' && (
                  <button onClick={() => retryOne.mutate(h.id)} disabled={retryOne.isPending} className="hb-btn hb-btn-primary hb-btn-sm">Reenviar</button>
                )}
              </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
