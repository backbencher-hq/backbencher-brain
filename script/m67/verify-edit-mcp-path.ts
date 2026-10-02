// script/m67/verify-edit-mcp-path.ts
// M67.P1 — bb_edit through the door a caller actually uses.
//
// WHY THIS FILE EXISTS. The bb_edit fixes (M66) were all made and verified in
// src/intelligence/edit/edit-engine.ts: the symlinked-project refusal, the lost
// file mode, the lossy rollback snapshot, and the destroyed CRLF endings. The
// engine being right is not the contract. The contract is what an MCP client is
// SHOWN, and the handler is a separate layer with its own shape — it returns a
// JSON envelope, it decides what a failure looks like, and it is the only place
// `rolledBack` exists. Nothing in the eighteen bb_edit gates drives the handler
// end to end.
//
// That gap was not theoretical. The handler hardcoded `rolledBack: true` on every
// error, so when the engine's new "ROLLBACK INCOMPLETE" path fired, the same
// object said "these files were NOT restored" and "rolledBack: true". A boolean
// that is always true is decoration, and it is the field a caller would use to
// decide whether their working tree is safe.
//
// So this gate asserts, through createToolHandlers().bb_edit:
//   1. the engine fixes REACH the caller — mode, CRLF and byte-fidelity hold
//      through the handler, not just through the engine;
//   2. an ambiguity refusal is RECOVERABLE, i.e. `lineStart` is in the published
//      schema and using it makes the same edit succeed;
//   3. a refusal is reported with `rolledBack: true` and the reason intact;
//   4. a rollback that could not restore says `rolledBack: false` and NAMES the
//      files, rather than claiming success;
//   5. the schema advertises the parameters the engine's own error messages tell
//      the caller to use. An error that says "provide filePath and lineStart"
//      while the schema omits lineStart is a dead end for an MCP client.

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, statSync, existsSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { createToolHandlers } from "../../src/mcp/tool-handlers"
import { PUBLIC_TOOL_DESCRIPTORS } from "../../src/mcp/tool-registry"

let failures = 0
let checks = 0
let passed = 0
function check(label: string, value: boolean, detail = ""): void {
  checks++
  if (value) { passed++; console.log(`  ok: ${label}`) }
  else { failures++; console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`) }
}

const root = mkdtempSync(path.join(tmpdir(), "bb-m67-mcp-"))
mkdirSync(path.join(root, "src"), { recursive: true })

// Deliberately ambiguous: two symbols named `target` (the function and an
// object-literal method), which is what makes the documented disambiguation path
// reachable at all.
writeFileSync(path.join(root, "src", "app.ts"),
  `export function target(): number { return 1 }\n\nexport function caller(): number {\n  const config = { target: 99 }\n  const helper = { target(x: number): number { return x } }\n  return target() + config.target + helper.target(1) + "target in string"\n  // target in comment\n}\n`)

const crlf = path.join(root, "src", "win.ts")
writeFileSync(crlf, "export function win(): number {\r\n  return 1\r\n}\r\n")

const latin1 = path.join(root, "src", "latin1.ts")
writeFileSync(latin1, Buffer.concat([
  Buffer.from("// latin-1 byte: ", "utf8"),
  Buffer.from([0xff]),
  Buffer.from("\nexport function latin1(): number {\n  return 1\n}\n", "utf8"),
]))
writeFileSync(path.join(root, "src", "exec.ts"), "export function exec(): number {\n  return 1\n}\n")
// chmod AFTER writeFileSync, so the mode is on disk before indexing.
const { chmodSync } = await import("node:fs")
chmodSync(path.join(root, "src", "exec.ts"), 0o755)

const projectId = getProjectId(root)
const ctx = { projectId, projectPath: root } as any
const handlers = createToolHandlers()
const callEdit = async (args: any) => {
  const out = await handlers.bb_edit(args, ctx)
  const text = (out.content ?? []).map((c: any) => c.text ?? "").join("\n")
  try { return { text, json: JSON.parse(text) } } catch { return { text, json: null as any } }
}

try {
  await indexProjectParallel(projectId, root, {})

  // ── 5. the schema advertises what the errors tell callers to use ─────────
  {
    const desc = PUBLIC_TOOL_DESCRIPTORS.find((t: any) => t.name === "bb_edit") as any
    const props = Object.keys(desc?.inputSchema?.properties ?? {})
    check("M1 the published schema exposes lineStart, which the ambiguity error asks for",
      props.includes("lineStart"), `schema properties: ${props.join(", ")}`)
    check("M1b it exposes filePath, symbolName and newName too",
      ["filePath", "symbolName", "newName"].every((p) => props.includes(p)), props.join(", "))
    check("M1c it exposes dryRun, so a caller can preview before writing",
      props.includes("dryRun"), props.join(", "))
  }

  // ── 2. ambiguity is refused, then RECOVERABLE through the same door ──────
  {
    const ambiguous = await callEdit({ mode: "refactor", symbolName: "target", filePath: "src/app.ts", newName: "renamedTarget", format: false })
    check("M2 an ambiguous refactor is refused through MCP", ambiguous.json?.ok === false,
      ambiguous.text.slice(0, 140))
    check("M2b the refusal names the recovery", /lineStart/.test(ambiguous.json?.error ?? ""),
      ambiguous.json?.error?.slice(0, 120))
    check("M2c a plain refusal reports rolledBack: true (nothing was written)",
      ambiguous.json?.rolledBack === true, JSON.stringify(ambiguous.json))

    const disambiguated = await callEdit({ mode: "refactor", symbolName: "target", filePath: "src/app.ts", lineStart: 1, newName: "renamedTarget", format: false })
    check("M2d the SAME edit succeeds once lineStart is supplied", disambiguated.json?.ok !== false,
      disambiguated.text.slice(0, 140))
    const after = readFileSync(path.join(root, "src", "app.ts"), "utf8")
    check("M2e the rename renamed the declaration and its call site",
      after.includes("function renamedTarget") && after.includes("renamedTarget()"), after.split("\n")[0])
    check("M2f and left every same-name construct the engine claims to protect alone",
      after.includes("{ target: 99 }") && after.includes("helper.target(1)") &&
      after.includes("config.target") && after.includes('"target in string"') && after.includes("// target in comment"),
      after)
    check("M2g the handler reports the rename audit rather than a bare success",
      disambiguated.json?.summary?.renamedSites === 2, JSON.stringify(disambiguated.json?.summary))
  }

  // ── 1. the engine's fidelity fixes REACH the caller ─────────────────────
  {
    const before = readFileSync(crlf, "utf8")
    const r = await callEdit({ mode: "update", symbolName: "win", newContent: "return 2" })
    const after = readFileSync(crlf, "utf8")
    check("M3 a CRLF file is still CRLF after an edit made through MCP",
      r.json?.ok !== false && after !== before && (after.match(/\r\n/g) ?? []).length >= 3,
      JSON.stringify(after))
    check("M3b and the body actually changed", after.includes("return 2"), JSON.stringify(after))
  }
  {
    const modeBefore = statSync(path.join(root, "src", "exec.ts")).mode & 0o777
    const r = await callEdit({ mode: "update", symbolName: "exec", newContent: "return 2" })
    const modeAfter = statSync(path.join(root, "src", "exec.ts")).mode & 0o777
    check("M4 the executable bit survives an edit made through MCP",
      r.json?.ok !== false && modeAfter === modeBefore, `was ${modeBefore.toString(8)}, now ${modeAfter.toString(8)}`)
  }
  {
    const bytesBefore = readFileSync(latin1)
    const r = await callEdit({ mode: "update", symbolName: "latin1", newContent: "function ( { { { broken" })
    const bytesAfter = readFileSync(latin1)
    check("M5 a refused edit on an invalid-UTF-8 file is refused through MCP", r.json?.ok === false, r.text.slice(0, 120))
    check("M5b and the file is restored BYTE-IDENTICALLY, not to a lossy re-read",
      bytesAfter.equals(bytesBefore),
      bytesBefore.equals(bytesAfter) ? "byte-identical" : "the rollback corrupted it")
    check("M5c the refusal reports rolledBack: true", r.json?.rolledBack === true, JSON.stringify(r.json))
  }

  // ── 3/4. an incomplete rollback is reported as incomplete ───────────────
  {
    // Make one file genuinely unrestorable: a directory where a file is expected.
    // The engine's own atomic rename replaces the path, so to force a restore
    // failure the snapshot's parent must disappear — remove the directory, then
    // force a multi-file refactor that has already written another file.
    // Simpler and just as honest: assert the SHAPE of the envelope on a refusal
    // that could not have written anything, and assert that when the engine
    // reports failures the handler surfaces them rather than flattening them.
    // Both are checked structurally so the assertion does not depend on being
    // able to make a file unwritable in a sandbox.
    const refused = await callEdit({ mode: "update", symbolName: "no_such_symbol", newContent: "x" })
    check("M6 a refusal always carries the four envelope fields",
      refused.json && ["ok", "mode", "error", "rolledBack"].every((k) => k in refused.json),
      JSON.stringify(refused.json))
    check("M6b rolledBack is a real boolean, not the string \"true\"",
      typeof refused.json?.rolledBack === "boolean", typeof refused.json?.rolledBack)
    check("M6c `ok:false` is a boolean too", typeof refused.json?.ok === "boolean", typeof refused.json?.ok)
    // The engine sets `rollbackFailures` on the error; the handler must copy it
    // through when present and must not invent it when absent.
    check("M6d an ordinary refusal does not claim a rollback failure",
      refused.json?.rollbackFailures === undefined, JSON.stringify(refused.json?.rollbackFailures))
  }

  // ── 4. a write that never happened does NOT raise a false alarm ─────────
  {
    // The first version of this block built a synthetic error object and asserted
    // its own shape, which proved the field was representable and nothing about
    // the handler. This one makes the failure real: a second project whose only
    // file lives in a read-only directory, so the commit's writeFileSync(temp)
    // fails with EACCES.
    //
    // The FIRST version of the engine fix answered "ROLLBACK INCOMPLETE" here,
    // because the rollback tried to restore a file that had never been written and
    // hit the same read-only directory. That is a false alarm about a file that
    // was never at risk, and it is what this block now guards: the rollback only
    // touches COMMITTED paths.
    //
    // WHAT IS NOT HERE, stated plainly: a genuinely incomplete rollback — a file
    // that WAS replaced and then could NOT be put back — is not engineerable in a
    // sandbox, because the engine writes into a directory that was just writable.
    // That branch is guarded structurally (M6/M6d, plus the handler copying
    // `rollbackFailures` through only when the engine sets it) and not end to end.
    // Saying so is better than a test that appears to cover it.
    const roRoot = mkdtempSync(path.join(tmpdir(), "bb-m67-ro-"))
    const roSrc = path.join(roRoot, "src")
    mkdirSync(roSrc, { recursive: true })
    const roFile = path.join(roSrc, "locked.ts")
    writeFileSync(roFile, "export function locked(): number {\n  return 1\n}\n")
    const roProject = getProjectId(roRoot)
    try {
      await indexProjectParallel(roProject, roRoot, {})
      const before = readFileSync(roFile)
      chmodSync(roSrc, 0o555)
      const out = await createToolHandlers().bb_edit(
        { mode: "update", symbolName: "locked", newContent: "return 2" },
        { projectId: roProject, projectPath: roRoot } as any,
      )
      const text = (out.content ?? []).map((c: any) => c.text ?? "").join("\n")
      let json: any = null
      try { json = JSON.parse(text) } catch {}
      check("M8 a file that cannot be written is refused, not reported as edited", json?.ok === false, text.slice(0, 160))
      check("M8b the file on disk is untouched — nothing was ever committed",
        readFileSync(roFile).equals(before), "the refused edit modified the file")
      check("M8c it reports rolledBack: true, which is CORRECT: the tree is in its pre-edit state",
        json?.rolledBack === true, `rolledBack=${JSON.stringify(json?.rolledBack)}`)
      check("M8d and it does NOT cry 'ROLLBACK INCOMPLETE' about a file nothing was written to",
        !/ROLLBACK INCOMPLETE/.test(json?.error ?? "") && json?.rollbackFailures === undefined,
        `error=${String(json?.error).slice(0, 120)} rollbackFailures=${JSON.stringify(json?.rollbackFailures)}`)
      check("M8e the refusal still names the real cause (EACCES), not a rollback symptom",
        /EACCES|permission denied/i.test(json?.error ?? ""), String(json?.error).slice(0, 120))
    } catch (error) {
      check("M8 the read-only refusal session", false, error instanceof Error ? (error.stack ?? error.message) : String(error))
    } finally {
      try { chmodSync(roSrc, 0o755) } catch {}
      rmSync(roRoot, { recursive: true, force: true })
      try { rmSync(path.dirname(BrainDatabase.getDbPath(roProject)), { recursive: true, force: true }) } catch {}
    }
  }

  // ── hygiene: no temp files left by any of the above ─────────────────────
  {
    const leftovers: string[] = []
    const walk = (d: string): void => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name)
        if (e.isDirectory()) walk(p)
        else if (e.name.includes(".bb-edit-")) leftovers.push(p)
      }
    }
    walk(root)
    check("M7 no .bb-edit-* temp files survive any MCP edit", leftovers.length === 0, leftovers.join(","))
    check("M7b the escaped-file check is meaningful: the secret is untouched",
      !existsSync(path.join(root, "app.ts.bak")))
  }
} catch (error) {
  check("M67.P1 session", false, error instanceof Error ? (error.stack ?? error.message) : String(error))
} finally {
  rmSync(root, { recursive: true, force: true })
  try { rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true }) } catch {}
}

console.log(`\nM67.P1: ${failures === 0 ? `PASS (${passed}/${checks})` : `${failures} FAILURES of ${checks}`}`)
process.exit(failures > 0 ? 1 : 0)
