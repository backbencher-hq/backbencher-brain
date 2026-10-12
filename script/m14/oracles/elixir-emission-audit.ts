/**
 * ELIXIR_EXPORTS — ontology probe, part 2: what the ANALYZER does.
 *
 * Runs the lane's analyzer through the PRODUCTION path (`ASTEngine.parseFile` —
 * the same entry the indexer and `bb_graph` use) over the real corpus and
 * measures, per relationship type:
 *
 *   count          edges produced, and how many FILES produced them
 *   labelled       the label distribution (one analyzer, so this is a tally)
 *   resolved       does each ENDPOINT bind to a symbol the file published?
 *   confident      confidence distribution + how many carry evidenceClass
 *   r7             placeholder literals / source-text endpoints / empty names
 *
 * Resolution is measured, not asserted: a relationship resolves when its
 * endpoint is a name the file's own symbol table publishes, either exactly or
 * as `owner.name` / `owner.name/arity` over a published owner. A cross-module
 * target (`references Elixir.Foo`) is NOT expected to resolve in-file and is
 * counted separately as `external`, because a reference to another file's
 * module resolving in this file would be a coincidence, not evidence.
 *
 * NO REGEX anywhere: every name test is a char-code comparison or `indexOf` on
 * a single delimiter.
 *
 * CLI: npx tsx script/m14/oracles/elixir-emission-audit.ts [--repo=elixir]
 *                                                    [--nf=0] [--verbose]
 */
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = process.env.BB_LANE_ROOT ?? path.resolve(process.cwd())
const CORPUS = process.env.BB_CORPUS ?? "$HOME/fixtures/repositories"
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3)
const REPOS = (arg("repo") ?? "elixir").split(",").filter(Boolean)
const NFILES = Number(arg("nf") ?? process.env.NFILES ?? "0")
const VERBOSE = process.argv.includes("--verbose")

// `imports` JOINED THIS ENUM 2026-10-10 (elixir fold): the list was written by the
// EXPORTS wave, when this lane published no `imports` relationship at all and the
// channel name `brain_import` stood in for it. The fold added the producer
// (`import Mod` -> `imports`), and until the enum named it the table below counted
// exactly ONE such row (the first occurrence creates the tally, every later one
// lands in that never-printed bucket) — an instrument blind to the edge it was
// supposed to audit. `brain_import` stays in the list: it is the CHANNEL, and for
// this lane it is silent by design (the ImportInfo list is separate from the
// relationship).
const REL_TYPES = ["calls", "extends", "implements", "uses", "brain_import", "imports", "exports", "contains", "references", "overrides", "instantiates"]

/** R7 / target-spelling classes, from validation/m60/target-spelling-register.json's
 *  own vocabulary, implemented as char scans. */
function hasWhitespace(s: string): boolean {
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); if (c === 32 || c === 9 || c === 10 || c === 13) return true }
  return false
}
function hasQuote(s: string): boolean {
  return s.indexOf('"') !== -1 || s.indexOf("'") !== -1 || s.indexOf("`") !== -1
}
function hasDelimiter(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c === 123 || c === 125 || c === 91 || c === 93 || c === 40 || c === 41 || c === 44 || c === 124) return true
  }
  return false
}
// EX-EX11b (2026-10-10): `unknown` lower-case is NOT a placeholder — a definition
// the source genuinely names `unknown` is a real public member, and
// `validation/m14/fixtures/elixir/ontology-placeholder-names` pins
// `exports OntoPlaceholder -> unknown`. The sentinel this lane may never publish
// is the CAPITAL `Unknown` (its own "I could not read it" spelling); the
// lower-case entry made the audit report a fabricated R7 endpoint on a row the
// corpus pins as correct.
const PLACEHOLDERS = new Set(["Unknown", "global", "Global", "", "TODO", "undefined"])

function walkFiles(dir: string, out: string[] = []): string[] {
  let ents: fs.Dirent[]
  try { ents = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of ents) {
    if ([".git", "_build", "deps", "node_modules"].indexOf(e.name) !== -1) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walkFiles(p, out)
    else if (e.name.endsWith(".ex") || e.name.endsWith(".exs")) out.push(p)
  }
  return out
}
function pick(files: string[], n: number): string[] {
  const sorted = [...files].sort()
  if (n <= 0 || n >= sorted.length) return sorted
  const step = sorted.length / n
  const out: string[] = []
  for (let i = 0; i < n; i++) out.push(sorted[Math.floor(i * step)]!)
  return [...new Set(out)]
}

interface Tally {
  edges: number
  files: Set<string>
  sourcesResolved: number
  sourcesExternal: number
  targetsResolved: number
  targetsExternal: number
  confidences: Record<string, number>
  withEvidenceClass: number
  r7: Record<string, number>
  r7Samples: Record<string, string[]>
}
function newTally(): Tally {
  return { edges: 0, files: new Set(), sourcesResolved: 0, sourcesExternal: 0, targetsResolved: 0, targetsExternal: 0,
    confidences: {}, withEvidenceClass: 0, r7: {}, r7Samples: {} }
}
function bump(o: Record<string, number>, k: string) { o[k] = (o[k] ?? 0) + 1 }

async function main() {
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const report: Record<string, any> = {}

  for (const repo of REPOS) {
    const dir = path.join(CORPUS, repo)
    const files = pick(walkFiles(dir), NFILES)
    if (!files.length) { console.log(`${repo}: NO FILES under ${dir}`); continue }
    const tallies: Record<string, Tally> = {}
    for (const t of REL_TYPES) tallies[t] = newTally()
    const oddLabels: Record<string, number> = {}
    let parsed = 0, failed = 0, imports = 0, importFiles = 0, exportsCh = 0, symbols = 0
    let unknownSymbols = 0, emptyNameSymbols = 0
    const unknownSymbolSamples: string[] = [], oddLabelSamples: string[] = []
    const t0 = Date.now()

    for (const f of files) {
      const src = fs.readFileSync(f, "utf8")
      let res: any
      try { res = await ASTEngine.parseFile(f, src) } catch { failed++; continue }
      parsed++
      symbols += res.symbols.length
      for (const s of res.symbols) {
        if (typeof s.name !== "string" || s.name.length === 0) { emptyNameSymbols++; continue }
        if (s.name === "Unknown") { unknownSymbols++; if (unknownSymbolSamples.length < 8) unknownSymbolSamples.push(`${path.relative(dir, f)}:${s.range?.startLine} kind=${s.kind}`) }
      }
      const names = new Set<string>()
      for (const s of res.symbols) {
        names.add(s.name)
        if (s.ownerName) names.add(`${s.ownerName}.${s.name}`)
        // the analyzer's edge sources carry arity: `Mod.f/1`
        names.add(s.name)
      }
      const imp = res.imports ?? []
      imports += imp.length
      if (imp.length) importFiles++
      exportsCh += (res.exports ?? []).length

      for (const r of res.relationships ?? []) {
        const t = (r as any).type ?? (r as any).relationshipType
        if (!t) continue
        if (!tallies[t]) { tallies[t] = newTally(); bump(oddLabels, t); if (oddLabelSamples.length < 8) oddLabelSamples.push(`${t} in ${path.relative(dir, f)}`) ; continue }
        const tally = tallies[t]
        tally.edges++
        tally.files.add(path.relative(dir, f))
        bump(tally.confidences, String(r.confidence))
        const md: any = r.metadata ?? {}
        if (typeof md.evidenceClass === "string" && md.evidenceClass.length) tally.withEvidenceClass++

        // --- endpoint resolution (measured against this file's own symbols) ---
        const src_ = String((r as any).source ?? "")
        const tgt = String((r as any).target ?? "")
        if (names.has(src_)) tally.sourcesResolved++
        else {
          const slash = src_.lastIndexOf("/")
          const head = slash >= 0 ? src_.slice(0, slash) : src_
          const lastDot = head.lastIndexOf(".")
          const owner = lastDot >= 0 ? head.slice(0, lastDot) : head
          if (owner.length > 0 && names.has(owner)) tally.sourcesResolved++
          else tally.sourcesExternal++
        }
        if (names.has(tgt)) tally.targetsResolved++
        else {
          const lastDot = tgt.lastIndexOf(".")
          const owner = lastDot >= 0 ? tgt.slice(0, lastDot) : ""
          if (owner.length > 0 && names.has(owner)) tally.targetsResolved++
          else tally.targetsExternal++
        }

        // --- R7 / spelling classes, both endpoints ---
        for (const which of ["source", "target"]) {
          const v = which === "source" ? src_ : tgt
          if (v.length === 0) bump(tally.r7, `${which}:empty`)
          if (PLACEHOLDERS.has(v)) { bump(tally.r7, `${which}:placeholder:${v || "(empty)"}`); const k = `${which}:placeholder`; (tally.r7Samples[k] ??= []).push(`${t} ${which}=${JSON.stringify(v.slice(0, 70))} @ ${path.relative(dir, f)}:${(r as any).line_number ?? "?"}`) }
          if (hasWhitespace(v)) { bump(tally.r7, `${which}:whitespace`); const k = `${which}:whitespace`; (tally.r7Samples[k] ??= []).push(`${t} ${which}=${JSON.stringify(v.slice(0, 70))} @ ${path.relative(dir, f)}:${(r as any).line_number ?? "?"}`) }
          if (hasQuote(v)) { bump(tally.r7, `${which}:quote`); const k = `${which}:quote`; (tally.r7Samples[k] ??= []).push(`${t} ${which}=${JSON.stringify(v.slice(0, 70))} @ ${path.relative(dir, f)}:${(r as any).line_number ?? "?"}`) }
          if (hasDelimiter(v)) { bump(tally.r7, `${which}:delimiter`); const k = `${which}:delimiter`; (tally.r7Samples[k] ??= []).push(`${t} ${which}=${JSON.stringify(v.slice(0, 70))} @ ${path.relative(dir, f)}:${(r as any).line_number ?? "?"}`) }
          if (v.indexOf("#") === 0) { bump(tally.r7, `${which}:commentText`); const k = `${which}:commentText`; (tally.r7Samples[k] ??= []).push(`${t} ${which}=${JSON.stringify(v.slice(0, 70))} @ ${path.relative(dir, f)}:${(r as any).line_number ?? "?"}`) }
          // Punctuation is NOT by itself a conviction: an Elixir operator
          // function (`def |||`, `def -->`) is a real callable name. The
          // exception is a name no definition could own — a definition HEAD
          // read as a name — which is measured and listed on its own.
          if (v === "(" || v === ")" || v === "[") { bump(tally.r7, `${which}:headDelimiterName`); const k = `${which}:headDelimiterName`; (tally.r7Samples[k] ??= []).push(`${t} ${which}=${JSON.stringify(v)} @ ${path.relative(dir, f)}:${(r as any).line_number ?? "?"}`) }
        }
      }
    }
    const wall = Date.now() - t0
    report[repo] = { parsed, failed, wall, symbols, imports, importFiles, exportsCh, unknownSymbols, emptyNameSymbols }
    console.log(`\n=== ${repo}: ${parsed} files parsed (${failed} failed), ${symbols} symbols, ${wall} ms`)
    console.log(`    imports[] channel: ${imports} ImportInfo in ${importFiles} files · exports[] channel: ${exportsCh} ExportInfo`)
    console.log(`    symbols named "Unknown": ${unknownSymbols} · empty-named symbols: ${emptyNameSymbols}`)
    if (unknownSymbolSamples.length) console.log(`    Unknown samples: ${unknownSymbolSamples.join("  ")}`)
    console.log(`    labels outside the 10 enum values: ${Object.keys(oddLabels).length === 0 ? "none" : JSON.stringify(oddLabels)}`)
    if (oddLabelSamples.length) console.log(`      ${oddLabelSamples.join("  ")}`)
    console.log("\n    type          edges   files   src-resolved  tgt-resolved  tgt-external  confidence             evidenceClass  R7")
    for (const t of REL_TYPES) {
      const q = tallies[t]
      if (!q.edges) { console.log(`    ${t.padEnd(12)} ${String(0).padStart(5)}   ${"-".padStart(5)}   (silent)`); continue }
      const conf = Object.entries(q.confidences).sort().map(([k, v]) => `${k}:${v}`).join(" ")
      const r7 = Object.entries(q.r7).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(" ")
      console.log(`    ${t.padEnd(12)} ${String(q.edges).padStart(5)}   ${String(q.files.size).padStart(5)}   ${(q.sourcesResolved + "/" + q.edges).padStart(12)}  ${(q.targetsResolved + "/" + q.edges).padStart(12)}  ${String(q.targetsExternal).padStart(12)}  ${conf.padEnd(22)} ${(q.withEvidenceClass + "/" + q.edges).padEnd(13)} ${r7 || "-"}`)
      if (VERBOSE) {
        const ks = Object.keys(q.r7Samples).sort()
        for (const k of ks) {
          const uniq = [...new Set(q.r7Samples[k]!)]
          const limit = process.argv.includes("--all") ? uniq.length : 12
          console.log(`        ${k} (${q.r7Samples[k]!.length} endpoint(s), ${uniq.length} distinct):`)
          for (const s of uniq.slice(0, limit)) console.log(`            ${s}`)
          if (uniq.length > limit) console.log(`            ... ${uniq.length - limit} more`)
        }
      }
    }
  }
  console.log("\nJSON " + JSON.stringify(report))
}
main().catch((e) => { console.error(String(e && e.stack ? e.stack : e)); process.exit(1) })