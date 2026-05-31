import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { sipApi } from '../../../lib/api';

interface Setting { key: string; label: string; kind: string; default: string; value: string }

export default function Settings() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['admin-settings'],
    queryFn: () => sipApi<Setting[]>('/admin/settings', { throwOnError: true }),
  });
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (data) {
      const init: Record<string, string> = {};
      data.forEach((s) => { init[s.key] = s.value ?? ''; });
      setDraft(init);
    }
  }, [data]);

  const save = useMutation({
    mutationFn: () => sipApi('/admin/settings', { method: 'POST', body: JSON.stringify({ settings: draft }), throwOnError: true }),
    onSuccess: () => {
      setSaved(true);
      qc.invalidateQueries({ queryKey: ['admin-settings'] });
      setTimeout(() => setSaved(false), 2000);
    },
  });

  return (
    <div className="hb-card rounded-xl" style={{ overflow: 'hidden' }}>
      <div className="px-5 py-4 border-b">
        <h2 className="font-semibold">Mensagens e configurações</h2>
        <p className="text-xs mt-0.5">Edite textos exibidos aos alunos, banners e metas — sem precisar mexer em código</p>
      </div>
      <form
        className="p-5 space-y-4"
        onSubmit={(e) => { e.preventDefault(); save.mutate(); }}
      >
        <div className="space-y-4">
          {(data ?? []).length === 0 && <div className="text-sm text-center py-8">Carregando configurações...</div>}
          {(data ?? []).map((s) => {
            const val = draft[s.key] ?? '';
            const isDefault = val === s.default;
            return (
              <div key={s.key} style={{ borderRadius: 8, padding: 16, border: '1px solid var(--border-soft)', background: 'var(--bg-muted)' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8, gap: 12, flexWrap: 'wrap' }}>
                  <label className="text-sm font-medium">{s.label}</label>
                  <span className="text-xs" style={{ color: 'var(--text-mute)' }}>{s.key}</span>
                </div>
                {s.kind === 'textarea' ? (
                  <textarea
                    rows={3}
                    className="hb-input"
                    style={{ width: '100%', resize: 'vertical' }}
                    placeholder={s.default}
                    value={val}
                    onChange={(e) => setDraft({ ...draft, [s.key]: e.target.value })}
                  />
                ) : (
                  <input
                    className="hb-input"
                    style={{ width: '100%' }}
                    placeholder={s.default}
                    value={val}
                    onChange={(e) => setDraft({ ...draft, [s.key]: e.target.value })}
                  />
                )}
                {!isDefault && (
                  <button type="button" className="text-xs mt-2" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-mute)' }} onClick={() => setDraft({ ...draft, [s.key]: s.default })}>
                    ↺ Restaurar padrão
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <div className="flex justify-end gap-3 pt-3 border-t">
          <button type="submit" className="hb-btn hb-btn-primary" disabled={save.isPending}>
            {save.isPending ? 'Salvando…' : saved ? 'Salvo ✓' : 'Salvar todas as alterações'}
          </button>
        </div>
      </form>
    </div>
  );
}
