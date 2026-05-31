import { useQuery } from '@tanstack/react-query';
import { sipApi } from '../../lib/api';
import { type MonitorStudent, isAurum, isSeminario, cicloChip } from './types';

interface Props {
  onSelect: (student: MonitorStudent) => void;
}

export default function MyStudents({ onSelect }: Props) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['monitor', 'students'],
    queryFn: () => sipApi<MonitorStudent[]>('/monitor/students', { throwOnError: true }),
    refetchInterval: 30_000,
  });

  const students = Array.isArray(data) ? data : [];
  const aurum = students.filter(isAurum);
  const seminario = students.filter(isSeminario);

  return (
    <div>
      <header className="page-head">
        <h1>Meus Alunos</h1>
        <p>Acompanhe o progresso de cada aluno do seu time</p>
      </header>

      <section className="kpi-row">
        <div className="kpi-tile">
          <p className="kpi-label">Total</p>
          <p className="kpi-value">{isLoading ? '—' : students.length}</p>
          <p className="kpi-hint">alunos ativos</p>
        </div>
        <div className="kpi-tile">
          <p className="kpi-label">Aurum</p>
          <p className="kpi-value" style={{ color: 'var(--brand)' }}>
            {isLoading ? '—' : aurum.length}
          </p>
          <p className="kpi-hint">1º ciclo</p>
        </div>
        <div className="kpi-tile">
          <p className="kpi-label">Diamante</p>
          <p className="kpi-value" style={{ color: 'var(--purple)' }}>
            {isLoading ? '—' : seminario.length}
          </p>
          <p className="kpi-hint">2º ciclo</p>
        </div>
      </section>

      <section className="info-card">
        <div className="info-card-head">
          <h2>Lista de alunos</h2>
          <p>Clique em qualquer aluno para abrir os detalhes completos</p>
        </div>

        <div className="students-list">
          {isLoading && (
            <div className="empty-state">
              <span className="hb-spinner" />
              <p className="sub">Carregando...</p>
            </div>
          )}

          {isError && !isLoading && (
            <div className="empty-state">
              <span className="icon">⚠️</span>
              <p className="title">Não foi possível carregar seus alunos</p>
              <p className="sub">Verifique sua conexão e tente novamente.</p>
              <button className="hb-btn hb-btn-secondary" onClick={() => refetch()}>
                Tentar de novo
              </button>
            </div>
          )}

          {!isLoading && !isError && students.length === 0 && (
            <div className="empty-state">
              <span className="icon">🎓</span>
              <p className="title">Nenhum aluno associado ainda</p>
              <p className="sub">O admin irá associar alunos ao seu perfil em breve.</p>
            </div>
          )}

          {!isLoading && !isError && students.length > 0 && (
            <>
              <StudentGroup list={aurum} label="Turma Aurum" headerCls="is-brand" onSelect={onSelect} />
              <StudentGroup
                list={seminario}
                label="Turma Diamante"
                headerCls="is-purple"
                onSelect={onSelect}
              />
            </>
          )}
        </div>
      </section>
    </div>
  );
}

function StudentGroup({
  list,
  label,
  headerCls,
  onSelect,
}: {
  list: MonitorStudent[];
  label: string;
  headerCls: string;
  onSelect: (s: MonitorStudent) => void;
}) {
  if (list.length === 0) return null;
  return (
    <>
      <div className={`student-group-head ${headerCls}`}>
        <span>{label}</span>
        <span className="student-group-count">{list.length}</span>
      </div>
      {list.map((s) => (
        <StudentRow key={s.id} s={s} onSelect={onSelect} />
      ))}
    </>
  );
}

function StudentRow({ s, onSelect }: { s: MonitorStudent; onSelect: (s: MonitorStudent) => void }) {
  const chip = cicloChip(s.ciclo_type);
  const pct = s.progress_percent ?? 0;
  const fillCls = pct === 100 ? 'is-green' : pct > 50 ? 'is-brand' : 'is-blue';

  return (
    <div className="student-row" onClick={() => onSelect(s)}>
      <div className="student-row-avatar">{(s.name?.charAt(0) ?? '?').toUpperCase()}</div>
      <div className="student-row-main">
        <div className="student-row-line1">
          <span className="student-row-name">{s.name}</span>
          <span className={`chip ${chip.cls} chip-sm`}>{chip.label}</span>
          {s.date_change_requested && (
            <span
              className="chip chip-sm"
              style={{
                background: 'rgba(202,138,4,0.10)',
                color: 'var(--yellow)',
                borderColor: 'rgba(202,138,4,0.30)',
              }}
            >
              📅 Mudança
            </span>
          )}
        </div>
        <div className="student-row-line2">
          <span>{s.email}</span>
        </div>
      </div>
      <div className="student-row-progress">
        <span className={`student-row-pct${pct === 100 ? ' is-green' : ''}`}>{pct}%</span>
        <div className="student-row-bar">
          <div className={fillCls} style={{ width: `${pct}%` }} />
        </div>
        <span className="student-row-frac">
          {s.completed_tasks ?? 0}/{s.total_tasks ?? 0}
        </span>
      </div>
    </div>
  );
}
