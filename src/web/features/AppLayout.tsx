import { NavLink, Outlet } from 'react-router-dom';
import { useSession, logout } from '../lib/auth';
import { ThemeProvider } from '../design/ThemeProvider';

// Layout autenticado: topbar + navegação (aluno) + tema por ciclo.
export default function AppLayout() {
  const { data: user } = useSession();
  const isStudent = user?.role === 'student';
  return (
    <ThemeProvider user={user ?? null}>
      <div className="topbar">
        <div className="topbar-left">
          <strong>SIP</strong>
          {isStudent && (
            <nav className="topnav">
              <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : '')}>
                Trilha
              </NavLink>
              <NavLink to="/conteudo" className={({ isActive }) => (isActive ? 'active' : '')}>
                Conteúdo
              </NavLink>
            </nav>
          )}
        </div>
        <button className="link-btn" onClick={logout}>
          Sair
        </button>
      </div>
      <Outlet />
    </ThemeProvider>
  );
}
