/**
 * DUMP EVERY `contains`, `imports` and `exports` EDGE THE ANALYZER EMITS.
 *
 * ## Why this exists
 *
 * Four of this lane's five emitted types were adjudicated against nothing but this
 * lane's own hand-derived expectations. `protoc` is a reference implementation that
 * shares no code with a vendored tree-sitter grammar, and a `FileDescriptorProto`
 * answers all three of these types by direct field read:
 *
 *   contains   message/enum/service OWNERSHIP is the descriptor's own nesting
 *   imports    `FileDescriptorProto.dependency` — the paths AS WRITTEN
 *   exports    `public_dependency` — INDICES into `dependency`
 *
 * This dump is the analyzer's half. `protoc-descriptor-oracle.py` is the other half
 * and shares no code with it: the two sides are a string helper over a parse tree
 * and the C++ compiler's own data structure.
 *
 * ## Why `member` is dumped and not just the endpoints
 *
 * An edge that connects the right two symbols with the WRONG label is a different
 * claim, and a set comparison cannot see it. The descriptor knows what each nested
 * member IS — a field, a nested type, a oneof, an enum value, a method — so the
 * oracle checks the label independently. This is the "labelled" question of the six,
 * answered by something other than this analyzer's own naming choice.
 *
 * ## The occurrence counter, and why it is its OWN COLUMN
 *
 * `contains` keys on (source, target). Two edges with the same pair are possible in
 * damaged input the grammar accepts, so a bare pair key would collide and a
 * multiset-based oracle could not see a duplicate on either side. The counter makes
 * the key unique per side.
 *
 * It is emitted as column 6 rather than appended to the endpoint as `src#0`,
 * because a protobuf symbol id may ITSELF end in `#<kind>` — `uniqueId` appends
 * `#property` to disambiguate a proto2 group's field from its type, and that suffix
 * is the thing the oracle most needs to read unambiguously. Folding a numeric
 * occurrence counter into the same field would make `#0` (occurrence zero) and
 * `#property` (an id disambiguator) the same shape of token.
 *
 * CLI: npx tsx script/m14/tmp/protobuf/probe/dump-contains-io.mts --out /tmp/x.tsv
 */
import { writeFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "<corpus-root>/bb_tests/repositories"
/** The value following `f`, or `undefined` when the flag is absent.
 *
 * `process.argv.indexOf(f)` is `-1` for an absent flag, so the unguarded
 * `process.argv[indexOf(f) + 1]` evaluated `process.argv[0]` — the path to the
 * `node` EXECUTABLE — and returned it. That is truthy, so the `??` default never
 * fired and `writeFileSync(OUT, …)` aimed the whole dump at the running `node`
 * binary. It surfaced only as `ETXTBSY: text file is busy` because `node` was
 * executing; a run where it was not would have truncated the interpreter.
 *
 * The guard is `> 0`, not truthiness of the result, because that is the condition
 * under which the index means anything at all. */
const at = (f: string): string | undefined => {
  const i = process.argv.indexOf(f)
  return i > 0 ? process.argv[i + 1] : undefined
}
const OUT = at("--out") ?? "/tmp/opencode/pb/contains-io.tsv"

const TYPES = ["contains", "imports", "exports"] as const

const files: string[] = []
const walk = (d: string): void => {
  let kids: string[]
  try { kids = readdirSync(d) } catch { return }
  for (const k of kids.sort()) {
    if (k === ".git" || k === "node_modules") continue
    const abs = path.join(d, k)
    let st
    try { st = statSync(abs) } catch { continue }
    if (st.isDirectory()) { walk(abs); continue }
    if (k.endsWith(".proto")) files.push(abs)
  }
}
for (const e of readdirSync(CR).sort()) {
  const dir = path.join(CR, e)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  walk(dir)
}

const lines: string[] = []
const perType: Record<string, number> = { contains: 0, imports: 0, exports: 0 }
const perMember: Record<string, number> = {}
const silent: string[] = []
const labelled = new Set<string>()

for (const f of files) {
  const rel = path.relative(CR, f)
  let prod: any
  try { prod = await parseFile(f, path.dirname(f)) } catch { continue }
  const syms: any[] = Array.isArray(prod?.symbols) ? prod.symbols : []
  // NAMED, not just counted: `parseFile` catches its own wasm fault and returns, so
  // a file that lost its whole parse still reaches this counter as `0`. This dump
  // feeds an external oracle, and an input that silently dropped a file would
  // adjudicate a corpus the analyzer never saw.
  if (syms.length === 0) silent.push(rel)

  const seen = new Map<string, number>()
  for (const e of (prod?.relationships ?? []) as any[]) {
    const t = String(e.type)
    if (!TYPES.includes(t as any)) continue
    const src = String(e.source)
    const tgt = String(e.target)
    const key = `${t}\u0000${src}\u0000${tgt}`
    const n = seen.get(key) ?? 0
    seen.set(key, n + 1)
    const meta: any = e.metadata ?? {}
    // `imports`/`exports` endpoints are module paths, not symbols, so `member` is
    // only meaningful on `contains`. Writing the column empty rather than a
    // placeholder keeps the oracle's TSV read honest about which side has a label.
    const member = t === "contains" ? String(meta.member ?? "") : ""
    if (member) {
      perMember[member] = (perMember[member] ?? 0) + 1
      labelled.add(member)
    }
    perType[t] = (perType[t] ?? 0) + 1
    lines.push(`${rel}\t${t}\t${src}\t${tgt}\t${member}\t${n}`)
  }
}
lines.sort()
writeFileSync(OUT, lines.join("\n") + "\n")
console.log(`files ${files.length}`)
for (const t of TYPES) console.log(`  ${t.padEnd(9)} ${perType[t]}`)
console.log(`  contains member labels: ${JSON.stringify(perMember)}`)
console.log(`files with no production symbols: ${silent.length}${silent.length ? "  " + silent.slice(0, 10).join(", ") : ""}`)
console.log(`wrote ${OUT}`)
