import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { sipApi, SipApiError } from '../../../lib/api';
import { IconPlus } from '../icons';
import { isAurum } from '../helpers';

interface MonitorStudent { name: string; progress_percent: number; ciclo_type: 'aurum' | 'seminario' | null }
interface MonitorCard {
  id: string;
  name: string;
  email: string;
  avg_progress: number | null;
  student_count: number;
  aurum_count: number;
  seminario_count: number;
  students?: MonitorStudent[];
}

export default function Monitores() {
  const qc = useQueryClient();
  const { data: monitors } = useQuery({
    queryKey: ['admin-monitors-full'],
    queryFn: () => sipApi<MonitorCard[]>('/admin/monitors', { throwOnError: true }),
  });
  const { data: studentsResp } = useQuery({
    queryKey: ['admin-students'],
    queryFn: () => sipApi<{ items: unknown[] }>('/admin/students?limit=200', { throwOnError: true }),
  });
  const totalAlunos = studentsResp?.items?.length ?? 0;

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [err, setErr] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => sipApi('/admin/monitors', { method: 'POST', body: JSON.stringify(form), throwOnError: true }),
    onSuccess: () => {
      setOpen(false);
      setForm({ name: '', email: '', password: '' });
      qc.invalidateQueries({ queryKey: ['admin-monitors-full'] });
      qc.invalidateQueries({ queryKey: ['admin-monitors'] });
    },
    onError: (e) => setErr(e instanceof SipApiError ? e.message : 'Erro ao criar monitor.'),
  });

  const list = monitors ?? [];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', margin: 0 }}>Monitores</h2>
          <p style={{ fontSize: 13, color: 'var(--text-mute)', marginTop: 2 }}>
            Responsáveis pelo acompanhamento dos alunos em cada ciclo
          </p>
        </div>
        <button onClick={() => { setErr(null); setOpen(true); }} className="hb-btn hb-btn-primary hb-btn-sm">
          <IconPlus /> Novo Monitor
        </button>
      </div>

      {list.length === 0 ? (
        <div className="empty-state" style={{ padding: '3rem' }}>
          <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>Nenhum monitor cadastrado</p>
          <p style={{ fontSize: 13, color: 'var(--text-mute)' }}>Clique em "Novo Monitor" para adicionar o primeiro.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(320px,1fr))', gap: 14 }}>
          {list.map((n) => {
            const prog = n.avg_progress;
            const progColor = prog == null ? 'var(--text-mute)' : prog >= 70 ? '#16a34a' : prog >= 40 ? '#d97706' : 'var(--red)';
            const pctTurma = totalAlunos > 0 ? Math.round((n.student_count / totalAlunos) * 100) : 0;
            const top = (n.students ?? []).slice().sort((a, b) => b.progress_percent - a.progress_percent).slice(0, 4);
            const moreCount = (n.students ?? []).length - 4;
            return (
              <div key={n.id} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', overflow: 'hidden', boxShadow: 'var(--shadow)' }}>
                <div style={{ padding: '18px 20px 14px', borderBottom: '1px solid var(--border-soft)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--brand-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 800, color: 'var(--brand)', flexShrink: 0 }}>
                      {n.name.charAt(0).toUpperCase()}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{n.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-mute)', marginTop: 1 }}>{n.email}</div>
                    </div>
                    {prog != null && (
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div style={{ fontSize: 18, fontWeight: 800, color: progColor }}>{prog}%</div>
                        <div style={{ fontSize: 10, color: 'var(--text-mute)' }}>progresso médio</div>
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-mute)' }}>
                      {n.student_count} aluno{n.student_count !== 1 ? 's' : ''}
                    </span>
                    <span style={{ color: 'var(--border)' }}>·</span>
                    <span style={{ fontSize: 11, color: 'var(--text-mute)' }}>{pctTurma}% do total</span>
                    {n.aurum_count > 0 && (
                      <span style={{ background: 'var(--brand-soft)', color: 'var(--brand)', fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 5 }}>🟠 {n.aurum_count} Aurum</span>
                    )}
                    {n.seminario_count > 0 && (
                      <span style={{ background: 'var(--purple-bg)', color: 'var(--purple)', fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 5 }}>💎 {n.seminario_count} Diamante</span>
                    )}
                  </div>
                  {prog != null && (
                    <div style={{ marginTop: 10, height: 4, background: 'var(--border)', borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${prog}%`, background: progColor, borderRadius: 4, transition: 'width .6s ease' }} />
                    </div>
                  )}
                </div>
                {n.student_count > 0 ? (
                  <div style={{ padding: '10px 20px' }}>
                    {top.map((s, i) => {
                      const barColor = isAurum(s) ? 'var(--brand)' : 'var(--purple)';
                      return (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--border-soft)' }}>
                          <div style={{ width: 22, height: 22, borderRadius: '50%', background: barColor + '18', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: barColor, flexShrink: 0 }}>
                            {s.name.charAt(0).toUpperCase()}
                          </div>
                          <span style={{ flex: 1, fontSize: 12, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                          <div style={{ width: 48, height: 3, background: 'var(--border)', borderRadius: 3, overflow: 'hidden', flexShrink: 0 }}>
                            <div style={{ height: '100%', width: `${s.progress_percent}%`, background: barColor }} />
                          </div>
                          <span style={{ fontSize: 11, fontWeight: 700, color: barColor, width: 30, textAlign: 'right', flexShrink: 0 }}>{s.progress_percent}%</span>
                        </div>
                      );
                    })}
                    {moreCount > 0 && (
                      <div style={{ fontSize: 11, color: 'var(--text-mute)', paddingTop: 6 }}>+{moreCount} aluno{moreCount !== 1 ? 's' : ''}</div>
                    )}
                  </div>
                ) : (
                  <div style={{ padding: '14px 20px', fontSize: 12, color: 'var(--text-mute)' }}>Nenhum aluno vinculado ainda.</div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div className="hb-card" style={{ background: 'var(--bg-card)', maxWidth: 460, width: '100%', padding: 24, borderRadius: 14 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3 style={{ fontSize: 18, fontWeight: 800 }}>Novo Monitor</h3>
              <button onClick={() => setOpen(false)} className="hb-btn hb-btn-secondary hb-btn-sm">Fechar</button>
            </div>
            {err && <div style={{ color: '#b91c1c', fontSize: 13, marginBottom: 10, padding: '8px 12px', background: 'rgba(185,28,28,0.07)', borderRadius: 8 }}>{err}</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label className="hb-label">Nome</label>
                <input className="hb-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={120} />
              </div>
              <div>
                <label className="hb-label">E-mail</label>
                <input className="hb-input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              <div>
                <label className="hb-label">Senha</label>
                <input className="hb-input" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 18 }}>
              <button onClick={() => setOpen(false)} className="hb-btn hb-btn-secondary hb-btn-sm">Cancelar</button>
              <button onClick={() => create.mutate()} disabled={create.isPending} className="hb-btn hb-btn-primary hb-btn-sm">
                {create.isPending ? 'Criando...' : 'Criar Monitor'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
