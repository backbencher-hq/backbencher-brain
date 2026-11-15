/**
 * WHICH CODE CLIMBS? — attributing `parent` crossings to call sites
 *
 * ## The question the census could not answer
 *
 * `node-crossing-census.ts` measured the shape of the cost: `parent` and `type` crossings
 * both scale as n^2 on a nested-if spine, which is the signature of a per-node ancestor
 * CLIMB. It did not say WHICH climb.
 *
 * That matters because the analyzer has both kinds. Six ancestor walks exist and most are
 * explicitly bounded:
 *
 *     2536  isTypeParameterShadowed     while (cur && guard++ < 32)
 *     2910  selectorIsLhsWrite          while (p && guard++ < 16)
 *     3058  isBindingPatternContext     while (p && guard++ < 8)
 *     3131  isInsideTemplateSubstitution while (p && guard++ < 8)
 *     3255  enclosingTypeDecl           (guard checked at the loop head)
 *     3464  formal-parameter group      while (p && p.type !== "optional_formal_parameters") p = p.parent   <- UNGUARDED
 *
 * Reading them and picking one would be a guess, and a guess here is unfalsifiable: every
 * one of these loops produces identical crossings. So the attribution is MEASURED, by
 * sampling the JS call stack on a fraction of crossings and aggregating the frames that
 * appear.
 *
 * ## Why sampling rather than counting per site
 *
 * Capturing `new Error().stack` on every crossing costs more than the crossing itself and
 * would dominate the measurement. Sampling every Nth crossing is enough to rank call sites
 * by share of the cost, and the share is what the fix needs. The sample rate is printed, so
 * the ranking's precision is declared rather than implied.
 *
 * Only stacks that contain an analyzer frame are counted, so the wasm unmarshalling frames
 * beneath the analyzer do not crowd out the frames being attributed.
 *
 * Run: npx tsx validation/m14/fixtures/dart/climb-attribution.ts [n] [sampleEvery]
 */
import { mkdirSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"

const ROOT = process.cwd()
const N = Number(process.argv[2] ?? 400)
const SAMPLE_EVERY = Number(process.argv[3] ?? 97)

const wts: any = await import("web-tree-sitter")
const g: any = globalThis
g.__s = { parent: 0, type: 0, sampled: 0, sites: new Map<string, number>() }

const NODE_PROTO = wts.Node?.prototype ?? wts.SyntaxNode?.prototype
if (!NODE_PROTO) throw new Error("no Node prototype")

/** Record the nearest analyzer frame in the stack — the code doing the climbing. */
function attribute(kind: string) {
  const st = new Error().stack ?? ""
  for (const line of st.split("\n").slice(1)) {
    if (!/real-dart-analyzer\.ts/.test(line)) continue
    const m = line.match(/real-dart-analyzer\.ts:(\d+):(\d+)/)
    const site = m ? `${m[1]}:${m[2]}` : "real-dart-analyzer.ts:?"
    const key = `${kind} @ ${site}`
    g.__s.sites.set(key, (g.__s.sites.get(key) ?? 0) + 1)
    return
  }
  const key = `${kind} @ (no analyzer frame)`
  g.__s.sites.set(key, (g.__s.sites.get(key) ?? 0) + 1)
}

for (const [prop, key] of [["parent", "parent"], ["type", "type"]] as const) {
  const d = Object.getOwnPropertyDescriptor(NODE_PROTO, prop)!
  if (!d.get) throw new Error(`${prop} is not a getter`)
  Object.defineProperty(NODE_PROTO, prop, {
    configurable: true,
    get() {
      g.__s[key]++
      // Count every crossing; sample every SAMPLE_EVERYth for attribution.
      if (g.__s[key] % SAMPLE_EVERY === 0) { g.__s.sampled++; attribute(key) }
      return d.get.call(this)
    },
  })
}

function nestedIfs(n: number): string {
  let s = "var x = 0;\n\nmain() {\n"
  for (let i = 0; i < n; i++) s += `  if (x == 0) { //# 01: continued\n`
  s += "x = 1;\n" + "}\n".repeat(n) + "  return x;\n}\n"
  return s
}

const FIX = "/tmp/opencode/dart-generated"
mkdirSync(FIX, { recursive: true })
const f = path.join(FIX, `climb-${N}.dart`)
writeFileSync(f, nestedIfs(N))

console.log(`climb attribution — n=${N} nested ifs, sampling every ${SAMPLE_EVERY} crossings`)
await parseFile(f, path.dirname(f))

const total = g.__s.parent + g.__s.type
console.log(`\ncrossings: parent=${g.__s.parent}  type=${g.__s.type}  total=${total}`)
console.log(`sampled ${g.__s.sampled} stacks\n`)

const rows = [...g.__s.sites.entries()].sort((a, b) => b[1] - a[1])
console.log(`  ${"share".padStart(7)}  ${"sampled".padStart(7)}  call site (real-dart-analyzer.ts:line:col)`)
for (const [site, c] of rows) {
  console.log(`  ${((100 * c) / g.__s.sampled).toFixed(2).padStart(6)}%  ${String(c).padStart(7)}  ${site}`)
}

console.log(`
READING IT
  Every crossing is counted; only every ${SAMPLE_EVERY}th is attributed, so the percentages
  are a RANKING of call sites by share of the cost, not an exact per-site total. The
  ranking is what a fix needs — it names the code, which the aggregate census cannot.
  The sampled fraction is printed above so the precision of the claim is declared.`)

void mkdirSync