import { useQuery } from '@tanstack/react-query';
import { sipApi } from '../../../lib/api';
import { IconRefresh, IconCalendar } from '../icons';
import { initials, isAurum } from '../helpers';

interface RankStudent {
  id: string;
  name: string;
  ciclo_type: string | null;
  monitor_name: string | null;
  completed_tasks?: number;
}
interface DashboardData {
  totais?: { total?: number; aurum?: number; diamante?: number };
  engajamento?: { engajados?: number; sem_monitor?: number; nunca_iniciou?: number };
  engajamento_medio?: number;
  progresso_medio?: { aurum?: number; diamante?: number };
  concluidos_7d?: number;
  ciclos?: { ativos?: number; encerrados?: number; aguardando?: number; total?: number };
  top_engajados?: RankStudent[];
  top_parados?: RankStudent[];
  posts_recentes?: Array<{
    platform?: string;
    platform_label?: string;
    author_name?: string;
    format?: string;
    created_at?: string;
    date?: string;
  }>;
}

const CIRC = 163.4;

function RankRow({ s, i, onGo }: { s: RankStudent; i: number; onGo: () => void }) {
  const aurum = isAurum(s);
  return (
    <div className="dh-rank-row" onClick={onGo} style={{ cursor: 'pointer' }}>
      <span className={`dh-rank-num ${i < 3 ? 'is-' + (i + 1) : ''}`}>{i + 1}</span>
      <span className="dh-rank-avatar" style={{ background: aurum ? 'var(--brand)' : 'var(--purple)' }}>
        {initials(s.name)}
      </span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <span className="dh-rank-name">{s.name || '—'}</span>
        <span className="dh-rank-meta">
          {(s.monitor_name || 'Sem monitor') + ' · ' + (s.completed_tasks || 0) + ' tarefas'}
        </span>
      </div>
      <span className={`dh-rank-tag ${aurum ? '' : 'is-purple'}`}>{aurum ? 'Aurum' : 'Diamante'}</span>
    </div>
  );
}

export default function Dashboard({ onGoStudents, onGoCiclos, onGoPosts, onGoTraffic }: {
  onGoStudents: () => void;
  onGoCiclos: () => void;
  onGoPosts: () => void;
  onGoTraffic: () => void;
}) {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['admin-dashboard'],
    queryFn: () => sipApi<DashboardData>('/admin/dashboard', { throwOnError: true }),
  });

  const totais = data?.totais ?? {};
  const eng = data?.engajamento ?? {};
  const ciclos = data?.ciclos ?? {};
  const pa = data?.progresso_medio?.aurum ?? 0;
  const pd = data?.progresso_medio?.diamante ?? 0;
  const cTotal = ciclos.total ?? 0;
  const pct = (n: number) => (cTotal > 0 ? Math.round((n / cTotal) * 100) + '%' : '—');

  return (
    <div>
      <div className="dh-header">
        <div>
          <h1>Visão Geral</h1>
          <p>Acompanhe os principais indicadores do programa em tempo real.</p>
        </div>
        <div className="dh-toolbar">
          <button onClick={() => refetch()} className="pg-export-btn" type="button">
            <IconRefresh /> Atualizar
          </button>
          <button className="pg-range-btn" type="button">
            <IconCalendar />
            <span>Últimos 30 dias</span>
          </button>
        </div>
      </div>

      <div className="dh-kpi-row">
        <div className="dh-kpi">
          <div className="dh-kpi-head">
            <span className="dh-kpi-label">Total de alunos</span>
          </div>
          <div className="dh-kpi-value-row"><span className="dh-kpi-value">{totais.total ?? '—'}</span></div>
          <span className="dh-kpi-sub"><strong>{totais.aurum ?? '—'}</strong> Aurum · <strong>{totais.diamante ?? '—'}</strong> Diamante</span>
        </div>
        <div className="dh-kpi">
          <div className="dh-kpi-head"><span className="dh-kpi-label">Alunos ativos</span></div>
          <div className="dh-kpi-value-row"><span className="dh-kpi-value">{eng.engajados ?? '—'}</span></div>
          <span className="dh-kpi-sub">
            {totais.total ? Math.round(((eng.engajados ?? 0) / totais.total) * 100) + '% do total' : '—'}
          </span>
        </div>
        <div className="dh-kpi">
          <div className="dh-kpi-head"><span className="dh-kpi-label">Engajamento médio</span></div>
          <div className="dh-kpi-value-row"><span className="dh-kpi-value">{(data?.engajamento_medio ?? 0) + '%'}</span></div>
          <span className="dh-kpi-sub">vs período anterior</span>
        </div>
        <div className="dh-kpi">
          <div className="dh-kpi-head"><span className="dh-kpi-label">Ciclos ativos</span></div>
          <div className="dh-kpi-value-row"><span className="dh-kpi-value">{ciclos.ativos ?? '—'}</span></div>
          <span className="dh-kpi-sub">Ativos: {ciclos.ativos ?? 0} · Encerrados: {ciclos.encerrados ?? 0}</span>
        </div>
        <div className="dh-kpi">
          <div className="dh-kpi-head"><span className="dh-kpi-label">Concluídos (7 dias)</span></div>
          <div className="dh-kpi-value-row"><span className="dh-kpi-value">{data?.concluidos_7d ?? '—'}</span></div>
          <span className="dh-kpi-sub">tarefas concluídas</span>
        </div>
        <div className="dh-kpi">
          <div className="dh-kpi-head"><span className="dh-kpi-label">Sem monitor</span></div>
          <div className="dh-kpi-value-row"><span className="dh-kpi-value">{eng.sem_monitor ?? '—'}</span></div>
          <span className="dh-kpi-sub"><strong>{eng.nunca_iniciou ?? '—'}</strong> nunca iniciaram</span>
        </div>
      </div>

      <div className="dh-grid-2">
        <div className="dh-card">
          <div className="dh-card-head">Desempenho do programa</div>
          <div className="dh-card-body">
            <div className="dh-perf-donuts">
              {[
                { v: pa, color: 'var(--brand)', label: 'Aurum' },
                { v: pd, color: 'var(--purple)', label: 'Diamante' },
              ].map((d) => (
                <div className="dh-perf-donut-cell" key={d.label}>
                  <div className="dh-perf-donut-svg">
                    <svg viewBox="0 0 64 64">
                      <circle cx="32" cy="32" r="26" fill="none" stroke="var(--border-soft)" strokeWidth="6" />
                      <circle
                        cx="32" cy="32" r="26" fill="none" stroke={d.color} strokeWidth="6" strokeLinecap="round"
                        strokeDasharray={CIRC} strokeDashoffset={CIRC - (d.v / 100) * CIRC}
                        style={{ transition: 'stroke-dashoffset 1.2s cubic-bezier(.4,0,.2,1)' }}
                      />
                    </svg>
                    <div className="dh-perf-donut-center" style={{ color: d.color }}>{d.v}%</div>
                  </div>
                  <div className="dh-perf-donut-info">
                    <span className="label" style={{ color: d.color }}>{d.label}</span>
                    <span className="sub">Progresso médio</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="dh-card">
          <div className="dh-card-head">
            Status dos ciclos
            <span className="dh-card-head-link" onClick={onGoCiclos}>Ver todos</span>
          </div>
          <div className="dh-card-body">
            <div className="dh-status-grid">
              <div className="dh-status-donut">
                <svg viewBox="0 0 140 140">
                  <circle cx="70" cy="70" r="60" fill="none" stroke="var(--border-soft)" strokeWidth="20" />
                </svg>
                <div className="dh-status-donut-center"><strong>{cTotal}</strong><small>ciclos no total</small></div>
              </div>
              <div className="dh-status-list">
                <div className="dh-status-row">
                  <span className="dh-status-dot is-green"></span>
                  <span className="dh-status-name">Ativos</span>
                  <span className="dh-status-cnt">{ciclos.ativos ?? '—'}</span>
                  <span className="dh-status-pct">{pct(ciclos.ativos ?? 0)}</span>
                </div>
                <div className="dh-status-row">
                  <span className="dh-status-dot is-mute"></span>
                  <span className="dh-status-name">Encerrados</span>
                  <span className="dh-status-cnt">{ciclos.encerrados ?? '—'}</span>
                  <span className="dh-status-pct">{pct(ciclos.encerrados ?? 0)}</span>
                </div>
                <div className="dh-status-row">
                  <span className="dh-status-dot is-blue"></span>
                  <span className="dh-status-name">Aguardando</span>
                  <span className="dh-status-cnt">{ciclos.aguardando ?? '—'}</span>
                  <span className="dh-status-pct">{pct(ciclos.aguardando ?? 0)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="dh-grid-3">
        <div className="dh-card">
          <div className="dh-card-head">
            <span><span className="dot is-amber"></span>Mais engajados</span>
            <span className="dh-card-head-link" onClick={onGoStudents}>últimos 7 dias</span>
          </div>
          <div className="dh-card-body">
            {isLoading ? (
              <div style={{ padding: 18, textAlign: 'center', fontSize: 12, color: 'var(--text-mute)' }}>Carregando…</div>
            ) : (data?.top_engajados ?? []).length === 0 ? (
              <div style={{ padding: 18, textAlign: 'center', fontSize: 12.5, color: 'var(--text-mute)' }}>Sem dados</div>
            ) : (
              (data?.top_engajados ?? []).slice(0, 3).map((s, i) => <RankRow key={s.id} s={s} i={i} onGo={onGoStudents} />)
            )}
          </div>
        </div>
        <div className="dh-card">
          <div className="dh-card-head">
            <span><span className="dot is-amber"></span>Precisam de atenção</span>
            <span className="dh-card-head-link" onClick={onGoStudents}>sem atividade</span>
          </div>
          <div className="dh-card-body">
            {(data?.top_parados ?? []).length === 0 ? (
              <div style={{ padding: 18, textAlign: 'center', fontSize: 12.5, color: 'var(--text-mute)' }}>Sem dados</div>
            ) : (
              (data?.top_parados ?? []).slice(0, 3).map((s, i) => <RankRow key={s.id} s={s} i={i} onGo={onGoStudents} />)
            )}
          </div>
        </div>
        <div className="dh-card">
          <div className="dh-card-head">
            <span><span className="dot is-blue"></span>Posts recentes</span>
            <span className="dh-card-head-link" onClick={onGoPosts}>Ver todos</span>
          </div>
          <div className="dh-card-body">
            {(data?.posts_recentes ?? []).length === 0 ? (
              <div style={{ padding: 18, textAlign: 'center', fontSize: 12.5, color: 'var(--text-mute)' }}>Sem posts recentes</div>
            ) : (
              (data?.posts_recentes ?? []).slice(0, 5).map((p, i) => (
                <div className="dh-post-row" key={i}>
                  <div className="dh-post-body">
                    <span className="dh-post-author">{p.author_name || '—'}</span>
                    <span className="dh-post-title">{p.platform_label || p.platform || '—'}</span>
                  </div>
                  <div className="dh-post-meta">
                    <span className="dh-post-fmt">{p.format || '—'}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="dh-footer-info" onClick={onGoTraffic} style={{ cursor: 'default' }}>
        Os dados são atualizados automaticamente a cada 24 horas.
      </div>
    </div>
  );
}
