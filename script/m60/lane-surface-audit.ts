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
//   L3 seam keys     per label: does the edge carry `type` AND `relationshipType`;
//                    `source`/`from`/`fromSymbol`; `target`/`to`/`toSymbol`? (the M60 P1
//                    payload seam: a consumer reading the missing key sees NOTHING where
//                    the edge exists)
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
          if (!n.trim() || PLACEHOLDER.test(n.trim())) {
            badNames.push({ file: path.relative(CORPUS_ROOT, file), symbol: JSON.stringify(n), kind: k, line: s.range?.startLine })
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
          if (ln === undefined || ln === null) noLine.set(t, (noLine.get(t) ?? 0) + 1)
          else if (ln === 0) zeroLine.set(t, (zeroLine.get(t) ?? 0) + 1)
          // The seam keys, per label: the P1 payload matrix measures these over samples;
          // here they are measured against every edge the lane emits on its corpora.
          const missing: string[] = []
          if (r.type === undefined || r.type === null) missing.push("type")
          if (r.relationshipType === undefined || r.relationshipType === null) missing.push("relationshipType")
          if (r.source === undefined && r.from === undefined && r.fromSymbol === undefined) missing.push("source")
          if (r.target === undefined && r.to === undefined && r.toSymbol === undefined) missing.push("target")
          if (missing.length) missingKey.set(t, (missingKey.get(t) ?? 0) + 1)
          const tgt = String(r.target ?? r.to ?? r.toSymbol ?? "")
          const w = writtenForm(tgt)
          if (w.length > 1 && !src.includes(w)) {
            ghosts.push({ file: path.relative(CORPUS_ROOT, file), label: t, target: tgt, line: ln ?? null })
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
      badNames, ghosts: ghosts.slice(0, 40), ghostCount: ghosts.length,
      parseErrors: parseErrors.slice(0, 20), parseErrorCount: parseErrors.length,
    }
    rows.push(row)

    if (!AS_JSON) {
      console.log(`\n=== ${lang} — ${repos.join(" + ")} — ${files} file(s), ${edges} edge(s), ${symbols} symbol(s), ${filesWithEdges} file(s) with edges (${pct(filesWithEdges, files)})`)
      console.log(`  labels        ${Object.entries(row.labels).map(([k, v]) => `${k}=${v}`).join(" ")}`)
      console.log(`  kinds         ${Object.entries(row.kinds).map(([k, v]) => `${k}=${v}`).join(" ")}`)
      const noLineTotal = Object.values(row.noLine).reduce((a: number, b: any) => a + b, 0)
      console.log(`  lines         no line: ${noLineTotal} (${Object.entries(row.noLine).map(([k, v]) => `${k}=${v}`).join(" ") || "none"}) | line 0: ${Object.values(row.zeroLine).reduce((a: number, b: any) => a + b, 0)}`)
      console.log(`  seam keys     edges missing a key: ${Object.values(row.missingSeamKeys).reduce((a: number, b: any) => a + b, 0)} (${Object.entries(row.missingSeamKeys).map(([k, v]) => `${k}=${v}`).join(" ") || "none"})`)
      console.log(`  names         not a name / not in source: ${badNames.length}`)
      for (const b of badNames.slice(0, 12)) console.log(`      ${b.file} :: ${b.kind} ${b.symbol}${b.why ? ` (${b.why})` : ""}`)
      console.log(`  ghost targets ${row.ghostCount}`)
      for (const g of row.ghosts.slice(0, 12)) console.log(`      ${g.file} :: ${g.label} -> ${g.target}${g.line ? ` (line ${g.line})` : ""}`)
      console.log(`  parse errors  ${row.parseErrorCount}`)
      for (const p of row.parseErrors.slice(0, 6)) console.log(`      ${p.file} :: ${p.error}`)
    }
  }
  if (AS_JSON) console.log(JSON.stringify(rows, null, 2))
}

if (import.meta.main) main()
