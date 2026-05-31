import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { sipApi, SipApiError } from '../../lib/api';
import { useSession } from '../../lib/auth';
import { useInvite } from './hooks';

export default function SocioCard() {
  const { data: user } = useSession();
  const invite = useInvite();
  const qc = useQueryClient();
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const generate = useMutation({
    mutationFn: () => sipApi<{ invite: { token: string; expires_at: string } }>('/me/invite', { method: 'POST', throwOnError: true }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me-invite'] }),
    onError: (e) => setErr(e instanceof SipApiError ? e.message : 'Erro ao gerar convite.'),
  });
  const remove = useMutation({
    mutationFn: () => sipApi('/me/invite', { method: 'DELETE', throwOnError: true }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me-invite'] }),
  });

  // Sócio (não titular) não vê o card de gestão
  if (user?.is_socio) {
    return <p className="text-sm" style={{ color: 'var(--text-mute)' }}>Você participa como sócio. Tudo é compartilhado com o titular.</p>;
  }

  const data = invite.data;
  const link = data?.pending_invite ? `${location.origin}/convite?token=${data.pending_invite.token}` : null;

  function copy() {
    if (!link) return;
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  if (invite.isLoading) return <p className="text-xs" style={{ color: 'var(--text-mute)' }}>Carregando…</p>;

  if (data?.socio) {
    return (
      <div>
        <div className="flex items-center gap-3 rounded-xl p-4 mb-3" style={{ background: 'var(--bg-muted)' }}>
          <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-400 font-bold text-sm flex-shrink-0">
            {(data.socio.name || '?').charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm">{data.socio.name}</p>
            <p className="text-xs">{data.socio.email}</p>
          </div>
          <span className="text-xs bg-blue-500/20 text-blue-400 border border-blue-500/30 px-2 py-0.5 rounded-full">Sócio</span>
        </div>
        <button onClick={() => remove.mutate()} className="w-full text-xs text-red-400 border border-red-900/50 rounded-lg py-2">
          Remover sócio
        </button>
      </div>
    );
  }

  if (data?.pending_invite && link) {
    return (
      <div>
        <div className="bg-amber-900/20 border border-amber-700/40 rounded-xl p-4 mb-3">
          <p className="text-xs text-amber-400 font-semibold mb-2">Link de convite ativo</p>
          <div className="flex items-center gap-2">
            <input readOnly value={link} className="hb-input flex-1 text-xs min-w-0" />
            <button onClick={copy} className="flex-shrink-0 bg-amber-500 hover:bg-amber-400 text-black text-xs font-bold px-3 py-1.5 rounded-lg">
              {copied ? 'Copiado!' : 'Copiar'}
            </button>
          </div>
          <p className="text-xs mt-2">Expira em {new Date(data.pending_invite.expires_at).toLocaleDateString('pt-BR')}</p>
        </div>
        <button onClick={() => generate.mutate()} disabled={generate.isPending} className="w-full text-xs border rounded-lg py-2">
          Gerar novo link
        </button>
      </div>
    );
  }

  return (
    <div>
      <p className="text-sm mb-4">Nenhum sócio vinculado ainda.</p>
      {err && <p className="text-xs text-red-400 mb-2">{err}</p>}
      <button
        onClick={() => {
          setErr(null);
          generate.mutate();
        }}
        disabled={generate.isPending}
        className="w-full bg-amber-500 hover:bg-amber-400 text-black font-bold py-2.5 rounded-lg text-sm"
      >
        {generate.isPending ? 'Gerando…' : '+ Convidar Sócio'}
      </button>
    </div>
  );
}
