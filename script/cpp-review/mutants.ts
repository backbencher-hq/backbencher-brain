/**
 * CPP LANE MUTANTS — the lane's own mutation harness.
 *
 * WHY THIS FILE EXISTS RATHER THAN AN ENTRY IN `script/m14/mutate-analyzer.ts`.
 * That file is MASTER-owned (ONTOLOGY-WORKSTREAM.md, ownership table), and this
 * wave's mutants belong in it permanently — so the entries are REPORTED, not
 * written here. What is written here is the instrument that proves each of them
 * dies, because "a fixture asserts the new behaviour" and "a deliberately broken
 * analyzer FAILS that fixture" are different claims and only the second is a gate.
 * `perf-interleaved.ts` established the precedent for exactly this shape: it
 * materialises a pre-fix arm rather than committing a second copy of the analyzer.
 *
 * It imports `runLang` from the SHARED fixture runner and passes the transform
 * through the same hook the shared mutation harness uses, so the expectations
 * evaluated here are the canonical ones — a lane-owned matcher would be a second
 * answer about what a fixture means, which is the failure mode
 * `cpp-oracle-contract.ts` exists to prevent.
 *
 *   bun run script/cpp-review/mutants.ts            # all
 *   BB_MUTANT_ONLY="cpp/ontology-" bun run script/cpp-review/mutants.ts
 *
 * `CAUGHT` means the mutated output breaks at least one fixture that passed
 * clean. `SURVIVED` means it did not, and this file EXITS NON-ZERO on any
 * survivor — a survivor is a fixture that documents behaviour without gating it.
 */
import { runLang } from "../m14/run-fixtures"

type Rel = Record<string, any>
interface Mutant {
  id: string
  defectClass: string
  /** Which analyzer file to edit, and with what. `edits` are exact string
   *  replacements; a mutant whose anchor text is absent FAILS rather than
   *  passing silently, which is the same discipline the shared harness applies
   *  to a mutant id that matches nothing. */
  description: string
  /** Applied to the RESULT (as in the shared harness), for the defect classes
   *  that are output-shaping. For SOURCE-level defects — a dropped `confidence`,
   *  a widened predicate — use `sourceEdits` and re-import. */
  transform?: (r: any) => any
  sourceEdits?: Array<{ find: string; replace: string }>
}

/** Every mutant here reverts ONE decision made in this wave. */
const MUTANTS: Mutant[] = [
  {
    id: "cpp/ontology-include-kind-downgraded",
    defectClass: "relationship-mislabel",
    description:
      "#910-for-cpp regression: `#include` goes back to `type: references` + metadata.isImport — the exact pre-fix state of this lane. The edge, its target, its line and its metadata are all unchanged, so every assertion that does not look at the KIND still passes and only the forbid rows in cpp/include-kind-imports (plus the corrected pins in seven other fixtures) catch it. That is the point: a relabel is invisible to a payload assertion and to a symbol count, which is why the kind is asserted directly.",
    sourceEdits: [
      {
        find: "type: ASTEngine.RelationshipType.Imports,\n              confidence: 1.0,\n              // M59.A7 (#825), the C lane's rule: the include directive is the",
        replace: "type: ASTEngine.RelationshipType.References,\n              confidence: 1.0,\n              // M59.A7 (#825), the C lane's rule: the include directive is the",
      },
    ],
  },
  {
    id: "cpp/ontology-imports-tier-wrong",
    defectClass: "evidence-class",
    description:
      "The `imports` evidence tier loses its arm, so a module dependency falls through the shared fallback to `usage_contextual` — the tier for a contextual usage, which says nothing about a module. Caught by cpp/include-kind-imports, which pins `meta.evidenceClass: import_based`. A tier is not cosmetic: `src/ast/graph.ts` and the LSP file-level reader both select on it.",
    sourceEdits: [
      {
        find: '      if (t === "imports") { md.evidenceClass = "import_based"; continue }\n',
        replace: "",
      },
    ],
  },
  {
    id: "cpp/ontology-implements-dropped",
    defectClass: "relationship-loss",
    description:
      "`implements` is not emitted at all. Caught by cpp/implements-pure-virtual-interface, whose four positive rows (including the ordering arm) all fail. This is the DIRECTION that costs edges, and the lane's own doctrine notes that a gate which only runs in the under-firing direction proves nothing about the direction that costs symbols — hence cpp/ontology-implements-forged below.",
    sourceEdits: [
      {
        find: "        const pure = classPureVirtuals.get(pend.base)",
        replace: "        if (true) continue\n        const pure = classPureVirtuals.get(pend.base)",
      },
    ],
  },
  {
    id: "cpp/ontology-implements-forged",
    defectClass: "relationship-fabrication",
    description:
      "THE OPPOSITE DIRECTION, and the control that makes the previous mutant mean something: `implements` is emitted for EVERY base, with no purity requirement. Caught by cpp/implements-pure-virtual-interface's four forbid rows — the virtual-with-a-body base, the defaulted-argument base, the member-initializer base, and the self-base. A gate that only ever runs in the under-firing direction proves nothing about the direction that fabricates.",
    sourceEdits: [
      {
        find: "        const pure = classPureVirtuals.get(pend.base)",
        replace: "        const pure = classPureVirtuals.get(pend.base) ?? new Set([\"injected\"])",
      },
    ],
  },
  {
    id: "cpp/ontology-implements-order-dependent",
    defectClass: "relationship-loss",
    description:
      "THE ORDERING MUTANT, and the only one in this file that moves code rather than widening a predicate. `implements` is emitted at the base-clause node instead of after the walk — the shape a reader writes first, because the candidate and the check are in the same place. It keeps every case where the base is declared BEFORE the derived class and loses the ones where it is declared after, because at the moment the base clause is read the pure-virtual registry holds only what has been walked so far. Caught by `ForwardDerived : LaterInterface` in cpp/implements-pure-virtual-interface ALONE: that is the fixture's only pair whose base is declared below it, so the other three positive rows stay green and the fixture cannot be 'caught' by the cases the naive order gets right.",
    sourceEdits: [
      {
        find: "              pendingImplements.push({ derived: name, base: target, line: this.nameLine(typeNode) ?? 1 })",
        replace: '              { const p0 = classPureVirtuals.get(target); if (p0 && p0.size > 0) relationships.push({ source: name, target, type: ASTEngine.RelationshipType.Implements, confidence: 1.0, line_number: this.nameLine(typeNode) ?? 1, metadata: { reasonCode: "pure-virtual-base", pureVirtuals: [...p0], pureVirtualCount: p0.size } }) }',
      },
      { find: "        const pure = classPureVirtuals.get(pend.base)", replace: "        if (true) continue\n        const pure = classPureVirtuals.get(pend.base)" },
    ],
  },
  {
    id: "cpp/ontology-exports-dropped",
    defectClass: "relationship-loss",
    description:
      "`exports` is not emitted at all. Caught by cpp/exports-visibility-attribute's six positive rows, which cover BOTH readable spellings (`__declspec(dllexport)` and `__attribute__((visibility(\"default\")))`), a class, and an `Owner.member` composite.",
    sourceEdits: [
      {
        find: "      for (const pend of pendingExports) {",
        replace: "      for (const pend of []) {",
      },
    ],
  },
  {
    id: "cpp/ontology-exports-dllimport",
    defectClass: "relationship-fabrication",
    description:
      "THE OPPOSITE DIRECTION for `exports`: the OPPOSITE spellings are accepted too — `__declspec(dllimport)` (this unit imports from another module) and `visibility(\"hidden\")` (the opposite of exported). Caught by cpp/exports-visibility-attribute's forbid rows for `from_another_module` and `not_exported`. 2 corpus sites spell `dllimport`, so a rule that took any `ms_declspec_modifier` would manufacture 2 real-looking edges and call them exports.",
    sourceEdits: [
      {
        find: '          if (a?.type === "identifier" && a.text === "dllexport") return "declspec-dllexport"',
        replace: '          if (a?.type === "identifier" && (a.text === "dllexport" || a.text === "dllimport")) return "declspec-dllexport"',
      },
    ],
  },
  {
    id: "cpp/ontology-exports-attribute-text",
    defectClass: "relationship-fabrication",
    description:
      "The visibility check stops being a ROLE walk (a `call_expression` naming `visibility`, with a `default` string argument) and becomes 'the attribute mentions `visibility`' — which is the rule a text scan buys and the reason this lane holds ZERO regexes in its own source (D6). Caught by cpp/exports-visibility-attribute's forbid row for `not_exported`, which is `__attribute__((visibility(\"hidden\")))`: real, well-formed, and the exact opposite of an export. The first version of this mutant accepted ANY `call_expression` and SURVIVED, which was the mutant being wrong rather than the fixture — `exportAttributeSpelling` is only consulted on declaration and class-specifier nodes, so a call to `visibility` buried in a return statement never reaches it. A mutant that cannot be applied is not a gate, and this file said so rather than passing it.",
    sourceEdits: [
      {
        find: '      if (c.type === "attribute_specifier") {',
        replace: '      if (c.type === "attribute_specifier") {\n        if (String(c.text ?? "").includes("visibility")) return "attribute-visibility-default"',
      },
    ],
  },
  {
    id: "cpp/ontology-override-keyword-ignored",
    defectClass: "relationship-confidence",
    description:
      "The `override`/`final` `virtual_specifier` stops being read for resolution, so the edges fall back to the 0.9 `signature-match` inference. Caught by cpp/virtual-override-resolution, which pins `reasonCode: override-keyword+signature-match`, `confidence: 1` and `overrideSpecifier`. The keyword is the author's own assertion and the whole measured gap (735 keyword sites against 185 edges) is about how much of it the resolver was ignoring — a mutant that ignores it again is the pre-fix state by construction.",
    sourceEdits: [
      {
        find: "            const overrideKeyword = this.functionOverrideSpecifier(node)",
        replace: "            const overrideKeyword = null as \"override\" | \"final\" | null",
      },
    ],
  },
  {
    id: "cpp/ontology-override-companion-trusts-names",
    defectClass: "relationship-fabrication",
    description:
      "THE OPPOSITE DIRECTION for the cross-file path, and the PERL-MR15 defect re-created on purpose: the companion's NAME SET is accepted with NO keyword, so a same-name method in a cross-file base produces an `overrides` edge whether or not anything was overridden. Caught by cpp/cross-file-override's forbid row for `ExternalDerived.probe` — which is, in real C++, a TRUE override whose signature matches, so the edge it must NOT get is one a name-only index cannot distinguish from the `tune` HIDE in the same fixture. 75.6% of perl's companion edges were false for exactly this reason.",
    sourceEdits: [
      {
        find: "            } else if (keyword && companion) {",
        replace: "            } else if (companion) {",
      },
    ],
  },
  {
    id: "cpp/ontology-override-context-ignored",
    defectClass: "relationship-loss",
    description:
      "The analyzer stops declaring the engine's FOURTH parameter, so `AnalyzeContext.overrideCompanion` never reaches it again — the python defect `override-context.ts` documents ('the engine's fourth never reached it ... the rule was written, wired to a channel, shipped, and had never run'). Caught by cpp/cross-file-override's cross-file row: `ExternalDerived.step -> ExternalInterface.step` disappears, and the in-file `LocalDerived.act` row stays green, so the fixture cannot be 'caught' by a rule that happens to break the ordinary same-file case.",
    sourceEdits: [
      {
        find: "    context?.overrideCompanion instanceof Map ? context.overrideCompanion : undefined",
        replace: "    undefined as unknown as Map<string, Set<string>> | undefined",
      },
    ],
  },
  {
    id: "cpp/ontology-calls-confidence-dropped",
    defectClass: "payload-loss",
    description:
      "`calls` goes back to publishing NO `confidence` — the exact pre-fix state of this lane, which the census measured at 101,340 rows over 929 corpus files, every one `undefined`, against a documentation table claiming 1.0. Caught by cpp/cross-file-override's `confidenceMin: 1` on the in-file override row and by the `confidence: 1` pins in cpp/implements-pure-virtual-interface and cpp/exports-visibility-attribute. A missing field is invisible from inside the analyzer because `classifyEvidenceTier` defaults it to 1, which is why it took a census rather than a code read.",
    sourceEdits: [
      {
        find: "              confidence: 1.0,\n              // M59.A7 (#825) / M60.P1 (#873): ONE line, ONE base, ONE node.",
        replace: "              // M59.A7 (#825) / M60.P1 (#873): ONE line, ONE base, ONE node.",
      },
    ],
  },
  {
    id: "cpp/ontology-pure-virtual-subtree-scan",
    defectClass: "relationship-fabrication",
    description:
      "The pure-specifier read stops being 'an unnamed `=` DIRECT CHILD of the declaration' and becomes 'a `= 0` anywhere in the declaration's subtree', which is the natural way to write it and wrong in the most expensive direction: `virtual int width(int n = 0)` puts its `=` inside the `parameter_list`, so every virtual with a DEFAULTED ARGUMENT becomes a contract member. Caught by cpp/implements-pure-virtual-interface's forbid row for `UsesDefaulted : Defaulted`.\n\n    The first version of this mutant removed the `function_declarator` requirement instead, and SURVIVED — because that requirement is redundant at this call site: `isPureVirtualDeclaration` is reached only from the class-scope METHOD branch, so a member initializer (`int counter = 0;`) never arrives. That is a real property of the code and is recorded in the fixture's rationale rather than papered over; the honest mutant is the one that bites, and the redundancy is noted where a reader will find it.",
    sourceEdits: [
      {
        find: "    for (let i = 0; i < declaration.childCount; i++) {\n      const c = declaration.child(i)\n      if (!c || c.isNamed || c.type !== \"=\") continue\n      const nxt = declaration.child(i + 1)\n      if (nxt && nxt.type === \"number_literal\" && String(nxt.text ?? \"\").trim() === \"0\") return true\n    }\n    return false",
        replace: "    const scanZero = (n: Node): boolean => {\n      for (let i = 0; i < n.childCount; i++) {\n        const c = n.child(i)\n        if (!c) continue\n        if (!c.isNamed && c.type === \"=\") {\n          const nxt = n.child(i + 1)\n          if (nxt && nxt.type === \"number_literal\" && String(nxt.text ?? \"\").trim() === \"0\") return true\n        }\n        if (scanZero(c)) return true\n      }\n      return false\n    }\n    return scanZero(declaration)",
      },
    ],
  },
  {
    id: "cpp/ontology-exports-attribute-widened",
    defectClass: "relationship-fabrication",
    description:
      "The C++11 `[[...]]` arm stops reading the attribute NAME and accepts ANY attribute, which is the shape a text scan buys. Caught by cpp/exports-cxx11-attribute's four non-export forbids: `[[nodiscard]]`, `[[maybe_unused]]`, `[[noreturn]]`, `[[deprecated]]`. The population is the reason this is the more expensive direction: over the 912 cpp corpus files, 285 of 308 `attribute_declaration` nodes spell `nodiscard`, so a name-blind rule would manufacture an export edge for essentially every annotated declaration in C++ while the true export population in that corpus is 0.",
    sourceEdits: [
      {
        find: '      if (name === "dllexport") return "attribute-dllexport"',
        replace: '      if (name !== null) return "attribute-dllexport"',
      },
    ],
  },
  {
    id: "cpp/ontology-exports-visibility-argument-ignored",
    defectClass: "relationship-fabrication",
    description:
      "The ARGUMENT is no longer compared: any string in the attribute\'s argument_list counts, so `visibility(\"hidden\")` - the exact opposite of exported, and the spelling that HIDES a symbol from the dynamic symbol table - becomes an export. Caught by cpp/exports-cxx11-attribute\'s forbid row for `not_exported_hidden`.\n\n    THE FIRST VERSION OF THIS MUTANT WAS WRONG, and the harness said so rather than the fixture: it removed the NAME test (`if (name !== \"visibility\") continue`) instead of the argument test, and SURVIVED with 0 fixture failures. The reason is a real property of the rule: an attribute with no `argument_list` still fails the next line, so dropping the name check changes nothing for `[[nodiscard]]` - the arm was already gated by the argument node. A mutant that does not remove the predicate it names is not a gate, and this file records the correction instead of the convenient claim.",
    sourceEdits: [
      {
        find: 'if (lit && stripIncludeChars(String(lit.text ?? "")).trim() === "default") return "attribute-visibility-default"',
        replace: 'if (lit) return "attribute-visibility-default"',
      },
    ],
  },
  {
    id: "cpp/ontology-exports-cxx11-dropped",
    defectClass: "relationship-loss",
    description:
      "The `[[...]]` arm is removed altogether, which is the state I inherited: the analyzer read only the two VENDOR KEYWORD spellings, and `src/ast/engine.ts` blanks BOTH of those before the parser sees them, so the production entry delivered 0 `exports` rows over 929 corpus files. Caught by cpp/exports-cxx11-attribute's four positive rows. This is the direction that matters for the verdict - the arm is the only export spelling that reaches production today - and it is invisible to every other cpp fixture, which is why the count was 0 and the type read as ruled.",
    sourceEdits: [
      {
        find: "        const hit = this.attributeRoleExport(c)",
        replace: "        const hit = null as \"attribute-dllexport\" | \"attribute-visibility-default\" | null",
      },
    ],
  },
  {
    id: "cpp/ontology-class-self-call-restored",
    defectClass: "relationship-fabrication",
    description:
      "D25 is reverted: a call at class scope whose callee is the class is published again as `calls C -> C`. Caught by cpp/class-self-call-925's two forbid rows (a plain constructor declaration and one behind a macro-decorated head). Measured before the fix: 82 fabrications over the 912-file corpus, published from 9 files - sysinfo.h:49 and :61, mutex.h:106, perf_counters.h:138 and :154, reporter.h:131 and :189, state.h:172, benchmark_api.h:219.",
    sourceEdits: [
      {
        find: " && !classCallingItself) {",
        replace: " && true) {",
      },
    ],
  },
  {
    id: "cpp/ontology-class-self-call-by-text",
    defectClass: "relationship-loss",
    description:
      "THE OPPOSITE ERROR, and the control that makes the previous mutant mean something: the rule is re-written to key on the CALLEE TEXT instead of the enclosing scope's kind, so `calls run -> run` and `calls descend -> descend` are refused as well. Caught by cpp/class-self-call-925's two control rows. The loss this would cause is measured: 1,373 real recursion rows over the 912-file corpus (923 sourced at a method, 450 at a function), so a rule that cannot tell a class body from a function body discards every one of them. The discriminator that separates the two is `parentContext.kind`, not the spelling - and `Widget fresh;` inside `Widget::make` shows why the text cannot decide it either way.",
    sourceEdits: [
      {
        find: "          const classCallingItself = ownerIsTypeScope && parentContext?.name === targetName",
        replace: "          const classCallingItself = parentContext?.name === targetName",
      },
    ],
  },
  {
    id: "cpp/ontology-reason-code-references-dropped",
    defectClass: "honesty-reason-code",
    description:
      "M14-HONESTY-CONTRACT 4, reverted for one of the two populations the census measured as violating it: the `using`-dependency `references` row loses its `reasonCode` while keeping its 0.9. Measured before the fix: 625 rows at 0.9 and 0 of them carrying a code, out of 929 corpus files. Caught by cpp/reason-code-4's `references` row, which pins `meta.reasonCode: using-dependency-name-only`. A confidence a consumer can bucket but not explain is exactly what that section forbids, and nothing else in the suite asserted it - all 38 pre-existing cpp fixtures passed against the violating analyzer, which is the measurement that produced the fixture.",
    sourceEdits: [
      {
        find: '                  relationshipType: "using_dependency",\n                  reasonCode: "using-dependency-name-only",\n',
        replace: '                  relationshipType: "using_dependency",\n',
      },
    ],
  },
  {
    id: "cpp/ontology-reason-code-uses-dropped",
    defectClass: "honesty-reason-code",
    description:
      "The same revert for the LARGER population: the member-read `uses` row loses its `reasonCode` while keeping its 0.9. Measured before the fix: 3,012 rows across 929 corpus files, none carrying a code - 4.8x the `references` population, so this is the arm that would have been left behind by fixing only the smaller one. Caught by cpp/reason-code-4's `uses readMember -> count` row.",
    sourceEdits: [
      {
        find: '                relationshipType: "field_access",\n                accessedFrom: obj?.text,\n                reasonCode: "member-read-receiver-type-unresolved",\n',
        replace: '                relationshipType: "field_access",\n                accessedFrom: obj?.text,\n',
      },
    ],
  },
  {
    id: "cpp/ontology-override-promoted-without-keyword",
    defectClass: "relationship-confidence",
    description:
      "The signature-match arm publishes 1.0 whether or not the author wrote `override` - the confidence half of the CPPD-R1 problem in the direction that HIDES a guess. A signature match with no keyword is a 0.9 inference, because a same-name/same-parameter coincidence is indistinguishable from a real override on that evidence alone, and 103 corpus rows are exactly that shape. Caught by cpp/reason-code-4's `Silent.sides` row (`confidence: 0.9`), and only by that row: the asserted arm sits at 1.0 either way, so a fixture that checked only the keyword case would pass against this mutant.",
    sourceEdits: [
      {
        find: "                confidence: keyword ? 1.0 : 0.9,",
        replace: "                confidence: 1.0,",
      },
    ],
  },
  {
    id: "cpp/ontology-override-demoted-with-keyword",
    defectClass: "relationship-confidence",
    description:
      "THE OPPOSITE DIRECTION, and the pair that makes the previous mutant mean something: `override`/`final` is read but no longer promotes the edge, so the author's own assertion is published as a 0.9 guess. `void D::m(int) override` is not a shape to be matched - it is the author stating that `m` overrides a base virtual - and demoting it tells a consumer to discount the strongest evidence C++ offers. Caught by cpp/reason-code-4's `Asserted.sides` row (`confidence: 1`, `meta.evidenceClass: structural`), which the 82 corpus rows the census measured at 1.0 with `override-keyword+signature-match` make a population rather than an anecdote.",
    sourceEdits: [
      {
        find: '                confidence: keyword ? 1.0 : 0.9,\n                reasonCode: keyword ? "override-keyword+signature-match" : "signature-match",',
        replace: '                confidence: 0.9,\n                reasonCode: "signature-match",',
      },
    ],
  },
]

// ── run ──────────────────────────────────────────────────────────────────────
const filter = process.env.BB_MUTANT_ONLY
const selected = filter ? MUTANTS.filter((m) => (filter.endsWith("/") ? m.id.startsWith(filter) : m.id === filter)) : MUTANTS
if (selected.length === 0) {
  console.error(`BB_MUTANT_ONLY="${filter}" matched 0 of ${MUTANTS.length} lane mutants — nothing was verified`)
  process.exit(3)
}

const base = await runLang("cpp")
console.log(`clean run: ${base.pass} pass, ${base.fail} fail\n`)
if (base.fail !== 0) {
  console.error("the clean run is already red, so 'caught' cannot mean anything on this run — fix the fixtures first")
  process.exit(2)
}

const { readFileSync, writeFileSync, rmSync, existsSync } = await import("node:fs")
const { join, resolve } = await import("node:path")
const ANALYZER = resolve(process.cwd(), "src/ast/real-cpp-analyzer.ts")
const ORIGINAL = readFileSync(ANALYZER, "utf8")

const rows: Array<{ id: string; caught: boolean; detail: string }> = []
for (const m of selected) {
  let caught = false
  let detail = ""
  const backup = ANALYZER + ".cpp-mutant-backup"
  try {
    let src = ORIGINAL
    for (const e of m.sourceEdits ?? []) {
      if (!src.includes(e.find)) throw new Error(`anchor text not found - ${JSON.stringify(e.find.slice(0, 90))}`)
      src = src.replace(e.find, e.replace)
    }
    if (src === ORIGINAL) throw new Error("no source edit applied - it would be a no-op that 'passes'")
    // The analyzer file is rewritten and the fixture runner is a FRESH PROCESS, so
    // neither the module cache nor an already-imported class can hand back the
    // clean copy. `perf-interleaved.ts` materialises and deletes its pre-fix arm
    // for the same reason; the original is restored in `finally`, so a throw
    // cannot leave the working tree with a mutant in it.
    writeFileSync(backup, ORIGINAL)
    writeFileSync(ANALYZER, src)
    const child = Bun.spawnSync({
      cmd: [process.execPath, "run", resolve(process.cwd(), "script/m14/run-fixtures.ts"), "--lang", "cpp"],
      env: { ...process.env, BB_M14_ROOT: process.cwd() },
      stdout: "pipe",
      stderr: "pipe",
    })
    const out = new TextDecoder().decode(child.stdout)
    const err = new TextDecoder().decode(child.stderr)
    const fails = Number((out.match(/"fail":\s*(\d+)/) ?? [])[1] ?? "0")
    const names = [...out.matchAll(/^FAIL\s+(\S+)/gm)].map((x) => x[1])
    // A child that never printed a summary is not "0 failures" — it is a run that
    // died, which this harness's first version reported as a SURVIVOR. That is
    // the worst possible reading of a broken analyzer, and it was found by
    // running a mutant that threw: a crashing mutant is CAUGHT, loudly.
    if (!/"fail":\s*\d+/.test(out)) {
      caught = true
      detail = `the mutated analyzer took the fixture run down (exit ${child.exitCode}); stderr: ${err.trim().split("\n").slice(-2).join(" | ").slice(0, 200)}`
      rows.push({ id: m.id, caught, detail })
      console.log(`${caught ? "CAUGHT" : "SURVIVED"}  ${m.id}  (${detail})`)
      continue
    }
    caught = fails > base.fail
    detail = `${base.fail} -> ${fails} fixture failures${names.length ? "; new failures: " + names.join(", ") : ""}`
  } catch (e: any) {
    caught = false
    detail = `the mutant could not be applied: ${e?.message ?? e}`
  } finally {
    if (existsSync(backup)) {
      writeFileSync(ANALYZER, ORIGINAL)
      rmSync(backup, { force: true })
    }
  }
  rows.push({ id: m.id, caught, detail })
  console.log(`${caught ? "CAUGHT" : "SURVIVED"}  ${m.id}  (${detail})`)
}
void existsSync

const survivors = rows.filter((r) => !r.caught)
console.log("-".repeat(100))
console.log(`lane mutants: ${rows.length - survivors.length}/${rows.length} caught`)
if (survivors.length) {
  console.log(`\nSURVIVORS: ${survivors.map((s) => s.id).join(", ")}`)
  console.log("a survivor is a fixture that documents a behaviour without gating it")
}
process.exit(survivors.length ? 1 : 0)