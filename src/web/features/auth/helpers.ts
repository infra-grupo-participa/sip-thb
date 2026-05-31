// Helpers portados do legado public/js/shared/sip.js e cadastro.html.

export function passwordStrengthError(pwd: string): string | null {
  if (typeof pwd !== 'string') return 'A senha precisa ser texto.';
  if (pwd.length < 10) return 'A senha precisa ter ao menos 10 caracteres.';
  if (!/[A-Z]/.test(pwd)) return 'A senha precisa ter ao menos 1 letra maiúscula.';
  if (!/[a-z]/.test(pwd)) return 'A senha precisa ter ao menos 1 letra minúscula.';
  if (!/\d/.test(pwd)) return 'A senha precisa ter ao menos 1 número.';
  if (!/[^A-Za-z0-9]/.test(pwd)) return 'A senha precisa ter ao menos 1 caracter especial.';
  return null;
}

export interface PasswordStrength {
  score: number;
  label: string;
  color: string;
}

export function passwordStrength(pwd: string): PasswordStrength {
  if (!pwd) return { score: 0, label: '', color: '#b91c1c' };
  let s = 0;
  if (pwd.length >= 10) s++;
  if (pwd.length >= 14) s++;
  const variety =
    Number(/[A-Z]/.test(pwd)) +
    Number(/[a-z]/.test(pwd)) +
    Number(/[0-9]/.test(pwd)) +
    Number(/[^A-Za-z0-9]/.test(pwd));
  s += Math.max(0, variety - 2);
  const score = Math.min(4, s);
  const labels = ['Muito fraca', 'Fraca', 'Razoável', 'Forte', 'Excelente'];
  const colors = ['#b91c1c', '#dc2626', '#d97706', '#65a30d', '#15803d'];
  return { score, label: labels[score] ?? '', color: colors[score] ?? '#b91c1c' };
}

export function sanitizeText(s: string, maxLen?: number): string {
  if (typeof s !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  let out = s.replace(/[\u0000-\u001F\u007F\u200B-\u200D\uFEFF]/g, '');
  out = out.replace(/\s+/g, ' ').trim();
  if (maxLen && out.length > maxLen) out = out.slice(0, maxLen);
  return out;
}

export function maskPhone(raw: string): string {
  const digits = String(raw || '').replace(/\D/g, '').slice(0, 11);
  if (!digits) return '';
  if (digits.length <= 2) return `(${digits}`;
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

export function maskCnpj(value: string): string {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 14);
  let out = digits;
  if (digits.length > 12) out = digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{1,2}).*$/, '$1.$2.$3/$4-$5');
  else if (digits.length > 8) out = digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{1,4}).*$/, '$1.$2.$3/$4');
  else if (digits.length > 5) out = digits.replace(/^(\d{2})(\d{3})(\d{1,3}).*$/, '$1.$2.$3');
  else if (digits.length > 2) out = digits.replace(/^(\d{2})(\d{1,3}).*$/, '$1.$2');
  return out;
}

export function normalizeInstagram(value: string): string {
  const v = value.trim();
  if (!v) return '';
  const urlMatch = v.match(/(?:https?:\/\/)?(?:www\.)?instagram\.com\/([^/?#\s]+)/i);
  if (urlMatch && urlMatch[1]) return '@' + urlMatch[1].replace(/\/$/, '');
  if (v.startsWith('@')) return v;
  return '@' + v;
}

export const UF_LIST = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG',
  'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
];

const NAME_RE = /^[\p{L}][\p{L}\s'.-]{1,99}$/u;
const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const CITY_RE = /^[\p{L}][\p{L}\s.'-]{1,79}$/u;

export function validateName(v: string): string | null {
  if (!v) return 'Informe seu nome.';
  if (v.length < 3) return 'Nome muito curto.';
  if (v.length > 100) return 'Nome muito longo (máx 100).';
  if (!v.includes(' ')) return 'Informe nome e sobrenome.';
  if (!NAME_RE.test(v)) return "Use apenas letras, espaços e -, ', .";
  return null;
}
export function validateEmail(v: string): string | null {
  if (!v) return 'Informe seu e-mail.';
  if (v.length > 120) return 'E-mail muito longo.';
  if (!EMAIL_RE.test(v)) return 'E-mail inválido.';
  return null;
}
export function validatePhone(v: string): string | null {
  if (!v) return 'Informe o celular.';
  const digits = v.replace(/\D/g, '');
  if (digits.length !== 11) return 'Celular deve ter 11 dígitos com DDD.';
  const ddd = parseInt(digits.slice(0, 2), 10);
  if (ddd < 11 || ddd > 99) return 'DDD inválido.';
  if (digits[2] !== '9') return 'Celular deve começar com 9 após o DDD.';
  return null;
}
export function validateUf(v: string): string | null {
  if (!v) return 'Selecione o estado.';
  if (!UF_LIST.includes(v)) return 'UF inválida.';
  return null;
}
export function validateCity(v: string): string | null {
  if (!v) return 'Informe a cidade.';
  if (!CITY_RE.test(v)) return 'Cidade inválida.';
  return null;
}
export function validatePassword2(p1: string, p2: string): string | null {
  if (!p2) return 'Confirme a senha.';
  if (p1 !== p2) return 'As senhas não coincidem.';
  return null;
}

export const PROFISSOES = [
  'Acupunturista', 'Administrador', 'Advogado(a)', 'Agente de Viagens', 'Agrônomo(a)', 'Analista de Sistemas',
  'Arquiteto(a)', 'Arquiteto(a) de Interiores', 'Artesão(ã)', 'Artista Plástico(a)', 'Atleta', 'Auditor(a)',
  'Biomédico(a)', 'Bombeiro(a)', 'Cabeleireiro(a)', 'Chef de Cozinha', 'Cinegrafista', 'Cirurgião(ã) Dentista',
  'Coach', 'Confeiteiro(a)', 'Consultor(a)', 'Consultor(a) de RH', 'Contador(a)', 'Copywriter', 'Corretor(a) de Imóveis',
  'Corretor(a) de Seguros', 'Costureiro(a)', 'Criador(a) de Conteúdo', 'Decorador(a)', 'Dentista', 'Designer',
  'Designer Gráfico', 'Designer de Interiores', 'Designer de Produto', 'Desenvolvedor(a)', 'Dermatologista',
  'Educador(a) Físico(a)', 'Empreendedor(a)', 'Empresário(a)', 'Enfermeiro(a)', 'Engenheiro(a) Civil',
  'Engenheiro(a) de Software', 'Engenheiro(a) Elétrico(a)', 'Engenheiro(a) Mecânico(a)', 'Esteticista', 'Estilista',
  'Farmacêutico(a)', 'Fisioterapeuta', 'Fonoaudiólogo(a)', 'Fotógrafo(a)', 'Geólogo(a)', 'Ginecologista',
  'Gestor(a) de Tráfego', 'Investidor(a)', 'Jornalista', 'Juiz(a)', 'Maquiador(a)', 'Marketing Digital',
  'Médico(a)', 'Mentor(a)', 'Microempresário(a)', 'Músico(a)', 'Nutricionista', 'Obstetra', 'Odontólogo(a)',
  'Oftalmologista', 'Otorrinolaringologista', 'Pastor(a)', 'Pedagogo(a)', 'Personal Trainer', 'Pediatra',
  'Pesquisador(a)', 'Psicanalista', 'Psicólogo(a)', 'Psicopedagogo(a)', 'Psiquiatra', 'Publicitário(a)',
  'Quiroprático(a)', 'Radiologista', 'Redator(a)', 'Representante Comercial', 'Social Media', 'Tatuador(a)',
  'Técnico(a) de Enfermagem', 'Terapeuta', 'Terapeuta Holístico(a)', 'Terapeuta Ocupacional', 'Tradutor(a)',
  'Treinador(a)', 'Urologista', 'Veterinário(a)', 'Outros',
];

// Carrega municípios do IBGE (mesma fonte do legado).
const _citiesCache: Record<string, string[]> = {};
export async function loadCitiesForUf(uf: string): Promise<string[]> {
  if (!uf) return [];
  const cached = _citiesCache[uf];
  if (cached) return cached;
  try {
    const res = await fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios`);
    if (!res.ok) throw new Error('IBGE indisponível');
    const data = (await res.json()) as Array<{ nome: string }>;
    const names = data.map((m) => m.nome).sort((a, b) => a.localeCompare(b, 'pt-BR'));
    _citiesCache[uf] = names;
    return names;
  } catch {
    return [];
  }
}
