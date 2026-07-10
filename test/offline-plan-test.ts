// Teste da VERIFICAÇÃO DE PLANO offline (OfflineCache real).
// "o offline tem que ter verificação de plano, pros caras não ficar usando
//  eterno" — prova que:
//  - assinatura ATIVA + não expirada + cache fresco → acesso liberado
//  - assinatura EXPIRADA (expires_at no passado) → BLOQUEIA offline
//  - cache com mais de 7 dias → BLOQUEIA (não dá pra usar eterno offline)
//  - status canceled/expired → BLOQUEIA
//  - cache adulterado (assinatura quebrada) → BLOQUEIA
//
// Roda: npx tsx test/offline-plan-test.ts

import './_browser-polyfill';
import { OfflineCache, type CachedProfile } from '../src/native/OfflineCache';

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.log(`  ❌ FALHOU: ${msg}`); }
}

const DAY = 24 * 60 * 60 * 1000;
function baseProfile(over: Partial<CachedProfile> = {}): CachedProfile {
  return {
    userId: 'u1', name: 'Zé', email: 'ze@x.com', role: 'user',
    subscriptionStatus: 'active', subscriptionPlan: 'mensal',
    subscriptionExpiresAt: new Date(Date.now() + 30 * DAY).toISOString(),
    cachedAt: Date.now(),
    ...over,
  };
}

function main(): void {
  console.log('═══ Verificação de plano offline (OfflineCache real) ═══\n');

  // 1) Assinatura ativa, válida, cache fresco → LIBERA
  OfflineCache.clear();
  OfflineCache.saveProfile(baseProfile());
  assert(OfflineCache.hasValidOfflineAccess() === true, 'ativo + válido + cache fresco → LIBERA acesso offline');

  // 2) Assinatura EXPIRADA (expires_at no passado) → BLOQUEIA
  OfflineCache.clear();
  OfflineCache.saveProfile(baseProfile({ subscriptionExpiresAt: new Date(Date.now() - 1 * DAY).toISOString() }));
  assert(OfflineCache.hasValidOfflineAccess() === false, 'assinatura expirada → BLOQUEIA (não usa de graça)');

  // 3) Cache velho (> 7 dias sem reconectar) → BLOQUEIA (não usa eterno)
  OfflineCache.clear();
  OfflineCache.saveProfile(baseProfile({ cachedAt: Date.now() - 8 * DAY }));
  assert(OfflineCache.hasValidOfflineAccess() === false, 'cache > 7 dias → BLOQUEIA (não dá pra usar eterno offline)');

  // 3b) Cache de 6 dias, assinatura válida → ainda LIBERA (janela ok)
  OfflineCache.clear();
  OfflineCache.saveProfile(baseProfile({ cachedAt: Date.now() - 6 * DAY }));
  assert(OfflineCache.hasValidOfflineAccess() === true, 'cache de 6 dias + assinatura válida → ainda LIBERA');

  // 4) status canceled → BLOQUEIA (mesmo com expires_at no futuro)
  OfflineCache.clear();
  OfflineCache.saveProfile(baseProfile({ subscriptionStatus: 'canceled' }));
  assert(OfflineCache.hasValidOfflineAccess() === false, 'status canceled → BLOQUEIA');

  // 4b) status expired → BLOQUEIA
  OfflineCache.clear();
  OfflineCache.saveProfile(baseProfile({ subscriptionStatus: 'expired' }));
  assert(OfflineCache.hasValidOfflineAccess() === false, 'status expired → BLOQUEIA');

  // 4c) trial válido → LIBERA
  OfflineCache.clear();
  OfflineCache.saveProfile(baseProfile({ subscriptionStatus: 'trial', subscriptionExpiresAt: new Date(Date.now() + 1 * DAY).toISOString() }));
  assert(OfflineCache.hasValidOfflineAccess() === true, 'trial dentro do prazo → LIBERA');

  // 5) Sem expires_at → BLOQUEIA (não assume acesso infinito)
  OfflineCache.clear();
  OfflineCache.saveProfile(baseProfile({ subscriptionExpiresAt: null }));
  assert(OfflineCache.hasValidOfflineAccess() === false, 'sem expires_at → BLOQUEIA');

  // 6) Cache adulterado (mexeram no localStorage) → BLOQUEIA + limpa
  OfflineCache.clear();
  OfflineCache.saveProfile(baseProfile());
  // Simula tampering: troca o status pra 'active' com expiry falso mantendo a assinatura antiga
  const tampered = JSON.parse(localStorage.getItem('gdrums-offline-profile')!);
  tampered.subscriptionExpiresAt = new Date(Date.now() + 999 * DAY).toISOString();
  localStorage.setItem('gdrums-offline-profile', JSON.stringify(tampered));
  assert(OfflineCache.getProfile() === null, 'cache adulterado → assinatura não bate, invalida');
  assert(OfflineCache.hasValidOfflineAccess() === false, 'cache adulterado → BLOQUEIA acesso');

  // 7) clear() → sem acesso
  OfflineCache.clear();
  assert(OfflineCache.hasValidOfflineAccess() === false, 'cache limpo (logout) → sem acesso offline');

  console.log('\n══════════════════════════════════════════════════');
  console.log(`RESULTADO: ${passed} passou, ${failed} falhou, ${passed + failed} total`);
  console.log('══════════════════════════════════════════════════');
  if (failed > 0) { console.log('\n❌ Verificação de plano offline com furo.'); process.exit(1); }
  console.log('\n🎯 Plano é verificado offline: expirado/cancelado/velho é bloqueado, ninguém usa eterno.');
  process.exit(0);
}

main();
