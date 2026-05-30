import { useQuery } from '@tanstack/react-query';
import { sipApi } from '../../lib/api';
import { useSession, logout } from '../../lib/auth';
import Dashboard from '../student/Dashboard';
import AdminShell from '../admin/AdminShell';

interface Health {
  ok: boolean;
  env: string;
  db?: string;
}

const ROLE_LABEL: Record<string, string> = {
  admin: 'Administrador',
  monitor: 'Monitor',
  student: 'Aluno',
};

// Painel para admin/monitor (UI completa entra nas Fases 4-5).
function StaffPanel() {
  const { data: user } = useSession();
  const { data: health } = useQuery({
    queryKey: ['health'],
    queryFn: () => sipApi<Health>('/health', { throwOnError: true }),
    refetchInterval: 30_000,
  });
  return (
    <div className="shell">
      <div className="card">
        <div className="brand-bar" />
        <h1>Olá, {user?.name?.split(' ')[0] ?? 'usuário'} 👋</h1>
        <p className="muted">
          Painel {user ? (ROLE_LABEL[user.role] ?? user.role) : ''} — em construção (Fases 4-5).
        </p>
        <div className="status">
          <span className={`dot ${health?.db === 'ok' ? 'ok' : 'err'}`} />
          Servidor {health?.env ?? '…'} · Banco: {health?.db ?? '…'}
        </div>
        <button className="btn btn-ghost" onClick={logout}>
          Sair
        </button>
      </div>
    </div>
  );
}

export default function Home() {
  const { data: user } = useSession();
  if (user?.role === 'student') return <Dashboard />;
  if (user?.role === 'admin') return <AdminShell />;
  return <StaffPanel />;
}
