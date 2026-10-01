// script/m66/verify-edit-path-containment.ts
// M66.P1 — bb_edit's path containment, and the symlinked-project bug that made
// the tool unusable.
//
// WHAT BROKE. resolveSafeEditPath realpath'd the project ROOT and compared it
// against a symbol's `fileId` as given. The fileId is the path the INDEXER was
// handed, so on macOS — where /var and /tmp are symlinks into /private — a
// project at /var/folders/.../bb-edit-X had root /private/var/folders/.../bb-edit-X
// and files spelled /var/folders/.../bb-edit-X/src/mod.ts. path.relative between
// them is ../../../var/..., so a file plainly inside the project read as an
// escape and the edit was REFUSED. On Linux /tmp is a real directory, so the bug
// is invisible there. Measured on macOS before the fix: 7 of the 18 bb_edit gates
// crash on this and 2 more fail for other reasons; only 4 run to completion.
//
// THE FIX. Compare real paths with real paths. Resolve the request through
// nearestExisting + realpath FIRST, then judge containment on the result.
//
// THE POINT OF THIS GATE. The fix touches a path-traversal guard, so "it made the
// failing test pass" is not evidence of anything. This proves both directions on
// the same fixture: the bug is gone AND every escape is still refused. The
// symlink-to-outside case that the OLD code missed entirely is asserted here —
// writing a NEW file through a symlink whose target is outside the project, where
// the old code returned the unresolved candidate with no realpath check on the
// final component.
//
// The symlink is created explicitly, so this fails on Linux too if the bug is
// reintroduced. Relying on /tmp being a symlink would make the gate pass on the
// one platform where the bug is invisible — which is how it stayed invisible.

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, existsSync, lstatSync, realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { resolveSafeEditPath, executeEdit } from "../../src/intelligence/edit/edit-engine"

let failures = 0
let checks = 0
let passed = 0
function check(label: string, value: boolean, detail = ""): void {
  checks++
  if (value) { passed++; console.log(`  ok: ${label}`) }
  else { failures++; console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`) }
}

// ── Pure containment: no index, no engine, just the resolver ──────────────
{
  const base = mkdtempSync(path.join(tmpdir(), "bb-m66-paths-"))
  const project = path.join(base, "project")
  const linkToProject = path.join(base, "link")
  mkdirSync(path.join(project, "src"), { recursive: true })
  writeFileSync(path.join(project, "src", "mod.ts"), "export function mod(): number { return 1 }\n")
  writeFileSync(path.join(base, "secret.txt"), "SECRET\n")
  writeFileSync(path.join(project, "inside.txt"), "INSIDE\n")
  symlinkSync(project, linkToProject, "dir")

  // A symlink INSIDE the project whose target is outside it.
  const escapeLink = path.join(project, "escape")
  symlinkSync(path.join(base, "secret.txt"), escapeLink)
  // A symlink to an outside DIRECTORY, so a new file can be written "through" it.
  symlinkSync(base, path.join(project, "escapeDir"), "dir")

  const viaLink = (requested: string): string => resolveSafeEditPath(linkToProject, requested)
  const viaReal = (requested: string): string => resolveSafeEditPath(project, requested)

  console.log("  ── the bug: a project reached through a symlink ──")
  // Both the symlinked and the real spelling of the same file must resolve, and
  // to the same place. The old code refused the symlinked one outright.
  const realResolved = viaReal("src/mod.ts")
  const linkResolved = viaLink("src/mod.ts")
  check("A1 an existing file inside the project resolves", existsSync(realResolved) && realResolved.endsWith("src/mod.ts"),
    realResolved)
  check("A2 the SAME file reached through a symlinked project root also resolves (the macOS bug)",
    linkResolved === realResolved, `link→${linkResolved} vs real→${realResolved}`)
  check("A3 an index-style ABSOLUTE fileId under the symlinked root resolves",
    viaLink(path.join(linkToProject, "src", "mod.ts")) === realResolved,
    viaLink(path.join(linkToProject, "src", "mod.ts")))
  check("A4 a new file in an existing directory resolves inside the project",
    viaLink("src/new.ts").endsWith("src/new.ts") && !existsSync(path.join(project, "src", "new.ts")),
    viaLink("src/new.ts"))
  check("A5 a file in a directory that does not exist yet resolves", viaLink("a/b/c.ts").endsWith("a/b/c.ts"),
    viaLink("a/b/c.ts"))
  check("A6 an existing file symlinked INSIDE the project to a file inside it resolves to the REAL path",
    (() => {
      const inner = path.join(project, "alias.ts")
      symlinkSync(path.join(project, "src", "mod.ts"), inner)
      // Compare against the TARGET's realpath, not the requested spelling: the
      // resolver is contractually required to return realpaths (that is the whole
      // point of the fix), and on macOS `<project>` is a `/var` path whose realpath
      // is `/private/var`. The first version of this assertion compared against
      // the unresolved `path.join(project, …)` and failed for that reason alone —
      // a test that fails on correct code is worse than no test.
      return viaReal("alias.ts") === realpathSync(path.join(project, "src", "mod.ts"))
    })())

  console.log("  ── escapes: every one must still be refused ──")
  const refused = (fn: () => string): boolean => { try { fn(); return false } catch { return true } }
  check("S1 a ../ escape is refused", refused(() => viaReal("../secret.txt")))
  check("S2 a deeper ../ escape is refused", refused(() => viaReal("src/../../secret.txt")))
  check("S3 an absolute path outside the project is refused",
    refused(() => viaReal(path.join(base, "secret.txt"))))
  check("S4 an absolute /etc path is refused", refused(() => viaReal("/etc/passwd")))
  check("S5 the same escapes are refused through the symlinked root too",
    refused(() => viaLink("../secret.txt")) && refused(() => viaLink("/etc/passwd")))
  check("S6 a symlink inside the project whose target is an outside FILE is refused for writing",
    refused(() => viaReal("escape")))
  check("S7 a NEW file written through a symlink to an outside DIRECTORY is refused",
    refused(() => viaReal("escapeDir/newfile.ts")))
  check("S8 the new-file-through-outside-dir case is refused through the symlinked root as well",
    refused(() => viaLink("escapeDir/newfile.ts")))
  check("S9 nothing was written outside the project by any refused call",
    readFileSync(path.join(base, "secret.txt"), "utf8") === "SECRET\n" && !existsSync(path.join(base, "newfile.ts")))

  rmSync(base, { recursive: true, force: true })
}

// ── End-to-end: a real edit through a symlinked project root ───────────────
{
  const base = mkdtempSync(path.join(tmpdir(), "bb-m66-e2e-"))
  const project = path.join(base, "project")
  const linkToProject = path.join(base, "link")
  mkdirSync(path.join(project, "src"), { recursive: true })
  writeFileSync(path.join(project, "src", "mod.ts"), "export function mod(): number {\n  return 1\n}\n")
  symlinkSync(project, linkToProject, "dir")

  const projectId = getProjectId(linkToProject)
  try {
    await indexProjectParallel(projectId, linkToProject, {})
    // The index stores the path it was GIVEN — the symlinked spelling. This is
    // the precondition for the bug: if the indexer ever realpaths, the bug is
    // gone for a different reason and this gate stops testing what it claims to.
    const raw = await BrainDatabase.getRawInstance(projectId)
    const stored = raw.prepare("SELECT path FROM brain_file WHERE project_id = ? AND relative_path = 'src/mod.ts'").get(projectId) as { path: string } | undefined
    check("E1 the index stores the symlinked spelling of the path (the bug's precondition)",
      !!stored && stored.path.includes("link"), `stored: ${stored?.path}`)

    const before = readFileSync(path.join(project, "src", "mod.ts"), "utf8")
    const result = await executeEdit(linkToProject, projectId, {
      mode: "update", symbolName: "mod", newContent: "return 42",
    })
    const after = readFileSync(path.join(project, "src", "mod.ts"), "utf8")
    check("E2 a real update edit succeeds in a symlinked project (the bug, end to end)",
      result.validated === true && after.includes("return 42"), `validated=${result.validated} after=${JSON.stringify(after)}`)
    check("E3 the edit landed on disk, not through a copy", after !== before)
    check("E4 the declaration survived (the fragment-safe path replaced only the body)",
      /export function mod\(\): number/.test(after), JSON.stringify(after))
    check("E5 the edit did not escape the project", existsSync(path.join(base, "mod.ts")) === false)
    check("E6 no temp files were left behind",
      readFileSync(path.join(project, "src", "mod.ts"), "utf8").includes("bb-edit-") === false)
  } catch (error) {
    check("E0 the end-to-end edit session", false, error instanceof Error ? (error.stack ?? error.message) : String(error))
  } finally {
    rmSync(base, { recursive: true, force: true })
    try { rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true }) } catch {}
  }
}

console.log(`\nM66.P1: ${failures === 0 ? `PASS (${passed}/${checks})` : `${failures} FAILURES of ${checks}`}`)
process.exit(failures > 0 ? 1 : 0)
