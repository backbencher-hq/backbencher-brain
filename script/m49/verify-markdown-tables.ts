// M49.G11 — markdown TABLE-CELL gate: a `|` inside a table cell splits the row.
//
// Why this exists (measured 2026-09-25, M60 oracle-sharpness wave). A review table is how this
// program publishes its evidence, and GFM has one rule that is easy to break without noticing:
// a pipe inside a row ends the cell, EVEN INSIDE A CODE SPAN. So a row that writes a regex or a
// shell alternation as prose —
//
//     | `split(/a|b/)` | the guard never fires |
//
// renders as three cells where the header promised two, and the last cell is silently dropped
// (or the row is not rendered as a table at all). The evidence is still in the file, so every
// other gate passes; only a human reading the rendered page notices the missing cell. Two rows of
// the M60 record had this defect, which is how the class was found; the fix is to escape the pipe
// (`\|`, inert inside code spans too).
//
// What this gate asserts:
//   1. every table row has the same number of cells as its header row (a delimiter row must also
//      agree with the header);
//   2. the count is computed with escapes honoured — `\|` is inert, `\\|` is not (the backslash
//      is escaped, so the pipe ends a cell) — i.e. the scanner reads GFM, not wishful thinking;
//   3. a table ends at the first line that is not a row, so prose is never counted as cells.
//
// Default mode is a CENSUS (exit 0): the 26 rows this gate finds under its default roots are
// PRE-EXISTING, live in other owners' review files, and a gate that fails a tree it did not dirty
// teaches nothing. `--strict` exits 1 on any violation (the mode to use once the debt is paid), and
// `--write` records the census beside the regex census it is modelled on. Registered as M49.G11 in
// validation/m49/ledger.json.
//
// The census numbers are a measured claim, and this gate measured them twice wrong before it could
// be believed: its first cell-width rule counted the two boundary pipes as cells (every row read one
// cell too wide), and its first skip list tested directories for the NAME `.` instead of a `.` prefix,
// so it walked `.merge-tmp/**` and reported copies of real reviews (55 rows/37 files where the tree
// holds 28/19). Both defects were caught by this file's own selftest and by reconciling against an
// independent whole-repo scan — which is what the `--all` mode exists for. Remaining debt, named not
// hidden: the 28 rows are in files this wave did not author, and the gate is not yet appended to the
// `verify` chain in package.json (that file was being edited by another actor at registration time).
//
// Run: bun script/m49/verify-markdown-tables.ts [--strict] [--write] [--selftest] [paths…]
import fs from "node:fs"
import path from "node:path"
import os from "node:os"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..", "..")

export interface Violation {
  file: string
  line: number
  cells: number
  expected: number
  row: string
  /** 1-based positions of this row's INTERIOR pipes — every unescaped pipe except the row's
   *  boundary ones. Those are the pipes a reader can escape to make the row render as written;
   *  pointing at the surplus tail instead would be a true count and a useless hint (the row
   *  `| `split(/x|y/)` | guard |` is wide because of its inner pipe, not its final one). */
  interiorPipes: number[]
}

/** Split a markdown row into cells, honouring backslash escapes. Returns the cell text plus the
 *  1-based position of every pipe that actually ends a cell — so a caller can point at the pipe
 *  that has to be escaped rather than at "the row is wrong". */
export function splitCells(line: string): { cells: string[]; pipes: number[] } {
  const cells: string[] = []
  const pipes: number[] = []
  let cur = ""
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === "\\") { cur += ch + (line[i + 1] ?? ""); i++; continue }
    if (ch === "|") { cells.push(cur); pipes.push(i + 1); cur = ""; continue }
    cur += ch
  }
  cells.push(cur)
  return { cells, pipes }
}

const trimmed = (s: string) => s.replace(/\s+/g, " ").trim()

/** Is this line a table row? A row starts and ends with an unescaped `|` (leading/trailing spaces
 *  allowed). Prose that merely contains a pipe is not a row and must not be counted. */
export function isRow(line: string): boolean {
  const t = line.trim()
  if (!t.startsWith("|") || !t.endsWith("|")) return false
  if (t.length < 2) return false
  // The final `|` must be unescaped: count backslashes immediately before it.
  let backslashes = 0
  for (let i = t.length - 2; i >= 0 && t[i] === "\\"; i--) backslashes++
  return backslashes % 2 === 0
}

/** A delimiter row is `|---|:--:|` and friends: only dashes, colons, pipes and spaces. */
export function isDelimiterRow(line: string): boolean {
  const t = line.trim()
  if (!isRow(t)) return false
  return /^[|\s:-]+$/.test(t) && t.includes("-")
}

/** Scan one markdown document. Pure, so `--selftest` can convict it instead of trusting it. */
export function scanTables(text: string, file = "<memory>"): Violation[] {
  const out: Violation[] = []
  const lines = text.split("\n")
  let headerCells: number | null = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!isRow(line)) { headerCells = null; continue }
    const { pipes } = splitCells(line.trim())
    // A row that starts and ends with an unescaped pipe has N pipes delimiting N-1 cells. The
    // first version wrote `cells.length - 1`, which counted the two BOUNDARY pipes as cells and
    // so read every row one cell wider than it is — the selftest below convicted it.
    const width = pipes.length - 1
    if (headerCells === null) {
      headerCells = width
      continue
    }
    if (width !== headerCells) {
      // A delimiter row of the wrong width is its own defect (the header it belongs to is then
      // not the header GFM renders), and it is reported the same way.
      out.push({
        file, line: i + 1, cells: width, expected: headerCells, row: trimmed(line),
        interiorPipes: pipes.slice(1, -1),
      })
    }
    // The delimiter row is the second row of a table; after it the header is settled either way.
    if (isDelimiterRow(line)) headerCells = headerCells ?? width
  }
  return out
}

function walk(dir: string, acc: string[]): void {
  let entries: fs.Dirent[]
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    // A directory is skipped when it is hidden (`.git`, `.merge-tmp`), a dependency tree, or a
    // scratch directory — the three places where markdown is tooling output, not our record.
    // The first version tested `/^(\.|node_modules|tmp)$/`, which matches a directory named
    // exactly `.` and therefore walked `.merge-tmp/**`: a scratch merge area whose copies of
    // real reviews doubled the census (55/37 where the answer is 28/19) and would have libelled
    // 18 files that do not have the defect. A skip list that reads as "hidden" must test for a
    // PREFIX.
    const hidden = e.name.startsWith(".")
    if (e.isDirectory()) { if (!hidden && e.name !== "node_modules" && e.name !== "tmp") walk(p, acc) }
    else if (e.name.endsWith(".md")) acc.push(p)
  }
}

/** Turn the command line's paths into the file list to scan. Only directories were walked in the
 *  first version, so a path that named a FILE was silently skipped: `… verify-markdown-tables.ts
 *  reviews/x.md` scanned nothing and reported `0 file(s), 0 row(s)` with exit 0 — a gate that
 *  appeared to check a file it never read, which is the defect class this whole gate exists for.
 *  Now a markdown file argument is scanned, and a path that is neither a directory nor a markdown
 *  file is refused instead of vanishing. */
export function collectFiles(paths: string[]): { files: string[]; bad: string[] } {
  const files: string[] = []
  const bad: string[] = []
  for (const r of paths) {
    let st: fs.Stats
    try { st = fs.statSync(r) } catch { bad.push(r); continue }
    if (st.isDirectory()) walk(r, files)
    else if (st.isFile() && r.endsWith(".md")) files.push(r)
    else bad.push(r)
  }
  return { files: [...new Set(files)], bad }
}

function selftest(): number {
  let pass = 0, fail = 0
  const check = (label: string, ok: boolean, detail = "") => { if (ok) pass++; else { fail++; console.log(`FAIL: ${label}${detail ? " — " + detail : ""}`) } }

  const good = "| a | b |\n| --- | --- |\n| 1 | 2 |\n"
  check("selftest: a well-formed table is clean", scanTables(good).length === 0)

  const bad = "| a | b |\n| --- | --- |\n| `split(/x|y/)` | guard |\n"
  const v = scanTables(bad)
  check("selftest: a pipe inside a code span splits the row and is convicted", v.length === 1 && v[0].cells === 3 && v[0].expected === 2,
    JSON.stringify(v))
  check("selftest: the conviction names the row's interior pipes — the ones to escape",
    JSON.stringify(v[0]?.interiorPipes) === JSON.stringify([12, 18]),
    JSON.stringify(v[0]?.interiorPipes))

  const escaped = "| a | b |\n| --- | --- |\n| `split(/x\\|y/)` | guard |\n"
  check("selftest: an escaped pipe is inert and does not convict", scanTables(escaped).length === 0)

  const escapedBackslash = "| a | b |\n| --- | --- |\n| `x\\\\|y` | guard |\n"
  check("selftest: `\\\\|` still ends a cell (the backslash is escaped), so it convicts", scanTables(escapedBackslash).length === 1)

  const wideHeader = "| a | b | c |\n| --- | --- |\n| 1 | 2 | 3 |\n"
  check("selftest: a delimiter row of the wrong width is convicted once", scanTables(wideHeader).length === 1 && scanTables(wideHeader)[0].cells === 2)

  const prose = "Text with a | pipe and no table.\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\nDone | here.\n"
  check("selftest: prose containing pipes is not counted as cells", scanTables(prose).length === 0)

  const second = "| a | b |\n| --- | --- |\n| 1 | 2 |\n\ntext\n\n| c | d |\n| --- | --- |\n| `p|q` | r |\n"
  check("selftest: a second table after prose is scanned with its OWN header width", scanTables(second).length === 1 && scanTables(second)[0].line === 9,
    JSON.stringify(scanTables(second)))

  // Path collection: a file argument must be scanned, and a path that is neither a directory nor
  // markdown must be refused — never quietly turned into "0 files, 0 rows, exit 0".
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "m49-g11-"))
  try {
    const md = path.join(tmpDir, "one.md")
    const txt = path.join(tmpDir, "notes.txt")
    fs.writeFileSync(md, "| a | b |\n| --- | --- |\n| 1 | 2 |\n")
    fs.writeFileSync(txt, "not markdown\n")
    const one = collectFiles([md])
    check("selftest: a markdown FILE argument is scanned (a file is not a silent no-op)", one.files.length === 1 && one.bad.length === 0, JSON.stringify(one))
    const dir = collectFiles([tmpDir])
    check("selftest: a directory argument still walks its markdown", dir.files.length === 1 && dir.files[0] === md, JSON.stringify(dir.files))
    const absent = collectFiles([path.join(tmpDir, "nope.md")])
    check("selftest: a path that does not exist is refused, not silently skipped", absent.files.length === 0 && absent.bad.length === 1)
    const nonMd = collectFiles([txt])
    check("selftest: a non-markdown file argument is refused", nonMd.files.length === 0 && nonMd.bad.length === 1)
    const both = collectFiles([md, path.join(tmpDir, "nope.md")])
    check("selftest: a good path plus a bad path keeps the bad one visible", both.files.length === 1 && both.bad.length === 1)
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }

  console.log(`\nM49.G11 selftest: ${pass} passed, ${fail} failed`)
  return fail > 0 ? 1 : 0
}

function main(): number {
  const args = process.argv.slice(2)
  if (args.includes("--selftest")) return selftest()
  const strict = args.includes("--strict")
  const write = args.includes("--write")
  const paths = args.filter((a) => !a.startsWith("--"))
  // `--all` scans every markdown file in the repository (still excluding node_modules, dot-dirs
  // and tmp/: untracked scratch is not evidence). It exists so the census can be reconciled with
  // an independent whole-repo scan instead of quietly depending on which roots this gate happens
  // to default to — the first version's default roots found 26 rows where a whole-repo probe had
  // found 51, and a gate that under-reports is worse than no gate.
  const all = args.includes("--all")
  const roots = paths.length > 0 ? paths.map((p) => path.resolve(ROOT, p)) : (all ? [ROOT] : ["reviews", "docs", "validation"].map((d) => path.join(ROOT, d)))

  const { files, bad } = collectFiles(roots)
  if (bad.length > 0) {
    // Only a path the CALLER named can be refused: the default roots are directories this gate
    // guarantees, and a tree without one of them is a different problem (the lineage gate's).
    console.error(`REFUSED: ${bad.length} path(s) are neither a directory nor a markdown file: ${bad.map((b) => path.relative(ROOT, b) || b).join(", ")}`)
    return 2
  }
  const violations: Violation[] = []
  let tables = 0, rows = 0
  for (const f of files) {
    const text = fs.readFileSync(f, "utf8")
    const vs = scanTables(text, path.relative(ROOT, f))
    const rowsInFile = text.split("\n").filter(isRow).length
    rows += rowsInFile
    if (vs.length === 0 && rowsInFile > 0) tables++
    violations.push(...vs)
  }
  const byFile = new Map<string, number>()
  for (const v of violations) byFile.set(v.file, (byFile.get(v.file) ?? 0) + 1)
  const record = {
    schemaVersion: 1,
    milestone: "M49",
    gate: "G11",
    title: "markdown table-cell census (an unescaped pipe splits the row)",
    // `path.relative(ROOT, ROOT)` is the empty string, which reads as "no roots" in a census that
    // scanned everything; `.` says the repository root in the one notation a path can carry.
    derivedFrom: { roots: roots.map((r) => path.relative(ROOT, r) || "."), files: files.length, rows, filesWithTables: tables },
    violationCount: violations.length,
    fileCount: byFile.size,
    byFile: [...byFile.entries()].sort((a, b) => b[1] - a[1]).map(([file, rows2]) => ({ file, rows: rows2 })),
    violations,
  }
  if (write) {
    const out = path.join(ROOT, "validation", "m49", "results", "markdown-tables.json")
    fs.mkdirSync(path.dirname(out), { recursive: true })
    fs.writeFileSync(out, JSON.stringify(record, null, 2) + "\n")
    console.log(`wrote ${path.relative(ROOT, out)}`)
  }
  console.log(`M49.G11: ${files.length} file(s), ${rows} table row(s), ${record.violationCount} row(s) with a cell count that does not match their header — ${record.fileCount} file(s)`)
  for (const { file, rows: n } of record.byFile.slice(0, 12)) console.log(`  ${String(n).padStart(3)}  ${file}`)
  if (record.byFile.length > 12) console.log(`  … ${record.byFile.length - 12} more file(s) — see the census above or --write`)
  if (record.violationCount > 0) {
    console.log(`\nDISCLOSED, NOT ENFORCED by default: these rows predate this gate and live in files this wave did not author.`)
    console.log(`Each is fixed by escaping the pipe (\`\\|\`) inside the offending cell. \`--strict\` exits 1 on any of them.`)
  }
  if (strict && record.violationCount > 0) return 1
  return 0
}

process.exitCode = main()
