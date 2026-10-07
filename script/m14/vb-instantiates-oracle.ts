/**
 * AN INDEPENDENT ORACLE FOR THE `instantiates` TARGET — derived from the SOURCE
 * TEXT, not from the parse tree, so it cannot share a bug with the analyzer.
 *
 * WHY THIS FILE IS THE SHAPE IT IS. `docs/analyzers/M14-HONESTY-CONTRACT.md` §2
 * allows L3 only against an independent second opinion, and
 * `docs/analyzers/ONTOLOGY-WORKSTREAM.md` Part 1 question 3 is explicit that the
 * differential's oracle is "a separate walker over the SAME grammar", so a
 * grammar bug shared by both is invisible. This oracle walks NO grammar at all:
 * it reads the `instantiates` edge the analyzer published, goes to the line it
 * cites, and asks one question of the TEXT —
 *
 *     is `target` the type name written immediately after a `New` keyword on
 *     that line, modulo the dotted namespace prefix and the `(Of …)` tail?
 *
 * A text oracle is the wrong instrument for "does this language HAVE the
 * construct" — that is what `vb-ontology-census.ts`'s grammar inventory is for,
 * and the ontology gate's header records two false positives a regex produced.
 * It is the RIGHT instrument for this narrower question, because the question is
 * about one token on one line and the source text is the ground truth for a
 * token. The two failures it CAN have are both stated here rather than left for
 * a reader to discover:
 *
 *   - a string literal or comment on the cited line containing `New X(`
 *     produces a false SUPPORT. Overcounted is visible in the report.
 *   - a `New` split across lines (`New _\n Foo()`) produces a false REJECT. The
 *     line window below is 3 lines, which covers the corpus's line-continuation
 *     style; the residual is reported as `unsupported` and each sample is shown so
 *     a reader can judge it.
 *
 * WHAT IT SETTLED. Running it against the implementation as it stood found the
 * worst class of edge the workstream names — a FABRICATED target:
 *
 *   `New StackFrame(1).GetMethod().Name`
 *
 * parses so the construction node (`array_creation_expression type: StackFrame
 * bounds: 1`) is the RECEIVER of a `member_access_expression` whose member is
 * `GetMethod`. The analyzer's "is this construction the leading segment of a
 * qualified name?" test said yes, climbed the chain and published
 * `instantiates -> GetMethod`. `GetMethod` is not a type anything constructs;
 * it is a method on the object just constructed. Measured: 240 of the 15,543
 * construction nodes sitting in an access chain carry their OWN arguments, and
 * every one of those 240 was a complete construction whose target was read off
 * the wrong node.
 *
 * CLI: npx tsx script/m14/vb-instantiates-oracle.ts [--sample N] [--out f.json]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { parseFile } from "../../src/ast/pool-worker"

function argOf(flag: string, dflt?: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt
}
const CR = process.env.BB_VB_CORPUS_ROOT ?? "$HOME/fixtures/vb-corpus"
const REPOS = (argOf("--repo", "p3d,dismt,pcl,tankex,runtime") ?? "").split(",").map((s) => s.trim()).filter(Boolean)
const SAMPLE = parseInt(argOf("--sample", "0") ?? "0")
const OUT = argOf("--out")

const files: { repo: string; dir: string; rel: string; abs: string; lines: string[] }[] = []
for (const e of REPOS) {
  const dir = path.join(CR, e)
  try { statSync(dir); execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    if (!rel.toLowerCase().endsWith(".vb")) continue
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > 512 * 1024) continue } catch { continue }
    let text = ""
    try { text = readFileSync(abs, "utf8").replace(/^\uFEFF/, "") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "vb") continue
    files.push({ repo: e, dir, rel, abs, lines: text.split(/\r?\n/) })
  }
}
files.sort((a, b) => (a.repo + "/" + a.rel < b.repo + "/" + b.rel ? -1 : 1))
const draw = SAMPLE > 0 ? files.slice(0, SAMPLE) : files
console.log(`vb instantiates oracle — corpus ${CR}  drawn ${draw.length} files  (source-text oracle; no grammar read)\n`)

/** Every type name written immediately after a `New` keyword in `window`, reduced
 *  to its last dotted segment with any `(Of …)` tail removed. */
function newTargetsIn(window: string): Set<string> {
  const out = new Set<string>()
  for (let i = 0; i < window.length - 3; i++) {
    if (window.charCodeAt(i) !== 78 || window.charCodeAt(i + 1) !== 101 || window.charCodeAt(i + 2) !== 119) continue // N,e,w
    const before = i === 0 ? " " : window[i - 1]
    const bc = before.charCodeAt(0)
    const isWord = (c: number): boolean => (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95
    if (isWord(bc)) continue
    // `New` must not be the tail of a longer word such as `IsNewThing`.
    let j = i + 3
    while (j < window.length && (window[j] === " " || window[j] === "\t" || window[j] === "\n" || window[j] === "\r")) j++
    let k = j
    while (k < window.length) {
      const c = window.charCodeAt(k)
      if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95 || c === 46) k++
      else break
    }
    if (k === j) continue
    let name = window.slice(j, k)
    const paren = name.indexOf("(")
    if (paren >= 0) name = name.slice(0, paren)
    if (name.length === 0) continue
    const last = name.lastIndexOf(".")
    out.add(last >= 0 ? name.slice(last + 1) : name)
  }
  return out
}

type Verdict = "SUPPORTED" | "UNSUPPORTED" | "NO_LINE"
const tally: Record<Verdict, number> = { SUPPORTED: 0, UNSUPPORTED: 0, NO_LINE: 0 }
const unsupported: Array<{ file: string; line: number; source: string; target: string; window: string }> = []
const unsupportedByTarget = new Map<string, number>()
let idx = 0
async function worker(): Promise<void> {
  while (true) {
    const i = idx++
    if (i >= draw.length) return
    const f = draw[i]
    const label = `${f.repo}/${f.rel}`
    let r: any
    try { r = await parseFile(f.abs, f.dir) } catch { continue }
    for (const x of r?.relationships ?? []) {
      if (String(x?.type ?? "") !== "instantiates") continue
      const line = typeof x?.line_number === "number" ? x.line_number : 0
      const target = String(x?.target ?? "")
      if (!(line > 0)) { tally.NO_LINE++; continue }
      // A 3-line window covers the corpus's `New _\n  Type()` continuation form.
      const window = f.lines.slice(Math.max(0, line - 2), Math.min(f.lines.length, line + 1)).join(" ")
      if (newTargetsIn(window).has(target)) { tally.SUPPORTED++; continue }
      tally.UNSUPPORTED++
      unsupportedByTarget.set(target, (unsupportedByTarget.get(target) ?? 0) + 1)
      if (unsupported.length < 40) {
        unsupported.push({ file: label, line, source: f.lines[line - 1] ?? "", target, window: window.slice(0, 200) })
      }
    }
  }
}
await Promise.all(Array.from({ length: 3 }, () => worker()))

const total = tally.SUPPORTED + tally.UNSUPPORTED + tally.NO_LINE
console.log(`instantiates edges: ${total}`)
console.log(`  SUPPORTED   (target is the name written after a \`New\` in the cited window) ${tally.SUPPORTED}  ${((tally.SUPPORTED / Math.max(1, total)) * 100).toFixed(2)}%`)
console.log(`  UNSUPPORTED (no \`New <target>\` in the cited window — a target the text does not justify) ${tally.UNSUPPORTED}  ${((tally.UNSUPPORTED / Math.max(1, total)) * 100).toFixed(2)}%`)
console.log(`  NO_LINE     ${tally.NO_LINE}`)
console.log(`\ntop unsupported targets (a target that is not a constructed type is a fabricated edge):`)
for (const [t, n] of [...unsupportedByTarget].sort((a, b) => b[1] - a[1]).slice(0, 30)) {
  console.log(`  ${String(n).padStart(6)}  ${t}`)
}
console.log(`\nsamples (each line shows the source, the target published, and the window searched):`)
for (const u of unsupported.slice(0, 12)) {
  console.log(`  ${u.file}:${u.line}  target=\`${u.target}\``)
  console.log(`      src: ${u.source.trim().slice(0, 150)}`)
}

if (OUT) {
  writeFileSync(OUT, JSON.stringify({
    corpusRoot: CR, drawn: draw.length, total, tally,
    unsupportedByTarget: Object.fromEntries([...unsupportedByTarget].sort((a, b) => b[1] - a[1])),
    samples: unsupported,
  }, null, 2))
  console.log(`\nwrote ${OUT}`)
}
process.exitCode = tally.UNSUPPORTED === 0 && tally.NO_LINE === 0 ? 0 : 1
