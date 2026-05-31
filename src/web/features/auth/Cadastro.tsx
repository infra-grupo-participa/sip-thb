import { useEffect, useMemo, useRef, useState } from 'react';
import { sipApi, SipApiError } from '../../lib/api';
import {
  PROFISSOES,
  UF_LIST,
  loadCitiesForUf,
  maskPhone,
  passwordStrength,
  passwordStrengthError,
  sanitizeText,
  validateCity,
  validateEmail,
  validateName,
  validatePassword2,
  validatePhone,
  validateUf,
} from './helpers';
import Combobox from './Combobox';
import PasswordInput from './PasswordInput';
import RaioxForm, { RaioxAnswers, RaioxQuestion, validateRaiox } from './RaioxForm';
import './auth-screens.css';

type Step = 1 | 2 | 3 | 4;
type Interesse = 'palestra' | 'seminario';
type HintKind = 'error' | 'ok' | null;

interface FieldHint {
  msg: string;
  kind: HintKind;
}

interface RegisterData {
  name: string;
  email: string;
  phone: string;
  city: string;
  password: string;
  interesse_ciclo: Interesse;
  profissao: string | null;
  turma_aurum: string | null;
  turma_thb: string;
}

interface RegisterResponse {
  token: string;
  user?: unknown;
}

const RESEND_DELAYS = [60, 300, 900];

export default function Cadastro() {
  const [step, setStep] = useState<Step>(1);
  const [error, setError] = useState<string | null>(null);

  // Step 1 fields
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [uf, setUf] = useState('');
  const [city, setCity] = useState('');
  const [profissao, setProfissao] = useState('');
  const [turmaThb, setTurmaThb] = useState('');
  const [turmaAurum, setTurmaAurum] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [interesse, setInteresse] = useState<Interesse>('palestra');
  const [hints, setHints] = useState<Record<string, FieldHint>>({});

  const [cities, setCities] = useState<string[]>([]);
  const [cityLoading, setCityLoading] = useState(false);

  // Step 2 (OTP)
  const [code, setCode] = useState('');
  const [checking, setChecking] = useState(false);
  const [emailVerified, setEmailVerified] = useState(false);
  const [resendCount, setResendCount] = useState(0);
  const [resendCooldown, setResendCooldown] = useState(0);
  const resendTimer = useRef<number | null>(null);

  // Step 3 (Raio-X)
  const [questions, setQuestions] = useState<RaioxQuestion[]>([]);
  const [answers, setAnswers] = useState<RaioxAnswers>({});
  const [raioxErrorId, setRaioxErrorId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isAurum = interesse === 'palestra';

  // Tema visual por interesse de ciclo (cosmético).
  const pageClass = `reg-page${isAurum ? ' theme-aurum' : ''}`;
  const logoSrc = isAurum ? '/assets/logo-aurum.png' : '/assets/logo-thb-mark.svg';
  const heroSub = isAurum
    ? 'Sistema de Integração e Progressão · Aurum'
    : interesse === 'seminario'
      ? 'Sistema de Integração e Progressão · Diamante'
      : 'Sistema de Integração e Progressão · Time Holding Brasil';

  const turmasThb = useMemo(() => Array.from({ length: 38 }, (_, i) => `T${i + 1}`), []);
  const turmasAurum = useMemo(() => Array.from({ length: 9 }, (_, i) => `A${i + 1}`), []);

  const validCities = useMemo(() => new Set(cities.map((c) => c.toLowerCase())), [cities]);

  useEffect(() => {
    return () => {
      if (resendTimer.current) window.clearInterval(resendTimer.current);
    };
  }, []);

  function setHint(id: string, msg: string, kind: HintKind) {
    setHints((h) => ({ ...h, [id]: { msg, kind } }));
  }
  function hintClass(id: string): string {
    const k = hints[id]?.kind;
    return 'reg-hint' + (k === 'error' ? ' is-error' : k === 'ok' ? ' is-ok' : '');
  }
  function inputClass(id: string): string {
    const k = hints[id]?.kind;
    return 'hb-input' + (k === 'error' ? ' is-invalid' : k === 'ok' ? ' is-valid' : '');
  }

  async function onUfChange(nextUf: string) {
    setUf(nextUf);
    const err = validateUf(nextUf);
    setHint('uf', err ?? '', err ? 'error' : nextUf ? 'ok' : null);
    setCity('');
    setCities([]);
    if (!nextUf) return;
    setCityLoading(true);
    const names = await loadCitiesForUf(nextUf);
    setCities(names);
    setCityLoading(false);
  }

  const strength = passwordStrength(password);
  const meterWidth = password ? Math.max(8, (strength.score + 1) * 20) : 0;

  async function onSubmitStep1(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const cleanName = sanitizeText(name, 100);
    const cleanEmail = email.trim().toLowerCase().slice(0, 120);
    const cleanCity = sanitizeText(city, 80);
    const cleanProf = sanitizeText(profissao, 80);
    setName(cleanName);
    setEmail(cleanEmail);
    setCity(cleanCity);

    const checks: Array<[string, string | null]> = [
      ['name', validateName(cleanName)],
      ['email', validateEmail(cleanEmail)],
      ['phone', validatePhone(phone)],
      ['uf', validateUf(uf)],
      ['city', validateCity(cleanCity)],
    ];
    for (const [id, err] of checks) {
      if (err) {
        setHint(id, err, 'error');
        setError(err);
        return;
      }
    }
    if (validCities.size > 0 && !validCities.has(cleanCity.toLowerCase())) {
      setHint('city', 'Selecione uma cidade da lista.', 'error');
      setError('Selecione uma cidade da lista.');
      return;
    }
    const pwdErr = passwordStrengthError(password);
    if (pwdErr) {
      setHint('password', pwdErr, 'error');
      setError(pwdErr);
      return;
    }
    const pwd2Err = validatePassword2(password, password2);
    if (pwd2Err) {
      setHint('password2', pwd2Err, 'error');
      setError(pwd2Err);
      return;
    }
    if (cleanProf && !/^[\p{L}][\p{L}\s.'\-/()]{0,79}$/u.test(cleanProf)) {
      setHint('profissao', 'Caracteres inválidos.', 'error');
      setError('Profissão contém caracteres inválidos.');
      return;
    }
    if (!turmaThb) {
      setError('Selecione sua turma THB.');
      return;
    }

    const data: RegisterData = {
      name: cleanName,
      email: cleanEmail,
      phone: phone.trim().slice(0, 16),
      city: `${cleanCity} / ${uf}`,
      password,
      interesse_ciclo: interesse,
      profissao: cleanProf || null,
      turma_aurum: turmaAurum || null,
      turma_thb: turmaThb,
    };
    registerDataRef.current = data;

    // Pré-cadastro (dispara e-mail de verificação). Só avança se confirmar.
    try {
      await sipApi('/register/pre', { method: 'POST', body: JSON.stringify(data), throwOnError: true });
    } catch (err) {
      const msg = err instanceof SipApiError ? err.message : '';
      if (msg.includes('já está cadastrado e verificado') || msg.includes('já está em uso')) {
        return setError('Este e-mail já está cadastrado. Faça login ou use outro e-mail.');
      }
      if (err instanceof SipApiError && err.status === 429) {
        return setError('Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.');
      }
      return setError('Não foi possível iniciar o cadastro agora. Tente novamente em instantes.');
    }
    setStep(2);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const registerDataRef = useRef<RegisterData | null>(null);

  async function loadQuestionsAndAdvance() {
    setChecking(true);
    try {
      if (questions.length === 0) {
        const qs = await sipApi<RaioxQuestion[]>(`/public/raiox-questions?ciclo=${interesse}`, {
          throwOnError: true,
        });
        if (!Array.isArray(qs)) throw new Error('Resposta inválida');
        setQuestions(qs);
      }
      setStep(3);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch {
      setError(
        'E-mail confirmado! Só não conseguimos carregar o Raio-X agora. Toque em "Continuar para o Raio-X" para tentar novamente.',
      );
    } finally {
      setChecking(false);
    }
  }

  async function onVerifyCode() {
    if (emailVerified) {
      setError(null);
      return loadQuestionsAndAdvance();
    }
    if (!/^\d{6}$/.test(code.trim())) {
      return setError('Digite o código de 6 dígitos enviado por e-mail.');
    }
    setChecking(true);
    let data: { success?: boolean; error?: string } | null = null;
    try {
      data = await sipApi<{ success?: boolean; error?: string }>('/verify-email-code', {
        method: 'POST',
        body: JSON.stringify({ email: registerDataRef.current?.email, code: code.trim() }),
      });
    } catch {
      setChecking(false);
      return setError('Não foi possível verificar agora. Tente novamente.');
    }
    if (!data || !data.success) {
      setChecking(false);
      return setError(data?.error || 'Código inválido.');
    }
    setEmailVerified(true);
    setError(null);
    await loadQuestionsAndAdvance();
  }

  function startResendCooldown(seconds: number) {
    setResendCooldown(seconds);
    if (resendTimer.current) window.clearInterval(resendTimer.current);
    resendTimer.current = window.setInterval(() => {
      setResendCooldown((r) => {
        if (r <= 1) {
          if (resendTimer.current) window.clearInterval(resendTimer.current);
          return 0;
        }
        return r - 1;
      });
    }, 1000);
  }

  async function onResend() {
    if (resendCount >= RESEND_DELAYS.length) return;
    try {
      const res = await sipApi<{ error?: string }>('/resend-verification', {
        method: 'POST',
        body: JSON.stringify({ email: registerDataRef.current?.email }),
      });
      if (res && res.error) return setError(res.error);
      const delay = RESEND_DELAYS[resendCount] ?? RESEND_DELAYS[RESEND_DELAYS.length - 1] ?? 60;
      setResendCount((c) => c + 1);
      startResendCooldown(delay);
    } catch {
      setError('Não foi possível reenviar. Tente novamente.');
    }
  }

  async function onSubmitRaiox() {
    setError(null);
    setRaioxErrorId(null);
    const { error: vErr, firstBadId } = validateRaiox(questions, answers);
    if (vErr) {
      setRaioxErrorId(firstBadId);
      return setError(vErr);
    }
    setSubmitting(true);
    try {
      const data = await sipApi<RegisterResponse>('/register', {
        method: 'POST',
        body: JSON.stringify({ ...registerDataRef.current, raiox_answers: answers }),
        throwOnError: true,
      });
      if (data?.token) localStorage.setItem('sip_token', data.token);
      setStep(4);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setError(err instanceof SipApiError ? err.message : 'Falha ao finalizar o cadastro.');
      setSubmitting(false);
    }
  }

  const resendDisabled = resendCooldown > 0 || resendCount >= RESEND_DELAYS.length;
  const resendLabel =
    resendCount >= RESEND_DELAYS.length
      ? 'Limite de reenvios atingido. Contate o suporte.'
      : resendCooldown > 0
        ? `Reenviar novamente em ${resendCooldown}s`
        : 'Reenviar código';

  return (
    <div className={pageClass}>
      <div className="reg-shell">
        <div className="reg-hero">
          <div className="reg-logo">
            <img src={logoSrc} alt="Time Holding Brasil" />
          </div>
          <h1>{step === 3 ? 'Raio-X' : 'Criar conta'}</h1>
          <p>{heroSub}</p>
        </div>

        {error && <div className="reg-error">{error}</div>}

        {/* STEP 1 */}
        {step === 1 && (
          <div className="step-panel">
            <div className="hb-card hb-card-elevated reg-card">
              <h2>Cadastro de aluno</h2>
              <p className="reg-sub">Preencha seus dados para começar.</p>

              <form className="reg-form" onSubmit={onSubmitStep1} noValidate>
                <div>
                  <label className="hb-label" htmlFor="name">Nome completo</label>
                  <input
                    type="text"
                    id="name"
                    className={inputClass('name')}
                    required
                    placeholder="João da Silva"
                    autoComplete="name"
                    minLength={3}
                    maxLength={100}
                    autoCapitalize="words"
                    spellCheck={false}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onBlur={() => {
                      const v = sanitizeText(name, 100);
                      setName(v);
                      const err = validateName(v);
                      setHint('name', err ?? '', err ? 'error' : v ? 'ok' : null);
                    }}
                  />
                  <small className={hintClass('name')}>{hints['name']?.msg ?? ''}</small>
                </div>

                <div className="reg-row">
                  <div>
                    <label className="hb-label" htmlFor="email">E-mail</label>
                    <input
                      type="email"
                      id="email"
                      className={inputClass('email')}
                      required
                      placeholder="seu@email.com"
                      autoComplete="email"
                      maxLength={120}
                      inputMode="email"
                      autoCapitalize="off"
                      spellCheck={false}
                      value={email}
                      onChange={(e) => setEmail(e.target.value.replace(/\s/g, '').slice(0, 120))}
                      onBlur={() => {
                        const v = email.toLowerCase().trim();
                        setEmail(v);
                        const err = validateEmail(v);
                        setHint('email', err ?? '', err ? 'error' : v ? 'ok' : null);
                      }}
                    />
                    <small className={hintClass('email')}>{hints['email']?.msg ?? ''}</small>
                  </div>
                  <div>
                    <label className="hb-label" htmlFor="phone">Celular (WhatsApp)</label>
                    <input
                      type="tel"
                      id="phone"
                      className={inputClass('phone')}
                      required
                      placeholder="(11) 99999-9999"
                      autoComplete="tel"
                      maxLength={15}
                      inputMode="numeric"
                      value={phone}
                      onChange={(e) => {
                        const masked = maskPhone(e.target.value);
                        setPhone(masked);
                        const err = validatePhone(masked);
                        setHint('phone', err ?? '', err ? 'error' : masked ? 'ok' : null);
                      }}
                    />
                    <small className={hintClass('phone')}>{hints['phone']?.msg ?? '11 dígitos com DDD.'}</small>
                  </div>
                </div>

                <div className="reg-row reg-row-loc">
                  <div>
                    <label className="hb-label" htmlFor="uf">UF</label>
                    <select
                      id="uf"
                      className={`${inputClass('uf')} hb-select-uf`}
                      required
                      value={uf}
                      onChange={(e) => onUfChange(e.target.value)}
                    >
                      <option value="">UF</option>
                      {UF_LIST.map((u) => (
                        <option key={u} value={u}>{u}</option>
                      ))}
                    </select>
                    <small className={hintClass('uf')}>{hints['uf']?.msg ?? ''}</small>
                  </div>
                  <div>
                    <label className="hb-label" htmlFor="city">Cidade</label>
                    <Combobox
                      id="city"
                      value={city}
                      options={cities}
                      disabled={!uf}
                      maxLength={80}
                      placeholder={
                        !uf
                          ? 'Selecione a UF primeiro'
                          : cityLoading
                            ? 'Carregando municípios…'
                            : `Digite ou escolha (${cities.length} cidades)`
                      }
                      onChange={setCity}
                      onCommit={(v) => {
                        const cleaned = sanitizeText(v, 80);
                        if (cleaned !== v) setCity(cleaned);
                        let err = validateCity(cleaned);
                        if (!err && validCities.size > 0 && !validCities.has(cleaned.toLowerCase())) {
                          err = 'Selecione uma cidade da lista.';
                        }
                        setHint('city', err ?? '', err ? 'error' : cleaned ? 'ok' : null);
                      }}
                    />
                    <small className={hintClass('city')}>{hints['city']?.msg ?? ''}</small>
                  </div>
                </div>

                <div className="reg-row">
                  <div>
                    <label className="hb-label" htmlFor="profissao">Profissão</label>
                    <Combobox
                      id="profissao"
                      value={profissao}
                      options={PROFISSOES}
                      maxLength={80}
                      placeholder="Ex: Médico, Advogado, Coach…"
                      onChange={setProfissao}
                      onCommit={(v) => {
                        const cleaned = sanitizeText(v, 80);
                        if (cleaned !== v) setProfissao(cleaned);
                        if (!cleaned) {
                          setHint('profissao', '', null);
                        } else if (!/^[\p{L}][\p{L}\s.'\-/()]{0,79}$/u.test(cleaned)) {
                          setHint('profissao', 'Caracteres inválidos.', 'error');
                        } else {
                          setHint('profissao', 'OK', 'ok');
                        }
                      }}
                    />
                    <small className={hintClass('profissao')}>
                      {hints['profissao']?.msg ?? 'Pode escolher da lista ou digitar livremente.'}
                    </small>
                  </div>
                </div>

                <div className="reg-row">
                  <div>
                    <label className="hb-label" htmlFor="turma_thb">
                      Turma THB <span style={{ color: '#b91c1c' }}>*</span>
                    </label>
                    <select
                      id="turma_thb"
                      className="hb-input"
                      required
                      value={turmaThb}
                      onChange={(e) => setTurmaThb(e.target.value)}
                    >
                      <option value="">Selecione sua turma...</option>
                      {turmasThb.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                    <small className="reg-hint">Sua turma original do THB.</small>
                  </div>
                  <div>
                    <label className="hb-label" htmlFor="turma_aurum">Turma Aurum</label>
                    <select
                      id="turma_aurum"
                      className="hb-input"
                      value={turmaAurum}
                      onChange={(e) => setTurmaAurum(e.target.value)}
                    >
                      <option value="">Não faço parte do Aurum</option>
                      {turmasAurum.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                    <small className="reg-hint">Opcional. Preencha se você passou no Aurum.</small>
                  </div>
                </div>

                <div className="reg-row">
                  <div>
                    <label className="hb-label" htmlFor="password">Senha</label>
                    <PasswordInput
                      id="password"
                      value={password}
                      onChange={setPassword}
                      autoComplete="new-password"
                      required
                    />
                    <div className="pwd-meter" aria-hidden="true">
                      <div
                        className="pwd-meter-bar"
                        style={{ width: `${meterWidth}%`, background: strength.color }}
                      />
                    </div>
                    <small className={hintClass('password')}>
                      {password
                        ? passwordStrengthError(password) || `Força: ${strength.label}`
                        : '10+ caracteres, com maiúscula, minúscula, número e especial.'}
                    </small>
                  </div>
                  <div>
                    <label className="hb-label" htmlFor="password2">Confirmar senha</label>
                    <PasswordInput
                      id="password2"
                      value={password2}
                      onChange={setPassword2}
                      autoComplete="new-password"
                      required
                    />
                    <small className={hintClass('password2')}>
                      {password2
                        ? validatePassword2(password, password2) || 'Senhas conferem ✓'
                        : ''}
                    </small>
                  </div>
                </div>

                <div>
                  <label className="hb-label">Modelo de interesse</label>
                  <div className="reg-cycle">
                    <label>
                      <input
                        type="radio"
                        name="interesse_ciclo"
                        value="palestra"
                        checked={interesse === 'palestra'}
                        onChange={() => setInteresse('palestra')}
                      />
                      <span className="cycle-title">Palestra</span>
                      <span className="cycle-desc">Pretendo realizar lançamentos no formato palestra.</span>
                    </label>
                    <label>
                      <input
                        type="radio"
                        name="interesse_ciclo"
                        value="seminario"
                        checked={interesse === 'seminario'}
                        onChange={() => setInteresse('seminario')}
                      />
                      <span className="cycle-title">Seminário</span>
                      <span className="cycle-desc">Pretendo realizar lançamentos no formato seminário.</span>
                    </label>
                  </div>
                  <small className="reg-hint">O administrador confirma o seu programa após análise.</small>
                </div>

                <button type="submit" className="hb-btn hb-btn-primary hb-btn-block" style={{ marginTop: 6 }}>
                  Continuar para o Raio-X →
                </button>
              </form>
            </div>
            <p className="reg-foot">
              Já tem conta? <a href="/login">Entrar na plataforma</a>
            </p>
          </div>
        )}

        {/* STEP 2 — OTP */}
        {step === 2 && (
          <div className="step-panel">
            <div className="hb-card hb-card-elevated reg-card otp-card">
              <div className="otp-icon" aria-hidden="true">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="5" width="18" height="14" rx="2" />
                  <path d="m3 7 9 6 9-6" />
                </svg>
              </div>
              <h2>Confirme seu e-mail</h2>
              <p className="reg-sub">
                Enviamos um código de 6 dígitos para <strong>{registerDataRef.current?.email}</strong>.
              </p>

              <div className="otp-input-wrap">
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="\d{6}"
                  maxLength={6}
                  autoComplete="one-time-code"
                  placeholder="– – – – – –"
                  aria-label="Código de 6 dígitos"
                  disabled={emailVerified}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') onVerifyCode();
                  }}
                />
              </div>

              {checking && (
                <div className="otp-checking">
                  <div className="otp-spinner" aria-hidden="true" />
                  <p>Verificando código…</p>
                </div>
              )}

              <div className="otp-actions">
                <button
                  type="button"
                  className="hb-btn hb-btn-primary hb-btn-block"
                  disabled={checking}
                  onClick={onVerifyCode}
                >
                  {emailVerified ? 'Continuar para o Raio-X' : 'Confirmar código'}
                </button>
                <button
                  type="button"
                  className="hb-btn hb-btn-secondary hb-btn-block"
                  disabled={emailVerified || resendDisabled}
                  onClick={onResend}
                >
                  {resendLabel}
                </button>
              </div>
              <p className="otp-hint">O código expira em 10 minutos. Confira também a caixa de spam.</p>
            </div>
          </div>
        )}

        {/* STEP 3 — Raio-X */}
        {step === 3 && (
          <div className="step-panel">
            <div className="hb-card hb-card-elevated reg-card">
              <h2>Raio-X — Diagnóstico inicial</h2>
              <p className="reg-sub">
                Responda com sinceridade — esses dados nos ajudam a priorizar o seu acompanhamento.
              </p>

              <div className="raiox-info">
                <span className="icon">i</span>
                <span>
                  Responda com sinceridade — diferentes formatos abaixo. Os campos com asterisco (*) são
                  obrigatórios. As redes sociais são opcionais.
                </span>
              </div>

              <RaioxForm
                questions={questions}
                answers={answers}
                errorId={raioxErrorId}
                onChange={setAnswers}
              />

              <div className="reg-actions">
                <button
                  type="button"
                  className="hb-btn hb-btn-secondary"
                  onClick={() => setStep(2)}
                >
                  ← Voltar
                </button>
                <button
                  type="button"
                  className="hb-btn hb-btn-primary"
                  disabled={submitting}
                  onClick={onSubmitRaiox}
                >
                  {submitting ? (
                    <>
                      <span className="hb-spinner" /> Enviando...
                    </>
                  ) : (
                    'Finalizar cadastro'
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* STEP 4 — Sucesso */}
        {step === 4 && (
          <div className="step-panel">
            <div className="hb-card hb-card-elevated done-card">
              <div className="done-icon">✓</div>
              <h2>Cadastro concluído!</h2>
              <p>
                Seu Raio-X foi recebido. Aguarde o administrador liberar seu acesso — você será notificado por
                e-mail.
              </p>
              <button
                type="button"
                className="hb-btn hb-btn-primary hb-btn-block"
                onClick={() => window.location.assign('/')}
              >
                Ir para o painel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
