/**
 * CPP LANE — standalone differential truth oracle, and the DERIVATION debt
 * repayment for the three types this lane emitted that nothing audited.
 *
 * ## WHAT THIS FILE IS FOR
 *
 * `validation/m60/rel-type-coverage-baseline.json` records, at the time of
 * writing, three findings for cpp:
 *
 *   DERIVATION|cpp|emits `contains`  but the differential audits
 *                ["calls","extends","implements","instantiates","uses"]
 *   DERIVATION|cpp|emits `overrides` but the differential audits (same)
 *   DERIVATION|cpp|emits `references` but the differential audits (same)
 *
 * "Stored and compared against nothing." 41,408 of 238,205 rows sat inside the
 * lane's "100% covered" claim and were never examined — and the D3 work (928
 * duplicate contains/references rows) was found in exactly that unexamined
 * region, by a separate probe, because no gate was looking.
 *
 * The repository has a sanctioned way for a lane to close this without editing
 * a shared file: `rel-type-coverage-gate.ts` prefers a lane-owned
 * `script/m14/<lang>-truth.ts` that exports `<LANG>_ORACLE_LABELS`, and reads it
 * INSTEAD of the shared `differential.ts` filter. Ruby's is the precedent, and
 * its note says the point precisely: the per-lane export "WINS over the shared
 * filter, because it is derived from the emitter itself."
 *
 * ## THE DIVISION OF LABOUR, AND WHY IT IS NOT A COPY
 *
 * Ten labels. SIX are derived HERE, by this module's own walker, and did not
 * previously have an independent derivation at all:
 *
 *   contains   namespace/class/enum/alias -> member, and function -> local type
 *   references `using`-dependencies (the `#include` half moved to `imports`)
 *   imports    `#include <...>` / `#include "..."`, one per MODULE
 *   exports    the export attribute (`__declspec(dllexport)`,
 *              `__attribute__((visibility("default")))`)
 *   overrides  a derived method against a base virtual, transitively
 *   implements  a base that declares a PURE VIRTUAL is an interface (this walker is the ONLY
 *               cpp derivation of the label: the shared heritage walker does not emit it for cpp)
 *
 * The other five are NOT re-derived here. `calls`, `uses`, `extends`,
 * `implements` and `instantiates` already have an independent oracle in the
 * shared `differential.ts` (`deriveCppEdges`, `deriveCppBareUses`), and this
 * module RE-EXPORTS that oracle rather than reimplementing it.
 *
 * That is the opposite of the failure this lane spent a milestone on. D1 and D2
 * were fixed by hand in the analyzer while the oracle kept a second copy of each
 * rule, and the two sides cancelling out of every count is how the self-agreeing
 * `uses num_bits` survived a year of gates (#916). A COPIED rule is a second
 * answer; a SHARED function is one answer. So the honest arrangement is: one
 * implementation per label, named here, and the label list DERIVED from the
 * implementations below rather than restated.
 *
 * ## WHAT INDEPENDENCE DOES AND DOES NOT BUY, STATED PLAINLY
 *
 * This oracle and the analyzer walk the SAME pinned parse tree, so a grammar bug
 * shared by both is invisible to any comparison made here. That is a property of
 * the harness, not a caveat added afterwards: the workstream doc requires it be
 * said rather than claimed around. What the comparison DOES catch is the class
 * that matters most here — a labelling or resolution mistake in the ANALYZER,
 * which is where D3, the D1 keyword family, the signature-key mismatch and the
 * override-keyword work all lived.
 *
 * ## WHERE THE ORACLE IMPORTS FROM THE ANALYZER, AND WHY THAT IS ALLOWED
 *
 * `isCppSpelledName` (D1) and `extendsTargetName` (D2) are imported, not copied.
 * Each is a single impossibility — "a C++ declared name is an identifier, so a
 * keyword spelling is recovery" and "a class cannot inherit from itself" — and
 * `cpp-oracle-contract.ts` enforces from both directions that every exported rule
 * whose doc comment names the oracle has a consumer there. Copying either would
 * create the second answer #916 measured.
 *
 * NO REGEX. The tree walks and the string helpers are character comparisons, so
 * "no regex" is a property of the construction rather than a lint that can be
 * forgotten (the same standard `ruby-truth.ts` sets).
 */
import type { Node } from "web-tree-sitter"
import { cppPureVirtualDeclaration, extendsTargetName, isCppSpelledName } from "../../src/ast/real-cpp-analyzer"
import { deriveCppBareUses, deriveCppEdges, deriveTreeEdges } from "./differential"

export type CppTruthLabel =
  | "calls" | "contains" | "exports" | "extends" | "implements"
  | "imports" | "instantiates" | "overrides" | "references" | "uses"

export interface CppTruthEdge {
  label: CppTruthLabel
  /** The edge's SOURCE. Absent only for labels that genuinely have none. */
  from?: string
  target: string
  line: number
}

export interface CppTruthSet {
  /** The six labels this module derives with its own walker. */
  local: CppTruthEdge[]
  /** The five the shared `differential.ts` oracle already derives for cpp,
   *  re-exported so this module is the single place a caller has to look. */
  shared: Array<{ label: string; from: string; target: string }>
}

/**
 * The audited label set for cpp, DERIVED FROM THE EMITTERS rather than restated.
 *
 * `REL_TYPE_COVERAGE_GATE` reads this literal with a narrow regex (a `const`
 * array of quoted strings), so it has to be a literal — but the four lists are
 * assembled from the same constants the walkers use, and `assertLabelSetMatches
 * Emitters` below fails loudly if the derivation and the literal ever disagree.
 * A hand-maintained list is how an instrument keeps reporting the old number
 * after the constant changes, and this repository has six recorded instances of
 * exactly that.
 */
const LOCAL_LABELS: readonly CppTruthLabel[] = ["contains", "references", "imports", "exports", "overrides", "implements"]
/** Re-exported, not re-derived — see the header. */
const SHARED_LABELS: readonly string[] = ["calls", "uses", "extends", "instantiates"]

/**
 * The audited label set, as a LITERAL of quoted strings — and the file's own
 * comment above already said it has to be one, while the code was a spread.
 *
 * `script/m60/rel-type-coverage-gate.ts` reads this export WITHOUT importing it
 * (`readOwnOracleLabels`), with a narrow pattern over the source text:
 *
 *     /export const [A-Z_]*ORACLE_LABELS[^=]*=\s*\[([^\]]*)\]/s
 *
 * A spread cannot be evaluated by a pattern. `[...LOCAL_LABELS, ...SHARED_LABELS]`
 * matches `[...]` as an EMPTY literal, `vals.length > 0` fails, the gate reads
 * `null`, and it FALLS BACK to the shared `differential.ts` filter — the very
 * filter this module exists to replace. Measured consequence, from the gate's own
 * stdout at this commit:
 *
 *     DERIVATION|cpp|emits `exports` but the differential audits ["calls","extends",
 *       "implements","instantiates","uses"] — the type is stored and compared against nothing
 *     DERIVATION|cpp|emits `imports` but the differential audits [ ...same... ]
 *
 * `contains`, `overrides` and `references` were credited (they appear in the shared
 * filter for some lanes' shape) — no: they were credited because the gate's REPAID
 * accounting compares against the recorded baseline, and `imports`/`exports` were
 * added by the previous round and so are NEW findings rather than repayments. Either
 * way the measurement is the same: two DERIVATION findings for cpp that this file
 * can retire, retired by making the export a literal the gate can actually read.
 *
 * `assertLabelSetMatchesEmitters()` below is what keeps a hand-maintained literal
 * honest: it compares the literal against LOCAL_LABELS + SHARED_LABELS and THROWS
 * on any difference, so the two cannot drift without the module refusing to load.
 */
export const CPP_ORACLE_LABELS: ReadonlyArray<CppTruthLabel> = [
  "contains",
  "references",
  "imports",
  "exports",
  "overrides",
  "implements",
  "calls",
  "uses",
  "extends",
  "instantiates",
]

/** The drift guard the literal above needs. Throws rather than warns: a warning in
 *  a module nobody reads is how a list goes stale while every gate still passes. */
export function assertLabelSetMatchesEmitters(): void {
  const derived = new Set<string>([...LOCAL_LABELS, ...SHARED_LABELS])
  const literal = new Set<string>(CPP_ORACLE_LABELS)
  const missing = [...derived].filter((x) => !literal.has(x))
  const extra = [...literal].filter((x) => !derived.has(x))
  if (missing.length === 0 && extra.length === 0) return
  throw new Error(
    `cpp-truth: CPP_ORACLE_LABELS has drifted from the emitters — missing ${JSON.stringify(missing)}, extra ${JSON.stringify(extra)}. ` +
      `The literal is read by pattern by rel-type-coverage-gate.ts, so it cannot be composed; fix BOTH sides in this file.`,
  )
}
assertLabelSetMatchesEmitters()

/**
 * The DERIVATION gate's own comparison, exported so a lane run can prove the
 * literal matches the emitters. It returns the labels `emits` carries that this
 * oracle does not derive — i.e. exactly the findings the gate would report.
 */
export function cppUnauditedLabels(emits: readonly string[]): string[] {
  return emits.filter((t) => !CPP_ORACLE_LABELS.includes(t as CppTruthLabel))
}

/** Pure-String helpers. No regex anywhere in this file (see the header). */
function lastSegment(raw: string): string {
  let start = 0, out = ""
  for (let i = 0; i <= raw.length; i++) {
    const c = i === raw.length ? ":" : raw[i]
    if (c === ":" || c === " " || c === "\t" || c === "\n" || c === "\r") {
      if (i > start) out = raw.slice(start, i)
      start = i + 1
    }
  }
  return out
}
function stripIncludeChars(text: string): string {
  let out = ""
  for (const c of text) if (c !== "<" && c !== ">" && c !== '"' && c !== "'") out += c
  return out
}
/**
 * Collapse every run of whitespace to one space and trim — the signature key's
 * normaliser. Pure-String: a character comparison per position, no pattern. This
 * replaced a whitespace-collapsing pattern that was the one regular expression in
 * this file, in a file whose own header claims there is none, so the claim was
 * false and the file now carries the answer instead of the promise. The pattern is
 * described rather than quoted, because a quoted one is a literal a grep-based
 * no-regex gate reads as a finding (the lane has measured that failure twice).
 */
function collapseSpaces(text: string): string {
  let out = ""
  let pendingSpace = false
  for (const c of text) {
    const ws = c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f" || c === "\v"
    if (ws) { if (out.length > 0) pendingSpace = true; continue }
    if (pendingSpace) { out += " "; pendingSpace = false }
    out += c
  }
  return out
}
function namedChildren(n: any): any[] {
  const out: any[] = []
  for (let i = 0; i < (n.namedChildCount ?? 0); i++) { const c = n.namedChild(i); if (c) out.push(c) }
  return out
}
function firstNamed(n: any, types: string[]): any {
  if (!n) return null
  for (const c of namedChildren(n)) if (types.includes(c.type)) return c
  return null
}
/** 1-based line of a node, 0 when the node is absent. */
const lineOf = (n: any): number => (n ? n.startPosition.row + 1 : 0)
/** The line the NAME is written on: a specifier starts at its keyword. */
function nameLine(n: any): number {
  const nm = n?.childForFieldName?.("name")
  return nm ? nm.startPosition.row + 1 : lineOf(n)
}

// ── contains ─────────────────────────────────────────────────────────────────
/**
 * `contains` truth: REAL container ownership, one edge per (owner, name) pair.
 *
 * The shape a reader must not take from the analyzer is "owner → every
 * descendant": the analyzer publishes `contains` from a symbol's `ownerName`, so
 * this oracle walks CONTAINERS (namespace/class/enum/alias scopes) and collects
 * their DIRECT members. That is an independent construction: it never reads the
 * analyzer's symbol table, so a symbol whose owner was mis-attributed does not
 * reproduce itself as truth.
 *
 * Deliberately NOT asserted: `global contains X` (the global namespace is not a
 * container — the analyzer's own contract), and a function-local alias/typedef
 * (CGD20: an execution artifact, not a declaration site).
 */
function deriveContains(root: Node): CppTruthEdge[] {
  const out: CppTruthEdge[] = []
  const seen = new Set<string>()
  const push = (from: string, target: string, line: number) => {
    if (!from || from === "global" || !target) return
    const k = `${from}\u0000${target}`
    if (seen.has(k)) return
    seen.add(k)
    out.push({ label: "contains", from, target, line })
  }
  const declaredName = (n: any): string | null => {
    const id = n?.childForFieldName?.("declarator")
    if (!id) return null
    const leaf = lastNamedIdentifier(id)
    return leaf && isCppSpelledName(leaf) ? leaf : null
  }
  const lastNamedIdentifier = (n: any): string | null => {
    let cur = n, guard = 0
    while (cur && guard++ < 12) {
      const t = cur.type
      if (t === "identifier" || t === "field_identifier" || t === "type_identifier" || t === "destructor_name" || t === "operator_name") return String(cur.text ?? "")
      const next = cur.childForFieldName?.("declarator") ?? namedChildren(cur)[namedChildren(cur).length - 1]
      cur = next
    }
    return null
  }
  /** Constructor is normalized to one name by the family contract, which is why
   *  the one-edge-per-pair rule exists for `contains` at all.
   *
   *  A DESTRUCTOR **IS** a published member — CORRECTED 2026-10-18 by measurement. The previous
   *  rule here skipped `~X` on the claim that "the analyzer deliberately publishes no symbol for
   *  it"; the probe on the pinned grammar shows the opposite:
   *    symbols  [class S, constructor, method ~S, method operator=, property x]
   *    contains [S -> constructor, S -> ~S, S -> operator=, S -> x]
   *  so the skip made truth MANUFACTURE gaps (`system_message -> ~system_message` unexplained on
   *  the fmt draw) exactly the failure this comment used to warn about, in the other direction.
   *  The fixture `destructor-definition-published` pins the analyzer's behavior; truth follows it.
   */
  const memberName = (cls: string, declared: string): string | null => {
    return declared === cls ? "constructor" : declared
  }

  const visit = (n: any, owner: string | null, ownerLine: number, isFunctionScope: boolean) => {
    const t = n.type
    // A NAMED class/struct/union is itself a MEMBER of its owner (a namespace or an enclosing
    // class), so the owning container CONTAINS it. Measured defect this closes: a namespace's
    // classes were never derived as contained members (contract case
    // `contains->ns.Widget` was MISSING against the analyzer), while the enum branch already
    // pushed the enum itself — the two shapes of a nested declaration must be treated the same.
    if (owner && (t === "class_specifier" || t === "struct_specifier" || t === "union_specifier")) {
      const own = n.childForFieldName?.("name")?.text
      if (own) push(owner, String(own), nameLine(n))
    }
    if (t === "namespace_definition") {
      const nm = n.childForFieldName?.("name")?.text
      if (nm) {
        const next = String(nm)
        const body = firstNamed(n, ["declaration_list"]) ?? n.childForFieldName?.("body")
        if (body) {
          for (const c of namedChildren(body)) {
            const ct = c.type
            // A NAMED namespace member is contained by the namespace: a function, a variable, a
            // typedef/using-alias — not only the class/enum shapes the class walker already
            // covers. Measured defect this closes: the fixtures' `namespace N { int x; int getx(); }`
            // published analyzer edges N -> x / N -> getx that truth never derived (unexplained
            // contains), while the analyzer's own contract is one edge per (owner, name) pair.
            if (ct === "declaration" || ct === "field_declaration" || ct === "function_definition" || ct === "alias_declaration" || ct === "type_definition") {
              const dn = declaredName(c) ?? (ct === "type_definition" ? firstNamed(c, ["type_identifier"])?.text : null)
              if (dn) push(next, String(dn), lineOf(c))
            }
            visit(c, next, nameLine(n), false)
          }
        }
      }
      return
    }
    if (t === "class_specifier" || t === "struct_specifier" || t === "union_specifier") {
      const body = n.childForFieldName?.("body") ?? firstNamed(n, ["field_declaration_list"])
      const nm = n.childForFieldName?.("name")?.text
      if (!body || !nm) return
      const cls = String(nm)
      for (const m of namedChildren(body)) {
        const mt = m.type
        if (mt === "field_declaration" || mt === "declaration" || mt === "function_definition" || mt === "alias_declaration" || mt === "type_definition" || mt === "using_declaration") {
          const dn = declaredName(m) ?? (mt === "type_definition" ? firstNamed(m, ["type_identifier"])?.text : null)
          if (dn) { const mn = memberName(cls, String(dn)); if (mn) push(cls, mn, lineOf(m)) }
        } else if (mt === "enum_specifier" || mt === "class_specifier" || mt === "struct_specifier" || mt === "union_specifier") {
          // A nested type is a MEMBER of this class: visit it with the class as owner so the
          // class-level push and the nested type's OWN members are both derived (the enum branch
          // pushes enum -> enumerator, never class -> enumerator).
          visit(m, cls, nameLine(m), false)
        } else if (mt === "template_declaration") {
          for (const c of namedChildren(m)) visit(c, cls, nameLine(n), false)
        }
      }
      return
    }
    if (t === "enum_specifier" && owner) {
      const nm = n.childForFieldName?.("name")?.text
      const list = n.childForFieldName?.("body")
      // The enum ITSELF is contained by its owner; its ENUMERATORS are contained by the enum.
      // Measured defect this closes: a namespace holding an enum published `ns -> enumerator`
      // rows the analyzer never emits (unexplained contains) and missed nothing, so the
      // namespace/enum shape had both a false positive and a false negative in one branch.
      const container = nm ? String(nm) : owner
      if (nm) push(owner, String(nm), nameLine(n))
      if (list) for (const e of namedChildren(list)) if (e.type === "enumerator") push(container, String(e.text ?? ""), lineOf(e))
      return
    }
    if (t === "alias_declaration" || t === "type_definition") {
      if (isFunctionScope) return // CGD20
      const nm = n.childForFieldName?.("name")?.text ?? firstNamed(n, ["type_identifier"])?.text
      if (nm && owner) push(owner, String(nm), nameLine(n))
      return
    }
    if (t === "function_definition" || t === "function_declarator") {
      // A function is never an owner EXCEPT for a local class/struct/enum, which
      // has members that need one.
      const body = n.childForFieldName?.("body") ?? firstNamed(n, ["compound_statement"])
      if (body) for (const c of namedChildren(body)) visit(c, null, ownerLine, true)
      return
    }
    if (t === "preproc_def" || t === "preproc_function_def" || t === "preproc_include" || t === "preproc_if" || t === "preproc_ifdef" || t === "preproc_else") {
      // An object-like macro with a VALUE body declares a name (the #901
      // ruling); a file-scope declaration carries no container, so nothing is
      // pushed and the subtree is still walked.
      for (const c of namedChildren(n)) visit(c, owner, ownerLine, isFunctionScope)
      return
    }
    for (const c of namedChildren(n)) visit(c, owner, ownerLine, isFunctionScope)
  }
  visit(root, null, 0, false)
  void ownerLineUnused
  return out
}
// `ownerLine` is carried for readability at the call sites above; a void read
// keeps the signature honest about not using it.
const ownerLineUnused = 0

// ── imports + references ─────────────────────────────────────────────────────
/**
 * `imports` truth: `#include` is C++'s FILE INCLUSION, one edge per MODULE.
 *
 * `references` truth: a `using`-dependency at file or namespace scope, one per
 * module. A class-body `using B::f;` is a member re-export and a function-local
 * `using` is an execution artifact — neither is a module dependency, and both
 * are asserted as absences in `cpp/include-kind-imports`.
 *
 * `stripIncludeChars` is a character scan, mirroring the C lane's contract: the
 * name is the PATH NODE's text (`<vector>` → `vector`), never a slice of the
 * whole directive, and a macro-composed argument is not a statically resolvable
 * header name at all (C-D2) so it produces nothing.
 */
function deriveImportsAndReferences(root: Node): { imports: CppTruthEdge[]; references: CppTruthEdge[] } {
  const imports: CppTruthEdge[] = []
  const references: CppTruthEdge[] = []
  const seenImports = new Set<string>()
  const seenRefs = new Set<string>()
  const stack: any[] = [...namedChildren(root)]
  while (stack.length) {
    const n = stack.pop()
    if (n.type === "preproc_include") {
      const p = n.childForFieldName?.("path")
      const raw = String(p?.text ?? "").trim()
      if (!p || (p.type !== "string_literal" && p.type !== "system_lib_string")) continue
      const mod = stripIncludeChars(raw).trim()
      if (!mod || seenImports.has(mod)) continue
      seenImports.add(mod)
      imports.push({ label: "imports", from: "global", target: mod, line: lineOf(p) })
      continue
    }
    if (n.type === "using_declaration") {
      const inClassOrFunction = insideClassOrFunction(n)
      if (inClassOrFunction) continue
      const q = firstNamed(n, ["qualified_identifier"]) ?? firstNamed(n, ["identifier"])
      const mod = String(q?.text ?? "")
      if (!mod || !isCppSpelledName(mod) || seenRefs.has(mod)) continue
      seenRefs.add(mod)
      references.push({ label: "references", from: "global", target: mod, line: lineOf(q) })
    }
    // An `#include` inside `#ifdef` is the ordinary case, and a `using` inside a
    // namespace is the ordinary case for the other half, so the walk descends
    // rather than reading only the translation unit's direct children.
    for (const c of namedChildren(n)) stack.push(c)
  }
  return { imports, references }
}
function insideClassOrFunction(n: any): boolean {
  let cur = n.parent, guard = 0
  while (cur && guard++ < 64) {
    const t = cur.type
    if (t === "class_specifier" || t === "struct_specifier" || t === "union_specifier") return true
    if (t === "function_definition") return true
    cur = cur.parent
  }
  return false
}

/**
 * `implements` truth: a base that declares at least one PURE VIRTUAL member is an
 * abstract interface, and `D : public I` is the spelling that says `D` implements
 * it. Derived from the same pure-virtual registry `overrides` uses, in one pass,
 * and adjudicated AFTER the walk because a base may be declared below its derived
 * class — the same ordering constraint the analyzer works under, and the reason
 * this oracle's `implements` is a separate function rather than a flag on the
 * heritage pass.
 */
function deriveImplements(root: Node): CppTruthEdge[] {
  const pure = new Map<string, Set<string>>()
  const pending: Array<{ derived: string; base: string; line: number }> = []
  const seen = new Set<string>()
  const out: CppTruthEdge[] = []
  const className = (n: any): string | null => {
    const nm = n.childForFieldName?.("name")?.text
    return nm && isCppSpelledName(String(nm)) ? String(nm) : null
  }
  const stack: any[] = [root]
  while (stack.length) {
    const n = stack.pop()
    if (n.type === "class_specifier" || n.type === "struct_specifier" || n.type === "union_specifier") {
      const cls = className(n)
      const body = n.childForFieldName?.("body") ?? firstNamed(n, ["field_declaration_list"])
      if (cls && body) {
        const clause = firstNamed(n, ["base_class_clause"])
        if (clause) {
          for (const bc of namedChildren(clause)) {
            if (bc.type === "access_specifier") continue
            const tn = firstNamed(bc, ["type_identifier"]) ?? firstNamed(bc, ["qualified_identifier"]) ?? firstNamed(bc, ["template_type"]) ?? bc
            const t = extendsTargetName(String(tn.text ?? ""), cls)
            if (t) pending.push({ derived: cls, base: t, line: lineOf(tn) })
          }
        }
        const set = pure.get(cls) ?? new Set<string>()
        for (const m of namedChildren(body)) {
          if (m.type !== "field_declaration" && m.type !== "declaration") continue
          if (!firstNamed(m, ["function_declarator"])) continue
          // Shared D23 rule (both `= 0` shapes), imported not copied — see deriveOverrides.
          if (cppPureVirtualDeclaration(m)) {
            const fd = firstNamed(m, ["function_declarator"])
            const id = fd?.childForFieldName?.("declarator") ?? firstNamed(fd ?? m, ["field_identifier", "identifier"])
            if (id) set.add(String(id.text ?? ""))
          }
        }
        pure.set(cls, set)
      }
    }
    for (const c of namedChildren(n)) stack.push(c)
  }
  for (const p of pending) {
    const k = `${p.derived} ${p.base}`
    if (seen.has(k) || !pure.get(p.base)?.size) continue
    seen.add(k)
    out.push({ label: "implements", from: p.derived, target: p.base, line: p.line })
  }
  return out
}

// ── exports ──────────────────────────────────────────────────────────────────
/**
 * `exports` truth: a declaration carrying an export ATTRIBUTE.
 *
 * `__declspec(dllexport)` (MSVC) and `__attribute__((visibility("default")))`
 * (GCC/Clang ELF) are the two spellings the pinned grammar reads as nodes.
 * `dllimport` is the opposite direction and `visibility("hidden")` is the
 * opposite of exported, so neither is truth.
 *
 * **MEASURED LIMITATION, and it is the important line in this function.** The
 * production entry CANNOT deliver these edges: `src/ast/engine.ts` blanks both
 * spellings out of C/C++ content before the parser sees it (the "UNIVERSAL C/C++
 * AST ILLUSION FIX" block), so `parseFile` returns 0 `exports` rows on a corpus
 * where the analyzer produces them. This oracle therefore derives what the
 * LANGUAGE expresses, and the comparison against production output is expected
 * to report every `exports` row as MISSING — which is the correct reading of a
 * known engine-level erasure, and is why the census reports the gap as its own
 * instrument rather than as a lane defect.
 */
function deriveExports(root: Node): CppTruthEdge[] {
  const out: CppTruthEdge[] = []
  const seen = new Set<string>()
  /**
   * The C++11 `[[...]]` spelling, read the way the pinned grammar hands it over:
   * an `attribute_declaration` holds `attribute` nodes, and an attribute's NAME is
   * its LAST `identifier` (`gnu::visibility` -> `visibility`) with the argument in
   * its own `argument_list`. Derived here independently of the analyzer's
   * `attributeRoleExport` — two walkers, one grammar, which is the most
   * independence this harness can offer, and the reason the spelling is in both.
   */
  const cxx11Spelling = (decl: any): "attribute-dllexport" | "attribute-visibility-default" | null => {
    const attrDecl = firstNamed(decl, ["attribute_declaration"])
    if (!attrDecl) return null
    for (const attr of namedChildren(attrDecl)) {
      if (attr.type !== "attribute") continue
      let name: string | null = null
      for (const c of namedChildren(attr)) if (c.type === "identifier") name = String(c.text ?? "")
      if (name === "dllexport") return "attribute-dllexport"
      if (name !== "visibility") continue
      const args = firstNamed(attr, ["argument_list"])
      if (!args) continue
      for (const a of namedChildren(args)) {
        const lit = a.type === "string_literal" ? a : firstNamed(a, ["string_literal"])
        if (lit && stripIncludeChars(String(lit.text ?? "")).trim() === "default") return "attribute-visibility-default"
      }
    }
    return null
  }
  for (const n of namedChildren(root)) {
    if (n.type !== "function_definition" && n.type !== "declaration" && n.type !== "field_declaration" && n.type !== "class_specifier" && n.type !== "struct_specifier") continue
    let spelling: string | null = null
    for (const c of namedChildren(n)) {
      if (c.type === "ms_declspec_modifier") {
        for (const a of namedChildren(c)) if (a.type === "identifier" && a.text === "dllexport") spelling = "declspec-dllexport"
        continue
      }
      if (c.type === "attribute_specifier") {
        const stack = [c]
        while (stack.length) {
          const x = stack.pop()
          if (x.type === "call_expression") {
            const fn = x.childForFieldName?.("function")
            if (fn && String(fn.text ?? "").trim() === "visibility") {
              const args = x.childForFieldName?.("arguments")
              for (const a of namedChildren(args ?? { namedChildCount: 0, namedChild: () => null })) {
                const lit = a.type === "string_literal" ? a : firstNamed(a, ["string_literal"])
                if (lit && stripIncludeChars(String(lit.text ?? "")).trim() === "default") spelling = "attribute-visibility-default"
              }
            }
          }
          for (const g of namedChildren(x)) stack.push(g)
        }
      }
      if (c.type === "attribute_declaration") {
        const hit = cxx11Spelling(n)
        if (hit) spelling = hit
      }
    }
    if (!spelling) continue
    const declared = declaredSymbolName(n)
    if (!declared) continue
    const target = declared.owner ? `${declared.owner}.${declared.name}` : declared.name
    if (seen.has(target)) continue
    seen.add(target)
    out.push({ label: "exports", from: "global", target, line: declared.line })
  }
  return out
}
function declaredSymbolName(n: any): { name: string; owner: string | null; line: number } | null {
  if (n.type === "class_specifier" || n.type === "struct_specifier") {
    const nm = n.childForFieldName?.("name")
    if (!nm) return null
    return { name: String(nm.text), owner: enclosingClassName(n), line: nameLine(n) }
  }
  const fd = firstNamed(n, ["function_declarator"])
  const decl = fd ?? firstNamed(n, ["init_declarator"]) ?? n
  let nameNode = n.childForFieldName?.("declarator") ?? n.childForFieldName?.("name") ?? firstNamed(n, ["field_identifier", "identifier", "type_identifier"])
  if (fd) nameNode = fd.childForFieldName?.("declarator") ?? firstNamed(fd, ["field_identifier", "identifier"])
  if (!nameNode) return null
  const name = String(nameNode.text ?? "")
  if (!name || !isCppSpelledName(name)) return null
  void decl
  return { name, owner: enclosingClassName(n), line: lineOf(nameNode) }
}
function enclosingClassName(n: any): string | null {
  let cur = n.parent, guard = 0
  while (cur && guard++ < 64) {
    if (cur.type === "class_specifier" || cur.type === "struct_specifier" || cur.type === "union_specifier") {
      const nm = cur.childForFieldName?.("name")?.text
      return nm ? String(nm) : null
    }
    cur = cur.parent
  }
  return null
}

// ── overrides ────────────────────────────────────────────────────────────────
/**
 * `overrides` truth: a derived method against a base VIRTUAL, transitively.
 *
 * The signature key is the parameter TYPE list only. Parameter NAMES are not part
 * of a C++ signature, and the gtest idiom of commenting an unused parameter name
 * out (`const TestInfo& /-*test_info*-/`) makes a full-text comparison diverge from
 * the base declaration — that alone silently dropped 11 of `EmptyTestEvent
 * Listener`'s 15 overrides before CPPD5.
 *
 * **The shared blind spot, named.** This is signature matching, and signature
 * matching is the analyzer's own rule. So a comparison here cannot see a rule
 * that is wrong in BOTH — which is why `script/m14/differential.ts` excludes cpp
 * overrides from its shared derivation outright (CPPD-R1: "cpp overrides are NOT
 * independently derivable — same-name across a base chain conflates C++
 * NAME-HIDING with virtual override"). What this oracle adds is the `override` /
 * `final` KEYWORD as an independent second source of truth, and the fact that it
 * is a separate implementation reading a separate registry. It is NOT proof that
 * the signature rule is right, and the lane doc says so.
 */
function deriveOverrides(root: Node): CppTruthEdge[] {
  // class -> bases (leaf-cleaned, self-refused), class -> method -> signatures,
  // and class -> pure virtuals. All filled in ONE pass, because a base declared
  // after its derived class is the ordinary case in a header.
  const bases = new Map<string, string[]>()
  const virtuals = new Map<string, Map<string, Set<string>>>()
  const lines = new Map<string, number>()
  const out: CppTruthEdge[] = []
  const seen = new Set<string>()

  const className = (n: any): string | null => {
    const nm = n.childForFieldName?.("name")?.text
    return nm && isCppSpelledName(String(nm)) ? String(nm) : null
  }
  const baseList = (n: any, cls: string): string[] => {
    const clause = firstNamed(n, ["base_class_clause"])
    if (!clause) return []
    const outB: string[] = []
    for (const bc of namedChildren(clause)) {
      if (bc.type === "access_specifier") continue
      const tn = firstNamed(bc, ["type_identifier"]) ?? firstNamed(bc, ["qualified_identifier"]) ?? firstNamed(bc, ["template_type"]) ?? bc
      const t = extendsTargetName(String(tn.text ?? ""), cls)
      if (t) outB.push(t)
    }
    return outB
  }
  const paramSig = (decl: any): string => {
    const fd = firstNamed(decl, ["function_declarator"])
    const params = fd?.childForFieldName?.("parameters") ?? null
    if (!params) return ""
    const parts: string[] = []
    for (const pc of namedChildren(params)) {
      if (pc.type === "comment") continue
      if (pc.type === "variadic_parameter_declaration") { parts.push("..."); continue }
      if (pc.type !== "parameter_declaration" && pc.type !== "optional_parameter_declaration") continue
      // The type is the text BEFORE the parameter's NAME node. A
      // `reference_declarator`'s text is `& b` and its start index points at the
      // `&`, so slicing at the declarator's length would publish
      // `const std::string` for `const std::string& b` — a different C++ type
      // that overloads differently, and the same slice is the override-matching
      // key (D8).
      const nameNode = pc.childForFieldName?.("declarator") ?? firstNamed(pc, ["identifier", "field_identifier"])
      let t = String(pc.text ?? "")
      if (nameNode) {
        const cut = nameNode.startIndex - pc.startIndex
        if (cut > 0) t = t.slice(0, cut)
      } else {
        const eq = t.indexOf("=")
        if (eq !== -1) t = t.slice(0, eq)
      }
      parts.push(collapseSpaces(t))
    }
    return parts.join(",")
  }
  const methodName = (decl: any): string | null => {
    const fd = firstNamed(decl, ["function_declarator"])
    if (!fd) return null
    const id = fd.childForFieldName?.("declarator") ?? firstNamed(fd, ["field_identifier", "identifier"])
    const nm = id ? String(id.text ?? "") : null
    return nm && isCppSpelledName(nm) ? nm : null
  }
  // D23: a pure virtual is `= 0`, and this grammar writes the `0` in TWO places (a direct child
  // of the declaration, or the `value` field ONE LEVEL DOWN inside an `init_declarator`). The
  // shared rule `cppPureVirtualDeclaration` is exported by the analyzer FOR this oracle (#916:
  // one rule, two sides — a copied rule is a second answer), so it is imported rather than
  // re-derived. Measured before this: the local direct-children-only test saw shape 1 and could
  // not see shape 2, so `implements`/`overrides` truth under-derived exactly the abstract bases
  // the analyzer flagged (the 4-of-7 miss D23 records).
  const isPure = (decl: any): boolean => cppPureVirtualDeclaration(decl)

  const stack: any[] = [root]
  while (stack.length) {
    const n = stack.pop()
    if (n.type === "class_specifier" || n.type === "struct_specifier" || n.type === "union_specifier") {
      const cls = className(n)
      const body = n.childForFieldName?.("body") ?? firstNamed(n, ["field_declaration_list"])
      if (cls && body) {
        bases.set(cls, baseList(n, cls))
        lines.set(cls, nameLine(n))
        const reg = virtuals.get(cls) ?? new Map<string, Set<string>>()
        for (const m of namedChildren(body)) {
          if (m.type !== "field_declaration" && m.type !== "declaration" && m.type !== "function_definition") continue
          const nm = methodName(m)
          if (!nm || nm === cls) continue
          if (String(nm).startsWith("~")) continue
          const sig = paramSig(m)
          const set = reg.get(nm) ?? new Set<string>()
          set.add(sig)
          reg.set(nm, set)
          if ((bases.get(cls) ?? []).length > 0) {
            // a pending candidate; resolved below
          }
        }
        virtuals.set(cls, reg)
      }
    }
    for (const c of namedChildren(n)) stack.push(c)
  }

  // Second pass: every derived class's methods against its bases.
  for (const [cls, bs] of bases) {
    if (bs.length === 0) continue
    const own = virtuals.get(cls)
    if (!own) continue
    for (const [method, sigs] of own) {
      const queue = [...bs]
      const visited = new Set<string>()
      let depth = 0
      while (queue.length && depth < 10) {
        depth++
        const b = queue.shift()!
        if (visited.has(b) || b === cls) continue
        visited.add(b)
        const bsigs = virtuals.get(b)?.get(method)
        if (bsigs && sigs.size > 0) {
          let hit = false
          for (const s of sigs) if (bsigs.has(s)) hit = true
          if (hit) {
            const k = `${cls}.${method}|${b}.${method}`
            if (!seen.has(k)) {
              seen.add(k)
              out.push({ label: "overrides", from: `${cls}.${method}`, target: `${b}.${method}`, line: lines.get(cls) ?? 0 })
            }
          }
        }
        for (const nb of bases.get(b) ?? []) queue.push(nb)
      }
    }
  }
  return out
}

// ── the entry point ──────────────────────────────────────────────────────────
/**
 * Derive cpp truth for ONE file, local labels only.
 *
 * `shared` is returned by {@link deriveCppShared} rather than mixed in here, so a
 * caller can attribute a disagreement to the implementation that produced it —
 * a disagreement in `local` is this module's, a disagreement in `shared` is the
 * shared differential oracle's, and neither is silently folded into the other.
 */
export function deriveCppTruth(root: Node): CppTruthEdge[] {
  const { imports, references } = deriveImportsAndReferences(root)
  return [
    ...deriveContains(root),
    ...imports,
    ...references,
    ...deriveExports(root),
    ...deriveOverrides(root),
    ...deriveImplements(root),
  ]
}

/**
 * THE D4 WIRING HALF (ALL-OUT-OF-ALL §9.1 D4, 2026-10-18).
 *
 * The measured state this closes: the shared differential's compared set for cpp named only
 * `calls`/`uses`/`extends`/`implements`/`instantiates`, so the lane's five OTHER emitted
 * labels — `contains` (161,930 whole-population edges), `references`, `imports` (45,829),
 * `exports`, `overrides` (1,875) — were stored and compared against NOTHING (the
 * `validation/m60/rel-type-coverage-baseline.json` DERIVATION shape). The Lead wires this
 * function into `script/m14/differential.ts` (the shared file is Lead-owned, single-writer
 * rule) and admits the five labels in the SAME change — an oracle with no admission compares
 * nothing, and an admitted label with no oracle turns every analyzer row into a fabrication.
 *
 * It returns ONLY the unadmitted five. `calls`/`uses`/`instantiates`/`extends`/`implements`
 * are already derived for cpp by the shared differential (`deriveCppEdges`,
 * `deriveCppBareUses`, `deriveTreeEdges`); re-exporting them here (see `deriveCppShared`)
 * would push every row twice. One implementation per label is the contract this module's
 * header states, so the wiring pushes each label's truth exactly once.
 */
export function deriveCppUnadmittedTruth(root: Node): CppTruthEdge[] {
  const { imports, references } = deriveImportsAndReferences(root)
  return [
    ...deriveContains(root),
    ...imports,
    ...references,
    ...deriveExports(root),
    ...deriveOverrides(root),
    // `implements` was believed shared-derived (`deriveTreeEdges`); the first post-wiring draw
    // disproved that: fmt --sample 60 reported "COMPARED WITH NO TRUTH: implements (15 comparable,
    // 0 truth)". The lane's own pure-virtual walker is pushed here instead — the shared heritage
    // walker does not derive this label for cpp, and the m60 coverage gate had been crediting it
    // from `CPP_ORACLE_LABELS` (the declared set) rather than from a compared truth.
    ...deriveImplements(root),
  ]
}

/** The five labels the SHARED `differential.ts` oracle already derives for cpp,
 *  re-exported. One implementation per label — see the header. */
export function deriveCppShared(root: Node): Array<{ label: string; from: string; target: string }> {
  // The shared differential builds cpp truth from ALL THREE of these
  // (`script/m14/differential.ts`, the `if (lang === "cpp")` block plus the
  // unconditional `deriveTreeEdges(root, lang)`): the generic heritage /
  // instantiate walker, then the cpp `calls` oracle, then the cpp bare-read
  // `uses` oracle. Re-exporting two of the three would understate the audited
  // set by dropping `extends` and `instantiates`, which is the exact false
  // finding the gate's own header warns about — a STALE set read as a current one.
  return [...deriveTreeEdges(root, "cpp"), ...deriveCppEdges(root), ...deriveCppBareUses(root)]
}

export { isCppSpelledName, extendsTargetName }