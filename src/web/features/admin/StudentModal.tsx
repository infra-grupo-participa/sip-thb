import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { sipApi } from '../../lib/api';
import { cicloLabel, fmtDateFull, initials, isSeminario } from './helpers';

interface FullStudent {
  id: string;
  name: string;
  email: string;
  ciclo_type: 'aurum' | 'seminario' | null;
  is_platina?: boolean;
  phone?: string | null;
  city?: string | null;
  profissao?: string | null;
  turma_thb?: string | null;
  created_at?: string | null;
  self_registered?: boolean;
  padrinho?: string | null;
  padrinho_contato?: string | null;
  data_palestra?: string | null;
  approval_status?: string;
  raiox_score?: number | null;
  raiox_max_score?: number | null;
  interesse_ciclo?: string | null;
  onboarding_perfil?: Record<string, string> | null;
  monitor_name?: string | null;
}
interface ChecklistTask { id: string; title: string; stage_title?: string; completed: boolean }
interface StageNode {
  id?: string;
  title?: string;
  tasks?: ChecklistTask[];
  categories?: Record<string, Array<{ id: string; title: string; completed?: boolean }>>;
}
interface CalendarMilestone { key?: string; label?: string; date?: string | null }
interface CalendarPayload { anchor_date?: string | null; milestones?: CalendarMilestone[] }
interface FullResp {
  student: FullStudent;
  completed: number;
  total: number;
  checklist?: ChecklistTask[];
  stages?: StageNode[];
  posts?: Array<Record<string, unknown>>;
  traffic?: Array<Record<string, unknown>>;
  proofs?: Array<Record<string, unknown>>;
  reports?: Array<Record<string, unknown>>;
  debriefing?: Record<string, unknown> | null;
  debriefings?: Array<Record<string, unknown>>;
  calendar?: CalendarPayload | null;
}

type ModalTab =
  | 'pessoais' | 'planejamento' | 'checklist' | 'proofs' | 'posts'
  | 'instagram' | 'traffic' | 'superdebriefing' | 'calendar' | 'cronograma' | 'chamados';

const TABS: Array<[ModalTab, string]> = [
  ['pessoais', 'Dados pessoais'],
  ['planejamento', 'Planejamento'],
  ['checklist', 'Checklist'],
  ['proofs', 'Comprovações'],
  ['posts', 'Postagens'],
  ['instagram', 'Instagram'],
  ['traffic', 'Tráfego'],
  ['superdebriefing', 'Debriefing'],
  ['calendar', 'Calendário'],
  ['cronograma', 'Cronograma'],
  ['chamados', 'Chamados'],
];

const PERFIL_KEYS: Array<[string, string]> = [
  ['tempo_carreira', 'Tempo de carreira'],
  ['faturamento_atual', 'Faturamento atual'],
  ['nivel_lancamentos', 'Nível em lançamentos'],
  ['maior_dificuldade', 'Maior dificuldade hoje'],
  ['motivacao', 'Motivação para entrar'],
  ['pitch', 'Pitch / como se apresenta'],
  ['palestra_tema', 'Tema da palestra'],
  ['palestra_publico', 'Público-alvo'],
  ['palestra_transformacao', 'Transformação prometida'],
  ['palestra_oferta', 'Oferta principal'],
  ['palestra_preco', 'Preço'],
  ['palestra_case', 'Case / prova social'],
  ['palestra_observacao', 'Observações'],
];

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="sm-row">
      <span className="sm-row-label">{label}</span>
      <span className="sm-row-value">{value}</span>
    </div>
  );
}

function Placeholder({ text }: { text: string }) {
  return <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-mute)', fontSize: 13 }}>{text}</div>;
}

export default function StudentModal({ studentId, onClose }: { studentId: string; onClose: () => void }) {
  const [tab, setTab] = useState<ModalTab>('pessoais');
  const { data, isLoading } = useQuery({
    queryKey: ['admin-student-full', studentId],
    queryFn: () => sipApi<FullResp>(`/admin/students/${studentId}/full`, { throwOnError: true }),
  });

  const s = data?.student;
  const completed = data?.completed ?? 0;
  const total = data?.total ?? 0;
  // Checklist: usa data.checklist se presente; senão deriva de stages[].categories (shape de /full).
  const checklist: ChecklistTask[] =
    data?.checklist && data.checklist.length > 0
      ? data.checklist
      : (data?.stages ?? []).flatMap((st) =>
          Object.values(st.categories ?? {}).flat().map((t) => ({
            id: t.id,
            title: t.title,
            stage_title: st.title,
            completed: t.completed === true,
          })),
        );
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const approvalText =
    s?.approval_status === 'pending' ? 'Pendente' : s?.approval_status === 'rejected' ? 'Rejeitado' : 'Aprovado';
  const raioxFmt =
    s?.raiox_score != null && s?.raiox_max_score
      ? `${Math.round((s.raiox_score / s.raiox_max_score) * 100)}% (${s.raiox_score}/${s.raiox_max_score} pts)`
      : '—';
  const interesseFmt =
    s?.interesse_ciclo === 'palestra' ? 'Palestra (Aurum)' : s?.interesse_ciclo === 'seminario' ? 'Seminário (Diamante)' : '—';
  const perfil = s?.onboarding_perfil ?? {};
  const perfilFilled = PERFIL_KEYS.filter(([k]) => perfil[k] && String(perfil[k]).trim());

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-shell modal-lg sm-shell" style={{ maxWidth: 'min(1280px, 98vw)' }} onClick={(e) => e.stopPropagation()}>
        <div className="sm-head">
          <div className="sm-avatar">{initials(s?.name)}</div>
          <div className="sm-head-main">
            <div className="sm-head-title">
              <h2>{s?.name ?? '—'}</h2>
              <span className="chip chip-sm">{cicloLabel(s?.ciclo_type, s?.is_platina)}</span>
            </div>
            <p className="sm-head-info">
              <span>{s ? `${s.email} · ${completed}/${total} tarefas` : '—'}</span>
            </p>
          </div>
          <div className="sm-head-actions">
            <button onClick={onClose} className="modal-close" aria-label="Fechar" style={{ fontSize: 24, padding: '4px 8px' }}>
              ×
            </button>
          </div>
        </div>

        <div className="sm-kpis">
          <div className="sm-kpi">
            <div className="sm-kpi-body">
              <div className="sm-kpi-label">Aprovação</div>
              <div className="sm-kpi-value">{approvalText}</div>
            </div>
          </div>
          <div className="sm-kpi">
            <div className="sm-kpi-body">
              <div className="sm-kpi-label">Ciclo Atual</div>
              <div className="sm-kpi-value">{cicloLabel(s?.ciclo_type, s?.is_platina)}</div>
            </div>
          </div>
          <div className="sm-kpi">
            <div className="sm-kpi-body">
              <div className="sm-kpi-label">Raio-X</div>
              <div className="sm-kpi-value">{raioxFmt}</div>
            </div>
          </div>
          <div className="sm-kpi">
            <div className="sm-kpi-body">
              <div className="sm-kpi-label">Progresso</div>
              <div className="sm-kpi-value">{pct}% concluído</div>
            </div>
          </div>
        </div>

        <div className="modal-tabs">
          {TABS.map(([id, label]) => (
            <button key={id} className={`modal-tab ${tab === id ? 'is-active' : ''}`} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>

        <div className="modal-body">
          {isLoading || !s ? (
            <Placeholder text="Carregando…" />
          ) : tab === 'pessoais' ? (
            <div className="sm-overview">
              <div className="sm-card">
                <div className="sm-card-head is-orange">Identidade &amp; contato</div>
                <div className="sm-card-body">
                  <Row label="Nome" value={s.name || '—'} />
                  <Row label="E-mail" value={s.email || '—'} />
                  <Row label="Telefone" value={s.phone || '—'} />
                  <Row label="Cidade" value={s.city || '—'} />
                  <Row label="Profissão" value={s.profissao || '—'} />
                  <Row label="Turma THB" value={s.turma_thb || '—'} />
                  {isSeminario(s) && <Row label="Platina" value={s.is_platina ? 'Sim' : 'Não'} />}
                  <Row label="Cadastro" value={fmtDateFull(s.created_at)} />
                  <Row label="Origem" value={s.self_registered ? 'Auto-cadastrado' : 'Pelo admin'} />
                </div>
              </div>
              <div className="sm-card">
                <div className="sm-card-head is-blue">Programa &amp; ciclo</div>
                <div className="sm-card-body">
                  <Row label="Ciclo" value={cicloLabel(s.ciclo_type, s.is_platina)} />
                  <Row label="Monitor" value={s.monitor_name || '—'} />
                  <Row label="Padrinho" value={s.padrinho || '—'} />
                  <Row label="Data da palestra" value={fmtDateFull(s.data_palestra)} />
                  <Row label="Aprovação" value={approvalText} />
                  <Row label="Raio-X" value={raioxFmt} />
                  <Row label="Interesse" value={interesseFmt} />
                </div>
              </div>
              <div className="sm-card">
                <div className="sm-card-head is-purple">Sobre o aluno (onboarding)</div>
                <div className="sm-card-body">
                  {perfilFilled.length === 0 ? (
                    <p style={{ fontSize: 12, color: 'var(--text-mute)', fontStyle: 'italic', padding: '4px 0' }}>
                      Aluno ainda não preencheu o onboarding.
                    </p>
                  ) : (
                    perfilFilled.map(([k, label]) => (
                      <div className="sm-row-stack" key={k}>
                        <div className="sm-row-stack-label">{label}</div>
                        <div className="sm-row-stack-value">{String(perfil[k])}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          ) : tab === 'checklist' ? (
            <div className="sm-pane">
              {checklist.length === 0 ? (
                <Placeholder text="Sem tarefas no checklist." />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {checklist.map((t) => (
                    <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderBottom: '1px solid var(--border-soft)' }}>
                      <span style={{ width: 18, height: 18, borderRadius: '50%', flexShrink: 0, background: t.completed ? 'var(--green)' : 'var(--border)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 11 }}>
                        {t.completed ? '✓' : ''}
                      </span>
                      <span style={{ flex: 1, fontSize: 13, color: 'var(--text)' }}>{t.title}</span>
                      {t.stage_title && <span className="hb-chip">{t.stage_title}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="sm-pane">
              <ModalTabContent tab={tab} studentId={studentId} full={data} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Sub-abas: o backend /admin/students/:id/full já devolve posts, traffic, proofs,
// reports, debriefing(s) e calendar embutidos — consumimos dali (contrato legado:
// o modal-aluno legado também carrega tudo de /full) em vez de chamar endpoints
// inexistentes. Instagram fica tolerante ("Em breve") até o ig.ts ser portado.
function ModalTabContent({ tab, studentId, full }: { tab: ModalTab; studentId: string; full?: FullResp }) {
  void studentId;
  if (tab === 'planejamento') {
    return (
      <Placeholder text="Edite ciclo, monitor, data da palestra e materiais — disponível quando o endpoint de planejamento for portado." />
    );
  }
  if (tab === 'instagram') {
    return <Placeholder text="Métricas do Instagram — Em breve." />;
  }

  const LABELS: Record<string, string> = {
    proofs: 'Comprovações',
    posts: 'Postagens do aluno',
    traffic: 'Tráfego do aluno',
    superdebriefing: 'Debriefing',
    calendar: 'Calendário',
    cronograma: 'Cronograma',
    chamados: 'Chamados do aluno',
  };

  // Debriefing: objeto único, não lista.
  if (tab === 'superdebriefing') {
    const d = full?.debriefing;
    if (!d) return <Placeholder text="Debriefing: sem dados disponíveis." />;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {Object.entries(d)
          .filter(([, v]) => v != null && String(v).trim() !== '')
          .map(([k, v]) => (
            <div key={k} className="sm-row-stack">
              <div className="sm-row-stack-label">{k}</div>
              <div className="sm-row-stack-value">{String(v)}</div>
            </div>
          ))}
      </div>
    );
  }

  // Calendário e Cronograma: milestones do payload calendar.
  if (tab === 'calendar' || tab === 'cronograma') {
    const cal = full?.calendar;
    const ms = cal?.milestones ?? [];
    if (!cal || ms.length === 0) {
      return <Placeholder text={`${LABELS[tab]}: cronograma ainda não definido.`} />;
    }
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {ms.map((m, i) => (
          <div key={m.key ?? i} className="hb-card" style={{ padding: '10px 12px', display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
            <span style={{ color: 'var(--text-sub)' }}>{m.label ?? m.key}</span>
            <span style={{ color: 'var(--text)', fontWeight: 600 }}>{fmtDateFull(m.date ?? null)}</span>
          </div>
        ))}
      </div>
    );
  }

  const arr: Array<Record<string, unknown>> | undefined =
    tab === 'proofs' ? full?.proofs
    : tab === 'posts' ? full?.posts
    : tab === 'traffic' ? full?.traffic
    : tab === 'chamados' ? full?.reports
    : undefined;

  if (!arr || arr.length === 0) {
    return <Placeholder text={`${LABELS[tab] ?? '—'}: sem dados disponíveis.`} />;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {arr.map((it, i) => (
        <div key={(it.id as string) ?? i} className="hb-card" style={{ padding: '10px 12px', fontSize: 13, color: 'var(--text-sub)' }}>
          {String(
            (it as { title?: string }).title ??
              (it as { name?: string }).name ??
              (it as { subject?: string }).subject ??
              (it as { message?: string }).message ??
              (it as { date?: string }).date ??
              JSON.stringify(it).slice(0, 120),
          )}
        </div>
      ))}
    </div>
  );
}
