import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { sipApi } from '../../../lib/api';
import { fmtDateFull } from '../helpers';

// Contrato legado: GET /admin/posts devolve array cru com student_name + link
// (campos content/engagement/platform_label não existem na tabela posts).
interface AdminPost {
  id: string;
  student_name?: string;
  author_name?: string;
  date?: string;
  created_at?: string;
  platform: string;
  format?: string;
  link?: string | null;
  url?: string | null;
}

function defaultRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 30);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(from), to: iso(to) };
}

export default function Posts() {
  const [range] = useState(defaultRange);
  const [fStudent, setFStudent] = useState('');
  const [fPlatform, setFPlatform] = useState('');

  const { data } = useQuery({
    queryKey: ['admin-posts', range.from, range.to],
    queryFn: () => sipApi<AdminPost[] | { items: AdminPost[] }>(`/admin/posts?from=${range.from}&to=${range.to}`, { throwOnError: true }),
  });

  const all: AdminPost[] = Array.isArray(data) ? data : (data?.items ?? []);
  const authorOf = (p: AdminPost) => p.student_name ?? p.author_name ?? '—';
  const linkOf = (p: AdminPost) => p.link ?? p.url ?? null;

  const students = useMemo(() => {
    const set = new Set<string>();
    all.forEach((p) => set.add(authorOf(p)));
    return Array.from(set.keys()).sort();
  }, [all]);

  const filtered = useMemo(() => {
    let f = all.slice();
    if (fStudent) f = f.filter((p) => authorOf(p) === fStudent);
    if (fPlatform) f = f.filter((p) => p.platform === fPlatform);
    return f;
  }, [all, fStudent, fPlatform]);

  const byPlatform = useMemo(() => {
    const m: Record<string, number> = {};
    all.forEach((p) => { m[p.platform] = (m[p.platform] ?? 0) + 1; });
    return m;
  }, [all]);
  const total = all.length;
  const withLink = total > 0 ? Math.round((all.filter((p) => linkOf(p)).length / total) * 100) : 0;
  const lead = Object.entries(byPlatform).sort((a, b) => b[1] - a[1])[0];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', margin: 0 }}>Postagens</h2>
          <p style={{ fontSize: 13, color: 'var(--text-mute)', marginTop: 2 }}>Volume e distribuição de conteúdo publicado pelos alunos</p>
        </div>
      </div>

      <div className="pg-kpi-row">
        <div className="pg-kpi">
          <div className="pg-kpi-body">
            <span className="pg-kpi-label">Total de posts</span>
            <div className="pg-kpi-value-row"><span className="pg-kpi-value">{total}</span></div>
            <span className="pg-kpi-sub">no período</span>
          </div>
        </div>
        <div className="pg-kpi">
          <div className="pg-kpi-body">
            <span className="pg-kpi-label">Alunos postando</span>
            <div className="pg-kpi-value-row"><span className="pg-kpi-value">{students.length}</span></div>
            <span className="pg-kpi-sub">distintos</span>
          </div>
        </div>
        <div className="pg-kpi">
          <div className="pg-kpi-body">
            <span className="pg-kpi-label">Plataforma líder</span>
            <div className="pg-kpi-value-row"><span className="pg-kpi-value is-text">{lead ? lead[0] : '—'}</span></div>
            <span className="pg-kpi-sub">{lead ? `${lead[1]} posts` : ''}</span>
          </div>
        </div>
        <div className="pg-kpi">
          <div className="pg-kpi-body">
            <span className="pg-kpi-label">% com link</span>
            <div className="pg-kpi-value-row"><span className="pg-kpi-value">{withLink}%</span></div>
            <span className="pg-kpi-sub">dos posts com URL</span>
          </div>
        </div>
      </div>

      <div className="pg-table-card">
        <div className="pg-table-head">
          <span className="pg-table-title">Todos os posts</span>
          <div className="pg-table-filters">
            <select value={fStudent} onChange={(e) => setFStudent(e.target.value)} className="pg-filter-chip">
              <option value="">Todos os alunos</option>
              {students.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={fPlatform} onChange={(e) => setFPlatform(e.target.value)} className="pg-filter-chip">
              <option value="">Todas as plataformas</option>
              <option value="instagram">Instagram</option>
              <option value="facebook">Facebook</option>
              <option value="youtube">YouTube</option>
            </select>
            <span className="pg-table-count">{filtered.length} posts</span>
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="pg-table">
            <thead>
              <tr><th>Aluno</th><th>Data</th><th>Plataforma</th><th>Formato</th><th>Link</th></tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={5} style={{ padding: 32, textAlign: 'center', color: 'var(--text-mute)', fontSize: 13 }}>Nenhum post no período.</td></tr>
              ) : (
                filtered.map((p) => {
                  const link = linkOf(p);
                  return (
                  <tr key={p.id}>
                    <td>{authorOf(p)}</td>
                    <td>{fmtDateFull(p.date) !== '—' ? fmtDateFull(p.date) : (p.created_at ? new Date(p.created_at).toLocaleDateString('pt-BR') : '—')}</td>
                    <td>{p.platform}</td>
                    <td>{p.format ?? '—'}</td>
                    <td>{link ? <a href={link} target="_blank" rel="noopener noreferrer">abrir</a> : '—'}</td>
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
