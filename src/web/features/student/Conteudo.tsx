import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { sipApi, SipApiError } from '../../lib/api';
import './conteudo.css';

interface Post {
  id: string;
  date: string;
  platform: string;
  format: string;
  link: string | null;
}
interface TrafficRow {
  id: string;
  date: string;
  platform: string | null;
  spent: number;
  leads_builderall: number;
  cpl: number | null;
  ctr: number | null;
}
interface TrafficResp {
  rows: TrafficRow[];
  totals: { spent?: number; leads_builderall?: number; cpl?: number | null } | null;
}

const FORMATS: Record<string, string[]> = {
  instagram: ['Reels', 'Carrossel', 'Estático', 'Stories'],
  facebook: ['Raiz', 'Reels'],
  youtube: ['Shorts', 'Vídeo Longo'],
};

const today = () => new Date().toISOString().split('T')[0];

function PostsSection() {
  const qc = useQueryClient();
  const { data: posts } = useQuery({
    queryKey: ['posts'],
    queryFn: () => sipApi<Post[]>('/posts', { throwOnError: true }),
  });
  const [date, setDate] = useState(today());
  const [platform, setPlatform] = useState('instagram');
  const [format, setFormat] = useState('Reels');
  const [link, setLink] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const add = useMutation({
    mutationFn: () =>
      sipApi('/posts', { method: 'POST', body: JSON.stringify({ date, platform, format, link }), throwOnError: true }),
    onSuccess: () => {
      setLink('');
      qc.invalidateQueries({ queryKey: ['posts'] });
      qc.invalidateQueries({ queryKey: ['my-progress'] });
      qc.invalidateQueries({ queryKey: ['gamification'] });
    },
    onError: (e) => setErr(e instanceof SipApiError ? e.message : 'Erro ao salvar post.'),
  });
  const del = useMutation({
    mutationFn: (id: string) => sipApi(`/posts/${id}`, { method: 'DELETE', throwOnError: true }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['posts'] }),
  });

  return (
    <section className="card2">
      <h2>Posts</h2>
      <div className="form-row">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <select
          value={platform}
          onChange={(e) => {
            setPlatform(e.target.value);
            setFormat(FORMATS[e.target.value]?.[0] ?? '');
          }}
        >
          <option value="instagram">Instagram</option>
          <option value="facebook">Facebook</option>
          <option value="youtube">YouTube</option>
        </select>
        <select value={format} onChange={(e) => setFormat(e.target.value)}>
          {(FORMATS[platform] ?? []).map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <input placeholder="Link (opcional)" value={link} onChange={(e) => setLink(e.target.value)} />
        <button className="btn-sm" disabled={add.isPending} onClick={() => { setErr(null); add.mutate(); }}>
          {add.isPending ? '...' : 'Adicionar'}
        </button>
      </div>
      {err && <div className="alert">{err}</div>}
      <ul className="rows">
        {(posts ?? []).map((p) => (
          <li key={p.id}>
            <span>
              {p.date} · {p.platform} · {p.format}
              {p.link && (
                <>
                  {' '}
                  · <a href={p.link} target="_blank" rel="noreferrer">link</a>
                </>
              )}
            </span>
            <button className="link-btn" onClick={() => del.mutate(p.id)}>
              remover
            </button>
          </li>
        ))}
        {(posts ?? []).length === 0 && <li className="muted">Nenhum post registrado.</li>}
      </ul>
    </section>
  );
}

function TrafficSection() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['traffic'],
    queryFn: () => sipApi<TrafficResp>('/traffic', { throwOnError: true }),
  });
  const [f, setF] = useState({ date: today(), platform: 'meta_instagram', spent: '', impressions: '', clicks: '', page_views: '', leads_builderall: '' });
  const [err, setErr] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => sipApi('/traffic', { method: 'POST', body: JSON.stringify(f), throwOnError: true }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['traffic'] });
      qc.invalidateQueries({ queryKey: ['my-progress'] });
      qc.invalidateQueries({ queryKey: ['gamification'] });
    },
    onError: (e) => setErr(e instanceof SipApiError ? e.message : 'Erro ao salvar tráfego.'),
  });
  const upd = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));

  return (
    <section className="card2">
      <h2>Tráfego pago (por dia)</h2>
      <div className="form-grid">
        <label>Data<input type="date" value={f.date} onChange={(e) => upd('date', e.target.value)} /></label>
        <label>Plataforma
          <select value={f.platform} onChange={(e) => upd('platform', e.target.value)}>
            <option value="meta_instagram">Instagram</option>
            <option value="meta_facebook">Facebook</option>
            <option value="tiktok">TikTok</option>
            <option value="youtube">YouTube</option>
            <option value="google">Google</option>
            <option value="outros">Outros</option>
          </select>
        </label>
        <label>Investido (R$)<input inputMode="decimal" value={f.spent} onChange={(e) => upd('spent', e.target.value)} /></label>
        <label>Impressões<input inputMode="numeric" value={f.impressions} onChange={(e) => upd('impressions', e.target.value)} /></label>
        <label>Cliques<input inputMode="numeric" value={f.clicks} onChange={(e) => upd('clicks', e.target.value)} /></label>
        <label>Views da página<input inputMode="numeric" value={f.page_views} onChange={(e) => upd('page_views', e.target.value)} /></label>
        <label>Leads (Builderall)<input inputMode="numeric" value={f.leads_builderall} onChange={(e) => upd('leads_builderall', e.target.value)} /></label>
      </div>
      {err && <div className="alert">{err}</div>}
      <button className="btn-sm" disabled={save.isPending} onClick={() => { setErr(null); save.mutate(); }}>
        {save.isPending ? 'Salvando...' : 'Salvar dia'}
      </button>

      {data?.totals && (
        <p className="muted tot">
          Total investido: R$ {(data.totals.spent ?? 0).toFixed(2)} · Leads: {data.totals.leads_builderall ?? 0} · CPL:{' '}
          {data.totals.cpl != null ? 'R$ ' + data.totals.cpl.toFixed(2) : '—'}
        </p>
      )}
      <ul className="rows">
        {(data?.rows ?? []).map((r) => (
          <li key={r.id}>
            <span>
              {r.date} · {r.platform ?? 'outros'} · R$ {(r.spent ?? 0).toFixed(2)} · {r.leads_builderall ?? 0} leads
              {r.cpl != null && ` · CPL R$ ${r.cpl.toFixed(2)}`}
            </span>
          </li>
        ))}
        {(data?.rows ?? []).length === 0 && <li className="muted">Nenhum dia registrado.</li>}
      </ul>
    </section>
  );
}

export default function Conteudo() {
  return (
    <div className="dash">
      <h1>Conteúdo &amp; Tráfego</h1>
      <p className="muted">Registre seus posts e o tráfego pago do dia. Isso alimenta sua gamificação e o SuperDebriefing.</p>
      <PostsSection />
      <TrafficSection />
    </div>
  );
}
