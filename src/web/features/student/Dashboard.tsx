import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { sipApi, SipApiError } from '../../lib/api';
import { useSession } from '../../lib/auth';
import type { ProgressResponse, Gamification, StageItem, TaskItem } from './types';
import './dashboard.css';

function useCompleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { taskId: string; completed: boolean; link?: string }) =>
      sipApi('/tasks/' + args.taskId + '/complete', {
        method: 'POST',
        body: JSON.stringify({ completed: args.completed, link: args.link }),
        throwOnError: true,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-progress'] });
      qc.invalidateQueries({ queryKey: ['gamification'] });
    },
  });
}

function WaitingCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="card center">
      <div className="brand-bar" />
      <h1>{title}</h1>
      <p className="muted">{body}</p>
    </div>
  );
}

function TaskRow({
  task,
  canToggle,
  busy,
  onToggle,
}: {
  task: TaskItem;
  canToggle: boolean;
  busy: boolean;
  onToggle: (t: TaskItem) => void;
}) {
  const check = (
    <span className="task-check" aria-hidden>
      {task.completed ? '✓' : '○'}
    </span>
  );
  return (
    <li className={`task ${task.completed ? 'done' : ''}`}>
      {canToggle ? (
        <button className="task-toggle" disabled={busy} onClick={() => onToggle(task)} title="Marcar/desmarcar">
          {check}
        </button>
      ) : (
        check
      )}
      <div className="task-body">
        <span className="task-title">{task.title}</span>
        <span className="task-tags">
          {task.owner === 'equipe' && <span className="tag tag-team">equipe</span>}
          {task.is_handoff && <span className="tag tag-handoff">handoff</span>}
          {task.requires_link && <span className="tag">link</span>}
          {task.prazo_label && <span className="tag">{task.prazo_label}</span>}
        </span>
      </div>
    </li>
  );
}

function StageCard({
  stage,
  busyId,
  onToggle,
}: {
  stage: StageItem;
  busyId: string | null;
  onToggle: (t: TaskItem) => void;
}) {
  const locked = !stage.unlocked;
  const cats = Object.entries(stage.categories);
  return (
    <section className={`stage ${locked ? 'locked' : ''} ${stage.completed ? 'completed' : ''}`}>
      <header className="stage-head">
        <div className="stage-num">{stage.completed ? '✓' : locked ? '🔒' : stage.stage_number}</div>
        <div className="stage-meta">
          <h3>{stage.title}</h3>
          {stage.description && <p className="muted">{stage.description}</p>}
        </div>
        <div className="stage-count">
          {stage.completed_count}/{stage.total_count}
        </div>
      </header>
      {!locked &&
        cats.map(([cat, tasks]) => (
          <div className="cat" key={cat}>
            {cats.length > 1 && <div className="cat-label">{cat}</div>}
            <ul className="tasks">
              {tasks
                .slice()
                .sort((a, b) => a.order_index - b.order_index)
                .map((t) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    canToggle={!locked && t.interactive}
                    busy={busyId === t.id}
                    onToggle={onToggle}
                  />
                ))}
            </ul>
          </div>
        ))}
      {locked && <p className="muted locked-hint">Conclua a etapa anterior para desbloquear.</p>}
    </section>
  );
}

export default function Dashboard() {
  const { data: user } = useSession();
  const progress = useQuery({
    queryKey: ['my-progress'],
    queryFn: () => sipApi<ProgressResponse>('/my-progress', { throwOnError: true }),
    refetchInterval: 60_000,
  });
  const gam = useQuery({
    queryKey: ['gamification'],
    queryFn: () => sipApi<Gamification>('/me/gamification', { throwOnError: true }),
    enabled: !!progress.data?.stages,
  });
  const complete = useCompleteTask();

  async function onToggle(task: TaskItem) {
    const completing = !task.completed;
    let link: string | undefined;
    if (completing && task.requires_link) {
      const entered = window.prompt('Cole o link (pasta no Drive) para esta tarefa:');
      if (entered === null) return; // cancelou
      link = entered.trim();
    }
    try {
      await complete.mutateAsync({ taskId: task.id, completed: completing, link });
    } catch (err) {
      window.alert(err instanceof SipApiError ? err.message : 'Não foi possível atualizar a tarefa.');
    }
  }

  if (progress.isLoading) {
    return <div className="card center">Carregando sua trilha…</div>;
  }

  const p = progress.data;
  if (p?.rejected) {
    return <WaitingCard title="Cadastro não aprovado" body="Entre em contato com o suporte." />;
  }
  if (p?.pending_approval) {
    return <WaitingCard title="Cadastro em análise" body="Assim que for aprovado, sua trilha será liberada." />;
  }
  if (p?.waiting || p?.wait_mode) {
    const body =
      p.reason === 'cycle_not_started' && p.data_inicio
        ? `Seu ciclo começa em ${p.data_inicio}.`
        : 'Você ainda não possui um monitor/ciclo ativo. Aguarde a liberação.';
    return <WaitingCard title="Aguardando início do ciclo" body={body} />;
  }

  const stages = p?.stages ?? [];
  const total = p?.total ?? 0;
  const completed = p?.completed ?? 0;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const g = gam.data;

  return (
    <div className="dash">
      <header className="dash-head">
        <div>
          <h1>Olá, {user?.name?.split(' ')[0] ?? 'aluno'} 👋</h1>
          <p className="muted">Sua trilha de implementação</p>
        </div>
        {g && (
          <div className="xp-box">
            <div className="xp-level">
              Nível {g.level} · {g.level_name}
            </div>
            <div className="xp-bar">
              <span style={{ width: `${g.xp_progress_percent}%` }} />
            </div>
            <div className="xp-meta">
              {g.xp} XP · 🔥 {g.streak} dias
            </div>
          </div>
        )}
      </header>

      <div className="progress-row">
        <div className="progress-bar">
          <span style={{ width: `${pct}%` }} />
        </div>
        <div className="progress-label">
          {completed}/{total} tarefas ({pct}%)
        </div>
      </div>

      <div className="stages">
        {stages.map((s) => (
          <StageCard key={s.id} stage={s} busyId={complete.isPending ? (complete.variables?.taskId ?? null) : null} onToggle={onToggle} />
        ))}
        {stages.length === 0 && <p className="muted">Nenhuma etapa disponível ainda.</p>}
      </div>

      {g && g.badges.some((b) => b.earned) && (
        <section className="badges">
          <h3>Conquistas</h3>
          <div className="badge-grid">
            {g.badges
              .filter((b) => b.earned || !b.secret)
              .map((b) => (
                <div key={b.id} className={`badge ${b.earned ? 'earned' : ''}`} title={b.description}>
                  <span className="badge-icon">{b.icon}</span>
                  <span className="badge-name">{b.name}</span>
                </div>
              ))}
          </div>
        </section>
      )}
    </div>
  );
}
