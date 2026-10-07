/**
 * VUE — DOES THE ANALYZER'S EVIDENCE SURVIVE THE WORKER BOUNDARY?
 *
 * The six questions ask whether an emitted row is right. They do not ask whether
 * the row's EVIDENCE is readable downstream, and this file answers that question
 * for the one channel this lane publishes it on.
 *
 * WHAT WAS MEASURED, and where it came from.
 * `script/m14/vue-six-questions.mts` over 1,151 admitted `.vue` files reports:
 *
 *     components whose identity is a name the file never writes: 589
 *     of those, carrying metadata.synthesized through parseFile:     0
 *
 * Zero. `real-vue-analyzer.ts` sets `synthesized: true` on exactly that case
 * (the `identityFromFileStem` block, analyzer line ~1000) — and the F16 comment
 * there says declaring it "with the audit's own general mechanism" is the right
 * answer. So either the branch does not run, or the marker does not survive.
 * It is the second, and the reason is not in the analyzer.
 *
 * THE SEAM. `src/ast/pool-worker.ts` (~line 1020) rebuilds every symbol on its way
 * out of the worker and copies `metadata` through a NARROW PER-LANGUAGE ALLOWLIST:
 * one generic key (`isDeclaration`), thirteen CSS keys, nine markdown keys, four
 * bash keys. Every other key is dropped, for every language. That list is
 * deliberate and documented in place — "only keys a READER CONSUMES belong here,
 * because widening `annotations` for every symbol in every language is a separate,
 * larger change that needs its own measurement round" — so this is not an
 * oversight to be patched from this lane. It is a queue item, and this file is the
 * measurement that sizes it.
 *
 * The same seam was found and measured twice already, for CSS (`declaresProperties`
 * deleted, `uses` resolving 6.0% at both ends) and for bash (13 of 13 keys, 0%
 * survival, three LABELS derived from the dropped keys). Vue is the third instance
 * of one defect class, and it is the largest so far: 20 keys.
 *
 * HOW IT IS MEASURED. Two parses per file over the SAME corpus through the SAME
 * production wasm — `analyze()` (pre-worker) and `parseFile` (post-worker) — and
 * the key sets are differenced per key, so a key's survival rate is a count, not
 * an impression. No regex: character walks and node APIs only.
 *
 * WHAT IT DOES NOT CLAIM. It does not claim any relationship is wrong. It claims
 * the metadata that labels them is unreadable at the only place a consumer can
 * see it, which is a different claim and the one the six questions cannot make.
 *
 * CLI: npx tsx script/m14/vue-metadata-survival.mts [--repo vuejs,element-plus] [--out f.json]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, statSync, writeFileSync } from "node:fs"
import * as path from "path"
import { RealVueAnalyzer } from "../../src/ast/real-vue-analyzer"
import { ASTEngine } from "../../src/ast/engine"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { parseFile } from "../../src/ast/pool-worker"

function argOf(flag: string, dflt?: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt
}
const REPOS = (argOf("--repo", "vuejs") ?? "").split(",").map((s) => s.trim()).filter(Boolean)
const OUT = argOf("--out")
const MAX_BYTES = 512 * 1024

const files: Array<{ repo: string; dir: string; rel: string; abs: string; text: string }> = []
for (const e of REPOS) {
  const dir = path.join(process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories", e)
  let tracked: string[]
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    if (!rel.endsWith(".vue")) continue
    const abs = path.join(dir, rel)
    let text: string
    try { if (statSync(abs).size > MAX_BYTES) continue; text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "vue") continue
    files.push({ repo: e, dir, rel, abs, text })
  }
}
files.sort((a, b) => (a.repo + "/" + a.rel < b.repo + "/" + b.rel ? -1 : 1))
const commits: Record<string, string> = {}
for (const d of new Set(files.map((f) => f.dir))) {
  try { commits[d] = execFileSync("git", ["-C", d, "rev-parse", "HEAD"], { encoding: "utf8" }).trim() } catch { commits[d] = "unknown" }
}
console.log(`vue metadata survival — repos ${[...new Set(files.map((f) => f.repo))].join(",")}  .vue admitted ${files.length}`)
console.log(`corpus commits: ${JSON.stringify(commits)}`)

/** key -> { publishedOn, survivedThrough } */
const stats = new Map<string, { pub: number; surv: number }>()
const bump = (k: string, survived: boolean): void => {
  let s = stats.get(k)
  if (!s) { s = { pub: 0, surv: 0 }; stats.set(k, s) }
  s.pub++
  if (survived) s.surv++
}
/** relationship metadata keys, differenced the same way. */
const relStats = new Map<string, { pub: number; surv: number }>()
const bumpRel = (k: string, survived: boolean): void => {
  let s = relStats.get(k)
  if (!s) { s = { pub: 0, surv: 0 }; relStats.set(k, s) }
  s.pub++
  if (survived) s.surv++
}

let filesOk = 0, parseFail = 0
const keySamples = new Map<string, string[]>()
for (const f of files) {
  let pre: any = null, post: any = null
  try {
    const parser = await ASTEngine.getParser("vue")
    const tree = await parser.parse(f.text)
    // The seam, built the way `ASTEngine.parseFile` builds it: locate each
    // <script> block and re-parse its body with the js/ts/tsx grammar. Hand-built
    // here rather than imported, so the pre-worker side cannot accidentally be
    // `parseFile` itself — that would make the comparison tautological.
    const blocks = extractScriptBlocks(tree.rootNode)
    if (blocks.length > 0) {
      const trees: any[] = [], lines: number[] = [], cols: number[] = [], starts: number[] = []
      for (const b of blocks) {
        const sub = await ASTEngine.getParser(b.lang === "ts" ? "typescript" : b.lang === "tsx" ? "tsx" : "javascript")
        trees.push(sub.parse(b.body))
        lines.push(b.startLine); cols.push(b.startColumn); starts.push(b.startIndex)
      }
      pre = new RealVueAnalyzer().analyze(tree.rootNode, f.text, f.abs, {
        sfcScriptTrees: trees, sfcScriptLines: lines, sfcScriptCols: cols,
        sfcScriptStartIndex: starts, sfcScriptLangs: blocks.map((b) => b.lang),
      } as any)
    } else {
      pre = new RealVueAnalyzer().analyze(tree.rootNode, f.text, f.abs)
    }
  } catch { parseFail++; continue }
  try { post = await parseFile(f.abs, f.dir) } catch { parseFail++; continue }
  filesOk++

  // ── SYMBOL metadata ────────────────────────────────────────────────────────
  const preSyms = (pre?.symbols ?? []) as any[]
  const postSyms = (post?.symbols ?? []) as any[]
  // Join by (name, startLine) — the same identity the store's symbol key uses
  // (`${fileId}:${name}:${startLine}`, owner excluded), so the join cannot pair a
  // pre-worker symbol with an unrelated post-worker one.
  const postIndex = new Map<string, any[]>()
  for (const s of postSyms) {
    const k = `${String(s.name)}@${String((s.range as any)?.startLine)}`
    const arr = postIndex.get(k)
    if (arr) arr.push(s); else postIndex.set(k, [s])
  }
  const takenPost = new Set<any>()
  for (const s of preSyms) {
    const md = (s.metadata ?? {}) as Record<string, unknown>
    const keys = Object.keys(md)
    if (keys.length === 0) continue
    const k = `${String(s.name)}@${String((s.range as any)?.startLine)}`
    const cands = postIndex.get(k) ?? []
    const match = cands.find((c) => !takenPost.has(c))
    if (match) takenPost.add(match)
    const after = ((match?.metadata ?? {}) as Record<string, unknown>)
    for (const key of keys) {
      bump(key, Object.prototype.hasOwnProperty.call(after, key))
      const arr = keySamples.get(key)
      const label = `${f.repo}/${f.rel}`
      if (!arr) keySamples.set(key, [label])
      else if (arr.length < 3 && !arr.includes(label)) arr.push(label)
    }
  }
  // ── RELATIONSHIP metadata ──────────────────────────────────────────────────
  // The seam does not rebuild relationship objects, so this side is a control:
  // if relationships also read 0% the cause is the census's join, not the allowlist.
  const preRels = (pre?.relationships ?? []) as any[]
  const postRels = (post?.relationships ?? []) as any[]
  const postRelIndex = new Map<string, any>()
  for (const r of postRels) {
    postRelIndex.set(`${String(r.type ?? r.relationshipType)}|${String(r.source)}|${String(r.target)}|${String(r.line_number ?? "")}`, r)
  }
  let relMatched = 0
  for (const r of preRels) {
    const key = `${String(r.type ?? r.relationshipType)}|${String(r.source)}|${String(r.target)}|${String(r.line_number ?? "")}`
    const m = postRelIndex.get(key)
    if (!m) continue
    relMatched++
    const md = (r.metadata ?? {}) as Record<string, unknown>
    for (const key2 of Object.keys(md)) {
      bumpRel(key2, Object.prototype.hasOwnProperty.call((m.metadata ?? {}) as Record<string, unknown>, key2))
    }
  }
  if (filesOk === 1) console.log(`  (control) relationship rows matched pre→post on the first file: ${relMatched}/${preRels.length}`)
}

const pct = (a: number, b: number): string => (b === 0 ? "n/a" : `${((a / b) * 100).toFixed(1)}%`)
const w = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
const rows = [...stats.entries()].sort((a, b) => b[1].pub - a[1].pub)
console.log("\n" + "=".repeat(96))
console.log(`SYMBOL metadata keys — published by analyze(), surviving parseFile()  (${filesOk} files, parseFail ${parseFail})`)
console.log("=".repeat(96))
console.log(`${w("key", 30)}${w("published", 12)}${w("survived", 12)}rate`)
console.log("-".repeat(96))
let pubTotal = 0, survTotal = 0
for (const [k, s] of rows) {
  pubTotal += s.pub; survTotal += s.surv
  console.log(`${w(k, 30)}${w(String(s.pub), 12)}${w(String(s.surv), 12)}${pct(s.surv, s.pub)}`)
}
console.log("-".repeat(96))
console.log(`distinct keys ${rows.length} · key-occurrences ${pubTotal} · survived ${survTotal} (${pct(survTotal, pubTotal)})`)

const relRows = [...relStats.entries()].sort((a, b) => b[1].pub - a[1].pub)
console.log("\n" + "=".repeat(96))
console.log("RELATIONSHIP metadata keys — the control (the seam does not rebuild relationship objects)")
console.log("=".repeat(96))
let rPub = 0, rSurv = 0
for (const [k, s] of relRows) { rPub += s.pub; rSurv += s.surv }
console.log(`distinct keys ${relRows.length} · key-occurrences ${rPub} · survived ${rSurv} (${pct(rSurv, rPub)})`)
for (const [k, s] of relRows.slice(0, 12)) console.log(`  ${w(k, 40)}${String(s.pub).padStart(8)}${String(s.surv).padStart(8)}  ${pct(s.surv, s.pub)}`)

if (OUT) {
  writeFileSync(OUT, JSON.stringify({
    schemaVersion: 1,
    at: new Date().toISOString(),
    corpus: { repos: [...new Set(files.map((f) => f.repo))], admittedVueFiles: files.length, commits, rule: "sorted git ls-files, .vue only, <=512KB" },
    runtime: { filesCompared: filesOk, parseFail },
    symbolMetadataKeys: Object.fromEntries(rows.map(([k, s]) => [k, { published: s.pub, survived: s.surv, rate: pct(s.surv, s.pub), samples: keySamples.get(k) ?? [] }])),
    symbolTotals: { distinctKeys: rows.length, occurrences: pubTotal, survived: survTotal, rate: pct(survTotal, pubTotal) },
    relationshipMetadataKeys: Object.fromEntries(relRows.map(([k, s]) => [k, { published: s.pub, survived: s.surv, rate: pct(s.surv, s.pub) }])),
    relationshipTotals: { distinctKeys: relRows.length, occurrences: rPub, survived: rSurv, rate: pct(rSurv, rPub) },
    seam: "src/ast/pool-worker.ts symbol-metadata allowlist (isDeclaration + 13 css + 9 markdown + 4 bash keys)",
    instrument: "analyze() with a hand-built SFC seam vs pool-worker parseFile(); no regex",
  }, null, 2))
  console.log(`\nevidence: ${OUT}`)
}

/**
 * Every `<script>` block's body, byte offsets and `lang`, read off the vue tree —
 * the same shape `engine.ts:extractSfcScriptBlocks` produces. Written out rather
 * than imported so the pre-worker half of this comparison cannot call the
 * production path and make the two sides identical by construction.
 */
function extractScriptBlocks(root: any): Array<{ body: string; lang: string; startLine: number; startColumn: number; startIndex: number }> {
  const out: Array<{ body: string; lang: string; startLine: number; startColumn: number; startIndex: number }> = []
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()
    if (n.type === "script_element") {
      let body: any = null
      let lang = "js"
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        if (c.type === "raw_text") body = c
        if (c.type === "attribute" && c.childForFieldName?.("name")?.text === "lang") {
          const raw = String(c.childForFieldName?.("value")?.text ?? "")
          lang = raw.length >= 2 && (raw[0] === '"' || raw[0] === "'") && raw[raw.length - 1] === raw[0] ? raw.slice(1, -1) : raw
        }
      }
      if (body) {
        out.push({
          body: body.text,
          lang,
          startLine: body.startPosition.row,
          startColumn: body.startPosition.column,
          startIndex: body.startIndex,
        })
      }
    }
    for (let i = 0; i < n.childCount; i++) if (n.child(i)) stack.push(n.child(i))
  }
  return out
}
