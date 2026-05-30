// Sessão/token no frontend. Porte parcial de shared/sip.js + flow.js.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { sipApi } from './api';

const TOKEN_KEY = 'sip_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(t: string): void {
  localStorage.setItem(TOKEN_KEY, t);
}
export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'monitor' | 'student';
  ciclo_type: 'aurum' | 'seminario' | null;
  onboarding_done: boolean;
  monitor_id: string | null;
  monitor_name: string | null;
  is_socio: boolean;
  socio_of: string | null;
  owner_name: string | null;
  must_change_password: boolean;
  approval_status: string;
  email_verified: boolean;
  raiox_submitted_at: string | null;
}

interface LoginResponse {
  token: string;
  user: SessionUser;
}

// Restaura a sessão a partir do JWT (GET /me). Só roda se houver token.
export function useSession() {
  return useQuery({
    queryKey: ['session'],
    queryFn: () => sipApi<SessionUser>('/me', { throwOnError: true }),
    enabled: !!getToken(),
    retry: false,
    staleTime: 60_000,
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (creds: { email: string; password: string }) => {
      const res = await sipApi<LoginResponse>('/login', {
        method: 'POST',
        body: JSON.stringify(creds),
        throwOnError: true,
      });
      if (!res?.token) throw new Error('Resposta de login inválida');
      return res;
    },
    onSuccess: (res) => {
      setToken(res.token);
      qc.setQueryData(['session'], res.user);
    },
  });
}

export function logout(): void {
  clearToken();
  window.location.assign('/login');
}
