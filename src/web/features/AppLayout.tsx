import { Outlet } from 'react-router-dom';
import { useSession } from '../lib/auth';
import { ThemeProvider } from '../design/ThemeProvider';

// Layout autenticado. Cada papel (aluno/admin/monitor) renderiza o seu próprio
// app-shell completo (sidebar + topbar) dentro do Outlet; aqui só aplicamos o
// tema por ciclo (theme-aurum / theme-diamante) e deixamos o conteúdo fluir.
export default function AppLayout() {
  const { data: user } = useSession();
  return (
    <ThemeProvider user={user ?? null}>
      <Outlet />
    </ThemeProvider>
  );
}
