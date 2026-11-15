/**
 * Runs json's RULING TABLE through the shared arbiter's verdict logic, without editing the
 * shared arbiter.
 *
 * ## Why this exists
 *
 * `script/m14/ontology-coverage-gate.ts` is §8 shared machinery. The task it answers — "is
 * this lane's RULED table sound, and would the gate falsify a ruling that is wrong?" — cannot
 * be answered for this lane until the table is wired in, and wiring it is the supervisor's
 * edit. So this harness imports the table from `script/m14/json-ruled.ts` and reproduces the
 * gate's verdict loop: production `parseFile` for what is EMITTED, then the table's own
 * instrument for what is not, then the same four statuses.
 *
 * What it is NOT: a second gate. It does not refuse to report, it does not own a baseline, and
 * nothing downstream reads its output. Its only claim is that the table in `json-ruled.ts`,
 * evaluated the way the shared gate would evaluate it, produces the rows printed below — and
 * that a table which reads `FALSIFIED` would say so here first.
 *
 * The instrument is the load-bearing part and it is worth reading twice. Every entry is on
 * `B:parse-tree-count`, because instrument A — "enumerate the node types the grammar produces
 * and show none expresses the construct" — is the question this lane retracted six rulings
 * over: JSON's grammar has 12 named node types and no node type for a KEYWORD, so it would
 * have passed a ruling about `implements` while the corpus carried 113 statements of it.
 *
 * Usage: npx tsx validation/m14/fixtures/json/ruling-table.ts [--out f.json]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"
import { JSON_RULED } from "../../../../script/m14/json-ruled"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const LANG = "json"
const ALL_TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"] as const
type Type = (typeof ALL_TYPES)[number]
const argv = process.argv.slice(2)
const OUT = argv.includes("--out") ? argv[argv.indexOf("--out") + 1] : ""

// `--repos a,b,c` bounds the corpus. It exists because of a measurement, not for
// convenience: this harness walks the population IN-PROCESS, and the engine's WASM
// parse traps under sustained in-process load (lane doc limitation 9). Over the whole
// admitted population it therefore dies at an arbitrary file — three different files on
// three runs — and prints the header WITHOUT the verdict table, which is the one thing
// it exists to print. A verdict table that cannot be reproduced is not evidence, so the
// corpus is scopeable and the scope is printed with the result. `ruling-recheck.ts`
// answers the same ruling question over the WHOLE population with a
// discard-poisoned-slot parser and does terminate; this harness is the one that runs
// the shared gate's four-status verdict logic, which the recheck does not.
const REPOS = argv.includes("--repos") ? argv[argv.indexOf("--repos") + 1].split(",").map((s) => s.trim()).filter(Boolean) : []

// ---------------------------------------------------------------- corpus — the gate's own admission test
const files: { repo: string; dir: string; rel: string; abs: string; text: string }[] = []
const reposSeen: string[] = []
for (const e of readdirSync(CR)) {
  if (REPOS.length > 0 && !REPOS.includes(e)) continue
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    continue
  }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch {
    continue
  }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try {
      if (statSync(abs).size > 512 * 1024) continue
      text = readFileSync(abs, "utf8")
    } catch {
      continue
    }
    if (detectLanguageFromPath(abs, text) !== LANG) continue
    files.push({ repo: e, dir, rel, abs, text })
  }
}
console.log(`json ruling table — ${LANG}, corpus ${files.length} admitted files`)
console.log(`corpus scope: ${REPOS.length > 0 ? `${REPOS.length} named repos (${REPOS.join(", ")})` : `EVERY repo under ${CR}`}`)
console.log(`table: script/m14/json-ruled.ts, ${JSON_RULED.length} entr${JSON_RULED.length === 1 ? "y" : "ies"}`)
for (const r of JSON_RULED) console.log(`  ${r.type.padEnd(14)} ${r.instrument.padEnd(22)} ${r.describe}`)
console.log("")

// ---------------------------------------------------------------- what is EMITTED, by production parseFile
const observed = new Map<Type, { n: number; files: Set<string> }>()
let idx = 0
async function worker(): Promise<void> {
  for (;;) {
    const i = idx++
    if (i >= files.length) return
    const f = files[i]
    let r: any
    try {
      r = await parseFile(f.abs, f.dir)
    } catch {
      continue
    }
    for (const x of r.relationships ?? []) {
      const t = String(x.type ?? x.relationshipType ?? "").toLowerCase() as Type
      if (!ALL_TYPES.includes(t)) continue
      const row = observed.get(t) ?? { n: 0, files: new Set<string>() }
      row.n++
      row.files.add(`${f.repo}/${f.rel}`)
      observed.set(t, row)
    }
  }
}
await Promise.all(Array.from({ length: 8 }, () => worker()))

// ---------------------------------------------------------------- the table's instruments
const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-json.wasm"))))

const grammarNodeTypes = new Map<string, number>()
for (const f of files) {
  const t = parser.parse(f.text)
  if (!t) continue
  const v = (n: any) => {
    grammarNodeTypes.set(n.type, (grammarNodeTypes.get(n.type) ?? 0) + 1)
    for (let i = 0; i < n.childCount; i++) v(n.child(i))
  }
  v(t.rootNode)
  t.delete?.()
}

const treeHits = new Map<Type, { occurrences: number; files: number; examples: string[] }>()
for (const r of JSON_RULED) {
  if (r.instrument !== "B:parse-tree-count" || !r.countOnTree) continue
  const hits: string[] = []
  const hitFiles = new Set<string>()
  for (const f of files) {
    const before = hits.length
    const t = parser.parse(f.text)
    if (t) {
      r.countOnTree(t.rootNode, `${f.repo}/${f.rel}`, hits)
      t.delete?.()
    }
    if (hits.length > before) hitFiles.add(f.rel)
  }
  treeHits.set(r.type, { occurrences: hits.length, files: hitFiles.size, examples: hits.slice(0, 3) })
}

// ---------------------------------------------------------------- the shared gate's written-ruling lookup
// Does `body` mention relationship type `t` as a WHOLE WORD, or in backticks?
//
// This replaces a `\b${t}\b` RegExp. Two reasons, and the second is the load-bearing
// one. First, the contract bans regex (honesty contract §1 / the no-regex rule) and this
// is a census script. Second, and worse: the old pattern was built by INTERPOLATING the
// type name into a pattern source, so a type name carrying regex metacharacters would
// have compiled to a different pattern — or thrown — and the failure would have landed
// on the branch that decides whether a RULED verdict is justified. A word test needs no
// pattern, so it cannot be wrong in that direction.
//
// `words()` splits on ASCII word characters by CODE POINT, not by pattern: `[a-z0-9_]`.
// A non-ASCII character is its own token, so a ruling written in another script still
// yields its ASCII type names as tokens.
function words(s: string): string[] {
  const out: string[] = []
  let cur = ""
  for (const ch of s.toLowerCase()) {
    const c = ch.codePointAt(0) ?? 0
    const word = (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95
    if (word) cur += ch
    else if (cur !== "") {
      out.push(cur)
      cur = ""
    }
  }
  if (cur !== "") out.push(cur)
  return out
}

function mentions(body: string, t: string): boolean {
  if (words(body).includes(t)) return true
  return body.includes("`" + t + "`")
}

function rulingFor(t: Type): { reason: string; src: string } | null {
  const specPath = `script/m14/spec/${LANG}-completeness.json`
  let raw: string
  try {
    raw = readFileSync(specPath, "utf8")
  } catch {
    return null
  }
  const d = JSON.parse(raw)
  for (const dec of d?.design_decision?.decisions ?? []) {
    if (dec.status !== "RULED") continue
    const body = String(dec.resolution ?? "")
    if (!mentions(body, t)) continue
    const lower = body.toLowerCase()
    const topical = ["ontology", "emits", "emitted", "excluded", "type"].some((w) => words(lower).includes(w))
    if (topical) return { reason: body, src: `${specPath}#${dec.id}` }
  }
  return null
}

// ---------------------------------------------------------------- the same four statuses the gate prints
type Row = { type: Type; status: "EMITTED" | "RULED-SOUND" | "FALSIFIED" | "RULED-UNJUSTIFIED"; detail: string }
const rows: Row[] = []
for (const t of ALL_TYPES) {
  const obs = observed.get(t)
  if (obs && obs.n > 0) {
    rows.push({ type: t, status: "EMITTED", detail: `${obs.n.toLocaleString()} edges in ${obs.files.size} files, e.g. ${[...obs.files].slice(0, 2).join(", ")}` })
    continue
  }
  const ruled = JSON_RULED.find((r) => r.type === t)
  if (ruled === undefined) {
    rows.push({ type: t, status: "RULED-UNJUSTIFIED", detail: "NOT EMITTED and no entry in the lane's ruling table" })
    continue
  }
  const hit = treeHits.get(t)
  if (hit && hit.occurrences > 0) {
    rows.push({ type: t, status: "FALSIFIED", detail: `NOT EMITTED, but the construct occurs ${hit.occurrences}x across ${hit.files} file(s) on the PARSE TREE. e.g. ${hit.examples[0] ?? ""}` })
    continue
  }
  if (ruled.instrument === "A:grammar-inventory") {
    const present = (ruled.nodeTypesThatWouldMeanIt ?? []).filter((n) => grammarNodeTypes.has(n))
    if (present.length > 0) {
      rows.push({ type: t, status: "FALSIFIED", detail: `NOT EMITTED, but the grammar DOES produce ${present.join(", ")}` })
      continue
    }
  }
  const ruling = rulingFor(t)
  if (!ruling) {
    rows.push({ type: t, status: "RULED-UNJUSTIFIED", detail: "NOT EMITTED, its construct is absent, but NO written ruling was found in the spec" })
    continue
  }
  const basis = ruled.instrument === "A:grammar-inventory" ? `the grammar produced ${grammarNodeTypes.size} distinct node types and NONE expresses it` : `the construct occurs 0x on the parse tree`
  rows.push({ type: t, status: "RULED-SOUND", detail: `NOT EMITTED; ${basis}. Written ruling: ${ruling.src}` })
}

const w = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
console.log(`${w("type", 14)}${w("status", 18)}detail`)
console.log("-".repeat(120))
for (const r of rows) console.log(`${w(r.type, 14)}${w(r.status, 18)}${r.detail}`)
const falsified = rows.filter((r) => r.status === "FALSIFIED")
const unjustified = rows.filter((r) => r.status === "RULED-UNJUSTIFIED")
console.log("-".repeat(120))
console.log(`emitted ${rows.filter((r) => r.status === "EMITTED").length}/10   ruled-sound ${rows.filter((r) => r.status === "RULED-SOUND").length}   FALSIFIED ${falsified.length}   ruled-without-justification ${unjustified.length}`)
console.log(`grammar node types observed across the corpus: ${grammarNodeTypes.size}`)

if (OUT) {
  writeFileSync(OUT, JSON.stringify({ corpusRoot: CR, admittedFiles: files.length, grammarNodeTypes: grammarNodeTypes.size, tableEntries: JSON.parse(JSON.stringify(JSON_RULED.map((r) => ({ type: r.type, instrument: r.instrument, describe: r.describe })))), rows }, null, 2))
  console.log(`wrote ${OUT}`)
}
process.exitCode = falsified.length + unjustified.length === 0 ? 0 : 1