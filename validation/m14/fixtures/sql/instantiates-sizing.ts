// INSTANTIATES SIZING — the funnel from construct site to emitted edge.
//
// THE GAP. SQL-D13 rules that `instantiates` is a composite-type construction
// (`ROW(...)::t`, a list/array constructor), and deliberately NOT a conversion (`x::my_enum`
// converts a value that already exists). The lane census measures 0 `instantiates` edges in the
// 594-file duckdb corpus against 24 `cast` nodes carrying a `custom_type` FIELD, and 21 edges over
// the 1,526-file pooled corpus against 184 such nodes. "0 edges against 24 sites" is only a defect
// if some of those 24 are CONSTRUCTIONS; if all 24 are conversions the ruling excludes, the 0 is
// the ruling working. That question cannot be answered from a count of casts, so this probe
// replays the analyzer's own funnel and reports WHERE each site stops:
//
//   keywordOrBuiltin   the target name is a SQL keyword or a known builtin -> suppressed (D3)
//   noReadableTarget   the `custom_type` field yields no leaf name
//   noValueSide        nothing before the `::`, or the `::` never appears
//   valueHasError      the value side carries an ERROR node (a damaged parse, not a construction)
//   conversion         the value side names an existing value -> the D13 exclusion
//   CONSTRUCTION       the value side builds (ROW(...) invocation, list, array) -> should emit
//
// The `conversion` bucket is broken down by the value node's TYPE so the exclusion can be audited
// rather than trusted: if a node type that genuinely constructs appears there, the ruling is
// under-delivering and the funnel says so.
//
// USAGE: bun validation/m14/fixtures/sql/instantiates-sizing.ts <corpusRoot> [--pools]
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { getParser } from "../../../../src/ast/engine.ts"

const args = process.argv.slice(2)
const POOLED = args.includes("--pools")
const ROOT = args.find((a) => !a.startsWith("--")) || "/home/ishaq2321/bb_tests/repositories/duckdb"
const CAP = 1_000_000

function walk(dir: string, out: string[] = [], depth = 0): string[] {
  if (depth > 24) return out
  let ents: any[]
  try { ents = readdirSync(dir, { withFileTypes: true }) } catch { return out }
  ents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  for (const e of ents) {
    const p = join(dir, e.name)
    if (e.isDirectory()) { if (!/node_modules|\.git|third_party/.test(e.name)) walk(p, out, depth + 1) }
    else if (e.name.endsWith(".sql")) { try { if (statSync(p).size <= CAP) out.push(p) } catch {} }
  }
  return out
}

const m: any = await import("../../../../src/ast/real-sql-analyzer.ts")
const Cls = Object.values(m).find((v: any) => typeof v === "function" && /Analyzer$/.test(v.name)) as any
// The analyzer's own predicates, reached through a throwaway instance. If any of these are
// renamed the probe fails loudly rather than silently counting every cast as a conversion.
const probe: any = new Cls()
for (const fn of ["constructsAValue", "referenceLeaf", "referenceNameNode"]) {
  if (typeof probe[fn] !== "function") throw new Error(`analyzer no longer exposes ${fn}() — this sizing probe is measuring a rule that moved`)
}
const { SQL_KEYWORDS, SQL_BUILTINS } = await import("../../../../src/ast/real-sql-analyzer.ts")
// `referenceLeaf` -> `identifierName` touches exactly one field of ParseState
// (`ambiguity.quotedIdentifiers++`, and only for a quoted name), so a permissive counter stub is
// enough to call the analyzer's OWN predicate rather than re-implementing quote stripping here.
// Auto-vivifying means a future counter added to that path reads 0 instead of throwing.
const makeState = (): any => ({
  ambiguity: new Proxy({}, {
    get: (t: any, k: string) => (k in t ? t[k] : 0),
    set: (t: any, k: string, v: any) => { t[k] = v; return true },
  }),
})

const stateStub: any = makeState()
const files = walk(ROOT)
const funnel: Record<string, number> = {
  castNodes: 0, withCustomTypeField: 0, keywordOrBuiltin: 0, noReadableTarget: 0,
  noValueSide: 0, valueHasError: 0, conversion: 0, CONSTRUCTION: 0,
}
const convByValueType = new Map<string, number>()
const ctorByValueType = new Map<string, number>()
const ctorSites: { file: string; target: string; valueType: string; chain: string; text: string }[] = []
const convSites: { file: string; target: string; valueType: string; text: string }[] = []
const errSites: { file: string; target: string; text: string }[] = []
const convDistinctTargets = new Map<string, number>()
let parsed = 0
let emitted = 0
const emittedFiles = new Set<string>()
const emittedSites = new Map<string, number>()
const emittedPairs = new Map<string, number>()
let counterTotal = 0

for (const f of files) {
  let content: string
  try { content = readFileSync(f, "utf8") } catch { continue }
  const parser = await getParser("sql")
  const pr = await parser.parse(content, f)
  const res = new Cls().analyze(pr.rootNode, content, f)
  parsed++
  for (const r of res.relationships || []) {
    if (String((r as any).type ?? (r as any).relationshipType) !== "instantiates") continue
    emitted++; emittedFiles.add(f)
    const t = String((r as any).target ?? "")
    emittedSites.set(t, (emittedSites.get(t) || 0) + 1)
    emittedPairs.set(`${relative(ROOT, f)}\u0000${t}`, (emittedPairs.get(`${relative(ROOT, f)}\u0000${t}`) || 0) + 1)
  }
  counterTotal += Number(res.metadata?.ambiguity?.instantiationsEmitted ?? 0)
  // A full tree walk, independent of which subtrees the analyzer chose to descend.
  const stack: any[] = [pr.rootNode]
  while (stack.length) {
    const n = stack.pop()
    if (n.type === "cast") {
      funnel.castNodes++
      const target = n.childForFieldName?.("custom_type") ?? null
      if (target) {
        funnel.withCustomTypeField++
        const name = probe.referenceLeaf(target, stateStub)
        if (!name) funnel.noReadableTarget++
        else {
          const lowered = String(name).toLowerCase()
          if (SQL_KEYWORDS.has(lowered) || SQL_BUILTINS.has(lowered)) funnel.keywordOrBuiltin++
          else {
            let value: any = null
            for (let i = 0; i < n.childCount; i++) {
              const c = n.child(i)
              if (!c) continue
              if (c.type === "::") break
              if (c.isNamed) value = c
            }
            if (!value) funnel.noValueSide++
            else if (value.hasError) {
              funnel.valueHasError++
              if (errSites.length < 60) errSites.push({ file: relative(ROOT, f), target: String(name), text: content.slice(n.startIndex, n.endIndex).slice(0, 90).replace(/\s+/g, " ") })
            }
            else if (probe.constructsAValue(value)) {
              funnel.CONSTRUCTION++
              ctorByValueType.set(value.type, (ctorByValueType.get(value.type) || 0) + 1)
              const chain: string[] = []
              for (let a = n.parent, d = 0; a && d < 6; a = a.parent, d++) chain.push(a.type)
              ctorSites.push({ file: relative(ROOT, f), target: String(name), valueType: value.type,
                               chain: chain.join("<"), text: content.slice(n.startIndex, n.endIndex).slice(0, 80).replace(/\s+/g, " ") })
            } else {
              funnel.conversion++
              convByValueType.set(value.type, (convByValueType.get(value.type) || 0) + 1)
              convDistinctTargets.set(String(name), (convDistinctTargets.get(String(name)) || 0) + 1)
              if (convSites.length < 400) {
                convSites.push({ file: relative(ROOT, f), target: String(name), valueType: value.type, text: content.slice(n.startIndex, n.endIndex).slice(0, 70).replace(/\s+/g, " ") })
              }
            }
          }
        }
      }
    }
    const kids = n.children ?? []
    for (let i = kids.length - 1; i >= 0; i--) if (kids[i]) stack.push(kids[i])
  }
}


const p = (s: any, n: number) => String(s).padEnd(n)
const pl = (s: any, n: number) => String(s).padStart(n)
console.log(`INSTANTIATES SIZING`)
console.log(`corpus: ${ROOT}   scope: ${POOLED ? "PER REPO" : "single project"}`)
console.log(`files: ${files.length}   parsed: ${parsed}\n`)
console.log(`THE FUNNEL (site -> edge), replayed from the analyzer's own predicates:`)
const order = ["castNodes", "withCustomTypeField", "keywordOrBuiltin", "noReadableTarget", "noValueSide", "valueHasError", "conversion", "CONSTRUCTION"]
const labels: Record<string, string> = {
  castNodes: "cast nodes (all)", withCustomTypeField: "  ...carrying a custom_type FIELD",
  keywordOrBuiltin: "    stopped: keyword/builtin target (D3)", noReadableTarget: "    stopped: no readable target name",
  noValueSide: "    stopped: no value side", valueHasError: "    stopped: value has ERROR (damaged parse)",
  conversion: "    stopped: CONVERSION — excluded by D13", CONSTRUCTION: "    reached: CONSTRUCTION (should emit)",
}
for (const k of order) console.log(`  ${p(labels[k], 48)}${pl(funnel[k], 7)}`)
console.log(`\n  edges the analyzer ACTUALLY emitted ........... ${pl(emitted, 7)}  in ${emittedFiles.size} file(s)`)
console.log(`  CONSTRUCTION sites vs emitted: ${funnel.CONSTRUCTION} vs ${emitted}`)
if (emittedSites.size) {
  console.log(`  emitted targets: ${[...emittedSites].map(([k, v]) => `${k}:${v}`).join("  ")}`)
}
// ── WHICH CONSTRUCTION SITES PRODUCED NO EDGE, and why
{
  const left = new Map(emittedPairs)
  const unmatched: typeof ctorSites = []
  for (const site of ctorSites) {
    const k = `${site.file}\u0000${site.target}`
    const n = left.get(k) || 0
    if (n > 0) left.set(k, n - 1)
    else unmatched.push(site)
  }
  const distinctSites = new Set(ctorSites.map((x) => `${x.file}\u0000${x.target}`))
  console.log(`\nDEDUP TEST — at (file, target) granularity, where the edge key lives:`)
  console.log(`  construction SITES (every occurrence) ........ ${ctorSites.length}`)
  console.log(`  distinct (file, target) pairs ............... ${distinctSites.size}`)
  console.log(`  instantiates edges actually emitted ......... ${emitted}`)
  console.log(`  => dedup ${distinctSites.size === emitted ? "FULLY explains" : "does NOT fully explain"} the difference`)
  if (distinctSites.size !== emitted) {
    const have = new Set(emittedPairs.keys())
    const missing = [...distinctSites].filter((k) => !have.has(k))
    console.log(`  (file,target) pairs with NO edge at all: ${missing.length}`)
    for (const k of missing.slice(0, 20)) console.log(`     ${k.replace("\u0000", "  ->  ")}`)
  }
  console.log(`\nCONSTRUCTION SITES THAT PRODUCED NO EDGE: ${unmatched.length} of ${ctorSites.length}`)
  console.log(`  analyzer's own ambiguity.instantiationsEmitted (SITES it processed): ${counterTotal}`)
  console.log(`  edges actually added: ${emitted}   (dedup key is type+source+target+memberKind)`)
  const byChain = new Map<string, number>()
  for (const u of unmatched) byChain.set(u.chain, (byChain.get(u.chain) || 0) + 1)
  console.log(`  unmatched sites by ANCESTOR CHAIN (site's parents outward):`)
  for (const [k, v] of [...byChain].sort((a, b) => b[1] - a[1])) console.log(`    ${String(v).padStart(4)}  ${k}`)
  console.log(`  the unmatched sites (up to 25):`)
  for (const u of unmatched.slice(0, 25)) console.log(`    ${u.file}\n        ${u.text}`)
}

console.log(`\nCONVERSIONS EXCLUDED, by the value node's TYPE (audit of the D13 exclusion):`)
for (const [k, v] of [...convByValueType].sort((a, b) => b[1] - a[1])) console.log(`  ${p(k, 26)}${pl(v, 6)}`)
console.log(`\nCONSTRUCTIONS FOUND, by value node type:`)
if (!ctorByValueType.size) console.log(`  (none)`)
for (const [k, v] of [...ctorByValueType].sort((a, b) => b[1] - a[1])) console.log(`  ${p(k, 26)}${pl(v, 6)}`)
if (ctorSites.length) {
  console.log(`\n  the construction sites (up to 40):`)
  for (const s of ctorSites.slice(0, 40)) console.log(`    ${s.target}  <- ${s.valueType}   ${s.file}`)
}
console.log(`\nconversion targets: ${convDistinctTargets.size} distinct name(s); top 15:`)
for (const [k, v] of [...convDistinctTargets].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`  ${p(k, 30)}${pl(v, 5)}`)
console.log(`\nDAMAGED-PARSE SITES (value side carries an ERROR) — a GRAMMAR limit, not an analyzer one:`)
for (const s2 of errSites.slice(0, 30)) console.log(`  ${p(s2.target, 16)} ${s2.text}`)
console.log(`  (${funnel.valueHasError} total)`)

console.log(`\nTHE INVOCATION-VALUED CONVERSIONS — the ONLY bucket a real constructor could hide in,`)
console.log(`because \`constructsAValue\` accepts only a callee literally named \`row\`:`)
for (const s3 of convSites.filter((x) => x.valueType === "invocation").slice(0, 20)) {
  console.log(`  ${p(s3.target, 22)} ${s3.file}\n      ${s3.text}`)
}
console.log(`  (${convByValueType.get("invocation") ?? 0} total invocation-valued conversions)`)

console.log(`\nconversion SAMPLE (up to 25, with source text, so the exclusion can be eyeballed):`)
for (const s of convSites.slice(0, 25)) console.log(`  ${p(s.valueType, 18)} ${p(s.target, 22)} ${s.text}`)
