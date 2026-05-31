import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { sipApi } from '../../../lib/api';

// Shape fiel à tabela legada sip.stages / sip.tasks: stage_number, order_index, category.
interface Stage { id: string; title: string; stage_number: number; description?: string | null; task_count?: number }
interface Task { id: string; stage_id: string; title: string; order_index: number; category?: string }

export default function Content() {
  const [ciclo, setCiclo] = useState<'aurum' | 'seminario'>('aurum');
  const { data: stages } = useQuery({
    queryKey: ['admin-stages', ciclo],
    queryFn: () => sipApi<Stage[]>(`/admin/stages?ciclo_type=${ciclo}`, { throwOnError: true }),
  });
  const { data: tasks } = useQuery({
    queryKey: ['admin-tasks', ciclo],
    queryFn: () => sipApi<Task[]>(`/admin/tasks?ciclo_type=${ciclo}`, { throwOnError: true }),
  });

  const tab = (id: 'aurum' | 'seminario', label: string, color: string) => (
    <button
      onClick={() => setCiclo(id)}
      style={{
        padding: '10px 22px', fontSize: 13, fontWeight: 700, border: 'none', background: 'transparent',
        cursor: 'pointer', borderBottom: `2px solid ${ciclo === id ? color : 'transparent'}`,
        marginBottom: -2, color: ciclo === id ? color : 'var(--text-mute)',
      }}
    >
      {label}
    </button>
  );

  const stageList = (stages ?? []).slice().sort((a, b) => a.stage_number - b.stage_number);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', margin: 0 }}>Conteúdo do programa</h2>
          <p style={{ fontSize: 13, color: 'var(--text-mute)', marginTop: 2 }}>Edite etapas, tarefas, tutoriais e textos motivacionais</p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid var(--border)', marginBottom: 24 }}>
        {tab('aurum', '🟠 Aurum', 'var(--brand)')}
        {tab('seminario', '💎 Diamante', 'var(--purple)')}
      </div>

      <div id="content-stages-list">
        {stageList.length === 0 ? (
          <div className="empty-state"><p style={{ color: 'var(--text-mute)', fontSize: 13 }}>Carregando etapas...</p></div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {stageList.map((st) => {
              const stTasks = (tasks ?? []).filter((t) => t.stage_id === st.id).sort((a, b) => a.order_index - b.order_index);
              return (
                <div key={st.id} className="hb-card" style={{ overflow: 'hidden' }}>
                  <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border-soft)', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-mute)', minWidth: 22 }}>{st.stage_number}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{st.title}</div>
                      {st.description && <div style={{ fontSize: 12, color: 'var(--text-mute)', marginTop: 1 }}>{st.description}</div>}
                    </div>
                    <span className="hb-badge">{stTasks.length} tarefa(s)</span>
                  </div>
                  <div style={{ padding: '6px 18px 12px' }}>
                    {stTasks.length === 0 ? (
                      <div style={{ fontSize: 12, color: 'var(--text-mute)', padding: '8px 0' }}>Nenhuma tarefa nesta etapa.</div>
                    ) : (
                      stTasks.map((t) => (
                        <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderBottom: '1px solid var(--border-soft)' }}>
                          <span style={{ fontSize: 11, color: 'var(--text-mute)', minWidth: 22 }}>{t.order_index + 1}</span>
                          <span style={{ flex: 1, fontSize: 13, color: 'var(--text)' }}>{t.title}</span>
                          {t.category && <span className="hb-chip">{t.category}</span>}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
