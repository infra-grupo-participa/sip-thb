import { useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useLogin } from '../../lib/auth';
import { SipApiError } from '../../lib/api';
import '../../legacy/login.css';

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const login = useLogin();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Aviso vindo de outra tela (ex.: após redefinir a senha em /recuperar-senha).
  const notice =
    location.state && typeof (location.state as { notice?: unknown }).notice === 'string'
      ? (location.state as { notice: string }).notice
      : null;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await login.mutateAsync({ email: email.trim(), password });
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof SipApiError ? err.message : 'Falha ao entrar.');
    }
  }

  return (
    <div className="login-page">
      <div className="login-shell">
        <div className="login-hero">
          <div className="login-logo">
            <img src="/assets/logo-thb-mark.svg" alt="Time Holding Brasil" />
          </div>
          <h1>Sistema de Integração e Progressão</h1>
          <p>Time Holding Brasil</p>
        </div>

        <div className="hb-card hb-card-elevated login-card">
          <h2>Entrar na plataforma</h2>

          {notice && !error && (
            <div
              className="login-error"
              style={{ background: 'var(--green-bg, #ecfdf5)', borderColor: 'rgba(21,128,61,.25)', color: 'var(--green, #15803d)' }}
            >
              {notice}
            </div>
          )}
          {error && <div className="login-error">{error}</div>}

          <form className="login-form" onSubmit={onSubmit}>
            <div>
              <label className="hb-label" htmlFor="email">E-mail</label>
              <input
                type="email"
                id="email"
                className="hb-input"
                required
                placeholder="seu@email.com"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div>
              <label className="hb-label" htmlFor="password">Senha</label>
              <input
                type="password"
                id="password"
                className="hb-input"
                required
                placeholder="••••••••"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <button
              type="submit"
              className="hb-btn hb-btn-primary hb-btn-block"
              style={{ marginTop: 6 }}
              disabled={login.isPending}
            >
              {login.isPending ? 'Entrando...' : 'Entrar'}
            </button>
          </form>

          <div style={{ textAlign: 'center', marginTop: 14 }}>
            <Link
              to="/recuperar-senha"
              style={{ fontSize: 13, color: 'var(--text-mute)', textDecoration: 'underline' }}
            >
              Esqueci minha senha
            </Link>
          </div>
        </div>

        <p className="login-foot">
          Não tem conta?{' '}
          <a href="/cadastro" style={{ color: 'var(--brand)', fontWeight: 600 }}>
            Criar minha conta
          </a>
        </p>
        <p className="login-foot" style={{ marginTop: 6, fontSize: 11 }}>
          Time Holding Brasil · Ciclo de Lançamentos
        </p>
      </div>
    </div>
  );
}
