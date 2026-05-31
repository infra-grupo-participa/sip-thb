import { useQuery } from '@tanstack/react-query';
import { sipApi } from '../../../lib/api';

interface TemplateMarker { key: string; label: string; offset_days: number }
interface CicloTemplate { ciclo_type: 'aurum' | 'seminario'; label?: string; markers?: TemplateMarker[]; anchor_label?: string }

export default function CicloTemplates() {
  const { data } = useQuery({
    queryKey: ['admin-ciclo-templates'],
    queryFn: () => sipApi<CicloTemplate[] | { items: CicloTemplate[] }>('/admin/ciclo-templates', { throwOnError: true }),
  });
  const templates: CicloTemplate[] = Array.isArray(data) ? data : (data?.items ?? []);

  return (
    <div>
      <section className="ct-page-header">
        <div className="ct-page-header-text">
          <span className="ct-page-eyebrow">Configuração de programa</span>
          <h1 className="ct-page-title">Templates de ciclo</h1>
          <p className="ct-page-subtitle">
            Receita dos ciclos Aurum e Diamante/Seminário. Defina os offsets relativos à data-âncora do evento de cada aluno.
          </p>
        </div>
        <div className="ct-page-alert" role="note">
          <div className="ct-page-alert-body">
            <strong>Mudanças aqui afetam apenas novas aprovações.</strong> Alunos com cronograma já materializado mantêm o template anterior até edição manual na aba "Cronograma" do aluno.
          </div>
        </div>
      </section>

      <div id="ciclo-templates-list">
        {templates.length === 0 ? (
          <div className="empty-state"><p style={{ color: 'var(--text-mute)', fontSize: 13 }}>Carregando templates...</p></div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {templates.map((t) => (
              <div key={t.ciclo_type} className="hb-card" style={{ overflow: 'hidden' }}>
                <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-soft)' }}>
                  <h3 style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', margin: 0 }}>
                    {t.label ?? (t.ciclo_type === 'aurum' ? '🟠 Aurum' : '💎 Diamante / Seminário')}
                  </h3>
                  {t.anchor_label && <p style={{ fontSize: 12, color: 'var(--text-mute)', marginTop: 2 }}>Âncora: {t.anchor_label}</p>}
                </div>
                <div style={{ padding: '8px 20px 14px' }}>
                  {(t.markers ?? []).length === 0 ? (
                    <div style={{ fontSize: 12, color: 'var(--text-mute)', padding: '8px 0' }}>Sem marcos configurados.</div>
                  ) : (
                    (t.markers ?? []).map((m) => (
                      <div key={m.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border-soft)' }}>
                        <span style={{ flex: 1, fontSize: 13, color: 'var(--text)' }}>{m.label}</span>
                        <span className="hb-chip">{m.offset_days >= 0 ? `+${m.offset_days}` : m.offset_days} dias</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
