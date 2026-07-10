// Schemas Zod centralizados — validação robusta de register/login/recovery.
//
// Mensagens em PT-BR específicas por caso — em vez de "required" genérico.
// Usado tanto no submit quanto em onblur pra feedback imediato.

import { z } from 'zod';
import { validateCPF } from '../utils/cpf';
import { t } from '../i18n';

// ─── Campos reutilizáveis ──────────────────────────────────────────────

const nameSchema = z
  .string({ error: t('auth.schemas.nameRequired') })
  .trim()
  .min(3, { error: t('auth.schemas.nameMinLength') })
  .max(80, { error: t('auth.schemas.nameMaxLength') })
  .refine(v => /^[a-zA-ZÀ-ÿ\s'.-]+$/.test(v), {
    error: t('auth.schemas.nameLettersOnly'),
  })
  .refine(v => v.trim().split(/\s+/).length >= 2, {
    error: t('auth.schemas.nameNeedsSurname'),
  });

const cpfSchema = z
  .string({ error: t('auth.schemas.cpfRequired') })
  .trim()
  .refine(v => v.replace(/\D/g, '').length === 11, {
    error: t('auth.schemas.cpfLength'),
  })
  .refine(v => validateCPF(v.replace(/\D/g, '')), {
    error: t('auth.schemas.cpfInvalid'),
  });

// Telefone OPCIONAL (Apple 5.1.1 — sequenciador de bateria não precisa
// exigir dados pessoais não essenciais). Se preenchido, valida formato.
const phoneSchema = z
  .string()
  .trim()
  .optional()
  .refine(v => {
    if (!v) return true; // vazio = ok (opcional)
    const digits = v.replace(/\D/g, '');
    return digits.length === 10 || digits.length === 11;
  }, {
    error: t('auth.schemas.phoneLength'),
  })
  .refine(v => {
    if (!v) return true;
    const digits = v.replace(/\D/g, '');
    if (digits.length === 11) return digits[2] === '9';
    return true;
  }, {
    error: t('auth.schemas.phoneMobileNine'),
  })
  .refine(v => {
    if (!v) return true;
    const digits = v.replace(/\D/g, '');
    const ddd = parseInt(digits.slice(0, 2));
    return ddd >= 11 && ddd <= 99;
  }, {
    error: t('auth.schemas.phoneDddInvalid'),
  });

const emailSchema = z
  .string({ error: t('auth.schemas.emailRequired') })
  .trim()
  .toLowerCase()
  .min(5, { error: t('auth.schemas.emailTooShort') })
  .max(120, { error: t('auth.schemas.emailTooLong') })
  .refine(v => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v), {
    error: t('auth.schemas.emailInvalid'),
  })
  .refine(v => !v.endsWith('.con'), { error: t('auth.schemas.emailTypoCon') })
  .refine(v => !v.includes('..'), { error: t('auth.schemas.emailDoubleDots') });

const passwordSchema = z
  .string({ error: t('auth.schemas.passwordRequired') })
  .min(6, { error: t('auth.schemas.passwordMinLength') })
  .max(72, { error: t('auth.schemas.passwordTooLong') })
  .refine(v => !/^\s+|\s+$/.test(v), {
    error: t('auth.schemas.passwordNoEdgeSpaces'),
  });

// ─── Schemas compostos ────────────────────────────────────────────────

export const registerSchema = z
  .object({
    name: nameSchema,
    cpf: cpfSchema,
    phone: phoneSchema,
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string({ error: t('auth.schemas.confirmPasswordRequired') }),
    acceptTerms: z.boolean().refine(v => v === true, {
      error: t('auth.schemas.acceptTermsRequired'),
    }),
  })
  .refine(d => d.password === d.confirmPassword, {
    error: t('auth.errors.passwordsDontMatch'),
    path: ['confirmPassword'],
  });

export type RegisterInput = z.infer<typeof registerSchema>;

// Cadastro INTERNACIONAL (país != Brasil): SEM CPF. O anti-abuso do CPF
// (documento BR único) é substituído no servidor por rate limit +
// confirmação de e-mail. Telefone segue opcional. Todo o RESTO é
// idêntico ao registerSchema — o BR não é afetado por este schema.
export const registerSchemaIntl = z
  .object({
    name: nameSchema,
    phone: phoneSchema,
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string({ error: t('auth.schemas.confirmPasswordRequired') }),
    acceptTerms: z.boolean().refine(v => v === true, {
      error: t('auth.schemas.acceptTermsRequired'),
    }),
  })
  .refine(d => d.password === d.confirmPassword, {
    error: t('auth.errors.passwordsDontMatch'),
    path: ['confirmPassword'],
  });

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string({ error: t('auth.schemas.loginPasswordRequired') }).min(1, { error: t('auth.schemas.loginPasswordRequired') }),
});

export const recoveryPasswordSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string({ error: t('auth.schemas.confirmNewPasswordRequired') }),
  })
  .refine(d => d.password === d.confirmPassword, {
    error: t('auth.errors.passwordsDontMatch'),
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
