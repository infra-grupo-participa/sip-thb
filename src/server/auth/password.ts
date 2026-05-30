// Validação/sanitização — porte 1:1 de sip-auth/index.ts (paridade Fase 1).

export const NAME_RE = /^[\p{L}][\p{L}\s'.\-]{1,99}$/u;
export const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

export function passwordStrengthError(pwd: string): string | null {
  if (typeof pwd !== 'string') return 'A senha precisa ser texto.';
  if (pwd.length < 10) return 'A senha precisa ter ao menos 10 caracteres.';
  if (pwd.length > 128) return 'A senha é longa demais.';
  if (!/[A-Z]/.test(pwd)) return 'A senha precisa ter ao menos 1 letra maiúscula.';
  if (!/[a-z]/.test(pwd)) return 'A senha precisa ter ao menos 1 letra minúscula.';
  if (!/[0-9]/.test(pwd)) return 'A senha precisa ter ao menos 1 número.';
  if (!/[^A-Za-z0-9]/.test(pwd)) return 'A senha precisa ter ao menos 1 caracter especial.';
  return null;
}

// Remove controle (0x00-0x1F, 0x7F), zero-width (0x200B-0x200D) e BOM (0xFEFF),
// normaliza espaços e trunca. Mesmo comportamento do backend atual (sip-auth).
// Filtra por code point para evitar regex de controle ambígua.
export function sanitizeText(s: unknown, maxLen: number): string {
  if (typeof s !== 'string') return '';
  let out = Array.from(s)
    .filter((ch) => {
      const c = ch.codePointAt(0) ?? 0;
      if (c <= 0x1f || c === 0x7f) return false;
      if (c >= 0x200b && c <= 0x200d) return false;
      if (c === 0xfeff) return false;
      return true;
    })
    .join('');
  out = out.replace(/\s+/g, ' ').trim();
  if (out.length > maxLen) out = out.slice(0, maxLen);
  return out;
}
