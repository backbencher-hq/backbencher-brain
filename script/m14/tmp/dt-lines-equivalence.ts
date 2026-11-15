// script/m14/tmp/dt-lines-equivalence.ts — the dart lane's `lines` cell evidence.
//
// Two measurements over the same drawn files:
//   1. EQUIVALENCE — HEAD's analyzer (materialized to script/m14/tmp/dt-head-analyzer.ts
//      by this file's own README below) vs the working tree's. Every field is
//      compared with `line_number` stripped, deep. The claim "this change only
//      ADDED lines" is then measured, not argued: identical symbols, identical
//      edge multisets, identical label histogram.
//   2. CONSISTENCY — for every edge that claims a line, the claimed line must be
//      a line the NAMED token is actually written on. The exemption table below
//      is explicit and counted, so the surface the check cannot decide is
//      DISCLOSED rather than silently passed (the M59 "phantom" rule).
//
// Materialize the HEAD comparator first:
//   git show HEAD:src/ast/real-dart-analyzer.ts \
//     | sed 's|from "./engine"|from "/home/ishaq2321/mcp/backbencher-brain/src/ast/engine"|' \
//     > script/m14/tmp/dt-head-analyzer.ts
//
// Reads only; writes nothing.
import * as fs from "fs"
import * as path from "path"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const REPOS = ["proxicall", "dart-http"].map((r) => path.join("/home/ishaq2321/bb_tests/repositories", r))

function filesUnder(dir: string, out: string[] = []): string[] {
  let entries: any[] = []
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (!/^(\.|node_modules|build|dist|\.dart_tool)/.test(e.name)) filesUnder(p, out) }
    else if (e.name.endsWith(".dart")) out.push(p)
  }
  return out
}

/** Deep-strip line_number so the payloads can be compared as if the field never existed. */
function strip(v: any): any {
  if (Array.isArray(v)) return v.map(strip)
  if (v && typeof v === "object") {
    const out: any = {}
    for (const k of Object.keys(v)) {
      if (k === "line_number") continue
      const s = strip(v[k])
      if (s !== undefined) out[k] = s
    }
    return out
  }
  return v
}

/** First differing entries between two stripped payloads, as printable lines. */
function diffEntries(a: any, b: any, path: string, out: string[], limit = 6): void {
  if (out.length >= limit) return
  const ta = typeof a, tb = typeof b
  if (ta !== tb) { out.push(`${path}: type ${ta} != ${tb}`); return }
  if (a === null || b === null || ta !== "object") {
    if (a !== b) out.push(`${path}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`)
    return
  }
  if (Array.isArray(a) !== Array.isArray(b)) { out.push(`${path}: array-ness differs`); return }
  if (Array.isArray(a)) {
    if (a.length !== b.length) { out.push(`${path}: length ${a.length} != ${b.length}`); return }
    for (let i = 0; i < a.length && out.length < limit; i++) diffEntries(a[i], b[i], `${path}[${i}]`, out, limit)
    return
  }
  const keys = Array.from(new Set([...Object.keys(a), ...Object.keys(b)])).sort()
  for (const k of keys) {
    if (out.length >= limit) return
    diffEntries(a[k], b[k], `${path}.${k}`, out, limit)
  }
}

function leaf(t: string): string {
  const s = String(t ?? "")
  const dot = s.lastIndexOf(".")
  const slash = s.lastIndexOf("/")
  return s.slice(Math.max(dot, slash) + 1) || s
}

/** The token a claimed line must contain, or an EXEMPT reason. */
function nameToken(r: any): { token?: string; exempt?: string } {
  const md: any = r.metadata ?? {}
  const t = String(r.type ?? "")
  if (t === "contains") {
    // Dart constructors are SYNTHESISED under the name `constructor`; the
    // spelling is a lane contract, not a name written in the file (kotlin's
    // phantom rule, same reason).
    if (String(r.target) === "constructor") return { exempt: "synthesised-constructor-name" }
    return { token: leaf(String(r.target)) }
  }
  if (t === "overrides") {
    // The edge NAMES the overriding method, so the token comes from the SOURCE
    // side (`Owner.method` -> `method`).
    return { token: leaf(String(r.source)) }
  }
  // Import edges target `<uri>:*` — the `:*` suffix is the wildcard marker, not
  // part of the written name (the probe mis-read it on the first run and
  // reported 1,050 phantom inconsistencies).
  if (t === "imports" || t === "exports") return { token: leaf(String(r.target).replace(/\:\*$/, "")) }
  if (md.isSuperConstructor) return { token: "super" }
  if (md.isRedirectingConstructor) return { token: "this" }
  return { token: leaf(String(r.target)) }
}

async function main() {
  const cap = Number(process.argv[2] ?? 60)
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-dart.wasm")))
  const cur: any = await import(path.join(ROOT, "src/ast/real-dart-analyzer"))
  const headPath = path.join(ROOT, "script/m14/tmp/dt-head-analyzer.ts")
  if (!fs.existsSync(headPath)) {
    console.error(`missing comparator: materialize it first (see this file's header) -> ${headPath}`)
    process.exit(2)
  }
  const head: any = await import(headPath)

  const files: string[] = []
  for (const repo of REPOS) for (const f of filesUnder(repo).sort().slice(0, cap)) files.push(f)
  console.log(`files=${files.length} (cap ${cap}/repo)`)

  let edges = 0, unlined = 0, lined = 0, outOfFile = 0, checked = 0, inconsistent = 0
  const exempt: Record<string, number> = {}
  let payloadDiffs = 0, symbolDiffs = 0, histDiffs = 0
  const diffSamples: string[] = []

  for (const f of files) {
    const content = fs.readFileSync(f, "utf8")
    const lineCount = content.split("\n").length
    const lines = content.split("\n")
    const p = new P()
    p.setLanguage(LANG)
    const tree = p.parse(content)
    const rel = path.relative(ROOT, f)
    const a = await new cur.RealDartAnalyzer().analyze(tree.rootNode, content, path.basename(f))
    const b = await new head.RealDartAnalyzer().analyze(tree.rootNode, content, path.basename(f))

    // (1) equivalence, line_number stripped on both sides
    const sa = JSON.stringify(strip(a))
    const sb = JSON.stringify(strip(b))
    if (sa !== sb) {
      payloadDiffs++
      if (diffSamples.length < 5) {
        const ra = (a.relationships ?? []).length, rb = (b.relationships ?? []).length
        const sy = (a.symbols ?? []).length, syb = (b.symbols ?? []).length
        if (ra !== rb) histDiffs++
        else if (sy !== syb) symbolDiffs++
        diffSamples.push(`${rel}: rel ${ra}/${rb} sym ${sy}/${syb}`)
        const entries: string[] = []
        diffEntries(JSON.parse(sa), JSON.parse(sb), "", entries)
        for (const e of entries) diffSamples.push(`    ${e}`)
      }
    }

    // (2) consistency of every claimed line
    for (const r of a.relationships ?? []) {
      edges++
      const ln = r.line_number
      if (typeof ln !== "number") { unlined++; continue }
      lined++
      if (ln < 1 || ln > lineCount) { outOfFile++; continue }
      const { token, exempt: why } = nameToken(r)
      if (why) { exempt[why] = (exempt[why] ?? 0) + 1; continue }
      if (!token) { exempt["no-token"] = (exempt["no-token"] ?? 0) + 1; continue }
      checked++
      const text = lines[ln - 1] ?? ""
      if (!text.includes(token)) {
        inconsistent++
        if (inconsistent <= 12) console.log(`  INCONSISTENT ${r.type} ${r.source}->${r.target} @${ln} token=${JSON.stringify(token)}  | ${text.trim().slice(0, 100)}`)
      }
    }
  }

  console.log(`edges=${edges} lined=${lined} unlined=${unlined}`)
  console.log(`  line outside its file: ${outOfFile}`)
  console.log(`  token-checked: ${checked}  INCONSISTENT: ${inconsistent}`)
  console.log(`  exempt: ${JSON.stringify(exempt)}`)
  console.log(`equivalence vs HEAD (line_number stripped): payload-different files=${payloadDiffs} (edge-count ${histDiffs}, symbol-count ${symbolDiffs})`)
  for (const s of diffSamples) console.log(`  DIFF ${s}`)
}
main()
