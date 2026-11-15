// #896 zero-symbol-delta A/B: dump the groovy analyzer's FULL production output
// (symbols + relationships + imports + exports + errors + metadata) for a
// deterministic corpus sample, so the handler-map refactor can be proven
// behaviour-preserving by comparing two dumps rather than by believing a diff.
//
// The sample is derived from the sorted grails-core file list (stride-sampled),
// so the same invocation always measures the same files.
//
// Run: bun script/m14/tmp/g896-ab-dump.ts <out.json> [fileCount]
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs"
import { createHash } from "node:crypto"
import path from "node:path"
import { parseFile } from "../../../src/ast/pool-worker"

const CORPUS = "/home/ishaq2321/bb_tests/repositories/grails-core"
const OUT = process.argv[2]
const WANT = Number(process.argv[3] ?? 250)
if (!OUT) {
  console.error("usage: bun script/m14/tmp/g896-ab-dump.ts <out.json> [fileCount]")
  process.exit(1)
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === ".git" || e.name === "build" || e.name === "node_modules") continue
      walk(p, acc)
    } else if (e.name.endsWith(".groovy") || e.name.endsWith(".gradle")) acc.push(p)
  }
  return acc
}

const all = walk(CORPUS).sort()
const stride = Math.max(1, Math.floor(all.length / WANT))
const sample: string[] = []
for (let i = 0; i < all.length && sample.length < WANT; i += stride) sample.push(all[i])

// Canonical form: the analyzer's own output, with volatile fields removed and
// every collection sorted, so the comparison is about CONTENT not ordering.
function canon(v: any): any {
  if (Array.isArray(v)) return v.map(canon)
  if (v && typeof v === "object") {
    const out: Record<string, any> = {}
    for (const k of Object.keys(v).sort()) {
      if (k === "duration" || k === "durationMs" || k === "elapsed" || k === "indexedAt" || k === "generatedAt") continue
      out[k] = canon(v[k])
    }
    return out
  }
  return v
}
const key = (o: any) => JSON.stringify(canon(o))

const rows: any[] = []
let failed = 0
for (const f of sample) {
  const rel = path.relative(CORPUS, f)
  try {
    const r: any = await parseFile(f, CORPUS)
    rows.push({
      file: rel,
      success: r.success,
      language: r.language,
      symbols: (r.symbols ?? []).map(canon).sort((a: any, b: any) => key(a).localeCompare(key(b))),
      relationships: (r.relationships ?? []).map(canon).sort((a: any, b: any) => key(a).localeCompare(key(b))),
      imports: (r.imports ?? []).map(canon).sort((a: any, b: any) => key(a).localeCompare(key(b))),
      exports: (r.exports ?? []).map(canon).sort((a: any, b: any) => key(a).localeCompare(key(b))),
      errors: (r.errors ?? []).map(canon).sort((a: any, b: any) => key(a).localeCompare(key(b))),
      metadata: canon(r.metadata ?? {}),
    })
  } catch (e: any) {
    failed++
    rows.push({ file: rel, threw: String(e?.message ?? e) })
  }
}

const totals = rows.reduce(
  (a, r) => ({
    files: a.files + 1,
    symbols: a.symbols + (r.symbols?.length ?? 0),
    relationships: a.relationships + (r.relationships?.length ?? 0),
    imports: a.imports + (r.imports?.length ?? 0),
    errors: a.errors + (r.errors?.length ?? 0),
  }),
  { files: 0, symbols: 0, relationships: 0, imports: 0, errors: 0 },
)

const payload = { corpus: CORPUS, stride, sampled: sample.length, ofTotal: all.length, totals, failed, rows }
writeFileSync(OUT, JSON.stringify(payload, null, 1) + "\n")
const digest = createHash("sha256").update(JSON.stringify(payload.rows)).digest("hex").slice(0, 16)
console.log(`wrote ${OUT}`)
console.log(`files=${totals.files} (of ${all.length}, stride ${stride}) symbols=${totals.symbols} relationships=${totals.relationships} imports=${totals.imports} errors=${totals.errors} threw=${failed}`)
console.log(`contentDigest=${digest}`)
// the digest must not include the input ordering: prove stability by re-hashing sorted rows
const sortedDigest = createHash("sha256").update(JSON.stringify([...payload.rows].sort((a, b) => a.file.localeCompare(b.file)))).digest("hex").slice(0, 16)
console.log(`contentDigest(fileSorted)=${sortedDigest}`)
console.log(`treeDigest=${createHash("sha256").update(readFileSync(OUT)).digest("hex").slice(0, 16)}`)
void statSync
