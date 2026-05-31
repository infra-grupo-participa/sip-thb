import { useSession } from '../../lib/auth';
import { useProgress, useCiclo, usePosts, useTraffic, useDebriefing, useDebriefingStatus } from './hooks';
import SocioCard from './SocioCard';
import type { TaskItem } from './types';

const CICLO_FASE_LABELS: Record<string, string> = {
  preparacao: 'Preparação',
  teste_criativo: 'Teste de Criativo',
  captacao: 'Captação',
  aquecimento: 'Aquecimento',
  lembrete: 'Lembrete',
  evento: 'Evento',
  pos_evento: 'Pós-evento',
  sdb: 'SuperDebriefing',
  pos_ciclo: 'Pós-ciclo',
  encerrado: 'Encerrado',
  pendente: 'Aguardando início',
  aguardando: 'Aguardando',
};

const fmtBR = (d: string | null | undefined) => (d ? new Date(d + 'T00:00:00').toLocaleDateString('pt-BR') : '—');

function nextTask(stages: { unlocked: boolean; completed: boolean; categories: Record<string, TaskItem[]> }[]): string | null {
  for (const stage of stages) {
    if (!stage.unlocked || stage.completed) continue;
    for (const tasks of Object.values(stage.categories)) {
      const pending = tasks.find((t) => !t.completed && t.interactive !== false);
      if (pending) return pending.title;
    }
  }
  return null;
}

export default function Overview({ onOpenDebriefing, onGoChecklist }: { onOpenDebriefing: () => void; onGoChecklist: () => void }) {
  const { data: user } = useSession();
  const progress = useProgress();
  const ciclo = useCiclo();
  const posts = usePosts();
  const traffic = useTraffic();
  const sdb = useDebriefing();
  const sdbStatus = useDebriefingStatus();

  const p = progress.data;
  const total = p?.total ?? 0;
  const completed = p?.completed ?? 0;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  const c = ciclo.data?.ciclo ?? null;
  const corCiclo = c?.cor_destaque || '#C8A96E';

  const postsTotal = posts.data?.total ?? posts.data?.items?.length ?? null;
  const rows = traffic.data?.rows ?? [];
  const leads = rows.reduce((s, r) => s + (r.leads_builderall || 0), 0);
  const spent = rows.reduce((s, r) => s + (r.spent || 0), 0);

  const sdbDone = !!sdb.data?.created_at;
  const sdbReady = !!sdbStatus.data?.show_debriefing;

  const nt = nextTask(p?.stages ?? []);

  return (
    <div className="overview">
      {c && (
        <section className="hero-card" style={{ borderLeftColor: corCiclo }}>
          <div className="hero-card-head">
            <div>
              <div className="hero-card-eyebrow">
                <span>{c.icone || '🟡'}</span>
                <span className="pill" style={{ background: corCiclo + '20', color: corCiclo, border: `1px solid ${corCiclo}40` }}>
                  {CICLO_FASE_LABELS[c.fase_atual] || 'Em andamento'}
                </span>
              </div>
              <h1 className="hero-card-title">{c.nome || '—'}</h1>
              <p className="hero-card-sub">
                {fmtBR(c.data_inicio)} → {fmtBR(c.data_fim)}
              </p>
            </div>
            <div className="hero-card-stat">
              <p className="hero-card-stat-value">{c.dias_restantes != null ? `${c.dias_restantes} dias` : '—'}</p>
              <p className="hero-card-stat-label">restantes</p>
            </div>
          </div>
          <div className="hero-card-progress">
            <div className="hero-card-progress-fill" style={{ width: (c.progresso_temporal || 0) + '%', background: corCiclo }} />
          </div>
        </section>
      )}

      <section className="kpi-row">
        <div className="kpi-tile">
          <p className="kpi-label">Progresso</p>
          <p className="kpi-value">{pct}%</p>
          <div className="kpi-bar">
            <div style={{ width: pct + '%' }} />
          </div>
          <p className="kpi-hint">
            {completed} de {total} tarefas concluídas
          </p>
        </div>
        <div className="kpi-tile">
          <p className="kpi-label">Postagens</p>
          <p className="kpi-value">{postsTotal ?? '—'}</p>
          <p className="kpi-hint">total no ciclo</p>
        </div>
        <div className="kpi-tile">
          <p className="kpi-label">Leads captados</p>
          <p className="kpi-value">{leads ? leads.toLocaleString('pt-BR') : '—'}</p>
          <p className="kpi-hint">acumulado</p>
        </div>
        <div className="kpi-tile">
          <p className="kpi-label">Investimento</p>
          <p className="kpi-value">{spent ? 'R$ ' + spent.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}</p>
          <p className="kpi-hint">tráfego pago</p>
        </div>
      </section>

      <section className="overview-grid">
        <div className="info-card">
          <div className="info-card-head">
            <h2>Meu Ciclo</h2>
            <p>Informações centrais sobre o seu ciclo</p>
          </div>
          <dl className="info-list">
            <div>
              <dt>Monitor</dt>
              <dd className="is-strong is-brand">{user?.monitor_name || '—'}</dd>
            </div>
            <div>
              <dt>Próxima tarefa</dt>
              <dd className="meta-field">
                {nt ? (
                  <span className="value" style={{ cursor: 'pointer', color: 'var(--brand)' }} onClick={onGoChecklist}>
                    {nt}
                  </span>
                ) : (
                  <span className="placeholder" style={{ color: 'var(--text-mute)', fontStyle: 'italic' }}>
                    Nenhuma pendente
                  </span>
                )}
              </dd>
            </div>
          </dl>
        </div>

        <div className="info-card" id="socio-card">
          <div className="info-card-head">
            <div>
              <h2>Meu Time</h2>
              <p>Convide um sócio para colaborar</p>
            </div>
          </div>
          <SocioCard />
        </div>
      </section>

      <section className={`sdb-card ${sdbDone ? 'sdb-card-done' : sdbReady ? 'sdb-card-ready' : 'sdb-card-locked'}`}>
        <div className="sdb-card-icon">📋</div>
        <div className="sdb-card-main">
          <h2>{sdbDone ? 'SuperDebriefing enviado ✓' : sdbReady ? 'SuperDebriefing disponível! 🏆' : 'SuperDebriefing'}</h2>
          <p>
            {sdbDone
              ? 'Você já concluiu seu SuperDebriefing. Clique para revisar ou editar.'
              : sdbReady
                ? 'Você concluiu todas as tarefas. Preencha o SuperDebriefing para fechar o ciclo.'
                : 'Disponível ao concluir todas as tarefas do ciclo.'}
          </p>
        </div>
        <button className="btn-primary" disabled={!sdbDone && !sdbReady} onClick={onOpenDebriefing}>
          {sdbDone ? 'Revisar' : sdbReady ? 'Preencher SuperDebriefing' : 'Aguardando'}
        </button>
      </section>
    </div>
  );
}
