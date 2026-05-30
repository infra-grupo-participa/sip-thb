import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { getToken, useSession } from '../lib/auth';

// Guard de autenticação. Sem token → /login. Com token, valida via /me;
// se inválido/expirado → /login. (Os guards de fluxo — wait-mode, raio-x,
// troca de senha — entram nas próximas fases, espelhando flow.js.)
export function RequireAuth({ children }: { children: ReactNode }) {
  const hasToken = !!getToken();
  const { data: user, isLoading, isError } = useSession();

  if (!hasToken) return <Navigate to="/login" replace />;
  if (isLoading) return <div className="shell"><div className="card">Carregando…</div></div>;
  if (isError || !user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
