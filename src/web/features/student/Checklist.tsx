import { useState } from 'react';
import { SipApiError } from '../../lib/api';
import { useProgress, useCompleteTask } from './hooks';
import type { StageItem, TaskItem } from './types';

function renderMissionLine(raw: string, key: number) {
  const line = raw.trim();
  if (!line) return <br key={key} />;
  const md = /^\[(.+?)\]\((https?:\/\/[^)]+)\)$/.exec(line);
  if (md) {
    return (
      <a
        key={key}
        href={md[2]}
        target="_blank"
        rel="noopener noreferrer"
        className="task-pasta-link"
        style={{ display: 'inline-flex', gap: 5 }}
      >
        📄 {md[1]}
      </a>
    );
  }
  const step = /^(\d+)[.)]\s+(.+)/.exec(line);
  if (step) {
    return (
      <span key={key} style={{ display: 'inline-flex', alignItems: 'flex-start', gap: 7 }}>
        <span
          style={{
            flexShrink: 0,
            minWidth: 19,
            height: 19,
            borderRadius: '50%',
            background: 'rgba(99,102,241,.13)',
            color: 'var(--brand)',
            fontSize: 10,
            fontWeight: 700,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginTop: 1,
          }}
        >
          {step[1]}
        </span>
        <span style={{ lineHeight: 1.5 }}>{step[2]}</span>
      </span>
    );
  }
  if (/^https?:\/\/\S+$/.test(line)) {
    return (
      <a key={key} href={line} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--brand)', fontSize: 11, wordBreak: 'break-all' }}>
        {line}
      </a>
    );
  }
  return <span key={key}>{raw}</span>;
}

function Mission({ text }: { text: string }) {
  const lines = text.split('\n');
  return (
    <>
      {lines.map((l, i) => (
        <span key={i} style={{ display: 'block' }}>
          {renderMissionLine(l, i)}
        </span>
      ))}
    </>
  );
}

function TaskDetails({ task }: { task: TaskItem }) {
  return (
    <div className="task-details-panel" style={{ marginTop: 8 }}>
      {task.why_text && (
        <div className="task-details-section">
          <div className="label">Por que isso importa</div>
          <div className="body">{task.why_text}</div>
        </div>
      )}
      {task.mission && (
        <div className="task-details-section">
          <div className="label">Sua missão</div>
          <div className="body">
            <Mission text={task.mission} />
          </div>
        </div>
      )}
      {task.tutorial_url && (
        <div className="task-details-section">
          <a href={task.tutorial_url} target="_blank" rel="noopener noreferrer" className="tutorial-link">
            ▶ Ver tutorial
          </a>
        </div>
      )}
    </div>
  );
}

function TaskRow({
  task,
  locked,
  busy,
  onToggle,
  onConfirmLink,
}: {
  task: TaskItem;
  locked: boolean;
  busy: boolean;
  onToggle: (t: TaskItem) => void;
  onConfirmLink: (t: TaskItem) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasInfo = !!(task.tutorial_url || task.why_text || task.mission);
  const requiresLink = task.requires_link;

  // Tarefa da equipe — read-only
  if (task.interactive === false) {
    return (
      <div className={`task-row task-row-equipe rounded-lg ${locked ? 'opacity-40' : ''}`}>
        <div className="flex items-start gap-3 p-2">
          <div className="task-equipe-icon mt-0.5 flex-shrink-0" title="Responsabilidade da equipe" aria-hidden>
            🛠
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm flex-1">{task.title}</span>
              <span className="task-owner-badge badge-equipe">Equipe</span>
              {task.prazo_label && <span className="task-prazo-chip">{task.prazo_label}</span>}
              {hasInfo && (
                <button type="button" className="task-expand-toggle" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)} title="Ver detalhes da tarefa">
                  ▾
                </button>
              )}
            </div>
            {hasInfo && expanded && <TaskDetails task={task} />}
            <p className="task-equipe-status">A equipe cuida desta etapa — você não precisa fazer nada aqui.</p>
          </div>
        </div>
      </div>
    );
  }

  const checked = task.completed;
  const dateVal = task.completed_at ? new Date(task.completed_at).toISOString().split('T')[0] : '';
  const ownerBadge = task.owner === 'ambos';

  return (
    <div className={`task-row rounded-lg ${locked ? 'opacity-40' : ''} ${expanded ? 'is-expanded' : ''}`}>
      <div className="flex items-start gap-3 p-2">
        <input
          type="checkbox"
          checked={checked}
          disabled={busy || locked || (requiresLink && !checked)}
          onChange={() => onToggle(task)}
          className="mt-0.5 w-4 h-4 accent-amber-500 cursor-pointer flex-shrink-0"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <label className={`text-sm ${checked ? 'line-through opacity-50' : ''} cursor-pointer flex-1`}>{task.title}</label>
            {ownerBadge && <span className="task-owner-badge badge-ambos">Você + equipe</span>}
            {task.prazo_label && <span className="task-prazo-chip">{task.prazo_label}</span>}
            {hasInfo && (
              <button type="button" className="task-expand-toggle" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)} title="Ver detalhes da tarefa">
                ▾
              </button>
            )}
          </div>
          {hasInfo && expanded && <TaskDetails task={task} />}

          {requiresLink && !checked && (
            <div className="mt-2 p-3 rounded-lg" style={{ background: 'var(--bg-muted)', border: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <span style={{ fontSize: 18 }}>📁</span>
                <div>
                  <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-sub)', margin: '0 0 2px' }}>
                    {task.link_label || 'Sua pasta de envio'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => onConfirmLink(task)}
                disabled={busy}
                style={{
                  width: '100%',
                  padding: 8,
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: 700,
                  border: 'none',
                  cursor: 'pointer',
                  background: 'var(--ciclo-aurum, #d97706)',
                  color: '#0f172a',
                }}
              >
                ✓ Confirmei — já enviei meus arquivos na pasta
              </button>
            </div>
          )}

          {requiresLink && checked && (
            <div className="mt-2 p-3 rounded-lg" style={{ background: 'rgba(34,197,94,.06)', border: '1px solid rgba(34,197,94,.2)' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <span style={{ fontSize: 18, flexShrink: 0 }}>✅</span>
                <div>
                  <p style={{ fontSize: 12, fontWeight: 700, color: '#15803d', margin: '0 0 3px' }}>Envio confirmado!</p>
                  <p style={{ fontSize: 11, color: 'var(--text-sub)', margin: 0, lineHeight: 1.5 }}>
                    A equipe foi notificada. O material editado será devolvido na mesma pasta.
                  </p>
                </div>
              </div>
            </div>
          )}

          {checked && (
            <div className="flex items-center gap-1 mt-0.5">
              <span className="text-xs">Concluído em</span>
              <span className="text-xs" style={{ color: 'var(--text-mute)' }}>
                {dateVal ? new Date(dateVal + 'T12:00:00').toLocaleDateString('pt-BR') : '—'}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StageCard({
  stage,
  defaultOpen,
  busyId,
  onToggle,
  onConfirmLink,
}: {
  stage: StageItem;
  defaultOpen: boolean;
  busyId: string | null;
  onToggle: (t: TaskItem) => void;
  onConfirmLink: (t: TaskItem) => void;
}) {
  const isLocked = !stage.unlocked;
  const isCompleted = stage.completed;
  const [open, setOpen] = useState(defaultOpen);
  const stagePct = stage.total_count > 0 ? Math.round((stage.completed_count / stage.total_count) * 100) : 0;

  return (
    <div className={`hb-card rounded-xl overflow-hidden border ${isCompleted ? 'border-green-500/40' : ''}`}>
      <div className="p-4 flex items-center justify-between cursor-pointer select-none" onClick={() => setOpen((v) => !v)}>
        <div className="flex items-center gap-3">
          {isLocked ? (
            <div className="w-8 h-8 rounded-lg flex items-center justify-center">🔒</div>
          ) : isCompleted ? (
            <div className="w-8 h-8 rounded-lg bg-green-500/20 flex items-center justify-center text-green-400 text-lg">✓</div>
          ) : (
            <div className="w-8 h-8 rounded-lg bg-amber-500/20 flex items-center justify-center text-amber-400 font-bold text-sm">{stage.stage_number}</div>
          )}
          <div>
            <h3 className={isLocked ? 'font-medium' : 'font-semibold'}>{stage.title}</h3>
            {stage.description && <p className="text-sm">{stage.description}</p>}
          </div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <div className="text-right">
            <span className={`text-sm font-medium ${isCompleted ? 'text-green-400' : 'text-amber-400'}`}>
              {stage.completed_count}/{stage.total_count}
            </span>
            <div className="w-20 rounded-full h-1.5 mt-1" style={{ background: 'var(--border)' }}>
              <div className={`${isCompleted ? 'bg-green-500' : 'bg-amber-500'} h-1.5 rounded-full`} style={{ width: stagePct + '%' }} />
            </div>
          </div>
          <span className="text-sm inline-block" style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform .2s' }}>
            ▼
          </span>
        </div>
      </div>

      {open && (
        <div>
          {Object.entries(stage.categories).map(([catName, tasks]) => {
            const studentTasks = tasks.filter((t) => t.interactive !== false);
            const catDone = studentTasks.filter((t) => t.completed).length;
            const catTotal = studentTasks.length;
            const catPct = catTotal > 0 ? Math.round((catDone / catTotal) * 100) : 0;
            return (
              <div className="px-4 pb-1" key={catName}>
                <div className="flex items-center justify-between py-2 border-t">
                  <p className="text-xs font-semibold uppercase tracking-wider">{catName}</p>
                  <div className="flex items-center gap-2">
                    <div className="w-16 rounded-full h-1" style={{ background: 'var(--border)' }}>
                      <div className={catDone === catTotal && catTotal > 0 ? 'bg-green-500' : 'bg-amber-500/60'} style={{ height: 4, borderRadius: 999, width: catPct + '%' }} />
                    </div>
                    <span className={`text-xs ${catDone === catTotal && catTotal > 0 ? 'text-green-400' : ''}`}>
                      {catDone}/{catTotal}
                    </span>
                  </div>
                </div>
                <div className="space-y-0.5 mb-1">
                  {tasks
                    .slice()
                    .sort((a, b) => a.order_index - b.order_index)
                    .map((t) => (
                      <TaskRow
                        key={t.id}
                        task={t}
                        locked={isLocked}
                        busy={busyId === t.id}
                        onToggle={onToggle}
                        onConfirmLink={onConfirmLink}
                      />
                    ))}
                </div>
              </div>
            );
          })}
          <div className="h-3" />
        </div>
      )}
    </div>
  );
}

export default function Checklist() {
  const progress = useProgress();
  const complete = useCompleteTask();
  const [congrats, setCongrats] = useState<string | null>(null);

  const p = progress.data;
  const stages = p?.stages ?? [];
  const total = p?.total ?? 0;
  const completed = p?.completed ?? 0;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  async function doComplete(task: TaskItem, opts: { completed: boolean; link?: string }) {
    const wasStageDone = stages.find((s) => Object.values(s.categories).some((arr) => arr.some((t) => t.id === task.id)));
    try {
      await complete.mutateAsync({ taskId: task.id, completed: opts.completed, link: opts.link });
      // congrats heurístico: se a etapa ficou completa após concluir
      if (opts.completed && wasStageDone) {
        const remaining = Object.values(wasStageDone.categories)
          .flat()
          .filter((t) => t.interactive !== false && !t.completed && t.id !== task.id).length;
        if (remaining === 0) setCongrats(`Você concluiu a Etapa ${wasStageDone.stage_number}!`);
      }
    } catch (err) {
      window.alert(err instanceof SipApiError ? err.message : 'Não foi possível atualizar a tarefa.');
    }
  }

  function onToggle(task: TaskItem) {
    void doComplete(task, { completed: !task.completed });
  }
  function onConfirmLink(task: TaskItem) {
    void doComplete(task, { completed: true, link: task.link_label ?? 'confirmado' });
  }

  if (progress.isLoading) {
    return <div className="hb-card rounded-xl p-5">Carregando sua trilha…</div>;
  }

  return (
    <div>
      <header className="page-head">
        <h1>Checklist</h1>
        <p>Conclua as tarefas em ordem para avançar</p>
      </header>

      <div className="progress-row" style={{ marginBottom: 16 }}>
        <div className="progress-bar">
          <span style={{ width: pct + '%' }} />
        </div>
        <div className="progress-label">
          {completed} de {total} tarefas concluídas ({pct}%)
        </div>
      </div>

      <div className="space-y-4">
        {stages.map((s, idx) => (
          <StageCard
            key={s.id}
            stage={s}
            defaultOpen={idx === 0 && !s.completed}
            busyId={complete.isPending ? (complete.variables?.taskId ?? null) : null}
            onToggle={onToggle}
            onConfirmLink={onConfirmLink}
          />
        ))}
        {stages.length === 0 && <p className="text-sm" style={{ color: 'var(--text-mute)' }}>Nenhuma etapa disponível ainda.</p>}
      </div>

      {congrats && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="rounded-2xl p-8 max-w-sm w-full border border-amber-500/50 shadow-2xl text-center" style={{ background: 'var(--bg-card)' }}>
            <div className="text-5xl mb-4">🏆</div>
            <h2 className="text-2xl font-black text-amber-400 mb-2">PARABÉNS!</h2>
            <p className="font-semibold mb-1">{congrats}</p>
            <p className="text-sm mb-6">Continue assim! A próxima etapa foi desbloqueada.</p>
            <button onClick={() => setCongrats(null)} className="bg-amber-500 hover:bg-amber-400 text-black font-bold py-2.5 px-8 rounded-lg">
              Continuar 🚀
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
