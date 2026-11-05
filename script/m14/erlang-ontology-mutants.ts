/**
 * ERLANG ONTOLOGY MUTANTS — the lane's own mutation run for `docs/analyzers/ONTOLOGY-WORKSTREAM.md`
 * JOB 2, plus its self-test.
 *
 *   bun script/m14/erlang-ontology-mutants.ts            run every mutant
 *   bun script/m14/erlang-ontology-mutants.ts --self-test  prove the runner can report a SURVIVOR
 *
 * ## Why this file exists and is not in `script/m14/mutate-analyzer.ts`
 *
 * `mutate-analyzer.ts` is master-owned and is edited by several lanes at once. It already
 * carries 20 erlang mutants, and every one of them guards an EMITTED behaviour. This wave's
 * deliverable is two types the analyzer does NOT emit, so what needs proving is the
 * opposite: that a reader (or a future fixer, or an agent that believes behaviours have
 * inheritance) cannot add an `extends` or `overrides` edge and have the lane stay quiet.
 * A gate nobody can watch go red is a claim rather than a gate, and the workstream's own
 * history — `overrides` absent from bash behind a prose justification for a whole wave — is
 * that claim being believed.
 *
 * Mutants are prefixed by what they defend: `ontology/` for the ten relationship types and
 * what would manufacture an edge the language cannot express, `symbols/` for the lane's
 * symbol-surface defects that a fixture pin from the same wave keeps honest. The second
 * prefix arrived with ER-D44 (2026-10-04), where the previous wave had rationalised a red
 * lane check as "the assertion is too strict" instead of measuring which of the two ends
 * was wrong — and the check was right.
 *
 * Each transform below is a FAITHFUL REPRODUCTION of a reading a reasonable reader would
 * reach for, not an arbitrary corruption. `mutate-analyzer.ts`'s own rule applies and is
 * worth restating: a transform must reproduce one measured pre-fix state off the result's
 * own tables, so that killing it means something specific.
 *
 * ## What a survivor means here
 *
 * A mutant that survives is a FAILURE of this script, not a skipped check. Silence is
 * guilt, and a mutant that nobody watched die is indistinguishable from a mutant the
 * fixture does not reach. `--self-test` runs the same loop with one `expectedCatch`
 * deliberately inverted, and requires the runner to FAIL — so a green run of this file is
 * evidence the loop works, not evidence the mutants die.
 */
import { runLang, getParser } from "./run-fixtures"
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import * as path from "node:path"
import { RealErlangAnalyzer } from "../../src/ast/real-erlang-analyzer"

interface Mutant {
  id: string
  /** What this reproduces, in one sentence. */
  reads: string
  /** The measurement that says the reading is wrong. */
  measured: string
  transform: (r: any) => any
}

/** One edge, with the shape the analyzer emits. */
function rel(source: string, target: string, type: string, metadata: Record<string, any>, line?: number): any {
  return { source, target, type, confidence: 1.0, metadata, ...(line ? { line_number: line } : {}) }
}

/**
 * REMOVED 2026-10-04 — `symbols/local-call-gated-on-bare-name` (ER-D45).
 *
 * It is not deleted for being redundant; it is deleted for being UNFAITHFUL, and the
 * registry's own green tick is what hid that. A result transform can only remove rows, so
 * it cannot reproduce a defect whose symptom is a row that was never produced — and this
 * one is exactly that. The bare-name gate emitted MORE `calls` edges than the arity-exact
 * gate does (`get(D)` beside a local `get/2`), so a faithful reproduction has to ADD an
 * edge the post-fix analyzer correctly withholds, and no result transform can see a site
 * that produced nothing.
 *
 * What it did instead was filter OUT local call edges whose `metadata.callArity` matched
 * no declared arity — a no-op for every correctly-emitted edge, except where the file
 * declares one name at SEVERAL arities and the call uses a declared one:
 * `fold(fun(X, Y) -> X + Y end, 0)` in `erlang/arity-distinct-calls` is arity 2, the
 * file declares `fold/2` AND `fold/3`, so the filter read the arity-3 declaration as a
 * mismatch and deleted a valid edge. The harness then reported
 *
 *     CAUGHT  symbols/local-call-gated-on-bare-name   caught by: erlang/arity-distinct-calls
 *
 * which is indistinguishable, in the output, from a faithful kill. It was caught by a
 * different bug and pinned a different behaviour, while the fixture that DOES pin ER-D45
 * (`erlang/arity-local-resolution`, added by the same wave) was never touched by it.
 * Reverting the gate in the source makes that fixture fail and leaves
 * `arity-distinct-calls` passing — measured, and it is what
 * `script/m14/erlang-source-revert.ts` now asserts on every run.
 *
 * The rule this adds: a mutation harness must be able to tell a faithful kill from a
 * lucky one, and the only way it can is if the mutant states which fixture its defect
 * breaks and the harness checks THAT fixture. `expectFailure` in the source-revert
 * registry is that field.
 */
const MUTANTS: Mutant[] = [
  {
    id: "ontology/overrides-callback-satisfied-in-one-file",
    reads: "A `-callback f/N` that the same file also defines is an override: the contract is overridden by the definition.",
    measured: "33 such sites corpus-wide, and ER-D30 deliberately merges each pair into ONE symbol, so the edge would be `f -> f` — a self-loop carrying no information. (fixture erlang/ontology-no-inheritance: `own/0` at 48 + 59, `needed/1` at 50 + 69.)",
    transform: (r) => {
      const out = { ...r, relationships: [...(r.relationships ?? [])] }
      for (const s of r.symbols ?? []) {
        if (s?.kind !== "function") continue
        if (!(s?.metadata as any)?.isCallback || !(s?.metadata as any)?.definedHere) continue
        const line = (s?.metadata as any)?.definitionLine ?? s?.range?.startLine
        out.relationships.push(rel(String(s.ownerName ?? ""), s.name, "overrides", { evidenceClass: "callback_satisfied_same_file" }, line))
      }
      return out
    },
  },
  {
    id: "ontology/overrides-behaviour-callback-supply",
    reads: "`-behaviour(B)` plus a function whose name matches a callback of B is an override of that callback — the member-level sibling of `implements`, the shape csharp/java/kotlin publish and the shape clojure/haskell publish for a protocol or typeclass.",
    measured: "The construct is REAL and large: 378 `-callback` declarations from 79 modules, 572 `-behaviour` sites, 2,548 callback identities supplied by an implementing module by exact name AND arity. It is still not published, because the cross-file channels this repository ships carry a Set<string> of bare NAMES (src/ast/override-context.ts:85, src/ast/project-index.ts:313) and Erlang's callback identity is name AND arity — a name-only match would publish `code_change/2` as implementing `code_change/3`. Reporting the class is not the same as emitting an edge a reader cannot discount.",
    transform: (r) => {
      const out = { ...r, relationships: [...(r.relationships ?? [])] }
      const behaviours = (r.relationships ?? []).filter((x: any) => String(x.type) === "implements").map((x: any) => String(x.target))
      if (behaviours.length === 0) return out
      for (const s of r.symbols ?? []) {
        if (s?.kind !== "function" || !s?.ownerName) continue
        const line = (s?.metadata as any)?.line ?? s?.range?.startLine
        for (const b of behaviours) out.relationships.push(rel(String(s.ownerName), `${b}.${s.name}`, "overrides", { isBehaviourCallbackSupply: true, evidenceClass: "name_only_match" }, line))
      }
      return out
    },
  },
  {
    id: "ontology/overrides-preprocessor-alternative-body",
    reads: "One (name, arity) written in two `-ifdef`/`-else` branches is a redefinition, and a redefinition replaces the prior one — the Bash instrument, verbatim in intent.",
    measured: "87 such identities corpus-wide, and 0 of them is an unconditional redefinition (Erlang's compiler rejects those as a program). Every one is a mutually exclusive preprocessor branch: exactly one body survives preprocessing and NEITHER replaces the other. The analyzer already publishes the multiplicity as `meta.clauseCount`, so the fact is not lost by declining to publish an edge.",
    transform: (r) => {
      const out = { ...r, relationships: [...(r.relationships ?? [])] }
      for (const s of r.symbols ?? []) {
        if (s?.kind !== "function" || !s?.ownerName) continue
        const cc = (s?.metadata as any)?.clauseCount
        if (typeof cc !== "number" || cc < 2) continue
        out.relationships.push(rel(String(s.ownerName), s.name, "overrides", { evidenceClass: "redefinition" }, (s?.metadata as any)?.line))
      }
      return out
    },
  },
  {
    id: "ontology/extends-from-type-dependency",
    reads: "A type declaration whose body APPLIES another type is a subtype relation, so it is an `extends` edge and not a `references` one.",
    measured: "2,992 such sites in 279 corpus files. In Erlang type syntax a bare unquoted atom is the ATOM LITERAL of that name (`-type day() :: monday | tuesday.` declares two literals) and a map/record field key is a DECLARATION, so an applied name is a type USE. The pre-ER3 rule counted every bare atom and produced 4,043 OTP / 244 rebar3 type-dependency edges whose own site line does not apply the name it cites; after the narrowing both are 0 (validation/m14/results/archive/erlang-er3-corpus-census.json). Relabelling them `extends` would put a fabricated edge on every record field key and every atom literal.",
    transform: (r) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) =>
        String(x.type) === "references" && (x.metadata as any)?.context === "type reference"
          ? { ...x, type: "extends" }
          : x,
      ),
    }),
  },
  {
    id: "ontology/extends-from-include",
    reads: "`-include(\"other.hrl\")` splices another file's declarations into this module, which is inheritance.",
    measured: "It is a TEXTUAL inclusion and since ER-D46 (2026-10-23) the dependency is published as `part_of` — the vocabulary's file-inclusion relation (php's include/require and fsharp's #load took the same relabel) — at the path string's own line, with `metadata.partRole:\"library\"`. Before ER-D46 it was `references`; the label moved because a mention cannot say the file became part of this unit. `contains` does not gain a row either: the included file's declarations belong to the module that textually includes it, and attributing them to the includer would put two owners on one declaration. Publishing it under `extends` would assert an IS-A relation the language does not have — which `erlang/extended-part-of`'s type-only `extends` forbid and `erlang/ontology-no-inheritance` both reject. This mutant survived once the label moved, which is why its filter is the NEW label: a mutant whose filter names a row that no longer exists tests nothing.",
    transform: (r) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) =>
        String(x.type) === "part_of" && (x.metadata as any)?.isFileInclusion
          ? { ...x, type: "extends" }
          : x,
      ),
    }),
  },
  {
    id: "ontology/extends-relabel-implements",
    reads: "`-behaviour(B)` is inheritance in every language that has it, so it is `extends` rather than `implements`.",
    measured: "572 `-behaviour` sites in 550 corpus files. The store carries BOTH labels and other lanes use both for the same file: csharp publishes `extends` for a base CLASS and `implements` for an INTERFACE; go publishes `implements` for `-behaviour` and `extends` for embedded structs. Relabelling erlang's would make the same edge disagree with itself across a graph that already contains both labels.",
    transform: (r) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) => (String(x.type) === "implements" ? { ...x, type: "extends" } : x)),
    }),
  },
  {
    id: "ontology/exports-drop-type-form",
    reads: "`-export_type([t/0])` is an `-export` of a type and can be published under the plain form.",
    measured: "2,182 `-export_type` rows in the 3,939-file census, and OTP keeps two lists because a published TYPE is a different declaration form from a published function. Dropping the form makes a consumer unable to tell `exports -> state` (a type) from `exports -> run` (a function) — the fixture pins both with `meta.exportForm`.",
    transform: (r) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) =>
        String(x.type) === "exports" && (x.metadata as any)?.isTypeExport
          ? { ...x, metadata: { ...(x.metadata ?? {}), exportForm: "export", isTypeExport: false } }
          : x,
      ),
    }),
  },
  {
    id: "ontology/exports-uppercase-name-dropped",
    reads: "ER-D42 regression: an `fa` name must be an `atom`, so `-export([HEAD/1])` — an identifier starting with an uppercase letter, which Erlang types as a VARIABLE — publishes nothing.",
    measured: "Dropping it cost the `exports` class a member with no error and no counter. Found by the exports/imports oracle, which derives the row from the same declaration and reported it MISSING while the analyzer reported nothing at all; pinned by erlang/macros-er3 `-export([run/0, helper/1, HEAD/1])`. `?MODULE` is also a `var` under its `macro_call_expr` and must still resolve to the module (ER-D28), so the two spellings are not interchangeable — a reader that accepts any `var` and expands `MODULE` to the literal text would publish a member named `MODULE`.",
    transform: (r) => ({
      ...r,
      relationships: (r.relationships ?? []).filter((x: any) => !(String(x.type) === "exports" && /^[A-Z]/.test(String(x.target ?? "")))),
    }),
  },
  {
    id: "ontology/exports-same-line-multi-arity-collapsed",
    reads: "ER-D43 regression: one `exports` row per (source, target, line) is enough, so `-export([start/0, start/1, …])` on one line publishes one row.",
    measured: "340 sites in a 204-file corpus draw. The module's public surface was published at half its real size, with no error and no counter — and the lane's own `arity-exports` fixture passed, because it pinned `expectExports` (the ExportInfo array, which recorded both identities) and asserted nothing about the EDGES. A test on the side table is not a test on the product: the store reads `brain_relationship`.",
    transform: (r) => {
      const seen = new Set<string>()
      const kept: any[] = []
      for (const x of r.relationships ?? []) {
        if (String(x.type) !== "exports") { kept.push(x); continue }
        const k = `${x.source}|${x.target}|${x.line_number ?? ""}`
        if (seen.has(k)) continue
        seen.add(k)
        kept.push(x)
      }
      return { ...r, relationships: kept }
    },
  },
  {
    id: "ontology/imports-dropped",
    reads: "ER-D41 regression: `-import(Mod, [f/a])` is a mention, so `references` alone is enough.",
    measured: "`imports` is the one label the module-dependency pass reads — `brain_import` rows, src/intelligence/analysis/dependencies.ts:27-28, relied on PRECISELY because `resolved_symbol_id` is routinely null and only the specifier and `is_external` matter. 19 analyzers emit `imports`; the 300 erlang rows measured here were the fact stored under a label nothing was reading.",
    transform: (r) => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => String(x.type) !== "imports") }),
  },
  {
    id: "symbols/function-range-ends-on-clause",
    reads: "A function symbol's range should end where its `function_clause` ends: `nodeToRange` publishes tree-sitter's EXCLUSIVE end, so the clause's end index excludes the clause-terminating `.` and the slice can only ever be the clause without it. This is the reading the previous wave recorded and shipped — and it is wrong, because it explains the missing character by the wrong mechanism.",
    measured: "On the pinned grammar, `fun_decl` [85,98) and `function_clause` [85,97) for `pick(X) -> X.` — the two nodes differ by exactly the `.`, and `source.slice(startIndex, endIndex)` reproduces whichever node was passed. `nodeToRange` is a verbatim pass-through (`startIndex: node.startIndex, endIndex: node.endIndex`, real-erlang-analyzer.ts), so exclusivity says nothing about WHICH node was chosen. The lane's own `script/m14/verify-erlang-identity.ts` asserted the `fun_decl` text and failed; with the range taken from `fun_decl` it passes with 19/19 mutants caught. Corpus reach: one character off the end of EVERY function symbol in 3,939 files.",
    transform: (r) => {
      const out = { ...r, symbols: [...(r.symbols ?? [])] }
      // Reproduce the pre-ER-D44 range: pull each function's end back to the last
      // character, which is what taking the `function_clause` instead of the `fun_decl`
      // produced on every clause that ends in `.`.
      for (let i = 0; i < out.symbols.length; i++) {
        const s = out.symbols[i]
        if (s?.kind !== "function") continue
        const r0 = s.range
        if (typeof r0.endIndex !== "number" || typeof r0.endColumn !== "number") continue
        const shorter = r0.endColumn > 1 ? { ...r0, endIndex: r0.endIndex - 1, endColumn: r0.endColumn - 1 } : r0
        out.symbols[i] = { ...s, range: shorter }
      }
      return out
    },
  },
]

/**
 * The runner. A mutant "dies" when it makes a fixture FAIL; a mutant that leaves every
 * fixture passing is a SURVIVOR and fails this script.
 */
async function main(): Promise<void> {
  const selfTest = process.argv.includes("--self-test")
  // In `--self-test` one mutant's expectation is INVERTED, so the loop must report it as a
  // survivor. A runner that cannot report a survivor is a runner whose green means nothing.
  const INVERT = selfTest ? 0 : -1
  console.log(`erlang ontology mutants — ${MUTANTS.length} mutants${selfTest ? " (SELF-TEST: expectation for mutant 0 deliberately inverted)" : ""}`)
  console.log("baseline: every fixture passing, measured by the same runner\n")
  const base = await runLang("erlang")
  if (base.fail > 0) {
    console.log(`  BASELINE IS RED (${base.fail} failing fixture(s) before any mutant) — a mutant run on a red baseline proves nothing.`)
    process.exit(1)
  }
  console.log(`  baseline: ${base.pass} passing, ${base.fail} failing\n`)

  const survivors: string[] = []
  const killed: string[] = []
  for (let i = 0; i < MUTANTS.length; i++) {
    const m = MUTANTS[i]!
    // `runLang` expects an ANALYZER-shaped override: it calls `override.analyze(...)`.
    // A bare `{ transform }` is not enough — that threw `analyzer.analyze is not a
    // function` on the first run, which is the same class of mistake as a gate that
    // passes because it never called the thing it was checking.
    const real = new RealErlangAnalyzer()
    const run = await runLang("erlang", {
      analyze: async (...args: any[]) => m.transform(await (real as any).analyze(...args)),
      transform: m.transform,
    })
    const died = run.fail > 0
    // `--self-test` asserts that mutant 0 SURVIVES, i.e. that the loop's verdict is
    // reachable at all. Everything else runs normally.
    const expected = i === INVERT ? !died : died
    if (!expected) survivors.push(m.id)
    else if (i !== INVERT) killed.push(m.id)
    const fixtures = run.details.filter((d: any) => !d.ok).map((d: any) => d.fixture)
    console.log(`  ${expected ? "CAUGHT " : "SURVIVED"} ${m.id}`)
    console.log(`      reads:    ${m.reads}`)
    console.log(`      measured: ${m.measured}`)
    console.log(`      caught by: ${fixtures.length ? fixtures.join(", ") : "(nothing — the fixture does not reach it)"}`)
  }

  console.log(`\n${killed.length}/${MUTANTS.length} CAUGHT, ${survivors.length} survived`)
  const outPath = path.join(process.cwd(), "validation", "m14", "tmp", "erlang-ontology-mutants.json")
  mkdirSync(path.dirname(outPath), { recursive: true })
  writeFileSync(outPath, `${JSON.stringify({
    at: new Date().toISOString(),
    script: "erlang-ontology-mutants",
    selfTest,
    baseline: { pass: base.pass, fail: base.fail },
    total: MUTANTS.length,
    caught: killed.length,
    survivors,
    perMutant: MUTANTS.map((m) => ({ id: m.id, reads: m.reads, measured: m.measured })),
  }, null, 2)}\n`)
  console.log(`artifact: ${outPath}`)
  if (survivors.length) {
    console.log(`\n>>> ${survivors.length} SURVIVOR(S): ${survivors.join(", ")}`)
    console.log(">>> A surviving mutant is a failure of this script, not a skipped check.")
    process.exit(1)
  }
  if (selfTest) {
    console.log("\n>>> SELF-TEST FAILED: the inverted expectation was not reported as a survivor, so this runner cannot detect one.")
    process.exit(1)
  }
  console.log("\nall mutants caught")
}

await main()
