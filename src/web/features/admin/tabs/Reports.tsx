import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { sipApi, SipApiError } from '../../../lib/api';
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
  status: string;
  created_at?: string;
}

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

// Status do chat de chamados (ticket_messages): aberto / em_atendimento / finalizado.
const STATUS_META: Record<string, { label: string; bg: string; color: string }> = {
  aberto: { label: 'Aberto', bg: 'rgba(245,158,11,0.15)', color: '#f59e0b' },
  em_atendimento: { label: 'Em atendimento', bg: 'rgba(59,130,246,0.15)', color: '#60a5fa' },
  finalizado: { label: 'Finalizado', bg: 'rgba(74,222,128,0.15)', color: '#4ade80' },
};
// Compat com o vocabulário antigo (em_analise/resolvido) caso ainda exista no banco.
const STATUS_LABEL: Record<string, string> = {
  aberto: 'Aberto',
  em_atendimento: 'Em atendimento',
  em_analise: 'Em análise',
  resolvido: 'Resolvido',
  finalizado: 'Finalizado',
};

const KIND_LABEL: Record<string, { label: string; icon: string; color: string }> = {
  sistema: { label: 'Problema no sistema', icon: '🐛', color: '#dc2626' },
  tutorial: { label: 'Tutorial Desatualizado', icon: '📖', color: '#f59e0b' },
  duvida: { label: 'Dúvidas sobre o sistema', icon: '❓', color: '#22d3ee' },
  tarefa: { label: 'Problema na tarefa', icon: '🎯', color: '#3b82f6' },
  outro: { label: 'Outro', icon: '💬', color: '#94a3b8' },
};

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
function avatarColor(role: string) {
  if (role === 'admin') return '#FF6300';
  if (role === 'monitor') return '#3b82f6';
  return '#64748b';
}

export default function Reports() {
  const [filter, setFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ['admin-reports', filter],
    queryFn: () => sipApi<{ items: Report[] }>(filter ? `/admin/reports?status=${filter}` : '/admin/reports', { throwOnError: true }),
    refetchInterval: 15_000,
  });

  const items = data?.items ?? [];
  const selected = items.find((r) => r.id === selectedId) ?? null;

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
          <option value="em_atendimento">Em atendimento</option>
          <option value="finalizado">Finalizados</option>
        </select>
      </div>

      {items.length === 0 ? (
        <div className="hb-card" style={{ padding: 32, textAlign: 'center', color: 'var(--text-mute)', fontSize: 13 }}>Nenhum chamado neste filtro.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.map((r) => {
            const who = r.user_name ?? r.student_name ?? '—';
            const kind = KIND_LABEL[r.kind ?? 'outro'] ?? KIND_LABEL.outro!;
            const sm = STATUS_META[r.status];
            return (
              <div key={r.id} className="hb-card" style={{ padding: '14px 16px', display: 'flex', gap: 12 }}>
                <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--brand-soft)', color: 'var(--brand)', fontSize: 13, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  {initials(who)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{who}</span>
                    <span style={{ fontSize: 12, color: kind.color }}>· {kind.icon} {kind.label}</span>
                    {sm ? (
                      <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: sm.bg, color: sm.color }}>{sm.label}</span>
                    ) : (
                      <span className="hb-chip">{STATUS_LABEL[r.status] ?? r.status}</span>
                    )}
                    <span style={{ fontSize: 11, color: 'var(--text-mute)', marginLeft: 'auto' }}>{fmtDateFull(r.created_at)}</span>
                  </div>
                  {r.message && <p style={{ fontSize: 13, color: 'var(--text-sub)', marginTop: 6, whiteSpace: 'pre-wrap' }}>{r.message}</p>}
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button onClick={() => setSelectedId(r.id)} className="hb-btn hb-btn-primary hb-btn-sm">Abrir conversa</button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selected && <ChatModal report={selected} filter={filter} onClose={() => setSelectedId(null)} />}
    </div>
  );
}

function ChatModal({ report, filter, onClose }: { report: Report; filter: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const msgsRef = useRef<HTMLDivElement>(null);

  const kind = KIND_LABEL[report.kind ?? 'outro'] ?? KIND_LABEL.outro!;

  const { data, isLoading } = useQuery({
    queryKey: ['admin-report-messages', report.id],
    queryFn: () => sipApi<ThreadResponse>(`/admin/reports/${report.id}/messages`, { throwOnError: true }),
    refetchInterval: 15_000,
  });

  const messages = data?.messages ?? [];
  const status = (data?.report.status as string | undefined) ?? report.status ?? 'aberto';
  const sm = STATUS_META[status] ?? STATUS_META.aberto!;
  const done = status === 'finalizado';

  useEffect(() => {
    const el = msgsRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['admin-report-messages', report.id] });
    qc.invalidateQueries({ queryKey: ['admin-reports', filter] });
    qc.invalidateQueries({ queryKey: ['admin-reports-count'] });
  }

  const send = useMutation({
    mutationFn: (body: string) =>
      sipApi(`/admin/reports/${report.id}/messages`, { method: 'POST', body: JSON.stringify({ body }), throwOnError: true }),
    onSuccess: () => {
      setDraft('');
      setErr(null);
      invalidate();
    },
    onError: (e) => setErr(e instanceof SipApiError ? e.message : 'Erro ao enviar mensagem.'),
  });

  const setStatus = useMutation({
    mutationFn: (next: string) =>
      sipApi(`/admin/reports/${report.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: next }), throwOnError: true }),
    onSuccess: invalidate,
    onError: (e) => setErr(e instanceof SipApiError ? e.message : 'Erro ao alterar status.'),
  });

  function onSend() {
    const body = draft.trim();
    if (!body) return;
    send.mutate(body);
  }

  let lastDate: string | null = null;
  let lastKey: string | null = null;

  return (
    <div className="modal-backdrop">
      <div className="modal-shell" style={{ maxWidth: 640, display: 'flex', flexDirection: 'column', maxHeight: '88vh' }}>
        <div className="modal-head">
          <div className="modal-head-main">
            <div className="modal-head-title-row">
              <h2>{report.user_name ?? report.student_name ?? 'Chamado'}</h2>
              <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: sm.bg, color: sm.color }}>{sm.label}</span>
            </div>
            <p className="modal-head-info" style={{ color: kind.color }}>{kind.icon} {kind.label}</p>
          </div>
          <button type="button" onClick={onClose} className="modal-close">×</button>
        </div>

        <div ref={msgsRef} className="modal-pane" style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, padding: 16, flex: 1, minHeight: 0 }}>
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
            const right = m.sender_role === 'admin' || m.sender_role === 'monitor';
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
                      <div style={{ fontSize: 10, color: 'var(--text-mute)', marginTop: 5, textAlign: 'right' }}>{timeLabel(m.created_at)}</div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {err && <p className="text-xs text-red-400" style={{ padding: '0 16px' }}>{err}</p>}

        <div className="modal-foot" style={{ flexDirection: 'column', gap: 10, alignItems: 'stretch' }}>
          {done ? (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, color: 'var(--text-mute)' }}>Chamado finalizado.</span>
              <button onClick={() => setStatus.mutate('aberto')} disabled={setStatus.isPending} className="tc-btn tc-btn-amber">
                {setStatus.isPending ? 'Reativando…' : 'Reativar'}
              </button>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
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
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button onClick={() => setStatus.mutate('finalizado')} disabled={setStatus.isPending} className="tc-btn tc-btn-green">
                  {setStatus.isPending ? 'Finalizando…' : 'Finalizar chamado'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
