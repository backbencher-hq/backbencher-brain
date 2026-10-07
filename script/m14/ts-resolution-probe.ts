/**
 * TYPESCRIPT ENDPOINT RESOLUTION PROBE — the six questions' Q5 (RESOLVED)
 * and the R7 checks, measured per relationship type.
 *
 * The ontology census reports `src%`/`tgt%` by testing an endpoint against the
 * symbols the analyzer emitted IN THE SAME FILE, matching on symbol id or bare
 * name. That test is right for `contains` (parent and member names) and wrong for
 * every edge whose endpoint is a QUALIFIED name: `overrides` emits
 * `Derived.method -> Base.method`, and neither string is a symbol name or an id.
 * So the census reported overrides src% 0.0 on rxjs and nest, which reads as
 * "no override edge has a real source" and is not the same claim as "the
 * resolution test cannot see a qualified name".
 *
 * This probe separates the two by testing four increasingly strong notions of
 * "binds to a real symbol", and reporting all four side by side:
 *
 *   name        endpoint equals a symbol's bare name (the census's test)
 *   id          endpoint equals a symbol's id
 *   qualified   endpoint equals `ownerName.name` of a real symbol
 *   ownerMember endpoint splits at the last "." and the halves are a real
 *               owner and a real member of it
 *
 * An endpoint that binds under `qualified` is a real symbol pair written in
 * qualified form. An endpoint that binds under NOTHING is unresolvable in this
 * file, which for an outgoing-only analyzer is expected whenever the target is
 * declared elsewhere — the count is reported rather than excused.
 *
 * Zero regular expressions. Endpoint splitting is `lastIndexOf(".")` and
 * `slice`.
 *
 * READ-ONLY.
 *
 * Usage: BB_CORPUS_ROOT=... bun script/m14/ts-resolution-probe.ts --repo rxjs --out x.json
 */
import fs from "node:fs"
import * as path from "node:path"
import { admittedTypeScriptFiles, isFallbackResult } from "./ts-lane-corpus"
import { parseFile } from "../../src/ast/pool-worker"

const argv = process.argv.slice(2)
const argOf = (flag: string): string | undefined => {
  const i = argv.indexOf(flag)
  return i >= 0 ? argv[i + 1] : undefined
}
const REPO = argOf("--repo") ?? "element-plus"
const LIMIT = Number(argOf("--limit") ?? "0")
const MAX_BYTES = Number(argOf("--max-bytes") ?? String(512 * 1024))
const OUT = argOf("--out")
const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"

const ALL_TYPES = [
  "calls", "uses", "contains", "imports", "references",
  "exports", "extends", "implements", "overrides", "instantiates",
] as const
type Type = (typeof ALL_TYPES)[number]

/** Standing rule R7: a placeholder literal is not a name. */
const PLACEHOLDER_LITERALS = new Set([
  "", "?", "unknown", "unknown_symbol", "unknownsymbol", "<unknown>", "undefined", "null",
  "todo", "tbd", "n/a", "na", "none", "anonymous", "<anonymous>", "anonymousfunction",
  "placeholder", "xxx", "<lambda>", "lambda", "func", "fn", "symbol", "name", "value",
  "target", "source", "object", "string", "number", "any", "unknown1", "foo", "bar", "baz",
])
const looksPlaceholder = (x: string): boolean => {
  const n = x.toLowerCase().trim()
  return PLACEHOLDER_LITERALS.has(n) || n.startsWith("<") || n.startsWith("??")
}

type End = { count: number; asName: number; asId: number; asQualified: number; asOwnerMember: number; empty: number; placeholder: number; samples: string[] }
const end = (): End => ({ count: 0, asName: 0, asId: 0, asQualified: 0, asOwnerMember: 0, empty: 0, placeholder: 0, samples: [] })
type Row = { count: number; files: Set<string>; src: End; tgt: End; conf: Map<number, number>; evidence: Map<string, number>; self: number; samples: string[] }
const row = (): Row => ({ count: 0, files: new Set(), src: end(), tgt: end(), conf: new Map(), evidence: new Map(), self: 0, samples: [] })
const rows = new Map<Type, Row>()
for (const t of ALL_TYPES) rows.set(t, row())

/** Split at the LAST dot: `a.b.c` -> ["a.b", "c"], `c` -> ["", "c"]. */
const splitLast = (s: string): [string, string] => {
  const i = s.lastIndexOf(".")
  return i < 0 ? ["", s] : [s.slice(0, i), s.slice(i + 1)]
}

const pop = admittedTypeScriptFiles(CR, REPO, MAX_BYTES, LIMIT)
let parsed = 0
let failed = 0
const fallbackFiles: string[] = []
let idx = 0
const queue = pop.all

async function worker(): Promise<void> {
  while (true) {
    const i = idx++
    if (i >= queue.length) return
    const abs = queue[i]
    const rel = path.relative(pop.repoDir, abs)
    let r: any
    try {
      r = await parseFile(abs, pop.repoDir)
    } catch {
      failed++
      continue
    }
    if (isFallbackResult(r)) fallbackFiles.push(rel)
    parsed++

    const symbols: any[] = r?.symbols ?? []
    const names = new Set<string>()
    const ids = new Set<string>()
    const qualified = new Set<string>()
    /** ownerName -> set of member names */
    const members = new Map<string, Set<string>>()
    /** ownerName -> set of member qualified names */
    for (const s of symbols) {
      if (s?.name) names.add(String(s.name))
      if (s?.id) ids.add(String(s.id))
      if (s?.ownerName && s?.name) {
        const q = `${s.ownerName}.${s.name}`
        qualified.add(q)
        const set = members.get(String(s.ownerName)) ?? new Set<string>()
        set.add(String(s.name))
        members.set(String(s.ownerName), set)
        // The bare owner is itself usually a symbol; record it so a qualified
        // id like `Example.Domain.Customer` binds too.
        qualified.add(String(s.ownerName))
      }
    }

    for (const e of (r?.relationships ?? []) as any[]) {
      const t = String(e.type ?? e.relationshipType ?? "").toLowerCase() as Type
      const row = rows.get(t)
      if (!row) continue
      const src = String(e.source ?? e.from ?? e.fromSymbol ?? "")
      const tgt = String(e.target ?? e.to ?? e.toSymbol ?? "")
      row.count++
      row.files.add(rel)
      if (src && src === tgt) row.self++
      if (e.confidence !== undefined) row.conf.set(Number(e.confidence), (row.conf.get(Number(e.confidence)) ?? 0) + 1)
      const ev = String(e.metadata?.evidenceClass ?? e.evidenceClass ?? "absent")
      row.evidence.set(ev, (row.evidence.get(ev) ?? 0) + 1)
      if (row.samples.length < 6) row.samples.push(`${src} -> ${tgt}`)

      for (const [label, value] of [["src", src], ["tgt", tgt]] as const) {
        const slot = label === "src" ? row.src : row.tgt
        slot.count++
        if (value === "") slot.empty++
        if (looksPlaceholder(value)) slot.placeholder++
        if (names.has(value)) {
          slot.asName++
          continue
        }
        if (ids.has(value)) {
          slot.asId++
          continue
        }
        if (qualified.has(value)) {
          slot.asQualified++
          continue
        }
        const [owner, member] = splitLast(value)
        if (owner !== "" && members.has(owner) && members.get(owner)!.has(member)) slot.asOwnerMember++
      }
    }
  }
}
await Promise.all(Array.from({ length: 8 }, () => worker()))

// ------------------------------------------------------------------ report
const w = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
const pct = (n: number, d: number) => (d ? ((100 * n) / d).toFixed(1) : "-")
console.log(`typescript endpoint resolution probe — ${REPO}@${pop.rev.slice(0, 8)}`)
console.log(`POPULATION  ${pop.all.length} admitted (tracked .ts-family ${pop.trackedTs}, ambient .d.ts ${pop.trackedDeclaration} excluded)`)
console.log(`            parsed ${parsed} failed ${failed} fallback ${fallbackFiles.length}\n`)
console.log(`${w("type", 13)}${w("n", 9)}END: ${w("src name%", 10)}${w("id%", 8)}${w("qual%", 8)}${w("ownmem%", 9)}${w("UNRESOLVED", 11)}${w("tgt unres", 10)}${w("empty", 7)}${w("R7", 6)}evidenceClass`)
console.log("-".repeat(140))
const out: any = { at: new Date().toISOString(), repo: REPO, rev: pop.rev, filesParsed: parsed, filesFailed: failed, fallbackFiles: fallbackFiles.slice(0, 10), types: {} }
for (const t of ALL_TYPES) {
  const r = rows.get(t)!
  const su = r.src.count - r.src.asName - r.src.asId - r.src.asQualified - r.src.asOwnerMember
  const tu = r.tgt.count - r.tgt.asName - r.tgt.asId - r.tgt.asQualified - r.tgt.asOwnerMember
  const ev = [...r.evidence.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(" ")
  const cf = [...r.conf.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}:${v}`).join(" ")
  out.types[t] = {
    count: r.count, files: r.files.size, selfLoops: r.self,
    source: r.src, target: r.tgt, sourceUnresolved: su, targetUnresolved: tu,
    confidenceHistogram: Object.fromEntries(r.conf), evidenceClassHistogram: Object.fromEntries(r.evidence),
    samples: r.samples,
  }
  console.log(
    `${w(t, 13)}${w(r.count.toLocaleString(), 9)}${w(pct(r.src.asName, r.src.count), 10)}${w(pct(r.src.asId, r.src.count), 8)}` +
    `${w(pct(r.src.asQualified, r.src.count), 8)}${w(pct(r.src.asOwnerMember, r.src.count), 9)}${w(su.toLocaleString(), 11)}` +
    `${w(tu.toLocaleString(), 10)}${w(String(r.src.empty + r.tgt.empty), 7)}${w(String(r.src.placeholder + r.tgt.placeholder), 6)}${ev} | conf ${cf}`,
  )
}
if (OUT) {
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2))
  console.log(`\nwrote ${OUT}`)
}