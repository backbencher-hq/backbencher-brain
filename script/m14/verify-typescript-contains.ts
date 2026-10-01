/**
 * M14 — TypeScript `contains` residual.
 *
 * Runs the lane-owned containment oracle against the analyzer over real files and
 * reports every disagreement, bucketed by shape, so the residue is a work list
 * rather than a verdict. `contains` is the surface the graph is navigated by and
 * the one surface TypeScript had no independent cross-check for at corpus scale
 * (see the oracle module's header for the instrument-side history).
 *
 * The comparison is site-agnostic on `from|target`, matching how the java
 * contains oracle is compared: the analyzer resolves an owner by FIRST name match,
 * so two same-named declarations in one file collapse to one owner name, and the
 * truth derives the same pair. Counting multiplicity separately would report that
 * as a difference when both sides agree on the set.
 *
 * Usage:
 *   bun run script/m14/verify-typescript-contains.ts [--repo <path>] [--limit N]
 */
import * as fs from "fs"
import { execSync } from "child_process"
import * as WTS from "web-tree-sitter"
import { deriveTypeScriptContainsTruth } from "./oracles/typescript-contains"
import { RealTypeScriptAnalyzer } from "../../src/ast/real-typescript-analyzer"

const ROOT = path_resolve()
function path_resolve(): string {
  const i = process.argv.indexOf("--repo")
  return i >= 0 ? process.argv[i + 1] : "$HOME/mcp/backbencher-brain"
}
const LIMIT = (() => {
  const i = process.argv.indexOf("--limit")
  return i >= 0 ? Number(process.argv[i + 1]) : 400
})()

async function main() {
  const wts: any = WTS
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init()
  const langTs = await L.load(`${process.cwd()}/wasm/tree-sitter-typescript.wasm`)
  const langTsx = await L.load(`${process.cwd()}/wasm/tree-sitter-tsx.wasm`)

  const files = execSync(
    `git ls-files '*.ts' '*.tsx' | rg -v '^node_modules/|^dist/|^wasm/|\\.d\\.ts$' | head -${LIMIT}`,
    { encoding: "utf8", cwd: ROOT },
  )
    .trim()
    .split("\n")
    .filter(Boolean)

  let agree = 0
  let missing = 0
  let extra = 0
  const missByShape = new Map<string, number>()
  const extraByShape = new Map<string, number>()
  const samples: string[] = []

  for (const f of files) {
    const full = ROOT.endsWith(f) ? f : `${ROOT}/${f}`
    let src: string
    try {
      src = fs.readFileSync(full, "utf8")
    } catch {
      continue
    }
    const p1 = new P()
    p1.setLanguage(f.endsWith(".tsx") ? langTsx : langTs)
    const p2 = new P()
    p2.setLanguage(f.endsWith(".tsx") ? langTsx : langTs)
    let res: any
    let truth: string[]
    try {
      const root = p1.parse(src).rootNode
      res = await new RealTypeScriptAnalyzer().analyze(root, src, full)
      truth = deriveTypeScriptContainsTruth(p2.parse(src).rootNode).map((e) => `${e.from}|${e.target}`)
    } catch {
      continue
    }
    const got = (res.relationships ?? [])
      .filter((r: any) => r.type === "contains")
      .map((r: any) => `${r.source}|${r.target}`)
    const gotSet = new Set(got)
    const truthSet = new Set(truth)
    for (const t of truthSet) {
      if (gotSet.has(t)) agree++
      else {
        missing++
        const owner = t.split("|")[0]
        const shape = owner.startsWith("[") || owner === "(new)" ? "synthetic-name" : "member"
        missByShape.set(shape, (missByShape.get(shape) ?? 0) + 1)
        if (samples.length < 30) samples.push(`MISSING  ${f}  ${t}`)
      }
    }
    for (const g of gotSet) {
      if (!truthSet.has(g)) {
        extra++
        const shape = g.split("|")[1]?.startsWith("[") ? "synthetic-name" : "member"
        extraByShape.set(shape, (extraByShape.get(shape) ?? 0) + 1)
        if (samples.length < 60) samples.push(`EXTRA    ${f}  ${g}`)
      }
    }
  }

  const total = agree + missing + extra
  console.log(`repo: ${ROOT}`)
  console.log(`files=${files.length}  agree=${agree}  missing(analyzer omits)=${missing}  extra(analyzer invents)=${extra}`)
  console.log(`agreement=${total === 0 ? "n/a" : ((100 * agree) / total).toFixed(2) + "%"}`)
  if (missByShape.size) console.log(`missing by shape: ${JSON.stringify([...missByShape].sort((a, b) => b[1] - a[1]))}`)
  if (extraByShape.size) console.log(`extra by shape:   ${JSON.stringify([...extraByShape].sort((a, b) => b[1] - a[1]))}`)
  if (samples.length) {
    console.log("samples:")
    for (const s of samples) console.log("  " + s)
  }
}
main()
