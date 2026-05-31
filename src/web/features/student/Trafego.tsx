// Aba Tráfego — porte fiel de public/js/student/traffic.js + dashboard.html (tab-traffic).
// Módulo de tráfego pago do aluno: lançamento por dia (POST /traffic), tabela de dias
// com KPIs (CPL/CTR/CPM), totais, distribuição de verba, projeção (quando disponível)
// e bloco WhatsApp. Consome GET /traffic via @tanstack/react-query.
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { sipApi, SipApiError } from '../../lib/api';

// ─── Tipos do contrato GET /traffic ──────────────────────────────────────────
// rows = linhas cruas de sip.traffic + KPIs por linha (calcTrafficKpis):
//   cpm, ctr, load_rate, cpl. totals = mesmas KPIs agregadas.
interface TrafficRow {
  id: string;
  date: string;
  platform: string | null;
  spent: number;
  impressions: number;
  clicks: number;
  page_views: number;
  leads_meta: number;
  leads_builderall: number;
  leads_whatsapp: number;
  grupos_whatsapp: number;
  meta_captacao: number;
  vendas_dia: number;
  faturamento_dia: number;
  cpm: number | null;
  ctr: number | null;
  load_rate: number | null;
  cpl: number | null;
}

interface TrafficTotals {
  spent: number;
  impressions: number;
  clicks: number;
  page_views: number;
  leads_meta: number;
  leads_builderall: number;
  leads_whatsapp: number;
  grupos_whatsapp: number;
  cpm: number | null;
  ctr: number | null;
  load_rate: number | null;
  cpl: number | null;
}

interface TrafficDistribution {
  escala: number;
  teste: number;
  lembrete: number;
  ehoje: number;
}

// Projeção: o legado renderiza só quando data.projection existe (if (p)).
// O backend atual pode não devolver — mantemos opcional/defensivo.
interface TrafficProjection {
  cpm: number | null;
  ctr: number | null;
  connect_rate: number | null;
  conversion: number | null;
  leads_projected: number;
  cpl_projected: number | null;
  wpp: number;
  ao_vivo: number;
}

interface TrafficResponse {
  rows: TrafficRow[];
  totals: TrafficTotals | null;
  distribution: TrafficDistribution | null;
  projection?: TrafficProjection | null;
}

// ─── Campos do formulário (fiel ao fieldMap do legado) ────────────────────────
interface TrafficFormFields {
  spent: number;
  impressions: number;
  clicks: number;
  page_views: number;
  leads_meta: number;
  leads_builderall: number;
  leads_whatsapp: number;
  grupos_whatsapp: number;
  meta_captacao: number;
  vendas_dia: number;
  faturamento_dia: number;
}

const PLATFORM_OPTIONS: { value: string; label: string }[] = [
  { value: 'meta_instagram', label: 'Instagram (Meta)' },
  { value: 'meta_facebook', label: 'Facebook (Meta)' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'youtube', label: 'YouTube' },
  { value: 'google', label: 'Google' },
  { value: 'outros', label: 'Outros' },
];

// ─── Helpers (porte de fmt / kpiClass do legado) ──────────────────────────────
function fmt(n: number | null | undefined, decimals = 2): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return Number(n).toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function kpiClass(value: number | null | undefined, greenMin: number, yellowMin: number): string {
  if (value === null || value === undefined) return '';
  if (value >= greenMin) return 'text-green-400';
  if (value >= yellowMin) return 'text-yellow-400';
  return 'text-red-400';
}

const today = () => new Date().toISOString().split('T')[0]!;

// ─── Modal de cadastro/edição ─────────────────────────────────────────────────
function TrafficModal({ existing, onClose }: { existing: TrafficRow | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [date, setDate] = useState(existing?.date ?? today());
  const [platform, setPlatform] = useState(existing?.platform || 'meta_instagram');
  const [err, setErr] = useState<string | null>(null);

  // Campos numéricos como string (estado controlado) — '' = vazio (vira 0 no submit).
  const initNum = (v: number | null | undefined) => (v != null ? String(v) : '');
  const [spent, setSpent] = useState(initNum(existing?.spent));
  const [impressions, setImpressions] = useState(initNum(existing?.impressions));
  const [clicks, setClicks] = useState(initNum(existing?.clicks));
  const [pageViews, setPageViews] = useState(initNum(existing?.page_views));
  const [leadsMeta, setLeadsMeta] = useState(initNum(existing?.leads_meta));
  const [leadsBuilderall, setLeadsBuilderall] = useState(initNum(existing?.leads_builderall));
  const [leadsWhatsapp, setLeadsWhatsapp] = useState(initNum(existing?.leads_whatsapp));
  const [gruposWhatsapp, setGruposWhatsapp] = useState(initNum(existing?.grupos_whatsapp));
  const [vendasDia, setVendasDia] = useState(initNum(existing?.vendas_dia));
  const [faturamentoDia, setFaturamentoDia] = useState(initNum(existing?.faturamento_dia));
  const [metaCaptacao, setMetaCaptacao] = useState(initNum(existing?.meta_captacao));

  const save = useMutation({
    mutationFn: () => {
      const pInt = (v: string) => parseInt(v, 10) || 0;
      const pFloat = (v: string) => parseFloat(v) || 0;
      const fields: TrafficFormFields = {
        spent: pFloat(spent),
        impressions: pInt(impressions),
        clicks: pInt(clicks),
        page_views: pInt(pageViews),
        leads_meta: pInt(leadsMeta),
        leads_builderall: pInt(leadsBuilderall),
        leads_whatsapp: pInt(leadsWhatsapp),
        grupos_whatsapp: pInt(gruposWhatsapp),
        meta_captacao: pInt(metaCaptacao),
        vendas_dia: pInt(vendasDia),
        faturamento_dia: pFloat(faturamentoDia),
      };
      return sipApi('/traffic', {
        method: 'POST',
        body: JSON.stringify({ date, platform: platform || 'outros', ...fields }),
        throwOnError: true,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['traffic'] });
      qc.invalidateQueries({ queryKey: ['my-progress'] });
      qc.invalidateQueries({ queryKey: ['gamification'] });
      onClose();
    },
    onError: (e) => setErr(e instanceof SipApiError ? e.message : 'Erro ao salvar tráfego.'),
  });

  function submit() {
    setErr(null);
    if (!date) return setErr('Selecione a data do dia de tráfego.');
    save.mutate();
  }

  const numField = (label: string, value: string, set: (v: string) => void, opts?: { step?: string; placeholder?: string; hint?: string }) => (
    <div>
      <label className="text-xs block mb-1">{label}</label>
      <input
        type="number"
        min={0}
        step={opts?.step}
        value={value}
        onChange={(e) => set(e.target.value)}
        placeholder={opts?.placeholder ?? '0'}
        className="w-full border rounded-lg px-3 py-2 text-sm"
      />
      {opts?.hint && <p className="text-[10px] mt-1" style={{ color: 'var(--text-mute)' }}>{opts.hint}</p>}
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="rounded-2xl p-6 max-w-lg w-full border shadow-2xl my-4" style={{ background: 'var(--bg-card)' }}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold">Dados de Tráfego</h2>
          <button onClick={onClose} className="text-xl leading-none">
            ×
          </button>
        </div>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs uppercase tracking-wide block mb-1">Data</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs uppercase tracking-wide block mb-1">Plataforma</label>
              <select value={platform} onChange={(e) => setPlatform(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm">
                {PLATFORM_OPTIONS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <p className="text-xs text-amber-400/70 uppercase tracking-wider font-semibold mb-2">Campanha</p>
            <div className="grid grid-cols-2 gap-3">
              {numField('Valor Gasto Diário (R$)', spent, setSpent, { step: '0.01', placeholder: '0,00' })}
              {numField('Impressões', impressions, setImpressions)}
              {numField('Cliques', clicks, setClicks)}
              {numField('Vis. Página de Destino', pageViews, setPageViews)}
            </div>
          </div>

          <div>
            <p className="text-xs text-green-400/70 uppercase tracking-wider font-semibold mb-2">Leads</p>
            <div className="grid grid-cols-2 gap-3">
              {numField('Leads do dia na META', leadsMeta, setLeadsMeta)}
              {numField('Leads Builderall', leadsBuilderall, setLeadsBuilderall)}
              {numField('Leads do dia WhatsApp', leadsWhatsapp, setLeadsWhatsapp)}
              {numField('Total leads grupos WhatsApp', gruposWhatsapp, setGruposWhatsapp)}
            </div>
          </div>

          <div>
            <p className="text-xs text-amber-400/70 uppercase tracking-wider font-semibold mb-2">Vendas do dia</p>
            <div className="grid grid-cols-2 gap-3">
              {numField('Vendas realizadas', vendasDia, setVendasDia, { hint: 'Quantas vendas você fechou hoje a partir do tráfego desta plataforma.' })}
              {numField('Faturamento do dia (R$)', faturamentoDia, setFaturamentoDia, { step: '0.01', placeholder: '0,00', hint: 'Valor total faturado hoje nessas vendas.' })}
            </div>
          </div>

          <div>
            <p className="text-xs text-blue-400/70 uppercase tracking-wider font-semibold mb-2">Meta</p>
            <div className="grid grid-cols-2 gap-3">{numField('Meta de Captação (leads/dia)', metaCaptacao, setMetaCaptacao)}</div>
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

// ─── Card de KPI / item de grade (helpers de render) ──────────────────────────
function Tip({ label, tip }: { label: string; tip: string }) {
  return (
    <span className="tip" data-tip={tip}>
      {label} ℹ
    </span>
  );
}

export default function Trafego() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['traffic'],
    queryFn: () => sipApi<TrafficResponse>('/traffic', { throwOnError: true }),
  });
  const [modal, setModal] = useState<{ existing: TrafficRow | null } | null>(null);

  if (isLoading) {
    return <div className="hb-card rounded-xl p-6 text-sm" style={{ color: 'var(--text-mute)' }}>Carregando tráfego…</div>;
  }

  if (isError || !data || !data.totals) {
    return (
      <div className="hb-card rounded-xl p-6 text-center space-y-2">
        <p className="font-semibold text-sm">Não foi possível carregar seu tráfego</p>
        <p className="text-xs" style={{ color: 'var(--text-mute)' }}>
          {error instanceof SipApiError ? error.message : 'Verifique sua conexão e tente novamente.'}
        </p>
        <button onClick={() => refetch()} className="mt-1 bg-amber-500 hover:bg-amber-400 text-black text-xs font-bold px-4 py-2 rounded-lg">
          Tentar novamente
        </button>
      </div>
    );
  }

  const rows = data.rows ?? [];
  const totals = data.totals;
  const { distribution } = data;
  const projection = data.projection ?? null;

  // KPI cards (porte do legado)
  const kpiCards = [
    { label: 'Total Investido', value: 'R$ ' + fmt(totals.spent), cls: 'font-bold', tip: null as string | null },
    { label: 'Total Leads', value: fmt(totals.leads_builderall, 0), cls: 'font-bold', tip: 'Leads captados pelo Builderall no total do ciclo' },
    {
      label: 'CPL Médio',
      value: totals.cpl !== null ? 'R$ ' + fmt(totals.cpl) : '—',
      cls: kpiClass(totals.cpl ? 1 / totals.cpl : null, 0.05, 0.01),
      tip: 'Custo por Lead — quanto você pagou em média por cada lead',
    },
    {
      label: 'CTR Médio',
      value: totals.ctr !== null ? fmt(totals.ctr) + '%' : '—',
      cls: kpiClass(totals.ctr, 1, 0.5),
      tip: 'Click-Through Rate — % de pessoas que clicaram no anúncio. Meta: acima de 1%',
    },
  ];

  // WhatsApp (somatório das linhas)
  const wTotal = rows.reduce((a, r) => a + (r.grupos_whatsapp || 0), 0);
  const wLeads = rows.reduce((a, r) => a + (r.leads_whatsapp || 0), 0);
  const showWhatsapp = wTotal > 0 || wLeads > 0;
  const txWpp = wTotal > 0 ? (wLeads / wTotal) * 100 : null;

  return (
    <div className="space-y-4">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {kpiCards.map((k) => (
          <div key={k.label} className="rounded-xl p-4 border text-center" style={{ background: 'var(--bg-card)' }}>
            <div className="text-xs mb-1">{k.tip ? <Tip label={k.label} tip={k.tip} /> : k.label}</div>
            <div className={`text-lg font-bold ${k.cls}`}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* Distribuição de verba + Projeção + WhatsApp */}
      {distribution && (
        <div className="space-y-4">
          <div className="rounded-xl p-5 border" style={{ background: 'var(--bg-card)' }}>
            <h3 className="font-semibold mb-3">Distribuição de Verba</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: 'Escala (77,5%)', value: distribution.escala },
                { label: 'Teste Criativo (12,5%)', value: distribution.teste },
                { label: 'Lembrete (7,5%)', value: distribution.lembrete },
                { label: '"É Hoje" (2,5%)', value: distribution.ehoje },
              ].map((d) => (
                <div key={d.label} className="rounded-lg p-3 text-center border">
                  <div className="text-xs mb-1">{d.label}</div>
                  <div className="text-sm font-bold text-amber-400">R$ {fmt(d.value)}</div>
                </div>
              ))}
            </div>
          </div>

          {projection && (
            <div className="rounded-xl p-5 border" style={{ background: 'var(--bg-card)' }}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold">Projeção do Ciclo</h3>
                <span className="text-xs">Baseado no investimento total</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: 'CPM', tip: 'Custo por Mil Impressões projetado. Meta: abaixo de R$25', value: projection.cpm ? 'R$ ' + fmt(projection.cpm) : '—', hint: '≤ R$25', cls: '' },
                  { label: 'CTR', tip: 'Click-Through Rate projetado. Meta: acima de 1%', value: projection.ctr ? fmt(projection.ctr) + '%' : '—', hint: '≥ 1%', cls: '' },
                  { label: 'Connect Rate', tip: '% de cliques que carregaram a página de destino. Meta: acima de 60%', value: projection.connect_rate ? fmt(projection.connect_rate) + '%' : '—', hint: '≥ 60%', cls: '' },
                  { label: 'Conversão', tip: '% de visitantes que se tornaram leads. Meta: acima de 20%', value: projection.conversion ? fmt(projection.conversion) + '%' : '—', hint: '≥ 20%', cls: '' },
                  { label: 'Leads Projetados', tip: 'Total de leads estimados com base no investimento', value: fmt(projection.leads_projected, 0), hint: '', cls: 'text-green-400 text-lg' },
                  { label: 'CPL', tip: 'Custo por Lead projetado com base na meta de investimento', value: projection.cpl_projected ? 'R$ ' + fmt(projection.cpl_projected) : '—', hint: '', cls: '' },
                  { label: 'WPP (80%)', tip: '80% dos leads projetados que devem entrar no WhatsApp', value: fmt(projection.wpp, 0), hint: 'leads → WhatsApp', cls: '' },
                  { label: 'Ao Vivo (10%)', tip: '10% dos leads projetados esperados na live', value: fmt(projection.ao_vivo, 0), hint: 'presença esperada', cls: '' },
                ].map((d) => (
                  <div key={d.label} className="rounded-lg p-3 border">
                    <div className="text-xs mb-1">
                      <Tip label={d.label} tip={d.tip} />
                    </div>
                    <div className={`text-sm font-bold ${d.cls || 'font-bold'}`}>{d.value}</div>
                    {d.hint && <div className="text-xs mt-0.5">{d.hint}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {showWhatsapp && (
            <div className="rounded-xl p-5 border" style={{ background: 'var(--bg-card)' }}>
              <h3 className="font-semibold mb-3">WhatsApp</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {[
                  { label: 'Leads nos Grupos', value: fmt(wTotal, 0), hint: '', cls: '' },
                  { label: 'Leads do Dia WPP', value: fmt(wLeads, 0), hint: '', cls: '' },
                  {
                    label: 'Tx WPP',
                    value: txWpp !== null ? fmt(txWpp) + '%' : '—',
                    hint: '≥ 80%',
                    cls: txWpp !== null && txWpp >= 80 ? 'text-green-400' : txWpp !== null && txWpp >= 50 ? 'text-yellow-400' : 'text-red-400',
                  },
                ].map((d) => (
                  <div key={d.label} className="rounded-lg p-3 text-center border">
                    <div className="text-xs mb-1">{d.label}</div>
                    <div className={`text-sm font-bold ${d.cls || 'font-bold'}`}>{d.value}</div>
                    {d.hint && <div className="text-xs mt-0.5">{d.hint}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tabela */}
      <div className="hb-card rounded-xl overflow-hidden" style={{ background: 'var(--bg-card)' }}>
        <div className="p-4 border-b flex items-center justify-between">
          <h3 className="font-semibold">Evolução de Tráfego</h3>
          <button onClick={() => setModal({ existing: null })} className="bg-amber-500 hover:bg-amber-400 text-black text-sm font-semibold px-4 py-2 rounded-lg">
            + Adicionar Dia
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b">
                <th className="px-3 py-2 text-left">Data</th>
                <th className="px-3 py-2 text-right">Gasto</th>
                <th className="px-3 py-2 text-right hidden sm:table-cell">Impressões</th>
                <th className="px-3 py-2 text-right hidden sm:table-cell">Cliques</th>
                <th className="px-3 py-2 text-right hidden md:table-cell">Vis. Pág.</th>
                <th className="px-3 py-2 text-right">Leads</th>
                <th className="px-3 py-2 text-right hidden sm:table-cell">
                  <Tip label="CPM" tip="Custo por Mil Impressões — quanto você paga para 1.000 pessoas verem seu anúncio" />
                </th>
                <th className="px-3 py-2 text-right">
                  <Tip label="CTR%" tip="Click-Through Rate — % de pessoas que clicaram após ver o anúncio. Meta: acima de 1%" />
                </th>
                <th className="px-3 py-2 text-right hidden md:table-cell">
                  <Tip label="Carg.%" tip="Taxa de Carregamento — % de cliques que chegaram à página de destino. Meta: acima de 80%" />
                </th>
                <th className="px-3 py-2 text-right">
                  <Tip label="CPL" tip="Custo por Lead — quanto você pagou por cada lead captado. Quanto menor, melhor." />
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={10}>
                    <div className="empty-state">
                      <div className="w-12 h-12 rounded-full flex items-center justify-center text-2xl">📊</div>
                      <p className="font-semibold text-sm">Nenhum dado de tráfego ainda</p>
                      <p className="text-xs">Registre o primeiro dia de campanha para começar a ver suas métricas.</p>
                      <button onClick={() => setModal({ existing: null })} className="mt-1 bg-amber-500 hover:bg-amber-400 text-black text-xs font-bold px-4 py-2 rounded-lg">
                        + Adicionar primeiro dia
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="border-b cursor-pointer" onClick={() => setModal({ existing: r })}>
                    <td className="px-3 py-2">{new Date(r.date + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}</td>
                    <td className="px-3 py-2 text-right">R$ {fmt(r.spent)}</td>
                    <td className="px-3 py-2 text-right hidden sm:table-cell">{fmt(r.impressions, 0)}</td>
                    <td className="px-3 py-2 text-right hidden sm:table-cell">{fmt(r.clicks, 0)}</td>
                    <td className="px-3 py-2 text-right hidden md:table-cell">{fmt(r.page_views, 0)}</td>
                    <td className="px-3 py-2 text-right">{fmt(r.leads_builderall, 0)}</td>
                    <td className="px-3 py-2 text-right hidden sm:table-cell">R$ {fmt(r.cpm)}</td>
                    <td className={`px-3 py-2 text-right ${kpiClass(r.ctr, 1, 0.5)}`}>{r.ctr !== null ? fmt(r.ctr) + '%' : '—'}</td>
                    <td className={`px-3 py-2 text-right ${kpiClass(r.load_rate, 80, 60)} hidden md:table-cell`}>{r.load_rate !== null ? fmt(r.load_rate) + '%' : '—'}</td>
                    <td className="px-3 py-2 text-right">{r.cpl !== null ? 'R$ ' + fmt(r.cpl) : '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
            {rows.length > 0 && (
              <tfoot className="border-t font-semibold">
                <tr>
                  <td className="px-3 py-2 text-xs uppercase">Total</td>
                  <td className="px-3 py-2 text-right">R$ {fmt(totals.spent)}</td>
                  <td className="px-3 py-2 text-right hidden sm:table-cell">{fmt(totals.impressions, 0)}</td>
                  <td className="px-3 py-2 text-right hidden sm:table-cell">{fmt(totals.clicks, 0)}</td>
                  <td className="px-3 py-2 text-right hidden md:table-cell">{fmt(totals.page_views, 0)}</td>
                  <td className="px-3 py-2 text-right">{fmt(totals.leads_builderall, 0)}</td>
                  <td className="px-3 py-2 text-right hidden sm:table-cell">R$ {fmt(totals.cpm)}</td>
                  <td className={`px-3 py-2 text-right ${kpiClass(totals.ctr, 1, 0.5)}`}>{totals.ctr !== null ? fmt(totals.ctr) + '%' : '—'}</td>
                  <td className={`px-3 py-2 text-right ${kpiClass(totals.load_rate, 80, 60)} hidden md:table-cell`}>{totals.load_rate !== null ? fmt(totals.load_rate) + '%' : '—'}</td>
                  <td className="px-3 py-2 text-right">{totals.cpl !== null ? 'R$ ' + fmt(totals.cpl) : '—'}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {modal && <TrafficModal existing={modal.existing} onClose={() => setModal(null)} />}
    </div>
  );
}
