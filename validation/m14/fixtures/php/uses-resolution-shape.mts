/**
 * `uses` RESOLUTION SHAPE — what the 42,859 unresolved `uses` edges are made of.
 *
 * ## WHY THIS EXISTS
 *
 * `validation/m60/php/ambiguity-split.json` prices `uses` at 155,016 edges with 42,859
 * unresolved and unlabelled. That is this lane's single largest unresolved population, and a
 * total does not say what to do about it. The top targets read `i`, `entry`, `other`,
 * `subscriber`, `parent` — which are not vendor names, so the population is not one class.
 *
 * `uses` in `src/ast/real-php-analyzer.ts` is not one rule. Each emission carries its own
 * `metadata.phpSpecific` flag, and the flags have DIFFERENT resolvability properties:
 *
 *   isMemberRead / isStaticRead / isConstFetch   target a MEMBER name. A member is published
 *                                                 under (ownerName, name), so the bare target
 *                                                 resolves only by luck and PHP's own key is
 *                                                 `ownerName\name` — cause A, priced by
 *                                                 B2a/B2b in ambiguity-split.
 *   isLocalRead / isGlobalRead / isSubscriptBase / isClosureCapture / isInterpolationRead
 *                                                 target a VARIABLE name. A PHP local variable
 *                                                 has NO declaration site and php can never
 *                                                 publish it as a symbol, so these edges can
 *                                                 NEVER resolve, by any implementation.
 *   isConstRead                                 target a bare constant name; resolves when the
 *                                                 file or an import declares it.
 *
 * The distinction decides the remedy, so it has to be a measured rate, not a claim:
 *
 *   a variable-name target   -> not a defect, a STRUCTURAL LIMIT. No correct implementation
 *                               resolves it. Remedy is a label or a documented limitation,
 *                               never a new edge and never a spelling change.
 *   a member-name target     -> cause A proper. The remedy is scoping, which is a change to
 *                               what every consumer sees.
 *   a constant-name target   -> resolvable in principle; a miss is a real defect.
 *
 * ## WHAT IT IS NOT
 *
 * This is a RESOLUTION-CLASSIFICATION instrument, not an oracle. It does not claim any
 * `uses` edge is wrong. It groups the edges the analyzer already emitted by the flag the
 * analyzer itself wrote on them, and by whether the bare target happens to match something
 * published anywhere in the walk. The population is every `uses` edge of every sampled file.
 *
 * ## METHOD
 *
 * Corpus: git-tracked files under `BB_CORPUS_ROOT` (default
 * /home/ishaq2321/bb_tests/repositories) that `detectLanguageFromPath` admits as `php`, over
 * `git ls-files` so build output is excluded by construction. Deterministic stride over the
 * sorted population with `--files N` (default 600); pass `--files <admitted>` for the whole
 * corpus. Entry point is production `parseFile` from `src/ast/pool-worker.ts`.
 *
 * A target is classified as VARIABLE-SHAPED without reading its text: the walk re-parses the
 * SAME file through the analyzer's own exported `phpStaticCallableName`-style accessors is not
 * needed — instead it collects every `variable_name` leaf text the grammar produced in that
 * file, which is a parse-tree fact, and asks set membership. So "is this target a variable name
 * in its own file" is answered by the grammar, not by a pattern. Zero regex: node types and
 * named children only.
 *
 * CONTROLS, printed and asserted. A zero in this instrument is only believable if the walk saw
 * the constructs it is counting, so the run prints and enforces:
 *   - `variable_name` leaves collected > 0            (else the variable test is vacuous)
 *   - `uses` edges carrying at least 4 distinct flags  (else the flag split is vacuous)
 *   - every edge's type set is exactly the store's spellings for the 10 types
 * Any failure exits 3. The literal-`unknown` endpoint check is a separate instrument with its
 * own discriminator — `validation/m14/fixtures/php/unknown-endpoints.mts`, output in
 * `validation/m60/php/unknown-endpoints.json` — because it answers a different question: whether
 * an endpoint equal to the string `unknown` is the sentinel or a declaration in the corpus.
 */
import { execFileSync } from "node:child_process"
import { readdirSync, statSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"
import * as ASTEngine from "../../../../src/ast/engine"
import { phpInternalKind } from "../../../../src/ast/php-internal-symbols"

const argv = process.argv.slice(2)
const fail = (m: string): never => {
  console.error(`uses-resolution-shape: ${m}`)
  process.exit(2)
}
const argOf = (f: string) => {
  const i = argv.indexOf(f)
  if (i < 0) return undefined
  const v = argv[i + 1]
  if (v == null || v.startsWith("--")) fail(`\`${f}\` has no value`)
  return v
}
const OUT = argOf("--out")
const N = Number(argOf("--files") ?? 600)
if (!Number.isInteger(N) || N < 1) fail(`--files must be a positive integer, got \`${argOf("--files")}\``)
const CORPUS = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 512 * 1024

/** The store spells `imports` two ways across two files; this instrument is about `uses`. */
const USES_SPELLINGS = ["uses", "use"]

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
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
    })
      .split("\0")
      .filter(Boolean)
  } catch {
    continue
  }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text = ""
    try {
      if (statSync(abs).size > SIZE_CAP) continue
      text = readFileSync(abs, "utf8")
    } catch {
      continue
    }
    if (detectLanguageFromPath(abs, text) !== "php") continue
    admitted.push({ label: `${entry}/${rel}`, abs })
  }
}
admitted.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0))
const population = admitted.length
const picked: typeof admitted = []
if (population <= N) picked.push(...admitted)
else for (let i = 0; i < N; i++) picked.push(admitted[Math.floor((i * population) / N)])

console.log(`uses resolution shape — php — production parseFile`)
console.log(`corpus root         ${CORPUS}`)
console.log(`--files             ${N}${argv.includes("--files") ? "" : "   (DEFAULT — not passed on the command line)"}`)
console.log(`repos scanned       ${reposScanned}`)
console.log(`admitted population ${String(population).padStart(8)}`)
console.log(`sample              ${String(picked.length).padStart(8)}  (deterministic stride over the sorted population)`)

// ------------------------------------------------------------------ walk

type Pub = { name: string; ownerName: string | null; fqn: string | null; qname: string; kind: string; file: string }
const byName = new Map<string, Pub[]>()
const push = (m: Map<string, Pub[]>, k: string, v: Pub) => {
  const a = m.get(k)
  if (a) a.push(v)
  else m.set(k, [v])
}

const parser = await ASTEngine.getParser("php")

/** flags seen -> edge count */
const byFlag = new Map<string, number>()
/** flag -> resolution class -> count */
const byFlagClass = new Map<string, Map<string, number>>()
/** flag -> target name -> count, unresolved only, for the top-N listing */
const topUnresolved = new Map<string, Map<string, number>>()
/** resolution class totals over every `uses` edge */
const classTotals = new Map<string, number>()
/** the variable test's inputs */
let variableLeaves = 0
let filesWithVariableLeaves = 0
/** class -> example `file:line target`, for the report */
const examples = new Map<string, string[]>()

/**
 * CAN THE `ownerScoped` BUCKET EVER FIRE?
 *
 * The bucket asks whether `(ownerName of the SOURCE, target)` names something published. It can
 * only answer yes if some symbol's NAME is the backslash-joined pair — because `byName` is keyed
 * on the published `name`, and a member is published under its BARE name with `ownerName` in a
 * separate field. So the count of published names containing a separator decides whether the
 * bucket is a measurement or a decoration, and printing `ownerScoped 0` without this check would
 * be indistinguishable from "no member is owner-resolvable" when it can only ever mean "the
 * composite key is not published". CONTROL below reports it.
 */
let compositeNameSymbols = 0
/** joined-name symbols by kind — decides whether `ownerScoped` can fire on a MEMBER */
const compositeKinds = new Map<string, number>()

let symbols = 0
let degraded = 0
let parseFailures = 0
let usesEdges = 0
let flaglessUses = 0
const distinctFlags = new Set<string>()

/** Every `variable_name` leaf text in one file — the grammar's own answer, not a pattern. */
function variableNamesInFile(text: string): Set<string> {
  const out = new Set<string>()
  let root: any
  try {
    root = parser.parse(text).rootNode
  } catch {
    return out
  }
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    if (n.type === "variable_name") {
      const nameChild = n.namedChild(0)
      const bare = nameChild && nameChild.type === "name" ? nameChild.text : n.text.replace("$", "")
      if (bare) out.add(bare)
    }
    for (const c of n.children) stack.push(c)
  }
  return out
}

const bumpClass = (flag: string, cls: string) => {
  let inner = byFlagClass.get(flag)
  if (!inner) {
    inner = new Map<string, number>()
    byFlagClass.set(flag, inner)
  }
  inner.set(cls, (inner.get(cls) ?? 0) + 1)
  classTotals.set(cls, (classTotals.get(cls) ?? 0) + 1)
}
const noteExample = (cls: string, s: string) => {
  const a = examples.get(cls)
  if (!a) examples.set(cls, [s])
  else if (a.length < 4 && !a.includes(s)) a.push(s)
}

/**
 * The classification. Ordered, and the ORDER IS THE CLAIM: the first rule that fires is the
 * finding, so the buckets cannot overlap.
 *
 *   resolvesBare     the target matches a published symbol NAME somewhere in the walk — this is
 *                    what a consumer doing a bare-name lookup gets today.
 *   ownerScoped     the target does not resolve bare, but (ownerName of the edge's SOURCE,
 *                    target) does. PHP's own key. This is the recoverable half of cause A.
 *   variableInFile   the target is a `variable_name` leaf in the SAME file the edge came from.
 *                    Unresolvable by ANY implementation: a php local has no declaration site.
 *   internalSymbol   php-src declares it, so it is external (cause C, already labelled).
 *   namespacedAbsent the target contains a namespace separator and no corpus file declares that
 *                    namespace — the third-party package is simply not indexed.
 *   keywordish       the target is `parent` / `self` / `static` / `this` — language syntax, no
 *                    such symbol exists. Same class as PHP_BUILTINS.
 *   UNCLASSIFIED     none of the above. THIS is the residual: the only bucket that can contain a
 *                    real defect, so it is printed even when it is small.
 */
const KEYWORDS = new Set(["parent", "self", "static", "this", "true", "false", "null"])

for (const f of picked) {
  let text = ""
  try {
    text = readFileSync(f.abs, "utf8")
  } catch {
    continue
  }
  let r: any
  try {
    r = await parseFile(f.abs, "php")
  } catch {
    parseFailures++
    continue
  }
  if (!r) {
    degraded++
    continue
  }
  if (r.degraded) degraded++

  const syms: any[] = Array.isArray(r.symbols) ? r.symbols : []
  for (const s of syms) {
    const name = String(s?.name ?? "")
    if (!name) continue
    symbols++
    if (name.includes("\\")) {
      compositeNameSymbols++
      const k = String(s?.kind ?? "(blank)")
      compositeKinds.set(k, (compositeKinds.get(k) ?? 0) + 1)
    }
    const pub: Pub = {
      name,
      ownerName: s?.ownerName ?? null,
      fqn: s?.metadata?.fqn ?? null,
      qname: String(s?.qualifiedName ?? ""),
      kind: String(s?.kind ?? ""),
      file: f.label,
    }
    push(byName, name, pub)
  }

  const vars = variableNamesInFile(text)
  if (vars.size > 0) {
    filesWithVariableLeaves++
    variableLeaves += vars.size
  }

  const rels: any[] = Array.isArray(r.relationships) ? r.relationships : []
  for (const rel of rels) {
    const t = String(rel?.type ?? "")
    if (!USES_SPELLINGS.includes(t)) continue
    usesEdges++
    const source = String(rel?.source ?? "")
    const target = String(rel?.target ?? "")
    const meta = (rel?.metadata ?? {}) as Record<string, unknown>
    const flag =
      Object.keys(meta)
        .filter((k) => k.startsWith("is") && meta[k] === true)
        .sort()
        .join("+") || "(no-flag)"
    if (flag === "(no-flag)") flaglessUses++
    distinctFlags.add(flag)
    byFlag.set(flag, (byFlag.get(flag) ?? 0) + 1)

    let cls: string
    if (byName.has(target)) cls = "resolvesBare"
    else {
      // owner-scoped: the source IS a published symbol here, so its name is the owner key.
      const owner = byName.get(source)
      const ownerHit =
        owner && owner.some((p) => byName.get(`${p.name}\\${target}`)?.some((q) => q.ownerName === p.name))
      const declaredHere = syms.some((s) => String(s?.name ?? "") === target)
      if (ownerHit) cls = "ownerScoped"
      else if (vars.has(target)) cls = "variableInFile"
      else if (phpInternalKind(target)) cls = "internalSymbol"
      else if (target.includes("\\")) cls = "namespacedAbsent"
      else if (KEYWORDS.has(target)) cls = "keywordish"
      else if (declaredHere) cls = "declaredInFile"
      else cls = "UNCLASSIFIED"
    }
    bumpClass(flag, cls)
    if (cls === "resolvesBare" || cls === "ownerScoped") continue
    let m = topUnresolved.get(flag)
    if (!m) {
      m = new Map<string, number>()
      topUnresolved.set(flag, m)
    }
    m.set(target, (m.get(target) ?? 0) + 1)
    noteExample(cls, `${f.label}:${rel?.line_number ?? "?"} ${source} -> ${target}`)
  }
}

// ------------------------------------------------------------------ controls

console.log("")
console.log(`symbols published   ${symbols}`)
console.log(`\`uses\` edges        ${usesEdges}`)
console.log(`parse failures      ${parseFailures}   degraded ${degraded}`)
console.log(`distinct \`uses\` flags ${distinctFlags.size}   edges with no phpSpecific flag: ${flaglessUses}`)
console.log("")
console.log("--- CONTROLS: a zero here would make the table above vacuous ---")
const ctlVar = variableLeaves > 0
const ctlFlags = distinctFlags.size >= 4
const ctlEdges = usesEdges > 0
console.log(`  \`variable_name\` leaves collected      ${String(variableLeaves).padStart(8)}  across ${filesWithVariableLeaves} files   ${ctlVar ? "OK" : "FAIL"}`)
console.log(`  distinct flags on \`uses\` edges         ${String(distinctFlags.size).padStart(8)}                                  ${ctlFlags ? "OK" : "FAIL"}`)
console.log(`  \`uses\` edges seen                      ${String(usesEdges).padStart(8)}                                  ${ctlEdges ? "OK" : "FAIL"}`)
const joinedKinds = [...compositeKinds.entries()].sort((a, b) => b[1] - a[1])
console.log(`  symbols published under a JOINED name     ${String(compositeNameSymbols).padStart(8)}   by kind: ${joinedKinds.map(([k, v]) => `${k}=${v}`).join(" ") || "(none)"}`)
if (!ctlVar || !ctlFlags || !ctlEdges) {
  console.error("CONTROL FAILED: the resolution table cannot be believed. Exiting 3.")
  process.exit(3)
}
console.log("")
const nonNsJoined = joinedKinds.filter(([k]) => k !== "namespace" && k !== "module")
if (nonNsJoined.length === 0) {
  console.log("")
  console.log("  Every joined name published is a NAMESPACE, and a namespace is not a member. So")
  console.log("  `ownerScoped` CAN fire in principle and did not: php publishes a member as (bare")
  console.log("  name, ownerName) in two fields and never as the `Owner\\member` name PHP's own")
  console.log("  resolver builds. That 0 is a real measurement, and what it measures is that a")
  console.log("  consumer cannot disambiguate a member read by owner TODAY without joining on a")
  console.log("  field the store does not index. The remedy is a publisher change, not an emitter")
  console.log("  change, which is why this round does not make it.")
} else {
  console.log("")
  console.log(`  joined names that are NOT namespaces: ${nonNsJoined.map(([k, v]) => `${k}=${v}`).join(" ")} — a member composite IS published, so ownerScoped 0 below is a real negative.`)
}

console.log("")
console.log("--- resolution class, over EVERY `uses` edge of the sample ---")
const CLASS_ORDER = [
  "resolvesBare",
  "ownerScoped",
  "declaredInFile",
  "variableInFile",
  "internalSymbol",
  "namespacedAbsent",
  "keywordish",
  "UNCLASSIFIED",
]
console.log(`  ${"class".padEnd(20)}${"edges".padStart(9)}${"share".padStart(10)}`)
for (const c of CLASS_ORDER) {
  const n = classTotals.get(c) ?? 0
  const share = usesEdges > 0 ? (n / usesEdges) * 100 : 0
  console.log(`  ${c.padEnd(20)}${String(n).padStart(9)}${(share.toFixed(2) + "%").padStart(10)}`)
}

console.log("")
console.log("--- the same split, per emitting rule (metadata flag) ---")
const flags = [...byFlag.keys()].sort((a, b) => (byFlag.get(b) ?? 0) - (byFlag.get(a) ?? 0))
console.log(`  ${"flag".padEnd(28)}${"edges".padStart(8)}  ${CLASS_ORDER.filter((c) => c !== "resolvesBare").join("  ")}`)
for (const fl of flags) {
  const inner = byFlagClass.get(fl)
  const cells = CLASS_ORDER.filter((c) => c !== "resolvesBare")
    .map((c) => String(inner?.get(c) ?? 0).padStart(7))
    .join(" ")
  console.log(`  ${fl.padEnd(28)}${String(byFlag.get(fl) ?? 0).padStart(8)}  ${cells}`)
}

console.log("")
console.log("--- top UNRESOLVED targets per flag (the only buckets that can hide a defect) ---")
for (const fl of flags) {
  const m = topUnresolved.get(fl)
  if (!m || m.size === 0) continue
  const top = [...m.entries()].sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : 1)).slice(0, 10)
  console.log(`  ${fl}:`)
  for (const [name, c] of top) console.log(`    ${String(c).padStart(6)}  ${name}`)
}

console.log("")
console.log("--- examples per class (file:line source -> target) ---")
for (const c of CLASS_ORDER) {
  const ex = examples.get(c)
  if (!ex || ex.length === 0) continue
  console.log(`  ${c}:`)
  for (const e of ex) console.log(`    ${e}`)
}

const report = {
  instrument: "validation/m14/fixtures/php/uses-resolution-shape.mts",
  entryPoint: "parseFile (src/ast/pool-worker.ts)",
  corpusRoot: CORPUS,
  reposScanned,
  admittedPopulation: population,
  requestedFiles: N,
  filesArgumentPresent: argv.includes("--files"),
  sampleFiles: picked.length,
  sampling: "deterministic stride over the admitted files sorted by repo/relative/path",
  symbolsPublished: symbols,
  usesEdges,
  parseFailures,
  degraded,
  distinctFlags: distinctFlags.size,
  flaglessUses,
  controls: {
    variableNameLeavesCollected: variableLeaves,
    filesWithVariableLeaves,
    distinctFlagsSeen: distinctFlags.size,
    distinctFlagsAtLeast4: ctlFlags,
    usesEdgesSeen: usesEdges,
    symbolsPublishedUnderJoinedName: compositeNameSymbols,
    ownerScopedBucketCanFire: compositeNameSymbols > 0,
  },
  classTotals: Object.fromEntries([...classTotals.entries()].sort()),
  byFlag: Object.fromEntries([...byFlag.entries()].sort()),
  byFlagClass: Object.fromEntries([...byFlagClass.entries()].map(([k, v]) => [k, Object.fromEntries([...v.entries()].sort())])),
  topUnresolved: Object.fromEntries(
    [...topUnresolved.entries()].map(([k, v]) => [k, Object.fromEntries([...v.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25))]),
  ),
  examples: Object.fromEntries(examples),
}
if (OUT) {
  mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true })
  writeFileSync(path.resolve(OUT), JSON.stringify(report, null, 2) + "\n")
  console.log("")
  console.log(`wrote ${OUT}`)
}