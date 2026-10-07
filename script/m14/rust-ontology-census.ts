/**
 * RUST ONTOLOGY CENSUS — the rust lane's own instrument for the
 * relationship-type workstream (docs/analyzers/ONTOLOGY-WORKSTREAM.md).
 *
 * WHY A LANE-OWNED FILE. `script/m14/differential.ts` runs a corpus sweep on
 * import (25k lines, MASTER-owned), so an instrument cannot ask it a question
 * without starting a 42-lane sweep. This file drives the PRODUCTION entry
 * (`parseFile` from `src/ast/pool-worker`) itself and computes its own numbers.
 * It writes nothing outside `--out`.
 *
 * THE TEN TYPES, and what each question needs.
 *
 *   1. FIRES      — does production `parseFile` produce the type on this corpus?
 *                   Answered with `parseFile`, never by reading the source: a
 *                   branch that never matches is invisible to derivation.
 *   2. RESOLVED   — do BOTH endpoints bind to a symbol the file declares?
 *                   Rust's analyzer is PER-FILE by declared contract (cross-file
 *                   resolution is M12.44), so both denominators are reported:
 *                   FILE scope (what this analyzer can resolve) and CRATE scope
 *                   (the union of every symbol the corpus declares, i.e. what a
 *                   crate-aware resolver could bind). The gap between them is a
 *                   SCOPE statement about the analyzer, not a defect count, and
 *                   conflating the two is how a per-file lane reports a fake 0%.
 *   3. LABELLED   — is the edge the right type and not a neighbour? Answered
 *                   partly here (per-type metadata/evidence census, which says
 *                   what each site claims to be) and partly by the differential,
 *                   which is the only second opinion. This file records what each
 *                   site CLAIMS so the label question can be read against it.
 *   4. RULED or not — for a type the analyzer does NOT emit, a corpus
 *                   measurement of the construct that would produce it. Two
 *                   instruments, per the ontology gate's own rule that a text
 *                   regex is the wrong instrument for "does this language have
 *                   this construct":
 *                     A: grammar inventory — every node type the pinned grammar
 *                        actually produces across the corpus. Positive evidence
 *                        of absence for a construct that needs a node the grammar
 *                        does not have.
 *                     B: parse-tree semantic count — for a construct the language
 *                        expresses through the SHAPE of a declaration rather than
 *                        a keyword. `overrides` is exactly this class in rust: a
 *                        trait method and an impl method of the same name are the
 *                        same fact spelled twice, and no node type says
 *                        "override", so a grammar inventory is blind to it by
 *                        construction.
 *
 * CLI: npx tsx script/m14/rust-ontology-census.ts [--repo ripgrep] [--sample N]
 *      [--out <file.json>]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { parseFile } from "../../src/ast/pool-worker"

const ROOT = path.resolve((import.meta as any).dirname ?? path.dirname(process.argv[1] ?? "."), "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const ALL_TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"] as const
type Type = (typeof ALL_TYPES)[number]

function argOf(flag: string, dflt?: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt
}
const REPO_ARG = argOf("--repo", "ripgrep") ?? ""
/** `--repo all` sweeps every admitted git repo under the corpus root, which is
 *  what `script/m14/ontology-coverage-gate.ts` does. It matters here because the
 *  ontology gate's admission rule (tracked files only, `git ls-files`) admits
 *  vendored rust that a single-repo draw misses — the first full sweep found
 *  359 `.rs` files against ripgrep's 110, and 2,208 `imports` edges against 442. */
const REPOS = REPO_ARG === "all"
  ? readdirSync(CR).filter((e) => { try { return statSync(path.join(CR, e)).isDirectory() } catch { return false } })
  : REPO_ARG.split(",").map((s) => s.trim()).filter(Boolean)
const SAMPLE = parseInt(argOf("--sample", "0") ?? "0")
const OUT = argOf("--out")
const MAX_BYTES = 512 * 1024

// ── corpus ────────────────────────────────────────────────────────────────────
// Tracked files only (`git ls-files`), the ontology gate's own admission rule: a
// build artifact nobody tracks is not evidence about the language.
type File = { repo: string; dir: string; rel: string; abs: string; mod: string; text: string }
const files: File[] = []
for (const e of REPOS) {
  const dir = path.join(CR, e)
  try { if (!statSync(dir).isDirectory()) continue; execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try { if (statSync(abs).size > MAX_BYTES) continue; text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "rust") continue
    files.push({ repo: e, dir, rel, abs, mod: e, text })
  }
}
files.sort((a, b) => ((a.repo + "/" + a.rel) < (b.repo + "/" + b.rel) ? -1 : 1))
const draw = SAMPLE > 0 ? files.slice(0, SAMPLE) : files
const pin = REPOS.map((r) => {
  try { return `${r}@${execFileSync("git", ["-C", path.join(CR, r), "rev-parse", "--short=12", "HEAD"], { encoding: "utf8" }).trim()}` } catch { return `${r}@?` }
})
console.log(`rust ontology census — repos ${REPOS.join(",")} (${pin.join(" ")})  admitted ${files.length}  drawn ${draw.length}`)

// ── 1. PRODUCTION EMISSION CENSUS (parseFile) ─────────────────────────────────
type Edge = {
  type: Type; source: string; target: string; confidence: number | undefined
  evidenceClass: string | undefined; metadataKeys: string; line: number | undefined
  repo: string; rel: string; fileSyms: Set<string>; crateSyms: Set<string>; bytes: number
}
const perType = new Map<Type, { n: number; files: Set<string>; conf: Map<string, number>; ev: Map<string, number>; md: Map<string, number> }>()
for (const t of ALL_TYPES) perType.set(t, { n: 0, files: new Set(), conf: new Map(), ev: new Map(), md: new Map() })
const resolution = new Map<Type, { fileBoth: number; fileSrcOnly: number; fileTgtOnly: number; fileNeither: number; leafBoth: number; crateBoth: number; crateNeither: number }>()
for (const t of ALL_TYPES) resolution.set(t, { fileBoth: 0, fileSrcOnly: 0, fileTgtOnly: 0, fileNeither: 0, leafBoth: 0, crateBoth: 0, crateNeither: 0 })
/** The store resolves a QUALIFIED endpoint by its leaf — `parallel-indexer.ts`
 *  matches `sym.name = SUBSTR(target_external, INSTR(target_external, '.') + 1)`
 *  — and the family spells an override edge `Owner.method` (scala/kotlin/java/ts).
 *  Scoring only exact names therefore reads every convention-conformant edge as
 *  unresolvable, which is a statement about the spelling and not about the graph.
 *  Both denominators are reported. */
const leafName = (s: string): string => {
  const d = Math.max(s.lastIndexOf("."), s.lastIndexOf(":"))
  return d === -1 ? s : s.slice(d + 1)
}
const integrity = new Map<Type, { emptySource: number; emptyTarget: number; placeholderSource: number; placeholderTarget: number; nonIdentTarget: number; nonIdentSource: number; below07: number }>()
for (const t of ALL_TYPES) integrity.set(t, { emptySource: 0, emptyTarget: 0, placeholderSource: 0, placeholderTarget: 0, nonIdentTarget: 0, nonIdentSource: 0, below07: 0 })
const lowConfidence: { type: Type; source: string; target: string; file: string; conf: number }[] = []

/** A rust NAME is an identifier: `[A-Za-z_][A-Za-z0-9_]*`. R10/R7: an endpoint
 *  outside that class is either a documented convention (a MODULE PATH on an
 *  `imports` edge — measured and counted separately) or debris. */
function isPlainIdent(s: string): boolean {
  if (!s) return false
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    const ok = (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || (c >= 48 && c <= 57) || c === 95
    if (!ok) return false
  }
  return !((s.charCodeAt(0) >= 48 && s.charCodeAt(0) <= 57))
}
/** R7 at runtime, with the rule the register records: a placeholder value is
 *  convicted only when THE FILE DOES NOT WRITE IT.
 *
 *  `global` (2026-10-03) was NOT in this set, and its absence made the census
 *  report `placeholderSource: 0` for all ten types while the analyzer publishes
 *  it on ten sites (`parent?.name || "global"`, real-rust-analyzer.ts:271, 302,
 *  476, 696, 711, 751, 783, 2093, 2698, 2843). That is an internal
 *  inconsistency, not a disagreement: RUST-D31's own header argues that `global`
 *  is unacceptable in a name-bearing field ("zig ships it and css deliberately
 *  rejected it in exactly this position … R7 bans a placeholder literal in a
 *  name-bearing field"), so the same reasoning applies to the other nine sites
 *  and the instrument that was supposed to catch it was blind to the spelling.
 *  Added so the count is a measurement rather than an assumption. */
const PLACEHOLDER_LITERALS = new Set(["unknown", "undefined", "null", "n/a", "todo", "fixme", "?", "", "<name>", "unnamed", "anonymous_impl", "symbol", "global"])
const isPlaceholder = (v: string, declared: Set<string>): boolean => {
  const low = v.trim().toLowerCase()
  if (!PLACEHOLDER_LITERALS.has(low)) return false
  return !declared.has(v)
}

const allEdges: Edge[] = []
const typeFiles = new Map<Type, Set<string>>()
for (const t of ALL_TYPES) typeFiles.set(t, new Set())
const placeholderSamples: string[] = []
const crateSymNames = new Set<string>()
let fileCount = 0, symbolTotal = 0, relTotal = 0, parseFail = 0, errorFiles = 0
const payload = new Map<Type, number>()
const wall0 = Date.now()

let idx = 0
async function worker() {
  while (true) {
    const i = idx++
    if (i >= draw.length) return
    const f = draw[i]
    let r: any
    try { r = await parseFile(f.abs, f.dir) } catch { parseFail++; continue }
    fileCount++
    if (Array.isArray(r?.metadata?.errors) && r.metadata.errors.length > 0) errorFiles++
    const fileSyms = new Set<string>()
    for (const s of r?.symbols ?? []) { if (typeof s?.name === "string") { fileSyms.add(s.name); crateSymNames.add(s.name) } }
    symbolTotal += (r?.symbols ?? []).length
    relTotal += (r?.relationships ?? []).length
    for (const x of r?.relationships ?? []) {
      const t = String(x.type ?? x.relationshipType ?? "").toLowerCase() as Type
      if (!ALL_TYPES.includes(t)) continue
      const row = perType.get(t)!
      row.n++
      const label = `${f.repo}/${f.rel}`
      typeFiles.get(t)!.add(label)
      const confKey = String(x.confidence ?? "undefined")
      row.conf.set(confKey, (row.conf.get(confKey) ?? 0) + 1)
      row.ev.set(String(x.metadata?.evidenceClass ?? "none"), (row.ev.get(String(x.metadata?.evidenceClass ?? "none")) ?? 0) + 1)
      const mk = Object.keys(x.metadata ?? {}).filter((k) => k !== "evidenceClass").sort().join("+") || "(none)"
      row.md.set(mk, (row.md.get(mk) ?? 0) + 1)
      const src = String(x.source ?? ""), tgt = String(x.target ?? "")
      const ig = integrity.get(t)!
      if (!src) ig.emptySource++
      if (!tgt) ig.emptyTarget++
      if (isPlaceholder(src, fileSyms)) { ig.placeholderSource++; placeholderSamples.push(`${t}: ${label}: src=${src} tgt=${tgt}`) }
      if (isPlaceholder(tgt, fileSyms)) { ig.placeholderTarget++; placeholderSamples.push(`${t}: ${label}: src=${src} tgt=${tgt}`) }
      if (!isPlainIdent(src)) ig.nonIdentSource++
      if (!isPlainIdent(tgt)) ig.nonIdentTarget++
      const conf = typeof x.confidence === "number" ? x.confidence : 1
      if (conf < 0.7) { ig.below07++; if (lowConfidence.length < 40) lowConfidence.push({ type: t, source: src, target: tgt, file: label, conf }) }
      const res = resolution.get(t)!
      const sb = fileSyms.has(src), tb = fileSyms.has(tgt)
      if (fileSyms.has(leafName(src)) && fileSyms.has(leafName(tgt))) res.leafBoth++
      if (sb && tb) res.fileBoth++
      else if (sb) res.fileSrcOnly++
      else if (tb) res.fileTgtOnly++
      else res.fileNeither++
      const bytes = Buffer.byteLength(JSON.stringify({ source: src, target: tgt, type: t, confidence: x.confidence, line_number: x.line_number, metadata: x.metadata ?? {} }))
      payload.set(t, (payload.get(t) ?? 0) + bytes)
      allEdges.push({ type: t, source: src, target: tgt, confidence: x.confidence, evidenceClass: x.metadata?.evidenceClass, metadataKeys: mk, line: x.line_number, repo: f.repo, rel: f.rel, fileSyms, crateSyms: crateSymNames, bytes })
    }
  }
}
await Promise.all(Array.from({ length: 8 }, () => worker()))
const wallMs = Date.now() - wall0
// The distinct-file count lives in `typeFiles` (populated per edge); the per-type
// row's own `files` field was left at 0, which printed "0" in the report column
// and wrote 0 into the artifact — a wrong number that reads as "no files".
for (const t of ALL_TYPES) perType.get(t)!.files = typeFiles.get(t)!.size
const sampleFilesOf = (t: Type): string[] => [...typeFiles.get(t)!].slice(0, 2)
// crate-scope resolution is scored AFTER every worker has contributed
for (const e of allEdges) {
  if (crateSymNames.has(e.source) && crateSymNames.has(e.target)) resolution.get(e.type)!.crateBoth++
  else resolution.get(e.type)!.crateNeither++
}

const importRows = (await Promise.all(draw.map(async (f) => {
  try { const r: any = await parseFile(f.abs, f.dir); return { label: `${f.repo}/${f.rel}`, n: (r?.imports ?? []).length } } catch { return null }
}))).filter(Boolean) as { label: string; n: number }[]
const importRowsTotal = importRows.reduce((a, b) => a + b.n, 0)
const importRowFiles = importRows.filter((r) => r.n > 0).length

// ── 2. INSTRUMENT A — grammar inventory over the drawn corpus ─────────────────
const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-rust.wasm"))))
const grammarNodeTypes = new Map<string, number>()
for (const f of draw) {
  const t = parser.parse(f.text)
  if (!t) continue
  const v = (n: any) => { grammarNodeTypes.set(n.type, (grammarNodeTypes.get(n.type) ?? 0) + 1); for (let i = 0; i < n.childCount; i++) v(n.child(i)) }
  v(t.rootNode)
  t.delete?.()
}

// ── 3. INSTRUMENT B — construct probes on the parse tree ──────────────────────
// Each probe counts a CONSTRUCT in the language, so a ruling can be falsified.
type Hit = { kind: string; file: string; detail: string }
const hits: Hit[] = []
const hitFiles = new Map<string, Set<string>>()
const addHit = (kind: string, file: string, detail: string) => {
  hits.push({ kind, file, detail })
  if (!hitFiles.has(kind)) hitFiles.set(kind, new Set())
  hitFiles.get(kind)!.add(file)
}
function leafOf(raw: string): string { const d = raw.lastIndexOf("::"); return (d === -1 ? raw : raw.slice(d + 2)).split("<")[0].trim() }

type TreeInfo = {
  file: File
  /** trait name -> declared method names (in-file traits only) */
  traitMethods: Map<string, Set<string>>
  /** `impl Trait for Type` -> the methods the impl declares */
  implOfTrait: Map<string, { ty: string; methods: Set<string> }[]>
  /** inherent impl blocks: type -> methods (no `for` clause) */
  inherentMethods: Map<string, Set<string>>
  useCount: number
  externCrateCount: number
}
const trees = new Map<string, TreeInfo>()

for (const f of draw) {
  const t = parser.parse(f.text)
  if (!t) continue
  const root = t.rootNode
  const info: TreeInfo = { file: f, traitMethods: new Map(), implOfTrait: new Map(), inherentMethods: new Map(), useCount: 0, externCrateCount: 0 }
  const walk = (n: any) => {
    if (n.type === "use_declaration") info.useCount++
    if (n.type === "extern_crate_declaration") info.externCrateCount++
    if (n.type === "trait_item") {
      const nm = n.childForFieldName?.("name")?.text
      if (nm) {
        const methods = info.traitMethods.get(nm) ?? new Set<string>()
        const body = n.namedChild(n.namedChildCount - 1)
        if (body && body.type === "declaration_list") {
          for (let i = 0; i < body.namedChildCount; i++) {
            const m = body.namedChild(i)
            if (!m) continue
            if (m.type === "function_signature_item" || m.type === "function_item") {
              const fn = m.childForFieldName?.("name")?.text
              if (fn) methods.add(fn)
            }
          }
        }
        info.traitMethods.set(nm, methods)
      }
    }
    if (n.type === "impl_item") {
      const traitN = n.childForFieldName?.("trait")
      const typeN = n.childForFieldName?.("type")
      const methods = new Set<string>()
      const body = n.namedChild(n.namedChildCount - 1)
      if (body && body.type === "declaration_list") {
        for (let i = 0; i < body.namedChildCount; i++) {
          const m = body.namedChild(i)
          if (!m || m.type !== "function_item") continue
          const fn = m.childForFieldName?.("name")?.text
          if (fn) methods.add(fn)
        }
      }
      if (traitN) {
        const tr = leafOf(String(traitN.text))
        const arr = info.implOfTrait.get(tr) ?? []
        arr.push({ ty: typeN ? leafOf(String(typeN.text)) : "?", methods })
        info.implOfTrait.set(tr, arr)
      } else if (typeN) {
        const ty = leafOf(String(typeN.text))
        const set = info.inherentMethods.get(ty) ?? new Set<string>()
        for (const m of methods) set.add(m)
        info.inherentMethods.set(ty, set)
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walk(c) }
  }
  walk(root)
  trees.set(f.abs, info)
  t.delete?.()
}

// B1 — `imports`: a `use` declaration IS the language's import. Counted on the
// tree, because a grammar inventory would say "use_declaration exists" and stop —
// the workstream's own lesson (the json `exports` ruling was overturned because a
// grammar cannot see a CONVENTION) is that the count is what decides.
for (const info of trees.values()) {
  if (info.useCount > 0) addHit("imports:use_declarations", `${info.file.repo}/${info.file.rel}`, `${info.useCount} use declaration(s)`)
  if (info.externCrateCount > 0) addHit("imports:extern_crate", `${info.file.repo}/${info.file.rel}`, `${info.externCrateCount} extern crate(s)`)
}
// B2 — `overrides`, sub-surface 1 (EMITTABLE by a per-file analyzer): a method in
// `impl Trait for Type` whose name is ALSO a method of a trait DECLARED IN THIS
// SAME FILE. Rust has no `override` keyword and no base class: the only sense in
// which the language overrides a member is that a trait impl method IS the
// implementation of that trait's method — it replaces the trait's default body
// for that type.
for (const info of trees.values()) {
  for (const [tr, impls] of info.implOfTrait) {
    const declared = info.traitMethods.get(tr)
    if (!declared) continue
    for (const im of impls) {
      for (const m of im.methods) {
        if (declared.has(m)) addHit("overrides:trait_impl_same_file", `${info.file.repo}/${info.file.rel}`, `${im.ty}.${m} implements ${tr}.${m}`)
      }
    }
  }
}
// B2b — `overrides`, sub-surface 1b: the method is declared by a SUPERTRAIT of the
// implemented trait, not by the trait itself, and the whole supertrait chain is
// in-file. Counted apart because it is the only part of the closure that needs
// the `extends` edges to exist: an impl method can satisfy an inherited
// requirement the trait itself never restates.
for (const info of trees.values()) {
  const supertraits = new Map<string, Set<string>>()
  const walkBounds = (n: any) => {
    if (n.type === "trait_item") {
      const nm = n.childForFieldName?.("name")?.text
      const bn = n.childForFieldName?.("bounds")
      const set = new Set<string>()
      if (nm && bn) for (const c of bn.namedChildren ?? []) {
        if (!c || c.type === "type_parameters" || c.type === "where_clause") continue
        let node: any = c
        if (node.type === "higher_ranked_trait_bound") {
          for (const kid of node.namedChildren ?? []) if (["type_identifier", "scoped_type_identifier", "generic_type"].includes(kid.type)) { node = kid; break }
        }
        const leaf = leafOf(String(node.text ?? ""))
        if (/^[A-Za-z_]/.test(leaf)) set.add(leaf)
      }
      if (nm) supertraits.set(nm, set)
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walkBounds(c) }
  }
  walkBounds(parser.parse(info.file.text)!.rootNode)
  const closure = (tr: string, depth = 0, seen = new Set<string>()): Set<string> => {
    const out = new Set<string>()
    if (depth > 8) return out
    for (const s of supertraits.get(tr) ?? []) {
      if (seen.has(s)) continue
      seen.add(s)
      out.add(s)
      for (const d of closure(s, depth + 1, new Set(seen))) out.add(d)
    }
    return out
  }
  for (const [tr, impls] of info.implOfTrait) {
    for (const sup of closure(tr)) {
      const declared = info.traitMethods.get(sup)
      if (!declared) continue
      for (const im of impls) {
        for (const m of im.methods) {
          if (info.traitMethods.get(tr)?.has(m)) continue // already B2, not B2b
          if (declared.has(m)) addHit("overrides:supertrait_inherited", `${info.file.repo}/${info.file.rel}`, `${im.ty}.${m} satisfies ${tr}'s inherited ${sup}.${m}`)
        }
      }
    }
  }
}
// B2c — `overrides`, sub-surface 1c: a trait method DECLARATION
// (`function_signature_item`, no body) that restates an in-file supertrait's
// method. A required redeclaration replaces the inherited default for every
// implementor, so it is an override in the same sense B2 is — measured apart
// because it is a DIFFERENT node (`function_signature_item`) and a different
// emission site.
for (const info of trees.values()) {
  const supertraits = new Map<string, Set<string>>()
  for (const [tr, decls] of info.traitMethods) void decls
  const walk = (n: any) => {
    if (n.type === "trait_item") {
      const nm = n.childForFieldName?.("name")?.text
      const bn = n.childForFieldName?.("bounds")
      const set = new Set<string>()
      if (nm && bn) for (const c of bn.namedChildren ?? []) {
        if (!c || c.type === "type_parameters" || c.type === "where_clause") continue
        const leaf = leafOf(String(c.text ?? ""))
        if (/^[A-Za-z_]/.test(leaf)) set.add(leaf)
      }
      if (nm) supertraits.set(nm, set)
      const body = n.namedChild(n.namedChildCount - 1)
      if (nm && body && body.type === "declaration_list") {
        for (let i = 0; i < body.namedChildCount; i++) {
          const m = body.namedChild(i)
          if (!m || m.type !== "function_signature_item") continue
          const fn = m.childForFieldName?.("name")?.text
          if (!fn) continue
          for (const sup of set) {
            const supDecls = info.traitMethods.get(sup)
            if (supDecls?.has(fn)) addHit("overrides:supertrait_required_redeclaration", `${info.file.repo}/${info.file.rel}`, `${nm}.${fn} redeclares ${sup}.${fn}`)
          }
        }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walk(c) }
  }
  walk(parser.parse(info.file.text)!.rootNode)
}
// B3 — `overrides`, sub-surface 2 (the construct, CROSS-FILE): the trait is
// declared in another file of the corpus. Measured separately and reported as
// such: a per-file analyzer cannot see it, which is a SCOPE statement about the
// analyzer and not evidence that the language lacks the construct.
{
  const crateTraitMethods = new Map<string, Set<string>>()
  for (const info of trees.values()) {
    for (const [tr, ms] of info.traitMethods) {
      const set = crateTraitMethods.get(tr) ?? new Set<string>()
      for (const m of ms) set.add(m)
      crateTraitMethods.set(tr, set)
    }
  }
  for (const info of trees.values()) {
    for (const [tr, impls] of info.implOfTrait) {
      const hereDeclared = info.traitMethods.get(tr)
      if (hereDeclared) continue
      const crate = crateTraitMethods.get(tr)
      if (!crate) continue
      for (const im of impls) for (const m of im.methods) if (crate.has(m)) addHit("overrides:trait_impl_cross_file", `${info.file.repo}/${info.file.rel}`, `${im.ty}.${m} implements ${tr}.${m} (trait declared in another file)`)
    }
  }
}
// B4 — `overrides`, sub-surface 3: a method in an INHERENT impl whose name is
// already declared for the same type by another inherent impl in the same file.
// Rust rejects this (E0592), so the count is expected to be 0 — measured rather
// than assumed, because "expected to be 0" is the prose the workstream refuses.
let inherentRedeclarations = 0
let cfgGatedRedeclarations = 0
const inherentRedeclExamples: string[] = []
/** Does this item carry a `#[cfg(..)]` attribute? A cfg-gated duplicate is an
 *  ALTERNATIVE COMPILATION, not a redefinition: ripgrep's
 *  `crates/ignore/src/walk.rs` declares `DirEntryRaw::from_path` under
 *  `#[cfg(unix)]` and again under `#[cfg(windows)]`, and both are live source
 *  that never coexists in one binary. A name-counting probe that reports those
 *  as "a second declaration replaces the first" is measuring cfg, not
 *  overriding, so the two classes are counted apart. */
const hasCfgAttr = (n: any): boolean => {
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c && c.type === "attribute_item" && String(c.text ?? "").startsWith("#[cfg")) return true
  }
  // Measured on the pinned wasm: `#[cfg(windows)] fn from_path(..)` parses with the
  // attribute as a SIBLING of the function_item inside the declaration_list, not
  // as its child, so a child-only test reads every gated alternative as ungated
  // and the cfg column comes back 0 — which is exactly the shape of a probe that
  // cannot fail. Two further facts about the sibling chain, both measured: the
  // attributes must be walked as a RUN rather than one step at a time
  // (`#[cfg(windows)]` then `#[allow(dead_code)]` before ripgrep's second
  // `Dir::link_file` in `tests/util.rs:235-237`), and a `line_comment` sits
  // between the attribute run and the item (`// unused on Windows`), so a comment
  // is transparent for this walk. A first version had all three defects and
  // reported 0 of 10 gated — the number a wrong instrument produces on a corpus
  // that is entirely cfg-heavy.
  for (let prev = n.previousNamedSibling; prev; prev = prev.previousNamedSibling) {
    if (prev.type === "line_comment" || prev.type === "block_comment") continue
    if (prev.type !== "attribute_item") break
    if (String(prev.text ?? "").startsWith("#[cfg")) return true
  }
  return false
}
for (const info of trees.values()) {
  const seen = new Map<string, Set<string>>()
  const cfgSeen = new Map<string, Set<string>>()
  const walkImpls = (n: any) => {
    if (n.type === "impl_item" && !n.childForFieldName?.("trait")) {
      const ty = leafOf(String(n.childForFieldName?.("type")?.text ?? ""))
      const set = seen.get(ty) ?? new Set<string>()
      const cfg = cfgSeen.get(ty) ?? new Set<string>()
      const implCfg = hasCfgAttr(n)
      const body = n.namedChild(n.namedChildCount - 1)
      if (body && body.type === "declaration_list") {
        for (let i = 0; i < body.namedChildCount; i++) {
          const m = body.namedChild(i)
          const fn = m?.type === "function_item" ? m.childForFieldName?.("name")?.text : undefined
          if (!fn) continue
          if (set.has(fn)) {
            inherentRedeclarations++
            if (implCfg || hasCfgAttr(m)) { cfgGatedRedeclarations++ } else if (inherentRedeclExamples.length < 5) inherentRedeclExamples.push(`${info.file.rel}: ${ty}.${fn} declared twice, NOT cfg-gated`)
          }
          set.add(fn)
          if (implCfg || hasCfgAttr(m)) cfg.add(fn)
        }
      }
      seen.set(ty, set)
      cfgSeen.set(ty, cfg)
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walkImpls(c) }
  }
  walkImpls(parser.parse(info.file.text)!.rootNode)
}
// B5 — the bash `overrides` instrument applied to rust: a SECOND declaration of a
// name already declared in the same file. A free function or a struct name cannot
// be declared twice in valid rust (E0428), so this is measured, not assumed.
let rustRedeclarations = 0
const redeclExamples: string[] = []
for (const info of trees.values()) {
  const t = parser.parse(info.file.text)
  if (!t) continue
  const seen = new Set<string>()
  const root = t.rootNode
  for (let i = 0; i < root.namedChildCount; i++) {
    const d = root.namedChild(i)
    if (!d) continue
    if (d.type === "use_declaration" || d.type === "extern_crate_declaration") continue
    const nm = d.childForFieldName?.("name")?.text
    if (!nm) continue
    const k = `${d.type}:${nm}`
    if (seen.has(k)) { rustRedeclarations++; if (redeclExamples.length < 5) redeclExamples.push(`${info.file.rel}: ${k}`) }
    seen.add(k)
  }
  t.delete?.()
}
// B6 — how many trait impl blocks exist at all, which is the denominator for the
// two override sub-surfaces and the reason a 0 in B2 has to be read as "the
// corpus puts them in different files", not "the language has no override".
let traitImplBlocks = 0, implMethods = 0
for (const info of trees.values()) for (const [, impls] of info.implOfTrait) { traitImplBlocks += impls.length; for (const im of impls) implMethods += im.methods.size }

// ── report ────────────────────────────────────────────────────────────────────
const out: any = {
  generatedFor: "rust ontology census",
  repos: REPOS, corpusPins: pin, corpusAdmitted: files.length, drawn: draw.length,
  parsedThroughProductionEntry: fileCount, parseFailures: parseFail, filesWithParseErrors: errorFiles,
  symbols: symbolTotal, relationships: relTotal, wallMs,
  importArrayRows: importRowsTotal,
  importArrayFiles: importRowFiles,
  types: {} as any, resolution: {} as any, integrity: {} as any,
  grammarNodeTypes: grammarNodeTypes.size, probes: {} as any,
}
console.log(`\nparseFile: ${fileCount} files (${errorFiles} with ERROR/MISSING nodes), ${symbolTotal} symbols, ${relTotal} relationships, ${wallMs} ms, ${parseFail} parse failures`)
console.log(`imports ARRAY rows (ImportInfo, not a relationship): ${importRowsTotal} across ${importRowFiles} files`)
console.log(`\n${"type".padEnd(14)}${"edges".padStart(9)}${"files".padStart(7)}${"confidence".padStart(26)}${"evidenceClass".padStart(32)}sample files`)
console.log("-".repeat(150))
for (const t of ALL_TYPES) {
  const row = perType.get(t)!, res = resolution.get(t)!, ig = integrity.get(t)!
  out.types[t] = {
    edges: row.n, files: row.files,
    confidence: Object.fromEntries([...row.conf].sort((a, b) => b[1] - a[1])),
    evidenceClass: Object.fromEntries([...row.ev].sort((a, b) => b[1] - a[1])),
    metadataKeySets: Object.fromEntries([...row.md].sort((a, b) => b[1] - a[1]).slice(0, 8)),
    payloadBytes: payload.get(t) ?? 0,
  }
  const confStr = [...row.conf].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).slice(0, 4).join(" ")
  const evStr = [...row.ev].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).slice(0, 3).join(" ")
  console.log(`${t.padEnd(14)}${String(row.n).padStart(9)}${String(row.files).padStart(7)}${confStr.padEnd(26)}${evStr.padEnd(32)}${sampleFilesOf(t).join(", ")}`)
  console.log(`${" ".repeat(14)}file-resolved both ${res.fileBoth} (${row.n === 0 ? "n/a" : ((res.fileBoth / row.n) * 100).toFixed(1) + "%"}) | src-only ${res.fileSrcOnly} | tgt-only ${res.fileTgtOnly} | neither ${res.fileNeither} | leaf-resolved both ${res.leafBoth} | crate-resolved both ${res.crateBoth} (${row.n === 0 ? "n/a" : ((res.crateBoth / row.n) * 100).toFixed(1) + "%"}) | empty src ${ig.emptySource} | empty tgt ${ig.emptyTarget} | placeholder SRC ${ig.placeholderSource} | placeholder tgt ${ig.placeholderTarget} | non-ident tgt ${ig.nonIdentTarget} | conf<0.7 ${ig.below07}`)
  out.resolution[t] = res
  out.integrity[t] = ig
}
console.log(`\nprobe hits (instrument B, parse-tree counts):`)
for (const [k, v] of [...hitFiles].sort()) console.log(`  ${k.padEnd(38)} ${String(hits.filter((h) => h.kind === k).length).padStart(7)} hits in ${v.size} files`)
console.log(`  ${"overrides:inherent_impl_redeclaration".padEnd(38)} ${String(inherentRedeclarations).padStart(7)} of which cfg-gated alternatives: ${cfgGatedRedeclarations}  ${inherentRedeclExamples.join(" | ")}`)
console.log(`  ${"rust_top_level_redeclarations".padEnd(38)} ${String(rustRedeclarations).padStart(7)} ${redeclExamples.join(" | ")}`)
console.log(`  ${"trait_impl_blocks (denominator)".padEnd(38)} ${String(traitImplBlocks).padStart(7)} blocks, ${implMethods} methods declared in them`)
console.log(`  grammar node types observed: ${grammarNodeTypes.size}`)
for (const n of ["use_declaration", "extern_crate_declaration", "impl_item", "trait_item", "function_signature_item", "struct_expression", "call_expression", "attribute_item", "mod_item", "inheritance_specifier", "class_declaration", "superclass"]) {
  console.log(`    node ${n.padEnd(26)} ${grammarNodeTypes.get(n) ?? 0}`)
}
console.log(`  probe samples:`)
for (const h of hits.slice(0, 8)) console.log(`    ${h.kind}: ${h.file}: ${h.detail}`)
for (const k of hitFiles.keys()) out.probes[k] = { occurrences: hits.filter((h) => h.kind === k).length, files: hitFiles.get(k)!.size, samples: hits.filter((h) => h.kind === k).slice(0, 6).map((h) => `${h.file}: ${h.detail}`) }
out.probes["overrides:inherent_impl_redeclaration"] = { occurrences: inherentRedeclarations, cfgGatedAlternatives: cfgGatedRedeclarations, samples: inherentRedeclExamples }
out.probes["rust_top_level_redeclarations"] = { occurrences: rustRedeclarations, samples: redeclExamples }
out.probes["trait_impl_blocks"] = { occurrences: traitImplBlocks, implMethods }
out.lowConfidenceEdges = lowConfidence
/** The COUNT is the measurement and it lives in `integrity.<type>.placeholderSource`
 *  / `.placeholderTarget`, per type. `placeholderSamples` is illustrative, and it
 *  was serialised UNBOUNDED — which was harmless while the screen convicted 76
 *  rows and produced a 1,618-row artifact once `global` was added (2026-10-03),
 *  turning a 30-line artifact into a 1,572-line diff. Bounded to 200 with the
 *  total kept alongside, so the artifact stays readable and the number is not
 *  lost. */
out.placeholderSampleTotal = placeholderSamples.length
out.placeholderSamples = placeholderSamples.slice(0, 200)
if (placeholderSamples.length) console.log(`\nR7 placeholder-literal endpoint samples (${placeholderSamples.length} total, first 10 shown):\n  ${placeholderSamples.slice(0, 10).join("\n  ")}`)

if (OUT) { writeFileSync(OUT, JSON.stringify(out, null, 2)); console.log(`\nwrote ${OUT}`) }
process.exitCode = 0