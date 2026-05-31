import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSession, logout } from '../../lib/auth';
import { sipApi } from '../../lib/api';
import { type MonitorStudent, type MonitorReport } from './types';
import MyStudents from './MyStudents';
import Summary from './Summary';
import Inbox from './Inbox';
import StudentModal from './StudentModal';
import './monitor.css';

type Tab = 'students' | 'summary' | 'inbox';

export default function MonitorShell() {
  const { data: user } = useSession();
  const [tab, setTab] = useState<Tab>('students');
  const [navOpen, setNavOpen] = useState(false);
  const [selected, setSelected] = useState<MonitorStudent | null>(null);

  // Badge de chamados abertos (mesma lógica do legado).
  const { data: openReports } = useQuery({
    queryKey: ['monitor', 'reports', 'aberto'],
    queryFn: () =>
      sipApi<MonitorReport[] | { items: MonitorReport[] }>('/monitor/reports?status=aberto', {
        throwOnError: true,
      }),
    refetchInterval: 30_000,
  });
  const openList: MonitorReport[] = Array.isArray(openReports)
    ? openReports
    : (openReports?.items ?? []);
  const openCount = openList.filter(
    (r) => r.status === 'aberto' || r.status === 'em_atendimento',
  ).length;

  function go(t: Tab) {
    setTab(t);
    setNavOpen(false);
  }

  const navItem = (key: Tab, label: string, icon: ReactNode, badge?: number) => (
    <button
      onClick={() => go(key)}
      className={`sidenav-item${tab === key ? ' is-active' : ''}`}
    >
      {icon}
      <span className="label">{label}</span>
      {badge != null && badge > 0 && <span className="sidenav-badge">{badge}</span>}
    </button>
  );

  return (
    <div className="app-shell">
      <aside className={`sidenav${navOpen ? ' is-open' : ''}`}>
        <div className="sidenav-brand">
          <span className="brand-mark">
            <img src="/assets/logo-thb-mark.svg" alt="THB" />
          </span>
          <div>
            <div className="brand-text">Time Holding Brasil</div>
            <div className="brand-sub">Painel do Monitor</div>
          </div>
        </div>

        <div className="sidenav-section">
          <div className="sidenav-section-label">Acompanhamento</div>
          {navItem(
            'students',
            'Meus alunos',
            <svg className="ico" viewBox="0 0 24 24" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>,
          )}
          {navItem(
            'summary',
            'Resumo',
            <svg className="ico" viewBox="0 0 24 24" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="20" x2="18" y2="10" />
              <line x1="12" y1="20" x2="12" y2="4" />
              <line x1="6" y1="20" x2="6" y2="14" />
            </svg>,
          )}
          {navItem(
            'inbox',
            'Chamados',
            <svg className="ico" viewBox="0 0 24 24" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
              <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
            </svg>,
            openCount,
          )}
        </div>

        <div className="sidenav-divider" />

        <div className="sidenav-footer">
          <button onClick={() => logout()} className="sidenav-item">
            <svg className="ico" viewBox="0 0 24 24" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            <span className="label">Sair</span>
          </button>
        </div>
      </aside>
      <div className="sidenav-backdrop" onClick={() => setNavOpen(false)} />

      <div className="app-content">
        <header className="topbar">
          <div className="topbar-inner">
            <button
              className="sidenav-toggle topbar-burger"
              onClick={() => setNavOpen((o) => !o)}
              aria-label="Abrir menu"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
            <div className="topbar-greet">
              <span className="topbar-name">{user?.name || 'Monitor'}</span>
              <span
                className="topbar-pill"
                style={{
                  background: 'var(--green-bg)',
                  color: 'var(--green)',
                  borderColor: 'var(--green-border)',
                }}
              >
                Monitor
              </span>
            </div>
          </div>
        </header>

        <main className="page-main">
          {tab === 'students' && <MyStudents onSelect={setSelected} />}
          {tab === 'summary' && <Summary onSelect={setSelected} />}
          {tab === 'inbox' && <Inbox />}
        </main>
      </div>

      {selected && <StudentModal student={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
