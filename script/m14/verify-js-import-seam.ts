/**
 * JS IMPORT SEAM — the pin for `brain_import`'s per-import binding and type.
 *
 * WHY THIS EXISTS. Measured read back out of a real index (`packages/svelte/src`, 368
 * files, and reproduced on a two-file project), EVERY javascript import was stored as
 *
 *     imported_name = './wrapper/wrapper_bench.js'   (the MODULE, not a name)
 *     imported_as   = NULL                            (the local binding, dropped)
 *     import_type   = 'named'                         (even for default and namespace)
 *
 * and `import * as ns from './m'` published NO binding anywhere in its record. Two
 * consumers felt it: `src/ast/patterns.ts` computes unused imports as
 * `usedName = imported_as || imported_name` and then looks that name up IN THE FILE — for
 * this lane it searched for a module specifier the source never writes — and no resolver
 * could attribute an edge whose target is an imported binding, because the store had never
 * recorded which local name the import bound.
 *
 * WHAT IT ASSERTS, end to end and by RUNNING THE INDEXER, never by reading the mapping:
 * a two-file project is indexed through the production path (`indexProjectParallel`), and
 * `brain_import` is read back for all four import forms plus a side-effect import.
 *
 *   1. `import thing from './m.js'`        -> imported_as thing, import_type default
 *   2. `import { alpha } from './m.js'`    -> imported_as alpha, import_type named
 *   3. `import { beta as bee }`            -> imported_as bee,   import_type named
 *   4. `import * as ns from './m.js'`      -> imported_as ns,    import_type namespace
 *   5. `import './m.js'`                   -> no binding (a side-effect import binds none)
 *
 * Plus two PINS, so a future change to the same seam is visible rather than silent:
 * `imported_name` still holds the module specifier for this shape (the shared column's
 * meaning for a module-shaped record — NOT changed here, see the note in the lane doc),
 * and the `imports` EDGE spellings stay exactly as the lane's fixtures pin them.
 *
 * Exit 0 = every row matches. Exit 1 = at least one does not (prints which).
 *
 *   bun run script/m14/verify-js-import-seam.ts
 */
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const ROOT = process.cwd()
const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-import-seam-"))
const projDir = path.join(workdir, "proj")
const dataDir = path.join(workdir, "data")
fs.mkdirSync(projDir, { recursive: true })
fs.mkdirSync(dataDir, { recursive: true })
process.env.BB_DATA_DIR = dataDir

fs.writeFileSync(path.join(projDir, "m.js"), [
  "export default function thing() { return 1 }",
  "export function alpha() { return 2 }",
  "export function beta() { return 3 }",
  "export function gamma() { return 4 }",
  "",
].join("\n"))
fs.writeFileSync(path.join(projDir, "a.js"), [
  "import thing from './m.js'",
  "import { alpha } from './m.js'",
  "import { beta as bee } from './m.js'",
  "import * as ns from './m.js'",
  "import './m.js'",
  "",
  "export function use() {",
  "  return [thing(), alpha(), bee(), ns.gamma()]",
  "}",
  "",
].join("\n"))

const { getProjectId } = await import(path.join(ROOT, "src/cli/index.ts"))
const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer.ts"))
const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))
const pid = (getProjectId as any)(projDir)
await indexProjectParallel(pid, projDir, { onProgress: () => {} } as any)

const raw: any = await (BrainDatabase as any).getRawInstance(pid)
const rows = raw.prepare(
  "SELECT imported_name, imported_as, import_path, import_type FROM brain_import ORDER BY imported_as",
).all() as any[]
const edges = raw.prepare(
  "SELECT target_external AS t, metadata FROM brain_relationship WHERE relationship_type = 'imports' ORDER BY target_external",
).all() as any[]

let failed = 0
const check = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`}`)
}

const byBinding = new Map<string, any>()
for (const r of rows) {
  const key = String(r.imported_as ?? "")
  // the side-effect import has no binding; keep the FIRST row of each binding
  if (!byBinding.has(key)) byBinding.set(key, r)
}

check("1. default import records its LOCAL BINDING and type",
  [byBinding.get("thing")?.imported_as, byBinding.get("thing")?.import_type], ["thing", "default"])
check("2. named import records its LOCAL BINDING and type",
  [byBinding.get("alpha")?.imported_as, byBinding.get("alpha")?.import_type], ["alpha", "named"])
check("3. aliased import records the LOCAL name `bee` (`beta as bee`)",
  [byBinding.get("bee")?.imported_as, byBinding.get("bee")?.import_type], ["bee", "named"])
check("4. namespace import records the alias `ns` — the binding that was published NOWHERE",
  [byBinding.get("ns")?.imported_as, byBinding.get("ns")?.import_type], ["ns", "namespace"])
check("5. a side-effect import binds no name",
  byBinding.has(""), true)
check("PIN — imported_name still carries the module specifier for this record shape",
  byBinding.get("thing")?.imported_name, "./m.js")
check("PIN — the `imports` edge spellings are unchanged",
  edges.map((e) => e.t),
  ["./m.js:*", "./m.js:alpha", "./m.js:bee", "./m.js:thing"])
check("PIN — the edge metadata still declares the DECLARED name (default, beta, *)",
  edges.map((e) => [JSON.parse(e.metadata ?? "{}").declaredName, JSON.parse(e.metadata ?? "{}").declaredKind]),
  [["*", "namespace"], ["alpha", "named"], ["beta", "named"], ["default", "default"]])

console.log(`\n${failed === 0 ? "PASS" : "FAIL"}  ${8 - failed} of 8 checks (${failed} failing)`)
console.log(`temp project: ${projDir}`)
process.exit(failed === 0 ? 0 : 1)
