/**
 * INCOMING_RUST source-level mutants — LANE-OWNED proof that the new
 * `instantiates` rule is testable, not merely asserted.
 *
 * WHY THIS FILE EXISTS
 *
 * `script/m14/mutate-analyzer.ts` is the shared mutation harness and is the
 * master's file: it mutates ANALYZER RESULTS, and a mutant that cannot be
 * expressed as a transform over a result has nowhere to live there. This lane's
 * new behaviour is a rule in the source — a bare callee is publishable when the
 * file declares a TUPLE SHAPE of that name VISIBLE where the call is written —
 * so its failure modes are source-level: drop the shape record, restore the
 * blanket ban, restore the pre-D30 rule, drop the visibility condition. Each is
 * a one-line edit with a distinct expected casualty, and without them the fixture
 * could pass for reasons that have nothing to do with the rule.
 *
 * TWO OF THE RULE'S GUARDS ARE NOT PINNABLE BY THIS FIXTURE, and the battery
 * says so rather than pretending otherwise:
 *
 *   the `inFile` kind filter (Struct/Enum/Type/Impl) — a bare callee naming
 *     something in-file that is not callable that way does not compile in Rust
 *     (`struct Unit;` then `Unit()` is an error), so no valid-Rust fixture can
 *     falsify a mutant that widens it. Its casualty would be the FOREIGN and
 *     same-named-FUNCTION forbid rows, which that filter already catches.
 *   the shape condition's own drop half, for the same reason.
 *
 * Both are recorded in the lane doc as declared boundaries with the reason, not
 * as coverage.
 *
 * So this harness edits the analyzer source in place, runs the lane's fixture
 * suite against it through the shared runner, records which fixtures died, and
 * RESTORES the file. A mutant that no fixture catches is a SURVIVOR and fails
 * the run — a check nobody watched fail is a claim.
 *
 * Safety: the original bytes are read once, every mutant is applied to that
 * original (never to another mutant's output), and the restore is in a
 * `finally`. The last thing the script does is compare the file on disk with
 * the bytes it started from and refuse to exit 0 if they differ.
 *
 * NO REGEX. Anchors are exact source substrings, located with `indexOf`; a
 * mutation that cannot find its anchor fails loudly rather than silently
 * becoming a no-op — which is the failure mode that leaves a suite green
 * because the defect was never injected.
 *
 * Usage: bun script/lanes/incoming-rust/mutants.ts
 */
import { readFileSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import * as path from "node:path"

const REPO_ROOT = path.resolve(path.join(import.meta.dir, "..", "..", ".."))
const ANALYZER = path.join(REPO_ROOT, "src", "ast", "real-rust-analyzer.ts")
const RUNNER = path.join(REPO_ROOT, "script", "m14", "run-fixtures.ts")

const original = readFileSync(ANALYZER, "utf8")

interface Mutant {
  id: string
  /** Every edit is an exact-source replacement. An anchor's ABSENCE is a hard
   *  error: a mutation that cannot find it injects nothing and reports a pass.
   *  A list, because several of the realistic wrong implementations are two
   *  edits in two places — removing a guard AND relaxing the test it guarded. */
  edits: { anchor: string; replacement: string }[]
  defectClass: string
  description: string
  /** A fixture that must fail. Recorded for the report, not enforced by name —
   *  the check is that SOME fixture dies, because a mutant's blast radius is a
   *  property of the suite, not of the author. */
  expectedToKill: string
}

const MUTANTS: Mutant[] = [
  {
    id: "incoming-rust/drop-tuple-shape-record",
    edits: [{ anchor: "    if (tupleStruct) symbol.metadata.tupleStruct = true", replacement: "    // MUTATED: the shape record is gone" }],
    defectClass: "relationship-loss",
    description: "stops recording that a struct is a TUPLE struct, so no bare call can ever be publishable: restores the pre-fix state where `Hasher(Hasher::OFFSET_BASIS)` published `calls` and nothing else",
    expectedToKill: "rust/bare-tuple-constructor",
  },
  {
    id: "incoming-rust/restore-blanket-bare-ban",
    edits: [{ anchor: "        if (cand.bareSpelling) {\n          const owners = tupleConstructible.get(cand.target)\n          if (!owners) continue\n          const here = cand.mods ?? []\n          const visible = owners.some((o) => {\n            if (o === \"\" || o === undefined) return true\n            return here.indexOf(o) >= 0\n          })\n          if (!visible) continue\n        }", replacement: "        if (cand.bareSpelling) continue // MUTATED: RUST-D30's blanket ban" }],
    defectClass: "relationship-loss",
    description: "reverts to RUST-D30's blanket ban on every bare single-segment callee — the rule that cost 46 decidable constructions on ripgrep and 13 MISSING rows on the F5 draw",
    expectedToKill: "rust/bare-tuple-constructor",
  },
  {
    id: "incoming-rust/restore-pre-d30-in-file-name",
    edits: [{ anchor: "        if (cand.bareSpelling) {\n          const owners = tupleConstructible.get(cand.target)\n          if (!owners) continue", replacement: "        if (false) {\n          const owners = tupleConstructible.get(cand.target)\n          if (!owners) continue" }],
    defectClass: "relationship-fabrication",
    description: "restores the pre-D30 rule — any in-file type name a bare callee names is a construction — which is the defect the ban was written for and the one the visibility condition now rules out with a reason",
    expectedToKill: "rust/bare-tuple-constructor",
  },
  {
    id: "incoming-rust/drop-visibility-condition",
    edits: [{ anchor: "          if (!visible) continue\n", replacement: "          // MUTATED: visibility is not checked — every module's tuple shape is treated as in scope\n" }],
    defectClass: "relationship-fabrication",
    description: "keeps the shape condition and drops module scoping, so `Ok(1u32)` outside the module that declares `struct Ok(u32)` reads as a construction of it. The decisive casualty: the prelude spelling in a sibling module.",
    expectedToKill: "rust/bare-tuple-constructor",
  },
  {
    id: "incoming-rust/drop-call-site-mods",
    edits: [{ anchor: "        ...(bareSpelling ? { mods: this.enclosingMods(node) } : {}),", replacement: "        // MUTATED: the call site's module chain is never recorded" }],
    defectClass: "relationship-loss",
    description: "stops recording where the call is written, so every bare candidate looks like it sits at file scope and the module-scoped half of the rule cannot decide anything",
    expectedToKill: "rust/bare-tuple-constructor",
  },

  // ---------------------------------------------------------------- overrides
  {
    id: "incoming-rust/overrides-dropped",
    edits: [{ anchor: "    this.extractRustTraitImplOverrides(rootNode, ctx)", replacement: "    // MUTATED: the overrides pass never runs" }],
    defectClass: "relationship-loss",
    description: "restores the pre-fix state, where the type was a GAP: 48 in-file trait method implementations over 3 ripgrep files published nothing",
    expectedToKill: "rust/trait-impl-overrides",
  },
  {
    id: "incoming-rust/overrides-accepts-foreign-traits",
    edits: [
      {
        anchor: "      const decl = traitMethods.get(imp.traitLeaf)\n      if (!decl) continue",
        replacement: "      const declared = traitMethods.get(imp.traitLeaf)\n      const decl = declared ?? { methods: new Set<string>(), line: new Map<string, number>() }\n      // MUTATED: an undeclared trait no longer stops the pass",
      },
      {
        anchor: "        if (!m || !decl.methods.has(m)) continue",
        replacement: "        if (!m || !(declared ? declared.methods.has(m) : true)) continue // MUTATED: every method of an undeclared trait's impl counts",
      },
    ],
    defectClass: "relationship-fabrication",
    description: "stops requiring the trait to be declared in this file, so `impl std::fmt::Display for Point` publishes an edge whose target names a method no symbol here owns — the unresolvable-endpoint class this lane exists to close",
    expectedToKill: "rust/trait-impl-overrides",
  },
  {
    id: "incoming-rust/overrides-accepts-generic-parameter-types",
    edits: [{
      anchor: "          if (typeLeaf && traitLeaf && !this.implTypeParameters(n).has(typeLeaf)) {",
      replacement: "          if (typeLeaf && traitLeaf) { // MUTATED: a generic parameter is accepted as a type name",
    }],
    defectClass: "relationship-fabrication",
    description: "drops the second endpoint condition, so `impl<'a, M: Matcher> Matcher for &'a M` publishes `M.find_at -> Matcher.find_at` — a locally bound generic parameter named as a type. 32 of the corpus's 48 in-file trait impls are this shape",
    expectedToKill: "rust/trait-impl-overrides",
  },
  {
    id: "incoming-rust/overrides-descends-into-method-bodies",
    edits: [{
      anchor: "      for (const item of directItems(declarationList(imp.body))) {",
      replacement: "      const deep: Node[] = directItems(declarationList(imp.body))\n      for (let k = 0; k < deep.length; k++) for (let j = 0; j < deep[k].namedChildCount; j++) { const c = deep[k].namedChild(j); if (c) deep.push(c) }\n      for (const item of deep) {",
    }],
    defectClass: "relationship-fabrication",
    description: "reads the whole impl subtree instead of its own items, so a local `fn helper` inside a method body that shares a trait method's name reads as an implementation",
    expectedToKill: "rust/trait-impl-overrides",
  },
  {
    id: "incoming-rust/overrides-pairs-any-in-file-trait",
    edits: [
      {
      anchor: "      const decl = traitMethods.get(imp.traitLeaf)\n      if (!decl) continue",
      replacement: "      let decl = traitMethods.get(imp.traitLeaf) // MUTATED: when the impl header names no trait declared here, pair with ANY declared trait that declares one of these method names\n      let paired = imp.traitLeaf\n      if (!decl) {\n        const names = [...new Set(directItems(declarationList(imp.body)).map((it) => methodName(it) ?? \"\").filter(Boolean))]\n        for (const entry of traitMethods.entries()) { if (names.some((nm) => entry[1].methods.has(nm))) { decl = entry[1]; paired = entry[0]; break } }\n      }\n      if (!decl) continue\n      const pairedName = paired",
      },
      {
        anchor: "        const target = `${imp.traitLeaf}.${m}`",
        replacement: "        const target = `${pairedName}.${m}`",
      },
    ],
    defectClass: "relationship-mislabel",
    description: "pairs an impl with ANY declared trait that happens to declare one of its method names, instead of the trait its own header names — the label is still `overrides` and the shape is still Type.method -> Trait.method, so only the TARGET is wrong, which is the mislabelling class a per-label count cannot see",
    expectedToKill: "rust/trait-impl-overrides",
  },
]

interface RunResult { failures: string[]; pass: number; fail: number }

function runFixtures(): RunResult {
  let out = ""
  try {
    out = execFileSync("bun", [RUNNER, "--lang", "rust"], { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })
  } catch (e: any) {
    out = String(e?.stdout ?? "") + String(e?.stderr ?? "")
  }
  const failures: string[] = []
  let pass = 0, fail = 0
  for (const line of out.split("\n")) {
    if (line.startsWith("PASS  rust/")) { pass++; continue }
    if (line.startsWith("FAIL  rust/")) { fail++; failures.push(line.slice("FAIL  ".length).trim()); continue }
  }
  // the runner prints a JSON summary too; prefer it when the lines were not matched
  const at = out.indexOf("summary: ")
  if (at >= 0) {
    const line = out.slice(at + 9).split("\n")[0].trim()
    try {
      const j = JSON.parse(line)
      const r = j?.rust
      if (r && typeof r.pass === "number") { pass = r.pass; fail = r.fail }
    } catch { /* the line-based tally stands */ }
  }
  return { failures, pass, fail }
}

const baseline = runFixtures()
console.log(`incoming-rust source-level mutants`)
console.log(`baseline: ${baseline.pass} fixtures pass, ${baseline.fail} fail`)
if (baseline.fail !== 0) {
  console.error(`\nREFUSING to measure a mutant against a suite that is already failing:`)
  for (const f of baseline.failures) console.error(`  FAIL ${f}`)
  process.exit(3)
}

let survived = 0
try {
  for (const m of MUTANTS) {
    let mutated = original
    let bad = ""
    for (const e of m.edits) {
      const at = mutated.indexOf(e.anchor)
      if (at < 0) { bad = `ANCHOR NOT FOUND: ${JSON.stringify(e.anchor.slice(0, 90))}`; break }
      if (mutated.indexOf(e.anchor, at + 1) >= 0) { bad = `ANCHOR IS NOT UNIQUE: ${JSON.stringify(e.anchor.slice(0, 90))}`; break }
      mutated = mutated.slice(0, at) + e.replacement + mutated.slice(at + e.anchor.length)
    }
    if (bad) {
      console.error(`\n${m.id}: ${bad} — the mutation would inject nothing and report a pass.`)
      survived++
      continue
    }
    writeFileSync(ANALYZER, mutated)
    const r = runFixtures()
    writeFileSync(ANALYZER, original)
    const killed = r.fail > 0
    if (!killed) survived++
    console.log(`${killed ? "CAUGHT " : "SURVIVED"}  ${m.id}`)
    console.log(`   ${m.description}`)
    console.log(`   defectClass=${m.defectClass}  expected killer=${m.expectedToKill}`)
    console.log(`   fixtures: ${r.pass} pass, ${r.fail} fail${r.fail ? ` — ${r.failures.join(", ")}` : ""}`)
  }
} finally {
  writeFileSync(ANALYZER, original)
}

const onDisk = readFileSync(ANALYZER, "utf8")
const restored = onDisk === original
console.log(`\nanalyzer source restored byte-identical: ${restored}`)
if (!restored) {
  console.error("the analyzer on disk differs from the bytes this run started with — restore it from git before trusting anything above")
  process.exit(4)
}
if (survived > 0) {
  console.error(`\n${survived} SURVIVING MUTANT(S) — the suite cannot detect this lane's new behaviour.`)
  process.exit(5)
}
console.log("every mutant was caught by at least one fixture")