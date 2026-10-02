// ============================================================================
// CROSS-FILE OVERRIDE-TARGET RESOLUTION (shared by Java + Kotlin analyzers)
// ============================================================================
//
// The analyzers are per-file by design: a file's analyzer sees only its own
// content, so when an @Override/`override` method's true declaring parent is
// declared in ANOTHER file, the analyzer cannot verify which hierarchy parent
// declares the method from the file alone. Blindly picking the first parent
// (superclass) is wrong whenever the method is declared by a later parent
// (an interface) instead.
//
// This module defines the *companion index*: a project-level map of
// `owner type name → declared method names`, built by the CALLER from the
// symbols of previously parsed files. The M12 differential harness builds it
// with a pre-pass over the fixture corpus, and `override-companion-pass.ts`
// builds it on demand for a re-parse (PERL-MR15). BOTH Java and Kotlin use the
// single shared resolver below, so the override-target semantics are identical
// across languages:
//
// WIRING HONESTY, corrected 2026-09-30 (vue master review, VSD26). This comment
// used to claim "the production indexer provides the same context from its global
// symbol space (wired via M12.44)". That was FALSE, and so was the correction
// that replaced it. Both are now history: as of 2026-10-31 the BATCH indexer
// builds the companion from the symbol space, via `override-companion-pass.ts`,
// for both lanes that consume it. What it took to get there is the part worth
// keeping — `parallel-indexer` was ALREADY calling the pass, with
// `language: "perl"` hardcoded, so perl's resolver had a companion and the
// claim that the batch indexer built none was wrong only about python. Python's
// `analyze()` had stopped at three parameters, so the engine's fourth
// (`AnalyzeContext`) never reached it, and the resolver read
// `(ctx as any)._overrideCompanion` — an underscore-prefixed key that nothing
// populates. The rule was written, wired to a channel, shipped, and had never
// run, which is the same failure this file's header is about, one level down.
//
//   "the first ancestor in declaration order that actually declares the
//    method; fall back to the first parent only when no ancestor declares it"
//
// Callers that do not provide a companion index (per-file-only contexts)
// keep the deterministic first-parent behavior — the honest per-file default.
// ============================================================================

/** Owner type name → set of declared method names. */
export type OverrideCompanion = Map<string, Set<string>>

/** Owner type name → declared type kind (class/interface/struct/record). */
export type TypeKindCompanion = Map<string, string>

/**
 * Merge declared type kinds from parsed symbols into a companion index.
 * Used by analyzers whose grammar cannot distinguish a base class from an
 * implemented interface in the base list (C# has no keyword, unlike Java's
 * extends/implements): the companion supplies the declared kind from the
 * cross-file symbol space, exactly like the override companion.
 */
export function mergeTypeKindsIntoCompanion(
  companion: TypeKindCompanion,
  symbols: readonly any[],
): void {
  for (const s of symbols) {
    if (!s || !s.name) continue
    const kind = String(s.kind ?? "")
    if (kind === "class" || kind === "interface" || kind === "struct" || kind === "record" || kind === "enum") {
      if (!companion.has(s.name)) companion.set(s.name, kind)
    }
  }
}

/**
 * Merge declared methods from parsed symbols into a companion index.
 * `kind` must be the method symbol kind (the analyzers emit
 * ASTEngine.SymbolKind.Method, whose value is "method").
 */
export function mergeSymbolsIntoOverrideCompanion(
  companion: OverrideCompanion,
  symbols: readonly any[],
): void {
  for (const s of symbols) {
    if (!s || !s.ownerName || !s.name) continue
    if (String(s.kind ?? "") !== "method") continue
    let declared = companion.get(s.ownerName)
    if (!declared) {
      declared = new Set()
      companion.set(s.ownerName, declared)
    }
    declared.add(s.name)
  }
}

/** Build a fresh companion index from parsed symbols. */
export function buildOverrideCompanion(symbols: readonly any[]): OverrideCompanion {
  const companion: OverrideCompanion = new Map()
  mergeSymbolsIntoOverrideCompanion(companion, symbols)
  return companion
}

/** Per-type parent lookup — each analyzer supplies its own hierarchy. */
export type TypeHierarchyFn = (typeName: string) => readonly string[]

/**
 * The local `Owner.method` label for an override edge whose endpoints are FQNs.
 *
 * An override endpoint is built as `${ownerFqn}.${name}${signature}` — the
 * SIGNATURE (a parameter list) is part of the string, and the owner chain is
 * inside it too, so the input is NOT a plain dotted path. A naive
 * `split('.')` therefore splits the parameter list as if its dots were
 * qualifier boundaries. Measured on grails-core (R10 register, java): an
 * anonymous `LinkedHashMap` subclass and a wall of anonymous classes overriding
 * `handle(PersistentEntity, Query.Criterion, …)` each published a key that is
 * not a name at all —
 *
 *   `handle.Criterion,StringBuilder,StringBuilder,String,int,List,
 *    ConversionService,boolean,boolean)`          (qualified parameter type)
 *   `removeEldestEntry.Entry<String, Boolean>)`     (generic parameter type)
 *
 * where the honest keys are `…QueryBuilder$1.handle` and
 * `LinkedHashMap.removeEldestEntry`.
 *
 * Removing the parameter list FIRST is not sufficient either. `split("(")[0]`
 * is immune to the split above, but the owner chain can itself carry a call:
 * for `Child.getInner().anonymous_Inner.foo(String)` it yields `Child.getInner`
 * — still a name, but the WRONG one, and silently so. So the ordering matters
 * in both directions and neither single cut is right.
 *
 * The rule that is right on both, and is what all three lanes that localize an
 * edge key through an FQN now call: delete every BALANCED parenthesised group,
 * then split on dots and keep the last two segments. A group is *deleted*, not
 * replaced, so a qualifier boundary is never invented and a real one is never
 * lost — `a().b` → `a.b`, `X.foo(String)` → `X.foo`, `X.foo(Map.Entry)` →
 * `X.foo`, and `Child.getInner().anonymous_Inner.foo(String)` →
 * `anonymous_Inner.foo`.
 */
export function localEdgeLabel(fqn: string): string {
  let cleaned = ""
  let depth = 0
  for (let i = 0; i < fqn.length; i++) {
    const c = fqn.charCodeAt(i)
    if (c === 40) depth++ // '('
    else if (c === 41) {
      if (depth > 0) depth-- // ')'
    } else if (depth === 0) cleaned += fqn[i]
  }
  // Empty segments are dropped, not carried: a malformed fqn (`Foo.`, `a..b`,
  // a partial tree) must not be able to emit a label with an empty half, and on
  // well-formed input the filter is a no-op. The R10 spelling census is the
  // standing guard that no lane's labels are ever non-name-shaped again.
  const segs = cleaned.split(".").filter((s) => s.length > 0)
  if (segs.length === 0) return ""
  const last = segs[segs.length - 1]
  if (segs.length < 2) return last
  return `${segs[segs.length - 2]}.${last}`
}

/**
 * Find the first ancestor (breadth-first, declaration order) that actually
 * declares `methodName`. Returns null when no ancestor declares it.
 */
export function findDeclaringParent(
  methodName: string,
  startParents: readonly string[],
  companion: OverrideCompanion,
  getParents: TypeHierarchyFn,
): string | null {
  const queue: string[] = [...startParents]
  const seen = new Set<string>()
  while (queue.length > 0) {
    const parent = queue.shift()!
    if (seen.has(parent)) continue
    seen.add(parent)
    const declared = companion.get(parent)
    if (declared && declared.has(methodName)) return parent
    for (const next of getParents(parent)) {
      if (!seen.has(next)) queue.push(next)
    }
  }
  return null
}
