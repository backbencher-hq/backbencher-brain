/**
 * THE MINIMAL REPRO FOR THE THIRD LEAF-REDUCTION SITE — three files, no corpus, seconds to run.
 *
 * ## Why this file exists
 *
 * Two fixes for the programme's central defect are landed:
 *   `63a888b03` — `extractLeaf` (TypeScript) no longer dot-splits a name carrying a path separator
 *   `47a45a72c` — the SQL rung `SUBSTR(target_external, INSTR(target_external,'.')+1)` carries the
 *                 same guard (`INSTR(target_external,'/') = 0`)
 *
 * **AND THE BINDING STILL HAPPENS.** On the fully-fixed revision, in a two-file project:
 *
 *     a.zig: const b = @import("sub/b.zig");
 *     sub/b.zig: pub fn zig() void {}
 *
 *     [references] sub/b.zig  ->  BOUND to "zig"
 *     [imports]    sub/b.zig  ->  BOUND to "zig"
 *
 * so `sub/b.zig` is still being reduced to its EXTENSION and bound by name.
 *
 * ## The controls that make it a diagnosis rather than an observation
 *
 *   1. rename the symbol `zig` -> `ziggy`              -> BOTH EDGES UNBOUND (the binder is a NAME
 *                                                         lookup, not the file claim)
 *   2. move the symbol `zig` into an UNRELATED `c.zig` -> BOTH EDGES STILL BOUND (the lookup is
 *                                                         GLOBAL by leaf name, not per-file)
 *
 * Control 2 is the one that matters: it rules OUT `import-resolution.ts`'s
 * `unique-file+qualified-leaf` rung (line ~344), whose lookup is per target file, as the sole
 * explanation — so the binder is another global name rung.
 *
 * ## What is already ruled out
 *
 *   `extractLeaf` (parallel-indexer, TS)          returns the path whole now
 *   the SQL rung at `parallel-indexer.ts:4783`    guarded by `INSTR(target_external,'/') = 0`
 *   `resolveTargetStmt`                           a plain `WHERE s.name = ?`, no reduction
 *   `pool-worker.ts:697`'s second `extractLeaf`   used for the keep/drop FILTER, not for binding
 *
 * Run: `npx tsx validation/m14/fixtures/zig/tools/leaf-reduction-repro.mts`
 * It builds its fixture under `.tmp-zig/leaf-repro/` (workspace-local, never committed data).
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"

const ROOT = path.resolve(new URL("../../../../../", import.meta.url).pathname)
const PROBE = path.join(ROOT, ".tmp-zig/leaf-repro")
const DATA = path.join(ROOT, ".tmp-zig/leaf-repro-data")

const write = (rel: string, body: string) => {
  const p = path.join(PROBE, rel)
  mkdirSync(path.dirname(p), { recursive: true })
  writeFileSync(p, body)
}

async function run(label: string, cZig: string, bZig: string): Promise<void> {
  rmSync(PROBE, { recursive: true, force: true })
  rmSync(DATA, { recursive: true, force: true })
  process.env.BB_DATA_DIR = DATA
  write("a.zig", `const c = @import("c.zig");\nconst b = @import("sub/b.zig");\n\npub fn main() void {\n    c.zig();\n    b.ziggy();\n}\n`)
  write("c.zig", `pub fn ${cZig}() void {}\n`)
  write("sub/b.zig", `pub fn ${bZig}() void {}\n\npub const x: u32 = 1;\n`)
  try { execFileSync("git", ["init", "-q"], { cwd: PROBE, stdio: "ignore" }) } catch {}
  try { execFileSync("git", ["add", "-A"], { cwd: PROBE, stdio: "ignore" }) } catch {}

  const { indexProjectParallel } = await import(`${ROOT}/src/ast/parallel-indexer.ts`)
  const { BrainDatabase } = await import(`${ROOT}/src/brain/database.ts`)
  const { getProjectId } = await import(`${ROOT}/src/cli/index.ts`)
  const pid = getProjectId(PROBE)
  await indexProjectParallel(pid as any, PROBE, {})
  const raw = await BrainDatabase.getRawInstance(pid as any)
  const rows = raw.prepare(`
    SELECT r.relationship_type t, r.target_external tgt, s.name sname
    FROM brain_relationship r LEFT JOIN brain_symbol s ON s.id = r.target_symbol_id
    WHERE r.project_id = ? AND r.target_external LIKE '%b.zig%'`).all(pid) as any[]
  console.log(`\n${label}`)
  for (const r of rows) console.log(`   [${r.t}] ${r.tgt}  ->  ${r.sname === null ? "UNBOUND" : `BOUND to ${JSON.stringify(r.sname)}`}`)
}

console.log("THE THIRD LEAF-REDUCTION SITE — minimal repro (current revision, both fixes in)")
await run("A. `zig` declared in the TARGET file (sub/b.zig): expect BOUND if a third site reduces the path", "notzig", "zig")
await run("B. CONTROL — renamed to `ziggy` in the target file (the name lookup should find nothing)", "notzig", "ziggy")
await run("C. CONTROL — `zig` moved to an UNRELATED c.zig (per-file lookup would NOT bind; a global leaf lookup WILL)", "zig", "ziggy")
