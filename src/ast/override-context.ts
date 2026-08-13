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
// with a pre-pass over the fixture corpus; the production indexer provides
// the same context from its global symbol space (wired via M12.44). Both the
// Java and Kotlin analyzers use the single shared resolver below, so the
// override-target semantics are identical across languages:
//
//   "the first ancestor in declaration order that actually declares the
//    method; fall back to the first parent only when no ancestor declares it"
//
// Callers that do not provide a companion index (per-file-only contexts)
// keep the deterministic first-parent behavior — the honest per-file default.
// ============================================================================

/** Owner type name → set of declared method names. */
export type OverrideCompanion = Map<string, Set<string>>

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
