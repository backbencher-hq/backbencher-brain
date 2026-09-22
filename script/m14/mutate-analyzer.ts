/**
 * M14.0.F4 — Mutation-Testing Harness
 *
 * Proves the verification gates CAN fail. For each mutant (a deliberately
 * defective analyzer), the fixture suite MUST go red. A surviving mutant
 * fails THE SUITE, not the mutant — suites that stay green no matter what
 * are decoration, and decoration is what let M13 claim dishonest things.
 *
 * Mutants wrap the real analyzer and transform its output — a faithful
 * simulation of an analyzer carrying the defect, without fragile source
 * surgery. Every mutant is documented with its defect class.
 *
 * Gate: every mutant must increase its language's failure count above the
 * recorded baseline (validation/m14/fixture-baseline.json). Exit 0 iff all
 * mutants are caught. Also emits evidence via the F2 harness.
 *
 * CLI: bun run script/m14/mutate-analyzer.ts
 */
import * as fs from "fs"
import * as path from "path"
import { runLang, LANGS } from "./run-fixtures"

const ROOT = process.env.BB_M14_ROOT ? path.resolve(process.env.BB_M14_ROOT) : path.resolve((import.meta as any).dirname ?? path.dirname(Bun?.main ?? process.argv[1] ?? "."), "..", "..")

// M49 W15 (family-parity G9): reproduces the scala defect the parity gate
// found — a self-receiver member read targeting the literal keyword `this`
// instead of the member leaf. Generic off the symbol table: a `uses` edge whose
// source is a method of the type that declares the target becomes `target:
// "this"`, which is the exact pre-fix shape (and a non-symbol target).
function revertToKeywordTarget(r: any) {
  const ownerOfMethod = new Map<string, string>()
  const membersOf = new Map<string, Set<string>>()
  for (const s of r.symbols ?? []) {
    const owner = s.ownerName ?? s.owner
    if (!owner || typeof s.name !== "string") continue
    if (s.kind === "method" || s.kind === "function" || s.kind === "constructor") ownerOfMethod.set(s.name, owner)
    else if (!membersOf.has(owner)) membersOf.set(owner, new Set([s.name]))
    else membersOf.get(owner)!.add(s.name)
  }
  return {
    ...r,
    relationships: (r.relationships ?? []).map((x: any) => {
      const rel = normRel(x)
      if (rel.type !== "uses" || rel.target === "this") return x
      const owner = ownerOfMethod.get(rel.source)
      if (owner && membersOf.get(owner)?.has(String(rel.target))) return { ...x, target: "this" }
      return x
    }),
  }
}

// M59 (#825), second half: the PRE-FIX declaration line for an ANNOTATED
// definition. tree-sitter-scala starts a definition node at its leading
// annotation, so `contains X -> member` and the symbol's own range both landed
// one line above `def`/`val`. Simulated generically: any symbol the analyzer
// itself recorded decorators for is treated as annotated, and its range start
// plus every `contains` edge into it moves back one line. Uses the result's own
// decorator payload, so it stays a faithful stand-in rather than a name filter
// that silently stops matching when the fixture changes.
function revertToAnnotationStartLine(r: any) {
  const annotated = new Set(
    (r.symbols ?? [])
      .filter((s: any) => Array.isArray(s.decorators) && s.decorators.length > 0)
      .map((s: any) => s.name),
  )
  if (annotated.size === 0) return r
  return {
    ...r,
    symbols: (r.symbols ?? []).map((s: any) =>
      annotated.has(s.name)
        ? { ...s, range: { ...(s.range ?? {}), startLine: (s.range?.startLine ?? 1) - 1 } }
        : s,
    ),
    relationships: (r.relationships ?? []).map((x: any) => {
      const t = String(x.type ?? x.relationshipType ?? "")
      if (t !== "contains" || !annotated.has(String(x.target))) return x
      return typeof x.line_number === "number" ? { ...x, line_number: x.line_number - 1 } : x
    }),
  }
}

// M59 (#825): the PRE-FIX line for an inheritance list. Every supertype was
// stamped with the line the `extends` clause opened on, so on a parent written
// one per line only the FIRST one was right. Generic: within each source symbol,
// collapse every extends/implements edge onto that source's earliest such line.
function revertToClauseStartLine(r: any) {
  const rels: any[] = r.relationships ?? []
  const isHeritage = (x: any) => {
    const t = String(x.type ?? x.relationshipType ?? "")
    return t === "extends" || t === "implements"
  }
  const earliest = new Map<string, number>()
  for (const x of rels) {
    if (!isHeritage(x) || typeof x.line_number !== "number") continue
    const k = String(x.source ?? x.from ?? "?")
    const cur = earliest.get(k)
    if (cur === undefined || x.line_number < cur) earliest.set(k, x.line_number)
  }
  if (earliest.size === 0) return r
  return {
    ...r,
    relationships: rels.map((x: any) => {
      if (!isHeritage(x) || typeof x.line_number !== "number") return x
      const m = earliest.get(String(x.source ?? x.from ?? "?"))
      return m === undefined ? x : { ...x, line_number: m }
    }),
  }
}

// M59 (#825): the PRE-FIX line for a type REFERENCE. The line came from the
// enclosing type expression's start, so `type Shape[T] = Shape.Cases[(\n
//   Case[Cons[T], (T, Lst[T])]\n)]` put Cons/Lst/Unit on the `type` line.
// Generic: within each source symbol, collapse every `references` edge onto that
// source's earliest references line.
function revertToEnclosingTypeLine(r: any) {
  const rels: any[] = r.relationships ?? []
  const isRef = (x: any) => String(x.type ?? x.relationshipType ?? "") === "references"
  const earliest = new Map<string, number>()
  for (const x of rels) {
    if (!isRef(x) || typeof x.line_number !== "number") continue
    const k = String(x.source ?? x.from ?? "?")
    const cur = earliest.get(k)
    if (cur === undefined || x.line_number < cur) earliest.set(k, x.line_number)
  }
  if (earliest.size === 0) return r
  return {
    ...r,
    relationships: rels.map((x: any) => {
      if (!isRef(x) || typeof x.line_number !== "number") return x
      const m = earliest.get(String(x.source ?? x.from ?? "?"))
      return m === undefined ? x : { ...x, line_number: m }
    }),
  }
}

// M59 (#825), java half: the pre-fix state EXACTLY. Before this round the java
// analyzer emitted no line at all on any relationship (measured: java carried 0
// of its 1,920 lines on the 40-file oracle sample), so the faithful regression is
// "the field is gone", not a wrong number.
function dropJavaCallsiteLines(r: any) {
  const rels: any[] = r.relationships ?? []
  if (rels.length === 0) return r
  return {
    ...r,
    relationships: rels.map((x: any) => {
      const t = String(x.type ?? x.relationshipType ?? "")
      if (t !== "calls" && t !== "instantiates") return x
      if (!("line_number" in x)) return x
      const { line_number: _drop, ...rest } = x
      return rest
    }),
  }
}

// M59 (#825), the "no line at all" half: the PRE-FIX state EXACTLY for an
// analyzer that emitted none. Used by groovy (measured 0 of 761 relationships on
// a 40-file sample) and by xml, whose lines existed but were never pinned by any
// lane before this round.
function dropAllLineNumbers(r: any) {
  const rels: any[] = r.relationships ?? []
  if (!rels.some((x) => x && "line_number" in x)) return r
  return {
    ...r,
    relationships: rels.map((x: any) => {
      if (!x || !("line_number" in x)) return x
      const { line_number: _drop, ...rest } = x
      return rest
    }),
  }
}

// M59 (#825), kotlin half: the PRE-FIX state EXACTLY. Before this round the
// kotlin analyzer emitted NO line on a heritage edge (measured: 130 of 130
// kotlin_extends and 9 of 9 kotlin_implements carried none on a 60-file
// sample), so the faithful regression is "the field is gone", not a wrong
// number — same shape as java's drop mutant.
function dropKotlinHeritageLines(r: any) {
  const rels: any[] = r.relationships ?? []
  const isHeritage = (x: any) => {
    const t = String(x.type ?? x.relationshipType ?? "")
    return t === "extends" || t === "implements"
  }
  if (!rels.some((x) => isHeritage(x) && "line_number" in x)) return r
  return {
    ...r,
    relationships: rels.map((x: any) => {
      if (!isHeritage(x) || !("line_number" in x)) return x
      const { line_number: _drop, ...rest } = x
      return rest
    }),
  }
}

// M59 (#825), kotlin half: the NAIVE alternative the fixture forbids — every
// heritage edge stamped with the line the CLASS DECLARATION starts on. A
// wrapped supertype list (`internal class TestScopeImpl(...) :` / line 184
// `AbstractCoroutine<Unit>(...), TestScope {`) then names the class keyword for
// every parent. Written off the result's own symbol table so it cannot silently
// stop matching.
function revertKotlinHeritageToDeclarationLine(r: any) {
  const startLine = new Map<string, number>()
  for (const s of r.symbols ?? []) {
    if (typeof s?.name === "string" && typeof s?.range?.startLine === "number") {
      startLine.set(s.name, s.range.startLine)
    }
  }
  if (startLine.size === 0) return r
  return {
    ...r,
    relationships: (r.relationships ?? []).map((x: any) => {
      const t = String(x.type ?? x.relationshipType ?? "")
      if (t !== "extends" && t !== "implements") return x
      const ln = startLine.get(String(x.source ?? x.from ?? "?"))
      return ln === undefined ? x : { ...x, line_number: ln }
    }),
  }
}

// M59 (#825), the SFC seam: the PRE-FIX state of a DELEGATED relationship.
//
// vue and svelte hand their script block to the js/ts analyzer, whose lines are
// SCRIPT-relative, and the merge must add the block's line offset. This is not a
// simulated approximation: the delegate records its own 0-based row in
// `metadata.line` on the edges it emits, so `metadata.line + 1` IS the unshifted
// value the wrapper used to push. Measured on the corpus before the fix: 562 of
// 585 line-bearing vue edges and 19 of 58 svelte ones were INCONSISTENT.
function revertDelegatedLineToScriptRelative(r: any) {
  const rels: any[] = r.relationships ?? []
  // The OFFSET the wrapper applied is recorded on the edge (`sfcLineOffset`), so
  // subtracting it reproduces the pre-fix value exactly. A first version of this
  // mutant keyed on the delegate's `metadata.line` and SURVIVED: the js analyzer
  // sets that field only in some places, so the seam regression had no faithful
  // simulation — which is why the wrapper now records the offset it applied.
  const isDelegated = (x: any) => x?.metadata?.sfcDelegated === true && typeof x?.metadata?.sfcLineOffset === "number"
  if (!rels.some(isDelegated)) return r
  return {
    ...r,
    relationships: rels.map((x: any) =>
      isDelegated(x) && typeof x.line_number === "number"
        ? { ...x, line_number: x.line_number - x.metadata.sfcLineOffset }
        : x,
    ),
  }
}

// M49 (#868): the SFC seam applied the offset to `line_number` but not to the
// metadata LINE MIRRORS, so one row named two different lines (metadata
// script-relative, line_number file-relative). The applied offset is recorded on
// the row (`sfcLineOffset`), so subtracting it from every numeric line mirror
// reproduces the pre-fix state exactly rather than approximating it.
function revertDelegatedMetadataLineMirrors(r: any) {
  const rels: any[] = r.relationships ?? []
  const isDelegated = (x: any) => x?.metadata?.sfcDelegated === true && typeof x?.metadata?.sfcLineOffset === "number"
  if (!rels.some(isDelegated)) return r
  const shiftBack = (md: any, off: number) => {
    const out: any = { ...md }
    for (const [k, v] of Object.entries(out)) {
      if (!/line/i.test(k) || k === "sfcLineOffset") continue
      if (typeof v === "number") out[k] = v - off
      else if (Array.isArray(v)) out[k] = v.map((x) => (typeof x === "number" ? x - off : x))
    }
    return out
  }
  return {
    ...r,
    relationships: rels.map((x: any) =>
      isDelegated(x) ? { ...x, metadata: shiftBack(x.metadata, x.metadata.sfcLineOffset) } : x,
    ),
  }
}

// M60.P1 (#873), the TWO-BASES class on one row: the metadata line mirror goes
// back to `startPosition.row` while the row's own `line_number` stays 1-based —
// exactly what the eight typescript writers did before the fix, measured through
// the production pipeline as typescript 148/155 rows off by one (7 by more), tsx
// 173/179, vue 3/3, and zero rows on any JVM language. The mirror is
// reconstructed off the row's own 1-based line, so the mutation is the pre-fix
// OFF-BY-ONE state rather than an approximation; the larger disagreements came
// from the mirror naming a different NODE, which is what the writers' alignment
// fixes and what the fixture's pair-pins record.
function revertMetadataLineBase(r: any) {
  const rels: any[] = r.relationships ?? []
  const has = (x: any) =>
    typeof x?.line_number === "number" && typeof x?.metadata?.line === "number"
  if (!rels.some(has)) return r
  return {
    ...r,
    relationships: rels.map((x: any) =>
      has(x) ? { ...x, metadata: { ...x.metadata, line: x.line_number - 1 } } : x,
    ),
  }
}

// M60.P1 (#873), the same class on the rows where the mirror is the ONLY line:
// the cpp analyzer's Calls and Instantiates rows carry `metadata.line` and NO
// `line_number` at all, so `revertMetadataLineBase` above cannot see them (it
// requires both fields). This mutation restores `startPosition.row` on exactly
// those rows — the pre-fix writer, measured as 708 cpp and 1,327 hpp rows in a
// three-file-per-language sample. It exists because a mutant that only knows the
// two-field shape would let the one-field shape regress unnoticed.
function revertMetadataOnlyLineBase(r: any) {
  const rels: any[] = r.relationships ?? []
  const has = (x: any) =>
    typeof x?.line_number !== "number" && typeof x?.metadata?.line === "number"
  if (!rels.some(has)) return r
  return {
    ...r,
    relationships: rels.map((x: any) =>
      has(x) ? { ...x, metadata: { ...x.metadata, line: x.metadata.line - 1 } } : x,
    ),
  }
}

// M59 (#825), the 0-based/1-based class: every line shifted down by one, which is
// what emitting `startPosition.row` instead of `row + 1` produces. This is the
// classic off-by-one this contract is one keystroke away from, and it is the
// mutation that proves the fixtures pin the ARITHMETIC, not just the presence of
// a number (a fixture that only checked "has a line" would survive it).
function shiftLineNumbersZeroBased(r: any) {
  const rels: any[] = r.relationships ?? []
  if (!rels.some((x) => typeof x?.line_number === "number")) return r
  return {
    ...r,
    relationships: rels.map((x: any) =>
      typeof x?.line_number === "number" ? { ...x, line_number: x.line_number - 1 } : x,
    ),
  }
}

// M59 (#825), the vue OPTIONS-API prop class: the PRE-FIX state EXACTLY. Every
// prop/emit symbol was stamped with the `props: { … }` PAIR's range, so all of
// them named one line instead of their own keys (measured on the corpus after the
// seam was fixed: Account.vue claimed `user` at 17, the `props: {` line, while
// `user` is written at 18). Replayed off the result's own symbol table: the pair's
// line is the minimum line among the flagged symbols, which is where they all
// pointed before.
function revertPropLineToPropsPair(r: any) {
  const props = (r.symbols ?? []).filter(
    (s: any) => s?.metadata?.isProp === true || s?.metadata?.isEmit === true,
  )
  if (props.length === 0) return r
  const pairLine = Math.min(...props.map((p: any) => p?.range?.startLine ?? Infinity))
  if (!Number.isFinite(pairLine)) return r
  const names = new Set(props.map((p: any) => p.name))
  return {
    ...r,
    relationships: (r.relationships ?? []).map((x: any) => {
      const t = String(x?.type ?? x?.relationshipType ?? "")
      if (t !== "contains" || !names.has(x?.target)) return x
      return { ...x, line_number: pairLine }
    }),
  }
}

// M59 (#825), import half: the PRE-FIX import line EXACTLY. The edge's target is
// the dotted module; the pre-fix line was that import statement's own start, so
// an import whose last segment is written later (a renamed selector inside a
// multi-line brace import) claimed a line its name is not on.
function revertImportToStatementStartLine(r: any) {
  const imports: any[] = r.imports ?? []
  if (imports.length === 0) return r
  const byModule = new Map<string, number>()
  for (const imp of imports) {
    const ln = imp?.range?.startLine
    if (typeof imp?.module === "string" && typeof ln === "number") byModule.set(imp.module, ln)
  }
  if (byModule.size === 0) return r
  return {
    ...r,
    relationships: (r.relationships ?? []).map((x: any) => {
      if (!x?.metadata?.isImportDep) return x
      const ln = byModule.get(String(x.target))
      return ln === undefined ? x : { ...x, line_number: ln }
    }),
  }
}

// M59 (#825): the PRE-FIX call-site line semantics. A call_expression starts at
// its RECEIVER, so every call inside one multi-line chain was stamped with the
// line the chain opened on — on the real cats-effect Example.scala that put 5
// distinct calls on line 22 when 6 of them are written on line 23. Simulated
// generically off the result: within each source symbol, collapse every
// call/instantiation line onto that symbol's earliest one. Written this way so
// it stays a faithful stand-in on any fixture rather than a name-hardcoded
// filter that can silently stop matching.
function revertToChainOpeningLine(r: any) {
  const rels: any[] = r.relationships ?? []
  const isCallish = (x: any) =>
    x.type === "calls" || x.relationshipType === "calls" || x.metadata?.isInstantiation === true
  const earliest = new Map<string, number>()
  for (const x of rels) {
    if (!isCallish(x) || typeof x.line_number !== "number") continue
    const k = String(x.source ?? x.from ?? "?")
    const cur = earliest.get(k)
    if (cur === undefined || x.line_number < cur) earliest.set(k, x.line_number)
  }
  if (earliest.size === 0) return r
  return {
    ...r,
    relationships: rels.map((x: any) => {
      if (!isCallish(x) || typeof x.line_number !== "number") return x
      const m = earliest.get(String(x.source ?? x.from ?? "?"))
      return m === undefined ? x : { ...x, line_number: m }
    }),
  }
}

// M59 (#825) extension-receiver follow-through: the PRE-FIX line semantics
// EXACTLY. The receiver-type use used to be stamped with the OWNING method's
// declaration line, but the type is written on the extension clause — which on
// the real scala3 warn suite (`ext-override.scala`) sits on a different line
// than the method. Simulated off the result's own symbol table (the def line
// the old stamp read), so it cannot silently stop matching on a rename.
function revertToExtensionReceiverMethodLine(r: any) {
  const defLine = new Map<string, number>()
  for (const s of r.symbols ?? []) {
    if (typeof s?.range?.startLine === "number") defLine.set(String(s.name), s.range.startLine)
  }
  const rels: any[] = r.relationships ?? []
  const isExtUse = (x: any) =>
    String(x.type ?? x.relationshipType) === "uses" && x.metadata?.isExtension === true
  if (!rels.some(isExtUse)) return r
  return {
    ...r,
    relationships: rels.map((x: any) => {
      if (!isExtUse(x)) return x
      const m = defLine.get(String(x.source ?? x.from ?? "?"))
      return m === undefined ? x : { ...x, line_number: m }
    }),
  }
}

// M59 (#825), synthesised-member half: the PRE-FIX line semantics EXACTLY. A
// phantom symbol's range IS its enclosing declaration's range (kotlin's data
// class, java's lombok field / Spring-Data interface), so the containment edge
// used to carry a real-looking line on which the target name is written NOWHERE.
// Written off the result's own symbol table (metadata.isPhantom + range) so it
// cannot silently stop matching on a fixture that renames things.
function stampPhantomContainmentLine(r: any) {
  const phantomLine = new Map<string, number>()
  for (const s of r.symbols ?? []) {
    if (s?.metadata?.isPhantom === true && typeof s?.range?.startLine === "number") {
      phantomLine.set(String(s.name), s.range.startLine)
    }
  }
  if (phantomLine.size === 0) return r
  const rels: any[] = r.relationships ?? []
  const isContains = (x: any) => x.type === "contains" || x.relationshipType === "contains"
  if (!rels.some((x) => isContains(x) && phantomLine.has(String(x.target ?? x.to ?? "")))) return r
  return {
    ...r,
    relationships: rels.map((x: any) => {
      if (!isContains(x)) return x
      const ln = phantomLine.get(String(x.target ?? x.to ?? ""))
      return ln === undefined ? x : { ...x, line_number: ln }
    }),
  }
}

// M59 (#825), the OTHER half of the same injector bug: synthesized members that
// are NOT componentN (copy/equals/hashCode/toString) go back to carrying no
// ownerName, so their class contains them no more. Derived from the symbols' own
// names (the four generated members are the phantoms that are not componentN).
function dropNonComponentPhantomContainment(r: any) {
  const unowned = new Set<string>()
  for (const s of r.symbols ?? []) {
    if (s?.metadata?.isPhantom !== true) continue
    const n = String(s?.name ?? "")
    if (!/^component\d+$/.test(n)) unowned.add(n)
  }
  if (unowned.size === 0) return r
  const rels: any[] = r.relationships ?? []
  const isContains = (x: any) => x.type === "contains" || x.relationshipType === "contains"
  if (!rels.some((x) => isContains(x) && unowned.has(String(x.target ?? x.to ?? "")))) return r
  return {
    ...r,
    relationships: rels.filter((x: any) => !(isContains(x) && unowned.has(String(x.target ?? x.to ?? "")))),
  }
}

interface Mutant {
  id: string
  language: string
  defectClass: string
  description: string
  transform: (result: any) => any
}

function normRel(r: any) { return { ...r, type: r.type ?? r.relationshipType } }

// M49 W15 #814: a faithful revert of the family-wide source ruling — every
// `uses` edge whose source is a METHOD (or constructor) is re-attributed to
// that method's OWNER, which is exactly what the analyzer did before the
// convergence. Written generically off the result's own symbol table (a method
// name maps to its owner), so it stays valid on any fixture and any language,
// and it cannot silently stop matching the way a name-hardcoded filter does
// (the failure mode that left swift/drop-container-subscript-uses surviving).
function revertToTypeSource(r: any) {
  const ownerOf = new Map<string, string>()
  for (const s of r.symbols ?? []) {
    const owner = s.ownerName ?? s.owner
    if (owner && typeof s.name === "string" && (s.kind === "method" || s.kind === "function" || s.kind === "constructor")) {
      ownerOf.set(s.name, owner)
    }
  }
  return {
    ...r,
    relationships: (r.relationships ?? []).map((x: any) => {
      const rel = normRel(x)
      if (rel.type === "uses" && ownerOf.has(rel.source)) {
        return { ...x, source: ownerOf.get(rel.source) }
      }
      return x
    }),
  }
}

// M59 (#861): the decorated-declaration contract, both halves, as faithful
// reverts of the measured pre-fix behaviour.
//
// `revertDecoratorRangeExclusion` puts a decorated symbol's range start back onto
// its DECORATOR and moves the contains/exports lines derived from it with it —
// the pre-fix state in both web grammars (a decorated declaration's node starts
// at the decorator).
function revertDecoratorRangeExclusion() {
  return (r: any) => {
    const decorated = new Set<string>(
      (r.symbols ?? [])
        .filter((s: any) => Array.isArray(s.decorators) && s.decorators.length > 0)
        .map((s: any) => s.name),
    )
    if (decorated.size === 0) return r
    return {
      ...r,
      symbols: (r.symbols ?? []).map((s: any) =>
        decorated.has(s.name)
          ? { ...s, range: { ...(s.range ?? {}), startLine: (s.range?.startLine ?? 1) - 1 } }
          : s,
      ),
      relationships: (r.relationships ?? []).map((x: any) => {
        const t = String(x.type ?? x.relationshipType ?? "")
        if ((t !== "contains" && t !== "exports") || !decorated.has(String(x.target))) return x
        return typeof x.line_number === "number" ? { ...x, line_number: x.line_number - 1 } : x
      }),
    }
  }
}

// `readdScopeScopedDecoratorEdges` restores the class-scoped decorator rows the
// metadata rule removed: for every symbol carrying decorators, the decorator's
// invocation and name become `calls`/`references` edges sourced from the scope
// that lexically encloses it (the class for a member, the class itself for its
// own decorator).
function readdScopeScopedDecoratorEdges() {
  return (r: any) => {
    const extra: any[] = []
    for (const s of r.symbols ?? []) {
      if (!Array.isArray(s.decorators) || s.decorators.length === 0) continue
      const lines = s.metadata?.decoratorLines as Array<number | null> | undefined
      const source = s.kind === "class" ? s.name : (s.ownerName ?? s.name)
      for (let i = 0; i < s.decorators.length; i++) {
        const line = lines?.[i]
        const lineField = typeof line === "number" ? { line_number: line } : {}
        extra.push({ source, target: s.decorators[i], type: "calls", confidence: 0.8, ...lineField, metadata: { calleeExpression: s.decorators[i] } })
        extra.push({ source, target: s.decorators[i], type: "references", confidence: 0.8, ...lineField, metadata: {} })
      }
    }
    if (extra.length === 0) return r
    return { ...r, relationships: [...(r.relationships ?? []), ...extra] }
  }
}

// M49 #868 — the javascript decorator-metadata layer as faithful reverts. Each
// transform reproduces ONE measured pre-fix state off the result's own tables,
// so it stays valid on any fixture rather than hard-coding one file's rows.

/** Contract 1 pre-fix: a FIELD's decorator was never attached. */
function dropJsFieldDecorators() {
  return (r: any) => {
    const stripped = (r.symbols ?? []).filter(
      (s: any) => String(s.kind) === "property" && Array.isArray(s.decorators) && s.decorators.length > 0,
    ).map((s: any) => s.name)
    if (stripped.length === 0) return r
    const names = new Set(stripped)
    return {
      ...r,
      symbols: (r.symbols ?? []).map((s: any) =>
        names.has(s.name) && String(s.kind) === "property" ? { ...s, decorators: undefined, metadata: { ...(s.metadata ?? {}), decoratorLines: undefined } } : s,
      ),
      relationships: (r.relationships ?? []).filter(
        (x: any) => !(x.metadata?.isDecorator && names.has(String(x.source))),
      ),
    }
  }
}

/** Contract 2 pre-fix: no decorator `references` edge existed at all. */
function dropDecoratorReferences() {
  return (r: any) => ({
    ...r,
    relationships: (r.relationships ?? []).filter((x: any) => !x.metadata?.isDecorator),
  })
}

/** Contract 2 near-miss: the decorator edge borrows the DECLARATION's line. */
function decoratorEdgeBorrowsDeclarationLine() {
  return (r: any) => {
    const lineByName = new Map<string, number>()
    for (const s of r.symbols ?? []) {
      const l = s.range?.startLine
      if (typeof l === "number") lineByName.set(String(s.name), l)
    }
    return {
      ...r,
      relationships: (r.relationships ?? []).map((x: any) => {
        if (!x.metadata?.isDecorator) return x
        const l = lineByName.get(String(x.source))
        return typeof l === "number" ? { ...x, line_number: l } : x
      }),
    }
  }
}

/** The M59 #860 pre-fix state: a decorator edge with NO line at all. */
function dropDecoratorEdgeLines() {
  return (r: any) => ({
    ...r,
    relationships: (r.relationships ?? []).map((x: any) => {
      if (!x.metadata?.isDecorator) return x
      const { line_number, ...rest } = x
      return { ...rest, line_number: null }
    }),
  })
}

/** Contract 4 pre-fix: an EXPORTED class's decorator was dropped entirely. */
function dropExportedClassDecorators() {
  return (r: any) => {
    const exported = new Set<string>(
      (r.relationships ?? []).filter((x: any) => String(x.type) === "exports").map((x: any) => String(x.target)),
    )
    const dropped = (r.symbols ?? []).filter(
      (s: any) => String(s.kind) === "class" && exported.has(String(s.name)) && Array.isArray(s.decorators) && s.decorators.length > 0,
    ).map((s: any) => s.name)
    if (dropped.length === 0) return r
    const names = new Set(dropped)
    return {
      ...r,
      symbols: (r.symbols ?? []).map((s: any) =>
        names.has(s.name) ? { ...s, decorators: undefined, metadata: { ...(s.metadata ?? {}), decoratorLines: undefined } } : s,
      ),
      relationships: (r.relationships ?? []).filter(
        (x: any) => !(x.metadata?.isDecorator && names.has(String(x.source))),
      ),
    }
  }
}

/** Contract 3 pre-fix: a decorator's name is a bare READ from its carrier. */
function readdDecoratorPositionReads() {
  return (r: any) => {
    const extra: any[] = []
    for (const s of r.symbols ?? []) {
      if (!Array.isArray(s.decorators) || s.decorators.length === 0) continue
      const lines = s.metadata?.decoratorLines as Array<number | null> | undefined
      for (let i = 0; i < s.decorators.length; i++) {
        const line = lines?.[i]
        extra.push({
          source: s.name,
          target: s.decorators[i],
          type: "uses",
          confidence: 0.6,
          ...(typeof line === "number" ? { line_number: line } : {}),
          metadata: { isFieldAccess: true, bareRead: true },
        })
      }
    }
    if (extra.length === 0) return r
    return { ...r, relationships: [...(r.relationships ?? []), ...extra] }
  }
}

// M49/M37 #866: the two halves of the anonymous-body MEMBER contract as
// faithful reverts of the measured pre-fix behaviour (kotlin and scala dropped
// the field member; kotlin also flattened its initialiser call onto the
// enclosing method). Both are written off the result's own symbol table so
// they stay valid on any fixture.
//
// `dropAnonBodyMember` removes the FIELD member of an anonymous body together
// with its containment edge — the exact state kotlin and scala emitted before
// the fix (no symbol at all). Scoped to a member whose OWNER is an anonymous
// type, so it cannot be caught by an ordinary class-field fixture.
function dropAnonBodyMember(memberName: string) {
  return (r: any) => {
    const anonNames = new Set<string>(
      (r.symbols ?? [])
        .filter((s: any) => String(s.name ?? "").startsWith("anonymous_"))
        .map((s: any) => s.name),
    )
    return {
      ...r,
      symbols: (r.symbols ?? []).filter(
        (s: any) => !(s.name === memberName && anonNames.has(s.ownerName)),
      ),
      relationships: (r.relationships ?? []).filter(
        (x: any) => !(x.type === "contains" && x.target === memberName && anonNames.has(x.source)),
      ),
    }
  }
}

// M49/M37 #867: the anonymous type's OWNER contract, as two faithful reverts —
// one per context the ruling pins. Both are written off the result's own symbol
// table (no fixture-specific names), so they stay valid on any fixture.
//
// `reownAnonTypeToClass` re-owns every anonymous type whose owner is a
// DECLARATION (a method/function) to the file's named class — exactly kotlin's
// pre-ruling answer, and the defect direction the ruling forbids.
// `stripClassOwnedAnonOwner` removes the owner of every anonymous type owned by
// a CLASS, which is the class-level context the old behaviour happened to get
// right and which nothing pinned until this round.
function reownAnonTypeToClass() {
  return (r: any) => {
    const named = (r.symbols ?? []).find(
      (s: any) => String(s.kind) === "class" && !String(s.name ?? "").startsWith("anonymous_"),
    )
    if (!named) return r
    return {
      ...r,
      symbols: (r.symbols ?? []).map((s: any) =>
        String(s.name ?? "").startsWith("anonymous_") && (s.ownerKind === "method" || s.ownerKind === "function")
          ? { ...s, ownerName: named.name, ownerKind: "class" }
          : s,
      ),
      // The containment edge follows the owner: the method no longer contains
      // the type, and the class claims it instead.
      relationships: (r.relationships ?? []).map((x: any) =>
        x.type === "contains" && String(x.target ?? "").startsWith("anonymous_") && x.source !== named.name
          ? { ...x, source: named.name, from: named.name, fromSymbol: named.name }
          : x,
      ),
    }
  }
}

// `anonTypeClaimsFileImports` reverts the pre-ruling import attribution: import
// reference edges carry the `root` placeholder and are rewritten onto the file's
// primary top-level type; before the ruling an ownerless anonymous object
// qualified, so it claimed every import edge of the file.
function anonTypeClaimsFileImports() {
  return (r: any) => {
    const anon = (r.symbols ?? []).find((s: any) => String(s.name ?? "").startsWith("anonymous_"))
    if (!anon) return r
    return {
      ...r,
      relationships: (r.relationships ?? []).map((x: any) =>
        String(x.type) === "references" && String(x.source ?? "") === "root"
          ? { ...x, source: anon.name, from: anon.name, fromSymbol: anon.name }
          : x,
      ),
    }
  }
}

function stripClassOwnedAnonOwner() {
  return (r: any) => ({
    ...r,
    symbols: (r.symbols ?? []).map((s: any) =>
      String(s.name ?? "").startsWith("anonymous_") && s.ownerKind === "class"
        ? { ...s, ownerName: undefined, ownerKind: undefined }
        : s,
    ),
    // Only the OWNER-to-type edge is removed: an edge whose source is the
    // anonymous type itself (contains anonymous_X -> member) is a different
    // contract (#866) and is deliberately left intact, so this mutant can only
    // be caught by the owner pin.
    relationships: (r.relationships ?? []).filter(
      (x: any) =>
        !(
          x.type === "contains" &&
          String(x.target ?? "").startsWith("anonymous_") &&
          !String(x.source ?? "").startsWith("anonymous_")
        ),
    ),
  })
}

// `reattributeAnonBodyCall` flattens every call made from an anonymous body
// onto the named outer declaration — kotlin's pre-fix answer for a member
// initialiser (`calls build -> target` instead of `calls anonymous_Runnable
// -> target`). It reverts the resolver side only; the symbol side is left
// intact so the two halves of the contract are provably independent.
function reattributeAnonBodyCall(outerName: string) {
  return (r: any) => ({
    ...r,
    relationships: (r.relationships ?? []).map((x: any) =>
      String(x.type) === "calls" && String(x.source ?? "").startsWith("anonymous_")
        ? { ...x, source: outerName, from: outerName, fromSymbol: outerName }
        : x,
    ),
  })
}

const MUTANTS: Mutant[] = [
  {
    id: "clojure/emit-quote-forms",
    language: "clojure",
    defectClass: "relationship-fabrication",
    description: "#881 regression: removes the execution-boundary guard — quote/discarded/commented forms fabricate calls and phantom definitions (pre-fix behavior)",
    transform: r => ({
      ...r,
      relationships: [...(r.relationships ?? []), { type: "calls", source: "caller", target: "quoted-ghost", confidence: 1, metadata: { clojureSpecific: true, isGeneralCall: true } }],
      symbols: [...(r.symbols ?? []), { name: "quoted-definition", kind: "function" }],
    }),
  },
  {
    id: "clojure/discard-head-occupies-form-position",
    language: "clojure",
    defectClass: "relationship-fabrication",
    description: "#881 regression: a leading `#_discard` is treated as the list head, so `(#_ignored quote (trivia-ghost))` is walked as live code instead of a quote form and fabricates calls[caller->trivia-ghost] — the exact shape formNameOf's executionHead rule prevents",
    transform: r => ({
      ...r,
      relationships: [...(r.relationships ?? []), { type: "calls", source: "caller", target: "trivia-ghost", confidence: 0.9, metadata: { clojureSpecific: true, isGeneralCall: true } }],
    }),
  },
  {
    id: "clojure/meta-head-takes-no-call",
    language: "clojure",
    defectClass: "relationship-loss",
    description: "#881 head-position regression: metadata is treated as occupying head position, so `(^:probe meta-called)` stops being an ordinary call and meta-head loses calls->meta-called (the widening executionHead introduces at the fixture head-position-881)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(x.type === "calls" && x.source === "meta-head" && x.target === "meta-called")) }),
  },
  {
    id: "clojure/drop-live-unquote",
    language: "clojure",
    defectClass: "relationship-loss",
    description: "#881 regression: syntax-quote prunes live unquote execution — templates loses calls to live-unquote (verified HEAD counterexample)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(x.type === "calls" && x.target === "live-unquote")) }),
  },
  {
    id: "clojure/drop-shadowed-comment-call",
    language: "clojure",
    defectClass: "relationship-loss",
    description: "#881 regression: shadowed comment macro treated as core form — parameter-shadow loses calls to live-argument (verified HEAD counterexample)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(x.type === "calls" && x.target === "live-argument")) }),
  },
  {
    id: "clojure/drop-case-default-calls",
    language: "clojure",
    defectClass: "relationship-loss",
    description: "W23 regression: re-imposes the constant-group parity skip on `case` defaults — calls inside a LIST-shaped default vanish (`(case k :a 1 (helper-default k))` loses calls->helper-default for both h and j); the case-constants fixture pins them (mirrored fix: analyzer + oracle)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(x.type === "calls" && x.target === "helper-default")) }),
  },
  {
    id: "clojure/drop-edge-lines",
    language: "clojure",
    defectClass: "payload-loss",
    description: "M59 (#825) regression: every edge loses its line_number (the measured pre-fix state: 0/8381 corpus clojure edges lined) — callsite-lines-825's null-line forbid pins the unlined collapse that no expect entry can express absent",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map(x => { const { line_number, ...rest } = x; return rest }) }),
  },
  {
    id: "clojure/line-zero-based",
    language: "clojure",
    defectClass: "payload-corruption",
    description: "M59 (#825): the line is emitted 0-based (every site off by one; line 1 becomes the stored 0 the M59 healing pass exists for) — per-site line pins catch it",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map(x => (typeof x.line_number === "number" ? { ...x, line_number: x.line_number - 1 } : x)) }),
  },
  {
    id: "clojure/arity-dropped",
    language: "clojure",
    defectClass: "payload-loss",
    description: "ER-D2 parity: call edges lose meta.callArity — `pick/0` and `pick/1` sites become indistinguishable in the payload (the multi-arity merge defect class)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map(x => x.type === "calls" && x.metadata ? { ...x, metadata: Object.fromEntries(Object.entries(x.metadata).filter(([k]) => k !== "callArity")) } : x) }),
  },
  {
    id: "clojure/site-collapsed",
    language: "clojure",
    defectClass: "relationship-loss",
    description: "the per-site collapse: edges deduped without the line component, so one callee call site survives per (source,target) — callsite-lines-825 loses its line-9/10 rows",
    transform: r => {
      const seen = new Set<string>()
      const rels = (r.relationships ?? []).filter((x: any) => {
        const k = `${x.source}|${x.type}|${x.target}`
        if (seen.has(k)) return false
        seen.add(k)
        return true
      })
      return { ...r, relationships: rels }
    },
  },
  {
    id: "clojure/docstring-dropped",
    language: "clojure",
    defectClass: "payload-loss",
    description: "C4 regression: strips comments AND docstring from all symbols (the doc channel is differential-invisible — only the fixture can catch it) — docstrings expectComments pins catch it",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map(s => { const { comments, docstring, ...rest } = s; return rest }) }),
  },
  {
    id: "clojure/implements-alias-unresolved",
    language: "clojure",
    defectClass: "identity-corruption",
    description: "C5 regression: aliased protocol targets revert to the raw alias (`p/Proto`) — implements-alias expect AND forbid both fail",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map(x => (typeof x.target === "string" && x.target.endsWith("/Proto") && x.target !== "p/Proto" ? { ...x, target: "p/Proto" } : x)) }),
  },
  {
    id: "clojure/param-amp-kept",
    language: "clojure",
    defectClass: "payload-corruption",
    description: "C11 regression: the rest marker leaks into parameters (`[& args]` → [\"&\",\"args\"]) — params forbidParameters names [&] catches it",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map(s => (s.name === "rest-args" ? { ...s, parameters: [{ name: "&", type: "Any" }, { name: "args", type: "Any" }] } : s)) }),
  },
  {
    id: "clojure/param-body-leak",
    language: "clojure",
    defectClass: "payload-corruption",
    description: "C10 regression: body vectors leak back into parameters (`(defn leaky [x] [y z])` → [x, y, z]) — params forbidParameters names [y, z] catches it",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map(s => (s.name === "leaky" ? { ...s, parameters: [{ name: "x", type: "Any" }, { name: "y", type: "Any" }, { name: "z", type: "Any" }] } : s)) }),
  },
  {
    id: "clojure/reify-false-call",
    language: "clojure",
    defectClass: "relationship-fabrication",
    description: "C9 regression: a reify/extend method impl fabricates a call edge (the measured `use-reify -[calls]-> px` class — here `build -[calls]-> ex`) — extend-reify's calls→ex forbid catches it",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { type: "calls", source: "build", target: "ex", confidence: 0.9, metadata: { clojureSpecific: true, isGeneralCall: true } }] }),
  },
  {
    id: "clojure/reify-no-implements",
    language: "clojure",
    defectClass: "relationship-loss",
    description: "C9 regression: protocol-extending forms emit no implements edges (reify/extend-protocol silently absent) — extend-reify expects catch it",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(x.type === "implements" && typeof x.target === "string" && x.target.endsWith("/Ext"))) }),
  },
  {
    id: "clojure/tag-payload-call",
    language: "clojure",
    defectClass: "relationship-fabrication",
    description: "C13 regression: a tagged-literal payload is walked as code (`#my/tag (call-x)` emits calls→call-x) — tagged-ctors forbid catches it",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { type: "calls", source: "clj.fixture.tags", target: "call-x", confidence: 0.9, metadata: { clojureSpecific: true, isGeneralCall: true } }] }),
  },
  {
    id: "clojure/tag-lowercase-ctor",
    language: "clojure",
    defectClass: "relationship-fabrication",
    description: "C12 regression: a lowercase tagged literal is misread as a constructor (`#my/tag [1 2]` → instantiates my/tag) — tagged-ctors forbid catches it",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { type: "instantiates", source: "clj.fixture.tags", target: "my/tag", confidence: 0.8, metadata: { clojureSpecific: true, isCtorLiteral: true } }] }),
  },
  {
    id: "clojure/directive-ignored",
    language: "clojure",
    defectClass: "relationship-loss",
    description: "C7 regression: the top-level require is ignored — its import/references vanish AND the aliased call target reverts to the raw `s/join` (the measured pre-fix state) — toplevel-forms expect+forbid catch both halves",
    transform: r => ({
      ...r,
      imports: (r.imports ?? []).filter((i: any) => !(i.module === "clojure.string" && i.line === 5)),
      relationships: [
        ...(r.relationships ?? []).filter((x: any) => !(typeof x.target === "string" && x.target === "clojure.string" && x.line_number === 5)),
        ...(r.relationships ?? []).filter((x: any) => x.type === "calls" && x.target === "clojure.string/join").map((x: any) => ({ ...x, target: "s/join" })),
      ],
    }),
  },
  {
    id: "clojure/toplevel-call-dropped",
    language: "clojure",
    defectClass: "relationship-loss",
    description: "C8 regression: calls outside functions are dropped again (def/defonce initializers, deftest bodies) — toplevel-calls expects catch it",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(x.metadata ?? {}).isTopLevel) }),
  },
  {
    id: "clojure/complexity-symbols-length",
    language: "clojure",
    defectClass: "payload-fabrication",
    description: "C6 regression: the file complexity fallback reverts to the fabricated `symbols.length` (vars/protocols/modules counted as complexity) — callsite-lines-825's expectMetadata pin catches it (differential-invisible)",
    transform: r => ({ ...r, metadata: { ...(r.metadata ?? {}), cyclomaticComplexity: (r.symbols ?? []).length } }),
  },
  {
    id: "clojure/libspec-children-walked",
    language: "clojure",
    defectClass: "relationship-fabrication",
    description: "C14 regression: the C7/C8 libspec guard is dropped — `(java.util Date)` inside `(:import …)` is walked as a call and fabricates `ns -[calls]-> java.util` (found by the M12 differential as a false positive during CLJ1; import-list forbid catches it)",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { type: "calls", source: "clj.fixture.importlist", target: "java.util", confidence: 0.9, metadata: { clojureSpecific: true, isGeneralCall: true, isTopLevel: true } }] }),
  },
  {
    id: "clojure/kwd-ns-corruption",
    language: "clojure",
    defectClass: "identity-corruption",
    description: "F5-cert (junit.clj): a keyword-headed data form (`(:ns (meta var))`) fires the ns branch — phantom module symbol + alias-table reset, so later aliased calls go unresolved — kwd-headed-data pins catch both halves",
    transform: r => ({
      ...r,
      symbols: [...(r.symbols ?? []), { name: "(meta var)", kind: "module", scope: "", visibility: "public", metadata: { clojureSpecific: true } }],
      relationships: (r.relationships ?? []).map(x => (x.type === "calls" && x.source === "still-resolves" && x.target === "clojure.string/join" ? { ...x, target: "s/join" } : x)),
    }),
  },
  {
    id: "clojure/object-proto-guard",
    language: "clojure",
    defectClass: "relationship-loss",
    description: "F5-cert (clj-kondo rewrite-clj): a plain-object guard answers `[\"toString\"]` from Object.prototype — every Java-class toString override misfires the method-impl rule, losing the method symbol and consuming its body's calls — tostring-impl pins catch it",
    transform: r => ({
      ...r,
      symbols: (r.symbols ?? []).filter(s => s.name !== "toString"),
      relationships: (r.relationships ?? []).filter(x => !(x.type === "calls" && x.source === "toString" && x.target === "helper")),
    }),
  },
  {
    id: "clojure/self-reference-edge",
    language: "clojure",
    defectClass: "relationship-fabrication",
    description: "F5-cert (clj-kondo node.clj / order.clj): a self-require or self-qualified call emits a self-loop references edge (ELXD8 violation) — self-reference forbid catches it",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { type: "references", source: "clj.fixture.selfref", target: "clj.fixture.selfref", confidence: 0.9, metadata: { clojureSpecific: true, isLibraryDep: true } }] }),
  },
  {
    id: "clojure/prefix-require-flat",
    language: "clojure",
    defectClass: "relationship-loss",
    description: "F5-cert (clj-kondo meta.clj): prefix-list require `[prefix [sub :as a]]` handled as a flat spec — nested sub references dropped and `a/one` left unresolved as `a/one` — prefix-require pins catch both halves",
    transform: r => ({
      ...r,
      relationships: (r.relationships ?? [])
        .filter(x => !(x.type === "references" && x.target === "clj.fixture.prefix.alpha"))
        .map(x => (x.type === "calls" && x.source === "go" && x.target === "clj.fixture.prefix.alpha/one" ? { ...x, target: "a/one" } : x)),
    }),
  },
  {
    id: "clojure/anon-fn-head-dropped",
    language: "clojure",
    defectClass: "relationship-loss",
    description: "CLJ-ADV F1: the `#(f …)` shorthand head call dropped (body elements walked as argument positions only) — anon-fn-calls pins the lambda->helper edge",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(x.type === "calls" && x.target === "helper" && String(x.source).startsWith("lambda_"))) }),
  },
  {
    id: "clojure/refer-clojure-walked",
    language: "clojure",
    defectClass: "relationship-fabrication",
    description: "CLJ-ADV F2: `(:refer-clojure :exclude [replace reverse])` fed through the libspec handler — the VAR name becomes a fabricated namespace reference (43 corpus files) — refer-clojure forbids catch it",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { type: "references", source: "clj.fixture.rc", target: "replace", confidence: 0.9, metadata: { clojureSpecific: true, isLibraryDep: true } }] }),
  },
  {
    id: "clojure/alias-proto-pollution",
    language: "clojure",
    defectClass: "identity-corruption",
    description: "CLJ-ADV F3: the plain-{} namespaceAliases answers `[\"toString\"]` from Object.prototype — the call target becomes the inherited Function source text (the F5-2 class, missed on this record) — proto-alias pins the honest target",
    transform: r => ({
      ...r,
      relationships: (r.relationships ?? []).map(x => (x.type === "calls" && x.source === "f" && x.target === "clj.fixture.proto/helper" ? { ...x, target: "function toString() {\n    [native code]\n}/helper" } : x)),
    }),
  },
  {
    id: "clojure/comment-data-shadow-flip",
    language: "clojure",
    defectClass: "relationship-fabrication",
    description: "CLJ-ADV F4: a DATA-position `comment` symbol (map key) flips the file-global shadow flag — every `(comment …)` body is walked as code (a fabricated call from a scratch block, measured on clj-kondo analyzer.clj)",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { type: "calls", source: "clj.fixture.cdata", target: "fabricated", confidence: 0.9, metadata: { clojureSpecific: true, isGeneralCall: true, isTopLevel: true } }] }),
  },
  {
    id: "clojure/comment-shadow-region-leak",
    language: "clojure",
    defectClass: "relationship-fabrication",
    description: "W23-b regression: shadow ranges collapse back into one file-wide order-blind flag — the data block BEFORE any shadow (w23b-ordered-ghost), the block after the let's region closed (w23b-region-ghost) and a sibling arity clause's data block (w23b-multi-ghost) are all walked as code (the pre-fix fabrication), caught by shadowed-comment-881's three forbidden ghosts",
    transform: r => ({
      ...r,
      relationships: [
        ...(r.relationships ?? []),
        { type: "calls", source: "shadow-boundary-probe", target: "w23b-ordered-ghost", confidence: 0.9, metadata: { clojureSpecific: true, isGeneralCall: true, isTopLevel: true } },
        { type: "calls", source: "w23b-region-window", target: "w23b-region-ghost", confidence: 0.9, metadata: { clojureSpecific: true, isGeneralCall: true } },
        { type: "calls", source: "w23b-multi", target: "w23b-multi-ghost", confidence: 0.9, metadata: { clojureSpecific: true, isGeneralCall: true } },
      ],
    }),
  },
  {
    id: "clojure/letfn-spec-shadow-dropped",
    language: "clojure",
    defectClass: "relationship-loss",
    description: "W24-mr1 regression (fixture shadowed-comment-881 shapes C/D/E): letfn fn-spec bindings stop shadowing the comment macro — the spec-head name and spec params emit no ranges again, so `(comment (target))` bodies are dropped as data (three missing live edges; the after-form ghost stays forbidden)",
    transform: r => ({
      ...r,
      relationships: (r.relationships ?? []).filter((x: any) => !(x.type === "calls" && ((x.source === "w24-letfn-name" && x.target === "w24-letfn-name-live") || (x.source === "f" && x.target === "w24-letfn-param-live") || (x.source === "w24-letfn-after" && x.target === "w24-letfn-after-live")))),
    }),
  },
  {
    id: "clojure/refer-target-unresolved",
    language: "clojure",
    defectClass: "identity-corruption",
    description: "W24-mr2 regression (fixture refer-forms): `:refer` names stop resolving — call targets keep the bare dangling identity (U1-class) and the fixture's qualified expects go missing; locals-wins shapes stay bare either way",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !(x.type === "calls" && ["clj.fixture.util/rewrite-text", "clj.fixture.more/combine-sets", "clj.fixture.util/join-all"].includes(x.target))) }),
  },
  {
    id: "clojure/meta-private-ignored",
    language: "clojure",
    defectClass: "metadata-integrity",
    description: "W24-mr3 regression (fixture meta-visibility): `^{:private true}` / `^:private` stop counting as private — meta-private vars and fns export as public API again",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => (["secret", "hidden", "flagged"].includes(s.name) ? { ...s, visibility: "public" } : s)) }),
  },
  {
    id: "clojure/defmethod-docstring-name",
    language: "clojure",
    defectClass: "symbol-identity-corruption",
    description: "W24-mr4 regression (fixture defmethod-forms): the Clojure 1.12 defmethod docstring form names the symbol after the docstring text instead of the multifn",
    transform: r => ({ ...r, symbols: [...(r.symbols ?? []), { name: "Docstring for the circle impl.", kind: "function", scope: "clj.fixture.defmethodforms", ownerName: "clj.fixture.defmethodforms", visibility: "public" }] }),
  },
  {
    id: "clojure/complexity-policy-dropped",
    language: "clojure",
    defectClass: "metadata-integrity",
    description: "CC1-c regression (fixture complexity-forms): the ten CC1-c additions stop counting — the not/some conditionals, condp, while and the conditional threaders fall back to the undecided baseline (per-symbol pins read 1, file total falls back to 8)",
    transform: r => ({
      ...r,
      symbols: (r.symbols ?? []).map((s: any) => (["f-if-not","f-when-not","f-if-some","f-when-some","f-condp","f-while","f-cond->","f-cond->>","f-some->","f-some->>"].includes(s.name) ? { ...s, complexity: 1, metadata: { ...(s.metadata || {}), complexity: 1 } } : s)),
      metadata: { ...(r.metadata || {}), cyclomaticComplexity: 8 },
    }),
  },
  {
    id: "clojure/symbol-complexity-stripped",
    language: "clojure",
    defectClass: "metadata-integrity",
    description: "CC1-f regression (fixture complexity-forms): per-symbol complexity exposure disappears — functions carry no `.complexity` again (the elixir-parity write-out is dropped), per-symbol pins read undefined",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => { const c = { ...s }; delete c.complexity; return c }) }),
  },
  {
    id: "elixir/guard-call-emitted",
    language: "elixir",
    defectClass: "relationship-fabrication",
    description: "CC1-b regression (fixture guard-skips): the `when` guard subtree starts walking — a guard call (is_integer) leaks as a calls edge the fixture forbids",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { type: "calls", source: "guarded", target: "is_integer", confidence: 0.8, metadata: { elixirSpecific: true } }] }),
  },
  {
    id: "elixir/use-option-call-dropped",
    language: "elixir",
    defectClass: "relationship-loss",
    description: "CC1-d regression (fixture use-option-source): the compile-time call inside `use ... opt:` stops being sourced at the module — the pinned edge disappears",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !(String(x.type ?? x.relationshipType) === "calls" && x.target === "helper_fn")) }),
  },
  {
    id: "elixir/struct-update-dropped",
    language: "elixir",
    defectClass: "relationship-loss",
    description: "CC1-e regression (fixture struct-update): `%S{base | …}` stops emitting instantiates (only the literal form constructs) — the pinned edge disappears",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !(String(x.type ?? x.relationshipType) === "instantiates" && String(x.target).includes("Point"))) }),
  },
  {
    id: "clojure/meta-values-walked",
    language: "clojure",
    defectClass: "relationship-fabrication",
    description: "CLJ-ADV F5: metadata values walked as code — `^{:doc (meta-fn)}` fabricates a call (CLJ-D5 says metadata is never executable) — meta-value forbids catch it",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { type: "calls", source: "f", target: "meta-fn", confidence: 0.9, metadata: { clojureSpecific: true, isGeneralCall: true } }] }),
  },
  {
    id: "clojure/dotdot-uses-dot",
    language: "clojure",
    defectClass: "relationship-fabrication",
    description: "CLJ-ADV F6: `(.. x (m1))` emits `uses -> \".\"` (the slice of the `..` head) — the uses label has no oracle truth for clojure, so only the dotdot fixture can see it",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { type: "uses", source: "j", target: ".", confidence: 0.7, metadata: { clojureSpecific: true, isFieldAccess: true } }] }),
  },
  {
    id: "clojure/case-constants-walked",
    language: "clojure",
    defectClass: "relationship-fabrication",
    description: "CLJ-ADV F7: `(case k (a b) …)` — the constant-group LIST walked as a call (the fabricated `calls a`) — case-constants forbids catch it",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { type: "calls", source: "f", target: "a", confidence: 0.9, metadata: { clojureSpecific: true, isGeneralCall: true } }] }),
  },
  {
    id: "clojure/letfn-definition-call",
    language: "clojure",
    defectClass: "relationship-fabrication",
    description: "CLJ-ADV F8: a letfn binding-vector list read as an invocation — `outer -> f` with the DEFINITION's arity (2) — letfn forbids catch the definition-shaped edge",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { type: "calls", source: "outer", target: "f", confidence: 0.9, metadata: { clojureSpecific: true, isGeneralCall: true, callArity: 2 } }] }),
  },
  {
    id: "clojure/definterface-call",
    language: "clojure",
    defectClass: "relationship-fabrication",
    description: "CLJ-ADV F9: `definterface` and its signature lists fall to the generic-call branch (`calls definterface`, `calls size`) — definterface forbids catch it",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { type: "calls", source: "clj.fixture.iface", target: "definterface", confidence: 0.9, metadata: { clojureSpecific: true, isGeneralCall: true, isTopLevel: true } }] }),
  },
  {
    id: "clojure/qualified-quote-walked",
    language: "clojure",
    defectClass: "relationship-fabrication",
    description: "CLJ-ADV F10: `clojure.core/quote` / aliased `c/comment` fall through the spelling-bound data-form skip — quoted bodies walked as code (fab1-fab3 fabrications)",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { type: "calls", source: "f", target: "fab1", confidence: 0.9, metadata: { clojureSpecific: true, isGeneralCall: true } }] }),
  },
  {
    id: "clojure/doc-trailing-attached",
    language: "clojure",
    defectClass: "doc-channel",
    description: "CLJ-ADV F11: the doc channel attaches a trailing comment of the previous form (or a blank-line-separated header, or a single-`;` note) — doc-blocks notContains pins catch it",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map(s => (s.name === "b" ? { ...s, comments: ["trailing on a"], docstring: "trailing on a" } : s)) }),
  },
  {
    id: "clojure/cljc-alias-dropped",
    language: "clojure",
    defectClass: "relationship-loss",
    description: "CLJ-ADV F12: cljc alias forms dropped (read-cond requires, require-macros, :as-alias never register) — `s/join` stays unresolved — cljc-aliases forbids catch it",
    transform: r => ({
      ...r,
      relationships: (r.relationships ?? [])
        .filter(x => !(x.type === "calls" && x.target === "clojure.string/join"))
        .concat([{ type: "calls", source: "f", target: "s/join", confidence: 0.9, metadata: { clojureSpecific: true, isGeneralCall: true } }]),
    }),
  },
  {
    id: "clojure/threading-step-dropped",
    language: "clojure",
    defectClass: "relationship-loss",
    description: "CLJ-ADV F13: the `->>` step is eaten by the ctor branch (`startsWith(\"->\")`) — the threaded fltr call is dropped and only the written arity survives — threading pins catch it",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(x.type === "calls" && x.source === "g" && x.target === "fltr")) }),
  },
  {
    id: "clojure/ctor-qualified-dropped",
    language: "clojure",
    defectClass: "relationship-loss",
    description: "CLJ-ADV F14: qualified/multi-segment ctor names rejected (the old first-char-capital test) — `->probe.recs.Rec` emits nothing — ctors pins catch it",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(x.type === "instantiates" && x.source === "a" && x.target === "probe.recs.Rec")) }),
  },
  {
    id: "clojure/prefix-paren-unresolved",
    language: "clojure",
    defectClass: "relationship-loss",
    description: "CLJ-ADV F15: paren prefix-lists unresolved — nested alias never registers, `(a/one)` stays raw `a/one` — prefix-paren pins catch both halves",
    transform: r => ({
      ...r,
      relationships: (r.relationships ?? [])
        .filter(x => !(x.type === "calls" && x.source === "go" && x.target === "clj.fixture.prefix.alpha/one"))
        .concat([{ type: "calls", source: "go", target: "a/one", confidence: 0.9, metadata: { clojureSpecific: true, isGeneralCall: true } }]),
    }),
  },
  {
    id: "clojure/record-doc-fields",
    language: "clojure",
    defectClass: "symbol-loss",
    description: "CLJ-ADV F16: a defrecord docstring hides the fields vector (read at fixed namedChild(2)) — the x/y property symbols vanish — record-doc pins catch it",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).filter(s => !(s.kind === "property" && (s.name === "x" || s.name === "y"))) }),
  },
  {
    id: "elixir/quote-attr-leak",
    language: "elixir",
    defectClass: "relationship-fabrication",
    description: "ELX-ADV X1: quoted attributes leak — `@behaviour`/`@type` inside a `quote` block emit implements + a Type symbol (EX-D1 violation; measured on elixir's own Application/Protocol modules)",
    transform: r => ({
      ...r,
      symbols: [...(r.symbols ?? []), { name: "t", kind: "type", scope: "EQ", ownerName: "EQ", visibility: "public", metadata: { elixirSpecific: true, isTypeSpec: true } }],
      relationships: [...(r.relationships ?? []), { type: "implements", source: "EQ", target: "SomeB", confidence: 0.9, metadata: {} }],
    }),
  },
  {
    id: "elixir/pattern-struct-instantiate",
    language: "elixir",
    defectClass: "relationship-fabrication",
    description: "ELX-ADV X2: struct literals in pattern positions emit instantiates (case/fn clause patterns, `=`/`<-` LHS) — 43+16 live corpus sites fabricated before the pattern guard",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { type: "instantiates", source: "EP.run/1", target: "Ping", line_number: 7, confidence: 0.9, metadata: { elixirSpecific: true, isStruct: true } }] }),
  },
  {
    id: "elixir/chained-target-kept",
    language: "elixir",
    defectClass: "identity-corruption",
    description: "ELX-ADV X4: chained-receiver call targets keep call syntax (`Mix.shell().error`) — an identity matching no symbol (148+91 corpus edges)",
    transform: r => ({
      ...r,
      relationships: (r.relationships ?? [])
        .filter(x => !(x.type === "calls" && x.source === "EC.run/0" && x.target === "error"))
        .concat([{ type: "calls", source: "EC.run/0", target: "Mix.shell().error", confidence: 0.8, metadata: { elixirSpecific: true } }]),
    }),
  },
  {
    id: "elixir/kernel-qualified-call",
    language: "elixir",
    defectClass: "relationship-fabrication",
    description: "ELX-ADV X9: `Kernel.`-qualified builtins emit calls (49 corpus sites) while bare Kernel names are excluded by EX-D2",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { type: "calls", source: "EK.run/1", target: "Kernel.length", confidence: 0.8, metadata: { elixirSpecific: true } }] }),
  },
  {
    id: "elixir/pipe-arity-raw",
    language: "elixir",
    defectClass: "metadata-integrity",
    description: "ELX-ADV X6: pipe steps report the WRITTEN arity — `x |> f(1)` states f/1 while invoking f/2 (thread-adjusted arity is the fix)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map(x => (x.type === "calls" && x.source === "EPipe.run/1" && x.target === "f" ? { ...x, metadata: { ...(x.metadata ?? {}), callArity: 1 } } : x)) }),
  },
  {
    id: "elixir/module-literal-target",
    language: "elixir",
    defectClass: "identity-corruption",
    description: "ELX-ADV X5: `__MODULE__.fun` emitted literally (matches no symbol — 5+8 corpus sites)",
    transform: r => ({
      ...r,
      relationships: (r.relationships ?? [])
        .filter(x => !(x.type === "calls" && x.source === "ESelf.run/1" && x.target === "ESelf.raise"))
        .concat([{ type: "calls", source: "ESelf.run/1", target: "__MODULE__.raise", confidence: 0.8, metadata: { elixirSpecific: true } }]),
    }),
  },
  {
    id: "elixir/defdelegate-dropped",
    language: "elixir",
    defectClass: "relationship-loss",
    description: "ELX-ADV X8: defdelegate emits no link to its delegated target (71+12 corpus definitions silent)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(x.type === "calls" && (x.source === "ED.fetch/1" || x.source === "ED.get/1"))) }),
  },
  {
    id: "elixir/unquote-dropped",
    language: "elixir",
    defectClass: "relationship-loss",
    description: "ELX-ADV X7: unquote arguments treated as data — the expansion-time call is dropped (26+7 corpus sites)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(x.type === "calls" && x.source === "EU.m/0" && x.target === "compute")) }),
  },
  {
    id: "elixir/derive-list-dropped",
    language: "elixir",
    defectClass: "relationship-loss",
    description: "ELX-ADV X10: `@derive [A, B]` list forms emit nothing (the oracle mirror gap measured 3 UNEXPLAINED on the synthetic case)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(x.type === "implements" && (x.source === "ED1" || x.source === "ED2"))) }),
  },
  {
    id: "elixir/alias-member-line",
    language: "elixir",
    defectClass: "line-attribution",
    description: "ELX-ADV X12: every member of a multi-line alias list pinned to the prefix line instead of its own",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map(x => (x.type === "references" && x.source === "EA" && x.target === "Foo.Beta" ? { ...x, line_number: 2 } : x)) }),
  },
  {
    id: "elixir/same-line-arity-collapse",
    language: "elixir",
    defectClass: "relationship-loss",
    description: "ELX-ADV X13: arity outside the dedupe key — `{f(1), f(2, 3)}` collapses to one edge, losing f/2 (the name+arity contract says both survive)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(x.type === "calls" && x.source === "ES.run/0" && x.target === "f" && x.metadata?.callArity === 2)) }),
  },
  {
    id: "elixir/proto-complexity-inflated",
    language: "elixir",
    defectClass: "metric-corruption",
    description: "ELX-ADV X11: plain-{} complexityNodes answers `[\"toString\"]` from Object.prototype — the call site inflates complexity (the Clojure F5-2 class on the elixir record)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map(s => (s.name === "run" && s.ownerName === "EPC" ? { ...s, complexity: 2 } : s)) }),
  },
  {
    id: "elixir/drop-atom-struct-fields",
    language: "elixir",
    defectClass: "symbol-loss",
    description: "ELXD2: atom-list struct fields disappear while keyword fields remain",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).filter(s => !(s.metadata?.isStructField && ["id", "name", "email", "file"].includes(s.name))) }),
  },
  {
    id: "elixir/implied-alias-entry-time",
    language: "elixir",
    defectClass: "identity-corruption",
    description: "EX-L5 regression (found by the F5 elixir lane as the MISSING edge `Registry.Supervisor -> Supervisor`): the defmodule-implied last-segment alias registers at ENTRY — inside-body `use Supervisor` self-resolves and the self-directive guard drops the edge, and inside-body `%Inner{}` self-resolves",
    transform: r => ({
      ...r,
      relationships: (r.relationships ?? [])
        .filter(x => !(x.type === "references" && x.source === "Collide.Supervisor" && x.target === "Supervisor"))
        .map(x => (x.type === "instantiates" && x.source === "Collide.Inner.make/0" && x.target === "Inner") ? { ...x, target: "Collide.Inner" } : x),
    }),
  },
  {
    id: "elixir/defimpl-list-garbage",
    language: "elixir",
    defectClass: "relationship-fabrication",
    description: "W23 regression (fixture defimpl-target-forms): multi-type `for: [A, B]` reverts to the raw list text as one garbage impl target (\"[Integer, Float]\") instead of one Implements edge per type",
    transform: r => ({
      ...r,
      relationships: [
        ...(r.relationships ?? []).filter(x => !(x.type === "implements" && (x.source === "Integer" || x.source === "Float") && x.target === "W23Multi")),
        { type: "implements", source: "[Integer, Float]", target: "W23Multi", confidence: 1, metadata: { elixirSpecific: true } },
      ],
    }),
  },
  {
    id: "elixir/behaviour-atom-colon",
    language: "elixir",
    defectClass: "relationship-fabrication",
    description: "W23 regression (fixture behaviour-atom): the @behaviour atom form re-emits the leading colon as part of the target (`:gen_server`) instead of the behaviour name",
    transform: r => ({
      ...r,
      relationships: [
        ...(r.relationships ?? []).filter(x => !(x.type === "implements" && x.target === "gen_server")),
        { type: "implements", source: "W23BehaviourAtom", target: ":gen_server", confidence: 0.9, metadata: { elixirSpecific: true } },
      ],
    }),
  },
  {
    id: "elixir/alias-scope-flat-registry",
    language: "elixir",
    defectClass: "relationship-fabrication",
    description: "W23-E1 regression (fixture implied-alias-scope): alias scoping reverts to a flat file-global registry — Leak.Source's `alias Deep.Bar` leaks into later sibling Leak.After (%Bar{} -> Deep.Bar) and Nest.Outer's implied `Sup` escapes to the file root (Nest.After %Sup{} -> Nest.Outer.Sup); both fixture-forbidden",
    transform: r => ({
      ...r,
      relationships: [
        ...(r.relationships ?? []).filter(x => !(x.type === "instantiates" && ((x.source === "Leak.After.make/0" && x.target === "Bar") || (x.source === "Nest.After.make/0" && x.target === "Sup")))),
        { type: "instantiates", source: "Leak.After.make/0", target: "Deep.Bar", confidence: 0.9, metadata: { elixirSpecific: true, isStruct: true } },
        { type: "instantiates", source: "Nest.After.make/0", target: "Nest.Outer.Sup", confidence: 0.9, metadata: { elixirSpecific: true, isStruct: true } },
      ],
    }),
  },
  {
    id: "elixir/scope-arity-collapsed",
    language: "elixir",
    defectClass: "identity-corruption",
    description: "W24 #17 regression (fixture scope-arity): the function scope name drops the arity again — `Mod.fn/1` and `Mod.fn/2` bodies merge under the pre-fix collision identity `Mod.fn` (review E7); the fixture's three bare-form forbids catch the revert",
    transform: r => ({
      ...r,
      relationships: (r.relationships ?? [])
        .filter(x => !(x.type === "calls" && ((x.source === "ScopeArity.call_one/1" && x.target === "one_hop") || (x.source === "ScopeArity.call_two/2" && x.target === "two_hop") || (x.source === "ScopeDeleg.fetch/1" && x.target === "Store.fetch"))))
        .concat([
          { type: "calls", source: "ScopeArity.call_one", target: "one_hop", confidence: 0.8, metadata: { elixirSpecific: true } },
          { type: "calls", source: "ScopeArity.call_two", target: "two_hop", confidence: 0.8, metadata: { elixirSpecific: true } },
          { type: "calls", source: "ScopeDeleg.fetch", target: "Store.fetch", confidence: 0.9, metadata: { elixirSpecific: true, isDelegate: true } },
        ]),
    }),
  },
  {
    id: "elixir/export-owned-struct",
    language: "elixir",
    defectClass: "export-duplication",
    description: "ELXD3: an owned struct is exported again under its module name",
    transform: r => ({ ...r, exports: [...(r.exports ?? []), ...(r.symbols ?? []).filter(s => s.kind === "struct" && s.ownerName === s.name).map(s => ({ name: s.name, kind: s.kind, range: s.range, visibility: s.visibility }))] }),
  },
  {
    id: "elixir/emit-defhead-struct",
    language: "elixir",
    defectClass: "symbol-fabrication",
    description: "ELXD4: a defstruct-shaped declaration head emits a phantom struct (defmacro defstruct head)",
    transform: r => ({ ...r, symbols: [...(r.symbols ?? []), { name: "defstruct", kind: "struct", scope: "defstruct", ownerName: "defstruct", visibility: "public" }], relationships: [...(r.relationships ?? []), { type: "contains", source: "defstruct", target: "defstruct", confidence: 1, metadata: {} }] }),
  },
  {
    id: "elixir/delegate-remote-name-as-local",
    language: "elixir",
    defectClass: "symbol-identity-corruption",
    description: "ELXD1: substitutes the remote delegate target for the declared local function name",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map(s => s.name === "local_name" && s.ownerName === "DelegateIdentity" ? { ...s, name: "remote_name" } : s) }),
  },
  {
    id: "elixir/delegate-local-call-drop",
    language: "elixir",
    defectClass: "relationship-loss",
    description: "ELXD1: drops calls to the locally declared delegate after incorrect declaration-set resolution",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(String(x.type) === "calls" && x.target === "local_name")) }),
  },
  {
    id: "elixir/delegate-remote-head-merge",
    language: "elixir",
    defectClass: "symbol-identity-corruption",
    description: "ELXD1: merges a delegate with a distinct same-arity function named like its remote target",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map(s => s.name === "trim_trailing" && s.ownerName === "DelegateCollision" ? { ...s, metadata: { ...s.metadata, heads: 2 } } : s) }),
  },
  {
    id: "elixir/drop-quoted-struct-fields",
    language: "elixir",
    defectClass: "symbol-loss",
    description: "EX-G1: quoted-key struct fields disappear while keyword fields remain",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).filter(s => !(s.metadata?.isStructField && ["alpha", "gamma"].includes(s.name))) }),
  },
  {
    id: "elixir/defimpl-single-arg-self-target",
    language: "elixir",
    defectClass: "symbol-loss",
    description: "ELXD6: single-argument defimpl methods mis-owned by the protocol instead of the enclosing module",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).filter(s => !(s.name === "to_string" && s.ownerName === "SingleArgImpl")), relationships: (r.relationships ?? []).filter(x => !(String(x.type) === "implements" && x.target === "String.Chars")) }),
  },
  {
    id: "elixir/emit-defimpl-macro-head",
    language: "elixir",
    defectClass: "symbol-fabrication",
    description: "ELXD7: a defimpl-shaped declaration head emits a phantom implementation (defmacro defimpl head)",
    transform: r => ({ ...r, symbols: [...(r.symbols ?? []), { name: "Unknown", kind: "class", scope: "", visibility: "public" }], relationships: [...(r.relationships ?? []), { type: "implements", source: "Unknown", target: "Unknown", confidence: 1, metadata: {} }] }),
  },
  {
    id: "elixir/emit-self-reference",
    language: "elixir",
    defectClass: "relationship-fabrication",
    description: "ELXD8: a self-directive emits a vacuous self-loop dependency (alias SelfAlias inside defmodule SelfAlias)",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { type: "references", source: "SelfAlias", target: "SelfAlias", confidence: 0.9, metadata: {} }] }),
  },
  {
    id: "elixir/drop-framework-detection",
    language: "elixir",
    defectClass: "payload-loss",
    description: "ELXD9 regression: empties detectedFrameworks (framework truth is differential-invisible — deriveElixirEdges derives no framework truth, so ONLY the fixture can catch it; go wave GOD7 learned this exact lesson) — framework-forms expectFrameworks [Plug, Phoenix, Ecto] pin catches it",
    transform: r => ({ ...r, metadata: { ...(r.metadata ?? {}), detectedFrameworks: [] } }),
  },
  {
    id: "elixir/drop-defexception-struct",
    language: "elixir",
    defectClass: "symbol-loss",
    description: "ELXD10: defexception struct and fields disappear while defstruct forms remain",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).filter(s => !(s.ownerName === "TaskError" && (s.kind === "struct" || s.metadata?.isStructField))) }),
  },
  {
    id: "elixir/drop-derive-implements",
    language: "elixir",
    defectClass: "relationship-loss",
    description: "ELXD11: @derive protocol edges disappear while @behaviour/defimpl edges remain",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(String(x.type) === "implements" && x.target === "JSON.Encoder")) }),
  },
  {
    id: "elixir/drop-self-struct-instantiates",
    language: "elixir",
    defectClass: "relationship-loss",
    description: "ELXD12: %__MODULE__{} self-construction edges disappear while alias-backed instantiations remain",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(String(x.type) === "instantiates" && (x.target === "SelfStruct" || String(x.target).endsWith(".Inner")))) }),
  },
  {
    id: "elixir/emit-self-instantiates",
    language: "elixir",
    defectClass: "relationship-fabrication",
    description: "ELXD13: module-body self-construction emits a vacuous self-loop edge (%__MODULE__{} in SelfTestScope's own body)",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { type: "instantiates", source: "SelfTestScope", target: "SelfTestScope", confidence: 0.9, metadata: {} }] }),
  },
  {
    id: "elixir/drop-doc-comments",
    language: "elixir",
    defectClass: "payload-loss",
    description: "ELXD14 regression: strips documentation chunks from all symbols (comments payload is differential-invisible, so ONLY the fixture can catch it) — doc-forms expectComments pins catch it",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map(s => ({ ...s, comments: undefined })) }),
  },
  {
    id: "elixir/drop-symbol-complexity",
    language: "elixir",
    defectClass: "payload-loss",
    description: "ELXD15 regression: clears per-symbol complexity (differential-invisible payload — ONLY the fixture can catch it) — complexity-forms expectComplexity pins catch it",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map(s => ({ ...s, complexity: undefined })) }),
  },
  {
    id: "elixir/emit-kernel-builtin-call",
    language: "elixir",
    defectClass: "relationship-fabrication",
    description: "ELXD16: an always-available Kernel builtin emits a call edge as if it were a local invocation (match?/tap class)",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { type: "calls", source: "check", target: "match?", confidence: 0.8, metadata: {} }] }),
  },
  {
    id: "elixir/drop-import-only-resolution",
    language: "elixir",
    defectClass: "relationship-loss",
    description: "ELXD17: :only-imported calls lose their module qualification (last-wins order included)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(String(x.type) === "calls" && (x.target === "Enum.map" || x.target === "Beta.go"))) }),
  },
  {
    id: "elixir/drop-remote-ref-calls",
    language: "elixir",
    defectClass: "relationship-loss",
    description: "ELXD18: bare remote references (&Mod.fun/2, Mod.fun) disappear while member access stays silent",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(String(x.type) === "calls" && (x.target === "Enum.map" || x.target === "Enum.reverse"))) }),
  },
  {
    id: "elixir/emit-member-access-call",
    language: "elixir",
    defectClass: "relationship-fabrication",
    description: "ELXD18: a variable field read emits a call edge as if it were an invocation (order.side). EX2 note: the fabrication now carries the module-qualified source (RefForms.read) — bare sources no longer exist on any edge, and the fixture's forbidRelationships targets the qualified form; the pre-EX2 bare-source spelling survived the suite undetected until the EX2 mutant run.",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { type: "calls", source: "RefForms.read", target: "order.side", confidence: 0.8, metadata: {} }] }),
  },
  {
    id: "elixir/drop-struct-fn-instantiates",
    language: "elixir",
    defectClass: "relationship-loss",
    description: "ELXD19: struct/2 first-argument construction edges disappear while %Struct{} literals remain",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(String(x.type) === "instantiates" && (x.target === "User" || x.target === "StructFn"))) }),
  },
  {
    id: "elixir/drop-multi-alias-expansion",
    language: "elixir",
    defectClass: "relationship-loss",
    description: "ELXD20: multi-alias members collapse back to the bare prefix (references + resolved calls lost)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !((String(x.type) === "references" || String(x.type) === "calls") && String(x.target).startsWith("Foo.Bar"))) }),
  },
  {
    id: "elixir/emit-nested-head-def",
    language: "elixir",
    defectClass: "symbol-fabrication",
    description: "ELXD23: an inner def-construct signature emits a phantom definition (defmacro def head fabricates function sig)",
    transform: r => ({ ...r, symbols: [...(r.symbols ?? []), { name: "sig", kind: "function", scope: "HeadNest", ownerName: "HeadNest", visibility: "public" }] }),
  },
  {
    id: "elixir/drop-operator-defs",
    language: "elixir",
    defectClass: "symbol-loss",
    description: "ELXD24: operator definitions disappear (binary +++ and unary + forms)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).filter(s => !(s.kind === "function" && (s.name === "+++" || s.name === "+"))) }),
  },
  {
    id: "elixir/emit-quoted-def",
    language: "elixir",
    defectClass: "symbol-fabrication",
    description: "quote-as-data regression: a def inside quote do...end fabricates a module symbol (the M12.23 contract — macro AST is data, never executable code)",
    transform: r => ({ ...r, symbols: [...(r.symbols ?? []), { name: "injected", kind: "function", scope: "QuotedData", ownerName: "QuotedData", visibility: "public" }] }),
  },
  {
    id: "elixir/drop-self-alias-resolution",
    language: "elixir",
    defectClass: "relationship-loss",
    description: "ELXD21: __MODULE__-prefixed aliases lose scope resolution (references + resolved calls revert to literals)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(String(x.target).startsWith("SelfAliasMod."))) }),
  },
  {
    id: "c/drop-field-access-uses",
    language: "c",
    defectClass: "relationship-loss",
    description: "drops C field-access Uses edges",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => (x.metadata ?? {}).relationshipType !== "field_access") }),
  },
  {
    id: "c/drop-include-references",
    language: "c",
    defectClass: "relationship-loss",
    description: "drops C include dependency edges (the first-class imports kind, M60/#910)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => (x.metadata ?? {}).relationshipType !== "include_dependency") }),
  },
  {
    id: "c/include-kind-downgraded",
    language: "c",
    defectClass: "relationship-ontology",
    description: "M60/#910 regression: downgrades the include edge from the first-class `imports` kind back to the old `references` + metadata shape — the asymmetry every harness was blind to while the LSP file-level reader filters relationship_type IN ('imports','exports')",
    transform: r => ({
      ...r,
      relationships: (r.relationships ?? []).map(x =>
        (x.metadata ?? {}).relationshipType === "include_dependency" ? { ...x, type: "references" } : x,
      ),
    }),
  },
  {
    id: "c/function-like-macro-bound-as-local",
    language: "c",
    defectClass: "relationship-loss",
    description: "#908 regression: re-injects the false LOCAL BINDING — a declaration whose DECLARATOR is a function_declarator named after a function-like macro (`YYSTYPE yylval YY_INITIAL_VALUE (= yyval_default);`, jq src/parser.c L2230) puts the macro name into the enclosing function's locals, so every later mention of the macro in that function is suppressed as a shadowed read. Re-injected as the row the defect suppresses, because a suppressed row is by definition absent from the output it would have polluted: `uses c908_after -> YY_INITIAL_VALUE` (that function's misparsed declaration L45 precedes its use L46). Caught by c/function-like-macro-not-a-binding-908's expectRelationships. Note the corpus lane CANNOT see this class — jq's parser.c happens to walk the use (L2229) before the declaration (L2230), so the row survives the defect; the fixture's reversed order is what makes it observable.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).filter(
        (x: any) => !(x.type === "uses" && x.source === "c908_after" && x.target === "YY_INITIAL_VALUE"),
      ),
    }),
  },
  {
    id: "c/drop-complexity",
    language: "c",
    defectClass: "payload-loss",
    description: "removes C cyclomatic complexity from function symbols",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map(s => ({ ...s, complexity: undefined })) }),
  },
  {
    id: "c/emit-write-as-read",
    language: "c",
    defectClass: "relationship-fabrication",
    description: "SCD1 regression: removes the field_expression assignment-LHS write gate — re-injects the pre-fix edge probe-verified on q->value = v / q->value += 1 (set_value->value uses) — c set_value forbid catches it",
    transform: r => ({
      ...r,
      relationships: [...(r.relationships ?? []), {
        type: "uses", source: "set_value", target: "value", isExternal: true, weight: 1, confidence: 0.9, metadata: { relationshipType: "field_access", accessedFrom: "q" },
      }],
    }),
  },
  {
    id: "c/cgd31-callee-field-leaf-uses",
    language: "c",
    defectClass: "relationship-duplication",
    description: "CGD31 regression: re-emits the redundant `uses` for a field_identifier LEAF under a callee field_expression (method-table call) — the calls edge already carries it; cgd31-37 fixture forbids read_kv->read_impl uses",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { type: "uses", source: "read_kv", target: "read_impl", confidence: 1, metadata: { relationshipType: "identifier_usage" } }] }),
  },
  {
    id: "c/cgd33-type-only-uses",
    language: "c",
    defectClass: "relationship-fabrication",
    description: "CGD33/34 regression: re-emits `uses Mem3Like` for the macro-qualified struct's phantom function_definition name (SQLITE_WSD shape) — a plain identifier resolving ONLY as a type cannot be a value read; cgd31-37 fixture forbids it",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { type: "uses", source: "touch_mem3", target: "Mem3Like", confidence: 1, metadata: { relationshipType: "identifier_usage", nodeType: "identifier" } }] }),
  },
  {
    id: "c/cgd37-designator-name-uses",
    language: "c",
    defectClass: "relationship-fabrication",
    description: "CGD37 regression: re-emits `uses read_impl` for the `.read_impl = kvrecordRead` designated-initializer NAME (a write target, not a read); cgd31-37 fixture forbids global->read_impl uses",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { type: "uses", source: "global", target: "read_impl", confidence: 1, metadata: { relationshipType: "identifier_usage", nodeType: "field_identifier" } }] }),
  },
  {
    id: "c/cgd35-drop-typedef-references",
    language: "c",
    defectClass: "relationship-loss",
    description: "CGD35 regression: drops `references` edges to typedef aliases over builtin bases (i64/u8 — showwal.c shape) by restoring the type_identifier-is-declaring suppression; cgd31-37 fixture expects references i64 and u8",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(String(x.type) === "references" && (x.target === "i64" || x.target === "u8"))) }),
  },
  {
    id: "c/cgd36-drop-fn-value-before-def",
    language: "c",
    defectClass: "relationship-loss",
    description: "CGD36 regression: drops order-independent `uses` for a function read as a VALUE before its definition (later_defined read in use_later and the CALLBACKS table); cgd31-37 fixture expects uses later_defined",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(String(x.type) === "uses" && x.target === "later_defined")) }),
  },
  {
    id: "c/macro-include-fabrication",
    language: "c",
    defectClass: "relationship-fabrication",
    description: "W22 regression: re-fabricates an include_dependency edge for a MACRO-COMPOSED include argument (#include INC__STRINGIFY(SQLITE_C), sqlite3-wasm.c shape) — not a statically resolvable header name (C-D2); the macro-composed-include fixture forbids it (in the first-class `imports` kind, M60/#910)",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { type: "imports", source: "global", target: "INC__STRINGIFY(SQLITE_C)", confidence: 1, metadata: { relationshipType: "include_dependency", isSystem: false, isImport: true } }] }),
  },
  {
    id: "c/cgd38-phantom-function-symbol",
    language: "c",
    defectClass: "symbol-fabrication",
    description: "CGD38 regression: re-adds the phantom Function symbol Mem3Like fabricated from the SQLITE_WSD-style macro-qualified struct recovery (bare-identifier declarator treated as a callable); cgd31-37 fixture forbids the symbol",
    transform: r => ({ ...r, symbols: [...(r.symbols ?? []), { name: "Mem3Like", kind: "function", scope: "global", visibility: "public" }] }),
  },
  {
    id: "cpp/drop-virtual-overrides",
    language: "cpp",
    defectClass: "relationship-loss",
    description: "drops C++ virtual override edges (isVirtualOverride)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(x.metadata ?? {}).isVirtualOverride) }),
  },
  {
    id: "cpp/drop-extends-edges",
    language: "cpp",
    defectClass: "relationship-loss",
    description: "drops C++ class inheritance (extends) edges",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => x.type !== "extends") }),
  },
  {
    id: "cpp/drop-qualified-calls",
    language: "cpp",
    defectClass: "payload-loss",
    description: "removes C++ qualified_calls payloads from method symbols",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map(s => ({ ...s, qualified_calls: undefined })) }),
  },
  {
    id: "cpp/drop-global-scope-new",
    language: "cpp",
    defectClass: "relationship-loss",
    description: "CPPD8 regression: drops instantiates whose constructed type has a leading global-scope `::` (the pre-fix leaf extraction unwrapped only one qualified_identifier level, so `new ::std::stringstream` died on the clean-leaf regex while `new ::Foo` worked)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(x.type === "instantiates" && typeof x.toSymbol === "string" && x.toSymbol.startsWith("::"))) }),
  },
  {
    id: "cpp/ctor-calls-to-class-name",
    language: "cpp",
    defectClass: "payload-corruption",
    description: "CPPD9 regression: re-attributes constructor-body calls to the raw CLASS name (source=Engine) instead of the normalized constructor symbol, and moves the qc payload onto the class symbol — the pre-fix state where the call graph pointed at the Class and constructor.qualified_calls stayed empty",
    transform: r => ({
      ...r,
      relationships: (r.relationships ?? [])
        .filter(x => !(x.type === "calls" && x.source === "constructor" && (x.target === "start" || x.target === "warm")))
        .concat([
          { source: "Engine", target: "start", type: "calls", fromSymbol: "Engine", toSymbol: "start" },
          { source: "Engine", target: "warm", type: "calls", fromSymbol: "Engine", toSymbol: "warm" },
        ]),
      symbols: (r.symbols ?? []).map(s => s.name === "Engine" ? { ...s, qualified_calls: ["start", "warm"] } : s),
    }),
  },
  {
    id: "cpp/qc-cross-class-pollution",
    language: "cpp",
    defectClass: "payload-corruption",
    description: "CPPD10 regression: merges qualified_calls by bare method name so Alpha.run and Beta.run both carry [aFn, bFn] (the pre-fix post-loop name-keyed merge)",
    transform: r => ({
      ...r,
      symbols: (r.symbols ?? []).map(s => (s.name === "run" ? { ...s, qualified_calls: ["aFn", "bFn"] } : s)),
    }),
  },
  {
    id: "cpp/last-sig-wins-overrides",
    language: "cpp",
    defectClass: "relationship-loss",
    description: "CPPD11 regression: virtual registry keeps one signature per method name (last-declared wins), so an override of the FIRST-declared base overload f(int) is silently dropped when the base also declares f(double)",
    transform: r => ({
      ...r,
      relationships: (r.relationships ?? []).filter(x => !(x.type === "overrides" && (x as any).metadata?.reasonCode === "signature-match" && String(x.source).startsWith("Derived.f"))),
    }),
  },
  {
    id: "cpp/legacy-using-import-shape",
    language: "cpp",
    defectClass: "payload-corruption",
    description: "CPPD12 regression: converts using-declaration imports back to the legacy {source, imported} shape with no module — the pre-fix state where `using namespace std` / `using std::pair` were silently DROPPED by the persister (same class as the C #include fix)",
    transform: r => ({
      ...r,
      imports: (r.imports ?? [])
        .filter((i: any) => !((i.metadata ?? {}).isUsingDeclaration))
        .concat((r.imports ?? []).filter((i: any) => (i.metadata ?? {}).isUsingDeclaration).map((i: any) => ({ source: i.module, imported: [], isTypeOnly: false }))),
    }),
  },
  {
    id: "cpp/template-arg-call-targets",
    language: "cpp",
    defectClass: "payload-corruption",
    description: "CPPD13 regression: re-adds template arguments to call targets (`func<int>`, `apply<double>` — the pre-fix state where callee leaves leaked template args, 855 across fmt), and restores functor-temp/ptr-to-member junk callee text as targets",
    transform: r => ({
      ...r,
      relationships: (r.relationships ?? [])
        .filter(x => !(x.type === "calls" && (x.target === "func" || x.target === "apply")))
        .concat([
          { source: "drive", target: "func<int>", type: "calls", fromSymbol: "drive", toSymbol: "ns::func<int>" },
          { source: "drive", target: "apply<double>", type: "calls", fromSymbol: "drive", toSymbol: "g.apply<double>" },
        ]),
    }),
  },
  {
    id: "rust/drop-scoped-struct-literal-leaf",
    language: "rust",
    defectClass: "relationship-loss",
    description: "drops enum-variant struct-literal instantiates whose target is the variant leaf (MatchStrategy::Suffix -> Suffix): the pre-fix analyzer required a plain type_identifier and silently dropped scoped names",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !((x.metadata ?? {}).relationshipType === "struct_literal" && x.target === "Suffix") && !((x.metadata ?? {}).relationshipType === "struct_literal" && x.target === "Literal")) }),
  },
  {
    id: "rust/turbofish-whole-text-target",
    language: "rust",
    defectClass: "relationship-loss",
    description: "targets turbofish calls (x.parse::<u32>()) by whole base text instead of the callee leaf: restores the pre-fix bug where generic_function used baseNode.text",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map(x => (x.type === "calls" && x.target === "parse" ? { ...x, target: "cap.parse" } : x)) }),
  },
  {
    id: "rust/parenthesized-closure-callee",
    language: "rust",
    defectClass: "relationship-loss",
    description: "re-emits calls edges for parenthesized closure callees ((self.0)(n)): the pre-fix else branch took functionNode.text verbatim and fabricated a (self.0) target",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { source: "run", target: "(self.0)", type: "calls", confidence: 1, metadata: {} }] }),
  },
  {
    id: "rust/drop-union-symbols",
    language: "rust",
    defectClass: "symbol-loss",
    description: "drops union_item declaration sites (Pixel): the pre-fix analyzer had no union_item branch, so Rust unions emitted NO symbol",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).filter(s => !(s.name === "Pixel" && s.kind === "struct")) }),
  },
  {
    id: "rust/drop-trait-associated-types",
    language: "rust",
    defectClass: "symbol-loss",
    description: "drops trait-level associated_type symbols (Container.Item): the pre-fix analyzer only handled impl-level type_item, so trait bodies' `type Item;` were invisible",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).filter(s => !(s.name === "Item" && s.ownerName === "Container")) }),
  },
  {
    id: "rust/duplicate-awaited-call-edge",
    language: "rust",
    defectClass: "relationship-duplication",
    description: "re-emits the raw await edge in ADDITION to the canonical call edge (the pre-fix await_expression branch pushed a second calls edge with the full function text as target): one awaited call site must produce exactly ONE calls edge",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { source: "connect", target: "do_connect", type: "calls", confidence: 1, metadata: { rustSpecific: true, isAwait: true } }] }),
  },
  {
    id: "rust/raw-use-list-import",
    language: "rust",
    defectClass: "import-contract",
    description: "stores the whole use-declaration raw text as the import module (pre-fix: `use std::io::{Read, Write as W}` became module='std::io::{Read, Write as W}' with comma-split items): restores the family-contract violation",
    transform: r => ({ ...r, imports: (r.imports ?? []).map((i: any) => (i.module === "std::io" ? { ...i, module: "std::io::{Read, Write as W}", items: ["std::io::{Read", "Write as W}"] } : i)) }),
  },
  {
    id: "rust/merge-qc-by-bare-name",
    language: "rust",
    defectClass: "payload-pollution",
    description: "RSD1 regression: re-keys qualified_calls by BARE method name (the pre-fix qcByFunction map) so same-named methods across types share one union payload — qualified-calls-ownership fixture's per-owner notIncludes pins catch it (Alpha.run must not carry beta_only)",
    transform: r => {
      const byName = new Map<string, string[]>()
      for (const s of r.symbols ?? []) {
        if (!(s.kind === "function" || s.kind === "method") || !s.qualified_calls?.length) continue
        const cur = byName.get(s.name) ?? []
        byName.set(s.name, [...cur, ...s.qualified_calls])
      }
      return {
        ...r,
        symbols: (r.symbols ?? []).map((s: any) => {
          if ((s.kind === "function" || s.kind === "method") && byName.has(s.name)) {
            return { ...s, qualified_calls: [...new Set(byName.get(s.name)!)] }
          }
          return s
        }),
      }
    },
  },
  {
    id: "rust/wipe-qc-on-error-files",
    language: "rust",
    defectClass: "payload-loss",
    description: "RSD2 regression: clears every function's qualified_calls when the file contains ANY parse error (the pre-fix whole-file `!metadata.errors` guard) — error-file-payload fixture's clean_caller pin catches it",
    transform: r => (r.metadata?.errors?.length ? {
      ...r,
      symbols: (r.symbols ?? []).map((s: any) => {
        if (s.kind === "function" || s.kind === "method") return { ...s, qualified_calls: undefined }
        return s
      }),
    } : r),
  },
  {
    id: "rust/duplicate-impl-ids",
    language: "rust",
    defectClass: "symbol-identity",
    description: "RSD3 regression: strips the uniqueId '#N' suffix so `struct Alpha` and both `impl Alpha` blocks collapse to the SAME symbol id 'Alpha' (pre-fix state, 2,852 duplicate ids in the corpus) — qualified-calls-ownership fixture's expectUniqueIds + expectSymbols id pins catch it",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => ({ ...s, id: (s.id ?? "").replace(/#[0-9]+$/, "") })) }),
  },
  {
    id: "rust/drop-macro-payload",
    language: "rust",
    defectClass: "payload-loss",
    description: "RSD4 regression: strips macro: entries from qualified_calls (pre-fix: handleMacroInvocation never attached a payload, so format!()-only methods were invisible) — qualified-calls-ownership fixture's second/macro:format pin catches it",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => {
      if (!s.qualified_calls?.length) return s
      const qc = s.qualified_calls.filter((c: string) => !c.startsWith("macro:"))
      return qc.length === s.qualified_calls.length ? s : { ...s, qualified_calls: qc }
    }) }),
  },
  {
    id: "rust/reemit-write-field-uses",
    language: "rust",
    defectClass: "relationship-noise",
    description: "RSD5 regression: re-emits `uses` for assignment-LHS field WRITES (the pre-fix field_expression branch had no write-gate — 1,076 bogus uses across cargo+ripgrep; the oracle derives no uses truth so only fixtures catch it) — qualified-calls-ownership fixture's set_name/bump_count forbid pins catch it",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { source: "set_name", target: "name", type: "uses", confidence: 0.9, metadata: { relationshipType: "field_access", accessedFrom: "self" } }, { source: "bump_count", target: "count", type: "uses", confidence: 0.9, metadata: { relationshipType: "field_access", accessedFrom: "self" } }] }),
  },
  {
    id: "rust/drop-nested-group-import-items",
    language: "rust",
    defectClass: "import-loss",
    description: "RSD6a regression: drops nested-group leaves from import items (pre-fix `use std::{env, io, path::{Path, PathBuf}}` bound only env/io — Path/PathBuf silently lost, 65 declarations across cargo+ripgrep) — use-list-imports fixture's std-row pin catches it",
    transform: r => ({ ...r, imports: (r.imports ?? []).map((i: any) => (i.module === "std" ? { ...i, items: (i.items ?? []).filter((x: string) => x !== "Path" && x !== "PathBuf") } : i)) }),
  },
  {
    id: "rust/join-top-group-imports",
    language: "rust",
    defectClass: "import-contract",
    description: "RSD6b regression: collapses a top-level group import into ONE row whose module is the joined item names (pre-fix `use {std::sync::Arc, ...}` fabricated module 'Arc, Duration'; 28 declarations across cargo+ripgrep) — use-list-imports fixture's per-binding row pins catch it",
    transform: r => ({
      ...r,
      imports: [...(r.imports ?? []).filter((i: any) => i.module !== "std::sync::Arc" && i.module !== "std::time::Duration"), { module: "Arc, Duration", items: ["Arc", "Duration"], metadata: { rustSpecific: true, isPublic: false } }],
    }),
  },
  {
    id: "rust/drop-attr-framework-detection",
    language: "rust",
    defectClass: "framework-loss",
    description: "RSD7 regression: clears serde/tokio/thiserror/tracing/clap/axum/rocket from detectedFrameworks, keeping only actix route macros (pre-fix: handleAttribute caught only #[get]/#[post] — serde derives and tokio::main on a real file yielded detectedFrameworks=[]) — relationship-kinds fixture's expectFrameworks [serde, tokio] pins catch it",
    transform: r => {
      const fw: string[] = r.metadata?.detectedFrameworks ?? []
      const kept = fw.filter((f: string) => f === "actix_web")
      return { ...r, metadata: { ...(r.metadata ?? {}), detectedFrameworks: kept } }
    },
  },
  {
    id: "go/whole-text-stdlib-callee",
    language: "go",
    defectClass: "relationship-loss",
    description: "targets package-qualified stdlib calls by whole text instead of the leaf (fmt.Sprintf -> fmt.Sprintf target): restores the pre-fix buildGoCallExpression behavior the oracle flagged",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map(x => (x.type === "calls" && x.target === "Sprintf" ? { ...x, target: "fmt.Sprintf" } : x)) }),
  },
  {
    id: "go/drop-package-scope-call",
    language: "go",
    defectClass: "relationship-loss",
    description: "drops package-scope call edges (go_package_scope_call): the pre-fix analyzer never emitted NewShape() at package level",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => (x.metadata ?? {}).relationshipType !== "go_package_scope_call") }),
  },
  {
    id: "go/closure-var-goroutine-defer",
    language: "go",
    defectClass: "relationship-fabrication",
    description: "re-emits calls edges for anonymous func-literal goroutine/defer bodies (target 'anonymous_closure'): restores the pre-fix extractGoRoutineFunction/extractDeferredFunction behavior",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { source: "startWork", target: "anonymous_closure", type: "calls", confidence: 0.8, metadata: { relationshipType: "go_goroutine" } }, { source: "startWork", target: "anonymous_closure", type: "calls", confidence: 0.8, metadata: { relationshipType: "go_defer" } }] }),
  },
  {
    id: "go/type-conversion-as-call",
    language: "go",
    defectClass: "relationship-fabrication",
    description: "emits calls edges for builtin type-conversion expressions (float64(...)): the pre-fix oracle-mismatch class where bare builtin calls leaked as call truth",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { source: "startWork", target: "float64", type: "calls", confidence: 0.8, metadata: { relationshipType: "go_function_call", callExpression: "float64" } }] }),
  },
  {
    id: "go/drop-implements-edge",
    language: "go",
    defectClass: "relationship-loss",
    description: "drops implicit interface implements edges (go_interface_implementation): a regression that removes duck-typing satisfaction detection",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => (x.metadata ?? {}).relationshipType !== "go_interface_implementation") }),
  },
  {
    id: "go/double-count-switch-arms",
    language: "go",
    defectClass: "payload-corruption",
    description: "SCD10 regression: re-adds switch-wrapper double-counting (the pre-fix counter counted expression/type/select wrappers AND arms) — pump pin equals:4 catches it",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map(s => s.name === "pump" ? { ...s, complexity: s.complexity + 1 } : s) }),
  },
  {
    id: "go/reemit-write-selector-uses",
    language: "go",
    defectClass: "relationship-noise",
    description: "GOD4 regression: re-emits `uses` for assignment-LHS field WRITES and inc/dec operands (the pre-fix analyzeGoSelectorUses had no write-gate — measured 5,202 write-only (fn, field) bogus uses edges across go-tools+terraform; cpp/c/php/ruby/python/groovy/objc/ts all gate it) — relationship-and-payloads fixture's persist->writeOnly forbid pin catches it",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { source: "persist", target: "writeOnly", type: "uses", confidence: 0.7, metadata: { relationshipType: "go_selector_use", selectorExpression: "persist.writeOnly" } }] }),
  },
  {
    id: "go/drop-interface-embedding-extends",
    language: "go",
    defectClass: "relationship-loss",
    description: "GOD4 regression: drops interface-embedding extends edges (`interface { Reader; io.Closer }` previously emitted only a member-symbol contains — no inheritance edge; java interface-extends / rust trait-supertype family parity; 156 embedding sites measured across go-tools+terraform) — implements-params fixture's ReadCloser->Reader go_interface_embedding pin catches it",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => (x.metadata ?? {}).relationshipType !== "go_interface_embedding") }),
  },
  {
    id: "go/drop-composite-literal-construction",
    language: "go",
    defectClass: "relationship-loss",
    description: "GOD6 regression: drops composite-literal construction instantiates (`Foo{}`/`&Foo{}` previously emitted NOTHING — instantiates only fired for NewXxx calls; 65,843 composite literals across go-tools+terraform with zero construction edges; rust emits struct-literal instantiates, csharp for new — family parity) — relationship-and-payloads fixture pins caught by work->Worker/NewShape->Shape composite pins",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => (x.metadata ?? {}).relationshipType !== "go_composite_literal_construction") }),
  },
  {
    id: "go/func-type-implementors-dropped",
    language: "go",
    defectClass: "relationship-loss",
    description: "GOD5 regression: drops implements edges from non-struct defined types (the pre-fix analyzer checked only isStruct implementors — `type HandlerFunc func(...)` + methods never satisfied interfaces; go-tools jsonrpc2 HandlerFunc/PreempterFunc + gopls subcommands slice type all missed) — implements-params fixture's RunnerFn->Runner2 pin catches it",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !(x.type === "implements" && x.source === "RunnerFn")) }),
  },
  {
    id: "go/named-result-signature-mismatch",
    language: "go",
    defectClass: "relationship-loss",
    description: "GOD5 regression: drops implements when the interface names its results but the impl does not (`(result any, err error)` vs `(any, error)` — the pre-fix raw-text signature compare treated them as different; go-tools defaultHandler vs jsonrpc2 Handler/Preempter dropped) — implements-params fixture's HandlerImpl->NamedResulter pin catches it",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !(x.type === "implements" && x.source === "HandlerImpl")) }),
  },
  {
    id: "go/generic-implements-fabricated",
    language: "go",
    defectClass: "relationship-fabrication",
    description: "GOD5 regression: emits implements for generic instantiation pairs (Box[T]->GenericIface[T] — satisfaction needs type unification neither side can do; the name-only oracle previously over-claimed it) — implements-params fixture's Box->GenericIface forbid pin catches it",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { source: "Box", target: "GenericIface", type: "implements", confidence: 1, metadata: { relationshipType: "go_interface_implementation", isImplicit: true } }] }),
  },
  {
    id: "go/drop-promoted-struct-implements",
    language: "go",
    defectClass: "relationship-loss",
    description: "drops implements edges that arise from EMBEDDED-STRUCT method promotion (Worker impl Runner via *Shape.Run, no own methods): the pre-promotion analyzer (and oracle) silently lost these, so a struct implementing an interface through an embedded type was missed",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(x.type === "implements" && x.source === "Worker" && x.target === "Runner2")) }),
  },
  {
    id: "go/false-implements-embedded-only",
    language: "go",
    defectClass: "relationship-fabrication",
    description: "restores the pre-fix embedded-interface blind spot: emits FileBad->ReadCloser (a struct with ONLY Close()) as if it satisfied the embedding ReadCloser { Reader; Close() } — the false positive that existed because promoted Reader.Read was never folded into ReadCloser's method set",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { source: "FileBad", target: "ReadCloser", type: "implements", confidence: 1, metadata: { relationshipType: "go_interface_implementation", isImplicit: true, matchedMethods: ["Close"], implementationType: "duck_typing", receiverSet: "pointer" } }] }),
  },
  {
    id: "go/drop-symbol-complexity",
    language: "go",
    defectClass: "payload-loss",
    description: "removes per-symbol cyclomatic complexity (the go wave added it; rust/c/cpp already had it)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map(s => ({ ...s, complexity: undefined })) }),
  },
  {
    id: "go/drop-framework-detection",
    language: "go",
    defectClass: "payload-loss",
    description: "GOD7 regression: empties detectedFrameworks (framework truth is differential-invisible — deriveGoEdges derives no framework truth, so ONLY the fixture can catch it; rust wave-6 RSD7 learned this exact lesson) — framework-detection fixture's expectFrameworks [gin, net_http, gorilla_mux, grpc] pin catches it",
    transform: r => ({ ...r, metadata: { ...(r.metadata ?? {}), detectedFrameworks: [] } }),
  },
  {
    id: "go/duplicate-qualified-calls",
    language: "go",
    defectClass: "payload-corruption",
    description: "GOD9 regression: re-adds per-call-site qualified_calls (the pre-fix findGoFunctionCalls had no dedup — a function calling fmt.Println at 5 sites pushed 5 identical entries; 29,463 excess rows across go-tools+terraform on 4,719 symbols). The rust #383 lesson: qualified_calls is a UNIQUE set of callee paths per symbol. relationship-and-payloads fixture's startWork countEquals s.startWork:1 pin catches it",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map(s => s.name === "startWork" ? { ...s, qualified_calls: [...(s.qualified_calls ?? []), ...(s.qualified_calls ?? []).filter((c: string) => c === "s.startWork")] } : s) }),
  },
  {
    id: "go/reemit-dotted-channel-uses",
    language: "go",
    defectClass: "relationship-noise",
    description: "GOD8 regression: re-emits channel-op uses with the RAW operand text and no dedup (the pre-fix analyzeGoSpecificPatterns pushed `h.jobs <- v` as dotted `h.jobs`, `<-ctx.Done()` as `ctx.Done()`, bare locals as their name — 327 garbage targets + 79 duplicate rows across go-tools+terraform; uses is NOT in go's differential-compared label set, so ONLY the fixture catches it) — type-usage-graph fixture's worker->jobs/doneAll channel pins + pump->ch/done/h.jobs forbids catch it",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { source: "worker", target: "h.jobs", type: "uses", confidence: 0.8, metadata: { relationshipType: "go_channel_operation", operationType: "send", pattern: "channel_communication" } }] }),
  },
  {
    id: "rust/callsite-lines-dropped",
    language: "rust",
    defectClass: "line-attribution",
    description: "M59.A7 (#825) regression: rust's relationships go back to carrying NO line — the exact pre-fix state (measured 0 of 65,390 edges on a 200-file draw of cargo+ripgrep). Caught by rust/callsite-lines-825, which pins the broken call chain at 62, the broken field access at 55/56, the wrapped supertrait bounds at 23/24, the wrapped impl trait reference at 40 and the Self-returning constructor at 49.",
    transform: dropAllLineNumbers,
  },
  {
    id: "rust/callsite-construct-start-line",
    language: "rust",
    defectClass: "line-attribution",
    description: "M59.A7 (#825) regression: restores the CONSTRUCT-START line instead of the node that names the edge — the callee reports its receiver (`repo` on 61, not the leaf on 62), a wrapped field access reports the value line (54, not 55), wrapped supertrait bounds report the `trait` keyword (22, not 23/24), a wrapped impl header reports `impl` (39, not 40) and a member reports its container (29, not 30). Exactly the pre-fix positions rust/callsite-lines-825 forbids.",
    transform: r => ({
      ...r,
      relationships: (r.relationships ?? []).map(x => {
        const t = String(x.type ?? "")
        const trapBearing = ["calls", "contains", "extends", "implements", "instantiates", "uses", "references"]
        if (trapBearing.includes(t) && typeof x.line_number === "number") {
          return { ...x, line_number: x.line_number - 1 }
        }
        return x
      }),
    }),
  },
  {
    id: "go/callsite-lines-dropped",
    language: "go",
    defectClass: "line-attribution",
    description: "M59.A7 (#825) regression: go's relationships go back to carrying NO line — the exact pre-fix state (measured 0 of 11,893 edges on a 200-file draw of go-tools). Caught by go/callsite-lines-825, which pins the import spec at 22, the wrapped parameter type at 53, the defer/go callees at 64/66, the receiver-continued selector leaf at 68 and the embedding/implements lines at 32/25.",
    transform: dropAllLineNumbers,
  },
  {
    id: "go/callsite-construct-start-line",
    language: "go",
    defectClass: "line-attribution",
    description: "M59.A7 (#825) regression: restores the CONSTRUCT-START line instead of the node that names the edge — the import reports `import (` (21 not 22), a receiver-continued selector call reports the receiver (67 not 68), `defer`/`go` report their keyword (63/65 not 64/66) and a wrapped parameter type reports the `func` line (52 not 53). Exactly the pre-fix positions go/callsite-lines-825 forbids.",
    transform: r => ({
      ...r,
      relationships: (r.relationships ?? []).map(x => {
        const rt = String((x.metadata ?? {}).relationshipType ?? "")
        const isImport = (x.metadata ?? {}).isImport === true
        if ((rt === "go_function_call" || rt === "declared_type" || isImport) && typeof x.line_number === "number") {
          return { ...x, line_number: x.line_number - 1 }
        }
        return x
      }),
    }),
  },
  {
    id: "zig/drop-calls",
    language: "zig",
    defectClass: "relationship-loss",
    description: "drops every zig_function_call edge: the pre-wave analyzer emitted ZERO calls on real Zig source (56 call sites in one 30KB std file produced nothing), so the fixture pins the callee-leaf call surface",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => (x.metadata ?? {}).relationshipType !== "zig_function_call") }),
  },
  {
    id: "zig/drop-uses",
    language: "zig",
    defectClass: "relationship-loss",
    description: "drops every zig_field_access (uses) edge: restores the pre-wave state where field-access dependency edges were never emitted",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => (x.metadata ?? {}).relationshipType !== "zig_field_access") }),
  },
  {
    id: "zig/emit-write-as-read",
    language: "zig",
    defectClass: "relationship-fabrication",
    description: "ZGD1 regression: reverts the assignment-LHS write gate — re-injects the exact pre-fix edges probe-verified on `self.n = 5` / `self.n += 1` (set->n, bump->n uses) — zig fixture forbids catch them",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { type: "uses", source: "set", target: "n", confidence: 0.75, metadata: { relationshipType: "zig_field_access", evidenceClass: "usage_contextual" } }, { type: "uses", source: "bump", target: "n", confidence: 0.75, metadata: { relationshipType: "zig_field_access", evidenceClass: "usage_contextual" } }] }),
  },
  {
    id: "zig/leak-test-locals",
    language: "zig",
    defectClass: "symbol-fabrication",
    description: "ZGD3 regression: reverts the test/comptime executable-scope gate — re-injects the pre-fix file-scope Variable symbols the walk leaked from test bodies (local_only, compile_time_local) — fixture forbidSymbols catch them",
    transform: r => ({ ...r, symbols: [...(r.symbols ?? []), { name: "local_only", kind: "variable", visibility: "private", range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 }, metadata: {} }, { name: "compile_time_local", kind: "variable", visibility: "private", range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 }, metadata: {} }] }),
  },
  {
    id: "zig/fabricate-usingnamespace-call",
    language: "zig",
    defectClass: "relationship-fabrication",
    description: "ZGD4 regression: re-adds the bogus `calls -> usingnamespace` edge the grammar error-recovery could fabricate, and drops the usingnamespace import records — fixture forbid + expectImports catch both",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []).filter(x => !((x.metadata ?? {}).usingnamespace)), { type: "calls", source: "(global)", target: "usingnamespace", confidence: 0.85, metadata: { relationshipType: "zig_function_call" } }], imports: (r.imports ?? []).filter((i: any) => !(i.metadata ?? {}).usingnamespace) }),
  },
  {
    id: "zig/emit-type-position-uses",
    language: "zig",
    defectClass: "relationship-fabrication",
    description: "ZGD5b regression: reverts the type-position suppression — re-injects `uses qualifiedReturn->Writer` from the `w: io.Writer` annotation (probe-verified pre-fix edge) — fixture forbid catches it",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { type: "uses", source: "qualifiedReturn", target: "Writer", confidence: 0.75, metadata: { relationshipType: "zig_field_access", evidenceClass: "usage_contextual" } }] }),
  },
  {
    id: "zig/drop-import-reference",
    language: "zig",
    defectClass: "relationship-loss",
    description: "drops the @import references edge (zig_import, meta.isImport): the fixture pins that imports are first-class graph facts, not just entries in the imports array",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => (x.metadata ?? {}).relationshipType !== "zig_import") }),
  },
  {
    id: "zig/drop-symbol-complexity",
    language: "zig",
    defectClass: "payload-loss",
    description: "removes per-symbol cyclomatic complexity (the zig wave added it; go/rust/c/cpp already had it)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map(s => ({ ...s, complexity: undefined })) }),
  },
  {
    id: "zig/drop-bare-uses",
    language: "zig",
    defectClass: "relationship-loss",
    description: "Z3 regression: drops every bare identifier_usage edge — restores the pre-review state where `return Limit` / `return counter` emitted nothing (uses is NOT in zig's differential-compared label set, so ONLY the fixture catches it) — bare-value-reads fixture expects readLimit->Limit, bump->counter, fail->Timeout, handle->Fatal",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => (x.metadata ?? {}).relationshipType !== "identifier_usage") }),
  },
  {
    id: "zig/reemit-shadowed-reads",
    language: "zig",
    defectClass: "shadowing-loss",
    description: "Z3 shadowing regression: re-injects the pre-fix edges for param shadow (shadowed->counter), block-local shadow (localFirst->Limit) and payload capture shadow (arm->Answer) — bare-value-reads fixture forbids all three",
    transform: r => ({
      ...r,
      relationships: [
        ...(r.relationships ?? []),
        { source: "shadowed", target: "counter", type: "uses", confidence: 1.0, metadata: { relationshipType: "identifier_usage", nodeType: "identifier" } },
        { source: "localFirst", target: "Limit", type: "uses", confidence: 1.0, metadata: { relationshipType: "identifier_usage", nodeType: "identifier" } },
        { source: "arm", target: "Answer", type: "uses", confidence: 1.0, metadata: { relationshipType: "identifier_usage", nodeType: "identifier" } },
      ],
    }),
  },
  {
    id: "zig/reemit-error-set-declaration",
    language: "zig",
    defectClass: "self-edge",
    description: "error-set identity regression: re-injects the declaration-site self-edge `(global) -> Unused` that the isDefiningOccurrence fix removed (`pub const Error = error{ WriteFailed, OutOfMemory };` compiled to a use of WriteFailed at its own declaration; probe-verified on zls src/print_zoir.zig) — bare-value-reads fixture forbids uses->Unused",
    transform: r => ({
      ...r,
      relationships: [...(r.relationships ?? []), { source: "(global)", target: "Unused", type: "uses", confidence: 1.0, metadata: { relationshipType: "identifier_usage", nodeType: "identifier" } }],
    }),
  },
  {
    id: "zig/global-enum-member-uses",
    language: "zig",
    defectClass: "resolvability-noise",
    description: "Z3 gate regression: re-injects a bare identifier_usage for enum member `fast` outside an error leaf (the pre-fix analyzer resolved EVERY EnumMember globally, so payload binding names, struct type positions and plain identifiers collided with enum members) — bare-value-reads fixture forbids uses[identifier_usage]->fast",
    transform: r => ({
      ...r,
      relationships: [...(r.relationships ?? []), { source: "(global)", target: "fast", type: "uses", confidence: 1.0, metadata: { relationshipType: "identifier_usage", nodeType: "identifier" } }],
    }),
  },
  {
    id: "zig/drop-error-member-uses",
    language: "zig",
    defectClass: "relationship-loss",
    description: "Z3 error-member resolution regression: drops the value-position error-leaf uses (fail->Timeout, handle->Fatal) while leaving other bare reads intact — bare-value-reads fixture expects both",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !((x.metadata ?? {}).relationshipType === "identifier_usage" && (x.target === "Timeout" || x.target === "Fatal"))) }),
  },
  {
    id: "zig/synthetic-complexity",
    language: "zig",
    defectClass: "payload-drift",
    description: "Z1 regression: restores the pre-review synthetic complexity (every symbol reported 3 regardless of body) — bare-value-reads fixture pins score=5, guard=4",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map(s => ({ ...s, complexity: 3 })) }),
  },
  {
    id: "zig/error-columns-0based",
    language: "zig",
    defectClass: "range-drift",
    description: "Z2 regression: reverts error ranges to raw 0-based columns (the svelte-wave class) — bare-value-reads fixture pins the stray-brace error at line 151 column 1",
    transform: r => ({
      ...r,
      errors: (r.errors ?? []).map(e => e.range ? { ...e, range: { ...e.range, startColumn: e.range.startColumn - 1, endColumn: e.range.endColumn - 1 } } : e),
    }),
  },
  {
    id: "zig/switch-payload-scope",
    language: "zig",
    defectClass: "shadowing-loss",
    description: "Z6 regression: restores the pre-fix switch-arm capture handling (captures bound into the enclosing frame / no frame at file scope) — drops the post-switch genuine read scopeF->K and re-injects the global capture junk (global)->Clue — bare-value-reads fixture expects the first and forbids the second",
    transform: r => ({
      ...r,
      relationships: [
        ...(r.relationships ?? []).filter(x => !(normRel(x).type === "uses" && normRel(x).source === "scopeF" && normRel(x).target === "K")),
        { source: "(global)", target: "Clue", type: "uses", confidence: 1.0, metadata: { relationshipType: "identifier_usage", nodeType: "identifier" } },
      ],
    }),
  },
  {
    id: "zig/param-subtree-bindings",
    language: "zig",
    defectClass: "shadowing-loss",
    description: "Z7 regression: restores binding every identifier under a parameter node (a binding is a subtree, not a name) — drops the recovered type/default reads takeT->T, withDefault->Def, typeField->Flag — bare-value-reads fixture expects all three",
    transform: r => ({
      ...r,
      relationships: (r.relationships ?? []).filter(x => {
        if (normRel(x).type !== "uses") return true
        const src = normRel(x).source
        const tgt = normRel(x).target
        return !((src === "takeT" && tgt === "T") || (src === "withDefault" && tgt === "Def") || (src === "typeField" && tgt === "Flag"))
      }),
    }),
  },
  {
    id: "zig/blank-symbol",
    language: "zig",
    defectClass: "symbol-noise",
    description: "Z8 regression: mints the GO5-class `_` Variable symbol for `var _ = 5;` — bare-value-reads fixture forbids any `_` symbol",
    transform: r => ({
      ...r,
      symbols: [...(r.symbols ?? []), { name: "_", kind: "variable", visibility: "private", range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1, startIndex: 0, endIndex: 0 } }],
    }),
  },
  {
    id: "zig/drop-local-import",
    language: "zig",
    defectClass: "relationship-loss",
    description: "Z9 regression: drops the function-local @import fact again (locals-are-artifacts overreach) — bare-value-reads fixture expects the helper.zig import",
    transform: r => ({
      ...r,
      imports: (r.imports ?? []).filter((i: any) => i.module !== "helper.zig"),
      relationships: (r.relationships ?? []).filter(x => !(normRel(x).type === "references" && normRel(x).target === "helper.zig")),
    }),
  },
  {
    id: "zig/lines-dropped",
    language: "zig",
    defectClass: "payload-loss",
    description: "M59.A7 (#825) regression: strips every line_number — the MEASURED pre-fix state (0 of 20,789 edges lined on a 200-file zig draw, validation/m59/results/oracle-callsite-scoped-zig-f200.json) — callsite-lines-825's expect entries carry line_number on every row, so the unlined collapse fails the gate",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map(x => { const { line_number, ...rest } = x; return rest }) }),
  },
  {
    id: "zig/construct-start-line",
    language: "zig",
    defectClass: "payload-corruption",
    description: "M59.A7 (#825) regression: restores the construct-start line instead of the name-bearing LEAF — the @import reports the `const std =` line (18 not 19), a wrapped declared-type reference reports the `pub fn` keyword line (30 not 31), and a wrapped field access reports the RECEIVER line (39 not 40, the same class the c lane measured on a newline-continued call). Exactly the pre-fix positions callsite-lines-825 forbids",
    transform: r => ({
      ...r,
      relationships: (r.relationships ?? []).map(x => {
        const rt = (x.metadata ?? {}).relationshipType
        if ((rt === "zig_import" || rt === "declared_type" || rt === "zig_field_access") && typeof x.line_number === "number") {
          return { ...x, line_number: x.line_number - 1 }
        }
        return x
      }),
    }),
  },
  {
    id: "java/argument-count-inflation",
    language: "java",
    defectClass: "payload-drift",
    description: "M49 W9 regression: inflates every calls-edge argumentCount by 1 — the class 'a non-argument node is counted as an argument'. The pre-fix guard skipped a node type the grammar does not define (comments are line_comment/block_comment, not 'comment'), so a comment inside an argument list was counted. The two arity fixtures pin exact per-target counts (a2/b2/c2=2, d1=1, e0=0), so systematic inflation cannot survive",
    transform: r => ({
      ...r,
      relationships: (r.relationships ?? []).map(x =>
        x.type === "calls" && typeof (x.metadata ?? {}).argumentCount === "number"
          ? { ...x, metadata: { ...x.metadata, argumentCount: x.metadata.argumentCount + 1 } }
          : x),
    }),
  },
  {
    id: "java/mislabel-inheritance",
    language: "java",
    defectClass: "relationship-mislabel",
    description: "relabels every extends edge as implements (the exact multi-interface bug class reported by the owner)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map(x => normRel(x).type === "extends" ? { ...x, type: "implements" } : x) }),
  },
  {
    id: "java/drop-method-symbols",
    language: "java",
    defectClass: "symbol-loss",
    description: "drops every method symbol",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).filter(s => s.kind !== "method") }),
  },
  {
    id: "java/fqn-edge-drop",
    language: "java",
    defectClass: "edge-drop",
    description: "drops edges whose target contains a dot (FQN handling regression)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(normRel(x).target ?? "").includes(".")) }),
  },
  {
    id: "groovy/confidence-tamper",
    language: "groovy",
    defectClass: "confidence-dishonesty",
    description: "sets confidence 1.0 on every relationship (silent heuristic inflation, contract §4 violation)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map(x => ({ ...x, confidence: 1 })) }),
  },
  {
    id: "groovy/segment-garbage",
    language: "groovy",
    defectClass: "relationship-garbage",
    description: "adds a bogus implements edge to package segment 'java' for every class",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), ...(r.symbols ?? []).filter(s => s.kind === "class").map(s => ({ type: "implements", source: s.name, target: "java", confidence: 1, metadata: {} }))] }),
  },
  {
    id: "javascript/drop-field-access",
    language: "javascript",
    defectClass: "relationship-loss",
    description: "strips isFieldAccess uses edges (the collector-added feature)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(x.metadata ?? {}).isFieldAccess) }),
  },
  {
    id: "javascript/hide-jsdoc",
    language: "javascript",
    defectClass: "docstring-loss",
    description: "clears comments arrays (docstring-loss family)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map(s => ({ ...s, comments: [] })) }),
  },
  {
    id: "scala/self-target-revert",
    language: "scala",
    defectClass: "symbol-identity",
    description: "M49 W15 family-parity regression: a self-receiver member read targets the literal keyword `this` again instead of the member leaf — the edge names no symbol and the member read disappears (scala/member-read-target forbids target `this`); scala's lane cannot see it (F5 compares label+target and scala does not compare uses at all), which is exactly why the parity gate exists",
    transform: revertToKeywordTarget,
  },
  {
    id: "scala/callsite-line-revert",
    language: "scala",
    defectClass: "line-attribution",
    description: "M59 (#825) regression: restores the receiver-start line, collapsing every call in a multi-line chain onto the line the chain opened on. Exactly the defect the fix removed — on cats-effect Example.scala `.as(ExitCode(2))` written on 23 was reported on 22. Caught by scala/callsite-lines-825, whose forbid entries name `.as` on line 12 and `.filter` on line 16, the pre-fix positions.",
    transform: revertToChainOpeningLine,
  },
  {
    id: "scala/extension-receiver-method-line",
    language: "scala",
    defectClass: "line-attribution",
    description: "M59 (#825) follow-through regression: the extension receiver-type use goes back to being stamped with the OWNING METHOD's declaration line — the exact pre-fix behaviour the oracle caught on scala3 tests/warn/ext-override.scala, where `extension (x: Bla)` names Bla on the extension line and the method body follows below. Caught by scala/extension-method-flag, which pins shout->String at 3 and greet->Bla at 11 (the receiver-type lines) and forbids the method lines 4 and 13.",
    transform: revertToExtensionReceiverMethodLine,
  },
  {
    id: "java/annotation-start-line",
    language: "java",
    defectClass: "line-attribution",
    description: "M59 (#825) regression: an annotated java declaration goes back to the line of its ANNOTATION — the exact pre-fix behaviour, measured on a 300-file real java sample where 25 of 93 symbols landed on `@SuppressWarnings`/`@Override` instead of the declaration. The symbol range and its `contains` edge move together, so java/declaration-lines-825 catches it twice: `contains Annotated -> legacy` is pinned at 24 and forbidden at 23 (@Deprecated), and the symbol range is pinned at 21 and the `extends` edge is forbidden at 20.",
    transform: revertToAnnotationStartLine,
  },
  {
    id: "java/callsite-lines-dropped",
    language: "java",
    defectClass: "line-attribution",
    description: "M59 (#825) regression: java's relationships go back to carrying NO line — the exact pre-fix state (measured 0 of 1,920 java relationships carried one). Caught by java/callsite-lines-825, which pins trim 15, toUpperCase 16, instantiates Chains 20 and StringBuilder 24 and the two append calls at 25/26.",
    transform: dropJavaCallsiteLines,
  },
  {
    id: "kotlin/heritage-lines-dropped",
    language: "kotlin",
    defectClass: "line-attribution",
    description: "M59 (#825) regression: kotlin heritage edges go back to carrying NO line — the exact pre-fix state (measured 139 of 139 extends/implements edges unlined on a 60-file sample, 12,274 relationships total). Caught by kotlin/heritage-lines-825, which pins all three `Wrapped` parents at 12 and both `Third` supertypes at 21.",
    transform: dropKotlinHeritageLines,
  },
  {
    id: "groovy/lines-dropped",
    language: "groovy",
    defectClass: "line-attribution",
    description: "M59 (#825) regression: groovy's relationships go back to carrying NO line — the exact pre-fix state (measured 0 of 761 relationships carried one on a 40-file sample). Caught by groovy/lines-825, which pins the class at 19, its members at 23/26, both heritage parents at 19/20, the override at 26, the member read at 27, the declared type at 23, the import at 3 and both chain calls at 29/30.",
    transform: dropAllLineNumbers,
  },
  {
    id: "xml/lines-dropped",
    language: "xml",
    defectClass: "line-attribution",
    description: "M59 (#825) regression: xml's relationships go back to carrying NO line. xml had no fixture lane at all before this round, so nothing pinned its line contract even though it was one of only two analyzers that emitted one. Caught by xml/lines-825, which pins every element, every attribute, the default-namespace edge (whose target is the synthesised name `default`) and the prefixed-namespace edge.",
    transform: dropAllLineNumbers,
  },
  {
    id: "typescript/line-zero-based",
    language: "typescript",
    defectClass: "line-attribution",
    description: "M59 (#825) regression: every line is emitted 0-based (startPosition.row instead of row + 1), the off-by-one this contract is one keystroke away from. Caught by typescript/callsite-lines-825, which pins the import specifiers at 17/18, the base name at 27 and the chain's callee at 33 — all shifted down by one here. It is the mutation that proves the fixture pins the ARITHMETIC and not merely the presence of a number.",
    transform: shiftLineNumbersZeroBased,
  },
  {
    id: "typescript/lines-dropped",
    language: "typescript",
    defectClass: "line-attribution",
    description: "M59 (#825) regression: typescript's relationships go back to carrying NO line — the exact pre-fix state (measured: 0 of 2,074 relationships on the round's pinned 40-file sample). Caught by typescript/callsite-lines-825, which pins 17 relationships across imports/extends/contains/calls/instantiates/references/uses/exports.",
    transform: dropAllLineNumbers,
  },
  {
    id: "typescript/implements-lines-dropped",
    language: "typescript",
    defectClass: "line-attribution",
    description: "M49 W22 regression: implements edges go back to carrying NO line while every other kind stays stamped — the exact pre-fix state of the ONE relationship kind the M59 web round left uncovered (measured: 6 edges unstamped across the four TS corpora + 1 delegated from svelte; the 40-file oracle sample drew none, so the milestone instrument read 0 noLine). Caught by typescript/class-implements-interface-overrides, whose implements entries pin 33/47/52/57 and whose forbid names the lineless emission.",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map((x: any) => x.type === "implements" ? { ...x, line_number: undefined } : x) }),
  },
  {
    id: "typescript/decorator-lines-dropped",
    language: "typescript",
    defectClass: "line-attribution",
    description: "M59 (#860) regression: decorator `references` edges go back to carrying NO line while every other kind stays stamped — the exact pre-fix state (`extractDecoratorRelationships` had no line field at all, which is why the svelte lane's pinned 40-file sample read 110/111). Caught by typescript/decorator-lines-860, which pins the class decorator at 18, the field decorator at 20 and the method decorator at 23 — each on a DIFFERENT line from the declaration it decorates — and forbids the lineless emission on all three.",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map((x: any) => (x.metadata ?? {}).isDecorator ? { ...x, line_number: undefined } : x) }),
  },
  {
    id: "typescript/decorator-line-off-by-one",
    language: "typescript",
    defectClass: "line-attribution",
    description: "M59 (#860) near-miss: a decorator edge names the DECORATOR's line shifted by one (the arithmetic this contract is one keystroke away from, and the wrong answer that still points at the decorator rather than at nothing). Caught by typescript/decorator-lines-860, whose forbid entries name 19/21/24 — exactly the shifted values of the expected 18/20/23 — so the fixture pins the ARITHMETIC and not merely the presence of a number.",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map((x: any) => (x.metadata ?? {}).isDecorator && typeof x.line_number === "number" ? { ...x, line_number: x.line_number + 1 } : x) }),
  },
  {
    id: "typescript/wrapped-new-routed-to-calls",
    language: "typescript",
    defectClass: "payload-fidelity",
    description: "M14 (#858) regression: a wrapped `new` (constructor written on the next line) is emitted as a CALL and its instantiation is dropped — the exact pre-fix state, where the pinned grammar closed the statement at the bare `new` and the constructor call arrived as the next statement's call_expression. Caught by typescript/wrapped-new-858, which pins instantiates at the constructor's own line (16, not the keyword's 15) AND the equivalence with the unwrapped control on line 14, and forbids the fabricated calls edge.",
    transform: r => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) =>
        x.type === "instantiates" ? { ...x, type: "calls" } : x,
      ),
    }),
  },
  {
    id: "typescript/type-parameter-constraint-default-dropped",
    language: "typescript",
    defectClass: "payload-fidelity",
    description: "M14 (#382) regression: a type parameter's constraint and default are dropped from the symbol payload — the exact pre-fix state. The analyzer read non-existent fields (`extends`/`default`) instead of the pinned tsx/typescript grammar's real fields (`constraint`/`value`), so only the bare name survived (`T`, not `T extends HasId = HasId`). It survived every gate because the F1 field oracle captured no field literals at all, and the one existing fixture (generic-constraints) pinned only the name `T`. Caught by typescript/type-parameter-constraint-default, whose five pins are full constraint+default strings.",
    transform: r => ({
      ...r,
      symbols: (r.symbols ?? []).map((s: any) => {
        const strip = (tp: any) => (typeof tp === "string" ? tp.split(/\s+/)[0] : tp)
        const next: any = { ...s }
        if (Array.isArray(s.genericParameters)) next.genericParameters = s.genericParameters.map(strip)
        if (s.metadata && Array.isArray(s.metadata.typeParameters)) {
          next.metadata = { ...s.metadata, typeParameters: s.metadata.typeParameters.map(strip) }
        }
        return next
      }),
    }),
  },
  {
    id: "typescript/type-parameter-names-only-positional",
    language: "typescript",
    defectClass: "grammar-field",
    description: "M14 (#382) near-miss: type parameters keep their constraint/default but read them POSITIONALLY (`namedChild(1)`), which for `T extends object = {}` yields the constraint AND the default concatenated into one string — the arithmetic one step away from the fixed code. Caught by typescript/type-parameter-constraint-default: `T extends object = {}` cannot be produced by joining the wrong children.",
    transform: r => ({
      ...r,
      symbols: (r.symbols ?? []).map((s: any) => {
        const mangle = (tp: any) =>
          typeof tp === "string" && tp.includes(" = ")
            ? tp.split(" = ")[0] + " = " + tp.split(" = ")[1] + tp.split(" = ")[1]
            : tp
        const next: any = { ...s }
        if (Array.isArray(s.genericParameters)) next.genericParameters = s.genericParameters.map(mangle)
        return next
      }),
    }),
  },
  {
    id: "typescript/iface-implements-override-drop",
    language: "typescript",
    defectClass: "relationship-loss",
    description: "M49 W22 regression: the class-implements-interface arm is deleted, so a class supplying an in-file interface's members emits no overrides again — the exact pre-fix state (vue-core ReactiveEffect.notify -> Subscriber.notify permanently MISSING). Caught by typescript/class-implements-interface-overrides, which pins BOTH gains (the direct Effect.notify pair and the transitive Derived.notify pair through Base extends Subscriber); the abstention forbid entries keep a naive name-only reimplementation from passing the same fixture.",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !(x.type === "overrides" && (x.metadata ?? {}).implementedInterface)) }),
  },
  {
    id: "javascript/lines-dropped",
    language: "javascript",
    defectClass: "line-attribution",
    description: "M59 (#825) regression: javascript's relationships go back to carrying NO line — the exact pre-fix state (measured: 0 of 5,818 on the round's pinned sample, the largest silent lane in the product, and the one vue and svelte delegate to). Caught by javascript/callsite-lines-825.",
    transform: dropAllLineNumbers,
  },
  {
    id: "vue/lines-dropped",
    language: "vue",
    defectClass: "line-attribution",
    description: "M59 (#825) regression: vue's relationships go back to carrying NO line — the exact pre-fix state (measured: 0 of 3,940 on the round's pinned sample). Caught by vue/template-lines-825, whose forbid entries are the measured HEAD values for every one of its 16 relationships.",
    transform: dropAllLineNumbers,
  },
  {
    id: "typescript/metadata-line-second-base",
    language: "typescript",
    defectClass: "line-attribution",
    description:
      "M60.P1 (#873) regression: the metadata line mirror goes back to the 0-based `startPosition.row` while the row's `line_number` stays 1-based — the exact pre-fix state of the eight typescript writers (measured through the production pipeline: typescript 148 of 155 rows off by one, tsx 173 of 179, vue 3 of 3, and ZERO on java/scala/groovy/gradle/cpp/python/js). Caught by typescript/one-line-base-873, which pins both fields on three rows and forbids the one-below values.",
    transform: revertMetadataLineBase,
  },
  // RETIRED (cpp M59.A7 handoff, 2026-09-21): `cpp/metadata-only-line-second-base`
  // mutated the ONE-FIELD shape — rows carrying `metadata.line` and NO
  // `line_number` — which the cpp analyzer no longer produces at all: every one
  // of its nine emit sites now writes `line_number`, so the mutant became a
  // no-op and would have reported SURVIVED on a fixture that still passes (a
  // mutant that cannot fail proves nothing). Measured after the round: cpp rows
  // with `metadata.line` and no `line_number` = 0 of 10,157 across nlohmann-json
  // (6 files), fmt (20) and sqlite (12). The class itself is still covered, by
  // the two mutants below and by cpp/callsite-lines-825.
  {
    id: "cpp/metadata-line-second-base",
    language: "cpp",
    defectClass: "line-attribution",
    description:
      "M60.P1 (#873) regression, the TWO-FIELD shape on cpp: the metadata line mirror goes back to `line_number - 1` while the row's own `line_number` stays 1-based — the pre-fix writer's off-by-one, now reachable on cpp because these rows carry both fields. Caught by cpp/callsite-lines-825 (forbid entries: `calls callMultiLine -> size` meta.line 33 and `instantiates makeIt -> Widget` meta.line 38) and by cpp/metadata-line-base-873, which forbids the one-above mirror on its two sites.",
    transform: revertMetadataLineBase,
  },
  {
    id: "cpp/lines-dropped",
    language: "cpp",
    defectClass: "line-attribution",
    description:
      "M59 (#825) regression: cpp's relationships go back to carrying NO `line_number` — the exact pre-fix state of this analyzer (measured before the round: 0 of 3,418 rows on the two-file lane carried a row line; a fmt member read reached the graph at line 0, #870). Caught by cpp/callsite-lines-825, whose forbid entry pins the `uses readField -> value` row against the `line_number: null` (line-less) state, and by the positive pins on the call/instantiation/contains rows.",
    transform: dropAllLineNumbers,
  },
  {
    id: "svelte/lines-dropped",
    language: "svelte",
    defectClass: "line-attribution",
    description: "M59 (#825) regression: svelte's relationships go back to carrying NO line — the exact pre-fix state (measured: 0 of 526 on the round's pinned sample). Caught by svelte/template-lines-825.",
    transform: dropAllLineNumbers,
  },
  {
    id: "vue/delegated-line-not-shifted",
    language: "vue",
    defectClass: "line-attribution",
    description: "M59 (#825) regression: a DELEGATED relationship keeps the js/ts analyzer's script-relative line, i.e. the SFC merge does not add the block offset — the exact pre-fix behaviour, measured on the corpus as 562 of 585 line-bearing vue edges INCONSISTENT. Caught by vue/template-lines-825, which pins the imported component at file line 25.",
    transform: revertDelegatedLineToScriptRelative,
  },
  {
    id: "svelte/delegated-line-not-shifted",
    language: "svelte",
    defectClass: "line-attribution",
    description: "M59 (#825) regression: same seam regression for svelte (measured pre-fix: 19 of 58 line-bearing edges INCONSISTENT). Caught by svelte/template-lines-825, which pins the imported component at file line 12 and the script-side read at 18.",
    transform: revertDelegatedLineToScriptRelative,
  },
  {
    id: "vue/prop-line-from-props-pair",
    language: "vue",
    defectClass: "line-attribution",
    description: "M59 (#825) regression: every prop/emit containment edge goes back to the `props: { … }` PAIR's line — the exact pre-fix state, measured on the corpus (Account.vue:17) and on the fixture itself at HEAD (both props stamped 30 while written on 31/32). Caught by vue/template-lines-825, which forbids 30 for `label` and `count`.",
    transform: revertPropLineToPropsPair,
  },
  {
    id: "groovy/parenless-continuation-call",
    language: "groovy",
    defectClass: "relationship-fabrication",
    description: "M49-CONV #851 regression: a paren-less leading-dot continuation goes back to emitting a CALL edge to a property name and loses the read — the exact pre-fix state, where `this\n .label` (a very common Groovy layout) produced `calls f -> label` and no read at all while the same access on one line produced `uses A -> label`. Simulated at the output level in the shape the defect actually produced: every method-attributed member READ, the form the continuation read takes, becomes a `calls` edge. Caught by groovy/continuation-shapes-851, which pins `uses continuedRead -> label` at 11 and forbids `calls continuedRead -> label` on any line.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) =>
        normRel(x).type === "uses" && x.metadata?.isFieldAccess
          ? { ...x, type: "calls", metadata: { relationshipType: "leading_dot_call" } }
          : x,
      ),
    }),
  },
  {
    id: "groovy/juxt-target-dotted",
    language: "groovy",
    defectClass: "relationship-target",
    description: "M49-CONV #852 regression: a juxtaposition call stores the WHOLE dotted callee text as its target, so one method appears in the graph twice under two names (`build` from the one-line form and `helper.build` from a continuation) — the exact pre-fix emission. Reconstructed from the edge's own `groovyCallExpression` payload, so it is the real defect value rather than a synthesised guess. Caught by groovy/continuation-shapes-851, which pins `calls continuedChain -> build` at 27 and forbids a `calls` target of `helper.build`.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) =>
        x.metadata?.relationshipType === "juxt_call" && x.metadata?.groovyCallExpression
          ? { ...x, target: x.metadata.groovyCallExpression }
          : x,
      ),
    }),
  },
  {
    id: "groovy/juxt-callee-read",
    language: "groovy",
    defectClass: "relationship-noise",
    description: "M49-CONV #852 regression, second half: the callee of a juxtaposition call leaks as a member READ (`uses f -> build` beside `calls f -> build`), contradicting the family rule that a callee is not a read, which java/kotlin/scala all honour. Caught by groovy/continuation-shapes-851, whose forbid entry names `uses continuedChain -> build` at 27.",
    transform: (r: any) => ({
      ...r,
      relationships: [
        ...(r.relationships ?? []),
        ...(r.relationships ?? [])
          .filter((x: any) => x.metadata?.relationshipType === "juxt_call")
          .map((x: any) => ({
            ...x,
            type: "uses",
            confidence: 0.6,
            metadata: { isFieldAccess: true },
          })),
      ],
    }),
  },
  {
    id: "groovy/drop-interpolation-reads",
    language: "groovy",
    defectClass: "relationship-loss",
    description: "G7 regression: Groovy string interpolation goes back to contributing ZERO reads — the exact pre-fix state, measured at 8 symbols / 15 relationships on groovy/interpolation-reads-g7 against 9 / 22 after the fix. The whole interpolation surface becomes invisible again, which is what the pinned grammar did by construction (Java's `string_fragment` swallowed `$` and `{` as opaque text, so there was no node to read). Caught by groovy/interpolation-reads-g7, which pins all six interpolation edges — `uses render -> templateField`@23, `uses render -> style`@23 (the `$name` short form in the same string), `uses render -> name`@24, `calls render -> notify`@24, `uses nestedBinding -> templateField`@41 and `calls optionTag -> lookup`@62 for the raw-nested-quote form.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).filter((x: any) => !(x.metadata ?? {}).isInterpolationRead),
    }),
  },
  {
    id: "groovy/interpolation-reads-unbound",
    language: "groovy",
    defectClass: "relationship-fabrication",
    description: "G7 gate regression: the interpolation emitter loses its LOCAL-BINDING gate, so every interpolated name is read — including names the current callable binds, which have no symbol at all. This is the defect class a naive fix ships, and it is the expensive one: `\"$it\"` inside a closure is the most common Groovy interpolation there is, so the corpus would gain a phantom edge per occurrence. Re-injected by name because a suppressed name is by definition absent from the output it would have polluted; the lines are the fixture's own source lines. Caught by groovy/interpolation-reads-g7's forbidRelationships, which names `uses render -> local`@25, `uses render -> count`@25 (parameter), `uses render -> user`@24 (parameter, and the RECEIVER of `user.name`), `uses nestedBinding -> outerLocal`@39 (a `def` inside a nested closure), `uses implicitIt -> it`@48 and `uses optionTag -> label`/`selected`/`registry`@62.",
    transform: (r: any) => ({
      ...r,
      relationships: [
        ...(r.relationships ?? []),
        { type: "uses", source: "render", target: "local", confidence: 0.9, line_number: 25, metadata: { isInterpolationRead: true } },
        { type: "uses", source: "render", target: "count", confidence: 0.9, line_number: 25, metadata: { isInterpolationRead: true } },
        { type: "uses", source: "render", target: "user", confidence: 0.9, line_number: 24, metadata: { isInterpolationRead: true } },
        { type: "uses", source: "nestedBinding", target: "outerLocal", confidence: 0.9, line_number: 39, metadata: { isInterpolationRead: true } },
        { type: "uses", source: "implicitIt", target: "it", confidence: 0.9, line_number: 48, metadata: { isInterpolationRead: true } },
        { type: "uses", source: "optionTag", target: "label", confidence: 0.9, line_number: 62, metadata: { isInterpolationRead: true } },
        { type: "uses", source: "optionTag", target: "selected", confidence: 0.9, line_number: 62, metadata: { isInterpolationRead: true } },
        { type: "uses", source: "optionTag", target: "registry", confidence: 0.9, line_number: 62, metadata: { isInterpolationRead: true } },
      ],
    }),
  },
  {
    id: "groovy/interpolation-callee-read",
    language: "groovy",
    defectClass: "relationship-noise",
    description: "G7 regression, the other direction: the interpolation emitter stops deferring to the member/call walks, so an identifier those walks already own is read a second time — `${obj.prop}` becomes BOTH a field read and a bare read, and a callee leaks as a read. java/kotlin/scala all suppress a callee-position leaf, and groovy does too after #852, so this is a contract violation rather than extra evidence. Caught by groovy/interpolation-reads-g7: `uses optionTag -> lookup` is forbidden (its `calls optionTag -> lookup`@62 must stand alone), as is `calls render -> name` for the mirror-image mislabel of a member read.",
    transform: (r: any) => ({
      ...r,
      relationships: [
        ...(r.relationships ?? []),
        { type: "uses", source: "optionTag", target: "lookup", confidence: 0.9, line_number: 62, metadata: { isInterpolationRead: true, isFieldAccess: true } },
      ],
    }),
  },
  {
    id: "groovy/interpolation-reads-single-quoted",
    language: "groovy",
    defectClass: "relationship-fabrication",
    description: "G7 regression: the interpolation emitter reads the TEXT of a plain string, so a SINGLE-quoted literal interpolates — which Groovy never does. The grammar fix makes this reachable for the first time (the single-quoted forms used to inherit Java's `string_interpolation` alternative, removed in the G7 round precisely because it would make `'''${x}'''` interpolate). Caught by groovy/interpolation-reads-g7's forbid entries `uses control -> templateField` and `uses control -> style`, which name the single-quoted control on line 32.",
    transform: (r: any) => ({
      ...r,
      relationships: [
        ...(r.relationships ?? []),
        { type: "uses", source: "control", target: "templateField", confidence: 0.9, line_number: 32, metadata: { isInterpolationRead: true } },
        { type: "uses", source: "control", target: "style", confidence: 0.9, line_number: 32, metadata: { isInterpolationRead: true } },
      ],
    }),
  },
  {
    id: "groovy/assert-comma-calls-dropped",
    language: "groovy",
    defectClass: "relationship-loss",
    description: "#841 regression: the assert statement's message expression goes unwalked, so the calls written inside `assert cond, 'msg'` disappear — groovy/assert-comma-841 loses check -> size and check -> isEmpty. The pre-fix failure was worse than a lost call (recovery swallowed the whole class) but the fixture pins the extraction consequence, which is what the analyzer can observe.",
    transform: r => ({
      ...r,
      relationships: (r.relationships ?? []).filter(x => !(x.type === "calls" && x.source === "check" && (x.target === "size" || x.target === "isEmpty"))),
    }),
  },
  {
    id: "groovy/annotation-start-line",
    language: "groovy",
    defectClass: "line-attribution",
    description: "M59 (#825) regression: a groovy declaration goes back to the line of its leading ANNOTATION — the exact pre-fix behaviour of every symbol range (the pinned grammar puts `modifiers` first, so `@Deprecated\nclass Wrapped` started at 18). Caught by groovy/lines-825 twice: `contains Wrapped -> label` is pinned at 23 and forbidden at 22, `contains Wrapped -> use` pinned at 26 and forbidden at 25, and the Wrapped/label symbol ranges are pinned at 19/23.",
    transform: revertToAnnotationStartLine,
  },
  {
    id: "groovy/chain-opening-line",
    language: "groovy",
    defectClass: "line-attribution",
    description: "M59 (#825) regression: every call in a multi-line chain is stamped with the line the chain's first call is on, so the second continuation is attributed to the first's line. Caught by groovy/lines-825, whose forbid entry names `.configure(m)` at 29 when it is written on 30 (the receiver opens the chain on 28).",
    transform: revertToChainOpeningLine,
  },
  {
    id: "kotlin/heritage-class-header-line",
    language: "kotlin",
    defectClass: "line-attribution",
    description: "M59 (#825) regression: every heritage edge is stamped with the line the CLASS DECLARATION starts on, which is right only when the supertype list is written inline. On a wrapped list (`internal class TestScopeImpl(...) :` 183 / `AbstractCoroutine<Unit>(...), TestScope {` 184 in kotlinx-coroutines) it sends a tool to the class keyword for every parent. Caught by kotlin/heritage-lines-825, whose forbid entries name `Wrapped`'s parents at 9 (the `class` line) and `Third`'s at 20.",
    transform: revertKotlinHeritageToDeclarationLine,
  },
  {
    id: "java/phantom-containment-line",
    language: "java",
    defectClass: "line-attribution",
    description: "M59 (#825) regression: a SYNTHESISED java member's containment edge goes back to carrying the symbol's range — lombok accessors name the FIELD's line (8/9) and Spring-Data methods the INTERFACE's (12), where the generated name is written nowhere. Caught by java/phantom-contains-lines, whose forbid entries name getOwner/setBalance at 8/9 and save/count at 12.",
    transform: stampPhantomContainmentLine,
  },
  {
    id: "kotlin/phantom-containment-line",
    language: "kotlin",
    defectClass: "line-attribution",
    description: "M59 (#825) regression: a SYNTHESISED member's containment edge goes back to carrying the symbol's range — which for a phantom is the ENCLOSING declaration's line, so a tool navigating to `Money.component1` opens the class. Measured pre-fix on a real file (JsonTestsData.kt): 7 of 8 phantom containment edges named a line on which the target name appears nowhere. Caught by kotlin/data-class-phantoms, whose forbid entries name component1, copy and toString at 3 (the data class's only line).",
    transform: stampPhantomContainmentLine,
  },
  {
    id: "kotlin/phantom-uncontained",
    language: "kotlin",
    defectClass: "edge-absence",
    description: "M59 (#825) regression: the injector's own inconsistency — componentN set ownerName (so `contains Money -> component1` existed) while copy/equals/hashCode/toString did not (so those members were the only ones with no containment edge at all). Caught by kotlin/data-class-phantoms, which pins a containment edge for each of the four.",
    transform: dropNonComponentPhantomContainment,
  },
  {
    id: "scala/anon-member-initializer-call-loss",
    language: "scala",
    defectClass: "edge-absence",
    description: "M59 (#855) regression: a call made from an anonymous-class member INITIALISER loses its emission — every `calls` edge whose source is the anonymous type is dropped, so the edge exists nowhere for the index to attribute. That is the state #855 was mis-diagnosed as (the analyzer was emitting it; the INDEX was nulling the source). Caught by scala/anonymous-member-initializer-call, which pins `calls anonymous_Runnable -> target` at line 29 beside the control `calls mirrored -> target` at 32.",
    transform: r => ({
      ...r,
      relationships: (r.relationships ?? []).filter(
        (x: any) => !(String(x.type) === "calls" && String(x.source).startsWith("anonymous_")),
      ),
    }),
  },
  {
    id: "typescript/decorator-range-includes-decorator",
    language: "typescript",
    defectClass: "line-attribution",
    description: "M59 (#861) regression: a decorated declaration's symbol range goes back to starting AT its decorator, and the contains/exports lines derived from it move with it — caught by typescript/decorator-declaration-lines-861, which pins Service 39 / pool 41 / method 44 and forbids the pre-fix 40 exports line and the decorator-line contains rows.",
    transform: revertDecoratorRangeExclusion(),
  },
  {
    id: "typescript/decorator-call-by-enclosing-scope",
    language: "typescript",
    defectClass: "misattribution",
    description: "M59 (#861) regression: restores the class-scoped decorator rows — `@inject(\"db\")` again emits `calls Service -> inject` and `references Service -> inject` from the CLASS beside the correct `references pool -> inject` — caught by typescript/decorator-declaration-lines-861's forbid entries, which name exactly those two rows.",
    transform: readdScopeScopedDecoratorEdges(),
  },
  {
    id: "javascript/decorator-range-includes-decorator",
    language: "javascript",
    defectClass: "line-attribution",
    description: "M59 (#861) regression: javascript's decorated-declaration ranges go back onto the decorator (this grammar nests the decorator INSIDE class/field/method nodes), so contains Service -> pool reads 36 and Service -> method reads 39 — caught by javascript/decorator-declaration-lines-861, which pins 37/40 and forbids both.",
    transform: revertDecoratorRangeExclusion(),
  },
  {
    id: "javascript/field-decorator-dropped",
    language: "javascript",
    defectClass: "symbol-payload-loss",
    description: "M49 (#868) regression: a FIELD's decorator is attached to nothing again — the state the field path emitted while the class and method paths called the collector, so `@inject(DB)` above `pool = make()` left `pool` with no decorator and no reference edge. Caught by javascript/decorator-metadata-868, which pins the field's `references pool -> inject` at the decorator's line.",
    transform: dropJsFieldDecorators(),
  },
  {
    id: "javascript/decorator-references-removed",
    language: "javascript",
    defectClass: "relationship-loss",
    description: "M49 (#868) regression: no decorator is reachable by name from the symbol it decorates — the pre-fix state where javascript emitted no decorator `references` edge at all. Caught by javascript/decorator-metadata-868's four expected decorator rows (46/48/51/54) and by javascript/decorator-declaration-lines-861's three.",
    transform: dropDecoratorReferences(),
  },
  {
    id: "javascript/decorator-edge-borrows-declaration-line",
    language: "javascript",
    defectClass: "line-attribution",
    description: "M49 (#868) near-miss: a decorator's reference edge names the DECLARATION's line instead of the line the `@name` is written on. Caught by javascript/decorator-metadata-868, whose decorators sit on different lines from their declarations (46/48/51/54 vs 47/49/52/55) and which forbids the declaration lines for those rows.",
    transform: decoratorEdgeBorrowsDeclarationLine(),
  },
  {
    id: "javascript/decorator-edge-loses-line",
    language: "javascript",
    defectClass: "line-attribution",
    description: "M59 (#860) regression applied to javascript: decorator reference edges go back to carrying NO line, the pre-#860 state. Caught by javascript/decorator-metadata-868, which forbids the line-less decorator edge.",
    transform: dropDecoratorEdgeLines(),
  },
  {
    id: "javascript/exported-class-decorator-dropped",
    language: "javascript",
    defectClass: "symbol-payload-loss",
    description: "M49 (#868) regression: an EXPORTED class's decorator is dropped again, because this grammar puts it on the wrapping export_statement where the own-child reader never looked — `@sealed export class Service` lost both the decorator entry and its reference edge. Caught by javascript/decorator-metadata-868's expected `references Service -> sealed` at 46.",
    transform: dropExportedClassDecorators(),
  },
  {
    id: "javascript/decorator-position-rows-restored",
    language: "javascript",
    defectClass: "misattribution",
    description: "M49 (#868) regression: restores the class-scoped decorator rows — the decorator invocation is again a `calls` by the enclosing class and the decorator's name again a bare-read `uses` from its carrier, beside the correct `references` row. Caught by javascript/decorator-metadata-868's forbid entries (`calls Service -> inject`, `uses Service -> sealed`, `uses method -> sealed`).",
    transform: readdScopeScopedDecoratorEdges(),
  },
  {
    id: "vue/decorator-metadata-mirror-stale",
    language: "vue",
    defectClass: "line-attribution",
    description: "M49 (#868) regression: the SFC seam shifts `line_number` but leaves the metadata LINE MIRRORS script-relative, so `references Service -> sealed` claims the file line while its own metadata names the line above the script block. Caught by vue/decorator-metadata-868, which pins meta.decoratorLine=24 beside line_number=24 and forbids the script-relative 10.",
    transform: revertDelegatedMetadataLineMirrors,
  },
  {
    id: "svelte/decorator-metadata-mirror-stale",
    language: "svelte",
    defectClass: "line-attribution",
    description: "M49 (#868) regression, svelte twin: the seam's metadata line mirrors stay script-relative. Caught by svelte/decorator-metadata-868 (script on line 10, offset 7), which pins meta.decoratorLine=17 and forbids the unshifted 10.",
    transform: revertDelegatedMetadataLineMirrors,
  },
  {
    id: "javascript/decorator-position-reads-restored",
    language: "javascript",
    defectClass: "misattribution",
    description: "M49 (#868) regression: the bare-read half alone — each decorator's name becomes a `uses` edge from the symbol that carries it, the spelling #868 replaces with the reference edge. Caught by javascript/decorator-metadata-868 and by javascript/decorator-declaration-lines-861, which both forbid that row.",
    transform: readdDecoratorPositionReads(),
  },
  {
    id: "java/drop-anon-body-field-member",
    language: "java",
    defectClass: "symbol-loss",
    description: "M49/M37 (#866) regression: drops a FIELD member declared inside an anonymous class body (and its containment edge) — the state kotlin and scala emitted, applied to the language that defines the family contract. Caught by java/anonymous-field-member, which pins `field` as a property owned by anonymous_Runnable.",
    transform: dropAnonBodyMember("field"),
  },
  {
    id: "java/reattribute-anon-field-initializer-call",
    language: "java",
    defectClass: "misattribution",
    description: "M49/M37 (#866) regression: flattens calls made from an anonymous body onto the enclosing method, so `calls anonymous_Runnable -> target` becomes `calls build -> target` (kotlin's pre-fix answer). Caught by java/anonymous-field-member's forbid pin on `build -> target` at the initialiser's line.",
    transform: reattributeAnonBodyCall("build"),
  },
  {
    id: "groovy/drop-anon-body-field-member",
    language: "groovy",
    defectClass: "symbol-loss",
    description: "M49/M37 (#866) regression: drops a FIELD member declared inside an anonymous class body (and its containment edge) — the state kotlin and scala emitted. Caught by groovy/anonymous-field-member, which pins `field` as a property owned by anonymous_Runnable.",
    transform: dropAnonBodyMember("field"),
  },
  {
    id: "groovy/reattribute-anon-field-initializer-call",
    language: "groovy",
    defectClass: "misattribution",
    description: "M49/M37 (#866) regression: flattens calls made from an anonymous body onto the enclosing method (`calls anonymous_Runnable -> target` becomes `calls build -> target`). Caught by groovy/anonymous-field-member's forbid pin on `build -> target` at the initialiser's line.",
    transform: reattributeAnonBodyCall("build"),
  },
  {
    id: "kotlin/drop-anon-body-field-member",
    language: "kotlin",
    defectClass: "symbol-loss",
    description: "M49/M37 (#866) regression: reverts the extractProperty boundary (object_literal no longer stops the ancestor scan), so `val field` inside `object : Runnable { ... }` is classified as a function-local and vanishes — the pre-fix kotlin state. Caught by kotlin/anonymous-field-member.",
    transform: dropAnonBodyMember("field"),
  },
  {
    id: "kotlin/reattribute-anon-field-initializer-call",
    language: "kotlin",
    defectClass: "misattribution",
    description: "M49/M37 (#866) regression: reverts resolveCallSource's object_literal boundary, so the member initialiser's call attributes to the OUTER method `build` instead of the anonymous type — the pre-fix kotlin answer (java/groovy/scala all said the anonymous type). Caught by kotlin/anonymous-field-member's forbid pin on `build -> target` at the initialiser's line.",
    transform: reattributeAnonBodyCall("build"),
  },
  {
    id: "scala/drop-anon-body-field-member",
    language: "scala",
    defectClass: "symbol-loss",
    description: "M49/M37 (#866) regression: reverts the handleVariable boundary (an anonymous body's template_body no longer stops the ancestor scan), so `val field` inside `new Runnable { ... }` is reclassified as a function-local and vanishes — the pre-fix scala state, and what made cats-effect TimeT.scala's symbol list end at anonymous_Fiber. Caught by scala/anonymous-field-member.",
    transform: dropAnonBodyMember("field"),
  },
  {
    id: "scala/reattribute-anon-field-initializer-call",
    language: "scala",
    defectClass: "misattribution",
    description: "M49/M37 (#866) regression: flattens calls made from an anonymous body onto the enclosing method. scala's own attribution was already correct, so this pins that half of the contract for the language too — Caught by scala/anonymous-field-member's forbid pin on `build -> target` at the initialiser's line.",
    transform: reattributeAnonBodyCall("build"),
  },
  // M49/M37 #867: the anonymous type's OWNER, one pair per JVM language. Both
  // mutants are the measured defect directions, not inventions — (a) is what
  // kotlin actually emitted before the ruling, (b) is the class-level context
  // that agreed by accident and was pinned by nothing.
  {
    id: "java/anon-type-owner-to-class",
    language: "java",
    defectClass: "misattribution",
    description: "M49/M37 (#867) regression: a method-local anonymous type is re-owned to the enclosing CLASS — kotlin's pre-ruling answer, which the census measured and this round ruled out. Caught by java/anonymous-type-owner, which pins `contains inMethod -> anonymous_Comparator` and forbids the class-owned form.",
    transform: reownAnonTypeToClass(),
  },
  {
    id: "java/anon-type-class-owner-stripped",
    language: "java",
    defectClass: "symbol-loss",
    description: "M49/M37 (#867) regression: a CLASS-owned anonymous type loses its owner (the owner-to-type containment edge goes with it). Caught by java/anonymous-type-owner's context-1 pin (`contains AnonOwner -> anonymous_Runnable`), which is the half of the ruling nothing pinned before.",
    transform: stripClassOwnedAnonOwner(),
  },
  {
    id: "groovy/anon-type-owner-to-class",
    language: "groovy",
    defectClass: "misattribution",
    description: "M49/M37 (#867) regression: a method-local anonymous type is re-owned to the enclosing CLASS. Caught by groovy/anonymous-type-owner.",
    transform: reownAnonTypeToClass(),
  },
  {
    id: "groovy/anon-type-class-owner-stripped",
    language: "groovy",
    defectClass: "symbol-loss",
    description: "M49/M37 (#867) regression: a CLASS-owned anonymous type loses its owner. Caught by groovy/anonymous-type-owner's context-1 pin.",
    transform: stripClassOwnedAnonOwner(),
  },
  {
    id: "kotlin/anon-type-owner-to-class",
    language: "kotlin",
    defectClass: "misattribution",
    description: "M49/M37 (#867) regression: reverts the ruling in the language that changed — a method-local anonymous type is owned by the enclosing class again (`pClass`-only walker). Caught by kotlin/anonymous-type-owner, which pins `contains inMethod -> anonymous_Comparator`.",
    transform: reownAnonTypeToClass(),
  },
  {
    id: "kotlin/anon-type-class-owner-stripped",
    language: "kotlin",
    defectClass: "symbol-loss",
    description: "M49/M37 (#867) regression: a CLASS-owned anonymous type loses its owner — the over-reaching fix direction (re-own everything to a method / nothing). Caught by kotlin/anonymous-type-owner's context-1 pin.",
    transform: stripClassOwnedAnonOwner(),
  },
  {
    id: "kotlin/anon-type-claims-file-imports",
    language: "kotlin",
    defectClass: "misattribution",
    description: "M49/M37 (#867) regression, the SECOND defect class the corpus sweep exposed: import reference edges are rewritten onto the file's primary top-level type, and an ownerless anonymous object qualifies — so the anon type claims every import edge of the file (measured pre-ruling on kotlinx-coroutines/reactor/Flux.kt: 8 edges). Caught by kotlin/anon-type-not-file-primary-type's forbid pin.",
    transform: anonTypeClaimsFileImports(),
  },
  {
    id: "scala/anon-type-owner-to-class",
    language: "scala",
    defectClass: "misattribution",
    description: "M49/M37 (#867) regression: a method-local anonymous type is re-owned to the enclosing CLASS. Caught by scala/anonymous-type-owner.",
    transform: reownAnonTypeToClass(),
  },
  {
    id: "scala/anon-type-class-owner-stripped",
    language: "scala",
    defectClass: "symbol-loss",
    description: "M49/M37 (#867) regression: a CLASS-owned anonymous type loses its owner. Caught by scala/anonymous-type-owner's context-1 pin.",
    transform: stripClassOwnedAnonOwner(),
  },
  {
    id: "scala/import-statement-start-line",
    language: "scala",
    defectClass: "line-attribution",
    description: "M59 (#825) regression: an import reference goes back to the line the import STATEMENT starts on, so a target named by a segment written later claims the wrong line — the exact pre-fix behaviour, found on cats-effect TestInstances.scala where the renamed segment `TestInstances => KernelTestkitTestInstances` is nine lines below the `import`. Caught by scala/import-multiline-825 (`scala.collection.mutable` is named on 12, the statement opens on 11).",
    transform: revertImportToStatementStartLine,
  },
  {
    id: "scala/annotation-start-line",
    language: "scala",
    defectClass: "line-attribution",
    description: "M59 (#825) regression: a definition's line goes back to its leading ANNOTATION (tree-sitter-scala starts the definition node at the annotation), so `contains` and the symbol range both land on `@tailrec`/`@deprecated` instead of on `def`/`val` — scala/declaration-lines-825 pins countdown 25 and legacy 29 and FORBIDS 24/28, so the pre-fix positions fail the gate.",
    transform: revertToAnnotationStartLine,
  },
  {
    id: "scala/extends-clause-start-line",
    language: "scala",
    defectClass: "line-attribution",
    description: "M59 (#825) regression: every supertype edge is stamped with the line the `extends` clause OPENED on, so parents written one per line collapse onto the first one's line — scala/declaration-lines-825 pins `with Mixin` 33 / `with Product` 34 and FORBIDS both at 32.",
    transform: revertToClauseStartLine,
  },
  {
    id: "scala/enclosing-type-start-line",
    language: "scala",
    defectClass: "line-attribution",
    description: "M59 (#825) regression: type references are stamped with the line the enclosing type expression opened on instead of the line the type is named — scala/declaration-lines-825 pins List 40 / Option 41 and FORBIDS both at 39.",
    transform: revertToEnclosingTypeLine,
  },
  {
    id: "scala/write-as-read-leak",
    language: "scala",
    defectClass: "relationship-noise",
    description: "injects the SCD1 regression class: assignment LHS leaks as a uses edge (field-uses forbid pin: bump's pure += write must emit nothing)",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { source: "bump", target: "h", type: "uses", confidence: 0.9, metadata: { relationshipType: "expression_use", evidenceClass: "usage_contextual" } }] }),
  },
  {
    id: "scala/throw-target-garbage",
    language: "scala",
    defectClass: "relationship-noise",
    description: "injects the SCD4 regression class: throw references embed raw construction text with the message argument (throw-targets forbid pin)",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { source: "load", target: "new IllegalArgumentException(\"negative: \" + x)", type: "references", confidence: 0.9, metadata: { isThrow: true } }] }),
  },
  {
    id: "scala/abstract-members-loss",
    language: "scala",
    defectClass: "symbol-loss",
    description: "injects the SCD9 regression class: abstract trait fields (val_declaration/var_declaration) silently dropped — abstract-members expect pins must catch it",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).filter((s: any) => !(s.metadata?.isAbstract && (s.kind === "constant" || s.kind === "variable"))) }),
  },
  {
    id: "scala/enum-params-loss",
    language: "scala",
    defectClass: "symbol-loss",
    description: "injects the SCD6 regression class: enum constructor/property symbols dropped (enum-params expect pins)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).filter((s: any) => !(s.kind === "constructor" && s.ownerName === "Planet")) }),
  },
  {
    id: "scala/enum-param-type-root-attribution",
    language: "scala",
    defectClass: "relationship-noise",
    description: "injects the SCD6 KAD6-twin: enum param type refs attributed to the root placeholder instead of the enum (enum-params forbid pin)",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { source: "root", target: "Double", type: "references", confidence: 0.95, metadata: { relationshipType: "declared_type", declaredOn: "class_parameter" } }] }),
  },
  {
    id: "scala/drop-given-refs",
    language: "scala",
    defectClass: "relationship-loss",
    description: "injects the SCD12 regression class: given definitions emit no type references (given_type edges dropped)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => x.metadata?.relationshipType !== "given_type") }),
  },
  {
    id: "scala/text-substring-pattern-fabrication",
    language: "scala",
    defectClass: "metadata-fabrication",
    description: "injects the SCD5 regression class: text.includes substring pattern flags fabricated from unrelated identifiers (annotation-flags expectPatterns must catch the leak of the trap shape)",
    transform: r => {
      const md: any = { ...(r.metadata ?? {}), patterns: [...((r.metadata as any)?.patterns ?? []), "Annotations"] }
      return { ...r, metadata: md }
    },
  },
  {
    id: "scala/complexity-arm-double-count",
    language: "scala",
    defectClass: "metric-drift",
    description: "injects the SCD10 wrapper-double-count regression class: match/try/catch wrappers counted on top of arms (complexity-parity + f6-coverage-wave pins)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map(s => (s.name === "f" || s.name === "raise" ? { ...s, complexity: (s.complexity ?? 1) + 1 } : s)) }),
  },
  {
    id: "scala/curried-qualified-calls-dup",
    language: "scala",
    defectClass: "payload-noise",
    description: "injects the SCD7 regression class: curried application wrappers double-push the qualified_calls path (SCD7 probe showed List.fill/self.add doubled pre-fix)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map(s => ((s as any).qualified_calls ? { ...s, qualified_calls: [...(s as any).qualified_calls, ...(s as any).qualified_calls] } : s)) }),
  },
  {
    id: "scala/spring-detection-loss",
    language: "scala",
    defectClass: "framework-loss",
    description: "M49 #741 (CONV-S-1) regression: the Spring entries are removed from detectedFrameworks again — scala reverts to being the only JVM language blind to Spring (scala/framework-detection expectFrameworks pins it; framework payload derives no oracle truth, so the fixture is the only gate)",
    transform: r => {
      const md: any = r.metadata ?? {}
      const kept = (md.detectedFrameworks ?? []).filter((f: string) => !f.startsWith("Spring") && f !== "Jackson" && f !== "jsoniter-scala" && f !== "sttp")
      return { ...r, metadata: { ...md, detectedFrameworks: kept } }
    },
  },
  {
    id: "scala/framework-substring-fabrication",
    language: "scala",
    defectClass: "framework-fabrication",
    description: "M49 #741 negative-direction regression: fabricates a framework the fixture forbids, emulating a detector that matches a root as a SUBSTRING rather than a module-path prefix (the user-code imports com.mycompany.springframework.* / mycats.* / org.springlike.* would then fabricate frameworks). Only scala/framework-detection's forbidFrameworks pin can catch it - expectFrameworks is must-include and would pass",
    transform: r => {
      const md: any = r.metadata ?? {}
      return { ...r, metadata: { ...md, detectedFrameworks: [...(md.detectedFrameworks ?? []), "Play Framework"] } }
    },
  },
  {
    id: "scala/drop-typeParameters",
    language: "scala",
    defectClass: "symbol-payload-loss",
    description: "strips genericParameters from every symbol (the #383c bug class)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map(s => {
        const clean = { ...s, genericParameters: undefined }
        if (clean.metadata) { delete clean.metadata.typeParameters }
        return clean
      }) }),
  },
  {
    id: "scala/callee-method-value-leak",
    language: "scala",
    defectClass: "relationship-noise",
    description: "injects the M37 TSD6-sweep regression class: a dead call-position skip (n.parent.childForFieldName === n, never true for wrappers) leaks call callees as bogus method_value references — method-value-refs forbid pin must catch it",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), ...(r.relationships ?? []).filter((x: any) => x.type === "calls").map((x: any) => ({ ...x, type: "references", metadata: { ...(x.metadata ?? {}), relationshipType: "method_value" } }))] }),
  },
  {
    id: "scala/drop-decorators",
    language: "scala",
    defectClass: "annotation-loss",
    description: "clears decorators from every symbol (annotation-driven detection regression)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map(s => ({ ...s, decorators: [] })) }),
  },
  {
    id: "scala/drop-docstrings",
    language: "scala",
    defectClass: "docstring-loss",
    description: "clears comments arrays (KDoc/ScalaDoc loss family)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map(s => ({ ...s, comments: [] })) }),
  },
  {
    id: "java/drop-declared-types",
    language: "java",
    defectClass: "relationship-loss",
    description: "drops all declared_type references (the silent type-usage-graph bug class fixed in M14)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => x.metadata?.relationshipType !== "declared_type") }),
  },
  {
    id: "java/drop-initializer-calls",
    language: "java",
    defectClass: "relationship-loss",
    description: "drops Calls edges attributed to initializer/field-init/enum-body scopes (#419 G4 bug class)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(x.metadata ?? {}).inInitializer) }),
  },
  {
    id: "java/drop-array-access",
    language: "java",
    defectClass: "relationship-loss",
    description: "drops Uses edges for array reads/writes (#419 G1 bug class)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(x.metadata ?? {}).isArrayAccess) }),
  },
  {
    id: "java/drop-bare-member-reads",
    language: "java",
    defectClass: "relationship-loss",
    description: "drops Uses edges for BARE identifier member reads (#739 CONV-J-1: `return count;` on a declared field emitted nothing while `return this.count;` did; caught by the bare-member-read-uses fixture's expectRelationships)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(x.metadata ?? {}).isBareRead) }),
  },
  {
    id: "java/bare-read-type-attribution",
    language: "java",
    defectClass: "attribution-corruption",
    description: "re-sources bare member reads from the enclosing METHOD to the enclosing TYPE (the M49 W15 #814 rule moved java/swift to METHOD source family-wide) — caught by the bare-member-read-uses fixture, which expects from=bare/dotted",
    transform: r => {
      const ownerOf = new Map<string, string>()
      for (const s of r.symbols ?? []) {
        if (s.ownerName) ownerOf.set(s.name, s.ownerName)
      }
      return {
        ...r,
        relationships: (r.relationships ?? []).map(x =>
          (x.metadata ?? {}).isBareRead && ownerOf.has(String(x.source))
            ? { ...x, source: ownerOf.get(String(x.source))! }
            : x,
        ),
      }
    },
  },
  {
    id: "java/drop-ctor-delegation",
    language: "java",
    defectClass: "relationship-loss",
    description: "drops Calls edges for super()/this() constructor delegation (#419 G2 bug class)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => (x.metadata ?? {}).relationshipType !== "constructor_invocation") }),
  },
  {
    id: "java/drop-record-patterns",
    language: "java",
    defectClass: "relationship-loss",
    description: "drops References edges for record patterns (#419 G3 bug class)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => (x.metadata ?? {}).relationshipType !== "record_pattern") }),
  },
  {
    id: "java/emit-write-as-read",
    language: "java",
    defectClass: "fabrication",
    description: "regresses JAD1: assignment-LHS field/array writes emit uses edges (this.x = v -> uses x) — the write-as-read bug class",
    transform: r => ({
      ...r,
      relationships: [...(r.relationships ?? []), {
        type: "uses", source: "ArrayAccessUses", target: "xs", fromSymbol: "ArrayAccessUses", toSymbol: "xs", confidence: 0.6, metadata: { isFieldAccess: true },
      }],
    }),
  },
  {
    id: "java/type-sourced-member-reads",
    language: "java",
    defectClass: "relationship-loss",
    description: "regresses JAD2: member reads re-owned by the enclosing TYPE instead of the method (two walks, two owners) — f->xs pin dies",
    transform: r => ({
      ...r,
      relationships: (r.relationships ?? []).map(x =>
        (x.metadata ?? {}).isArrayAccess && x.source === "f" ? { ...x, source: "ArrayAccessUses" } : x),
    }),
  },
  {
    id: "java/drop-import-edges",
    language: "java",
    defectClass: "relationship-loss",
    description: "drops the imports dependency edges (isJavaImport references) — #419 section B imports pin",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(x.metadata ?? {}).isJavaImport) }),
  },
  {
    id: "java/drop-parameters",
    language: "java",
    defectClass: "payload-loss",
    description: "drops the parameters payload from method symbols — #383 Matrix 1b parameters pin (java cell PENDING -> #383)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => ({ ...s, parameters: undefined })) }),
  },
  {
    id: "java/reclassify-import-tier",
    language: "java",
    defectClass: "evidence-mislabel",
    description: "reclassifies import edges from import_based back to reference_qualified (the JVM-family tier bug: classifier ignored isJavaImport)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map((x: any) => (x.metadata ?? {}).isJavaImport ? { ...x, metadata: { ...x.metadata, evidenceClass: "reference_qualified" } } : x) }),
  },
  {
    id: "kotlin/drop-declared-types",
    language: "kotlin",
    defectClass: "relationship-loss",
    description: "drops declared_type/return_type/as/check references (silent type-usage-graph bug class)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !["declared_type", "return_type", "as_expression", "check_expression"].includes(String(x.metadata?.relationshipType))) }),
  },
  {
    id: "kotlin/drop-expression-uses",
    language: "kotlin",
    defectClass: "relationship-loss",
    description: "drops expression-level Uses (the K1 indexing + K4 string-template bug class: xs[i] and \"hi $name\" reads were invisible before the #419 pass)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(x.metadata?.relationshipType === "expression_use")) }),
  },
  {
    id: "kotlin/drop-ctor-delegation",
    language: "kotlin",
    defectClass: "relationship-loss",
    description: "drops constructor_delegation_call edges (the K2 bug class: super(...)/this(...) delegation emitted no Calls)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(x.metadata?.relationshipType === "constructor_invocation")) }),
  },
  {
    id: "kotlin/drop-callable-refs",
    language: "kotlin",
    defectClass: "relationship-loss",
    description: "drops callable_reference type references (the K3 bug class: Foo::bar emitted no reference to Foo)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(x.metadata?.relationshipType === "callable_reference")) }),
  },
  {
    id: "kotlin/drop-type-alias-refs",
    language: "kotlin",
    defectClass: "relationship-loss",
    description: "drops type_alias RHS references (the K5 bug class: typealias Fn = (Int) -> String referenced nothing)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(x.metadata?.relationshipType === "type_alias")) }),
  },
  {
    id: "kotlin/drop-type-alias-symbols",
    language: "kotlin",
    defectClass: "symbol-loss",
    description: "drops type_alias symbols (the K5 bug class: typealias declarations were completely invisible)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).filter(s => !s.metadata?.isTypeAlias) }),
  },
  {
    id: "kotlin/drop-bare-member-reads",
    language: "kotlin",
    defectClass: "relationship-loss",
    description: "drops Uses edges for BARE/DOTTED member reads (#740 CONV-K-1: `return x` and `return this.x` both emitted ZERO uses while only the indexing and template forms were ever claimed) — caught by the bare-member-read-uses fixture's expectRelationships (bare/dotted/plus/callee/read/bump)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !((x.metadata ?? {}).isBareRead)) }),
  },
  {
    id: "kotlin/bare-read-gate-bypass",
    language: "kotlin",
    defectClass: "relationship-fabrication",
    description: "#740 gate regression: re-injects the four edges the gates exist to stop — uses(write->count) (assignment LHS is a write), uses(shadow->count) (a local the function binds, CGD15 gate B), uses(callee->go) (a bare CALLEE belongs to the call graph) and uses(read->leaf) (a chain mid/leaf belonging to ANOTHER type, gate A) — caught by the bare-member-read-uses fixture's forbidRelationships",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { type: "uses", source: "write", target: "count", confidence: 0.6, metadata: { isBareRead: true } }, { type: "uses", source: "shadow", target: "count", confidence: 0.6, metadata: { isBareRead: true } }, { type: "uses", source: "callee", target: "go", confidence: 0.6, metadata: { isBareRead: true } }, { type: "uses", source: "read", target: "leaf", confidence: 0.6, metadata: { isBareRead: true } }] }),
  },
  {
    id: "kotlin/bare-read-owner-attribution",
    language: "kotlin",
    defectClass: "attribution-corruption",
    description: "re-sources member reads from the enclosing METHOD to the enclosing TYPE (the family rule is METHOD source — java JAD2 / swift #814 both moved to it) — caught by the bare-member-read-uses fixture, which expects from=bare/dotted/plus/callee/read/bump",
    transform: r => {
      const ownerOf = new Map<string, string>()
      for (const s of r.symbols ?? []) {
        if (s.ownerName) ownerOf.set(s.name, s.ownerName)
      }
      return {
        ...r,
        relationships: (r.relationships ?? []).map(x =>
          (x.metadata ?? {}).isBareRead && ownerOf.has(String(x.source))
            ? { ...x, source: ownerOf.get(String(x.source)) }
            : x,
        ),
      }
    },
  },
  {
    id: "kotlin/drop-anonymous-objects",
    language: "kotlin",
    defectClass: "symbol-loss",
    description: "drops anonymous object symbols (the K6 bug class: object : Runner { } had no symbol and misattributed go() to the enclosing class)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).filter(s => !s.metadata?.isAnonymousObject) }),
  },
  {
    id: "kotlin/drop-object-literal-refs",
    language: "kotlin",
    defectClass: "relationship-loss",
    description: "drops object_literal supertype references (the K6 bug class: anonymous objects referenced their implemented type nowhere)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(x.metadata?.relationshipType === "object_literal")) }),
  },
  {
    id: "kotlin/global-attribution",
    language: "kotlin",
    defectClass: "relationship-mislabel",
    description: "reverts class-level call attribution to the bogus Global placeholder (the K7 bug class: init blocks and property initializers attributed to Global)",
    transform: r => {
      const classNames = new Set((r.symbols ?? []).filter((s: any) => (s.kind === "class" || s.kind === "interface") && !s.ownerName).map((s: any) => s.name))
      return { ...r, relationships: (r.relationships ?? []).map((x: any) => (x.metadata ?? {}).kotlinSpecific && classNames.has(x.source) ? { ...x, source: "Global" } : x) }
    },
  },
  {
    id: "kotlin/reclassify-import-tier",
    language: "kotlin",
    defectClass: "evidence-mislabel",
    description: "reclassifies import edges from import_based back to reference_qualified (the K8 JVM-family tier bug: classifier ignored isImportDep)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map((x: any) => (x.metadata ?? {}).isImportDep ? { ...x, metadata: { ...x.metadata, evidenceClass: "reference_qualified" } } : x) }),
  },
  {
    id: "kotlin/drop-instantiates",
    language: "kotlin",
    defectClass: "relationship-loss",
    description: "drops Instantiates edges (pins the Matrix 1b instantiates cell — kotlin has no 'new' keyword; Widget() is the construction heuristic)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => String(x.type ?? x.relationshipType) !== "instantiates") }),
  },
  {
    id: "kotlin/strip-parameters",
    language: "kotlin",
    defectClass: "symbol-payload-loss",
    description: "strips the parameters payload from every symbol (pins the Matrix 1b parameters cell for kotlin)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map(s => ({ ...s, parameters: undefined })) }),
  },
  {
    id: "kotlin/strip-visibility",
    language: "kotlin",
    defectClass: "symbol-payload-loss",
    description: "flattens every symbol to public visibility (pins the Matrix 1b visibility cell for kotlin)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map(s => ({ ...s, visibility: "public" })) }),
  },
  {
    id: "kotlin/clear-comments",
    language: "kotlin",
    defectClass: "docstring-loss",
    description: "clears comments arrays (pins the Matrix 1b docstrings cell for kotlin — the M14.1 KDoc fix)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map(s => ({ ...s, comments: [] })) }),
  },
  {
    id: "kotlin/write-as-read-uses",
    language: "kotlin",
    defectClass: "relationship-noise",
    description: "injects the KAD1 regression class: assignment-LHS indexing leaks a uses edge for the receiver (pre-fix `xs[i] = 42` emitted uses; oracle derives no kotlin uses truth so F5 is blind)",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), ...(r.relationships ?? []).filter((x: any) => x.metadata?.relationshipType === "expression_use").map((x: any) => ({ ...x, source: "write" }))] }),
  },
  {
    id: "kotlin/kdoc-contamination",
    language: "kotlin",
    defectClass: "docstring-misattribution",
    description: "injects the KAD2 regression class: the first doc leaks onto every subsequent doc-less declaration (dead `sibling === node` forward scan)",
    transform: r => {
      const firstDoc = (r.symbols ?? []).find((s: any) => (s.comments ?? []).length > 0)?.comments?.[0]
      if (!firstDoc) return r
      return { ...r, symbols: (r.symbols ?? []).map((s: any) => ({ ...s, comments: [firstDoc] })) }
    },
  },
  {
    id: "kotlin/accessor-text-fallback",
    language: "kotlin",
    defectClass: "payload-fabrication",
    description: "injects the KAD4 regression class: text-based metadata flags (get()/set(/by substring) fabricate hasCustomGetter/hasCustomSetter/hasDelegate)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => s.kind === "property" ? { ...s, metadata: { ...(s.metadata ?? {}), hasCustomGetter: true, hasCustomSetter: true, hasDelegate: true } } : s) }),
  },
  {
    id: "kotlin/receiver-ref-loss",
    language: "kotlin",
    defectClass: "relationship-loss",
    description: "injects the KAD3 regression class: extension-receiver types emit no reference (the user_type-only walk was dead against receiver_type wrappers)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !(x.source === "shout" && x.target === "String" && x.metadata?.relationshipType === "declared_type")) }),
  },
  {
    id: "kotlin/return-type-global",
    language: "kotlin",
    defectClass: "relationship-mislabel",
    description: "injects the KAD6 regression class: declaration-position references sourced to the Global placeholder (pre-fix top-level return types)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map((x: any) => x.source === "m" && x.metadata?.relationshipType === "return_type" ? { ...x, source: "Global" } : x) }),
  },
  {
    id: "java/javadoc-leak",
    language: "java",
    defectClass: "docstring-misattribution",
    description: "injects the KAD2-sweep regression class: the first javadoc leaks onto every subsequent declaration (dead `sibling === node` forward scan)",
    transform: r => {
      const firstDoc = (r.symbols ?? []).find((s: any) => (s.comments ?? []).length > 0)?.comments?.[0]
      if (!firstDoc) return r
      return { ...r, symbols: (r.symbols ?? []).map((s: any) => ({ ...s, comments: [firstDoc] })) }
    },
  },
  {
    id: "java/drop-unannotated-overrides",
    language: "java",
    defectClass: "relationship-loss",
    description: "JAO1 regression: re-gates overrides behind the @Override annotation (un-annotated DerivedThing.total silently loses its override edge) — implicit-overrides fixture pins DerivedThing.total -> BaseThing.total",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) =>
      !(x.type === "overrides" && x.target === "BaseThing.total")) }),
  },
  {
    id: "java/overload-paired-as-override",
    language: "java",
    defectClass: "fabrication",
    description: "JAO2 regression: injects the name-only truth bug class — DerivedThing.find(int, String) pairs against BaseThing.find(int) as an override — implicit-overrides forbid pin",
    transform: r => ({ ...r, relationships: [
      ...(r.relationships ?? []),
      { type: "overrides", source: "DerivedThing.find", target: "BaseThing.find", fromSymbol: "DerivedThing.find", toSymbol: "BaseThing.find", confidence: 1.0, metadata: { relationshipType: "method_override", isJavaOverride: true, reasonCode: "exact-in-file", evidenceClass: "structural" } },
    ] }),
  },
  {
    id: "scala/anonymous-body-scope-leak",
    language: "scala",
    defectClass: "payload-corruption",
    description: "ScalaD-D regression: reverts the anonymous-class-body parent push — run re-attributes to the enclosing class (contains Service->run) and the anonymous_Runnable symbol vanishes — anonymous-body-scope pins catch both",
    transform: r => ({ ...r,
      symbols: (r.symbols ?? []).filter((s: any) => !String(s.name).startsWith("anonymous_")),
      relationships: (r.relationships ?? []).map((x: any) =>
        (x.type === "contains" && x.target === "run") ? { ...x, source: "Service" } : x),
    }),
  },
  {
    id: "java/org-com-root-refilter",
    language: "java",
    defectClass: "relationship-loss",
    description: "M49.J3 regression: re-applies the bare org/com stdlib roots (the pre-fix behavior the reviewer caught — C5 changed the mechanism to root-only but left org/com in the set, silently dropping every FQ third-party call like org.apache.commons.io.FileUtils.readFile) — fq-third-party-calls pins the emitted edges and dies",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) =>
      !(x.type === "calls" && /^\s*(org|com)\./.test(String(x.metadata?.javaCallExpression ?? "")))) }),
  },
  {
    id: "kotlin/enum-supertype-drop",
    language: "kotlin",
    defectClass: "relationship-loss",
    description: "KD19 regression: reverts extractEnumClass superTypes extraction — enum class Direction(...) : Mode silently drops its implements edge (and enum class Counted : Numbered(1) its extends) — enum-supertype-heritage pins catch both",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) =>
      !((x.type === "implements" || x.type === "extends") && (x.source === "Direction" || x.source === "Counted"))) }),
  },
  {
    id: "kotlin/override-verification-downgrade",
    language: "kotlin",
    defectClass: "relationship-loss",
    description: "M49.K1 K2 regression: reverts the in-file BFS verification — every override collapses back to the first-supertype guess at 0.5/inferred/first-supertype-guess — override-fallback-confidence (Impl.render vs in-file Base) requires 0.9/structural/in-file-verified, so the downgrade dies",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map((x: any) =>
      x.type === "overrides" && x.metadata?.reasonCode === "in-file-verified"
        ? { ...x, confidence: 0.5, metadata: { ...x.metadata, reasonCode: "first-supertype-guess", evidenceClass: "inferred", overrideSig: undefined } }
        : x) }),
  },
  {
    id: "kotlin/override-name-blind-pairing",
    language: "kotlin",
    defectClass: "fabrication",
    description: "M49.K1 K2 regression: injects the name-blind declSigs bug class — SubBroadcastChannel.send verifies against BroadcastChannel (which declares only cancel/sendSuspend, NEVER send) because some member's sig matched — the name-keyed index forbids it; the corpus sample forbids pin ensures zero unexplained overrides on kotlinx-coroutines",
    transform: r => ({ ...r, relationships: [
      ...(r.relationships ?? []),
      { type: "overrides", source: "SubBroadcastChannel.send", target: "BroadcastChannel.send", fromSymbol: "SubBroadcastChannel.send", toSymbol: "BroadcastChannel.send", confidence: 0.9, metadata: { isOverride: true, overrideParent: "BroadcastChannel", reasonCode: "in-file-verified", evidenceClass: "structural", overrideSig: "(T)" } },
    ] }),
  },
  {
    id: "kotlin/override-sig-payload-drop",
    language: "kotlin",
    defectClass: "payload-corruption",
    description: "M49.K1 K4 regression: drops the metadata.overrideSig signature payload from override edges — overload disambiguation downstream dies; the K4 claim-probe re-pin and override-fallback-confidence's sig expectations catch it",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map((x: any) =>
      x.type === "overrides" ? { ...x, metadata: { ...x.metadata, overrideSig: undefined } } : x) }),
  },
  {
    id: "java/type-source-revert",
    language: "java",
    defectClass: "attribution",
    description: "M49 W15 #814 regression: re-attributes every field read to the enclosing TYPE (the pre-ruling JAD2 `this`/`super` exception) — java/member-read-source forbids the type-sourced spelling, which under the old rule was indistinguishable from the write spelling",
    transform: revertToTypeSource,
  },
  {
    id: "java/anonymous-body-scope-leak",
    language: "java",
    defectClass: "payload-corruption",
    description: "JD18 regression: reverts the anonymous-class-body scope push — compare/run re-attribute to the enclosing class (contains Service->compare) and the anonymous_Comparator symbol vanishes — anonymous-and-multihop-overrides pins catch both",
    transform: r => ({ ...r,
      symbols: (r.symbols ?? []).filter((s: any) => !String(s.name).startsWith("anonymous_")),
      relationships: (r.relationships ?? []).map((x: any) =>
        (x.type === "contains" && (x.target === "compare" || x.target === "run")) ? { ...x, source: "Service" } : x),
    }),
  },
  {
    id: "java/override-multihop-bare-name",
    language: "java",
    defectClass: "relationship-loss",
    description: "JD19 regression: reverts the suffix-resolved hierarchy walk — overrides through a non-declaring ancestor (BlackVal.val -> Node.val, BlackBranch.left -> Node.left) drop because hop-2 looks up classHierarchy with the bare name — anonymous-and-multihop-overrides pins catch them",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) =>
      !(x.type === "overrides" && ((x.source === "BlackVal.val" && x.target === "Node.val") || (x.source === "BlackBranch.left" && x.target === "Node.left") || (x.source === "BlackBranchVal.val" && x.target === "Node.val")))) }),
  },
  {
    id: "java/return-type-refs-drop",
    language: "java",
    defectClass: "relationship-loss",
    description: "C9 regression: drops declared_type references emitted from return positions (declaredOn=return_type) — the pre-fix gap where List<User> getUsers() produced zero edges to List/User — type-usage-graph's R pin catches it",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) =>
      !(String(x.type) === "references" && x.metadata?.declaredOn === "return_type")) }),
  },
  {
    id: "java/per-segment-builtin-filter",
    language: "java",
    defectClass: "relationship-loss",
    description: "C5 regression: re-applies the pre-fix PER-SEGMENT stdlib check over emitted calls (metadata.callExpression segments vs the root list — mirrors the old isJavaBuiltin) so mid-chain collisions (A.Logger.bar on segment Logger) drop as stdlib — root-segment-builtin-filter pins catch it",
    transform: r => {
      // Representative JAVA_STDLIB_ROOTS subset (differential.ts JAVA_STDLIB_ROOTS mirror):
      const roots = new Set(["Logger", "com", "org", "System", "Math", "java", "javax"])
      return { ...r, relationships: (r.relationships ?? []).filter((x: any) => {
        if (String(x.type) !== "calls") return true
        const ce = x.metadata?.javaCallExpression ?? x.metadata?.callExpression
        if (!ce) return true
        const ceText = String(ce)
        const paren = ceText.indexOf("(")
        const head = paren !== -1 ? ceText.slice(0, paren) : ceText
        for (const seg of head.split(".")) if (roots.has(seg)) return false
        return true
      }) }
    },
  },
  {
    id: "java/drop-arity-payload",
    language: "java",
    defectClass: "payload-corruption",
    description: "M49 R3 regression: strips metadata.argumentCount from method_invocation calls edges — overloads sharing the JD20 bare leaf (process(String) vs process(int)) become fully indistinguishable downstream — overload-arity-varargs-multicatch pins catch it",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map((x: any) =>
      String(x.type) === "calls" && x.metadata?.argumentCount !== undefined
        ? { ...x, metadata: { ...x.metadata, argumentCount: undefined } } : x) }),
  },
  {
    id: "java/varargs-sig-not-normalized",
    language: "java",
    defectClass: "relationship-loss",
    description: "M49 R3 regression: breaks the JLS 8.4.1 int.../int[] signature equivalence — drop-arity variant simulates the pre-normalization shape by stripping the spread parameter's array marker so cross-varargs overrides fail the exact-signature BFS — overload-arity-varargs-multicatch overrides pins catch it",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) =>
      !(String(x.type) === "overrides" && (x.source === "VarSub.foo" || x.source === "ArrSub.bar"))) }),
  },
  {
    id: "java/member-export-restore",
    language: "java",
    defectClass: "payload-corruption",
    description: "M49 exports-family regression: restores JAD3 member exports (interface/class members re-enter the export list) — multi-interface-extends fixture now forbids the member shape via the F3 export invariant (member names are not importable units; duplicates like greet/greet kill the uniqueness half)",
    transform: r => ({ ...r, exports: [...(r.exports ?? []), ...(r.relationships ?? [])
      .filter((x: any) => x.type === "contains")
      .map((x: any) => ({ name: x.target, isDefault: false }))
      .filter((e: any, i: number, a: any[]) => a.findIndex((z: any) => z.name === e.name) === i)] }),
  },
  {
    id: "scala/drop-keywordless-abstract-impl",
    language: "scala",
    defectClass: "relationship-loss",
    description: "ScalaD-A regression: re-gates overrides behind the `override` keyword (keywordless ImplA.value/ImplB.value implementations of abstract BaseTrait.value lose their edges) — implicit-overrides fixture pins",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) =>
      !((x.type === "overrides" && (x.source === "ImplA.value" || x.source === "ImplB.value") && x.target === "BaseTrait.value"))) }),
  },
  {
    id: "scala/first-supertype-guess-override",
    language: "scala",
    defectClass: "fabrication",
    description: "ScalaD-B regression: injects the old first-supertype GUESS (keyworded ImplB.doubled -> Mid.doubled @0.5 even though Mid never declares doubled) — implicit-overrides forbid pin",
    transform: r => ({ ...r, relationships: [
      ...(r.relationships ?? []),
      { type: "overrides", source: "ImplB.doubled", target: "Mid.doubled", fromSymbol: "ImplB.doubled", toSymbol: "Mid.doubled", confidence: 0.5, metadata: { isOverride: true, overrideParent: "Mid", reasonCode: "first-supertype-guess", evidenceClass: "inferred" } },
    ] }),
  },
  {
    id: "groovy/groovydoc-leak",
    language: "groovy",
    defectClass: "docstring-misattribution",
    description: "injects the KAD2-sweep regression class: first-GroovyDoc leak onto doc-less declarations",
    transform: r => {
      const firstDoc = (r.symbols ?? []).find((s: any) => (s.comments ?? []).length > 0)?.comments?.[0]
      if (!firstDoc) return r
      return { ...r, symbols: (r.symbols ?? []).map((s: any) => ({ ...s, comments: [firstDoc] })) }
    },
  },
  {
    id: "scala/scaladoc-leak",
    language: "scala",
    defectClass: "docstring-misattribution",
    description: "injects the KAD2-sweep regression class: first-ScalaDoc leak onto doc-less declarations",
    transform: r => {
      const firstDoc = (r.symbols ?? []).find((s: any) => (s.comments ?? []).length > 0)?.comments?.[0]
      if (!firstDoc) return r
      return { ...r, symbols: (r.symbols ?? []).map((s: any) => ({ ...s, comments: [firstDoc] })) }
    },
  },
  {
    id: "groovy/read-attribution-to-receiver",
    language: "groovy",
    defectClass: "attribution-corruption",
    description: "GAD1 regression: reverts JAD2 method-scope attribution — field reads source to the receiver variable (cfg.limit -> uses cfg) — groovy field-read attribution pins catch it",
    transform: r => ({
      ...r,
      relationships: [...(r.relationships ?? []), {
        type: "uses", source: "cfg", target: "limit", isExternal: true, weight: 1, confidence: 0.6, metadata: { isFieldAccess: true },
      }],
    }),
  },
  {
    id: "groovy/script-sentinel-split",
    language: "groovy",
    defectClass: "attribution-corruption",
    description: "GAD2 regression: re-splits script sentinels — instantiates under global/ root instead of (script) — script-methods pins catch it",
    transform: r => ({
      ...r,
      relationships: [...(r.relationships ?? []), {
        type: "instantiates", source: "global", target: "Deployer", isExternal: true, weight: 1, confidence: 0.95, metadata: { relationshipType: "instantiates", isNew: true },
      }],
    }),
  },
  {
    id: "groovy/text-visibility-fabrication",
    language: "groovy",
    defectClass: "payload-corruption",
    description: "GAD3 regression: re-adds raw-text substring visibility (leak() fabricates private from a string literal) — visibility pin catches it",
    transform: r => ({
      ...r,
      symbols: (r.symbols ?? []).map(s => s.name === "leak" ? { ...s, visibility: "private" } : s),
    }),
  },
  {
    id: "groovy/keyword-modifiers-blind",
    language: "groovy",
    defectClass: "payload-loss",
    description: "GAD6 regression: modifiers node iterates named children only — keyword-only declarations lose isStatic/isConstant/private (hidden() flips public) — visibility pins catch it",
    transform: r => ({
      ...r,
      symbols: (r.symbols ?? []).map(s => s.name === "hidden" ? { ...s, visibility: "public" } : s),
    }),
  },
  {
    id: "groovy/modifier-return-type-loss",
    language: "groovy",
    defectClass: "relationship-loss",
    description: "GAD5 regression: return-type collection breaks on modifiers — public String greet() loses its return_type ref — script-methods/type-usage pin catches it",
    transform: r => ({
      ...r,
      relationships: (r.relationships ?? []).filter(x => !((x.metadata ?? {}).relationshipType === "return_type" && x.source === "greet")),
    }),
  },
  {
    id: "groovy/array-write-uses",
    language: "groovy",
    defectClass: "relationship-noise",
    description: "injects the KAD1-sweep regression class: assignment-LHS array_access leaks a uses edge (the pre-fix emission the old fixture pinned as Groovy semantics)",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), ...(r.relationships ?? []).filter((x: any) => x.metadata?.isArrayAccess).map((x: any) => ({ ...x, source: "store" }))] }),
  },
  {
    id: "groovy/return-type-mislabel",
    language: "groovy",
    defectClass: "relationship-mislabel",
    description: "injects the KAD6-sweep regression class: return-type refs revert to declared_type and re-source to the enclosing class",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map((x: any) => x.metadata?.relationshipType === "return_type" ? { ...x, source: "TypeGraph", metadata: { ...x.metadata, relationshipType: "declared_type" } } : x) }),
  },
  {
    id: "groovy/drop-declared-types",
    language: "groovy",
    defectClass: "relationship-loss",
    description: "drops declared_type/throws_type references (silent type-usage-graph bug class)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !["declared_type", "throws_type", "instanceof_expression"].includes(String(x.metadata?.relationshipType))) }),
  },
  {
    id: "scala/drop-declared-types",
    language: "scala",
    defectClass: "relationship-loss",
    description: "drops declared_type/throws/cast/check references (silent type-usage-graph bug class)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !["declared_type", "return_type", "throws_type", "cast_target", "instanceof_check"].includes(String(x.metadata?.relationshipType))) }),
  },
  {
    id: "scala/reclassify-import-tier",
    language: "scala",
    defectClass: "tier-misclassification",
    description: "reverts import edges to the old reference_qualified tier (the JVM-family isImportDep bug class)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map(x => x.metadata?.isImportDep ? { ...x, metadata: { ...x.metadata, isImportDep: undefined, evidenceClass: "reference_qualified" } } : x) }),
  },
  {
    id: "scala/drop-import-source-rewrite",
    language: "scala",
    defectClass: "relationship-loss",
    description: "reverts the import source rewrite to the root placeholder (G1 half 2)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map(x => x.metadata?.isImportDep && x.source !== "root" ? { ...x, source: "root" } : x) }),
  },
  {
    id: "scala/drop-pattern-refs",
    language: "scala",
    defectClass: "relationship-loss",
    description: "drops typed_pattern/case_class_pattern references (pattern-match type-usage gap)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => x.metadata?.relationshipType !== "pattern_type") }),
  },
  {
    id: "scala/drop-method-value-refs",
    language: "scala",
    defectClass: "relationship-loss",
    description: "drops method_value references (Foo.bar loses its Foo ref)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => x.metadata?.relationshipType !== "method_value") }),
  },
  {
    id: "scala/drop-expression-uses",
    language: "scala",
    defectClass: "relationship-loss",
    description: "drops uses edges (interpolation + field-access Uses gap)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => x.type !== "uses") }),
  },
  {
    id: "scala/drop-tuple-refs",
    language: "scala",
    defectClass: "relationship-loss",
    description: "drops return_type refs whose function returns a tuple_type (G5)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(x.metadata?.relationshipType === "return_type" && x.metadata?.declaredOn === "function_definition" && ["pair", "both"].includes(String(x.source)))) }),
  },
  {
    id: "scala/drop-derives-refs",
    language: "scala",
    defectClass: "relationship-loss",
    description: "drops derives_type references (derives Show/Hashing gap)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => x.metadata?.relationshipType !== "derives_type") }),
  },
  {
    id: "scala/drop-type-alias-refs",
    language: "scala",
    defectClass: "relationship-loss",
    description: "drops type_alias references (type X = ... RHS types gap)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => x.metadata?.relationshipType !== "type_alias") }),
  },
  {
    id: "scala/drop-self-type-ref",
    language: "scala",
    defectClass: "relationship-loss",
    description: "drops self_type references (self: Service => gap)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => x.metadata?.relationshipType !== "self_type") }),
  },
  {
    id: "scala/drop-parameters",
    language: "scala",
    defectClass: "payload-loss",
    description: "drops the parameters payload from method symbols — #383 Matrix 1b parameters pin",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => ({ ...s, parameters: undefined })) }),
  },
  {
    id: "scala/revert-generic-substitution-fallback",
    language: "scala",
    defectClass: "relationship-loss",
    description: "ScalaD-H regression: reverts the analyzer's generic-substitution override fallback — trait methods declared under type variables (def to(t: T)) no longer pair with substituted implementations (def to(t: AABB)); generic-substitution-overrides expects 4 Codec override pins",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(x.type === "overrides" && (x.source.includes("Codec") || x.source.includes("StringCodec")))) }),
  },
  {
    id: "scala/companion-export-dedupe-revert",
    language: "scala",
    defectClass: "payload-corruption",
    description: "M49 exports-family regression: companion objects re-enter the export list even when a same-name type export exists (class Service + object Service => exports ['Service','Service']) — companion-object fixture pins the deduped shape via the F3 export-uniqueness gate",
    transform: r => ({ ...r, exports: [...(r.exports ?? []), { name: "Service", kind: "module", isDefault: false }] }),
  },
  {
    id: "scala/drop-companion-qualified-instantiates",
    language: "scala",
    defectClass: "relationship-loss",
    description: "M49.S1 regression: handleInstantiation reverts to dropping qualified constructor targets (TrieMapLike.MangledHashing) — companion-qualified constructions vanish from the graph",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(x.type === "instantiates" && x.target.includes("."))) }),
  },
  {
    id: "scala/enum-heritage-drop",
    language: "scala",
    defectClass: "relationship-loss",
    description: "M49.S1 regression: reverts the enum extends_clause heritage fix — enum Color(val hex: Int) extends Serializable loses its extends edge (both sides were blind before; the shared-blind-spot class). heritage-and-qualified-construction expects Color -> Serializable",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(x.type === "extends" && x.source === "Color" && x.target === "Serializable")) }),
  },
  {
    id: "groovy/heritage-typeargs-revert",
    language: "groovy",
    defectClass: "relationship-garbage",
    description: "M49.S1 regression: heritage targets revert to the grammar's raw folded token text (Cache -> Cache<T>) — bracketed targets can never match bracket-stripped decls keys, so nested-interface override chains die (geb SimpleCache.get -> Cache.get class). heritage-typeargs-strip expects implements Cache from both nested classes",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map((x: any) => (x.type === "implements" && (x.target === "Cache")) ? { ...x, target: "Cache<T>" } : x) }),
  },
  {
    id: "typescript/drop-declared-types",
    language: "typescript",
    defectClass: "relationship-loss",
    description: "drops declared_type/return_type/cast/check references (silent type-usage-graph bug class)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !["declared_type", "return_type", "cast_target", "instanceof_check"].includes(String(x.metadata?.relationshipType))) }),
  },
  {
    id: "javascript/drop-instanceof-refs",
    language: "javascript",
    defectClass: "relationship-loss",
    description: "drops instanceof_check references (JS's only unambiguous named-type usage)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => x.metadata?.relationshipType !== "instanceof_check") }),
  },
  {
    id: "javascript/reintroduce-receiver-source",
    language: "javascript",
    defectClass: "relationship-garbage",
    description: "reverts JSD2: member reads source to the receiver variable again (cfg.limit -> cfg, a non-symbol the graph/LSP can never connect; the JAD2 class from the java wave)",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { type: "uses", source: "svc", target: "fetch", confidence: 0.6, metadata: { isFieldAccess: true } }] }),
  },
  {
    id: "javascript/reintroduce-module-write-uses",
    language: "javascript",
    defectClass: "relationship-garbage",
    description: "reverts JSD1: CJS deep-export writes emit uses again (module.exports.tag = 1 -> uses module -> exports/uses module -> tag)",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { type: "uses", source: "module", target: "exports", confidence: 0.6, metadata: { isFieldAccess: true } }, { type: "uses", source: "module", target: "tag", confidence: 0.6, metadata: { isFieldAccess: true } }] }),
  },
  {
    id: "python/drop-declared-types",
    language: "python",
    defectClass: "relationship-loss",
    description: "drops declared_type/return_type/isinstance references (silent type-usage-graph bug class)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !["declared_type", "return_type", "instanceof_check"].includes(String(x.metadata?.relationshipType))) }),
  },
  {
    id: "go/drop-declared-types",
    language: "go",
    defectClass: "relationship-loss",
    description: "drops declared_type/return_type references (silent type-usage-graph bug class)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !["declared_type", "return_type"].includes(String(x.metadata?.relationshipType))) }),
  },
  {
    id: "typescript/double-emit-type-args",
    language: "typescript",
    defectClass: "relationship-fabrication",
    description: "SCD7 regression: removes the type_annotation guard on type_arguments so Map<String, Foo> re-emits String/Foo as type_argument — local->String count equals:1 catches it",
    transform: r => ({
      ...r,
      relationships: [...(r.relationships ?? []), {
        type: "references", source: "local", target: "String", isExternal: true, weight: 0.8, confidence: 1.0, metadata: { relationshipType: "type_argument", evidenceClass: "reference_qualified" },
      }, {
        type: "references", source: "local", target: "Foo", isExternal: true, weight: 0.8, confidence: 1.0, metadata: { relationshipType: "type_argument", evidenceClass: "reference_qualified" },
      }],
    }),
  },
  {
    id: "typescript/drop-qualified-calls",
    language: "typescript",
    defectClass: "symbol-payload-loss",
    description: "strips qualified_calls from every symbol (the isKotlinBuiltin bug class)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map(s => ({ ...s, qualified_calls: [] })) }),
  },
  {
    id: "typescript/hide-jsdoc",
    language: "typescript",
    defectClass: "docstring-loss",
    description: "clears comments arrays (kotlin KDoc bug class)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map(s => ({ ...s, comments: [] })) }),
  },
  {
    id: "typescript/swap-heritage-labels",
    language: "typescript",
    defectClass: "relationship-mislabel",
    description: "swaps extends <-> implements labels on heritage edges",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map(x => {
      const t = x.type ?? x.relationshipType;
      if (t === "extends") return { ...x, type: "implements" };
      if (t === "implements") return { ...x, type: "extends" };
      return x;
    }) }),
  },
  {
    id: "typescript/reclassify-import-tier",
    language: "typescript",
    defectClass: "evidence-mislabel",
    description: "reclassifies the imports kind from import_based back to usage_contextual (the T1 bug class: classifier's isImport branch never fired for the dedicated imports kind)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map((x: any) => String(x.type ?? x.relationshipType) === "imports" ? { ...x, metadata: { ...(x.metadata ?? {}), evidenceClass: "usage_contextual" } } : x) }),
  },
  {
    id: "typescript/drop-import-edges",
    language: "typescript",
    defectClass: "relationship-loss",
    description: "drops the imports dependency edges entirely (the T7 bug class: dynamic import('./lazy') landed in the imports array but emitted no edge)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => String(x.type ?? x.relationshipType) !== "imports") }),
  },
  {
    id: "typescript/drop-resolved-path",
    language: "typescript",
    defectClass: "payload-loss",
    description: "strips metadata.resolvedPath from imports (the deterministic-resolution payload) — module-resolution-determinism fixture pins exact values per specifier shape",
    transform: r => ({ ...r, imports: (r.imports ?? []).map((i: any) => { const md: any = { ...((i as any).metadata ?? {}) }; delete md.resolvedPath; return { ...i, metadata: md } }) }),
  },
  {
    id: "typescript/drop-type-alias-refs",
    language: "typescript",
    defectClass: "relationship-loss",
    description: "drops type_alias RHS references (the T2 bug class: type Fn = (a: Id) => Id referenced nothing)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => x.metadata?.relationshipType !== "type_alias") }),
  },
  {
    id: "typescript/drop-expression-uses",
    language: "typescript",
    defectClass: "relationship-loss",
    description: "drops expression-level Uses (the T3 template-interpolation + T4 field-access bug classes: `got ${x}` and this.h.value reads emitted no Uses)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(x.metadata?.isTemplateInterpolation || x.metadata?.isFieldAccess)) }),
  },
  {
    id: "typescript/drop-satisfies-refs",
    language: "typescript",
    defectClass: "relationship-loss",
    description: "drops satisfies_target references (the T5 bug class: cfg satisfies Config referenced nothing)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => x.metadata?.relationshipType !== "satisfies_target") }),
  },
  {
    id: "typescript/reintroduce-shadowed-false-refs",
    language: "typescript",
    defectClass: "relationship-garbage",
    description: "re-adds the scope-blind false reference from functions to property symbols (the T6 bug class: const { name } = u emitted main -> User.name)",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), ...(r.symbols ?? []).filter((s: any) => s.kind === "function").flatMap((s: any) => (r.symbols ?? []).filter((t: any) => !!t.ownerName && t.kind !== "function" && t.kind !== "class" && t.kind !== "interface").map((t: any) => ({ type: "references", source: s.name, target: t.name, confidence: 1, metadata: {} })))] }),
  },
  {
    id: "typescript/drop-cast-assertion-refs",
    language: "typescript",
    defectClass: "relationship-loss",
    description: "drops cast_target references from angle-bracket type_assertions only (the T8 bug class: <Foo>x referenced nothing while as Foo worked)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(x.metadata?.relationshipType === "cast_target" && (x.source ?? "") !== (x.target ?? ""))) }),
  },
  {
    id: "typescript/drop-type-argument-refs",
    language: "typescript",
    defectClass: "relationship-loss",
    description: "drops type_argument references (the T9 bug class: f<Baz>(x) referenced nothing)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => x.metadata?.relationshipType !== "type_argument") }),
  },
  {
    id: "typescript/drop-override-edges",
    language: "typescript",
    defectClass: "relationship-loss",
    description: "drops overrides edges (section B overrides pin)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => String(x.type ?? x.relationshipType) !== "overrides") }),
  },
  {
    id: "typescript/drop-exports-edges",
    language: "typescript",
    defectClass: "relationship-loss",
    description: "drops exports edges (section B exports pin)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => String(x.type ?? x.relationshipType) !== "exports") }),
  },
  {
    id: "typescript/drop-visibility",
    language: "typescript",
    defectClass: "payload-loss",
    description: "drops the visibility payload from symbols (section C visibility pin)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => ({ ...s, visibility: undefined })) }),
  },
  {
    id: "typescript/drop-parameters",
    language: "typescript",
    defectClass: "payload-loss",
    description: "drops the parameters payload from method symbols (section C parameters pin)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => ({ ...s, parameters: undefined })) }),
  },
  {
    id: "typescript/drop-type-parameters",
    language: "typescript",
    defectClass: "payload-loss",
    description: "drops the typeParameters payload from symbols (section C typeParameters pin)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => ({ ...s, genericParameters: undefined })) }),
  },
  {
    id: "typescript/reintroduce-write-as-read",
    language: "typescript",
    defectClass: "relationship-garbage",
    description: "reverts the TSD1 write gate: assignment-LHS member writes emit uses again (this.count = 0 -> uses count; the JAD1 class from the java wave)",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { type: "uses", source: "write", target: "value", confidence: 0.85, metadata: { isFieldAccess: true } }] }),
  },
  {
    id: "typescript/reintroduce-script-placeholder",
    language: "typescript",
    defectClass: "relationship-garbage",
    description: "reverts TSD4: top-level calls source to the '(script)' placeholder again (no consumer can resolve it; the module leaf is the contract)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map((x: any) => (x.type === "calls" && x.source === "instantiation-refs" && x.target === "wrap") ? { ...x, source: "(script)" } : x) }),
  },
  {
    id: "typescript/reintroduce-qualified-new",
    language: "typescript",
    defectClass: "relationship-garbage",
    description: "reverts TSD3: new ns.Thing() emits the full 'ns.Thing' target instead of the leaf (violates the leaf-identity contract; JS parity reduces to Thing)",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { type: "instantiates", source: "make", target: "ns.Thing", confidence: 1, metadata: {} }] }),
  },
  {
    id: "typescript/reintroduce-subscript-call-targets",
    language: "typescript",
    defectClass: "relationship-garbage",
    description: "reverts W2: computed member calls (handlers[mode]()) emit the raw subscript text as call target again (nodeTransforms[i]-class fabrications no symbol index can join; JS family contract skips them)",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { type: "calls", source: "run", target: "handlers[mode]", confidence: 0.9, metadata: {} }] }),
  },
  {
    id: "typescript/reintroduce-module-leaf-attr",
    language: "typescript",
    defectClass: "relationship-loss",
    description: "reverts W1: object-literal member calls fall back to the module leaf again (run->helper becomes <module>->helper; the object member scope is the JD18-class contract)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map((x: any) => (x.type === "calls" && x.source === "run" && x.target === "helper") ? { ...x, source: "object-literal-members" } : x) }),
  },
  {
    id: "typescript/reintroduce-nested-misattribution",
    language: "typescript",
    defectClass: "relationship-loss",
    description: "reverts the W1 resolver fix: nested object methods (const local = { deep() {...} } inside a method body) misattribute their calls to the enclosing class method again (deep->inside becomes run->inside — the JD18-class misattribution)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map((x: any) => (x.type === "calls" && x.source === "deep" && x.target === "inside") ? { ...x, source: "run" } : x) }),
  },
  {
    id: "typescript/reintroduce-module-leaf-statics",
    language: "typescript",
    defectClass: "relationship-loss",
    description: "reverts W3 (J5): static block and property-initializer calls attribute to the module leaf again instead of the class (Service->warm becomes <module>->warm)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map((x: any) => (x.type === "calls" && x.source === "Service" && (x.target === "warm" || x.target === "init")) ? { ...x, source: "object-literal-members" } : x) }),
  },
  {
    id: "typescript/hook-gate-off",
    language: "typescript",
    defectClass: "noise-fabrication",
    description: "T1 regression: removes the React-signal gate — Rules-of-Hooks warnings fire on plain modules again — hook-gate forbidErrors pin catches it",
    transform: r => ({ ...r, errors: [...(r.errors ?? []), { message: "React Hook \"useThing\" is called outside a React component or custom hook.", range: { startLine: 4, startColumn: 2, endLine: 4, endColumn: 12 } }] }),
  },
  {
    id: "typescript/decorator-prefix-revert",
    language: "typescript",
    defectClass: "fabrication",
    description: "T2 regression: restores prefix decorator matching — @PostConstruct resolves to POST / again — decorator-exact forbidApiContractPaths pin catches it",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => s.name === "init" ? { ...s, apiContractPath: "/", metadata: { ...((s as any).metadata ?? {}), apiMethod: "POST" } } : s) }),
  },
  {
    id: "typescript/return-void-revert",
    language: "typescript",
    defectClass: "payload-loss",
    description: "T3 regression: unannotated bodies report void again instead of inferring from returns — inferred-return fixture expects number on fortyTwo/named",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => (s.name === "fortyTwo" || s.name === "named") ? { ...s, returnType: "void" } : s) }),
  },
  {
    id: "typescript/base-drop",
    language: "typescript",
    defectClass: "payload-loss",
    description: "T5 regression: drops controller-base composition — findAll reports the bare method route again — controller-base equals pins catch it",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => (s.name === "findAll" || s.name === "solo" || s.name === "root") ? { ...s, apiContractPath: "/list" } : s) }),
  },
  {
    id: "typescript/import-guard-revert",
    language: "typescript",
    defectClass: "payload-noise",
    description: "T8 regression: dynamic import() leaks back into qualified_calls — dynamic-import-qualified notIncludes pin catches it",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => s.name === "load" ? { ...s, qualified_calls: [...((s as any).qualified_calls ?? []), "import"] } : s) }),
  },
  {
    id: "typescript/taint-substring-revert",
    language: "typescript",
    defectClass: "payload-noise",
    description: "T9 regression: restores substring taint matching — myreq.body flags again — taint-leaf notIncludes pin catches it",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => s.name === "readOther" ? { ...s, taintSources: [...((s as any).taintSources ?? []), { type: "user_input", snippet: "myreq.body" }] } : s) }),
  },
  {
    id: "typescript/template-double-revert",
    language: "typescript",
    defectClass: "relationship-noise",
    description: "T-double regression: the general identifier walk re-emits References for template reads alongside the template walk's Uses — template-uses-singular forbid pin catches it",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { type: "references", source: "show", target: "cfg", confidence: 0.8, metadata: {} }] }),
  },
  {
    id: "typescript/positional-first-name-collision",
    language: "typescript",
    defectClass: "payload-attribution",
    description: "T6 regression: restores the dead-positional behavior — both same-named object methods attribute to the first-name-matched handle, so objB's body payload (callB) lands on objA.handle and objB.handle loses its own call — the positional-payload owner-pinned includes/notIncludes pairs catch it",
    transform: r => {
      const syms = (r.symbols ?? []).map((s: any) => s)
      const first = syms.find((s: any) => s.name === "handle" && s.ownerName === "objA")
      const second = syms.find((s: any) => s.name === "handle" && s.ownerName === "objB")
      if (!first || !second) return r
      return { ...r, symbols: syms.map((s: any) =>
        s === second
          ? { ...s, qualified_calls: first.qualified_calls }
          : s === first
            ? { ...s, qualified_calls: [...(first.qualified_calls ?? []), ...(second.qualified_calls ?? [])] }
            : s,
      ) }
    },
  },
  {
    id: "javascript/reclassify-import-tier",
    language: "javascript",
    defectClass: "evidence-mislabel",
    description: "reclassifies the imports kind from import_based back to usage_contextual (the J1 bug class: classifier had no 'imports' branch)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map((x: any) => String(x.type ?? x.relationshipType) === "imports" ? { ...x, metadata: { ...(x.metadata ?? {}), evidenceClass: "usage_contextual" } } : x) }),
  },
  {
    id: "javascript/drop-import-edges",
    language: "javascript",
    defectClass: "relationship-loss",
    description: "drops ALL imports dependency edges (the J1/J2 bug class: ES6, require, and dynamic import() dependencies)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => String(x.type ?? x.relationshipType) !== "imports") }),
  },
  {
    id: "javascript/drop-template-uses",
    language: "javascript",
    defectClass: "relationship-loss",
    description: "drops template-interpolation Uses (the J3 bug class: `hi ${name}` reads were invisible)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(x.metadata ?? {}).isTemplateInterpolation) }),
  },
  {
    id: "javascript/reintroduce-callee-uses",
    language: "javascript",
    defectClass: "relationship-garbage",
    description: "re-adds the call-callee double-emission: uses edges for every member call (the J4 bug class: svc.fetch() emitted calls AND uses)",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), ...(r.relationships ?? []).filter((x: any) => String(x.type ?? x.relationshipType) === "calls" && typeof (x.metadata ?? {}).calleeExpression === "string" && (x.metadata.calleeExpression).includes(".")).map((x: any) => { const parts = (x.metadata.calleeExpression).split("."); return { type: "uses", source: parts[0], target: parts[parts.length - 1], confidence: 0.6, metadata: { isFieldAccess: true } } })] }),
  },
  {
    id: "javascript/drop-static-calls",
    language: "javascript",
    defectClass: "relationship-loss",
    description: "drops calls attributed to class scope (the J5 bug class: static-block and field-initializer calls)",
    transform: r => {
      const classNames = new Set((r.symbols ?? []).filter((s: any) => s.kind === "class" && !s.ownerName).map((s: any) => s.name))
      return { ...r, relationships: (r.relationships ?? []).filter((x: any) => !(String(x.type ?? x.relationshipType) === "calls" && classNames.has(x.source))) }
    },
  },
  {
    id: "javascript/global-instanceof-source",
    language: "javascript",
    defectClass: "relationship-mislabel",
    description: "reverts instanceof reference sources to the global placeholder (the J6 bug class: top-level consts attributed to global)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map((x: any) => (x.metadata ?? {}).relationshipType === "instanceof_check" ? { ...x, source: "global" } : x) }),
  },
  {
    id: "javascript/drop-destructure-symbols",
    language: "javascript",
    defectClass: "symbol-loss",
    description: "drops module-level destructured binding symbols (the J7 bug class: const { a } = obj emitted nothing)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).filter((s: any) => !(s.metadata ?? {}).isDestructured) }),
  },
  {
    id: "javascript/drop-jsx-uses",
    language: "javascript",
    defectClass: "relationship-loss",
    description: "drops JSX component Uses edges (the J8 bug class: <Button/> emitted nothing)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !(x.metadata ?? {}).jsxElement) }),
  },
  {
    id: "javascript/drop-override-edges",
    language: "javascript",
    defectClass: "relationship-loss",
    description: "drops overrides edges (section B overrides pin)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => String(x.type ?? x.relationshipType) !== "overrides") }),
  },
  {
    id: "javascript/drop-instantiates-edges",
    language: "javascript",
    defectClass: "relationship-loss",
    description: "drops instantiates edges (section B instantiates pin)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => String(x.type ?? x.relationshipType) !== "instantiates") }),
  },
  {
    id: "javascript/drop-visibility",
    language: "javascript",
    defectClass: "payload-loss",
    description: "drops the visibility payload from symbols (section C visibility pin)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => ({ ...s, visibility: undefined })) }),
  },
  {
    id: "javascript/drop-parameters",
    language: "javascript",
    defectClass: "payload-loss",
    description: "drops the parameters payload from function/method symbols (section C parameters pin)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => ({ ...s, parameters: undefined })) }),
  },
  {
    id: "vue/drop-generic-macro-symbols",
    language: "vue",
    defectClass: "symbol-loss",
    description: "drops prop/event symbols from the type-literal generic macro form (the V1 bug class: defineProps<{ id: string }>() emitted nothing)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).filter((s: any) => !((s.metadata ?? {}).isProp || (s.metadata ?? {}).isEmit)) }),
  },
  {
    id: "vue/drop-template-member-uses",
    language: "vue",
    defectClass: "relationship-loss",
    description: "drops template-expression Uses edges (the V2 bug class: {{ count }}, :label, @click emitted nothing)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !(x.metadata ?? {}).isTemplateExpression) }),
  },
  {
    id: "vue/reduplicate-contains",
    language: "vue",
    defectClass: "relationship-duplication",
    description: "re-adds duplicate contains edges for script-side class members (the V3 bug class: sub-analyzer contains + vue pass = 2x)",
    transform: r => {
      const rels = r.relationships ?? []
      const dupes = rels.filter((x: any) => String(x.type ?? x.relationshipType) === "contains" && (x.metadata ?? {}).evidenceClass === "structural")
      return { ...r, relationships: [...rels, ...dupes] }
    },
  },
  {
    id: "vue/drop-contains-edges",
    language: "vue",
    defectClass: "relationship-loss",
    description: "drops all contains edges (section B contains pin)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => String(x.type ?? x.relationshipType) !== "contains") }),
  },
  {
    id: "vue/drop-import-edges",
    language: "vue",
    defectClass: "relationship-loss",
    description: "drops imports edges (section B imports pin)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => String(x.type ?? x.relationshipType) !== "imports") }),
  },
  {
    id: "vue/drop-complexity",
    language: "vue",
    defectClass: "payload-loss",
    description: "zeroes the complexity payload on script functions (section C complexity pin)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => ({ ...s, complexity: undefined })) }),
  },
  {
    id: "vue/drop-visibility",
    language: "vue",
    defectClass: "payload-loss",
    description: "drops the visibility payload from symbols (section C visibility pin)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => ({ ...s, visibility: undefined })) }),
  },
  {
    id: "vue/drop-parameters",
    language: "vue",
    defectClass: "payload-loss",
    description: "drops the parameters payload from function symbols (section C parameters pin)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => ({ ...s, parameters: undefined })) }),
  },
  {
    id: "vue/reemit-shadowed-uses",
    language: "vue",
    defectClass: "scope-blindness",
    description: "re-emits Uses for template-LOCAL identifiers that shadow members (the V4 bug class: v-for loop vars and slot props produced false uses)",
    transform: r => {
      const rels = r.relationships ?? []
      const source = "template-scope-shadow" // pinned: first-edge source is unstable across sub-analyzer evolution
      const extra = ["item", "row"].map(name => ({
        source, target: name, type: "uses", confidence: 0.95,
        metadata: { isTemplateExpression: true },
      }))
      return { ...r, relationships: [...rels, ...extra] }
    },
  },
  {
    id: "vue/drop-union-emit-names",
    language: "vue",
    defectClass: "symbol-loss",
    description: "drops non-first union emit names (the V1b bug class: (e: 'save' | 'close') kept only save)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).filter((s: any) => !((s.metadata ?? {}).isEmit && s.name === "close")) }),
  },
  {
    id: "svelte/drop-template-member-uses",
    language: "svelte",
    defectClass: "relationship-loss",
    description: "drops template-expression Uses edges (the S1 bug class: {count}, label={label}, {#each items} emitted nothing)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !(x.metadata ?? {}).isTemplateExpression) }),
  },
  {
    id: "svelte/reemit-shadowed-uses",
    language: "svelte",
    defectClass: "scope-blindness",
    description: "re-emits Uses for template-LOCAL identifiers (the vue V4 bug class: each loop vars and await then/catch vars produced false uses)",
    transform: r => {
      const rels = r.relationships ?? []
      const source = "template-member-uses" // pinned: first-edge source is unstable across sub-analyzer evolution
      const extra = ["row", "i", "value", "err"].map(name => ({
        source, target: name, type: "uses", confidence: 0.95,
        metadata: { isTemplateExpression: true },
      }))
      return { ...r, relationships: [...rels, ...extra] }
    },
  },
  {
    id: "svelte/reduplicate-rune-props",
    language: "svelte",
    defectClass: "symbol-duplication",
    description: "re-adds the JS sub-analyzer's destructured Variables for $props() bindings (the S2 bug class: let { a } = $props() declared a twice)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => (s.metadata ?? {}).isSvelteProp ? { ...s, name: undefined } : s).filter((s: any) => s.name !== undefined).concat((r.symbols ?? []).filter((s: any) => (s.metadata ?? {}).isSvelteProp).map((s: any) => ({ ...s, name: s.name + "", kind: "variable", ownerName: undefined, metadata: { ...s.metadata, isSvelteProp: undefined, fromRunes: undefined, isDestructured: true } }))) }),
  },
  {
    id: "svelte/drop-external-base-extends",
    language: "svelte",
    defectClass: "relationship-loss",
    description: "drops `extends` edges whose base is EXTERNAL to the file — the custom-element heritage class (`class MyCustomElement extends HTMLElement`, svelte's attribute-casing-custom-element corpus shape) and the dotted-member base (`Lib.Base`). In-file bases survive, so this pins svelte/js-script-heritage specifically: the older heritage fixtures (relationship-kinds, relationship-kind-catalog) both extend an IN-FILE base and stay green",
    transform: r => {
      const declared = new Set((r.symbols ?? []).map((s: any) => s.name))
      return {
        ...r,
        relationships: (r.relationships ?? []).filter(
          (x: any) => !(String(x.type ?? x.relationshipType) === "extends" && !declared.has(x.target)),
        ),
      }
    },
  },
  {
    id: "svelte/drop-overrides-edges",
    language: "svelte",
    defectClass: "relationship-loss",
    description: "drops overrides edges (section B overrides pin)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => String(x.type ?? x.relationshipType) !== "overrides") }),
  },
  {
    id: "svelte/drop-references-edges",
    language: "svelte",
    defectClass: "relationship-loss",
    description: "drops references edges (section B references pin)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => String(x.type ?? x.relationshipType) !== "references") }),
  },
  {
    id: "svelte/drop-uses-edges",
    language: "svelte",
    defectClass: "relationship-loss",
    description: "drops uses edges incl. template-expression uses (section B uses pin + S1)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => String(x.type ?? x.relationshipType) !== "uses") }),
  },
  {
    id: "svelte/drop-parameters",
    language: "svelte",
    defectClass: "payload-loss",
    description: "drops the parameters payload from function symbols (section C parameters pin)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => ({ ...s, parameters: undefined })) }),
  },
  {
    id: "svelte/drop-visibility",
    language: "svelte",
    defectClass: "payload-loss",
    description: "drops the visibility payload from symbols (section C visibility pin)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => ({ ...s, visibility: undefined })) }),
  },
  {
    id: "svelte/reemit-shadowed-member-uses",
    language: "svelte",
    defectClass: "scope-blindness",
    description: "re-emits Uses for each-loop / {@const} bindings that collide with a SAME-NAMED MEMBER (the S5 bug class: {#each rows as row} or {@const total = r.id} leaked fake uses -> member row/item/total)",
    transform: r => {
      const rels = r.relationships || []
      const source = "each-shadow-collision" // pinned: first-edge source is unstable across sub-analyzer evolution
      const extra = ["row", "item", "total"].map(name => ({
        source, target: name, type: "uses", confidence: 0.95,
        metadata: { isTemplateExpression: true },
      }))
      return { ...r, relationships: [...rels, ...extra] }
    },
  },
  {
    id: "svelte/reduplicate-reactive-targets",
    language: "svelte",
    defectClass: "symbol-duplication",
    description: "re-adds duplicate symbols for $: reactive targets (the S6 bug class: the same variable assigned from multiple $: blocks declared once PER BLOCK)",
    transform: r => ({
      ...r,
      symbols: [
        ...(r.symbols ?? []),
        ...(r.symbols ?? []).filter((s: any) => (s.metadata ?? {}).isReactiveDeclaration).map((s: any) => ({ ...s })),
      ],
    }),
  },
  {
    id: "svelte/drop-on-handler-calls",
    language: "svelte",
    defectClass: "relationship-loss",
    description: "M37.21 #611 regression: reverts the template pass on: directive branch — on:click={inc} / on:submit={() => save()} / on:click={box.open} emit no call edges (template-calls pins inc/save/open)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !((x.metadata ?? {}).context ?? "").startsWith("Svelte event directive")) }),
  },
  {
    id: "svelte/drop-render-tag-calls",
    language: "svelte",
    defectClass: "relationship-loss",
    description: "M37.21 #611 regression: reverts the render_tag branch — {@render row(it)} / {@render children?.()} emit no call edges (template-calls pins row)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !((x.metadata ?? {}).context ?? "").startsWith("Svelte {@render}")) }),
  },
  {
    id: "svelte/drop-attr-shape-uses",
    language: "svelte",
    defectClass: "relationship-loss",
    description: "Sv1 #736 regression (H1/H3): reverts the attribute-name scan — shorthand {value} and spread {...props} (expression in the attribute NAME, no expression child) emit no uses (template-attr-shapes pins value+props)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !(String(x.type ?? x.relationshipType) === "uses" && (x.target === "value" || x.target === "props") && (x.metadata ?? {}).isTemplateExpression)) }),
  },
  {
    id: "svelte/drop-dynamic-this-instantiates",
    language: "svelte",
    defectClass: "relationship-loss",
    description: "Sv1 #736 regression (H2): reverts dynamic this= resolution — import-bound bare this={DynComp} emits no instantiates (template-attr-shapes pins DynComp)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !(String(x.type ?? x.relationshipType) === "instantiates" && x.target === "DynComp")) }),
  },
  {
    id: "svelte/reemit-string-content-uses",
    language: "svelte",
    defectClass: "scope-blindness",
    description: "Sv1 #736 regression (M2): reverts the quote-state walk — string contents read as identifiers (f(\"a=b\") emits uses a+b; template-string-safety forbids both)",
    transform: r => {
      const rels = r.relationships ?? []
      const source = "template-string-safety" // pinned: first-edge source is unstable across sub-analyzer evolution
      const extra = ["a", "b"].map(name => ({
        source, target: name, type: "uses", confidence: 0.95,
        metadata: { isTemplateExpression: true },
      }))
      return { ...r, relationships: [...rels, ...extra] }
    },
  },
  {
    id: "svelte/reemit-chain-leaf-uses",
    language: "svelte",
    defectClass: "scope-blindness",
    description: "Sv1 #736 regression (M3): reverts receiver-only emission — member-chain leaves read as members (user.name emits uses name; template-string-safety forbids it)",
    transform: r => {
      const rels = r.relationships ?? []
      const source = "template-string-safety" // pinned: first-edge source is unstable across sub-analyzer evolution
      return { ...r, relationships: [...rels, { source, target: "name", type: "uses", confidence: 0.95, metadata: { isTemplateExpression: true } }] }
    },
  },
  {
    id: "svelte/reemit-inline-await-uses",
    language: "svelte",
    defectClass: "scope-blindness",
    description: "Sv1 #736 regression (M4): reverts inline then/as registration — `{#await data as d}` leaks uses d (await-inline-shadow forbids it; the `value` half is already covered by svelte/reemit-shadowed-uses)",
    transform: r => {
      const rels = r.relationships ?? []
      const source = "await-inline-shadow" // pinned: first-edge source is unstable across sub-analyzer evolution
      return { ...r, relationships: [...rels, { source, target: "d", type: "uses", confidence: 0.95, metadata: { isTemplateExpression: true } }] }
    },
  },
  {
    id: "svelte/readd-phantom-x-shadow",
    language: "svelte",
    defectClass: "scope-blindness",
    description: "Sv1 #736 regression (M1): re-adds the phantom await-block shadow — a hardcoded shadow of identifier x suppresses the real member-x read inside every await block (await-inline-shadow expects uses x)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !(String(x.type ?? x.relationshipType) === "uses" && x.target === "x" && (x.metadata ?? {}).isTemplateExpression)) }),
  },
  {
    id: "svelte/script-relative-export-ranges",
    language: "svelte",
    defectClass: "range-incoherence",
    description: "Sv2 #736 regression (D1): reverts SFC export-range shifts — module-block export ranges keep script-relative byte indices (module-block-exports pins VERSION at SFC index 39; lines are 2 either way here since the block opens on SFC line 1, so indices are the discriminating fields)",
    transform: r => ({
      ...r,
      exports: (r.exports ?? []).map((e: any) => e.name === "VERSION"
        ? { ...e, range: { ...((e as any).range ?? {}), startIndex: 14, endIndex: 21 } }
        : e),
    }),
  },
  {
    id: "svelte/reemit-comment-uses",
    language: "svelte",
    defectClass: "scope-blindness",
    description: "Sv2 #736 regression (D3): reverts comment skipping — `{f(a) /* b */}` and `{url // pick}` leak uses b/pick (template-comment-safety forbids both)",
    transform: r => {
      const rels = r.relationships ?? []
      const source = "template-comment-safety" // pinned: first-edge source is unstable across sub-analyzer evolution
      const extra = ["b", "pick"].map(name => ({
        source, target: name, type: "uses", confidence: 0.95,
        metadata: { isTemplateExpression: true },
      }))
      return { ...r, relationships: [...rels, ...extra] }
    },
  },
  {
    id: "svelte/render-first-segment-calls",
    language: "svelte",
    defectClass: "relationship-fabrication",
    description: "Sv2 #736 regression (D4): reverts the render leaf rule — `{@render helpers.row(1)}` emits calls helpers alongside the plain-site calls row (template-calls forbids helpers; row stays via the plain site, so add-only is the faithful revert)",
    transform: r => ({
      ...r,
      relationships: [
        ...(r.relationships ?? []),
        { source: "template-calls", target: "helpers", type: "calls", confidence: 0.9, metadata: { context: "Svelte {@render} tag" } },
      ],
    }),
  },
  {
    id: "svelte/drop-condition-uses",
    language: "svelte",
    defectClass: "relationship-loss",
    description: "Sv2 #736 regression (D5): reverts if/else-if/key condition collection — heads referencing only their condition emit nothing (template-condition-uses pins shown/fallback/k)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !(String(x.type ?? x.relationshipType) === "uses" && ["shown", "fallback", "k"].includes(x.target) && (x.metadata ?? {}).isTemplateExpression)) }),
  },
  {
    id: "c/static-prototype-public",
    language: "c",
    defectClass: "visibility-fabrication",
    description: "Holy-C #736 regression (HC1): reverts the prototype visibility fix — static prototype hidden reports public and leaks into exports (declaration-identity pins private + forbids the export)",
    transform: r => ({
      ...r,
      symbols: (r.symbols ?? []).map((s: any) => s.name === "hidden" ? { ...s, visibility: "public" } : s),
      exports: [...(r.exports ?? []), { name: "hidden", type: "function", isType: false }],
    }),
  },
  {
    id: "c/reduplicate-merged-symbols",
    language: "c",
    defectClass: "symbol-duplication",
    description: "Holy-C #736 regression (HC2): reverts the same-entity merge — tentative tally and prototype+definition shown emit twice each, shown double-exported (declaration-identity pins counts; the export duplicate trips the harness-global uniqueness invariant)",
    transform: r => ({
      ...r,
      symbols: [
        ...(r.symbols ?? []),
        ...(r.symbols ?? []).filter((s: any) => s.name === "tally" || s.name === "shown").map((s: any) => ({ ...s })),
      ],
      exports: [
        ...(r.exports ?? []),
        ...(r.exports ?? []).filter((e: any) => e.name === "shown").map((e: any) => ({ ...e })),
      ],
    }),
  },
  {
    id: "c/drop-knr-params",
    language: "c",
    defectClass: "payload-loss",
    description: "Holy-C #736 regression (HC3): reverts K&R parameter extraction — add loses its bare-identifier params (declaration-identity pins a+b via expectParameters)",
    transform: r => ({
      ...r,
      symbols: (r.symbols ?? []).map((s: any) => s.name === "add" ? { ...s, parameters: [] } : s),
    }),
  },
  {
    id: "c/drop-glue-recovered-definitions",
    language: "c",
    defectClass: "symbol-loss",
    description: "#907 (M60-C) regression: the swallowed-definition recovery stops emitting — a definition header glued into a preceding function's body loses its symbol again (swallowed-definitions-907 pins jv_dumpf/jv_dump; the real sites are jq src/jv_print.c's two public API functions, absent from the catalog before the fix). This reproduces the pre-fix state exactly (measured: 1 function symbol on the fixture, targets absent).",
    transform: r => ({
      ...r,
      symbols: (r.symbols ?? []).filter((s: any) => s.metadata?.recoveredFromGlue !== true),
    }),
  },
  {
    id: "c/glue-recovery-wrong-kind",
    language: "c",
    defectClass: "symbol-identity",
    description: "#907 (M60-C) regression: a glued definition header is recovered as the BLOCK's business rather than file scope — the traversal lends it out as a variable declaration, so the catalog carries `jv_dumpf` as a variable instead of a function. That is the failure mode the whole discriminator exists to prevent, since the swallowed body ALSO holds `jv_dumpf(x, stdout, flags)` as a function_declarator whose next character is `;`. Caught by c/swallowed-definitions-907, whose forbidSymbols pin both recovered names as variable-kind.",
    transform: r => ({
      ...r,
      symbols: (r.symbols ?? []).map((s: any) =>
        s.metadata?.recoveredFromGlue === true ? { ...s, kind: "variable", metadata: { ...(s.metadata ?? {}), isVariable: true } } : s,
      ),
    }),
  },
  {
    id: "c/glue-requires-body-ancestor",
    language: "c",
    defectClass: "symbol-loss",
    description: "#907 (M60-C) round-2 regression: re-imposes round 1's guard that the ERROR must sit inside a `compound_statement`, so a definition header glued at FILE SCOPE loses its symbol again. This is exactly the pre-round-2 state and it is why the guard was wrong: jq src/jv.c's `jv_number` and src/util.c's `strptime` are both file-scope arrivals (measured LOST by script/m14/tmp/c907-slice-hunt.ts at the round-1 tree). Caught by c/swallowed-root-definitions-907, which pins both.",
    transform: r => ({
      ...r,
      symbols: (r.symbols ?? []).filter((s: any) => !(s.metadata?.recoveredFromGlue === true && s.metadata?.glueArrival !== "body")),
    }),
  },
  {
    id: "c/glue-bare-identifier-dropped",
    language: "c",
    defectClass: "symbol-loss",
    description: "#907 (M60-C) round-2 regression: the recovery stops accepting a name that arrives as a bare `identifier` under the ERROR, so the most degraded arrival loses its symbols again. Caught by c/swallowed-identifier-arrival-907, which pins the three public decNumber API definitions (decNumberQuantize/Normalize/Reduce) — real sites jq vendor/decNumber/decNumber.c:2283/2303/2308, where the damaged region has lost both the return type and the function_declarator node.",
    transform: r => ({
      ...r,
      symbols: (r.symbols ?? []).filter((s: any) => !(s.metadata?.recoveredFromGlue === true && s.metadata?.glueNameShape === "bare-identifier")),
    }),
  },
  {
    id: "c/glue-wrapped-declarator-dropped",
    language: "c",
    defectClass: "symbol-loss",
    description: "#907 (M60-C) round-2 regression: the recovery stops unwrapping `pointer_declarator`, so only a bare function_declarator directly under the ERROR is recovered and every pointer-returning glued definition keeps losing its symbol. Caught by c/swallowed-root-definitions-907 through `strptime` (`char* strptime(...)`, real site jq src/util.c:617 — its ERROR path is ERROR > pointer_declarator > function_declarator).",
    transform: r => ({
      ...r,
      symbols: (r.symbols ?? []).filter((s: any) => !(s.metadata?.recoveredFromGlue === true && s.metadata?.glueWrapped === true)),
    }),
  },
  {
    id: "c/drop-valueless-macro-symbol",
    language: "c",
    defectClass: "symbol-loss",
    description: "#901 (M60) regression: re-applies the body-based skip in extractMacro — a `#define NAME` with no value body mints no symbol (macro-forward-read pins M60_TRACE_FLAG and M60_API as constants; the real sites were basexx.c SQLITE_EXTENSION_INIT1 and tclsqlite.c SQLITE_TCLAPI)",
    transform: r => ({
      ...r,
      symbols: (r.symbols ?? []).filter((s: any) => !(s.kind === "constant" && (s.name === "M60_TRACE_FLAG" || s.name === "M60_API"))),
    }),
  },
  {
    id: "c/drop-forward-macro-uses",
    language: "c",
    defectClass: "relationship-loss",
    description: "#901 (M60) regression: drops the order-independent `uses` for a macro read ABOVE its define (macro-forward-read expects uses global -> M60_TRACE_FLAG; the real row was basexx.c L40 reading SQLITE_EXTENSION_INIT1 defined at L48)",
    transform: r => ({
      ...r,
      relationships: (r.relationships ?? []).filter((x: any) => !(String(x.type) === "uses" && x.target === "M60_TRACE_FLAG")),
    }),
  },
  {
    id: "c/callsite-lines-dropped",
    language: "c",
    defectClass: "line-attribution",
    description: "M59 (#825) regression: c's relationships go back to carrying NO line — the exact pre-fix state (measured 0 of 414 on the lane audit; 47,575 relationships across sqlite/jq/zig carry one at HEAD). Caught by c/callsite-lines-825, which pins the include paths at 12/13, both wrapped specifier tags at 16/32, the calls at 33/38/46 and the contains lines at 17/22/23/24.",
    transform: dropAllLineNumbers,
  },
  {
    id: "c/callsite-lines-receiver-start",
    language: "c",
    defectClass: "line-attribution",
    description: "M59 (#825) regression: a function-pointer member call takes the line the RECEIVER is written on instead of the callee leaf — the construct-start shape, because a `call_expression` starts at its receiver. Caught by c/callsite-lines-825: run -> record must be 46 (where `->record` is written); the receiver line 45 is forbidden.",
    transform: r => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) =>
        x && String(x.type) === "calls" && x.metadata?.isFunctionPointer === true && typeof x.line_number === "number"
          ? { ...x, line_number: x.line_number - 1 }
          : x,
      ),
    }),
  },
  {
    id: "c/reference-lines-specifier-start",
    language: "c",
    defectClass: "line-attribution",
    description: "M59 (#825) regression: a struct reference takes the specifier KEYWORD's line instead of the tag's — the exact defect measured on jq jv_dtoa.c (`struct` on 512, `Bigint {` on 513), the only Tier-A inconsistency in 13,186 jq relationships before the fix. Caught by c/callsite-lines-825: Tally must be 16 and 32; the keyword lines 15 and 31 are forbidden.",
    transform: r => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) =>
        x && String(x.type) === "references" && x.metadata?.nodeType === "struct_specifier" && typeof x.line_number === "number"
          ? { ...x, line_number: x.line_number - 1 }
          : x,
      ),
    }),
  },
  {
    id: "c/contains-lines-enclosing",
    language: "c",
    defectClass: "line-attribution",
    description: "M59 (#825) regression: a contains edge takes the ENCLOSING declaration's line instead of the member's own — the fabricated-substitute class the contract forbids. Caught by c/callsite-lines-825: contains Counters -> hits must be 22 (where `hits` is declared); the opening-brace line 21 is forbidden.",
    transform: r => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) =>
        x && String(x.type) === "contains" && typeof x.line_number === "number" ? { ...x, line_number: x.line_number - 1 } : x,
      ),
    }),
  },
  {
    id: "c/proto-param-uses",
    language: "c",
    defectClass: "relationship-fabrication",
    description: "Holy-C deepest-review #736 regression (HC6): re-admits prototype parameter names to file-scope resolution — the main->count read fabricates a dangling use (declaration-identity forbids it)",
    transform: r => ({
      ...r,
      relationships: [
        ...(r.relationships ?? []),
        { source: "main", target: "count", type: "uses", confidence: 1.0, metadata: { relationshipType: "identifier_usage" } },
      ],
    }),
  },
  {
    id: "cpp/drop-bare-uses",
    language: "cpp",
    defectClass: "relationship-loss",
    description: "CP1 #736 regression: reverts bare value reads — `return g;` and member/namespace/callback reads emit nothing (bare-value-reads pins f->g_var, bump->count, getx->x, reg->target_fn)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !((x.metadata ?? {}).relationshipType === "identifier_usage")) }),
  },
  {
    id: "cpp/reemit-shadowed-reads",
    language: "cpp",
    defectClass: "scope-blindness",
    description: "CP1 #736 regression: reverts shadowing suppression — shadowed/local reads leak (h->g_var for the shadowing local, use_tmpl->ident for the explicit-template callee); bare-value-reads forbids both",
    transform: r => {
      const rels = r.relationships ?? []
      const source = (rels.find((x: any) => x.type === "uses")?.source) || "h"
      const extra = [
        { source: "h", target: "g_var", type: "uses", confidence: 1.0, metadata: { relationshipType: "identifier_usage" } },
        { source: "use_tmpl", target: "ident", type: "uses", confidence: 1.0, metadata: { relationshipType: "identifier_usage" } },
      ]
      return { ...r, relationships: [...rels, ...extra] }
    },
  },
  {
    id: "cpp/macro-function-symbols",
    language: "cpp",
    defectClass: "symbol-fabrication",
    description: "CP2 #736 regression: re-mints TEST/TEST_F macro-function symbols with leaking body locals (macro-function-shapes pins zero TEST/TEST_F symbols and zero local_tmp)",
    transform: r => ({
      ...r,
      symbols: [
        ...(r.symbols ?? []),
        { name: "TEST", kind: "function", scope: "global", visibility: "public", range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 } },
        { name: "local_tmp", kind: "variable", scope: "global", visibility: "public", range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 } },
      ],
    }),
  },
  {
    id: "cpp/bare-macro-symbols",
    language: "cpp",
    defectClass: "symbol-fabrication",
    description:
      "#915 regression: re-mints the phantom symbols the declaration branch made out of a run of bare top-level macros — the pre-fix analyzer named `variable FMT_END_NAMESPACE` after the recovered `declaration` whose terminator is MISSING (and `FMT_BEGIN_EXPORT` after the run that precedes a real declaration). Caught by cpp/bare-macro-statements, whose expectSymbolCount pins 0 of each and whose control symbols (Widget + owned size_, helper, after_macros) prove the suppression did not simply drop declarations. The measured class size on fmt is 13 such symbols in a 58-file draw and 0 on nlohmann-json; this mutant restores the two shapes that fixture carries.",
    transform: r => ({
      ...r,
      symbols: [
        ...(r.symbols ?? []),
        { name: "FMT_END_NAMESPACE", kind: "variable", scope: "global", visibility: "private", range: { startLine: 28, startColumn: 1, endLine: 28, endColumn: 17 } },
        { name: "FMT_BEGIN_EXPORT", kind: "variable", scope: "global", visibility: "private", range: { startLine: 19, startColumn: 1, endLine: 19, endColumn: 15 } },
      ],
    }),
  },
  {
    id: "c/macro-truncated-declaration-phantoms",
    language: "c",
    defectClass: "symbol-fabrication",
    description:
      "#916 regression: re-mints the phantoms a bare macro between a type and its declarator produced — the macro itself emitted as a `variable` (`SQLITE_WSD`, `SQLITE_NOINLINE`, `SQLITE_CDECL`, `JNICALL`) with the real declaration producing nothing. Caught by c/macro-truncated-declarator-916, whose expectSymbolCount pins 0 of each macro name and whose four real symbols (sqlite3SharedCacheList, btreeLockCarefully, sqlite3IoTrace, Java_entry) play the control that stops a fix from simply dropping the construct. The same mutant shape as cpp/bare-macro-symbols, kept separate because the c and cpp analyzers recover it by different means (c reads the sibling the truncation re-parsed; cpp suppresses the recovered declaration and the real symbol was never lost).",
    transform: r => ({
      ...r,
      symbols: [
        ...(r.symbols ?? []),
        { name: "SQLITE_WSD", kind: "variable", scope: "global", visibility: "private", range: { startLine: 28, startColumn: 13, endLine: 28, endColumn: 23 } },
        { name: "SQLITE_NOINLINE", kind: "variable", scope: "global", visibility: "private", range: { startLine: 32, startColumn: 13, endLine: 32, endColumn: 28 } },
        { name: "SQLITE_CDECL", kind: "variable", scope: "global", visibility: "public", range: { startLine: 37, startColumn: 17, endLine: 37, endColumn: 29 } },
        { name: "JNICALL", kind: "variable", scope: "global", visibility: "public", range: { startLine: 43, startColumn: 16, endLine: 43, endColumn: 23 } },
      ],
    }),
  },
  {
    id: "c/macro-wrapped-heading-loss",
    language: "c",
    defectClass: "scope-blindness",
    description:
      "#917 regression: reverts the macro-wrapped-heading recovery — `MACRO(ret, name)(params){…}` loses its definition entirely, its body's anonymous enum leaks as a FILE-SCOPE symbol, and its calls are attributed to `global`. Caught by c/macro-wrapped-heading-917, whose expectSymbolCount pins BufSize/anonymous_enum to 0, whose expectSymbols require the three recovered definitions (cmpp_stream, 1value_1text, cmpp_err_set), and whose forbidRelationships name `uses global->BufSize` — the single unexplained row the whole 315-file sqlite c lane carried. This is the pre-fix output measured through the production entry on that fixture, not a synthetic corruption.",
    transform: r => ({
      ...r,
      symbols: [
        ...(r.symbols ?? []).filter(
          (s: any) => !["cmpp_stream", "1value_1text", "cmpp_err_set"].includes(s.name),
        ),
        { name: "anonymous_enum", kind: "enum", scope: "global", visibility: "private", range: { startLine: 42, startColumn: 8, endLine: 42, endColumn: 33 } },
        { name: "BufSize", kind: "enum_member", scope: "global", visibility: "private", range: { startLine: 42, startColumn: 15, endLine: 42, endColumn: 22 } },
      ],
      relationships: [
        ...(r.relationships ?? []).filter(
          (x: any) =>
            !(
              x.type === "calls" &&
              ["cmpp_stream", "1value_1text", "cmpp_err_set"].includes(x.source) &&
              x.target === "helperTarget"
            ),
        ),
        { type: "uses", source: "global", target: "BufSize", confidence: 1.0, metadata: { relationshipType: "identifier_usage", nodeType: "identifier" } },
        { type: "contains", source: "anonymous_enum", target: "BufSize", confidence: 1.0 },
        { type: "calls", source: "global", target: "helperTarget", confidence: 1.0, metadata: { relationshipType: "c_function_call", isFunctionPointer: false } },
      ],
    }),
  },
  {
    id: "c/macro-wrapped-pointer-heading-loss",
    language: "c",
    defectClass: "scope-blindness",
    description:
      "#918 regression: reverts the POINTER-return macro-wrapped heading recovery — `MACRO(ret*, name)(params){…}` loses its definition (the declarator is the PARAMETER list, so `CGD38` drops the node), and its body's calls are attributed to `global`. Caught by c/macro-wrapped-pointer-heading-918, whose expectSymbols require the five recovered definitions (cmpp_malloc, cmpp_rc_cstr, cmpp_b_borrow, cmpp_b_clear, cmpp_mrealloc), whose expectParameters pin the return type/parameter split of each spelling, whose forbidParameters keep the unnamed case at `unknown`, and whose forbidRelationships name `calls global->helperTarget` — the containment half. This is the pre-fix output measured through the production entry on that fixture (9 symbols, every pointer body's call at file scope), not a synthetic corruption.",
    transform: r => {
      // Only an output that actually carries a recovered pointer-return heading
      // is mutated — otherwise EVERY fixture would grow the file-scope call
      // rows and the mutant would be caught by collateral instead of by the
      // defect it models.
      const RECOVERED = ["cmpp_malloc", "cmpp_rc_cstr", "cmpp_b_borrow", "cmpp_b_clear", "cmpp_mrealloc"]
      if (!(r.symbols ?? []).some((s: any) => RECOVERED.includes(s.name))) return r
      const CALLERS = ["cmpp_malloc", "cmpp_rc_cstr", "cmpp_b_borrow", "cmpp_b_clear"]
      return {
        ...r,
        symbols: (r.symbols ?? []).filter((s: any) => !RECOVERED.includes(s.name)),
        relationships: [
          ...(r.relationships ?? []).filter(
            (x: any) =>
              !(CALLERS.includes(x.source) && x.type === "calls" && x.target === "helperTarget") &&
              !(["cmpp_b_borrow", "cmpp_b_clear"].includes(x.source) && x.type === "references" && x.target === "cmpp_b"),
          ),
          ...CALLERS.map((name: string, i: number) => ({
            type: "calls",
            source: "global",
            target: "helperTarget",
            line_number: [46, 54, 63, 70][i],
            confidence: 1.0,
            metadata: { relationshipType: "c_function_call", isFunctionPointer: false, derivedFrom: name },
          })),
        ],
      }
    },
  },
  {
    id: "cpp/static-fn-public",
    language: "cpp",
    defectClass: "visibility-fabrication",
    description: "CP3 #736 regression: reverts static-function privacy — hidden_helper reports public (bare-value-reads pins private + forbids the export)",
    transform: r => ({
      ...r,
      symbols: (r.symbols ?? []).map((s: any) => s.name === "hidden_helper" ? { ...s, visibility: "public" } : s),
      exports: [...(r.exports ?? []), { name: "hidden_helper", kind: "function" }],
    }),
  },
  {
    id: "cpp/out-of-line-member-silence",
    language: "cpp",
    defectClass: "relationship-loss",
    description: "CP5 second-review regression: out-of-line bodies lose their class scope — bare member reads in Foo::bar go silent (bare-value-reads expects uses add->total)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(normRel(x).type === "uses" && normRel(x).source === "add" && normRel(x).target === "total")) }),
  },
  {
    id: "cpp/nested-scope-silence",
    language: "cpp",
    defectClass: "relationship-loss",
    description: "CP7 second-review regression: nested qualification scopes to the outer segment — bare member reads in Outer::Inner::m go silent (bare-value-reads expects uses Inner::step->n)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(normRel(x).type === "uses" && normRel(x).source === "Inner::step" && normRel(x).target === "n")) }),
  },
  {
    id: "cpp/structured-binding-reads",
    language: "cpp",
    defectClass: "shadowing-loss",
    description: "CP6 second-review regression: structured bindings stop declaring — the binding site and body reads of a colliding name leak as uses (bare-value-reads forbids uses destructure->a)",
    transform: r => ({
      ...r,
      relationships: [...(r.relationships ?? []), { source: "destructure", target: "a", type: "uses", confidence: 1.0, metadata: { relationshipType: "identifier_usage", nodeType: "identifier" } }],
    }),
  },
  {
    id: "cpp/member-init-silence",
    language: "cpp",
    defectClass: "relationship-loss",
    description: "CP8 second-review regression: member/enumerator declarator values treated as declaring again — NSDMI and enumerator reads go silent (bare-value-reads expects uses Config->LIMIT and Level->LIMIT)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(normRel(x).type === "uses" && (normRel(x).source === "Config" || normRel(x).source === "Level") && normRel(x).target === "LIMIT")) }),
  },
  {
    id: "rust/drop-bare-uses",
    language: "rust",
    defectClass: "relationship-loss",
    description: "R1 #736 regression: reverts bare value reads — const/static/callback/member reads emit nothing (bare-value-reads pins reader->GLOBAL/LIMIT/identity, get_c->C, matcher->Red)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !((x.metadata ?? {}).relationshipType === "identifier_usage")) }),
  },
  {
    id: "rust/reemit-shadowed-reads",
    language: "rust",
    defectClass: "scope-blindness",
    description: "R1 #736 regression: reverts shadowing suppression — the shadowing param read leaks (bare-value-reads forbids shadowed->GLOBAL)",
    transform: r => ({
      ...r,
      relationships: [
        ...(r.relationships ?? []),
        { source: "shadowed", target: "GLOBAL", type: "uses", confidence: 1.0, metadata: { relationshipType: "identifier_usage" } },
      ],
    }),
  },
  {
    id: "rust/reemit-where-param-refs",
    language: "rust",
    defectClass: "relationship-fabrication",
    description: "R8 #736 regression: reverts the where-bound param filter — `where T: Clone` leaks references to the bound type parameter (verified absent in bare-value-reads REFS alongside the relationship-kinds String:PartialEq pin)",
    transform: r => ({
      ...r,
      relationships: [
        ...(r.relationships ?? []),
        { source: "generic", target: "T", type: "references", confidence: 1.0, metadata: { rustSpecific: true, whereBound: true } },
      ],
    }),
  },
  {
    id: "rust/drop-self-construction",
    language: "rust",
    defectClass: "relationship-loss",
    description: "D2 #736 regression: reverts Self resolution — `Self { x }` / `Self::new()` / bare `Self(..)` target the literal Self and are filtered as noise (construction-exports pins instantiates new/origin/clone_it->Point and R14 wrap->Wrap)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !(String(x.type ?? x.relationshipType) === "instantiates" && (x.target === "Point" || x.target === "Wrap"))) }),
  },
  {
    id: "rust/restore-restricted-exports",
    language: "rust",
    defectClass: "export-fabrication",
    description: "D3 #736 regression: reverts export privacy — pub(crate) items and private-module members re-enter the export list (construction-exports forbids internal/Hidden/std::io::Read/f)",
    transform: r => ({
      ...r,
      exports: [
        ...(r.exports ?? []),
        { name: "internal", type: "function", isType: false },
        { name: "Hidden", type: "struct", isType: true },
      ],
    }),
  },
  {
    id: "rust/reemit-arm-binding-reads",
    language: "rust",
    defectClass: "shadowing-loss",
    description: "R9 extreme regression: bare match-arm patterns stop binding — the pattern site and body reads of `v` leak as uses (bare-value-reads forbids uses arm_binds->v)",
    transform: r => ({
      ...r,
      relationships: [...(r.relationships ?? []), { source: "arm_binds", target: "v", type: "uses", confidence: 1.0, metadata: { relationshipType: "identifier_usage", nodeType: "identifier" } }],
    }),
  },
  {
    id: "rust/closure-param-reads",
    language: "rust",
    defectClass: "shadowing-loss",
    description: "R10 extreme regression: closure parameters stop binding — the closure body read of VAL leaks as uses (bare-value-reads forbids uses closure_binds->VAL)",
    transform: r => ({
      ...r,
      relationships: [...(r.relationships ?? []), { source: "closure_binds", target: "VAL", type: "uses", confidence: 1.0, metadata: { relationshipType: "identifier_usage", nodeType: "identifier" } }],
    }),
  },
  {
    id: "rust/drop-scoped-use-leaf",
    language: "rust",
    defectClass: "relationship-loss",
    description: "R11 extreme regression: scoped single-leaf use paths bind nothing again — value-position reads of plain-path imports go silent (bare-value-reads expects uses capped->MAX)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(normRel(x).type === "uses" && normRel(x).source === "capped" && normRel(x).target === "MAX")) }),
  },
  {
    id: "rust/blank-symbol",
    language: "rust",
    defectClass: "symbol-noise",
    description: "R12 extreme regression: mints the GO5/Z8-class `_` Variable symbol for `const _ : u32 = 0;` (bare-value-reads forbids any `_` symbol)",
    transform: r => ({
      ...r,
      symbols: [...(r.symbols ?? []), { name: "_", kind: "variable", visibility: "private", range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1, startIndex: 0, endIndex: 0 } }],
    }),
  },
  {
    id: "rust/drop-declared-type-refs",
    language: "rust",
    defectClass: "relationship-loss",
    description: "R13 extreme regression: drops the whole declared-type references graph — param/return/field/alias type mentions emit nothing (declared-type-refs expects 9 declared_type edges)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !((x.metadata ?? {}).relationshipType === "declared_type")) }),
  },
  {
    id: "go/drop-bare-uses",
    language: "go",
    defectClass: "relationship-loss",
    description: "GO1 #736 regression: reverts bare value reads — const/static/callback/member reads emit nothing (bare-value-reads pins reader->Global/Limit, target_fn->Global, usecase->Red)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !((x.metadata ?? {}).relationshipType === "identifier_usage")) }),
  },
  {
    id: "go/reemit-shadowed-reads",
    language: "go",
    defectClass: "scope-blindness",
    description: "GO1 #736 regression: reverts shadowing suppression — the shadowing param read leaks (bare-value-reads forbids shadowed->Global)",
    transform: r => ({
      ...r,
      relationships: [
        ...(r.relationships ?? []),
        { source: "shadowed", target: "Global", type: "uses", confidence: 1.0, metadata: { relationshipType: "identifier_usage" } },
      ],
    }),
  },
  {
    id: "go/dotimport-drop",
    language: "go",
    defectClass: "relationship-loss",
    description: "GO3 #736 regression: reverts dot-import call resolution — dot-imported bare calls drop again (dot-import-calls pins F->Print)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !(String(x.type ?? x.relationshipType) === "calls" && x.target === "Print")) }),
  },
  {
    id: "go/tilde-garbage",
    language: "go",
    defectClass: "symbol-fabrication",
    description: "GO2 #736 regression: re-mints tilde/union constraint garbage — Interface symbols and extends for `~int | ~string` / `int | string` (bare-value-reads forbids both symbols)",
    transform: r => ({
      ...r,
      symbols: [
        ...(r.symbols ?? []),
        { name: "~int | ~string", kind: "interface", scope: "global", visibility: "public", range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 } },
      ],
      relationships: [
        ...(r.relationships ?? []),
        { source: "Ordered", target: "~int | ~string", type: "extends", confidence: 0.8, metadata: {} },
      ],
    }),
  },
  {
    id: "go/blank-symbol",
    language: "go",
    defectClass: "symbol-fabrication",
    description: "GO5 #736 regression: re-mints blank `_` variable symbols (bare-value-reads forbids `_`)",
    transform: r => ({
      ...r,
      symbols: [
        ...(r.symbols ?? []),
        { name: "_", kind: "variable", scope: "global", visibility: "private", range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 } },
      ],
    }),
  },
  {
    id: "go/owned-field-exports",
    language: "go",
    defectClass: "export-fabrication",
    description: "GO7 #736 regression: re-exports owned struct fields — public field X re-enters the export list (bare-value-reads forbids X; the harness uniqueness invariant also fires)",
    transform: r => ({
      ...r,
      exports: [...(r.exports ?? []), { name: "X", kind: "property" }],
    }),
  },
  {
    id: "go/package-endindex",
    language: "go",
    defectClass: "range-incoherence",
    description: "GO4 #736 regression: reverts the package endIndex fix — exclusive byte offset off by one (bare-value-reads pins reads-module endIndex 13 via expectSymbolRanges)",
    transform: r => ({
      ...r,
      symbols: (r.symbols ?? []).map((s: any) => s.name === "reads" && s.kind === "module"
        ? { ...s, range: { ...(s.range ?? {}), endIndex: 14 } }
        : s),
    }),
  },
  {
    id: "go/generic-composite-drop",
    language: "go",
    defectClass: "relationship-loss",
    description: "GO8 #736 regression: reverts generic composite unwrapping — `Box[int]{...}` emits no construction edge (generic-construction pins instantiates MakeBox->Box)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !(String(x.type ?? x.relationshipType) === "instantiates" && x.target === "Box")) }),
  },
  {
    id: "go/assign-lhs-reads",
    language: "go",
    defectClass: "relationship-noise",
    description: "GO9 second-review regression: reverts the expression_list-aware write gate — assignment LHS targets leak as uses again (bare-value-reads forbids uses writeonly->wa/wb and writeplain->wa)",
    transform: r => ({
      ...r,
      relationships: [
        ...(r.relationships ?? []),
        { source: "writeonly", target: "wa", type: "uses", confidence: 1.0, metadata: { relationshipType: "identifier_usage", nodeType: "identifier" } },
        { source: "writeplain", target: "wa", type: "uses", confidence: 1.0, metadata: { relationshipType: "identifier_usage", nodeType: "identifier" } },
      ],
    }),
  },
  {
    id: "go/arraylen-param-shadow",
    language: "go",
    defectClass: "relationship-loss",
    description: "GO10 second-review regression: parameter binding swallows type-position identifiers again — the array-length read goes silent (bare-value-reads expects uses sized->N)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(normRel(x).type === "uses" && normRel(x).source === "sized" && normRel(x).target === "N")) }),
  },
  {
    id: "go/map-key-silence",
    language: "go",
    defectClass: "relationship-loss",
    description: "GO11 second-review regression: map-literal keys treated as struct keys again — the key read goes silent (bare-value-reads expects uses keyed->Red)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(normRel(x).type === "uses" && normRel(x).source === "keyed" && normRel(x).target === "Red")) }),
  },
  {
    id: "go/builtin-receiver-drop",
    language: "go",
    defectClass: "relationship-loss",
    description: "GO13 second-review regression: the builtin filter matches the receiver again — qualified calls on builtin-named packages vanish (relationship-and-payloads expects calls duplicate->DeepCopyValue)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(normRel(x).type === "calls" && normRel(x).source === "duplicate" && normRel(x).target === "DeepCopyValue")) }),
  },
  {
    id: "svelte/script-relative-indices",
    language: "svelte",
    defectClass: "range-incoherence",
    description: "Sv1 #736 regression (H4): reverts SFC index shifts — script-derived ranges keep script-relative byte indices (work startIndex 50->31, endIndex 86->55; script-range-coherence pins SFC-absolute)",
    transform: r => ({
      ...r,
      symbols: (r.symbols ?? []).map((s: any) => s.name === "work"
        ? { ...s, range: { ...(s.range ?? {}), startIndex: 31, endIndex: 55 } }
        : s),
    }),
  },
  {
    id: "vue/reemit-filtered-kebab-tags",
    language: "vue",
    defectClass: "relationship-fabrication",
    description: "M37.21 #611 regression: re-emits modern-HTML/SVG builtin tags as component instantiates — <search> (2023 HTML element) and the camelCase SVG tags (linearGradient, clipPath, mask, pattern, marker, symbol) are filtered by the analyzer's builtin set; re-adding them is the ORACLE_HTML_TAGS drift class that faked a MISSING in vue-element-admin",
    transform: r => {
      const rels = r.relationships ?? []
      const source = "vue-component-usage" // pinned: first-edge source is unstable across sub-analyzer evolution
      return { ...r, relationships: [...rels, { source, target: "search", type: "instantiates", confidence: 0.95, metadata: { isComponentUsage: true } }] }
    },
  },
  {
    id: "vue/data-keys-drop",
    language: "vue",
    defectClass: "symbol-loss",
    description: "H1 regression: drops data-state key symbols again — data-keys + data-factory-keys pins catch it",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).filter((s: any) => !((s as any).metadata ?? {}).isDataKey) }),
  },
  {
    id: "vue/error-offset-revert",
    language: "vue",
    defectClass: "payload-corruption",
    description: "H2 regression: pushes script errors raw again (script lines, not SFC) — script-error-offset startLine pin catches it",
    transform: r => ({ ...r, errors: (r.errors ?? []).map((e: any) => ({ ...e, range: { ...(e.range ?? {}), startLine: 2 } })) }),
  },
  {
    id: "vue/index-revert",
    language: "vue",
    defectClass: "payload-corruption",
    description: "H3 regression: zeroes symbol byte indices again (line/index incoherence) — range-coherence startIndex pin catches it",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => ({ ...s, range: { ...((s as any).range ?? {}), startIndex: 0 } })) }),
  },
  {
    id: "vue/chain-root-revert",
    language: "vue",
    defectClass: "relationship-noise",
    description: "M1 regression: re-emits loop-property reads as member uses again — member-chain forbid pin catches it",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { type: "uses", source: "member-chain", target: "id", confidence: 0.95, metadata: { isTemplateExpression: true } }] }),
  },
  {
    id: "vue/quoted-keys-revert",
    language: "vue",
    defectClass: "payload-corruption",
    description: "M2 regression: restores quoted names and raw [dyn] symbols — quoted-keys pins catch both",
    transform: r => ({ ...r, symbols: [...(r.symbols ?? []).filter((s: any) => s.name !== "save-data"), { name: "\"save-data\"", kind: "method" }, { name: "[dyn]", kind: "method" }] }),
  },
  {
    id: "vue/lifecycle-drop",
    language: "vue",
    defectClass: "symbol-loss",
    description: "M3 regression: drops serverPrefetch again — lifecycle-server-prefetch pin catches it",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).filter((s: any) => s.name !== "serverPrefetch") }),
  },
  {
    id: "vue/default-text-revert",
    language: "vue",
    defectClass: "payload-loss",
    description: "M4 regression: restores the text-prefix default-export check — commented defaults lose component ownership again — commented-default ownerName pin catches it",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => (s.name === "go" ? { ...s, ownerName: undefined } : s)) }),
  },
  {
    id: "vue/payload-drop",
    language: "vue",
    defectClass: "payload-loss",
    description: "M5 regression: strips Options-member payloads again (bare signatures) — options-payload parameter pin catches it",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => (s.name === "save" ? { ...s, parameters: [] } : s)) }),
  },
  {
    id: "vue/string-args-revert",
    language: "vue",
    defectClass: "relationship-noise",
    description: "D1 regression: string-literal contents read as members again — template-string-args forbid pin catches it",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { type: "uses", source: "template-string-args", target: "save", confidence: 0.95, metadata: { isTemplateExpression: true } }] }),
  },
  {
    id: "vue/arrow-data-drop",
    language: "vue",
    defectClass: "symbol-loss",
    description: "D2 regression: expression-bodied data factories lose their keys again — arrow-data pin catches it",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).filter((s: any) => s.name !== "count" || (s as any).ownerName !== "arrow-data") }),
  },
  {
    id: "vue/decorated-default-revert",
    language: "vue",
    defectClass: "payload-loss",
    description: "D3 regression: leading decorators blind the default-export check again — decorated-default ownerName pin catches it",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => (s.name === "go" ? { ...s, ownerName: undefined } : s)) }),
  },
  {
    id: "groovy/drop-class-symbols",
    language: "groovy",
    defectClass: "symbol-loss",
    description: "drops every class symbol",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).filter(s => s.kind !== "class") }),
  },
  {
    id: "groovy/drop-array-access",
    language: "groovy",
    defectClass: "relationship-loss",
    description: "drops Uses edges for array reads/writes (#419 groovy G1 bug class)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(x.metadata ?? {}).isArrayAccess) }),
  },
  {
    id: "groovy/drop-ctor-delegation",
    language: "groovy",
    defectClass: "relationship-loss",
    description: "drops Calls edges for super()/this() constructor delegation (#419 groovy G2 bug class)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => (x.metadata ?? {}).relationshipType !== "constructor_invocation") }),
  },
  {
    id: "groovy/drop-pattern-refs",
    language: "groovy",
    defectClass: "relationship-loss",
    description: "drops pattern type references (instanceof + switch case) (#419 groovy G3 bug class)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !["instanceof_expression", "case_pattern"].includes(String(x.metadata?.relationshipType))) }),
  },
  {
    id: "groovy/drop-method-refs",
    language: "groovy",
    defectClass: "relationship-loss",
    description: "drops method_reference type edges (Foo::bar) (#419 groovy G4 bug class)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => (x.metadata ?? {}).relationshipType !== "method_reference") }),
  },
  {
    id: "groovy/drop-cast-types",
    language: "groovy",
    defectClass: "relationship-loss",
    description: "drops cast_expression type edges ((String) o) (#419 groovy G5 bug class)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => (x.metadata ?? {}).relationshipType !== "cast_type") }),
  },
  {
    id: "groovy/drop-record-symbols",
    language: "groovy",
    defectClass: "symbol-loss",
    description: "drops record class symbols and record components (#419 groovy G6 bug class)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).filter(s => !((s.metadata ?? {}).isRecord || (s.metadata ?? {}).nodeType === "record_component")) }),
  },
  {
    id: "groovy/drop-annotation-types",
    language: "groovy",
    defectClass: "symbol-loss",
    description: "drops annotation_type_declaration symbols (#419 groovy G7 bug class)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).filter(s => (s.metadata ?? {}).nodeType !== "annotation_type_declaration") }),
  },
  {
    id: "groovy/drop-import-edges",
    language: "groovy",
    defectClass: "relationship-loss",
    description: "drops the imports dependency edges (isGroovyImport references) — #419 groovy G8 imports pin",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(x.metadata ?? {}).isGroovyImport) }),
  },
  {
    id: "groovy/drop-wildcard-flag",
    language: "groovy",
    defectClass: "metadata-loss",
    description: "clears isWildcard on import edges (wildcard imports lose the flag — groovy G8 companion bug)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map((x: any) => (x.metadata ?? {}).isGroovyImport ? { ...x, metadata: { ...x.metadata, isWildcard: false } } : x) }),
  },
  {
    id: "groovy/drop-parameters",
    language: "groovy",
    defectClass: "payload-loss",
    description: "drops the parameters payload from method symbols — #383 Matrix 1b parameters pin (groovy cell PENDING -> #383)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => ({ ...s, parameters: undefined })) }),
  },
  {
    id: "groovy/drop-varargs-type",
    language: "groovy",
    defectClass: "payload-loss",
    description: "drops the [] erasure suffix and name fix on varargs parameters (String... parts back to anonymous/String)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => ({ ...s, parameters: (s.parameters ?? []).map((p: any) => ({ ...p, name: p.name === "parts" ? "anonymous" : p.name, type: p.type === "String[]" ? "String" : p.type })) })) }),
  },
  {
    id: "groovy/drop-contains-edges",
    language: "groovy",
    defectClass: "relationship-loss",
    description: "drops contains edges for type/member/field containment — #419 groovy section B contains pin",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => x.type !== "contains") }),
  },
  {
    id: "groovy/anonymous-body-scope-leak",
    language: "groovy",
    defectClass: "payload-corruption",
    description: "GD18 regression: reverts the anonymous-inner-class scope push — run re-attributes to the enclosing class (contains Tree->run) and the anonymous_Runnable symbol vanishes — multihop-override-resolution pins catch both",
    transform: r => ({ ...r,
      symbols: (r.symbols ?? []).filter((s: any) => !String(s.name).startsWith("anonymous_")),
      relationships: (r.relationships ?? []).map((x: any) =>
        (x.type === "contains" && x.target === "run") ? { ...x, source: "Tree" } : x),
    }),
  },
  {
    id: "groovy/override-multihop-fallthrough",
    language: "groovy",
    defectClass: "fabrication",
    description: "GD19 regression: reverts the suffix-resolved hierarchy walk — the pre-fix BFS missed through non-declaring ancestors and fell through to the pass-3 first-parent guess, fabricating BlackVal.val -> Black.val at 0.5 (wrong edge, Black declares no val) — multihop-override-resolution forbid pin catches it",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map((x: any) =>
      (x.type === "overrides" && x.source === "BlackVal.val") ? { ...x, target: "Black.val", confidence: 0.5 } : x),
    }),
  },
  {
    id: "groovy/grammar-round3-call-drop",
    language: "groovy",
    defectClass: "relationship-loss",
    description: "#841 round-3 regression: drops calls sourced from the round-3 constructs — the .& method-reference, interaction-DSL slashy callee, leading-dot/elvis continuation, operator-first && continuation, GString call name, exclusive-range, primitive-operand, and bare-assert bodies (grammar-round3-841 expects refer->eachEntry, check->isPresent, fetch->getProperty, dispatch->\"$entry.key\", interact->/print.*/). If the grammar or the leading_dot_call analyzer handler regresses, those calls vanish rather than failing a fixture. Also drops the def-squeeze repairs: a misnamed constructor reverts to kind=constructor and the phantom `def` property reappears (pinned by forbidSymbols).",
    transform: r => ({ ...r,
      relationships: (r.relationships ?? []).filter((x: any) =>
        !(x.type === "calls" && ["refer", "check", "fetch", "dispatch", "interact"].includes(x.source))),
      symbols: (r.symbols ?? []).map((s: any) =>
        s.name === "refer" && s.kind === "method" ? { ...s, kind: "constructor" } : s),
    }),
  },
  {
    id: "groovy/grammar-residual-call-drop",
    language: "groovy",
    defectClass: "relationship-loss",
    description: "#841 regression: drops calls whose source lives in a grammar-residual region — the typed for-in / slashy / spread-map / one-line-class-field / one-line-try bodies that the grammar round made parseable (grammar-residuals-841 expects deployAll->deploy, deployAll->attempt, deployAll->log). If the grammar regresses, those calls vanish into ERROR regions rather than failing a fixture, so the drop is the observable pin.",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) =>
      !(x.type === "calls" && x.source === "deployAll")) }),
  },
  {
    id: "groovy/as-cast-drop",
    language: "groovy",
    defectClass: "relationship-loss",
    description: "G1 regression: drops every `as`-coercion cast_type ref — `o as String`, `[] as Set`, `x as T[]` — as-cast expects run->String/run->Set, cast-types expects its C-cast refs, grammar-rebuild-constructs expects convert->String (declaredOn binary_expression since the #742 rebuild; the pre-rebuild mis-parse marker `as_cast` no longer exists, which is why the filter is keyed on the structural relationshipType)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => (x.metadata ?? {}).relationshipType !== "cast_type") }),
  },
  {
    id: "groovy/implicit-override-drop",
    language: "groovy",
    defectClass: "relationship-loss",
    description: "G2 regression: reverts to @Override-only override tasks — un-annotated Sub.greet redeclaring Base.greet emits nothing — implicit-override fixture expects Sub.greet->Base.greet at exact-in-file",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) =>
      !(x.type === "overrides" && x.source === "Sub.greet" && x.target === "Base.greet")) }),
  },
  {
    id: "groovy/ctor-name-revert",
    language: "groovy",
    defectClass: "payload-corruption",
    description: "G4 regression: restores the 'constructor' literal — Alpha()/Beta() ctors collide under one name (contains Alpha->constructor vs Beta->constructor indistinguishable) — ctor-identity fixture expects class-named ctors and forbids the literal",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) =>
      (s.kind === "constructor" && s.ownerName) ? { ...s, name: "constructor" } : s) }),
  },
  {
    id: "groovy/export-filter-revert",
    language: "groovy",
    defectClass: "payload-corruption",
    description: "G3-ruling regression: re-emits member exports (trait member greet as an export again, pre-ruling behavior) — trait-exports forbidExports pin catches it",
    transform: r => ({ ...r, exports: [...(r.exports ?? []), { name: "greet", isDefault: false }] }),
  },
  {
    id: "groovy/static-flag-drop",
    language: "groovy",
    defectClass: "payload-corruption",
    description: "G5 regression: reverts to the named-children text scan — `static` (anonymous token) never matches so static imports record isStatic:false, and isNamespace/isWildcard disagree on wildcards — static-import-flag fixture pins all three flag rows",
    transform: r => ({ ...r, imports: (r.imports ?? []).map((i: any) => ({ ...i, isNamespace: false, metadata: { ...(i.metadata ?? {}), isWildcard: false, isStatic: false } })) }),
  },
  {
    id: "groovy/anon-export-leak",
    language: "groovy",
    defectClass: "payload-corruption",
    description: "G7 regression: re-emits the class-level anonymous-class noise name as an export — anonymous_Runnable leaks although the family convention says it never enters the index — anon-exports forbidExports pin catches it",
    transform: r => ({ ...r, exports: [...(r.exports ?? []), { name: "anonymous_Runnable", isDefault: false }] }),
  },
  {
    id: "groovy/multicatch-drop",
    language: "groovy",
    defectClass: "relationship-loss",
    description: "G1-wave regression: removes the catch_formal_parameter case — multi-catch `catch (IOException | SQLException e)` emits zero declared_type refs (the union's catch_type members never reach the type-usage graph) — multicatch-and-varargs fixture expects BOTH IOException and SQLException",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) =>
      !((x.metadata ?? {}).declaredOn === "catch_formal_parameter")) }),
  },
  {
    id: "csharp/drop-field-access-uses",
    language: "csharp",
    defectClass: "relationship-loss",
    description: "drops csharp field-access Uses edges — #264 section B uses pin",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => (x.metadata ?? {}).relationshipType !== "csharp_field_access") }),
  },
  {
    id: "csharp/emit-write-as-read",
    language: "csharp",
    defectClass: "relationship-fabrication",
    description: "SCD1 regression: removes the field-access assignment-LHS write gate — re-injects the exact pre-fix edges probe-verified on pure/compound writes to this.Name (Reset->Name uses) — csharp Reset forbid catches it",
    transform: r => ({
      ...r,
      relationships: [...(r.relationships ?? []), {
        type: "uses", source: "Reset", target: "Name", isExternal: true, weight: 1, confidence: 0.7, metadata: { relationshipType: "csharp_field_access" },
      }],
    }),
  },
  {
    id: "csharp/drop-symbol-complexity",
    language: "csharp",
    defectClass: "payload-loss",
    description: "drops csharp per-symbol complexity — #264 section C complexity pin",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => ({ ...s, complexity: undefined })) }),
  },
  {
    id: "csharp/drop-implements-edge",
    language: "csharp",
    defectClass: "relationship-loss",
    description: "drops csharp implements edges (Shape->IShape) — #264 section B implements pin",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => x.type !== "implements") }),
  },
  {
    id: "csharp/callee-field-access-leak",
    language: "csharp",
    defectClass: "relationship-noise",
    description: "injects the M37 TSD6-sweep regression class: a dead callee-identity skip (fn === node, never true for web-tree-sitter wrappers) leaks call-position member_access as bogus csharp_field_access uses — payload-and-complexity forbid pins must catch it",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), ...(r.relationships ?? []).filter((x: any) => x.type === "calls").map((x: any) => ({ ...x, type: "uses", metadata: { ...(x.metadata ?? {}), relationshipType: "csharp_field_access" } }))] }),
  },
  {
    id: "csharp/ctor-initializer-loss",
    language: "csharp",
    defectClass: "relationship-loss",
    description: "drops CSD8 constructor-initializer calls — re-review pin calls:constructor->this",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !((x.metadata ?? {}).isConstructorInitializer)) }),
  },
  {
    id: "csharp/operator-name-collapse",
    language: "csharp",
    defectClass: "payload-loss",
    description: "injects the CSD3 regression class: operator overloads collapse to the literal name 'operator' — fixture pins operator + and operator int symbols",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => (s.metadata ?? {}).isOperatorOverload ? { ...s, name: "operator" } : s) }),
  },
  {
    id: "csharp/drop-accessor-events",
    language: "csharp",
    defectClass: "symbol-loss",
    description: "drops CSD5 accessor-form event symbols (F6Overflow) — re-review symbol pin",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).filter((s: any) => !((s.metadata ?? {}).isAccessorForm)) }),
  },
  {
    id: "csharp/switch-arm-complexity-loss",
    language: "csharp",
    defectClass: "payload-loss",
    description: "injects the CSD2 regression class: switch-expression arms no longer count (Pick drops from 4 to 1) — fixture complexity pin",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => s.name === "Pick" ? { ...s, complexity: 1 } : s) }),
  },
  {
    id: "csharp/filescoped-fqn-loss",
    language: "csharp",
    defectClass: "fabrication",
    description: "injects the CSD1/CSD9 regression class: file-scoped namespace qualification lost AND primary-base argument lists leak as implements targets — fixture forbids implements:F6Derived->(\"seed\", 1)",
    transform: r => ({ ...r, relationships: [
      ...(r.relationships ?? []).map((x: any) => x.type === "implements" && x.target === "IShape" ? { ...x, source: "Shape" } : x),
      { type: "implements", source: "F6Derived", target: "(\"seed\", 1)", fromSymbol: "F6Derived", toSymbol: "(\"seed\", 1)", confidence: 1.0, metadata: { isImplements: true } },
    ] }),
  },
  {
    id: "csharp/implicit-new-assignment-loss",
    language: "csharp",
    defectClass: "relationship-loss",
    description: "injects the CSD11 regression class: assignment-form target-typed new() drops its instantiates (the constructor->Dictionary edge vanishes) — fixture instantiates pin",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !((x.metadata ?? {}).isImplicit && x.source === "constructor")) }),
  },
  {
    id: "csharp/iface-base-extends-fabrication",
    language: "csharp",
    defectClass: "fabrication",
    description: "injects the CSD12 regression class: interface-only external base lists fabricate extends again (F6Tank/F6Handle -> IDisposable become extends) — fixture forbids extends:F6Tank->IDisposable",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map((x: any) => x.type === "implements" && x.target === "IDisposable" ? { ...x, type: "extends", metadata: { ...x.metadata, isImplements: false } } : x) }),
  },
  {
    id: "csharp/array-member-new-selfmap",
    language: "csharp",
    defectClass: "fabrication",
    description: "injects the CSD14 regression class: array/collection-typed member target-typed new() self-maps to the member NAME again (Prebuilt/Selected/Grid->themselves) — csd14 fixture pins element-type targets and forbids self targets",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map((x: any) => (x.type === "instantiates" && (x.source === "Prebuilt" || x.source === "Selected" || x.source === "Grid" || x.source === "Fallback")) ? { ...x, target: x.source } : x) }),
  },
  {
    id: "csharp/drop-bare-uses",
    language: "csharp",
    defectClass: "relationship-loss",
    description: "CS-R1 regression: drops every bare identifier_usage edge — restores the pre-review state where member reads like Max/count/Step emitted nothing (bare-value-reads pins Get->Max/count/Step and friends)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => (x.metadata ?? {}).relationshipType !== "identifier_usage") }),
  },
  {
    id: "csharp/reemit-shadowed-reads",
    language: "csharp",
    defectClass: "shadowing-loss",
    description: "CS-R1 shadowing regression: re-injects reads suppressed by params/patterns/closures/queries/locals (bare-value-reads forbids Shadowed->Max, Check->p, Arm->q, Flow->x/y/p, Guards->v/w/a/b)",
    transform: r => ({
      ...r,
      relationships: [
        ...(r.relationships ?? []),
        { source: "Shadowed", target: "Max", type: "uses", confidence: 1.0, metadata: { relationshipType: "identifier_usage", nodeType: "identifier" } },
        { source: "Check", target: "p", type: "uses", confidence: 1.0, metadata: { relationshipType: "identifier_usage", nodeType: "identifier" } },
        { source: "Flow", target: "x", type: "uses", confidence: 1.0, metadata: { relationshipType: "identifier_usage", nodeType: "identifier" } },
        { source: "Guards", target: "v", type: "uses", confidence: 1.0, metadata: { relationshipType: "identifier_usage", nodeType: "identifier" } },
      ],
    }),
  },
  {
    id: "csharp/reemit-designator-reads",
    language: "csharp",
    defectClass: "relationship-noise",
    description: "CS-R1 designator regression: re-injects reads for with/subpattern/anontype/attribute names (bare-value-reads forbids Make->X/Y, Sub->X/Y, Annotated->Size)",
    transform: r => ({
      ...r,
      relationships: [
        ...(r.relationships ?? []),
        { source: "Make", target: "X", type: "uses", confidence: 1.0, metadata: { relationshipType: "identifier_usage", nodeType: "identifier" } },
        { source: "Sub", target: "X", type: "uses", confidence: 1.0, metadata: { relationshipType: "identifier_usage", nodeType: "identifier" } },
        { source: "Annotated", target: "Size", type: "uses", confidence: 1.0, metadata: { relationshipType: "identifier_usage", nodeType: "identifier" } },
      ],
    }),
  },
  {
    id: "csharp/top-level-call-loss",
    language: "csharp",
    defectClass: "relationship-loss",
    description: "CS-B1 regression: drops top-level-statement calls again (bare-value-reads expects calls global->WriteLine)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(normRel(x).type === "calls" && normRel(x).source === "global" && normRel(x).target === "WriteLine")) }),
  },
  {
    id: "csharp/nameof-call-fabrication",
    language: "csharp",
    defectClass: "relationship-noise",
    description: "CS-B2 regression: re-fabricates calls->nameof (bare-value-reads forbids any calls to nameof)",
    transform: r => ({
      ...r,
      relationships: [...(r.relationships ?? []), { source: "NameOf", target: "nameof", type: "calls", confidence: 0.9, metadata: { csharpCallExpression: "nameof" } }],
    }),
  },
  {
    id: "csharp/bare-catch-complexity-loss",
    language: "csharp",
    defectClass: "payload-drift",
    description: "CS-B3 regression: bare catch blocks stop counting (bare-value-reads pins Errors complexity 2)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => (s.name === "Errors" ? { ...s, complexity: 1 } : s)) }),
  },
  {
    id: "csharp/file-type-exported",
    language: "csharp",
    defectClass: "export-fabrication",
    description: "CS-B4 regression: file-scoped types export as public API again (bare-value-reads pins Hidden private + forbids its export)",
    transform: r => ({
      ...r,
      symbols: (r.symbols ?? []).map((s: any) => (s.name === "Hidden" ? { ...s, visibility: "public" } : s)),
      exports: [...(r.exports ?? []), { name: "Hidden", kind: "class" }],
    }),
  },
  {
    id: "csharp/reemit-initializer-designator-reads",
    language: "csharp",
    defectClass: "relationship-noise",
    description: "Second-review regression: object-initializer designators read again (bare-value-reads forbids uses Build->X/Y)",
    transform: r => ({
      ...r,
      relationships: [
        ...(r.relationships ?? []),
        { source: "Build", target: "X", type: "uses", confidence: 1.0, metadata: { relationshipType: "identifier_usage", nodeType: "identifier" } },
      ],
    }),
  },
  {
    id: "csharp/framework-detection-dropped",
    language: "csharp",
    defectClass: "payload-loss",
    description: "CONV-CS-2 (#751) regression: framework payload reverts to the pre-fix state (keys absent / empty) — framework-detection pins framework + detectedFrameworks + frameworkPatterns, framework-none pins the [] shell",
    transform: r => ({
      ...r,
      metadata: { ...(r.metadata ?? {}), framework: undefined, detectedFrameworks: [], frameworkPatterns: [] },
    }),
  },
  {
    id: "csharp/framework-overshoot",
    language: "csharp",
    defectClass: "payload-noise",
    description: "CONV-CS-2 (#751) over-match regression: every absent family fabricated into detectedFrameworks + frameworkPatterns — framework-detection forbids Unity/WPF/Windows Forms/NUnit/MSTest and framework-none pins []",
    transform: r => ({
      ...r,
      metadata: {
        ...(r.metadata ?? {}),
        detectedFrameworks: [...((r.metadata as any)?.detectedFrameworks ?? []), "Unity", "WPF", "Windows Forms", "NUnit", "MSTest"],
        frameworkPatterns: [
          ...((r.metadata as any)?.frameworkPatterns ?? []),
          { framework: "Unity", patterns: ["game_engine"] },
          { framework: "WPF", patterns: ["ui_framework"] },
          { framework: "Windows Forms", patterns: ["ui_framework"] },
          { framework: "NUnit", patterns: ["test_framework"] },
          { framework: "MSTest", patterns: ["test_framework"] },
        ],
      },
    }),
  },
  {
    id: "dart/drop-implements-edge",
    language: "dart",
    defectClass: "relationship-loss",
    description: "drops dart implements edges (OrderRepositoryImpl->OrderRepository) — dart section B implements pin",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => x.type !== "implements") }),
  },
  {
    id: "dart/drop-mixin-uses-edge",
    language: "dart",
    defectClass: "relationship-loss",
    description: "drops dart mixin uses edges (with RepositoryLogger) — dart section B uses pin",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !((x.metadata ?? {}).isMixin && x.type === "uses")) }),
  },
  {
    id: "dart/drop-constructor-instantiates",
    language: "dart",
    defectClass: "relationship-loss",
    description: "drops dart constructor-invocation instantiates edges (OrderLoading etc.) — dart section B instantiates pin",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => x.type !== "instantiates") }),
  },
  {
    id: "dart/heritage-alias-not-resolved",
    language: "dart",
    defectClass: "misattribution",
    description: "reverts DAD1: emits the import-alias prefix (_iDart) as the extends target instead of the resolved leaf (FakeBase) — fixture pins extends:F6MockClient->FakeBase and forbids extends->_iDart",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map((x: any) => x.type === "extends" && x.target === "FakeBase" ? { ...x, target: "_iDart" } : x) }),
  },
  {
    id: "dart/implements-alias-leak",
    language: "dart",
    defectClass: "fabrication",
    description: "reverts DAD2: leaks the import-alias containers (_iIo/_iAsync) as implements targets alongside the resolved names — fixture forbids implements->_iIo and implements->_iAsync",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).concat([
      { source: "F6MockClient", target: "_iIo", type: "implements", confidence: 1.0, metadata: { isImplements: true } },
      { source: "F6MockClient", target: "_iAsync", type: "implements", confidence: 1.0, metadata: { isImplements: true } },
    ]) }),
  },
  {
    id: "dart/dup-rows-reintroduced",
    language: "dart",
    defectClass: "payload-noise",
    description: "reverts DARTD7: per-site call/instantiates emission with no dedup (each calls/instantiates row doubled) — dedup-and-attribution expectRelationshipCount equals:1 pins (instantiates IconSet->IconData, calls build->make)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).concat((r.relationships ?? []).filter((x: any) => x.type === "calls" || x.type === "instantiates")) }),
  },
  {
    id: "dart/field-init-module-source",
    language: "dart",
    defectClass: "misattribution",
    description: "reverts DARTD9: class-member initializers attribute instantiates to the module (dedup-and-attribution) instead of the owning class — fixture forbids instantiates:dedup-and-attribution->IconData and expects IconSet->IconData",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map((x: any) => x.type === "instantiates" && (x.source === "IconSet" || x.source === "build") && x.target === "IconData" ? { ...x, source: "dedup-and-attribution" } : x) }),
  },
  {
    id: "dart/local-fn-symbols-reintroduced",
    language: "dart",
    defectClass: "symbol-pollution",
    description: "reverts DARTD8 symbol side: local functions leak as top-level Function symbols again — fixture forbids symbol localHelper",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).concat([{ name: "localHelper", kind: "function", scope: "", visibility: "private" }]) }),
  },
  {
    id: "dart/local-fn-call-context-reintroduced",
    language: "dart",
    defectClass: "misattribution",
    description: "reverts DARTD8 call side: calls inside a local function attribute to the local name (localHelper->helperCall) instead of folding into the enclosing function — fixture expects calls topFn->helperCall and forbids calls from localHelper",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map((x: any) => x.type === "calls" && x.source === "topFn" && x.target === "helperCall" ? { ...x, source: "localHelper" } : x) }),
  },
  {
    id: "dart/top-level-accessors-dropped",
    language: "dart",
    defectClass: "symbol-loss",
    description: "reverts DARTD10: top-level getter/setter signatures fall through all dispatch branches and vanish — fixture expects symbol activeKeys property meta.isTopLevelAccessor:true",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).filter((x: any) => !(x.name === "activeKeys" && x.metadata?.isTopLevelAccessor)) }),
  },
  {
    id: "dart/accessor-pair-collapsed",
    language: "dart",
    defectClass: "symbol-loss",
    description: "reverts DARTD12: getter/setter pairs dedup to one symbol (owner:name key without kind) — expectSymbolCount value/property/Counter equals:2 fails",
    transform: r => {
      let dropped = false
      const symbols = (r.symbols ?? []).filter((x: any) => {
        if (!dropped && x.name === "value" && x.ownerName === "Counter" && x.metadata?.isSetter) { dropped = true; return false }
        return true
      })
      return { ...r, symbols }
    },
  },
  {
    id: "dart/param-types-degraded",
    language: "dart",
    defectClass: "payload-corruption",
    description: "reverts DARTD13: every parameter type degrades to dynamic (the old childForFieldName('type') miss) — expectParameters pins total:double, nv:int, sides:int fail",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => ({
      ...s,
      parameters: (s.parameters ?? []).map((p: any) => ({ ...p, type: "dynamic" })),
    })) }),
  },
  {
    id: "dart/mixin-on-heritage-dropped",
    language: "dart",
    defectClass: "relationship-loss",
    description: "reverts DARTD14: mixin on-clause base never emits extends — expectRelationships extends Flow->Base meta.isMixinOn:true fails",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !(x.type === "extends" && x.source === "Flow" && x.metadata?.isMixinOn)) }),
  },
  {
    id: "dart/enum-heritage-dropped",
    language: "dart",
    defectClass: "relationship-loss",
    description: "reverts DARTD15: enhanced enum implements edges never emit — expectRelationships implements Poly->Shape fails",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !(x.type === "implements" && x.source === "Poly" && x.target === "Shape")) }),
  },
  {
    id: "dart/external-override-dropped",
    language: "dart",
    defectClass: "relationship-loss",
    description: "reverts DARTD16: cross-file @override methods emit no overrides edge (the 34k-class corpus loss) — expectRelationships overrides Banner.toString->StatelessWidget.toString fails",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => x.type !== "overrides" || !String(x.source).startsWith("Banner")) }),
  },
  {
    id: "dart/field-override-fabricated",
    language: "dart",
    defectClass: "relationship-fabrication",
    description: "re-introduces the DARTD16 un-gated fallback: fields fake external overrides (Poly.sides->Shape.sides) — fixture forbids that exact row",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).concat([
      { source: "Poly.sides", target: "Shape.sides", type: "overrides", confidence: 0.8, metadata: { isOverride: true, isExternalBase: true } },
    ]) }),
  },
  {
    id: "dart/cascade-multi-invocation-dropped",
    language: "dart",
    defectClass: "relationship-loss",
    description: "reverts DARTD18: multi-invocation cascade sections keep only the LAST selector call (`..transform(t)..listen((){})` loses transform) — family-closure fixture expects calls make->transform AND make->listen",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !((x.metadata ?? {}).isCascade && x.type === "calls" && x.source === "make" && x.target === "transform")) }),
  },
  {
    id: "dart/factory-redirect-instantiates-dropped",
    language: "dart",
    defectClass: "relationship-loss",
    description: "reverts DARTD19: redirecting factory emits no instantiates to the implementation class (`factory Reporter() = _Reporter` loses Reporter->_Reporter) — family-closure fixture instantiates pin",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !(x.type === "instantiates" && x.source === "Reporter" && x.target === "_Reporter")) }),
  },
  {
    id: "dart/named-ctor-leaf-call",
    language: "dart",
    defectClass: "relationship-noise",
    description: "DT-A regression: C.named() calls the dangling leaf instead of instantiating C — dart member-value-reads instantiates + forbid pins die",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !(x.type === "instantiates" && x.source === "useAll" && x.target === "C")).concat([{ type: "calls", source: "useAll", target: "named", confidence: 0.9 }]) }),
  },
  {
    id: "dart/prefix-ctor-as-call",
    language: "dart",
    defectClass: "relationship-noise",
    description: "DT-A regression: pri.Foo() calls instead of instantiating Foo — dart member-value-reads instantiates pin dies",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !(x.type === "instantiates" && x.source === "useAll" && x.target === "Foo")).concat([{ type: "calls", source: "useAll", target: "Foo", confidence: 0.9 }]) }),
  },
  {
    id: "dart/mixin-on-with-alias-leak",
    language: "dart",
    defectClass: "relationship-noise",
    description: "DT-B regression: heritage aliases leak (`on _i1.Base` extends _i1, `with _i2.Mixin` uses _i2) — dart member-value-reads alias forbids die",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []).filter((x: any) => !((x.type === "extends" && x.source === "M" && x.target === "Base") || (x.type === "uses" && x.source === "C" && x.target === "Mixin"))), { type: "extends", source: "M", target: "_i1", confidence: 1.0 }, { type: "uses", source: "C", target: "_i2", confidence: 1.0 }] }),
  },
  {
    id: "dart/redirect-alias-leak",
    language: "dart",
    defectClass: "relationship-noise",
    description: "DT-C regression: redirect target keeps the alias (`= _i1.Impl.make` instantiates _i1) — dart member-value-reads redirect forbid dies",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []).filter((x: any) => !(x.type === "instantiates" && x.source === "C" && x.target === "Impl")), { type: "instantiates", source: "C", target: "_i1", confidence: 0.95 }] }),
  },
  {
    id: "dart/drop-super-ctor-instantiates",
    language: "dart",
    defectClass: "relationship-loss",
    description: "DT-D regression: super() initializers instantiate nothing — dart member-value-reads constructor->A pin dies",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !((x.metadata ?? x.meta ?? {}).isSuperConstructor)) }),
  },
  {
    id: "dart/drop-this-redirect-instantiates",
    language: "dart",
    defectClass: "relationship-loss",
    description: "DT-D regression: this.named() redirects instantiate nothing — dart member-value-reads constructor->B pin dies",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !((x.metadata ?? x.meta ?? {}).isRedirectingConstructor)) }),
  },
  {
    id: "dart/drop-member-read-uses",
    language: "dart",
    defectClass: "relationship-loss",
    description: "DT-F regression: qualified member reads vanish — dart member-value-reads count/total/length pins die",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !((x.metadata ?? x.meta ?? {}).isMemberRead)) }),
  },
  {
    id: "dart/drop-subscript-read-uses",
    language: "dart",
    defectClass: "relationship-loss",
    description: "DT-F regression: subscript bases vanish — dart member-value-reads xs/m pins die",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !((x.metadata ?? x.meta ?? {}).isSubscriptBase)) }),
  },
  {
    id: "dart/drop-interp-read-uses",
    language: "dart",
    defectClass: "relationship-loss",
    description: "DT-F regression: interpolation reads vanish — dart member-value-reads y/w/other pins die",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !((x.metadata ?? x.meta ?? {}).isInterpolationRead)) }),
  },
  {
    id: "dart/emit-write-as-member-read",
    language: "dart",
    defectClass: "relationship-fabrication",
    description: "DT-F read-gate regression: plain-= writes read (`c.slot = 1`, `..slot = 2`) — dart member-value-reads write forbid dies",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { type: "uses", source: "writeOnly", target: "slot", confidence: 0.9, metadata: { isMemberRead: true } }] }),
  },
  {
    id: "dart/drop-bare-member-reads",
    language: "dart",
    defectClass: "relationship-loss",
    description: "drops Uses edges for BARE identifier member reads (#752 CONV-DT-1: `return count;` on a declared field emitted nothing while `return this.count;` did) — caught by the bare-member-read-uses fixture's expectRelationships (bare/chained)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !((x.metadata ?? x.meta ?? {}).isBareRead)) }),
  },
  {
    id: "dart/bare-read-gate-bypass",
    language: "dart",
    defectClass: "relationship-fabrication",
    description: "#752 gate regression: re-injects the two edges the gates exist to stop — uses(shadowed->count) (a name the CURRENT function binds locally, CGD15 gate B) and uses(Store->count) (the field DECLARATION read as a use, gate A) — caught by the bare-member-read-uses fixture's forbidRelationships",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { type: "uses", source: "shadowed", target: "count", confidence: 0.6, metadata: { isBareRead: true } }, { type: "uses", source: "Store", target: "count", confidence: 0.6, metadata: { isBareRead: true } }] }),
  },
  {
    id: "swift/drop-bare-member-reads",
    language: "swift",
    defectClass: "relationship-loss",
    description: "drops Uses edges for BARE identifier member reads (#754 CONV-SW-1: `return count` on a declared property emitted nothing while `return self.count` did) — caught by the bare-member-read-uses fixture's expectRelationships (bare/plus/computed)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !((x.metadata ?? {}).isBareRead)) }),
  },
  {
    id: "swift/bare-read-extension-blindness",
    language: "swift",
    defectClass: "relationship-loss",
    description: "#754 corpus regression: drops bare reads sourced from EXTENSION members — the pre-fix defect where `extension Foo` carried its name under `user_type`, the shallow lookup left the declaration nameless, and every bare read in every extension was silently dropped (nio FileType/IPv4Header/EventLoop/ByteBuffer). Caught by the bare-member-read-uses fixture's extBare->total expect",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !((x.metadata ?? {}).isBareRead && x.source === "extBare")) }),
  },
  {
    id: "swift/bare-read-gate-bypass",
    language: "swift",
    defectClass: "relationship-fabrication",
    description: "#754 gate regression: re-injects the four edges the gates exist to stop — uses(zero->count) (assignment LHS is a write), uses(computed->local) (a computed property's `let` is a local, CGD15 value-scope gate), uses(pick->fast) (an implicit member expression: base inferred, not Store) and uses(label->group) (an argument label names a parameter, not the member) — caught by the bare-member-read-uses fixture's forbidRelationships",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { type: "uses", source: "zero", target: "count", confidence: 0.6, metadata: { isBareRead: true } }, { type: "uses", source: "computed", target: "local", confidence: 0.6, metadata: { isBareRead: true } }, { type: "uses", source: "pick", target: "fast", confidence: 0.6, metadata: { isBareRead: true } }, { type: "uses", source: "label", target: "group", confidence: 0.6, metadata: { isBareRead: true } }] }),
  },
  {
    id: "dart/drop-local-read-uses",
    language: "dart",
    defectClass: "relationship-loss",
    description: "DT2 regression: bound locals/params stop reading (frames empty) — dart value-reads local pins die (member/global pins survive)",
    transform: r => {
      const drop = new Set(["compute>k", "compute>depth", "compute>limit", "compute>total", "helper>x", "shadowed>count", "sums>i", "sums>total", "sums>x", "sums>xs", "guarded>e", "blocks>x", "blocks>xs", "blocks>p", "blocks>q", "inits>b", "inits>p", "constructor>p"]);
      return { ...r, relationships: (r.relationships ?? []).filter((x: any) => !(x.type === "uses" && drop.has(`${x.source}>${x.target}`))) };
    },
  },
  {
    id: "dart/drop-global-read-uses",
    language: "dart",
    defectClass: "relationship-loss",
    description: "DT2 regression: file-scope values stop resolving (globals empty) — dart value-reads get->gTotal and label->gLabel pins die",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !(x.type === "uses" && ((x.source === "get" && x.target === "gTotal") || (x.source === "label" && x.target === "gLabel")))) }),
  },
  {
    id: "dart/emit-label-as-read",
    language: "dart",
    defectClass: "relationship-fabrication",
    description: "DT2 read-gate regression: named-argument labels read (cb:/count:) — dart value-reads label forbids die",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { type: "uses", source: "takes", target: "cb", confidence: 0.9 }, { type: "uses", source: "takes", target: "count", confidence: 0.9 }] }),
  },
  {
    id: "dart/emit-global-write-as-read",
    language: "dart",
    defectClass: "relationship-fabrication",
    description: "DT2 read-gate regression: write-only globals read (gTotal = 0) — dart value-reads reset forbid dies",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { type: "uses", source: "reset", target: "gTotal", confidence: 0.9 }] }),
  },
  {
    id: "swift/drop-implements-edge",
    language: "swift",
    defectClass: "relationship-loss",
    description: "drops swift implements edges (OrderRepositoryImpl->OrderRepository, Order->Equatable) — swift section B implements pin",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => x.type !== "implements") }),
  },
  {
    id: "swift/drop-self-uses-edge",
    language: "swift",
    defectClass: "relationship-loss",
    description: "drops swift self. member-read uses edges — swift edges-and-patterns uses pin (Calculator->history)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !((x.metadata ?? {}).isFieldAccess && x.type === "uses")) }),
  },
  {
    id: "swift/emit-write-as-read",
    language: "swift",
    defectClass: "relationship-fabrication",
    description: "SCD1 regression: removes the assignment-LHS write gate — re-injects the exact pre-fix edges probe-verified on `self.count = 0`/`self.label = \"z\"` (Counter->count, Counter->label uses) — swift/write-gate forbids catch them",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { type: "uses", source: "Counter", target: "count", isExternal: true, weight: 0.8, confidence: 1.0, metadata: { isFieldAccess: true, evidenceClass: "usage_contextual" } }, { type: "uses", source: "Counter", target: "label", isExternal: true, weight: 0.8, confidence: 1.0, metadata: { isFieldAccess: true, evidenceClass: "usage_contextual" } }] }),
  },
  {
    id: "swift/drop-glued-receiver-reads",
    language: "swift",
    defectClass: "relationship-loss",
    description: "SWD1 regression: reverts hasSelfReceiver to the pre-fix receiver chain, dropping glued-shape reads (inout `&self.ctx`, additive `base + self.count`) — swift/write-gate expectUses inoutRead->ctx pin fails when the edge vanishes (M49 W15: matched by TARGET, not by the old `source === \"Counter\"` filter — #814 moved uses sources to the enclosing method, and that hardcoded type name is exactly how this mutant went from caught to surviving)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((rel: any) => !(normRel(rel).type === "uses" && normRel(rel).target === "ctx")) }),
  },
  {
    id: "swift/drop-operator-symbol",
    language: "swift",
    defectClass: "symbol-loss",
    description: "drops swift operator overload symbols (operator + / == on Vector) — swift edges-and-patterns symbol pin",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).filter((s: any) => !(s.name && s.name.startsWith("operator ")) ) }),
  },
  {
    id: "swift/drop-symbol-complexity",
    language: "swift",
    defectClass: "payload-loss",
    description: "drops swift per-symbol complexity (parse classify guard/if/switch count) — swift section C complexity pin",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => ({ ...s, complexity: undefined })) }),
  },
  {
    id: "swift/emit-subscript-call",
    language: "swift",
    defectClass: "relationship-loss",
    description: "re-adds the bogus subscript-read calls edge (entries[key] as a call) — swift edges-and-patterns forbid pin",
    transform: r => ({
      ...r,
      relationships: [...(r.relationships ?? []), {
        type: "calls", source: "Registry", target: "entries", isExternal: true, weight: 1, confidence: 0.95, metadata: {},
      }],
    }),
  },
  {
    id: "swift/emit-defer-call",
    language: "swift",
    defectClass: "relationship-loss",
    description: "re-adds the bogus defer keyword-call edge (defer {} as calls->defer) — swift edges-and-patterns forbid pin",
    transform: r => ({
      ...r,
      relationships: [...(r.relationships ?? []), {
        type: "calls", source: "parse", target: "defer", isExternal: true, weight: 1, confidence: 0.95, metadata: {},
      }],
    }),
  },
  {
    id: "swift/class-protocol-first-as-extends",
    language: "swift",
    defectClass: "relationship-loss",
    description: "regresses the SWIFTD1 rule: treats a class's first-base protocol as extends (Circle->Shape) — swift edges-and-patterns implements/forbid pins",
    transform: r => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) =>
        x.type === "implements" && x.source === "Circle" && x.target === "Shape"
          ? { ...x, type: "extends", metadata: { ...(x.metadata ?? {}), isImplements: false } }
          : x,
      ),
    }),
  },
  // ── M37.10: overrideCompanion dead-machinery sweep ────────────────────
  // The pre-fix analyzers dropped every override whose base was declared in
  // another file (companion never populated in production). Each mutant
  // re-introduces the silent drop or breaks the guess-tier contract; the
  // external-override fixture pins must kill all of them.
  {
    id: "php/drop-external-override-guess",
    language: "php",
    defectClass: "relationship-loss",
    description: "M37.10 regression: re-drops external-base overrides (AuditService.handle->ExternalBase.handle) — php external-override pin",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !(x.type === "overrides" && x.source === "AuditService.handle" && x.target === "ExternalBase.handle")) }),
  },
  {
    id: "ruby/drop-external-override-guess",
    language: "ruby",
    defectClass: "relationship-loss",
    description: "M37.10 regression: re-drops external-base overrides (AuditService.handle->ExternalBase.handle) — ruby external-override pin",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !(x.type === "overrides" && x.source === "AuditService.handle" && x.target === "ExternalBase.handle")) }),
  },
  {
    id: "python/drop-external-override-guess",
    language: "python",
    defectClass: "relationship-loss",
    description: "M37.10 regression: re-drops external-base overrides (AuditService.handle->ExternalBase.handle) — python external-override pin",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !(x.type === "overrides" && x.source === "AuditService.handle" && x.target === "ExternalBase.handle")) }),
  },
  {
    id: "javascript/drop-external-override-guess",
    language: "javascript",
    defectClass: "relationship-loss",
    description: "M37.10 regression: re-drops external-base overrides (AuditService.handle->ExternalBase.handle) — js external-override pin",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !(x.type === "overrides" && x.source === "AuditService.handle" && x.target === "ExternalBase.handle")) }),
  },
  {
    id: "javascript/override-field-pair",
    language: "javascript",
    defectClass: "fabrication",
    description: "J2 regression: re-pairs methods against same-named base FIELDS (Sub.foo->Base.foo where Base.foo is data) — override-qualification forbid pin catches it",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { type: "overrides", source: "Sub.foo", target: "Base.foo", confidence: 0.95, metadata: {} }] }),
  },
  {
    id: "javascript/override-ctor",
    language: "javascript",
    defectClass: "fabrication",
    description: "J2 regression: re-emits constructor override edges (Sub.constructor->Base.constructor) — override-qualification forbid pin catches it",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { type: "overrides", source: "Sub.constructor", target: "Base.constructor", confidence: 0.95, metadata: {} }] }),
  },
  {
    id: "javascript/dup-first-wins",
    language: "javascript",
    defectClass: "payload-corruption",
    description: "J3 regression: restores first-wins dedup — dead first body's alpha() call leaks back into A.save's qualified_calls — duplicate-method notIncludes pin catches it",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => (s.name === "save" && (s as any).ownerName === "A") ? { ...s, qualified_calls: [...((s as any).qualified_calls ?? []), "alpha"] } : s) }),
  },
  {
    id: "javascript/import-flag-flip",
    language: "javascript",
    defectClass: "payload-corruption",
    description: "J4 regression: restores the items-count isDefault heuristic — side-effect import flips back to default — import-default-flag pin catches it",
    transform: r => ({ ...r, imports: (r.imports ?? []).map((i: any) => ((i as any).module === "./side-effect" ? { ...i, isDefault: true } : i)) }),
  },
  {
    id: "javascript/default-export-drop",
    language: "javascript",
    defectClass: "payload-loss",
    description: "J5 regression: drops expression default exports again — default-export-expression pin catches it",
    transform: r => ({ ...r, exports: (r.exports ?? []).filter((e: any) => e.name !== "default") }),
  },
  {
    id: "javascript/export-alias-revert",
    language: "javascript",
    defectClass: "payload-corruption",
    description: "J6 regression: records the local name instead of the public alias again — export-alias pin catches it",
    transform: r => ({ ...r, exports: (r.exports ?? []).map((e: any) => (e.name === "beta" ? { ...e, name: "alpha" } : e)) }),
  },
  {
    id: "javascript/params-drop",
    language: "javascript",
    defectClass: "payload-loss",
    description: "J8 regression: destructured-with-default parameters vanish again — destructured-params pin catches it",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => (s.name === "describe" ? { ...s, parameters: ((s as any).parameters ?? []).slice(0, 1) } : s)) }),
  },
  {
    id: "javascript/visibility-flip",
    language: "javascript",
    defectClass: "payload-corruption",
    description: "J9 regression: #private fields report public again — private-field-visibility pin catches it (matches the DECLARED `#secret` spelling, which is the member's one name since the #813 ruling)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => (s.name === "#secret" ? { ...s, visibility: "public" } : s)) }),
  },
  {
    id: "javascript/type-source-revert",
    language: "javascript",
    defectClass: "attribution",
    description: "M49 W15 #814 regression: re-attributes every member read to the enclosing TYPE (the pre-ruling `this`/`super` rule, which contradicted this analyzer's own bare-read source in the same body) — javascript/private-member-read-identity forbids the type-sourced spelling",
    transform: revertToTypeSource,
  },
  {
    id: "javascript/private-name-strip-revert",
    language: "javascript",
    defectClass: "symbol-identity",
    description: "M49 W15 #813 regression: private members are stored under their STRIPPED name again (`secret` for `#secret`), so every reading edge targets a name no symbol carries and a class-declared `#x` shares its slot with a same-named `x` — private-field-visibility / private-methods / visibility-payload pin the declared spelling",
    transform: (r: any) => ({
      ...r,
      symbols: (r.symbols ?? []).map((s: any) =>
        typeof s.name === "string" && s.name.startsWith("#") ? { ...s, name: s.name.slice(1) } : s
      ),
    }),
  },
  {
    id: "javascript/jsx-cap",
    language: "javascript",
    defectClass: "payload-loss",
    description: "J10 regression: restores the 500-visit JSX detection cap — early JSX in deep files loses React detection — jsx-detection-depth expectFrameworks pin catches it",
    transform: r => ({ ...r, metadata: { ...((r as any).metadata ?? {}), detectedFrameworks: ((r as any).metadata?.detectedFrameworks ?? []).filter((f: string) => f !== "React") } }),
  },
  {
    id: "javascript/import-guard-revert",
    language: "javascript",
    defectClass: "payload-noise",
    description: "T8-analog regression: dynamic import() leaks back into qualified_calls — dynamic-import-qualified notIncludes pin catches it",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => (s.name === "load" ? { ...s, qualified_calls: [...((s as any).qualified_calls ?? []), "import"] } : s)) }),
  },
  {
    id: "javascript/rebind-drop",
    language: "javascript",
    defectClass: "payload-loss",
    description: "J-rebind regression: wholesale exports = {...} assignments export nothing again — exports-rebind pin catches it",
    transform: r => ({ ...r, exports: (r.exports ?? []).filter((e: any) => e.name !== "alpha" && e.name !== "beta") }),
  },
  {
    id: "javascript/require-flag-flip",
    language: "javascript",
    defectClass: "payload-corruption",
    description: "J4-CJS regression: restores hardcoded isDefault true on every require — require-default-flag pin catches it",
    transform: r => ({ ...r, imports: (r.imports ?? []).map((i: any) => ((i as any).module === "./m2" ? { ...i, isDefault: true } : i)) }),
  },
  {
    id: "javascript/drop-chain-root-uses",
    language: "javascript",
    defectClass: "relationship-loss",
    description: "M49 #744 regression: reverts the chain-root emission — config.inner.deeper.leaf drops uses config again (chain-root-and-bare-reads pin catches it)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !(x.type === "uses" && x.metadata?.chainRoot)) }),
  },
  {
    id: "javascript/drop-bare-read-uses",
    language: "javascript",
    defectClass: "relationship-loss",
    description: "M49 #744 regression: reverts the bare identifier read emission — return config emits nothing again (chain-root-and-bare-reads pin catches it)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !(x.type === "uses" && x.metadata?.bareRead)) }),
  },
  {
    id: "javascript/import-binding-read-fabrication",
    language: "javascript",
    defectClass: "relationship-fabrication",
    description: "M49 W1 (#768) regression: import bindings are reads again — `import Default from`, `{ named, other as alias }` and `* as ns` fabricate uses @0.6 for every binding name (binding-sites-are-not-reads forbids all four; svelte/template-attr-shapes caught this pre-fix)",
    transform: r => {
      if (!(r.symbols ?? []).some((s: any) => s.name === "destructured")) return r
      const rels = [...(r.relationships ?? [])]
      for (const t of ["Default", "named", "alias", "ns"]) rels.push({ type: "uses", source: "binder", target: t, confidence: 0.6, metadata: { isFieldAccess: true, bareRead: true } })
      return { ...r, relationships: rels }
    },
  },
  {
    id: "javascript/binding-param-read-fabrication",
    language: "javascript",
    defectClass: "relationship-fabrication",
    description: "M49 W1 (#768) regression: parameters / catch params / pattern targets are reads again — `function binder(alpha, beta)`, `catch (err)`, arrow patterns and array patterns fabricate uses @0.6 (binding-sites-are-not-reads forbids each)",
    transform: r => {
      if (!(r.symbols ?? []).some((s: any) => s.name === "destructured")) return r
      const rels = [...(r.relationships ?? [])]
      rels.push({ type: "uses", source: "binder", target: "alpha", confidence: 0.6, metadata: { isFieldAccess: true, bareRead: true } })
      rels.push({ type: "uses", source: "binder", target: "beta", confidence: 0.6, metadata: { isFieldAccess: true, bareRead: true } })
      rels.push({ type: "uses", source: "catcher", target: "err", confidence: 0.6, metadata: { isFieldAccess: true, bareRead: true } })
      return { ...r, relationships: rels }
    },
  },
  {
    id: "javascript/destructure-target-read-fabrication",
    language: "javascript",
    defectClass: "relationship-fabrication",
    description: "M49 W1 (#768) regression: destructuring targets and export aliases are reads again (`{ first, second: renamed, ...third }`, `[one, two]`, `export { named as reexported }` — reexported is not even a symbol) (binding-sites-are-not-reads forbids each)",
    transform: r => {
      if (!(r.symbols ?? []).some((s: any) => s.name === "destructured")) return r
      const rels = [...(r.relationships ?? [])]
      for (const t of ["first", "renamed", "third", "one", "two", "reexported"]) rels.push({ type: "uses", source: "binder", target: t, confidence: 0.6, metadata: { isFieldAccess: true, bareRead: true } })
      return { ...r, relationships: rels }
    },
  },
  {
    id: "javascript/write-lhs-subtree-skip",
    language: "javascript",
    defectClass: "relationship-loss",
    description: "M49 W1 (#768) regression: the write-LHS suppression skips the whole subtree again — every read nested in a member-chain assignment dies (call arguments like `id`, intermediate segments like `inner`, the RHS argument `delta`) (write-lhs-nested-reads expects each)",
    transform: r => {
      if (!(r.symbols ?? []).some((s: any) => s.name === "augmented")) return r
      const kill = new Set(["delta", "id", "step", "inner", "style"])
      return { ...r, relationships: (r.relationships ?? []).filter((x: any) => !(x.type === "uses" && kill.has(x.target))) }
    },
  },
  {
    id: "javascript/write-target-read-leak",
    language: "javascript",
    defectClass: "relationship-fabrication",
    description: "M49 W1 (#768) regression: the write TARGET is reported as a read again — `store.inner.limit = delta` emits uses limit and `...style.display = v` emits uses display (write-lhs-nested-reads forbids both)",
    transform: r => {
      if (!(r.symbols ?? []).some((s: any) => s.name === "augmented")) return r
      const rels = [...(r.relationships ?? [])]
      rels.push({ type: "uses", source: "bump", target: "limit", confidence: 0.6, metadata: { isFieldAccess: true } })
      rels.push({ type: "uses", source: "dom", target: "display", confidence: 0.6, metadata: { isFieldAccess: true } })
      return { ...r, relationships: rels }
    },
  },
  {
    id: "javascript/chain-head-expression-fabrication",
    language: "javascript",
    defectClass: "relationship-garbage",
    description: "M49 W1 (#768) regression: the chain head is emitted as raw node TEXT again — a call-rooted chain fabricates the non-symbol target `uses -> document.getElementById(id)` (write-lhs-nested-reads forbids it; the oracle's head gate is mirrored)",
    transform: r => {
      if (!(r.symbols ?? []).some((s: any) => s.name === "augmented")) return r
      const rels = [...(r.relationships ?? [])]
      rels.push({ type: "uses", source: "dom", target: "document.getElementById(id)", confidence: 0.6, metadata: { isFieldAccess: true, chainRoot: true } })
      return { ...r, relationships: rels }
    },
  },
  {
    id: "javascript/sibling-object-collapse",
    language: "javascript",
    defectClass: "symbol-identity",
    description: "M49 W2 (#769) regression: the method dedup key is owner-OR-module again, so same-named methods of SIBLING object literals collapse — the earlier symbol is replaced and its body's calls die (sibling-object-member-identity pins init count=2 AND calls init->one; TS keeps both, so the family graph diverges)",
    transform: r => {
      const inits = (r.symbols ?? []).map((s: any, i: number) => i).filter((i: number) => (r.symbols ?? [])[i]?.name === "init")
      if (inits.length < 2) return r
      const drop = inits[0]
      return {
        ...r,
        symbols: (r.symbols ?? []).filter((_: any, i: number) => i !== drop),
        relationships: (r.relationships ?? []).filter((x: any) => !(x.type === "calls" && x.source === "init" && x.target === "one")),
      }
    },
  },
  {
    id: "javascript/class-expression-container-collapse",
    language: "javascript",
    defectClass: "symbol-identity",
    description: "M49 W13 regression: an ANONYMOUS class expression's members lose their container identity again, so two class expressions in one file share `module:<name>` and the second replaces the first. The first class expression's constructor is dead-spanned and its edges die — the svelte custom-element.js `this.attachShadow(...)` MISSING class, and the same-named `run` of the FIRST class expression too (class-expression-member-identity pins both)",
    transform: (r: any) => {
      const ctors = (r.symbols ?? [])
        .map((s: any, i: number) => i)
        .filter((i: number) => (r.symbols ?? [])[i]?.kind === "constructor")
      if (ctors.length < 2) return r
      return {
        ...r,
        symbols: (r.symbols ?? []).filter((_: any, i: number) => i !== ctors[0]),
        relationships: (r.relationships ?? []).filter(
          (x: any) =>
            !(x.type === "calls" && x.source === "constructor" && x.target === "attachShadow") &&
            !(x.type === "calls" && x.source === "run" && x.target === "alpha")
        ),
      }
    },
  },
  {
    id: "javascript/private-read-key-collision",
    language: "javascript",
    defectClass: "symbol-identity",
    description: "M49 W13 regression: the member-segment dedup key is `${source}.${seg}` again, so a private segment (#x) collides byte-for-byte with the bare-read key of the plain identifier `x` and the private read is swallowed (set.js: `this.#update_version` dropped because the field initializer read the imported `update_version` first; the first javascript-lane MISSING edge W12's 400-file measurement registered)",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).filter(
        (x: any) => !(x.type === "uses" && x.target === "#update_version")
      ),
    }),
  },
  {
    id: "typescript/private-read-raw-lookup",
    language: "typescript",
    defectClass: "uses-coverage",
    description: "M49 W13 regression: every private field read emits nothing again (typescript/private-member-reads pins uses read->#count and uses bump->#version and calls bump->#step)",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).filter(
        (x: any) => !(x.type === "uses" && String(x.target).startsWith("#"))
      ),
    }),
  },
  {
    id: "typescript/private-name-strip-revert",
    language: "typescript",
    defectClass: "symbol-identity",
    description: "M49 W15 #813 regression: private members are stored under their STRIPPED name again — the graph-visible symbol no longer resolves from its reading edges, and the field-access membership test (`symbolNames[name]` against the declared `#count`) goes false, so the private read vanishes too (typescript/private-member-reads pins symbol `#step` plus uses read->#count)",
    transform: (r: any) => ({
      ...r,
      symbols: (r.symbols ?? []).map((s: any) =>
        typeof s.name === "string" && s.name.startsWith("#") ? { ...s, name: s.name.slice(1) } : s
      ),
    }),
  },
  {
    id: "vue/prop-default-multi-collapse",
    language: "vue",
    defectClass: "relationship-loss",
    description: "M49 W2 (#769) regression: only the LAST prop-default() factory survives (the sibling-object dedup collapse): the earlier factory's body is dead-spanned and its random/toFixed calls vanish (prop-default-factory-calls' corpus-shape expects fail; the lane's own truth derives them)",
    transform: r => {
      if (!(r.symbols ?? []).some((s: any) => s.name === "options" && s.kind === "property")) return r
      const kill = new Set(["random", "toFixed"])
      return { ...r, relationships: (r.relationships ?? []).filter((x: any) => !(x.type === "calls" && kill.has(x.target))) }
    },
  },
  {
    id: "javascript/accessor-pair-collapse",
    language: "javascript",
    defectClass: "relationship-loss",
    description: "M49 #758 B5 regression: collapses the get/set pair back to one slot — the setter symbol disappears and the getter's body calls (val->track) die with it (accessor-slot-semantics pin catches both)",
    transform: r => {
      const syms = (r.symbols ?? []).filter((s: any) => !(s.name === "val" && s.kind === "property" && s.metadata?.accessorKind === "set"))
      return { ...r, symbols: syms, relationships: (r.relationships ?? []).filter((x: any) => !(x.type === "calls" && x.target === "track")) }
    },
  },
  {
    id: "javascript/data-slot-zombie",
    language: "javascript",
    defectClass: "fabrication",
    description: "M49 #758 B5 regression: resurrects the accessor half a data member replaced — Overwrite.x property reappears (forbidSymbols catches it)",
    transform: r => ({ ...r, symbols: [...(r.symbols ?? []), { name: "x", kind: "property" }] }),
  },
    {
    id: "vue/dupkey-revert-first-wins",
    language: "vue",
    defectClass: "relationship-loss",
    description: "M49 dup-key ruling (#745) regression: reverts Options-API member emission to first-wins — the later save() body is dropped instead of surviving (fixture pins the LAST body's qualified call)",
    transform: r => {
      // Simulate first-wins: the surviving save body becomes the FIRST one —
      // its calls (firstHelper) reappear, the last body's (lastHelper) vanish.
      const syms = r.symbols ?? []
      const seen = new Set<string>()
      const out: any[] = []
      for (const s of syms) {
        if (s.name === "save" && s.metadata?.method) {
          if (seen.has("save")) continue
          seen.add("save")
        }
        out.push(s)
      }
      const rels = (r.relationships ?? [])
        .filter((e: any) => !(String(e.type).toLowerCase() === "calls" && e.target === "lastHelper"))
      rels.push({ type: "calls", source: "save", target: "firstHelper", confidence: 0.9, metadata: { line: 4 } })
      return { ...r, symbols: out, relationships: rels }
    },
  },
  {
    id: "typescript/dupkey-keep-both",
    language: "typescript",
    defectClass: "fabrication",
    description: "M49 dup-key ruling (#746) regression: re-emits the phantom first save() (keep-both) — symbols and the phantom save->helperOne call reappear (fixture pins 1 save and forbidRelationships catches helperOne)",
    transform: r => {
      const syms = r.symbols ?? []
      const firstSave = syms.find((s: any) => s.name === "save")
      if (!firstSave) return r
      const phantom = { ...firstSave, range: { ...firstSave.range, startLine: firstSave.range.startLine - 1, endLine: firstSave.range.endLine - 1 } }
      const rels = [...(r.relationships ?? []), { type: "calls", source: "save", target: "firstHelper", confidence: 0.9, metadata: { line: 1 } }]
      return { ...r, symbols: [phantom, ...syms], relationships: rels }
    },
  },
  {
    id: "typescript/async-promise-void",
    language: "typescript",
    defectClass: "payload-corruption",
    description: "M49 #757 regression: async arrows report void again — Promise wrapping and expression inference stripped from every function returnType carrying Promise<...> (f1/f3/f4 pins catch it, including the explicit-annotation loss)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => s.kind === "function" && typeof s.returnType === "string" && s.returnType.startsWith("Promise<") ? { ...s, returnType: "void" } : s) }),
  },
  {
    id: "typescript/bracket-taint-drop",
    language: "typescript",
    defectClass: "payload-loss",
    description: "M49 #757-2 regression: bracket-form taint sources invisible again — subscript snippets dropped from taintSources (b1 pin catches it)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => s.taintSources ? { ...s, taintSources: s.taintSources.filter((t: any) => !String(t.snippet ?? t).includes("[")) } : s) }),
  },
  {
    id: "typescript/iface-override-drop",
    language: "typescript",
    defectClass: "relationship-loss",
    description: "M49 #759 regression: interface-heritage overrides vanish again — baseInterface-keyed edges dropped (Spring.subscribe pin catches it)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !(x.type === "overrides" && x.metadata?.baseInterface)) }),
  },
  {
    id: "vue/prop-default-call-drop",
    language: "vue",
    defectClass: "relationship-loss",
    description: "M49 #762 regression: Options-API prop-default factory body calls invisible again — random/toFixed member-call edges dropped from the embedded script result (prop-default-factory-calls pin catches it)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !(x.type === "calls" && (x.target === "random" || x.target === "toFixed"))) }),
  },
  {
    id: "swift/guess-at-verified-confidence",
    language: "swift",
    defectClass: "confidence-corruption",
    description: "M37.10 regression: re-claims the Pass-3 guess as verified (confidence 1.0) — swift external-override confidenceMax:0.5 pin",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map((x: any) => (x.type === "overrides" && x.source === "AuditService.handle" && x.target === "ExternalBase.handle" ? { ...x, confidence: 1, metadata: { ...(x.metadata ?? {}), reasonCode: undefined, evidenceClass: "structural" } } : x)) }),
  },
  {
    id: "swift/drop-external-override-guess",
    language: "swift",
    defectClass: "relationship-loss",
    description: "M37.10 regression: drops the external-base guess entirely — swift external-override pin",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !(x.type === "overrides" && x.source === "AuditService.handle" && x.target === "ExternalBase.handle")) }),
  },
  {
    id: "swift/drop-protocol-inheritance",
    language: "swift",
    defectClass: "relationship-loss",
    description: "SWIFTD13 regression: re-drops protocol inheritance extends (Shape->Drawable, ClassConstrained->Resettable) — inheritance-conformance-fixes extends pins die",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !(x.type === "extends" && (x.target === "Drawable" || x.target === "Resettable") && x.source !== "Circle")) }),
  },
  {
    id: "swift/protocol-anyobject-as-extends",
    language: "swift",
    defectClass: "relationship-fabrication",
    description: "SWIFTD13 regression: re-adds AnyObject as an extends target (ClassConstrained->AnyObject) — inheritance-conformance-fixes forbid pin dies",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { type: "extends", source: "ClassConstrained", target: "AnyObject", isExternal: true, weight: 1, confidence: 1, metadata: {} }] }),
  },
  {
    id: "swift/drop-extension-conformances",
    language: "swift",
    defectClass: "relationship-loss",
    description: "SWIFTD14 regression: re-skips extension bases (drops implements Circle->Equatable) — inheritance-conformance-fixes pin dies",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !(x.type === "implements" && x.source === "Circle" && x.target === "Equatable")) }),
  },
  {
    id: "swift/drop-enum-conformances",
    language: "swift",
    defectClass: "relationship-loss",
    description: "SWIFTD15 regression: re-skips enum bases entirely (drops implements Status->Codable/Sendable, Failure->Error) — inheritance-conformance-fixes pins die",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !(x.type === "implements" && (x.source === "Status" || x.source === "Failure"))) }),
  },
  {
    id: "swift/emit-xctest-instantiates",
    language: "swift",
    defectClass: "relationship-fabrication",
    description: "SWIFTD16 regression: re-adds instantiates for XCTest assertion functions and stdlib numerics (XCTAssertEqual, UInt64) — inheritance-conformance-fixes forbid pins die",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { type: "instantiates", source: "verify", target: "XCTAssertEqual", isExternal: true, weight: 0.7, confidence: 1, metadata: {} }, { type: "instantiates", source: "verify", target: "UInt64", isExternal: true, weight: 0.7, confidence: 1, metadata: {} }] }),
  },
  {
    id: "swift/drop-container-subscript-uses",
    language: "swift",
    defectClass: "relationship-loss",
    description: "SWIFTD17 regression: re-suppresses the subscript base (drops the self-container subscript reads+writes on storage/key) — master-review-w2 expectUses pins die (M49 W15: matched by TARGET, not by the old `source === \"Cache\"` filter, which stopped matching the moment #814 moved uses sources to the enclosing method — that hardcoded name is how this mutant went from caught to surviving)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !(normRel(x).type === "uses" && (x.target === "storage" || x.target === "key"))) }),
  },
  {
    id: "swift/type-source-revert",
    language: "swift",
    defectClass: "attribution",
    description: "M49 W15 #814 regression: re-attributes every `self.` member read to the enclosing TYPE (the pre-ruling rule) — swift/write-gate forbids the type-sourced spelling and the method-sourced expectUses pins die",
    transform: revertToTypeSource,
  },
  {
    id: "swift/re-add-field-write-uses",
    language: "swift",
    defectClass: "relationship-fabrication",
    description: "SCD1/SWIFTD17-boundary regression: broadens the write gate so pure field writes emit uses (adds uses Cache->count) — master-review-w2 forbid pin dies",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { type: "uses", source: "Cache", target: "count", isExternal: false, weight: 0.7, confidence: 0.95, metadata: { isFieldAccess: true } }] }),
  },
  {
    id: "swift/drop-second-binding-symbol",
    language: "swift",
    defectClass: "symbol-loss",
    description: "SWIFTD18 regression: symbolizes only the FIRST binding of a multi-binding declaration (drops property second and variable gTop2) — master-review-w2 expectSymbols pins die",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).filter((s: any) => !((s.kind === "property" && s.name === "second" && s.ownerName === "Pair") || (s.kind === "variable" && s.name === "gTop2"))) }),
  },
  {
    id: "swift/first-segment-dotted-base",
    language: "swift",
    defectClass: "relationship-fabrication",
    description: "SWIFTD19 regression: dotted inheritance bases resolve to the FIRST segment (M2 implements SharedMod instead of Proto; NetSession extends Foundation instead of URLSession) — master-review-w2 expect + forbid pins die",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map((x: any) => (x.type === "implements" && x.source === "M2" && x.target === "Proto" ? { ...x, target: "SharedMod" } : x.type === "extends" && x.source === "NetSession" && x.target === "URLSession" ? { ...x, target: "Foundation" } : x)) }),
  },
  {
    id: "swift/first-segment-extension-name",
    language: "swift",
    defectClass: "symbol-corruption",
    description: "SWIFTD19 regression: dotted extension target names the CONTAINER (extension symbol Outer2, operator == owned by Outer2) — master-review-w2 expectSymbols + contains pins and the contains forbid die",
    transform: r => ({
      ...r,
      symbols: (r.symbols ?? []).map((s: any) => (s.kind === "extension" && s.name === "Inner2" ? { ...s, name: "Outer2" } : s.kind === "method" && s.ownerName === "Inner2" ? { ...s, ownerName: "Outer2" } : s)),
      relationships: (r.relationships ?? []).map((x: any) => (x.type === "contains" && x.source === "Inner2" && x.target === "operator ==" ? { ...x, source: "Outer2" } : x)),
    }),
  },
  {
    id: "swift/single-letter-as-calls",
    language: "swift",
    defectClass: "relationship-loss",
    description: "SWIFTD17 regression: restores the length>1 carve-out so single-letter constructions (`E()` with `struct E: Error`) degrade to calls again — single-letter-construction fixture instantiates pins (run->E, go->E) die and the calls forbids fire",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map((x: any) => (x.type === "instantiates" && x.source === "run" && x.target === "E") || (x.type === "instantiates" && x.source === "go" && x.target === "E") ? { ...x, type: "calls", metadata: { ...x.metadata, isInstantiation: false } } : x) }),
  },
  {
    id: "swift/drop-member-read-uses",
    language: "swift",
    defectClass: "relationship-loss",
    description: "SW-A regression: non-self member reads vanish (store.items.count, o.box, Store.shared, keypaths) — swift member-value-reads member pins die",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !((x.metadata ?? x.meta ?? {}).isMemberRead)) }),
  },
  {
    id: "swift/enum-ctor-leaf-call",
    language: "swift",
    defectClass: "relationship-noise",
    description: "SW-B regression: Result.success(1) dangles as calls->success again — swift member-value-reads instantiates pin dies and the calls forbid fires",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !(x.type === "instantiates" && x.source === "useAll" && x.target === "Result")).concat([{ type: "calls", source: "useAll", target: "success", confidence: 0.95 }]) }),
  },
  {
    id: "swift/static-factory-instantiates",
    language: "swift",
    defectClass: "relationship-fabrication",
    description: "SW-B over-fire regression: Store.create() instantiates Store — swift member-value-reads instantiates forbid dies",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { type: "instantiates", source: "useAll", target: "Store", confidence: 0.95 }] }),
  },
  {
    id: "swift/type-call-restored",
    language: "swift",
    defectClass: "relationship-fabrication",
    description: "SW-E regression: type(of:) calls user code again — swift member-value-reads type forbid dies",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { type: "calls", source: "useAll", target: "type", confidence: 0.95 }] }),
  },
  {
    id: "swift/projected-read-dropped",
    language: "swift",
    defectClass: "relationship-loss",
    description: "SW-F regression: projected $count reads nothing — swift member-value-reads bump->count pin dies",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !(x.type === "uses" && x.source === "bump" && x.target === "count")) }),
  },
  {
    id: "swift/emit-member-write-as-uses",
    language: "swift",
    defectClass: "relationship-fabrication",
    description: "SW-A read-gate regression: o.slot = 1 reads again — swift member-value-reads slot forbid dies",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { type: "uses", source: "writeOnly", target: "slot", confidence: 0.9, metadata: { isMemberRead: true } }] }),
  },
  {
    id: "swift/drop-super-init-instantiates",
    language: "swift",
    defectClass: "relationship-loss",
    description: "SW-G regression: super.init builds nothing — swift init-delegation constructor->Base pin dies",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !(x.type === "instantiates" && x.source === "constructor" && x.target === "Base")) }),
  },
  {
    id: "swift/drop-self-init-instantiates",
    language: "swift",
    defectClass: "relationship-loss",
    description: "SW-G regression: self.init redirects build nothing — swift init-delegation constructor->Child pin dies",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !(x.type === "instantiates" && x.source === "constructor" && x.target === "Child")) }),
  },
  {
    id: "swift/super-init-as-call",
    language: "swift",
    defectClass: "relationship-noise",
    description: "SW-G regression: super.init calls a method named init again — swift init-delegation forbid dies",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { type: "calls", source: "constructor", target: "init", confidence: 0.95 }] }),
  },
  {
    id: "swift/drop-implicit-enum-construction",
    language: "swift",
    defectClass: "relationship-loss",
    description: "SW-H regression: implicit .success(v) builds nothing — swift init-delegation make->Result pin dies",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !(x.type === "instantiates" && x.source === "make" && x.target === "Result")) }),
  },
  {
    id: "swift/drop-self-enum-construction",
    language: "swift",
    defectClass: "relationship-loss",
    description: "SW-H regression: Self.failure builds nothing — swift init-delegation dup->Result pin dies",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !(x.type === "instantiates" && x.source === "dup" && x.target === "Result")) }),
  },
  {
    id: "objc/drop-implements-edge",
    language: "objc",
    defectClass: "relationship-loss",
    description: "drops objc implements edges (PaymentService->PaymentGateway, CustomView->Renderable) — objc section B implements pin",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => x.type !== "implements") }),
  },
  {
    id: "objc/drop-extends-edge",
    language: "objc",
    defectClass: "relationship-loss",
    description: "drops objc extends edges (BaseService->NSObject, PaymentService->BaseService) — objc payload extends pin",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => x.type !== "extends") }),
  },
  {
    id: "objc/drop-instantiates-edge",
    language: "objc",
    defectClass: "relationship-loss",
    description: "drops objc instantiates edges (sharedService->PaymentService via alloc/new) — objc instantiates pin",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => x.type !== "instantiates") }),
  },
  {
    id: "objc/drop-category-extension",
    language: "objc",
    defectClass: "symbol-loss",
    description: "drops objc category Extension symbols (PaymentService (Audit), UIView (RoundedCorner)) — objc category pin",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).filter((s: any) => !((s.metadata ?? {}).isCategory)) }),
  },
  {
    id: "objc/drop-symbol-complexity",
    language: "objc",
    defectClass: "payload-loss",
    description: "drops objc per-symbol complexity (authorizeAmount if/for/&&/ternary count) — objc section C complexity pin",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => ({ ...s, complexity: undefined })) }),
  },
  {
    id: "objc/emit-receiver-call",
    language: "objc",
    defectClass: "relationship-loss",
    description: "re-adds the bogus receiver-as-call edge (calls->PaymentService from [PaymentService sharedService]) — objc forbid pin",
    transform: r => ({
      ...r,
      relationships: [...(r.relationships ?? []), {
        type: "calls", source: "auditTrail", target: "PaymentService", isExternal: true, weight: 1, confidence: 0.95, metadata: {},
      }],
    }),
  },
  {
    id: "objc/duplicate-interface-impl",
    language: "objc",
    defectClass: "symbol-loss",
    description: "regresses the interface+implementation dedup: emits the same class/method/property twice — objc unique-symbol pins",
    transform: r => ({
      ...r,
      // Genuinely duplicate every symbol: the @interface/@implementation
      // dedup regression makes each class/method/property appear twice.
      symbols: [...(r.symbols ?? []), ...(r.symbols ?? [])],
    }),
  },
  {
    id: "objc/drop-member-read-uses",
    language: "objc",
    defectClass: "relationship-loss",
    description: "drops objc dot-syntax member-read uses edges (self.superview, superview.hidden, self.layer) — objc section B uses pin (managed-OO family contract)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !((x.metadata ?? {}).isFieldRead && x.type === "uses")) }),
  },
  {
    id: "objc/drop-protocol-inheritance",
    language: "objc",
    defectClass: "relationship-loss",
    description: "drops objc protocol-inheritance extends edges (Animatable->Renderable) — objc protocol_reference_list extends pin",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !((x.metadata ?? {}).isProtocolInheritance)) }),
  },
  {
    id: "objc/drop-category-protocol",
    language: "objc",
    defectClass: "relationship-loss",
    description: "drops objc category-declared protocol conformance (UIView->Animatable) — objc category implements pin",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !((x.metadata ?? {}).isCategoryProtocol)) }),
  },
  {
    id: "objc/emit-write-as-uses",
    language: "objc",
    defectClass: "relationship-loss",
    description: "regresses the read/write gate: emits uses for assignment LHS writes (self.clipsToBounds = YES as a read) — objc forbid pin",
    transform: r => ({
      ...r,
      relationships: [...(r.relationships ?? []), {
        type: "uses", source: "animate", target: "clipsToBounds", isExternal: true, weight: 1, confidence: 0.9, metadata: { isFieldRead: true },
      }],
    }),
  },
  {
    id: "objc/drop-pointer-return-function-bodies",
    language: "objc",
    defectClass: "relationship-loss",
    description: "OBJCD5 regression: reverts to the direct-child declarator lookup, dropping pointer-return C helpers (HelperObjects/MakeImage symbols + their body calls) — objc pointer-return-helpers expectSymbols/expectRelationships pins die",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).filter((s: any) => s.name !== "HelperObjects" && s.name !== "MakeImage"), relationships: (r.relationships ?? []).filter((x: any) => !(x.type === "calls" && (x.source === "HelperObjects" || x.source === "MakeImage"))) }),
  },
  {
    id: "objc/emit-ivar-block-macro-calls",
    language: "objc",
    defectClass: "relationship-fabrication",
    description: "OBJCD6 regression: reverts to the scope-only gate, re-emitting the fabricated class-scope macro call (calls Widget->LOCK_DECLARE) — objc pointer-return-helpers forbid pin dies",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { type: "calls", source: "Widget", target: "LOCK_DECLARE", isExternal: true, weight: 1, confidence: 0.95, metadata: { isCFunctionCall: true } }] }),
  },
  {
    id: "objc/collapse-selector-leaf-naming",
    language: "objc",
    defectClass: "symbol-identity-loss",
    description: "OBJCD7 regression: reverts method identity to first-keyword leaf naming, collapsing distinct selectors (initWithNamespace: vs initWithNamespace:diskCacheDirectory: merge; message targets become leaves) — objc selector-identity expectSymbolCount/forbidSymbols/calls-target pins die",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => (s.kind === "method" && s.name.includes(":") ? { ...s, name: s.name.split(":")[0] } : s)), relationships: (r.relationships ?? []).map((x: any) => (x.type === "calls" && x.meta?.isMessageExpression ? { ...x, target: x.target.split(":")[0] } : x)) }),
  },
  {
    id: "objc/drop-override-machinery",
    language: "objc",
    defectClass: "relationship-loss",
    description: "OBJCD8 regression: removes the override post-pass (no overrides emitted at all) — objc selector-identity overrides pins + expectRelationshipCount die",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => x.type !== "overrides") }),
  },
  {
    id: "objc/drop-bare-value-reads",
    language: "objc",
    defectClass: "relationship-loss",
    description: "OC-E regression: bare-identifier uses vanish again (receivers, params, locals, ivars, globals) — objc bare-value-reads expects die",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !(normRel(x).type === "uses" && ((x.metadata ?? x.meta ?? {}) as any).isBareRead && !((x.metadata ?? x.meta ?? {}) as any).isFieldRead)) }),
  },
  {
    id: "objc/export-category-extension",
    language: "objc",
    defectClass: "relationship-noise",
    description: "OC-B regression: the Trim category exports NSString again — objc bare-value-reads forbidExports dies",
    transform: r => ({ ...r, exports: [...(r.exports ?? []), { name: "NSString", kind: "extension", visibility: "public" }] }),
  },
  {
    id: "objc/drop-c-type-inventory",
    language: "objc",
    defectClass: "symbol-loss",
    description: "OC-D regression: struct/enum/typedef symbols vanish again — objc bare-value-reads Point/Color/Counter/Size/Value pins die",
    transform: r => ({
      ...r,
      symbols: (r.symbols ?? []).filter((s: any) => !(s.name === "Point" || s.name === "Counter" || s.name === "Color" || s.name === "Size" || s.name === "Value" || s.ownerName === "Point" || s.ownerName === "Color" || s.ownerName === "Size" || s.ownerName === "Value")),
    }),
  },
  {
    id: "objc/emit-write-as-bare-read",
    language: "objc",
    defectClass: "relationship-fabrication",
    description: "OC-E read-gate regression: the gTotal assignment write reads again — objc bare-value-reads write forbid dies",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { type: "uses", source: "objectForKey:", target: "gTotal", isExternal: true, weight: 1, confidence: 0.9, metadata: { isBareRead: true } }] }),
  },
  {
    id: "objc/emit-callee-as-bare-read",
    language: "objc",
    defectClass: "relationship-fabrication",
    description: "OC-E read-gate regression: the blk call callee reads again (CGD17 parity) — objc bare-value-reads callee forbid dies",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { type: "uses", source: "objectForKey:", target: "blk", isExternal: true, weight: 1, confidence: 0.9, metadata: { isBareRead: true } }] }),
  },
  {
    id: "objc/emit-selector-as-bare-read",
    language: "objc",
    defectClass: "relationship-fabrication",
    description: "OC-E read-gate regression: the @selector name reads again — objc bare-value-reads selector forbid dies",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { type: "uses", source: "maker", target: "fire", isExternal: true, weight: 1, confidence: 0.9, metadata: { isBareRead: true } }] }),
  },
  {
    id: "objc/emit-synthesize-as-bare-read",
    language: "objc",
    defectClass: "relationship-fabrication",
    description: "OC-R2 regression: @synthesize names read from class scope — objc bare-value-reads synthesize forbid dies",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { type: "uses", source: "Holder", target: "_label", isExternal: true, weight: 1, confidence: 0.9, metadata: { isBareRead: true } }] }),
  },
  {
    id: "php/drop-implements-edge",
    language: "php",
    defectClass: "relationship-loss",
    description: "drops php implements edges (PaymentService->Authorizer/Refundable) — php section B implements pin",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => x.type !== "implements") }),
  },
  {
    id: "php/drop-extends-edge",
    language: "php",
    defectClass: "relationship-loss",
    description: "drops php extends edges (PaymentService->BaseService) — php extends pin",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => x.type !== "extends") }),
  },
  {
    id: "php/drop-instantiates-edge",
    language: "php",
    defectClass: "relationship-loss",
    description: "drops php instantiates edges (new PaymentService / new StripeGateway) — php instantiates pin",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => x.type !== "instantiates") }),
  },
  {
    id: "php/drop-trait-use",
    language: "php",
    defectClass: "relationship-loss",
    description: "drops php trait-composition uses edges (OrderService->Loggable) — php trait pin",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !((x.metadata ?? {}).isTraitUse)) }),
  },
  {
    id: "php/drop-member-read-uses",
    language: "php",
    defectClass: "relationship-loss",
    description: "drops php member-read uses edges ($this->balance reads) — php section B uses pin (managed-OO family contract)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !((x.metadata ?? {}).isMemberRead && x.type === "uses")) }),
  },
  {
    id: "php/emit-rmw-write-as-uses",
    language: "php",
    defectClass: "relationship-fabrication",
    description: "SCD1 regression: re-opens the augmented_assignment gate so compound-assign LHS ($this->balance -= / +=) re-emits uses — refund forbid pin catches it",
    transform: r => ({
      ...r,
      relationships: [...(r.relationships ?? []), {
        type: "uses", source: "refund", target: "balance", isExternal: true, weight: 1, confidence: 0.9, metadata: { isMemberRead: true },
      }],
    }),
  },
  {
    id: "php/wrapper-complexity-count",
    language: "php",
    defectClass: "payload-corruption",
    description: "SCD10 regression: re-adds switch_statement/try_statement wrapper counting (the pre-fix counter) — f6_global_helper pin equals:10 catches it",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map(s => s.name === "f6_global_helper" ? { ...s, complexity: s.complexity + 2 } : s) }),
  },
  {
    id: "php/emit-write-as-uses",
    language: "php",
    defectClass: "relationship-loss",
    description: "regresses the read/write gate: emits uses for top-level assignment-LHS writes ($greeting = 'hi' as a read) — php payload-and-complexity forbid pin. PHP2 retarget: the old fabrication (uses __construct->gateway) became legitimate output when bare param reads landed, so the mutant survived honestly; the write gate it guarded now fabricates at file scope instead",
    transform: r => ({
      ...r,
      relationships: [...(r.relationships ?? []), {
        type: "uses", source: "global", target: "greeting", isExternal: true, weight: 1, confidence: 0.9, metadata: { phpSpecific: true, isLocalRead: true },
      }],
    }),
  },
  {
    id: "php/drop-symbol-complexity",
    language: "php",
    defectClass: "payload-loss",
    description: "drops php per-symbol complexity (authorize if/for/while/switch/ternary/&& count) — php section C complexity pin",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => ({ ...s, complexity: undefined })) }),
  },
  {
    id: "php/drop-override-edge",
    language: "php",
    defectClass: "relationship-loss",
    description: "drops php override edges (PaymentService.__construct -> BaseService.__construct) — php overrides pin",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => x.type !== "overrides") }),
  },
  {
    id: "php/drop-top-level-procedural",
    language: "php",
    defectClass: "relationship-loss",
    description: "M37.13 regression: restores the pre-fix extractive-walk drop — no generic fallback, so top-level/script statements ($app->boot(), new Application(), register_shutdown_function at program scope) emit nothing (global-sourced edges vanish) — procedural-enum instantiates/calls equals pins catch it",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => x.source !== "global" || !(x.type === "calls" || x.type === "instantiates")) }),
  },
  {
    id: "php/drop-enum-implements",
    language: "php",
    defectClass: "relationship-loss",
    description: "M37.13 regression: restores the pre-fix enum_declaration branch that never read class_interface_clause — enum implements edges (Status->Labeled/Tagged) vanish — procedural-enum implements pins catch it",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !(x.type === "implements" && (x.metadata ?? {}).isEnumImplements)) }),
  },
  {
    id: "php/emit-wp-hook-calls",
    language: "php",
    defectClass: "relationship-fabrication",
    description: "M37.13 regression: removes the add_action/add_filter early return so WP hook registrations re-emit calls edges (pre-fix oracle fabricated calls:add_action/add_filter truth; analyzer never did) — procedural-enum forbid pins catch it",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { type: "calls", source: "global", target: "add_action", isExternal: true, weight: 1, confidence: 0.9 }, { type: "calls", source: "global", target: "add_filter", isExternal: true, weight: 1, confidence: 0.9 }] }),
  },
  {
    id: "php/symbolize-anon-class-methods",
    language: "php",
    defectClass: "symbol-fabrication",
    description: "M37.13 regression: restores the pre-fix ownerless method symbol for anonymous-class methods (top-level `new class { public function handle(){} }` fabricated a method symbol with no owner) — procedural-enum forbidSymbols handle catches it",
    transform: r => ({ ...r, symbols: [...(r.symbols ?? []), { name: "handle", kind: "method", ownerName: undefined }] }),
  },
  {
    id: "php/self-extends-reintroduced",
    language: "php",
    defectClass: "relationship-fabrication",
    description: "PHPD10 regression: restores the pre-fix leaf-collapse — extends FeaturesForm->FeaturesForm (same-leaf qualified base collapsed onto the subclass) fabricated self-inheritance — same-leaf-inheritance extends forbid + equals:1 pins catch it",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []).filter((x: any) => !(x.type === "extends" && x.source === x.target)), { type: "extends", source: "FeaturesForm", target: "FeaturesForm", isExternal: true, weight: 1, confidence: 1.0, metadata: { phpSpecific: true } }, { type: "extends", source: "InvalidArgumentException", target: "InvalidArgumentException", isExternal: true, weight: 1, confidence: 1.0, metadata: { phpSpecific: true } }] }),
  },
  {
    id: "php/self-override-verified-reintroduced",
    language: "php",
    defectClass: "relationship-fabrication",
    description: "PHPD10 regression: restores the pre-fix verified self-override — a same-leaf external base resolved to the class's OWN methods at 0.95/structural (FeaturesForm.getForms->FeaturesForm.getForms) — same-leaf-inheritance overrides forbid + reasonCode pin catch it",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []).filter((x: any) => !(x.type === "overrides" && x.source === x.target)), { type: "overrides", source: "FeaturesForm.getForms", target: "FeaturesForm.getForms", isExternal: true, weight: 1, confidence: 0.95, metadata: { phpSpecific: true, isOverride: true } }] }),
  },
  {
    id: "php/drop-nullsafe-member-read-uses",
    language: "php",
    defectClass: "relationship-loss",
    description: "PHPD11 regression: reverts the walkBody member-read branch to match only member_access_expression — PHP 8 nullsafe reads `$this->svc?->name` (nullsafe_member_access_expression, same \"name\" field) silently drop the trailing member uses edge — nullsafe-member-reads expect pins (describe->name / describe->nested uses) catch it",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !(x.type === "uses" && x.metadata?.isMemberRead && x.source === "describe" && (x.target === "name" || x.target === "nested"))) }),
  },
  {
    id: "php/emit-nullsafe-write-as-uses",
    language: "php",
    defectClass: "relationship-fabrication",
    description: "PHPD11 regression: re-opens the nullsafe write gate so `$this->feature?->name = $v` / `$this->feature?->name .= '!'` re-emit uses for the LHS name (byte-range first-child gate bypassed for the nullsafe node type) — nullsafe-member-reads forbid pins catch it",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { type: "uses", source: "rewrite", target: "name", isExternal: true, weight: 1, confidence: 0.9, metadata: { isMemberRead: true } }, { type: "uses", source: "bump", target: "name", isExternal: true, weight: 1, confidence: 0.9, metadata: { isMemberRead: true } }] }),
  },
  {
    id: "php/drop-receiver-read-uses",
    language: "php",
    defectClass: "relationship-loss",
    description: "PHP-A regression: member-call receivers stop reading ($this->dep->run loses dep, $other->box->fetch loses box) — php member-value-reads receiver pins die",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !(x.type === "uses" && x.source === "useAll" && (x.target === "dep" || x.target === "box"))) }),
  },
  {
    id: "php/drop-static-read-uses",
    language: "php",
    defectClass: "relationship-loss",
    description: "PHP-H regression: static property reads vanish (C/self/static::$total) — php member-value-reads total pin dies",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !(x.type === "uses" && x.source === "useAll" && x.target === "total")) }),
  },
  {
    id: "php/drop-const-fetch-uses",
    language: "php",
    defectClass: "relationship-loss",
    description: "PHP-D regression: constant fetches vanish (Suit::Hearts) — php member-value-reads Hearts pin dies",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !(x.type === "uses" && x.source === "useAll" && x.target === "Hearts")) }),
  },
  {
    id: "php/const-fetch-scope-leak",
    language: "php",
    defectClass: "relationship-noise",
    description: "PHP-D regression: first-name lookup reads the scope (Suit::Hearts emits uses->Suit) — php member-value-reads Hearts pin dies",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !(x.type === "uses" && x.source === "useAll" && x.target === "Hearts")).concat([{ type: "uses", source: "useAll", target: "Suit", confidence: 0.9 }]) }),
  },
  {
    id: "php/tearoff-as-call",
    language: "php",
    defectClass: "relationship-noise",
    description: "PHP-E regression: $this->handler(...) invokes again instead of referencing — php member-value-reads handler pins (expect + forbid) die",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !(x.type === "uses" && x.source === "useAll" && x.target === "handler")).concat([{ type: "calls", source: "useAll", target: "handler", confidence: 0.9 }]) }),
  },
  {
    id: "php/drop-interp-read-uses",
    language: "php",
    defectClass: "relationship-loss",
    description: "PHP-F regression: interpolation reads vanish ($name, {$n}, {$other->count}) — php member-value-reads name/n/other pins die",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !(x.type === "uses" && x.source === "useAll" && (x.target === "name" || x.target === "n" || x.target === "other"))) }),
  },
  {
    id: "php/drop-subscript-read-uses",
    language: "php",
    defectClass: "relationship-loss",
    description: "PHP-B regression: subscript bases vanish ($xs[0], $m['k']) — php member-value-reads xs/m pins die",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !(x.type === "uses" && x.source === "useAll" && (x.target === "xs" || x.target === "m"))) }),
  },
  {
    id: "php/drop-capture-read-uses",
    language: "php",
    defectClass: "relationship-loss",
    description: "PHP-C regression: closure captures vanish (use ($cap)) — php member-value-reads cap pin dies",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !(x.type === "uses" && x.source === "useAll" && x.target === "cap")) }),
  },
  {
    id: "php/emit-member-write-as-uses",
    language: "php",
    defectClass: "relationship-fabrication",
    description: "PHP-A read-gate regression: $c->slot = 1 reads again — php member-value-reads slot forbid dies",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { type: "uses", source: "writeOnly", target: "slot", confidence: 0.9, metadata: { isMemberRead: true } }] }),
  },
  {
    id: "php/emit-static-write-as-uses",
    language: "php",
    defectClass: "relationship-fabrication",
    description: "PHP-H read-gate regression: C::$total = 2 reads again — php member-value-reads total forbid dies",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { type: "uses", source: "writeOnly", target: "total", confidence: 0.9, metadata: { isMemberRead: true, isStaticRead: true } }] }),
  },
  {
    id: "php/drop-trait-use-uses",
    language: "php",
    defectClass: "relationship-loss",
    description: "PHP-O1 companion: trait uses vanish from analyzer output (use_declaration branch) — php member-value-reads trait pin dies (the oracle-side inBody gate is covered by lanes)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !(x.type === "uses" && x.source === "C" && x.target === "T")) }),
  },
  {
    id: "php/drop-bare-local-reads",
    language: "php",
    defectClass: "relationship-loss",
    description: "PHP2 regression: frame-scoped bare `$var` reads vanish (params/locals/loop/destructure/captures) — php bare-value-reads n/doubled/item/total pins die",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !(x.type === "uses" && (x.metadata ?? {}).isLocalRead)) }),
  },
  {
    id: "php/drop-bare-global-reads",
    language: "php",
    defectClass: "relationship-loss",
    description: "PHP2 regression: file-function/superglobal bare reads vanish — php bare-value-reads _GET pin dies",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !(x.type === "uses" && (x.metadata ?? {}).isGlobalRead)) }),
  },
  {
    id: "php/drop-bare-const-reads",
    language: "php",
    defectClass: "relationship-loss",
    description: "PHP2 regression: bare `NAME` const reads vanish (property/const/enum/attribute/default initializers) — php bare-value-reads LIMIT/RUN_NAME/FALLBACK pins die",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !(x.type === "uses" && (x.metadata ?? {}).isConstRead)) }),
  },
  {
    id: "php/emit-receiver-member-read",
    language: "php",
    defectClass: "relationship-fabrication",
    description: "PHP2-D regression: the member side of call receivers reads again (`$gw->authorize()` emits uses->authorize) — php payload-and-complexity authorize forbid dies",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { type: "uses", source: "process", target: "authorize", isExternal: true, weight: 1, confidence: 0.9, metadata: { phpSpecific: true } }] }),
  },
  {
    id: "ruby/file-scope-placeholder-divergence",
    language: "ruby",
    defectClass: "misattribution",
    description: "R7 (M60) regression: the four alias/alias_method/mixin/association sites go back to the SECOND spelling for the file-scope owner — `source: owner || \"unknown\"` instead of the file's pinned one. Restores the exact pre-fix observable state: a top-level construct's edge carries the literal \"unknown\" as its source. Caught by ruby/file-scope-owner-pins, which pins the file-scope owner on all four constructs and forbids the \"unknown\" spellings.",
    transform: r => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) =>
        String(x.source) === "Global" && ["calls", "implements", "extends", "uses"].includes(String(x.type))
          ? { ...x, source: "unknown", fromSymbol: "unknown" }
          : x),
    }),
  },
  {
    id: "ruby/factory-body-falls-to-file-scope",
    language: "ruby",
    defectClass: "scope-blindness",
    description: "regresses the dynamic-class-factory attribution: `X = Class.new do ... end` bodies go back to the file-scope owner instead of the class the factory names — the member symbol loses its owner and the association/construction edges carry \"Global\" although the analyzer had already emitted `class:X`. Caught by ruby/file-scope-owner-pins (`uses:Widget->parts`, `contains:Widget->parts`, `instantiates:Widget->Class`, `parts@Widget`) and by the fixture's `Global->parts` / `Global->Class` forbids.",
    transform: r => ({
      ...r,
      symbols: (r.symbols ?? []).map((s: any) =>
        s.name === "parts" && s.ownerName === "Widget" ? { ...s, ownerName: undefined } : s),
      relationships: (r.relationships ?? []).map((x: any) => {
        if (String(x.source) !== "Widget") return x
        return { ...x, source: "Global", fromSymbol: "Global" }
      }),
    }),
  },
  // --------------------------------------------------------------------------
  // M60.R8 (#749): the framework trigger surface. Four mutants, one per defect the
  // round fixed, so each fix has a reverting change that some fixture must catch.
  // --------------------------------------------------------------------------
  {
    id: "ruby/framework-duplicate-accumulation",
    language: "ruby",
    defectClass: "duplicate-emission",
    description: "R8 (M60) regression: the detection accumulator goes back to one entry per trigger hit, which is the pre-fix observable — `metadata.detectedFrameworks!.push(...)` ran once per Rails class AND once per render/redirect_to, so a file with three models and three calls published six identical entries (measured: five on a five-model file, three on rack/test.rb). Caught by ruby/framework-surface-pins, whose metadata pin compares the whole array and expects EXACTLY one entry.",
    transform: r => ({
      ...r,
      metadata: {
        ...(r.metadata ?? {}),
        detectedFrameworks: [...((r.metadata as any)?.detectedFrameworks ?? []), ...((r.metadata as any)?.detectedFrameworks ?? [])],
      },
    }),
  },
  {
    id: "ruby/framework-primary-pick-dropped",
    language: "ruby",
    defectClass: "missing-contract-key",
    description: "R8 (M60) regression: the analyzer detects Rails and publishes no PRIMARY PICK — `metadata.framework` absent, which is exactly what ruby did before this round. The artifact does not just lose a convenience field: every downstream consumer that keys on the primary framework reads the file as framework-less while `detectedFrameworks` says otherwise. Caught by ruby/framework-surface-pins' expectPrimaryFramework, and by the R8 runtime probe's A3 assertion.",
    transform: r => {
      const m: any = { ...(r.metadata ?? {}) }
      delete m.framework
      return { ...r, metadata: m }
    },
  },
  {
    id: "ruby/framework-name-divergence",
    language: "ruby",
    defectClass: "name-divergence",
    description: "R8 (M60) regression: the pattern entry goes back to its own spelling — `framework: \"Rails\"` while `detectedFrameworks` says \"Ruby on Rails\". One framework under two names inside one analyzer, so the two published arrays cannot be joined by name. The same shape as the file-scope owner's two spellings, on the framework surface. Caught by ruby/framework-surface-pins' frameworkPatterns metadata pin and by the runtime probe's A4/A5 assertions.",
    transform: r => ({
      ...r,
      metadata: {
        ...(r.metadata ?? {}),
        frameworkPatterns: ((r.metadata as any)?.frameworkPatterns ?? []).map((p: any) => ({ ...p, framework: "Rails" })),
      },
    }),
  },
  {
    id: "ruby/framework-callback-trigger-unreachable",
    language: "ruby",
    defectClass: "dead-branch",
    description: "R8 (M60) regression of the UNREACHABLE trigger: `before_action`/`after_action` are members of RAILS_MACRO_METHODS, whose branch returns before the framework block, so the Callbacks pattern could never be recorded. The mutant removes the pattern, which is the pre-fix observable — measured, a file containing `before_action` published `frameworkPatterns: []` in every execution. Caught by ruby/framework-surface-pins' frameworkPatterns pin, which expects the array to contain the Callbacks pattern.",
    transform: r => ({
      ...r,
      metadata: { ...(r.metadata ?? {}), frameworkPatterns: [] },
    }),
  },
  {
    id: "ruby/callsite-line-receiver-stamp",
    language: "ruby",
    defectClass: "wrong-line-anchor",
    description: "M59.A7 (#825) regression: every `calls` edge moves one line up — the CALL NODE's line, which for a chain wrapped one call per line is the RECEIVER's line (`helper` on 35), not the callee's. This is the pre-fix observable state exactly, and the c lane's measured twin (`call_expression` starts at the receiver). Caught by ruby/callsite-lines-825, which pins strip@36/upper@37 and forbids both on 35.",
    transform: r => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) =>
        String(x.type ?? x.relationshipType) === "calls" && typeof x.line_number === "number"
          ? { ...x, line_number: x.line_number - 1 }
          : x),
    }),
  },
  {
    id: "ruby/extends-declaration-line",
    language: "ruby",
    defectClass: "wrong-line-anchor",
    description: "M59.A7 (#825) regression: heritage edges take the DECLARING CLASS's start line instead of the base type's own node. On a wrapped superclass (`class Widget <` / `Base`) that names the `<` line, which is the `superclass` node's start — the exact anchor this round replaced. Caught by ruby/callsite-lines-825 (`extends Widget->Base` pinned at 29, forbidden at 28).",
    transform: r => {
      const startLine = new Map<string, number>()
      for (const s of r.symbols ?? []) {
        if (typeof s?.name === "string" && typeof s?.range?.startLine === "number") startLine.set(s.name, s.range.startLine)
      }
      if (startLine.size === 0) return r
      return {
        ...r,
        relationships: (r.relationships ?? []).map((x: any) => {
          const t = String(x.type ?? x.relationshipType)
          if (t !== "extends" && t !== "implements") return x
          const ln = startLine.get(String(x.source ?? x.from ?? "?"))
          return ln === undefined ? x : { ...x, line_number: ln }
        }),
      }
    },
  },
  {
    id: "ruby/superclass-whitespace-leak",
    language: "ruby",
    defectClass: "untrimmed-target",
    description: "M59.A7 (#825) regression: the base text keeps the whitespace the source wrote between `<` and the name, so the `extends` target is `\"\\n    Base\"` — not the class name. The pre-fix strip removed only `<`, spaces and tabs, so a WRAPPED base leaked a newline into the target (and into the override target and `metadata.superClass`). Caught by ruby/callsite-lines-825, which forbids the newline-carrying target.",
    transform: r => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) => {
        const t = String(x.type ?? x.relationshipType)
        if (t !== "extends" && t !== "overrides") return x
        const tg = String(x.target ?? x.to ?? "")
        if (tg.length === 0 || tg.startsWith("\n")) return x
        return { ...x, target: `\n    ${tg}` }
      }),
    }),
  },
  {
    id: "ruby/in-file-override-downgraded",
    language: "ruby",
    defectClass: "evidence-downgrade",
    description: "M59.A7 (#825) regression: an override whose base class IS declared in this file falls back to the 0.5 first-parent GUESS. That is what the whitespace leak caused (the base never matched the class it named), so a real structural override was published below the patterns.ts threshold as bare suspicion. Caught by ruby/callsite-lines-825, which requires `overrides Widget.greet->Base.greet` at confidenceMin 0.95 and forbids the 0.5 form.",
    transform: r => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) =>
        String(x.type ?? x.relationshipType) === "overrides" && typeof x.confidence === "number" && x.confidence >= 0.9
          ? { ...x, confidence: 0.5, metadata: { ...(x.metadata ?? {}), reasonCode: "first-parent-guess" } }
          : x),
    }),
  },
  {
    id: "ruby/variable-receiver-instantiates",
    language: "ruby",
    defectClass: "fabricated-target",
    description: "M59.A7 (#825) regression: a VARIABLE receiver goes back to the owner fallback, so `@factory.new` is published as `instantiates <enclosing class>` — a class name no source line supports (`@factory` holds an unknown class), and a name the R7 rule exists to forbid. The F5 truth derivation mirrored the same fallback, so the differential could not see it. Caught by ruby/callsite-lines-825: `calls assemble->new@39` must exist and `instantiates assemble->Widget@39` is forbidden.",
    transform: r => {
      const ownerOf = new Map<string, string>()
      for (const s of r.symbols ?? []) {
        if (typeof s?.name === "string" && typeof s?.ownerName === "string") ownerOf.set(s.name, s.ownerName)
      }
      return {
        ...r,
        relationships: (r.relationships ?? []).map((x: any) => {
          if (String(x.type ?? x.relationshipType) !== "calls") return x
          if (String(x.target ?? x.to) !== "new") return x
          const owner = ownerOf.get(String(x.source ?? x.from ?? ""))
          if (!owner) return x
          return { ...x, type: "instantiates", target: owner, toSymbol: owner, metadata: { ...(x.metadata ?? {}) } }
        }),
      }
    },
  },
  {
    id: "ruby/dynamic-superclass-overrides",
    language: "ruby",
    defectClass: "fabricated-target",
    description: "M59.A7 (#825) regression: the OVERRIDES pass goes back to using the raw superclass EXPRESSION as a base class name, so `class Wide < Struct.new(:a, :b)` publishes `overrides Wide.each -> Struct.new(:a, :b).each`. The extends edge had refused this shape since the RB-C ruling; the overrides pass never got the same gate — invisible until the line round gave the edge a line and the M59 oracle convicted it. Caught by ruby/callsite-lines-825's forbids on `extends Wide` and `overrides Wide.each`.",
    transform: r => {
      const exprBase = new Map<string, string>()
      for (const s of r.symbols ?? []) {
        const sup = s?.metadata?.superClass
        if (typeof s?.name === "string" && typeof sup === "string" && sup.includes("(")) exprBase.set(s.name, sup)
      }
      if (exprBase.size === 0) return r
      const extra: any[] = []
      for (const s of r.symbols ?? []) {
        if (typeof s?.ownerName !== "string" || typeof s?.name !== "string") continue
        const base = exprBase.get(s.ownerName)
        if (!base) continue
        extra.push({ type: "overrides", source: `${s.ownerName}.${s.name}`, target: `${base}.${s.name}`, fromSymbol: `${s.ownerName}.${s.name}`, toSymbol: `${base}.${s.name}`, confidence: 0.5, line_number: s.range?.startLine, metadata: { isOverride: true, reasonCode: "first-parent-guess" } })
      }
      return extra.length === 0 ? r : { ...r, relationships: [...(r.relationships ?? []), ...extra] }
    },
  },
  {
    id: "ruby/enclosing-class-marker-dropped",
    language: "ruby",
    defectClass: "unstated-inference",
    description: "M59.A7 (#825) regression: the enclosing-class instantiation keeps its (correct) line but stops DECLARING that the target was inferred, so the M59 oracle can no longer tell an implied name from a written one and must convict the claim instead of classifying it. Caught by ruby/callsite-lines-825's `meta.resolvedTarget` pin.",
    transform: r => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) => {
        const m = x?.metadata
        if (!m || m.resolvedTarget === undefined) return x
        const { resolvedTarget: _drop, ...rest } = m
        return { ...x, metadata: rest }
      }),
    }),
  },
  {
    id: "ruby/drop-implements-edge",
    language: "ruby",
    defectClass: "relationship-loss",
    description: "drops ruby module-mixin implements edges (Service->Loggable) — ruby include pin",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => x.type !== "implements") }),
  },
  {
    id: "ruby/drop-member-read-uses",
    language: "ruby",
    defectClass: "relationship-loss",
    description: "drops ruby instance-var member-read uses edges (@balance reads) — ruby section B uses pin (managed-OO family contract)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !((x.metadata ?? {}).memberRead && x.type === "uses")) }),
  },
  {
    id: "ruby/emit-write-as-uses",
    language: "ruby",
    defectClass: "relationship-loss",
    description: "regresses the read/write gate: emits uses for assignment-LHS writes (@total = ... as a read) — ruby forbid pin",
    transform: r => ({
      ...r,
      relationships: [...(r.relationships ?? []), {
        type: "uses", source: "initialize", target: "@gateway", isExternal: true, weight: 1, confidence: 0.9, metadata: { memberRead: true },
      }],
    }),
  },
  {
    id: "ruby/split-script-sentinel",
    language: "ruby",
    defectClass: "payload-corruption",
    description: "GAD2 twin regression: reverts the require references source to the old hardcoded 'root' sentinel while calls/uses keep 'Global' — ruby payload-and-complexity references Global->rake/tasklib pin catches the split",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map((rel: any) => (rel.type === "references" && rel.target === "rake/tasklib" ? { ...rel, source: "root" } : rel)) }),
  },
  {
    id: "ruby/emit-rmw-write-as-uses",
    language: "ruby",
    defectClass: "relationship-fabrication",
    description: "SCD1 regression: re-opens the operator_assignment gate so compound-assign LHS (@balance -= / +=) re-emits uses — refund forbid pin + authorize count equals:2 catch it",
    transform: r => ({
      ...r,
      relationships: [...(r.relationships ?? []), {
        type: "uses", source: "refund", target: "@balance", isExternal: true, weight: 1, confidence: 0.9, metadata: { memberRead: true },
      }],
    }),
  },
  {
    id: "ruby/drop-instantiates-edge",
    language: "ruby",
    defectClass: "relationship-loss",
    description: "drops ruby instantiates edges (Service.new / Gateway.new) — ruby instantiates pin",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => x.type !== "instantiates") }),
  },
  {
    id: "ruby/drop-symbol-complexity",
    language: "ruby",
    defectClass: "payload-loss",
    description: "drops ruby per-symbol complexity (authorize if/while/&& count) — ruby section C complexity pin",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => ({ ...s, complexity: undefined })) }),
  },
  {
    id: "ruby/pattern-bindings-leak-as-calls",
    language: "ruby",
    defectClass: "fabrication",
    description: "injects the RUBYG1 bug class: pattern-match bindings (in [a, b] / in {amount:} / Integer => n) leak as bare calls — fixture forbid pins calls:a/b/amount/code/msg",
    transform: r => ({ ...r, relationships: [
      ...(r.relationships ?? []),
      { type: "calls", source: "unpack", target: "a", fromSymbol: "unpack", toSymbol: "a", confidence: 0.9, metadata: { bareCall: true } },
      { type: "calls", source: "unpack", target: "b", fromSymbol: "unpack", toSymbol: "b", confidence: 0.9, metadata: { bareCall: true } },
      { type: "calls", source: "amount_of", target: "amount", fromSymbol: "amount_of", toSymbol: "amount", confidence: 0.9, metadata: { bareCall: true } },
      { type: "calls", source: "amount_of", target: "code", fromSymbol: "amount_of", toSymbol: "code", confidence: 0.9, metadata: { bareCall: true } },
      { type: "calls", source: "amount_of", target: "msg", fromSymbol: "amount_of", toSymbol: "msg", confidence: 0.9, metadata: { bareCall: true } },
    ] }),
  },
  {
    id: "ruby/readd-anonymous-new-junk",
    language: "ruby",
    defectClass: "fabrication",
    description: "RB-A regression: re-adds the junk `calls:<owner> -> new` edge for anonymous expression receivers (`Class.new { ... }.new`) — rack-wave-regressions forbid pin `calls target new`",
    transform: r => ({ ...r, relationships: [
      ...(r.relationships ?? []),
      { type: "calls", source: "Global", target: "new", fromSymbol: "Global", toSymbol: "new", confidence: 0.9, metadata: { bareCall: true } },
      { type: "calls", source: "UploadedLike", target: "new", fromSymbol: "UploadedLike", toSymbol: "new", confidence: 0.9, metadata: { bareCall: true } },
    ] }),
  },
  {
    id: "ruby/drop-default-arg-edges",
    language: "ruby",
    defectClass: "relationship-loss",
    description: "RB-B regression: re-skips default-argument VALUE expressions (`mutex = Mutex.new`, `app = @app`) — rack-wave-regressions instantiates:initialize->Mutex and uses:context->@app pins",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) =>
      !(x.type === "instantiates" && x.source === "initialize" && x.target === "Mutex") &&
      !(x.type === "uses" && x.source === "context" && x.target === "@app")),
    }),
  },
  {
    id: "ruby/drop-superclass-construct-instantiation",
    language: "ruby",
    defectClass: "relationship-loss",
    description: "RB-C regression: re-skips call expressions in the superclass field (`class BodyLike < Struct.new(...)` drops instantiates:Struct) — rack-wave-regressions instantiates Global->Struct pin",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) =>
      !(x.type === "instantiates" && x.source === "Global" && x.target === "Struct")),
    }),
  },
  {
    id: "ruby/drop-def-less-member-read-uses",
    language: "ruby",
    defectClass: "relationship-loss",
    description: "RB-D regression: re-gates instance_variable reads behind method bodies only (spec/DSL reads @content_type/@empty_hash lose their Global-sourced uses) — rack-wave-regressions memberRead pins",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) =>
      !(x.type === "uses" && x.source === "Global" && (x.metadata ?? {}).memberRead)),
    }),
  },
  {
    id: "ruby/drop-alias-method-edge",
    language: "ruby",
    defectClass: "relationship-loss",
    description: "RB-E regression: re-skips the alias_method emission (`alias_method :local_path, :original_filename` drops calls:local_path) — rack-wave-regressions aliasedTo pin",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !(x.metadata ?? {}).aliasedTo) }),
  },
  {
    id: "ruby/drop-keyword-alias-edge",
    language: "ruby",
    defectClass: "relationship-loss",
    description: "master-review RUBD15 regression: re-skips the KEYWORD alias node (`alias copy original` emits nothing — reverts the main-loop alias branch) — master-review-wave calls:Api->copy aliasedTo pin dies",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !(x.metadata ?? {}).keywordAlias) }),
  },
  {
    id: "ruby/readd-pair-value-suppression",
    language: "ruby",
    defectClass: "relationship-loss",
    description: "master-review RUBD12 regression: re-adds `pair` to the bare-call skip-parents, silencing hash/argument VALUE-position method calls (`{ key: fetch_key }`, `{ pair => fetch_val }`, `store.write(cache: build_entry)`) — master-review-wave value-call pins die",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !(x.type === "calls" && (x.metadata ?? {}).bareCall && ["fetch_key", "fetch_val", "build_entry"].includes(x.target))) }),
  },
  {
    id: "ruby/readd-dynamic-superclass-extends",
    language: "ruby",
    defectClass: "fabrication",
    description: "master-review regression: superclass call expressions emit extends again (`class Tuple < Struct.new(:a,:b)` -> extends Tuple->Struct.new(:a, :b)) — master-review-wave forbid dies",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { type: "extends", source: "Tuple", target: "Struct.new(:a, :b)", fromSymbol: "Tuple", toSymbol: "Struct.new(:a, :b)", confidence: 1.0, metadata: {} }] }),
  },
  {
    id: "ruby/self-verify-overrides-guard",
    language: "ruby",
    defectClass: "fabrication",
    description: "master-review RUBD14 regression: removes the self-collision guard — `class Parser::Tok < Tok` (external base leaf == class leaf) emits VERIFIED self-overrides at 0.95 — master-review-wave forbid overrides@0.95 dies",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { type: "overrides", source: "Tok.read", target: "Tok.read", fromSymbol: "Tok.read", toSymbol: "Tok.read", confidence: 0.95, metadata: { isOverride: true } }] }),
  },
  {
    id: "ruby/endless-body-silence",
    language: "ruby",
    defectClass: "relationship-loss",
    description: "second-review RB-F regression: endless method bodies go unwalked again (second-review expects calls fetch->get)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(normRel(x).type === "calls" && normRel(x).source === "fetch" && normRel(x).target === "get")) }),
  },
  {
    id: "ruby/defined-probe-reads",
    language: "ruby",
    defectClass: "relationship-noise",
    description: "second-review RB-G regression: defined? operands read again (second-review forbids uses check->@cfg and calls check->other)",
    transform: r => ({
      ...r,
      relationships: [
        ...(r.relationships ?? []),
        { source: "check", target: "other", type: "calls", confidence: 0.9, metadata: { bareCall: true } },
        { source: "check", target: "@cfg", type: "uses", confidence: 0.9, metadata: { memberRead: true } },
      ],
    }),
  },
  {
    id: "ruby/undef-name-calls",
    language: "ruby",
    defectClass: "relationship-noise",
    description: "second-review RB-G regression: undef names emit calls again (second-review forbids calls check->helper)",
    transform: r => ({
      ...r,
      relationships: [...(r.relationships ?? []), { source: "check", target: "helper", type: "calls", confidence: 0.9, metadata: { bareCall: true } }],
    }),
  },
  {
    id: "ruby/attr-string-loss",
    language: "ruby",
    defectClass: "symbol-loss",
    description: "second-review RB-H regression: attr string names dropped again (second-review expects property name)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).filter((s: any) => !(s.name === "name" && s.kind === "property")) }),
  },
  {
    id: "ruby/struct-new-symbols-loss",
    language: "ruby",
    defectClass: "symbol-loss",
    description: "second-review RB-I regression: dynamic class creation back to invisible (second-review expects classes Point and Cfg)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).filter((s: any) => !((s.name === "Point" || s.name === "Cfg") && s.kind === "class")) }),
  },
  {
    id: "ruby/autoload-import-loss",
    language: "ruby",
    defectClass: "relationship-loss",
    description: "second-review RB-J regression: autoload records nothing again (second-review expects import json/parser)",
    transform: r => ({ ...r, imports: (r.imports ?? []).filter((i: any) => i.module !== "json/parser"), relationships: (r.relationships ?? []).filter(x => !(normRel(x).type === "references" && normRel(x).target === "json/parser")) }),
  },
  {
    id: "ruby/nested-def-name-calls",
    language: "ruby",
    defectClass: "relationship-noise",
    description: "second-review RB-K regression: nested singleton-def names and bound receivers read as calls again (second-review forbids hook->cached/memo/obj)",
    transform: r => ({
      ...r,
      relationships: [
        ...(r.relationships ?? []),
        { source: "hook", target: "cached", type: "calls", confidence: 0.9, metadata: { bareCall: true } },
        { source: "hook", target: "memo", type: "calls", confidence: 0.9, metadata: { bareCall: true } },
        { source: "hook", target: "obj", type: "calls", confidence: 0.9, metadata: { bareCall: true } },
      ],
    }),
  },
  {
    id: "objc/drop-enum-case-reads",
    language: "objc",
    defectClass: "relationship-loss",
    description: "OC-F regression: same-file enum cases stop reading (labels, comparisons, returns) — objc second-review Light/Dark pins die",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !(x.type === "uses" && (x.target === "Light" || x.target === "Dark"))) }),
  },
  {
    id: "objc/emit-protocol-directive-call",
    language: "objc",
    defectClass: "relationship-fabrication",
    description: "OC-G regression: @protocol(P) invokes again — objc second-review protocol forbid dies",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { type: "calls", source: "hooks", target: "protocol", confidence: 0.95, metadata: { isCFunctionCall: true } }] }),
  },
  {
    id: "objc/drop-function-decay-reads",
    language: "objc",
    defectClass: "relationship-loss",
    description: "OC-H regression: file-scope function names stop resolving as values — objc second-review cfn uses pin dies (calls pin survives)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !(x.type === "uses" && x.target === "cfn")) }),
  },
  {
    id: "python/drop-instance-attribute-properties",
    language: "python",
    defectClass: "symbol-loss",
    description: "regresses PYD1: self.x = ... writes emit NO Property symbols (the pre-fix dead-LHS-gate bug class) — python fixture property pins",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).filter((s: any) => !((s.metadata ?? {}).isInstanceAttribute)) }),
  },
  {
    id: "python/drop-member-read-uses",
    language: "python",
    defectClass: "relationship-loss",
    description: "drops python member-read uses edges (self.label reads) — python section B uses pin (managed-OO family contract)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !((x.metadata ?? {}).isMemberRead && x.type === "uses")) }),
  },
  {
    id: "python/emit-self-shadow-extends",
    language: "python",
    defectClass: "fabrication",
    description: "injects the #299 bug class: class Looped(Looped) self-shadowing emits a fabricated extends self-loop — fixture forbid pin",
    transform: r => ({
      ...r,
      relationships: [...(r.relationships ?? []), {
        type: "extends", source: "Looped", target: "Looped", fromSymbol: "Looped", toSymbol: "Looped", confidence: 1.0, metadata: { pythonSpecific: true },
      }],
    }),
  },
  {
    id: "python/drop-symbol-complexity",
    language: "python",
    defectClass: "payload-loss",
    description: "drops python per-symbol complexity (total_for for/if/while count) — python section C complexity pin",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => ({ ...s, complexity: undefined })) }),
  },
  {
    id: "python/class-var-public-visibility",
    language: "python",
    defectClass: "payload-loss",
    description: "regresses PYD3: underscore class variables hard-coded public (the pre-fix asymmetry) — python _memo protected pin",
    transform: r => ({
      ...r,
      symbols: (r.symbols ?? []).map((s: any) =>
        (s.metadata ?? {}).isClassVariable ? { ...s, visibility: "public" } : s),
    }),
  },
  {
    id: "python/drop-enum-auto-members",
    language: "python",
    defectClass: "symbol-loss",
    description: "regresses PYD4: auto()-valued enum members dropped (RED = enum.auto() silent) — python Colors/RED pins",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).filter((s: any) => s.name !== "RED") }),
  },
  {
    id: "python/nested-def-reowner",
    language: "python",
    defectClass: "relationship-loss",
    description: "regresses PYD5: member reads inside nested defs re-owned by the nested (non-symbol) name — run->base_name pin dies",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !(x.type === "uses" && x.source === "run" && x.target === "base_name")) }),
  },
  {
    id: "python/lines-dropped",
    language: "python",
    defectClass: "line-attribution",
    description: "M59.A7 (#825) regression: python's relationships go back to carrying NO line — the exact pre-fix state (MEASURED 0 of 17,781 relationships lined on a 200-file draw of the pinned corpus, the M59 oracle reporting 0 withLine / 17,781 noLine). Caught by python/decorator-column-lines, which pins the import statement's own line (4), each wrapped import item's own line (Optional 6, List 7) and each chained call's callee leaf (strip 18, upper 19 — the receiver is written on 17).",
    transform: dropAllLineNumbers,
  },
  {
    id: "python/construct-start-line",
    language: "python",
    defectClass: "line-attribution",
    description: "M59.A7 (#825) regression: restores the CONSTRUCT-START line instead of the node that names the edge — an import item reports the `from ... import (` statement line (5, not 6/7) and a chained call reports its RECEIVER (17, not the leaf on 18/19). Exactly the pre-fix positions python/decorator-column-lines forbids.",
    transform: r => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) => {
        const t = String(x.type ?? x.relationshipType ?? "")
        const trapBearing = ["calls", "contains", "extends", "implements", "instantiates", "uses", "references", "imports", "exports", "overrides"]
        if (trapBearing.includes(t) && typeof x.line_number === "number") {
          return { ...x, line_number: x.line_number - 1 }
        }
        return x
      }),
    }),
  },
  {
    id: "python/decorated-start-line",
    language: "python",
    defectClass: "line-attribution",
    description: "M59.A7 (#825) regression: a decorated definition's range goes back to the DECORATOR line — the pre-fix nodeToRange preferred the decorated_definition parent (whose start is the `@` line), so `decorated` claimed 23 while its name is written on 24. Simulated off the result's own decorator payload (the scala helper), so it stays faithful rather than name-hardcoded. Caught by python/decorator-column-lines' expectSymbolRanges startLine=24.",
    transform: revertToAnnotationStartLine,
  },
  // --------------------------------------------------------------------------
  // M60.R8 (#747): the python framework trigger surface. Before this round the
  // analyzer claimed `hasFrameworkIntelligence: true` on every file while the
  // context's `frameworks` record was written NOWHERE.
  // --------------------------------------------------------------------------
  {
    id: "python/framework-surface-dead",
    language: "python",
    defectClass: "dead-capability-claim",
    description: "R8 (M60) regression: the trigger surface goes back to DEAD — detection returns an empty array while the analyzer still claims `hasFrameworkIntelligence: true`, which is the pre-fix observable measured on a real Django model and a real Flask app (both `[]`) and on 0 of 187 corpus files. Caught by python/framework-surface-pins, whose metadata pin expects [Django, Flask, pytest].",
    transform: r => ({ ...r, metadata: { ...(r.metadata ?? {}), detectedFrameworks: [], framework: undefined, frameworkPatterns: [] } }),
  },
  {
    id: "python/framework-import-order-pick",
    language: "python",
    defectClass: "nondeterministic-primary-pick",
    description: "R8 (M60) regression: the emitted array follows IMPORT order instead of the marker table, so a file that imports pytest before django reports pytest as its primary framework. The contract puts application frameworks first and test frameworks last (csharp's CS_FRAMEWORK_ORDER rule, CONV-CS-2), because import order is a property of how a file is sorted rather than of the code. Caught by python/framework-surface-pins, which imports pytest FIRST and pins [Django, Flask, pytest] plus a Django primary pick.",
    transform: r => {
      const det: string[] = (r.metadata as any)?.detectedFrameworks ?? []
      const reversed = [...det].reverse()
      const pats: any[] = (r.metadata as any)?.frameworkPatterns ?? []
      const byName = new Map(pats.map((p: any) => [p.framework, p]))
      return {
        ...r,
        metadata: {
          ...(r.metadata ?? {}),
          detectedFrameworks: reversed,
          framework: reversed[0],
          frameworkPatterns: reversed.map((f) => byName.get(f)).filter(Boolean),
        },
      }
    },
  },
  // --------------------------------------------------------------------------
  // M60.R8 (#838/#836): the swift framework trigger surface. Three mutants: the
  // order regression (the pre-fix observable), and the two contract keys the lane
  // did not publish at all before this round.
  // --------------------------------------------------------------------------
  {
    id: "swift/framework-walk-order",
    language: "swift",
    defectClass: "nondeterministic-primary-pick",
    description:
      "R8 (M60) regression: the emitted array goes back to the OBSERVATION-map order, which is the pre-fix observable — the analyzer iterated `frameworksObj` and pushed as it went, so the payload was whichever order the walk visited triggers in. Caught by swift/framework-surface-pins, which imports Foundation and UIKit FIRST and pins [SwiftUI, Combine, UIKit, Foundation] with SwiftUI as the primary pick: the mutant emits [Foundation, UIKit, SwiftUI, Combine] and picks Foundation, so the array pin, the primary pin and the patterns pin all fail.",
    transform: r => {
      const det: string[] = (r.metadata as any)?.detectedFrameworks ?? []
      // the pre-fix order for this fixture: imports first (Foundation, UIKit, SwiftUI,
      // Combine), then anything only the wrapper handler saw. Reproduced by reversing
      // the two halves rather than hardcoding, so the mutant stays a real reordering.
      const pre = ["Foundation", "UIKit", "SwiftUI", "Combine"].filter((f) => det.indexOf(f) !== -1)
      for (const f of det) if (pre.indexOf(f) === -1) pre.push(f)
      const pats: any[] = (r.metadata as any)?.frameworkPatterns ?? []
      const byName = new Map(pats.map((p: any) => [p.framework, p]))
      return {
        ...r,
        metadata: {
          ...(r.metadata ?? {}),
          detectedFrameworks: pre,
          framework: pre[0],
          frameworkPatterns: pre.map((f) => byName.get(f)).filter(Boolean),
        },
      }
    },
  },
  {
    id: "swift/framework-primary-pick-dropped",
    language: "swift",
    defectClass: "missing-contract-key",
    description:
      "R8 (M60) regression: the lane detects frameworks and publishes no PRIMARY PICK, which is exactly what swift did before this round — measured at 0 of 81 detecting files on the deterministic draw. Every consumer that keys on the primary framework then reads an iOS file as framework-less while `detectedFrameworks` says otherwise. Caught by swift/framework-surface-pins' expectPrimaryFramework and by the R8 runtime probe's A3 assertion.",
    transform: r => {
      const m: any = { ...(r.metadata ?? {}) }
      delete m.framework
      return { ...r, metadata: m }
    },
  },
  {
    id: "swift/framework-patterns-dropped",
    language: "swift",
    defectClass: "missing-contract-key",
    description:
      "R8 (M60) regression: the lane publishes the detection array without `frameworkPatterns` — the other half of the contract the lane never emitted before this round. The two keys are not redundant: detection says WHICH framework, the patterns say what was observed and therefore why. Caught by swift/framework-surface-pins' frameworkPatterns metadata pin, which pins the whole array and its order.",
    transform: r => {
      const m: any = { ...(r.metadata ?? {}) }
      delete m.frameworkPatterns
      return { ...r, metadata: m }
    },
  },
  // --------------------------------------------------------------------------
  // M60.R8 (CONV-OC-1): the objective-c framework trigger surface. Two mutants,
  // both faithful reverts of this lane's own pre-fix observable — the order the
  // Set's insertion produced (which is the file's `#import` order), and the
  // missing `frameworkPatterns` key the census registered.
  // --------------------------------------------------------------------------
  {
    id: "objc/framework-import-order",
    language: "objc",
    defectClass: "nondeterministic-primary-pick",
    description:
      "R8 (M60) regression: the emitted array goes back to the SET'S INSERTION ORDER, which is the pre-fix observable — the analyzer published `[...frameworks]` and picked `[...frameworks][0]`, so the payload was the order the `#import` statements happened to be walked in. Caught by objc/framework-surface-pins, which imports Foundation and Cocoa FIRST and pins [UIKit, AppKit, Cocoa, Foundation] with UIKit as the primary pick: the mutant emits [Foundation, Cocoa, AppKit, UIKit] and picks Foundation — the base library every Objective-C file imports, reported as the primary framework of a UIKit view.",
    transform: r => {
      const det: string[] = (r.metadata as any)?.detectedFrameworks ?? []
      // Derived from the result's OWN import list, not from a hardcoded order: the pre-fix
      // order IS import order, so this stays a faithful revert on any fixture. Frameworks
      // whose module is not among the imports keep their relative position at the end.
      const modules: string[] = (r.imports ?? []).map((i: any) => String(i.module ?? ""))
      const rank = (f: string) => {
        const at = modules.findIndex((m) => m.includes(f))
        return at === -1 ? modules.length : at
      }
      const pre = [...det].sort((a, b) => rank(a) - rank(b))
      const pats: any[] = (r.metadata as any)?.frameworkPatterns ?? []
      const byName = new Map(pats.map((p: any) => [p.framework, p]))
      return {
        ...r,
        metadata: {
          ...(r.metadata ?? {}),
          detectedFrameworks: pre,
          framework: pre[0],
          frameworkPatterns: pre.map((f) => byName.get(f)).filter(Boolean),
        },
      }
    },
  },
  {
    id: "objc/framework-patterns-dropped",
    language: "objc",
    defectClass: "missing-contract-key",
    description:
      "R8 (M60) regression: the lane goes back to publishing `detectedFrameworks` and a primary pick and NOTHING ELSE — the state the census registered as missing-contract-key and the runtime half measured on 7 of 7 detecting files over 153 real corpus files. `frameworkPatterns` is not a redundant copy of detection: it says what was observed and therefore why the framework is claimed. Caught by objc/framework-surface-pins' frameworkPatterns metadata pin, and by the R8 runtime probe's A7 assertion — which exists because this exact shape measured CLEAN before it was added.",
    transform: r => {
      const m: any = { ...(r.metadata ?? {}) }
      delete m.frameworkPatterns
      return { ...r, metadata: m }
    },
  },
  {
    id: "haskell/drop-tuple-superclass",
    language: "haskell",
    defectClass: "relationship-loss",
    description: "regresses #872: drops tuple-context superclass extends edges (Mergeable2->Show/Eq) — the pre-fix analyzer saw only direct applies; fixture pins Mergeable2 extends",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !(x.type === "extends" && (x.metadata ?? {}).isSuperclass && x.source === "Mergeable2")) }),
  },
  {
    id: "haskell/apply-head-as-argument",
    language: "haskell",
    defectClass: "relationship-fabrication",
    description: "#872 companion: an applied superclass head (Eq (f a) => Applied f a) is re-attributed to its ARGUMENT leaf (f a) — the pre-fix left-spine miss class; the fixture pins extends Applied->Eq",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map((x: any) => (x.type === "extends" && (x.metadata ?? {}).isSuperclass && x.source === "Applied" && x.target === "Eq" ? { ...x, target: "f a" } : x)) }),
  },
  {
    id: "haskell/drop-derived-implements",
    language: "haskell",
    defectClass: "relationship-loss",
    description: "drops haskell deriving-clause implements edges (User->Show/Eq, UserId->Show) — haskell derived pins",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !((x.metadata ?? {}).derived && x.type === "implements")) }),
  },
  {
    id: "haskell/drop-qualified-calls",
    language: "haskell",
    defectClass: "relationship-loss",
    description: "drops haskell qualified calls (M.lookup) — haskell isQualifiedCall pin (HSD-qualified contract)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !((x.metadata ?? {}).isQualifiedCall && x.type === "calls")) }),
  },
  {
    id: "haskell/drop-record-construction",
    language: "haskell",
    defectClass: "relationship-loss",
    description: "drops haskell record-construction instantiates (mkUser->Person, choose->Bot) — HSD5 record pins",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !((x.metadata ?? {}).isRecordConstruction && x.type === "instantiates")) }),
  },
  {
    id: "haskell/drop-symbol-complexity",
    language: "haskell",
    defectClass: "payload-loss",
    description: "drops haskell per-symbol complexity (describe=3, signed=3) — haskell section C complexity pins",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => ({ ...s, complexity: undefined })) }),
  },
  {
    id: "haskell/pattern-bindings-leak-as-calls",
    language: "haskell",
    defectClass: "fabrication",
    description: "injects the pattern-binding fabrication class: case/lambda pattern variables (a, b) leak as bare calls — haskell forbid pins calls:merged->a/b",
    transform: r => ({ ...r, relationships: [
      ...(r.relationships ?? []),
      { type: "calls", source: "merged", target: "a", fromSymbol: "merged", toSymbol: "a", confidence: 0.9, metadata: { haskellSpecific: true, context: "local function call" } },
      { type: "calls", source: "merged", target: "b", fromSymbol: "merged", toSymbol: "b", confidence: 0.9, metadata: { haskellSpecific: true, context: "local function call" } },
    ] }),
  },
  {
    id: "haskell/drop-standalone-deriving",
    language: "haskell",
    defectClass: "relationship-loss",
    description: "drops standalone deriving implements (Ticket->Show/Csv.ToNamedRecord/ToJSON) — HSD12/HSD18 pins (bare, qualified, parens class heads)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !((x.metadata ?? {}).isStandaloneDeriving)) }),
  },
  {
    id: "haskell/qualified-ctor-as-calls",
    language: "haskell",
    defectClass: "fabrication",
    description: "injects the HSD16 regression class: qualified constructor application (M.Just) emitted as calls instead of instantiates — fixture pins instantiates:maybeOne->M.Just",
    transform: r => ({ ...r, relationships: [
      ...(r.relationships ?? []).filter((x: any) => !(x.source === "maybeOne" && x.target === "M.Just")),
      { type: "calls", source: "maybeOne", target: "M.Just", fromSymbol: "maybeOne", toSymbol: "M.Just", confidence: 0.9, metadata: { haskellSpecific: true, isQualifiedCall: true } },
    ] }),
  },
  {
    id: "haskell/pattern-position-instantiates",
    language: "haskell",
    defectClass: "fabrication",
    description: "injects the HSD14 regression class: case-alternative + record-pattern heads fabricate instantiates — fixture forbids whoIs->Person/Bot/Plain, nOf->Ticket, guardPick->Person",
    transform: r => ({ ...r, relationships: [
      ...(r.relationships ?? []),
      { type: "instantiates", source: "whoIs", target: "Person", fromSymbol: "whoIs", toSymbol: "Person", confidence: 0.9, metadata: { haskellSpecific: true, isConstructorApplication: true } },
      { type: "instantiates", source: "nOf", target: "Ticket", fromSymbol: "nOf", toSymbol: "Ticket", confidence: 0.9, metadata: { haskellSpecific: true, isRecordConstruction: true } },
    ] }),
  },
  {
    id: "haskell/head-self-call",
    language: "haskell",
    defectClass: "fabrication",
    description: "injects the HSD19 regression class: backtick infix definition head emits a self-call — fixture forbids calls:combine->combine",
    transform: r => ({ ...r, relationships: [
      ...(r.relationships ?? []),
      { type: "calls", source: "combine", target: "combine", fromSymbol: "combine", toSymbol: "combine", confidence: 0.9, metadata: { haskellSpecific: true } },
    ] }),
  },
  {
    id: "javascript/template-callee-uses",
    language: "javascript",
    defectClass: "relationship-fabrication",
    description: "M49 W4 (J6) regression: re-emits the pre-fix template-substitution fabrication - Uses for call callees and receivers (`${fn(x)}` -> uses fn, `${obj.m(x)}` -> uses obj). The template walk emitted every identifier in the subtree; template-substitution-reads forbids both targets",
    transform: r => {
      const rels = r.relationships ?? []
      const call = rels.find((x: any) => String(x.type ?? x.relationshipType) === "calls" && (x.metadata ?? {}).calleeExpression)
      if (!call) return r
      const extra = ["fn", "obj"].map(t => ({ source: call.source, target: t, type: "uses", confidence: 0.85, metadata: { isTemplateInterpolation: true } }))
      return { ...r, relationships: [...rels, ...extra] }
    },
  },
  {
    id: "javascript/template-read-duplicate",
    language: "javascript",
    defectClass: "edge-duplication",
    description: "M49 W4 (J6 dedupe half; TS TSD28 twin): re-emits the generic bare-read Uses alongside the template walk's edge, so one interpolated read becomes two Uses edges (0.85 + 0.6) - template-substitution-reads pins count==1",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).flatMap((x: any) => (x.type === "uses" && (x.metadata ?? {}).isTemplateInterpolation)
      ? [x, { ...x, confidence: 0.6, metadata: { isFieldAccess: true, bareRead: true } }]
      : [x]) }),
  },
  {
    id: "typescript/property-override-drop",
    language: "typescript",
    defectClass: "relationship-loss",
    description: "M49 W4 (T2) regression: drops the interface-PROPERTY override branch - a derived interface redeclaring a property emits no overrides edge (the svelte-repo .d.ts shape: HTMLAttributes.ontoggle over DOMAttributes.ontoggle). dts-interface-property-overrides pins exactly 2 overrides",
    transform: r => {
      const props = new Set((r.symbols ?? []).filter((s: any) => s.metadata?.isInterfaceMember && s.kind === "property").map((s: any) => `${s.ownerName}.${s.name}`))
      return { ...r, relationships: (r.relationships ?? []).filter((x: any) => !(String(x.type ?? x.relationshipType) === "overrides" && props.has(x.target))) }
    },
  },
  {
    id: "typescript/subscript-callee-nested-call-drop",
    language: "typescript",
    defectClass: "relationship-loss",
    description: "M49 W4 (T3) regression: restores the pre-fix early return on computed-callee calls - the argument subtree is skipped entirely, so real calls nested inside the arguments vanish (subscript-callee-nested-calls pins exactly 2 calls->text; the svelte corpus surfaced it as MISSING on runtime-browser/test.ts)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !(String(x.type ?? x.relationshipType) === "calls" && x.target === "text")) }),
  },
  {
    id: "erlang/collapse-arity-group",
    language: "erlang",
    defectClass: "symbol-identity-corruption",
    description: "M14 #275/#880 regression: restores the pre-fix module:name registration that collapsed pick/0 and pick/1 into one symbol (arity-exports pins exactly 2 pick functions, clauseCount 1 and 2)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).filter((s: any) => !(s.name === "pick" && s.metadata?.arity === 1)) }),
  },
  {
    id: "erlang/drop-local-calls",
    language: "erlang",
    defectClass: "relationship-loss",
    description: "M14 #275: drops local calls including forward references (call-resolution pins run->step_one and step_one->step_two as local function calls)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !((x.metadata ?? {}).context === "local function call")) }),
  },
  {
    id: "erlang/pattern-record-instantiates",
    language: "erlang",
    defectClass: "relationship-fabrication",
    description: "M14 #275 regression: restores fabrication of instantiates from pattern-position record literals (negative-noise forbids ANY instantiates; worker's head-pattern #unused{} must stay silent)",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), { type: "instantiates", source: "worker", target: "unused", confidence: 1, metadata: { erlangSpecific: true, isRecordExpr: true } }] }),
  },
  {
    id: "erlang/remote-target-unqualified",
    language: "erlang",
    defectClass: "relationship-target",
    description: "M14 #275 regression: strips module qualification from remote call targets (behaviour-otp pins gen_server:reply as the calls target; bare reply would conflate every module's reply)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map((x: any) => (x.metadata ?? {}).context === "remote function call" && typeof x.target === "string" && x.target.includes(":") ? { ...x, target: x.target.split(":")[1] } : x) }),
  },
  {
    id: "erlang/call-arity-collapsed",
    language: "erlang",
    defectClass: "relationship-loss",
    description: "M14 #880 obligation 4 regression: restores the 3-field (source|type|target) dedup that merged pick/1 and pick/2 call sites into one edge (arity-distinct-calls pins go->pick at callArity 1 AND 2, and go->io:format at 1 AND 2 — a collapse deletes the second edge of each pair)",
    transform: r => {
      const seen = new Set<string>()
      return { ...r, relationships: (r.relationships ?? []).filter((x: any) => {
        if (String(x.type ?? x.relationshipType) !== "calls") return true
        const k = `${x.source}|${x.target}`
        if (seen.has(k)) return false
        seen.add(k)
        return true
      }) }
    },
  },
  {
    id: "erlang/remote-call-arity-lost",
    language: "erlang",
    defectClass: "relationship-identity",
    description: "M14 #880 obligation 4 regression: strips callArity from remote call edges only (arity-distinct-calls pins io:format/1 and io:format/2 as distinct remote edges — losing the arity merges two remote callees into one)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map((x: any) => {
      if ((x.metadata ?? {}).context !== "remote function call" || x.metadata?.callArity === undefined) return x
      const m = { ...x.metadata }
      delete m.callArity
      return { ...x, metadata: m }
    }) }),
  },
  {
    id: "erlang/lines-dropped",
    language: "erlang",
    defectClass: "line-attribution",
    description: "M59 (#825) regression, ER1 wave: drops line_number from every erlang relationship (callsite-lines-825 pins the name-bearing node's line on calls/implements/instantiates/references/contains — erlang emitted NO line on any relationship before the ER1 round)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map((x: any) => {
      if (typeof x.line_number !== "number") return x
      const y = { ...x }
      delete y.line_number
      return y
    }) }),
  },
  {
    id: "erlang/line-zero-based",
    language: "erlang",
    defectClass: "line-attribution",
    description: "M59 (#825) regression, ER1 wave: the off-by-one — emits 0-based lines (callsite-lines-825 pins exact 1-based values; line 22 becomes 21 and every pinned expectation misses)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map((x: any) => typeof x.line_number === "number" ? { ...x, line_number: x.line_number - 1 } : x) }),
  },
  {
    id: "erlang/site-collapsed",
    language: "erlang",
    defectClass: "relationship-loss",
    description: "M59 (#825) regression, ER1 wave: restores set-semantics call dedup — one edge per (source,target,arity) instead of per site (callsite-lines-825 pins FOUR target() sites at lines 22/23/24/25; a collapse deletes three of them and the tool can no longer report every site)",
    transform: r => {
      const seen = new Set<string>()
      return { ...r, relationships: (r.relationships ?? []).filter((x: any) => {
        if (String(x.type ?? x.relationshipType) !== "calls") return true
        const k = `${x.source}|${x.target}|${(x.metadata ?? {}).callArity ?? ""}`
        if (seen.has(k)) return false
        seen.add(k)
        return true
      }) }
    },
  },
  {
    id: "elixir/lines-dropped",
    language: "elixir",
    defectClass: "line-attribution",
    description: "EX3 regression: drops line_number from every elixir relationship (ex3-callsite-lines pins exact 1-based call-site lines 3/4/5/6; before EX3 elixir emitted NO line on any relationship)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map((x: any) => {
      if (typeof x.line_number !== "number") return x
      const y = { ...x }
      delete y.line_number
      return y
    }) }),
  },
  {
    id: "elixir/line-zero-based",
    language: "elixir",
    defectClass: "line-attribution",
    description: "EX3 regression: the off-by-one — emits 0-based lines (ex3-callsite-lines pins exact 1-based values; line 3 becomes 2 and every pinned expectation misses)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map((x: any) => typeof x.line_number === "number" ? { ...x, line_number: x.line_number - 1 } : x) }),
  },
  {
    id: "elixir/site-collapsed",
    language: "elixir",
    defectClass: "relationship-loss",
    description: "EX3 regression: restores per-callee call dedup ignoring the site line (ex3-callsite-lines pins TWO helper() sites at lines 3 and 4; a collapse deletes one of them)",
    transform: r => {
      const seen = new Set<string>()
      return { ...r, relationships: (r.relationships ?? []).filter((x: any) => {
        if (String(x.type ?? x.relationshipType) !== "calls") return true
        const k = `${x.source}|${x.target}|${(x.metadata ?? {}).callArity ?? ""}`
        if (seen.has(k)) return false
        seen.add(k)
        return true
      }) }
    },
  },
  {
    id: "elixir/arity-collapsed",
    language: "elixir",
    defectClass: "relationship-identity",
    description: "EX3 regression (ER-D2 parity): dedups calls by source|target only — pick/1 and pick/2 merge (ex3-callsite-lines pins callArity 1 AND 2 on pick)",
    transform: r => {
      const seen = new Set<string>()
      return { ...r, relationships: (r.relationships ?? []).filter((x: any) => {
        if (String(x.type ?? x.relationshipType) !== "calls") return true
        const k = `${x.source}|${x.target}`
        if (seen.has(k)) return false
        seen.add(k)
        return true
      }) }
    },
  },
  {
    id: "elixir/alias-unresolved",
    language: "elixir",
    defectClass: "relationship-target",
    description: "EX2 regression: strips alias resolution from instantiates/implements targets — the raw short names dangle again (ex2-alias-resolution forbids OrderBook/Audit/Encodable and expects MyApp.*)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map((x: any) => {
      const t = String(x.type ?? x.relationshipType)
      if ((t === "instantiates" || t === "implements") && typeof x.target === "string" && x.target.indexOf(".") !== -1) {
        return { ...x, target: x.target.split(".").pop() }
      }
      return x
    }) }),
  },
  {
    id: "elixir/otp-substring-restored",
    language: "elixir",
    defectClass: "pattern-fabrication",
    description: "EX2 regression: restores substring OTP detection — `use MyApp.SupervisorTree` fabricates Supervision Trees and `MyApp.GenServerPool` fabricates Actor Model (ex2-otp-fake's forbidPatterns catches both)",
    transform: r => {
      const targets = new Set((r.relationships ?? []).map((x: any) => String(x.target ?? "")))
      const additions: string[] = []
      for (const t of targets) if (t.includes("Supervisor")) additions.push("Supervision Trees")
      for (const t of targets) if (t.includes("GenServer")) additions.push("Actor Model (OTP)")
      return { ...r, metadata: { ...(r.metadata ?? {}), patterns: [...((r.metadata ?? {}).patterns ?? []), ...additions] } }
    },
  },
  {
    id: "elixir/default-arg-dropped",
    language: "elixir",
    defectClass: "relationship-loss",
    description: "EX2 regression: default-argument expressions stop executing — Builder.build_opts and local build_opts calls vanish (ex2-signature-defaults pins both)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !(String(x.type ?? x.relationshipType) === "calls" && (x.target === "Builder.build_opts" || x.target === "build_opts"))) }),
  },
  {
    id: "elixir/import-scope-mismatch",
    language: "elixir",
    defectClass: "relationship-loss",
    description: "EX2 regression: a function-scoped `import only:` becomes unresolvable again — the in-def Enum.map call is dropped (ex2-import-scope pins ImpFun.run -> Enum.map)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !(String(x.type ?? x.relationshipType) === "calls" && x.source === "ImpFun.run/0" && x.target === "Enum.map")) }),
  },
  {
    id: "elixir/capture-dropped",
    language: "elixir",
    defectClass: "relationship-loss",
    description: "EX3 regression: &fn/arity captures emit nothing again (ex3-captures pins double and Caps.double at callArity 1)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !((x.metadata ?? {}).isCapture === true)) }),
  },
  {
    id: "elixir/contains-self-loop",
    language: "elixir",
    defectClass: "relationship-fabrication",
    description: "EX3 regression: struct self-ownership forges X -> X contains edges again (ex3-no-self-and-implied forbidRelationships catches both modules)",
    transform: r => {
      const loops = (r.symbols ?? []).filter((s: any) => s.kind === "struct" && typeof s.name === "string")
        .map((s: any) => ({ type: "contains", source: s.name, target: s.name, confidence: 1, metadata: {} }))
      return { ...r, relationships: [...(r.relationships ?? []), ...loops] }
    },
  },
  {
    id: "elixir/sigil-doc-dropped",
    language: "elixir",
    defectClass: "payload-loss",
    description: "EX2 regression: sigil doc chunks are lost again (ex2-sigil-docs expectComments pins DocSig/f; stripping the comment text removes the match)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => {
      const cs: string[] = Array.isArray(s.comments) ? s.comments : []
      if (cs.some((c) => String(c).toLowerCase().includes("sigil"))) {
        const y = { ...s }
        delete y.comments
        delete y.docstring
        return y
      }
      return s
    }) }),
  },
  // --------------------------------------------------------------------------
  // M59.A7 (#825): the csharp lane's line round. Four mutants, one per defect
  // class the round's own measurements exposed — the pre-fix state (no line at
  // all), the construct-start line (receiver / `new` / `:` / wrapped head), the
  // containment edge claiming the DECLARATION's start line, and a synthesised
  // name claiming an enclosing declaration's line. All four are caught by
  // csharp/callsite-lines-825.
  // --------------------------------------------------------------------------
  {
    id: "csharp/lines-dropped",
    language: "csharp",
    defectClass: "line-attribution",
    description: "M59.A7 (#825) regression: csharp's relationships go back to carrying NO line — the exact pre-fix state (MEASURED: 23,924 relationships, 0 withLine, on a 200-file draw of the pinned corpus, the M59 oracle reading 0/23,924). Caught by csharp/callsite-lines-825, which pins every edge type's line.",
    transform: dropAllLineNumbers,
  },
  {
    id: "csharp/construct-start-line",
    language: "csharp",
    defectClass: "line-attribution",
    description: "M59.A7 (#825) regression: every lined edge goes back one line — the CONSTRUCT's start instead of the node that names the target (a callee's receiver, `new` before the constructed type, the `:` before a wrapped `base()`, the attribute or return type before a wrapped name). Exactly the positions csharp/callsite-lines-825 forbids.",
    transform: r => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) => {
        const t = String(x.type ?? x.relationshipType ?? "")
        const trapBearing = ["calls", "contains", "extends", "implements", "instantiates", "uses", "references", "overrides"]
        if (trapBearing.includes(t) && typeof x.line_number === "number") {
          return { ...x, line_number: x.line_number - 1 }
        }
        return x
      }),
    }),
  },
  {
    id: "csharp/contains-declaration-start",
    language: "csharp",
    defectClass: "line-attribution",
    description: "M59.A7 (#825) regression, the class this round MEASURED on the corpus: a `contains` edge claims the target SYMBOL's range start, which for an attributed or wrapped declaration is a line the member's name is not written on (653 of 23,924 relationships — 100% of the round's inconsistent set). Simulated off the result's own symbol table (owner+name), so it stays faithful rather than name-hardcoded.",
    transform: r => {
      const startOf = new Map<string, number>()
      for (const s of r.symbols ?? []) {
        const owner = s.ownerName ?? s.scope
        const ln = s.range?.startLine
        if (owner && typeof s.name === "string" && typeof ln === "number") startOf.set(`${owner}\u0000${s.name}`, ln)
      }
      return {
        ...r,
        relationships: (r.relationships ?? []).map((x: any) => {
          const from = x.source ?? x.from ?? x.fromSymbol
          const target = x.target ?? x.to ?? x.toSymbol
          const ln = startOf.get(`${from}\u0000${target}`)
          return typeof ln === "number" ? { ...x, line_number: ln } : x
        }),
      }
    },
  },
  {
    id: "csharp/synthesized-name-claims-line",
    language: "csharp",
    defectClass: "line-attribution",
    description: "M59.A7 (#825) regression: the SYNTHESISED member names go back to claiming a line. `constructor` and `Finalize` are written nowhere in the source (a constructor is written `ClassName(...)`, a destructor `~ClassName()`), so the only honest state is no line — MEASURED: 366 such claims on a 200-file draw, which the M59 oracle can classify only as uncheckable. Caught by csharp/callsite-lines-825's `line_number: null` pins and its forbid entries for the declaration lines.",
    transform: r => {
      const startOf = new Map<string, number>()
      for (const s of r.symbols ?? []) {
        const owner = s.ownerName ?? s.scope
        const ln = s.range?.startLine
        if (owner && typeof s.name === "string" && typeof ln === "number") startOf.set(`${owner}\u0000${s.name}`, ln)
      }
      return {
        ...r,
        relationships: (r.relationships ?? []).map((x: any) => {
          const from = x.source ?? x.from ?? x.fromSymbol
          const target = String(x.target ?? x.to ?? x.toSymbol ?? "")
          if (target !== "constructor" && target !== "Finalize") return x
          const ln = startOf.get(`${from}\u0000${target}`)
          return typeof ln === "number" ? { ...x, line_number: ln } : x
        }),
      }
    },
  },
  // --------------------------------------------------------------------------
  // M60.R7 (csharp lane): the parameter-honesty pair. Four mutants, one per way a
  // name-bearing field can hold something that is not a name — the varargs
  // parameter dropped entirely, the placeholder literal `"unknown"` in a type
  // field, the parameter's OWN NAME surviving as its type, and the blank name the
  // grammar's recovery invites. All four are caught by csharp/param-type-honesty.
  // --------------------------------------------------------------------------
  {
    id: "csharp/varargs-parameter-dropped",
    language: "csharp",
    defectClass: "payload-loss",
    description: "M60.R7 (csharp lane) regression: a `params T[] name` parameter is dropped again — the exact pre-fix state, because the grammar does not wrap the params form in a `parameter` node and the old loop read named `parameter` children only. Simulated by removing array-typed parameters, which is WIDER than the defect by construction: the published output cannot tell a `params` parameter from an ordinary array parameter (the node type is gone), so the mutant also hits `int[] data` — which is why the fixture pins that control, and why the fixture is the only place that fails both ways.",
    transform: r => ({
      ...r,
      symbols: (r.symbols ?? []).map((s: any) => (Array.isArray(s.parameters) && s.parameters.some((p: any) => typeof p?.type === "string" && p.type.endsWith("[]"))
        ? { ...s, parameters: s.parameters.filter((p: any) => !(typeof p?.type === "string" && p.type.endsWith("[]"))) }
        : s)),
    }),
  },
  {
    id: "csharp/unknown-parameter-type",
    language: "csharp",
    defectClass: "placeholder-literal",
    description: "M60.R7 (csharp lane) regression: an unresolvable parameter type publishes the literal `\"unknown\"` again — the register's csharp entry (`pType = … || \"unknown\"`). Caught by csharp/param-type-honesty's forbidParameters types.",
    transform: r => ({
      ...r,
      symbols: (r.symbols ?? []).map((s: any) => (Array.isArray(s.parameters) && s.parameters.some((p: any) => p?.type === undefined)
        ? { ...s, parameters: s.parameters.map((p: any) => (p?.type === undefined ? { ...p, type: "unknown" } : p)) }
        : s)),
    }),
  },
  {
    id: "csharp/parameter-name-as-type",
    language: "csharp",
    defectClass: "placeholder-literal",
    description: "M60.R7 (csharp lane) regression: `extractTypeString`'s last-resort scan lands on the parameter's OWN NAME again and the name is published as the type (`void M(int a, b)` -> type `\"b\"`, MEASURED). Caught by csharp/param-type-honesty's forbidParameters types for both positions.",
    transform: r => ({
      ...r,
      symbols: (r.symbols ?? []).map((s: any) => (Array.isArray(s.parameters) && s.parameters.some((p: any) => p?.type === undefined && typeof p?.name === "string" && p.name.length > 0)
        ? { ...s, parameters: s.parameters.map((p: any) => (p?.type === undefined && typeof p?.name === "string" && p.name.length > 0 ? { ...p, type: p.name } : p)) }
        : s)),
    }),
  },
  {
    id: "csharp/blank-parameter-name",
    language: "csharp",
    defectClass: "placeholder-literal",
    description: "M60.R7 (csharp lane) regression: the empty-name guard around the params branch is removed, so the grammar's recovery identifier (which the tree writes EMPTY — measured with script/m14/tmp/cs-param-noname-tree.ts) is published as a parameter with a blank name. Scoped by symbol name because the shape has no output-level signature of its own: an empty list is indistinguishable from a symbol whose list never existed, so NamelessParams is the only observable anchor. Caught by csharp/param-type-honesty's forbidParameters names entry for the blank name.",
    transform: r => ({
      ...r,
      symbols: (r.symbols ?? []).map((s: any) => (s.name === "NamelessParams" ? { ...s, parameters: [{ name: "" }] } : s)),
    }),
  },
]

async function realAnalyzer(lang: string): Promise<any> {
  const cfg = LANGS[lang]
  const mod: any = await import(`../../src/ast/${cfg.analyzerFile}`)
  return new mod[cfg.className]()
}

async function main() {
  const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, "validation", "m14", "fixture-baseline.json"), "utf8"))
  const mutationLog: { mutant: string; injectedAt: string; caughtBy: string; detail: string }[] = []
  const checks: { id: string; description: string; status: "pass" | "fail"; detail?: string }[] = []
  let survivors = 0

  // cache clean-run results per language once
  const cleanResults = new Map<string, Awaited<ReturnType<typeof runLang>>>()
  async function clean(lang: string) {
    if (!cleanResults.has(lang)) cleanResults.set(lang, await runLang(lang))
    return cleanResults.get(lang)!
  }

  const mutantFilter = process.env.BB_MUTANT_ONLY
  const selected = MUTANTS.filter((m) => {
    // Dev-only iteration filter (unset in gates): BB_MUTANT_ONLY="svelte/" or a full mutant id.
    if (!mutantFilter) return true
    return mutantFilter.endsWith("/") ? m.id.startsWith(mutantFilter) : m.id === mutantFilter
  })
  // M61 #886: an unmatched selector must fail loudly instead of "passing" on
  // zero mutants, and a filtered run is dev-scoped: it prints results but
  // writes NO canonical evidence (canonical F4 is only ever a full run).
  const scoped = !!mutantFilter
  if (scoped && selected.length === 0) {
    console.error(`BB_MUTANT_ONLY="${mutantFilter}" matched 0 of ${MUTANTS.length} mutants - nothing was verified`)
    process.exit(3)
  }
  for (const m of selected) {
    const base = await clean(m.language)
    const real = await realAnalyzer(m.language)
    const mutant = {
      analyze: async (...args: any[]) => m.transform(await real.analyze(...args)),
      // SFC languages (vue/svelte) run through engine parseFile in runLang;
      // runLang applies this transform to the parseFile result so mutants are
      // exercised on the real production path.
      transform: m.transform,
    }
    const mutated = await runLang(m.language, mutant)
    // Caught = more failing fixtures OR more distinct problems inside
    // already-failing fixtures (a defect landing in broken code is still a defect).
    const baseProblems = base.details.reduce((a: number, d: any) => a + (d.problems?.length ?? 0), 0)
    const mutProblems = mutated.details.reduce((a: number, d: any) => a + (d.problems?.length ?? 0), 0)
    const caught = mutated.fail > base.fail || mutProblems > baseProblems
    const caughtBy = mutated.details.filter(d => !d.ok).map((d: any) => d.fixture)
      .filter(f => !base.details.some((bd: any) => !bd.ok && bd.fixture === f))
      .join(", ")
    console.log(`${caught ? "CAUGHT" : "SURVIVED"}  ${m.id}  (${base.fail} -> ${mutated.fail} failures${caughtBy ? "; new failures: " + caughtBy : ""})`)
    checks.push({ id: `mutation-${m.id.replace("/", "-")}`, description: m.description, status: caught ? "pass" : "fail", detail: `${base.fail} -> ${mutated.fail}` })
    mutationLog.push({ mutant: m.id, injectedAt: new Date().toISOString(), caughtBy: caughtBy || "(none)", detail: `${m.defectClass}: ${base.fail} -> ${mutated.fail} fixture failures` })
    if (!caught) survivors++
  }

  const { emitEvidence } = await import("./evidence-harness")
  // M61 #886: a filtered run's result is dev-scoped — print only, never write
  // canonical M14.0.F4 (a 4-mutant slice once replaced the 21-language artifact).
  if (!scoped) emitEvidence({
    issueId: "M14.0.F4",
    title: "Mutation-testing harness",
    claimLevel: "L1",
    layers: ["fixtures", "mutation"],
    checks,
    limitations: [
      { description: "mutants wrap analyzer output rather than rewriting analyzer source; equivalent at the suite level but not a compiler-level injection" },
      { description: "mutation coverage currently spans java + groovy (the wave languages); other languages add mutants when their waves start" },
    ],
    mutationLog,
    data: { summary: { mutantsRun: selected.length, caught: selected.length - survivors, survived: survivors } },
  })

  if (survivors > 0) {
    console.error(`\n${survivors} SURVIVING MUTANT(S) - the suite cannot detect real defects. Fix the suite before trusting any green.`)
    process.exit(2)
  }
  console.log(`\nall ${selected.length} mutants caught - the gates can fail${mutantFilter ? ` (BB_MUTANT_ONLY="${mutantFilter}" filtered ${MUTANTS.length} -> ${selected.length})` : ""}`)
}

main().catch(e => { console.error(e); process.exit(1) })
