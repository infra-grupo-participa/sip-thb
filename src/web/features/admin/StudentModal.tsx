import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { sipApi, SipApiError } from '../../lib/api';
import { cicloLabel, fmtDateFull, initials, isSeminario } from './helpers';

interface FullStudent {
  id: string;
  name: string;
  email: string;
  ciclo_type: 'aurum' | 'seminario' | null;
  taskline?: string | null;
  is_platina?: boolean;
  phone?: string | null;
  city?: string | null;
  profissao?: string | null;
  turma_thb?: string | null;
  turma_aurum?: string | null;
  monitor_id?: string | null;
  created_at?: string | null;
  self_registered?: boolean;
  padrinho?: string | null;
  padrinho_contato?: string | null;
  data_palestra?: string | null;
  approval_status?: string;
  raiox_score?: number | null;
  raiox_max_score?: number | null;
  raiox_submitted_at?: string | null;
  is_socio?: boolean;
  interesse_ciclo?: string | null;
  nivel?: string | null;
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
interface ProofRow {
  id: string;
  task_title?: string | null;
  description?: string | null;
  link?: string | null;
  status?: string | null;
  submitted_at?: string | null;
  admin_note?: string | null;
}
interface FullResp {
  student: FullStudent;
  completed: number;
  total: number;
  checklist?: ChecklistTask[];
  stages?: StageNode[];
  posts?: Array<Record<string, unknown>>;
  traffic?: Array<Record<string, unknown>>;
  proofs?: ProofRow[];
  reports?: Array<Record<string, unknown>>;
  debriefing?: Record<string, unknown> | null;
  debriefings?: Array<Record<string, unknown>>;
  calendar?: CalendarPayload | null;
  // /full devolve os campos de planejamento em meta (jsonb por chave).
  meta?: Record<string, unknown> | null;
}

interface MonitorRow { id: string; name: string; is_admin?: boolean }

// ── Schedule (cronograma) ──────────────────────────────────────────────────
interface ScheduleMilestone {
  key: string;
  label: string;
  date: string;
  dow: number;
  offset?: number;
  phase_color?: string;
  is_anchor?: boolean;
}
interface ScheduleRow {
  user_id?: string;
  ciclo_type?: string;
  anchor_date?: string | null;
  milestones?: ScheduleMilestone[];
  overrides?: Record<string, string>;
  version?: number;
}
interface ScheduleRules {
  anchor_dow?: number | null;
  min_offset_today_days?: number | null;
  max_offset_today_days?: number | null;
}
interface ScheduleResp {
  schedule: ScheduleRow | null;
  ciclo_type?: string | null;
  approval_status?: string | null;
  rules?: ScheduleRules | null;
  duracao_dias?: number | null;
}
interface SchedulePreviewMilestone {
  key: string;
  label: string;
  date: string;
  dow: number;
  phase_color?: string;
  is_anchor?: boolean;
}
interface SchedulePreviewResp {
  anchor_date: string;
  ciclo_type: string;
  milestones: SchedulePreviewMilestone[];
  rules?: ScheduleRules | null;
  duracao_dias?: number | null;
  warning?: string;
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

const DOW_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const DOW_LONG = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const LIVE_SLOTS: Array<[string, string]> = [
  ['aq1', 'Live aquecimento 1'],
  ['aq2', 'Live aquecimento 2'],
  ['aq3', 'Live aquecimento 3'],
  ['pre', 'Pré-palestra'],
  ['palestra', 'Palestra'],
];

// Tradução do valor do select (público) → par {ciclo_type, is_platina} do banco.
function cicloApiPair(sel: string): { ciclo_type: 'aurum' | 'seminario'; is_platina: boolean } {
  if (sel === 'aurum') return { ciclo_type: 'aurum', is_platina: false };
  if (sel === 'platina') return { ciclo_type: 'seminario', is_platina: true };
  return { ciclo_type: 'seminario', is_platina: false };
}

function phasePalette(color?: string): string {
  switch (color) {
    case 'blue': return '#2563eb';
    case 'amber': return '#d97706';
    case 'orange': return '#ea580c';
    case 'green': return '#16a34a';
    case 'purple': return '#9333ea';
    default: return 'var(--text-mute)';
  }
}

function fmtBr(iso?: string | null): string {
  if (!iso) return '—';
  const parts = String(iso).split('-');
  return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : String(iso);
}

function metaStr(meta: Record<string, unknown> | null | undefined, key: string): string {
  const v = meta?.[key];
  return v == null ? '' : String(v);
}
function metaNum(meta: Record<string, unknown> | null | undefined, key: string): string {
  const v = meta?.[key];
  return v == null || v === '' ? '' : String(v);
}

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
  const meta = data?.meta ?? null;
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
                  <Row label="Turma Aurum" value={s.turma_aurum || '—'} />
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
                  <Row label="Padrinho" value={metaStr(meta, 'padrinho') || s.padrinho || '—'} />
                  <Row label="Data da palestra" value={fmtDateFull(metaStr(meta, 'data_palestra') || s.data_palestra || null)} />
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
          ) : tab === 'planejamento' ? (
            <div className="sm-pane">
              <PlanejamentoTab studentId={studentId} student={s} meta={meta} />
            </div>
          ) : tab === 'cronograma' ? (
            <div className="sm-pane">
              <CronogramaTab studentId={studentId} />
            </div>
          ) : tab === 'proofs' ? (
            <div className="sm-pane">
              <ProofsTab studentId={studentId} proofs={data?.proofs ?? []} />
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

// ─── Aba PLANEJAMENTO — editável ──────────────────────────────────────────────
// Fiel a modal-aluno-actions.js: select de ciclo + monitor + data, padrinho,
// metas (Aurum), pasta de acesso, links das 5 lives. Salva ciclo/monitor/meta
// em PATCH /assignment e, se houver ajustes de cronograma na prévia, persiste
// via PATCH /schedule. Dados pessoais editáveis em PATCH /admin/students/:id.
function PlanejamentoTab({
  studentId,
  student,
  meta,
}: {
  studentId: string;
  student: FullStudent;
  meta: Record<string, unknown> | null;
}) {
  const qc = useQueryClient();
  const { data: monitors } = useQuery({
    queryKey: ['admin-monitors'],
    queryFn: () => sipApi<MonitorRow[]>(`/admin/monitors`, { throwOnError: true }),
  });

  // Valor inicial do select de ciclo: platina é virtual (seminario + is_platina).
  const initialCiclo = student.is_platina ? 'platina' : (student.ciclo_type ?? '');
  const [ciclo, setCiclo] = useState<string>(initialCiclo);
  const [monitorId, setMonitorId] = useState<string>(student.monitor_id ?? '');
  const [dataPalestra, setDataPalestra] = useState<string>(metaStr(meta, 'data_palestra') || student.data_palestra || '');
  const [padrinho, setPadrinho] = useState<string>(metaStr(meta, 'padrinho') || student.padrinho || '');
  const [padrinhoContato, setPadrinhoContato] = useState<string>(metaStr(meta, 'padrinho_contato') || student.padrinho_contato || '');
  const [metaInvest, setMetaInvest] = useState<string>(metaNum(meta, 'investimento_previsto'));
  const [metaLeads, setMetaLeads] = useState<string>(metaNum(meta, 'meta_captacao_leads'));
  const [obs, setObs] = useState<string>(metaStr(meta, 'obs_planejamento'));
  const [pastaAcesso, setPastaAcesso] = useState<string>(metaStr(meta, 'pasta_acesso'));
  const [liveLinks, setLiveLinks] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const [slot] of LIVE_SLOTS) out[slot] = metaStr(meta, `live_link_${slot}`);
    return out;
  });

  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const isAurum = ciclo === 'aurum';
  const precisaData = !!ciclo;

  // ── Prévia de cronograma (debounce 300ms) ──────────────────────────────────
  const [preview, setPreview] = useState<SchedulePreviewResp | null>(null);
  const [previewState, setPreviewState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const previewKeyRef = useRef<string>('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!ciclo || !dataPalestra) {
      setPreview(null);
      setPreviewState('idle');
      previewKeyRef.current = '';
      return;
    }
    const key = `${ciclo}|${dataPalestra}`;
    if (key === previewKeyRef.current) return;
    previewKeyRef.current = key;
    setOverrides({});
    setPreview(null);
    setPreviewState('loading');
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      try {
        const { ciclo_type } = cicloApiPair(ciclo);
        const resp = await sipApi<SchedulePreviewResp>(`/admin/schedule-preview`, {
          method: 'POST',
          body: JSON.stringify({ ciclo_type, anchor_date: dataPalestra }),
          throwOnError: true,
        });
        if (previewKeyRef.current !== key) return;
        setPreview(resp ?? null);
        setPreviewState('idle');
      } catch {
        if (previewKeyRef.current !== key) return;
        setPreviewState('error');
      }
    }, 300);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [ciclo, dataPalestra]);

  const previewRows = useMemo(() => {
    const base = preview?.milestones ?? [];
    return base
      .map((m) => {
        const ov = overrides[m.key];
        if (ov) {
          const d = new Date(ov + 'T12:00:00');
          return { ...m, date: ov, dow: d.getDay(), overridden: true };
        }
        return { ...m, overridden: false };
      })
      .slice()
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }, [preview, overrides]);

  function setOverride(key: string, value: string) {
    setOverrides((prev) => {
      const next = { ...prev };
      if (value) next[key] = value;
      else delete next[key];
      return next;
    });
  }

  const assignmentMut = useMutation({
    mutationFn: async () => {
      const { ciclo_type, is_platina } = cicloApiPair(ciclo);
      const linksPayload: Record<string, string> = {};
      for (const [slot] of LIVE_SLOTS) linksPayload[slot] = (liveLinks[slot] ?? '').trim();
      const body = {
        ciclo_type,
        is_platina,
        monitor_id: monitorId,
        padrinho: padrinho.trim() || null,
        padrinho_contato: padrinhoContato.trim() || null,
        data_palestra: dataPalestra || null,
        investimento_previsto: metaInvest ? Number(metaInvest) : null,
        meta_captacao_leads: metaLeads ? Number(metaLeads) : null,
        obs_planejamento: obs.trim() || null,
        pasta_acesso: pastaAcesso.trim() || null,
        live_links: linksPayload,
      };
      await sipApi(`/admin/students/${studentId}/assignment`, {
        method: 'PATCH',
        body: JSON.stringify(body),
        throwOnError: true,
      });
      // Persiste ajustes manuais de datas (overrides) — degrada com aviso se falhar.
      if (Object.keys(overrides).length > 0 && dataPalestra) {
        await sipApi(`/admin/students/${studentId}/schedule`, {
          method: 'PATCH',
          body: JSON.stringify({ anchor_date: dataPalestra, overrides }),
          throwOnError: true,
        });
      }
    },
    onSuccess: () => {
      setMsg({ kind: 'ok', text: 'Planejamento salvo.' });
      qc.invalidateQueries({ queryKey: ['admin-student-full', studentId] });
      qc.invalidateQueries({ queryKey: ['admin-student-schedule', studentId] });
    },
    onError: (e) => {
      setMsg({ kind: 'err', text: e instanceof SipApiError ? e.message : 'Falha ao salvar.' });
    },
  });

  function handleSave() {
    setMsg(null);
    if (!ciclo || !monitorId) {
      setMsg({ kind: 'err', text: 'Selecione ciclo e monitor.' });
      return;
    }
    if (precisaData && !dataPalestra) {
      setMsg({ kind: 'err', text: isAurum ? 'Informe a data da palestra.' : 'Informe a data do Dia 01 do Seminário.' });
      return;
    }
    if (!isAurum && dataPalestra) {
      const d = new Date(dataPalestra + 'T12:00:00');
      if (d.getDay() !== 2) {
        setMsg({ kind: 'err', text: `O Seminário deve começar numa terça-feira. Você escolheu ${DOW_LONG[d.getDay()]}.` });
        return;
      }
    }
    assignmentMut.mutate();
  }

  const labelStyle: React.CSSProperties = { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-mute)', marginBottom: 4, display: 'block' };
  const inputStyle: React.CSSProperties = { width: '100%', padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text)', fontSize: 13 };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 760 }}>
      <DadosPessoaisEditor studentId={studentId} student={student} />

      <div style={{ borderTop: '1px solid var(--border-soft)', paddingTop: 14 }}>
        <h3 style={{ fontSize: 15, fontWeight: 800, marginBottom: 12 }}>Atribuição &amp; planejamento</h3>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={labelStyle}>Ciclo</label>
            <select value={ciclo} onChange={(e) => setCiclo(e.target.value)} style={inputStyle}>
              <option value="">— Selecionar —</option>
              <option value="aurum">Aurum</option>
              <option value="seminario">Diamante</option>
              <option value="platina">Platina</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>Monitor</label>
            <select value={monitorId} onChange={(e) => setMonitorId(e.target.value)} style={inputStyle}>
              <option value="">— Selecionar —</option>
              {(monitors ?? []).map((m) => (
                <option key={m.id} value={m.id}>{m.name}{m.is_admin ? ' (admin)' : ''}</option>
              ))}
            </select>
          </div>
        </div>

        {precisaData && (
          <div style={{ marginTop: 12 }}>
            <label style={labelStyle}>
              {isAurum ? 'Data da palestra' : 'Data do Dia 01 do Seminário (terça)'} <span style={{ color: 'var(--red,#ef4444)' }}>*</span>
            </label>
            <input type="date" value={dataPalestra} onChange={(e) => setDataPalestra(e.target.value)} style={{ ...inputStyle, width: 'auto' }} />
            <p style={{ fontSize: 11, color: 'var(--text-mute)', marginTop: 4 }}>
              {isAurum ? 'Recomendado: sexta ou sábado, mín. 21 dias a partir de hoje.' : 'Obrigatório: terça-feira, mín. 28 dias a partir de hoje.'}
            </p>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
          <div>
            <label style={labelStyle}>Padrinho</label>
            <input value={padrinho} onChange={(e) => setPadrinho(e.target.value)} maxLength={120} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Contato do padrinho</label>
            <input value={padrinhoContato} onChange={(e) => setPadrinhoContato(e.target.value)} maxLength={120} style={inputStyle} />
          </div>
        </div>

        {isAurum && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
            <div>
              <label style={labelStyle}>Investimento previsto (R$)</label>
              <input type="number" value={metaInvest} onChange={(e) => setMetaInvest(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Meta de captação de leads</label>
              <input type="number" value={metaLeads} onChange={(e) => setMetaLeads(e.target.value)} style={inputStyle} />
            </div>
          </div>
        )}

        <div style={{ marginTop: 12 }}>
          <label style={labelStyle}>Observações de planejamento</label>
          <textarea value={obs} onChange={(e) => setObs(e.target.value)} maxLength={500} rows={3} style={{ ...inputStyle, resize: 'vertical' }} />
        </div>

        <div style={{ marginTop: 12 }}>
          <label style={labelStyle}>Pasta de acesso (materiais)</label>
          <input value={pastaAcesso} onChange={(e) => setPastaAcesso(e.target.value)} maxLength={500} placeholder="https://…" style={inputStyle} />
        </div>

        <div style={{ marginTop: 12 }}>
          <label style={labelStyle}>Links das lives</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {LIVE_SLOTS.map(([slot, label]) => (
              <div key={slot} style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 10, alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: 'var(--text-sub)' }}>{label}</span>
                <input
                  value={liveLinks[slot] ?? ''}
                  onChange={(e) => setLiveLinks((prev) => ({ ...prev, [slot]: e.target.value }))}
                  placeholder="https://…"
                  style={inputStyle}
                />
              </div>
            ))}
          </div>
        </div>

        {/* Prévia do cronograma */}
        {precisaData && dataPalestra && (
          <div style={{ marginTop: 16, border: '1px solid var(--border)', borderRadius: 12, padding: '12px 14px' }}>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-mute)', fontWeight: 700, marginBottom: 8 }}>
              Prévia do cronograma
            </div>
            {previewState === 'loading' ? (
              <span style={{ color: 'var(--text-mute)', fontSize: 13 }}>Calculando…</span>
            ) : previewState === 'error' ? (
              <span style={{ color: 'var(--red,#ef4444)', fontSize: 13 }}>Falha ao calcular.</span>
            ) : previewRows.length === 0 ? (
              <span style={{ color: 'var(--text-mute)', fontSize: 13 }}>Nenhum marco no template.</span>
            ) : (
              <>
                {preview?.warning && (
                  <div style={{ fontSize: 12, color: 'var(--yellow)', marginBottom: 8 }}>⚠ {preview.warning}</div>
                )}
                <p style={{ fontSize: 11, color: 'var(--text-mute)', marginBottom: 10 }}>
                  Estas datas são uma <strong>sugestão</strong> calculada a partir do evento. Ajuste o que precisar — o aluno verá exatamente as datas que você definir.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {previewRows.map((m) => (
                    <div key={m.key} style={{ display: 'grid', gridTemplateColumns: '10px 1fr 130px 36px', gap: 10, alignItems: 'center', fontSize: 12 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: phasePalette(m.phase_color) }} />
                      <span style={{ color: 'var(--text)' }}>
                        {m.label}
                        {m.overridden ? <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--brand)' }}>ajustado</span> : m.is_anchor ? <span style={{ marginLeft: 6 }}>★</span> : null}
                      </span>
                      {m.is_anchor ? (
                        <span style={{ fontSize: 11, color: 'var(--text-sub)' }}>{fmtBr(m.date)} <span style={{ fontSize: 10 }}>(evento)</span></span>
                      ) : (
                        <input
                          type="date"
                          value={m.date}
                          onChange={(e) => setOverride(m.key, e.target.value)}
                          style={{ ...inputStyle, fontSize: 11, padding: '3px 6px', ...(m.overridden ? { borderColor: 'var(--brand)' } : {}) }}
                        />
                      )}
                      <span style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--text-mute)', textAlign: 'center' }}>{DOW_SHORT[m.dow] ?? ''}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {msg && (
          <div style={{ marginTop: 12, fontSize: 13, color: msg.kind === 'ok' ? 'var(--green)' : 'var(--red,#ef4444)' }}>{msg.text}</div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
          <button
            className="hb-btn hb-btn-primary"
            onClick={handleSave}
            disabled={assignmentMut.isPending}
            style={assignmentMut.isPending ? { opacity: 0.7 } : undefined}
          >
            {assignmentMut.isPending ? 'Salvando…' : 'Salvar planejamento'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Editor de dados pessoais — PATCH /admin/students/:id ──────────────────────
function DadosPessoaisEditor({ studentId, student }: { studentId: string; student: FullStudent }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(student.name ?? '');
  const [email, setEmail] = useState(student.email ?? '');
  const [phone, setPhone] = useState(student.phone ?? '');
  const [city, setCity] = useState(student.city ?? '');
  const [profissao, setProfissao] = useState(student.profissao ?? '');
  const [turmaThb, setTurmaThb] = useState(student.turma_thb ?? '');
  const [turmaAurum, setTurmaAurum] = useState(student.turma_aurum ?? '');
  const [isPlatina, setIsPlatina] = useState(!!student.is_platina);
  const [interesse, setInteresse] = useState(student.interesse_ciclo ?? '');
  const [nivel, setNivel] = useState(student.nivel ?? '');
  const [err, setErr] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: async () => {
      const body = {
        name: name.trim(),
        email: email.trim().toLowerCase(),
        phone: phone.trim(),
        city: city.trim(),
        profissao: profissao.trim(),
        turma_aurum: turmaAurum.trim(),
        is_platina: isPlatina,
        turma_thb: turmaThb.trim(),
        interesse_ciclo: interesse.trim() || null,
        nivel: nivel.trim() || null,
      };
      await sipApi(`/admin/students/${studentId}`, { method: 'PATCH', body: JSON.stringify(body), throwOnError: true });
    },
    onSuccess: () => {
      setOpen(false);
      qc.invalidateQueries({ queryKey: ['admin-student-full', studentId] });
    },
    onError: (e) => setErr(e instanceof SipApiError ? e.message : 'Falha ao salvar.'),
  });

  const labelStyle: React.CSSProperties = { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-mute)', marginBottom: 4, display: 'block' };
  const inputStyle: React.CSSProperties = { width: '100%', padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text)', fontSize: 13 };

  if (!open) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h3 style={{ fontSize: 15, fontWeight: 800 }}>Dados do aluno</h3>
        <button className="hb-btn hb-btn-secondary hb-btn-sm" onClick={() => { setErr(null); setOpen(true); }}>Editar dados</button>
      </div>
    );
  }

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h3 style={{ fontSize: 15, fontWeight: 800 }}>Editar dados do aluno</h3>
        <button className="hb-btn hb-btn-secondary hb-btn-sm" onClick={() => setOpen(false)}>Fechar</button>
      </div>
      {err && <div style={{ marginBottom: 10, fontSize: 13, color: 'var(--red,#ef4444)' }}>{err}</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <label style={labelStyle}>Nome completo</label>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>E-mail</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={120} style={inputStyle} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <label style={labelStyle}>Telefone</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={16} placeholder="(11) 99999-9999" style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Cidade / UF</label>
            <input value={city} onChange={(e) => setCity(e.target.value)} maxLength={80} placeholder="São Paulo / SP" style={inputStyle} />
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px 120px', gap: 10 }}>
          <div>
            <label style={labelStyle}>Profissão</label>
            <input value={profissao} onChange={(e) => setProfissao(e.target.value)} maxLength={80} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Turma THB</label>
            <select value={turmaThb} onChange={(e) => setTurmaThb(e.target.value)} style={inputStyle}>
              <option value="">—</option>
              {Array.from({ length: 38 }, (_, i) => `T${i + 1}`).map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Turma Aurum</label>
            <select value={turmaAurum} onChange={(e) => setTurmaAurum(e.target.value)} style={inputStyle}>
              <option value="">—</option>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => (
                <option key={i} value={`A${i}`}>{`A${i}`}</option>
              ))}
            </select>
          </div>
        </div>
        {isSeminario(student) && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
            <input type="checkbox" checked={isPlatina} onChange={(e) => setIsPlatina(e.target.checked)} style={{ width: 16, height: 16 }} />
            É Platina?
          </label>
        )}
        <div>
          <label style={labelStyle}>Modelo de interesse declarado</label>
          <select value={interesse} onChange={(e) => setInteresse(e.target.value)} style={inputStyle}>
            <option value="">— Não informado —</option>
            <option value="palestra">Palestra (Aurum)</option>
            <option value="seminario">Seminário (Diamante)</option>
          </select>
        </div>
        <div>
          <label style={labelStyle}>Nível</label>
          <select value={nivel} onChange={(e) => setNivel(e.target.value)} style={inputStyle}>
            <option value="">— Não definido —</option>
            <option value="Ouro">Ouro</option>
            <option value="Platina">Platina</option>
            <option value="Diamante">Diamante</option>
            <option value="Diamante Vermelho">Diamante Vermelho</option>
          </select>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="hb-btn hb-btn-secondary" onClick={() => setOpen(false)}>Cancelar</button>
          <button className="hb-btn hb-btn-primary" onClick={() => { setErr(null); mut.mutate(); }} disabled={mut.isPending}>
            {mut.isPending ? 'Salvando…' : 'Salvar alterações'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Aba CRONOGRAMA — editável ────────────────────────────────────────────────
// GET /admin/students/:id/schedule → anchor + milestones materializadas.
// PATCH idem → muda anchor e/ou overrides individuais. Fiel a modal-aluno-tabs.js.
function CronogramaTab({ studentId }: { studentId: string }) {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin-student-schedule', studentId],
    queryFn: () => sipApi<ScheduleResp>(`/admin/students/${studentId}/schedule`, { throwOnError: true }),
  });

  const [draftAnchor, setDraftAnchor] = useState<string>('');
  const [draftOverrides, setDraftOverrides] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const hydratedRef = useRef<string>('');

  useEffect(() => {
    if (!data) return;
    const ver = String(data.schedule?.version ?? 'none');
    if (hydratedRef.current === ver) return;
    hydratedRef.current = ver;
    setDraftAnchor(data.schedule?.anchor_date ?? '');
    setDraftOverrides({ ...(data.schedule?.overrides ?? {}) });
    setMsg(null);
  }, [data]);

  const mut = useMutation({
    mutationFn: async () => {
      await sipApi(`/admin/students/${studentId}/schedule`, {
        method: 'PATCH',
        body: JSON.stringify({ anchor_date: draftAnchor, overrides: draftOverrides }),
        throwOnError: true,
      });
    },
    onSuccess: () => {
      setMsg({ kind: 'ok', text: 'Cronograma atualizado.' });
      hydratedRef.current = '';
      qc.invalidateQueries({ queryKey: ['admin-student-schedule', studentId] });
      qc.invalidateQueries({ queryKey: ['admin-student-full', studentId] });
    },
    onError: (e) => setMsg({ kind: 'err', text: e instanceof SipApiError ? e.message : 'Falha ao salvar.' }),
  });

  if (isLoading) return <Placeholder text="Carregando cronograma…" />;
  if (isError || !data) return <Placeholder text="Falha ao carregar o cronograma." />;

  const cicloType = data.ciclo_type;
  if (!cicloType) {
    return <Placeholder text='Aluno sem ciclo definido. Defina o ciclo na aba "Planejamento" primeiro.' />;
  }

  const isAurum = cicloType === 'aurum';
  const evtLabel = isAurum ? 'palestra' : 'Dia 01 do Seminário';
  const rules = data.rules;
  const hintParts: string[] = [];
  if (rules?.anchor_dow != null) hintParts.push(`dia da semana: ${DOW_LONG[rules.anchor_dow] ?? ''}`);
  if (rules?.min_offset_today_days != null) hintParts.push(`mín. ${rules.min_offset_today_days}d`);
  if (rules?.max_offset_today_days != null) hintParts.push(`máx. ${rules.max_offset_today_days}d`);
  const hint = hintParts.join(' · ');

  const milestones = [...(data.schedule?.milestones ?? [])].sort((a, b) => (a.offset ?? 0) - (b.offset ?? 0));

  const hasDraftChange = data.schedule
    ? draftAnchor !== (data.schedule.anchor_date ?? '') ||
      JSON.stringify(draftOverrides) !== JSON.stringify(data.schedule.overrides ?? {})
    : !!draftAnchor;

  const inputStyle: React.CSSProperties = { padding: '5px 8px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text)', fontSize: 12 };

  function setOverride(key: string, value: string) {
    setDraftOverrides((prev) => {
      const next = { ...prev };
      if (value) next[key] = value;
      else delete next[key];
      return next;
    });
  }

  function handleSave() {
    setMsg(null);
    if (!draftAnchor) { setMsg({ kind: 'err', text: 'Informe a data do evento.' }); return; }
    const d = new Date(draftAnchor + 'T12:00:00');
    if (Number.isNaN(d.getTime())) { setMsg({ kind: 'err', text: 'Data inválida.' }); return; }
    if (rules?.anchor_dow != null && d.getDay() !== rules.anchor_dow) {
      setMsg({ kind: 'err', text: `A data-âncora deve cair em ${DOW_LONG[rules.anchor_dow] ?? ''}. Você escolheu ${DOW_LONG[d.getDay()]}.` });
      return;
    }
    mut.mutate();
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 720 }}>
      <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px', background: 'var(--bg-muted)' }}>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-mute)', fontWeight: 700, marginBottom: 8 }}>
          Data-âncora ({evtLabel})
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="date" value={draftAnchor} onChange={(e) => setDraftAnchor(e.target.value)} style={{ ...inputStyle, width: 'auto' }} />
          <span style={{ color: 'var(--text-mute)', fontSize: 12 }}>{draftAnchor ? fmtBr(draftAnchor) : ''}</span>
          {hint && <span style={{ color: 'var(--text-mute)', fontSize: 11, marginLeft: 'auto' }}>{hint}</span>}
        </div>
      </div>

      <div style={{ border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '14px 1fr 130px 32px 28px', gap: 10, padding: '8px 6px', background: 'var(--bg-card)', borderBottom: '1px solid var(--border)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-mute)', fontWeight: 700 }}>
          <span />
          <span>Marco</span>
          <span style={{ textAlign: 'center' }}>Data</span>
          <span style={{ textAlign: 'center' }}>Dia</span>
          <span />
        </div>
        {milestones.length === 0 ? (
          <p style={{ color: 'var(--text-mute)', textAlign: 'center', padding: 24, fontSize: 13 }}>
            Defina a data do evento acima e clique em "Salvar" pra gerar o cronograma.
          </p>
        ) : (
          milestones.map((m) => {
            const overrideVal = draftOverrides[m.key] ?? '';
            const overridden = !!overrideVal;
            const dow = overrideVal ? new Date(overrideVal + 'T12:00:00').getDay() : m.dow;
            return (
              <div key={m.key} style={{ display: 'grid', gridTemplateColumns: '14px 1fr 130px 32px 28px', gap: 10, alignItems: 'center', padding: '8px 6px', borderBottom: '1px solid var(--border-soft)', fontWeight: m.is_anchor ? 700 : 400 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: phasePalette(m.phase_color) }} />
                <span style={{ color: 'var(--text)', fontSize: 12 }}>{m.label}{m.is_anchor ? ' ★' : ''}</span>
                <input
                  type="date"
                  value={overrideVal || m.date}
                  onChange={(e) => setOverride(m.key, e.target.value)}
                  disabled={m.is_anchor}
                  title={m.is_anchor ? 'Use o campo de data-âncora acima para mover este marco' : undefined}
                  style={{ ...inputStyle, fontSize: 11, padding: '3px 6px', ...(overridden ? { borderColor: 'var(--brand)' } : {}) }}
                />
                <span style={{ color: 'var(--text-mute)', textTransform: 'uppercase', fontSize: 10, textAlign: 'center' }}>{DOW_SHORT[dow] ?? ''}</span>
                {overridden && !m.is_anchor ? (
                  <button onClick={() => setOverride(m.key, '')} title="Restaurar padrão" style={{ background: 'none', border: 'none', color: 'var(--text-mute)', cursor: 'pointer', fontSize: 14, padding: 0 }}>↻</button>
                ) : (
                  <span />
                )}
              </div>
            );
          })
        )}
      </div>

      {msg && <div style={{ fontSize: 13, color: msg.kind === 'ok' ? 'var(--green)' : 'var(--red,#ef4444)' }}>{msg.text}</div>}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        <button
          onClick={() => setDraftOverrides({})}
          disabled={Object.keys(draftOverrides).length === 0}
          style={{ background: 'none', border: 'none', color: 'var(--text-mute)', fontSize: 12, fontWeight: 600, cursor: Object.keys(draftOverrides).length === 0 ? 'not-allowed' : 'pointer', textDecoration: 'underline', opacity: Object.keys(draftOverrides).length === 0 ? 0.4 : 1 }}
        >
          Restaurar todos os padrões
        </button>
        <button className="hb-btn hb-btn-primary hb-btn-sm" onClick={handleSave} disabled={!hasDraftChange || mut.isPending} style={!hasDraftChange || mut.isPending ? { opacity: 0.5 } : undefined}>
          {mut.isPending ? 'Salvando…' : hasDraftChange ? 'Salvar cronograma' : 'Sem alterações'}
        </button>
      </div>
    </div>
  );
}

// ─── Aba COMPROVAÇÕES — aprovar/reprovar ───────────────────────────────────────
// PUT /admin/students/:id/proofs/:proofId com { status: 'aprovado' | 'reprovado' }.
function ProofsTab({ studentId, proofs }: { studentId: string; proofs: ProofRow[] }) {
  const qc = useQueryClient();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: async ({ proofId, status }: { proofId: string; status: 'aprovado' | 'reprovado' }) => {
      await sipApi(`/admin/students/${studentId}/proofs/${proofId}`, {
        method: 'PUT',
        body: JSON.stringify({ status }),
        throwOnError: true,
      });
    },
    onMutate: ({ proofId }) => { setPendingId(proofId); setErr(null); },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-student-full', studentId] });
    },
    onError: (e) => setErr(e instanceof SipApiError ? e.message : 'Falha ao revisar comprovação.'),
    onSettled: () => setPendingId(null),
  });

  if (proofs.length === 0) {
    return <Placeholder text="Nenhuma comprovação enviada ainda." />;
  }

  const statusLabel: Record<string, string> = { pendente: 'Pendente', aprovado: 'Aprovado', reprovado: 'Reprovado' };
  const statusColor: Record<string, string> = { pendente: 'var(--brand)', aprovado: 'var(--green)', reprovado: 'var(--red,#ef4444)' };
  const fmtDt = (d?: string | null) => (d ? new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '4px 0' }}>
      {err && <div style={{ fontSize: 13, color: 'var(--red,#ef4444)' }}>{err}</div>}
      {proofs.map((p) => {
        const st = p.status ?? '';
        return (
          <div key={p.id} style={{ border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', background: 'var(--bg-card)' }}>
            <div style={{ padding: '12px 14px', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{p.task_title || 'Tarefa'}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: `${statusColor[st] ?? 'var(--text-mute)'}22`, color: statusColor[st] ?? 'var(--text-mute)' }}>
                    {statusLabel[st] ?? st}
                  </span>
                </div>
                {p.description && <p style={{ fontSize: 12, color: 'var(--text-sub)', margin: '0 0 6px' }}>{p.description}</p>}
                {p.link && (
                  <a href={p.link} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: 'var(--brand)' }}>
                    Abrir link
                  </a>
                )}
                <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 6 }}>Enviado em {fmtDt(p.submitted_at)}</div>
                {p.admin_note && (
                  <div style={{ marginTop: 6, padding: '8px 10px', background: 'var(--bg-muted)', borderRadius: 8, fontSize: 12, color: 'var(--text-sub)' }}>
                    <strong>Nota:</strong> {p.admin_note}
                  </div>
                )}
              </div>
              {st === 'pendente' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
                  <button
                    onClick={() => mut.mutate({ proofId: p.id, status: 'aprovado' })}
                    disabled={pendingId === p.id}
                    style={{ padding: '5px 12px', borderRadius: 8, background: 'rgba(34,197,94,.15)', color: 'var(--green)', border: '1px solid rgba(34,197,94,.3)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                  >
                    ✓ Aprovar
                  </button>
                  <button
                    onClick={() => mut.mutate({ proofId: p.id, status: 'reprovado' })}
                    disabled={pendingId === p.id}
                    style={{ padding: '5px 12px', borderRadius: 8, background: 'rgba(239,68,68,.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,.25)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                  >
                    ✗ Reprovar
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Sub-abas restantes (read-only): posts, traffic, debriefing, calendar, chamados,
// instagram. Consomem dados embutidos em /full (contrato legado).
function ModalTabContent({ tab, studentId, full }: { tab: ModalTab; studentId: string; full?: FullResp }) {
  void studentId;
  if (tab === 'instagram') {
    return <Placeholder text="Métricas do Instagram — Em breve." />;
  }

  const LABELS: Record<string, string> = {
    posts: 'Postagens do aluno',
    traffic: 'Tráfego do aluno',
    superdebriefing: 'Debriefing',
    calendar: 'Calendário',
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

  // Calendário: milestones do payload calendar.
  if (tab === 'calendar') {
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
    tab === 'posts' ? full?.posts
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
