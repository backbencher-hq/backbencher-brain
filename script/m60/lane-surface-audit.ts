// script/m60/lane-surface-audit.ts — the OO family's per-lane SURFACE audit over the
// pinned corpora: every relationship label the lane emits, whether each edge carries the
// line of the name it names, whether each edge carries the seam KEYS the store reads,
// whether a name the lane publishes is written anywhere in the file at all, and which
// symbol kinds it extracts.
//
// WHY THIS EXISTS
// ---------------
// A milestone says a rule ONCE, for the lane that exposed it, and the rule is then the
// FAMILY's. Two examples that cost the family twice: M59 stated the line contract for the
// lanes that were missing lines (`cpp is missing line numbers`), so a lane that never had
// the defect was never asked whether it would pass the rule — and R9 exists because every
// gate asks whether an edge that EXISTS is right, so a lane that emits NOTHING for a whole
// class of edge reads clean in all of them (csharp's declared-type graph was missing through
// an entire review wave).
//
// The completion matrix answers this at the LANE level (nine cells, each read from an
// artifact). This answers it at the SURFACE level, per label, per key, per kind, over real
// corpora — the level at which "all the relationship types" and "no unknown symbols" are
// actually falsifiable statements:
//
//   L1 labels        every relationshipType the lane emits, with its count
//   L2 line          per label: edges with no line, and edges with line 0 (the M59 defect)
//   L3 seam keys     per label: does the edge carry a `type` (either the analyzer's
//                    `type` or the store's `relationshipType`), a source
//                    (`source`/`from`/`fromSymbol`) and a target
//                    (`target`/`to`/`toSymbol`)? (the M60 P1 payload seam: a consumer
//                    reading the missing key sees NOTHING where the edge exists).
//                    NOT a raw-vs-store spelling census: the store's column alias is
//                    where `type` becomes `relationshipType`, so requiring the store
//                    spelling here flagged all 19,750 php edges and every lane besides —
//                    see the correction at the check site.
//   L4 ghosts        a published name that occurs NOWHERE in the file's own source text.
//                    A PROXY, not a conviction: `__init__`, `constructor`, `anonymous_7`
//                    and macro-built names are legitimately absent, so every hit is a
//                    triage candidate with its file and line, never a verdict.
//                    KNOWN LIMIT, measured while building it: the proxy is only as good
//                    as the lane's SPELLING rules. python's 281 hits on the first run were
//                    ALL the `module:item` import spelling — the item is written, the
//                    `module:` prefix is not — and teaching `writtenForm` about the single
//                    colon took python AND php to 0. objc has the same shape in reverse: a
//                    selector (`initWithURL:options:`) really does carry colons, so the
//                    same rule MANGLES it. A ghost count for objc/swift/dart is therefore
//                    not yet a measurement, and the per-lane spelling rule is owed before
//                    any of those counts is quoted as a finding.
//   L5 kinds         the symbol kinds extracted, with counts, plus names that are empty,
//                    whitespace, or a placeholder literal (R7's runtime half)
//   L6 parse         files that parse with errors (a partial parse makes every count above
//                    measure a smaller language than the lane claims)
//
// Run:
//   bun script/m60/lane-surface-audit.ts                    # all families' pinned lanes
//   bun script/m60/lane-surface-audit.ts --lang php,ruby    # one or more lanes
//   bun script/m60/lane-surface-audit.ts --lang php --limit 50
//   bun script/m60/lane-surface-audit.ts --lang php --json  # machine-readable
//
// This is a PROBE: it writes no artifact and exits 0. The ruling it informs is a round of
// its own, with a fixture and a reverting mutant per defect it finds.
import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"

const argOf = (name: string): string | undefined => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const LANGS_ARG = argOf("--lang")
const LIMIT = argOf("--limit") ? parseInt(argOf("--limit")!) : 400
const AS_JSON = process.argv.includes("--json")

/** A name that is not a name — R7's runtime half (the register measures the source). */
const PLACEHOLDER = /^(unknown|undefined|null|none|nil|n\/a|\?|unknown_\w+|_\w*unknown)$/i

/**
 * Kinds for which a null-flavoured name really is a placeholder.
 *
 * `none` is in PLACEHOLDER because it is python's null literal, and `None` is a
 * perfectly good enum member in VB, C# and anything else on .NET -- `None` as the
 * zero member of an enum is idiomatic, and P3D writes it in three files. The
 * audit therefore reported 4 false positives on a 400-file draw:
 * `enum_member "None"` flagged as "a name that is not a name", for a name that is
 * written in the file and is exactly what it says.
 *
 * A null literal stands in for a VALUE, so the check is scoped to the kinds that
 * denote one. A member, a type, a namespace and a method are named things, and a
 * type called `None` is a type.
 */
const VALUE_KINDS = new Set(["variable", "constant", "field", "parameter", "local"])
const isPlaceholderName = (n: string, kind: string): boolean => {
  if (!n.trim()) return true
  if (VALUE_KINDS.has(String(kind).toLowerCase())) return PLACEHOLDER.test(n.trim())
  // outside the value kinds, only the unambiguously synthetic names count
  return /^(unknown|undefined|n\/a|\?|unknown_\w+|_\w*unknown)$/i.test(n.trim())
}

/**
 * A name that is a name BY CONTRACT, not by how the source spells it.
 *
 * `constructor` is the family's published name for a constructor, with the class
 * in `ownerName` — csharp and typescript both publish that literal (five sites
 * each), and vb does the same, as does `operator` for an operator. The source
 * says `New` and `+`, so the L4 "name not present in source" check counts every
 * one of them as a ghost: 393 symbol names and 376 relationship targets on a
 * 400-file draw, ALL of them contract literals and none of them defects.
 *
 * It is a separate channel rather than a suppression, because the number is real
 * and a reader deserves to see it: `contract literals: N` is reported beside
 * `ghosts: 0`, so the difference between "clean" and "excused" stays visible. The
 * exemption is keyed to the KIND for symbols, so a class genuinely called
 * `constructor` in some language is still reported.
 */
const CONTRACT_LITERALS: Record<string, ReadonlySet<string>> = {
  constructor: new Set(["constructor"]),
  operator: new Set(["method", "operator", "function"]),
}

function filesUnder(dir: string, exts: string[], out: string[] = [], cap = 100000): string[] {
  if (out.length >= cap) return out
  let names: string[]
  try { names = readdirSync(dir) } catch { return out }
  for (const name of names) {
    if (out.length >= cap) return out
    if (name.startsWith(".") || name === "node_modules") continue
    const p = path.join(dir, name)
    let st: any
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) filesUnder(p, exts, out, cap)
    else if (exts.some((e) => name.endsWith("." + e))) out.push(p)
  }
  return out
}

/** The name as it is WRITTEN in a source file, without the lane's own sigils. */
function writtenForm(name: string): string {
  let n = String(name ?? "").trim()
  n = n.replace(/^[$@:]{1,2}/, "")
  n = n.replace(/^(this|self|super|cls|static)\./, "")
  if (n.includes("::")) n = n.split("::").pop()!
  if (n.includes("->")) n = n.split("->").pop()!
  if (n.includes(".")) n = n.split(".").pop()!
  // python/others spell an imported item as `module:item`; the ITEM is the name that
  // is written in the file, so a single colon is a separator, not part of the name.
  // (`::` is handled above; a lone `:` left here is that spelling.)
  if (n.includes(":")) n = n.split(":").pop()!
  n = n.replace(/^['"]|['"]$/g, "")
  // A method selector spelled with a leading `-`/`+` (objc) or a C++-ish `::` remnant.
  n = n.replace(/^[-+](\[|\()?/, "").replace(/[\]\s]*$/, "")
  return n
}

async function main() {
  const { LANGS, LANG_REPOS, SECOND_CORPUS } = await import(path.join(ROOT, "script/m14/differential.ts"))
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))

  const wanted = LANGS_ARG ? LANGS_ARG.split(",").map((s) => s.trim()) : Object.keys(LANGS)
  const rows: any[] = []
  for (const lang of wanted) {
    const cfg: any = (LANGS as any)[lang]
    if (!cfg) { console.error(`lane-surface-audit: unknown language ${lang}`); process.exit(2) }
    const exts = String(cfg.ext).split(",")
    const repos = [LANG_REPOS[lang], SECOND_CORPUS[lang]].filter(Boolean) as string[]

    const labels = new Map<string, number>()
    const noLine = new Map<string, number>()
    const zeroLine = new Map<string, number>()
    const missingKey = new Map<string, number>()
    const kinds = new Map<string, number>()
    const badNames: any[] = []
    const ghosts: any[] = []
    const contractNames: any[] = []
    const contractTargets: any[] = []
    const unlinedSample: Array<{ file: string; label: string; target: string; from: string; reason: string }> = []
    const parseErrors: any[] = []
    let files = 0, filesWithEdges = 0, edges = 0, symbols = 0

    for (const repo of repos) {
      const paths = filesUnder(path.join(CORPUS_ROOT, repo), exts, [], LIMIT)
      for (const file of paths) {
        if (files >= LIMIT) break
        let src: string
        try { src = readFileSync(file, "utf8") } catch { continue }
        files++
        let res: any
        try { res = await ASTEngine.parseFile(file, src) } catch (e: any) {
          parseErrors.push({ file: path.relative(CORPUS_ROOT, file), error: String(e?.message ?? e).slice(0, 80) })
          continue
        }
        if ((res?.errors?.length ?? 0) > 0 || (res?.metadata?.errors?.length ?? 0) > 0) {
          const errs: any[] = [...(res.errors ?? []), ...(res.metadata?.errors ?? [])]
          parseErrors.push({ file: path.relative(CORPUS_ROOT, file), error: `${errs.length} parse error(s)` })
        }
        const rels: any[] = res?.relationships ?? []
        const syms: any[] = res?.symbols ?? []
        if (rels.length) filesWithEdges++
        edges += rels.length
        symbols += syms.length
        for (const s of syms) {
          const k = String(s.kind ?? "?")
          kinds.set(k, (kinds.get(k) ?? 0) + 1)
          const n = String(s.name ?? "")
          if (isPlaceholderName(n, k)) {
            badNames.push({ file: path.relative(CORPUS_ROOT, file), symbol: JSON.stringify(n), kind: k, line: s.range?.startLine })
          } else if (CONTRACT_LITERALS[n.toLowerCase()]?.has(k.toLowerCase())) {
            // a name by contract — counted, disclosed, and not a ghost
            contractNames.push({ file: path.relative(CORPUS_ROOT, file), symbol: n, kind: k, line: s.range?.startLine })
          } else if (!src.includes(n)) {
            // A symbol name written nowhere in its own file. Kept in the same channel as
            // badNames because both are "a name that is not a name in this source".
            badNames.push({ file: path.relative(CORPUS_ROOT, file), symbol: n, kind: k, line: s.range?.startLine, why: "name not present in source" })
          }
        }
        for (const r of rels) {
          const t = String(r.type ?? r.relationshipType ?? "?")
          labels.set(t, (labels.get(t) ?? 0) + 1)
          // The line the edge claims: `line_number` is the store's field, `metadata.line`
          // its mirror, `line` the probe shape. Absent and 0 are DIFFERENT findings.
          const ln = r.line_number ?? r.metadata?.line ?? r.line
          if (ln === undefined || ln === null) {
            noLine.set(t, (noLine.get(t) ?? 0) + 1)
            // WHY an edge has no line matters, and conflating the reasons made this
            // instrument accuse two lanes wrongly on the php round (csharp 61, kotlin 24):
            // an edge whose TARGET is a SYNTHESIZED symbol has no naming node anywhere in
            // the source — csharp's `containmentLine` returns undefined for exactly those
            // (`sites.synthesized`), and M59.A7's own contract makes absence the honest
            // answer there, since the alternative is the fabricated 0 the milestone
            // outlawed. So the sample carries the reason a reader needs to triage: the
            // target name, and whether any symbol of that name in this file lacks a source
            // range (the synthesized signature). A lane read as unlined is only a finding
            // once its samples say `range` — not `synthesized`.
            // The decisive test is NOT whether the symbol carries a source range —
            // csharp's synthesised constructors carry a full one (measured: `constructor`
            // at Interop.cs 1127 with a real range) and still must NOT claim a line. The
            // test is whether any node in this file WRITES the target's name: a constructor
            // is named `constructor` and written `<ClassName>(...)`, a destructor is named
            // `Finalize` and written `~ClassName`, java's phantoms are named by nothing at
            // all. When the name is unwritten, no line in the file can BE the line of the
            // name, so absence is the contract rather than a violation — csharp's rule is
            // written down and measured in `collectContainmentSites` (366 constructor edges
            // used to claim the ATTRIBUTE's line), and the oracle's own phantom rule counts
            // a synthesised member's containment edge CLAIMING a line as the defect.
            // So `unwritten` is exempt-by-contract and `written` is the finding class.
            const tgtName = String(r.target ?? r.to ?? r.toSymbol ?? "")
            const w = writtenForm(tgtName)
            const nameWritten = w.length > 1 && src.includes(w)
            unlinedSample.push({
              file: path.relative(CORPUS_ROOT, file), label: t, target: tgtName,
              from: String(r.source ?? r.from ?? r.fromSymbol ?? ""),
              reason: nameWritten ? "written? (TRIAGE: name occurs in source)" : "unwritten (no naming node — exempt)",
            })
          } else if (ln === 0) zeroLine.set(t, (zeroLine.get(t) ?? 0) + 1)
          // The seam keys, per label: the P1 payload matrix measures these over samples;
          // here they are measured against every edge the lane emits on its corpora.
          //
          // CORRECTED 2026-09-24 (M60 #929 round), by measuring the field's own frame.
          // It first required `relationshipType` alongside `type` and so reported
          // `edges missing a key: <ALL edges>` on EVERY lane — php 19,750/19,750, all
          // seven OO lanes the same shape. That was the probe's frame, not the lane's:
          // `relationshipType` is the STORE's column alias (`relationship_type AS
          // relationshipType`, src/lsp/graph_request.ts), and an in-memory analyzer
          // edge carries `type` because a rename has not happened yet. An instrument
          // that flags every edge of every lane is measuring its own assumption, and a
          // line that can never read zero is decoration. What actually starves a
          // consumer is an edge whose type, source or target is absent in EVERY
          // accepted spelling; that is what is counted now, and the type half accepts
          // either spelling because the rename is the store's job.
          const missing: string[] = []
          if (r.type === undefined && r.relationshipType === undefined) missing.push("type")
          if (r.source === undefined && r.from === undefined && r.fromSymbol === undefined) missing.push("source")
          if (r.target === undefined && r.to === undefined && r.toSymbol === undefined) missing.push("target")
          if (missing.length) missingKey.set(t, (missingKey.get(t) ?? 0) + 1)
          const tgt = String(r.target ?? r.to ?? r.toSymbol ?? "")
          const w = writtenForm(tgt)
          if (w.length > 1 && !src.includes(w)) {
            if (CONTRACT_LITERALS[w.toLowerCase()]) {
              contractTargets.push({ file: path.relative(CORPUS_ROOT, file), label: t, target: tgt, line: ln ?? null })
            } else {
              ghosts.push({ file: path.relative(CORPUS_ROOT, file), label: t, target: tgt, line: ln ?? null })
            }
          }
        }
      }
    }

    const pct = (n: number, d: number) => (d === 0 ? "0" : ((100 * n) / d).toFixed(1)) + "%"
    const row = {
      lang,
      repos,
      files, filesWithEdges, edges, symbols,
      labels: Object.fromEntries([...labels.entries()].sort((a, b) => b[1] - a[1])),
      noLine: Object.fromEntries([...noLine.entries()].sort((a, b) => b[1] - a[1])),
      zeroLine: Object.fromEntries([...zeroLine.entries()].sort((a, b) => b[1] - a[1])),
      missingSeamKeys: Object.fromEntries([...missingKey.entries()].sort((a, b) => b[1] - a[1])),
      kinds: Object.fromEntries([...kinds.entries()].sort((a, b) => b[1] - a[1])),
      unlinedSample: unlinedSample.slice(0, 40), unlinedSampleCount: unlinedSample.length,
      badNames, ghosts: ghosts.slice(0, 40), ghostCount: ghosts.length,
      contractNames, contractNameCount: contractNames.length,
      contractTargets, contractTargetCount: contractTargets.length,
      parseErrors: parseErrors.slice(0, 20), parseErrorCount: parseErrors.length,
    }
    rows.push(row)

    if (!AS_JSON) {
      console.log(`\n=== ${lang} — ${repos.join(" + ")} — ${files} file(s), ${edges} edge(s), ${symbols} symbol(s), ${filesWithEdges} file(s) with edges (${pct(filesWithEdges, files)})`)
      console.log(`  labels        ${Object.entries(row.labels).map(([k, v]) => `${k}=${v}`).join(" ")}`)
      console.log(`  kinds         ${Object.entries(row.kinds).map(([k, v]) => `${k}=${v}`).join(" ")}`)
      const noLineTotal = Object.values(row.noLine).reduce((a: number, b: any) => a + b, 0)
      console.log(`  lines         no line: ${noLineTotal} (${Object.entries(row.noLine).map(([k, v]) => `${k}=${v}`).join(" ") || "none"}) | line 0: ${Object.values(row.zeroLine).reduce((a: number, b: any) => a + b, 0)}`)
      if (noLineTotal) {
        // The reasons, not just the count: an edge whose target name the source never
        // WRITES cannot carry a line and is exempt by contract (see the check site).
        const byReason = new Map<string, number>()
        for (const x of unlinedSample) byReason.set(x.reason, (byReason.get(x.reason) ?? 0) + 1)
        console.log(`      why (sampled): ${[...byReason.entries()].map(([k, v]) => `${k}=${v}`).join(" ")}`)
        const triage = unlinedSample.filter(x => x.reason.startsWith("written?"))
        console.log(`      triage (sampled): ${triage.length} of ${unlinedSample.length} — ${triage.length === 0 ? "every sampled gap is a name the source never writes (exempt by contract)" : "the name OCCURS in the source; whether any node NAMES it there is the lane's ruling to read (a call site like GC.SuppressFinalize writes `Finalize` without naming the member)"}`)
        for (const x of unlinedSample.slice(0, 5)) console.log(`      ${x.file} :: ${x.label} ${x.from} -> ${x.target} (${x.reason})`)
      }
      console.log(`  seam keys     edges missing a key: ${Object.values(row.missingSeamKeys).reduce((a: number, b: any) => a + b, 0)} (${Object.entries(row.missingSeamKeys).map(([k, v]) => `${k}=${v}`).join(" ") || "none"})`)
      console.log(`  names         not a name / not in source: ${badNames.length}`)
      for (const b of badNames.slice(0, 12)) console.log(`      ${b.file} :: ${b.kind} ${b.symbol}${b.why ? ` (${b.why})` : ""}`)
      console.log(`  contract literals (named by contract, not by source spelling)  ${row.contractNameCount ?? 0} symbols, ${row.contractTargetCount ?? 0} relationship targets`)
      console.log(`  ghost targets ${row.ghostCount}`)
      for (const g of row.ghosts.slice(0, 12)) console.log(`      ${g.file} :: ${g.label} -> ${g.target}${g.line ? ` (line ${g.line})` : ""}`)
      console.log(`  parse errors  ${row.parseErrorCount}`)
      for (const p of row.parseErrors.slice(0, 6)) console.log(`      ${p.file} :: ${p.error}`)
    }
  }
  if (AS_JSON) console.log(JSON.stringify(rows, null, 2))
}

if (import.meta.main) main()
