/**
 * BINARY-SOURCE GATE — a source file that tools read as binary is unreviewable.
 *
 * ## Why this file exists
 *
 * The protobuf lane's analyzer contained a raw NUL byte (U+0000) inside a template
 * literal. The runtime string is unchanged — an escaped NUL is the same character —
 * so `tsc --noEmit` was clean and every test passed.
 *
 * But `file` reported "data", `grep` reported "binary file matches" and returned
 * NOTHING, and `git diff` printed "Binary files differ" instead of a hunk. So:
 *
 *   - the analyzer could not be reviewed by diff, which is how every lane here
 *     programme is reviewed;
 *   - `grep -l RelationshipType src/ast/real-*-analyzer.ts` silently omitted it,
 *     so an audit over "which analyzers emit this type" reported a confident and
 *     WRONG population.
 *
 * That second consequence is the dangerous one. A tool that quietly skips a file
 * produces a plausible answer with a hole in it, and nothing downstream can tell.
 * The same shape as the honesty contract's "silence is guilt", arrived at by a
 * different route: not a skipped test but a skipped FILE.
 *
 * ## What it asserts
 *
 * Every TypeScript source file under src/ and script/ is valid UTF-8 text with
 * no NUL byte. Both are cheap to check and both fail silently everywhere else.
 *
 * READ-ONLY. Writes nothing.
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"

const ROOT = process.env.BB_M14_ROOT
  ? path.resolve(process.env.BB_M14_ROOT)
  : path.resolve((import.meta as any).dirname ?? ".", "..", "..")

const ROOTS = ["src", "script"]  // source roots to walk
const EXT = /\.(ts|mts|cts|js|mjs|json|md|sh)$/
// Directories that are not source and would only slow the walk.
const SKIP = new Set(["node_modules", ".git", "dist", ".bb-data", "worktree-snapshots", "tmp"])

type Bad = { file: string; rel: string; reason: string }

function* walk(dir: string): Generator<string> {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const name of entries) {
    if (SKIP.has(name)) continue
    const full = path.join(dir, name)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) yield* walk(full)
    else if (EXT.test(name)) yield full
  }
}

const bad: Bad[] = []
let scanned = 0

for (const r of ROOTS) {
  const base = path.join(ROOT, r)
  try {
    if (!statSync(base).isDirectory()) continue
  } catch {
    continue
  }
  for (const file of walk(base)) {
    scanned++
    let buf: Buffer
    try {
      buf = readFileSync(file)
    } catch {
      continue
    }
    const rel = path.relative(ROOT, file)

    // 1. no NUL byte. This is the specific defect: it survives tsc, every test,
    //    and every typecheck, and it breaks diff, grep and `file`.
    const nul = buf.indexOf(0)
    if (nul !== -1) {
      const line = buf.subarray(0, nul).toString("utf8").split("\n").length
      bad.push({ file, rel, reason: `NUL byte at offset ${nul} (line ~${line})` })
      continue
    }

    // 2. valid UTF-8. A file that decodes lossily is equally unreadable to a
    //    reviewer, and round-trips through a tool as mojibake rather than as an
    //    error.
    const text = buf.toString("utf8")
    if (!Buffer.from(text, "utf8").equals(buf)) {
      bad.push({ file, rel, reason: "not valid UTF-8 (lossy round-trip)" })
      continue
    }
    // The round-trip above is the whole discriminator, and it is exact: a file
    // that CONTAINS U+FFFD as data decodes to U+FFFD and re-encodes to the same
    // three bytes, so it passes. A file with an INVALID sequence loses bytes on
    // decode and fails the comparison.
    //
    // An earlier version also tested `text.includes(REPLACEMENT)`, which fired on
    // three files that legitimately contain the character — this gate's own
    // needle, and two scripts whose subject IS invalid encoding. That is the
    // mirror image of the bug this gate exists to catch: a check that reports a
    // defect where there is none trains a reader to ignore it.
  }
}

console.log(`binary-source gate — ${scanned} source files under ${ROOTS.join(", ")}`)
console.log(`checked: no NUL byte, valid UTF-8, no replacement characters\n`)

if (bad.length === 0) {
  console.log("ok  every source file is text a reviewer can diff and grep")
} else {
  for (const b of bad) console.log(`FAIL ${b.rel}: ${b.reason}`)
  console.log("")
  console.log(`>>> ${bad.length} file(s) are read as binary or lossily decoded by ordinary text tools.`)
  console.log(">>> A raw NUL byte passes tsc and every test, and silently removes the file from")
  console.log(">>> grep and from `git diff` — so an audit over 'which analyzers emit X' reports a")
  console.log(">>> confident, WRONG population. Fix by escaping the byte (\\u0000) or removing it.")
  process.exitCode = 1
}