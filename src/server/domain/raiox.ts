// Scoring do Raio-X — porte 1:1 de _shared/raiox-score.ts.
export type RaioxQuestion = { id: string; tipo: string; peso?: number | null };
export type RaioxScoreResult = { total: number; max: number; cleaned: Record<string, unknown> };

export function computeRaioxScore(
  answersObj: Record<string, unknown>,
  questions: RaioxQuestion[],
  sanitizeText: (s: unknown, maxLen: number) => string,
): RaioxScoreResult {
  let total = 0;
  let max = 0;
  const cleaned: Record<string, unknown> = {};
  for (const q of questions || []) {
    const raw = answersObj[q.id];
    const peso = Number(q.peso ?? 1);
    if (q.tipo === 'escala_1_5') {
      if (raw == null) continue;
      const n = Math.max(1, Math.min(5, Number(raw) || 0));
      total += n * peso;
      max += 5 * peso;
      cleaned[q.id] = n;
    } else if (q.tipo === 'sim_nao') {
      if (raw == null) continue;
      const v = raw === true || raw === 'sim' || raw === 'yes' || raw === 1;
      total += (v ? 5 : 1) * peso;
      max += 5 * peso;
      cleaned[q.id] = v ? 'sim' : 'nao';
    } else if (q.tipo === 'sim_nao_andamento') {
      if (raw == null) continue;
      const v = String(raw).toLowerCase();
      if (!['sim', 'nao', 'andamento'].includes(v)) continue;
      const pts = v === 'sim' ? 5 : v === 'andamento' ? 2.5 : 0;
      total += pts * peso;
      max += 5 * peso;
      cleaned[q.id] = v;
    } else if (q.tipo === 'numero') {
      const n = Math.max(0, Math.min(999, Number(raw) || 0));
      total += Math.min(n, 5) * peso;
      max += 5 * peso;
      cleaned[q.id] = n;
    } else if (q.tipo === 'texto') {
      if (raw == null || raw === '') continue;
      const s = sanitizeText(String(raw), 200);
      cleaned[q.id] = s;
      if (peso > 0) {
        const filled = s.trim().length > 0 ? 5 : 0;
        total += filled * peso;
        max += 5 * peso;
      }
    } else {
      if (raw != null) cleaned[q.id] = sanitizeText(String(raw), 200);
    }
  }
  return { total, max, cleaned };
}
