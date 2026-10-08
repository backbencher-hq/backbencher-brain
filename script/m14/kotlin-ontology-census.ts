/**
 * KOTLIN ONTOLOGY CENSUS — the measurement behind every `exports` verdict for
 * the DERIV_EXPORTS_KOT lane, and behind the six questions for the eight types
 * the analyzer already emits.
 *
 * NO REGEX. Nothing here matches source text. Every fact is read from the
 * tree-sitter AST by node.type and named-child inspection (MASTER rule 1). A
 * census that regexes source would count `internal` inside a comment and inside
 * a string literal, and would miss `internal` written with odd whitespace; a
 * census over the grammar cannot.
 *
 * WHAT IS MEASURED, and why each one decides something
 *
 *   Q-VIS    Does the Kotlin corpus actually carry a VISIBILITY construct that
 *            discriminates a declaration's module exposure? This is the whole
 *            GAP-vs-RULED question for `exports`. If `internal`/`private`/
 *            `protected` never appeared on a top-level declaration, then
 *            "exported" and "declared" would be the same set, any `exports`
 *            edge would be a tautology over `contains`, and the honest verdict
 *            would be RULED. If they DO appear, the language has the construct
 *            and `exports` is a GAP.
 *
 *   Q-TL     Top-level vs nested declarations — the `exports` set is top-level
 *            only (a member is reachable through its owner), so the size of the
 *            nested population is what a missing owner check would wrongly add.
 *
 *   Q-ANNOT  Kotlin/JS `@JsExport` — the one annotation whose name means
 *            "export this to another language". Its frequency decides whether
 *            an annotation-driven export edge is real corpus surface or a
 *            one-off worth leaving to the metadata.
 *
 *   Q-CHAN   Counts per relationship type over the corpus, plus the separate
 *            `imports[]` and `exports[]` channels, so the firing verdict is a
 *            corpus number rather than a source scan.
 *
 *   Q-ENDPT  Endpoint resolution for the types that claim one: how many edges
 *            have both endpoints naming a symbol the SAME file published.
 *            Cross-file resolution is a separate subsystem, so same-file
 *            resolution is the strongest claim available per-file, and
 *            anything below 1.0 is reported as a number, not as a caveat.
 *
 *   Q-R7     Standing rule R7: placeholder-literal endpoints ("Global",
 *            "constructor", "root", empty string) on emitted edges.
 *
 * USAGE
 *   BB_CORPUS=$HOME/fixtures/repositories bun script/m14/kotlin-ontology-census.ts
 *   NFILES=200 bun script/m14/kotlin-ontology-census.ts [repoDir ...]
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import type { Node } from "web-tree-sitter"

const ROOT = process.env.BB_ROOT
  || join(import.meta.dir, "..", "..")
const CORPUS = process.env.BB_CORPUS || "$HOME/fixtures/repositories"
const NFILES = Number(process.env.NFILES || 200)

/** Corpus dirs that hold real Kotlin, extension -> signal tokens (string
 *  `includes` only; the file list is the harness's, this lane's copy so the
 *  shared instrument is untouched). */
const DEFAULT_REPOS = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["kotlin"]

const SIGNAL: Record<string, string[]> = {
  ".kt": ["fun ", "class ", "val ", "object "],
  ".kts": ["fun ", "class ", "val ", "object "],
}

function isKotlin(name: string): boolean {
  return name.endsWith(".kt") || name.endsWith(".kts")
}

/** Pick code-bearing Kotlin files, deepest-last so the sample is not all
 *  build scripts or all generated code. Deterministic: the walk is sorted, so
 *  NFILES=N always samples the same N files and a re-run is comparable. */
function pickFiles(dir: string, want: number): string[] {
  const sigs = new Set<string>()
  for (const e of [".kt", ".kts"]) for (const s of SIGNAL[e]) sigs.add(s)
  const all: string[] = []
  const walk = (d: string, depth: number) => {
    if (depth > 20) return
    let ents
    try { ents = readdirSync(d, { withFileTypes: true }) } catch { return }
    const names = ents.map((e) => e.name).sort()
    for (const name of names) {
      const p = join(d, name)
      let dirent
      try { dirent = readdirSync(d, { withFileTypes: true }).find((e) => e.name === name) } catch { continue }
      // The lookup is a SECOND read of the same directory, so an entry that vanished
      // between the two (or a name the second read no longer lists) is absent here.
      // Skipping it is the conservative direction; the dereference used to throw.
      if (!dirent) continue
      if (dirent.isDirectory()) {
        if (name === "node_modules" || name === ".git" || name === "build") continue
        walk(p, depth + 1)
      } else if (isKotlin(name)) {
        try {
          const st = statSync(p)
          if (st.size > 400_000 || st.size < 40) continue
          const src = readFileSync(p, "utf8")
          let hit = false
          for (const s of sigs) if (src.includes(s)) { hit = true; break }
          if (hit) all.push(p)
        } catch {}
      }
    }
  }
  walk(dir, 0)
  // Even stride over the whole code-bearing population: a prefix would sample
  // one subtree (the defect firing-check-v2 measured on Ruby, 1/10 at NFILES=25).
  if (all.length <= want) return all
  const stride = all.length / want
  const out: string[] = []
  for (let i = 0; i < want; i++) out.push(all[Math.floor(i * stride)])
  return out
}

const { getParser, ASTEngine } = await import(`${ROOT}/src/ast/engine.ts`)
const { RealKotlinAnalyzer } = await import(`${ROOT}/src/ast/real-kotlin-analyzer.ts`)

// ---------------------------------------------------------------------------
// Grammar-side visibility read. Deliberately NOT the analyzer's code path: this
// is the independent half of the measurement, and reusing
// RealKotlinAnalyzer.determineVisibility would make a shared bug invisible.
// ---------------------------------------------------------------------------

/** Every named `*_modifier` node reachable from `node`, as a list of texts.
 *  The grammar nests modifier classes: a declaration's `modifiers` node holds
 *  `visibility_modifier`, `class_modifier`, `function_modifier`, ... (see
 *  tree-sitter-kotlin 0.3.8 node-types.json `modifiers.children`). Reading the
 *  nested classes matters: `private constructor` puts `private` in
 *  class_modifier, not visibility_modifier. */
function modifierTexts(node: Node): string[] {
  const out: string[] = []
  const stack: Node[] = [node]
  while (stack.length) {
    const n = stack.pop()!
    if (n.type === "modifiers" || n.type === "parameter_modifiers") {
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) out.push(c.text.trim())
      }
    }
    if (n.type === "visibility_modifier") { out.push(n.text.trim()); continue }
    for (let i = n.namedChildCount - 1; i >= 0; i--) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
  return out
}

/** The visibility a declaration carries, read from the grammar: an explicit
 *  `visibility_modifier` wins; a `private`/`protected` in a modifier class
 *  (constructor/property/member modifier) still removes a declaration from the
 *  module surface; anything else is Kotlin's DEFAULT public. */
function visibilityOf(node: Node): string {
  const mods = modifierTexts(node)
  let vis = "public"
  for (const m of mods) {
    if (m === "private" || m === "protected" || m === "internal" || m === "public") { vis = m; break }
  }
  return vis
}

const TOP_LEVEL_DECL = new Set([
  "class_declaration",
  "object_declaration",
  "function_declaration",
  "property_declaration",
])

/** Declaration nodes whose parent is the SOURCE_FILE: top level by grammar
 *  position, not by a parent-type allowlist. A `property_declaration` inside a
 *  `class_body` has the class_body as parent, so it is excluded structurally —
 *  this is what makes "top level" falsifiable rather than asserted. */
function topLevelDecls(root: Node): Node[] {
  const out: Node[] = []
  const stack: Node[] = [root]
  while (stack.length) {
    const n = stack.pop()!
    if (TOP_LEVEL_DECL.has(n.type) && n.parent && n.parent.type === "source_file") out.push(n)
    for (let i = n.namedChildCount - 1; i >= 0; i--) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
  return out
}

function countBy<T>(items: T[], key: (t: T) => string): Map<string, number> {
  const m = new Map<string, number>()
  for (const it of items) {
    const k = key(it)
    m.set(k, (m.get(k) || 0) + 1)
  }
  return m
}

const PLACEHOLDERS = new Set(["Global", "constructor", "root", "", "unknown", "Global "])

interface Totals {
  files: number
  parsed: number
  threw: number
  errorFiles: number
  relTally: Map<string, number>
  relByTypeFiles: Map<string, Set<string>>
  importsTotal: number
  importsFiles: number
  exportsArrayTotal: number
  exportsArrayFiles: number
  topLevel: number
  topLevelVis: Map<string, number>
  topLevelNonPublic: Array<{ file: string; name: string; vis: string }>
  nestedDecls: number
  allDeclVis: Map<string, number>
  jsExport: number
  jsExportFiles: Set<string>
  // endpoint resolution, per relationship type
  edgeCount: number
  bothResolve: number
  unresolvedTargets: Map<string, number>
  unresolvedSources: Map<string, number>
  placeholderEdges: Array<{ type: string; source: string; target: string; file: string }>
  placeholderTotal: number
  placeholderByType: Map<string, number>
  placeholderByToken: Map<string, number>
  ktsFiles: number
  ktFiles: number
  emptyNameEdges: number
  lowConfidence: Map<string, number>
  heuristicEdges: Map<string, number>
  exportsRelCount: number
  exportsRelExample: string[]
}

const tot: Totals = {
  files: 0, parsed: 0, threw: 0, errorFiles: 0,
  relTally: new Map(), relByTypeFiles: new Map(),
  importsTotal: 0, importsFiles: 0,
  exportsArrayTotal: 0, exportsArrayFiles: 0,
  topLevel: 0, topLevelVis: new Map(), topLevelNonPublic: [],
  nestedDecls: 0, allDeclVis: new Map(),
  jsExport: 0, jsExportFiles: new Set(),
  edgeCount: 0, bothResolve: 0, unresolvedTargets: new Map(), unresolvedSources: new Map(),
  placeholderEdges: [], placeholderTotal: 0, placeholderByType: new Map(), placeholderByToken: new Map(),
  ktsFiles: 0, ktFiles: 0, emptyNameEdges: 0,
  lowConfidence: new Map(), heuristicEdges: new Map(),
  exportsRelCount: 0, exportsRelExample: [],
}

const parser = await getParser("kotlin")

for (const repo of DEFAULT_REPOS) {
  const dir = join(CORPUS, repo)
  const files = pickFiles(dir, NFILES)
  if (!files.length) {
    console.error(`no code-bearing kotlin under ${dir}`)
    continue
  }
  for (const f of files) {
    tot.files++
    const content = readFileSync(f, "utf8")
    let res: any
    let root: Node
    try {
      const pr = await parser.parse(content, f)
      root = pr.rootNode as any
      res = new RealKotlinAnalyzer().analyze(root as any, content, f)
      tot.parsed++
    } catch (e) {
      tot.threw++
      continue
    }
    if (root.hasError) tot.errorFiles++
    if (f.endsWith(".kts")) tot.ktsFiles++; else tot.ktFiles++

    // --- grammar-side visibility census (Q-VIS / Q-TL / Q-ANNOT) ---
    for (const d of topLevelDecls(root)) {
      tot.topLevel++
      const vis = visibilityOf(d)
      tot.topLevelVis.set(vis, (tot.topLevelVis.get(vis) || 0) + 1)
      if (vis !== "public") {
        let name = "(anonymous)"
        for (let i = 0; i < d.namedChildCount; i++) {
          const c = d.namedChild(i)
          if (c && (c.type === "simple_identifier" || c.type === "type_identifier")) { name = c.text; break }
        }
        if (tot.topLevelNonPublic.length < 40) tot.topLevelNonPublic.push({ file: f.replace(dir + "/", ""), name, vis })
      }
    }
    // every declaration node anywhere, for the contrast
    {
      const stack: Node[] = [root]
      while (stack.length) {
        const n = stack.pop()!
        if (TOP_LEVEL_DECL.has(n.type)) {
          if (!(n.parent && n.parent.type === "source_file")) {
            tot.nestedDecls++
            const vis = visibilityOf(n)
            tot.allDeclVis.set(vis, (tot.allDeclVis.get(vis) || 0) + 1)
          }
        }
        if (n.type === "annotation") {
          for (let i = 0; i < n.namedChildCount; i++) {
            const c = n.namedChild(i)
            if (c && c.type === "user_type") {
              // last identifier in the annotation's type path
              let leaf: string | undefined
              for (let j = c.namedChildCount - 1; j >= 0; j--) {
                const cc = c.namedChild(j)
                if (cc && cc.type === "type_identifier") { leaf = cc.text; break }
              }
              if (leaf === "JsExport") {
                tot.jsExport++
                tot.jsExportFiles.add(f)
              }
            }
          }
        }
        for (let i = n.namedChildCount - 1; i >= 0; i--) {
          const c = n.namedChild(i)
          if (c) stack.push(c)
        }
      }
    }

    // --- channels (Q-CHAN) ---
    const imps = res.imports || []
    tot.importsTotal += imps.length
    if (imps.length) tot.importsFiles++
    const exps = res.exports || []
    tot.exportsArrayTotal += exps.length
    if (exps.length) tot.exportsArrayFiles++

    // --- relationship tally + endpoint resolution (Q-ENDPT / Q-R7) ---
    const names = new Set<string>()
    for (const s of res.symbols || []) if (s && typeof s.name === "string" && s.name) names.add(s.name)
    // owner-qualified member names, since overrides/contains use them
    for (const s of res.symbols || []) {
      if (s && s.ownerName && typeof s.name === "string") names.add(`${s.ownerName}.${s.name}`)
    }
    for (const r of res.relationships || []) {
      const t = r.type ?? r.relationshipType
      if (!t) continue
      tot.edgeCount++
      tot.relTally.set(t, (tot.relTally.get(t) || 0) + 1)
      if (!tot.relByTypeFiles.has(t)) tot.relByTypeFiles.set(t, new Set())
      tot.relByTypeFiles.get(t)!.add(f)
      if (t === ASTEngine.RelationshipType.Exports) {
        tot.exportsRelCount++
        if (tot.exportsRelExample.length < 5) tot.exportsRelExample.push(`${f.replace(dir + "/", "")} ${r.source} -> ${r.target}`)
      }
      const src = String(r.source ?? "")
      const tgt = String(r.target ?? "")
      if (src === "" || tgt === "") { tot.emptyNameEdges++; }
      if (PLACEHOLDERS.has(src) || PLACEHOLDERS.has(tgt)) {
        tot.placeholderTotal++
        tot.placeholderByType.set(String(t), (tot.placeholderByType.get(String(t)) || 0) + 1)
        for (const ep of [src, tgt]) {
          if (PLACEHOLDERS.has(ep)) tot.placeholderByToken.set(JSON.stringify(ep), (tot.placeholderByToken.get(JSON.stringify(ep)) || 0) + 1)
        }
        if (tot.placeholderEdges.length < 20) {
          tot.placeholderEdges.push({ type: String(t), source: src, target: tgt, file: f.replace(dir + "/", "") })
        }
      }
      const srcOk = names.has(src) || [...names].some((n) => n.endsWith(`.${src}`))
      const tgtOk = names.has(tgt) || [...names].some((n) => n.endsWith(`.${tgt}`)) || tgt.includes(".")
      if (srcOk && tgtOk) tot.bothResolve++
      else {
        if (!srcOk) tot.unresolvedSources.set(String(t), (tot.unresolvedSources.get(String(t)) || 0) + 1)
        if (!tgtOk) tot.unresolvedTargets.set(String(t), (tot.unresolvedTargets.get(String(t)) || 0) + 1)
      }
      const c = typeof r.confidence === "number" ? r.confidence : 1
      if (c < 0.7) tot.lowConfidence.set(String(t), (tot.lowConfidence.get(String(t)) || 0) + 1)
      if (r.metadata?.evidenceClass === "heuristic") tot.heuristicEdges.set(String(t), (tot.heuristicEdges.get(String(t)) || 0) + 1)
    }
  }
}

const pct = (n: number, d: number) => (d === 0 ? "n/a" : ((n / d) * 100).toFixed(1) + "%")
const lines: string[] = []
const say = (s = "") => lines.push(s)

say("KOTLIN ONTOLOGY CENSUS")
say(`corpus=${CORPUS} repos=${DEFAULT_REPOS.join(",")} NFILES=${NFILES}`)
say(`files sampled=${tot.files} parsed=${tot.parsed} threw=${tot.threw} errorFiles=${tot.errorFiles}`)
say("")
say("Q-CHAN  relationship channel (res.relationships) per production type")
const PROD = [...new Set(Object.values(ASTEngine.RelationshipType))] as string[]
for (const t of PROD) {
  const n = tot.relTally.get(t) || 0
  const fs = tot.relByTypeFiles.get(t)?.size ?? 0
  say(`   ${t.padEnd(12)} ${String(n).padStart(6)}   in ${fs} files`)
}
const offEnum = [...tot.relTally.keys()].filter((t) => !(PROD as string[]).includes(t))
say(`   OFF-ENUM: ${offEnum.join(" ") || "(none)"}`)
say(`Q-CHAN  separate channels: imports[]=${tot.importsTotal} in ${tot.importsFiles} files; exports[]=${tot.exportsArrayTotal} in ${tot.exportsArrayFiles} files`)
say(`Q-CHAN  exports as a RELATIONSHIP: ${tot.exportsRelCount}`)
for (const e of tot.exportsRelExample) say(`   e.g. ${e}`)
say("")
say("Q-VIS  top-level declaration visibility, read from the grammar's modifiers node")
say(`   top-level declarations: ${tot.topLevel}`)
for (const [v, n] of [...tot.topLevelVis.entries()].sort((a, b) => b[1] - a[1])) {
  say(`   ${v.padEnd(12)} ${String(n).padStart(6)}  ${pct(n, tot.topLevel)}`)
}
say(`   nested declarations: ${tot.nestedDecls}`)
for (const [v, n] of [...tot.allDeclVis.entries()].sort((a, b) => b[1] - a[1])) {
  say(`   ${v.padEnd(12)} ${String(n).padStart(6)}  (nested only) ${pct(n, tot.nestedDecls)}`)
}
say(`Q-VIS  sample non-public top-level declarations (max 40):`)
for (const e of tot.topLevelNonPublic) say(`   ${e.vis.padEnd(10)} ${e.name}   ${e.file}`)
say("")
say(`Q-ANNOT @JsExport annotations: ${tot.jsExport} in ${tot.jsExportFiles.size} files`)
say("")
say("Q-ENDPT endpoint resolution (per-file maximum: both endpoints name a symbol this file published)")
for (const t of PROD) {
  const n = tot.relTally.get(t) || 0
  if (!n) continue
  const us = tot.unresolvedSources.get(t) || 0
  const ut = tot.unresolvedTargets.get(t) || 0
  say(`   ${t.padEnd(12)} ${String(n).padStart(6)} edges, src-unres ${String(us).padStart(5)} (${pct(us, n)}), tgt-unres ${String(ut).padStart(5)} (${pct(ut, n)}), BOTH resolved ${pct(n - Math.max(us, ut), n)}`)
}
say("")
say(`Q-R7  empty endpoint strings: ${tot.emptyNameEdges} of ${tot.edgeCount} edges`)
say(`Q-R7  placeholder endpoints (Global/constructor/root/empty/unknown): ${tot.placeholderTotal} of ${tot.edgeCount} edges (${pct(tot.placeholderTotal, tot.edgeCount)})`)
say(`Q-R7  .kt files sampled ${tot.ktFiles}, .kts files sampled ${tot.ktsFiles}`)
for (const [k, n] of [...tot.placeholderByToken.entries()].sort((a, b) => b[1] - a[1])) say(`   token ${k.padEnd(14)} ${String(n).padStart(6)}`)
for (const [k, n] of [...tot.placeholderByType.entries()].sort((a, b) => b[1] - a[1])) say(`   type  ${k.padEnd(14)} ${String(n).padStart(6)}  ${pct(n, tot.placeholderTotal)}`)
say(`Q-R7  first 20 examples:`)
for (const p of tot.placeholderEdges) say(`   ${p.type} "${p.source}" -> "${p.target}"  ${p.file}`)
say("")
say("Q-CONF confidence below 0.7 (heuristic band), per type")
for (const [t, n] of [...tot.lowConfidence.entries()].sort((a, b) => b[1] - a[1])) say(`   ${t.padEnd(12)} ${String(n).padStart(6)}  ${pct(n, tot.relTally.get(t) || 0)}`)
say("Q-CONF metadata.evidenceClass === heuristic, per type")
for (const [t, n] of [...tot.heuristicEdges.entries()].sort((a, b) => b[1] - a[1])) say(`   ${t.padEnd(12)} ${String(n).padStart(6)}  ${pct(n, tot.relTally.get(t) || 0)}`)

console.log(lines.join("\n"))