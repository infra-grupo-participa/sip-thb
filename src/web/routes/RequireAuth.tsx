import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { getToken, useSession } from '../lib/auth';

// Guard de autenticação + fluxo (espelha shared/flow.js do legado):
//  - sem token / sessão inválida → /login
//  - must_change_password → força /trocar-senha (não deixa usar o resto)
// (wait-mode / pending / rejected são tratados dentro do Dashboard via
//  /my-progress; verificação de e-mail e Raio-X pendentes ficam no fluxo de
//  cadastro.)
export function RequireAuth({ children }: { children: ReactNode }) {
  const hasToken = !!getToken();
  const { data: user, isLoading, isError } = useSession();
  const loc = useLocation();

  if (!hasToken) return <Navigate to="/login" replace />;
  if (isLoading)
    return (
      <div className="login-page">
        <div className="hb-card hb-card-elevated" style={{ padding: 32 }}>
          Carregando…
        </div>
      </div>
    );
  if (isError || !user) return <Navigate to="/login" replace />;

  // Troca de senha obrigatória: bloqueia o resto até trocar.
  if (user.must_change_password && loc.pathname !== '/trocar-senha') {
    return <Navigate to="/trocar-senha" replace />;
  }

  return <>{children}</>;
}
