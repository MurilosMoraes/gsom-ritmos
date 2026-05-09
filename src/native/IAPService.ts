// IAPService — In-App Purchase (Apple StoreKit 2) só pro iOS nativo.
//
// Fluxo:
// 1. plans.ts detecta isIOSNative() e chama IAPService em vez do checkout
//    InfinitePay.
// 2. Compra: NativePurchases.purchaseProduct → recebe jwsRepresentation
//    (StoreKit 2) ou receipt base64 (StoreKit 1 fallback).
// 3. Envia o token pra edge fn `apple-iap-verify` no Supabase, que valida
//    com o App Store Server API e atualiza gdrums_profiles + insere
//    transação em gdrums_transactions.
// 4. Restore: NativePurchases.restorePurchases() + getPurchases() pra
//    recuperar assinatura existente (Apple exige botão "Restore").
//
// IMPORTANTE: este serviço NUNCA deve ser chamado fora do iOS nativo.
// Web e Android continuam usando InfinitePay (PaymentService).

import { NativePurchases, PURCHASE_TYPE } from '@capgo/native-purchases';
import { supabase } from '../auth/supabase';
import { isIOSNative } from './Platform';

const SUPABASE_URL = 'https://qsfziivubwdgtmwyztfw.supabase.co';
const ANON_KEY = 'sb_publishable_qjW2fGXMHtQvqVKgyyiiUg_HczRwmXy';

// ─── Mapeamento planId → productId Apple ───────────────────────────────
//
// Os productIds DEVEM ser idênticos aos cadastrados no App Store Connect.
// Convenção: com.gdrums.app.<plano>
//
// TODO: confirmar IDs reais quando o usuário criar os produtos no ASC.
// Se mudar a convenção, basta atualizar aqui.

export const APPLE_PRODUCT_IDS: Record<string, string> = {
  mensal: 'com.gdrums.app.mensal',
  trimestral: 'com.gdrums.app.trimestral',
  semestral: 'com.gdrums.app.semestral',
  anual: 'com.gdrums.app.anual',
  'rei-dos-palcos': 'com.gdrums.app.reidospalcos',
};

export function getAppleProductId(planId: string): string | null {
  return APPLE_PRODUCT_IDS[planId] || null;
}

export function getPlanIdFromAppleProduct(productId: string): string | null {
  for (const [planId, prodId] of Object.entries(APPLE_PRODUCT_IDS)) {
    if (prodId === productId) return planId;
  }
  return null;
}

// ─── Tipos auxiliares ──────────────────────────────────────────────────

export interface IAPProductInfo {
  productId: string;
  planId: string;
  priceString: string;
  title: string;
  description: string;
}

export interface IAPPurchaseResult {
  success: boolean;
  planId?: string;
  error?: string;
  /** True se o user cancelou o sheet (não é erro). */
  canceled?: boolean;
  /** True se a verificação no servidor falhou — precisa retry. */
  verificationFailed?: boolean;
}

// ─── API pública ───────────────────────────────────────────────────────

/**
 * Carrega os 5 produtos do App Store. Necessário antes de qualquer compra.
 * Idempotente: pode chamar várias vezes sem efeito colateral.
 */
export async function loadProducts(): Promise<IAPProductInfo[]> {
  if (!isIOSNative()) return [];

  const productIds = Object.values(APPLE_PRODUCT_IDS);
  try {
    const result = await NativePurchases.getProducts({
      productIdentifiers: productIds,
      productType: PURCHASE_TYPE.SUBS,
    });

    const products = (result as { products?: any[] }).products || [];
    return products.map(p => ({
      productId: p.identifier || p.productIdentifier || p.id,
      planId: getPlanIdFromAppleProduct(p.identifier || p.productIdentifier || p.id) || '',
      priceString: p.priceString || p.price || '',
      title: p.title || '',
      description: p.description || '',
    })).filter(p => p.planId);
  } catch (e) {
    console.warn('[IAP] loadProducts falhou:', e);
    return [];
  }
}

/**
 * Inicia compra de assinatura. Mostra o sheet nativo da Apple.
 * Após sucesso, envia o JWS/receipt pro backend pra ativar a assinatura
 * no Supabase. Retorna planId em caso de sucesso.
 */
export async function purchasePlan(planId: string): Promise<IAPPurchaseResult> {
  if (!isIOSNative()) {
    return { success: false, error: 'IAP só disponível no app iOS' };
  }

  const productId = getAppleProductId(planId);
  if (!productId) {
    return { success: false, error: `Plano desconhecido: ${planId}` };
  }

  // appAccountToken vincula a compra ao user do Supabase. Apple recomenda
  // (StoreKit 2) — chega no webhook V2 e ajuda a evitar fraude.
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { success: false, error: 'Faça login antes de comprar' };
  }

  try {
    const purchaseResult = await NativePurchases.purchaseProduct({
      productIdentifier: productId,
      productType: PURCHASE_TYPE.SUBS,
      quantity: 1,
      // appAccountToken precisa ser UUID válido. Apple aceita qualquer UUID;
      // usamos o user.id direto pra correlacionar no webhook.
      appAccountToken: user.id,
    } as any);

    // O retorno varia entre StoreKit 1 (receipt base64) e StoreKit 2
    // (jwsRepresentation). Pegamos o que existir.
    const tx = (purchaseResult as any).transaction || purchaseResult;
    const jws = tx.jwsRepresentation || tx.jws || null;
    const receipt = tx.receipt || null;
    const transactionId = tx.transactionId || tx.id || null;

    if (!jws && !receipt) {
      return {
        success: false,
        error: 'Compra retornou sem token. Tente Restaurar Compras.',
      };
    }

    // Validação no backend (segurança real — não confiar no cliente).
    const verified = await verifyOnBackend({
      planId,
      productId,
      jws,
      receipt,
      transactionId,
      userId: user.id,
    });

    if (!verified.success) {
      return {
        success: false,
        verificationFailed: true,
        error: verified.error || 'Falha na verificação. Tente Restaurar Compras.',
      };
    }

    return { success: true, planId };
  } catch (e: any) {
    const msg = String(e?.message || e);
    // Códigos comuns de cancelamento StoreKit
    if (
      msg.includes('cancel') ||
      msg.includes('SKErrorPaymentCancelled') ||
      msg.includes('userCancelled')
    ) {
      return { success: false, canceled: true };
    }
    return { success: false, error: msg };
  }
}

/**
 * Restaura compras anteriores. Apple exige botão "Restore Purchases".
 * Se houver assinatura ativa, faz a verificação no backend.
 */
export async function restorePurchases(): Promise<IAPPurchaseResult> {
  if (!isIOSNative()) {
    return { success: false, error: 'Restore só disponível no app iOS' };
  }

  try {
    await NativePurchases.restorePurchases();

    const result = await NativePurchases.getPurchases({
      productType: PURCHASE_TYPE.SUBS,
    } as any);

    const purchases = ((result as any).purchases || []) as any[];
    const active = purchases.find(p => {
      if (p.isActive === false) return false;
      if (p.expirationDate) {
        return new Date(p.expirationDate) > new Date();
      }
      return true;
    });

    if (!active) {
      return { success: false, error: 'Nenhuma assinatura ativa encontrada' };
    }

    const productId = active.productIdentifier || active.identifier;
    const planId = getPlanIdFromAppleProduct(productId);
    if (!planId) {
      return { success: false, error: 'Produto restaurado não reconhecido' };
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: 'Faça login antes de restaurar' };
    }

    const verified = await verifyOnBackend({
      planId,
      productId,
      jws: active.jwsRepresentation || active.jws || null,
      receipt: active.receipt || null,
      transactionId: active.transactionId || active.id || null,
      userId: user.id,
    });

    if (!verified.success) {
      return {
        success: false,
        verificationFailed: true,
        error: verified.error || 'Falha na verificação',
      };
    }

    return { success: true, planId };
  } catch (e: any) {
    return { success: false, error: String(e?.message || e) };
  }
}

/** Abre tela de gerenciamento de assinaturas (Apple). */
export async function openManageSubscriptions(): Promise<void> {
  if (!isIOSNative()) return;
  try {
    if ((NativePurchases as any).manageSubscriptions) {
      await (NativePurchases as any).manageSubscriptions();
    }
  } catch (e) {
    console.warn('[IAP] manageSubscriptions falhou:', e);
  }
}

// ─── Backend ───────────────────────────────────────────────────────────

interface VerifyArgs {
  planId: string;
  productId: string;
  jws: string | null;
  receipt: string | null;
  transactionId: string | null;
  userId: string;
}

interface VerifyResponse {
  success: boolean;
  error?: string;
}

async function verifyOnBackend(args: VerifyArgs): Promise<VerifyResponse> {
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/apple-iap-verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ANON_KEY}`,
        'apikey': ANON_KEY,
      },
      body: JSON.stringify(args),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return { success: false, error: `HTTP ${response.status}: ${text.slice(0, 200)}` };
    }

    const data = await response.json();
    if (!data.success) {
      return { success: false, error: data.error || 'Backend rejeitou' };
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}
