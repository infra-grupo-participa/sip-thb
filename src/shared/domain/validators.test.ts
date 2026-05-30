// Oráculo de domínio (Fase 0 do plano de migração): entradas conhecidas →
// saídas fixas. Garante que as fórmulas portadas batem com o as-is.
import { describe, it, expect } from 'vitest';
import {
  passwordStrengthError,
  sanitizeText,
  TURMA_AURUM_RE,
  TURMA_THB_RE,
  PHONE_RE,
  EMAIL_RE,
  INSTAGRAM_RE,
} from './validators.js';

describe('passwordStrengthError', () => {
  it('aceita senha forte', () => {
    expect(passwordStrengthError('Senha@2026!')).toBeNull();
  });
  it('rejeita curta', () => {
    expect(passwordStrengthError('Ab1!')).toMatch(/10 caracteres/);
  });
  it('exige maiúscula', () => {
    expect(passwordStrengthError('senha@2026!')).toMatch(/maiúscula/);
  });
  it('exige minúscula', () => {
    expect(passwordStrengthError('SENHA@2026!')).toMatch(/minúscula/);
  });
  it('exige número', () => {
    expect(passwordStrengthError('SenhaForte@!')).toMatch(/número/);
  });
  it('exige caractere especial', () => {
    expect(passwordStrengthError('SenhaForte2026')).toMatch(/especial/);
  });
});

describe('sanitizeText', () => {
  it('colapsa espaços e apara', () => {
    expect(sanitizeText('  ola   mundo  ', 50)).toBe('ola mundo');
  });
  it('trunca no máximo', () => {
    expect(sanitizeText('abcdefghij', 4)).toBe('abcd');
  });
  it('retorna vazio para não-string', () => {
    expect(sanitizeText(123, 10)).toBe('');
  });
});

describe('regex de validação', () => {
  it('TURMA_AURUM aceita A1..A9 e rejeita A0/A10', () => {
    expect(TURMA_AURUM_RE.test('A1')).toBe(true);
    expect(TURMA_AURUM_RE.test('A9')).toBe(true);
    expect(TURMA_AURUM_RE.test('A0')).toBe(false);
    expect(TURMA_AURUM_RE.test('A10')).toBe(false);
  });
  it('TURMA_THB aceita T1..T38', () => {
    expect(TURMA_THB_RE.test('T1')).toBe(true);
    expect(TURMA_THB_RE.test('T38')).toBe(true);
    expect(TURMA_THB_RE.test('T39')).toBe(false);
  });
  it('PHONE no formato (xx) 9xxxx-xxxx', () => {
    expect(PHONE_RE.test('(11) 91234-5678')).toBe(true);
    expect(PHONE_RE.test('11912345678')).toBe(false);
  });
  it('EMAIL básico', () => {
    expect(EMAIL_RE.test('a@b.co')).toBe(true);
    expect(EMAIL_RE.test('invalido')).toBe(false);
  });
  it('INSTAGRAM com ou sem @', () => {
    expect(INSTAGRAM_RE.test('@grupoparticipa')).toBe(true);
    expect(INSTAGRAM_RE.test('grupo.participa')).toBe(true);
  });
});
