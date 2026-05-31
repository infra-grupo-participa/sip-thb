// Admin — Raio-X (porte fiel de handlers/admin-raiox.ts, split E.1.1).
//
// Concentra os fluxos do Raio-X visíveis pelo admin:
//   1. Ranking dos alunos (GET /admin/raiox-ranking)
//   2. Pendentes — quem ainda não preencheu (GET /admin/raiox-pending)
//   3. Recompute em batch (POST /admin/raiox-recompute)
//   4. Detalhe de respostas de um aluno (GET /admin/students/:id/raiox)
//   5. CRUD de perguntas (GET/POST /admin/raiox-questions, PATCH|PUT/DELETE /:id)
//
// Montagem: este router deve subir ANTES do adminRouter genérico, para que
// GET /admin/students/:id/raiox seja capturado aqui e não pelo roster.
// O gate de role (adminGate) já é aplicado em /api/admin no index.ts; os
// checks de role inline do legado são redundantes nesse mount e foram
// omitidos (o gate já bloqueia não-admins).
import { Router } from 'express';
import { sip } from '../db.js';
import { audit } from '../domain/audit.js';
import { computeRaioxScore } from '../domain/raiox.js';

export const adminRaioxRouter = Router();

// Classificação para AÇÃO (porte de _shared/domain/student-status.ts).
// Thresholds 40/70 — usado no ranking (cor da borda / KPIs de criticidade).
// Mantido in-loco para evitar criar um helper compartilhado novo nesta área.
type RaioxClassification = 'critico' | 'atencao' | 'ok';
function raioxClassify(percent: number): RaioxClassification {
  if (percent < 40) return 'critico';
  if (percent < 70) return 'atencao';
  return 'ok';
}

// sanitizeText local — mesma fórmula que o legado usa pra recompute.
// Mantido in-loco (paridade com handlers/admin-raiox.ts).
function sanitizeText(s: unknown, max: number): string | null {
  if (typeof s !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  let out = s.split('').filter((ch) => { const c = ch.charCodeAt(0); if (c <= 0x1f || c === 0x7f) return false; if (c >= 0x200b && c <= 0x200d) return false; if (c === 0xfeff) return false; return true; }).join('').replace(/\s+/g, ' ').trim();
  if (out.length > max) out = out.slice(0, max);
  return out;
}

type RaioxRankingItem = {
  user_id: string;
  name: string;
  email: string;
  phone: string | null;
  ciclo_type: 'aurum' | 'seminario' | null;
  is_platina: boolean;
  score: number;
  max_score: number;
  percent: number;
  classificacao: 'critico' | 'atencao' | 'ok';
  submitted_at: string | null;
  tem_monitor: boolean;
  categorias_fracas: Array<{ categoria: string; percent: number }>;
};

// ── GET /admin/raiox-ranking — alunos com Raio-X submetido, ordenados pelos piores
adminRaioxRouter.get('/admin/raiox-ranking', async (req, res, next) => {
  try {
    const cicloFilter = typeof req.query.ciclo_type === 'string' ? req.query.ciclo_type : null;
    // Cap defensivo: query sem LIMIT puxava todos os students; padrão 500 (override via ?limit=)
    const limitParam = Number(req.query.limit);
    const cap = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 2000) : 500;
    let usersQ = sip()
      .from('users')
      .select('id, name, email, phone, ciclo_type, is_platina, raiox_score, raiox_max_score, raiox_submitted_at, raiox_answers, monitor_id')
      .eq('role', 'student')
      .not('raiox_submitted_at', 'is', null)
      .order('raiox_submitted_at', { ascending: false })
      .limit(cap);
    // Aceita 'aurum', 'seminario' (Diamante = seminario+is_platina=false), e 'platina'
    // (mapeia para seminario+is_platina=true). Sem filtro = todos os ciclos.
    if (cicloFilter === 'aurum') {
      usersQ = usersQ.eq('ciclo_type', 'aurum');
    } else if (cicloFilter === 'seminario') {
      usersQ = usersQ.eq('ciclo_type', 'seminario').neq('is_platina', true);
    } else if (cicloFilter === 'platina') {
      usersQ = usersQ.eq('ciclo_type', 'seminario').eq('is_platina', true);
    }
    const [{ data: students }, { data: questions }] = await Promise.all([
      usersQ,
      sip().from('raiox_questions').select('id, categoria, tipo, peso').eq('active', true),
    ]);

    // Mapa de questões pra cálculo por categoria
    type Q = { id: string; categoria: string; tipo: string; peso: number };
    const qById = new Map<string, Q>();
    for (const q of questions || []) {
      qById.set(q.id, { id: q.id, categoria: q.categoria, tipo: q.tipo, peso: Number(q.peso ?? 1) });
    }

    const scorePts = (q: Q, raw: unknown): { pts: number; maxPts: number } | null => {
      const peso = q.peso;
      if (q.tipo === 'escala_1_5') {
        if (raw == null) return null;
        const n = Math.max(1, Math.min(5, Number(raw) || 0));
        return { pts: n * peso, maxPts: 5 * peso };
      }
      if (q.tipo === 'sim_nao') {
        if (raw == null) return null;
        const v = raw === true || raw === 'sim' || raw === 'yes' || raw === 1;
        return { pts: (v ? 5 : 1) * peso, maxPts: 5 * peso };
      }
      if (q.tipo === 'sim_nao_andamento') {
        if (raw == null) return null;
        const v = String(raw).toLowerCase();
        if (!['sim', 'nao', 'andamento'].includes(v)) return null;
        const pts = v === 'sim' ? 5 : v === 'andamento' ? 2.5 : 0;
        return { pts: pts * peso, maxPts: 5 * peso };
      }
      if (q.tipo === 'numero') {
        const n = Math.max(0, Math.min(999, Number(raw) || 0));
        return { pts: Math.min(n, 5) * peso, maxPts: 5 * peso };
      }
      if (q.tipo === 'texto') {
        if (peso <= 0 || raw == null || raw === '') return null;
        const filled = String(raw).trim().length > 0 ? 5 : 0;
        return { pts: filled * peso, maxPts: 5 * peso };
      }
      return null;
    };

    const rankRows: RaioxRankingItem[] = ((students || []) as Array<Record<string, unknown>>)
      .map((s) => {
        const score = Number(s.raiox_score ?? 0);
        const max = Number(s.raiox_max_score ?? 0);
        const percent = max > 0 ? (score / max) * 100 : 0;
        const classificacao = raioxClassify(percent);

        // % por categoria (top 2 piores)
        const answers = (s.raiox_answers ?? {}) as Record<string, unknown>;
        const byCat: Record<string, { pts: number; max: number }> = {};
        for (const [qid, raw] of Object.entries(answers)) {
          const q = qById.get(qid);
          if (!q) continue;
          const r = scorePts(q, raw);
          if (!r) continue;
          const cat = byCat[q.categoria] ?? { pts: 0, max: 0 };
          cat.pts += r.pts;
          cat.max += r.maxPts;
          byCat[q.categoria] = cat;
        }
        const categorias = Object.entries(byCat)
          .filter(([, v]) => v.max > 0)
          .map(([categoria, v]) => ({ categoria, percent: Math.round((v.pts / v.max) * 1000) / 10 }))
          .sort((a, b) => a.percent - b.percent);
        const categorias_fracas = categorias.slice(0, 2);

        const item: RaioxRankingItem = {
          user_id: s.id as string,
          name: s.name as string,
          email: s.email as string,
          phone: (s.phone as string | null) ?? null,
          ciclo_type: s.ciclo_type as 'aurum' | 'seminario' | null,
          is_platina: s.is_platina === true,
          score,
          max_score: max,
          percent: Math.round(percent * 10) / 10,
          classificacao,
          submitted_at: (s.raiox_submitted_at as string | null) ?? null,
          tem_monitor: !!s.monitor_id,
          categorias_fracas,
        };
        return item;
      })
      .sort((a, b) => a.percent - b.percent);
    return res.json({ items: rankRows, total: rankRows.length });
  } catch (err) {
    next(err);
  }
});

// ── GET /admin/raiox-pending — aprovados/pendentes que ainda não preencheram o Raio-X
adminRaioxRouter.get('/admin/raiox-pending', async (req, res, next) => {
  try {
    const cicloFilter = typeof req.query.ciclo_type === 'string' ? req.query.ciclo_type : null;
    let usersQ = sip()
      .from('users')
      .select('id, name, email, phone, ciclo_type, is_platina, approval_status, created_at, monitor_id')
      .eq('role', 'student')
      .is('raiox_submitted_at', null)
      .in('approval_status', ['pending', 'approved'])
      .order('created_at', { ascending: false })
      .limit(500);
    if (cicloFilter === 'aurum') {
      usersQ = usersQ.eq('ciclo_type', 'aurum');
    } else if (cicloFilter === 'seminario') {
      usersQ = usersQ.eq('ciclo_type', 'seminario').neq('is_platina', true);
    } else if (cicloFilter === 'platina') {
      usersQ = usersQ.eq('ciclo_type', 'seminario').eq('is_platina', true);
    }
    const { data: students } = await usersQ;
    return res.json({ items: students || [], total: (students || []).length });
  } catch (err) {
    next(err);
  }
});

// ── POST /admin/raiox-recompute — recalcula raiox_score/raiox_max_score em batch
// Por padrão só toca usuários afetados (raiox_max_score = 0/null mas com
// raiox_submitted_at preenchido). ?all=1 força recálculo de todos com submissão.
adminRaioxRouter.post('/admin/raiox-recompute', async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const all = req.query.all === '1';
    let q = sip()
      .from('users')
      .select('id, raiox_answers, raiox_score, raiox_max_score')
      .eq('role', 'student')
      .not('raiox_submitted_at', 'is', null);
    if (!all) {
      // Só os afetados pelo bug — max=0/null
      q = q.or('raiox_max_score.is.null,raiox_max_score.eq.0');
    }
    const { data: users } = await q;
    const { data: questions } = await sip().from('raiox_questions').select('id, tipo, peso').eq('active', true);

    const sanitizeForRaiox = (s: unknown, maxLen: number): string => {
      const out = sanitizeText(s, maxLen);
      return out ?? '';
    };

    let updated = 0;
    let skipped = 0;
    let errors = 0;
    for (const u of (users || []) as Array<Record<string, unknown>>) {
      const answers = u.raiox_answers as Record<string, unknown> | null;
      if (!answers || typeof answers !== 'object') {
        skipped++;
        continue;
      }
      const r = computeRaioxScore(answers, (questions || []) as Array<{ id: string; tipo: string; peso?: number | null }>, sanitizeForRaiox);
      const { error: upErr } = await sip()
        .from('users')
        .update({ raiox_score: r.total, raiox_max_score: r.max })
        .eq('id', u.id);
      if (upErr) {
        errors++;
        continue;
      }
      updated++;
    }
    await audit(userId, 'raiox.recompute', 'users', null, { all, updated, skipped, errors });
    return res.json({ updated, skipped, errors });
  } catch (err) {
    next(err);
  }
});

// ── GET /admin/students/:id/raiox — detalhe das respostas de um aluno
adminRaioxRouter.get('/admin/students/:id/raiox', async (req, res, next) => {
  try {
    const studentId = req.params.id;
    const { data: student } = await sip()
      .from('users')
      .select('id, name, email, ciclo_type, phone, city, raiox_answers, raiox_score, raiox_max_score, raiox_submitted_at')
      .eq('id', studentId)
      .maybeSingle();
    if (!student) return res.status(404).json({ error: 'Aluno não encontrado' });

    const { data: questions } = await sip()
      .from('raiox_questions')
      .select('id, ordem, categoria, pergunta, tipo, peso')
      .eq('active', true)
      .order('ordem', { ascending: true });

    const answersObj = (student.raiox_answers ?? {}) as Record<string, unknown>;
    const respostas = ((questions || []) as Array<Record<string, unknown>>).map((q) => {
      const raw = answersObj[q.id as string];
      let pontos = 0;
      const peso = Number(q.peso ?? 1);
      if (raw != null) {
        if (q.tipo === 'escala_1_5') {
          pontos = Number(raw) * peso;
        } else if (q.tipo === 'sim_nao') {
          pontos = (raw === 'sim' ? 5 : 1) * peso;
        } else if (q.tipo === 'sim_nao_andamento') {
          const v = String(raw).toLowerCase();
          pontos = (v === 'sim' ? 5 : v === 'andamento' ? 2.5 : 0) * peso;
        } else if (q.tipo === 'numero') {
          pontos = Math.min(Number(raw) || 0, 5) * peso;
        } else if (q.tipo === 'texto' && peso > 0) {
          pontos = String(raw).trim() ? 5 * peso : 0;
        }
      }
      return {
        question_id: q.id,
        ordem: q.ordem,
        categoria: q.categoria,
        pergunta: q.pergunta,
        tipo: q.tipo,
        peso,
        resposta: raw ?? null,
        pontos,
      };
    });

    return res.json({
      student: {
        id: student.id,
        name: student.name,
        email: student.email,
        phone: student.phone,
        city: student.city,
        ciclo_type: student.ciclo_type,
      },
      score: Number(student.raiox_score ?? 0),
      max_score: Number(student.raiox_max_score ?? 0),
      submitted_at: student.raiox_submitted_at,
      respostas,
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /admin/raiox-questions — listar perguntas (incl. inativas) p/ gestão
adminRaioxRouter.get('/admin/raiox-questions', async (_req, res, next) => {
  try {
    const { data } = await sip().from('raiox_questions').select('*').order('ordem', { ascending: true });
    return res.json(data || []);
  } catch (err) {
    next(err);
  }
});

// ── POST /admin/raiox-questions — criar pergunta
adminRaioxRouter.post('/admin/raiox-questions', async (req, res, next) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const { ordem, categoria, pergunta, tipo, opcoes, peso, active } = body;
    const perguntaTxt = typeof pergunta === 'string' ? pergunta.replace(/\s+/g, ' ').trim() : '';
    const categoriaTxt = typeof categoria === 'string' ? categoria.replace(/\s+/g, ' ').trim() : '';
    if (!perguntaTxt || !categoriaTxt) return res.status(400).json({ error: 'Pergunta e categoria são obrigatórias.' });
    if (perguntaTxt.length > 500) return res.status(400).json({ error: 'Pergunta excede 500 caracteres.' });
    if (categoriaTxt.length > 100) return res.status(400).json({ error: 'Categoria excede 100 caracteres.' });
    const tipoValido = ['escala_1_5', 'sim_nao', 'sim_nao_andamento', 'numero', 'texto'];
    const tipoFinal = tipo && tipoValido.includes(String(tipo)) ? String(tipo) : 'escala_1_5';
    const { data, error } = await sip()
      .from('raiox_questions')
      .insert({
        ordem: Number(ordem ?? 0),
        categoria: categoriaTxt,
        pergunta: perguntaTxt,
        tipo: tipoFinal,
        opcoes: opcoes ?? null,
        peso: Number(peso ?? 1),
        active: active !== false,
      })
      .select()
      .single();
    if (error) return res.status(500).json({ error: 'Erro ao criar pergunta.' });
    return res.status(201).json(data);
  } catch (err) {
    next(err);
  }
});

// ── PATCH|PUT /admin/raiox-questions/:id — atualizar pergunta
// Legado usa PATCH; aceitamos PUT também (paridade com o contrato da nova stack).
const updateQuestion = async (
  req: import('express').Request,
  res: import('express').Response,
  next: import('express').NextFunction,
): Promise<void> => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const key of ['ordem', 'categoria', 'pergunta', 'tipo', 'opcoes', 'peso', 'active']) {
      if (key in body) updates[key] = body[key];
    }
    const { data, error } = await sip()
      .from('raiox_questions')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) {
      res.status(500).json({ error: 'Erro ao atualizar pergunta.' });
      return;
    }
    res.json(data);
  } catch (err) {
    next(err);
  }
};
adminRaioxRouter.patch('/admin/raiox-questions/:id', updateQuestion);
adminRaioxRouter.put('/admin/raiox-questions/:id', updateQuestion);

// ── DELETE /admin/raiox-questions/:id — desativar (soft delete)
adminRaioxRouter.delete('/admin/raiox-questions/:id', async (req, res, next) => {
  try {
    await sip().from('raiox_questions').update({ active: false }).eq('id', req.params.id);
    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
});
