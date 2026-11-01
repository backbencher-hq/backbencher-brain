/**
 * JAVA FOLD A/B — pre-fold analyzer (HEAD blob) vs post-fold (working tree),
 * over the WHOLE java-lib corpus, same engine, same files, same run.
 *
 * WHY. The M60 java fold (docs/analyzers/java.md) moved several
 * corpus-level counts, and a claim that a number moved needs BOTH numbers from
 * the same instrument — quoting the pre-fold tables (different instruments,
 * different samples, different dates) beside a fresh census would attribute
 * drift to the fold that came from somewhere else. So this harness runs the
 * recorded revision's analyzer and the working tree's analyzer side by side and
 * prints per-type deltas, label-pair deltas, the owner-less tally, the
 * single-capital-letter `references` targets, and per-file module-info channels.
 *
 * PRE-FOLD SIDE. `git show HEAD:src/ast/real-java-analyzer.ts` is materialized
 * as `src/ast/real-java-analyzer-headprobe.ts` for the duration of the run and
 * removed afterwards — it has to sit beside the analyzer for its relative
 * imports (`./engine`, `./override-context`) to resolve. Nothing else is
 * written; the corpus is read-only.
 *
 * NO REGEX. Character walks only, per the family rule.
 *
 * USAGE (from the repo root):
 *   bun script/m14/lanes/java-fold-ab.mts
 *   AB_CONC=4 bun script/m14/lanes/java-fold-ab.mts
 */
import { execFileSync } from "node:child_process"
import { readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
import { join, relative } from "node:path"

const REPO = "$HOME/backbencher-brain"
const CORPUS = process.env.BB_CORPUS_ROOT ? join(process.env.BB_CORPUS_ROOT, "java-lib") : "$HOME/fixtures/repositories/java-lib"
const CONC = Number(process.env.AB_CONC ?? 8)
const PROBE_REL = "src/ast/real-java-analyzer-headprobe.ts"

const TEN = ["calls", "extends", "implements", "uses", "imports", "exports", "contains", "references", "overrides", "instantiates"]

type Acc = {
  symbols: number
  rels: number
  zeroSymbolFiles: number
  types: Map<string, number>
  labels: Map<string, number>
  ownerless: string[]
  capitalRefs: Map<string, number>
  moduleFiles: Map<string, {
    grammar: { module_declaration: number; exports_module_directive: number; requires_module_directive: number }
    symbols: string[]
    importsChannel: number
    exportsChannel: string[]
    rels: string[]
  }>
  importChannel: number
  exportChannel: number
}

const mkAcc = (): Acc => ({
  symbols: 0, rels: 0, zeroSymbolFiles: 0,
  types: new Map(), labels: new Map(), ownerless: [], capitalRefs: new Map(),
  moduleFiles: new Map(), importChannel: 0, exportChannel: 0,
})

const pre = mkAcc()
const post = mkAcc()

const walkAll: string[] = []
function walk(d: string): void {
  let ents
  try { ents = readdirSync(d, { withFileTypes: true }) } catch { return }
  for (const e of ents) {
    if (e.name === ".git" || e.name === "node_modules") continue
    const p = join(d, e.name)
    if (e.isDirectory()) walk(p)
    else if (e.name.endsWith(".java")) walkAll.push(p)
  }
}
walk(CORPUS)
walkAll.sort()

function tally(acc: Acc, res: any, L: string, root: any): void {
  const syms: any[] = res.symbols ?? []
  acc.symbols += syms.length
  if (syms.length === 0) acc.zeroSymbolFiles++
  acc.importChannel += (res.imports ?? []).length
  acc.exportChannel += (res.exports ?? []).length

  for (const s of syms) {
    const nt = String(s.metadata?.nodeType ?? "")
    const isTop =
      nt === "class_declaration" || nt === "interface_declaration" || nt === "enum_declaration" ||
      nt === "record_declaration" || nt === "annotation_type_declaration" || nt === "module_declaration"
    if (s.ownerName || isTop) continue
    acc.ownerless.push(`${L}: ${String(s.name)} nodeType=${nt || "(none)"} line=${s.range?.startLine ?? 0}`)
  }

  const rels: any[] = res.relationships ?? []
  acc.rels += rels.length
  for (const r of rels) {
    const t = String(r.type ?? r.relationshipType ?? "")
    const label = String(r.metadata?.relationshipType ?? "")
    if (TEN.includes(t)) acc.types.set(t, (acc.types.get(t) ?? 0) + 1)
    acc.labels.set(`${t}::${label}`, (acc.labels.get(`${t}::${label}`) ?? 0) + 1)
    if (t === "references") {
      const tgt = String(r.target ?? "")
      if (tgt.length === 1 && tgt >= "A" && tgt <= "Z") acc.capitalRefs.set(tgt, (acc.capitalRefs.get(tgt) ?? 0) + 1)
    }
  }

  if (L.endsWith("module-info.java")) {
    let mods = 0, expD = 0, reqD = 0
    const stack: any[] = [root]
    while (stack.length) {
      const n: any = stack.pop()
      if (n.type === "module_declaration") mods++
      if (n.type === "exports_module_directive") expD++
      if (n.type === "requires_module_directive") reqD++
      for (let k = 0; k < n.childCount; k++) stack.push(n.child(k))
    }
    acc.moduleFiles.set(L, {
      grammar: { module_declaration: mods, exports_module_directive: expD, requires_module_directive: reqD },
      symbols: syms.map((s) => `${s.name}|${s.kind}|L${s.range?.startLine ?? 0}`),
      importsChannel: (res.imports ?? []).length,
      exportsChannel: (res.exports ?? []).map((e) => `${e.name}|${e.kind ?? ""}|${e.exportForm ?? ""}`),
      rels: rels.map((r) => `${String(r.type ?? "")}|${String(r.metadata?.relationshipType ?? "")}|${r.source} -> ${r.target}|c=${r.confidence}`),
    })
  }
}

const top = (m: Map<string, number>, n: number): string =>
  [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k}:${v}`).join("  ")

async function main(): Promise<void> {
  const blob = execFileSync("git", ["show", `HEAD:${"src/ast/real-java-analyzer.ts"}`], { cwd: REPO, maxBuffer: 1 << 26 }).toString()
  writeFileSync(join(REPO, PROBE_REL), blob)

  const { getParser } = await import(`${REPO}/src/ast/engine.ts`)
  const preMod = await import(`${REPO}/${PROBE_REL}`)
  const postMod = await import(`${REPO}/src/ast/real-java-analyzer.ts`)
  const Pre: any = preMod.RealJavaAnalyzer
  const Post: any = postMod.RealJavaAnalyzer

  console.log(`JAVA FOLD A/B — corpus files: ${walkAll.length}   PRE = HEAD blob   POST = working tree`)

  let cursor = 0
  const t0 = Date.now()
  async function worker(): Promise<void> {
    while (true) {
      const i = cursor++
      if (i >= walkAll.length) return
      const p = walkAll[i]
      const L = relative(CORPUS, p)
      let content: string
      try { content = readFileSync(p, "utf8") } catch { continue }
      for (const [acc, Cls] of [[pre, Pre], [post, Post]] as Array<[Acc, any]>) {
        try {
          const parser = await getParser("java")
          const pr = await parser.parse(content)
          if (!pr) throw new Error("parse returned no tree")
          tally(acc, new Cls().analyze(pr.rootNode, content, p), L, pr.rootNode)
        } catch (e) {
          console.log(`ANALYZE FAIL ${L}: ${String(e).slice(0, 160)}`)
        }
      }
    }
  }
  await Promise.all(Array.from({ length: CONC }, () => worker()))
  const ms = Date.now() - t0

  console.log(`\n=== TOTALS in ${ms} ms`)
  console.log(`PRE  symbols ${pre.symbols}  rels ${pre.rels}  zeroSymbolFiles ${pre.zeroSymbolFiles}  imports[] ${pre.importChannel}  exports[] ${pre.exportChannel}`)
  console.log(`POST symbols ${post.symbols}  rels ${post.rels}  zeroSymbolFiles ${post.zeroSymbolFiles}  imports[] ${post.importChannel}  exports[] ${post.exportChannel}`)

  console.log(`\n=== PER-TYPE (relationship channel)`)
  for (const t of TEN) {
    const a = pre.types.get(t) ?? 0
    const b = post.types.get(t) ?? 0
    console.log(`${t.padEnd(13)} PRE ${String(a).padStart(7)}   POST ${String(b).padStart(7)}   ${a === b ? "same" : `DELTA ${b - a >= 0 ? "+" : ""}${b - a}`}`)
  }

  console.log(`\n=== LABEL PAIRS THAT MOVED`)
  const allKeys = new Set([...pre.labels.keys(), ...post.labels.keys()])
  const diffs = [...allKeys].map((k) => [k, pre.labels.get(k) ?? 0, post.labels.get(k) ?? 0]).filter(([, a, b]) => a !== b).sort((x, y) => Math.abs(y[1] - y[2]) - Math.abs(x[1] - x[2]))
  console.log(`moved: ${diffs.length}`)
  for (const [k, a, b] of diffs) console.log(`  ${k.padEnd(52)} PRE ${String(a).padStart(6)} -> POST ${String(b).padStart(6)}`)
  console.log(`\nPRE top:  ${top(pre.labels, 24)}`)
  console.log(`POST top: ${top(post.labels, 24)}`)

  console.log(`\n=== OWNER-LESS NON-TYPE SYMBOLS`)
  const preFiles = new Set(pre.ownerless.map((s) => s.slice(0, s.indexOf(": "))))
  const postFiles = new Set(post.ownerless.map((s) => s.slice(0, s.indexOf(": "))))
  console.log(`PRE  ${pre.ownerless.length} symbols in ${preFiles.size} files`)
  console.log(`POST ${post.ownerless.length} symbols in ${postFiles.size} files`)
  const preSet = new Set(pre.ownerless), postSet = new Set(post.ownerless)
  console.log(`only in PRE: ${[...preSet].filter((x) => !postSet.has(x)).length}   only in POST: ${[...postSet].filter((x) => !preSet.has(x)).length}`)
  for (const x of [...postSet].filter((v) => !preSet.has(v)).slice(0, 12)) console.log(`  POST-only: ${x}`)
  for (const x of [...preSet].filter((v) => !postSet.has(v)).slice(0, 12)) console.log(`  PRE-only:  ${x}`)

  console.log(`\n=== REFERENCES TARGETS THAT ARE A SINGLE CAPITAL LETTER`)
  const preT = [...pre.capitalRefs.values()].reduce((a, b) => a + b, 0)
  const postT = [...post.capitalRefs.values()].reduce((a, b) => a + b, 0)
  console.log(`PRE  total ${preT}   top: ${top(pre.capitalRefs, 16)}`)
  console.log(`POST total ${postT}   top: ${top(post.capitalRefs, 16)}`)

  console.log(`\n=== MODULE-INFO FILES, per file`)
  for (const f of [...post.moduleFiles.keys()]) {
    console.log(`\n--- ${f}`)
    const A = pre.moduleFiles.get(f), B = post.moduleFiles.get(f)
    console.log(`grammar PRE ${JSON.stringify(A?.grammar)}   POST ${JSON.stringify(B?.grammar)}`)
    console.log(`symbols PRE ${A ? A.symbols.length : 0}  POST ${B ? B.symbols.length : 0}`)
    for (const x of B?.symbols ?? []) console.log(`   POST sym ${x}`)
    console.log(`imports[] PRE ${A?.importsChannel ?? 0}  POST ${B?.importsChannel ?? 0}`)
    console.log(`exports[] PRE ${A?.exportsChannel.length ?? 0}  POST ${B?.exportsChannel.length ?? 0}`)
    for (const x of B?.exportsChannel ?? []) console.log(`   POST exp ${x}`)
    console.log(`rels PRE ${A ? A.rels.length : 0}  POST ${B ? B.rels.length : 0}`)
    for (const x of B?.rels ?? []) console.log(`   POST rel ${x}`)
    for (const x of A?.rels ?? []) console.log(`   PRE  rel ${x}`)
  }
}

try {
  await main()
} finally {
  try { unlinkSync(join(REPO, PROBE_REL)) } catch { /* already gone */ }
}
