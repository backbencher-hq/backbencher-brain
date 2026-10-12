// script/m51/probe-a1-mutant.ts — mutation child for verify-a1-owner-integrity.
// Restores the pre-M51 Path-A owner assignment in a THROWAWAY copy of the
// source, re-indexes an identical fixture, and proves phantoms reappear.
// The real source file is restored in a finally block and hash-verified; if
// this probe dies mid-run, the .bak copy under script/m51/tmp/ is authoritative.

import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createHash } from "node:crypto"

const ROOT = join(import.meta.dirname ?? ".", "../..")
const SRC = join(ROOT, "src/ast/parallel-indexer.ts")
const original = readFileSync(SRC, "utf8")
const sha = (s: string) => createHash("sha256").update(s).digest("hex")

process.env.BB_DATA_DIR = mkdtempSync(join(tmpdir(), "bb-m51-a1-mutant-"))
process.env.BB_LOG_LEVEL = "3"
// M54.P1: this mutation resurrects the PRE-M51 writer, which also ran with FK
// enforcement OFF (bun default before M54). Under the M54 policy the phantom-
// sourced contains edges this mutant writes are rejected at write time (the
// store batch rolls back — that rejection is exactly what M54's own gate S2
// proves), so the A1 counting mutation must run under the legacy posture to
// keep its original contract: without A1's guards, phantom owner ids appear
// in stored rows.
process.env.BB_FK_ENFORCE = "0"

let restored = false
// The text this run wrote into the SOURCE, kept for the restore guard below.
let mutantText = ""
let result: { colonZero: number; orphans: number } | null = null
try {
  mkdirSync(join(ROOT, "script/m51/tmp"), { recursive: true })
  writeFileSync(join(ROOT, "script/m51/tmp/parallel-indexer.ts.bak"), original)

  // Revert the three M51.A1 changes in Path A to the pre-M51 behavior.
  let mutant = original
  const r1 = "              const parentSymbol = nameToSymbol.get(_ownerName)\n"
  if (!mutant.includes(r1)) throw new Error("mutation anchor 1 missing")
  mutant = mutant.replace(r1, r1 + "              ownerSymbolId = `${fileId}:${_ownerName}:0`\n")
  // ANCHORS 2 and 3 RE-POINTED 2026-10-12 (#612 containment round). The guards
  // this probe reverts are still there and still the M51.A1 ones — the second
  // simply gained a `!ownerSymbolId && ` prefix so a covering same-name owner
  // chosen above is not overwritten by the module fallback — and the probe's
  // string pins still spelled the pre-#612 line, so the arm died with
  // "mutation anchor 2 missing" BEFORE it wrote anything (the source stayed
  // untouched, which is why the failure read as a crash rather than as a
  // phantom). A pin that stops matching looks exactly like a guard that was
  // removed, and the honest answer is to re-point it at the guard that IS
  // there: `if (parentSymbol)` is still the pre-M51 unconditional module
  // fallback, and `if (parentStartLine >= 0)` is still the old storeability
  // test.
  const r2 = "               if (!ownerSymbolId && parentSymbol && parentSymbol.name !== symbol.name) {"
  if (!mutant.includes(r2)) throw new Error("mutation anchor 2 missing")
  mutant = mutant.replace(r2, "               if (parentSymbol) {")
  const r3 = "                 if (storeableName(parentSymbol.name, parentStartLine)) {"
  if (!mutant.includes(r3)) throw new Error("mutation anchor 3 missing")
  mutant = mutant.replace(r3, "                 if (parentStartLine >= 0) {")
  mutantText = mutant
  writeFileSync(SRC, mutant)

  // Import AFTER the patch so the mutated module is what runs.
  const { getProjectId } = await import(join(ROOT, "src/cli/index"))
  const { indexProjectParallel } = await import(join(ROOT, "src/ast/parallel-indexer"))
  const { BrainDatabase } = await import(join(ROOT, "src/brain/database"))

  const fixture = mkdtempSync(join(tmpdir(), "bb-m51-a1-mutant-fixture-"))
  mkdirSync(join(fixture, "src"), { recursive: true })
  writeFileSync(join(fixture, "package.json"), JSON.stringify({
    name: "m51-fixture", version: "1.0.0", scripts: { build: "tsc -p ." },
  }, null, 2))
  writeFileSync(join(fixture, "src", "user.ts"), [
    "export interface User { id: string; name: string }",
    "export const DEFAULT_NAME = 'anon'",
    "export function createUser(name: string): User {",
    "  return { id: '1', name }",
    "}",
    "export class UserService {",
    "  getUser(id: string): User | null {",
    "    return null",
    "  }",
    "}",
  ].join("\n") + "\n")

  const pid = getProjectId(fixture)
  await indexProjectParallel(pid as any, fixture)
  const raw = await BrainDatabase.getRawInstance(pid as any)
  const syms = raw.prepare("SELECT id, name, owner_symbol_id FROM brain_symbol").all() as any[]
  const colonZero = syms.filter((s) => typeof s.owner_symbol_id === "string" && s.owner_symbol_id.endsWith(":0")).length
  const ids = new Set(syms.map((s) => s.id))
  const orphans = syms.filter((s) => s.owner_symbol_id && !ids.has(s.owner_symbol_id)).length
  raw.close?.()
  rmSync(fixture, { recursive: true, force: true })
  rmSync(process.env.BB_DATA_DIR!, { recursive: true, force: true })

  result = { colonZero, orphans }
} finally {
  // THE RESTORE IS GUARDED, because this probe writes the REAL source file and
  // other agents work in this checkout at the same time. Restoring
  // unconditionally overwrites whatever is on disk with the pre-run copy, which
  // silently destroys a concurrent edit and then reports a byte-identical
  // restore — the hash check compared the file against the very text it had just
  // written, so it could not see the loss. Measured shape of the hazard: the
  // source's mtime moved 40s after one run of this probe. Three cases now, read
  // from the disk itself: our mutant (restore), already the pre-run copy (nothing
  // to do), or NEITHER — someone else wrote, and this probe refuses to overwrite
  // a writer it cannot see, failing loudly while its `.bak` copy stays in place.
  const disk = readFileSync(SRC, "utf8")
  const diskHash = sha(disk)
  if (diskHash === sha(original)) {
    restored = true
  } else if (mutantText && diskHash === sha(mutantText)) {
    writeFileSync(SRC, original)
    restored = sha(readFileSync(SRC, "utf8")) === sha(original)
    if (!restored) {
      // Last-resort recovery from the .bak copy.
      writeFileSync(SRC, readFileSync(join(ROOT, "script/m51/tmp/parallel-indexer.ts.bak"), "utf8"))
      restored = sha(readFileSync(SRC, "utf8")) === sha(original)
    }
  } else {
    throw new Error(
      "parallel-indexer.ts changed underneath this probe: on-disk text is neither the pre-run copy nor this run's mutant. " +
      "A concurrent writer edited the file, so this probe refuses to overwrite it. The pre-run copy is at " +
      "script/m51/tmp/parallel-indexer.ts.bak — reconcile by hand, then re-run.",
    )
  }
  if (restored) rmSync(join(ROOT, "script/m51/tmp"), { recursive: true, force: true })
}

// Printed AFTER the finally so `restored` reflects the post-restore reality.
if (!result) throw new Error("mutant probe produced no result")
console.log(JSON.stringify({ ...result, restored }))
