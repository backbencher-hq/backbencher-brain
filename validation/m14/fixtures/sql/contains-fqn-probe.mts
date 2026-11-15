/**
 * CONTAINS → QUALIFIED-NAME PRECONDITION PROBE.
 *
 * ## THE QUESTION
 *
 * `pass13-ambiguity-split-AFTER.json` reports `K3_qname` resolution EQUAL to `K0_bare` on every one
 * of the ten types — 651/651, 2,512/2,512, 4,364/4,364 — because no edge in this lane targets a
 * qualified name. This probe answers the one question that decides whether `contains` can be made
 * to: **for a `contains` edge, is the qualified name of its target a fact, or a guess?**
 *
 * ## WHY `contains` AND NOT THE OTHER NINE
 *
 * `publishQualifiedNames` gives every symbol `<basename>::<owner>.<name>`. For a `contains` edge the
 * member was declared INSIDE the owner in the SAME parse result, so the target's qualified name is
 * derivable from this file alone and names one symbol in this file — a parse fact. For `calls`,
 * `uses` and `references` the target is a name in another file, and the analyzer does not know which
 * file declares it; emitting a qualified name there would be inventing the file, which is the
 * fabrication the M14 contract forbids. So `contains` is the only type where the change is sound,
 * and this probe measures how much of `contains` that covers rather than assuming all of it.
 *
 * ## WHAT WOULD OVERTURN IT
 *
 * If the target's qualified name were NOT unique in the project — two symbols sharing one fqn — then
 * a `contains` edge targeting it would bind to whichever row the store's `MIN(id)` picks, which is
 * deterministic but is not the member. The population is reported as `fqnCollisions`, and a
 * non-zero value is the falsifier: it says the qualified name is not an identifier for those members.
 *
 * ## USAGE
 *
 *   npx tsx validation/m14/fixtures/sql/contains-fqn-probe.mts [--files N] [--out FILE]
 */
import { execFileSync } from "node:child_process"
import { readdirSync, statSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"

const argv = process.argv.slice(2)
const fail = (m: string): never => { console.error(`contains-fqn-probe: ${m}`); process.exit(2) }
const argOf = (f: string) => {
  const i = argv.indexOf(f)
  if (i < 0) return undefined
  const v = argv[i + 1]
  if (v == null || v.startsWith("--")) fail(`\`${f}\` has no value`)
  return v
}
const OUT = argOf("--out")
const N = Number(argOf("--files") ?? 600)
const LIST = Number(argOf("--list") ?? 12)
if (!Number.isInteger(N) || N < 1) fail(`--files must be a positive integer`)
const CORPUS = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 512 * 1024

// ------------------------------------------------------------------ population
const admitted: { label: string; abs: string }[] = []
let reposScanned = 0
for (const entry of readdirSync(CORPUS)) {
  const dir = path.join(CORPUS, entry)
  let tracked: string[] = []
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    reposScanned++
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text = ""
    try {
      if (statSync(abs).size > SIZE_CAP) continue
      text = readFileSync(abs, "utf8")
    } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "sql") continue
    admitted.push({ label: `${entry}/${rel}`, abs })
  }
}
admitted.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0))
const population = admitted.length
const picked: typeof admitted = []
if (population <= N) picked.push(...admitted)
else for (let i = 0; i < N; i++) picked.push(admitted[Math.floor((i * population) / N)])

/** every published symbol in the sample: fqn -> the files that publish it */
const fqnOwners = new Map<string, string[]>()
/** bare published name -> count, project-wide */
const nameOwners = new Map<string, Set<string>>()
/** one row per contains edge */
type Row = {
  source: string
  target: string
  file: string
  spelledQualified: boolean
  derivedFqnIsPublished: boolean
  memberKind: string | null
}
const rows: Row[] = []
let symbols = 0
let parseFailures = 0
let degraded = 0
let symbolsWithoutFqn = 0

for (const f of picked) {
  let r: any
  try {
    r = await parseFile(f.abs, path.dirname(f.abs))
  } catch {
    parseFailures++
    continue
  }
  if (!r) { parseFailures++; continue }
  if (r.fallback === true) degraded++

  const localFqn = new Set<string>()
  const localNames = new Map<string, number>()
  for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
    symbols++
    const name = String(s?.name ?? "")
    if (!name) continue
    localNames.set(name, (localNames.get(name) ?? 0) + 1)
    // BOTH fields, because the two production entry points carry the identifier in different ones.
    // Measured on `postgrest/test/io/fixtures/big_schema.sql`: `pool-worker.parseFile` returns
    // `qualifiedName` DERIVED from `metadata.fqn` and no longer carrying it, while
    // `ASTEngine.parseFile` returns `metadata.fqn` and no `qualifiedName`. Reading only
    // `metadata.fqn` reported 0 of 8,819 symbols carrying an identifier on this instrument — a true
    // statement about the field it read and a false statement about the analyzer.
    const nf = nameOwners.get(name)
    if (nf) nf.add(f.abs)
    else nameOwners.set(name, new Set([f.abs]))
    const fqn = String(s?.qualifiedName ?? s?.metadata?.fqn ?? "")
    if (!fqn || fqn === name) { symbolsWithoutFqn++; continue }
    localFqn.add(fqn)
    const owners = fqnOwners.get(fqn)
    if (owners) owners.push(f.abs)
    else fqnOwners.set(fqn, [f.abs])
  }
  for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
    const type = String(rel?.type ?? rel?.relationshipType ?? "")
    if (type !== "contains") continue
    const source = String(rel?.source ?? "")
    const rawTarget = String(rel?.target ?? "")
    if (!rawTarget) continue
    // The member's fqn is `<basename>::<owner>.<name>`. The edge's SOURCE is the owner, and both
    // were declared in this file, so the fqn is computed from this file's own module name — the
    // same string `publishQualifiedNames` writes.
    //
    // TWO ARMS, because the analyzer changed under this probe. `retargetContainmentEdges` now writes
    // that fqn AS the target, so an arm that always recomputed the candidate would look for
    // `<file>::<owner>.<file>::<owner>.<name>` after the change and report 0% derivable — a true
    // statement about a string the probe invented and a false statement about the analyzer. So the
    // target is read AS WRITTEN and classified by whichever contract it is spelled in, and the
    // derived candidate is recorded separately as the BEFORE-arm figure.
    const qualified = rawTarget.includes("::")
    const derived = `${path.basename(f.abs)}::${source && source !== rawTarget ? `${source}.` : ""}${qualified ? rawTarget.slice(rawTarget.indexOf("::") + 2).slice(rawTarget.slice(rawTarget.indexOf("::") + 2).lastIndexOf(".") + 1) : rawTarget}`
    rows.push({
      source,
      target: rawTarget,
      file: f.abs,
      spelledQualified: qualified,
      derivedFqnIsPublished: localFqn.has(derived),
      memberKind: rel?.metadata?.memberKind == null ? null : String(rel.metadata.memberKind),
    })
  }
}

// ------------------------------------------------------------------ counts
/**
 * THE QUESTION BOTH ARMS ANSWER: read the target AS WRITTEN and count how many published symbols it
 * names. A target spelled with `::` is looked up in the qualified-name index; a bare one in the name
 * index. That is what the store does too — `target_external = qualified_name` first, then
 * `target_external = name` — so a single number is comparable across the contract change.
 */
const resolvesExactlyOne = rows.filter((r) => {
  if (r.spelledQualified) return (fqnOwners.get(r.target)?.length ?? 0) === 1
  return (nameOwners.get(r.target)?.size ?? 0) === 1
}).length
const ambiguous = rows.filter((r) => {
  if (r.spelledQualified) return (fqnOwners.get(r.target)?.length ?? 0) > 1
  return (nameOwners.get(r.target)?.size ?? 0) > 1
}).length
const unresolvedTargets = rows.filter((r) => {
  if (r.spelledQualified) return (fqnOwners.get(r.target)?.length ?? 0) === 0
  return (nameOwners.get(r.target)?.size ?? 0) === 0
}).length
const spelledQualified = rows.filter((r) => r.spelledQualified).length
const derived = rows.filter((r) => r.derivedFqnIsPublished).length

/** the falsifier: a target the analyzer qualified but that MORE THAN ONE symbol publishes */
const fqnCollidingTargets = rows.filter((r) => r.spelledQualified && (fqnOwners.get(r.target)?.length ?? 0) > 1).length
const fqnCollidingFiles = [...fqnOwners.entries()].filter(([, files]) => files.length > 1)

const out = {
  instrument: "validation/m14/fixtures/sql/contains-fqn-probe.mts",
  entryPoint: "parseFile (src/ast/pool-worker.ts)",
  corpusRoot: CORPUS,
  reposScanned,
  admittedPopulation: population,
  requestedFiles: N,
  sampleFiles: picked.length,
  filesArgumentPresent: argv.includes("--files"),
  sampling: `deterministic stride over the ${population} admitted files sorted by repo/relative/path`,
  symbolsPublished: symbols,
  symbolsWithoutFqn: symbolsWithoutFqn,
  degradedFiles: degraded,
  parseFailures,
  contains: {
    edges: rows.length,
    /** the target is spelled as a qualified name */
    spelledQualified,
    spelledBare: rows.length - spelledQualified,
    /** read as written, how many published symbols does the target name? */
    resolvesExactlyOne,
    ambiguous,
    unresolved: unresolvedTargets,
    resolvesExactlyOneRate: rows.length ? resolvesExactlyOne / rows.length : 0,
    ambiguousRate: rows.length ? ambiguous / rows.length : 0,
    /** the BEFORE-arm figure, kept so the two runs read against the same derivation */
    derivedFqnIsPublished: derived,
    derivedFqnIsPublishedRate: rows.length ? derived / rows.length : 0,
    memberKindHist: (() => {
      const h = new Map<string, number>()
      for (const r of rows) {
        const k = r.memberKind ?? "(none)"
        h.set(k, (h.get(k) ?? 0) + 1)
      }
      return Object.fromEntries([...h].sort())
    })(),
  },
  /** the falsifier, project-wide */
  fqnCollisions: fqnCollidingFiles.length,
  fqnCollidingTargets,
  fqnCollisionExamples: fqnCollidingFiles.slice(0, LIST).map(([fqn, files]) => ({
    fqn,
    symbols: files.length,
  })),
  unresolvedExamples: rows.filter((r) => {
    if (r.spelledQualified) return (fqnOwners.get(r.target)?.length ?? 0) === 0
    return (nameOwners.get(r.target)?.size ?? 0) === 0
  }).slice(0, LIST).map((r) => ({ target: r.target, file: path.relative(CORPUS, r.file) })),
}

if (OUT) {
  mkdirSync(path.dirname(OUT), { recursive: true })
  writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`)
  console.log(`wrote ${OUT}`)
}
console.log(JSON.stringify(out, null, 2))
