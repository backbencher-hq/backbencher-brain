/**
 * ELIXIR lane — DEEP AUDIT instrument (oracle-blind).
 *
 * WHY THIS EXISTS. The F5 differential (script/m14/differential.ts) compares the
 * analyzer against `deriveElixirEdges`, a SECOND IMPLEMENTATION OF THE SAME
 * RULES. It is site-agnostic (`label + lastSegment(target)`), so it is blind to
 * whole defect classes that the lane's own history says are its worst:
 *
 *   1. SOURCE attribution — the comparison treats `from` as "attribution only",
 *      so EX2-U2 / W24 #17 / EX-L1 (the lane's biggest call-identity decisions)
 *      are invisible to it.
 *   2. RAW target spelling — the comparison normalizes both sides to the last
 *      segment, which is exactly how X3 (the oracle not resolving aliases) hid
 *      for a whole wave.
 *   3. `contains` — outside the compared label set entirely.
 *
 * The F3 fixture runner pins symbols by NAME and KIND only, so a symbol-RANGE
 * defect class cannot be pinned by any existing gate either (A8 below measures
 * one). Everything here is therefore checked against facts that do not come from
 * a second implementation of the emission rules — containment, identity, range
 * arithmetic, and the raw tree:
 *
 *   A1 line contract  — a relationship's `line_number` is the NAME-BEARING line,
 *                       so the callee's name must be on (or beside) that line.
 *   A2 source         — the edge's source must be the innermost declared scope
 *                       that CONTAINS the edge's line (range containment).
 *   A3 contains       — owner/member integrity, and the ambiguity census for the
 *                       bare member-name target.
 *   A4 dangling       — every target resolved against the PROJECT symbol table
 *                       (cross-file); the residue is printed, never hidden.
 *   A5 symbol sanity  — Unknown/empty names, inverted ranges, owners that do not
 *                       exist in the file.
 *   A6 edge surface   — type census, confidence bounds, line presence, self-loops.
 *   A7 complexity     — per-symbol and file-level complexity sanity.
 *   A8 range coverage — a MERGED multi-clause definition's symbol range vs. the
 *                       clause lines the TREE reports (A8 is measured from the
 *                       tree, not from the analyzer's own merge bookkeeping).
 *
 * CLI:
 *   npx tsx script/m14/tmp/elixir-deep-audit.ts --repo=<name> [--sample=N] [--only=A1,A2]
 */
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = "/home/sano/ishaq/backbencher-brain"
const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "/home/sano/ishaq/bb_tests/repositories"

const arg = (name: string): string | undefined => process.argv.find((x) => x.startsWith(`--${name}=`))?.slice(name.length + 3)
const REPO = arg("repo") ?? "elixir"
const SAMPLE = Number(arg("sample") ?? "80")
const ONLY = (arg("only") ?? "").split(",").filter(Boolean)
const wants = (id: string) => ONLY.length === 0 || ONLY.includes(id)

const FUNCTIONAL = new Set(["function", "macro", "method"])
const DEF_TARGETS = new Set(["def", "defp", "defmacro", "defmacrop", "defdelegate", "defguard", "defguardp"])
const leaf = (s: string) => s.split(".").pop() ?? s

function walk(dir: string, out: string[] = []): string[] {
  let entries: fs.Dirent[]
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    if (e.name === ".git" || e.name === "_build" || e.name === "deps" || e.name === "node_modules") continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.name.endsWith(".ex") || e.name.endsWith(".exs")) out.push(p)
  }
  return out
}

interface Rel { type: string; source: string; target: string; confidence: number; line_number?: number; metadata?: any }
interface Sym {
  name: string; kind: string; scope?: string; ownerName?: string; visibility?: string
  range: { startLine: number; endLine: number; startColumn: number; endColumn: number; startIndex: number; endIndex: number }
  metadata?: any
}

const bump = (m: Record<string, number>, k: string) => { m[k] = (m[k] ?? 0) + 1 }
const note = (m: Record<string, string[]>, k: string, s: string) => {
  if (!m[k]) m[k] = []
  if (m[k]!.length < 5) m[k]!.push(s)
}
const show = (title: string, m: Record<string, any>, ex?: Record<string, string[]>) => {
  const keys = Object.keys(m)
  if (keys.length === 0) { console.log(`\n== ${title}: CLEAN ==`); return }
  console.log(`\n== ${title} ==`)
  for (const k of keys.sort((a, b) => m[b] - m[a])) {
    console.log(`  ${String(m[k]).padStart(7)}  ${k}`)
    for (const e of ex?.[k] ?? []) console.log(`            e.g. ${e}`)
  }
}

interface Clause { name: string; arity: number; line: number; owner: string }

/** Independent def-head census straight off the tree: every `def`-family
 *  declaration's (ownerScope, name, arity, line). Uses only the tree shape — no
 *  analyzer bookkeeping — so it can falsify the analyzer's own merge record. */
function clauseCensus(root: any): Clause[] {
  const out: Clause[] = []
  const stack: any[] = [root]
  const owners: string[] = []
  while (stack.length > 0) {
    const n = stack.pop()
    if (n.type === "call") {
      let id: any = null
      for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c && c.type === "identifier") { id = c; break } }
      if (id && DEF_TARGETS.has(id.text)) {
        // the signature is the first non-identifier, non-do_block child
        let sig: any = null
        for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c && c.type !== "identifier" && c.type !== "do_block") { sig = c; break } }
        if (sig) {
          if (sig.type === "arguments" && sig.namedChildCount > 0) sig = sig.namedChild(0)
          if (sig && (sig.type === "binary_operator") && sig.child(1)?.text === "when") sig = sig.child(0)
          if (sig && sig.type === "call") {
            let nm: any = null
            for (let i = 0; i < sig.childCount; i++) { const c = sig.child(i); if (c && c.type === "identifier") { nm = c; break } }
            let ar = 0
            for (let i = 0; i < sig.childCount; i++) { const c = sig.child(i); if (c && c.type === "arguments") ar = c.namedChildCount }
            if (nm) out.push({ name: nm.text, arity: ar, line: n.startPosition.row + 1, owner: owners[owners.length - 1] ?? "" })
          } else if (sig && sig.type === "identifier") {
            out.push({ name: sig.text, arity: 0, line: n.startPosition.row + 1, owner: owners[owners.length - 1] ?? "" })
          }
        }
      }
      if (id && id.text === "defmodule") owners.push(n.endPosition.row + 1)
    }
    for (let i = n.namedChildCount - 1; i >= 0; i--) { const c = n.namedChild(i); if (c) stack.push(c) }
  }
  return out
}

async function main() {
  const dir = path.join(CORPUS_ROOT, REPO)
  const files = walk(dir).sort()
  const picked = SAMPLE > 0 && SAMPLE < files.length ? files.slice(0, SAMPLE) : files
  console.error(`repo=${REPO} discovered=${files.length} sampled=${picked.length}`)

  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const wts: any = await import("web-tree-sitter")
  const ParserClass = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const grammar = await Language.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-elixir.wasm")))
  const parser = new ParserClass()
  parser.setLanguage(grammar)

  const allSymbolNames = new Set<string>()
  const kindCensus: Record<string, number> = {}
  const visCensus: Record<string, number> = {}
  const typeCensus: Record<string, number> = {}
  const a1: Record<string, number> = {}; const a1ex: Record<string, string[]> = {}
  const a2: Record<string, number> = {}; const a2ex: Record<string, string[]> = {}
  const a3: Record<string, number> = {}; const a3ex: Record<string, string[]> = {}
  const a5: Record<string, number> = {}; const a5ex: Record<string, string[]> = {}
  const a6: Record<string, number> = {}; const a6ex: Record<string, string[]> = {}
  const a7: Record<string, number> = {}; const a7ex: Record<string, string[]> = {}
  const a8: Record<string, number> = {}; const a8ex: Record<string, string[]> = {}
  const a9: Record<string, number> = {}; const a9ex: Record<string, string[]> = {}
  const unresolved = new Map<string, { n: number; ex: string }>()
  let errFiles = 0, symCount = 0, relCount = 0, multiClauseSymbols = 0
  const t0 = Date.now()

  type Row = { short: string; syms: Sym[]; rels: Rel[]; lines: string[]; meta: any; clauses: Clause[] }
  const rows: Row[] = []

  for (const f of picked) {
    const text = fs.readFileSync(f, "utf8")
    let res: any
    try { res = await ASTEngine.parseFile(f, text) } catch { errFiles++; continue }
    const syms = (res.symbols ?? []) as Sym[]
    const rels = (res.relationships ?? []) as Rel[]
    symCount += syms.length
    relCount += rels.length
    if ((res.errors ?? []).length > 0) errFiles++
    for (const s of syms) {
      allSymbolNames.add(s.name)
      allSymbolNames.add(leaf(s.name))
      bump(kindCensus, s.kind)
      bump(visCensus, String(s.visibility))
      if (typeof s.metadata?.heads === "number" && s.metadata.heads > 1) multiClauseSymbols++
    }
    let clauses: Clause[] = []
    if (wants("A8")) { try { clauses = clauseCensus(parser.parse(text).rootNode) } catch { /* parse miss: analyzer already reported it */ } }
    rows.push({ short: path.relative(dir, f), syms, rels, lines: text.split("\n"), meta: res.metadata ?? {}, clauses })
  }

  for (const { short, syms, rels, lines, meta, clauses } of rows) {
    const fileSymNames = new Set<string>()
    for (const s of syms) { fileSymNames.add(s.name); fileSymNames.add(leaf(s.name)) }
    const symByName = new Map<string, Sym[]>()
    for (const s of syms) {
      if (!symByName.has(s.name)) symByName.set(s.name, [])
      symByName.get(s.name)!.push(s)
    }
    const exactByName = new Map<string, Sym>()
    for (const s of syms) if (!exactByName.has(s.name)) exactByName.set(s.name, s)

    if (wants("A5")) {
      for (const s of syms) {
        if (s.name === "Unknown" || s.name === "") { bump(a5, "unknown-or-empty-name"); note(a5ex, "unknown-or-empty-name", `${short} ${s.kind} "${s.name}"`) }
        if (s.range.endLine < s.range.startLine) { bump(a5, "inverted-lines"); note(a5ex, "inverted-lines", `${short} ${s.name} ${s.range.startLine}..${s.range.endLine}`) }
        if (s.range.endLine === s.range.startLine && s.range.endColumn < s.range.startColumn) { bump(a5, "inverted-columns"); note(a5ex, "inverted-columns", `${short} ${s.name}`) }
        if (s.range.endIndex < s.range.startIndex) { bump(a5, "inverted-indices"); note(a5ex, "inverted-indices", `${short} ${s.name}`) }
        if (s.range.startLine < 1) { bump(a5, "line-zero-based"); note(a5ex, "line-zero-based", `${short} ${s.name}`) }
        if (s.ownerName && s.ownerName !== s.name && !fileSymNames.has(s.ownerName)) { bump(a5, "owner-not-in-file"); note(a5ex, "owner-not-in-file", `${short} ${s.kind} ${s.name} owner=${s.ownerName}`) }
      }
    }

    if (wants("A8")) {
      // group tree clauses by (ownerEndLine, name, arity) and compare the span
      // against the analyzer symbol that claims those heads.
      const groups = new Map<string, Clause[]>()
      for (const c of clauses) {
        const k = `${c.owner}|${c.name}|${c.arity}`
        if (!groups.has(k)) groups.set(k, [])
        groups.get(k)!.push(c)
      }
      for (const [k, cs] of groups) {
        if (cs.length < 2) continue
        const [ownerLine, name, arStr] = k.split("|")
        const arity = Number(arStr)
        // find the analyzer symbol: bare name, in a scope whose start <= ownerLine
        const cand = syms.filter((s) => s.name === name && FUNCTIONAL.has(s.kind) && (s.metadata?.arity === arity || s.metadata?.arity === undefined))
        if (cand.length === 0) { bump(a8, "no-symbol-for-merged-clauses"); continue }
        const sym = cand.find((s) => (s.ownerName ?? "") !== "" && cs.every((c) => c.line >= s.range.startLine && c.line <= s.range.endLine))
        if (!sym) {
          const s0 = cand[0]!
          const lo = Math.min(...cs.map((c) => c.line))
          const hi = Math.max(...cs.map((c) => c.line))
          bump(a8, "range-does-not-cover-all-clauses")
          note(a8ex, "range-does-not-cover-all-clauses", `${short}:${lo}-${hi} ${name}/${arity} range=${s0.range.startLine}..${s0.range.endLine} heads=${s0.metadata?.heads} owner=${s0.ownerName} (ownerLine ${ownerLine})`)
        }
      }
    }

    for (const r of rels) {
      bump(typeCensus, r.type)
      if (wants("A6")) {
        if (typeof r.confidence !== "number" || r.confidence <= 0 || r.confidence > 1) { bump(a6, "confidence-out-of-range"); note(a6ex, "confidence-out-of-range", `${short} ${r.type} ${r.source}->${r.target} c=${r.confidence}`) }
        if (r.line_number === undefined) bump(a6, "line-missing")
        else if (r.line_number <= 0) { bump(a6, "line-zero-or-less"); note(a6ex, "line-zero-or-less", `${short} ${r.type} ${r.source}->${r.target} line=${r.line_number}`) }
        if (typeof r.source !== "string" || r.source.length === 0) bump(a6, "source-empty")
        if (typeof r.target !== "string" || r.target.length === 0) { bump(a6, "target-empty"); note(a6ex, "target-empty", `${short} ${r.type} ${r.source}->"${r.target}"`) }
        if (r.source === r.target) { bump(a6, "self-loop"); note(a6ex, "self-loop", `${short} ${r.type} ${r.source}`) }
      }
      // ---- A1: the name-bearing line
      if (wants("A1") && typeof r.line_number === "number" && r.line_number > 0) {
        const want = leaf(r.target)
        const lo = Math.max(1, r.line_number - 2)
        const hi = Math.min(lines.length, r.line_number + 2)
        const win = lines.slice(lo - 1, hi).join("\n")
        // `%__MODULE__{}` / `__MODULE__.fun` resolve to the enclosing module, so
        // the NAME is not on the line by construction — adjudicated as clean.
        const selfSpell = win.includes("__MODULE__")
        if (want.length > 0 && !selfSpell && !win.includes(want)) {
          bump(a1, r.type)
          note(a1ex, r.type, `${short}:${r.line_number} ${r.type} ${r.source} -> ${r.target}`)
        }
      }
      // ---- A2: source attribution (call-site edges only; a `contains` line is
      // the MEMBER's declaration line, which is inside the member by definition)
      if (wants("A2") && r.type !== "contains" && typeof r.line_number === "number" && r.line_number > 0) {
        const line = r.line_number
        let innermost: Sym | undefined
        for (const f of syms) {
          if (!FUNCTIONAL.has(f.kind)) continue
          if (f.range.startLine <= line && f.range.endLine >= line) {
            if (!innermost || (f.range.endLine - f.range.startLine) < (innermost.range.endLine - innermost.range.startLine)) innermost = f
          }
        }
        if (innermost) {
          const owner = innermost.ownerName ?? ""
          const withArity = `${owner}.${innermost.name}/${innermost.metadata?.arity ?? "?"}`
          const bare = `${owner}.${innermost.name}`
          if (r.source !== withArity && r.source !== bare && r.source !== innermost.name) {
            const outer = r.source === owner || r.source === "Global"
            bump(a2, outer ? "outer-scope" : "wrong-scope")
            note(a2ex, outer ? "outer-scope" : "wrong-scope", `${short}:${line} ${r.type} got=${r.source} want=${withArity}`)
          }
        } else if (r.source !== "Global" && !exactByName.has(r.source) && !r.source.includes(".")) {
          bump(a2, "unknown-source")
          note(a2ex, "unknown-source", `${short}:${line} ${r.type} ${r.source} -> ${r.target}`)
        }
      }
      // ---- A3/A9: contains integrity + bare-target ambiguity
      if (wants("A3") && r.type === "contains") {
        const owner = exactByName.get(r.source)
        const members = symByName.get(r.target) ?? []
        if (!owner) { bump(a3, "owner-missing"); note(a3ex, "owner-missing", `${short} ${r.source}->${r.target}`) }
        if (members.length === 0) { bump(a3, "member-missing"); note(a3ex, "member-missing", `${short} ${r.source}->${r.target}`) }
        if (owner && members.length > 0) {
          const mine = members.filter((m) => (m.ownerName ?? m.scope) === owner.name)
          if (mine.length === 0) { bump(a3, "no-member-owned-by-source"); note(a3ex, "no-member-owned-by-source", `${short} ${r.source}->${r.target} owners=${[...new Set(members.map((m) => m.ownerName ?? m.scope))].join(",")}`) }
          if (mine.some((m) => m.range.startLine < owner.range.startLine || m.range.endLine > owner.range.endLine)) { bump(a3, "member-outside-owner"); note(a3ex, "member-outside-owner", `${short} ${owner.name}[${owner.range.startLine}..${owner.range.endLine}] -> ${r.target}`) }
        }
        if (members.length > 1) { bump(a9, "ambiguous-bare-contains-target"); note(a9ex, "ambiguous-bare-contains-target", `${short} ${r.source}->${r.target} (${members.length} same-named symbols: ${[...new Set(members.map((m) => m.ownerName ?? m.scope))].join(", ")})`) }
      }
      // ---- A4: dangling target, resolved against the WHOLE PROJECT
      if (wants("A4") && !allSymbolNames.has(r.target) && !allSymbolNames.has(leaf(r.target))) {
        const k = `${r.type} -> ${r.target}`
        const cur = unresolved.get(k)
        if (cur) cur.n++
        else unresolved.set(k, { n: 1, ex: `${short}:${r.line_number ?? 0}` })
      }
      if (wants("A7")) {
        const hit = syms.find((s) => `${s.ownerName ?? ""}.${s.name}` === r.source)
        const c = hit?.metadata?.complexity
        if (c !== undefined && (!Number.isFinite(c) || c < 1)) { bump(a7, "bad-symbol-complexity"); note(a7ex, "bad-symbol-complexity", `${short} ${r.source}=${c}`) }
      }
    }
    if (wants("A7")) {
      const fc = meta?.cyclomaticComplexity
      if (typeof fc !== "number" || !Number.isFinite(fc) || fc < 1) { bump(a7, "file-complexity-invalid"); note(a7ex, "file-complexity-invalid", `${short} cyc=${fc}`) }
      if (typeof meta?.complexity !== "number" || !Number.isFinite(meta?.complexity)) { bump(a7, "file-complexity-missing"); note(a7ex, "file-complexity-missing", `${short}`) }
    }
  }

  console.log(`\n######## ELIXIR DEEP AUDIT — repo=${REPO} files=${picked.length} symbols=${symCount} rels=${relCount} multiClauseSyms=${multiClauseSymbols} errFiles=${errFiles} ms=${Date.now() - t0}`)
  show("SYMBOL KIND CENSUS", kindCensus)
  show("VISIBILITY CENSUS", visCensus)
  show("RELATIONSHIP TYPE CENSUS", typeCensus)
  show("A1 line-name mismatch", a1, a1ex)
  show("A2 source attribution", a2, a2ex)
  show("A3 contains integrity", a3, a3ex)
  show("A5 symbol sanity", a5, a5ex)
  show("A6 edge surface", a6, a6ex)
  show("A7 complexity sanity", a7, a7ex)
  show("A8 range coverage (tree-measured clause spans)", a8, a8ex)
  show("A9 bare contains target ambiguity", a9, a9ex)
  if (wants("A4")) {
    const r4 = [...unresolved.entries()].sort((a, b) => b[1].n - a[1].n)
    console.log(`\n== A4 dangling targets (no project symbol match): ${r4.length} distinct, ${r4.reduce((s, r) => s + r[1].n, 0)} edges ==`)
    for (const [k, v] of r4.slice(0, 60)) console.log(`  ${String(v.n).padStart(6)}  ${k}   e.g. ${v.ex}`)
    if (r4.length > 60) console.log(`  … ${r4.length - 60} more`)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
