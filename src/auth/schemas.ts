// Schemas Zod centralizados — validação robusta de register/login/recovery.
//
// Mensagens em PT-BR específicas por caso — em vez de "required" genérico.
// Usado tanto no submit quanto em onblur pra feedback imediato.

import { z } from 'zod';
import { validateCPF } from '../utils/cpf';

// ─── Campos reutilizáveis ──────────────────────────────────────────────

const nameSchema = z
  .string({ error: 'Informe seu nome' })
  .trim()
  .min(3, { error: 'Nome precisa ter ao menos 3 letras' })
  .max(80, { error: 'Nome longo demais (máx 80 caracteres)' })
  .refine(v => /^[a-zA-ZÀ-ÿ\s'.-]+$/.test(v), {
    error: 'Use só letras, espaços e acentos',
  })
  .refine(v => v.trim().split(/\s+/).length >= 2, {
    error: 'Informe nome e sobrenome',
  });

const cpfSchema = z
  .string({ error: 'Informe seu CPF' })
  .trim()
  .refine(v => v.replace(/\D/g, '').length === 11, {
    error: 'CPF precisa ter 11 dígitos',
  })
  .refine(v => validateCPF(v.replace(/\D/g, '')), {
    error: 'CPF inválido — verifique os dígitos',
  });

const phoneSchema = z
  .string({ error: 'Informe seu WhatsApp' })
  .trim()
  .refine(v => {
    const digits = v.replace(/\D/g, '');
    return digits.length === 10 || digits.length === 11;
  }, {
    error: 'WhatsApp precisa ter 10 ou 11 dígitos',
  })
  .refine(v => {
    const digits = v.replace(/\D/g, '');
    // Se tem 11 dígitos, o 3º (após DDD) deve ser 9 (celular)
    if (digits.length === 11) return digits[2] === '9';
    return true;
  }, {
    error: 'Celular precisa começar com 9 após o DDD',
  })
  .refine(v => {
    const digits = v.replace(/\D/g, '');
    const ddd = parseInt(digits.slice(0, 2));
    // DDDs válidos no Brasil: 11-99 (excluindo alguns raros)
    return ddd >= 11 && ddd <= 99;
  }, {
    error: 'DDD inválido',
  });

const emailSchema = z
  .string({ error: 'Informe seu e-mail' })
  .trim()
  .toLowerCase()
  .min(5, { error: 'E-mail muito curto' })
  .max(120, { error: 'E-mail longo demais' })
  .refine(v => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v), {
    error: 'E-mail inválido — precisa ser tipo seu@email.com',
  })
  .refine(v => !v.endsWith('.con'), { error: 'Você quis dizer .com?' })
  .refine(v => !v.includes('..'), { error: 'E-mail tem pontos duplicados' });

const passwordSchema = z
  .string({ error: 'Informe uma senha' })
  .min(6, { error: 'Senha precisa ter no mínimo 6 caracteres' })
  .max(72, { error: 'Senha longa demais (máx 72)' })
  .refine(v => !/^\s+|\s+$/.test(v), {
    error: 'Senha não pode começar ou terminar com espaço',
  });

// ─── Schemas compostos ────────────────────────────────────────────────

export const registerSchema = z
  .object({
    name: nameSchema,
    cpf: cpfSchema,
    phone: phoneSchema,
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string({ error: 'Confirme sua senha' }),
    acceptTerms: z.boolean().refine(v => v === true, {
      error: 'Você precisa aceitar os termos para continuar',
    }),
  })
  .refine(d => d.password === d.confirmPassword, {
    error: 'As senhas não conferem',
    path: ['confirmPassword'],
  });

export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string({ error: 'Informe sua senha' }).min(1, { error: 'Informe sua senha' }),
});

export const recoveryPasswordSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string({ error: 'Confirme a nova senha' }),
  })
  .refine(d => d.password === d.confirmPassword, {
    error: 'As senhas não conferem',
    path: ['confirmPassword'],
  });

// ─── Helper: extrai erro por campo pro formato { [fieldName]: "msg" } ──

export function zodErrorsToFieldMap(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  // z.ZodError.issues é sempre array; Zod v4
  for (const issue of err.issues) {
    const key = issue.path.join('.');
    if (key && !out[key]) out[key] = issue.message;
  }
  return out;
}
