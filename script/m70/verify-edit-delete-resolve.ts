// script/m70/verify-edit-delete-resolve.ts
// M70.P1 — bb_edit's delete guard: a specifier must be RESOLVED, not name-matched.
//
// THIS GATE EXISTS BECAUSE m68 WAS NOT ENOUGH, and finding that out is the point
// of recording it. m68 asserted the aliased-import case with a single specifier
// spelling — `./target` — and passed 16/16. The real world is not one spelling.
//
// TWO BUGS, both measured, both invisible to m68.
//
// 1. THE ORIGINAL DEFECT WAS STILL THERE FOR ANY OTHER DIRECTORY. The guard
//    compared the recorded specifier against the declaration's bare stem and
//    `./`+stem. So:
//
//      import { target as aliased } from './target'        REFUSED   (m68's case)
//      import { target as aliased } from '../models/user'  DELETED   (silent break)
//
//    m68 was green throughout while the cross-directory case deleted silently. A
//    gate that only exercises one spelling of the thing it is testing is a gate
//    that proves the spelling works.
//
// 2. IT OVER-REFUSED ON A SHADOWED LOCAL. The guard scanned each importing file
//    for every *reference* to the name. In a file importing an unrelated
//    `./user`, a local `const user = {n:1}` with `String(user.n)` blocked the
//    delete of an unrelated `models/user.ts`. The occurrence is a real reference —
//    to the file's own local. No amount of care in that scan fixes it; telling
//    "the imported symbol is used" from "something else of this name is used" is
//    scope analysis, which is not what this guard should be.
//
// THE FIX. Resolve the specifier to a real path, and count only SPECIFIERS. An
// aliased import still spells the original name in its specifier, and that
// specifier is broken the moment the declaration is deleted — no scope analysis
// and no alias resolution needed. Both bugs are structural consequences of
// scanning by name, and both disappear with it.
//
// A third bug was found only by instrumenting the guard rather than reading it:
// `match.fileId` is the ABSOLUTE path on the wire path, not the index's
// `<projectId>:<relativePath>` key, so the lookup by id returned undefined and the
// whole importer check found zero candidates. Every case above still "passed" in
// the sense of not crashing. A guard that reports nothing when the evidence is
// present is worse than no guard, because it reads as a clean bill of health.
//
// Hermetic: a tmpdir project per shape, indexed by the real indexer, no corpus.
// The KNOWN-GAP shape below is asserted as a known gap, not quietly skipped —
// see the note on it for why it cannot be closed here.

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

const T = "export function target(): number {\n  return 1\n}\n"
const OTHER = "export function other(): number {\n  return 2\n}\n"

/** Run one delete in its own project. `force` is deliberately NOT set: a probe
 *  that passes force can never observe a refusal, which is how an earlier
 *  revision of this gate reported every shape as "deleted" and looked like a
 *  total failure of the guard rather than a broken probe. */
async function attempt(
  files: Record<string, string>,
  declPath: string,
  force = false,
): Promise<{ verdict: "deleted" | "refused"; message: string; warnings: string[] | null; changed: string[] }> {
  const root = mkdtempSync(path.join(tmpdir(), "bb-m70-del-"))
  for (const [name, body] of Object.entries(files)) {
    const p = path.join(root, "src", name)
    mkdirSync(path.dirname(p), { recursive: true })
    writeFileSync(p, body, "utf8")
  }
  const projectId = getProjectId(root)
  const before: Record<string, string> = {}
  for (const name of Object.keys(files)) before[name] = readFileSync(path.join(root, "src", name), "utf8")
  try {
    await indexProjectParallel(projectId, root, {})
    let verdict: "deleted" | "refused" = "deleted"
    let message = ""
    let warnings: string[] | null = null
    try {
      const r = await executeEdit(root, projectId, { mode: "delete", symbolName: "target", filePath: declPath, force, format: false } as any)
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
  // ── specifier spellings that must all be caught ────────────────────────
  // Each is a distinct way of naming the same module, and m68 proved only the
  // first. The declaration is named `target` in all of them so the symbol is
  // held constant and only the PATH varies.
  const MUST_REFUSE: Array<[string, Record<string, string>, string]> = [
    ["same-directory, direct name", { "target.ts": T, "c.ts": "import { target } from './target'\nexport function f(): number { return target() }\n" }, "src/target.ts"],
    ["same-directory, ALIASED", { "target.ts": T, "c.ts": "import { target as a } from './target'\nexport function f(): number { return a() }\n" }, "src/target.ts"],
    ["child directory", { "models/target.ts": T, "c.ts": "import { target as a } from './models/target'\nexport function f(): number { return a() }\n" }, "src/models/target.ts"],
    ["three levels deep", { "a/b/c/target.ts": T, "z.ts": "import { target as a } from './a/b/c/target'\nexport function f(): number { return a() }\n" }, "src/a/b/c/target.ts"],
    ["parent-directory specifier", { "a/target.ts": T, "a/b/c.ts": "import { target as a } from '../target'\nexport function f(): number { return a() }\n" }, "src/a/target.ts"],
    ["re-export", { "target.ts": T, "barrel.ts": "export { target } from './target'\n" }, "src/target.ts"],
    ["directory index (barrel)", { "target/index.ts": T, "c.ts": "import { target } from './target'\nexport function f(): number { return target() }\n" }, "src/target/index.ts"],
  ]
  for (const [label, files, decl] of MUST_REFUSE) {
    const r = await attempt(files, decl)
    check(`R1 ${label}: refused`, r.verdict === "refused", `deleted; changed ${r.changed.join(",") || "none"}`)
    check(`R1b ${label}: nothing written when refused`, r.changed.length === 0, `changed: ${r.changed.join(",")}`)
  }

  // ── and the shapes that must NOT be refused ────────────────────────────
  // The over-refusal risk is the design constraint: a guard that refuses
  // everything is safe and useless, and a guard that refuses nothing is neither.
  const MUST_DELETE: Array<[string, Record<string, string>, string]> = [
    ["a same-stem module in ANOTHER directory", { "models/target.ts": T, "types/target.ts": OTHER, "c.ts": "import { other } from './types/target'\nexport function f(): number { return other() }\n" }, "src/models/target.ts"],
    ["a local that merely SHADOWS the name", { "target.ts": T, "types/target.ts": OTHER, "c.ts": "import { other } from './types/target'\nconst target = { n: 1 }\nexport function f(): number { return other() + target.n }\n" }, "src/target.ts"],
    ["a side-effect-only import", { "target.ts": T, "boot.ts": "import './target'\nexport const s = true\n" }, "src/target.ts"],
    ["a namespace import", { "target.ts": T, "c.ts": "import * as m from './target'\nexport function f(): number { return m.helper ? 1 : 0 }\n" }, "src/target.ts"],
    ["no importer at all", { "target.ts": T }, "src/target.ts"],
    ["a bare PACKAGE specifier", { "target.ts": T, "c.ts": "import { target as a } from 'some-pkg'\nexport function f(): number { return a() }\n" }, "src/target.ts"],
  ]
  for (const [label, files, decl] of MUST_DELETE) {
    const r = await attempt(files, decl)
    check(`R2 ${label}: not blocked`, r.verdict === "deleted", `refused: ${r.message.slice(0, 130)}`)
    check(`R2b ${label}: no spurious warning`, !r.warnings || r.warnings.length === 0, JSON.stringify(r.warnings))
  }

  // ── force still works, and is audited ──────────────────────────────────
  {
    const r = await attempt({ "models/target.ts": T, "c.ts": "import { target as a } from './models/target'\nexport function f(): number { return a() }\n" }, "src/models/target.ts", true)
    check("R3 force deletes through a cross-directory alias", r.verdict === "deleted", r.message.slice(0, 120))
    check("R3b and it WARNS, naming the file and the surviving specifier",
      !!r.warnings?.some((w) => /c\.ts/.test(w) && /specifier|import|export/i.test(w)),
      JSON.stringify(r.warnings))
    check("R3c force changed only the declaring file",
      r.changed.length === 1 && r.changed[0] === "models/target.ts", `changed: ${r.changed.join(",")}`)
  }

  // ── the guard must be REACHABLE at all ─────────────────────────────────
  //
  // The third bug was invisible to every purely behavioural check, because a
  // guard that finds nothing still reports "no reason to refuse" and every delete
  // succeeds — which is exactly what a correct guard does for the MUST_DELETE
  // shapes. So this block asserts the refusal is attributed to the resolved
  // specifier rather than to something incidental.
  //
  // WHAT THE MUTATIONS PROVED, run against this gate, so the claims above are
  // checked rather than asserted:
  //
  //   M1  specifier compared to the bare stem (the m68 bug)  -> 10 FAILURES
  //   M2  importer check disabled entirely                  -> 14 FAILURES
  //   M3  scan every reference instead of only specifiers   -> 14 FAILURES
  //   M6  no way to learn the declaration's relative path   -> 16 FAILURES
  //
  // and two mutations that correctly do NOT turn it red, recorded because the
  // reason is a design property worth keeping:
  //
  //   M4  remove the absolute-path fallback  -> still green
  //   M5  remove the `OR path = ?` clause    -> still green
  //
  // M4 and M5 each disable ONE of the two ways the relative path is determined
  // (relativizing an absolute match.fileId, or looking the file up by its `path`
  // column). Either alone is sufficient because match.fileId arrives as an
  // absolute path on the wire while the row's own key is `<projectId>:<relPath>`.
  // Two independent routes that each work is defence in depth, not redundancy to
  // remove — and it is exactly why M6, which removes both, is the mutation that
  // matters. Recorded so a future reader does not "simplify" one of the two and
  // assume the gate would notice.
  {
    const r = await attempt({ "models/target.ts": T, "c.ts": "import { target as a } from './models/target'\nexport function f(): number { return a() }\n" }, "src/models/target.ts")
    check("R3x the refusal is attributed to the IMPORTING file, not to an indexed caller",
      /importing file/i.test(r.message) && !/indexed caller/.test(r.message),
      r.message.slice(0, 160))
    check("R3y and it cites a specifier shape, which only a resolved path can produce",
      /specifier|import|export/i.test(r.message), r.message.slice(0, 160))
  }

  // ── the refusal is actionable ──────────────────────────────────────────
  {
    const r = await attempt({ "models/target.ts": T, "c.ts": "import { target as a } from './models/target'\nexport function f(): number { return a() }\n" }, "src/models/target.ts")
    check("R4 the refusal names the importing file", /c\.ts/.test(r.message), r.message.slice(0, 150))
    check("R4b it says the reference is in an importing file", /importing file/i.test(r.message), r.message.slice(0, 150))
    check("R4c it names the remedy", /force=true/.test(r.message), r.message.slice(0, 150))
  }

  // ── KNOWN GAP, asserted as a known gap ─────────────────────────────────
  // A tsconfig path alias (`@/models/user`, `~/models/user`) is a real,
  // extremely common way to name a project module, and this guard cannot see it.
  // MEASURED reason: the INDEXER does not record non-relative specifiers in
  // brain_import at all — there is no row, so there is nothing to resolve FROM.
  // An earlier version of resolveImportToFile handled `@/` and `~/` by assuming
  // `src/`, which was dead code: the absence of the row, not the arithmetic, was
  // why the delete proceeded. Assuming `src/` would also be wrong in any project
  // whose alias points elsewhere.
  //
  // This check asserts the CURRENT behaviour so the gap is visible and will fail
  // loudly if it is ever closed — at which point the guard should be updated to
  // require a refusal. It is deliberately not written as a skip: a skip cannot
  // tell anyone the blind spot exists.
  {
    const r = await attempt({ "target.ts": T, "c.ts": "import { target as a } from '@/target'\nexport function f(): number { return a() }\n" }, "src/target.ts")
    check("R5 KNOWN GAP: a tsconfig path alias is NOT caught (indexer records no row for it)",
      r.verdict === "deleted",
      `it now refuses (${r.message.slice(0, 100)}) — the indexer records the alias, so this guard should require a refusal and R5 should be inverted`)
  }
} catch (error) {
  check("M70.P1 session", false, error instanceof Error ? (error.stack ?? error.message) : String(error))
}

console.log(`\nM70.P1: ${failures === 0 ? `PASS (${passed}/${checks})` : `${failures} FAILURES of ${checks}`}`)
process.exit(failures > 0 ? 1 : 0)
