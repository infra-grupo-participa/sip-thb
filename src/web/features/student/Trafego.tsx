// Aba Tráfego — fiel ao legado: módulo de tráfego pago "Em breve".
// O legado mantém containers ocultos; aqui exibimos só o estado visível.
export default function Trafego() {
  return (
    <div className="space-y-4">
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '48px 20px',
          borderRadius: 16,
          border: '1px dashed var(--border)',
          background: 'var(--bg-muted, #f8f8f8)',
          textAlign: 'center',
          gap: 12,
        }}
      >
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--text-mute)" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="20" x2="18" y2="10" />
          <line x1="12" y1="20" x2="12" y2="4" />
          <line x1="6" y1="20" x2="6" y2="14" />
        </svg>
        <div>
          <p style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', margin: 0 }}>Métricas de Tráfego</p>
          <span style={{ display: 'inline-block', marginTop: 4, fontSize: 11, fontWeight: 700, padding: '2px 10px', borderRadius: 999, background: 'rgba(245,158,11,.15)', color: '#d97706' }}>
            Em breve
          </span>
        </div>
        <p style={{ fontSize: 13, color: 'var(--text-mute)', maxWidth: 360, margin: 0 }}>
          O módulo de acompanhamento de tráfego pago será disponibilizado em breve. A equipe acompanha suas campanhas diretamente pelo gestor de tráfego.
        </p>
      </div>
    </div>
  );
}
