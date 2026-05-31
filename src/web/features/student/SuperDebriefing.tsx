import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { sipApi, SipApiError } from '../../lib/api';
import { useDebriefing } from './hooks';

type SdbState = Record<string, string>;

const SECTIONS = ['1. Captação', '2. Presença', '3. Vendas', '4. Conteúdo', '5. Reflexão', '6. Script', '7. Avatar'];
const TOTAL = SECTIONS.length;

const SCRIPT_BLOCKS: { slug: string; label: string }[] = [
  { slug: 'super_promessa', label: 'Super Promessa' },
  { slug: 'gancho', label: 'Gancho' },
  { slug: 'comando_atencao', label: 'Comando para atenção' },
  { slug: 'qualificacao', label: 'Qualificação' },
  { slug: 'antecipa_conteudo', label: 'Antecipação ao Conteúdo' },
  { slug: 'antecipa_desejo', label: 'Antecipação ao Desejo' },
  { slug: 'conteudo', label: 'Conteúdo' },
  { slug: 'prova_social', label: 'Prova + Prova Social' },
  { slug: 'pilar1_ignorantes', label: 'Pilar 1 — Ignorantes' },
  { slug: 'pilar2_procrastina', label: 'Pilar 2 — Procrastinadores' },
  { slug: 'pilar3_resolvedores', label: 'Pilar 3 — Resolvedores' },
  { slug: 'oferta', label: 'Oferta' },
  { slug: 'cta1', label: 'CTA (1)' },
  { slug: 'desapego', label: 'Desapego' },
  { slug: 'cta2', label: 'CTA (2)' },
  { slug: 'escassez', label: 'Escassez' },
  { slug: 'cta3', label: 'CTA (3)' },
  { slug: 'fechamento', label: 'Fechamento' },
];

function Num({ id, label, st, set, auto, step }: { id: string; label: string; st: SdbState; set: (id: string, v: string) => void; auto?: boolean; step?: string }) {
  return (
    <div>
      <label className="text-xs block mb-1">{label}</label>
      <input
        type="number"
        step={step}
        className={`${auto ? 'sdb-auto ' : ''}w-full border rounded-lg px-3 py-2 text-sm`}
        placeholder={auto ? 'Auto' : '0'}
        value={st[id] ?? ''}
        onChange={(e) => set(id, e.target.value)}
      />
    </div>
  );
}
function Txt({ id, label, st, set, type = 'text', placeholder }: { id: string; label: string; st: SdbState; set: (id: string, v: string) => void; type?: string; placeholder?: string }) {
  return (
    <div>
      <label className="text-xs block mb-1">{label}</label>
      <input type={type} className="w-full border rounded-lg px-3 py-2 text-sm" placeholder={placeholder} value={st[id] ?? ''} onChange={(e) => set(id, e.target.value)} />
    </div>
  );
}
function Area({ id, label, st, set, placeholder }: { id: string; label: string; st: SdbState; set: (id: string, v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label className="text-xs block mb-1">{label}</label>
      <textarea rows={3} className="w-full border rounded-lg px-3 py-2 text-sm resize-none" placeholder={placeholder} value={st[id] ?? ''} onChange={(e) => set(id, e.target.value)} />
    </div>
  );
}
function YesNo({ id, label, st, set }: { id: string; label: string; st: SdbState; set: (id: string, v: string) => void }) {
  return (
    <div>
      <label className="text-xs block mb-1">{label}</label>
      <select className="w-full border rounded-lg px-3 py-2 text-sm" value={st[id] ?? ''} onChange={(e) => set(id, e.target.value)}>
        <option value="">—</option>
        <option value="sim">Sim</option>
        <option value="nao">Não</option>
      </select>
    </div>
  );
}

export default function SuperDebriefing({ onClose }: { onClose: () => void }) {
  const existing = useDebriefing();
  const qc = useQueryClient();
  const [section, setSection] = useState(1);
  const [st, setSt] = useState<SdbState>({ nota: '5' });
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (existing.data) {
      const d = existing.data as Record<string, unknown>;
      setSt((prev) => {
        const next = { ...prev };
        for (const [k, v] of Object.entries(d)) {
          if (v != null && typeof v !== 'object') next[k] = String(v);
        }
        return next;
      });
    }
  }, [existing.data]);

  const set = (id: string, v: string) => setSt((s) => ({ ...s, [id]: v }));

  // ROI calculado
  const fat = parseFloat((st.faturamento ?? '').replace(',', '.')) || 0;
  const invested = parseFloat((st.valor_investido ?? '').replace(',', '.')) || 0;
  const roi = fat > 0 && invested > 0 ? (((fat - invested) / invested) * 100).toFixed(1) + '%' : '';

  const save = useMutation({
    mutationFn: (draft: boolean) =>
      sipApi('/superdebriefing', { method: 'POST', body: JSON.stringify({ ...st, roi, draft }), throwOnError: true }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['debriefing'] });
      qc.invalidateQueries({ queryKey: ['debriefing-status'] });
      qc.invalidateQueries({ queryKey: ['my-progress'] });
      qc.invalidateQueries({ queryKey: ['gamification'] });
    },
    onError: (e) => setErr(e instanceof SipApiError ? e.message : 'Erro ao salvar SuperDebriefing.'),
  });

  function submit() {
    setErr(null);
    save.mutate(false, { onSuccess: () => onClose() });
  }

  return (
    <div className="modal-backdrop">
      <div className="modal-shell modal-lg sdb-modal">
        <div className="modal-head">
          <div className="modal-head-main">
            <div className="modal-head-title-row">
              <h2>SuperDebriefing do Ciclo</h2>
            </div>
            <p className="modal-head-info">
              Seção {section} de {TOTAL}
            </p>
          </div>
          <button onClick={onClose} className="modal-close" aria-label="Fechar">
            ×
          </button>
        </div>

        <div className="sdb-tabs">
          {SECTIONS.map((label, i) => (
            <button key={i} className={`sdb-tab ${section === i + 1 ? 'is-active' : ''}`} onClick={() => setSection(i + 1)}>
              {label}
            </button>
          ))}
        </div>

        <div className="sdb-body">
          {section === 1 && (
            <div className="p-5 space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-amber-400 font-bold">1.</span>
                <h3 className="font-semibold">Captação e Tráfego</h3>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Num id="valor_investido" label="Valor Investido (R$)" st={st} set={set} auto step="0.01" />
                <Num id="leads_builderall" label="Leads Builderall" st={st} set={set} auto />
                <Num id="cpl" label="CPL (R$)" st={st} set={set} auto step="0.01" />
                <Txt id="cpm" label="CPM (R$)" st={st} set={set} placeholder="Auto (ex: 12,50)" />
                <Num id="ctr" label="CTR (%)" st={st} set={set} auto step="0.01" />
                <Num id="taxa_carregamento" label="Taxa de Carregamento (%)" st={st} set={set} auto step="0.01" />
                <Num id="num_criativos" label="Qtd. Criativos Usados" st={st} set={set} />
                <Num id="leads_wpp" label="Leads no WhatsApp" st={st} set={set} />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <Num id="investimento_lembrete" label="Investimento Lembrete (R$)" st={st} set={set} auto step="0.01" />
                <Num id="ll_call" label="Ligue Lead — Ligações" st={st} set={set} />
                <Num id="ll_sms" label="Ligue Lead — SMS" st={st} set={set} />
              </div>
            </div>
          )}

          {section === 2 && (
            <div className="p-5 space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-amber-400 font-bold">2.</span>
                <h3 className="font-semibold">Presença e Lives</h3>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Txt id="live_aq1" label="Link Live Aquecimento 01" st={st} set={set} type="url" placeholder="https://youtube.com/..." />
                <Txt id="live_aq2" label="Link Live Aquecimento 02" st={st} set={set} type="url" placeholder="https://youtube.com/..." />
                <Txt id="live_pre" label="Pré-palestra (link)" st={st} set={set} type="url" placeholder="https://youtube.com/..." />
                <Txt id="live_palestra" label="Link Palestra" st={st} set={set} type="url" placeholder="https://youtube.com/..." />
                <Txt id="live_td" label="Link Tira Dúvidas" st={st} set={set} type="url" placeholder="https://youtube.com/..." />
              </div>
              <div className="border-t pt-3">
                <p className="text-base font-semibold mb-3">Quantidade de pessoas em cada live</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <Num id="presenca_aq1" label="Live Aquecimento 01" st={st} set={set} />
                  <Num id="presenca_aq2" label="Live Aquecimento 02" st={st} set={set} />
                  <Num id="presenca_aq3" label="Live Aquecimento 03" st={st} set={set} />
                  <Num id="presenca_pre" label="Pré-palestra" st={st} set={set} />
                  <Num id="presenca_palestra" label="Palestra" st={st} set={set} />
                  <Num id="presenca_td" label="Tira-dúvidas" st={st} set={set} />
                </div>
              </div>
            </div>
          )}

          {section === 3 && (
            <div className="p-5 space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-amber-400 font-bold">3.</span>
                <h3 className="font-semibold">Vendas e Faturamento</h3>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Num id="sessoes" label="Qtd. Sessões de Viabilidade" st={st} set={set} />
                <Num id="vendas" label="Qtd. Vendas realizadas" st={st} set={set} />
                <Num id="fat_sessoes" label="Faturamento Sessões (R$)" st={st} set={set} step="0.01" />
                <Num id="raspa" label="Raspa do Tacho (R$)" st={st} set={set} step="0.01" />
                <Num id="faturamento" label="Faturamento Total (R$)" st={st} set={set} step="0.01" />
                <div>
                  <label className="text-xs block mb-1">ROI</label>
                  <input type="text" readOnly value={roi} className="w-full border rounded-lg px-3 py-2 text-amber-400 text-sm font-bold cursor-not-allowed" placeholder="Calculado automaticamente" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 border-t pt-3">
                <Num id="vendas_raspa" label="Vendas Raspa do Tacho (qtd)" st={st} set={set} />
                <Num id="vendas_recuperacao" label="Vendas Recuperação (qtd)" st={st} set={set} />
                <Num id="boletos_emitidos" label="Boletos Emitidos" st={st} set={set} />
                <Num id="boletos_pagos" label="Boletos Pagos" st={st} set={set} />
                <Num id="croquis_fechados" label="Croquis Fechados" st={st} set={set} />
                <Num id="holdings_fechadas" label="Holdings Fechadas" st={st} set={set} />
                <Num id="fat_croquis" label="Faturamento Croquis (R$)" st={st} set={set} step="0.01" />
                <Num id="fat_holdings" label="Faturamento Holdings (R$)" st={st} set={set} step="0.01" />
              </div>
              <div>
                <label className="text-xs block mb-1">
                  Nota geral do ciclo: <span className="text-amber-400 font-bold">{st.nota ?? '5'}</span>/10
                </label>
                <input type="range" min={1} max={10} value={st.nota ?? '5'} onChange={(e) => set('nota', e.target.value)} className="w-full accent-amber-500 cursor-pointer" />
              </div>
            </div>
          )}

          {section === 4 && (
            <div className="p-5 space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-amber-400 font-bold">4.</span>
                <h3 className="font-semibold">Conteúdo Publicado no Ciclo</h3>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <Num id="reels" label="Reels Instagram" st={st} set={set} auto />
                <Num id="carrossel" label="Carrossel Instagram" st={st} set={set} auto />
                <Num id="raiz_fb" label="Raízes Facebook" st={st} set={set} auto />
                <Num id="shorts" label="Shorts YouTube" st={st} set={set} auto />
                <Num id="videos_yt" label="Vídeos Longos YouTube" st={st} set={set} auto />
              </div>
              <div className="border-t pt-3 space-y-3">
                <Area id="gatilhos" label="Gatilhos mentais utilizados" st={st} set={set} placeholder="Escassez, autoridade, prova social..." />
                <Area id="quebras_objecao" label="Quebras de objeção realizadas" st={st} set={set} placeholder="Preço, tempo, ceticismo..." />
                <YesNo id="disclaimer_oab" label="Disclaimer OAB exibido?" st={st} set={set} />
              </div>
            </div>
          )}

          {section === 5 && (
            <div className="p-5 space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-amber-400 font-bold">5.</span>
                <h3 className="font-semibold">Reflexão</h3>
              </div>
              <Area id="refl_deixou_fazer" label="O que você deixou de fazer e/ou teve dificuldade de implementar na mentoria?" st={st} set={set} />
              <Area id="refl_fez_alem" label="O que você fez além da mentoria que acredita que pode ter ajudado?" st={st} set={set} />
              <Area id="refl_mudar_mentoria" label="O que você acredita que pode ser mudado na mentoria?" st={st} set={set} />
              <Area id="refl_mudar_voce" label="O que pode ser mudado em você para melhorar seu desempenho?" st={st} set={set} />
              <Area id="refl_caracteristica" label="Característica pessoal sua que pode ter auxiliado?" st={st} set={set} />
            </div>
          )}

          {section === 6 && (
            <div className="p-5 space-y-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-amber-400 font-bold">6.</span>
                <h3 className="font-semibold">Empilhamento de Script</h3>
              </div>
              <div className="overflow-x-auto rounded-lg border" style={{ background: 'var(--bg-subtle, var(--bg-muted))' }}>
                <table className="w-full text-xs">
                  <thead className="border-b">
                    <tr>
                      <th className="text-left px-3 py-2">Bloco</th>
                      <th className="text-center px-2 py-2 w-20">Realizou?</th>
                      <th className="text-center px-2 py-2 w-24">Início</th>
                      <th className="text-center px-2 py-2 w-24">Fim</th>
                    </tr>
                  </thead>
                  <tbody>
                    {SCRIPT_BLOCKS.map((b) => (
                      <tr key={b.slug}>
                        <td className="px-3 py-1.5">{b.label}</td>
                        <td className="px-2 py-1.5 text-center">
                          <input
                            type="checkbox"
                            className="w-4 h-4 accent-amber-500 cursor-pointer"
                            checked={st[`script_${b.slug}_done`] === 'true'}
                            onChange={(e) => set(`script_${b.slug}_done`, e.target.checked ? 'true' : '')}
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <input type="time" className="w-full border rounded px-2 py-1 text-xs" value={st[`script_${b.slug}_start`] ?? ''} onChange={(e) => set(`script_${b.slug}_start`, e.target.value)} />
                        </td>
                        <td className="px-2 py-1.5">
                          <input type="time" className="w-full border rounded px-2 py-1 text-xs" value={st[`script_${b.slug}_end`] ?? ''} onChange={(e) => set(`script_${b.slug}_end`, e.target.value)} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {section === 7 && (
            <div className="p-5 space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-amber-400 font-bold">7.</span>
                <h3 className="font-semibold">Avatar / Perfil Demográfico</h3>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <YesNo id="avatar_pesquisa" label="Rodou pesquisa?" st={st} set={set} />
                <Num id="avatar_dias" label="Dias antes do evento" st={st} set={set} />
                <Num id="avatar_respostas" label="Total de respostas" st={st} set={set} />
                <Num id="avatar_feminino" label="% Feminino" st={st} set={set} step="0.01" />
                <Num id="avatar_masculino" label="% Masculino" st={st} set={set} step="0.01" />
                <Txt id="avatar_faixa_etaria" label="Faixa etária predominante" st={st} set={set} placeholder="Ex.: 45-60" />
                <Txt id="avatar_estado" label="Estado de residência" st={st} set={set} placeholder="Ex.: SP" />
                <Txt id="avatar_estado_civil" label="Estado civil predominante" st={st} set={set} placeholder="Ex.: Casado" />
                <Num id="avatar_filhos" label="% com filhos" st={st} set={set} step="0.01" />
                <Num id="avatar_netos" label="% com netos" st={st} set={set} step="0.01" />
                <Num id="avatar_patrimonio" label="% com patrimônio" st={st} set={set} step="0.01" />
                <Txt id="avatar_renda" label="Faixa de renda" st={st} set={set} placeholder="Ex.: R$ 10-20k" />
              </div>
            </div>
          )}
        </div>

        <div className="modal-foot sdb-foot">
          <div className="sdb-foot-left">
            {section > 1 && (
              <button onClick={() => setSection((s) => s - 1)} className="btn-ghost">
                ← Anterior
              </button>
            )}
            {err && <span style={{ color: 'var(--red)', fontSize: 13 }}>{err}</span>}
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => save.mutate(true)} className="btn-ghost" disabled={save.isPending}>
              Salvar Rascunho
            </button>
            {section < TOTAL && (
              <button onClick={() => setSection((s) => s + 1)} className="btn-primary">
                Próxima →
              </button>
            )}
            {section === TOTAL && (
              <button onClick={submit} className="btn-primary" style={{ background: 'var(--green)' }} disabled={save.isPending}>
                {save.isPending ? 'Enviando...' : 'Enviar SuperDebriefing 🏆'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
