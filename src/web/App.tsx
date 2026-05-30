import { useQuery } from '@tanstack/react-query';
import { sipApi } from './lib/api';

interface Health {
  ok: boolean;
  service: string;
  env: string;
  db_configured: boolean;
  db?: string;
  db_error?: string;
}

export default function App() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['health'],
    queryFn: () => sipApi<Health>('/health', { throwOnError: true }),
    refetchInterval: 15_000,
  });

  const online = !isLoading && !isError && data?.ok === true;
  const dbOk = data?.db === 'ok';

  return (
    <div className="shell">
      <div className="card">
        <div className="brand-bar" />
        <h1>SIP — Sistema de Implementação Prática</h1>
        <p className="muted">
          Fundação do refactor (Express + React). Reusa o mesmo banco Supabase.
        </p>

        <div className="status">
          <span className={`dot ${online ? 'ok' : isLoading ? '' : 'err'}`} />
          {isLoading
            ? 'Verificando o servidor…'
            : online
              ? `Servidor no ar (${data?.env}) · Banco: ${dbOk ? 'conectado' : data?.db}`
              : 'Servidor indisponível'}
        </div>

        {data && <pre>{JSON.stringify(data, null, 2)}</pre>}
      </div>
    </div>
  );
}
