/**
 * ELIXIR — symbol-ID integrity, determinism, and placeholder census.
 *
 * Three questions no gate on this lane asks, two of which are risks this round
 * CREATED:
 *
 * 1. ID COLLISION. The store's symbol id is `${fileId}:${name}:${startLine}`
 *    (parallel-indexer.ts). Two symbols in one file that share a NAME and a
 *    START LINE are the same row: the second insert is a no-op, so a symbol
 *    silently disappears from the index. EX-A14 shares the function merge key
 *    between a `@callback` and a sibling `def` and extends merged ranges to the
 *    last clause — both operations move a startLine, so this round raised the
 *    risk of a collision that no fixture can see (fixtures compare analyzer
 *    output, and the store is where the loss happens).
 *
 * 2. DETERMINISM. The adversarial wave claimed determinism; this round added
 *    Sets, prototype-chained maps, an array-of-names payload and two
 *    order-independent spec registries. The same bytes must produce the same
 *    payload every time, or every fixture pin is a coin flip on a slow box.
 *
 * 3. PLACEHOLDERS. EX-D9 keeps a visible `Unknown` symbol for a dynamically
 *    named definition and claims — on the elixir+phoenix corpora — that no
 *    `Unknown` is ever a MISSED STATIC NAME. Four corpora later, that claim has
 *    never been re-measured. Every occurrence is classified by the node shape
 *    that produced it.
 *
 * CLI: npx tsx script/m14/tmp/elixir-id-integrity.ts --repo=<name> [--sample=N]
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { createHash } from "node:crypto"

const ROOT = "/home/sano/ishaq/backbencher-brain"
const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "/home/sano/ishaq/bb_tests/repositories"
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3)
const REPO = arg("repo") ?? "ecto_sql"
const SAMPLE = Number(arg("sample") ?? "80")
const UNKNOWN_SHAPES = Number(arg("unknown-shapes") ?? "12")

function walk(d: string, out: string[] = []): string[] {
  let e: fs.Dirent[]
  try { e = fs.readdirSync(d, { withFileTypes: true }) } catch { return out }
  for (const x of e) {
    if ([".git", "_build", "deps", "node_modules"].includes(x.name)) continue
    const p = path.join(d, x.name)
    if (x.isDirectory()) walk(p, out)
    else if (x.name.endsWith(".ex") || x.name.endsWith(".exs")) out.push(p)
  }
  return out
}
const digest = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 16)

async function main() {
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const dir = path.join(CORPUS_ROOT, REPO)
  const files = walk(dir).sort()
  const picked = SAMPLE > 0 && SAMPLE < files.length ? files.slice(0, SAMPLE) : files

  let collisions = 0, nonDeterministic = 0, unknownSymbols = 0, symbols = 0
  const collisionEx: string[] = []
  const nondetEx: string[] = []
  const unknownRows: { file: string; line: number; kind: string; owner: string; source: string }[] = []
  const idShape = new Map<string, number>()

  for (const f of picked) {
    const content = fs.readFileSync(f, "utf8")
    const rel = path.relative(dir, f)
    const a: any = await ASTEngine.parseFile(f, content)
    // --- determinism: the SAME bytes, twice, through the same production path
    const b: any = await ASTEngine.parseFile(f, content)
    const da = digest({ s: (a.symbols ?? []).map((s: any) => [s.name, s.kind, s.range, s.ownerName, s.visibility, s.isDeclaration, s.metadata]), r: (a.relationships ?? []).map((x: any) => [x.type, x.source, x.target, x.line_number, x.confidence]) })
    const db = digest({ s: (b.symbols ?? []).map((s: any) => [s.name, s.kind, s.range, s.ownerName, s.visibility, s.isDeclaration, s.metadata]), r: (b.relationships ?? []).map((x: any) => [x.type, x.source, x.target, x.line_number, x.confidence]) })
    if (da !== db) { nonDeterministic++; if (nondetEx.length < 5) nondetEx.push(`${rel} ${da} != ${db}`) }

    // --- id collision: the store's own id key
    const seen = new Map<string, any>()
    for (const s of a.symbols ?? []) {
      symbols++
      const line = s.range?.startLine
      if (typeof line !== "number") { collisionEx.push(`NEGATIVE-OR-MISSING startLine ${rel} ${s.name}`); continue }
      const key = `${s.name}:${line}`
      if (seen.has(key)) {
        collisions++
        if (collisionEx.length < 5) collisionEx.push(`${rel}:${line} "${s.name}" (${s.kind}/${seen.get(key).kind}) — one store row, one symbol LOST`)
      } else seen.set(key, s)
      const shape = `${String(s.kind)}`
      idShape.set(shape, (idShape.get(shape) ?? 0) + 1)
      if (s.name === "Unknown") {
        unknownSymbols++
        if (unknownRows.length < 400) unknownRows.push({ file: rel, line, kind: String(s.kind), owner: String(s.ownerName ?? ""), source: content.split("\n")[line - 1]?.trim().slice(0, 110) ?? "" })
      }
    }
  }

  console.log(`\n######## ELIXIR ID/DETERMINISM/PLACEHOLDER AUDIT — repo=${REPO} files=${picked.length} symbols=${symbols}`)
  console.log(`id collisions (name+startLine, the store's own key): ${collisions}`)
  for (const e of collisionEx) console.log(`    ${e}`)
  console.log(`non-deterministic files (two runs, same bytes): ${nonDeterministic}`)
  for (const e of nondetEx) console.log(`    ${e}`)
  console.log(`Unknown placeholder symbols: ${unknownSymbols}`)
  for (const r of unknownRows.slice(0, UNKNOWN_SHAPES)) console.log(`    ${r.file}:${r.line} ${r.kind} owner=${r.owner}\n        ${r.source}`)
  if (unknownRows.length > UNKNOWN_SHAPES) console.log(`    … ${unknownRows.length - UNKNOWN_SHAPES} more`)
  console.log(JSON.stringify({ REPO, files: picked.length, symbols, collisions, nonDeterministic, unknownSymbols, kinds: Object.fromEntries(idShape) }))
}
main().catch((e) => { console.error(e); process.exit(1) })
