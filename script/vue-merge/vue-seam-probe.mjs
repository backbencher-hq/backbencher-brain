// VUE_MERGE independent seam probe.
//
// QUESTION: does real-vue-analyzer lose its script-side edges when it is invoked
// the way firing-check-v2.mjs invokes it (analyze(rootNode, content, path), no
// context), or does it lose them only on that path?
//
// METHOD: for each corpus .vue file, run THREE paths on the SAME bytes:
//   A  analyze(rootNode, content, path)            <- firing-check-v2's shape
//   B  ASTEngine.parseFile(path, content)           <- production (pool-worker:833)
//   C  analyze(rootNode, content, path, CONTEXT)    <- context built by hand from
//      ASTEngine.extractSfcScriptBlocks + getParser, i.e. the seam engine.ts:1592
//      builds, but assembled by this script rather than by parseFile.
//
// If A is silent and B fires, the loss is in the CALLER, not the analyzer, and
// the honest verdict is "the analyzer emits; firing-check-v2 cannot see it".
//
// NO REGEX. readdirSync + endsWith + Map lookups only.
import { readFileSync, readdirSync, statSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = process.env.BB_REPO || join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const CORPUS = process.env.BB_CORPUS || "$HOME/fixtures/repositories"

function walkVue(dir, out, depth = 0) {
  if (depth > 12) return out
  let ents
  try { ents = readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of ents) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".git") continue
      walkVue(p, out, depth + 1)
    } else if (e.name.endsWith(".vue")) out.push(p)
  }
  return out
}

const eng = await import(`${REPO}/src/ast/engine.ts`)
const { getParser, ASTEngine } = eng
const vueMod = await import(`${REPO}/src/ast/real-vue-analyzer.ts`)
const VueCls = Object.values(vueMod).find((v) => typeof v === "function" && v.name.endsWith("Analyzer"))
console.log(`analyzer class: ${VueCls && VueCls.name}`)
console.log(`has extractSfcScriptBlocks: ${typeof ASTEngine.extractSfcScriptBlocks}`)

const dirs = process.argv[2] ? [process.argv[2]] : ["vuejs", "vue-element-admin"]
const LIMIT = Number(process.env.LIMIT || 0)

function tally(res) {
  const rel = new Map()
  for (const r of res.relationships || []) {
    const t = r.relationshipType ?? r.type
    if (t) rel.set(t, (rel.get(t) || 0) + 1)
  }
  return { rel, imports: (res.imports || []).length, symbols: (res.symbols || []).length }
}

function show(label, o) {
  const total = [...o.rel.values()].reduce((a, b) => a + b, 0)
  console.log(`  ${label.padEnd(12)} rel=${String(total).padStart(6)} imports[]=${String(o.imports).padStart(5)} symbols=${String(o.symbols).padStart(5)}  ${[...o.rel.keys()].sort().join(" ")}`)
  console.log(`               ${[...o.rel.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(" ")}`)
}

for (const d of dirs) {
  let files = walkVue(join(CORPUS, d), []).sort()
  if (LIMIT > 0) files = files.slice(0, LIMIT)
  console.log(`\n=== ${d}: ${files.length} .vue files (population: every .vue under ${join(CORPUS, d)}, readdir walk, sorted, no signal filter) ===`)
  const agg = { A: { rel: new Map(), imports: 0, symbols: 0 }, B: { rel: new Map(), imports: 0, symbols: 0 }, C: { rel: new Map(), imports: 0, symbols: 0 } }
  const counts = { A: 0, B: 0, C: 0 }
  const fails = { A: 0, B: 0, C: 0 }
  for (const f of files) {
    let content
    try { content = readFileSync(f, "utf8") } catch { continue }
    if (statSync(f).size > 400_000) continue
    const add = (k, res) => {
      const t = tally(res); counts[k]++
      for (const [kk, vv] of t.rel) agg[k].rel.set(kk, (agg[k].rel.get(kk) || 0) + vv)
      agg[k].imports += t.imports; agg[k].symbols += t.symbols
    }
    try {
      const p = await getParser("vue")
      const pr = await p.parse(content, f)
      add("A", new VueCls().analyze(pr.rootNode, content, f))
    } catch (e) { fails.A++; if (fails.A === 1) console.log(`  first A failure: ${f} :: ${String(e).slice(0, 120)}`) }
    try {
      add("B", await ASTEngine.parseFile(f, content))
    } catch (e) { fails.B++; if (fails.B === 1) console.log(`  first B failure: ${f} :: ${String(e).slice(0, 120)}`) }
    try {
      const p = await getParser("vue")
      const pr = await p.parse(content, f)
      const blocks = ASTEngine.extractSfcScriptBlocks(pr.rootNode, content)
      let ctx = null
      if (blocks.length) {
        const trees = [], lines = [], cols = [], idx = [], langs = []
        for (const b of blocks) {
          const subLang = b.lang === "ts" ? "typescript" : b.lang === "tsx" ? "tsx" : "javascript"
          const sp = await getParser(subLang)
          trees.push(sp.parse(b.body)); lines.push(b.startLine); cols.push(b.startColumn)
          idx.push(b.startIndex); langs.push(b.lang)
        }
        ctx = { sfcScriptTrees: trees, sfcScriptLines: lines, sfcScriptCols: cols, sfcScriptStartIndex: idx, sfcScriptLangs: langs }
      }
      add("C", new VueCls().analyze(pr.rootNode, content, f, ctx))
    } catch (e) { fails.C++; if (fails.C === 1) console.log(`  first C failure: ${f} :: ${String(e).slice(0, 120)}`) }
  }
  console.log(`  ok: A=${counts.A} B=${counts.B} C=${counts.C}   threw: A=${fails.A} B=${fails.B} C=${fails.C}`)
  show("A no-ctx", agg.A)
  show("B parseFile", agg.B)
  show("C ctx", agg.C)
}