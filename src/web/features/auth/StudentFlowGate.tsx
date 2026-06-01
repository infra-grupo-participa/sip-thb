import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { sipApi, SipApiError } from '../../lib/api';
import type { SessionUser } from '../../lib/auth';
import RaioxForm, { type RaioxAnswers, type RaioxQuestion, validateRaiox } from './RaioxForm';
import '../../legacy/login.css';

// Gate de fluxo do aluno logado (espelha flow.js): e-mail não verificado →
// confirmar código; Raio-X pendente (pré-aprovação) → preencher Raio-X.
// Ao concluir, invalida a sessão para o app seguir.
export default function StudentFlowGate({ user }: { user: SessionUser }) {
  const qc = useQueryClient();
  const refreshSession = () => qc.invalidateQueries({ queryKey: ['session'] });

  if (!user.email_verified) return <VerifyEmail email={user.email} onDone={refreshSession} />;
  return <CompleteRaiox onDone={refreshSession} />;
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="login-page">
      <div className="login-shell">
        <div className="login-hero">
          <div className="login-logo">
            <img src="/assets/logo-thb-mark.svg" alt="Time Holding Brasil" />
          </div>
          <h1>{title}</h1>
          <p>Time Holding Brasil</p>
        </div>
        <div className="hb-card hb-card-elevated login-card">{children}</div>
      </div>
    </div>
  );
}

function VerifyEmail({ email, onDone }: { email: string; onDone: () => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^\d{6}$/.test(code.trim())) return setError('O código deve ter 6 dígitos.');
    setBusy(true);
    try {
      await sipApi('/verify-email-code', { method: 'POST', body: JSON.stringify({ email, code: code.trim() }), throwOnError: true });
      onDone();
    } catch (err) {
      setError(err instanceof SipApiError ? err.message : 'Código inválido ou expirado.');
    } finally {
      setBusy(false);
    }
  }
  async function resend() {
    setError(null);
    setInfo(null);
    try {
      await sipApi('/resend-verification', { method: 'POST', body: JSON.stringify({ email }), throwOnError: true });
      setInfo('Reenviamos o código para seu e-mail.');
    } catch {
      setInfo('Se o e-mail existir, reenviamos o código.');
    }
  }

  return (
    <Shell title="Confirme seu e-mail">
      <h2>Verificação de e-mail</h2>
      <p style={{ fontSize: 13, color: 'var(--text-sub)', marginBottom: 16 }}>
        Enviamos um código de 6 dígitos para <strong>{email}</strong>. Digite-o para liberar seu acesso.
      </p>
      {error && <div className="login-error">{error}</div>}
      {info && <div className="login-error" style={{ background: 'var(--blue-bg)', color: 'var(--text-sub)', borderColor: 'rgba(37,99,235,.25)' }}>{info}</div>}
      <form className="login-form" onSubmit={confirm}>
        <input
          className="hb-input"
          inputMode="numeric"
          maxLength={6}
          placeholder="000000"
          style={{ letterSpacing: '0.3em', fontSize: 20, textAlign: 'center', fontWeight: 700 }}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
        />
        <button className="hb-btn hb-btn-primary hb-btn-block" disabled={busy}>
          {busy ? 'Verificando…' : 'Confirmar código'}
        </button>
        <button type="button" className="hb-btn hb-btn-secondary hb-btn-block" onClick={resend}>
          Reenviar código
        </button>
      </form>
    </Shell>
  );
}

function CompleteRaiox({ onDone }: { onDone: () => void }) {
  const [answers, setAnswers] = useState<RaioxAnswers>({});
  const [errorId, setErrorId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { data: questions, isLoading } = useQuery({
    queryKey: ['raiox-questions'],
    queryFn: () => sipApi<RaioxQuestion[]>('/public/raiox-questions', { throwOnError: true }),
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const qs = questions ?? [];
    const { error: vErr, firstBadId } = validateRaiox(qs, answers);
    if (vErr) {
      setErrorId(firstBadId ?? null);
      return setError(vErr);
    }
    setBusy(true);
    try {
      await sipApi('/me/raiox', { method: 'POST', body: JSON.stringify({ raiox_answers: answers }), throwOnError: true });
      onDone();
    } catch (err) {
      setError(err instanceof SipApiError ? err.message : 'Erro ao enviar o Raio-X.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell title="Diagnóstico inicial (Raio-X)">
      <h2>Complete seu Raio-X</h2>
      <p style={{ fontSize: 13, color: 'var(--text-sub)', marginBottom: 16 }}>
        Responda o diagnóstico para liberar sua trilha. Leva poucos minutos.
      </p>
      {error && <div className="login-error">{error}</div>}
      {isLoading ? (
        <p className="muted">Carregando perguntas…</p>
      ) : (
        <form className="login-form" onSubmit={submit}>
          <RaioxForm questions={questions ?? []} answers={answers} errorId={errorId} onChange={setAnswers} />
          <button className="hb-btn hb-btn-primary hb-btn-block" disabled={busy}>
            {busy ? 'Enviando…' : 'Enviar Raio-X'}
          </button>
        </form>
      )}
    </Shell>
  );
}
