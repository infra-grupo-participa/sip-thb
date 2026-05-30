import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLogin } from '../../lib/auth';
import { SipApiError } from '../../lib/api';

export default function Login() {
  const navigate = useNavigate();
  const login = useLogin();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await login.mutateAsync({ email, password });
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof SipApiError ? err.message : 'Falha ao entrar.');
    }
  }

  return (
    <div className="shell">
      <form className="card" onSubmit={onSubmit}>
        <div className="brand-bar" />
        <h1>Entrar no SIP</h1>
        <p className="muted">Sistema de Implementação Prática — Grupo Participa</p>

        <label className="field">
          <span>E-mail</span>
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>

        <label className="field">
          <span>Senha</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>

        {error && <div className="alert">{error}</div>}

        <button className="btn" type="submit" disabled={login.isPending}>
          {login.isPending ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}
