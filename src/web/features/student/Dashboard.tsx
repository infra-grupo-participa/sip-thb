import { useState } from 'react';
import { useSession, logout } from '../../lib/auth';
import { useProgress, useGamification } from './hooks';
import type { Badge } from './types';
import Overview from './Overview';
import Checklist from './Checklist';
import Postagens from './Postagens';
import Trafego from './Trafego';
import Calendario from './Calendario';
import Historico from './Historico';
import Chamados from './Chamados';
import Perfil from './Perfil';
import SuperDebriefing from './SuperDebriefing';

type TabKey = 'overview' | 'checklist' | 'history' | 'posts' | 'traffic' | 'calendar' | 'inbox' | 'profile';

function WaitingScreen({ title, body }: { title: string; body: string }) {
  return (
    <div className="ws-wrap" style={{ position: 'fixed', inset: 0, zIndex: 40, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="ws-card">
        <div className="ws-badge">
          <span className="dot" /> Aguardando aprovação
        </div>
        <h2 className="ws-title">{title}</h2>
        <p className="ws-body">{body}</p>
        <button onClick={() => logout()} className="ws-logout">
          Sair da conta
        </button>
      </div>
    </div>
  );
}

function TrophyPopover({ badges }: { badges: Badge[] }) {
  const [open, setOpen] = useState(false);
  const earned = badges.filter((b) => b.earned);
  const visible = badges.filter((b) => !b.secret || b.earned);
  return (
    <>
      <button type="button" className="trophy-btn" onClick={() => setOpen((v) => !v)} aria-label="Minhas conquistas" aria-haspopup="true" aria-expanded={open}>
        <span className="trophy-icon">🏆</span>
        {earned.length > 0 && <span className="trophy-count">{earned.length}</span>}
      </button>
      {open && (
        <div className="trophy-popover" role="dialog" aria-label="Conquistas">
          <div className="trophy-popover-head">
            <h3>Minhas Conquistas</h3>
            <span className="count">
              {earned.length}/{visible.length} conquistas
            </span>
          </div>
          <div className="trophy-popover-grid">
            {visible.length === 0 && <div className="trophy-popover-empty col-span-2">Conclua tarefas para desbloquear conquistas.</div>}
            {visible.map((b) => {
              const isSecret = b.secret && !b.earned;
              return (
                <div key={b.id} className={`flex flex-col items-center gap-1 p-2.5 rounded-lg border ${b.earned ? 'border-amber-500/40 bg-amber-500/5' : 'opacity-40'}`}>
                  <span className="text-xl">{isSecret ? '🔒' : b.icon}</span>
                  <span className={`text-xs font-semibold text-center ${b.earned ? 'text-amber-400' : ''}`}>{isSecret ? '???' : b.name}</span>
                  <span className="text-[10px] text-center leading-tight">{isSecret ? 'Badge secreto' : b.description}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

const NAV: { section: string; items: { key: TabKey; label: string; icon: React.ReactNode }[] }[] = [
  {
    section: 'Início',
    items: [
      {
        key: 'overview',
        label: 'Visão Geral',
        icon: (
          <svg className="ico" viewBox="0 0 24 24" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 12 12 3l9 9" />
            <path d="M5 10v10a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V10" />
          </svg>
        ),
      },
    ],
  },
  {
    section: 'Progresso',
    items: [
      {
        key: 'checklist',
        label: 'Checklist',
        icon: (
          <svg className="ico" viewBox="0 0 24 24" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 11l3 3L22 4" />
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
          </svg>
        ),
      },
      {
        key: 'history',
        label: 'Histórico',
        icon: (
          <svg className="ico" viewBox="0 0 24 24" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
        ),
      },
    ],
  },
  {
    section: 'Conteúdo & Tráfego',
    items: [
      {
        key: 'posts',
        label: 'Postagens',
        icon: (
          <svg className="ico" viewBox="0 0 24 24" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
        ),
      },
      {
        key: 'traffic',
        label: 'Tráfego',
        icon: (
          <svg className="ico" viewBox="0 0 24 24" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="20" x2="18" y2="10" />
            <line x1="12" y1="20" x2="12" y2="4" />
            <line x1="6" y1="20" x2="6" y2="14" />
          </svg>
        ),
      },
      {
        key: 'calendar',
        label: 'Calendário',
        icon: (
          <svg className="ico" viewBox="0 0 24 24" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        ),
      },
    ],
  },
];

const FOOTER_ITEMS: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  {
    key: 'inbox',
    label: 'Chamados',
    icon: (
      <svg className="ico" viewBox="0 0 24 24" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 12h-6l-2 3h-4l-2-3H2" />
        <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
      </svg>
    ),
  },
  {
    key: 'profile',
    label: 'Meus Dados',
    icon: (
      <svg className="ico" viewBox="0 0 24 24" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
      </svg>
    ),
  },
];

export default function Dashboard() {
  const { data: user } = useSession();
  const progress = useProgress();
  const [tab, setTab] = useState<TabKey>('overview');
  const [navOpen, setNavOpen] = useState(false);
  const [sdbOpen, setSdbOpen] = useState(false);

  const p = progress.data;
  const hasStages = Array.isArray(p?.stages);
  const gam = useGamification(hasStages);
  const g = gam.data;

  // Estados de espera (sem trilha)
  if (!progress.isLoading && p && !hasStages) {
    if (p.rejected) return <WaitingScreen title="Cadastro não aprovado" body="Seu cadastro não foi aprovado. Entre em contato com o suporte." />;
    if (p.pending_approval) return <WaitingScreen title="Aguardando aprovação" body="Seu cadastro está em análise pelo administrador. Você receberá acesso assim que for aprovado." />;
    if (p.waiting || p.wait_mode) {
      const body =
        p.reason === 'cycle_not_started' && p.data_inicio
          ? `Seu ciclo começa em ${new Date(p.data_inicio + 'T12:00:00').toLocaleDateString('pt-BR')}.`
          : 'Você ainda não possui um monitor/ciclo ativo. Aguarde a liberação.';
      return <WaitingScreen title="Aguardando início do ciclo" body={body} />;
    }
  }

  function NavButton({ item }: { item: { key: TabKey; label: string; icon: React.ReactNode } }) {
    return (
      <button
        className={`sidenav-item ${tab === item.key ? 'is-active' : ''}`}
        onClick={() => {
          setTab(item.key);
          setNavOpen(false);
        }}
      >
        {item.icon}
        <span className="label">{item.label}</span>
      </button>
    );
  }

  return (
    <div className="app-shell">
      <aside className={`sidenav ${navOpen ? 'is-open' : ''}`}>
        <div className="sidenav-brand">
          <span className="brand-mark">THB</span>
          <div>
            <div className="brand-text">Time Holding Brasil</div>
            <div className="brand-sub">Sistema de Integração</div>
          </div>
        </div>
        {NAV.map((grp) => (
          <div className="sidenav-section" key={grp.section}>
            <div className="sidenav-section-label">{grp.section}</div>
            {grp.items.map((item) => (
              <NavButton key={item.key} item={item} />
            ))}
          </div>
        ))}
        <div className="sidenav-divider" />
        <div className="sidenav-footer">
          {FOOTER_ITEMS.map((item) => (
            <NavButton key={item.key} item={item} />
          ))}
        </div>
      </aside>
      {navOpen && <div className="sidenav-backdrop" onClick={() => setNavOpen(false)} />}

      <div className="app-content">
        <header className="topbar">
          <div className="topbar-inner">
            <button className="sidenav-toggle topbar-burger" onClick={() => setNavOpen((v) => !v)} aria-label="Abrir menu">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
            <div className="topbar-greet">
              <span className="topbar-name">{user?.name?.split(' ')[0] ?? '—'}</span>
              {user?.is_socio && <span className="topbar-pill is-blue">Sócio</span>}
            </div>
            <div className="topbar-actions">
              {g && g.streak >= 2 && (
                <div className="topbar-stat flex">
                  <span>🔥</span>
                  <span>{g.streak}d</span>
                </div>
              )}
              {g && (
                <div className="topbar-xp">
                  <span id="xp-level-badge">
                    Nv.{g.level} {g.level_name}
                  </span>
                  <span className="topbar-xp-text">{g.xp} XP</span>
                  <div className="topbar-xp-bar">
                    <div style={{ width: (g.xp_progress_percent ?? 0) + '%' }} />
                  </div>
                </div>
              )}
              {g && <TrophyPopover badges={g.badges} />}
              <button onClick={() => logout()} className="topbar-logout">
                Sair
              </button>
            </div>
          </div>
        </header>

        <main className="page-main">
          {tab === 'overview' && <Overview onOpenDebriefing={() => setSdbOpen(true)} onGoChecklist={() => setTab('checklist')} />}
          {tab === 'checklist' && <Checklist />}
          {tab === 'history' && <Historico />}
          {tab === 'posts' && <Postagens />}
          {tab === 'traffic' && <Trafego />}
          {tab === 'calendar' && <Calendario />}
          {tab === 'inbox' && <Chamados />}
          {tab === 'profile' && <Perfil />}
        </main>
      </div>

      {sdbOpen && <SuperDebriefing onClose={() => setSdbOpen(false)} />}
    </div>
  );
}
