// Porte de sip.js (sipApi) — contrato preservado (doc 08 §4A.1).
// Versão inicial da fundação: o tratamento completo de 401/429 será
// finalizado quando o auth entrar (Fase 5 do plano).
const BASE = import.meta.env.VITE_API_URL ?? '/api';

export class SipApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: unknown,
  ) {
    super(message);
    this.name = 'SipApiError';
  }
}

function token(): string | null {
  return localStorage.getItem('sip_token');
}

export async function sipApi<T = unknown>(
  path: string,
  opts: RequestInit & { throwOnError?: boolean } = {},
): Promise<T | null> {
  const { throwOnError = false, ...init } = opts;
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token() ?? ''}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
  } catch {
    const err = { error: 'Sem conexão com o servidor.' };
    if (throwOnError) throw new SipApiError(err.error, 0, null);
    return err as T;
  }

  if (res.status === 401) {
    localStorage.removeItem('sip_token');
    window.dispatchEvent(new CustomEvent('sip:session-expired'));
    if (throwOnError) throw new SipApiError('Sessão expirada', 401, null);
    return null;
  }

  let data: T | null = null;
  try {
    data = (await res.json()) as T;
  } catch {
    /* corpo vazio é OK */
  }

  if (throwOnError && !res.ok) {
    throw new SipApiError(
      (data as { error?: string })?.error ?? `Erro ${res.status}`,
      res.status,
      data,
    );
  }
  return data;
}
