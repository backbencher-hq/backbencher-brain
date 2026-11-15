/**
 * BASH LANE — adjudicating the C bucket (EXTERNAL / genuinely-absent) of the incoming split.
 *
 * ## The question
 *
 * `probe-bash-abc.mts` measured, on a 600-file window:
 *
 *     B  format mismatch   29 dotted unresolved targets, 0 whose final segment is published
 *     A  name not an identifier   227 distinct targets, 2,019 edges
 *     C  external / absent   319 distinct targets, 5,084 edges
 *                            (calls 4,384  uses 602  imports 49  references 49)
 *
 * and its own closing line said: *"Nothing here claims a residue is external. Each name is
 * read and adjudicated in the next commit."* This file is that commit's instrument.
 *
 * ## Why a 600-file window cannot answer the question
 *
 * "Unresolved" inside a window means "no file IN THE WINDOW publishes this name". For bash
 * that is not the same as "nothing publishes this name": a script calls a function defined
 * in a sibling file, and whether the sibling is in the window is an accident of sort order.
 * So the honest decomposition needs a SECOND measurement over the whole corpus, and this
 * probe runs it. For every residue name:
 *
 *   DISCOVERY  `git grep -l -F` for the three DEFINITION shapes bash admits
 *              (`name()`, `function name`, `name=`) over every tracked file in the corpus,
 *              keeping only files the production router admits as bash.
 *   VERDICT    production `parseFile` on each candidate file. If any candidate PUBLISHES
 *              the name, the name is CROSS_FILE_LOCAL — a real project symbol the window
 *              missed — and it is NOT external. If no candidate publishes it, the name is
 *              NOT_DECLARED_IN_CORPUS, which is the only population "external" may be
 *              claimed over.
 *
 * The corpus-wide pass uses `git grep` for DISCOVERY only. Every verdict comes from
 * production `parseFile` and a published symbol name. No regex reads a target or a name.
 *
 * ## What the categories mean
 *
 *   CROSS_FILE_LOCAL   declared in the corpus, outside the window. NOT external. The window
 *                      undercounted resolution; these are recoverable edges, not defects.
 *   FILE_PATH          the target is a path (`./x.sh`, `/usr/bin/env`, `${D}/activate`), and
 *                      the edge type is `imports`/`references` — a `source`/`.` dependency on
 *                      a file, not on a symbol. Carries no symbol to bind to BY CONSTRUCTION.
 *   ENV_VAR            `uses` of an ALL-CAPS name: process state, not a declaration in the
 *                      file. Some are set by the shell itself (`PWD`, `PIPESTATUS`).
 *   POSITIONAL_PARAM   `$1`, `$@`, `$#`, `$*` read in COMMAND position. A parameter is not a
 *                      command; an edge to one names no program that could run.
 *   EXTERNAL_BINARY    `calls` to a name no file in the corpus declares as a function, alias
 *                      or variable. The largest bucket and the one the brief calls external.
 *   UNCLASSIFIED       printed with its evidence, never folded into a bucket above.
 *
 * A name in NOT_DECLARED_IN_CORPUS is NOT automatically EXTERNAL_BINARY: a path, an env var
 * and a binary are all undeclared, and they are separated by EDGE TYPE plus a NAME SHAPE,
 * with the shape census printed so the split can be checked. The split is a claim about the
 * sample and says so.
 *
 * ## CLI
 *
 *   npx tsx validation/m14/fixtures/bash/probe-bash-c-adjudication.mts \
 *     [--sample 600] [--ext sh] [--json out.json] [--skip-corpus]
 */
import { execFileSync } from "node:child_process"
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { createHash } from "node:crypto"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const flag = (n: string) => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 ? argv[i + 1] : undefined
}
const has = (n: string) => argv.includes(`--${n}`)
const SAMPLE = Number(flag("sample") ?? 600)
const EXT = flag("ext") ?? "sh"

// ---------------------------------------------------------------- sample
// The exact population of `probe-bash-abc.mts --order path`, so the residue here IS the
// residue there. The digest is asserted, not assumed: if the analyzer changed, this prints
// MISMATCH rather than adjudicating a different population.
const listed = execFileSync(
  "bash",
  ["-lc", `find ${CR} -name '*.${EXT}' -type f 2>/dev/null | sort | head -${SAMPLE}`],
  { encoding: "utf8", maxBuffer: 1 << 28 },
)
  .trim()
  .split("\n")
  .filter(Boolean)
const sample = listed.map((abs) => ({ abs, dir: path.dirname(abs), repo: abs.slice(CR.length + 1).split("/")[0] }))

// ---------------------------------------------------------------- window pass
interface Edge {
  type: string
  t: string
  src: string
  file: string
  line: number
  isExternalCommand: boolean | undefined
  isFunctionCall: boolean | undefined
  targetResolution: string | undefined
  commandInErrorRecovery: boolean | undefined
  variableDeclaredInFile: boolean | undefined
  isSourceImport: boolean | undefined
  isSourceDependency: boolean | undefined
  resolution: string | undefined
  confidence: number | undefined
}
const published = new Map<string, { files: Set<string>; kinds: Set<string> }>()
const edges: Edge[] = []
let parsed = 0
let failed = 0
let degraded = 0
let symbols = 0
const digest = createHash("sha256")

for (const f of sample) {
  let r: any
  try {
    r = await parseFile(f.abs, f.dir)
    parsed++
  } catch {
    failed++
    continue
  }
  const syms: any[] = r?.symbols ?? []
  symbols += syms.length
  if (r?.degraded) degraded++
  for (const s of syms) {
    let e = published.get(s.name)
    if (!e) published.set(s.name, (e = { files: new Set(), kinds: new Set() }))
    e.files.add(f.abs)
    e.kinds.add(String(s.kind))
  }
  for (const e of r?.relationships ?? []) {
    const t = String(e?.target ?? "")
    if (!t) continue
    const m = (e?.metadata ?? {}) as Record<string, any>
    const type = String(e?.type ?? "")
    edges.push({
      type,
      t,
      src: String(e?.source ?? ""),
      file: f.abs,
      line: Number(e?.line_number ?? 0),
      isExternalCommand: typeof m.isExternalCommand === "boolean" ? m.isExternalCommand : undefined,
      isFunctionCall: typeof m.isFunctionCall === "boolean" ? m.isFunctionCall : undefined,
      targetResolution: m.targetResolution === undefined ? undefined : String(m.targetResolution),
      commandInErrorRecovery: m.commandInErrorRecovery === true ? true : undefined,
      variableDeclaredInFile: typeof m.variableDeclaredInFile === "boolean" ? m.variableDeclaredInFile : undefined,
      isSourceImport: m.isSourceImport === true ? true : undefined,
      isSourceDependency: m.isSourceDependency === true ? true : undefined,
      resolution: m.resolution === undefined ? undefined : String(m.resolution),
      confidence: typeof e?.confidence === "number" ? e.confidence : undefined,
    })
    digest.update(`${f.abs}\u0000${type}\u0000${e?.source ?? ""}\u0000${t}\n`)
  }
}

const windowDigest = digest.digest("hex").slice(0, 16)
const EXPECTED_DIGEST = "6d5542aa6d6640e2"

const distinctTargets = [...new Set(edges.map((e) => e.t))]
const unresolved = distinctTargets.filter((t) => !published.has(t))

/** residue name -> its edges */
const residueEdges = new Map<string, Edge[]>()
for (const e of edges) {
  if (published.has(e.t)) continue
  const a = residueEdges.get(e.t)
  if (a) a.push(e)
  else residueEdges.set(e.t, [e])
}

// ---------------------------------------------------------------- corpus pass
//
// Repos in the corpus, and the tracked bash files in each. `git ls-files` keeps the
// population to what a clone actually contains; a `--filter=blob:none` clone still lists
// paths, and `git grep` fetches only the blobs it needs.
const repos: { name: string; dir: string }[] = []
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    continue
  }
  repos.push({ name: e, dir })
}

const trackedBash = new Map<string, string[]>() // repo -> relpaths
for (const r of repos) {
  try {
    const out = execFileSync("git", ["-C", r.dir, "ls-files", "-z"], {
      encoding: "utf8",
      maxBuffer: 1 << 28,
    })
    trackedBash.set(
      r.name,
      out
        .split("\0")
        .filter(Boolean)
        .filter((rel) => detectLanguageFromPath(rel, "") === "bash"),
    )
  } catch {
    trackedBash.set(r.name, [])
  }
}
const corpusBashFiles = [...trackedBash.values()].reduce((a, b) => a + b.length, 0)

/** residue name -> repo dir -> relpaths that could declare it (DISCOVERY only) */
const candidates = new Map<string, Map<string, string[]>>()
let corpusScanned = 0
let candidateFiles = 0
let filesRead = 0
let filesUnreadable = 0

if (!has("skip-corpus")) {
  // DISCOVERY, with git removed from the measurement path.
  //
  // Two earlier versions used `git grep -F -e ...` and both failed silently, in two
  // different ways, and the shape of the failure is the reason this is plain `readFileSync`
  // now:
  //
  //   1. Every tracked relpath passed as a pathspec alongside ~1,300 patterns overruns the
  //      argv limit; git exits 128; the catch treated every non-zero exit as "no match" and
  //      printed `census 0 candidate files`. A census of zero produced by a command that
  //      never ran. With an empty census every residue name falls through to EXTERNAL_BINARY,
  //      so the failure would have been REPORTED AS A FINDING.
  //   2. Chunked to 150 patterns, git still exited 128 with
  //      `fatal: ambiguous argument 'function grep': unknown revision or path not in the
  //      working tree` — git grep's own pathspec-versus-pattern parsing, which depends on
  //      argument ORDER. The same 150 patterns succeed under a different order, which is
  //      why this reproduced only inside the walk.
  //
  // The corpus is 3,748 bash files. Reading all of them and applying the definition-shape
  // predicate in Node removes git's argv limits, git's pathspec grammar and the partial-clone
  // promisor from the measurement, and a read failure is now counted and printed rather than
  // absorbed. DISCOVERY ONLY — every verdict still comes from production `parseFile` on a
  // published symbol name.
  const names = [...residueEdges.keys()]
  for (const r of repos) {
    const rels = trackedBash.get(r.name) ?? []
    if (!rels.length) continue
    for (const rel of rels) {
      corpusScanned++
      const buf = readFileIfPresent(path.join(r.dir, rel))
      if (buf === null) {
        filesUnreadable++
        continue
      }
      filesRead++
      for (const n of names) {
        if (!declaresName(buf, n)) continue
        let m = candidates.get(n)
        if (!m) candidates.set(n, (m = new Map()))
        const a = m.get(r.name)
        if (a) a.push(rel)
        else m.set(r.name, [rel])
      }
    }
  }
  for (const m of candidates.values()) for (const rels of m.values()) candidateFiles += rels.length
}

function readFileIfPresent(p: string): string | null {
  try {
    return readFileSync(p, "utf8")
  } catch {
    return null
  }
}

/**
 * Does this file text DECLARE `name` in one of the shapes bash admits? DISCOVERY ONLY —
 * the verdict comes from production `parseFile` on the file this returns true for.
 * Kept deliberately narrow: a mention is not a declaration, and the corpus census is
 * looking for definitions, not usages.
 *
 * `function name` is matched as a PREFIX followed by one of the legal separators, not as
 * the exact string `function name `. The first version required a space immediately after
 * the name and so rejected `function name {`, which is the form consul writes 47 times in
 * test/integration/connect/envoy/helpers.bash (`function upsert_config_entry {`, line 936).
 * With that form rejected, the census found nothing, `upsert_config_entry` and
 * `gen_envoy_bootstrap` fell through to EXTERNAL_BINARY, and the report would have claimed
 * 188 + 186 real cross-file calls were calls to external binaries. Both forms are legal
 * bash; a census that reads one of them is measuring a syntax the corpus does not use.
 */
function declaresName(text: string, name: string): boolean {
  if (name.includes("/") || name.includes("$") || name.includes(".")) return false
  const kwForms = ["export ", "local ", "declare ", "typeset ", "readonly "]
  for (const raw of text.split("\n")) {
    const line = raw.trimStart()
    if (line.startsWith("#")) continue
    // `name()` — POSIX function definition, brace on this line or a later one.
    if (line.startsWith(`${name}()`)) {
      const rest = line.slice(name.length + 2)
      if (rest === "" || rest === "{" || rest.startsWith("{")) return true
    }
    // `function name`, `function name()`, `function name {` — bash keyword form.
    // `rest` is TRIMMED before the separator test: `function upsert_config_entry {`
    // leaves `" {"`, so an untrimmed `startsWith("{")` is false and the census silently
    // reports zero cross-file declarations. That is the second version of this bug.
    if (line.startsWith("function ") && line.slice(9).trimStart().startsWith(name)) {
      const rest = line.slice(9).trimStart().slice(name.length).trimStart()
      if (rest === "" || rest === "()" || rest === "(" || rest.startsWith("{")) return true
    }
    // `name=` / `export name=` / `local name=` / `declare name=` — assignment, no spaces.
    for (const kw of kwForms) {
      if (!line.startsWith(kw)) continue
      const rest = line.slice(kw.length)
      if (!rest.startsWith(name)) continue
      const after = rest.slice(name.length)
      if (after.startsWith("=") || after.startsWith("+=")) return true
    }
  }
  return false
}

// ---------------------------------------------------------------- verdict pass
//
// Production parseFile on every candidate file. A residue name is CROSS_FILE_LOCAL when
// some candidate file PUBLISHES it — the analyzer's own symbol table, not a grep.
const crossFileLocal = new Map<string, { file: string; kind: string }>()
let candidatesParsed = 0
let candidatesFailed = 0
const candidateFailures: string[] = []
{
  // `candidates` is Map<targetName, Map<repoName, relpaths[]>>. The outer key is the
  // TARGET and the inner key is the REPO, and a first version destructured the outer key
  // as `repoName` — so every candidate was looked for under a directory named after the
  // thing it was supposed to contain. All 60 parses failed with
  // `ENOENT .../repositories/apk/eng/ci/capture-maui-android-samples.sh`, where `apk` is a
  // residue target and the real repo is `Fabulous`. The census reported 0 cross-file
  // declarations for the same reason the git version reported 0, by a third route.
  const absSet = new Set<string>()
  for (const m of candidates.values()) {
    for (const [repoName, rels] of m) {
      const rdir = path.join(CR, repoName)
      for (const rel of rels) absSet.add(path.join(rdir, rel))
    }
  }
  for (const abs of absSet) {
    let r: any
    try {
      r = await parseFile(abs, path.dirname(abs))
      candidatesParsed++
    } catch (e: any) {
      candidatesFailed++
      if (candidatesFailed <= 3)
        candidateFailures.push(`${abs} :: ${String(e?.message ?? e).slice(0, 160)}`)
      continue
    }
    for (const s of r?.symbols ?? []) {
      const n = String(s?.name ?? "")
      if (!n) continue
      if (!residueEdges.has(n)) continue
      if (crossFileLocal.has(n)) continue
      crossFileLocal.set(n, { file: abs, kind: String(s?.kind ?? "") })
    }
  }
}

// ---------------------------------------------------------------- classification
/** M60 no-regex rule: the lane forbids regex literals in its own files, so the positional
 *  spelling is tested with character codes exactly as the analyzer tests identifiers. */
const POSITIONAL = (n: string): boolean => {
  if (n.length < 2 || n.charCodeAt(0) !== 36 /* $ */) return false
  if (n.length === 2) {
    const c = n.charCodeAt(1)
    return c === 64 || c === 42 || c === 35 || c === 63 || (c >= 48 && c <= 57)
  }
  for (let i = 1; i < n.length; i++) {
    const c = n.charCodeAt(i)
    if (c < 48 || c > 57) return false
  }
  return true
}
const isPathShape = (n: string) => n.includes("/") || (n.includes(".") && !n.endsWith(".sh") ? true : false)
const isAllCaps = (n: string): boolean => {
  if (n.length === 0) return false
  const first = n.charCodeAt(0)
  if (first < 65 || first > 90) return false
  for (let i = 1; i < n.length; i++) {
    const c = n.charCodeAt(i)
    if ((c >= 65 && c <= 90) || (c >= 48 && c <= 57) || c === 95) continue
    return false
  }
  return true
}

/**
 * PER-EDGE classification. Per-TARGET was the first version and it conflated two facts that
 * must not share a bucket.
 *
 * `CROSS_FILE_LOCAL` as first written meant "some corpus file publishes this name", and on
 * the measured rows that put these in one bucket:
 *
 *   188 calls -> upsert_config_entry   declared as FUNCTION in consul/helpers.bash
 *    28 calls -> xargs                 declared as VARIABLE in ohmyzsh/plugins/pip/pip.plugin.zsh
 *   106 calls -> git                   declared as VARIABLE in kubernetes/hack/lib/version.sh
 *
 * The first is a real cross-file call the window missed. The second and third are /usr/bin
 * binaries whose NAME coincides with a variable in an unrelated file — `git` declared as a
 * variable does not make 106 `git` calls anything but external. A consumer told
 * "cross-file local, therefore not external" would resolve all three against the wrong
 * declaration, which is the same class of error as a fabricated edge.
 *
 * So the unit is the EDGE, and the declared KIND plus the edge TYPE decide the bucket:
 *
 *   EXTERNAL_BINARY   calls, and the corpus declares the name as a VARIABLE/CONSTANT only,
 *                     or not at all. Command position resolves to a function or a PATH
 *                     lookup, never to a variable.
 *   NAME_COLLISION    calls, and the corpus declares the name as a VARIABLE/CONSTANT. Same
 *                     edge as EXTERNAL_BINARY plus the fact that a consumer matching by
 *                     target will find a variable it must not pick.
 *   CROSS_FILE_CALL   calls, and the corpus declares the name as a FUNCTION.
 *   CROSS_FILE_READ   uses, and the corpus declares the name at all.
 *   ENV_VAR           uses, ALL-CAPS, declared nowhere.
 *   UNRESOLVED_READ   uses, not ALL-CAPS, declared nowhere. This is the honest residue: an
 *                     undeclared variable read. It is neither a binary nor env state, and
 *                     calling it external would be a claim the measurement does not support.
 *   FILE_PATH         the target is a path. Carries no symbol to bind to BY CONSTRUCTION.
 *   POSITIONAL_PARAM  $1/$@/$#/$* — a parameter is not a command.
 */
interface Row {
  target: string
  edges: number
  types: Record<string, number>
  buckets: Record<string, number>
  category: string
  declaredAt?: string
  declaredKind?: string
  example?: { file: string; line: number; source: string }
  flags: { isExternalCommand?: number; isFunctionCall?: number; targetResolution?: number; errorRecovery?: number }
  confidences: number[]
}

const FUNC_KINDS = new Set(["function", "method"])
const rows: Row[] = []
for (const [t, es] of residueEdges) {
  const types: Record<string, number> = {}
  const buckets: Record<string, number> = {}
  let externalFlag = 0
  let functionFlag = 0
  let resFlag = 0
  let errFlag = 0
  const confidences: number[] = []
  const declared = crossFileLocal.get(t)
  const declaredIsFunction = declared ? FUNC_KINDS.has(declared.kind) : false

  for (const e of es) {
    types[e.type] = (types[e.type] ?? 0) + 1
    if (e.isExternalCommand === true) externalFlag++
    if (e.isFunctionCall === true) functionFlag++
    if (e.targetResolution) resFlag++
    if (e.commandInErrorRecovery) errFlag++
    if (typeof e.confidence === "number") confidences.push(e.confidence)

    let b: string
    if (POSITIONAL(t)) b = "POSITIONAL_PARAM"
    else if (t.includes("/") || (t.includes(".") && e.type !== "calls")) b = "FILE_PATH"
    else if (e.type === "calls" && declaredIsFunction) b = "CROSS_FILE_CALL"
    else if (e.type === "calls" && declared) b = "NAME_COLLISION"
    else if (e.type === "calls" && e.commandInErrorRecovery) b = "UNRESOLVED_READ_ERROR_RECOVERY"
    else if (e.type === "calls") b = "EXTERNAL_BINARY"
    else if (declared) b = "CROSS_FILE_READ"
    else if (isAllCaps(t)) b = "ENV_VAR"
    else b = "UNRESOLVED_READ"
    buckets[b] = (buckets[b] ?? 0) + 1
  }

  // A target is labelled by its largest bucket; the full split is carried in `buckets` and
  // summed into the totals, so a mixed target is counted in EVERY bucket it belongs to.
  const category = Object.entries(buckets).sort((a, b) => b[1] - a[1])[0][0]
  const ex = es[0]
  rows.push({
    target: t,
    edges: es.length,
    types,
    buckets,
    category,
    declaredAt: declared?.file,
    declaredKind: declared?.kind,
    example: { file: ex.file, line: ex.line, source: ex.src },
    flags: { isExternalCommand: externalFlag, isFunctionCall: functionFlag, targetResolution: resFlag, errorRecovery: errFlag },
    confidences: [...new Set(confidences)].sort((a, b) => a - b),
  })
}
rows.sort((a, b) => b.edges - a.edges || (a.target < b.target ? -1 : 1))

// ---------------------------------------------------------------- report
const byCategory = new Map<string, { targets: number; edges: number; byType: Record<string, number> }>()
for (const r of rows) {
  for (const [b, n] of Object.entries(r.buckets)) {
    let c = byCategory.get(b)
    if (!c) byCategory.set(b, (c = { targets: 0, edges: 0, byType: {} }))
    c.edges += n
    for (const [t, k] of Object.entries(r.types)) if (r.buckets[b]) c.byType[t] = (c.byType[t] ?? 0) + 0
    c.targets++
  }
}
// byType per bucket, counted from the edges themselves so a mixed target contributes only
// the edges that landed in that bucket.
{
  const perBucketType = new Map<string, Map<string, number>>()
  for (const [t, es] of residueEdges) {
    const declared = crossFileLocal.get(t)
    const declaredIsFunction = declared ? FUNC_KINDS.has(declared.kind) : false
    for (const e of es) {
      let b: string
      if (POSITIONAL(t)) b = "POSITIONAL_PARAM"
      else if (t.includes("/") || (t.includes(".") && e.type !== "calls")) b = "FILE_PATH"
      else if (e.type === "calls" && declaredIsFunction) b = "CROSS_FILE_CALL"
      else if (e.type === "calls" && declared) b = "NAME_COLLISION"
      else if (e.type === "calls" && e.commandInErrorRecovery) b = "UNRESOLVED_READ_ERROR_RECOVERY"
      else if (e.type === "calls") b = "EXTERNAL_BINARY"
      else if (declared) b = "CROSS_FILE_READ"
      else if (isAllCaps(t)) b = "ENV_VAR"
      else b = "UNRESOLVED_READ"
      let m = perBucketType.get(b)
      if (!m) perBucketType.set(b, (m = new Map()))
      m.set(e.type, (m.get(e.type) ?? 0) + 1)
    }
  }
  for (const [b, c] of byCategory) c.byType = Object.fromEntries(perBucketType.get(b) ?? [])
}

const PINNED = SAMPLE === 600 && EXT === "sh"
console.log(`BASH C ADJUDICATION   sample=${sample.length}  ext=.${EXT}  order=path`)
console.log(
  `  window   parsed ${parsed}/${sample.length} failed ${failed} degraded ${degraded} symbols ${symbols} edges ${edges.length} distinct targets ${distinctTargets.length}`,
)
console.log(
  `  digest   ${windowDigest}  ${
    !PINNED
      ? `not asserted — the pin is sample=600 ext=sh, this run is sample=${SAMPLE} ext=${EXT}`
      : windowDigest === EXPECTED_DIGEST
        ? "== abc-before-600-path.json (same population)"
        : `!= ${EXPECTED_DIGEST} MISMATCH — the analyzer changed since round 20`
  }`,
)
console.log(
  `  corpus   ${repos.length} repos / ${corpusBashFiles} tracked bash files / ${corpusScanned} scanned for definitions`,
)
console.log(
  `  corpus   discovery read ${filesRead} files (${filesUnreadable} unreadable), ${candidateFiles} candidate (name, file) pairs`,
)
console.log(
  `  census   ${candidatesParsed} candidate files parsed (${candidatesFailed} failed), ${crossFileLocal.size} residue names PUBLISHED by one of them`,
)
for (const f of candidateFailures) console.log(`    CANDIDATE PARSE FAILED ${f}`)
console.log(`  residue  ${unresolved.length} distinct targets / ${edges.filter((e) => !published.has(e.t)).length} edges`)
console.log()
console.log(`C BUCKET, ADJUDICATED  (per EDGE; a target may appear in more than one bucket)`)
console.log(`  ${"bucket".padEnd(32)} ${"targets".padStart(8)} ${"edges".padStart(7)}  by type`)
for (const [k, v] of [...byCategory.entries()].sort((a, b) => b[1].edges - a[1].edges)) {
  console.log(
    `  ${k.padEnd(32)} ${String(v.targets).padStart(8)} ${String(v.edges).padStart(7)}  ${JSON.stringify(v.byType)}`,
  )
}
console.log()
for (const r of rows.slice(0, 45)) {
  console.log(
    `  ${String(r.edges).padStart(4)}  ${JSON.stringify(r.buckets).padEnd(40)} ${r.target}${r.declaredAt ? `   [${r.declaredKind} in ${path.basename(r.declaredAt)}]` : ""}`,
  )
  console.log(
    `        ${JSON.stringify(r.types)}  extFlag ${r.flags.isExternalCommand ?? 0}/${r.edges}  conf=${r.confidences.join(",")}  eg ${path.basename(r.example!.file)}:${r.example!.line}`,
  )
}

// ---------------------------------------------------------------- marker census
let markerCensus: any = null
//
// Cause C asks for "targets now marked external". This is the measured state of every
// marker the analyzer publishes on an edge that does not resolve in the window, so the
// before/after is a number rather than an assertion.
{
  let marked = 0
  let unmarked = 0
  const perBucket = new Map<string, { marked: number; unmarked: number; kinds: Record<string, number> }>()
  for (const [t, es] of residueEdges) {
    const declared = crossFileLocal.get(t)
    const declaredIsFunction = declared ? FUNC_KINDS.has(declared.kind) : false
    for (const e of es) {
      let b: string
      if (POSITIONAL(t)) b = "POSITIONAL_PARAM"
      else if (t.includes("/") || (t.includes(".") && e.type !== "calls")) b = "FILE_PATH"
      else if (e.type === "calls" && declaredIsFunction) b = "CROSS_FILE_CALL"
      else if (e.type === "calls" && declared) b = "NAME_COLLISION"
      else if (e.type === "calls" && e.commandInErrorRecovery) b = "UNRESOLVED_READ_ERROR_RECOVERY"
      else if (e.type === "calls") b = "EXTERNAL_BINARY"
      else if (declared) b = "CROSS_FILE_READ"
      else if (isAllCaps(t)) b = "ENV_VAR"
      else b = "UNRESOLVED_READ"
      // A marker is any of the facts the analyzer publishes that a consumer can act on.
      // A marker is any published fact that tells a consumer what KIND of thing the
      // target is, or what this file does to bind it. The first version of this census
      // counted only three of them and reported 96 FILE_PATH edges as unmarked, when the
      // emitter has published `isSourceImport` / `isSourceDependency` / `resolution` on
      // every one of them since the `source`/`.` handler was written. "Unmarked" must
      // mean "the row says nothing", not "the row says something this list forgot".
      const isMarked =
        e.isExternalCommand === true ||
        typeof e.variableDeclaredInFile === "boolean" ||
        e.targetResolution !== undefined ||
        e.isSourceImport === true ||
        e.isSourceDependency === true ||
        e.resolution !== undefined
      if (isMarked) marked++
      else unmarked++
      let m = perBucket.get(b)
      if (!m) perBucket.set(b, (m = { marked: 0, unmarked: 0, kinds: {} }))
      if (isMarked) m.marked++
      else m.unmarked++
      m.kinds[e.variableDeclaredInFile === undefined ? "no-variableFlag" : `variableFlag=${e.variableDeclaredInFile}`] =
        (m.kinds[e.variableDeclaredInFile === undefined ? "no-variableFlag" : `variableFlag=${e.variableDeclaredInFile}`] ?? 0) + 1
    }
  }
  console.log(`MARKER CENSUS over the ${unresolved.length} unresolved targets / ${marked + unmarked} edges`)
  console.log(`  edges carrying at least one published marker  ${marked}`)
  console.log(`  edges carrying none                         ${unmarked}`)
  console.log(`  ${"bucket".padEnd(32)} ${"marked".padStart(7)} ${"none".padStart(7)}  variableDeclaredInFile`)
  for (const [b, m] of [...perBucket.entries()].sort((a, c) => c[1].marked + c[1].unmarked - (a[1].marked + a[1].unmarked)))
    console.log(`  ${b.padEnd(32)} ${String(m.marked).padStart(7)} ${String(m.unmarked).padStart(7)}  ${JSON.stringify(m.kinds)}`)
  markerCensus = { marked, unmarked, perBucket: Object.fromEntries([...perBucket.entries()].map(([k, v]) => [k, v])) }
  console.log()
}

const jf = flag("json")
if (jf) {
  writeFileSync(
    jf as string,
    JSON.stringify(
      {
        population: {
          corpusRoot: CR, ext: EXT, sample: sample.length, repos: repos.length,
          trackedBashFiles: corpusBashFiles, corpusScanned, candidateFiles,
          candidatesParsed, candidatesFailed, parsed, failed, degraded, symbols,
          filesRead, filesUnreadable,
          relationshipEdges: edges.length, distinctTargets: distinctTargets.length,
          analyzerDigest: windowDigest, expectedDigest: EXPECTED_DIGEST,
        },
        residue: {
          distinctTargets: unresolved.length,
          edges: edges.filter((e) => !published.has(e.t)).length,
          byCategory: Object.fromEntries([...byCategory.entries()].map(([k, v]) => [k, v])),
        },
        rows,
        markers: markerCensus,
      },
      null,
      2,
    ),
  )
  console.log(`\nwrote ${jf as string}`)
}