import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { sipApi, SipApiError } from '../../lib/api';
import { useReports } from './hooks';
import type { Report } from './types';

const TK_STATUS: Record<string, { label: string; bg: string; color: string }> = {
  aberto: { label: 'Aberto', bg: 'rgba(245,158,11,0.15)', color: '#f59e0b' },
  em_atendimento: { label: 'Em atendimento', bg: 'rgba(59,130,246,0.15)', color: '#60a5fa' },
  finalizado: { label: 'Finalizado', bg: 'rgba(74,222,128,0.15)', color: '#4ade80' },
};
const TK_KIND: Record<string, { label: string; icon: string; color: string }> = {
  sistema: { label: 'Problema no sistema', icon: '🐛', color: '#dc2626' },
  tutorial: { label: 'Tutorial Desatualizado', icon: '📖', color: '#f59e0b' },
  duvida: { label: 'Dúvidas sobre o sistema', icon: '❓', color: '#22d3ee' },
  tarefa: { label: 'Problema na tarefa', icon: '🎯', color: '#3b82f6' },
  outro: { label: 'Outro', icon: '💬', color: '#94a3b8' },
};

const FILTERS: { key: string; label: string }[] = [
  { key: 'all', label: 'Todos' },
  { key: 'aberto', label: 'Abertos' },
  { key: 'em_atendimento', label: 'Em atendimento' },
  { key: 'finalizado', label: 'Finalizados' },
];

function fmtDateTime(s: string) {
  try {
    return new Date(s).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return s;
  }
}

function ReportModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState('sistema');
  const [message, setMessage] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const submit = useMutation({
    mutationFn: () => sipApi('/me/reports', { method: 'POST', body: JSON.stringify({ kind, message }), throwOnError: true }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['me-reports'] });
      onClose();
    },
    onError: (e) => setErr(e instanceof SipApiError ? e.message : 'Erro ao enviar chamado.'),
  });
  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (message.trim().length < 5) return setErr('Descreva o problema com pelo menos 5 caracteres.');
    submit.mutate();
  }
  return (
    <div className="modal-backdrop">
      <div className="modal-shell" style={{ maxWidth: 480 }}>
        <div className="modal-head">
          <div className="modal-head-main">
            <div className="modal-head-title-row">
              <h2>Abrir chamado</h2>
            </div>
            <p className="modal-head-info">Descreva o problema ou dúvida. Seu monitor e o admin serão notificados.</p>
          </div>
          <button type="button" onClick={onClose} className="modal-close">
            ×
          </button>
        </div>
        <form onSubmit={onSubmit}>
          <div className="modal-pane space-y-4" style={{ paddingTop: 20 }}>
            <div>
              <label className="form-label">Categoria</label>
              <select className="form-select" value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="sistema">Problema no sistema</option>
                <option value="tutorial">Tutorial Desatualizado</option>
                <option value="duvida">Dúvidas sobre o sistema</option>
                <option value="outro">Outro</option>
              </select>
            </div>
            <div>
              <label className="form-label">
                Descrição <span style={{ color: 'var(--red)' }}>*</span>
              </label>
              <textarea className="form-textarea" rows={4} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Explique o que está acontecendo com o máximo de detalhes..." />
            </div>
            {err && <p className="text-xs text-red-400">{err}</p>}
          </div>
          <div className="modal-foot">
            <button type="button" onClick={onClose} className="btn-ghost">
              Cancelar
            </button>
            <button type="submit" className="btn-primary" disabled={submit.isPending}>
              {submit.isPending ? 'Enviando...' : 'Enviar chamado'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function TicketDetail({ report }: { report: Report }) {
  const qc = useQueryClient();
  const markRead = useMutation({
    mutationFn: () => sipApi(`/me/reports/${report.id}/read`, { method: 'PUT', throwOnError: true }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me-reports'] }),
  });
  const kind = TK_KIND[report.kind] || TK_KIND.outro;
  const st = TK_STATUS[report.status] || TK_STATUS.aberto;
  return (
    <div className="hb-card rounded-xl p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: st.bg, color: st.color }}>
          {st.label}
        </span>
        <span style={{ color: kind.color, fontSize: 12 }}>
          {kind.icon} {kind.label}
        </span>
      </div>
      {report.task_title && (
        <p className="text-xs mb-1" style={{ color: 'var(--text-mute)' }}>
          Tarefa: <strong style={{ color: 'var(--text-sub)' }}>{report.task_title}</strong>
        </p>
      )}
      <p className="text-sm" style={{ whiteSpace: 'pre-wrap' }}>
        {report.message}
      </p>
      <p className="text-xs mt-2" style={{ color: 'var(--text-mute)' }}>
        {fmtDateTime(report.created_at)}
      </p>
      {report.admin_response && (
        <div className="mt-3 pt-3 border-t">
          <p className="text-xs font-bold" style={{ color: 'var(--brand)' }}>Resposta da equipe</p>
          <p className="text-sm mt-1" style={{ whiteSpace: 'pre-wrap' }}>
            {report.admin_response}
          </p>
          {report.responded_at && <p className="text-xs mt-1" style={{ color: 'var(--text-mute)' }}>{fmtDateTime(report.responded_at)}</p>}
          {!report.read_at && (
            <button onClick={() => markRead.mutate()} disabled={markRead.isPending} className="text-xs mt-2 underline" style={{ color: 'var(--brand)' }}>
              {markRead.isPending ? 'Marcando…' : 'Marcar como lido'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function Chamados() {
  const reports = useReports();
  const [filter, setFilter] = useState('all');
  const [modal, setModal] = useState(false);

  const all = reports.data ?? [];
  const filtered = filter === 'all' ? all : all.filter((r) => r.status === filter);

  return (
    <div>
      <div style={{ padding: '0 0 12px' }}>
        <div className="flex items-center justify-between flex-wrap gap-3" style={{ marginBottom: 10 }}>
          <div>
            <h2 className="font-semibold" style={{ fontSize: 17 }}>
              Suporte
            </h2>
            <p className="text-xs" style={{ color: 'var(--text-mute)', marginTop: 2 }}>
              Abra chamados para dúvidas, problemas técnicos ou solicitações
            </p>
          </div>
          <button onClick={() => setModal(true)} className="bg-amber-500 text-xs font-bold px-4 py-2 rounded-lg flex items-center gap-2">
            + Novo chamado
          </button>
        </div>
        <div className="flex gap-2 flex-wrap">
          {FILTERS.map((f) => (
            <button key={f.key} onClick={() => setFilter(f.key)} className={`chip chip-sm ${filter === f.key ? 'is-active' : ''}`}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        {reports.isLoading && <div className="tc-placeholder">Carregando…</div>}
        {!reports.isLoading && filtered.length === 0 && (
          <div className="tc-placeholder" style={{ textAlign: 'center', color: 'var(--text-mute)', padding: 28 }}>
            {filter === 'all' ? 'Nenhum chamado ainda.' : 'Nenhum chamado neste filtro.'}
          </div>
        )}
        {filtered.map((r) => (
          <TicketDetail key={r.id} report={r} />
        ))}
      </div>

      {modal && <ReportModal onClose={() => setModal(false)} />}
    </div>
  );
}
