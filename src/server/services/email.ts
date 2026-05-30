// Serviço de e-mail (Resend) — porte de sip-email/index.ts. Chamado direto
// (não HTTP cross-function). Fire-and-forget no caller; falha não bloqueia fluxo.
import { env } from '../env.js';

const FROM_NAME = 'SIP - Aurum';
const FROM_EMAIL = 'noreply@sip.grupoparticipa.app.br';
const BASE_URL = env.SIP_APP_URL || 'https://sip.grupoparticipa.app.br';

async function sendEmail(to: string, subject: string, html: string, text: string): Promise<boolean> {
  if (!env.RESEND_API_KEY) {
    console.error('[email] RESEND_API_KEY não configurada');
    return false;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: `${FROM_NAME} <${FROM_EMAIL}>`, to: [to], subject, html, text }),
    });
    if (!res.ok) {
      console.error('[email] Resend error:', res.status, await res.text());
      return false;
    }
    return true;
  } catch (e) {
    console.error('[email] fetch failed:', e);
    return false;
  }
}

function emailBase(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="margin:0;padding:0;background:#f4f5f8;font-family:'Inter',Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px"><tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08)">
      <tr><td style="background:#0f172a;padding:24px 32px;text-align:center">
        <p style="color:#C8A96E;font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;margin:0">SIP - Aurum</p>
      </td></tr>
      <tr><td style="padding:32px">${body}</td></tr>
      <tr><td style="padding:16px 32px 24px;border-top:1px solid #eef0f4;text-align:center">
        <p style="font-size:11px;color:#94a3b8;margin:0">Este e-mail foi enviado automaticamente pelo sistema SIP da Mentoria Aurum. Não responda.</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

function digitsHtml(code: string): string {
  return code
    .split('')
    .map(
      (d) => `
    <td style="padding:0 4px"><table cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate">
      <tr><td width="44" height="56" align="center" valign="middle" style="background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;font-family:'Courier New',Consolas,monospace;font-size:30px;font-weight:800;color:#0f172a;line-height:56px">${d}</td></tr>
    </table></td>`,
    )
    .join('');
}

function tplCode(nome: string, code: string, kind: 'verificacao' | 'reset'): { html: string; text: string } {
  const lead =
    kind === 'verificacao'
      ? 'Use o código abaixo para confirmar seu e-mail e liberar o acesso ao SIP.'
      : 'Use o código abaixo para redefinir sua senha no SIP. Ele é válido por <strong>10 minutos</strong>.';
  const html = emailBase(kind === 'verificacao' ? 'Seu código de verificação — SIP' : 'Redefinição de senha — SIP', `
    <h2 style="font-size:22px;font-weight:800;color:#0f172a;margin:0 0 12px;text-align:center">Olá, ${nome}!</h2>
    <p style="font-size:15px;color:#475569;line-height:1.6;margin:0 0 28px;text-align:center">${lead}</p>
    <table cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto 28px"><tr><td>
      <table cellpadding="0" cellspacing="0" border="0"><tr>${digitsHtml(code)}</tr></table>
    </td></tr></table>
    <p style="font-size:12px;color:#94a3b8;line-height:1.5;text-align:center;margin:24px 0 0">O código expira em <strong style="color:#475569">10 minutos</strong>. Se você não solicitou, ignore este e-mail.</p>
  `);
  const text = `Olá, ${nome}!\n\nSeu código SIP: ${code}\n\nExpira em 10 minutos.`;
  return { html, text };
}

function tplAcessoLiberado(nome: string): { html: string; text: string } {
  const html = emailBase('Seu acesso ao SIP foi liberado!', `
    <h2 style="font-size:22px;font-weight:800;color:#0f172a;margin:0 0 12px">Parabéns, ${nome}!</h2>
    <p style="font-size:15px;color:#475569;line-height:1.6;margin:0 0 28px">Seu acesso ao SIP foi liberado. Você já pode entrar no sistema e começar o seu ciclo. Use o e-mail e senha cadastrados.</p>
    <table cellpadding="0" cellspacing="0" style="margin:0 auto 24px"><tr><td style="background:#C8A96E;border-radius:10px;padding:14px 32px;text-align:center">
      <a href="${BASE_URL}/" style="color:#0f172a;font-size:15px;font-weight:700;text-decoration:none">Acessar o SIP</a>
    </td></tr></table>
  `);
  const text = `Parabéns, ${nome}!\n\nSeu acesso ao SIP foi liberado. Acesse: ${BASE_URL}/`;
  return { html, text };
}

/** Mesma interface do dispatchEmail legado. Nunca lança. */
export async function dispatchEmail(type: string, payload: Record<string, unknown>): Promise<boolean> {
  const to = String(payload.to ?? '');
  const nome = String(payload.nome ?? '');
  if (!to || !nome) return false;
  if (type === 'verificacao_email') {
    const code = String(payload.code ?? '');
    if (!/^\d{6}$/.test(code)) return false;
    const t = tplCode(nome, code, 'verificacao');
    return sendEmail(to, '[AURUM] Seu código de verificação do SIP', t.html, t.text);
  }
  if (type === 'reset_senha') {
    const code = String(payload.code ?? '');
    if (!/^\d{6}$/.test(code)) return false;
    const t = tplCode(nome, code, 'reset');
    return sendEmail(to, '[AURUM] Código para redefinição de senha', t.html, t.text);
  }
  if (type === 'acesso_liberado') {
    const t = tplAcessoLiberado(nome);
    return sendEmail(to, '[AURUM] Seu acesso ao SIP foi liberado!', t.html, t.text);
  }
  console.error('[email] tipo desconhecido:', type);
  return false;
}
