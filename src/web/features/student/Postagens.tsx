import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { sipApi, SipApiError } from '../../lib/api';
import { usePosts } from './hooks';
import type { Post } from './types';

const POST_FORMATS: Record<string, string[]> = {
  instagram: ['Reels', 'Carrossel', 'Estático', 'Story'],
  facebook: ['Raiz', 'Story', 'DIA LIVRE'],
  youtube: ['Vídeo Longo', 'Shorts', 'Nutella', 'Raiz'],
};
const PLATFORM_ICONS: Record<string, string> = { instagram: '📷', facebook: '📘', youtube: '▶️' };
const PLATFORM_COLORS: Record<string, string> = { instagram: 'text-pink-400', facebook: 'text-blue-400', youtube: 'text-red-400' };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const today = () => new Date().toISOString().split('T')[0];

function PostModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [date, setDate] = useState(today());
  const [platform, setPlatform] = useState('');
  const [format, setFormat] = useState('');
  const [link, setLink] = useState('');
  const [reach, setReach] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      sipApi('/posts', {
        method: 'POST',
        body: JSON.stringify({ date, platform, format, link: link || null, manual_reach: reach ? parseInt(reach, 10) : null }),
        throwOnError: true,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['posts'] });
      qc.invalidateQueries({ queryKey: ['my-progress'] });
      qc.invalidateQueries({ queryKey: ['gamification'] });
      onClose();
    },
    onError: (e) => setErr(e instanceof SipApiError ? e.message : 'Erro ao salvar post.'),
  });

  function submit() {
    setErr(null);
    if (!date) return setErr('Selecione a data do post.');
    if (!platform) return setErr('Selecione a plataforma.');
    if (!format) return setErr('Selecione o formato do post.');
    save.mutate();
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="rounded-2xl p-6 max-w-md w-full border shadow-2xl" style={{ background: 'var(--bg-card)' }}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold">Registrar Post</h2>
          <button onClick={onClose} className="text-xl leading-none">
            ×
          </button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="text-xs uppercase tracking-wide block mb-1">Data do post</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="hb-input w-full" />
          </div>
          <div>
            <label className="text-xs uppercase tracking-wide block mb-1">Plataforma</label>
            <select
              value={platform}
              onChange={(e) => {
                setPlatform(e.target.value);
                setFormat('');
              }}
              className="hb-input w-full"
            >
              <option value="">Selecione...</option>
              <option value="instagram">Instagram</option>
              <option value="facebook">Facebook</option>
              <option value="youtube">YouTube</option>
            </select>
          </div>
          <div>
            <label className="text-xs uppercase tracking-wide block mb-1">Formato</label>
            <select value={format} onChange={(e) => setFormat(e.target.value)} className="hb-input w-full" disabled={!platform}>
              <option value="">{platform ? 'Selecione...' : 'Selecione a plataforma primeiro'}</option>
              {(POST_FORMATS[platform] ?? []).map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs uppercase tracking-wide block mb-1">Link do post (opcional)</label>
            <input type="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://..." className="hb-input w-full" />
          </div>
          <div>
            <label className="text-xs uppercase tracking-wide block mb-1">Alcance (opcional)</label>
            <input type="number" min={0} value={reach} onChange={(e) => setReach(e.target.value)} placeholder="Ex: 1500" className="hb-input w-full" />
          </div>
          {err && <p className="text-xs text-red-400">{err}</p>}
        </div>
        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 py-2 rounded-lg border text-sm">
            Cancelar
          </button>
          <button onClick={submit} disabled={save.isPending} className="flex-1 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-black font-semibold text-sm">
            {save.isPending ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Postagens() {
  const posts = usePosts();
  const qc = useQueryClient();
  const [modal, setModal] = useState(false);

  const del = useMutation({
    mutationFn: (id: string) => sipApi(`/posts/${id}`, { method: 'DELETE', throwOnError: true }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['posts'] });
      qc.invalidateQueries({ queryKey: ['gamification'] });
    },
  });

  const items = posts.data?.items ?? [];
  const counts: Record<string, number> = { instagram: 0, facebook: 0, youtube: 0 };
  for (const p of items) counts[p.platform] = (counts[p.platform] || 0) + 1;

  const byDate: Record<string, Post[]> = {};
  for (const p of items) {
    (byDate[p.date] ??= []).push(p);
  }
  const groups = Object.entries(byDate).sort(([a], [b]) => b.localeCompare(a));

  return (
    <div className="space-y-4">
      <div className="ig-metrics-block" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderRadius: 12, border: '1px dashed var(--border)', background: 'var(--bg-muted)', color: 'var(--text-mute)', fontSize: 13 }}>
        <span style={{ fontSize: 20 }}>📸</span>
        <div>
          <span style={{ fontWeight: 700, color: 'var(--text)' }}>Métricas do Instagram — Em breve</span>
          <p style={{ margin: '2px 0 0', fontSize: 12 }}>A integração automática com o Instagram está em fase de aprovação.</p>
        </div>
      </div>

      <div className="rounded-xl p-5 border" style={{ background: 'var(--bg-card)' }}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">Minhas Postagens</h2>
          <button onClick={() => setModal(true)} className="bg-amber-500 hover:bg-amber-400 text-black text-sm font-semibold px-4 py-2 rounded-lg">
            + Registrar Post
          </button>
        </div>
        <div className="flex gap-4 flex-wrap text-sm">
          {Object.entries(counts).map(([plat, count]) => (
            <span key={plat} className={PLATFORM_COLORS[plat]}>
              {PLATFORM_ICONS[plat]} {cap(plat)}: <strong>{count}</strong>
            </span>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        {groups.length === 0 && (
          <div className="hb-card rounded-xl">
            <div className="empty-state">
              <div className="w-12 h-12 rounded-full flex items-center justify-center text-2xl">📱</div>
              <p className="font-semibold text-sm">Nenhum post registrado ainda</p>
              <p className="text-xs">Registre seus posts do Instagram, Facebook e YouTube.</p>
              <button onClick={() => setModal(true)} className="mt-1 bg-amber-500 hover:bg-amber-400 text-black text-xs font-bold px-4 py-2 rounded-lg">
                + Registrar primeiro post
              </button>
            </div>
          </div>
        )}
        {groups.map(([date, dayPosts]) => {
          const dateStr = new Date(date + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric', month: 'short' });
          return (
            <div className="hb-card rounded-xl p-4" key={date}>
              <div className="text-xs uppercase tracking-wide mb-3 font-semibold">{dateStr}</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {dayPosts.map((p) => (
                  <div key={p.id} className="flex items-start gap-3 rounded-lg p-3 border">
                    <span className="text-xl flex-shrink-0">{PLATFORM_ICONS[p.platform] || '📌'}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-xs font-semibold ${PLATFORM_COLORS[p.platform]}`}>{cap(p.platform)}</span>
                        <span className="text-xs">·</span>
                        <span className="text-xs">{p.format}</span>
                      </div>
                      {p.link ? (
                        <a href={p.link} target="_blank" rel="noreferrer" className="text-xs text-amber-400 truncate block mt-0.5">
                          {p.link}
                        </a>
                      ) : (
                        <span className="text-xs mt-0.5 block">Sem link</span>
                      )}
                      {p.manual_reach != null && (
                        <span className="text-xs mt-0.5 block" style={{ color: 'var(--text-mute)' }}>
                          👁 {Number(p.manual_reach).toLocaleString('pt-BR')} de alcance
                        </span>
                      )}
                    </div>
                    <button onClick={() => del.mutate(p.id)} className="text-sm flex-shrink-0" title="Remover">
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {modal && <PostModal onClose={() => setModal(false)} />}
    </div>
  );
}
