#!/usr/bin/env bun
/**
 * Cross-lane AST walk cost — the instrument for a bug class no gate could see.
 *
 * WHY THIS EXISTS. The engine used to cut any file over 1 MiB to its first 1 MiB
 * before parsing (`MAX_PARSE_BYTES`, since raised). That truncation was hiding a
 * per-node tree walk in the JavaScript analyzer: a minified 1.89 MB file took 347
 * seconds, of which `parser.parse` was 4.8 s and the ANALYZER 357.8 s. Two
 * predicates — `isNodeInDeadSpans` and `inDecoratorPosition` — walked the
 * ancestor chain once per node to return an answer they already had (44.6% and
 * 15.0% of CPU samples). No gate could have caught it, because the gate would
 * have had to parse a file the cap refused to let the parser finish.
 *
 * WHAT IT MEASURES, and why that number. Wall-clock is machine-dependent and so
 * is a poor gate. These two are not:
 *
 *   typeReadsPerNode  how many times the analyzer reads `.type` per tree node
 *   parentHopsPerNode  how many times it walks to a parent per tree node
 *
 * `.type` is a WASM boundary crossing (`ts_node_symbol` plus marshal/unmarshal),
 * so a walker that checks `.type` at each ancestor level pays that cost at every
 * level, for every node. Measured across the corpus, real analyzers sit at
 * 19-69 reads per node. A single-digit figure is the target; anything in the
 * dozens means an ancestor walk is running per node and the cost is
 * superlinear in depth. That is the signature, and it is portable.
 *
 * WHAT IT DOES NOT DO. It does not attribute cost to a function — use a CPU
 * profile for that (`node:inspector/promises`, 2 ms sampling, then attribute each
 * sample to the nearest JS caller; that is how the two functions above were
 * named). This ranks lanes so the next person knows where to look, and it fails
 * loudly when a lane regresses past a threshold.
 *
 * USAGE
 *   bun run script/m14/ast-walk-cost.ts                 # the default sample
 *   bun run script/m14/ast-walk-cost.ts --json          # machine-readable
 *   bun run script/m14/ast-walk-cost.ts --lang zig,cpp # a subset
 *   bun run script/m14/ast-walk-cost.ts --threshold 20  # fail above N type/node
 */
import { existsSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { ASTEngine, parseFile } from "../../src/ast/engine"

const CORPUS = process.env.BB_CORPUS_ROOT ?? "$HOME/ishaq/fixtures/repositories"

/**
 * One file per lane, chosen for SIZE and DEPTH rather than for being interesting:
 * the cost class only shows on large, deeply nested input, so a small tidy file
 * measures nothing. Each entry records why that file is the sample.
 */
const SAMPLES: { lang: string; rel: string; why: string }[] = [
  { lang: "javascript", rel: "aspnetcore/src/Http/Routing/test/testassets/RoutingSandbox/wwwroot/full.render.js",
    why: "minified: 84 lines, one 310,647 chars, depth 75 — the 347 s file" },
  { lang: "zig", rel: "zig/src/codegen/x86_64/CodeGen.zig",
    why: "10.4 MB, 1.99M nodes — the largest source file in the corpus" },
  { lang: "csharp", rel: "roslyn/src/Compilers/CSharp/Test/Semantic/Semantics/NullableReferenceTypesTests.cs",
    why: "6.3 MB generated test corpus, depth-heavy" },
  { lang: "cpp", rel: "nlohmann-json/single_include/nlohmann/json.hpp",
    why: "1.27 MB single-header amalgamation, class body 2,600+ lines" },
  { lang: "typescript", rel: "aspnetcore/src/SignalR/clients/ts/signalr/tests/HttpConnection.test.ts",
    why: "the largest TypeScript surface in the corpus; typescript walks the same tree as javascript" },
]

/** Machine-independent. Real analyzers measure 19-69; single digits is the target. */
const DEFAULT_THRESHOLD = 40

type Counters = { type: number; parent: number; childForFieldName: number; namedChild: number }

function instrument(): { counters: Counters; installed: boolean } {
  const counters: Counters = { type: 0, parent: 0, childForFieldName: 0, namedChild: 0 }
  let installed = false
  return {
    counters,
    get installed() {
      return installed
    },
    // called once the prototype is known
    ...({} as Record<string, never>),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    install(proto: any) {
      if (installed) return
      installed = true
      for (const k of ["parent", "type", "childForFieldName", "namedChild"] as const) {
        const d = Object.getOwnPropertyDescriptor(proto, k)
        if (!d?.get) continue
        const orig = d.get
        Object.defineProperty(proto, k, {
          ...d,
          get(this: unknown) {
            counters[k]++
            return orig.call(this)
          },
        })
      }
    },
  }
}

function countNodes(root: any): number {
  let n = 0
  const v = (x: any) => {
    n++
    for (let i = 0; i < x.namedChildCount; i++) {
      const c = x.namedChild(i)
      if (c) v(c)
    }
  }
  v(root)
  return n
}

interface Row {
  lang: string
  rel: string
  why: string
  bytes: number
  nodes: number
  typeReads: number
  parentHops: number
  typePerNode: number
  parentPerNode: number
  ms: number
  symbols: number
  relationships: number
  error?: string
}

async function measure(lang: string, rel: string, why: string, inst: ReturnType<typeof instrument>): Promise<Row> {
  const abs = join(CORPUS, rel)
  const row: Row = {
    lang, rel, why, bytes: 0, nodes: 0, typeReads: 0, parentHops: 0,
    typePerNode: 0, parentPerNode: 0, ms: 0, symbols: 0, relationships: 0,
  }
  if (!existsSync(abs)) {
    row.error = "sample missing from the corpus"
    return row
  }
  const src = readFileSync(abs, "utf8")
  row.bytes = Buffer.byteLength(src)
  let tree: any
  try {
    tree = (await ASTEngine.parseTree(abs, src)).tree
  } catch (e) {
    row.error = `parse failed: ${String((e as Error)?.message ?? e).slice(0, 80)}`
    return row
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inst.install(Object.getPrototypeOf(tree.rootNode))
  row.nodes = countNodes(tree.rootNode)
  for (const k of Object.keys(inst.counters) as (keyof Counters)[]) inst.counters[k] = 0
  const t0 = Date.now()
  try {
    const r: any = await parseFile(abs, src)
    row.symbols = (r?.symbols ?? []).length
    row.relationships = (r?.relationships ?? []).length
  } catch (e) {
    row.error = `analyze failed: ${String((e as Error)?.message ?? e).slice(0, 80)}`
  }
  row.ms = Date.now() - t0
  row.typeReads = inst.counters.type
  row.parentHops = inst.counters.parent
  row.typePerNode = +(row.typeReads / Math.max(1, row.nodes)).toFixed(1)
  row.parentPerNode = +(row.parentHops / Math.max(1, row.nodes)).toFixed(1)
  return row
}

const argv = process.argv.slice(2)
const asJson = argv.includes("--json")
const threshold = argv.includes("--threshold")
  ? Number(argv[argv.indexOf("--threshold") + 1])
  : DEFAULT_THRESHOLD
const only = argv.includes("--lang")
  ? argv[argv.indexOf("--lang") + 1].split(",").map((s) => s.trim())
  : null

const inst = instrument()
const rows: Row[] = []
for (const s of SAMPLES) {
  if (only && !only.includes(s.lang)) continue
  process.stderr.write(`  measuring ${s.lang}…\n`)
  rows.push(await measure(s.lang, s.rel, s.why, inst))
}
rows.sort((a, b) => b.typePerNode - a.typePerNode)

if (asJson) {
  console.log(JSON.stringify({ threshold, rows }, null, 2))
} else {
  console.log(`\nAST walk cost — machine-independent counters. Threshold: > ${threshold} type-reads/node fails.\n`)
  console.log(
    "  lane         MB      nodes   type/node  parent/node   analyze    symbols   sample",
  )
  for (const r of rows) {
    if (r.error) {
      console.log(`  ${r.lang.padEnd(11)} ${(r.bytes / 1048576).toFixed(2).padStart(5)}  ${r.error}`)
      continue
    }
    const bad = r.typePerNode > threshold
    console.log(
      `  ${r.lang.padEnd(11)} ${(r.bytes / 1048576).toFixed(2).padStart(5)} ${r.nodes.toLocaleString().padStart(9)}` +
        ` ${String(r.typePerNode).padStart(10)}${bad ? " !" : "  "} ${String(r.parentPerNode).padStart(12)}` +
        ` ${(r.ms / 1000).toFixed(1).padStart(7)}s ${r.symbols.toLocaleString().padStart(9)}   ${r.rel.split("/").slice(-1)[0]}`,
    )
  }
  console.log(`\n  Why each sample: `)
  for (const r of rows) console.log(`    ${r.lang.padEnd(11)} ${r.why}`)
  const over = rows.filter((r) => !r.error && r.typePerNode > threshold)
  if (over.length > 0) {
    console.log(
      `\n  ${over.length} lane(s) above ${threshold} type-reads/node: ${over.map((r) => r.lang).join(", ")}.` +
        `\n  That is the per-node-ancestor-walk signature. Attribute it with a CPU profile before changing anything —`,
    )
    console.log(`  the counter ranks lanes, it does not name the function. See this file's header.`)
  }
}

const failures = rows.filter((r) => !r.error && r.typePerNode > threshold)
if (failures.length > 0) process.exit(1)
if (rows.some((r) => r.error)) {
  process.stderr.write(`\n  note: some samples were missing or failed; those lanes are UNMEASURED, not passing.\n`)
  process.exit(2)
}
void statSync