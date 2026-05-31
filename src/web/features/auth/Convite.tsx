import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { sipApi, SipApiError } from '../../lib/api';
import { passwordStrengthError } from './helpers';
import PasswordInput from './PasswordInput';
import './auth-screens.css';

interface InviteInfo {
  owner_name: string;
  ciclo_type: 'aurum' | 'seminario' | null;
  expires_at: string;
  error?: string;
}

interface AcceptResponse {
  token: string;
  user?: unknown;
  error?: string;
}

type Screen = 'loading' | 'error' | 'invite';
type Tab = 'novo' | 'login';

export default function Convite() {
  const { token } = useParams<{ token: string }>();
  const [screen, setScreen] = useState<Screen>('loading');
  const [errorScreenMsg, setErrorScreenMsg] = useState('');
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [tab, setTab] = useState<Tab>('novo');
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Form novo
  const [novoName, setNovoName] = useState('');
  const [novoEmail, setNovoEmail] = useState('');
  const [novoPassword, setNovoPassword] = useState('');
  // Form login
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  const isAurum = info?.ciclo_type === 'aurum';

  useEffect(() => {
    if (!token) {
      setErrorScreenMsg('Link inválido. Peça um novo convite ao titular.');
      setScreen('error');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const data = await sipApi<InviteInfo>(`/invite/${token}`);
        if (cancelled) return;
        if (!data || data.error) {
          setErrorScreenMsg(data?.error || 'Erro ao verificar convite.');
          setScreen('error');
          return;
        }
        setInfo(data);
        setScreen('invite');
      } catch {
        if (cancelled) return;
        setErrorScreenMsg('Erro ao verificar convite. Tente novamente.');
        setScreen('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function acceptInvite(mode: Tab) {
    setFormError(null);
    const body: Record<string, string> = { mode };
    if (mode === 'novo') {
      body.name = novoName.trim();
      body.email = novoEmail.trim();
      body.password = novoPassword;
      if (!body.name || body.name.length < 2) return setFormError('Informe seu nome completo.');
      if (!body.email) return setFormError('Informe seu e-mail.');
      const pwdErr = passwordStrengthError(body.password);
      if (pwdErr) return setFormError(pwdErr);
    } else {
      body.email = loginEmail.trim();
      body.password = loginPassword;
      if (!body.email) return setFormError('Informe seu e-mail.');
      if (!body.password) return setFormError('Informe sua senha.');
    }

    setBusy(true);
    try {
      const data = await sipApi<AcceptResponse>(`/invite/${token}/accept`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (!data || data.error) throw new Error(data?.error || 'Erro ao aceitar convite');
      if (data.token) localStorage.setItem('sip_token', data.token);
      window.setTimeout(() => window.location.assign('/'), 400);
    } catch (err) {
      setFormError(err instanceof SipApiError ? err.message : (err as Error).message || 'Erro ao aceitar convite');
      setBusy(false);
    }
  }

  if (screen === 'loading') {
    return (
      <div className="invite-page">
        <div className="loading-pill">
          <span className="hb-spinner" /> Verificando convite...
        </div>
      </div>
    );
  }

  if (screen === 'error') {
    return (
      <div className="invite-page">
        <div className="invite-shell invite-error-screen">
          <span className="icon">!</span>
          <h1>Convite inválido</h1>
          <p>{errorScreenMsg}</p>
          <a href="/login" className="invite-link">Ir para o login →</a>
        </div>
      </div>
    );
  }

  const expires = info ? new Date(info.expires_at).toLocaleDateString('pt-BR') : '';

  return (
    <div className={`invite-page${isAurum ? ' theme-aurum' : ''}`}>
      <div className="invite-shell">
        <div className="invite-hero">
          <div className="invite-logo">
            <img
              src={isAurum ? '/assets/logo-aurum.png' : '/assets/logo-thb-mark.svg'}
              alt={isAurum ? 'Aurum' : 'Time Holding Brasil'}
            />
          </div>
          <h1>Você foi convidado!</h1>
          <p>
            <span className="invite-owner">{info?.owner_name}</span> te convidou para ser sócio no ciclo{' '}
            <span className="invite-ciclo">{isAurum ? 'Aurum' : 'Diamante'}</span>.
          </p>
          <p className="invite-meta">Convite válido até {expires}</p>
        </div>

        <div className="hb-card hb-card-elevated">
          <div className="invite-tabs">
            <button
              type="button"
              className={`invite-tab${tab === 'novo' ? ' is-active' : ''}`}
              onClick={() => {
                setTab('novo');
                setFormError(null);
              }}
            >
              Criar conta
            </button>
            <button
              type="button"
              className={`invite-tab${tab === 'login' ? ' is-active' : ''}`}
              onClick={() => {
                setTab('login');
                setFormError(null);
              }}
            >
              Já tenho conta
            </button>
          </div>

          <div className="invite-body">
            {formError && <div className="invite-error">{formError}</div>}

            {tab === 'novo' ? (
              <form
                style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
                onSubmit={(e) => {
                  e.preventDefault();
                  acceptInvite('novo');
                }}
              >
                <div>
                  <label className="hb-label" htmlFor="novo-name">Seu nome</label>
                  <input
                    type="text"
                    id="novo-name"
                    className="hb-input"
                    placeholder="Nome completo"
                    autoComplete="name"
                    value={novoName}
                    onChange={(e) => setNovoName(e.target.value)}
                  />
                </div>
                <div>
                  <label className="hb-label" htmlFor="novo-email">E-mail</label>
                  <input
                    type="email"
                    id="novo-email"
                    className="hb-input"
                    placeholder="seu@email.com"
                    autoComplete="email"
                    value={novoEmail}
                    onChange={(e) => setNovoEmail(e.target.value)}
                  />
                </div>
                <div>
                  <label className="hb-label" htmlFor="novo-password">Senha</label>
                  <PasswordInput
                    id="novo-password"
                    value={novoPassword}
                    onChange={setNovoPassword}
                    autoComplete="new-password"
                    placeholder="••••••••"
                  />
                  <small style={{ color: 'var(--text-mute)', fontSize: 11, display: 'block', marginTop: 4 }}>
                    10+ caracteres, com maiúscula, minúscula, número e caracter especial.
                  </small>
                </div>
                <button
                  type="submit"
                  className="hb-btn hb-btn-primary hb-btn-block"
                  style={{ marginTop: 4 }}
                  disabled={busy}
                >
                  {busy ? (
                    <>
                      <span className="hb-spinner" /> Aguarde...
                    </>
                  ) : (
                    'Criar conta e entrar'
                  )}
                </button>
              </form>
            ) : (
              <form
                style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
                onSubmit={(e) => {
                  e.preventDefault();
                  acceptInvite('login');
                }}
              >
                <div>
                  <label className="hb-label" htmlFor="login-email">E-mail da sua conta</label>
                  <input
                    type="email"
                    id="login-email"
                    className="hb-input"
                    placeholder="seu@email.com"
                    autoComplete="email"
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                  />
                </div>
                <div>
                  <label className="hb-label" htmlFor="login-password">Senha</label>
                  <PasswordInput
                    id="login-password"
                    value={loginPassword}
                    onChange={setLoginPassword}
                    autoComplete="current-password"
                    placeholder="••••••••"
                  />
                </div>
                <button
                  type="submit"
                  className="hb-btn hb-btn-primary hb-btn-block"
                  style={{ marginTop: 4 }}
                  disabled={busy}
                >
                  {busy ? (
                    <>
                      <span className="hb-spinner" /> Aguarde...
                    </>
                  ) : (
                    'Entrar e aceitar convite'
                  )}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
