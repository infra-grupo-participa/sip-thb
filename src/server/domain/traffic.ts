// Domínio: Tráfego pago — porte de _shared/domain/platform.ts + traffic-fields.ts
// + calcTrafficKpis (de _shared.ts).

export type TrafficPlatform =
  | 'meta_instagram'
  | 'meta_facebook'
  | 'tiktok'
  | 'youtube'
  | 'google'
  | 'outros';

export const PLATFORMS: readonly TrafficPlatform[] = [
  'meta_instagram', 'meta_facebook', 'tiktok', 'youtube', 'google', 'outros',
];

export const PLATFORM_LABELS: Record<TrafficPlatform, string> = {
  meta_instagram: 'Instagram',
  meta_facebook: 'Facebook',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  google: 'Google',
  outros: 'Outros',
};

export function sanitizePlatform(raw: unknown): TrafficPlatform {
  if (typeof raw !== 'string') return 'outros';
  const normalized = raw.toLowerCase().trim();
  return (PLATFORMS as readonly string[]).includes(normalized) ? (normalized as TrafficPlatform) : 'outros';
}

export interface TrafficFields {
  spent: number;
  impressions: number;
  clicks: number;
  page_views: number;
  page_conversion: number;
  leads_meta: number;
  leads_builderall: number;
  leads_whatsapp: number;
  grupos_whatsapp: number;
  meta_captacao: number;
  platform: TrafficPlatform;
  vendas_dia: number;
  faturamento_dia: number;
}

function intOrZero(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.max(0, Math.floor(raw));
  if (typeof raw !== 'string') return 0;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}
function floatOrZero(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.max(0, raw);
  if (typeof raw !== 'string') return 0;
  const n = parseFloat(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function sanitizeTrafficFields(body: Record<string, unknown>): TrafficFields {
  return {
    spent: floatOrZero(body.spent),
    impressions: intOrZero(body.impressions),
    clicks: intOrZero(body.clicks),
    page_views: intOrZero(body.page_views),
    page_conversion: floatOrZero(body.page_conversion),
    leads_meta: intOrZero(body.leads_meta),
    leads_builderall: intOrZero(body.leads_builderall),
    leads_whatsapp: intOrZero(body.leads_whatsapp),
    grupos_whatsapp: intOrZero(body.grupos_whatsapp),
    meta_captacao: intOrZero(body.meta_captacao),
    platform: sanitizePlatform(body.platform),
    vendas_dia: intOrZero(body.vendas_dia),
    faturamento_dia: floatOrZero(body.faturamento_dia),
  };
}

// KPIs por linha (de _shared.ts calcTrafficKpis).
export function calcTrafficKpis(rows: Record<string, number>[]) {
  return rows.map((r) => {
    const spent = r.spent ?? 0;
    const impressions = r.impressions ?? 0;
    const clicks = r.clicks ?? 0;
    const page_views = r.page_views ?? 0;
    const leads_builderall = r.leads_builderall ?? 0;
    const cpm = impressions > 0 ? (spent / impressions) * 1000 : null;
    const ctr = impressions > 0 ? (clicks / impressions) * 100 : null;
    const load_rate = clicks > 0 ? (page_views / clicks) * 100 : null;
    const cpl = leads_builderall > 0 ? spent / leads_builderall : null;
    return { ...r, cpm, ctr, load_rate, cpl };
  });
}

// Extrai shortcode de URL do Instagram (de _shared/domain/ig.ts).
export function extractIgShortcode(url: string): string | null {
  const match = url.match(/instagram\.com\/(?:p|reel)\/([A-Za-z0-9_-]+)/);
  return match ? match[1]! : null;
}
