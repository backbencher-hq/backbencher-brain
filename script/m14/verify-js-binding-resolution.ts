/**
 * JS BINDING RESOLUTION — the gate for `src/ast/binding-resolution.ts`.
 *
 * WHAT IT PINS. A bare-name edge target (`parse`, `cubicOut`) is resolved by the name
 * strategies, and the authoritative name pass ALWAYS produces an answer — ranked same-file,
 * then same-language, then lowest id. A same-named symbol in the wrong file therefore looks
 * exactly like the right one, and two of this lane's own instruments can see the population:
 * 2,581 rows on `packages/svelte/src` name a symbol their file IMPORTS from a module that
 * declares it (`script/m14/javascript-import-decidability.ts`).
 *
 * The pass being gated reads the row's own import statement, which is the one piece of
 * evidence that makes a bare leaf exact. Two layers are asserted here, because they fail
 * differently:
 *
 *   A. THE PLANNER, as a pure function — every gate and every refusal, case by case, with
 *      no database and no indexer involved.
 *   B. THE INDEX, end to end — a three-file project with a deliberate DECOY (`other/util.js`
 *      declares the same `parse` the importing file does not import), indexed through
 *      `indexProjectParallel`, read back from sqlite. A pass that is wired but decides
 *      nothing looks identical to a pass that is not wired at all; only B distinguishes
 *      them.
 *
 *   bun run script/m14/verify-js-binding-resolution.ts
 *   exit 0 = every case holds; exit 1 = at least one failed (prints which)
 */
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import {
  planBindingResolutions,
  type BindingIndex,
  type BindingRow,
} from "../../src/ast/binding-resolution"

let failed = 0
// The count is taken from the checks that actually RAN, not from a literal: this gate's
// summary line read "32 of 32" while 33 checks executed (A1–A20 planner, B1–B13 store),
// which is the same class of defect the gate exists to catch one layer down.
let total = 0
const check = (label: string, got: unknown, want: unknown) => {
  total++
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`}`)
}

// ───────────────────────── A. THE PLANNER, PURE ─────────────────────────
//
// Files: importer.js imports from ./lib/parse.js; decoy.js declares the same name.
const index = (): BindingIndex => ({
  filePath: new Map([["Fimp", "src/importer.js"], ["Flib", "src/lib/parse.js"], ["Fdec", "src/lib/decoy.js"]]),
  fileIdByPath: new Map([["src/importer.js", "Fimp"], ["src/lib/parse.js", "Flib"], ["src/lib/decoy.js", "Fdec"]]),
  symbolsByFile: new Map([
    ["Fimp", new Map([["run", ["Simp_run"]]])],
    ["Flib", new Map([["parse", ["Slib_parse"]], ["helper", ["Slib_helper"]]])],
    ["Fdec", new Map([["parse", ["Sdec_parse"]]])],
  ]),
  symbolFile: new Map([["Simp_run", "Fimp"], ["Slib_parse", "Flib"], ["Slib_helper", "Flib"], ["Sdec_parse", "Fdec"]]),
  importsByFile: new Map([
    ["Fimp", [
      { module: "./lib/parse.js", local: "parse", declared: "parse", kind: "named" },
      { module: "./lib/parse.js", local: "p", declared: "parse", kind: "named" },
      { module: "./lib/parse.js", local: "ns", declared: "*", kind: "namespace" },
    ]],
  ]),
  exportsByFile: new Map([
    ["Flib", new Set(["parse", "helper"])],
    ["Fdec", new Set(["parse"])],
  ]),
  // A barrel file: declares NOTHING it publishes, and its clause names `./parse.js`.
  reexportsByFile: new Map([
    ["Fbar", new Map([["reparse", [{ module: "./parse.js", declared: "parse" }]]])],
  ]),
  starsByFile: new Map(),
})

const row = (over: Partial<BindingRow>): BindingRow => ({
  id: "R1", type: "calls", target_external: "parse", currentTarget: null,
  sourceFileId: "Fimp", sourceParams: null, calleeExpression: null, ...over,
})

const plan = (rows: BindingRow[]) => planBindingResolutions(rows, index())

check("A1. a bare name the file IMPORTS resolves to that module's symbol",
  plan([row({})]).map((p) => [p.symbolId, p.via]), [["Slib_parse", "import-binding"]])

check("A2. the DECOY in another file never wins (the name pass could pick it)",
  plan([row({ currentTarget: "Sdec_parse" })]).map((p) => p.symbolId), ["Slib_parse"])

check("A3. an ALIAS resolves by the DECLARED name (`{ parse as p }` -> parse)",
  plan([row({ target_external: "p" })]).map((p) => [p.symbolId, p.via]), [["Slib_parse", "import-alias"]])

check("A4. a NAMESPACE member resolves through the receiver",
  plan([row({ target_external: "helper", calleeExpression: "ns.helper" })]).map((p) => [p.symbolId, p.via]),
  [["Slib_helper", "import-namespace"]])

check("A5. REFUSED — the row's own file declares the name (that IS the answer)",
  plan([row({ target_external: "run", sourceFileId: "Fimp" })]), [])

check("A6. DETACHED — the name is a PARAMETER of the row's own source symbol",
  plan([row({ sourceParams: JSON.stringify(["parse", "b"]), currentTarget: "Sdec_parse" })]).map((p) => [p.symbolId, p.via]),
  [[null, "shadowed-local-binding"]])

check("A7. REFUSED — the module is not in the project",
  plan([row({ target_external: "nope" })]), [])

check("A8. REFUSED — a dotted target belongs to the qualified-name strategy",
  plan([row({ target_external: "obj.parse" })]), [])

check("A9. REFUSED — a `module:item` target belongs to the import resolver",
  plan([row({ target_external: "./m.js:parse" })]), [])

check("A10. REFUSED — a structural label (`contains` is pinned to its own line)",
  plan([row({ type: "contains" })]), [])

check("A11. REFUSED — two modules bind the same local name (ambiguous by construction)",
  planBindingResolutions([row({})], {
    ...index(),
    importsByFile: new Map([["Fimp", [
      { module: "./lib/parse.js", local: "parse", declared: "parse", kind: "named" },
      { module: "./other/parse.js", local: "parse", declared: "parse", kind: "named" },
    ]]]),
  }), [])

check("A12. REFUSED — the module declares the name but does NOT export it",
  planBindingResolutions([row({ target_external: "hidden" })], {
    ...index(),
    symbolsByFile: new Map([
      ["Fimp", new Map([["run", ["Simp_run"]]])],
      ["Flib", new Map([["hidden", ["Slib_hidden"]]])],
    ]),
    importsByFile: new Map([["Fimp", [{ module: "./lib/parse.js", local: "hidden", declared: "hidden", kind: "named" }]]]),
  }), [])

check("A13. REFUSED — a row with no source file at all cannot name an importer",
  plan([row({ sourceFileId: null })]), [])

// ── A14–A20: THE RE-EXPORT CHAIN ────────────────────────────────────────────────────────
//
// A barrel publishes names it does not declare. The import route alone must refuse those
// (the module does not declare the name), and the chain answers them from the barrel's own
// clause. Files: Fbar (`export { parse as reparse } from './parse.js'`), Fbar2 (two hops),
// Fcyc1/Fcyc2 (a cycle), Famb (two clauses for one name), Fext (a clause into a package).
const barrelIndex = (over: Partial<BindingIndex> = {}) => ({
  ...index(),
  filePath: new Map([
    ["Fimp", "src/importer.js"], ["Flib", "src/lib/parse.js"], ["Fdec", "src/lib/decoy.js"],
    ["Fbar", "src/lib/barrel.js"], ["Fbar2", "src/lib/barrel2.js"],
  ]),
  fileIdByPath: new Map([
    ["src/importer.js", "Fimp"], ["src/lib/parse.js", "Flib"], ["src/lib/decoy.js", "Fdec"],
    ["src/lib/barrel.js", "Fbar"], ["src/lib/barrel2.js", "Fbar2"],
  ]),
  symbolsByFile: new Map([
    ["Fimp", new Map([["run", ["Simp_run"]]])],
    ["Flib", new Map([["parse", ["Slib_parse"]], ["helper", ["Slib_helper"]]])],
    ["Fdec", new Map([["parse", ["Sdec_parse"]]])],
  ]),
  exportsByFile: new Map([
    ["Flib", new Set(["parse", "helper"])],
    ["Fdec", new Set(["parse"])],
    ["Fbar", new Set(["reparse"])],
    ["Fbar2", new Set(["reparse"])],
  ]),
  importsByFile: new Map([["Fimp", [{ module: "./lib/barrel.js", local: "reparse", declared: "reparse", kind: "named" }]]]),
  reexportsByFile: new Map([
    ["Fbar", new Map([["reparse", [{ module: "./parse.js", declared: "parse" }]]])],
    // TWO HOPS: barrel2 -> barrel, barrel -> parse.
    ["Fbar2", new Map([["reparse", [{ module: "./barrel.js", declared: "reparse" }]]])],
  ]),
  starsByFile: new Map(),
  ...over,
})

check("A14. a name the module RE-EXPORTS resolves through its own clause",
  planBindingResolutions([row({ target_external: "reparse" })], barrelIndex()).map((p) => [p.symbolId, p.via]),
  [["Slib_parse", "import-reexport"]])

check("A15. a TWO-HOP chain resolves to the declaring module",
  planBindingResolutions([
    row({ target_external: "reparse" }),
  ], barrelIndex({
    importsByFile: new Map([["Fimp", [{ module: "./lib/barrel2.js", local: "reparse", declared: "reparse", kind: "named" }]]]),
  })).map((p) => [p.symbolId, p.via]),
  [["Slib_parse", "import-reexport"]])

check("A16. a re-export CYCLE terminates with no answer (no recursion, no guess)",
  planBindingResolutions([row({ target_external: "a" })], barrelIndex({
    reexportsByFile: new Map([
      ["Fbar", new Map([["a", [{ module: "./barrel2.js", declared: "b" }]]])],
      ["Fbar2", new Map([["b", [{ module: "./barrel.js", declared: "a" }]]])],
    ]),
    importsByFile: new Map([["Fimp", [{ module: "./lib/barrel.js", local: "a", declared: "a", kind: "named" }]]]),
    exportsByFile: new Map([["Fbar", new Set(["a"])]]),
  })), [])

check("A17. an `exports` EDGE that publishes a re-export is re-targeted at the declarer",
  planBindingResolutions([
    row({ id: "X1", type: "exports", target_external: "reparse", sourceFileId: "Fbar", currentTarget: "Sdec_parse" }),
  ], barrelIndex()).map((p) => [p.symbolId, p.via]),
  [["Slib_parse", "reexport-chain"]])

check("A18. REFUSED — two clauses publish the same name from different modules",
  planBindingResolutions([row({ target_external: "reparse" })], barrelIndex({
    reexportsByFile: new Map([["Fbar", new Map([
      ["reparse", [{ module: "./parse.js", declared: "parse" }, { module: "./decoy.js", declared: "parse" }]],
    ])]]),
  })), [])

check("A19. REFUSED — a clause into a module that is not in the project",
  planBindingResolutions([row({ target_external: "reparse" })], barrelIndex({
    reexportsByFile: new Map([["Fbar", new Map([["reparse", [{ module: "some-package", declared: "parse" }]]])]]),
  })), [])

check("A20. REFUSED — the barrel does not publish the name at all",
  planBindingResolutions([row({ target_external: "nowhere" })], barrelIndex({
    importsByFile: new Map([["Fimp", [{ module: "./lib/barrel.js", local: "nowhere", declared: "nowhere", kind: "named" }]]]),
  })), [])

// ── A21–A28: THE STAR REDISTRIBUTION ─────────────────────────────────────────────────────
//
// `export * from './parse.js'` publishes names the barrel never writes, so there is no
// clause to file them under — the STATEMENT is the evidence. The eight cases below are the
// route, its two refusals that come from the language rather than from a policy (ambiguity,
// and `default`), and the two precedence rules (a named clause shadows a star; a star
// source outside the project is not evidence).
const starIndex = (over: Partial<BindingIndex> = {}): BindingIndex => ({
  filePath: new Map([
    ["Fimp", "src/importer.js"], ["Fstar", "src/lib/star.js"], ["Fstar2", "src/lib/star2.js"],
    ["Fparse", "src/lib/parse.js"], ["Fdec", "src/lib/decoy.js"],
  ]),
  fileIdByPath: new Map([
    ["src/importer.js", "Fimp"], ["src/lib/star.js", "Fstar"], ["src/lib/star2.js", "Fstar2"],
    ["src/lib/parse.js", "Fparse"], ["src/lib/decoy.js", "Fdec"],
  ]),
  symbolsByFile: new Map([
    ["Fimp", new Map([["run", ["Simp_run"]]])],
    ["Fparse", new Map([["parse", ["Sparse_parse"]], ["helper", ["Sparse_helper"]], ["default", ["Sparse_default"]]])],
    ["Fdec", new Map([["parse", ["Sdec_parse"]]])],
  ]),
  symbolFile: new Map([
    ["Simp_run", "Fimp"], ["Sparse_parse", "Fparse"], ["Sparse_helper", "Fparse"],
    ["Sparse_default", "Fparse"], ["Sdec_parse", "Fdec"],
  ]),
  importsByFile: new Map([["Fimp", [
    { module: "./lib/star.js", local: "parse", declared: "parse", kind: "named" },
    { module: "./lib/star.js", local: "sn", declared: "*", kind: "namespace" },
    { module: "./lib/star.js", local: "default", declared: "default", kind: "named" },
  ]]]),
  exportsByFile: new Map([["Fparse", new Set(["parse", "helper"])]]),
  reexportsByFile: new Map(),
  starsByFile: new Map([["Fstar", ["./parse.js"]]]),
  ...over,
})

check("A21. a name the barrel REDISTRIBUTES (`export *`) resolves to the declarer",
  planBindingResolutions([row({ target_external: "parse" })], starIndex()).map((p) => [p.symbolId, p.via]),
  [["Sparse_parse", "import-star"]])

check("A22. a NAMESPACE member of a star barrel resolves through the same route",
  planBindingResolutions([row({ target_external: "helper", calleeExpression: "sn.helper" })], starIndex()).map((p) => [p.symbolId, p.via]),
  [["Sparse_helper", "import-star"]])

check("A23. REFUSED — two star sources both declare the name (ambiguous, and the language agrees)",
  planBindingResolutions([row({ target_external: "parse" })], starIndex({
    starsByFile: new Map([["Fstar", ["./parse.js", "./decoy.js"]]]),
  })), [])

check("A24. two star sources naming the SAME declaration still answer it (union by symbol)",
  planBindingResolutions([row({ target_external: "parse" })], starIndex({
    starsByFile: new Map([["Fstar", ["./parse.js", "./lib/parse.js"]]]),
  })).map((p) => [p.symbolId, p.via]),
  [["Sparse_parse", "import-star"]])

check("A25. REFUSED — `export *` never redistributes the DEFAULT binding",
  planBindingResolutions([row({ target_external: "default" })], starIndex()), [])

check("A25b. CONTROL — the same name through a NAMED clause does resolve (so A25 is the star rule)",
  planBindingResolutions([row({ target_external: "default" })], starIndex({
    reexportsByFile: new Map([["Fstar", new Map([["default", [{ module: "./parse.js", declared: "default" }]]])]]),
    exportsByFile: new Map([["Fstar", new Set(["default"])]]),
  })).map((p) => [p.symbolId, p.via]),
  [["Sparse_default", "import-reexport"]])

check("A26. a NAMED clause SHADOWS a star for the same name (the clause answer wins)",
  planBindingResolutions([row({ target_external: "parse" })], starIndex({
    starsByFile: new Map([["Fstar", ["./decoy.js"]]]),
    reexportsByFile: new Map([["Fstar", new Map([["parse", [{ module: "./parse.js", declared: "parse" }]]])]]),
    exportsByFile: new Map([["Fstar", new Set(["parse"])]]),
  })).map((p) => [p.symbolId, p.via]),
  [["Sparse_parse", "import-reexport"]])

check("A27. REFUSED — a star source outside the project is not evidence",
  planBindingResolutions([row({ target_external: "parse" })], starIndex({
    starsByFile: new Map([["Fstar", ["some-package"]]]),
  })), [])

check("A28. a TWO-HOP star chain (star -> star -> declaration) resolves",
  planBindingResolutions([row({ target_external: "parse" })], starIndex({
    starsByFile: new Map([["Fstar", ["./star2.js"]], ["Fstar2", ["./parse.js"]]]),
  })).map((p) => [p.symbolId, p.via]),
  [["Sparse_parse", "import-star"]])

// ───────────────────────── B. THE INDEX, END TO END ─────────────────────────
const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-binding-res-"))
const projDir = path.join(workdir, "proj")
const dataDir = path.join(workdir, "data")
fs.mkdirSync(path.join(projDir, "lib"), { recursive: true })
fs.mkdirSync(dataDir, { recursive: true })
process.env.BB_DATA_DIR = dataDir

// The DECOY: same function name, a different module. `importer.js` does not import it.
fs.writeFileSync(path.join(projDir, "lib", "decoy.js"), "export function parse() { return 'decoy' }\n")
fs.writeFileSync(path.join(projDir, "lib", "parse.js"), [
  "export function parse() { return 'real' }",
  "export function helper() { return 'helper' }",
  "",
].join("\n"))
// THE BARRELS. Neither declares anything it publishes: one clause renames, one keeps the
// name, and the second barrel reaches the first — so a consumer of barrel2 needs a two-hop
// chain. The decoy above (`lib/decoy.js` also declares `parse`) is what the name pass picks
// for `reparse` if the chain is not followed.
fs.writeFileSync(path.join(projDir, "lib", "barrel.js"), [
  "export { parse as reparse, helper } from './parse.js'",
  "",
].join("\n"))
fs.writeFileSync(path.join(projDir, "lib", "barrel2.js"), [
  "export { reparse as deep } from './barrel.js'",
  "",
].join("\n"))
// THE STAR FORMS. `star.js` REDISTRIBUTES every member of parse.js and writes no name, so
// no clause can be filed for it; `star2.js` reaches the declaration through two stars; and
// `nstar.js` is the OTHER star form, which binds `ns` and redistributes nothing at all.
fs.writeFileSync(path.join(projDir, "lib", "star.js"), "export * from './parse.js'\n")
fs.writeFileSync(path.join(projDir, "lib", "star2.js"), "export * from './star.js'\n")
fs.writeFileSync(path.join(projDir, "lib", "nstar.js"), "export * as ns from './parse.js'\n")
// The MULTI-MEMBER clause is not decoration: `{ helper, parse as p2 }` is the shape whose
// second and later bindings were silently dropped by the store (one row per statement, the
// last member winning), and a dropped binding is a binding no resolver can read.
fs.writeFileSync(path.join(projDir, "importer.js"), [
  "import { parse } from './lib/parse.js'",
  "import { parse as aliased } from './lib/parse.js'",
  "import * as ns from './lib/parse.js'",
  "import { helper, parse as p2 } from './lib/parse.js'",
  "import { reparse, helper as h2 } from './lib/barrel.js'",
  "import { deep } from './lib/barrel2.js'",
  "import { parse as viaStarImport } from './lib/star.js'",
  "import { parse as viaDeepStarImport } from './lib/star2.js'",
  "",
  "export function run() { return parse() }",
  "export function viaAlias() { return aliased() }",
  "export function viaNamespace() { return ns.helper() }",
  "export function viaMulti() { return helper() + p2() }",
  "export function viaBarrel() { return reparse() }",
  "export function viaBarrelSameName() { return h2() }",
  "export function viaChain() { return deep() }",
  "export function viaStar() { return viaStarImport() }",
  "export function viaDeepStar() { return viaDeepStarImport() }",
  // A PARAMETER named `parse` shadows the import: the call below is NOT the imported
  // function, and the name pass will have attached some other file's `parse` to it.
  "export function shadowed(parse) { return parse() }",
  "",
].join("\n"))

// The NEGATIVE CONTROL, and the code in it is ILLEGAL ON PURPOSE: `export * as ns`
// publishes `ns` and nothing else, so `./lib/nstar.js` exports no `helper`. A resolver that
// filed the namespace form as a REDISTRIBUTION would land this call on `parse.js:helper`,
// and that edge would be invented rather than derived — which is exactly what the
// `starForm` discriminator exists to prevent, and what B17 asserts.
// The imported name is ALIASED (`helper as notHelper`) on purpose: the raw target is then a
// name NO file in the project declares, so the name-across-the-project strategies leave it
// detached and the only way this row could acquire a target is the wrong star route. With the
// plain name the name pass would resolve `helper` to `parse.js:helper` by uniqueness, and the
// check would pass or fail for a reason that has nothing to do with the discriminator.
fs.writeFileSync(path.join(projDir, "nsconsumer.js"), [
  "import { helper as notHelper } from './lib/nstar.js'",
  "",
  "export function viaInventedStar() { return notHelper() }",
  "",
].join("\n"))

const { getProjectId } = await import(path.join(process.cwd(), "src/cli/index.ts"))
const { indexProjectParallel } = await import(path.join(process.cwd(), "src/ast/parallel-indexer.ts"))
const { BrainDatabase } = await import(path.join(process.cwd(), "src/brain/database.ts"))
const pid = (getProjectId as any)(projDir)
await indexProjectParallel(pid, projDir, { onProgress: () => {} } as any)

const raw: any = await (BrainDatabase as any).getRawInstance(pid)
// NOTE ON THE LOOKUP. A `calls` row written for a call INSIDE a function carries its
// importer on `source_symbol_id` — `source_external` is empty for it (the first version of
// this gate matched on `source_external` and therefore matched NOTHING, reporting the pass
// as broken while the store was in fact being corrected). The rows that DO carry a file
// spelling on the source side are the module-level ones (`exports`), so both are read here.
const landed = raw.prepare(
  `SELECT r.relationship_type AS t, ss.name AS sourceSymbol, r.source_external AS src,
          r.target_external AS tgt, tf.relative_path AS file, ts.name AS symbol
     FROM brain_relationship r
     LEFT JOIN brain_symbol ss ON ss.id = r.source_symbol_id
     LEFT JOIN brain_symbol ts ON ts.id = r.target_symbol_id
     LEFT JOIN brain_file tf ON tf.id = ts.file_id`,
).all() as any[]
/** The `calls` row whose source symbol is `srcSym` and whose target spells `tgt`. */
const callRow = (srcSym: string, tgt: string) =>
  landed.find((r: any) => String(r.t) === "calls" && String(r.sourceSymbol) === srcSym && String(r.tgt) === tgt)
const where = (r: any) => [r?.file ?? null, r?.symbol ?? null]

check("B1. `run` -> parse lands on the IMPORTED module's parse, not the decoy's",
  where(callRow("run", "parse")), ["lib/parse.js", "parse"])
check("B2. the aliased call lands on the DECLARED symbol (`aliased` -> parse.js:parse)",
  where(callRow("viaAlias", "aliased")), ["lib/parse.js", "parse"])
check("B3. the namespace member lands on the module's symbol (`ns.helper`)",
  where(callRow("viaNamespace", "helper")), ["lib/parse.js", "helper"])

// The export surface is a published fact in its own right (`bb_graph` on the module shows
// it), so it is asserted per row: every export edge must name the symbol declared by the
// file its own source spelling names. Before the pass, BOTH `parse` export rows pointed at
// lib/decoy.js — so lib/parse.js was recorded as not exporting the function it declares.
const exportRows = landed.filter((r: any) => String(r.t) === "exports")
// Which file declares which name, read from the store — needed to tell a LOCAL export
// (must land on its own file's symbol) from a RE-EXPORT (must land on another file's).
const declaredByFile = new Map<string, Set<string>>()
for (const s of raw.prepare(
  `SELECT f.relative_path AS p, s.name AS n FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id`,
).all() as any[]) {
  const set = declaredByFile.get(String(s.p)) ?? new Set<string>()
  set.add(String(s.n))
  declaredByFile.set(String(s.p), set)
}
// A LOCAL export lands on the symbol its own file declares. A RE-EXPORT may not claim a
// symbol in its own file at all (it declares none), and must land on a symbol in a DIFFERENT
// file — the one its clause names, asserted concretely by B12.
check("B4. every export edge is consistent with its own file (local lands on local, re-export leaves)",
  exportRows
    .map((r: any) => {
      const local = declaredByFile.get(String(r.src))?.has(String(r.tgt)) ?? false
      const landedInSource = String(r.file) === String(r.src)
      if (local) return landedInSource ? null : `${r.src} -> ${r.tgt} @ ${r.file} (local export left its file)`
      return landedInSource ? `${r.src} -> ${r.tgt} (re-export claims a local symbol)` : null
    })
    .filter(Boolean),
  [])
check("B12. a barrel's re-export row lands on the declaring module, aliased and same-name",
  exportRows.filter((r: any) => String(r.src) === "lib/barrel.js")
    .map((r: any) => `${r.tgt} @ ${r.file}`)
    .sort(),
  ["helper @ lib/parse.js", "reparse @ lib/parse.js"])
check("B5. the export surface of lib/parse.js holds both names it declares",
  exportRows.filter((r: any) => String(r.src) === "lib/parse.js").map((r: any) => String(r.tgt)).sort(),
  ["helper", "parse"])
check("B6. no edge anywhere still points at the decoy except the decoy's own export",
  landed.filter((r: any) => String(r.file) === "lib/decoy.js" && String(r.tgt) === "parse" && String(r.t) !== "exports").length,
  0)

// The import TABLE, not the edges: a resolver can only use a binding the store recorded.
// Before the id was keyed on the imported name, this read back `['ns', 'p2']` — the last
// member of each of the two multi-member clauses — for a file that writes five bindings.
const bindings = (raw.prepare(
  `SELECT imported_as AS as_, import_type AS t FROM brain_import WHERE file_id = ? ORDER BY imported_as`,
).all(`${pid}:importer.js`) as any[]).map((r: any) => `${r.as_}:${r.t}`)
check("B7. EVERY binding of every clause is stored (ten, across eight clauses and two barrels)",
  bindings,
  ["aliased:named", "deep:named", "h2:named", "helper:named", "ns:namespace", "p2:named", "parse:named", "reparse:named", "viaDeepStarImport:named", "viaStarImport:named"])
check("B8. a call through the SECOND member of a multi-member clause lands correctly",
  [where(callRow("viaMulti", "helper")), where(callRow("viaMulti", "p2"))],
  [["lib/parse.js", "helper"], ["lib/parse.js", "parse"]])
// The shadowed call must be CLEARED, not left on whatever same-named symbol the name pass
// chose and not "corrected" onto the import it is shadowed from. Either of those is a
// confident lie about a name that is a local parameter.
const shadowRow = landed.find((r: any) => String(r.sourceSymbol) === "shadowed" && String(r.tgt) === "parse")
check("B9. a SHADOWED name is detached, not attached to the import or to a namesake",
  [shadowRow ? where(shadowRow) : "row missing"], [[null, null]])

// THE CHAIN, end to end: a consumer of a barrel lands on the module that DECLARES the name,
// never on the decoy that merely shares it.
check("B10. a call through a RENAMED re-export lands on the declarer (`reparse` -> parse.js:parse)",
  where(callRow("viaBarrel", "reparse")), ["lib/parse.js", "parse"])
check("B11. a call through a SAME-NAME re-export lands on the declarer (`h2` -> parse.js:helper)",
  where(callRow("viaBarrelSameName", "h2")), ["lib/parse.js", "helper"])
check("B13. a call through a TWO-HOP chain lands on the declarer (`deep` -> parse.js:parse)",
  where(callRow("viaChain", "deep")), ["lib/parse.js", "parse"])

// ── B14–B17: THE STAR ROUTE, END TO END ─────────────────────────────────────────────────
const nsFormRow: any = raw.prepare(
  `SELECT i.imported_as, i.import_type, i.imported_name
     FROM brain_import i JOIN brain_file f ON f.id = i.file_id
    WHERE f.relative_path = 'lib/nstar.js'`,
).get()

check("B14. a call through a BARREL THAT WRITES NO NAME (`export *`) lands on the declarer",
  where(callRow("viaStar", "viaStarImport")), ["lib/parse.js", "parse"])

check("B15. a TWO-HOP star chain (star -> star -> declaration) lands on the declarer",
  where(callRow("viaDeepStar", "viaDeepStarImport")), ["lib/parse.js", "parse"])

check("B16. `export * as ns` records the BINDING that statement creates (it had no row at all)",
  [nsFormRow?.imported_as, nsFormRow?.import_type], ["ns", "namespace"])

check("B17. REFUSED — the NAMESPACE form is not a redistribution (no invented edge)",
  where(callRow("viaInventedStar", "notHelper")), [null, null])

console.log(`\n${failed === 0 ? "PASS" : "FAIL"}  ${total - failed} of ${total} checks (${failed} failing)`)
console.log(`temp project: ${projDir}`)
process.exit(failed === 0 ? 0 : 1)
