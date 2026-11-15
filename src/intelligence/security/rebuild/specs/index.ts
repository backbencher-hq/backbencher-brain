// M72 — spec aggregation. One aggregator per owner keeps write scopes disjoint;
// this file is Lead-owned. Every spec is DATA (LanguageSecuritySpec), never code.
import type { LanguageSecuritySpec } from "../spec-types"
import { groupASpecs } from "./group-a"
import { groupBSpecs } from "./group-b"
import { componentSpecs } from "./component-specs"
import { buildSpecs } from "./build-specs"

export const ALL_LANGUAGE_SPECS: LanguageSecuritySpec[] = [...groupASpecs, ...groupBSpecs, ...componentSpecs, ...buildSpecs]

const byLanguage = new Map<string, LanguageSecuritySpec>()
const byAlias = new Map<string, LanguageSecuritySpec>()
for (const spec of ALL_LANGUAGE_SPECS) {
  byLanguage.set(spec.language.toLowerCase(), spec)
  for (const alias of spec.aliases ?? []) byAlias.set(alias.toLowerCase(), spec)
}

/** Resolve a language id (or alias) to its spec, or null when no spec exists. */
export function specForLanguage(language: string): LanguageSecuritySpec | null {
  const key = (language ?? "").trim().toLowerCase()
  return byLanguage.get(key) ?? byAlias.get(key) ?? null
}

/** Languages that currently have a spec; used by the matrix/answer to prove coverage. */
export function specLanguages(): string[] {
  return [...byLanguage.keys()].sort()
}
