/**
 * M60 — fabricated `calls` targets that cannot be command names.
 *
 * FOUND BY, and this is the reason it exists: an adversarial probe of the F9
 * completeness spec's `internal_silent` bucket. The spec's own verification
 * sentence claims "a file of pure arithmetic publishes no edges and no symbols",
 * which is false, and probing WHY produced a real defect:
 *
 *     $xs = 1..3
 *       -> contains t.ps1 -> xs                              (correct)
 *       -> calls   t.ps1 -> 1..3                            (FABRICATED)
 *
 * The mechanism is the GRAMMAR's, and it is worth being precise about which half
 * is at fault. `command_name`'s character class is
 * `/[^\{\}\(\);,\|\&`"'\s\r\n\[\]\+\-\*\/\$@<\!]+/`, which allows digits and `.`.
 * So `1..3` lexes as one `command_name`, the tree contains a `command` node, and
 * the analyzer publishes a `calls` edge naming a RANGE OPERATOR as a callee. The
 * analyzer is reporting the tree faithfully; the tree is wrong. This is the same
 * fabrication family the lane has already paid for twice (G7's path fragments,
 * G8's recovery reads), and it is INVISIBLE to every error-keyed gate because the
 * file parses cleanly.
 *
 * Why measure it rather than fix it blind: `$x = 1..N` is one of the commonest
 * idioms in PowerShell, so the footprint decides whether this is a guard clause
 * or a grammar change. A guard is safe (no lexer movement); a `command_name`
 * narrowing is NOT, and G10 is the standing record of what moving that token costs.
 */
import { execSync } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../src/ast/pool-worker"

const ROOT = process.cwd()
const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const REPOS = (process.env.BB_ONLY_REPO ? [process.env.BB_ONLY_REPO] : ["powershell", "ansible"])
const EXTS = ["ps1", "psm1", "psd1"]
const OUT = path.join(ROOT, "validation/m60/results/powershell-fabricated-calls.json")

/**
 * A `calls` target that cannot name a command. PowerShell command names begin
 * with a letter, `_`, `.` (dot-sourcing) or `&`/`%`/`{` (operators that are not
 * commands at all), and may contain digits, dots, dashes, underscores and slashes
 * after that first character.
 *
 * Deliberately conservative: anything that COULD be a command name is not counted,
 * so a zero here means "no candidate fabricated calls", not "no fabricated calls".
 */
function implausibleAsCommand(target: string): boolean {
  if (target.length === 0) return true
  const first = target[0]
  if (/[A-Za-z_.]/.test(first)) return false
  // Everything left is: digits, operators, punctuation, whitespace, quotes.
  // `1..3`, `1`, `-1`, `+2`, `123` — none of these is a command name.
  return true
}

/** A range literal in any of the shapes PowerShell writes. */
function looksLikeRange(target: string): boolean {
  let i = 0
  let sawDigit = false
  while (i < target.length) {
    const c = target[i]
    if (c >= "0" && c <= "9") { sawDigit = true; i++; continue }
    if (c === "." && target[i + 1] === ".") { i += 2; continue }
    return sawDigit && i >= 2
  }
  return false
}

type Hit = { file: string; line: number; target: string }
const perRepo: Record<string, { files: number; calls: number; implausible: Hit[]; ranges: Hit[] }> = {}

for (const repo of REPOS) {
  const dir = path.join(CORPUS_ROOT, repo)
  const acc = { files: 0, calls: 0, implausible: [] as Hit[], ranges: [] as Hit[] }
  if (existsSync(dir)) {
    const pattern = EXTS.map((e) => `'*.${e}'`).join(" ")
    let rels: string[] = []
    try {
      rels = execSync(`git -C ${dir} ls-files ${pattern}`, { encoding: "utf8", maxBuffer: 1 << 26 })
        .split("\n").map((s) => s.trim()).filter(Boolean)
    } catch { rels = [] }
    // Production draw only: skip the language's own parser torture suite.
    rels = rels.filter((r) => !/(^|\/)test(s)?\//i.test(r))
    for (const rel of rels) {
      const abs = path.join(dir, rel)
      let r: any
      try { r = await parseFile(abs, ROOT) } catch { continue }
      acc.files++
      for (const x of r.relationships ?? []) {
        const t = String(x.type ?? x.relationshipType ?? "")
        if (t !== "calls") continue
        acc.calls++
        const target = String(x.target ?? "")
        const hit = { file: rel, line: x.line_number ?? 0, target }
        if (implausibleAsCommand(target)) acc.implausible.push(hit)
        if (looksLikeRange(target)) acc.ranges.push(hit)
      }
    }
  }
  perRepo[repo] = acc
}

const totalImplausible = Object.values(perRepo).reduce((s, a) => s + a.implausible.length, 0)
const totalRanges = Object.values(perRepo).reduce((s, a) => s + a.ranges.length, 0)
const filesHit = new Set(Object.values(perRepo).flatMap((a) => a.implausible.map((h) => h.file))).size

const out = {
  instrument: "m60-powershell-fabricated-calls",
  question:
    "How many `calls` edges name a target that cannot be a command name, and how many of those are range literals?",
  predicate: {
    implausibleAsCommand: "first character is not [A-Za-z_.] — conservative by design, so 0 means 'no candidates', not 'none exist'",
    looksLikeRange: "digits with a `..` range operator, e.g. 1..3, 0..9, 1..$n",
  },
  totalCallsEdges: Object.values(perRepo).reduce((s, a) => s + a.calls, 0),
  totalImplausible,
  totalRanges,
  distinctFilesWithImplausible: filesHit,
  perRepo: Object.fromEntries(
    Object.entries(perRepo).map(([k, a]) => [
      k,
      { files: a.files, calls: a.calls, implausibleCount: a.implausible.length, rangeCount: a.ranges.length,
        implausibleSample: a.implausible.slice(0, 25), rangeSample: a.ranges.slice(0, 25) },
    ]),
  ),
  conclusion:
    totalRanges > 0
      ? "RANGE FABRICATIONS CONFIRMED in the corpus. The grammar's command_name class admits digits and dots, so a range literal becomes a command and the analyzer publishes calls -> <range>. A guard is the safe fix; narrowing command_name is a token change and G10 is the standing cost record."
      : totalImplausible > 0
        ? "Implausible call targets exist but none are ranges — classify before fixing."
        : "No fabricated call targets in this draw. The probe's single-file finding is not reproduced at corpus scale.",
}
mkdirSync(path.dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n")
console.log(JSON.stringify({ totalCallsEdges: out.totalCallsEdges, totalImplausible, totalRanges, distinctFilesWithImplausible: filesHit }, null, 2))
for (const [k, a] of Object.entries(perRepo)) {
  console.log(`  ${k}: files=${a.files} calls=${a.calls} implausible=${a.implausible.length} ranges=${a.ranges.length}`)
  for (const h of a.ranges.slice(0, 8)) console.log(`     RANGE  ${h.file}:${h.line} -> ${h.target}`)
  for (const h of a.implausible.slice(0, 8)) console.log(`     IMPLAUS ${h.file}:${h.line} -> ${h.target}`)
}
console.log(`wrote ${path.relative(ROOT, OUT)}`)
