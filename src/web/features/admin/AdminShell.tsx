import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { sipApi, SipApiError } from '../../lib/api';
import './admin.css';

type Tab = 'visao' | 'aprovacoes' | 'alunos' | 'config';

// ── Visão geral ────────────────────────────────────────────────────────────────
interface Dashboard {
  totais: { total: number; aurum: number; diamante: number };
  engajamento: { engajados: number; sem_monitor: number; nunca_iniciou: number };
  progresso_medio: { aurum: number; diamante: number };
  top_engajados: Array<{ id: string; name: string; ciclo_type: string; monitor_name: string | null; completed_tasks: number }>;
  concluidos_7d: number;
  ciclos: { ativos: number; encerrados: number; aguardando: number; total: number };
}
function Visao() {
  const { data, isLoading } = useQuery({ queryKey: ['admin-dashboard'], queryFn: () => sipApi<Dashboard>('/admin/dashboard', { throwOnError: true }) });
  if (isLoading || !data) return <p className="muted">Carregando…</p>;
  const kpis = [
    { label: 'Alunos', value: data.totais.total },
    { label: 'Aurum', value: data.totais.aurum },
    { label: 'Diamante', value: data.totais.diamante },
    { label: 'Engajados (7d)', value: data.engajamento.engajados },
    { label: 'Sem monitor', value: data.engajamento.sem_monitor },
    { label: 'Concluídas (7d)', value: data.concluidos_7d },
    { label: 'Progresso médio Aurum', value: data.progresso_medio.aurum + '%' },
    { label: 'Progresso médio Diamante', value: data.progresso_medio.diamante + '%' },
    { label: 'Ciclos ativos', value: data.ciclos.ativos },
  ];
  return (
    <>
      <div className="kpi-grid">
        {kpis.map((k) => (
          <div className="kpi" key={k.label}>
            <div className="kpi-value">{k.value}</div>
            <div className="kpi-label">{k.label}</div>
          </div>
        ))}
      </div>
      <h3>Top engajados</h3>
      <table className="tbl">
        <thead><tr><th>Aluno</th><th>Ciclo</th><th>Monitor</th><th>Tarefas</th></tr></thead>
        <tbody>
          {data.top_engajados.map((s) => (
            <tr key={s.id}><td>{s.name}</td><td>{s.ciclo_type ?? '—'}</td><td>{s.monitor_name ?? '—'}</td><td>{s.completed_tasks}</td></tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

// ── Aprovações ───────────────────────────────────────────────────────────────────
interface Pending { id: string; name: string; email: string; ciclo_type: string | null; interesse_ciclo: string | null; raiox_score: number | null; raiox_max_score: number | null }
interface Monitor { id: string; name: string; is_admin: boolean }
function Aprovacoes() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['admin-pending'], queryFn: () => sipApi<{ items: Pending[] }>('/admin/pending-students', { throwOnError: true }) });
  const { data: monitors } = useQuery({ queryKey: ['admin-monitors'], queryFn: () => sipApi<Monitor[]>('/admin/monitors', { throwOnError: true }) });
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
  if (items.length === 0) return <p className="muted">Nenhum cadastro pendente. 🎉</p>;
  return (
    <table className="tbl">
      <thead><tr><th>Aluno</th><th>Interesse</th><th>Raio-X</th><th></th></tr></thead>
      <tbody>
        {items.map((s) => (
          <>
            <tr key={s.id}>
              <td>{s.name}<br /><span className="muted">{s.email}</span></td>
              <td>{s.interesse_ciclo ?? '—'}</td>
              <td>{s.raiox_score != null && s.raiox_max_score ? Math.round((s.raiox_score / s.raiox_max_score) * 100) + '%' : '—'}</td>
              <td className="nowrap">
                <button className="btn-sm" onClick={() => { setErr(null); setOpenId(openId === s.id ? null : s.id); setForm((f) => ({ ...f, monitor_id: monitors?.[0]?.id ?? '' })); }}>Aprovar</button>{' '}
                <button className="link-btn" onClick={() => reject.mutate(s.id)}>Rejeitar</button>
              </td>
            </tr>
            {openId === s.id && (
              <tr key={s.id + '-form'}>
                <td colSpan={4}>
                  <div className="approve-form">
                    <label>Ciclo
                      <select value={form.ciclo_type} onChange={(e) => setForm({ ...form, ciclo_type: e.target.value })}>
                        <option value="aurum">Aurum (palestra)</option>
                        <option value="seminario">Diamante/Platina (seminário)</option>
                      </select>
                    </label>
                    {form.ciclo_type === 'seminario' && (
                      <label className="chk"><input type="checkbox" checked={form.is_platina} onChange={(e) => setForm({ ...form, is_platina: e.target.checked })} /> Platina</label>
                    )}
                    <label>Monitor
                      <select value={form.monitor_id} onChange={(e) => setForm({ ...form, monitor_id: e.target.value })}>
                        <option value="">Selecione…</option>
                        {(monitors ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}{m.is_admin ? ' (admin)' : ''}</option>)}
                      </select>
                    </label>
                    <label>Data do evento<input type="date" value={form.data_palestra} onChange={(e) => setForm({ ...form, data_palestra: e.target.value })} /></label>
                    <button className="btn-sm" disabled={approve.isPending} onClick={() => approve.mutate(s.id)}>{approve.isPending ? '...' : 'Confirmar liberação'}</button>
                  </div>
                  {err && <div className="alert">{err}</div>}
                </td>
              </tr>
            )}
          </>
        ))}
      </tbody>
    </table>
  );
}

// ── Alunos ────────────────────────────────────────────────────────────────────────
interface Student { id: string; name: string; email: string; ciclo_type: string | null; monitor_name: string | null; approval_status: string; progress_percent: number }
function Alunos() {
  const { data } = useQuery({ queryKey: ['admin-students'], queryFn: () => sipApi<{ items: Student[] }>('/admin/students', { throwOnError: true }) });
  const items = data?.items ?? [];
  return (
    <table className="tbl">
      <thead><tr><th>Aluno</th><th>Ciclo</th><th>Monitor</th><th>Status</th><th>Progresso</th></tr></thead>
      <tbody>
        {items.map((s) => (
          <tr key={s.id}>
            <td>{s.name}<br /><span className="muted">{s.email}</span></td>
            <td>{s.ciclo_type ?? '—'}</td>
            <td>{s.monitor_name ?? '—'}</td>
            <td>{s.approval_status}</td>
            <td>
              <div className="mini-bar"><span style={{ width: `${s.progress_percent}%` }} /></div>
              {s.progress_percent}%
            </td>
          </tr>
        ))}
        {items.length === 0 && <tr><td colSpan={5} className="muted">Nenhum aluno.</td></tr>}
      </tbody>
    </table>
  );
}

// ── Configurações ──────────────────────────────────────────────────────────────────
interface Setting { key: string; label: string; kind: string; default: string; value: unknown }
function Config() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['admin-settings'], queryFn: () => sipApi<Setting[]>('/admin/settings', { throwOnError: true }) });
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: () => sipApi('/admin/settings', { method: 'POST', body: JSON.stringify({ settings: draft }), throwOnError: true }),
    onSuccess: () => { setSaved(true); qc.invalidateQueries({ queryKey: ['admin-settings'] }); setTimeout(() => setSaved(false), 2000); },
  });
  const val = (s: Setting) => (draft[s.key] !== undefined ? draft[s.key] : String(s.value ?? ''));
  return (
    <div className="settings">
      {(data ?? []).map((s) => (
        <label className="setting" key={s.key}>
          <span>{s.label}</span>
          {s.kind === 'textarea' ? (
            <textarea value={val(s)} onChange={(e) => setDraft({ ...draft, [s.key]: e.target.value })} />
          ) : (
            <input value={val(s)} onChange={(e) => setDraft({ ...draft, [s.key]: e.target.value })} />
          )}
        </label>
      ))}
      <button className="btn-sm" disabled={save.isPending || Object.keys(draft).length === 0} onClick={() => save.mutate()}>
        {save.isPending ? 'Salvando…' : saved ? 'Salvo ✓' : 'Salvar configurações'}
      </button>
    </div>
  );
}

export default function AdminShell() {
  const [tab, setTab] = useState<Tab>('visao');
  const tabs: Array<[Tab, string]> = [['visao', 'Visão geral'], ['aprovacoes', 'Aprovações'], ['alunos', 'Alunos'], ['config', 'Configurações']];
  return (
    <div className="admin">
      <h1>Painel administrativo</h1>
      <div className="admin-tabs">
        {tabs.map(([id, label]) => (
          <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      <div className="admin-body">
        {tab === 'visao' && <Visao />}
        {tab === 'aprovacoes' && <Aprovacoes />}
        {tab === 'alunos' && <Alunos />}
        {tab === 'config' && <Config />}
      </div>
    </div>
  );
}
