import { useHistory } from './hooks';

const fmtBR = (d: string | null) => (d ? new Date(d + 'T00:00:00').toLocaleDateString('pt-BR') : '—');

export default function Historico() {
  const history = useHistory();
  const data = history.data ?? [];

  return (
    <div className="space-y-4">
      <div className="rounded-xl p-5 border" style={{ background: 'var(--bg-card)' }}>
        <h2 className="font-semibold mb-1">Meus ciclos anteriores</h2>
        <p className="text-xs mb-4">Resumo de cada ciclo que você já participou</p>
        <div className="space-y-3">
          {history.isLoading && <div className="text-sm text-center py-8">Carregando histórico...</div>}
          {!history.isLoading && data.length === 0 && (
            <div className="empty-state">
              <div className="w-12 h-12 rounded-full flex items-center justify-center text-2xl">📚</div>
              <p className="font-semibold text-sm">Você ainda não tem ciclos anteriores</p>
              <p className="text-xs">Quando seu ciclo atual for encerrado, ele aparecerá aqui.</p>
            </div>
          )}
          {data.map((h, i) => (
            <div className="hb-card rounded-xl p-4" key={i}>
              <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold">{h.ciclo_nome || '—'}</h3>
                  <p className="text-xs mt-0.5">
                    {fmtBR(h.data_inicio)} → {fmtBR(h.data_fim)}
                  </p>
                </div>
                <span className="text-xs px-2 py-0.5 rounded-full font-semibold">Encerrado</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-2">
                <div className="rounded-lg p-3 border">
                  <p className="text-xs mb-1">Conclusão</p>
                  <p className={`text-lg font-bold ${h.progress_percent === 100 ? 'text-green-400' : ''}`}>{h.progress_percent}%</p>
                  <p className="text-xs">
                    {h.completed_tasks}/{h.total_tasks} tarefas
                  </p>
                </div>
                <div className="rounded-lg p-3 border">
                  <p className="text-xs mb-1">Postagens</p>
                  <p className="text-lg font-bold">{h.total_posts || 0}</p>
                </div>
                <div className="rounded-lg p-3 border">
                  <p className="text-xs mb-1">Leads captados</p>
                  <p className="text-lg font-bold text-blue-400">{(h.total_leads || 0).toLocaleString('pt-BR')}</p>
                </div>
                <div className="rounded-lg p-3 border">
                  <p className="text-xs mb-1">SuperDebriefing</p>
                  {h.sdb_submitted ? (
                    <>
                      <p className="text-sm font-semibold text-green-400">✓ Entregue</p>
                      {h.sdb_nota != null && <p className="text-xs mt-0.5">Nota: {h.sdb_nota}/10</p>}
                    </>
                  ) : (
                    <p className="text-sm">Não entregue</p>
                  )}
                </div>
              </div>
              {h.sdb_submitted && (h.sdb_vendas != null || h.sdb_roi != null) && (
                <div className="mt-3 pt-3 border-t flex flex-wrap gap-x-6 gap-y-2 text-sm">
                  {h.sdb_vendas != null && <span>💼 {h.sdb_vendas} venda(s)</span>}
                  {h.sdb_roi != null && <span className="text-amber-400 font-semibold">📈 ROI {Number(h.sdb_roi).toFixed(1)}x</span>}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
