/**
 * R LANE FIXTURE RUNNER — executes `validation/m14/fixtures/r/*.expectation.json`.
 *
 * ## Why this file exists, and why it is not `script/m14/run-fixtures.ts`
 *
 * `script/m14/run-fixtures.ts` is shared machinery (workstream §8: the supervisor
 * owns it) and its `LANGS` map has **no `r` entry** at handover. Two consequences
 * follow, and both are reported rather than worked around silently:
 *
 *   1. `run-fixtures.ts` computes `orphaned = dirs.filter(d => !(d in LANGS))` and
 *      calls `process.exit(6)` on a FULL run. `validation/m14/fixtures/r/` is such
 *      a directory, so a full fixture run fails today for a reason that has nothing
 *      to do with any lane's behaviour.
 *   2. Even with `r` added to `LANGS`, that runner FAILS a fixture source with no
 *      expectation file ("missing expectation file"), and the R directory holds 16
 *      `.R` sources with 0 expectation files.
 *
 * So an `F17-uses.expectation.json` written in the canonical schema would be
 * evidence nothing executes — precisely the defect the R doc already records once
 * ("251/251 and 26/26 were assertions rather than results"). This runner exists so
 * that the fixture is a RESULT. It re-implements the matching semantics rather than
 * importing them, because importing `runLang` would require the `LANGS` entry that
 * is not mine to add; the semantics it copies are stated below and are the subset
 * F17 uses.
 *
 * ## Matching semantics (the subset of `run-fixtures.ts` this fixture uses)
 *
 *   expectSymbols / expectRelationships : each entry must match >= 1 actual item;
 *     every SPECIFIED constraint must match, unspecified fields are wildcards.
 *   forbidSymbols / forbidRelationships : NO actual item may match the entry.
 *   constraints: name, kind, ownerName for symbols; type, from, target,
 *     confidenceMin, confidenceMax, meta.<key> for relationships.
 *   knownProductionLoss : a relationship the ANALYZER emits and production
 *     `parseFile` deletes. Asserted in BOTH directions plus a non-empty
 *     `sharedMachineryRef`, so a shared-machinery loss is a checked fact that fails
 *     when it is fixed, not a hole with a comment above it.
 *   expectNoParseErrors : the parse tree must contain no ERROR or MISSING node.
 *     This is asserted against the TREE, not against `result.errors`, because a
 *     tree-sitter ERROR node is a successful parse of a damaged region — the same
 *     distinction the make lane's gate makes.
 *
 * ## ENTRY POINT
 *
 * `parseFile` from `src/ast/pool-worker.ts` — the production path — not
 * `analyze()`. `run-fixtures.ts` calls `analyze()` directly, so it would not see
 * the pipeline stages; for a fixture whose subject is relationship emission that
 * difference is the whole point of the ontology workstream, and this runner takes
 * the stricter path.
 *
 * ## MUTANTS
 *
 * `--mutants` applies one named, reversible transformation to the ANALYZER and
 * re-runs the fixtures. A mutant that NO fixture rejects is a SURVIVOR and exits
 * non-zero, so a suite that has lost its teeth fails here rather than being cited
 * as a pin.
 *
 * Three properties of that check are load-bearing, and each was wrong in an earlier
 * revision of this file:
 *
 *   1. A mutant counts as caught when AT LEAST ONE fixture rejects it, not when
 *      every fixture does. The stricter rule scores a fixture rather than a mutant:
 *      `drop-uses` cannot be caught by a fixture with no `uses` edge, and recording
 *      that as a survivor asserts something false about the fixture.
 *   2. A child that CRASHED is not a catch. `caught` used to be `code !== 0`, which is
 *      also true of a child that died on start-up — so `bun run <this file>`, where
 *      `process.execPath` is bun and bun rejects `--import tsx`, reported all 26
 *      mutant/fixture pairs as caught while executing none of them. A result now
 *      counts only when the child's own banner and tally line are present; a missing
 *      banner is a HARNESS FAULT, counted apart from a survivor.
 *   3. RUN IT WITH `npx tsx`. The guard in (2) reports the fault rather than
 *      absorbing it, and it exits non-zero.
 *
 * `knownProductionLoss` is a third assertion class, described at its use below.
 *
 * USAGE
 *   npx tsx validation/m14/fixtures/r/run-r-fixtures.ts
 *   npx tsx validation/m14/fixtures/r/run-r-fixtures.ts --mutants
 */
import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { parseFile } from "../../../../src/ast/pool-worker"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "..", "..", "..", "..")
const DIR = HERE

type Rel = { type?: string; from?: string; target?: string; confidence?: number; metadata?: any; line_number?: number }
type Sym = { name?: string; kind?: string; ownerName?: string }

const argv = process.argv.slice(2)
const wantMutants = argv.includes("--mutants")
const onlyFixture = (() => { const i = argv.indexOf("--fixture"); return i >= 0 ? argv[i + 1] : undefined })()
const onlyMutant = (() => { const i = argv.indexOf("--mutant"); return i >= 0 ? argv[i + 1] : undefined })()

const constraintsMatch = (actual: any, want: any): boolean => {
  for (const [k, v] of Object.entries(want)) {
    if (v === undefined) continue
    if (k === "meta") {
      // LEGACY LANE DIALECT, kept so any row still written this way keeps working. It is NOT
      // what `script/m14/run-fixtures.ts` reads, and a row written this way is INERT there:
      // the canonical matcher falls through to `actual["meta"] !== v`, no relationship has a
      // top-level `meta` field, so the row can never match and is reported as an "inert
      // assertion". See the `meta.` branch below.
      for (const [mk, mv] of Object.entries(v as Record<string, unknown>)) {
        const got = (actual as any)?.metadata?.[mk]
        if (Array.isArray(mv)) { if (!mv.includes(got as any)) return false }
        else if (got !== mv) return false
      }
      continue
    }
    // THE CANONICAL DIALECT, and the one the header above has always documented. It was
    // documented and not implemented, and that divergence is what made 16 rows in
    // F12/F18/F21/F22 unreadable to the gate that gates: those fixtures were written against
    // this runner, the canonical gate (`script/m14/run-fixtures.ts`) reads `meta.<key>` only,
    // and until fceae35d3 taught the canonical runner that `.R` is `r`, `--lang r` discovered
    // ZERO of this lane's fixtures — so the two dialects never had to agree out loud.
    // MEASURED: translating those 16 rows (38 constraints) into this form took the canonical
    // gate from `18 pass / 4 fail` to `22 pass / 0 fail` with no analyzer change, which is how
    // the "62 bases DECLINED by the file-scoped overrides pass" hypothesis was refuted — the
    // edges were emitted all along; the rows could not be found.
    if (k.startsWith("meta.")) {
      const mk = k.slice("meta.".length)
      const mv = (actual as any)?.metadata?.[mk]
      if (Array.isArray(v)) {
        // Sorted JSON, matching the canonical matcher: a list mirror is pinned as a set.
        if (!Array.isArray(mv)) return false
        const canon = (xs: any[]) => JSON.stringify([...xs].map((x: any) => JSON.stringify(x)).sort())
        if (canon(mv) !== canon(v)) return false
      } else if (v === null) {
        // `meta.x: null` means "this edge must NOT carry x", the canonical convention.
        if (mv !== undefined && mv !== null) return false
      } else if (mv !== v) return false
      continue
    }
    if (k === "ownerName" && (actual as any)?.ownerName !== undefined) {
      if ((actual as any).ownerName !== v) return false
      continue
    }
    if (k === "confidenceMin") { if (typeof actual.confidence !== "number" || actual.confidence < (v as number)) return false; continue }
    if (k === "confidenceMax") { if (typeof actual.confidence !== "number" || actual.confidence > (v as number)) return false; continue }
    if ((actual as any)[k] !== v) return false
  }
  return true
}

// ------------------------------------------------------------------ mutants
/**
 * MUTANTS COME IN TWO KINDS, and the split is not cosmetic.
 *
 * An OUTPUT transform edits the analyzer's result. It can express a defect that is
 * visible in the emitted edges — a dropped label, a wrong confidence, a qualified
 * target, an edge duplicated under a second label — and it cannot express a defect
 * in a GATE, because a gate's whole behaviour is to emit nothing.
 *
 * The first version of this file wrote six output transforms and two of them were
 * IDENTITY FUNCTIONS: `uses-on-write` returned its input unchanged, and
 * `uses-keeps-backticks` matched a target shape the analyzer had already stripped,
 * so it also changed nothing. Both were reported as SURVIVORS, which is the correct
 * verdict for a mutant that cannot fail but the wrong lesson to draw — the fixture
 * was not weak, the mutants were not mutants. A mutant that is a no-op is worse than
 * no mutant, because it inflates the denominator of a ratio.
 *
 * So a gate defect is now injected as a SOURCE edit: the analyzer file is rewritten
 * in place, the fixture runs, and the original bytes are restored. The runner
 * refuses to start if that file already has uncommitted changes, because restoring
 * over someone else's work is worse than not running, and it asserts byte identity
 * after every mutant.
 */
const ANALYZER = path.join(ROOT, "src", "ast", "real-r-analyzer.ts")

const OUTPUT_MUTANTS: Record<string, { what: string; apply: (rels: Rel[]) => Rel[] }> = {
  "drop-uses": {
    what: "OUTPUT: remove every `uses` edge — the pre-M14 state of this lane, which is the defect this fixture exists to pin",
    apply: (rels) => rels.filter((r) => r.type !== "uses"),
  },
  "uses-on-callee": {
    what: "OUTPUT: publish a `uses` edge for a member access that is the callee of a call, duplicating the `calls` edge under a second label",
    apply: (rels) => rels.flatMap((r) => (r.type === "calls" && /[$@]/.test(String(r.target)) ? [r, { type: "uses", from: r.from, target: String(r.target).split(/[$@]/).pop()!, confidence: 1, metadata: {} }] : [r])),
  },
  "uses-target-is-qualified": {
    what: "OUTPUT: publish the `uses` target as `receiver$member` instead of the member name, so it binds to no property symbol",
    apply: (rels) => rels.map((r) => (r.type === "uses" && r.metadata?.receiver ? { ...r, target: `${r.metadata.receiver}$${r.target}` } : r)),
  },
  "uses-closure-at-1.0": {
    what: "OUTPUT: publish the closure-attributed `uses` edge at 1.0, hiding it from the heuristic ratio",
    apply: (rels) => rels.map((r) => (r.type === "uses" && r.confidence === 0.7 ? { ...r, confidence: 1.0 } : r)),
  },
}

/**
 * Source edits, each a LIST of replacements. Every `from` must occur exactly once in
 * the file, and the concatenated result must differ from the original — a mutant whose
 * edits leave the bytes unchanged is REFUSED rather than run, because a no-op mutant
 * reported as a survivor teaches the reader that the fixture is weak when the mutant
 * is what is weak. Three of those were written and caught this way.
 *
 * The list form exists for the same reason. `src-one-bracket-is-a-member` first
 * appeared as a single edit to `subset2Arguments`, which made that helper accept a
 * `subset` node — and changed nothing, because the WALK's condition
 * (`type === "subset2" && …`) is what decides whether the helper is consulted at all.
 * A gate has to be mutated where it is REACHED, not only where it is defined.
 */
const SOURCE_MUTANTS: Record<string, { what: string; edits: { from: string; to: string }[] }> = {
  "src-drop-callee-gate": {
    what: "SOURCE: remove the callee gate, so a member access that is a call's function also publishes a `uses` edge",
    edits: [{ from: "    if (this.isCalleePosition(node)) {\n      ambiguity.memberReadsSuppressedByCall++\n      return\n    }", to: "    if (false) {\n      ambiguity.memberReadsSuppressedByCall++\n      return\n    }" }],
  },
  "src-drop-write-gate": {
    what: "SOURCE: remove the write gate, so `obj$field <- v` publishes a `uses` edge for the member it stores into",
    edits: [{ from: "    if (this.isMemberWrite(node)) {\n      ambiguity.memberWrites++\n      return\n    }", to: "    if (false) {\n      ambiguity.memberWrites++\n      return\n    }" }],
  },
  "src-one-bracket-is-a-member": {
    what: "SOURCE: accept `[` with a string index as a member read, collapsing the R asymmetry between `x[\"k\"]` and `x[[\"k\"]]`",
    edits: [
      { from: "  private subset2Arguments(node: Node): Node | null {\n    if (node.type !== \"subset2\") return null", to: "  private subset2Arguments(node: Node): Node | null {\n    if (node.type !== \"subset2\" && node.type !== \"subset\") return null" },
      { from: "        if (type === \"subset2\" && this.stringSubsetIndex(current)) {", to: "        if (this.stringSubsetIndex(current)) {" },
    ],
  },
  "src-keep-backticks": {
    what: "SOURCE: publish a backticked member name with its backticks, so the target is the literal string \"`odd name`\"",
    edits: [{ from: '    if (rhs.type === "identifier") return this.unquoteIdentifier(rhs.text) || null\n    if (rhs.type === "string") return this.stringNodeText(rhs) || null', to: '    if (rhs.type === "identifier") return rhs.text || null\n    if (rhs.type === "string") return this.stringNodeText(rhs) || null' }],
  },
  "src-uses-confidence-1": {
    what: "SOURCE: hard-code the `uses` confidence at 1.0, so a closure-attributed read reports a certainty it does not have",
    edits: [{ from: "      member,\n      ASTEngine.RelationshipType.Uses,\n      attribution.confidence,", to: "      member,\n      ASTEngine.RelationshipType.Uses,\n      1.0," }],
  },
  "src-uses-unattributed": {
    what: "SOURCE: attribute a file-scope member read to `global`, inventing a source for a body that has no named owner",
    edits: [{ from: "    const attribution = this.enclosingAttribution(fnStack)\n    if (!attribution) {\n      ambiguity.memberReadsUnresolvedScope++\n      return\n    }\n    const receiver = this.memberReadReceiver(node)", to: "    const attribution = this.enclosingAttribution(fnStack) ?? { name: \"global\", confidence: 0.7, subType: \"closure_call\", reason: \"invented\" }\n    const receiver = this.memberReadReceiver(node)" }],
  },
  "src-overrides-direction": {
    what: "SOURCE: restore the pre-M14 `overrides` direction, so the edge names the class being overridden as the thing doing the overriding",
    edits: [{ from: "          this.pushRel(relationships, className, member, ASTEngine.RelationshipType.Overrides, 0.95, {", to: "          this.pushRel(relationships, base, member, ASTEngine.RelationshipType.Overrides, 0.95, {" }],
  },
  "src-overrides-drops-qualification": {
    what: "SOURCE: strip the qualified member names from the `overrides` metadata, leaving a bare `render` target that resolves to four published symbols in F18 and cannot say which one",
    // The 14-space indent is not cosmetic: d2fc8626f moved this block one level deeper
    // (a per-DECLARATION loop replaced a per-NAME loop) and the shallower anchor then
    // occurred 0x, which the runner correctly reported as HARNESS rather than as a catch.
    // A stale anchor is a silent hole in the denominator, so the indent is part of the pin.
    edits: [{ from: "              overridingMember: `${className}$${member}`,\n              overriddenMember: `${base}$${member}`,\n              overriddenClass: base,", to: "              overriddenClass: base," }],
  },
  "src-overrides-base-is-last-declaration": {
    what: "SOURCE: resolve the base class to the LAST declaration of its name in the file instead of the nearest PRECEDING one. Sound when a class name is declared once, wrong the moment it is redeclared -- and R6's test-clone.R declares `AC` 19 times. F22's cases 1 and 2 are built so `last` and `preceding` disagree, which is why the third case exists",
    edits: [{ from: "          const prior = (classDecls.get(base) ?? []).filter(d => d.line < decl.line)\n          const baseDecl = prior.length ? prior[prior.length - 1] : null", to: "          const prior = classDecls.get(base) ?? []\n          const baseDecl = prior.length ? prior[prior.length - 1] : null" }],
  },
  "src-overrides-base-is-name-union": {
    what: "SOURCE: union the member sets of EVERY declaration of the base class name, which is the pre-d2fc8626f shape for the BASE side (`classMembers` keyed by name held the union). Two declarations of `AC` with disjoint member sets then produce a base that never existed, so the pass invents `overrides` edges onto members no base in scope declares. The DERIVED side is left positional on purpose: isolating the base side is what makes the mutant's failure attributable to one change",
    edits: [{ from: "          for (const member of baseDecl.members.keys()) {\n            if (!decl.members.has(member)) continue", to: "          const unioned = new Set<string>()\n          for (const d of classDecls.get(base) ?? []) for (const m of d.members.keys()) unioned.add(m)\n          for (const member of unioned) {\n            if (!decl.members.has(member)) continue" }],
  },
  "src-s7-export-names-the-class": {
    what: "SOURCE: push the DECLARED class name for an S7 `@export`, so `class_logical <- new_base_class(\"logical\")` exports `logical` -- the defect S7's own NAMESPACE contradicts",
    edits: [{ from: "        exports.push({ name, kind: declared && declared !== name ? ASTEngine.SymbolKind.Variable : ASTEngine.SymbolKind.Class })", to: "        exports.push({ name: className, kind: ASTEngine.SymbolKind.Class })" }],
  },
  "src-qualified-base-class-dropped": {
    what: "SOURCE: revert the namespace-qualified base-class read, so `inherit = pkgA::AC` publishes no edge at all — the pre-F20 state, and the defect F20 exists to pin",
    edits: [{ from: '    if (node.type === "namespace_operator") {\n      // `pkg::Parent` — the `rhs` field is the name. `pkg:::Parent` reaches here as the same\n      // node type; `calleeName` already normalises `:::` to `::` and the class name is the\n      // same token either way.\n      const rhs = node.childForFieldName("rhs")\n      return rhs ? this.unquoteIdentifier(rhs.text) : ""\n    }\n', to: "" }],
  },
  "src-qualified-base-class-keeps-package": {
    what: "SOURCE: publish the base class with its package qualifier attached, so the endpoint is the string `pkgA::AC`, which is the name of no symbol in any file",
    edits: [{ from: '      const rhs = node.childForFieldName("rhs")\n      return rhs ? this.unquoteIdentifier(rhs.text) : ""', to: '      const lhs = node.childForFieldName("lhs")\n      const rhs = node.childForFieldName("rhs")\n      return lhs && rhs ? `${this.unquoteIdentifier(lhs.text)}::${this.unquoteIdentifier(rhs.text)}` : ""' }],
  },
  "src-namespace-drops-dependson": {
    what: "SOURCE: revert the `references` edge beside the `imports` edge for `::`/`:::` access — the pre-F21 state, and the asymmetry that held `references` recall at 16.9%. A namespace access is a hard dependency (R must load the namespace to evaluate it) and `src/ast/types.ts:72` makes `references` the dependsOn type, so dropping the second label makes `dplyr::filter` invisible to every consumer that reads dependsOn edges. F21 exists to pin the pair",
    edits: [{
      from: "        this.pushRel(relationships, \"global\", this.unquoteIdentifier(ns.text), ASTEngine.RelationshipType.References, 1.0, {\n          rSpecific: true,\n          relationshipSubType: \"namespace_access\",\n          accessOperator: op,\n        }, ns)",
      to: "        // mutant: the `references` edge beside the `imports` edge is deleted",
    }],
  },
  "src-namespace-target-is-the-function": {
    what: "SOURCE: publish the EXPORTED NAME as the namespace target instead of the package, so `dplyr::filter` asserts that a package called `filter` exists. F21 forbids exactly this and the confidence stays 1.0, so nothing else in the result would reveal it",
    edits: [{
      from: "        this.pushRel(relationships, \"global\", this.unquoteIdentifier(ns.text), ASTEngine.RelationshipType.Imports, 1.0, {\n          rSpecific: true,\n          relationshipSubType: \"namespace_access\",\n          accessOperator: op,\n        }, ns)",
      to: "        const rhsName = fnNode.childForFieldName(\"rhs\")\n        const exported = rhsName ? this.unquoteIdentifier(rhsName.text) : \"\"\n        this.pushRel(relationships, \"global\", exported, ASTEngine.RelationshipType.Imports, 1.0, {\n          rSpecific: true,\n          relationshipSubType: \"namespace_access\",\n          accessOperator: op,\n        }, ns)",
    }],
  },
}

const runFixture = async (base: string, mutant?: { kind: "output"; apply: (rels: Rel[]) => Rel[] } | { kind: "source"; from: string; to: string }) => {
  const exp = JSON.parse(fs.readFileSync(path.join(DIR, `${base}.expectation.json`), "utf8"))
  const srcPath = path.join(DIR, `${base}.R`)
  const result: any = await parseFile(srcPath, DIR)
  // The per-file unit, for the `knownProductionLoss` assertions only. It is NOT the
  // thing under test — `parseFile` above is — and using it as the oracle would make
  // the check compare a result with itself.
  const raw: any = await (async () => {
    const { RealRAnalyzer } = await import("../../../../src/ast/real-r-analyzer")
    const wts: any = await import("web-tree-sitter")
    const P = wts.Parser ?? wts.default
    const L = wts.Language ?? wts.default?.Language
    await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
    const p = new P()
    p.setLanguage(await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-r.wasm"))))
    const text = fs.readFileSync(srcPath, "utf8")
    const t = p.parse(text)
    const out: any = new RealRAnalyzer().analyze(t!.rootNode, text, srcPath)
    t!.delete?.()
    return out
  })()

  let rels: Rel[] = (result.relationships ?? []).map((r: any) => ({
    type: r.type ?? r.relationshipType,
    from: r.source ?? r.from,
    target: r.target ?? r.to,
    confidence: r.confidence,
    metadata: r.metadata,
    line_number: r.line_number,
  }))
  const analyzeRels: Rel[] = (raw?.relationships ?? []).map((r: any) => ({
    type: r.type ?? r.relationshipType,
    from: r.source ?? r.from,
    target: r.target ?? r.to,
    confidence: r.confidence,
    metadata: r.metadata,
    line_number: r.line_number,
  }))
  const syms: Sym[] = result.symbols ?? []
  if (mutant && mutant.kind === "output") rels = mutant.apply(rels)

  const problems: string[] = []

  if (exp.expectNoParseErrors) {
    const wts: any = await import("web-tree-sitter")
    const P = wts.Parser ?? wts.default
    const L = wts.Language ?? wts.default?.Language
    await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
    const parser = new P()
    parser.setLanguage(await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-r.wasm"))))
    const tree = parser.parse(fs.readFileSync(srcPath, "utf8"))
    const bad: string[] = []
    const walk = (n: any) => {
      if (n.type === "ERROR" || n.isMissing) bad.push(`${n.type}@${n.startPosition.row + 1}`)
      for (let i = 0; i < n.childCount; i++) walk(n.child(i))
    }
    walk(tree.rootNode)
    if (bad.length) problems.push(`parse tree carries ERROR/MISSING nodes: ${bad.slice(0, 5).join(", ")} (${bad.length})`)
    tree.delete?.()
  }

  for (const want of exp.expectSymbols ?? []) {
    if (!syms.some((s) => constraintsMatch(s, want))) problems.push(`expected symbol not found: ${JSON.stringify(want)}`)
  }
  for (const want of exp.forbidSymbols ?? []) {
    const hit = syms.find((s) => constraintsMatch(s, want))
    if (hit) problems.push(`forbidden symbol present: ${JSON.stringify(want)}`)
  }
  for (const want of exp.expectRelationships ?? []) {
    if (!rels.some((r) => constraintsMatch(r, want))) {
      problems.push(`expected relationship not found: ${JSON.stringify(want)}; got ${rels.filter((r) => r.type === want.type).map((r) => `${r.from}->${r.target}@${r.confidence}`).join("; ") || "(no edges of that type)"}`)
    }
  }
  for (const want of exp.forbidRelationships ?? []) {
    const hit = rels.find((r) => constraintsMatch(r, want))
    if (hit) problems.push(`forbidden relationship present: ${JSON.stringify(want)} -> found ${hit.type}[${hit.from}->${hit.target}]@${hit.confidence}`)
  }

  // `knownProductionLoss` — an edge the ANALYZER EMITS and production `parseFile`
  // DELETES, with the shared-machinery rule that deletes it named.
  //
  // This section exists because the alternative is a hole with a comment above it. An
  // expectation file that simply omits the edge says nothing; one that pins its
  // absence says something FALSE; and a doc that mentions it is prose nobody checks.
  // So the loss is a three-way assertion: the edge IS in `analyze()`, it is NOT in
  // `parseFile()`, and the `sharedMachineryRef` string is present. When someone fixes
  // the filter, this check FAILS and names the pin that has to move — which is the
  // outcome that keeps the defect from outliving its measurement.
  //
  // `analyze()` is imported here rather than reusing the fixture's own parse, because
  // the whole claim under test is about the DIFFERENCE between the two.
  for (const loss of exp.knownProductionLoss ?? []) {
    const want = loss.relationship ?? {}
    const text = String(loss.sharedMachineryRef ?? "")
    if (!text) problems.push(`knownProductionLoss entry has no sharedMachineryRef: ${JSON.stringify(want)} — an unexplained loss is the defect this section exists to prevent`)
    if (!analyzeRels.some((r) => constraintsMatch(r, want))) {
      problems.push(`knownProductionLoss claims the analyzer emits ${JSON.stringify(want)} but analyze() does not — the entry is stale`)
    }
    if (rels.some((r) => constraintsMatch(r, want))) {
      problems.push(`knownProductionLoss is no longer lost: ${JSON.stringify(want)} now survives parseFile — move it into expectRelationships and delete this entry`)
    }
  }

  // Standing rules the ontology workstream states for every lane, asserted here so
  // the fixture lane is not the only place they are checked.
  for (const r of rels) {
    if (r.from === "unknown" || r.target === "unknown") problems.push(`endpoint equal to the literal "unknown": ${r.type}[${r.from}->${r.target}]`)
    if (!r.from || !r.target) problems.push(`empty endpoint: ${r.type}[${r.from}->${r.target}]`)
  }
  for (const s of syms) {
    if (!s.name) problems.push(`symbol with an empty name (kind ${s.kind})`)
    if (!s.kind || String(s.kind).toLowerCase() === "unknown") problems.push(`symbol with an empty/unknown kind: ${JSON.stringify(s.name)}`)
  }
  return { base, mutant, ok: problems.length === 0, problems, relCount: rels.length, symCount: syms.length }
}

// ------------------------------------------------------------------ run
const bases = (onlyFixture ? [onlyFixture] : fs
  .readdirSync(DIR)
  .filter((f) => f.endsWith(".expectation.json"))
  // suffix stripped by length, not by pattern: this lane carries no regex
  .map((f) => f.slice(0, f.length - ".expectation.json".length))
  .sort())

console.log(`R lane fixtures — production parseFile, ${bases.length} expectation file(s) in validation/m14/fixtures/r`)
let pass = 0
let fail = 0
for (const b of bases) {
  const r = await runFixture(b, onlyMutant ? { kind: "output", apply: OUTPUT_MUTANTS[onlyMutant].apply } : undefined)
  if (r.ok) { pass++; console.log(`  PASS  ${b}  (${r.symCount} symbols, ${r.relCount} relationships)`) }
  else {
    fail++
    console.log(`  FAIL  ${b}`)
    for (const p of r.problems) console.log(`          ${p}`)
  }
}
console.log(`fixtures: ${pass} passed, ${fail} failed`)

if (wantMutants) {
  console.log("")
  const allMutants: { name: string; what: string; source?: { edits: { from: string; to: string }[] } }[] = [
    ...Object.entries(OUTPUT_MUTANTS).map(([name, d]) => ({ name, what: d.what })),
    ...Object.entries(SOURCE_MUTANTS).map(([name, d]) => ({ name, what: d.what, source: { edits: d.edits } })),
  ]
  console.log(`MUTATION — ${allMutants.length} mutants, each in ONE child running all ${bases.length} fixture(s); a mutant no fixture rejects fails this run`)

  // A source mutant rewrites a TRACKED file in place. The guard is BYTE IDENTITY,
  // not `git status`: the exact bytes read at start-up are the exact bytes restored,
  // so an already-dirty file is fine and in fact the normal state while a lane is
  // mid-change — refusing on `git status` would mean a mutant battery could never
  // be run on the change it is meant to test. What must never happen is writing over
  // a file some OTHER process changed in between, so every write re-reads first and
  // refuses when the bytes are not the ones this run captured. An earlier version
  // used `git status --porcelain` and reported all six source mutants as REFUSED
  // during ordinary development, which reads like a weak suite and is not one.
  const ORIGINAL = fs.readFileSync(ANALYZER, "utf8")

  // SELF-HEAL AFTER AN INTERRUPTED RUN. A source mutant is a rewrite of a TRACKED
  // file, and `finally` covers a normal exit and nothing else: this battery was killed
  // by a timeout partway through with 18 fixtures in scope, and the next invocation
  // then reported two fixtures failing against an analyzer that had been left holding
  // `src-overrides-direction` — a red suite describing a mutant, not a defect. The
  // bytes are captured before the first write and restored on the next start, so an
  // interrupted battery costs one run and not the lane's credibility.
  const BACKUP = ANALYZER + ".mutantbak"
  if (fs.existsSync(BACKUP)) {
    fs.writeFileSync(ANALYZER, fs.readFileSync(BACKUP, "utf8"))
    fs.unlinkSync(BACKUP)
    console.log(`recovered ${path.relative(ROOT, ANALYZER)} from an interrupted mutant run before starting`)
  }
  fs.writeFileSync(BACKUP, ORIGINAL)
  const dropBackup = (): void => { try { fs.unlinkSync(BACKUP) } catch { /* already gone */ } }

  const writeMutant = (bytes: string): boolean => {
    if (fs.readFileSync(ANALYZER, "utf8") !== ORIGINAL) return false
    fs.writeFileSync(ANALYZER, bytes)
    return true
  }

  let survivors = 0
  let total = 0
  let harnessFaults = 0
  const SELF = fileURLToPath(import.meta.url)
  for (const m of allMutants) {
    let mutated: string | null = null
    if (m.source) {
      mutated = ORIGINAL
      for (const e of m.source.edits) {
        const occurrences = mutated.split(e.from).length - 1
        if (occurrences !== 1) {
          console.log(`  HARNESS   ${m.name.padEnd(34)} an anchor occurs ${occurrences}x, expected exactly 1 — the mutant would be a NO-OP, and a no-op is a harness fault, not a result`)
          mutated = null
          break
        }
        // a mutant is a deliberate TEXTUAL corruption of the analyzer source, so this
        // is the one place a substring swap is the operation rather than a shortcut
        // around a parse. split/join, not a pattern.
        mutated = mutated.split(e.from).join(e.to)
      }
      if (mutated !== null && mutated === ORIGINAL) {
        console.log(`  HARNESS   ${m.name.padEnd(34)} the edits leave the file byte-identical — a no-op mutant is a harness fault, not a result`)
        mutated = null
      }
      if (mutated === null) {
        harnessFaults++
        total++
        continue
      }
    }
    const hit: string[] = []
    try {
      if (m.source && !writeMutant(mutated!)) {
        console.log(`  HARNESS   ${m.name.padEnd(34)} ${path.relative(ROOT, ANALYZER)} changed underneath this run; writing a mutant over it would discard the change`)
        harnessFaults++
        total++
        continue
      }
      // Each mutant runs in a CHILD PROCESS. A mutated analyzer is a mutated MODULE,
      // and ESM caches modules by resolved URL: re-importing `pool-worker` with a
      // cache-busting query yields a fresh pool-worker whose `import("./real-r-analyzer")`
      // resolves to the URL already in the registry and hands back the PRISTINE class.
      // The first version of this runner did that and every source mutant "passed" by
      // never being loaded. A child process is the only way to be sure.
      // ONE child per mutant, running the WHOLE suite. The rule is "caught when at
      // least one fixture rejects it", so a child per (mutant, fixture) computes the
      // same answer 18 times over -- 234 wasm loads for 13 mutants, over 40 minutes on
      // this corpus. One child runs all 18 fixtures and reports which ones failed.
      total++
      let code = 0
      let out = ""
      try {
        const childArgs = ["--import", "tsx", SELF]
        if (!m.source) childArgs.push("--mutant", m.name)
        out = execFileSync(process.execPath, childArgs, { encoding: "utf8", cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 })
      } catch (e: any) {
        code = typeof e.status === "number" ? e.status : 1
        out = `${e.stdout ?? ""}${e.stderr ?? ""}`
      }

      // THE TAUTOLOGY GUARD, and it is here because the gate was passing for the wrong
      // reason. `caught` used to be `code !== 0`, and that is true for a child that
      // CRASHED on start-up as well as for a child that ran the suite and rejected it.
      // Running this file with `bun run` makes `process.execPath` the bun binary, bun
      // does not accept `--import tsx`, and every child died before printing a word --
      // so all mutant/fixture pairs read `caught` and the run reported "26 caught, 0
      // survived" while having executed nothing. The same run under `npx tsx` reported
      // 12 caught and 14 survived.
      //
      // So a result counts only when the child demonstrably RAN THE SUITE: its banner
      // and its own tally line must both be present. A missing banner is a HARNESS FAULT
      // counted apart from a survivor, because conflating them is what let the
      // tautology through the first time.
      const ranSuite = out.includes("R lane fixtures") && out.includes("fixtures:")
      if (!ranSuite) {
        harnessFaults++
        console.log(`  HARNESS   ${m.name.padEnd(34)} the child never ran the suite (${path.basename(process.execPath)} could not execute \`--import tsx\`). Run this file with \`npx tsx\`.`)
        continue
      }
      const failed = out.split("\n").filter((l) => l.startsWith("  FAIL")).map((l) => l.trim().split(/\s+/)[1]).filter(Boolean)
      for (const b of failed) hit.push(b)
      const caught = hit.length > 0
      const detail = caught ? `${hit.length}/${bases.length} fixture(s) rejected: ${hit.join(", ")}` : `no fixture rejected it (${out.split("\n").find((l) => l.includes("fixtures:"))?.trim() ?? "?"})`
      console.log(`  ${caught ? "caught  " : "SURVIVED"}  ${m.name.padEnd(34)} ${detail}`)
    } finally {
      if (m.source) fs.writeFileSync(ANALYZER, ORIGINAL)
    }
    // A mutant is caught when AT LEAST ONE fixture rejects it. The rule is not "every
    // fixture", because that scores a fixture rather than a mutant: `drop-uses` cannot
    // be caught by a fixture that has no `uses` edge, and calling that a survivor would
    // be a claim about F18 that is not true. A mutant no fixture rejects IS a survivor,
    // and that is the number that says the suite has lost its teeth.
    if (hit.length === 0) survivors++
  }
  if (fs.readFileSync(ANALYZER, "utf8") !== ORIGINAL) {
    console.error(`MUTANT RUN LEFT THE ANALYZER MODIFIED — ${path.relative(ROOT, ANALYZER)} does not match its pre-run bytes`)
    process.exit(4)
  }
  dropBackup()
  console.log(`analyzer restored: ${path.relative(ROOT, ANALYZER)} is byte-identical to its pre-run content`)
  console.log(`mutants: ${total - survivors - harnessFaults} caught by >=1 of ${bases.length} fixture(s), ${survivors} survived by every fixture, ${harnessFaults} harness faults, of ${total} mutants`)
  console.log(`parent runtime: ${path.basename(process.execPath)} — a runtime that cannot execute \`node --import tsx\` makes every child fail and is reported as HARNESS, never as a catch`)
  process.exitCode = fail + survivors + harnessFaults === 0 ? 0 : 1
} else {
  process.exitCode = fail === 0 ? 0 : 1
}
