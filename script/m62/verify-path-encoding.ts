#!/usr/bin/env tsx
// script/m62/verify-path-encoding.ts — find the sites that turn a module URL into
// a filesystem path WITHOUT decoding it.
//
// THE DEFECT. A WHATWG URL's `pathname` is percent-encoded. A repository path
// containing a space therefore arrives percent-encoded, which is not a directory
// anyone can open. Measured live on 2026-10-08, in this repo, whose path is
// `$HOME/Documents/Default Project/ishaq/backbencher-brain`,
// in ide/vscode/publish-openvsx.mjs:
//
//   const here = path.dirname(new URL(import.meta.url).pathname)
//
// every existsSync() below then answered about a directory that does not exist,
// and the E4 gate reported "VSIX not found at .../Default%20Project/..." — which
// reads like a missing build artifact rather than a missing decode. The owner was
// told to run the E4 verifier first, for an artifact that had already been built.
// Replacing that line with fileURLToPath took E4 from 55/56 to 56/56.
//
// WHY A GATE. 106 files used the idiom, and some of them already carried a
// comment explaining why the naive form is wrong — the class was understood,
// fixed in a few places, and left everywhere else. Nothing counted it, so it
// could not shrink. A gate that merely COUNTS would be a gate that cannot fail,
// so this one fails on any site in code that ships or gates, and reports the rest
// as a named backlog.
//
// COMMENTS ARE NOT CODE, AND THIS DETECTOR KNOWS IT. The first version of this
// gate reported four "failures" in shipping code and all four were its own
// explanation of the defect: two comment lines in the file it had just fixed and
// two lines of its own self-test. A text scan that flags the prose describing a
// bug is the same self-reference as a lint that matches its own pattern string,
// and it is unsatisfiable. So the scan runs over CODE ONLY — comments and string
// bodies blanked, offsets preserved so line numbers stay true.
//
// BUT THE EXCLUSION MUST NOT HIDE ANYTHING. Blanking comments means a line could
// in principle swallow a real hit after it, so the gate runs BOTH scans and
// reports every occurrence the code scan suppressed. A suppressed hit is
// downgraded from FAIL to a printed line, never to silence. And the scanner has
// to survive a division operator, or `const x = a / b; const here = <the idiom>`
// would have its real hit eaten as a line comment.
//
// KNOWN LIMITATION, STATED RATHER THAN HIDDEN. The regex-vs-division decision
// uses the standard previous-token heuristic, not a full parser. A `/` in an
// exotic position could still be misread. The dual scan is what bounds the damage:
// anything swallowed is printed with its file and line, so a wrong guess is
// visible on the gate's own output instead of silently green.

import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import {
  PATTERN,
  UNREADABLE_DIRS,
  blankCommentsAndStrings,
  findCodeHits,
  findRawHits,
  walkSourceFiles,
} from "./path_encoding_scan.ts"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"

type Check = { name: string; ok: boolean; detail: string }
const checks: Check[] = []
const check = (name: string, ok: boolean, detail: string): void => {
  checks.push({ name, ok, detail })
  console.log(`  ${ok ? "ok  " : "FAIL"}: ${name} — ${detail}`)
}

// --- the self-tests. These are the gate's proof that it can see a defect -----
{
  const real = 'const here = path.dirname(new URL(import.meta.url).pathname)'
  check("detector sees the idiom in real code", findCodeHits(real).length === 1, `${findCodeHits(real).length} hit(s)`)

  const commented = [
    "// The old form was: new URL(import.meta.url).pathname — percent-encoded, so",
    "/* and block comments too: new URL(import.meta.url).pathname */",
    'const a = "new URL(import.meta.url).pathname"',
  ].join("\n")
  check(
    "detector does NOT flag a mention inside a comment or a string",
    findCodeHits(commented).length === 0,
    `${findCodeHits(commented).length} hit(s)`,
  )
  check(
    "…but the raw scan still sees those mentions (the exclusion reports, it does not delete)",
    findRawHits(commented).length === 3,
    `${findRawHits(commented).length} raw hit(s)`,
  )

  const trailing = 'const here = path.dirname(new URL(import.meta.url).pathname) // and a trailing comment'
  check("a trailing comment does not hide a real hit", findCodeHits(trailing).length === 1, `${findCodeHits(trailing).length} hit(s)`)

  const division = 'const x = a / b; const here = path.dirname(new URL(import.meta.url).pathname)'
  check(
    "a DIVISION slash does not swallow the rest of the line",
    findCodeHits(division).length === 1,
    `${findCodeHits(division).length} hit(s) — if 0, the scanner ate a real defect`,
  )

  const interpolated = 'const p = `${new URL(import.meta.url).pathname}/x`'
  check("an interpolated path is CODE and is still seen", findCodeHits(interpolated).length === 1, `${findCodeHits(interpolated).length} hit(s)`)

  const good = 'const here = path.dirname(fileURLToPath(import.meta.url))'
  check("the correct idiom (fileURLToPath) is never flagged", findCodeHits(good).length === 0, "no false positive on the fix")

  const https = 'const u = "https://example.com/x"; const y = 1'
  check("a // inside a string does not start a comment", findCodeHits(https).length === 0, "no false comment")

  const re = 'const re = /a\\/b/; const z = new URL(import.meta.url).pathname'
  check("a regex literal does not start a comment", findCodeHits(re).length === 1, `${findCodeHits(re).length} hit(s)`)

  // REGRESSION, both found live on 2026-10-08 by this gate scanning its own source.
  //
  // 1. A template containing an interpolation with a ternary leaked a phantom
  //    template frame, so every later backtick closed the wrong frame and the rest
  //    of the FILE was blanked as string content — hiding real code, which is the
  //    one thing this scanner must never do.
  const leak =
    'const label = `  ${ok ? "ok" : "FAIL"}: ${name}`\n' +
    "const here = path.dirname(new URL(import.meta.url).pathname)\n"
  check(
    "a template with a ternary does not swallow the lines after it",
    findCodeHits(leak).length === 1,
    `${findCodeHits(leak).length} hit(s) — 0 means the file was blanked`,
  )
  // 2. `const x = a / b` read the stale `=` as "a regex may follow", so everything
  //    after the slash was eaten as a regex body.
  check(
    "division after an identifier is not read as a regex",
    findCodeHits("const x = a / b; const here = path.dirname(new URL(import.meta.url).pathname)").length === 1,
    "the real hit after a division survives",
  )
  // 3. A shebang must not be read as a regex either.
  check(
    "a shebang line does not open a frame",
    findCodeHits('#!/usr/bin/env tsx\nconst here = path.dirname(new URL(import.meta.url).pathname)\n').length === 1,
    "the hit on the next line survives",
  )
}

// --- walk the repository ---------------------------------------------------
const ROOT = process.cwd()

// Directories whose code SHIPS or GATES. A defect here is a defect in the product
// or in the thing that judges the product.
const SHIPPING = ["ide", "src", "bin", "website/src", "script/lib", "script/m62"]

interface Hit {
  file: string
  line: number
  shipping: boolean
}
const codeHits: Hit[] = []
const suppressed: Hit[] = []
const scanned = walkSourceFiles(ROOT)
for (const f of scanned) {
  const rel = path.relative(ROOT, f)
  const text = readFileSync(f, "utf8")
  const shipping = SHIPPING.some((s) => rel === s || rel.startsWith(`${s}/`))
  for (const h of findCodeHits(text)) codeHits.push({ file: rel, line: h.line, shipping })
  const inCode = new Set(findCodeHits(text).map((h) => h.line))
  for (const h of findRawHits(text)) if (!inCode.has(h.line)) suppressed.push({ file: rel, line: h.line, shipping })
}

const shippingHits = codeHits.filter((h) => h.shipping)
const backlogHits = codeHits.filter((h) => !h.shipping)

// --- THE GATE PROVES IT CAN SEE A DEFECT IN A TREE IT WALKS ----------------
//
// This leg exists because the gate was once green while examining nothing.
// `readdirSync` had never been imported into the scan module; the walk's bare
// `catch { return out }` swallowed the ReferenceError and returned an empty
// array; and the gate reported "0 defects in code that ships or gates" and
// exited 0. Nothing in the gate noticed, because every assertion about the
// repository's cleanliness was trivially satisfied by scanning zero files.
//
// So: plant the defect in a real directory, walk it the way the repository is
// walked, and require that it is found. A walk that cannot find a planted defect
// must not be permitted to certify anything.
{
  const dir = mkdtempSync(path.join(tmpdir(), "path-encoding-selftest-"))
  try {
    writeFileSync(
      path.join(dir, "planted.ts"),
      "const here = path.dirname(new URL(import.meta.url).pathname)\n",
      "utf8",
    )
    writeFileSync(
      path.join(dir, "mention-only.ts"),
      "// mentions new URL(import.meta.url).pathname only\nconst here = fileURLToPath(import.meta.url)\n",
      "utf8",
    )
    writeFileSync(path.join(dir, "notes.md"), "new URL(import.meta.url).pathname\n", "utf8")

    const walked = walkSourceFiles(dir)
    let planted = 0
    let mentioned = 0
    for (const f of walked) {
      const n = findCodeHits(readFileSync(f, "utf8")).length
      if (path.basename(f) === "planted.ts") planted = n
      if (path.basename(f) === "mention-only.ts") mentioned = n
    }
    check("the walk FINDS a defect planted in a real directory", planted === 1, `${planted} hit(s) in planted.ts`)
    check("the walk does not flag a comment that only mentions the idiom", mentioned === 0, `${mentioned} hit(s) in mention-only.ts`)
    check("the walk ignores files that are not source", !walked.some((f) => f.endsWith("notes.md")), "notes.md was not walked as source")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// --- the defect is live in THIS checkout, not hypothetical -------------------
{
  const repoHasSpace = / /.test(ROOT)
  check(
    "this checkout's path contains a space, so the defect can actually fire here",
    repoHasSpace,
    repoHasSpace ? ROOT : `*** NO SPACE in ${ROOT} — the defect cannot fire and this gate proves nothing ***`,
  )
  const encoded = new URL(`file://${ROOT}`).pathname
  check(
    "the encoded form really differs from the real path (the mechanism, shown)",
    encoded !== ROOT && encoded.includes("%20"),
    `real=${ROOT}  encoded=${encoded}`,
  )
}

// THE REPOSITORY-SCOPED ASSERTION MUST BE SHOWN ABLE TO FAIL. The self-tests above
// prove the SCANNER sees a planted defect; this proves the top-level VERDICT goes
// red for one, inside the repository rather than in a temp directory — which is the
// scope at which the previous version wrongly reported green.
{
  const dir = path.join(ROOT, `.tmp-gate-selftest-${process.pid}`)
  mkdirSync(dir, { recursive: true })
  try {
    writeFileSync(path.join(dir, "planted.ts"), "const h = new URL(import.meta.url).pathname\n", "utf8")
    const plantedPath = path.join(dir, "planted.ts")
    const plantedHits = findCodeHits(readFileSync(plantedPath, "utf8")).length
    check(
      "a defect planted INSIDE the repository is detected (the verdict can go red)",
      plantedHits === 1,
      `${plantedHits} hit(s) at repository scope — 0 would mean the check cannot fail`,
    )
    const walksIt = walkSourceFiles(ROOT).includes(plantedPath)
    check("…and the repository walk reaches the planted file", walksIt, walksIt ? "walked" : "*** the walk missed it ***")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// A gate that read nothing must not say the repository is clean.
check(
  "the walk actually read the repository (not an empty scan reported as clean)",
  scanned.length > 0,
  scanned.length > 0 ? `${scanned.length} source file(s) read` : "*** ZERO FILES SCANNED — every verdict below is vacuous ***",
)
check(
  "every directory was readable (an unscanned tree is never called clean)",
  UNREADABLE_DIRS.length === 0,
  UNREADABLE_DIRS.length === 0 ? "no directory failed to list" : `*** ${UNREADABLE_DIRS.length}: ${UNREADABLE_DIRS.slice(0, 3).join("; ")} ***`,
)

// THE GATE FAILS ON A DEFECT ANYWHERE, NOT ONLY WHERE IT SHIPS.
//
// An earlier version failed only for `ide/ src/ bin/ website/src/ script/lib/
// script/m62` and merely PRINTED the rest as a backlog. Measured consequence: five
// defects planted in `.tmp-determinism/` — real code, real source files, a
// directory the walk covered — and the check reported
//
//   ok: no undecoded URL.pathname in code that ships or gates — 5 site(s) remain
//
// Green, with the defects sitting in the tree. That is a pass/fail boundary drawn
// around the work rather than around the defect, and it is the same error as
// lowering a threshold: the report reads clean while the repository is not.
//
// The scope distinction is still worth knowing — a defect in `ide/` breaks the
// product, one in an old gate script breaks a gate — so it is reported as detail.
// But it is detail, not a boundary. Now that the sweep has actually fixed all of
// them, the honest assertion needs no carve-out to pass.
const allHits = codeHits
check(
  "no undecoded URL.pathname in ANY source file in the repository",
  allHits.length === 0,
  allHits.length === 0
    ? `${scanned.length} file(s) scanned; ${shippingHits.length} shipping, ${backlogHits.length} elsewhere — none with the defect`
    : `*** ${allHits.length} defect(s) across ${new Set(allHits.map((h) => h.file)).size} file(s): ${allHits
        .slice(0, 10)
        .map((h) => `${h.file}:${h.line}`)
        .join(", ")}${allHits.length > 10 ? ", …" : ""} ***`,
)

// Nothing is swallowed: every occurrence the code scan did not count is printed.
if (suppressed.length > 0) {
  const uniq = new Map<string, number>()
  for (const h of suppressed) uniq.set(h.file, h.line)
  console.log(`\n  SUPPRESSED MENTIONS — ${suppressed.length} occurrence(s) in comments/strings, listed not hidden:`)
  for (const [file, line] of [...uniq].sort()) console.log(`    ${file}:${line}`)
}

if (backlogHits.length > 0) {
  const byDir = new Map<string, number>()
  for (const h of backlogHits) {
    const d = h.file.split("/").slice(0, 2).join("/")
    byDir.set(d, (byDir.get(d) ?? 0) + 1)
  }
  console.log(`\n  UNFIXED BACKLOG — ${backlogHits.length} real site(s) in older gate scripts:`)
  for (const [d, n] of [...byDir].sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(4)}  ${d}/`)
  console.log(`    Each is broken on a checkout whose path contains a space. Not counted as a pass.`)
}

const failed = checks.filter((c) => !c.ok).length
console.log(`\nPATH ENCODING: ${failed === 0 ? "PASS" : `FAILED (${failed} check(s))`}`)
process.exit(failed === 0 ? 0 : 1)