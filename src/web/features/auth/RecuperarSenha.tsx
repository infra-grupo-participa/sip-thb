import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { sipApi, SipApiError } from '../../lib/api';

export default function RecuperarSenha() {
  const navigate = useNavigate();
  const [step, setStep] = useState<1 | 2>(1);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [pwd, setPwd] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function requestCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await sipApi('/forgot-password', { method: 'POST', body: JSON.stringify({ email }), throwOnError: true });
      setInfo('Se o e-mail existir, enviamos um código de 6 dígitos. Verifique sua caixa de entrada.');
      setStep(2);
    } catch (err) {
      setError(err instanceof SipApiError ? err.message : 'Falha ao solicitar o código.');
    } finally {
      setBusy(false);
    }
  }

  async function resetPwd(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await sipApi('/reset-password', {
        method: 'POST',
        body: JSON.stringify({ email, code, new_password: pwd }),
        throwOnError: true,
      });
      navigate('/login', { replace: true });
    } catch (err) {
      setError(err instanceof SipApiError ? err.message : 'Falha ao redefinir a senha.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="shell">
      <form className="card" onSubmit={step === 1 ? requestCode : resetPwd}>
        <div className="brand-bar" />
        <h1>Recuperar senha</h1>
        <p className="muted">
          {step === 1 ? 'Informe seu e-mail para receber um código.' : 'Digite o código recebido e a nova senha.'}
        </p>

        <label className="field">
          <span>E-mail</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required disabled={step === 2} />
        </label>

        {step === 2 && (
          <>
            <label className="field">
              <span>Código (6 dígitos)</span>
              <input inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} required />
            </label>
            <label className="field">
              <span>Nova senha</span>
              <input type="password" autoComplete="new-password" value={pwd} onChange={(e) => setPwd(e.target.value)} required />
            </label>
          </>
        )}

        {info && <div className="alert alert-info">{info}</div>}
        {error && <div className="alert">{error}</div>}

        <button className="btn" type="submit" disabled={busy}>
          {busy ? 'Enviando…' : step === 1 ? 'Enviar código' : 'Redefinir senha'}
        </button>

        <p className="muted center-text">
          <Link to="/login">Voltar para o login</Link>
        </p>
      </form>
    </div>
  );
}
