// Helpers do painel admin — porte de js/shared/sip.js (sipCicloChip etc).

export type CicloType = 'aurum' | 'seminario' | null | undefined;

export function cicloLabel(cicloType: CicloType, isPlatina?: boolean): string {
  if (cicloType === 'aurum') return 'Aurum';
  if (cicloType === 'seminario') return isPlatina ? 'Platina' : 'Diamante';
  return 'Pendente';
}

export function cicloChip(
  cicloType: CicloType,
  isPlatina?: boolean,
): { label: string; cls: string } {
  if (cicloType === 'aurum') return { label: 'Aurum', cls: 'is-aurum' };
  if (cicloType === 'seminario')
    return { label: isPlatina ? 'Platina' : 'Diamante', cls: 'is-diamante' };
  return { label: 'Pendente', cls: 'is-pending' };
}

export function isAurum(x: { ciclo_type?: string | null } | null | undefined): boolean {
  return !!x && x.ciclo_type === 'aurum';
}

export function isSeminario(x: { ciclo_type?: string | null } | null | undefined): boolean {
  return !!x && x.ciclo_type === 'seminario';
}

export function initials(name: string | null | undefined): string {
  const parts = (name || '?').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return (parts[0] ?? '?').slice(0, 2).toUpperCase();
  const first = parts[0] ?? '';
  const last = parts[parts.length - 1] ?? '';
  return ((first[0] ?? '') + (last[0] ?? '')).toUpperCase();
}

export function fmtDateShort(d: string | null | undefined): string {
  if (!d) return '—';
  return new Date(d + 'T00:00:00').toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
  });
}

export function fmtDateFull(d: string | null | undefined): string {
  if (!d) return '—';
  return new Date(d + 'T00:00:00').toLocaleDateString('pt-BR');
}

export function fmtBRL(n: number | null | undefined): string {
  if (n == null) return '—';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function fmtNum(n: number | null | undefined): string {
  if (n == null) return '—';
  return n.toLocaleString('pt-BR');
}
