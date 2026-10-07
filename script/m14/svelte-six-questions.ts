/**
 * SVELTE — THE SIX QUESTIONS, per emitted relationship type, with a number on each.
 *
 * Companion to `svelte-ontology-census.ts`, which answers "does the label fire, at
 * what count, in which files". This file answers the questions a raw tally cannot:
 *
 *   q3 CORRECT   — an INDEPENDENT second opinion. Not a differential re-run: this
 *                  walks the parse trees itself and checks each edge's TYPE against
 *                  the CONSTRUCT it claims, which is the only way to catch a
 *                  mislabel that both sides of a differential would share.
 *   q4 LABELLED  — label x the construct that produced it, so "is it the right
 *                  type, not a neighbour" is a cross-tab and not an opinion.
 *   q5 RESOLVED  — per CONVENTION, because the conventions differ:
 *                    `imports`      target is the composite `module:item`
 *                    `instantiates` target is the TAG AS WRITTEN; Svelte resolves a
 *                                  component through the LOCAL BINDING its script
 *                                  imports, so the honest join is against the file's
 *                                  own import bindings + the corpus's file stems
 *                    everything else  target is a bare symbol name
 *   q6 CONFIDENT — confidence x metadata shape, so "how much of this graph is
 *                  guesswork" is a queryable number and names the emission site.
 *
 * AND THE PROJECTION LOSSINESS, measured: `templateExprNames` is a
 * `Map<name, line>`, so N reads of one template member collapse to ONE `uses` edge
 * carrying the LAST site. The first N-1 sites are unrecoverable from the edge. This
 * file counts how many edges are in that state, because an unstated collapse reads
 * as "one read" and is therefore a false claim about the graph.
 *
 * NOTHING here is claimed from source derivation. Every number is a count from
 * production `parseFile`, from the parse tree, or from the corpus's own text.
 *
 * CLI: npx tsx script/m14/svelte-six-questions.ts [--repo a,b] [--dir c] [--out f.json]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, statSync, writeFileSync } from "node:fs"
import * as path from "path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { parseFile } from "../../src/ast/pool-worker"
import { ASTEngine } from "../../src/ast/engine"

function argOf(flag: string, dflt?: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt
}
const REPOS = (argOf("--repo", "shadcn-svelte") ?? "").split(",").map((s) => s.trim()).filter(Boolean)
const EXTRA = (argOf("--dir", "") ?? "").split(",").map((s) => s.trim()).filter(Boolean)
const OUT = argOf("--out")
const MAX_BYTES = 512 * 1024

/** The CACHED svelte parser (`getParser`, not `new Parser`): a fresh one per
 * file exhausts the fixed wasm heap mid-sweep — M49 W12 measured that on exactly
 * this sweep shape. */
let _svelteParser: any
function getSvelteParser(): any {
  if (!_svelteParser) _svelteParser = (ASTEngine as any).getParser("svelte")
  return _svelteParser
}

const files: Array<{ repo: string; dir: string; rel: string; abs: string; text: string }> = []
const seenAbs = new Set<string>()
const admit = (dir: string, repo: string): void => {
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
      .split("\0").filter(Boolean)
  } catch { return }
  for (const rel of tracked) {
    if (!rel.endsWith(".svelte")) continue
    const abs = path.join(dir, rel)
    let text: string
    try { if (statSync(abs).size > MAX_BYTES) continue; text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "svelte") continue
    if (seenAbs.has(abs)) continue
    seenAbs.add(abs)
    files.push({ repo, dir, rel, abs, text })
  }
}
const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
for (const e of REPOS) admit(path.join(CR, e), e)
for (const d of EXTRA) admit(d, path.basename(d))
files.sort((a, b) => (a.repo + "/" + a.rel < b.repo + "/" + b.rel ? -1 : 1))
console.log(`svelte six questions — ${files.length} .svelte files, repos ${[...new Set(files.map((f) => f.repo))].join(",")}`)

type Rel = { t: string; s: string; g: string; conf: number; line?: number; md: Record<string, unknown> }
type FileOut = {
  label: string; names: Set<string>; comps: Set<string>; rels: Rel[]
  /** local binding names the file's own `import` statements introduce */
  importBindings: Set<string>
  /** import modules, by local binding */
  importModule: Map<string, string>
  /** every identifier the file's own TEXT writes — the "is this name here" denominator */
  written: Set<string>
  /** name -> every line the text writes it on (the collapse denominator) */
  writtenLines: Map<string, number[]>
  /** name -> every line OUTSIDE <script>/<style> that writes it (the collapse denominator) */
  templateWrittenLines: Map<string, number[]>
  /** the file's own lines, so a claimed line can be checked against what is written there */
  textLines: string[]
  /** the SFC root node, for locating <script>/<style> spans */
  sfcRoot: unknown
}
const out: FileOut[] = []
let parseFail = 0, symbolTotal = 0, relTotal = 0
const svelteParser = getSvelteParser()
{
  let i = 0
  const work = async (): Promise<void> => {
    while (true) {
      const k = i++
      if (k >= files.length) return
      const f = files[k]
      let r: any
      try { r = await parseFile(f.abs, f.dir) } catch { parseFail++; continue }
      const fo: FileOut = {
        label: `${f.repo}/${f.rel}`, names: new Set(), comps: new Set(), rels: [],
        importBindings: new Set(), importModule: new Map(), written: new Set(), writtenLines: new Map(),
        templateWrittenLines: new Map(), textLines: f.text.split("\n"), sfcRoot: null,
      }
      for (const s of r?.symbols ?? []) {
        const n = String(s?.name ?? "")
        if (!n) continue
        fo.names.add(n)
        if (String(s?.kind ?? "").toLowerCase() === "class") fo.comps.add(n)
        symbolTotal++
      }
      for (const x of r?.relationships ?? []) {
        fo.rels.push({
          t: String(x.type ?? x.relationshipType ?? ""),
          s: String(x.source ?? ""),
          g: String(x.target ?? ""),
          conf: typeof x.confidence === "number" ? x.confidence : 1,
          line: typeof x.line_number === "number" ? x.line_number : undefined,
          md: (x.metadata ?? {}) as Record<string, unknown>,
        })
        relTotal++
      }
      // The import binding names come from the analyzer's OWN import records, not
      // from a regex: an `imports` edge target is `module:item`, so splitting it
      // would be reading this lane's convention back out of its own output.
      //
      // AND THE RECORD SHAPE IS NOT THE ONE `types.ts` NAMES. `ImportInfo` declares
      // `module`/`items`, but the SFC path (which delegates its script to
      // `RealJavaScriptAnalyzer`) emits `{ name, path, type, isExternal }` per
      // imported binding instead. A probe that trusted the declared field names
      // read zero bindings from 1,878 files and reported `tgtImportBinding 0.0%` for
      // every label — a confident, entirely false resolution number. Both spellings
      // are read here, and the evidence records which one supplied the bindings.
      const addBinding = (bind: string, mod: string): void => {
        if (!bind || bind === "*") return
        fo.importBindings.add(bind)
        if (mod) fo.importModule.set(bind, mod)
      }
      for (const imp of r?.imports ?? []) {
        const mod = String(imp?.module ?? imp?.path ?? imp?.modulePath ?? imp?.source ?? "")
        if (typeof imp?.name === "string") addBinding(imp.name, mod)
        for (const item of imp?.items ?? []) addBinding(String(item).includes(" as ") ? String(item).split(" as ")[1].trim() : String(item), mod)
        for (const item of imp?.importedNames ?? []) addBinding(String(item), mod)
        if (typeof imp?.localName === "string") addBinding(imp.localName, mod)
        if (typeof imp?.alias === "string") addBinding(imp.alias, mod)
      }
      // Template-region lines only. The collapse denominator must EXCLUDE `<script>`
      // and `<style>` bodies: an identifier written in the script is a DECLARATION,
      // not a template read, and counting it would inflate the loss with sites no
      // edge was ever supposed to carry. The spans come from the SFC grammar, not
      // from a `<script>` text search, because a `<script>` inside a string in the
      // template would fool a text scan and an unclosed one would fool it worse.
      const scriptOrStyleLines = new Set<number>()
      {
        // `parseFile` does not hand back the SFC tree, so the spans come from a
        // direct parse with the CACHED svelte parser — the same bytes, the same
        // grammar, no re-implementation of the walk.
        try { fo.sfcRoot = (await svelteParser).parse(f.text, f.abs).rootNode } catch { /* keep the text denominator */ }
        const stack = [(fo.sfcRoot as any)]
        while (stack.length) {
          const nd = stack.pop()
          if (!nd) continue
          if (nd.type === "script_element" || nd.type === "style_element") {
            for (let L = nd.startPosition.row + 1; L <= nd.endPosition.row + 1; L++) scriptOrStyleLines.add(L)
            continue
          }
          for (let i = nd.namedChildCount - 1; i >= 0; i--) {
            const c = nd.namedChild(i)
            if (c) stack.push(c)
          }
        }
      }
      // Line-level denominator. Deliberately the file's own TEXT rather than the
      // template walk: the question "how many sites does this edge collapse?" has to
      // be answerable by someone reading the file, and a script-side count of the
      // same walk would inherit any bug the walk has.
      const lines = f.text.split("\n")
      lines.forEach((ln, li) => {
        if (scriptOrStyleLines.has(li + 1)) return
        for (const m of ln.matchAll(/[A-Za-z_$][A-Za-z0-9_$]*/g)) {
          fo.written.add(m[0])
          const arr = fo.templateWrittenLines.get(m[0]) ?? []
          arr.push(li + 1)
          fo.templateWrittenLines.set(m[0], arr)
        }
      })
      out.push(fo)
    }
  }
  await Promise.all(Array.from({ length: 8 }, () => work()))
}
const corpusNames = new Set<string>(), corpusStems = new Set<string>()
for (const fo of out) {
  for (const n of fo.names) corpusNames.add(n)
  corpusStems.add(path.basename(fo.label, ".svelte"))
}
console.log(`parsed ${out.length} files (parseFail ${parseFail}) — ${symbolTotal} symbols, ${relTotal} relationships, ${corpusNames.size} distinct symbol names`)

// ══ q5 RESOLVED, per convention ═══════════════════════════════════════════════
const pct = (a: number, b: number): string => (b === 0 ? "n/a" : `${((a / b) * 100).toFixed(1)}%`)
const splitImport = (t: string): { module: string; item: string } => {
  const i = t.lastIndexOf(":")
  return i < 0 ? { module: "", item: t } : { module: t.slice(0, i), item: t.slice(i + 1) }
}
type Res = { n: number; srcLocal: number; tgtLocal: number; tgtCorpus: number; tgtImportBinding: number; tgtCorpusStem: number; spelledHere: number; spelledNotPublished: number }
const res = new Map<string, Res>()
const bump = (m: Map<string, Res>, k: string, f: (r: Res) => void): void => {
  let r = m.get(k)
  if (!r) { r = { n: 0, srcLocal: 0, tgtLocal: 0, tgtCorpus: 0, tgtImportBinding: 0, tgtCorpusStem: 0, spelledHere: 0, spelledNotPublished: 0 }; m.set(k, r) }
  f(r)
}
const unresolvedByType = new Map<string, Map<string, number>>()
for (const fo of out) {
  for (const r of fo.rels) {
    bump(res, r.t, (x) => { x.n++ })
    if (fo.names.has(r.s) || fo.comps.has(r.s)) bump(res, r.t, (x) => { x.srcLocal++ })
    if (fo.written.has(r.g)) bump(res, r.t, (x) => { x.spelledHere++ })
    if (!fo.names.has(r.g)) {
      let m = unresolvedByType.get(r.t)
      if (!m) { m = new Map(); unresolvedByType.set(r.t, m) }
      m.set(r.g, (m.get(r.g) ?? 0) + 1)
    }
    // The convention decides the join.
    if (r.t === "imports") {
      // target is `module:item` — a composite by this lane's documented convention.
      const item = splitImport(r.g).item
      if (fo.names.has(item)) bump(res, r.t, (x) => { x.tgtLocal++ })
      if (corpusNames.has(item)) bump(res, r.t, (x) => { x.tgtCorpus++ })
      if (fo.importBindings.has(item)) bump(res, r.t, (x) => { x.tgtImportBinding++ })
      if (corpusStems.has(item)) bump(res, r.t, (x) => { x.tgtCorpusStem++ })
    } else if (r.t === "instantiates") {
      // Svelte resolves a component through the LOCAL BINDING the script imports
      // (`import Button from '$lib/Button.svelte'` then `<Button/>`). So the honest
      // joins are: a binding this file imports, or a corpus file whose STEM is that
      // name (an intra-repo component), or a symbol this file publishes.
      if (fo.names.has(r.g)) bump(res, r.t, (x) => { x.tgtLocal++ })
      if (corpusNames.has(r.g)) bump(res, r.t, (x) => { x.tgtCorpus++ })
      if (fo.importBindings.has(r.g)) bump(res, r.t, (x) => { x.tgtImportBinding++ })
      if (corpusStems.has(r.g)) bump(res, r.t, (x) => { x.tgtCorpusStem++ })
    } else {
      if (fo.names.has(r.g)) bump(res, r.t, (x) => { x.tgtLocal++ })
      if (corpusNames.has(r.g)) bump(res, r.t, (x) => { x.tgtCorpus++ })
      if (fo.importBindings.has(r.g)) bump(res, r.t, (x) => { x.tgtImportBinding++ })
      if (corpusStems.has(r.g)) bump(res, r.t, (x) => { x.tgtCorpusStem++ })
    }
    // "spelled here but no symbol published for it" is a different defect from
    // "never mentioned here" and the difference is invisible without both columns.
    if (fo.written.has(r.g) && !fo.names.has(r.g)) bump(res, r.t, (x) => { x.spelledNotPublished++ })
  }
}
console.log("\n" + "=".repeat(126))
console.log("q5 RESOLVED — per convention. tgtImportBinding = the file's own import introduces that binding")
console.log("=".repeat(126))
console.log(`${"label".padEnd(14)}${"edges".padStart(8)}${"srcLocal".padStart(10)}${"tgtLocal".padStart(10)}${"tgtCorpus".padStart(11)}${"tgtImportBind".padStart(14)}${"tgtCorpusStem".padStart(15)}${"spelledHere".padStart(13)}${"spelledNotPub".padStart(14)}`)
for (const t of [...new Set([...res.keys()])].sort()) {
  const r = res.get(t)!
  console.log(`${t.padEnd(14)}${String(r.n).padStart(8)}${pct(r.srcLocal, r.n).padStart(10)}${pct(r.tgtLocal, r.n).padStart(10)}${pct(r.tgtCorpus, r.n).padStart(11)}${pct(r.tgtImportBinding, r.n).padStart(14)}${pct(r.tgtCorpusStem, r.n).padStart(15)}${pct(r.spelledHere, r.n).padStart(13)}${pct(r.spelledNotPublished, r.n).padStart(14)}`)
}

// ══ q4/q6 label x metadata shape x confidence ═════════════════════════════════
const shapeOf = (md: Record<string, unknown>): string =>
  Object.keys(md).filter((k) => k !== "evidenceClass").sort().join("+") || "(none)"
const crossTab = new Map<string, Map<string, number>>()
for (const fo of out) {
  for (const r of fo.rels) {
    let m = crossTab.get(r.t)
    if (!m) { m = new Map(); crossTab.set(r.t, m) }
    m.set(`${shapeOf(r.md)} @conf=${r.conf}`, (m.get(`${shapeOf(r.md)} @conf=${r.conf}`) ?? 0) + 1)
  }
}
console.log("\n" + "=".repeat(126))
console.log("q4/q6 — label x metadata-shape x confidence. heuristic = conf < 0.7 (the contract's floor for 'a fact')")
console.log("=".repeat(126))
for (const t of [...crossTab.keys()].sort()) {
  const rows = [...crossTab.get(t)!.entries()].sort((a, b) => b[1] - a[1])
  const total = rows.reduce((a, [, v]) => a + v, 0)
  const heur = rows.filter(([k]) => Number(k.split("@conf=")[1]) < 0.7).reduce((a, [, v]) => a + v, 0)
  console.log(`\n${t}: ${total} edges, ${heur} heuristic (${pct(heur, total)})`)
  for (const [k, v] of rows.slice(0, 8)) console.log(`   ${String(v).padStart(6)}  ${k}`)
}

// ══ THE PROJECTION LOSSINESS, measured ════════════════════════════════════════
// `templateExprNames` is a Map<name, line>. Two reads of one member overwrite, and
// the `seenUses` dedupe then publishes ONE edge. So the edge's single line_number
// is the LAST site, and every earlier site is gone. Measured two ways: against the
// analyzer's own edge set (does the claimed line match the LAST text site?) and
// against the file's text (how many sites does this one edge stand for?).
let tmplEdges = 0, tmplMultiSite = 0, tmplSitesLost = 0, tmplLineIsLast = 0, tmplLineWrong = 0, tmplNoLine = 0
const collapseSamples: string[] = []
for (const fo of out) {
  const lines = fo.textLines ?? []
  for (const r of fo.rels) {
    if (r.md?.isTemplateExpression !== true) continue
    tmplEdges++
    const sites = [...new Set(fo.templateWrittenLines.get(r.g) ?? [])].filter((L) => lines[L - 1] !== undefined)
    if (sites.length > 1) {
      tmplMultiSite++
      tmplSitesLost += sites.length - 1
      if (collapseSamples.length < 10) collapseSamples.push(`${fo.label}: ${r.s} ->[${r.t}] ${r.g} — edge line ${r.line ?? "-"}; text sites ${sites.join(",")}`)
    }
    if (typeof r.line !== "number") { tmplNoLine++; continue }
    const last = sites[sites.length - 1]
    if (last === r.line) tmplLineIsLast++
    else {
      tmplLineWrong++
      if (collapseSamples.length < 20) collapseSamples.push(`${fo.label}: ${r.s} -> ${r.g} edge line ${r.line} but LAST text site ${last}`)
    }
  }
}
console.log("\n" + "=".repeat(126))
console.log("THE PROJECTION LOSSINESS — `templateExprNames` is Map<name,line>, so N reads collapse to 1 edge")
console.log("=".repeat(126))
console.log(`  template-sourced \`uses\` edges:                      ${tmplEdges}`)
console.log(`  of those, the member is WRITTEN ON >1 line:            ${tmplMultiSite} (${pct(tmplMultiSite, tmplEdges)})`)
console.log(`  sites that exist in the text but are on NO edge:        ${tmplSitesLost}`)
console.log(`  edges whose line_number IS the last text site:         ${tmplLineIsLast}`)
console.log(`  edges whose line_number is NOT the last text site:     ${tmplLineWrong}`)
console.log(`  edges carrying no line_number at all:                  ${tmplNoLine}`)
for (const s of collapseSamples) console.log(`     ${s}`)

// ══ R7 — placeholders, blanks, unknowns ═══════════════════════════════════════
let blankEdges = 0, blankSymbols = 0, placeholderTargets = 0
const placeholderSamples: string[] = []
const PLACEHOLDERS = new Set(["<>", "<unknown>", "unknown", "<placeholder>", "TODO", "TBD", "<T>", "$_", "***", "self", "this", "?"])
for (const fo of out) {
  for (const r of fo.rels) {
    if (r.g.trim().length === 0 || r.s.trim().length === 0) blankEdges++
    if (PLACEHOLDERS.has(r.g.trim())) {
      placeholderTargets++
      if (placeholderSamples.length < 8) placeholderSamples.push(`${fo.label}: ${r.s} -[${r.t}]-> ${JSON.stringify(r.g)}`)
    }
  }
}
console.log("\n" + "=".repeat(126))
console.log("R7 — placeholder-literal / empty endpoints")
console.log("=".repeat(126))
console.log(`  edges with a blank or whitespace endpoint: ${blankEdges}`)
console.log(`  edges whose TARGET is a placeholder literal: ${placeholderTargets}`)
for (const s of placeholderSamples) console.log(`     ${s}`)

if (OUT) {
  writeFileSync(OUT, JSON.stringify({
    schemaVersion: 1,
    at: new Date().toISOString(),
    corpus: {
      files: files.length, repos: [...new Set(files.map((f) => f.repo))],
      commits: Object.fromEntries([...new Set(files.map((f) => f.dir))].map((d) => {
        let c = "unknown"
        try { c = execFileSync("git", ["-C", d, "rev-parse", "HEAD"], { encoding: "utf8" }).trim() } catch { /* not a repo */ }
        return [path.basename(d), c]
      })),
    },
    runtime: { files: out.length, parseFail, symbols: symbolTotal, relationships: relTotal, distinctSymbolNames: corpusNames.size, corpusFileStems: corpusStems.size },
    resolvedPerConvention: Object.fromEntries(res),
    labelConfidenceCrossTab: Object.fromEntries([...crossTab.entries()].map(([k, v]) => [k, Object.fromEntries([...v.entries()].sort((a, b) => b[1] - a[1]))])),
    projectionLossiness: {
      templateUsesEdges: tmplEdges, edgesWithMultipleWrittenSites: tmplMultiSite,
      sitesWithNoEdge: tmplSitesLost, lineEqualsLastSite: tmplLineIsLast,
      lineNotLastSite: tmplLineWrong, edgesWithoutLine: tmplNoLine, samples: collapseSamples,
    },
    r7: { blankEdges, blankSymbols, placeholderTargets, placeholderSamples },
    unresolvedTargets: Object.fromEntries([...unresolvedByType.entries()].map(([k, v]) => [k, Object.fromEntries([...v.entries()].sort((a, b) => b[1] - a[1]).slice(0, 50))])),
    instrument: "production ASTEngine.parseFile via src/ast/pool-worker; per-convention joins; file-text line denominator",
  }, null, 2))
  console.log(`\nevidence: ${OUT}`)
}