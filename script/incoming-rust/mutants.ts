/**
 * RUST LANE MUTANTS — lane INCOMING_RUST.
 *
 * WHY THIS FILE EXISTS RATHER THAN AN ENTRY IN `script/m14/mutate-analyzer.ts`.
 * That file is MASTER-owned (`ONTOLOGY-WORKSTREAM.md`, ownership table), so the
 * entries are REPORTED, not written here. What is written here is the instrument
 * that proves each of them DIES, because "a fixture asserts the new behaviour"
 * and "a deliberately broken analyzer FAILS that fixture" are different claims
 * and only the second is a gate. `script/cpp-review/mutants.ts` is the precedent
 * for this exact shape, and this file borrows its structure deliberately — a
 * second lane writing a second shape would be two answers about how a mutant is
 * measured.
 *
 * It imports `runLang` from the SHARED fixture runner, so the expectations
 * evaluated are the canonical ones. A lane-owned matcher would be a second
 * answer about what a fixture means, which is the failure mode
 * `script/m14/oracles/rust-contains.ts` exists to prevent.
 *
 *   npx tsx script/incoming-rust/mutants.ts
 *   BB_MUTANT_ONLY="rust/incoming-" npx tsx script/incoming-rust/mutants.ts
 *
 * `CAUGHT` means the mutated analyzer breaks at least one fixture that passed
 * clean. `SURVIVED` means it did not, and this file EXITS NON-ZERO on any
 * survivor — a survivor is a fixture that documents behaviour without gating it.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { runLang } from "../m14/run-fixtures"

interface Mutant {
  id: string
  defectClass: string
  description: string
  /** Exact string replacements on the analyzer source. An anchor that is absent
   *  FAILS the mutant rather than passing it silently — the same discipline the
   *  shared harness applies to a mutant id that matches nothing. */
  sourceEdits: Array<{ find: string; replace: string }>
}

const MUTANTS: Mutant[] = [
  {
    id: "rust/incoming-imports-kind-downgraded",
    defectClass: "relationship-mislabel",
    description:
      "The `imports` edge goes back to being no edge at all — the pre-round state, where a `use` declaration produced only an ImportInfo row and `bb_graph`'s file-level reader (which filters relationship_type IN ('imports','exports')) could not see it. Caught by rust/module-surface, whose eight positive `imports` rows all fail. The kind is asserted directly because a relabel is invisible to a payload assertion and to a symbol count: that is the whole reason the edge existed.",
    sourceEdits: [
      {
        find: "            type: ASTEngine.RelationshipType.Imports,\n            confidence: 1.0,",
        replace: "            type: ASTEngine.RelationshipType.Contains,\n            confidence: 1.0,",
      },
    ],
  },
  {
    id: "rust/incoming-imports-tier-wrong",
    defectClass: "evidence-class",
    description:
      "The `imports` evidence tier loses its arm, so a module dependency falls through the shared fallback to `usage_contextual` — the tier for a contextual usage, which says nothing about a module. Caught by rust/module-surface, which pins `meta.evidenceClass: import_based` on a `std::io` row. A tier is not cosmetic: `src/ast/graph.ts` and the LSP file-level reader both select on it.",
    sourceEdits: [
      {
        find: '      if (t === "imports") { md.evidenceClass = "import_based"; continue }\n',
        replace: "",
      },
    ],
  },
  {
    id: "rust/incoming-imports-leaf-as-dependency",
    defectClass: "target-resolution",
    description:
      "A path's LEAF becomes the dependency again: `use crate::flags::Flag` targets `crate::flags::Flag`, `use std::collections::HashMap` targets `std::collections::HashMap`. This is the c/#924 shape in reverse — a target that is a name-plus-path rather than a name — and it is invisible to a count because the row count is identical. Caught by rust/module-surface's positive pins on `crate::flags` / `std::collections` AND by its forbids on the two full paths, which is why both directions are asserted.",
    sourceEdits: [
      {
        find: "    const splitLeaf = (full: string): { module: string; item: string } => {\n      const parts = full.split(\"::\")\n      if (parts.length < 2) return { module: full, item: full }\n      return { module: parts.slice(0, -1).join(\"::\"), item: parts[parts.length - 1] }\n    }",
        replace: "    const splitLeaf = (full: string): { module: string; item: string } => {\n      return { module: full, item: full }\n    }",
      },
    ],
  },
  {
    id: "rust/incoming-imports-nested-group-dropped",
    defectClass: "relationship-loss",
    description:
      "A NESTED group stops contributing its own dependency, so `use std::{env, path::PathBuf}` depends on `std` and not on `std::path`. The row count drops by exactly one per nested group and nothing else notices. Caught by rust/module-surface's `std::path` pin with `meta.moduleKind: nested_group`.",
    sourceEdits: [
      {
        find: '            if (module && module !== base) {\n              out.push({ module: `${base}::${module}`, items: [], line: this.nodeLine(leaf), kind: "nested_group" })\n            }',
        replace: '            if (module && module !== base && false) {\n              out.push({ module: `${base}::${module}`, items: [], line: this.nodeLine(leaf), kind: "nested_group" })\n            }',
      },
    ],
  },
  {
    id: "rust/incoming-imports-source-forgets-module",
    defectClass: "endpoint-resolution",
    description:
      "An `imports` SOURCE stops being the enclosing inline module and is always `global`, so a `use` inside `mod scoped` is attributed to the file. The target is untouched, so every positive pin that does not name a source still matches — only the `from: scoped` row fails. That is the shape of this defect class in general: a wrong endpoint on one side is invisible until something pins that side, which is why the fixture pins `from` explicitly on one row of each kind.",
    sourceEdits: [
      {
        find: '        const source = mods.length > 0 ? mods[mods.length - 1] : "global"',
        replace: '        const source = "global"',
      },
    ],
  },
  {
    id: "rust/incoming-exports-unresolvable-target-published",
    defectClass: "fabricated-endpoint",
    description:
      "The `exports` gate is removed, so a `pub use` of an IMPORTED name publishes `exports -> Flag` — a target this file does not declare and no index can join. This is the R7/R10 class the INCOMING lane exists to prevent, and it is the direction that costs correctness rather than recall: bb_graph, bb_impact and bb_migrate all repeat whatever the row says. Caught by rust/module-surface's `forbidRelationships` on `Flag`. A mutant that only removed the gate would be caught; this one also keeps the row count plausible, which is the point.",
    sourceEdits: [
      {
        find: "    const importableUnits = new Set<string>()\n    for (const s of ctx.symbols) if (s.name && !s.ownerName) importableUnits.add(s.name)",
        replace: "    const importableUnits = new Set<string>()\n    for (const s of ctx.symbols) if (s.name && !s.ownerName) importableUnits.add(s.name)\n    for (const im of ctx.imports) for (const it of im.items ?? []) importableUnits.add(String(it))",
      },
    ],
  },
  {
    id: "rust/incoming-exports-member-as-unit",
    defectClass: "endpoint-resolution",
    description:
      "ONE decision, reverted at both of the places it lives: \"a `pub` member is an importable unit\". The export LIST gate (`!parent` in handleFunction/handleMod/handleStruct) admits `pub fn nested` inside `pub mod inner`, and the `exports` RELATIONSHIP gate admits any symbol name. Both are the same ruling and are mutated together — mutating only the relationship gate was tried first and is a NO-OP, because the relationship gate can only publish a name the list already carries, so that version of the mutant measured a dead branch rather than the defect. The count goes UP, which is the direction a coverage-style assertion cannot see; what catches it is the M49 top-level-resolvability invariant in the shared runner plus the fixture's `forbidRelationships` on `nested`.",
    sourceEdits: [
      {
        find: "    for (const s of ctx.symbols) if (s.name && !s.ownerName) importableUnits.add(s.name)",
        replace: "    for (const s of ctx.symbols) if (s.name) importableUnits.add(s.name)",
      },
      {
        find: "    if (this.isUnrestrictedPublic(node) && !isMethod && !parent) {",
        replace: "    if (this.isUnrestrictedPublic(node) && !isMethod) {",
      },
    ],
  },
  {
    id: "rust/incoming-overrides-added-method-forged",
    defectClass: "fabricated-edge",
    description:
      "The `declared.has(m)` guard is removed, so an impl method the trait does NOT declare is published as `overrides` — `Widget.only_in_impl -> Local.only_in_impl` in the fixture. Every override row the file produces is now a claim about a method that does not exist above it. This is the direction that poisons the graph, and it is why the fixture forbids the row by SOURCE rather than by count: a count assertion cannot tell a forged row from a real one.",
    sourceEdits: [
      {
        find: "        if (declared && !declared.has(m)) continue",
        replace: "        if (declared && !declared.has(m) && false) continue",
      },
    ],
  },
  {
    id: "rust/incoming-overrides-inherent-impl-forged",
    defectClass: "fabricated-edge",
    description:
      "An INHERENT impl is treated as an override: the `traitNode` requirement is relaxed, so `impl Widget { fn inherent }` publishes `overrides` with an empty trait and the target becomes `.inherent`. A name-based rule cannot see the `for` clause, and this is exactly what it produces. Caught by rust/trait-override's forbid on `Widget.inherent`.",
    sourceEdits: [
      {
        find: "        if (!traitNode || !typeNode) { /* inherent impl: no override, see the header */ }",
        replace: "        if (!typeNode) { continue }",
      },
    ],
  },
  {
    id: "rust/incoming-overrides-target-unqualified",
    defectClass: "endpoint-resolution",
    description:
      "The `overrides` TARGET loses its owner qualification and becomes the bare method name, so `Widget.handle -> handle` instead of `-> Local.handle`. Both endpoints still resolve to something, which is why a resolution check passes — but a bare method name does not say WHICH type's, and the store's dotted-target strategy (the only one that resolves a member at all when the name is not project-unique) no longer applies. Caught by rust/trait-override's forbid on `target: handle`.",
    sourceEdits: [
      {
        find: "          source: `${impl.type}.${m}`,\n          target: `${impl.trait}.${m}`,",
        replace: "          source: `${impl.type}.${m}`,\n          target: `${m}`,",
      },
    ],
  },
  {
    id: "rust/incoming-overrides-default-body-method-dropped",
    defectClass: "relationship-loss",
    description:
      "A trait method with a DEFAULT BODY stops counting as a declaration, so `impl Widget { fn with_default }` publishes nothing. This is the recall direction and it is invisible to a count of impl blocks: the file still has two trait impls. It is caught only because the fixture pins the method by name and the analyzer counts `function_item` inside a trait body as well as `function_signature_item`.",
    sourceEdits: [
      {
        find: '              if (f?.type === "function_signature_item" || f?.type === "function_item") {\n                const mn = f.childForFieldName("name")?.text',
        replace: '              if (f?.type === "function_signature_item") {\n                const mn = f.childForFieldName("name")?.text',
      },
    ],
  },
  {
    id: "rust/incoming-calls-confidence-dropped",
    defectClass: "missing-field",
    description:
      "The `calls` edge loses its `confidence` field — the exact pre-round state, where 17,083 of 17,083 rows on this lane's corpus read `undefined`. Nothing turned red at the time because `classifyEvidenceTier` defaults a missing value to 1, so the evidence tier looked right, and because no fixture asserted confidence on a calls row. Caught by rust/trait-override's `confidenceMin: 1` pin on a `calls` row, which exists because this mutant class was found by inspection rather than by a failing suite.",
    sourceEdits: [
      {
        find: "      // lane's own relationship table already claimed.\n      confidence: 1.0,",
        replace: "      // lane's own relationship table already claimed.",
      },
    ],
  },
  {
    id: "rust/incoming-pub-use-path-as-export-name",
    defectClass: "fabricated-endpoint",
    description:
      "The pre-round `pub use` export row comes back: the export name is the module PATH rather than the name it re-binds, so `pub use crate::flags::Flag;` publishes an export named `crate::flags::Flag`. The M49 export invariant (every export name resolves to a TOP-LEVEL symbol) is the guard, and it is a guard the lane did not have until this fixture existed: `construction-exports` pins `pub use` only INSIDE a private `mod`, where the `!parent` gate suppressed the row entirely.",
    sourceEdits: [
      {
        find: "            for (const item of reExports) {\n              publishExport(exportSource, item, row.line, \"re_export\", \"symbol\")",
        replace: "            for (const item of reExports) {\n              publishExport(exportSource, row.module, row.line, \"re_export\", \"symbol\")",
      },
    ],
  },
]

// ── run ─────────────────────────────────────────────────────────────────────
const filter = process.env.BB_MUTANT_ONLY
const selected = filter
  ? MUTANTS.filter((m) => (filter.endsWith("/") ? m.id.startsWith(filter) : m.id === filter))
  : MUTANTS
if (selected.length === 0) {
  console.error(`BB_MUTANT_ONLY="${filter}" matched 0 of ${MUTANTS.length} lane mutants — nothing was verified`)
  process.exit(3)
}

const base = await runLang("rust")
console.log(`clean run: ${base.pass} pass, ${base.fail} fail\n`)
if (base.fail !== 0) {
  console.error("the clean run is already red, so 'caught' cannot mean anything on this run — fix the fixtures first")
  process.exit(2)
}

const ANALYZER = resolve(process.cwd(), "src/ast/real-rust-analyzer.ts")
const ORIGINAL = readFileSync(ANALYZER, "utf8")
const rows: Array<{ id: string; caught: boolean; detail: string }> = []

for (const m of selected) {
  let caught = false
  let detail = ""
  try {
    let src = ORIGINAL
    for (const e of m.sourceEdits) {
      if (!src.includes(e.find)) throw new Error(`anchor text not found - ${JSON.stringify(e.find.slice(0, 90))}`)
      src = src.replace(e.find, e.replace)
    }
    if (src === ORIGINAL) throw new Error("no source edit applied - it would be a no-op that 'passes'")
    // The analyzer file is rewritten and the fixture runner runs in a FRESH
    // process, so neither the module cache nor an already-imported class can
    // hand back the clean copy. The original is restored in `finally`, so a
    // throw cannot leave the working tree with a mutant in it.
    writeFileSync(ANALYZER, src)
    const child = Bun.spawnSync({
      cmd: [process.execPath, "run", resolve(process.cwd(), "script/m14/run-fixtures.ts"), "--lang", "rust"],
      env: { ...process.env, BB_M14_ROOT: process.cwd() },
      stdout: "pipe",
      stderr: "pipe",
    })
    const out = new TextDecoder().decode(child.stdout)
    const err = new TextDecoder().decode(child.stderr)
    // A child that never printed a summary is not "0 failures" — it is a run
    // that died, which this harness's first version reported as a SURVIVOR.
    // That is the worst possible reading of a broken analyzer. A crashing
    // mutant is CAUGHT, loudly.
    if (!/"fail":\s*\d+/.test(out)) {
      caught = true
      detail = `the mutated analyzer took the fixture run down (exit ${child.exitCode}); stderr: ${err.trim().split("\n").slice(-2).join(" | ").slice(0, 200)}`
    } else {
      const fails = Number((out.match(/"fail":\s*(\d+)/) ?? [])[1] ?? "0")
      const names = [...out.matchAll(/^FAIL\s+(\S+)/gm)].map((x) => x[1])
      caught = fails > base.fail
      detail = `${base.fail} -> ${fails} fixture failures${names.length ? "; new failures: " + names.join(", ") : ""}`
    }
  } catch (e: any) {
    caught = false
    detail = `the mutant could not be applied: ${e?.message ?? e}`
  } finally {
    if (existsSync(ANALYZER)) writeFileSync(ANALYZER, ORIGINAL)
    rmSync(ANALYZER + ".rust-mutant-backup", { force: true })
  }
  rows.push({ id: m.id, caught, detail })
  console.log(`${caught ? "CAUGHT" : "SURVIVED"}  ${m.id}  (${detail})`)
}

const survivors = rows.filter((r) => !r.caught)
console.log("-".repeat(100))
console.log(`lane mutants: ${rows.length - survivors.length}/${rows.length} caught`)
if (survivors.length) {
  console.log(`\nSURVIVORS: ${survivors.map((s) => s.id).join(", ")}`)
  console.log("a survivor is a fixture that documents a behaviour without gating it")
}
process.exit(survivors.length ? 1 : 0)
