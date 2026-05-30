// Domínio: Ciclo — porte 1:1 de _shared/domain/ciclo.ts (puro).
export type CicloType = 'aurum' | 'seminario' | null;
export type Ciclo = 'aurum' | 'diamante' | 'platina' | 'pendente';
export type CicloBearer = { ciclo_type?: CicloType | string | null; is_platina?: boolean | null };

export function cicloOf(x: CicloBearer): Ciclo {
  if (x.ciclo_type === 'aurum') return 'aurum';
  if (x.ciclo_type === 'seminario') return x.is_platina === true ? 'platina' : 'diamante';
  return 'pendente';
}

export function cicloApiPair(c: Ciclo): { ciclo_type: CicloType; is_platina: boolean } {
  if (c === 'aurum') return { ciclo_type: 'aurum', is_platina: false };
  if (c === 'platina') return { ciclo_type: 'seminario', is_platina: true };
  if (c === 'diamante') return { ciclo_type: 'seminario', is_platina: false };
  return { ciclo_type: null, is_platina: false };
}

export function cicloLabel(c: Ciclo): string {
  if (c === 'aurum') return 'Aurum';
  if (c === 'diamante') return 'Diamante';
  if (c === 'platina') return 'Platina';
  return 'Pendente';
}

export function isAurum(x: CicloBearer): boolean {
  return x.ciclo_type === 'aurum';
}
export function isSeminario(x: CicloBearer): boolean {
  return x.ciclo_type === 'seminario';
}

export const VALID_CICLO_TYPES = ['aurum', 'seminario'] as const;
export function isValidCicloType(v: unknown): v is 'aurum' | 'seminario' {
  return typeof v === 'string' && (VALID_CICLO_TYPES as readonly string[]).includes(v);
}
