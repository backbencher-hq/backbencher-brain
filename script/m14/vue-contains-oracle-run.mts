/**
 * VUE — THE `contains` ORACLE RUN, so the label's DERIVATION finding gets a number.
 *
 * WHY THIS FILE. `script/m60/rel-type-coverage-gate.ts` CHECK 1 reports, for vue:
 *
 *   DERIVATION | emits `contains` but the differential audits
 *   ["calls","extends","implements","instantiates","overrides"]
 *
 * i.e. 2,467 `contains` rows on the 2,273-file draw are stored and compared
 * against nothing. An unverified edge ships a bug invisibly, which is why the
 * workstream counts these findings as first-class work rather than bookkeeping.
 *
 * WHY IT IS NOT A FIX. Closing it properly means a new oracle push AND a
 * `contains` entry in the differential's compared-label allowlist, and BOTH live
 * in `script/m14/differential.ts`, which is MASTER's. Adding the allowlist entry
 * alone is the #910 trap the differential's own comments document: the analyzer
 * side is unfiltered while the truth side is not, so the lane reads as a
 * catastrophic regression instead of the missing comparison it is. So this file
 * MEASURES the agreement and reports it; it does not wire it.
 *
 * WHAT IT MEASURES, and the two denominators that matter:
 *   COMPONENT-OWNED   rows whose source is the component's own identity. This is
 *                     the half the Vue analyzer owns and the half the oracle is
 *                     written for.
 *   DELEGATED         rows the JS/TS sub-analyzer emits for symbols inside the
 *                     embedded script blocks. Those are the typescript lane's
 *                     `contains`, audited there; counting them here would credit
 *                     this oracle with another lane's work.
 *
 * The oracle is READ, never modified: `oracles/vue-contains.ts` is lane-authored
 * but lives under the shared `script/m14/**` tree.
 *
 * The embedded-script extraction below is a local re-implementation on purpose —
 * importing `deriveEmbeddedScriptTrees` from `differential.ts` would start that
 * module's ~40-lane sweep on import. It is validated against the engine's own
 * reader by the `sfcLineOffset`/`hasTypeInference` cross-check recorded in the
 * doc: 774 of 1,011 element-plus + vue-class-component SFCs arrive from
 * production `parseFile` with `metadata.hasTypeInference === true`, against 768
 * `lang="ts"` + 10 `lang="tsx"` blocks written in the corpus text, the 4
 * differences being empty script bodies that `extractSfcScriptBlocks` skips.
 *
 * CLI: npx tsx script/m14/vue-contains-oracle-run.mts --repo vuejs --dir <a,b,c> [--out f.json]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, statSync, writeFileSync } from "node:fs"
import * as path from "path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { parseFile } from "../../src/ast/pool-worker"
import { deriveVueContainsTruth } from "./oracles/vue-contains"

function argOf(flag: string, dflt?: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt
}
const REPOS = (argOf("--repo", "vuejs") ?? "").split(",").map((s) => s.trim()).filter(Boolean)
const EXTRA = (argOf("--dir", "") ?? "").split(",").map((s) => s.trim()).filter(Boolean)
const OUT = argOf("--out")
const MAX_BYTES = 512 * 1024

const files: Array<{ repo: string; dir: string; rel: string; abs: string; text: string }> = []
const seen = new Set<string>()
for (const dir of [...REPOS.map((e) => path.join(process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories", e)), ...EXTRA]) {
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    if (!rel.endsWith(".vue")) continue
    const abs = path.join(dir, rel)
    let text: string
    try { if (statSync(abs).size > MAX_BYTES) continue; text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "vue") continue
    if (seen.has(abs)) continue
    seen.add(abs)
    files.push({ repo: path.basename(dir), dir, rel, abs, text })
  }
}
files.sort((a, b) => (a.repo + "/" + a.rel < b.repo + "/" + b.rel ? -1 : 1))
console.log(`vue contains oracle run — ${files.length} .vue files`)

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
const ROOT = path.resolve((import.meta as any).dirname ?? ".", "..", "..")
await WSP.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const load = async (name: string): Promise<any> => { const p = new WSP(); p.setLanguage(await WSL.load(readFileSync(path.join(ROOT, "wasm", name)))); return p }
const vueP = await load("tree-sitter-vue.wasm")
const jsP = await load("tree-sitter-javascript.wasm")
const tsP = await load("tree-sitter-typescript.wasm")

/** The engine's own reader, re-implemented: `lang` lives at
 *  `script_element > start_tag > attribute > attribute_name`, and the value at
 *  `attribute > quoted_attribute_value > attribute_value`. Reading `lang` as a
 *  direct child of `script_element` yields `undefined` for every block, which
 *  hands TS-only syntax to the javascript grammar — measured, and the reason an
 *  earlier version of a sibling probe reported 0 `extends_clause` on the one
 *  repository whose SFCs contain a class. */
const unq = (s: string): string => (s.length >= 2 && (s[0] === '"' || s[0] === "'") && s[s.length - 1] === s[0] ? s.slice(1, -1) : s)
const scriptLang = (se: any): string => {
  let lang = "js"
  const walk: any[] = [se]
  while (walk.length) {
    const n = walk.pop()
    if (n.type === "attribute") {
      let name = ""
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c && c.type === "attribute_name") { name = c.text; break } }
      if (name === "lang") {
        let value = ""
        const vs: any[] = []
        for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) vs.push(c) }
        while (vs.length) {
          const m = vs.pop()
          if (m.type === "attribute_value") { value = m.text; break }
          for (let i = 0; i < m.namedChildCount; i++) { const c = m.namedChild(i); if (c) vs.push(c) }
        }
        value = unq(value)
        if (value === "ts" || value === "tsx") lang = value
      }
      continue
    }
    for (let i = 0; i < n.childCount; i++) if (n.child(i)) walk.push(n.child(i))
  }
  return lang
}

const bucketCounts = new Map<string, number>()
let oracleRows = 0, analyzerRows = 0
let agreed = 0, oracleOnly = 0, analyzerOnly = 0
let delegatedAnalyzerRows = 0, componentAnalyzerRows = 0
const oracleOnlySamples: string[] = []
const analyzerOnlySamples: string[] = []
const perRepo = new Map<string, { oracle: number; agreed: number; oracleOnly: number; analyzerOnly: number }>()
let parseFail = 0, wasmFail = 0
const t0 = Date.now()
{
  let i = 0
  const work = async (): Promise<void> => {
    while (true) {
      const k = i++
      if (k >= files.length) return
      const f = files[k]
      try { await one(f) } catch { wasmFail++ }
    }
  }
  const one = async (f: { repo: string; dir: string; rel: string; abs: string; text: string }): Promise<void> => {
    {
      const stem = path.basename(f.rel, ".vue")
      // ORACLE SIDE — the production wasm, the same parse the analyzer gets.
      const t = vueP.parse(f.text)
      if (!t) { parseFail++; return }
      const trees: any[] = []
      const btOwners: any[] = []
      const w: any[] = [t.rootNode]
      while (w.length) {
        const n = w.pop()
        if (n.type === "script_element") {
          let body: any = null
          for (let i2 = 0; i2 < n.childCount; i2++) if (n.child(i2)?.type === "raw_text") body = n.child(i2)
          if (body && body.text.trim().length > 0) {
            const lang = scriptLang(n)
            const p = lang === "ts" || lang === "tsx" ? tsP : jsP
            // rootNode, not the Tree. The oracle walks `n.type`, which is a Node
            // property; handed a Tree it finds nothing and returns 0 rows for the
            // whole corpus — which reads as "the analyzer is 100% wrong" and is the
            // exact shape the workstream's "absence without a measurement" rule is
            // about. `deriveEmbeddedScriptTrees` (differential.ts:1307) pushes
            // `sub.parse(block.body).rootNode` for the same reason.
            const bt = p.parse(body.text)
            if (bt) { trees.push(bt.rootNode); btOwners.push(bt) }
          }
        }
        for (let i2 = 0; i2 < n.childCount; i2++) if (n.child(i2)) w.push(n.child(i2))
      }
      t.delete?.()
      let truth: Array<{ from: string; target: string }> = []
      try { truth = deriveVueContainsTruth(trees, stem) as any } catch { parseFail++ }
      // Release the script trees BEFORE any further walk over them. The earlier
      // order held them across a second full traversal and the fixed-size wasm heap
      // ran out mid-sweep ("memory access out of bounds" on
      // ts_node_named_child_count) — the same heap pressure
      // `extractSfcScriptBlocks`'s own comment records ("a fresh Parser per file
      // exhausted the fixed-size wasm heap mid-sweep at --sample 400, M49 W12").
      for (const x of btOwners) x.delete?.()
      btOwners.length = 0

      // ANALYZER SIDE — production parseFile, the whole seam.
      let r: any
      try { r = await parseFile(f.abs, f.dir) } catch { parseFail++; return }
      const compName = String((r.symbols ?? []).find((s: any) => String(s?.kind ?? "").toLowerCase() === "class")?.name ?? stem)
      const truthSet = new Set(truth.map((x) => `${x.from}|${x.target}`))
      const propNames = new Set<string>()
      for (const s2 of r.symbols ?? []) {
        if (String(s2?.kind ?? "").toLowerCase() === "class") continue
        const md = (s2 as any)?.metadata ?? {}
        if (md.isProp || md.isEmit || md.isPropContract || md.isEmitContract) propNames.add(String(s2?.name ?? ""))
      }
      // Bucket the disagreement in the direction that matters: an analyzer row the
      // oracle derives none of. The documented cause (VSD49/VSD50) is that a
      // `<script setup>` program's top-level bindings are module-scope for the
      // oracle and component-owned for the analyzer, so the rows are bucketed by
      // whether the member name IS such a binding rather than left as one number.
      const setupTopLevel = new Set<string>()
      for (const root of trees) {
        for (let i = 0; i < (root as any).namedChildCount; i++) {
          const st2 = (root as any).namedChild(i)
          if (!st2) continue
          if (st2.type === "lexical_declaration" || st2.type === "variable_declaration") {
            for (const d of st2.namedChildren as any[]) {
              const nm = d?.childForFieldName?.("name")?.text
              if (nm) setupTopLevel.add(nm)
            }
          } else if (st2.type === "function_declaration" || st2.type === "class_declaration") {
            const nm = st2.childForFieldName?.("name")?.text
            if (nm) setupTopLevel.add(nm)
          } else if (st2.type === "import_statement") {
            const cl = (st2.namedChildren as any[]).find((c: any) => c.type === "import_clause")
            for (const c of (cl?.namedChildren ?? []) as any[]) {
              const nm = c?.type === "identifier" ? c.text : c?.type === "named_imports" ? undefined : undefined
              if (nm) setupTopLevel.add(nm)
            }
          }
        }
      }
      const anSet = new Set<string>()
      for (const x of r.relationships ?? []) {
        if (String(x.type ?? x.relationshipType ?? "") !== "contains") continue
        analyzerRows++
        const key = `${x.source}|${x.target}`
        if ((x.metadata ?? {}).sfcDelegated === true) delegatedAnalyzerRows++
        else componentAnalyzerRows++
        if (truthSet.has(key)) { anSet.add(key); continue }
        if (compName === String(x.source)) {
          analyzerOnly++
          const member = String(x.target)
          const bucket = setupTopLevel.has(member)
            ? "a <script setup> top-level binding the oracle treats as module-scope"
            : propNames.has(member)
              ? "a macro contract member (defineProps/defineEmits) the oracle does not derive"
              : "other"
          bucketCounts.set(bucket, (bucketCounts.get(bucket) ?? 0) + 1)
          if (analyzerOnlySamples.length < 20) analyzerOnlySamples.push(`${f.repo}/${f.rel}: analyzer ${key} [${bucket}]`)
        }
      }
      for (const key of truthSet) {
        oracleRows++
        if (anSet.has(key)) { agreed++; const p = perRepo.get(f.repo) ?? { oracle: 0, agreed: 0, oracleOnly: 0, analyzerOnly: 0 }; p.oracle++; p.agreed++; perRepo.set(f.repo, p) }
        else {
          oracleOnly++
          if (oracleOnlySamples.length < 20) oracleOnlySamples.push(`${f.repo}/${f.rel}: oracle ${key}`)
          const p = perRepo.get(f.repo) ?? { oracle: 0, agreed: 0, oracleOnly: 0, analyzerOnly: 0 }; p.oracle++; p.oracleOnly++; perRepo.set(f.repo, p)
        }
      }
    }
  }
  await Promise.all(Array.from({ length: 4 }, () => work()))
}
const wall = Date.now() - t0

const pct = (a: number, b: number): string => (b === 0 ? "n/a" : `${((a / b) * 100).toFixed(1)}%`)
console.log("\n" + "=".repeat(96))
console.log("VUE `contains` — the lane-owned oracle against production parseFile")
console.log("=".repeat(96))
console.log(`oracle rows (component-owned truth)   ${oracleRows}`)
console.log(`  agreed with the analyzer             ${agreed}  (${pct(agreed, oracleRows)} of oracle truth)`)
console.log(`  oracle rows the analyzer does NOT emit ${oracleOnly}`)
console.log(`analyzer component-owned rows          ${componentAnalyzerRows}`)
console.log(`  of those, NOT derived by the oracle  ${analyzerOnly}  (${pct(analyzerOnly, componentAnalyzerRows)})`)
console.log(`analyzer DELEGATED contains rows       ${delegatedAnalyzerRows}  (the typescript lane's surface, audited there)`)
console.log("\nwhat the analyzer-only rows are, bucketed:")
for (const [k, v] of [...bucketCounts.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(6)}  ${k}`)
console.log(`parseFail ${parseFail}   wasmFail ${wasmFail}   wall ${(wall / 1000).toFixed(1)}s`)
console.log("\nper repo:")
for (const [k, v] of [...perRepo.entries()].sort()) console.log(`  ${k.padEnd(20)} oracle ${String(v.oracle).padStart(6)}  agreed ${String(v.agreed).padStart(6)}  oracleOnly ${String(v.oracleOnly).padStart(5)}  analyzerOnly ${String(v.analyzerOnly).padStart(5)}`)
if (oracleOnlySamples.length) { console.log("\noracle truth the analyzer does not emit (first 20):"); for (const s of oracleOnlySamples) console.log("  " + s) }
if (analyzerOnlySamples.length) { console.log("\nanalyzer component-owned rows the oracle does not derive (first 20):"); for (const s of analyzerOnlySamples) console.log("  " + s) }

if (OUT) {
  writeFileSync(OUT, JSON.stringify({
    schemaVersion: 1,
    at: new Date().toISOString(),
    corpus: { files: files.length, repos: [...new Set(files.map((f) => f.repo))], rule: "sorted git ls-files, .vue only, <=512KB, detected as vue" },
    runtime: { parseFail, wasmFail, wallMs: wall },
    oracleRows, agreed, oracleOnly,
    analyzerComponentOwnedRows: componentAnalyzerRows, analyzerOnly,
    analyzerDelegatedRows: delegatedAnalyzerRows,
    analyzerOnlyBuckets: Object.fromEntries(bucketCounts),
    perRepo: Object.fromEntries(perRepo),
    oracleOnlySamples, analyzerOnlySamples,
    instrument: "production ASTEngine.parseFile vs script/m14/oracles/vue-contains.ts over the same production wasm",
    note: "closing the DERIVATION finding needs a truth push AND a compared-label allowlist entry, both in script/m14/differential.ts (MASTER-owned)",
  }, null, 2))
  console.log(`\nevidence: ${OUT}`)
}
