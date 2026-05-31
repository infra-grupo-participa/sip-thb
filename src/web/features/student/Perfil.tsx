import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { sipApi, SipApiError } from '../../lib/api';
import { useProfile } from './hooks';

const CICLO_LABELS: Record<string, string> = { aurum: 'Aurum', seminario: 'Seminário' };

interface EditState {
  phone: string;
  city: string;
  profissao: string;
  instagram_handle: string;
  facebook_handle: string;
  youtube_handle: string;
}

function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const [cur, setCur] = useState('');
  const [nw, setNw] = useState('');
  const [cf, setCf] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const checks = {
    len: nw.length >= 10,
    upper: /[A-Z]/.test(nw),
    lower: /[a-z]/.test(nw),
    digit: /\d/.test(nw),
    special: /[^A-Za-z0-9]/.test(nw),
  };
  const change = useMutation({
    mutationFn: () => sipApi('/change-password', { method: 'POST', body: JSON.stringify({ current_password: cur, new_password: nw }), throwOnError: true }),
    onSuccess: onClose,
    onError: (e) => setErr(e instanceof SipApiError ? e.message : 'Erro ao trocar a senha.'),
  });
  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (nw !== cf) return setErr('A nova senha e a confirmação não coincidem.');
    if (!Object.values(checks).every(Boolean)) return setErr('A senha não atende a todos os requisitos.');
    change.mutate();
  }
  const rules: [keyof typeof checks, string][] = [
    ['len', 'ao menos 10 caracteres'],
    ['upper', '1 letra maiúscula'],
    ['lower', '1 letra minúscula'],
    ['digit', '1 número'],
    ['special', '1 caracter especial'],
  ];
  return (
    <div className="modal-backdrop">
      <div className="modal-shell" style={{ maxWidth: 440 }}>
        <div className="modal-head">
          <div className="modal-head-main">
            <div className="modal-head-title-row">
              <h2>Trocar senha</h2>
            </div>
            <p className="modal-head-info">Defina uma nova senha. Você continuará logado.</p>
          </div>
          <button type="button" onClick={onClose} className="modal-close">
            ×
          </button>
        </div>
        <form onSubmit={submit}>
          <div className="modal-pane space-y-4" style={{ paddingTop: 20 }}>
            {err && (
              <div style={{ background: 'var(--red-soft)', border: '1px solid rgba(185,28,28,0.25)', color: 'var(--red)', padding: '10px 14px', borderRadius: 10, fontSize: 13 }}>{err}</div>
            )}
            <div>
              <label className="form-label">Senha atual</label>
              <input type="password" className="form-input" value={cur} onChange={(e) => setCur(e.target.value)} required autoComplete="current-password" />
            </div>
            <div>
              <label className="form-label">Nova senha</label>
              <input type="password" className="form-input" value={nw} onChange={(e) => setNw(e.target.value)} required autoComplete="new-password" />
            </div>
            <div>
              <label className="form-label">Confirmar nova senha</label>
              <input type="password" className="form-input" value={cf} onChange={(e) => setCf(e.target.value)} required autoComplete="new-password" />
            </div>
            <div style={{ background: 'var(--bg-muted)', borderRadius: 10, padding: '12px 14px', fontSize: 12, color: 'var(--text-sub)' }}>
              <strong>Sua senha precisa ter:</strong>
              <ul style={{ margin: '6px 0 0', paddingLeft: 16 }}>
                {rules.map(([k, label]) => (
                  <li key={k} className={checks[k] ? 'ok' : ''} style={{ color: checks[k] ? 'var(--green, #16a34a)' : undefined }}>
                    {label}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="modal-foot">
            <button type="button" onClick={onClose} className="btn-ghost">
              Cancelar
            </button>
            <button type="submit" className="btn-primary" disabled={change.isPending}>
              {change.isPending ? 'Trocando...' : 'Trocar senha'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Editable({ id, label, hint, value, placeholder, onChange }: { id: string; label: string; hint?: string; value: string; placeholder: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label htmlFor={id} style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--text-sub)', marginBottom: 6 }}>
        {label}
        {hint && <span style={{ fontWeight: 400, color: 'var(--text-mute)', marginLeft: 4 }}>{hint}</span>}
      </label>
      <input id={id} type="text" className="hb-input" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function ReadonlyRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px' }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 11, color: 'var(--text-mute)', fontWeight: 500 }}>{label}</div>
        <div style={{ fontSize: 14, color: 'var(--text)', fontWeight: 600, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value || '—'}</div>
      </div>
    </div>
  );
}

export default function Perfil() {
  const profile = useProfile();
  const qc = useQueryClient();
  const [pwModal, setPwModal] = useState(false);
  const [edit, setEdit] = useState<EditState>({ phone: '', city: '', profissao: '', instagram_handle: '', facebook_handle: '', youtube_handle: '' });
  const [saved, setSaved] = useState(false);

  const u = profile.data;
  useEffect(() => {
    if (u && !u.error) {
      setEdit({
        phone: u.phone ?? '',
        city: u.city ?? '',
        profissao: u.profissao ?? '',
        instagram_handle: u.instagram_handle ?? '',
        facebook_handle: u.facebook_handle ?? '',
        youtube_handle: u.youtube_handle ?? '',
      });
    }
  }, [u]);

  const save = useMutation({
    mutationFn: () => sipApi('/me/profile', { method: 'PATCH', body: JSON.stringify(edit), throwOnError: true }),
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      qc.invalidateQueries({ queryKey: ['me-profile'] });
    },
  });

  const set = (k: keyof EditState) => (v: string) => setEdit((s) => ({ ...s, [k]: v }));

  const turmaAurum = u?.is_platina ? 'Platina' : u?.turma_aurum || '—';
  const raioxPct = u?.raiox_score && u?.raiox_max_score ? Math.round((u.raiox_score / u.raiox_max_score) * 100) + '%' : '—';
  const cicloLabel = u?.ciclo_type ? CICLO_LABELS[u.ciclo_type] ?? u.ciclo_type : '—';

  return (
    <div className="space-y-4">
      <div className="hb-card rounded-xl p-5 border" style={{ background: 'var(--bg-card)' }}>
        <h2 className="font-semibold text-lg mb-1">Meus Dados</h2>
        <p className="text-xs mb-4" style={{ color: 'var(--text-mute)' }}>
          Mantenha seus dados atualizados. Campos travados só podem ser alterados pelo admin.
        </p>

        {profile.isLoading ? (
          <p className="text-xs" style={{ color: 'var(--text-mute)' }}>
            Carregando...
          </p>
        ) : (
          <div>
            <section style={{ marginBottom: 28 }}>
              <h3 style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--brand-ink)', margin: '0 0 16px' }}>Editáveis</h3>
              <div className="profile-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: '18px 20px' }}>
                <Editable id="profile-phone" label="Telefone" value={edit.phone} placeholder="(00) 00000-0000" onChange={set('phone')} />
                <Editable id="profile-city" label="Cidade" hint="(formato: Cidade / UF)" value={edit.city} placeholder="Ex.: Rio de Janeiro / RJ" onChange={set('city')} />
                <Editable id="profile-profissao" label="Profissão" value={edit.profissao} placeholder="Ex.: Advogado(a)" onChange={set('profissao')} />
                <Editable id="profile-instagram" label="Perfil no Instagram" value={edit.instagram_handle} placeholder="@usuario" onChange={set('instagram_handle')} />
                <Editable id="profile-facebook" label="Perfil no Facebook" value={edit.facebook_handle} placeholder="@usuario ou link" onChange={set('facebook_handle')} />
                <Editable id="profile-youtube" label="Perfil no YouTube" value={edit.youtube_handle} placeholder="@canal ou link" onChange={set('youtube_handle')} />
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 22, flexWrap: 'wrap', alignItems: 'center' }}>
                <button type="button" onClick={() => save.mutate()} disabled={save.isPending} className="hb-btn hb-btn-primary">
                  {save.isPending ? 'Salvando...' : '✓ Salvar alterações'}
                </button>
                <button type="button" onClick={() => setPwModal(true)} className="hb-btn hb-btn-secondary">
                  🔒 Trocar senha
                </button>
                {saved && <span className="text-xs" style={{ color: 'var(--green, #16a34a)' }}>Dados atualizados.</span>}
              </div>
            </section>

            <div style={{ height: 1, background: 'var(--border-soft, var(--border))', margin: '8px 0 24px' }} />

            <section>
              <h3 style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--brand-ink)', margin: '0 0 14px' }}>
                Informações da conta
                <span style={{ fontWeight: 500, textTransform: 'none', letterSpacing: 0, color: 'var(--text-mute)', marginLeft: 6 }}>(somente leitura)</span>
              </h3>
              <div className="profile-ro-card" style={{ background: 'var(--bg-muted)', border: '1px solid var(--border-soft, var(--border))', borderRadius: 14, padding: 10, display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: '4px 8px' }}>
                <ReadonlyRow label="Nome" value={u?.name ?? null} />
                <ReadonlyRow label="E-mail" value={u?.email ?? null} />
                <ReadonlyRow label="Turma THB" value={u?.turma_thb ?? null} />
                <ReadonlyRow label="Turma Aurum" value={turmaAurum} />
                <ReadonlyRow label="Ciclo" value={cicloLabel} />
                <ReadonlyRow label="Monitor" value={u?.monitor_name ?? null} />
                <ReadonlyRow label="Score Raio-X" value={raioxPct} />
                {u?.nivel && <ReadonlyRow label="Nível" value={u.nivel} />}
              </div>
            </section>
          </div>
        )}
      </div>

      {pwModal && <ChangePasswordModal onClose={() => setPwModal(false)} />}
    </div>
  );
}
