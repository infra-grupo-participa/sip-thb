import { useMemo, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { sipApi } from '../../../lib/api';
import { IconRefresh } from '../icons';
import { cicloChip } from '../helpers';

// ─── Tipos do contrato GET /admin/ig/cohort (espelha handlers/ig.ts) ──────────
type IgFlag =
  | 'not_connected'
  | 'revoked'
  | 'no_posts'
  | 'low_volume'
  | 'reach_drop'
  | 'below_cohort'
  | 'ok';

type IgSeverity = 'red' | 'orange' | 'yellow' | 'green';

interface CohortItem {
  user_id: string;
  name: string;
  email: string;
  ciclo_type: 'aurum' | 'seminario' | null;
  is_platina: boolean;
  current_stage: number | null;
  total_stages: number | null;
  data_palestra: string | null;
  monitor_id: string | null;
  monitor_name: string | null;
  ig: {
    status: 'active' | 'revoked' | 'not_connected';
    ig_username: string | null;
    last_collected_at: string | null;
    followers_count: number | null;
    followers_snapshot_date: string | null;
  };
  window: {
    posts_count: number;
    avg_reach: number | null;
    total_impressions: number | null;
    total_engagement: number | null;
    by_type: Record<string, number>;
    last_post_at: string | null;
    days_since_last_post: number | null;
  };
  reach_drop_pct: number | null;
  manual_posts_count: number;
  matched_posts_count: number;
  streak: { days: number; last_post_date: string | null };
  flags: IgFlag[];
  severity: IgSeverity;
}

interface CohortMeta {
  window: string;
  configured: boolean;
  generated_at: string | null;
  total_students: number;
  total_connected: number;
  total_with_metrics_in_window: number;
  cohorts: unknown[];
}

interface CohortResponse {
  items?: CohortItem[];
  meta?: CohortMeta | null;
  error?: string;
}

interface CollectResponse {
  collected?: number;
  skipped?: number;
  errors?: unknown[];
  error?: string;
}

// ─── i18n / labels (espelha ig.js) ────────────────────────────────────────────
const FLAG_LABEL: Record<IgFlag, string> = {
  not_connected: 'Não conectado',
  revoked: 'Token revogado',
  no_posts: 'Sem postar',
  low_volume: 'Volume baixo',
  reach_drop: 'Alcance em queda',
  below_cohort: 'Abaixo da coorte',
  ok: 'OK',
};
const FLAG_TINT: Record<IgFlag, string> = {
  not_connected: 'rgba(239,68,68,.15)',
  revoked: 'rgba(239,68,68,.15)',
  no_posts: 'rgba(251,146,60,.18)',
  low_volume: 'rgba(251,146,60,.18)',
  reach_drop: 'rgba(251,191,36,.18)',
  below_cohort: 'rgba(251,191,36,.18)',
  ok: 'rgba(74,222,128,.16)',
};
const FLAG_COLOR: Record<IgFlag, string> = {
  not_connected: '#ef4444',
  revoked: '#ef4444',
  no_posts: '#fb923c',
  low_volume: '#fb923c',
  reach_drop: '#f59e0b',
  below_cohort: '#f59e0b',
  ok: '#16a34a',
};
const SEVERITY_LEFT_BORDER: Record<IgSeverity, string> = {
  red: '#ef4444',
  orange: '#fb923c',
  yellow: '#f59e0b',
  green: 'transparent',
};

const flagLabel = (f: string): string => FLAG_LABEL[f as IgFlag] ?? f;
const flagTint = (f: string): string => FLAG_TINT[f as IgFlag] ?? 'transparent';
const flagColor = (f: string): string => FLAG_COLOR[f as IgFlag] ?? 'var(--text)';
const severityBorder = (s: string): string => SEVERITY_LEFT_BORDER[s as IgSeverity] ?? 'transparent';

// ─── Formatação (espelha ig.js) ──────────────────────────────────────────────
function fmtNum(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace('.', ',') + 'k';
  return String(n);
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

// ─── Streak badge (espelha streakBadgeHtml) ──────────────────────────────────
function StreakBadge({ days }: { days: number }) {
  if (!days) {
    return (
      <span style={{ color: 'var(--text-mute)', fontSize: 14 }} title="Sem postagem recente">
        💤
      </span>
    );
  }
  const color = days >= 7 ? 'var(--green,#16a34a)' : days >= 3 ? 'var(--yellow,#d97706)' : 'var(--text-mute)';
  const icon = days >= 7 ? '🔥 ' : '';
  return (
    <span style={{ color, fontWeight: 700 }} title={`${days} dias consecutivos`}>
      {icon}
      {days}d
    </span>
  );
}

const GRID = 'minmax(180px,2fr) 100px 70px 110px 100px 70px 90px 90px 110px 1fr';

const FLAG_OPTS: Array<[string, string]> = [
  ['all', 'Todas'],
  ['critical', 'Críticas'],
  ['not_connected', 'Não conectado'],
  ['revoked', 'Token revogado'],
  ['no_posts', 'Sem postar'],
  ['low_volume', 'Volume baixo'],
  ['reach_drop', 'Alcance em queda'],
  ['below_cohort', 'Abaixo da coorte'],
  ['ok', 'OK'],
];

export default function Instagram() {
  const [win, setWin] = useState('7d');
  const [fCiclo, setFCiclo] = useState('all');
  const [fMonitor, setFMonitor] = useState('all');
  const [fFlag, setFFlag] = useState('all');
  const [search, setSearch] = useState('');

  const { data, refetch, isFetching } = useQuery({
    queryKey: ['admin-ig-cohort', win],
    queryFn: () =>
      sipApi<CohortResponse>(`/admin/ig/cohort?window=${encodeURIComponent(win)}`, { throwOnError: false }),
    retry: false,
  });

  const collectAll = useMutation({
    mutationFn: () => sipApi<CollectResponse>('/admin/ig/collect-all', { method: 'POST', throwOnError: false }),
    onSettled: () => {
      void refetch();
    },
  });

  const items = useMemo<CohortItem[]>(
    () => (Array.isArray(data?.items) ? data!.items!.filter(Boolean) : []),
    [data],
  );
  const meta = data?.meta ?? null;
  const errorMsg = data?.error ?? null;

  // Banner (espelha loadAdminIg)
  const banner = useMemo<string | null>(() => {
    if (errorMsg) return `Erro: ${errorMsg}`;
    if (meta && meta.configured === false) {
      return '⚙️ Configuração pendente: defina META_APP_ID e META_REDIRECT_URI nas secrets do servidor para ativar a coleta.';
    }
    if (meta && meta.total_connected === 0 && items.length > 0) {
      return '🔌 Nenhum aluno conectou o Instagram ainda. Eles podem conectar pelo dashboard.';
    }
    return null;
  }, [errorMsg, meta, items.length]);

  // Opções de monitor (self-contained a partir dos items — espelha populateMonitorFilter)
  const monitorOpts = useMemo<Array<[string, string]>>(() => {
    const seen = new Map<string, string>();
    for (const it of items) {
      if (it.monitor_id && it.monitor_name && !seen.has(it.monitor_id)) {
        seen.set(it.monitor_id, it.monitor_name);
      }
    }
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'));
  }, [items]);

  // Filtro local (espelha applyAndRender)
  const filtered = useMemo<CohortItem[]>(() => {
    const q = search.trim().toLowerCase();
    return items.filter((item) => {
      if (fCiclo === 'platina' && !item.is_platina) return false;
      if (fCiclo !== 'all' && fCiclo !== 'platina' && item.ciclo_type !== fCiclo) return false;
      if (fMonitor === 'none' && item.monitor_id) return false;
      if (fMonitor !== 'all' && fMonitor !== 'none' && item.monitor_id !== fMonitor) return false;
      if (fFlag === 'critical' && item.severity === 'green') return false;
      if (fFlag !== 'all' && fFlag !== 'critical' && (!Array.isArray(item.flags) || !item.flags.includes(fFlag as IgFlag)))
        return false;
      if (q) {
        const hay = `${item.name || ''} ${item.email || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [items, fCiclo, fMonitor, fFlag, search]);

  // Contador (espelha renderCounter)
  const counter = useMemo<string>(() => {
    const total = items.length;
    const collected = meta?.total_with_metrics_in_window ?? 0;
    const connected = meta?.total_connected ?? 0;
    const generated = meta?.generated_at ? ` · gerado ${fmtDateTime(meta.generated_at)}` : '';
    const filterPart = filtered.length === total ? `${total} alunos` : `${filtered.length} de ${total} alunos`;
    return `${filterPart} · ${connected} conectados · ${collected} com posts na janela${generated}`;
  }, [items.length, meta, filtered.length]);

  function clearFilters() {
    setFCiclo('all');
    setFMonitor('all');
    setFFlag('all');
    setSearch('');
  }

  return (
    <div className="space-y-4">
      <div className="hb-card rounded-xl" style={{ overflow: 'hidden' }}>
        <div
          className="px-5 py-4 border-b"
          style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}
        >
          <div>
            <h2 className="font-semibold">Instagram dos alunos</h2>
            <p className="text-xs mt-0.5">Identifique quem está postando vs quem precisa de atenção ao longo do ciclo.</p>
          </div>
          <button
            id="ig-refresh-btn"
            onClick={() => collectAll.mutate()}
            disabled={collectAll.isPending}
            className="pg-export-btn"
            type="button"
            title="Coleta métricas do Instagram de todos os alunos conectados — pode levar até 1 min."
          >
            <IconRefresh /> <span>{collectAll.isPending ? 'Coletando…' : 'Atualizar agora'}</span>
          </button>
        </div>

        {banner && (
          <div
            style={{
              padding: '12px 20px',
              borderBottom: '1px solid var(--border)',
              background: 'var(--bg-muted)',
              fontSize: 13,
              color: 'var(--text-sub)',
            }}
          >
            {banner}
          </div>
        )}

        {collectAll.isSuccess && collectAll.data && !collectAll.data.error && (
          <div
            style={{
              padding: '10px 20px',
              borderBottom: '1px solid var(--border)',
              fontSize: 12,
              color: 'var(--green,#16a34a)',
            }}
          >
            Coleta concluída: {collectAll.data.collected ?? 0} posts atualizados.
          </div>
        )}
        {collectAll.isSuccess && collectAll.data?.error && (
          <div
            style={{ padding: '10px 20px', borderBottom: '1px solid var(--border)', fontSize: 12, color: '#ef4444' }}
          >
            {collectAll.data.error}
          </div>
        )}

        {/* Filtros */}
        <div
          style={{
            padding: '14px 20px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
          }}
        >
          <label className="hb-label" style={{ margin: 0 }}>
            Janela
          </label>
          <select value={win} onChange={(e) => setWin(e.target.value)} className="hb-input hb-input-sm">
            <option value="7d">Últimos 7 dias</option>
            <option value="30d">Últimos 30 dias</option>
            <option value="since_palestra">Desde a palestra</option>
          </select>

          <label className="hb-label" style={{ margin: 0 }}>
            Ciclo
          </label>
          <select
            id="ig-filter-ciclo"
            value={fCiclo}
            onChange={(e) => setFCiclo(e.target.value)}
            className="hb-input hb-input-sm"
          >
            <option value="all">Todos</option>
            <option value="aurum">Aurum</option>
            <option value="seminario">Seminário</option>
            <option value="platina">Platina</option>
          </select>

          <label className="hb-label" style={{ margin: 0 }}>
            Monitor
          </label>
          <select
            id="ig-filter-monitor"
            value={fMonitor}
            onChange={(e) => setFMonitor(e.target.value)}
            className="hb-input hb-input-sm"
          >
            <option value="all">Todos</option>
            <option value="none">Sem monitor</option>
            {monitorOpts.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>

          <label className="hb-label" style={{ margin: 0 }}>
            Flag
          </label>
          <select
            id="ig-filter-flag"
            value={fFlag}
            onChange={(e) => setFFlag(e.target.value)}
            className="hb-input hb-input-sm"
          >
            {FLAG_OPTS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>

          <input
            id="ig-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            type="search"
            placeholder="Buscar nome ou e-mail…"
            className="hb-input hb-input-sm"
            style={{ marginLeft: 'auto', minWidth: 220 }}
          />
          <button type="button" className="pg-export-btn" onClick={clearFilters} title="Limpar filtros">
            Limpar
          </button>
        </div>

        {/* Contador */}
        <div
          id="ig-counter"
          style={{
            padding: '10px 20px',
            fontSize: 12,
            color: 'var(--text-mute)',
            borderBottom: '1px solid var(--border-soft)',
          }}
        >
          {isFetching ? 'Carregando…' : counter}
        </div>

        {/* Tabela coorte */}
        <div style={{ padding: '4px 20px 18px' }}>
          {isFetching ? (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-mute)', fontSize: 13 }}>
              Carregando…
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: '48px 20px', textAlign: 'center' }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>👌</div>
              <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', margin: 0 }}>Nenhum aluno nesse filtro</p>
              <p style={{ fontSize: 12, color: 'var(--text-mute)', marginTop: 4 }}>
                Tente afrouxar os filtros — bom sinal quando nada aparece em "críticas".
              </p>
            </div>
          ) : (
            <div
              style={{
                border: '1px solid var(--border)',
                borderRadius: 12,
                overflow: 'hidden',
                background: 'var(--bg-card)',
              }}
            >
              {/* Cabeçalho */}
              <div
                className="ig-row ig-row-head"
                style={{
                  display: 'grid',
                  gridTemplateColumns: GRID,
                  gap: 10,
                  padding: '10px 12px',
                  fontSize: 10,
                  textTransform: 'uppercase',
                  letterSpacing: '.06em',
                  color: 'var(--text-mute)',
                  fontWeight: 800,
                  borderBottom: '1px solid var(--border)',
                }}
              >
                <span>Aluno</span>
                <span>Ciclo</span>
                <span>Etapa</span>
                <span>Monitor</span>
                <span title="IG coletados / manuais registrados">Posts</span>
                <span title="Dias consecutivos postando">Streak</span>
                <span>Alcance</span>
                <span>Engaj.</span>
                <span>Seguidores</span>
                <span>Flags</span>
              </div>

              {/* Linhas */}
              {filtered.map((item) => {
                const chip = cicloChip(item.ciclo_type, item.is_platina);
                const stage =
                  item.current_stage != null && item.total_stages ? `${item.current_stage}/${item.total_stages}` : '—';
                const followers = item.ig?.followers_count != null ? fmtNum(item.ig.followers_count) : '—';
                const reach = item.window?.avg_reach != null ? fmtNum(item.window.avg_reach) : '—';
                const engagement = item.window?.total_engagement != null ? fmtNum(item.window.total_engagement) : '—';

                const igCount = item.window?.posts_count ?? 0;
                const manualCount = item.manual_posts_count ?? 0;
                const matched = item.matched_posts_count ?? 0;
                const streakDays = item.streak?.days ?? 0;

                return (
                  <div
                    key={item.user_id}
                    className="ig-row"
                    style={{
                      display: 'grid',
                      gridTemplateColumns: GRID,
                      gap: 10,
                      padding: 12,
                      borderBottom: '1px solid var(--border-soft)',
                      borderLeft: `3px solid ${severityBorder(item.severity)}`,
                      alignItems: 'center',
                      transition: 'background .12s',
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: 'var(--text)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {item.name}
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: 'var(--text-mute)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {item.email}
                      </div>
                    </div>

                    <div>
                      <span className={`st-ciclo-chip ${chip.cls}`}>{chip.label}</span>
                    </div>

                    <div style={{ fontSize: 12, color: 'var(--text)' }}>{stage}</div>

                    <div
                      style={{
                        fontSize: 12,
                        color: item.monitor_name ? 'var(--text)' : 'var(--text-mute)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {item.monitor_name || '—'}
                    </div>

                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
                      {igCount}
                      {manualCount > 0 && (
                        <span
                          title={`${matched}/${manualCount} manuais vinculados à coleta IG`}
                          style={{
                            color: matched === manualCount ? 'var(--green,#16a34a)' : 'var(--text-mute)',
                            fontWeight: 600,
                            fontSize: 10,
                            marginLeft: 4,
                          }}
                        >
                          ({matched}/{manualCount})
                        </span>
                      )}
                    </div>

                    <div style={{ fontSize: 13 }}>
                      <StreakBadge days={streakDays} />
                    </div>

                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{reach}</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{engagement}</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{followers}</div>

                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                      {(item.flags || []).map((f) => (
                        <span
                          key={f}
                          title={flagLabel(f)}
                          style={{
                            display: 'inline-block',
                            fontSize: 10,
                            fontWeight: 800,
                            padding: '2px 8px',
                            borderRadius: 999,
                            background: flagTint(f),
                            color: flagColor(f),
                            marginRight: 4,
                          }}
                        >
                          {flagLabel(f)}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
