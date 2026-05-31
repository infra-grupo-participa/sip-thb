import { useMemo } from 'react';
import { maskCnpj, normalizeInstagram } from './helpers';

export interface RaioxQuestion {
  id: string | number;
  pergunta: string;
  categoria: string;
  tipo: 'sim_nao_andamento' | 'escala_1_5' | 'numero' | 'texto';
  peso?: number;
  ordem?: number;
  hint?: string;
  depends_on?: string | number | null;
  depends_value?: string | number | null;
  input_kind?: 'cnpj' | 'url' | null;
}

export type RaioxAnswers = Record<string, string | number>;

export function isDependent(q: RaioxQuestion): boolean {
  return q.depends_on != null && q.depends_on !== '';
}

export function dependencyMet(q: RaioxQuestion, answers: RaioxAnswers): boolean {
  if (!isDependent(q)) return true;
  return String(answers[String(q.depends_on)] ?? '') === String(q.depends_value);
}

export function isQuestionRequired(q: RaioxQuestion, answers: RaioxAnswers): boolean {
  if (isDependent(q)) return dependencyMet(q, answers);
  return q.tipo !== 'texto' || Number(q.peso) > 0;
}

// Valida e devolve a primeira mensagem de erro (ou null). Mutável: sanitiza answers.
export function validateRaiox(
  questions: RaioxQuestion[],
  answers: RaioxAnswers,
): { error: string | null; firstBadId: string | null } {
  for (const q of questions) {
    const qid = String(q.id);
    if (q.tipo === 'numero') {
      const raw = answers[qid];
      if (raw != null && raw !== '') {
        const num = Number(raw);
        if (!Number.isInteger(num) || num < 0 || num > 999 || isNaN(num)) {
          return { error: 'O campo numérico deve ser um inteiro entre 0 e 999.', firstBadId: qid };
        }
      }
    } else if (q.tipo === 'texto' && isDependent(q) && dependencyMet(q, answers)) {
      const raw = String(answers[qid] || '');
      if (q.input_kind === 'cnpj') {
        const digits = raw.replace(/\D/g, '');
        if (digits.length !== 14) return { error: 'Informe o CNPJ completo (14 dígitos).', firstBadId: qid };
      } else if (q.input_kind === 'url') {
        if (!/^https?:\/\//.test(raw.trim())) {
          return { error: 'Informe um link válido começando com http:// ou https://.', firstBadId: qid };
        }
      } else if (isQuestionRequired(q, answers) && !raw.trim()) {
        return { error: 'Preencha o campo destacado.', firstBadId: qid };
      }
    }
  }

  const required = questions.filter((q) => isQuestionRequired(q, answers));
  const missing = required.filter((q) => answers[String(q.id)] == null || answers[String(q.id)] === '');
  if (missing.length) {
    const first = missing[0];
    return {
      error: `Responda todas as ${required.length} perguntas obrigatórias. Faltam ${missing.length}.`,
      firstBadId: first ? String(first.id) : null,
    };
  }
  return { error: null, firstBadId: null };
}

interface RaioxFormProps {
  questions: RaioxQuestion[];
  answers: RaioxAnswers;
  errorId: string | null;
  onChange: (answers: RaioxAnswers) => void;
}

interface Group {
  categoria: string;
  perguntas: RaioxQuestion[];
}

export default function RaioxForm({ questions, answers, errorId, onChange }: RaioxFormProps) {
  // Agrupa por categoria preservando ordem; insere dependentes logo após o gatilho.
  const { groups, indexByQid } = useMemo(() => {
    const sorted = questions.slice().sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
    const grps: Group[] = [];
    const seen = new Map<string, number>();
    for (const q of sorted) {
      if (!seen.has(q.categoria)) {
        seen.set(q.categoria, grps.length);
        grps.push({ categoria: q.categoria, perguntas: [] });
      }
      grps[seen.get(q.categoria)!]!.perguntas.push(q);
    }
    const depsByTrigger = new Map<string, RaioxQuestion[]>();
    for (const q of questions) {
      if (isDependent(q)) {
        const key = String(q.depends_on);
        if (!depsByTrigger.has(key)) depsByTrigger.set(key, []);
        depsByTrigger.get(key)!.push(q);
      }
    }
    // Reordena cada grupo: gatilho seguido de seus dependentes, e numera.
    const idxMap = new Map<string, number>();
    let idx = 0;
    const orderedGroups: Group[] = grps.map((g) => {
      const ordered: RaioxQuestion[] = [];
      for (const q of g.perguntas) {
        if (isDependent(q)) continue;
        idx++;
        idxMap.set(String(q.id), idx);
        ordered.push(q);
        for (const dep of depsByTrigger.get(String(q.id)) || []) {
          idx++;
          idxMap.set(String(dep.id), idx);
          ordered.push(dep);
        }
      }
      return { categoria: g.categoria, perguntas: ordered };
    });
    return { groups: orderedGroups, indexByQid: idxMap };
  }, [questions]);

  function setAnswer(qid: string, val: string | number | null) {
    const next = { ...answers };
    if (val === null || val === '') delete next[qid];
    else next[qid] = val;
    onChange(next);
  }

  const required = questions.filter((q) => isQuestionRequired(q, answers));
  const done = required.filter((q) => {
    const v = answers[String(q.id)];
    return v != null && v !== '';
  }).length;

  function renderBody(q: RaioxQuestion) {
    const qid = String(q.id);
    const cur = answers[qid];
    if (q.tipo === 'sim_nao_andamento') {
      const opts = [
        { v: 'sim', label: 'Sim', color: '#15803d' },
        { v: 'andamento', label: 'Em andamento', color: '#d97706' },
        { v: 'nao', label: 'Não', color: '#b91c1c' },
      ];
      return (
        <div className="raiox-tri">
          {opts.map((o) => (
            <label key={o.v} className="raiox-tri-opt" style={{ ['--c' as string]: o.color }}>
              <input
                type="radio"
                name={`q-${qid}`}
                value={o.v}
                checked={cur === o.v}
                onChange={() => setAnswer(qid, o.v)}
              />
              <span>{o.label}</span>
            </label>
          ))}
        </div>
      );
    }
    if (q.tipo === 'escala_1_5') {
      return (
        <>
          <div className="raiox-scale">
            {[1, 2, 3, 4, 5].map((n) => (
              <label key={n}>
                <input
                  type="radio"
                  name={`q-${qid}`}
                  value={n}
                  checked={String(cur) === String(n)}
                  onChange={() => setAnswer(qid, n)}
                />
                {n}
              </label>
            ))}
          </div>
          <div className="raiox-scale-legend">
            <span>Nada / Nenhum</span>
            <span>Domínio total</span>
          </div>
        </>
      );
    }
    if (q.tipo === 'numero') {
      return (
        <div>
          <input
            type="number"
            min={0}
            max={999}
            step={1}
            className="hb-input"
            placeholder="0"
            inputMode="numeric"
            style={{ maxWidth: 160 }}
            value={cur == null ? '' : String(cur)}
            onChange={(e) => setAnswer(qid, e.target.value === '' ? null : Number(e.target.value))}
          />
          <p className="raiox-q-hint">Informe um número entre 0 e 999.</p>
        </div>
      );
    }
    // texto
    const isOptional = !isQuestionRequired(q, answers);
    const pLower = (q.pergunta || '').toLowerCase();
    let placeholder = Number(q.peso) > 0 ? 'Resposta…' : 'Opcional — link, @ ou descrição';
    if (Number(q.peso) === 0) {
      if (pLower.includes('instagram')) placeholder = '@seuhandle ou link completo';
      else if (pLower.includes('facebook')) placeholder = 'facebook.com/seuperfil ou link';
      else if (pLower.includes('youtube')) placeholder = 'link do canal (youtube.com/@seucanal)';
    }
    if (isDependent(q) && q.input_kind === 'cnpj') placeholder = '00.000.000/0000-00';
    else if (isDependent(q) && q.input_kind === 'url') placeholder = 'https://...';

    const isInstagram = isOptional && pLower.includes('instagram');
    const isCnpj = isDependent(q) && q.input_kind === 'cnpj';

    return (
      <div>
        <input
          type="text"
          maxLength={isCnpj ? 18 : 200}
          className="hb-input"
          inputMode={isCnpj ? 'numeric' : undefined}
          placeholder={placeholder}
          value={cur == null ? '' : String(cur)}
          onChange={(e) => {
            const v = isCnpj ? maskCnpj(e.target.value) : e.target.value;
            setAnswer(qid, v === '' ? null : v);
          }}
          onBlur={(e) => {
            if (isInstagram) {
              const normalized = normalizeInstagram(e.target.value);
              setAnswer(qid, normalized || null);
            }
          }}
        />
      </div>
    );
  }

  return (
    <>
      <div className="raiox-progress">
        {done} de {required.length} respondidas
      </div>
      <div>
        {groups.map((g) => {
          const allOptional = g.perguntas.every((q) => Number(q.peso) === 0);
          return (
            <div className="raiox-section" key={g.categoria}>
              <div className="raiox-section-header">
                <span className="raiox-section-name">{g.categoria}</span>
                {allOptional && <span className="raiox-section-hint">Opcional — preencha se já tiver.</span>}
              </div>
              {g.perguntas.map((q) => {
                const qid = String(q.id);
                if (isDependent(q) && !dependencyMet(q, answers)) return null;
                const isOptional = !isQuestionRequired(q, answers);
                const v = answers[qid];
                const hasAnswer = v != null && v !== '';
                let cls = 'raiox-q';
                if (hasAnswer) cls += isOptional ? ' raiox-q-answered-optional' : ' raiox-q-answered';
                if (errorId === qid) cls += ' raiox-q-error';
                return (
                  <div className={cls} key={qid} data-qid={qid}>
                    <div className="raiox-q-text">
                      <strong>{indexByQid.get(qid)}.</strong> {q.pergunta}{' '}
                      {isOptional ? (
                        <span className="raiox-q-opt">opcional</span>
                      ) : (
                        <span className="raiox-req">*</span>
                      )}
                    </div>
                    {renderBody(q)}
                    {q.hint && <p className="raiox-q-hint">{q.hint}</p>}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </>
  );
}
