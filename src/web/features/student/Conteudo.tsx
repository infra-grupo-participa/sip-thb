// Tela "Conteúdo & Tráfego" — reescrita para reusar os componentes fiéis ao
// legado (Postagens + aba Tráfego "Em breve"). Mantida como export default
// para compatibilidade com rotas existentes; o fluxo completo do aluno vive
// no Dashboard (StudentShell) com navegação por abas.
import Postagens from './Postagens';
import Trafego from './Trafego';

export default function Conteudo() {
  return (
    <main className="page-main">
      <header className="page-head">
        <h1>Conteúdo &amp; Tráfego</h1>
        <p>Registre seus posts e acompanhe o tráfego pago do ciclo.</p>
      </header>
      <Postagens />
      <div style={{ height: 16 }} />
      <Trafego />
    </main>
  );
}
