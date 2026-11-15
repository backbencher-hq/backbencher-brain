/**
 * PROOF RUNNER for `script/m14/toml-ruled.ts` — runs the shared arbiter against
 * this lane's ruling table WITHOUT editing the shared file.
 *
 * ## Why this exists
 *
 * `script/m14/ontology-coverage-gate.ts` is supervisor-owned (lane brief §8) and
 * its `RULED_BY_LANG` is a literal, so the table in `script/m14/toml-ruled.ts`
 * cannot be exercised by running the gate. A table that has never been run is a
 * claim, and this runner is the difference between the two: it copies the gate to
 * /tmp, applies EXACTLY the two lines the supervisor's permanent change needs,
 * plus one more the change also needs (see below), and runs the copy. The patches
 * are printed, so the change can be applied by hand without re-deriving it.
 *
 * ## The three patches, and why the third is not optional
 *
 *   1. `import { TOML_RULED } from "<abs path>"` — the table.
 *   2. `RULED_BY_LANG = { bash: …, json: …, toml: TOML_RULED }` — the map entry.
 *   3. `specPath` points at a TEMP SPEC instead of
 *      `script/m14/spec/toml-completeness.json`.
 *
 * Patch 3 exists because `rulingFor()` reads `dec.resolution`, and 30 of the 38
 * completeness specs in this repo write that field — but toml's spec writes
 * `ruling`, and it carries ONE decision (TOML-D1, about `escape_sequence`) with no
 * ontology ruling at all. So with the real spec the gate would report every ruled
 * row as RULED-UNJUSTIFIED, which is a verdict about the SPEC and not about the
 * table. The temp spec this runner writes carries the nine ontology rulings in the
 * field the gate reads, so the run below measures the TABLE. Writing those nine
 * decisions into the lane's own spec is a two-file change for the owner (the spec,
 * and a regenerated `validation/m14/results/M14.0.SPEC*.json`, because that
 * evidence file lists each lane's `ruledDecisions`) — it is a report item, not a
 * lane edit, because the evidence file is supervisor-owned.
 *
 * ## What it prints
 *
 * The gate's own output and exit code, plus `TOML_OVERRIDES_EXAMINED` so the
 * `overrides` row can be seen to have examined the corpus rather than to be a probe
 * that cannot fire.
 *
 *   npx tsx validation/m14/fixtures/toml/ruled-gate.ts
 */
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { TOML_OVERRIDES_EXAMINED, TOML_RULED } from "../../../../script/m14/toml-ruled"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..")
const GATE = path.join(ROOT, "script/m14/ontology-coverage-gate.ts")
const TABLE = path.join(ROOT, "script/m14/toml-ruled.ts")
const OUT_DIR = "/tmp/opencode/toml-ruled-proof"

// ---------------------------------------------------------------- the temp spec: the nine ontology rulings
//
// Each carries the numbers from validation/m14/fixtures/toml/census.ts (pass 1) and
// pass2-probes.ts (pass 2). `rulingFor` accepts a decision whose `resolution`
// mentions the type and reads as being about the ontology.

const RESOLUTIONS: Record<string, string> = {
  calls: "RULED: the toml analyzer emits no `calls` edge and no callable exists. The corpus yields 20 distinct grammar node types and none is a function definition, method or call; TOML's values are literals. 0 edges, and no branch of the walk can produce one.",
  uses: "RULED: the toml analyzer emits no `uses` edge: no value is computed from another value. 1 key named like an interpolation marker and 366 string values carrying one (155 files), every one of them a template for ANOTHER tool. 0 edges.",
  imports: "RULED: the toml analyzer emits no `imports` edge. TOML v1.0.0 defines no key whose value is read as a file. 216 values name an existing file (68 files) and the 7 naming another .toml are 3 tool-list keys, 4 of which name a target whose module name equals the source's. 0 edges.",
  references:
    "RULED for the `references` type, AND THE ARBITER FALSIFIES IT: the construct is real and resolvable — 167 `version.ref` occurrences in 5 Gradle catalogues, 167 resolving — and this lane still declines it. The reading is Gradle's and Cargo's rather than TOML's; the sibling Cargo construct resolves in the same file on 81 of 1,269 occurrences and is repo-ambiguous on 992, where 75.5% of this lane's edge target names are published by 2+ files of their own repository; and emitting it without an oracle in deriveTomlEdges would create this lane's first DERIVATION finding. The exact rule that would emit it is in docs/analyzers/toml.md.",
  exports: "RULED: the toml analyzer emits no `exports` edge. There is no visibility modifier and no published surface to attach a name to. 144 export-shaped keys (65 files) and 173 build-target sections; the `publish` population is `publish = false` and the `path` population names .rs files, which are not symbols in this graph. 0 edges.",
  extends: "RULED: the toml analyzer emits no `extends` edge. No entity declares that it IS-A another. 13 inheritance-shaped keys in 12 files, 11 of them cargo's `--base` git branch. 0 edges.",
  implements: "RULED: the toml analyzer emits no `implements` edge. No supertype clause exists. 0 keys named implements/implement/iface/interface/contracts in 1,141 files. 0 edges.",
  overrides:
    "RULED: the toml analyzer emits no `overrides` edge. A redeclaration is not an override. 97 redeclarations measured — 96 [[array-of-tables]] headers that TOML APPENDS to, 1 [table] header that TOML v1.0.0 forbids redefining (traefik/docs/content/reference/static-configuration/file.toml:650), 0 duplicate keys in one section — and 0 replacements. 0 edges.",
  instantiates: "RULED: the toml analyzer emits no `instantiates` edge. No constructor call exists. 0 keys named new/instantiate/construct/constructor/factory in 1,141 files. 0 edges.",
}

{
  // The copy runs from /tmp, where there is no package.json saying `type: module`,
  // so tsx would compile it as CommonJS and reject the gate's top-level await.
  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(path.join(OUT_DIR, "package.json"), JSON.stringify({ type: "module" }))
}

{
  const decisions = Object.entries(RESOLUTIONS).map(([type, resolution]) => ({
    id: `TOML-ONTOLOGY-${type.toUpperCase()}`,
    node_type: "(relationship ontology)",
    status: "RULED",
    question: `Should the toml analyzer emit a \`${type}\` relationship, and on what measurement?`,
    resolution,
  }))
  writeFileSync(path.join(OUT_DIR, "toml-completeness.json"), JSON.stringify({ language: "toml", design_decision: { decisions } }, null, 2))
}

// ---------------------------------------------------------------- patch the COPY

const original = readFileSync(GATE, "utf8")
const patches: { find: string; replace: string; note: string }[] = [
  {
    find: 'import { LANGS } from "./differential"',
    replace: `import { LANGS } from "${path.join(ROOT, "script/m14/differential")}"\nimport { TOML_RULED } from "${TABLE}"`,
    note: "patch 1 — the table",
  },
  {
    find: "const RULED_BY_LANG: Record<string, Ruled[]> = { bash: BASH_RULED, json: JSON_RULED }",
    replace: "const RULED_BY_LANG: Record<string, Ruled[]> = { bash: BASH_RULED, json: JSON_RULED, toml: TOML_RULED }",
    note: "patch 2 — the map entry",
  },
  {
    find: 'const specPath = `script/m14/spec/${LANG}-completeness.json`',
    replace: `const specPath = ${JSON.stringify(path.join(OUT_DIR, "toml-completeness.json"))}`,
    note: "patch 3 — the spec the gate reads (toml's own spec writes `ruling`, the gate reads `resolution`, and it carries no ontology decision)",
  },
]

let patched = original
for (const p of patches) {
  if (!patched.includes(p.find)) {
    console.error(`ruled-gate: PATCH DID NOT APPLY — ${p.note}\n  looking for: ${p.find}`)
    process.exit(2)
  }
  patched = patched.replace(p.find, p.replace)
}
// The copy lives outside the repo, so the two source imports it makes relative
// must become absolute. That is a mechanical consequence of running from /tmp, not
// a change in what the gate measures.
patched = patched
  .replace('from "../../src/ast/language-detection"', `from "${path.join(ROOT, "src/ast/language-detection")}"`)
  .replace('from "../../src/ast/pool-worker"', `from "${path.join(ROOT, "src/ast/pool-worker")}"`)
  // The gate's own dynamic `import("web-tree-sitter")` resolves from the importing
  // FILE, and the copy is in /tmp where there is no node_modules — so it becomes an
  // absolute specifier. Without this the run dies with ERR_MODULE_NOT_FOUND after
  // the corpus admit and the whole `observed` phase, which is where the first
  // attempt at this proof ended.
  // A DIRECTORY specifier is not a legal ES module import, so the package's own
  // resolved entry is used. `web-tree-sitter`'s bare specifier resolves to
  // tree-sitter.cjs, which is what the in-repo gates load.
  .replace('await import("web-tree-sitter")', `await import(${JSON.stringify(path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.cjs"))})`)

// Optional patch 4, applied ONLY when BB_TOML_RULED_WORKERS is set. The gate
// admits the corpus through 8 concurrent `parseFile` calls, and this repo's lanes
// run concurrently on one 15 GB machine: at 8 workers the proof run was killed by
// the OOM killer twice (13 of 15 GB already in use by other lanes) with its output
// lost. The patch changes the fan-out and nothing else — the admitted file list,
// the instrument, the verdicts and the exit code are the gate's.
const WORKERS = process.env.BB_TOML_RULED_WORKERS
if (WORKERS) {
  const find = "Array.from({ length: 8 }, () => worker())"
  if (!patched.includes(find)) {
    console.error("ruled-gate: worker patch did not apply")
    process.exit(2)
  }
  patched = patched.replace(find, `Array.from({ length: ${Number(WORKERS)} }, () => worker())`)
  patches.push({ find, replace: `Array.from({ length: ${Number(WORKERS)} }, () => worker())`, note: "patch 4 — corpus fan-out (BB_TOML_RULED_WORKERS), because 8 concurrent parseFile calls were OOM-killed on a saturated box" })
  console.log("")
  console.log("ruled-gate: patch 4 applied (corpus fan-out) — see the note above")
}

const GATE_COPY = path.join(OUT_DIR, "ontology-coverage-gate.toml-proof.ts")
writeFileSync(GATE_COPY, patched)

console.log("ruled-gate: 3 patches applied to a COPY of script/m14/ontology-coverage-gate.ts")
for (const p of patches) {
  console.log(`  ${p.note}`)
  console.log(`    - ${p.find.length > 90 ? `${p.find.slice(0, 90)}…` : p.find}`)
  console.log(`    + ${p.replace.length > 90 ? `${p.replace.slice(0, 90)}…` : p.replace}`)
}
console.log(`  (plus: the copy's two relative src/ imports rewritten to absolute paths, because the copy runs from ${OUT_DIR})`)
console.log(`  shared file on disk: UNTOUCHED — ${path.relative(ROOT, GATE)}`)
console.log("")

// ---------------------------------------------------------------- run it

// `BB_TOML_RULED_SKIP_GATE=1` writes the patched copy and stops. It exists because
// the gate run holds a corpus-wide parse in memory, and this repo's lanes run
// concurrently on one machine: when the box is saturated the child is killed and
// its output is lost with it. With the copy written, the run can be repeated
// directly:
//   npx tsx /tmp/opencode/toml-ruled-proof/ontology-coverage-gate.toml-proof.ts toml
const SKIP_GATE = process.env.BB_TOML_RULED_SKIP_GATE === "1"
if (SKIP_GATE) {
  console.log(`BB_TOML_RULED_SKIP_GATE=1 — patched copy written, gate NOT run.`)
  console.log(`  run it with: npx tsx ${GATE_COPY} toml`)
  console.log("")
}
if (!SKIP_GATE) {
  const started = Date.now()
  let out = ""
  let code = 0
  try {
    out = execFileSync("npx", ["tsx", GATE_COPY, "toml"], { cwd: ROOT, encoding: "utf8", maxBuffer: 512 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] })
  } catch (err: any) {
    out = String(err.stdout ?? "") + String(err.stderr ?? "")
    code = typeof err.status === "number" ? err.status : 1
  }
  process.stdout.write(out)
  console.log("")
  console.log(`exit code ${code}  (${((Date.now() - started) / 1000).toFixed(0)}s)`)
}
console.log("")
console.log("== TOML_OVERRIDES_EXAMINED — what the `overrides` probe walked and why it recorded nothing ==")
for (const [k, v] of Object.entries(TOML_OVERRIDES_EXAMINED)) console.log(`  ${k.padEnd(20)}${v}`)
console.log("  replacements is the number that would make the gate print FALSIFIED for `overrides`.")

// ---------------------------------------------------------------- the table's own B probes, run here
//
// An independent run of the same probes, in THIS process, over the same admission
// rule the gate uses. It cross-checks the gate's rows (the gate counts in its own
// process) and it is where TOML_OVERRIDES_EXAMINED is filled — the child process
// cannot fill a counter in this one.

{
  const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
  const files: string[] = []
  for (const e of readdirSync(CR).sort()) {
    const dir = path.join(CR, e)
    try {
      if (!statSync(dir).isDirectory()) continue
      execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    } catch {
      continue
    }
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
        .split("\0")
        .filter(Boolean)
    } catch {
      continue
    }
    for (const rel of tracked) {
      const abs = path.join(dir, rel)
      try {
        if (statSync(abs).size > 512 * 1024) continue
      } catch {
        continue
      }
      if (detectLanguageFromPath(abs) !== "toml") continue
      files.push(abs)
    }
  }
  const wts: any = await import("web-tree-sitter")
  const WSP = wts.Parser ?? wts.default
  const WSL = wts.Language ?? wts.default?.Language
  await WSP.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const parser = new WSP()
  parser.setLanguage(await WSL.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-toml.wasm"))))
  console.log("")
  console.log(`== the table's instrument-B probes, run over ${files.length} admitted files (this process) ==`)
  for (const entry of TOML_RULED) {
    if (entry.instrument !== "B:parse-tree-count" || !entry.countOnTree) continue
    const hits: string[] = []
    const hitFiles = new Set<string>()
    for (const abs of files) {
      const before = hits.length
      const t = parser.parse(readFileSync(abs, "utf8"))
      if (t) {
        entry.countOnTree(t.rootNode, path.relative(CR, abs), hits)
        t.delete?.()
      }
      if (hits.length > before) hitFiles.add(abs)
    }
    console.log(`  ${entry.type.padEnd(12)}occurrences=${String(hits.length).padEnd(6)}files=${hitFiles.size}`)
    for (const h of hits.slice(0, 3)) console.log(`      ${h}`)
  }
  console.log("")
  console.log("== TOML_OVERRIDES_EXAMINED, after the probe above ==")
  for (const [k, v] of Object.entries(TOML_OVERRIDES_EXAMINED)) console.log(`  ${k.padEnd(20)}${v}`)
}