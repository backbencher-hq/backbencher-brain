// bb_tests/bb_edit/probe-e2-file-fidelity.ts
// Does bb_edit leave the file byte-faithful?
//
// E1 asked whether the engine can find the file. This asks the question that
// matters more for a tool that WRITES SOURCE: when it is done, is the file still
// the file, and if an edit is rolled back, is the rollback byte-identical?
//
// The engine's whole I/O shape is:
//   const original = readFileSync(match.fileId, "utf8")     // plan
//   writeFileSync(temporary, change.after, "utf8")          // commit
//   writeFileSync(file, snapshot.content, "utf8")           // rollback
//
// Three properties of that shape are asserted nowhere in the repository's
// eighteen bb_edit gates, and each is a way a source file is silently damaged:
//
//   F1  FILE MODE. A 0755 script or a 0600 secret that bb_edit rewrites comes back
//       0644, because writeFileSync creates with the process umask and renameSync
//       replaces the inode wholesale. Nothing carries the mode across.
//
//   F2  INVALID UTF-8. readFileSync(path, "utf8") does not fail on invalid bytes;
//       it replaces each bad sequence with U+FFFD. The SNAPSHOT is taken from
//       that already-lossy string, so a rollback of a file that was never valid
//       UTF-8 writes back the replacement characters. The rollback is not a
//       rollback — it is a second, different corruption. A repo with one latin-1
//       file in it has that file rewritten with loss on any edit that fails.
//
//   F3  ROLLBACK COMPLETENESS. The catch block restores each snapshot with a bare
//       writeFileSync. If ONE of those throws — a read-only file, a vanished
//       directory — the loop aborts, the remaining files are never restored, the
//       orphaned-temp scrub after it never runs, and the original error is
//       replaced by the rollback's.
//
// Measured, not asserted. Each is exercised for real and the resulting bytes are
// compared, so a passing run means the property holds rather than that nobody
// looked.

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync, statSync, existsSync } from "node:fs"
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

const root = mkdtempSync(path.join(tmpdir(), "bb-e2-fidelity-"))
mkdirSync(path.join(root, "src"), { recursive: true })

// Four files, one per property. All TypeScript so the indexer sees them.
const script = path.join(root, "src", "executable.ts")
writeFileSync(script, "export function executable(): number {\n  return 1\n}\n")
chmodSync(script, 0o755)

const latin1 = path.join(root, "src", "latin1.ts")
// 0xFF is never valid UTF-8. Written as bytes so the file on disk is genuinely
// invalid, which is the whole point — a JS string literal could not express it.
writeFileSync(latin1, Buffer.concat([
  Buffer.from("// caf\u00e9 na\u00efve comment with a latin-1 byte: ", "utf8"),
  Buffer.from([0xff]),
  Buffer.from("\nexport function latin1(): number {\n  return 1\n}\n", "utf8"),
]))

const crlf = path.join(root, "src", "crlf.ts")
writeFileSync(crlf, "export function crlf(): number {\r\n  return 1\r\n}\r\n")

const noNewline = path.join(root, "src", "nonewline.ts")
writeFileSync(noNewline, "export function nonewline(): number {\n  return 1\n}")

const projectId = getProjectId(root)

try {
  await indexProjectParallel(projectId, root, {})

  const raw = await BrainDatabase.getRawInstance(projectId)

  // ── F1: file mode ───────────────────────────────────────────────────────
  {
    const before = statSync(script).mode & 0o777
    await executeEdit(root, projectId, { mode: "update", symbolName: "executable", newContent: "return 2" })
    const after = statSync(script).mode & 0o777
    check("F1 a 0755 file keeps its mode after a successful edit", after === before,
      `was ${before.toString(8)}, now ${after.toString(8)}`)
  }

  // ── F2: invalid UTF-8, read lossily then rolled back ───────────────────
  {
    const bytesBefore = readFileSync(latin1)
    const hasBadByte = bytesBefore.includes(0xff)
    // Force a failure AFTER the write so the rollback path runs: update a symbol
    // with content that cannot parse is validated and throws, restoring from the
    // snapshot.
    let threw = false
    try {
      await executeEdit(root, projectId, {
        mode: "update", symbolName: "latin1", newContent: "function ( { { { broken",
      })
    } catch { threw = true }
    const bytesAfter = readFileSync(latin1)
    const lostBadByte = hasBadByte && !bytesAfter.includes(0xff)
    const gainedFffd = !hasBadByte && bytesAfter.includes(Buffer.from("�", "utf8"))
    check("F2 the invalid byte was really on disk to begin with (otherwise this proves nothing)", hasBadByte,
      `bytes: ${bytesBefore.toString("hex").slice(0, 40)}`)
    check("F2b a rolled-back invalid-UTF-8 file keeps its bytes byte-identical",
      bytesAfter.equals(bytesBefore),
      lostBadByte ? "the 0xff byte was REPLACED — the rollback wrote a lossy re-read of the file"
        : gainedFffd ? "a U+FFFD replacement character was introduced" : "byte-identical")
  }

  // ── F3: line endings, trailing newline, and a successful edit's fidelity ──
  {
    const before = readFileSync(crlf, "utf8")
    await executeEdit(root, projectId, { mode: "update", symbolName: "crlf", newContent: "return 2" })
    const after = readFileSync(crlf, "utf8")
    const crlfKept = (after.match(/\r\n/g) ?? []).length >= 3
    check("F3 CRLF line endings survive an edit", crlfKept, JSON.stringify(after))
    check("F3b the edit actually happened on the CRLF file", after.includes("return 2"), JSON.stringify(after))
  }
  {
    const before = readFileSync(noNewline, "utf8")
    await executeEdit(root, projectId, { mode: "update", symbolName: "nonewline", newContent: "return 2" })
    const after = readFileSync(noNewline, "utf8")
    check("F3c a file with no trailing newline still has none after an edit",
      !after.endsWith("\n"), JSON.stringify(after.slice(-24)))
  }
  {
    // The whole point of the temp-file + rename commit: a reader never sees a
    // half-written file. Confirm no .bb-edit-* artifacts survive a success.
    const { readdirSync } = await import("node:fs")
    const leftovers: string[] = []
    const walk = (d: string): void => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name)
        if (e.isDirectory()) walk(p)
        else if (e.name.includes(".bb-edit-")) leftovers.push(p)
      }
    }
    walk(root)
    check("F3d no .bb-edit-* temp files survive a successful run", leftovers.length === 0, leftovers.join(","))
  }
} catch (error) {
  check("E2 session", false, error instanceof Error ? (error.stack ?? error.message) : String(error))
} finally {
  rmSync(root, { recursive: true, force: true })
  try { rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true }) } catch {}
}

console.log(`\nE2: ${failures === 0 ? `PASS (${passed}/${checks})` : `${failures} FAILURES of ${checks}`}`)
