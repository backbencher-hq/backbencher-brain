/**
 * CLOJURE LANE — THE PUBLICATION-GAP INSTRUMENT (the 13 rows, DISPOSITIONED).
 *
 * ## THE QUESTION IT ANSWERS
 *
 * The lane's own probe reported **13 rows** as "NOT PUBLISHED BY THE ANALYZER" — rows whose
 * qualified key the probe's raw rule answered, and which the probe could not find in the
 * analyzer's publication. **A GAP THAT IS MERELY FILED IS A FAILURE** (the Lead's ruling, L-…):
 * every wall is dispositioned with a count and a falsifier. So this instrument answers, for
 * each of the 13:
 *
 *   1. does the ANALYZER publish that key AT ALL — as a bare name, or as the **qualified-name
 *      ALIAS** of a symbol it does publish?
 *   2. if it does not, is the gap real (a defect), and what exactly is missing?
 *
 * ## WHY THE ANSWER IS ABOUT A KEY SPACE, NOT ABOUT THE CORPUS
 *
 * **THE GATE's OWN KEY SPACE COUNTS A SYMBOL's `qualifiedName` AS AN ALIAS OF THE SAME
 * DECLARATION** (`script/m14/incoming-gate.ts`: `countKey(name, …)` and, when the qualified name
 * differs from the name, `countKey(q, …)` — the same declaration, counted under two spellings, so
 * the declaration count stays honest). ⇒ **THE GATE CAN ASK `ns/target` AND FIND IT ✓✓.**
 *
 * The lane's own probe, by contrast, kept its analyzer publication in a map **KEYED BY THE BARE
 * NAME** and asked it for a **QUALIFIED** key ⇒ ⇒ the answer it computes is FALSE for every
 * qualified key, whatever the corpus says ⇒ ⇒ **THE 13 ARE A QUESTION TO THE WRONG KEY SPACE, AND
 * THE INSTRUMENT MEASURES IT RATHER THAN ASSUMING IT ✓✓.**
 *
 * ## WHAT IT PRINTS
 *
 *   - one line per row: the key, the repo, the file, and the verdict with the WITNESS (the
 *     symbol's name, kind, scope, file and line);
 *   - the class counts: `published-as-a-bare-name`, `published-as-a-qualified-alias`,
 *     `truly-unpublished`;
 *   - the falsifier, stated: a key that is in NEITHER the bare-name map NOR the alias map of its
 *     own repository is a REAL gap ⇒ the class count of `truly-unpublished` is the count of real
 *     gaps, and it is the number that must be zero for the analyzer to be complete.
 *
 * ## NO REGEX OVER SOURCE TEXT
 *
 * Every reading is a symbol field, a key, or a set membership. The corpus is read through the
 * PRODUCTION parser and the PRODUCTION analyzer.
 *
 * ## USAGE
 *
 *   BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/clojure-publication-gap.ts \
 *     --probe validation/m14/fixtures/clojure/lane-logs/index-effect.json \
 *     --out validation/m14/measurements/clojure-publication-gap.json
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs"
import { resolve } from "node:path"
import { parseFile } from "../../src/ast/pool-worker"

type Row = { key: string; repo: string; file: string; target: string; verdict: string; witness: any }

const argv = process.argv.slice(2)
const argOf = (name: string, dflt?: string) => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? String(argv[i + 1]) : dflt
}
const ROOT = resolve(process.env.BB_CORPUS_ROOT ?? resolve(process.cwd(), ".corpus"))
const PROBE_JSON = argOf("--probe", "validation/m14/fixtures/clojure/lane-logs/index-effect.json")
const OUT = argOf("--out", "validation/m14/measurements/clojure-publication-gap.json")

// ── THE PROBE's OWN ROWS, AND THE ROW SET THEY CAME FROM ✓✓ ────────────────────
const probe: any = JSON.parse(readFileSync(PROBE_JSON, "utf8"))
const notPublished: string[] = Array.isArray(probe?.joinPrice?.notPublishedRows) ? probe.joinPrice.notPublishedRows : []
/** THE PROBE's ROW STRING: `<key>  (target <target> in <file>)` ✓✓. */
function parseRowString(s: string): { key: string; target: string; file: string } {
  const m = /^(\S+)\s+\(target\s+(.*?)\s+in\s+(.*)\)$/.exec(s.trim())
  if (!m) return { key: s.trim(), target: "", file: "" }
  return { key: m[1], target: m[2], file: m[3] }
}
/** THE REPO OF A FILE — the corpus root's first path segment ✓✓ (the corpus root holds one
 *  directory per repository, and the gate's `repoOf` reads the same shape ✓✓). */
function repoOfFile(file: string): string {
  const rel = file.startsWith(ROOT) ? file.slice(ROOT.length).replace(/^\/+/, "") : file
  const seg = rel.split("/")[0] ?? ""
  return seg
}

// ── THE REPOSITORIES THE ROWS NAME ✓✓ (only those are parsed ✓✓) ───────────────
const repos = [...new Set(notPublished.map((s) => repoOfFile(parseRowString(s).file)).filter((r) => r !== ""))]
const rowsByRepo = new Map<string, { key: string; target: string; file: string }[]>()
for (const s of notPublished) {
  const p = parseRowString(s)
  const repo = repoOfFile(p.file)
  const list = rowsByRepo.get(repo) ?? []
  list.push(p)
  rowsByRepo.set(repo, list)
}

/** THE GATE's OWN KEY SPACE, PER REPO — the bare name AND the qualified-name alias ✓✓, with the
 *  WITNESS for each (the symbol that carries it) ✓✓. */
type Witness = { name: string; qualifiedName: string; scope: string; kind: string; file: string; line: number }
const keySpace = new Map<string, Map<string, Witness>>()
/** THE ANALYZER's PUBLICATION, AS THE PROBE KEPT IT — BARE NAMES ONLY ✓✓ (the probe's own
 *  key space, reproduced so the comparison is against the probe's own thing ✓✓). */
const bareNameSpace = new Map<string, Map<string, Witness>>()

for (const repo of repos) {
  const km = new Map<string, Witness>()
  const bn = new Map<string, Witness>()
  const repoDir = resolve(ROOT, repo)
  const files: string[] = []
  const walk = (dir: string) => {
    let entries: string[] = []
    try { entries = readdirSync(dir) } catch { return }
    for (const e of entries) {
      const p = resolve(dir, e)
      let st: any
      try { st = statSync(p) } catch { continue }
      if (st.isDirectory()) walk(p)
      else if (/\.(clj|cljs|cljc|edn)$/.test(e)) files.push(p)
    }
  }
  walk(repoDir)
  for (const f of files) {
    let r: any
    try { r = await parseFile(f, repo, { projectRoot: repo } as any) } catch { continue }
    for (const sym of Array.isArray(r?.symbols) ? r.symbols : []) {
      const name = String((sym as any)?.name ?? "")
      if (!name) continue
      const qual = String((sym as any)?.qualifiedName ?? "")
      const scope = String((sym as any)?.scope ?? "")
      const kind = String((sym as any)?.kind ?? "")
      const line = Number((sym as any)?.range?.startLine ?? (sym as any)?.line ?? 0) || 0
      const w: Witness = { name, qualifiedName: qual, scope, kind, file: f, line }
      bn.set(name, w)
      // THE GATE's ALIAS RULE: the qualified name is the SAME declaration under a second
      // spelling ⇒ ⇒ it goes into the same key space, with the same witness ✓✓.
      if (qual.length > 0 && qual !== name) km.set(qual, w)
      else km.set(name, w)
    }
  }
  keySpace.set(repo, km)
  bareNameSpace.set(repo, bn)
}

/** THE FILE's OWN PUBLICATION — the symbols, their scopes and their qualified names ✓✓ — and
 *  the file's MODULE SYMBOLS (the analyzer's own namespace source) ✓✓. This is the EVIDENCE a
 *  row's disposition is read from: a row's key is compared against what the analyzer publishes
 *  IN THAT FILE, not against a corpus-wide set ✓✓. */
const filePublication = new Map<string, { modules: string[]; symbols: { name: string; qualifiedName: string; scope: string; kind: string }[] }>()
for (const repo of repos) {
  const repoDir = resolve(ROOT, repo)
  const files: string[] = []
  const walk = (dir: string) => {
    let entries: string[] = []
    try { entries = readdirSync(dir) } catch { return }
    for (const e of entries) {
      const p = resolve(dir, e)
      let st: any
      try { st = statSync(p) } catch { continue }
      if (st.isDirectory()) walk(p)
      else if (/\.(clj|cljs|cljc|edn)$/.test(e)) files.push(p)
    }
  }
  walk(repoDir)
  for (const f of files) {
    let r: any
    try { r = await parseFile(f, repo, { projectRoot: repo } as any) } catch { continue }
    const modules: string[] = []
    const symbols: { name: string; qualifiedName: string; scope: string; kind: string }[] = []
    for (const sym of Array.isArray(r?.symbols) ? r.symbols : []) {
      const name = String((sym as any)?.name ?? "")
      const qual = String((sym as any)?.qualifiedName ?? "")
      const scope = String((sym as any)?.scope ?? "")
      const kind = String((sym as any)?.kind ?? "")
      if (kind.toLowerCase() === "module" || kind.toLowerCase() === "namespace") modules.push(name)
      symbols.push({ name, qualifiedName: qual, scope, kind })
    }
    filePublication.set(f, { modules, symbols })
  }
}

const rows: Row[] = []
let asBare = 0
let asAlias = 0
let trulyUnpublished = 0
for (const s of notPublished) {
  const p = parseRowString(s)
  const repo = repoOfFile(p.file)
  const km = keySpace.get(repo)
  const bn = bareNameSpace.get(repo)
  let verdict = "TRULY-UNPUBLISHED — THE ANALYZER PUBLISHES NO SUCH SYMBOL, IN EITHER SPELLING"
  let witness: any = null
  if (bn?.has(p.key)) {
    verdict = "PUBLISHED AS A BARE NAME"
    witness = bn.get(p.key)
    asBare++
  } else if (km?.has(p.key)) {
    verdict = "PUBLISHED AS A QUALIFIED-NAME ALIAS — the gate's own key space holds it (the qualified name is the SAME declaration under a second spelling)"
    witness = km.get(p.key)
    asAlias++
  } else {
    trulyUnpublished++
  }
  // THE EVIDENCE FOR THE VERDICT: the file's OWN namespace source (the analyzer's module
  // symbols) and the symbols whose name or qualified name carries the key's LAST SEGMENT ✓✓.
  const fp = filePublication.get(p.file)
  const last = p.key.slice(p.key.lastIndexOf("/") + 1)
  const near = (fp?.symbols ?? []).filter((s) => s.name === last || s.qualifiedName === p.key || s.qualifiedName.endsWith("/" + last))
  const evidence = {
    fileModuleSymbols: fp?.modules ?? [],
    theNamespaceSourceTheKeyWasBuiltFrom: p.key.slice(0, p.key.length - last.length - 1),
    symbolsInThatFileCarryingTheName: near.map((s) => ({ name: s.name, qualifiedName: s.qualifiedName, scope: s.scope, kind: s.kind })),
  }
  rows.push({ key: p.key, repo, file: p.file, target: p.target, verdict, witness, evidence })
}

const report = {
  instrument: "script/m14/clojure-publication-gap.ts",
  probeArtifact: PROBE_JSON,
  probeNotPublishedCount: notPublished.length,
  question: "the 13 rows the lane's own probe reported as NOT PUBLISHED BY THE ANALYZER — a real gap, or the probe asking a qualified key in a bare-name map?",
  method: "the probe's own row set, re-asked against (a) the ANALYZER's BARE-NAME publication and (b) the GATE's OWN key space, which counts a symbol's qualifiedName as an ALIAS of the same declaration (script/m14/incoming-gate.ts, countKey)",
  classCounts: { publishedAsABareName: asBare, publishedAsAQualifiedNameAlias: asAlias, trulyUnpublished },
  theGapIsReal: trulyUnpublished,
  falsifier: "a key that is in NEITHER the bare-name map NOR the alias map of its OWN repository is a REAL gap; the class count `trulyUnpublished` is therefore the count of real gaps, and it is the number that must be zero",
  rows,
}
writeFileSync(OUT, JSON.stringify(report, null, 2) + "\n")
console.log(`THE PUBLICATION GAP — ${notPublished.length} row(s) the probe reported as NOT PUBLISHED ✓✓`)
console.log(`  published as a bare name:            ${asBare}`)
console.log(`  published as a qualified-name ALIAS:  ${asAlias}  ← the gate's own key space holds these ✓✓`)
console.log(`  TRULY UNPUBLISHED (a REAL gap):       ${trulyUnpublished}`)
for (const r of rows) {
  const w = r.witness ? ` [${r.witness.kind} ${r.witness.name} · qualifiedName ${r.witness.qualifiedName || "-"}]` : ""
  const e: any = r.evidence
  console.log(`    ${r.key}  (${r.repo})  ⇒ ${r.verdict}${w}`)
  console.log(`        the file's module symbols: ${JSON.stringify(e.fileModuleSymbols)} · the key was built from ns "${e.theNamespaceSourceTheKeyWasBuiltFrom}" · the file's symbols carrying that name: ${JSON.stringify(e.symbolsInThatFileCarryingTheName)}`)
}
console.log(`JSON: ${OUT}`)
