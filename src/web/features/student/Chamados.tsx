import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { sipApi, SipApiError } from '../../lib/api';
import { useReports } from './hooks';
import type { Report } from './types';

const TK_STATUS: Record<string, { label: string; bg: string; color: string; dot: string }> = {
  aberto: { label: 'Aberto', bg: 'rgba(245,158,11,0.15)', color: '#f59e0b', dot: '#f59e0b' },
  em_atendimento: { label: 'Em atendimento', bg: 'rgba(59,130,246,0.15)', color: '#60a5fa', dot: '#60a5fa' },
  finalizado: { label: 'Finalizado', bg: 'rgba(74,222,128,0.15)', color: '#4ade80', dot: '#4ade80' },
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

interface TicketMessage {
  id: string;
  report_id?: string;
  sender_id: string | null;
  sender_name: string;
  sender_role: string;
  body: string | null;
  attachments?: { name?: string; type?: string; signed_url?: string }[];
  created_at: string;
}
interface MessagesResponse {
  messages: TicketMessage[];
  status?: string;
}

function fmtDateTime(s: string) {
  try {
    return new Date(s).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return s;
  }
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

// Thread de mensagens do chamado (aluno) — polling a cada 15s, sem Realtime.
function TicketThread({ report }: { report: Report }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const msgsRef = useRef<HTMLDivElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['me-report-messages', report.id],
    queryFn: () => sipApi<MessagesResponse>(`/me/reports/${report.id}/messages`, { throwOnError: true }),
    refetchInterval: 15_000,
  });

  const messages = data?.messages ?? [];
  const status = data?.status ?? report.status;
  const done = status === 'finalizado';

  useEffect(() => {
    const el = msgsRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const send = useMutation({
    mutationFn: (body: string) =>
      sipApi(`/me/reports/${report.id}/messages`, { method: 'POST', body: JSON.stringify({ body }), throwOnError: true }),
    onSuccess: () => {
      setDraft('');
      setErr(null);
      qc.invalidateQueries({ queryKey: ['me-report-messages', report.id] });
      qc.invalidateQueries({ queryKey: ['me-reports'] });
    },
    onError: (e) => setErr(e instanceof SipApiError ? e.message : 'Erro ao enviar mensagem.'),
  });

  const reopen = useMutation({
    mutationFn: () => sipApi(`/me/reports/${report.id}/reopen`, { method: 'POST', throwOnError: true }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['me-report-messages', report.id] });
      qc.invalidateQueries({ queryKey: ['me-reports'] });
    },
    onError: (e) => setErr(e instanceof SipApiError ? e.message : 'Erro ao solicitar reabertura.'),
  });

  function onSend() {
    const body = draft.trim();
    if (!body) return;
    send.mutate(body);
  }

  let lastDate: string | null = null;
  let lastKey: string | null = null;

  return (
    <div>
      <div className="tc-msgs" ref={msgsRef} style={{ maxHeight: 360, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, padding: '8px 0' }}>
        {isLoading && <div className="tc-placeholder">Carregando…</div>}
        {!isLoading && messages.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--text-mute)', fontSize: 13, padding: 20 }}>Sem mensagens ainda. Escreva abaixo.</div>
        )}
        {messages.map((m) => {
          if (m.sender_role === 'system') {
            lastKey = null;
            return (
              <div key={m.id} className="tc-sys" style={{ display: 'flex', justifyContent: 'center' }}>
                <span style={{ fontSize: 11, color: 'var(--text-mute)', fontStyle: 'italic', background: 'var(--bg-elevated)', border: '1px solid var(--border-soft)', padding: '3px 12px', borderRadius: 20 }}>{m.body}</span>
              </div>
            );
          }
          const right = m.sender_role === 'student';
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
              <div style={{ display: 'flex', gap: 8, padding: '0 4px', alignItems: 'flex-end', flexDirection: right ? 'row-reverse' : 'row' }}>
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
        <div style={{ padding: '12px 0 4px', textAlign: 'center' }}>
          <button onClick={() => reopen.mutate()} disabled={reopen.isPending} className="tc-btn tc-btn-amber">
            {reopen.isPending ? 'Solicitando…' : 'Solicitar reabertura do chamado'}
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 8 }}>
          <textarea
            className="tc-textarea"
            rows={2}
            placeholder="Escreva sua mensagem…"
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

function TicketCard({ report }: { report: Report }) {
  const [open, setOpen] = useState(false);
  const kind = TK_KIND[report.kind] || TK_KIND.outro;
  const st = TK_STATUS[report.status] || TK_STATUS.aberto;
  return (
    <div className="hb-card rounded-xl p-4">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: st!.bg, color: st!.color }}>
          {st!.label}
        </span>
        <span style={{ color: kind!.color, fontSize: 12 }}>
          {kind!.icon} {kind!.label}
        </span>
        <button onClick={() => setOpen((o) => !o)} className="text-xs underline" style={{ marginLeft: 'auto', color: 'var(--brand)' }}>
          {open ? 'Fechar conversa' : 'Abrir conversa'}
        </button>
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
      {open && (
        <div className="mt-3 pt-3 border-t">
          <TicketThread report={report} />
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
          <TicketCard key={r.id} report={r} />
        ))}
      </div>

      {modal && <ReportModal onClose={() => setModal(false)} />}
    </div>
  );
}
