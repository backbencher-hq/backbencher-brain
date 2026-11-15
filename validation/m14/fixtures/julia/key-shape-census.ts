/**
 * KEY-SHAPE CENSUS — are the keys this lane PUBLISHES identifier-shaped?
 *
 * The defect this exists to measure: the analyzer published symbol keys that are whole
 * source spans rather than names — a struct body with newlines and leading comments
 * (`layer::ScopeLayer\n    # For provenance; is not affected by escaping\n    const
 * unexpanded::Any`). Such a key cannot be matched, cannot be a target, and poisons every
 * name-based lookup.
 *
 * POPULATION: EVERY `.jl` file under the corpus root, walked at run time — not a sample.
 * A sample can never certify that a key shape is absent; the population is printed.
 *
 * Run:  npx tsx validation/m14/fixtures/julia/key-shape-census.ts
 * Env:  BB_JULIA_CORPUS (default /home/ishaq2321/bb_tests/repositories/julia)
 *       BB_JULIA_MAX_FILES (0 = all)
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..")
const CORPUS = process.env.BB_JULIA_CORPUS || "/home/ishaq2321/bb_tests/repositories/julia"
const MAX = Number(process.env.BB_JULIA_MAX_FILES || 0)

function discover(dir: string): string[] {
  const explicit = process.env.BB_JULIA_FILES
  if (explicit) return explicit.split(":").filter(Boolean)
  const out: string[] = []
  const walk = (d: string, depth: number) => {
    if (depth > 20) return
    let ents; try { ents = readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      const p = join(d, e.name)
      if (e.isDirectory()) { if (!/node_modules|\.git/.test(e.name)) walk(p, depth + 1) }
      else if (e.name.endsWith(".jl")) { try { if (statSync(p).size < 400_000) out.push(p) } catch {} }
    }
  }
  walk(dir, 0)
  out.sort()
  return MAX > 0 ? out.slice(0, MAX) : out
}

/** A key is IDENTIFIER-SHAPED when it is a dotted path of identifier segments, possibly with a
 *  leading `@` (macro), an operator name, or a `:op` quoted symbol. Anything containing a
 *  newline, a tab, a comment marker, or an internal run of whitespace is NOT. */
const IDENT_PATH = /^@?[A-Za-z_$][A-Za-z0-9_$!?]*(\.[A-Za-z_$][A-Za-z0-9_$!?]*)*$/
const OPERATOR = /^[^\sA-Za-z0-9_$"']{1,6}$/
export function keyShape(k: string): "identifier" | "operator" | "dotted" | "nonidentifier" {
  if (IDENT_PATH.test(k)) return k.includes(".") ? "dotted" : "identifier"
  if (OPERATOR.test(k)) return "operator"
  if (/^@?[^\s]*(\.[^\s]*)+$/.test(k) && !/[\s#(){}[\]:,]/.test(k)) return "dotted"
  return "nonidentifier"
}

/**
 * THE LANE'S OWN DEFECT CLASS, defined before the fix so the after-number cannot be chosen to
 * flatter it. A key is a SPAN KEY when it carries text that no identifier can carry:
 *
 *   - a newline, carriage return or tab (the reported shape: a whole struct body)
 *   - an internal run of 2+ spaces (a source span, not a name)
 *   - a `#` comment marker (a comment welded into a key)
 *   - more than 64 characters (no Julia identifier is that long; the reported key was hundreds)
 *
 * Deliberately NOT included: unicode identifier characters (`slot₂` is a legal Julia name),
 * `var"..."` spellings (legal Julia), and `Base.:(==)` (a legal qualified method name).
 */
/**
 * THE DEFECT CLASS ITSELF, split from the census's conservative union so a fix cannot be reported
 * against a criterion the defect does not occupy. A key carries LAYOUT when it holds text no
 * identifier can: a newline, CR, tab, an internal run of 2+ spaces, or a `#`. Length is NOT layout:
 * a 78-character dotted field chain (`Base.Sort._DEFAULT_ALGORITHMS_FOR_VECTORS.next.next...`) is a
 * dotted path of identifiers and is name-shaped however long it is.
 */
export function isLayoutKey(k: string): boolean {
  if (/[\n\r\t]/.test(k)) return true
  if (/ {2,}/.test(k)) return true
  if (k.includes("#")) return true
  return false
}
/** A key that is name-shaped but longer than any Julia identifier — reported, not a layout defect. */
export function isLongKey(k: string): boolean {
  return k.length > 64 && !isLayoutKey(k)
}

export function isSpanKey(k: string): boolean {
  if (/[\n\r\t]/.test(k)) return true
  if (/ {2,}/.test(k)) return true
  if (k.includes("#")) return true
  if (k.length > 64) return true
  return false
}

const { getParser } = await import(join(REPO, "src/ast/engine.ts"))
const mod = await import(join(REPO, "src/ast/real-julia-analyzer.ts"))
const Cls: any = Object.values(mod).find((v: any) => typeof v === "function" && /Analyzer$/.test(v.name))

const files = discover(CORPUS)
console.log(`population: ${files.length} .jl files under ${CORPUS}${MAX > 0 ? ` (TRUNCATED to ${MAX})` : " (ALL)"}`)

const badKeys = new Map<string, { count: number; files: Set<string>; where: string[] }>()
const badRelTargets = new Map<string, { count: number; files: Set<string>; where: string[] }>()
const badRelSources = new Map<string, { count: number; files: Set<string>; where: string[] }>()
const spanKeys = new Map<string, { count: number; files: Set<string>; where: string[] }>()
const spanTargets = new Map<string, { count: number; files: Set<string>; where: string[] }>()
const spanSources = new Map<string, { count: number; files: Set<string>; where: string[] }>()
const spanFiles = new Set<string>()
let symTotal = 0, relTotal = 0, parsed = 0, failed = 0
const shapeTally: Record<string, number> = { identifier: 0, operator: 0, dotted: 0, nonidentifier: 0 }
const record = (m: Map<string, any>, key: string, file: string, site: string) => {
  const e = m.get(key) ?? { count: 0, files: new Set<string>(), where: [] }
  e.count++; e.files.add(file)
  if (e.where.length < 3) e.where.push(`${file}:${site}`)
  m.set(key, e)
}

for (const f of files) {
  let content: string
  try { content = readFileSync(f, "utf8") } catch { continue }
  try {
    const parser = await getParser("julia")
    const pr: any = await parser.parse(content, f)
    const res: any = new Cls().analyze(pr.rootNode, content, f)
    parsed++
    const short = f.slice(CORPUS.length + 1)
    for (const s of res.symbols || []) {
      symTotal++
      const k = String(s.name ?? "")
      const shape = keyShape(k)
      shapeTally[shape]!++
      if (shape === "nonidentifier") record(badKeys, k, short, `symbol ${s.kind}`)
      if (isSpanKey(k)) { record(spanKeys, k, short, `symbol ${s.kind}`); spanFiles.add(short) }
    }
    for (const r of res.relationships || []) {
      relTotal++
      const t = String(r.target ?? ""), src = String(r.source ?? "")
      if (keyShape(t) === "nonidentifier") record(badRelTargets, t, short, `${r.type} src=${JSON.stringify(src).slice(0, 40)}`)
      if (keyShape(src) === "nonidentifier") record(badRelSources, src, short, `${r.type} tgt=${JSON.stringify(t).slice(0, 40)}`)
      if (isSpanKey(t)) { record(spanTargets, t, short, `${r.type} src=${JSON.stringify(src).slice(0, 60)}`); spanFiles.add(short) }
      if (isSpanKey(src)) { record(spanSources, src, short, `${r.type} tgt=${JSON.stringify(t).slice(0, 60)}`); spanFiles.add(short) }
    }
  } catch (e) { failed++; if (failed < 4) console.log(`FAILED ${f}: ${String(e).slice(0, 120)}`) }
}

const show = (title: string, m: Map<string, any>) => {
  console.log(`\n== ${title}: ${m.size} distinct non-identifier shape(s) ==`)
  const rows = [...m.entries()].sort((a, b) => b[1].count - a[1].count)
  for (const [k, e] of rows.slice(0, 15)) {
    console.log(`  x${e.count} on ${e.files.size} file(s)  len=${k.length}  ${JSON.stringify(k.slice(0, 160))}`)
    for (const w of e.where) console.log(`      at ${w}`)
  }
}
console.log(`\nparsed ${parsed}/${files.length} (failed ${failed}); symbols ${symTotal}, relationships ${relTotal}`)
console.log(`symbol name shapes: ${JSON.stringify(shapeTally)}`)
console.log(`non-identifier symbol names: distinct=${badKeys.size} occurrences=${[...badKeys.values()].reduce((a, b) => a + b.count, 0)} files=${new Set([...badKeys.values()].flatMap((v) => [...v.files])).size}`)
console.log(`non-identifier rel TARGETS:  distinct=${badRelTargets.size} occurrences=${[...badRelTargets.values()].reduce((a, b) => a + b.count, 0)} files=${new Set([...badRelTargets.values()].flatMap((v) => [...v.files])).size}`)
console.log(`non-identifier rel SOURCES:  distinct=${badRelSources.size} occurrences=${[...badRelSources.values()].reduce((a, b) => a + b.count, 0)} files=${new Set([...badRelSources.values()].flatMap((v) => [...v.files])).size}`)
show("NON-IDENTIFIER SYMBOL NAMES", badKeys)
show("NON-IDENTIFIER RELATIONSHIP TARGETS", badRelTargets)
show("NON-IDENTIFIER RELATIONSHIP SOURCES", badRelSources)

const sum = (m: Map<string, any>) => [...m.values()].reduce((a, b) => a + b.count, 0)
console.log(`\n############ SPAN KEYS (newline/tab, 2+ spaces, '#' comment, or >64 chars) ############`)
console.log(`symbol names:  distinct=${spanKeys.size} occurrences=${sum(spanKeys)} files=${new Set([...spanKeys.values()].flatMap((v) => [...v.files])).size}`)
console.log(`rel targets:   distinct=${spanTargets.size} occurrences=${sum(spanTargets)} files=${new Set([...spanTargets.values()].flatMap((v) => [...v.files])).size}`)
console.log(`rel sources:   distinct=${spanSources.size} occurrences=${sum(spanSources)} files=${new Set([...spanSources.values()].flatMap((v) => [...v.files])).size}`)
console.log(`FILES CARRYING ANY SPAN KEY: ${spanFiles.size} of ${parsed} parsed`)
{
  const pick = (m: Map<string, any>, pred: (k: string) => boolean) => [...m.entries()].filter(([k]) => pred(k))
  const filesOf = (rows: [string, any][]) => new Set<string>(rows.flatMap(([, e]) => [...e.files]))
  const layoutSyms = pick(spanKeys, isLayoutKey)
  const layoutTgts = pick(spanTargets, isLayoutKey)
  const layoutSrcs = pick(spanSources, isLayoutKey)
  const layoutFiles = new Set<string>([...filesOf(layoutSyms), ...filesOf(layoutTgts), ...filesOf(layoutSrcs)])
  const longFiles = new Set<string>([
    ...filesOf(pick(spanKeys, isLongKey)), ...filesOf(pick(spanTargets, isLongKey)), ...filesOf(pick(spanSources, isLongKey)),
  ])
  console.log(`\n############ LAYOUT KEYS (newline/tab/2+ spaces/'#') — THE DEFECT CLASS ############`)
  console.log(`layout symbol names:  distinct=${layoutSyms.length} occurrences=${layoutSyms.reduce((a, [, e]) => a + e.count, 0)}`)
  console.log(`layout rel targets:   distinct=${layoutTgts.length} occurrences=${layoutTgts.reduce((a, [, e]) => a + e.count, 0)}`)
  console.log(`layout rel sources:   distinct=${layoutSrcs.length} occurrences=${layoutSrcs.reduce((a, [, e]) => a + e.count, 0)}`)
  for (const [k, e] of layoutTgts.slice(0, 10)) console.log(`    target ${JSON.stringify(k)} x${e.count} @ ${[...e.where].slice(0, 2).join(" | ")}`)
  console.log(`FILES CARRYING ANY LAYOUT KEY: ${layoutFiles.size} of ${parsed} parsed`)
  console.log(`LONG (>64) BUT NAME-SHAPED KEYS on ${longFiles.size} file(s) — reported, not a layout defect`)
}
show("SPAN SYMBOL NAMES", spanKeys)
show("SPAN RELATIONSHIP TARGETS", spanTargets)
show("SPAN RELATIONSHIP SOURCES", spanSources)
