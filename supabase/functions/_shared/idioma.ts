// Idioma do cliente no lado do servidor (push e e-mail).
//
// O app escolhe idioma pelo aparelho, mas quem manda push e e-mail é o
// servidor, que só tem o país do perfil (gdrums_profiles.country). Regra:
//   BR e PT      → português (textos EXATAMENTE os de hoje)
//   países hispânicos → espanhol
//   resto e desconhecido que não seja nulo → inglês
//   nulo/vazio   → português (conta antiga: o app só existia no Brasil)
//
// Nunca lança e nunca inventa idioma: o que não estiver mapeado cai no
// inglês, que é o padrão internacional do app.

export type Idioma = "pt" | "es" | "en";

const PORTUGUES = new Set(["BR", "PT", "AO", "MZ", "CV", "GW", "ST", "TL"]);

const ESPANHOL = new Set([
  "ES", "MX", "AR", "CL", "CO", "PE", "UY", "PY", "BO", "EC", "VE",
  "CR", "GT", "HN", "NI", "PA", "DO", "SV", "CU", "PR", "GQ",
]);

export function idiomaDoPais(country?: string | null): Idioma {
  const c = String(country || "").trim().toUpperCase();
  if (!c) return "pt";            // conta antiga, de quando só existia Brasil
  if (PORTUGUES.has(c)) return "pt";
  if (ESPANHOL.has(c)) return "es";
  return "en";
}

/** Pega o texto do idioma do cliente, caindo pro português se faltar. */
export function textoNoIdioma<T extends Record<Idioma, string>>(
  catalogo: T,
  country?: string | null,
): string {
  const idioma = idiomaDoPais(country);
  return catalogo[idioma] || catalogo.pt;
}

/** Substitui {chave} pelos valores, igual ao t() do app. */
export function preencher(texto: string, valores: Record<string, string | number> = {}): string {
  let s = texto;
  for (const [k, v] of Object.entries(valores)) s = s.split(`{${k}}`).join(String(v));
  return s;
}
