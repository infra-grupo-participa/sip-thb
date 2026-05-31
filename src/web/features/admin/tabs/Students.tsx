import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { sipApi } from '../../../lib/api';
import { IconSearch } from '../icons';
import { cicloChip, fmtDateShort, isAurum, isSeminario } from '../helpers';

export interface AdminStudent {
  id: string;
  name: string;
  email: string;
  ciclo_type: 'aurum' | 'seminario' | null;
  is_platina?: boolean;
  monitor_id: string | null;
  monitor_name: string | null;
  progress_percent: number;
  current_stage: number;
  total_stages: number;
  completed_tasks?: number;
  total_tasks?: number;
  data_palestra?: string | null;
  created_at?: string | null;
  self_registered?: boolean;
  has_socio?: boolean;
  date_change_requested?: boolean;
  raiox_score?: number | null;
  raiox_max_score?: number | null;
}
interface AdminMonitor { id: string; name: string }

type StatusFilter = 'all' | 'active' | 'pending' | 'socios';

export default function Students({ onOpenStudent }: { onOpenStudent: (id: string) => void }) {
  const { data: studentsResp } = useQuery({
    queryKey: ['admin-students'],
    queryFn: () => sipApi<{ items: AdminStudent[] }>('/admin/students?limit=200', { throwOnError: true }),
  });
  const { data: monitors } = useQuery({
    queryKey: ['admin-monitors'],
    queryFn: () => sipApi<AdminMonitor[]>('/admin/monitors', { throwOnError: true }),
  });
  const { data: sociosResp } = useQuery({
    queryKey: ['admin-students-socios'],
    queryFn: () => sipApi<{ items: AdminStudent[] }>('/admin/students?status=socios', { throwOnError: true }),
  });

  const all = useMemo(() => studentsResp?.items ?? [], [studentsResp]);
  const socios = sociosResp?.items ?? [];

  const [status, setStatus] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [fCiclo, setFCiclo] = useState('all');
  const [fPalestra, setFPalestra] = useState('all');
  const [fNav, setFNav] = useState('all');
  const [fStage, setFStage] = useState('all');

  const maxStage = useMemo(() => Math.max(0, ...all.map((s) => s.total_stages ?? 0)), [all]);

  const summary = useMemo(() => {
    const aurum = all.filter((s) => isAurum(s)).length;
    const seminario = all.filter((s) => isSeminario(s)).length;
    const pending = all.filter((s) => !s.monitor_id).length;
    const avg = all.length ? Math.round(all.reduce((a, s) => a + (s.progress_percent ?? 0), 0) / all.length) : 0;
    const active = all.filter((s) => s.monitor_id).length;
    return { aurum, seminario, pending, avg, active };
  }, [all]);

  const filtered = useMemo(() => {
    let f = [...all];
    if (status === 'pending') f = f.filter((s) => !s.monitor_id);
    else if (status === 'active') f = f.filter((s) => s.monitor_id);
    if (fCiclo === 'platina') f = f.filter((s) => s.is_platina === true);
    else if (fCiclo !== 'all') f = f.filter((s) => s.ciclo_type === fCiclo && !s.is_platina);
    if (fStage !== 'all') f = f.filter((s) => s.current_stage === parseInt(fStage, 10));
    if (fPalestra === 'sim') f = f.filter((s) => s.data_palestra);
    if (fPalestra === 'nao') f = f.filter((s) => !s.data_palestra);
    if (fNav === 'none') f = f.filter((s) => !s.monitor_id);
    else if (fNav !== 'all') f = f.filter((s) => s.monitor_id === fNav);
    const q = search.trim().toLowerCase();
    if (q) f = f.filter((s) => (s.name || '').toLowerCase().includes(q) || (s.email || '').toLowerCase().includes(q));
    return f;
  }, [all, status, fCiclo, fStage, fPalestra, fNav, search]);

  const activeFilterCount =
    (fCiclo !== 'all' ? 1 : 0) + (fStage !== 'all' ? 1 : 0) + (fPalestra !== 'all' ? 1 : 0) + (fNav !== 'all' ? 1 : 0);

  const rows = status === 'socios' ? socios : filtered;

  return (
    <div>
      <div className="st-kpi-bar">
        <div className="st-kpi-cell">
          <span className="st-kpi-num">{all.length || '—'}</span>
          <span className="st-kpi-label">Total de alunos</span>
          <span className="st-kpi-sub">
            <span style={{ color: 'var(--brand)', fontWeight: 700 }}>{summary.aurum}</span> Aurum ·{' '}
            <span style={{ color: 'var(--purple)', fontWeight: 700 }}>{summary.seminario}</span> Diamante
          </span>
        </div>
        <div className="st-kpi-cell">
          <span className="st-kpi-num is-green">{summary.avg}%</span>
          <span className="st-kpi-label">Progresso médio</span>
          <span className="st-kpi-sub">Tarefas concluídas / total</span>
        </div>
        <div className="st-kpi-cell">
          <span className="st-kpi-num">{summary.pending}</span>
          <span className="st-kpi-label">Sem monitor</span>
          <span className="st-kpi-sub">Aguardando atribuição</span>
        </div>
        <div className="st-kpi-cell">
          <span className="st-kpi-num is-brand">—</span>
          <span className="st-kpi-label">Meta Aurum</span>
        </div>
        <div className="st-kpi-cell">
          <span className="st-kpi-num is-purple">—</span>
          <span className="st-kpi-label">Meta Diamante</span>
        </div>
      </div>

      <div className="st-toolbar">
        <div className="st-search-wrap">
          <IconSearch />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome ou e-mail…"
            className="st-search-input"
          />
        </div>
        <div className="st-status-tabs">
          <button className={`st-status-tab ${status === 'all' ? 'is-active' : ''}`} onClick={() => setStatus('all')}>
            Todos <span className="st-status-badge">{all.length}</span>
          </button>
          <button className={`st-status-tab ${status === 'active' ? 'is-active' : ''}`} onClick={() => setStatus('active')}>
            Ativos <span className="st-status-badge is-green">{summary.active}</span>
          </button>
          <button className={`st-status-tab ${status === 'pending' ? 'is-active' : ''}`} onClick={() => setStatus('pending')}>
            Pendentes <span className="st-status-badge is-amber">{summary.pending}</span>
          </button>
          <button className={`st-status-tab ${status === 'socios' ? 'is-active' : ''}`} onClick={() => setStatus('socios')}>
            Sócios <span className="st-status-badge is-blue">{socios.length}</span>
          </button>
        </div>
        <button onClick={() => setDrawerOpen((v) => !v)} className="admin-toolbar-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
          </svg>
          <span>Filtros</span>
          {activeFilterCount > 0 && <span className="admin-toolbar-count">{activeFilterCount}</span>}
        </button>
      </div>

      {drawerOpen && (
        <div className="admin-filter-drawer">
          <div className="admin-filter-row">
            <div className="filter-group">
              <span className="filter-group-label">Ciclo</span>
              {[
                ['all', 'Todos', ''],
                ['aurum', 'Aurum', 'is-brand'],
                ['seminario', 'Diamante', 'is-purple'],
                ['platina', 'Platina', 'is-amber'],
              ].map(([v, label, cls]) => (
                <button key={v} onClick={() => setFCiclo(v as string)} className={`chip ${cls} ${fCiclo === v ? 'is-active' : ''}`}>
                  {label}
                </button>
              ))}
            </div>
            <div className="filter-group">
              <span className="filter-group-label">Palestra</span>
              {[
                ['all', 'Todos'],
                ['sim', 'Com data'],
                ['nao', 'Sem data'],
              ].map(([v, label]) => (
                <button key={v} onClick={() => setFPalestra(v as string)} className={`chip ${fPalestra === v ? 'is-active' : ''}`}>
                  {label}
                </button>
              ))}
            </div>
            <div className="filter-group">
              <span className="filter-group-label">Monitor</span>
              <select value={fNav} onChange={(e) => setFNav(e.target.value)} className="chip-select">
                <option value="all">Todos</option>
                <option value="none">Sem monitor</option>
                {(monitors ?? []).map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </div>
            <div className="filter-group">
              <span className="filter-group-label">Etapa</span>
              <button onClick={() => setFStage('all')} className={`chip ${fStage === 'all' ? 'is-active' : ''}`}>Todas</button>
              {Array.from({ length: maxStage }, (_, i) => i + 1).map((n) => (
                <button key={n} onClick={() => setFStage(String(n))} className={`chip ${fStage === String(n) ? 'is-active' : ''}`}>
                  {n}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="st-table-card">
        <div className="st-table-head">
          <div className="st-col-name">Aluno</div>
          <div className="st-col-ciclo">Ciclo</div>
          <div className="st-col-monitor">Monitor</div>
          <div className="st-col-etapa">Etapa</div>
          <div className="st-col-progress">Progresso</div>
          <div className="st-col-palestra">Palestra</div>
        </div>
        <div>
          {rows.length === 0 ? (
            <div className="st-empty">
              <div style={{ fontSize: 28 }}>🎓</div>
              <p style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>Nenhum aluno encontrado</p>
              <p style={{ fontSize: 12, color: 'var(--text-mute)' }}>Tente ajustar os filtros acima.</p>
            </div>
          ) : (
            rows.map((s) => {
              const pct = s.progress_percent ?? 0;
              const barColor = pct === 100 ? 'var(--green)' : pct > 50 ? 'var(--brand)' : 'var(--blue)';
              const chip = cicloChip(s.ciclo_type, s.is_platina);
              return (
                <div className="st-row" key={s.id} onClick={() => onOpenStudent(s.id)}>
                  <div className="st-col-name">
                    <div className="st-avatar">{(s.name || '?').charAt(0).toUpperCase()}</div>
                    <div className="st-name-block">
                      <span className="st-name">{s.name || '—'}</span>
                      <span className="st-email">{s.email || ''}</span>
                      <span className="st-badges">
                        {s.has_socio && <span className="st-badge is-blue" title="Tem sócio">Sócio</span>}
                        {s.date_change_requested && <span className="st-badge is-amber">↻ Data</span>}
                      </span>
                    </div>
                  </div>
                  <div className="st-col-ciclo"><span className={`st-ciclo-chip ${chip.cls}`}>{chip.label}</span></div>
                  <div className="st-col-monitor">
                    {s.monitor_name ? (
                      <span className="st-nav-name">{s.monitor_name}</span>
                    ) : (
                      <span className="st-nav-pending">Sem monitor</span>
                    )}
                  </div>
                  <div className="st-col-etapa">
                    <span className="st-etapa-num">{s.current_stage}</span>
                    <span className="st-etapa-sep"> / {s.total_stages}</span>
                  </div>
                  <div className="st-col-progress">
                    <div className="st-prog-wrap">
                      <div className="st-prog-bar">
                        <div className="st-prog-fill" style={{ width: `${pct}%`, background: barColor }} />
                      </div>
                      <span className="st-prog-pct" style={{ color: barColor }}>{pct}%</span>
                    </div>
                    <span className="st-prog-frac">{s.completed_tasks ?? 0}/{s.total_tasks ?? 0} tarefas</span>
                  </div>
                  <div className="st-col-palestra">{fmtDateShort(s.data_palestra)}</div>
                </div>
              );
            })
          )}
        </div>
        <div className="st-table-foot">
          <span style={{ fontSize: 12, color: 'var(--text-mute)' }}>
            {rows.length !== all.length ? `${rows.length} de ${all.length} alunos` : `${all.length} alunos`}
          </span>
        </div>
      </div>
    </div>
  );
}
