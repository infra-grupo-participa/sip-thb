import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { sipApi, SipApiError } from '../../lib/api';
import {
  type StudentFull,
  type MonitorStudent,
  type ChecklistStage,
  isAurum,
  isSeminario,
  cicloLabel,
} from './types';

type ModalTab = 'perfil' | 'checklist' | 'posts' | 'traffic' | 'superdebriefing';

const TABS: { key: ModalTab; label: string }[] = [
  { key: 'perfil', label: 'Perfil' },
  { key: 'checklist', label: 'Checklist' },
  { key: 'posts', label: 'Postagens' },
  { key: 'traffic', label: 'Tráfego' },
  { key: 'superdebriefing', label: 'Debriefing' },
];

function fmtNum(v: number | null | undefined, dec = 2): string {
  return v != null ? Number(v).toFixed(dec) : '—';
}

function brDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR');
}

interface Props {
  student: MonitorStudent;
  onClose: () => void;
}

export default function StudentModal({ student, onClose }: Props) {
  const [tab, setTab] = useState<ModalTab>('checklist');
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['monitor', 'student-full', student.id],
    queryFn: () =>
      sipApi<StudentFull>(`/monitor/students/${student.id}/full`, {
        throwOnError: true,
      }),
  });

  const approveDate = useMutation({
    mutationFn: () =>
      sipApi(`/admin/students/${student.id}/approve-date`, {
        method: 'PUT',
        body: '{}',
        throwOnError: true,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['monitor', 'students'] });
    },
  });

  const full = data ?? null;
  const s = full?.student;

  const cicloBadge = s
    ? isAurum(s)
      ? 'hb-badge hb-badge-brand'
      : isSeminario(s)
        ? 'hb-badge hb-badge-purple'
        : 'hb-badge hb-badge-mute'
    : 'hb-badge';

  return (
    <div
      className="nv-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="nv-modal">
        <div className="nv-modal-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <h2>{s?.name ?? student.name}</h2>
              <span className={cicloBadge}>{cicloLabel((s ?? student).ciclo_type)}</span>
            </div>
            <p className="nv-modal-info">
              {(s?.email ?? student.email)} · {s?.completed_tasks ?? student.completed_tasks ?? 0}/
              {s?.total_tasks ?? student.total_tasks ?? 0} tarefas concluídas
            </p>
            {student.date_change_requested && (
              <div className="nv-banner">
                <span>📅 Solicitou mudança de data</span>
                <button
                  onClick={() => approveDate.mutate()}
                  disabled={approveDate.isPending}
                  className="hb-btn hb-btn-primary"
                  style={{ padding: '4px 10px', fontSize: 12 }}
                >
                  {approveDate.isPending ? '...' : 'Aprovar'}
                </button>
              </div>
            )}
          </div>
          <button onClick={onClose} className="nv-modal-close" aria-label="Fechar">
            ×
          </button>
        </div>

        <div className="nv-modal-tabs">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`nv-modal-tab${tab === t.key ? ' is-active' : ''}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="nv-modal-body">
          <div className="nv-modal-pane">
            {isLoading && (
              <p style={{ textAlign: 'center', padding: '32px 0' }}>
                <span className="hb-spinner" />
              </p>
            )}
            {error && (
              <p style={{ textAlign: 'center', padding: '32px 0', fontSize: 14, color: 'var(--text-mute)' }}>
                {error instanceof SipApiError ? error.message : 'Erro ao carregar dados do aluno.'}
              </p>
            )}
            {full && tab === 'perfil' && <PerfilTab full={full} />}
            {full && tab === 'checklist' && <ChecklistTab stages={full.checklist?.stages ?? []} />}
            {full && tab === 'posts' && <PostsTab full={full} />}
            {full && tab === 'traffic' && <TrafficTab full={full} />}
            {full && tab === 'superdebriefing' && <DebriefingTab full={full} />}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Perfil ────────────────────────────────────────────────────────────────

const LABEL_MAP: Record<string, { title: string; map?: Record<string, string> }> = {
  tempo_carreira: {
    title: 'Tempo de carreira',
    map: { '<1': 'Menos de 1 ano', '1-3': '1 a 3 anos', '3-5': '3 a 5 anos', '5+': 'Mais de 5 anos' },
  },
  faturamento_atual: {
    title: 'Faturamento mensal',
    map: {
      '<10k': 'Até R$ 10k',
      '10-30k': 'R$ 10k a R$ 30k',
      '30-50k': 'R$ 30k a R$ 50k',
      '50-100k': 'R$ 50k a R$ 100k',
      '100k+': 'Mais de R$ 100k',
    },
  },
  pitch: { title: 'O que ensina/vende' },
  motivacao: { title: 'O que trouxe ao ciclo' },
  maior_dificuldade: {
    title: 'Maior dificuldade',
    map: {
      captacao: 'Captação',
      conversao: 'Conversão',
      conteudo: 'Conteúdo',
      trafego: 'Tráfego pago',
      estrutura: 'Estrutura técnica',
      posicionamento: 'Posicionamento',
      outro: 'Outro',
    },
  },
  nivel_lancamentos: {
    title: 'Nível com lançamentos',
    map: { iniciante: 'Iniciante', intermediario: 'Intermediário', avancado: 'Avançado' },
  },
  palestra_tema: { title: 'Tema da palestra' },
  palestra_publico: { title: 'Público-alvo' },
  palestra_transformacao: { title: 'Transformação prometida' },
  palestra_oferta: { title: 'Produto/oferta' },
  palestra_preco: {
    title: 'Faixa de preço',
    map: {
      '<1k': 'Menos de R$ 1k',
      '1-3k': 'R$ 1k a R$ 3k',
      '3-7k': 'R$ 3k a R$ 7k',
      '7-15k': 'R$ 7k a R$ 15k',
      '15k+': 'Mais de R$ 15k',
      indefinido: 'Indefinido',
    },
  },
  palestra_case: {
    title: 'Tem case/prova social',
    map: { sim: 'Sim', desenvolvendo: 'Em desenvolvimento', nao: 'Ainda não' },
  },
  palestra_observacao: { title: 'Observação ao monitor' },
};

const SECTION_PERFIL = [
  'tempo_carreira',
  'faturamento_atual',
  'pitch',
  'motivacao',
  'maior_dificuldade',
  'nivel_lancamentos',
];
const SECTION_PALESTRA = [
  'palestra_tema',
  'palestra_publico',
  'palestra_transformacao',
  'palestra_oferta',
  'palestra_preco',
  'palestra_case',
  'palestra_observacao',
];

function PerfilTab({ full }: { full: StudentFull }) {
  const p = full.student.onboarding_perfil ?? null;

  if (!p || Object.keys(p).length === 0) {
    return (
      <p style={{ textAlign: 'center', padding: '32px 0', fontSize: 14, color: 'var(--text-mute)' }}>
        Aluno ainda não preencheu o perfil de onboarding.
      </p>
    );
  }

  const renderField = (key: string) => {
    const meta = LABEL_MAP[key];
    if (!meta) return null;
    const raw = p[key];
    if (!raw) return null;
    const display = meta.map ? (meta.map[raw] ?? raw) : raw;
    return (
      <div key={key} style={{ marginBottom: 10 }}>
        <div
          style={{
            fontSize: 11,
            textTransform: 'uppercase',
            letterSpacing: '.05em',
            color: 'var(--text-mute)',
            fontWeight: 700,
            marginBottom: 2,
          }}
        >
          {meta.title}
        </div>
        <div style={{ fontSize: 13, color: 'var(--text)', whiteSpace: 'pre-wrap' }}>
          {String(display)}
        </div>
      </div>
    );
  };

  const perfilFields = SECTION_PERFIL.map(renderField).filter(Boolean);
  const palestraFields = SECTION_PALESTRA.map(renderField).filter(Boolean);

  return (
    <>
      {perfilFields.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <h4
            style={{
              fontSize: 13,
              fontWeight: 800,
              textTransform: 'uppercase',
              letterSpacing: '.05em',
              color: 'var(--brand-ink)',
              marginBottom: 10,
            }}
          >
            Sobre o aluno
          </h4>
          {perfilFields}
        </div>
      )}
      {palestraFields.length > 0 && (
        <div>
          <h4
            style={{
              fontSize: 13,
              fontWeight: 800,
              textTransform: 'uppercase',
              letterSpacing: '.05em',
              color: 'var(--brand-ink)',
              marginBottom: 10,
            }}
          >
            Sobre a palestra
          </h4>
          {palestraFields}
        </div>
      )}
    </>
  );
}

// ─── Checklist ───────────────────────────────────────────────────────────────

function ChecklistTab({ stages }: { stages: ChecklistStage[] }) {
  return (
    <>
      {stages.map((stage, i) => (
        <StageCard key={`${stage.title}-${i}`} stage={stage} defaultOpen={false} />
      ))}
    </>
  );
}

function StageCard({ stage, defaultOpen }: { stage: ChecklistStage; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const pct =
    stage.total_count > 0 ? Math.round((stage.completed_count / stage.total_count) * 100) : 0;
  const isComplete = stage.completed_count === stage.total_count && stage.total_count > 0;

  return (
    <div className="stage-card">
      <div className="stage-head" onClick={() => setOpen((o) => !o)}>
        <div className={`stage-title${isComplete ? ' complete' : ''}`}>
          {stage.title}
          {isComplete ? ' ✓' : ''}
        </div>
        <div className="stage-meta">
          <div className="nv-progress-mini">
            <span className={isComplete ? 'fill-green' : 'fill-brand'} style={{ width: `${pct}%` }} />
          </div>
          <span className="count">
            {stage.completed_count}/{stage.total_count}
          </span>
        </div>
      </div>
      {open && (
        <div className="stage-body">
          {Object.entries(stage.categories ?? {}).map(([catName, tasks]) => {
            const catDone = tasks.filter((t) => t.completed).length;
            return (
              <div key={catName}>
                <div className="cat-head">
                  <span>{catName}</span>
                  <span className={catDone === tasks.length ? 'done' : ''}>
                    {catDone}/{tasks.length}
                  </span>
                </div>
                {tasks.map((task, ti) => (
                  <div className="task-row" key={`${task.title}-${ti}`}>
                    <span className={`marker${task.completed ? ' is-done' : ''}`}>
                      {task.completed ? '✓' : '○'}
                    </span>
                    <span className={`text${task.completed ? ' is-done' : ''}`}>{task.title}</span>
                    {task.completed_at && <span className="date">{brDate(task.completed_at)}</span>}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Postagens ───────────────────────────────────────────────────────────────

const PICONS: Record<string, string> = { instagram: '📷', facebook: '📘', youtube: '▶️' };

function PostsTab({ full }: { full: StudentFull }) {
  const posts = full.posts ?? [];
  if (posts.length === 0) {
    return (
      <p style={{ textAlign: 'center', padding: '32px 0', fontSize: 14 }}>Nenhum post registrado.</p>
    );
  }
  return (
    <>
      {posts.map((p, i) => (
        <div className="post-row" key={i}>
          <span className="platform-icon">{PICONS[p.platform] ?? '📌'}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="post-format">{p.format}</div>
            <div className="post-meta">
              {new Date(p.date + 'T12:00:00').toLocaleDateString('pt-BR')} · {p.platform}
            </div>
          </div>
          {p.link && (
            <a href={p.link} target="_blank" rel="noopener noreferrer" className="post-link">
              {p.link}
            </a>
          )}
        </div>
      ))}
    </>
  );
}

// ─── Tráfego ─────────────────────────────────────────────────────────────────

function TrafficTab({ full }: { full: StudentFull }) {
  const rows = full.traffic?.rows ?? [];
  const totals = full.traffic?.totals ?? {};
  if (rows.length === 0) {
    return (
      <p style={{ textAlign: 'center', padding: '32px 0', fontSize: 14 }}>Nenhum dado de tráfego.</p>
    );
  }
  return (
    <>
      <div className="traffic-stats">
        <div className="traffic-stat">
          <div className="label">Total Investido</div>
          <div className="value">R$ {fmtNum(totals.spent)}</div>
        </div>
        <div className="traffic-stat">
          <div className="label">Leads</div>
          <div className="value">{fmtNum(totals.leads_builderall, 0)}</div>
        </div>
        <div className="traffic-stat">
          <div className="label">CPL</div>
          <div className="value">{totals.cpl != null ? `R$ ${fmtNum(totals.cpl)}` : '—'}</div>
        </div>
        <div className="traffic-stat">
          <div className="label">CTR</div>
          <div className="value">{totals.ctr != null ? `${fmtNum(totals.ctr)}%` : '—'}</div>
        </div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="hb-table">
          <thead>
            <tr>
              <th>Data</th>
              <th style={{ textAlign: 'right' }}>Gasto</th>
              <th style={{ textAlign: 'right' }}>Leads</th>
              <th style={{ textAlign: 'right' }}>CPL</th>
              <th style={{ textAlign: 'right' }}>CTR</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>
                  {new Date(r.date + 'T12:00:00').toLocaleDateString('pt-BR', {
                    day: '2-digit',
                    month: '2-digit',
                  })}
                </td>
                <td style={{ textAlign: 'right' }}>R$ {fmtNum(r.spent)}</td>
                <td style={{ textAlign: 'right' }}>{r.leads_builderall}</td>
                <td style={{ textAlign: 'right' }}>{r.cpl != null ? `R$ ${fmtNum(r.cpl)}` : '—'}</td>
                <td style={{ textAlign: 'right' }}>{r.ctr != null ? `${fmtNum(r.ctr)}%` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ─── SuperDebriefing ───────────────────────────────────────────────────────────

function DebriefingTab({ full }: { full: StudentFull }) {
  const sdb = full.debriefing;
  if (!sdb) {
    return (
      <p style={{ textAlign: 'center', padding: '32px 0', fontSize: 14 }}>
        SuperDebriefing ainda não foi enviado.
      </p>
    );
  }
  const sp = (sdb.payload ?? sdb) as Record<string, unknown>;
  const raw = sdb as Record<string, unknown>;
  const num = (v: unknown): number | null =>
    v == null ? null : Number.isNaN(Number(v)) ? null : Number(v);

  const valInv = num(sp.valor_investido ?? raw.valor_investido);
  const leads = sp.leads_builderall ?? raw.leads_builderall;
  const cpl = num(sp.cpl ?? raw.cpl);
  const vendas = sp.vendas ?? raw.qtd_vendas;
  const fat = num(sp.faturamento ?? raw.faturamento_total);
  const roi = num(sp.roi ?? raw.roi);

  const fields: [string, string | number | null | undefined][] = [
    ['Live palestra', sp.live_palestra as string | undefined],
    ['Live tira-dúvidas', sp.live_td as string | undefined],
    ['Valor Investido', valInv != null ? `R$ ${valInv.toFixed(2)}` : null],
    ['Leads Total', leads as number | undefined],
    ['CPL', cpl != null ? `R$ ${cpl.toFixed(2)}` : null],
    ['Vendas', vendas as number | undefined],
    ['Faturamento', fat != null ? `R$ ${fat.toFixed(2)}` : null],
    ['ROI', roi != null ? `${roi.toFixed(1)}x` : null],
    ['O que deixou de fazer', sp.refl_deixou_fazer as string | undefined],
    ['O que mudaria na mentoria', sp.refl_mudar_mentoria as string | undefined],
  ];

  const filtered = fields.filter(([, v]) => v != null);

  return (
    <>
      {filtered.map(([label, val], i) => (
        <div className="sdb-row" key={i}>
          <span className="label">{label}</span>
          <span className="value">{String(val)}</span>
        </div>
      ))}
    </>
  );
}
