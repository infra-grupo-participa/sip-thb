import { useQuery } from '@tanstack/react-query';
import { sipApi } from '../../lib/api';
import { useSession, logout } from '../../lib/auth';
import { ThemeProvider } from '../../design/ThemeProvider';

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
const CICLO_LABEL: Record<string, string> = {
  aurum: 'Aurum (palestra)',
  seminario: 'Seminário (diamante)',
};

export default function Home() {
  const { data: user } = useSession();
  const { data: health } = useQuery({
    queryKey: ['health'],
    queryFn: () => sipApi<Health>('/health', { throwOnError: true }),
    refetchInterval: 30_000,
  });

  return (
    <ThemeProvider user={user ?? null}>
      <div className="shell">
        <div className="card">
          <div className="brand-bar" />
          <h1>Olá, {user?.name?.split(' ')[0] ?? 'usuário'} 👋</h1>
          <p className="muted">Painel SIP — fundação do refactor (Express + React).</p>

          <dl className="kv">
            <div>
              <dt>Papel</dt>
              <dd>{user ? (ROLE_LABEL[user.role] ?? user.role) : '—'}</dd>
            </div>
            <div>
              <dt>Ciclo</dt>
              <dd>{user?.ciclo_type ? CICLO_LABEL[user.ciclo_type] : '—'}</dd>
            </div>
            <div>
              <dt>Monitor</dt>
              <dd>{user?.monitor_name ?? '—'}</dd>
            </div>
            <div>
              <dt>Aprovação</dt>
              <dd>{user?.approval_status ?? '—'}</dd>
            </div>
          </dl>

          <div className="status">
            <span className={`dot ${health?.db === 'ok' ? 'ok' : 'err'}`} />
            Servidor {health?.env ?? '…'} · Banco: {health?.db ?? '…'}
          </div>

          <button className="btn btn-ghost" onClick={logout}>
            Sair
          </button>
        </div>
      </div>
    </ThemeProvider>
  );
}
