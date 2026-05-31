import { useState } from 'react';
import { logout } from '../../lib/auth';
import './admin.css';
import {
  IconDashboard, IconStudents, IconMonitors, IconRaiox, IconCycle, IconContent,
  IconSettings, IconPosts, IconTraffic, IconInstagram, IconHistory, IconClickup,
  IconReports, IconLogout, IconMenu,
} from './icons';
import Dashboard from './tabs/Dashboard';
import Students from './tabs/Students';
import Monitores from './tabs/Monitores';
import Raiox from './tabs/Raiox';
import CicloTemplates from './tabs/CicloTemplates';
import Content from './tabs/Content';
import Settings from './tabs/Settings';
import Posts from './tabs/Posts';
import Traffic from './tabs/Traffic';
import Instagram from './tabs/Instagram';
import History from './tabs/History';
import Clickup from './tabs/Clickup';
import Reports from './tabs/Reports';
import Aprovacoes from './tabs/Aprovacoes';
import StudentModal from './StudentModal';

type Tab =
  | 'dashboard' | 'students' | 'aprovacoes' | 'navigators' | 'raiox' | 'ciclos'
  | 'content' | 'settings' | 'posts' | 'traffic' | 'ig' | 'history' | 'clickup' | 'reports';

interface NavItem { id: Tab; label: string; icon: () => JSX.Element }
interface NavSection { label: string; items: NavItem[] }

const SECTIONS: NavSection[] = [
  { label: 'Visão Geral', items: [{ id: 'dashboard', label: 'Dashboard', icon: IconDashboard }] },
  {
    label: 'Pessoas',
    items: [
      { id: 'students', label: 'Alunos', icon: IconStudents },
      { id: 'aprovacoes', label: 'Aprovações', icon: IconStudents },
      { id: 'navigators', label: 'Monitores', icon: IconMonitors },
      { id: 'raiox', label: 'Raio-X', icon: IconRaiox },
    ],
  },
  {
    label: 'Programa',
    items: [
      { id: 'ciclos', label: 'Templates', icon: IconCycle },
      { id: 'content', label: 'Conteúdo', icon: IconContent },
      { id: 'settings', label: 'Mensagens', icon: IconSettings },
    ],
  },
  {
    label: 'Métricas',
    items: [
      { id: 'posts', label: 'Postagens', icon: IconPosts },
      { id: 'traffic', label: 'Tráfego', icon: IconTraffic },
      { id: 'ig', label: 'Instagram', icon: IconInstagram },
      { id: 'history', label: 'Histórico', icon: IconHistory },
    ],
  },
];

const FOOTER_ITEMS: NavItem[] = [
  { id: 'clickup', label: 'ClickUp', icon: IconClickup },
  { id: 'reports', label: 'Chamados', icon: IconReports },
];

export default function AdminShell() {
  const [tab, setTab] = useState<Tab>('dashboard');
  const [navOpen, setNavOpen] = useState(false);
  const [modalStudent, setModalStudent] = useState<string | null>(null);

  const go = (t: Tab) => {
    setTab(t);
    setNavOpen(false);
  };
  const openStudent = (id: string) => setModalStudent(id);

  const NavButton = ({ item }: { item: NavItem }) => (
    <button
      onClick={() => go(item.id)}
      className={`sidenav-item ${tab === item.id ? 'is-active' : ''}`}
    >
      <item.icon />
      <span className="label">{item.label}</span>
    </button>
  );

  return (
    <div className="app-shell">
      <aside className={`sidenav ${navOpen ? 'is-open' : ''}`}>
        <div className="sidenav-brand">
          <div>
            <div className="brand-text">Time Holding Brasil</div>
            <div className="brand-sub">Painel Administrativo</div>
          </div>
        </div>

        {SECTIONS.map((sec) => (
          <div className="sidenav-section" key={sec.label}>
            <div className="sidenav-section-label">{sec.label}</div>
            {sec.items.map((item) => (
              <NavButton key={item.id} item={item} />
            ))}
          </div>
        ))}

        <div className="sidenav-divider"></div>

        <div className="sidenav-footer">
          {FOOTER_ITEMS.map((item) => (
            <NavButton key={item.id} item={item} />
          ))}
          <button onClick={logout} className="sidenav-item" style={{ marginTop: 6 }}>
            <IconLogout />
            <span className="label">Sair</span>
          </button>
        </div>
      </aside>
      <div className="sidenav-backdrop" onClick={() => setNavOpen(false)}></div>

      <div className="app-content">
        <header className="topbar">
          <div className="px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button className="sidenav-toggle items-center justify-center w-9 h-9 rounded-lg border" onClick={() => setNavOpen((v) => !v)} aria-label="Abrir menu">
                <IconMenu />
              </button>
              <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: 'rgba(239,68,68,0.2)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)' }}>
                Admin
              </span>
            </div>
          </div>
        </header>

        <main className="flex-1 min-w-0 space-y-6 px-4 py-6">
          {tab === 'dashboard' && (
            <Dashboard
              onGoStudents={() => go('students')}
              onGoCiclos={() => go('ciclos')}
              onGoPosts={() => go('posts')}
              onGoTraffic={() => go('traffic')}
            />
          )}
          {tab === 'students' && <Students onOpenStudent={openStudent} />}
          {tab === 'aprovacoes' && <Aprovacoes />}
          {tab === 'navigators' && <Monitores />}
          {tab === 'raiox' && <Raiox onOpenStudent={openStudent} />}
          {tab === 'ciclos' && <CicloTemplates />}
          {tab === 'content' && <Content />}
          {tab === 'settings' && <Settings />}
          {tab === 'posts' && <Posts />}
          {tab === 'traffic' && <Traffic />}
          {tab === 'ig' && <Instagram />}
          {tab === 'history' && <History />}
          {tab === 'clickup' && <Clickup />}
          {tab === 'reports' && <Reports />}
        </main>
      </div>

      {modalStudent && <StudentModal studentId={modalStudent} onClose={() => setModalStudent(null)} />}
    </div>
  );
}
