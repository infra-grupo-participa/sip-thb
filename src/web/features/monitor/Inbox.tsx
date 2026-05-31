import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { sipApi } from '../../lib/api';
import { type MonitorReport, type TicketStatus } from './types';

const REPORT_KIND: Record<string, { label: string; icon: string; color: string }> = {
  sistema: { label: 'Problema no sistema', icon: '🐛', color: '#dc2626' },
  tutorial: { label: 'Tutorial Desatualizado', icon: '📖', color: '#f59e0b' },
  duvida: { label: 'Dúvidas sobre o sistema', icon: '❓', color: '#22d3ee' },
  tarefa: { label: 'Problema na tarefa', icon: '🎯', color: '#3b82f6' },
  outro: { label: 'Outro', icon: '💬', color: '#94a3b8' },
};

const STATUS: Record<string, { label: string; bg: string; color: string }> = {
  aberto: { label: 'Aberto', bg: 'rgba(245,158,11,0.15)', color: '#f59e0b' },
  em_atendimento: { label: 'Em atendimento', bg: 'rgba(59,130,246,0.15)', color: '#60a5fa' },
  finalizado: { label: 'Finalizado', bg: 'rgba(74,222,128,0.15)', color: '#4ade80' },
};

type Filter = '' | TicketStatus;

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'aberto', label: 'Abertos' },
  { key: 'em_atendimento', label: 'Atend.' },
  { key: 'finalizado', label: 'Finalizados' },
  { key: '', label: 'Todos' },
];

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function Inbox() {
  const [filter, setFilter] = useState<Filter>('aberto');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const path = filter ? `/monitor/reports?status=${filter}` : '/monitor/reports';
  const { data, isLoading } = useQuery({
    queryKey: ['monitor', 'reports', filter],
    queryFn: () => sipApi<MonitorReport[] | { items: MonitorReport[] }>(path, { throwOnError: true }),
    refetchInterval: 30_000,
  });

  const tickets: MonitorReport[] = Array.isArray(data) ? data : (data?.items ?? []);
  const selected = tickets.find((t) => t.id === selectedId) ?? null;

  return (
    <div>
      <header className="page-head">
        <h1>Chamados</h1>
        <p>Atenda às dúvidas e problemas reportados pelos seus alunos</p>
      </header>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '12px 0 16px' }}>
        {FILTERS.map((f) => (
          <button
            key={f.key || 'all'}
            className={`chip chip-sm${filter === f.key ? ' is-active' : ''}`}
            onClick={() => {
              setFilter(f.key);
              setSelectedId(null);
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="mon-inbox">
        <div className="mon-inbox-list">
          {isLoading && <div className="empty-state"><span className="hb-spinner" /></div>}
          {!isLoading && tickets.length === 0 && (
            <div className="empty-state">
              <span className="icon">📭</span>
              <p className="sub">Nenhum chamado neste filtro</p>
            </div>
          )}
          {!isLoading &&
            tickets.map((r) => {
              const kind = REPORT_KIND[r.kind ?? 'outro'] ?? REPORT_KIND.outro!;
              const st = STATUS[r.status ?? 'aberto'] ?? STATUS.aberto!;
              const preview = (r.message ?? '').slice(0, 120);
              return (
                <div
                  key={r.id}
                  className={`mon-ticket-card${selectedId === r.id ? ' is-active' : ''}`}
                  onClick={() => setSelectedId(r.id)}
                >
                  <div className="mon-ticket-head">
                    <span className="mon-ticket-name">{r.user_name || '—'}</span>
                    <span className="mon-ticket-status" style={{ background: st.bg, color: st.color }}>
                      {st.label}
                    </span>
                  </div>
                  <div className="mon-ticket-kind" style={{ color: kind.color }}>
                    {kind.icon} {kind.label}
                  </div>
                  <div className="mon-ticket-preview">{preview}</div>
                  <div className="mon-ticket-date">{fmtDateTime(r.created_at)}</div>
                </div>
              );
            })}
        </div>

        <div className="hb-card">
          {!selected ? (
            <div className="mon-inbox-detail-empty">
              <div style={{ fontSize: 32, marginBottom: 10 }}>💬</div>
              <p>Selecione um chamado para ver os detalhes</p>
            </div>
          ) : (
            <TicketDetail report={selected} />
          )}
        </div>
      </div>
    </div>
  );
}

function TicketDetail({ report }: { report: MonitorReport }) {
  const kind = REPORT_KIND[report.kind ?? 'outro'] ?? REPORT_KIND.outro!;
  const st = STATUS[report.status ?? 'aberto'] ?? STATUS.aberto!;
  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 4 }}>{report.user_name || '—'}</h2>
          <div style={{ fontSize: 13, color: kind.color }}>
            {kind.icon} {kind.label}
          </div>
        </div>
        <span className="mon-ticket-status" style={{ background: st.bg, color: st.color, fontSize: 12 }}>
          {st.label}
        </span>
      </div>
      <p style={{ fontSize: 11, color: 'var(--text-mute)', marginTop: 6 }}>
        {fmtDateTime(report.created_at)}
      </p>
      <div
        style={{
          marginTop: 16,
          padding: '14px 16px',
          background: 'var(--bg-subtle)',
          border: '1px solid var(--border-soft)',
          borderRadius: 10,
          fontSize: 14,
          color: 'var(--text)',
          whiteSpace: 'pre-wrap',
          lineHeight: 1.5,
        }}
      >
        {report.message || 'Sem mensagem.'}
      </div>
    </div>
  );
}
