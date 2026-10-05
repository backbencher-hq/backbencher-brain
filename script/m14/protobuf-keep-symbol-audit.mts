/**
 * PROTOBUF LANE — what `keepSymbol` drops, and what that leaves pointing at nothing.
 *
 * ## Why this file exists
 *
 * Pass 20 partitioned this lane's unresolved targets and found exactly ONE unresolved
 * `contains` edge in 39,674 — `controller.custom_options.v1.MaskMapping.this`, at
 * `boundary/internal/proto/controller/custom_options/v1/options.proto:46`:
 *
 *     message MaskMapping {
 *       string this = 1;
 *       string that = 2;
 *     }
 *
 * The cause is not this analyzer. Read straight off `src/ast/pool-worker.ts`:
 *
 *   - `analyze()` publishes the field. Verified directly: the analyzer emits 16 symbols
 *     for this file including `controller.custom_options.v1.MaskMapping.this`, and the
 *     `contains` edge to it.
 *   - pool-worker's symbol projection calls `keepSymbol(s, lang)` (`pool-worker.ts:917`),
 *     and `UNIVERSAL` in that function contains the bare name `"this"`
 *     (`pool-worker.ts:481`). So the symbol is deleted after the analyzer is done with it.
 *   - the relationship survives. `filterNoiseRelationships` does not consult the symbol
 *     set, so the edge is kept and names a symbol the index does not hold.
 *
 * The result is the thing §"INCOMING" of the round brief calls out: an edge the graph
 * cannot walk, asserting a node that is not there. And `this` is not a rare name in
 * this corpus — protobuf is a Java/C#-facing schema language and `this` is the natural
 * spelling of a self-reference, which is why boundary's SDK-option mapping uses it.
 *
 * ## What is measured here, and what is not
 *
 *   droppedByKeepSymbol   symbols this analyzer publishes that `keepSymbol` refuses,
 *                         by name, with the rule that refused them
 *   edgesLeftDangling     edges whose TARGET is a symbol `keepSymbol` dropped —
 *                         the price, in edges the graph cannot walk
 *   edgesLeftDanglingByType  the same, per relationship type
 *
 * Every count is off production `parseFile`, so it is the pipeline's own verdict rather
 * than the analyzer's, and the analyzer is asked separately what it published so the two
 * populations are attributed rather than blended.
 *
 * `pool-worker.ts` is shared machinery (§8). This file PRICES the fix; it does not
 * write it.
 *
 * ## No regex
 *
 * No source text is scanned. Names are compared as strings; `keepSymbol` and
 * `nameTheSymbolRule` are CALLED, not re-implemented, so this probe cannot drift from
 * the rule it audits.
 */

import * as fs from "node:fs"
import * as path from "node:path"
import { parseFile, keepSymbol, nameTheSymbolRule } from "../../src/ast/pool-worker"
import { RealProtobufAnalyzer } from "../../src/ast/real-protobuf-analyzer"
import { getParser } from "./run-fixtures"

const CORPUS = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"

const TYPES = [
  "calls", "uses", "contains", "imports", "references",
  "exports", "extends", "implements", "overrides", "instantiates",
] as const

/**
 * The corpus walk, done the way pass 20's probe does it and for the same reason:
 * `statSync` FOLLOWS SYMLINKS, so a repository holding a symlinked directory has every
 * file under it walked twice and every count doubles. `lstatSync` + `isSymbolicLink`
 * is the fix, and the count is reported against it rather than rounded away.
 */
function walk(dir: string, out: string[], seenSymlinks: { n: number }): void {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isSymbolicLink()) {
      seenSymlinks.n++
      continue
    }
    if (e.isDirectory()) walk(full, out, seenSymlinks)
    else if (e.isFile() && e.name.endsWith(".proto")) out.push(full)
  }
}

async function main(): Promise<void> {
  const files: string[] = []
  const symlinks = { n: 0 }
  walk(CORPUS, files, symlinks)
  files.sort()

  const parser = await getParser("protobuf")
  const analyzer = new RealProtobufAnalyzer()

  const dropped = new Map<string, { rule: string; count: number; files: Set<string> }>()
  const danglingByType: Record<string, number> = {}
  for (const t of TYPES) danglingByType[t] = 0
  const danglingSamples: Record<string, { target: string; from: string; file: string; line: number }[]> = {}
  for (const t of TYPES) danglingSamples[t] = []

  let parsed = 0
  let failed = 0
  let analyzerSymbols = 0
  let productionSymbols = 0
  let danglingTotal = 0

  for (const f of files) {
    let src: string
    try {
      src = fs.readFileSync(f, "utf8")
    } catch {
      continue
    }

    // What the ANALYZER published, before the pipeline touches it. `direct` holds the ids and
    // `directNames` the SAME symbol's own `name` field, because the name is the thing
    // `keepSymbol` reads and re-deriving it from the id's last dotted segment is wrong for
    // protobuf: a package segment and a message segment are indistinguishable in the id, so
    // `id.slice(lastIndexOf('.')+1)` is a guess and a protobuf field named `this` in
    // `MaskMapping` needs the guess to be right to be reported at all.
    let direct: Set<string>
    let directNames: Map<string, string>
    try {
      const tree = parser.parse(src)
      const r: any = analyzer.analyze(tree.rootNode as any, src, f)
      analyzerSymbols += r.symbols.length
      direct = new Set<string>()
      directNames = new Map<string, string>()
      for (const s of r.symbols as any[]) {
        const id = String(s.qualifiedName ?? "")
        if (id === "") continue
        direct.add(id)
        directNames.set(id, String(s.name ?? ""))
      }
    } catch {
      failed++
      continue
    }

    let prod: any
    try {
      prod = await parseFile(f, "protobuf")
    } catch {
      failed++
      continue
    }
    parsed++
    const published = new Set<string>((prod.symbols ?? []).map((s: any) => String(s.qualifiedName ?? "")))
    productionSymbols += published.size

    // Which of the analyzer's own symbols the shared filter refuses, by name.
    //
    // `nameTheSymbolRule` is CALLED on the analyzer's own symbol rather than re-implemented,
    // so the rule this prints is the rule the pipeline runs. An earlier version of this loop
    // looked the symbol up in `prod.symbols` — which by construction cannot contain an id
    // that was just established to be absent from it, so the lookup ALWAYS returned
    // undefined and every row fell through to the derived name. The instrument was
    // reporting a guess under the heading of a measurement.
    for (const id of direct) {
      if (published.has(id)) continue
      const name = directNames.get(id) ?? id.slice(id.lastIndexOf(".") + 1)
      const rule = nameTheSymbolRule({ name, qualifiedName: id }, "protobuf")
      const key = `${name}\0${rule}`
      const cur = dropped.get(key)
      if (cur) {
        cur.count++
        if (cur.files.size < 5) cur.files.add(f)
      } else {
        dropped.set(key, { rule, count: 1, files: new Set([f]) })
      }
    }

    // The price: an edge whose target is a symbol the filter dropped.
    for (const e of (prod.relationships ?? [])) {
      const t = String(e.target ?? "")
      if (t === "" || published.has(t)) continue
      if (direct.has(t)) {
        danglingTotal++
        const ty = String(e.type ?? "?")
        if (ty in danglingByType) danglingByType[ty]++
        const arr = danglingSamples[ty] ?? (danglingSamples[ty] = [])
        if (arr.length < 12) {
          arr.push({ target: t, from: String(e.source ?? ""), file: f, line: Number(e.line_number ?? 0) })
        }
      }
    }
  }

  console.log(`\ncorpus: ${files.length} .proto files walked, ${symlinks.n} symlinked entries skipped`)
  console.log(`parsed ${parsed}  failed ${failed}  analyzer-published symbols ${analyzerSymbols}  production symbols ${productionSymbols}`)

  console.log("\nSYMBOLS THIS ANALYZER PUBLISHED THAT keepSymbol REFUSES")
  console.log("name                         rule                                                 count")
  console.log("-".repeat(100))
  const rows = [...dropped.entries()].sort((a, b) => b[1].count - a[1].count)
  if (rows.length === 0) console.log("(none)")
  for (const [key, v] of rows) {
    const name = key.slice(0, key.indexOf("\0"))
    console.log(`${name.padEnd(28)}${v.rule.padEnd(52)}${v.count}`)
    for (const file of v.files) console.log(`${"".padEnd(28)}  e.g. ${file}`)
  }

  console.log("\nEDGES LEFT NAMING A DROPPED SYMBOL — the price, per type")
  console.log("type         edges")
  console.log("-".repeat(60))
  for (const t of TYPES) if (danglingByType[t] > 0) console.log(`${t.padEnd(13)}${danglingByType[t]}`)
  console.log(`${"TOTAL".padEnd(13)}${danglingTotal}`)

  for (const t of TYPES) {
    const s = danglingSamples[t]
    if (!s || s.length === 0) continue
    console.log(`\n  ${t} — up to ${s.length} named, every one:`)
    for (const r of s) console.log(`    ${r.file}:${r.line}  ${r.from} -> ${r.target}`)
  }
}

await main()