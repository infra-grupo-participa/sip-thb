import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { sipApi, SipApiError } from '../../lib/api';
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

interface TicketMessage {
  id: string;
  sender_id: string | null;
  sender_name: string;
  sender_role: string;
  body: string | null;
  attachments?: { name?: string; type?: string; signed_url?: string }[];
  created_at: string;
}
interface ThreadResponse {
  report: { id: string; status?: string; kind?: string; user_name?: string; user_email?: string; created_at?: string };
  messages: TicketMessage[];
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
function timeLabel(iso: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}
function dateLabel(iso: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const n = new Date();
  const y = new Date();
  y.setDate(n.getDate() - 1);
  const same = (a: Date, b: Date) => a.getDate() === b.getDate() && a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
  if (same(d, n)) return 'Hoje';
  if (same(d, y)) return 'Ontem';
  return d.toLocaleDateString('pt-BR');
}
function initials(name: string) {
  const p = (name || '?').trim().split(/\s+/);
  let s = (p[0] && p[0][0]) || '?';
  if (p.length > 1 && p[p.length - 1]![0]) s += p[p.length - 1]![0];
  return s.toUpperCase();
}
function avatarColor(role: string) {
  if (role === 'admin') return '#FF6300';
  if (role === 'monitor') return '#3b82f6';
  return '#64748b';
}

export default function Inbox() {
  const [filter, setFilter] = useState<Filter>('aberto');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const path = filter ? `/monitor/reports?status=${filter}` : '/monitor/reports';
  const { data, isLoading } = useQuery({
    queryKey: ['monitor', 'reports', filter],
    queryFn: () => sipApi<MonitorReport[] | { items: MonitorReport[] }>(path, { throwOnError: true }),
    refetchInterval: 15_000,
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
            <TicketDetail report={selected} filter={filter} />
          )}
        </div>
      </div>
    </div>
  );
}

function TicketDetail({ report, filter }: { report: MonitorReport; filter: Filter }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const msgsRef = useRef<HTMLDivElement>(null);

  const kind = REPORT_KIND[report.kind ?? 'outro'] ?? REPORT_KIND.outro!;

  const { data, isLoading } = useQuery({
    queryKey: ['monitor-report-messages', report.id],
    queryFn: () => sipApi<ThreadResponse>(`/monitor/reports/${report.id}/messages`, { throwOnError: true }),
    refetchInterval: 15_000,
  });

  const messages = data?.messages ?? [];
  const status = (data?.report.status as string | undefined) ?? report.status ?? 'aberto';
  const st = STATUS[status] ?? STATUS.aberto!;
  const done = status === 'finalizado';

  useEffect(() => {
    const el = msgsRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['monitor-report-messages', report.id] });
    qc.invalidateQueries({ queryKey: ['monitor', 'reports', filter] });
  }

  const send = useMutation({
    mutationFn: (body: string) =>
      sipApi(`/monitor/reports/${report.id}/messages`, { method: 'POST', body: JSON.stringify({ body }), throwOnError: true }),
    onSuccess: () => {
      setDraft('');
      setErr(null);
      invalidate();
    },
    onError: (e) => setErr(e instanceof SipApiError ? e.message : 'Erro ao enviar mensagem.'),
  });

  const finalize = useMutation({
    mutationFn: () => sipApi(`/monitor/reports/${report.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'finalizado' }), throwOnError: true }),
    onSuccess: invalidate,
    onError: (e) => setErr(e instanceof SipApiError ? e.message : 'Erro ao finalizar.'),
  });

  function onSend() {
    const body = draft.trim();
    if (!body) return;
    send.mutate(body);
  }

  let lastDate: string | null = null;
  let lastKey: string | null = null;

  return (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 4 }}>{report.user_name || '—'}</h2>
          <div style={{ fontSize: 13, color: kind.color }}>
            {kind.icon} {kind.label}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="mon-ticket-status" style={{ background: st.bg, color: st.color, fontSize: 12 }}>
            {st.label}
          </span>
          {!done && (
            <button onClick={() => finalize.mutate()} disabled={finalize.isPending} className="tc-btn tc-btn-green">
              {finalize.isPending ? 'Finalizando…' : 'Finalizar'}
            </button>
          )}
        </div>
      </div>
      <p style={{ fontSize: 11, color: 'var(--text-mute)', marginTop: 6 }}>{fmtDateTime(report.created_at)}</p>

      <div ref={msgsRef} style={{ marginTop: 14, maxHeight: 380, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {isLoading && <div className="tc-placeholder">Carregando…</div>}
        {!isLoading && messages.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--text-mute)', fontSize: 13, padding: 20 }}>Sem mensagens ainda.</div>
        )}
        {messages.map((m) => {
          if (m.sender_role === 'system') {
            lastKey = null;
            return (
              <div key={m.id} style={{ display: 'flex', justifyContent: 'center' }}>
                <span style={{ fontSize: 11, color: 'var(--text-mute)', fontStyle: 'italic', background: 'var(--bg-elevated)', border: '1px solid var(--border-soft)', padding: '3px 12px', borderRadius: 20 }}>{m.body}</span>
              </div>
            );
          }
          const right = m.sender_role === 'monitor' || m.sender_role === 'admin';
          const dl = dateLabel(m.created_at);
          const sep = dl && dl !== lastDate;
          if (sep) lastDate = dl;
          const key = m.sender_role + '|' + m.sender_name;
          const grouped = key === lastKey;
          lastKey = key;
          return (
            <div key={m.id}>
              {sep && (
                <div style={{ display: 'flex', justifyContent: 'center', margin: '6px 0' }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-mute)', background: 'var(--bg-elevated)', border: '1px solid var(--border-soft)', padding: '3px 12px', borderRadius: 20 }}>{dl}</span>
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexDirection: right ? 'row-reverse' : 'row' }}>
                {!right && (
                  <div style={{ width: 30, height: 30, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#fff', background: grouped ? 'transparent' : avatarColor(m.sender_role), visibility: grouped ? 'hidden' : 'visible' }}>
                    {initials(m.sender_name)}
                  </div>
                )}
                <div style={{ maxWidth: '78%', display: 'flex', flexDirection: 'column', alignItems: right ? 'flex-end' : 'flex-start', minWidth: 0 }}>
                  {!right && !grouped && <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-mute)', margin: '0 0 3px 2px' }}>{m.sender_name}</div>}
                  <div
                    style={{
                      border: '1px solid',
                      borderColor: right ? 'rgba(255,99,0,0.2)' : 'var(--border-soft)',
                      background: right ? 'rgba(255,99,0,0.08)' : 'var(--bg-card)',
                      borderRadius: right ? '14px 4px 14px 14px' : '4px 14px 14px 14px',
                      padding: '8px 12px',
                    }}
                  >
                    {m.body && <div style={{ fontSize: 13, color: 'var(--text)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.5 }}>{m.body}</div>}
                    {(m.attachments ?? []).map((a, i) =>
                      a.type && a.type.startsWith('image/') && a.signed_url ? (
                        <img key={i} src={a.signed_url} alt={a.name ?? ''} style={{ display: 'block', maxWidth: 220, maxHeight: 180, objectFit: 'contain', borderRadius: 10, marginTop: 8, border: '1px solid var(--border-soft)' }} />
                      ) : (
                        <a key={i} href={a.signed_url} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', gap: 5, fontSize: 12, color: 'var(--text-mute)', marginTop: 6, textDecoration: 'underline' }}>
                          📄 {a.name ?? 'Arquivo'}
                        </a>
                      ),
                    )}
                    <div style={{ fontSize: 10, color: 'var(--text-mute)', marginTop: 5, textAlign: 'right' }} title={fmtDateTime(m.created_at)}>{timeLabel(m.created_at)}</div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {err && <p className="text-xs text-red-400" style={{ marginTop: 6 }}>{err}</p>}

      {done ? (
        <p style={{ marginTop: 12, fontSize: 12, color: 'var(--text-mute)', textAlign: 'center' }}>Chamado finalizado.</p>
      ) : (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 12 }}>
          <textarea
            className="tc-textarea"
            rows={2}
            placeholder="Escreva sua resposta…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                onSend();
              }
            }}
            style={{ flex: 1, resize: 'none' }}
          />
          <button onClick={onSend} disabled={send.isPending || !draft.trim()} className="tc-send-btn" title="Enviar (Enter)" aria-label="Enviar mensagem">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M2 21l21-9L2 3v7l15 2-15 2v7z" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
