/**
 * M60 — ITEMISE the powershell production draw's parse damage.
 *
 * WHY THIS EXISTS. Every damage number this lane has is a COUNT: 49 files, 8 damaged,
 * 56 ERROR, 6 MISSING. A count says the lane is not done and nothing about what to do
 * next, and it is the kind of number that stays stable while the things underneath it
 * are never looked at. This turns the count into an inventory keyed by ERROR/MISSING
 * node type, with the source line and a class name, so each entry can be adjudicated
 * — fixed, ruled out, or accepted with a reason.
 *
 * It is the same instrument the surface measure uses (production `parseFile`, the
 * language's own `test/` torture tree excluded) plus a SEPARATE parse used only to
 * walk for damage nodes, because parseDamage in the surface measure reports totals
 * rather than the nodes themselves.
 *
 * The MISSING rows matter most. A MISSING node is a token the parser INSERTED to keep
 * going, so it is a fabrication with no error attached, and a `redirected_file_name`
 * carrying a MISSING `>` is exactly the shape G10 recorded: the analyzer then publishes
 * a number as a redirected file. That is why MISSING is itemised separately from
 * ERROR even though the surface measure sums them into "damage".
 */
import { execSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import * as path from "node:path"

const ROOT = process.cwd()
const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const REPOS = process.env.BB_ONLY_REPO ? [process.env.BB_ONLY_REPO] : ["powershell", "ansible"]
const EXTS = ["ps1", "psm1", "psd1"]
const OUT = path.join(ROOT, "validation/m60/results/powershell-damage-inventory.json")

const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new P()
parser.setLanguage(await L.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-powershell.wasm"))))

type Item = { file: string; line: number; column: number; type: string; text: string }
const inv: Record<string, Item[]> = {}
const perRepo: Record<string, { files: number; damaged: number; errorNodes: number; missingNodes: number }> = {}
let grand = { files: 0, damaged: 0, errorNodes: 0, missingNodes: 0 }

const walk = (node: any, file: string, into: Item[]): void => {
  if (node.type === "ERROR" || node.isMissing) {
    const key = node.isMissing ? `MISSING ${node.type}` : `ERROR ${node.type}`
    into.push({
      file,
      line: node.startPosition.row + 1,
      column: node.startPosition.column + 1,
      type: node.type,
      text: node.text.slice(0, 80).replace(/\n/g, "\\n"),
    })
  }
  for (let i = 0; i < node.childCount; i++) walk(node.child(i), file, into)
}

for (const repo of REPOS) {
  const dir = path.join(CORPUS_ROOT, repo)
  const acc = { files: 0, damaged: 0, errorNodes: 0, missingNodes: 0 }
  if (!existsSync(dir)) { perRepo[repo] = acc; continue }
  const pattern = EXTS.map((e) => `'*.${e}'`).join(" ")
  let rels: string[] = []
  try {
    rels = execSync(`git -C ${dir} ls-files ${pattern}`, { encoding: "utf8", maxBuffer: 1 << 26 })
      .split("\n").map((s) => s.trim()).filter(Boolean)
  } catch { rels = [] }
  rels = rels.filter((r) => !/(^|\/)test(s)?\//i.test(r))
  // Same unbiased draw the surface measure uses: a hash of repo/relative-path, capped.
  const h = (s: string) => { let x = 2166136261; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 1676136261) >>> 0 } return x }
  rels = rels.map((r) => ({ r, k: h(`${repo}/${r}`) })).sort((a, b) => a.k - b.k).slice(0, 60).map((x) => x.r)

  for (const rel of rels) {
    const abs = path.join(dir, rel)
    let content: string
    try { content = readFileSync(abs, "utf8") } catch { continue }
    acc.files++
    const tree = parser.parse(content)
    const found: Item[] = []
    walk(tree.rootNode, rel, found)
    if (found.length === 0) continue
    acc.damaged++
    const errs = found.filter((f) => f.type === "ERROR").length
    const miss = found.length - errs
    acc.errorNodes += errs
    acc.missingNodes += miss
    for (const f of found) {
      const key = f.text ? `${f.type}|${f.text.slice(0, 40)}` : f.type
      ;(inv[key] ??= []).push(f)
    }
  }
  perRepo[repo] = acc
  grand.files += acc.files; grand.damaged += acc.damaged
  grand.errorNodes += acc.errorNodes; grand.missingNodes += acc.missingNodes
}

const classes = Object.entries(inv)
  .map(([k, v]) => ({ key: k, count: v.length, files: [...new Set(v.map((x) => x.file))].length, sample: v.slice(0, 4) }))
  .sort((a, b) => b.count - a.count)

const out = {
  instrument: "m60-powershell-damage-inventory",
  question: "What ARE the production draw's ERROR and MISSING nodes, as an adjudicable list rather than a count?",
  draw: { repos: REPOS, exts: EXTS, excluded: "the language's own test/ parser torture tree", cap: 60, order: "hash of repo/relative-path, ascending" },
  totals: grand,
  distinctClasses: classes.length,
  classes,
  perRepo,
  howToRead:
    "A class is a node type plus its source text. A MISSING row is a token the parser INSERTED, so it is a fabrication with no error attached - those are the rows worth reading first. A class with many sites and one shape is a fixable grammar class; a class with one site in a damaged region is usually recovery, not a language gap.",
}
mkdirSync(path.dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n")

console.log(`totals: files=${grand.files} damaged=${grand.damaged} ERROR=${grand.errorNodes} MISSING=${grand.missingNodes} classes=${classes.length}\n`)
for (const c of classes) {
  console.log(`  ${String(c.count).padStart(3)}x  ${c.files}f  ${c.key.replace(/\n/g, "\\n")}`)
  for (const s of c.sample.slice(0, 2)) console.log(`          ${s.file}:${s.line}  ${JSON.stringify(s.text.slice(0, 60))}`)
}
console.log(`\nwrote ${path.relative(ROOT, OUT)}`)
