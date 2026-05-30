// bcrypt (cost 10) — porte de sip-auth (Deno usava bcryptjs@2.4.3).
import bcrypt from 'bcryptjs';

export const bcryptHash = (plain: string): Promise<string> => bcrypt.hash(plain, 10);
export const bcryptCompare = (plain: string, hash: string): Promise<boolean> =>
  bcrypt.compare(plain, hash);
