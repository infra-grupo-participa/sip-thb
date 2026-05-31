import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { sipApi, SipApiError } from '../../lib/api';
import { useSession, logout } from '../../lib/auth';
import { passwordStrengthError } from './helpers';
import PasswordInput from './PasswordInput';
import './auth-screens.css';

const RULES = [
  { key: 'len', label: 'ao menos 10 caracteres', test: (p: string) => p.length >= 10 },
  { key: 'upper', label: '1 letra maiúscula', test: (p: string) => /[A-Z]/.test(p) },
  { key: 'lower', label: '1 letra minúscula', test: (p: string) => /[a-z]/.test(p) },
  { key: 'digit', label: '1 número', test: (p: string) => /[0-9]/.test(p) },
  { key: 'special', label: '1 caracter especial', test: (p: string) => /[^A-Za-z0-9]/.test(p) },
];

export default function ChangePassword() {
  const navigate = useNavigate();
  const { data: user } = useSession();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const isAurum = user?.ciclo_type === 'aurum';

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (next !== confirm) {
      return setError('A nova senha e a confirmação não coincidem.');
    }
    const pwdErr = passwordStrengthError(next);
    if (pwdErr) return setError(pwdErr);

    setBusy(true);
    try {
      await sipApi('/change-password', {
        method: 'POST',
        body: JSON.stringify({ current_password: current, new_password: next }),
        throwOnError: true,
      });
      setSuccess(true);
      window.setTimeout(() => navigate('/', { replace: true }), 800);
    } catch (err) {
      setError(err instanceof SipApiError ? err.message : 'Erro ao trocar a senha.');
      setBusy(false);
    }
  }

  return (
    <div className={`cp-page${isAurum ? ' theme-aurum' : ''}`}>
      <div className="cp-shell">
        <div className="cp-hero">
          <div className="cp-logo">
            <img
              src={isAurum ? '/assets/logo-aurum.png' : '/assets/logo-thb-mark.svg'}
              alt={isAurum ? 'Aurum' : 'Time Holding Brasil'}
            />
          </div>
          <h1>Trocar senha</h1>
          <p>{isAurum ? 'Aurum' : 'Time Holding Brasil'}</p>
        </div>

        <div className="hb-card hb-card-elevated cp-card">
          <h2>Defina sua nova senha</h2>
          <p className="sub">
            Por motivo de segurança, você precisa criar uma senha pessoal antes de continuar.
          </p>

          {error && <div className="cp-error">{error}</div>}
          {success && <div className="cp-success">Senha trocada com sucesso. Redirecionando...</div>}

          <form className="cp-form" onSubmit={onSubmit}>
            <div>
              <label className="hb-label" htmlFor="current_password">Senha atual</label>
              <PasswordInput
                id="current_password"
                value={current}
                onChange={setCurrent}
                autoComplete="current-password"
                placeholder="••••••••"
                required
              />
            </div>
            <div>
              <label className="hb-label" htmlFor="new_password">Nova senha</label>
              <PasswordInput
                id="new_password"
                value={next}
                onChange={setNext}
                autoComplete="new-password"
                placeholder="••••••••"
                required
              />
            </div>
            <div>
              <label className="hb-label" htmlFor="confirm_password">Confirmar nova senha</label>
              <PasswordInput
                id="confirm_password"
                value={confirm}
                onChange={setConfirm}
                autoComplete="new-password"
                placeholder="••••••••"
                required
              />
            </div>

            <div className="pwd-rules">
              <strong>Sua senha precisa ter:</strong>
              <ul>
                {RULES.map((r) => (
                  <li key={r.key} className={r.test(next) ? 'ok' : ''}>
                    {r.label}
                  </li>
                ))}
              </ul>
            </div>

            <button
              type="submit"
              className="hb-btn hb-btn-primary hb-btn-block"
              style={{ marginTop: 6 }}
              disabled={busy}
            >
              {busy ? (
                <>
                  <span className="hb-spinner" /> Trocando...
                </>
              ) : (
                'Trocar senha'
              )}
            </button>
          </form>
        </div>

        <p className="cp-foot">
          <a
            href="#"
            style={{ color: 'var(--text-mute)' }}
            onClick={(e) => {
              e.preventDefault();
              logout();
            }}
          >
            Sair sem trocar
          </a>
        </p>
      </div>
    </div>
  );
}
