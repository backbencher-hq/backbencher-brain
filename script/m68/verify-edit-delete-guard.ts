// script/m68/verify-edit-delete-guard.ts
// M68.P1 — bb_edit's delete guard, across the shapes a reference can take.
//
// THE DEFECT. Measured on three call shapes for one declaration:
//
//   import { target } from './target'            2 edges: 'calls' + 'exports'
//   import { target as aliased } from './target' 1 edge:  'exports' ONLY
//
// In the aliased shape the analyzer never resolved the call site to the imported
// symbol, so the `calls` edge does not exist. The guard's two inputs were then
// both empty — zero indexed callers, and zero occurrences of the name in the
// DECLARATION file — and the delete proceeded. The result was caller.ts still
// calling a function that no longer exists, reported as SUCCESS. A build break,
// silently, from a tool whose whole purpose is to make source changes safe.
//
// THE FIX does not trust the edges more; they are what failed here. It consults
// brain_import, the one table that DID record the dependency, and requires
// POSITIVE evidence in each importing file — the deleted name must actually
// appear there. An aliased import still spells the original name in its specifier
// (`import { target as aliased }` contains `target`, parent=import_specifier), so
// the alias case is caught by name without resolving the alias.
//
// THE OVER-REFUSAL RISK, which is the real design constraint and the reason this
// is not simply "refuse if any importer exists": refusing on any unresolved edge
// would make delete unusable on any project with imperfect edges, which is most of
// them. So the negative cases below matter as much as the positive one — a
// side-effect-only `import './target'` must NOT block, because it never names the
// symbol and cannot dangle.
//
// Hermetic: a tmpdir project per case, indexed by the real indexer, no corpus.

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { executeEdit } from "../../src/intelligence/edit/edit-engine"

let failures = 0
let checks = 0
let passed = 0
function check(label: string, value: boolean, detail = ""): void {
  checks++
  if (value) { passed++; console.log(`  ok: ${label}`) }
  else { failures++; console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`) }
}

const TARGET = "export function target(): number {\n  return 1\n}\n"

/** Run one delete in its own project and report exactly what happened. */
async function attempt(
  files: Record<string, string>,
  symbol: string,
  extra: Record<string, unknown> = {},
): Promise<{ verdict: "deleted" | "refused"; message: string; warnings: string[] | null; changed: string[] }> {
  const root = mkdtempSync(path.join(tmpdir(), "bb-m68-del-"))
  mkdirSync(path.join(root, "src"), { recursive: true })
  for (const [name, body] of Object.entries(files)) writeFileSync(path.join(root, "src", name), body, "utf8")
  const projectId = getProjectId(root)
  const before: Record<string, string> = {}
  for (const name of Object.keys(files)) before[name] = readFileSync(path.join(root, "src", name), "utf8")
  try {
    await indexProjectParallel(projectId, root, {})
    let verdict: "deleted" | "refused" = "deleted"
    let message = ""
    let warnings: string[] | null = null
    try {
      const r = await executeEdit(root, projectId, { mode: "delete", symbolName: symbol, format: false, ...extra } as any)
      warnings = (r.warnings ?? null) as any
    } catch (e: any) {
      verdict = "refused"
      message = String(e?.message ?? e)
    }
    const changed = Object.keys(files).filter((n) => readFileSync(path.join(root, "src", n), "utf8") !== before[n])
    return { verdict, message, warnings, changed }
  } finally {
    rmSync(root, { recursive: true, force: true })
    try { rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true }) } catch {}
  }
}

try {
  // ── the defect: an aliased call site must not survive a silent delete ────
  {
    const aliased = await attempt(
      { "target.ts": TARGET, "caller.ts": "import { target as aliased } from './target'\nexport function caller(): number { return aliased() }\n" },
      "target",
    )
    check("G1 deleting a symbol reached through an import ALIAS is REFUSED",
      aliased.verdict === "refused", `it deleted; changed ${aliased.changed.join(",")}`)
    check("G1b the refusal says the reference is in an importing file",
      /importing file/i.test(aliased.message), aliased.message.slice(0, 150))
    check("G1c the refusal NAMES the importing file, so the caller can go look",
      /caller\.ts/.test(aliased.message), aliased.message.slice(0, 150))
    check("G1d the refusal names the remedy (force=true)", /force=true/.test(aliased.message), aliased.message.slice(0, 150))
    check("G1e and NOTHING was written — a refused delete touches no file",
      aliased.changed.length === 0, `changed: ${aliased.changed.join(",")}`)
  }

  // ── the shape that already worked must keep working ────────────────────
  {
    const direct = await attempt(
      { "target.ts": TARGET, "caller.ts": "import { target } from './target'\nexport function caller(): number { return target() }\n" },
      "target",
    )
    check("G2 a direct same-name call is still refused", direct.verdict === "refused", direct.message.slice(0, 120))
    check("G2b and it still cites the indexed caller(s)", /indexed caller/i.test(direct.message), direct.message.slice(0, 140))
  }

  // ── force: allowed, and AUDITED ─────────────────────────────────────────
  {
    const forced = await attempt(
      { "target.ts": TARGET, "caller.ts": "import { target as aliased } from './target'\nexport function caller(): number { return aliased() }\n" },
      "target",
      { force: true },
    )
    check("G3 force deletes through an alias", forced.verdict === "deleted", forced.message.slice(0, 120))
    check("G3b and it WARNS, naming the surviving reference and its file",
      !!forced.warnings?.some((w) => /reference/i.test(w) && /caller\.ts/.test(w)),
      JSON.stringify(forced.warnings))
    check("G3c force changed only the declaring file", forced.changed.length === 1 && forced.changed[0] === "target.ts",
      `changed: ${forced.changed.join(",")}`)
  }

  // ── the over-refusal risks: cases that must still succeed ──────────────
  {
    const none = await attempt({ "target.ts": TARGET }, "target")
    check("G4 a caller-less symbol still deletes cleanly",
      none.verdict === "deleted" && none.changed.length === 1, `verdict=${none.verdict}`)
    check("G4b with no spurious warning", !none.warnings || none.warnings.length === 0, JSON.stringify(none.warnings))
  }
  {
    // A side-effect-only import never names the symbol, so it cannot dangle.
    // Refusing here would make delete unusable for any module that is imported
    // for its side effects, which is extremely common.
    const sideEffect = await attempt(
      { "target.ts": TARGET, "boot.ts": "import './target'\nexport const started = true\n" },
      "target",
    )
    check("G5 a side-effect-only import does NOT block the delete",
      sideEffect.verdict === "deleted", sideEffect.message.slice(0, 140))
  }
  {
    // An importer that names a DIFFERENT symbol from the same module must not be
    // treated as a reference to the deleted one.
    const other = await attempt(
      { "target.ts": TARGET + "export function sibling(): number {\n  return 2\n}\n", "caller.ts": "import { sibling } from './target'\nexport function use(): number { return sibling() }\n" },
      "target",
    )
    check("G6 an importer that names only a SIBLING symbol does NOT block",
      other.verdict === "deleted", other.message.slice(0, 160))
  }
  {
    // Two importers, only one of which references it: the refusal must still
    // happen, and must name the one that matters rather than "some file".
    const mixed = await attempt(
      {
        "target.ts": TARGET,
        "caller.ts": "import { target as aliased } from './target'\nexport function caller(): number { return aliased() }\n",
        "bystander.ts": "import { sibling } from './target'\nexport const x = sibling\n",
      },
      "target",
    )
    check("G7 with two importers, one referencing, the delete is refused", mixed.verdict === "refused", mixed.message.slice(0, 140))
    check("G7b and the refusal names the file that actually references it",
      /caller\.ts/.test(mixed.message), mixed.message.slice(0, 160))
  }
} catch (error) {
  check("M68.P1 session", false, error instanceof Error ? (error.stack ?? error.message) : String(error))
}

console.log(`\nM68.P1: ${failures === 0 ? `PASS (${passed}/${checks})` : `${failures} FAILURES of ${checks}`}`)
process.exit(failures > 0 ? 1 : 0)