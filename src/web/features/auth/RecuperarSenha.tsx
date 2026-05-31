import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { sipApi, SipApiError } from '../../lib/api';
import { passwordStrengthError } from './helpers';
import PasswordInput from './PasswordInput';
import '../../legacy/login.css';

// Recuperação de senha — paridade com o fluxo legado embutido em index.html.
// Contrato: 2 chamadas ao servidor (POST /forgot-password, POST /reset-password).
// UX em 3 passos: e-mail → confirmar código (validação só no cliente) → nova senha.
type Step = 1 | 2 | 3;

export default function RecuperarSenha() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>(1);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [pwd, setPwd] = useState('');
  const [pwd2, setPwd2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) return setError('Informe seu e-mail.');
    setBusy(true);
    try {
      // Anti-enumeração: o servidor sempre responde ok. Avançamos sempre.
      await sipApi('/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: cleanEmail }),
        throwOnError: true,
      });
      setEmail(cleanEmail);
      setInfo(`Se houver uma conta para ${cleanEmail}, enviamos um código de 6 dígitos. Verifique também o spam.`);
      setStep(2);
    } catch (err) {
      setError(err instanceof SipApiError ? err.message : 'Erro ao enviar código. Tente novamente.');
    } finally {
      setBusy(false);
    }
  }

  function confirmCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^\d{6}$/.test(code.trim())) {
      return setError('O código deve ter exatamente 6 dígitos numéricos.');
    }
    setInfo(null);
    setStep(3);
  }

  async function submitReset(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!pwd || !pwd2) return setError('Preencha os dois campos de senha.');
    if (pwd !== pwd2) return setError('As senhas não coincidem.');
    const pwdErr = passwordStrengthError(pwd);
    if (pwdErr) return setError(pwdErr);

    setBusy(true);
    try {
      await sipApi('/reset-password', {
        method: 'POST',
        body: JSON.stringify({ email, code: code.trim(), new_password: pwd }),
        throwOnError: true,
      });
      navigate('/login', { replace: true, state: { notice: 'Senha redefinida com sucesso! Faça login com sua nova senha.' } });
    } catch (err) {
      setError(err instanceof SipApiError ? err.message : 'Erro ao redefinir senha. Verifique o código e tente novamente.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-shell">
        <div className="login-hero">
          <div className="login-logo">
            <img src="/assets/logo-thb-mark.svg" alt="Time Holding Brasil" />
          </div>
          <h1>Recuperar senha</h1>
          <p>Time Holding Brasil</p>
        </div>

        <div className="hb-card hb-card-elevated login-card">
          <h2>
            {step === 1 ? 'Esqueci minha senha' : step === 2 ? 'Confirme o código' : 'Defina a nova senha'}
          </h2>

          {error && <div className="login-error">{error}</div>}
          {info && step !== 1 && (
            <div
              className="login-error"
              style={{ background: 'var(--blue-bg, #eff6ff)', borderColor: 'rgba(37,99,235,.25)', color: 'var(--text-sub)' }}
            >
              {info}
            </div>
          )}

          {step === 1 && (
            <form className="login-form" onSubmit={sendCode}>
              <p style={{ fontSize: 13, color: 'var(--text-sub)', margin: 0 }}>
                Informe seu e-mail para receber um código de 6 dígitos.
              </p>
              <div>
                <label className="hb-label" htmlFor="rs-email">E-mail</label>
                <input
                  type="email"
                  id="rs-email"
                  className="hb-input"
                  required
                  autoComplete="email"
                  placeholder="seu@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <button type="submit" className="hb-btn hb-btn-primary hb-btn-block" disabled={busy}>
                {busy ? 'Enviando…' : 'Enviar código'}
              </button>
            </form>
          )}

          {step === 2 && (
            <form className="login-form" onSubmit={confirmCode}>
              <p style={{ fontSize: 13, color: 'var(--text-sub)', margin: 0 }}>
                Enviamos um código de 6 dígitos para <strong>{email}</strong>.
              </p>
              <div>
                <label className="hb-label" htmlFor="rs-code">Código de verificação</label>
                <input
                  type="text"
                  id="rs-code"
                  className="hb-input"
                  inputMode="numeric"
                  maxLength={6}
                  autoComplete="one-time-code"
                  placeholder="000000"
                  style={{ letterSpacing: '0.3em', fontSize: 20, textAlign: 'center', fontWeight: 700 }}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                />
              </div>
              <button type="submit" className="hb-btn hb-btn-primary hb-btn-block">
                Confirmar código
              </button>
              <button
                type="button"
                className="hb-btn hb-btn-secondary hb-btn-block"
                onClick={() => {
                  setStep(1);
                  setError(null);
                }}
              >
                ← Trocar e-mail
              </button>
            </form>
          )}

          {step === 3 && (
            <form className="login-form" onSubmit={submitReset}>
              <div>
                <label className="hb-label" htmlFor="rs-pwd">Nova senha</label>
                <PasswordInput id="rs-pwd" value={pwd} onChange={setPwd} autoComplete="new-password" required />
                <small style={{ fontSize: 11, color: 'var(--text-mute)', display: 'block', marginTop: 4 }}>
                  10+ caracteres, com maiúscula, minúscula, número e caracter especial.
                </small>
              </div>
              <div>
                <label className="hb-label" htmlFor="rs-pwd2">Confirmar nova senha</label>
                <PasswordInput id="rs-pwd2" value={pwd2} onChange={setPwd2} autoComplete="new-password" required />
              </div>
              <button type="submit" className="hb-btn hb-btn-primary hb-btn-block" disabled={busy}>
                {busy ? 'Redefinindo…' : 'Redefinir senha'}
              </button>
            </form>
          )}

          <div style={{ textAlign: 'center', marginTop: 14 }}>
            <Link to="/login" style={{ fontSize: 13, color: 'var(--text-mute)', textDecoration: 'underline' }}>
              Voltar para o login
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
