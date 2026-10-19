// kotlin-import-claim-probe — both-direction assertions for the flag-gated imported-binding claim
// (fleet depth task-40). The shared fixture runner cannot set the env flag, so the on-state contract is
// pinned HERE; the .kt fixtures pin the default-OFF edge surface in the normal runner.
// USAGE: bun run script/m14/kotlin-import-claim-probe.ts [--cap=200]
import { readFileSync, readdirSync, statSync } from "node:fs"
import { execFileSync } from "node:child_process"
import * as path from "node:path"
import { getParser } from "../../src/ast/engine"
const CR = process.env.BB_CORPUS_ROOT ?? path.join(process.cwd(), ".corpus")
const CAP = Number(process.argv.find((a) => a.startsWith("--cap="))?.split("=")[1] ?? 200)
const FIX = "validation/m14/fixtures/kotlin"
const { RealKotlinAnalyzer } = await import("../../src/ast/real-kotlin-analyzer")
const analyzer = new (RealKotlinAnalyzer as any)()
const parser: any = await getParser("kotlin" as any)
type Row = { t: string; from: string; target: string; md: any }
async function run(file: string, flagOn: boolean): Promise<Row[]> {
  if (flagOn) process.env.BB_KOTLIN_IMPORT_CLAIM = "1"
  else delete process.env.BB_KOTLIN_IMPORT_CLAIM
  const content = readFileSync(file, "utf8")
  const tree = parser.parse(content)
  const res: any = await analyzer.analyze(tree.rootNode, content, file)
  tree.delete?.()
  return (res.relationships ?? []).map((r: any) => ({ t: r.type, from: r.source, target: r.target, md: r.metadata ?? {} }))
}
const fails: string[] = []
function check(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`)
  if (!cond) fails.push(name)
}
// ── both-direction assertions on the six claim fixtures ──────────────────────────────────────────────
{
  const ext = await run(`${FIX}/import-claim-external.kt`, true)
  const imp = ext.find((r) => r.t === "imports" && r.target === "kotlin.math.abs")
  check("external import publishes evidence", !!imp && Array.isArray(imp.md.importedBindings) && imp.md.importedBindings[0] === "abs" && imp.md.module === "kotlin.math.abs")
  const call = ext.find((r) => r.t === "calls" && r.target === "abs")
  check("external bare call carries the claim", !!call && call.md.importedBinding?.binding === "abs" && call.md.importedBinding?.specifier === "kotlin.math.abs")
  const alias = await run(`${FIX}/import-claim-alias.kt`, true)
  const aCall = alias.find((r) => r.t === "calls" && r.target === "makeList")
  check("aliased external import claims the ALIAS", !!aCall && aCall.md.importedBinding?.binding === "makeList")
  const project = await run(`${FIX}/import-claim-project.kt`, true)
  check("project import is UNMARKED", project.every((r) => r.md.importedBindings === undefined && r.md.importedBinding === undefined))
  const shadow = await run(`${FIX}/import-claim-shadowed.kt`, true)
  const shadowCall = shadow.find((r) => r.t === "calls" && r.target === "abs")
  check("file-shadowed name is UNMARKED", !!shadowCall && shadowCall.md.importedBinding === undefined)
  const recv = await run(`${FIX}/import-claim-receiver.kt`, true)
  const recvCall = recv.find((r) => r.t === "calls" && r.target === "abs")
  check("receiver-carrying row is skipped in cut 1", !!recvCall && recvCall.md.importedBinding === undefined)
  const wild = await run(`${FIX}/import-claim-wildcard.kt`, true)
  check("on-demand import binds nothing", wild.every((r) => r.md.importedBindings === undefined && r.md.importedBinding === undefined))
}
// ── DEFAULT-OFF byte-identity: off adds no claim key and changes no edge ─────────────────────────────
{
  const files = readdirSync(FIX).filter((f) => /^import-claim-.*\.kt$/.test(f)).map((f) => `${FIX}/${f}`)
  let identical = true
  for (const f of files) {
    const off = await run(f, false)
    const on = await run(f, true)
    const key = (r: Row) => `${r.t}|${r.from}|${r.target}`
    const strip = (rs: Row[]) => rs.map(key).sort().join("\n")
    if (strip(off) !== strip(on)) identical = false
    if (off.some((r) => r.md.importedBindings !== undefined || r.md.importedBinding !== undefined)) identical = false
  }
  check("DEFAULT-OFF byte-identity: no claim metadata, edge surface identical", identical)
}
// ── bounded sample sizing for the pre-committed arm table ────────────────────────────────────────────
type Size = { files: number; externalImports: number; claimsCalls: number; claimsUses: number; cut2ReceiverCandidates: number; projectImports: number }
async function sizeSample(): Promise<{ s: Size; population: number; repos: number }> {
  const EXT = [".kt", ".kts"], SIZE = 1024 * 1024
  const found: string[] = []; const repos = new Set<string>()
  for (const name of readdirSync(CR).sort()) {
    const dir = path.join(CR, name)
    try { if (!statSync(dir).isDirectory()) continue } catch { continue }
    try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
    let tracked: string[] = []
    try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0") } catch { continue }
    for (const rel of tracked) {
      if (!rel || !EXT.some((e) => rel.toLowerCase().endsWith(e))) continue
      const abs = path.join(dir, rel)
      try { if (statSync(abs).size > SIZE) continue } catch { continue }
      found.push(abs); repos.add(name)
    }
  }
  found.sort()
  const stride = Math.max(1, Math.floor(found.length / CAP))
  const sample: string[] = []
  for (let i = 0; i < found.length && sample.length < CAP; i += stride) sample.push(found[i])
  const s: Size = { files: sample.length, externalImports: 0, claimsCalls: 0, claimsUses: 0, cut2ReceiverCandidates: 0, projectImports: 0 }
  for (const f of sample) {
    const rows = await run(f, true)
    const boundSpecs = new Set<string>()
    for (const r of rows) if (r.t === "imports") {
      if (Array.isArray(r.md.importedBindings)) { s.externalImports++; boundSpecs.add(r.target) } else s.projectImports++
    }
    const bindingByLeaf = new Map<string, string>()
    for (const r of rows) if (r.t === "imports" && Array.isArray(r.md.importedBindings)) for (const b of r.md.importedBindings) bindingByLeaf.set(b, r.target)
    for (const r of rows) {
      if (r.md.importedBinding !== undefined) { if (r.t === "calls") s.claimsCalls++; else if (r.t === "uses") s.claimsUses++ }
      else if ((r.t === "calls" || r.t === "uses") && bindingByLeaf.has(r.target)) s.cut2ReceiverCandidates++
    }
  }
  return { s, population: found.length, repos: repos.size }
}
const { s, population, repos } = await sizeSample()
console.log("\nSIZING (bounded sample; stride):", JSON.stringify({ population, repos, ...s }, null, 1))
console.log("fails:", fails.length)
if (fails.length > 0) process.exit(3)
