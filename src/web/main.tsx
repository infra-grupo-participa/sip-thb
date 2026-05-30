import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import './index.css';
// Design system legado (tokens de marca + classes hb-*). Importado por último
// para prevalecer nos elementos compartilhados (body, tipografia, cores).
import './legacy/dashboard.css';

const queryClient = new QueryClient();

// Qualquer 401 (token rejeitado/expirado) → limpa cache e volta ao login,
// em vez de deixar a tela presa com "Sessão expirada".
window.addEventListener('sip:session-expired', () => {
  queryClient.clear();
  if (window.location.pathname !== '/login') window.location.assign('/login');
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
