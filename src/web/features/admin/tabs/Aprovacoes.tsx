import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { sipApi, SipApiError } from '../../../lib/api';

interface Pending {
  id: string;
  name: string;
  email: string;
  ciclo_type: string | null;
  interesse_ciclo: string | null;
  raiox_score: number | null;
  raiox_max_score: number | null;
}
interface Monitor { id: string; name: string; is_admin?: boolean }

export default function Aprovacoes() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['admin-pending'],
    queryFn: () => sipApi<{ items: Pending[] }>('/admin/pending-students', { throwOnError: true }),
  });
  const { data: monitors } = useQuery({
    queryKey: ['admin-monitors'],
    queryFn: () => sipApi<Monitor[]>('/admin/monitors', { throwOnError: true }),
  });

  const [openId, setOpenId] = useState<string | null>(null);
  const [form, setForm] = useState({ ciclo_type: 'aurum', is_platina: false, monitor_id: '', data_palestra: '' });
  const [err, setErr] = useState<string | null>(null);

  const approve = useMutation({
    mutationFn: (id: string) => sipApi(`/admin/students/${id}/approve`, { method: 'POST', body: JSON.stringify(form), throwOnError: true }),
    onSuccess: () => {
      setOpenId(null);
      qc.invalidateQueries({ queryKey: ['admin-pending'] });
      qc.invalidateQueries({ queryKey: ['admin-students'] });
    },
    onError: (e) => setErr(e instanceof SipApiError ? e.message : 'Erro ao aprovar.'),
  });
  const reject = useMutation({
    mutationFn: (id: string) => sipApi(`/admin/students/${id}/reject`, { method: 'POST', body: JSON.stringify({}), throwOnError: true }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-pending'] }),
  });

  const items = data?.items ?? [];

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', margin: 0 }}>Aprovações pendentes</h2>
        <p style={{ fontSize: 13, color: 'var(--text-mute)', marginTop: 2 }}>Cadastros aguardando liberação de acesso</p>
      </div>

      {items.length === 0 ? (
        <div className="hb-card" style={{ padding: 32, textAlign: 'center', color: 'var(--text-mute)', fontSize: 13 }}>
          Nenhum cadastro pendente. 🎉
        </div>
      ) : (
        <div className="st-table-card">
          {items.map((s) => {
            const pct = s.raiox_score != null && s.raiox_max_score ? Math.round((s.raiox_score / s.raiox_max_score) * 100) + '%' : '—';
            return (
              <div key={s.id} style={{ borderBottom: '1px solid var(--border-soft)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{s.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-mute)' }}>{s.email}</div>
                  </div>
                  <span style={{ fontSize: 12, color: 'var(--text-sub)' }}>{s.interesse_ciclo ?? '—'}</span>
                  <span className="hb-chip">Raio-X {pct}</span>
                  <button
                    className="hb-btn hb-btn-primary hb-btn-sm"
                    onClick={() => {
                      setErr(null);
                      setOpenId(openId === s.id ? null : s.id);
                      setForm((f) => ({ ...f, monitor_id: monitors?.[0]?.id ?? '' }));
                    }}
                  >
                    Aprovar
                  </button>
                  <button className="hb-btn hb-btn-secondary hb-btn-sm" onClick={() => reject.mutate(s.id)}>Rejeitar</button>
                </div>
                {openId === s.id && (
                  <div style={{ padding: '12px 16px', background: 'var(--bg-muted)', display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
                    <div>
                      <label className="hb-label">Ciclo</label>
                      <select className="hb-input hb-input-sm" value={form.ciclo_type} onChange={(e) => setForm({ ...form, ciclo_type: e.target.value })}>
                        <option value="aurum">Aurum (palestra)</option>
                        <option value="seminario">Diamante/Platina (seminário)</option>
                      </select>
                    </div>
                    {form.ciclo_type === 'seminario' && (
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                        <input type="checkbox" checked={form.is_platina} onChange={(e) => setForm({ ...form, is_platina: e.target.checked })} /> Platina
                      </label>
                    )}
                    <div>
                      <label className="hb-label">Monitor</label>
                      <select className="hb-input hb-input-sm" value={form.monitor_id} onChange={(e) => setForm({ ...form, monitor_id: e.target.value })}>
                        <option value="">Selecione…</option>
                        {(monitors ?? []).map((m) => (
                          <option key={m.id} value={m.id}>{m.name}{m.is_admin ? ' (admin)' : ''}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="hb-label">Data do evento</label>
                      <input className="hb-input hb-input-sm" type="date" value={form.data_palestra} onChange={(e) => setForm({ ...form, data_palestra: e.target.value })} />
                    </div>
                    <button className="hb-btn hb-btn-primary hb-btn-sm" disabled={approve.isPending} onClick={() => approve.mutate(s.id)}>
                      {approve.isPending ? '...' : 'Confirmar liberação'}
                    </button>
                    {err && <div style={{ color: '#b91c1c', fontSize: 13, width: '100%' }}>{err}</div>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
