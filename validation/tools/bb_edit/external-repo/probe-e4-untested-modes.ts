// bb_tests/bb_edit/probe-e4-untested-modes.ts
// The four bb_edit modes I have never exercised.
//
// Everything this lane has done so far went through `update` and `refactor`. The
// other three modes, and `dryRun`, are untested by me — and for a tool that
// WRITES SOURCE an untested mode is not a neutral unknown, it is an untested way
// to lose someone's work.
//
//   dryRun   the preview promise. If a dry run writes to disk, every other
//            guarantee here is decorative, because the one operation a caller
//            reaches for when they are unsure is the one that must be safe.
//   write    replaces an ENTIRE file. There is no diff, no merge, and the
//            in-memory snapshot that makes rollback possible dies with the
//            process — so this is the only mode whose mistakes are irreversible.
//   delete   the dangling-reference guard, including `force`.
//   insert   four positions (before / after / inside-top / inside-bottom) against
//            a brace body, an empty body, and a single-line body.
//
// Each is checked by reading the file back and comparing BYTES, and each mode's
// line endings are checked too, because the CRLF fix (M66) was applied to the
// `update` splice and the `insert` splice and NOT to `write` or `delete`.

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, statSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const REPO = process.env.BB_REPO
const { executeEdit } = await import(path.join(REPO, "src/intelligence/edit/edit-engine.ts"))
const { getProjectId } = await import(path.join(REPO, "src/cli/index.ts"))
const { indexProjectParallel } = await import(path.join(REPO, "src/ast/parallel-indexer.ts"))
const { BrainDatabase } = await import(path.join(REPO, "src/brain/database.ts"))

let failures = 0
let checks = 0
let passed = 0
function check(label: string, value: boolean, detail = ""): void {
  checks++
  if (value) { passed++; console.log(`  ok: ${label}`) }
  else { failures++; console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`) }
}

const root = mkdtempSync(path.join(tmpdir(), "bb-e4-modes-"))
mkdirSync(path.join(root, "src"), { recursive: true })
const p = (n: string) => path.join(root, "src", n)

writeFileSync(p("target.ts"), "export function target(): number {\n  return 1\n}\n")
// The import is ALIASED deliberately. Importing `{ target }` under its own name
// makes the name ambiguous project-wide — the indexer stores a symbol for the
// import specifier too — and BOTH `delete` and `refactor` then refuse with
// "provide filePath and lineStart". That is correct behaviour (the first version
// of this probe tripped over it and it read like a delete defect), but the
// fixture has to keep the caller's reference to `target` while leaving the NAME
// unique, which is what an alias does.
writeFileSync(p("caller.ts"),
  "import { target as aliased } from './target'\nexport function caller(): number { return aliased() }\n")
writeFileSync(p("crlf.ts"), "export function crlf(): number {\r\n  return 1\r\n}\r\n")
writeFileSync(p("empty.ts"), "export function empty(): number {}\n")
writeFileSync(p("oneline.ts"), "export function oneline(): number { return 1 }\n")
writeFileSync(p("lonely.ts"), "export function lonely(): number {\n  return 1\n}\n")
writeFileSync(p("wmode.ts"), "export function wmode(): number {\n  return 1\n}\n")

const projectId = getProjectId(root)

try {
  await indexProjectParallel(projectId, root, {})

  // ── dryRun: the preview must not write ─────────────────────────────────
  console.log("  ── dryRun ──")
  {
    const before = readFileSync(p("target.ts"))
    const beforeMode = statSync(p("target.ts")).mode
    const r: any = await executeEdit(root, projectId, { mode: "update", symbolName: "target", newContent: "return 999", dryRun: true })
    const after = readFileSync(p("target.ts"))
    check("D1 a dryRun leaves the file byte-identical", after.equals(before),
      `file changed: ${JSON.stringify(after.toString("utf8"))}`)
    check("D1b a dryRun leaves the file mode alone", statSync(p("target.ts")).mode === beforeMode)
    check("D1c a dryRun reports dryRun: true", r.dryRun === true, JSON.stringify(r.dryRun))
    check("D1d a dryRun does NOT claim it validated or reindexed",
      r.validated === false && r.reindexed === false, `validated=${r.validated} reindexed=${r.reindexed}`)
    check("D1e a dryRun still returns the planned change, so a preview is possible",
      Array.isArray(r.changes) && r.changes.length === 1, `${r.changes?.length} changes`)
    // The preview must describe the edit that WOULD happen, or it is worse than
    // no preview: a caller reads it, approves, and gets something else.
    const previewAfter = r.changes?.[0]?.after
    const real = await executeEdit(root, projectId, { mode: "update", symbolName: "target", newContent: "return 999" })
    const realAfter = readFileSync(p("target.ts"), "utf8")
    check("D1f the preview's `after` matches what the real edit actually produced",
      previewAfter === realAfter,
      `preview=${JSON.stringify(String(previewAfter).slice(0, 90))}\n            real   =${JSON.stringify(realAfter.slice(0, 90))}`)
  }

  // ── write: replaces an entire file ─────────────────────────────────────
  console.log("  ── write ──")
  {
    const r: any = await executeEdit(root, projectId, {
      mode: "write", filePath: "src/wmode.ts", content: "export function wmode(): number {\n  return 42\n}\n",
    })
    const after = readFileSync(p("wmode.ts"), "utf8")
    check("W1 write replaces the file's contents", after.includes("return 42"), JSON.stringify(after))
    check("W1b write reports exactly one change", r.changes.length === 1)
    check("W1c write reports validated and reindexed", r.validated === true && r.reindexed === true)
    // A NEW file, in a directory that does not exist yet.
    await executeEdit(root, projectId, { mode: "write", filePath: "src/brand/new.ts", content: "export function fresh(): number { return 7 }\n" })
    check("W2 write creates a new file in a new directory", readFileSync(p("brand/new.ts"), "utf8").includes("return 7"))
    // The path guard must still apply to write, which is the mode that can
    // create a file anywhere.
    for (const bad of ["../escape.ts", "/tmp/bb-e4-escape.ts", "src/../../escape.ts"]) {
      let refused = false
      try { await executeEdit(root, projectId, { mode: "write", filePath: bad, content: "x" }) } catch { refused = true }
      check(`W3 write refuses an escaping path: ${bad}`, refused)
    }
    check("W3b and nothing was written outside the project", !readdirSync(path.dirname(root)).includes("escape.ts"))
    // CRLF: the write mode takes caller content verbatim, so the question is
    // whether a CRLF file written with LF content is normalized or preserved.
    const crlfBefore = readFileSync(p("crlf.ts"))
    await executeEdit(root, projectId, { mode: "write", filePath: "src/crlf.ts", content: "export function crlf(): number {\r\n  return 5\r\n}\r\n" })
    const crlfAfter = readFileSync(p("crlf.ts"))
    check("W4 write preserves CRLF when given CRLF content", (crlfAfter.toString("utf8").match(/\r\n/g) ?? []).length === 3,
      JSON.stringify(crlfAfter.toString("utf8")))
    void crlfBefore
  }

  // ── delete: the dangling-reference guard ───────────────────────────────
  console.log("  ── delete ──")
  {
    // `caller` calls `target`, but the index may or may not have the edge. The
    // guard is the AST scan of the POST-delete content, so it must refuse.
    let refused = false
    let msg = ""
    try { await executeEdit(root, projectId, { mode: "delete", symbolName: "target" }) }
    catch (e: any) { refused = true; msg = String(e?.message ?? e) }
    check("D2 deleting a symbol with live references is refused", refused, msg.slice(0, 120))
    check("D2b the refusal names the surviving references", /reference|caller|force/i.test(msg), msg.slice(0, 160))
    check("D2c the file is untouched after the refusal", readFileSync(p("target.ts"), "utf8").includes("return 1"))

    const forced: any = await executeEdit(root, projectId, { mode: "delete", symbolName: "target", force: true })
    const after = readFileSync(p("target.ts"), "utf8")
    check("D3 force deletes it anyway", !after.includes("function target"), JSON.stringify(after))
    check("D3b and force is AUDITED, never silent", (forced.warnings ?? []).some((w: string) => /reference/i.test(w)),
      JSON.stringify(forced.warnings))
    check("D3c the warning names the file that still references it", (forced.warnings ?? []).some((w: string) => w.includes("caller.ts")),
      JSON.stringify(forced.warnings))
    // A genuinely unreferenced symbol deletes cleanly, with no ceremony.
    const lonely: any = await executeEdit(root, projectId, { mode: "delete", symbolName: "lonely" })
    check("D4 a caller-less symbol deletes with no spurious warning", (lonely.warnings ?? []).length === 0,
      JSON.stringify(lonely.warnings))
  }

  // ── insert: four positions × three body shapes ─────────────────────────
  console.log("  ── insert ──")
  {
    for (const position of ["before", "after", "inside-top", "inside-bottom"] as const) {
      const file = p(`ins-${position}.ts`)
      writeFileSync(file, "export function host(): number {\n  const a = 1\n  return a\n}\n")
      await indexProjectParallel(projectId, root, { paths: [`src/ins-${position}.ts`] } as any)
      const r: any = await executeEdit(root, projectId, {
        mode: "insert", targetSymbolName: "host", position, newContent: "injected();", format: false,
      })
      const after = readFileSync(file, "utf8")
      const ok = r.changes?.length === 1 && after.includes("injected();")
      check(`I1 insert ${position} lands the content`, ok, JSON.stringify(after).slice(0, 130))
      if (position.startsWith("inside")) {
        // It must go INSIDE the braces, not after the closing one.
        const brace = after.indexOf("}")
        const at = after.indexOf("injected();")
        check(`I1${position === "inside-top" ? "b" : "c"} it is inside the body, not appended after it`,
          at >= 0 && at < brace, `injected at ${at}, closing brace at ${brace}`)
        check(`I1${position === "inside-top" ? "c" : "d"} it parses: the original declaration survived`,
          after.includes("function host"))
      }
    }
    // An empty `{}` body and a single-line body are the two shapes the engine
    // explicitly branches on, and both are easy to leave broken.
    for (const [name, label] of [["empty", "empty {}"], ["oneline", "single-line"]] as const) {
      const file = p(`${name}.ts`)
      const before = readFileSync(file, "utf8")
      let r: any = null
      let err = ""
      try { r = await executeEdit(root, projectId, { mode: "insert", targetSymbolName: name, position: "inside-top", newContent: "injected();", format: false }) }
      catch (e: any) { err = String(e?.message ?? e) }
      const after = readFileSync(file, "utf8")
      check(`I2 insert into a ${label} body either works or refuses LOUDLY — never half-applies`,
        err !== "" ? after.equals(before) : after.includes("injected();"),
        err ? `refused: ${err.slice(0, 100)}` : JSON.stringify(after).slice(0, 130))
      void r
    }
  }

  // ── hygiene ────────────────────────────────────────────────────────────
  {
    const leftovers: string[] = []
    const walk = (d: string): void => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const q = path.join(d, e.name)
        if (e.isDirectory()) walk(q)
        else if (e.name.includes(".bb-edit-")) leftovers.push(q)
      }
    }
    walk(root)
    check("H no .bb-edit-* temp files survive any of these modes", leftovers.length === 0, leftovers.join(","))
  }
} catch (error) {
  check("E4 session", false, error instanceof Error ? (error.stack ?? error.message) : String(error))
} finally {
  rmSync(root, { recursive: true, force: true })
  try { rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true }) } catch {}
}

console.log(`\nE4: ${failures === 0 ? `PASS (${passed}/${checks})` : `${failures} FAILURES of ${checks}`}`)
process.exit(failures > 0 ? 1 : 0)
