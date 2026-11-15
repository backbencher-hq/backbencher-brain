/**
 * BASH `part_of` SITE-BY-SITE RECONCILIATION — the census's numerator against the
 * analyzer's own rows, one site at a time.
 *
 * WHY THIS FILE EXISTS. `probe-bash-silent-types.mts --corpus` counts the `source`/`.`
 * SITES on the parse tree and the `part_of` EDGES the production path emits. On the
 * 2,962-file corpus the two read **521 sites, 469 eligible, 470 edges** — an
 * off-by-one that a total can only report, never explain, and the fleet's rule is that
 * a number which moves between two readings of the same population is an instrument
 * defect until it is located. This file is the locator: it walks the SAME corpus, reads
 * the analyzer's `part_of` rows, and prints EVERY site where the prediction and the row
 * disagree, with the site's classification and the row's target.
 *
 * THE THREE CLASSES, and each has a different remedy:
 *   * ELIGIBLE-WITH-NO-ROW  — a site that shares this file's scope and names a part,
 *     but published nothing. The analyzer's guard (a case-arm pattern, a recovered
 *     region, a child-process boundary it did not see) refused it; the census must say
 *     so or the eligible count is wrong.
 *   * REFUSED-WITH-ROW      — a site the two refusals say must NOT fire, but a row
 *     exists. This is the falsifying direction: the emission's discrimination is wrong.
 *   * ROW-WITH-NO-SITE      — a row whose line holds no `source` command at all. The
 *     line or the construct is being read from a node the site walk did not visit.
 *
 * CLI: bun validation/m14/fixtures/bash/probe-bash-part-of-sites.mts [--corpus] [--repo NAME]
 * No network, no index, no regex.
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { join } from "node:path"

const REPO_ROOT = process.env.BB_REPO || join(import.meta.dirname, "..", "..", "..", "..")
const CORPUS = process.env.BB_CORPUS || "/home/ishaq2321/bb_tests/repositories"
const EXTS = [".sh", ".bash"]
const argv = process.argv.slice(2)
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : undefined
}
const REPO_DIR = flag("repo")
const CORPUS_WIDE = argv.includes("--corpus") || REPO_DIR === undefined

type Node = any

const engine = await import(`${REPO_ROOT}/src/ast/engine.ts`)
const analyzerMod = await import(`${REPO_ROOT}/src/ast/real-bash-analyzer.ts`)
const Analyzer = Object.values(analyzerMod).find(
  (v: any) => typeof v === "function" && String(v.name).indexOf("Analyzer") >= 0,
) as any
if (!Analyzer) throw new Error("no analyzer class exported")
const { getParser } = engine

/* ---------------------------------------------------------------- discovery */
function pickCorpusWide(): string[] {
  const out: string[] = []
  for (const e of readdirSync(CORPUS).sort()) {
    const d = join(CORPUS, e)
    try {
      if (!statSync(d).isDirectory()) continue
      execFileSync("git", ["-C", d, "rev-parse", "--git-dir"], { stdio: "ignore" })
    } catch {
      continue
    }
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", d, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
    } catch {
      continue
    }
    for (const rel of tracked) {
      if (!EXTS.some((x) => rel.toLowerCase().endsWith(x))) continue
      const abs = join(d, rel)
      try {
        if (statSync(abs).size < 400_000) out.push(abs)
      } catch {
        /* unreadable */
      }
    }
  }
  return out
}
function pickRepo(repo: string): string[] {
  const d = join(CORPUS, repo)
  const tracked = execFileSync("git", ["-C", d, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  const out: string[] = []
  for (const rel of tracked) {
    if (!EXTS.some((x) => rel.toLowerCase().endsWith(x))) continue
    const abs = join(d, rel)
    try {
      if (statSync(abs).size < 400_000) out.push(abs)
    } catch {
      /* unreadable */
    }
  }
  return out
}

/* ------------------------------------------------- the probe's own site reading */
/**
 * THE COMMAND WORD, read the way the analyzer reads it: a `command_name` CHILD, not
 * `child(0)`. The difference is a whole command shape — `V=x source lib.sh` puts a
 * `variable_assignment` in child(0), so a walk keyed on child(0) misses every
 * ENV-prefixed command. Measured: exactly one `source` site in the corpus
 * (ansible/test/integration/targets/ansible-test-sanity-runtime-metadata/runme.sh:3,
 * `COLLECTION_NAME=version source ../collection/setup.sh`), which is why the first
 * version of this probe counted 521 sites against 470 rows and could not explain the gap.
 */
function commandNameNodeOf(n: Node): Node | null {
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c && c.type === "command_name") return c
  }
  return null
}
function keywordOf(n: Node): string {
  const cn = commandNameNodeOf(n)
  return cn ? cn.text : (n.child(0) ? n.child(0).text : "")
}
function insideChildProcess(n: Node): boolean {
  for (let cur: Node | null = n.parent; cur; cur = cur.parent) {
    if (cur.type === "program") return false
    if (cur.type === "subshell" || cur.type === "command_substitution" || cur.type === "process_substitution") return true
  }
  return false
}
function sourceArgOf(n: Node): Node | null {
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (!c || c.type === "command_name") continue
    if (c.type === "word" || c.type === "raw_string" || c.type === "string" || c.type === "concatenation") return c
  }
  return null
}
function dequotePath(text: string): string {
  let out = ""
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c === 34 || c === 39) continue
    out += text[i]
  }
  return out
}
function partSymbolOfPath(pathText: string): string {
  const slash = pathText.lastIndexOf("/")
  const base = slash >= 0 ? pathText.slice(slash + 1) : pathText
  if (base.length === 0) return ""
  for (let i = 0; i < base.length; i++) {
    const c = base.charCodeAt(i)
    if (c <= 32 || c === 34 || c === 39 || c === 96 || c === 36 || c === 40 || c === 41 ||
        c === 123 || c === 125 || c === 91 || c === 93 || c === 42 || c === 63 ||
        c === 59 || c === 124 || c === 38 || c === 60 || c === 62 || c === 92) return ""
  }
  return base
}

type Site = {
  node: Node
  line: number
  childProcess: boolean
  path: string
  symbol: string
  predicted: "eligible" | "refused-child-process" | "refused-no-name"
}

/** One iterative pre-order walk, the same shape every instrument in this lane uses. */
function sitesOf(root: Node): Site[] {
  const sites: Site[] = []
  const stack: Node[] = [root]
  while (stack.length > 0) {
    const node = stack.pop() as Node
    if (node.type === "command" || node.type === "declaration_command") {
      const kw = keywordOf(node)
      if (kw === "source" || kw === ".") {
        const arg = sourceArgOf(node)
        const child = insideChildProcess(node)
        const path = arg ? dequotePath(arg.text) : ""
        const symbol = child ? "" : partSymbolOfPath(path)
        const nameNode = commandNameNodeOf(node)
        const line = arg ? arg.startPosition.row + 1 : (nameNode ?? node).startPosition.row + 1
        sites.push({
          node,
          line,
          childProcess: child,
          path,
          symbol,
          predicted: child ? "refused-child-process" : symbol.length > 0 ? "eligible" : "refused-no-name",
        })
      }
    }
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (c) stack.push(c)
    }
  }
  return sites
}

/* ---------------------------------------------------------------- the comparison */
const files = REPO_DIR ? pickRepo(REPO_DIR) : pickCorpusWide()
console.log(`BASH part_of SITE RECONCILIATION`)
console.log(`  population: ${files.length} git-tracked .sh/.bash files under 400KB${REPO_DIR ? ` in ${REPO_DIR}` : ` across ${readdirSync(CORPUS).length} corpus directories`}`)
console.log(`  instrument: production parseFile shape (getParser -> analyze) + the lane's site walk; no index, no network`)
console.log("")

let parseFailures = 0
let sitesTotal = 0
let eligible = 0
let refusedChild = 0
let refusedNoName = 0
let rowsTotal = 0
const eligibleWithNoRow: string[] = []
const refusedWithRow: string[] = []
const rowWithNoSite: string[] = []

for (const f of files) {
  let content: string
  try {
    content = readFileSync(f, "utf8")
  } catch {
    continue
  }
  let root: Node
  try {
    const parser = await getParser("bash")
    const pr = await parser.parse(content, f)
    root = pr.rootNode
  } catch {
    parseFailures++
    continue
  }
  const sites = sitesOf(root)
  sitesTotal += sites.length
  for (const s of sites) {
    if (s.predicted === "eligible") eligible++
    else if (s.predicted === "refused-child-process") refusedChild++
    else refusedNoName++
  }
  let rows: any[] = []
  try {
    const res = new Analyzer().analyze(root, content, f)
    rows = (res.relationships || []).filter((r: any) => (r.relationshipType ?? r.type) === "part_of")
  } catch {
    continue
  }
  rowsTotal += rows.length
  const siteByLine = new Map<number, Site[]>()
  for (const s of sites) {
    const arr = siteByLine.get(s.line) ?? []
    arr.push(s)
    siteByLine.set(s.line, arr)
  }
  const rowLines = new Set<number>()
  for (const r of rows) {
    const ln = Number(r.line_number ?? 0)
    rowLines.add(ln)
    const at = siteByLine.get(ln) ?? []
    const match = at.find((s) => s.predicted === "eligible" && s.symbol === String(r.target ?? ""))
    if (match) continue
    const anyAllowed = at.find((s) => s.predicted === "eligible")
    if (anyAllowed) continue // an eligible site at this line exists; the target spelling is the subject of its own check
    refusedWithRow.push(`${f}:${ln} row=${JSON.stringify({ target: r.target, source: r.source, metadata: r.metadata })} sites=${JSON.stringify(at.map((s) => ({ predicted: s.predicted, path: s.path, symbol: s.symbol })))}`)
  }
  for (const s of sites) {
    if (s.predicted !== "eligible") continue
    if (rowLines.has(s.line)) continue
    eligibleWithNoRow.push(`${f}:${s.line} ${JSON.stringify({ path: s.path, symbol: s.symbol })}`)
  }
  for (const ln of rowLines) {
    if (!siteByLine.has(ln)) rowWithNoSite.push(`${f}:${ln}`)
  }
}

const pct = (a: number, b: number): string => (b === 0 ? "-" : `${((100 * a) / b).toFixed(1)}%`)
console.log(`  parsed OK                    : ${files.length - parseFailures}/${files.length}  (parse failures: ${parseFailures})`)
console.log(`  source/. sites on the tree   : ${sitesTotal}`)
console.log(`      ELIGIBLE                 : ${eligible}`)
console.log(`      refused (child process)  : ${refusedChild}`)
console.log(`      refused (no nameable part): ${refusedNoName}`)
console.log(`  part_of rows (production)    : ${rowsTotal}`)
console.log("")
console.log(`  ELIGIBLE-WITH-NO-ROW         : ${eligibleWithNoRow.length}  (a guard refused a site the census calls eligible)`)
for (const s of eligibleWithNoRow.slice(0, 40)) console.log(`      ${s}`)
console.log(`  REFUSED-WITH-ROW             : ${refusedWithRow.length}  (the discrimination FAILED at these sites)`)
for (const s of refusedWithRow.slice(0, 40)) console.log(`      ${s}`)
console.log(`  ROW-WITH-NO-SITE             : ${rowWithNoSite.length}  (a row whose line holds no source command)`)
for (const s of rowWithNoSite.slice(0, 40)) console.log(`      ${s}`)
console.log("")
console.log(`  SITE/EDGE RECONCILIATION     : ${eligible} eligible - ${eligibleWithNoRow.length} eligible-with-no-row + ${refusedWithRow.length} refused-with-row = ${eligible - eligibleWithNoRow.length + refusedWithRow.length} predicted rows; ${rowsTotal} observed`)
console.log(`  resolution share of rows     : ${pct(Math.min(eligible, rowsTotal), Math.max(eligible, 1))} of eligible sites published`)
