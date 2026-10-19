/**
 * TS CLAIM-ARM CENSUS — count the binding claims the analyzer actually EMITS on the gate's own
 * analyzer path (streaming per-repo ProjectIndex, completeness stated by the caller exactly as
 * `incoming-gate.ts --index` does, engine `parseFile` with `{projectIndex, projectRoot}`), split into
 * imported-binding claims, local-binding claims, and the pre-existing whole-module binding claims.
 *
 * ## Why this instrument
 *
 * The arm re-run's `bindOK` is the only number that matters; a claim-count EXPECTATION is arithmetic
 * over a decomposition and can be wrong (it was: 61,330 expected against 37,668 measured). This
 * instrument measures the emission directly so the expectation can be replaced by a measurement.
 * It also reproduces per repo: element-plus measured 5,241 claims here vs the gate's 5,236 bindOK
 * (a 5-row delivery-path difference), which is how the whole-population gap is attributed.
 *
 * ## What it is NOT
 *
 * It does not arbitrate claims (the arbiter's rule decides verified/refuted; the gate does that) and
 * it does not replace the arm. It counts EMITTED claim rows — the ceiling `bindOK` can reach.
 *
 * Usage:
 *   BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/ts-claim-arm-census.ts
 */
import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import { ASTEngine } from "../../src/ast/engine"
import { resolveWasmAsset } from "../../src/util/wasm"

const CR = process.env.BB_CORPUS_ROOT ?? path.join(process.cwd(), ".corpus")
const mod: any = await import("../../src/ast/project-index")
const wasm = resolveWasmAsset("tree-sitter-typescript/tree-sitter-typescript.wasm")
const repos = fs.readdirSync(CR).filter((r) => { try { return fs.statSync(path.join(CR, r)).isDirectory() } catch { return false } }).sort()
let filesTotal = 0
let importedClaims = 0
let localClaims = 0
let wholeModuleClaims = 0
const byLabel: Record<string, number> = {}
for (const repo of repos) {
  const dir = path.join(CR, repo)
  let tracked: string[] = []
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  const files = tracked.filter((r) => r.endsWith(".ts")).map((r) => path.join(dir, r)).filter((abs) => { try { return fs.statSync(abs).size <= 1024 * 1024 } catch { return false } })
  if (files.length === 0) continue
  let projectIndex: any
  try {
    projectIndex = await mod.buildProjectIndexStreaming(wasm, files, mod.TYPESCRIPT_DECLARATION_SPEC)
    projectIndex.complete = true // THE CALLER STATES COMPLETENESS — the same line the gate uses for a whole run
  } catch { continue }
  for (const abs of files) {
    filesTotal++
    let content: string
    try { content = fs.readFileSync(abs, "utf8") } catch { continue }
    let parsed: any
    try { parsed = await ASTEngine.parseFile(abs, content, { projectIndex, projectRoot: dir } as any) } catch { continue }
    for (const r of parsed.relationships ?? []) {
      const md: any = r.metadata ?? {}
      if (md.importedBinding) { importedClaims++; byLabel[String(r.type)] = (byLabel[String(r.type)] ?? 0) + 1 }
      else if (md.localBinding === true) {
        if (String(r.type) === "imports") wholeModuleClaims++
        else { localClaims++; byLabel[String(r.type)] = (byLabel[String(r.type)] ?? 0) + 1 }
      }
    }
  }
}
const newClaims = importedClaims + localClaims
console.log(`TS CLAIM-ARM CENSUS (gate analyzer path): files ${filesTotal}`)
console.log(`  imported-binding claims ${importedClaims} · local-binding claims ${localClaims} · new claims ${newClaims}`)
console.log(`  pre-existing whole-module imports claims ${wholeModuleClaims} · emitted claim rows total ${newClaims + wholeModuleClaims}`)
console.log(`  bindOK ceiling on this emission = ${wholeModuleClaims} + ${newClaims} = ${wholeModuleClaims + newClaims} (gate loses ~0.8% in delivery filters)`)
console.log(`  new claims by label: ${JSON.stringify(byLabel)}`)
