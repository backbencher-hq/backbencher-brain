/**
 * dart-extfail-86-rows — the 86 refuted external claims of the PRE-FIX production `--index` arm,
 * NAMED ONE BY ONE, with the arbiter's own verdict on each.
 *
 * ## WHY THIS INSTRUMENT EXISTS
 *
 * The dart production `--index` arm read **extFAIL 86** — the only clause-4 red this lane ever
 * had, and the acceptance test says the number must be 0. The gate prints the refuted claims
 * under the header "EXTERNAL CLAIMS THE POPULATION REFUTES", and the pre-fix arm's own log carries
 * that list — **25 names**. But the gate's name lists are capped at `NAME_CAP = 25`
 * (`script/m14/incoming-rule.ts:2212`), so **25 IS THE CAP, not the number of distinct names**:
 * the 86 rows have MORE distinct targets than the arm printed, and the arm's list is a SAMPLE of
 * them. (The report's own header calls that list "PRINTED WHOLE AND UNCAPTIONED BY ANYTHING ELSE"
 * — it is not, and the omitted count is collected but never printed. That is a Lead-owned
 * instrument finding, reported here with its evidence and NOT fixed by this lane.)
 *
 * A count and 25 names are not "what each of the 86 was". This instrument gets the ROW: the file,
 * the line, the class that published it, the base it named, and the base that actually declares
 * the member.
 *
 * ## HOW IT REPRODUCES THE PRE-FIX STATE WITHOUT RE-RUNNING THE PRE-FIX ARM
 *
 * The rows are the analyzer's **first-parent override fallback**: a class applies a mixin
 * (`class X extends Object with A, B`) and the member it overrides is declared by one of the
 * mixins, so the analyzer — unable to see any mixin — names the FIRST heritage parent instead,
 * publishes the claim "this base is outside the project", and the ARBITER REFUTES it because the
 * project DOES publish that parent.
 *
 * The blind spot was the INDEX SPEC, not the analyzer: `DART_DECLARATION_SPEC` had no
 * `nameResolver`, and Dart's `mixin_declaration` has no `name` field (the name is a direct
 * `identifier` child), so the pre-fix index **named no mixin at all** — measured on dart-http:
 * `typeKinds` census `class 524 · extension_type 278 · extension 183 · enum 16 · unknown 11`,
 * **mixin 0**.
 *
 * So the pre-fix index IS the fixed index with every mixin-typed entry removed — the fixed spec's
 * `nameResolver` changes NOTHING about the other declarations ("the other Dart declarations DO
 * have a `name` field, so the resolver returns it for them and changes nothing about them"). This
 * instrument therefore builds the index ONCE, with the committed (fixed) spec, and derives the
 * pre-fix view from it. **THE DERIVATION IS CHECKED, NOT ASSUMED:** the instrument prints the
 * `typeKinds` census of BOTH views, and the pre-fix census must show **mixin 0** — the measured
 * pre-fix state — while the fixed census shows the mixins.
 *
 * ## THE CANDIDATE SET IS A SUPERSET, AND THE ARGUMENT IS STATED
 *
 * A refuted row is published only where the analyzer's fallback fired, and the fallback fires only
 * for a member that carries the `@override` annotation, in a class that HAS a heritage clause
 * (`real-dart-analyzer.ts:2185` — `hasOverrideAnn` — and `:2215-2217` — the base choice). So every
 * file that can publish a refuted row contains the text `@override`. This instrument therefore
 * analyses **every admitted file containing `@override`**, which is a superset of the publishing
 * files, and it says how many files that is.
 *
 * ## THE ARBITER IS ASKED
 *
 * Every collected row is put to the ARBITER'S OWN `verifyExternalClaim` (imported from
 * `script/m14/incoming-rule.ts`, with the project's declaration counts as its key space). A row the
 * arbiter reads `externalRefuted` is one of the lane's extFAIL rows. The instrument does not
 * predict the arbiter's verdict from the key space (R4) — it asks.
 *
 * ## THE CONTROLS (a probe that cannot fail is not a probe)
 *
 * 1. **THE PRE-FIX CENSUS.** The derived view's `typeKinds` census must show `mixin 0`.
 * 2. **THE PUBLISHED FIVE.** The dart-http reproduction the lane already published names five
 *    rows with their files and lines. This instrument must find exactly those five, at those lines.
 * 3. **THE COUNT.** The number of refuted rows must be **86** — the number the pre-fix arm
 *    measured independently. A different number is a FAILURE of this instrument, printed as one.
 * 4. **THE ARM'S PRINTED LIST.** Every one of the 25 names the pre-fix arm printed must be covered.
 *
 * ## WHAT IT EMITS
 *
 * Nothing into the analyzer; it changes no count of any other tool.
 */
import * as path from "node:path"
import { readFileSync, statSync, readdirSync, writeFileSync, mkdirSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { parseFile } from "../../src/ast/pool-worker"
import { buildProjectIndexStreaming, deserializeProjectIndex, DART_DECLARATION_SPEC, serializeProjectIndex } from "../../src/ast/project-index"
import { resolveWasmAsset } from "../../src/util/wasm"
import { verifyExternalClaim, NAME_CAP } from "./incoming-rule"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const SIZE_CAP = 1024 * 1024

/** THE 25 TARGETS THE PRE-FIX ARM PRINTED — a SUBSET (the gate's `NAME_CAP` is 25, so the list it
 *  printed is capped), and the instrument's floor: every one of them must be covered. */
const ARM_PRINTED = [
  "TerminatableMixin.onCheckForClose",
  "TerminatableMixin.onClosing",
  "ListMixin.length",
  "ListMixin.operator []",
  "ListMixin.add",
  "TypeAnalyzer.expressionEndOffset",
  "TypeAnalyzer.finishNullShorting",
  "TypeAnalyzer.handleNullShortingStep",
  "ClientCapabilitiesHelperMixin.pathContext",
  "ClientCapabilitiesHelperMixin.serverToClient",
  "ClientCapabilitiesHelperMixin.closeFile",
  "ClientCapabilitiesHelperMixin.expectSuccessfulResponseTo",
  "ClientCapabilitiesHelperMixin.getCurrentFileContent",
  "ClientCapabilitiesHelperMixin.openFile",
  "ClientCapabilitiesHelperMixin.replaceFile",
  "ClientCapabilitiesHelperMixin.sendNotificationToServer",
  "ClientCapabilitiesHelperMixin.sendRequestToServer",
  "ClientCapabilitiesHelperMixin.sendResponseToServer",
  "HandlerHelperMixin.execute",
  "ResourceProviderMixin.analyticsManager",
  "ResourceProviderMixin.dartSdkPath",
  "ResourceProviderMixin.editorClientCapabilities",
  "ResourceProviderMixin.packagesRootPath",
  "ResourceProviderMixin.uriConverter",
  "ResourceProviderMixin.expectSuccessfulResponseTo",
]

/** THE PUBLISHED FIVE (dart-http, the whole reproduction, `DART-DEPTH-D7.md` §3.1). CONTROL 2. */
const KNOWN_FIVE = [
  "pkgs/http2/lib/src/flowcontrol/connection_queues.dart:73",
  "pkgs/http2/lib/src/flowcontrol/connection_queues.dart:230",
  "pkgs/http2/lib/src/flowcontrol/stream_queues.dart:96",
  "pkgs/http2/lib/src/streams/stream_handler.dart:932",
  "pkgs/http2/lib/src/streams/stream_handler.dart:937",
]

// ── THE POPULATION — the gate's own discovery rules, so this is the ARM's population. ─────────
type Repo = { name: string; dir: string; files: string[] }
function discover(): Repo[] {
  const repos: Repo[] = []
  for (const name of readdirSync(CR).sort()) {
    const dir = path.join(CR, name)
    try {
      if (!statSync(dir).isDirectory()) continue
    } catch { continue }
    try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
    } catch { continue }
    const files: string[] = []
    for (const rel of tracked) {
      if (!rel.endsWith(".dart")) continue
      const abs = path.join(dir, rel)
      try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
      files.push(abs)
    }
    if (files.length) repos.push({ name, dir, files })
  }
  return repos
}

/** THE PRE-FIX VIEW OF A BUILT INDEX: the same index with every MIXIN-typed entry removed.
 *  The pre-fix spec's `nameResolver` returned "" for a `mixin_declaration`, so the pre-fix index
 *  NAMED NO MIXIN — and a view in which the mixin types are absent IS that index. */
function preFixView(index: any): { view: any; removed: string[] } {
  const typeKinds = new Map(index.typeKinds)
  const typeMembers = new Map(index.typeMembers)
  const typeBases = new Map(index.typeBases)
  const removed: string[] = []
  // THE PRE-FIX SPEC NAMED NEITHER A MIXIN NOR AN ALIAS, so the derived pre-fix view must remove
  // BOTH: a view that keeps the typedefs is not the state the pre-fix arm measured, and it would
  // under-count the refuted rows (the alias rows were refuted in that state too, because the index
  // held nothing for the alias).
  for (const [name, kind] of [...typeKinds]) {
    if (String(kind) === "mixin" || String(kind) === "typedef") {
      typeKinds.delete(name); typeMembers.delete(name); typeBases.delete(name); removed.push(String(name))
    }
  }
  const view: any = { ...index, typeKinds, typeMembers, typeBases }
  delete view.__closedMembers
  return { view, removed }
}

function census(index: any): string {
  const c = new Map<string, number>()
  for (const k of index.typeKinds.keys()) {
    const kind = String(index.typeKinds.get(k))
    c.set(kind, (c.get(kind) ?? 0) + 1)
  }
  return [...c.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(" · ")
}

/** THE INDEX FOR A REPOSITORY — the gate's own cache when it holds exactly this file set, and the
 *  gate's own builder otherwise. The cache key is the file set plus the newest mtime, and it does
 *  NOT include the spec — so a cache is only reused when the file set is the same, and the
 *  instrument says which path it took, because an index built with a DIFFERENT spec would be a
 *  silent wrong measurement. */
async function indexForRepo(repo: Repo, wasm: string): Promise<any> {
  const cacheDir = process.env.BB_INDEX_CACHE ?? "/tmp/bb-project-index"
  const cachePath = path.join(cacheDir, `dart-${repo.name}.json`)
  let newest = 0
  for (const f of repo.files) { try { newest = Math.max(newest, statSync(f).mtimeMs) } catch { /* counted by the gate */ } }
  try {
    const raw = JSON.parse(readFileSync(cachePath, "utf8"))
    if (raw?.files === repo.files.length && raw?.newest === newest) {
      const back = deserializeProjectIndex(raw.index)
      if (back !== null) {
        back.complete = true
        console.log(`  index: REUSED the gate's cache (${cachePath}) — the same file set and the same newest mtime`)
        return back
      }
    }
  } catch { /* no usable cache: build below */ }
  console.log(`  index: BUILT (${repo.files.length} files) — no usable cache at ${cachePath}`)
  const built = await buildProjectIndexStreaming(wasm, repo.files, DART_DECLARATION_SPEC)
  // WRITE THE CACHE THE GATE CAN REUSE, in the gate's own format (`files`, `newest`, the
  // SERIALIZED index). The gate's cache key is the file set plus the newest mtime and NOT the
  // spec — so a cache built with a different spec is reused SILENTLY. The lane's rule is
  // therefore: a cache is FRESH (a new directory) and DECLARED, and the lane's own instrument
  // prints which path it took, because a stale index is a wrong measurement that looks right.
  try {
    mkdirSync(cacheDir, { recursive: true })
    writeFileSync(cachePath, JSON.stringify({ files: repo.files.length, newest, index: serializeProjectIndex(built) }))
    console.log(`  index: CACHED (${cachePath}) — written in the gate's format, for the arm that follows`)
  } catch { /* a cache that cannot be written is not a failed measurement */ }
  return built
}

const repos = discover()
const repoFilter = process.argv.find((a) => a.startsWith("--repo="))?.slice("--repo=".length)
const selected = repoFilter ? repos.filter((r) => repoFilter.split(",").includes(r.name)) : repos
console.log(`population: ${selected.reduce((a, r) => a + r.files.length, 0)} admitted .dart files across ${selected.length} repos${repoFilter ? ` (--repo=${repoFilter})` : ""}`)

const wasm = resolveWasmAsset("tree-sitter-dart.wasm")

type Row = {
  repo: string; file: string; line: number; source: string; target: string; confidence: number
  owner: string; member: string; verdict: string; isObjectInterfaceBase: boolean
  declaringTypes: string[]
}
const rows: Row[] = []
/** THE PROJECT'S DECLARATION COUNTS — the arbiter's key space, built from the ANALYZER'S OWN
 *  symbols exactly as the gate builds it (`incoming-gate.ts:1478-1493`). **PER PROJECT**, because
 *  the gate's resolution scope is per project ("the file's OWN PROJECT — production's scope"), and
 *  the arbiter's refutation is a statement about THIS project: a row in one repository is not
 *  refuted by a same-named declaration in another one. A single global map would have made the
 *  instrument refute rows the gate never refutes. */
/** WHICH INDEX VIEW THE ANALYSIS USES — `pre` (the derived pre-fix view: the state the
 *  pre-fix arm measured, and the state the 86 were named in) or `fixed` (the index as committed:
 *  the state the FIXED arm measured, and the state the rows that SURVIVE the fix are named in). */
/** THE COUNT THE COMMITTED SPEC MUST PRODUCE — and the number the arm measured BEFORE the alias
 *  fix, kept because the difference between the two IS the measurement.
 *
 *  · `FIXED_ARM_EXTFAIL` — the number the production arm measured for `externalRefuted` with the
 *    MIXIN fix in but the ALIAS fix OUT: **25** (`.tmp-lane/dart-prod-index-FIXED.json`, the
 *    `overrides` row). Those 25 are the SDK's own `ListMixin`/`SetMixin` aliases.
 *  · `ALIAS_FIXED_EXTFAIL` — the number the COMMITTED spec must produce: **0**, because the alias
 *    fix (`type_alias` in the dart spec) puts the alias's target's members where the companion
 *    lookup can see them, so the analyzer no longer publishes an external base for an alias.
 *
 *  The instrument must find this number INDEPENDENTLY, or one of the two is wrong — and when the
 *  two disagree, THE INSTRUMENT'S CONTROL SAYS SO rather than printing a quiet number. */
const FIXED_ARM_EXTFAIL = 25
const ALIAS_FIXED_EXTFAIL = 0
const VIEW = (process.argv.find((a) => a.startsWith("--view="))?.split("=")[1] ?? "pre") as "pre" | "fixed"
if (VIEW !== "pre" && VIEW !== "fixed") {
  console.error(`--view= must be "pre" or "fixed", not "${VIEW}"`)
  process.exit(2)
}
const declCounts = new Map<string, Map<string, number>>()
let preFixHasMixin = false
let fixedHasMixin = false
let preFixHasTypedef = false
let candidateTotal = 0

for (const repo of selected) {
  // THIS PROJECT'S KEY SPACE. The gate's is per project, so this one is too.
  const declCount = new Map<string, number>()
  declCounts.set(repo.name, declCount)
  // THE CANDIDATE SET: every admitted file that contains the text `@override` — a superset of the
  // files that can publish a refuted row (the fallback is gated on the annotation).
  // `git grep` EXITS 1 WHEN IT MATCHES NOTHING — which is not an error, it is a repository with no
  // `@override` (nvim-treesitter). MEASURED: the instrument crashed on it with execFileSync's
  // "Command failed", so the exit code is now read rather than thrown.
  let candRel: string[] = []
  try {
    candRel = execFileSync("git", ["-C", repo.dir, "grep", "-l", "-F", "@override", "--", "*.dart"], {
      encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
    }).split("\n").filter(Boolean)
  } catch (e: any) {
    if (e?.status === 1) candRel = []
    else throw e
  }
  const candAbs = new Set(candRel.map((r) => path.join(repo.dir, r)))
  const candidates = repo.files.filter((f) => candAbs.has(f))
  candidateTotal += candidates.length
  if (!candidates.length) continue

  const t0 = Date.now()
  const index = await indexForRepo(repo, wasm)
  const { view, removed } = preFixView(index)
  // WHICH INDEX VIEW THE ANALYSIS USES. `--view=pre` (the default) analyses with the DERIVED
  // pre-fix view (the mixins removed) — that is the state the pre-fix arm measured, and it is how
  // the 86 were named. `--view=fixed` analyses with the index AS COMMITTED (the mixins present) —
  // that is the state the FIXED arm measured, and it is how the rows that SURVIVE the fix are
  // named. The two modes are the same instrument pointed at two states, and each one's control
  // checks the census of the state it claims to be in.
  const analysisView = VIEW === "fixed" ? index : view
  console.log(`\n=== ${repo.name}: ${repo.files.length} files indexed in ${Date.now() - t0}ms · ${candidates.length} candidate files (of ${repo.files.length})`)
  console.log(`  FIXED view  census: ${census(index)}`)
  console.log(`  PRE-FIX view census: ${census(view)}  (mixin entries removed: ${removed.length})`)
  console.log(`  ANALYSIS VIEW: ${VIEW === "fixed" ? "FIXED (the committed spec — the state the fixed arm measured)" : "PRE-FIX (derived — the state the pre-fix arm measured)"}`)
  if (removed.length) console.log(`  mixin names removed: ${removed.slice(0, 8).join(", ")}${removed.length > 8 ? ` … (+${removed.length - 8})` : ""}`)
  if ([...view.typeKinds.values()].some((k) => String(k) === "mixin")) preFixHasMixin = true
  if ([...view.typeKinds.values()].some((k) => String(k) === "typedef")) preFixHasTypedef = true
  if ([...index.typeKinds.values()].some((k) => String(k) === "mixin")) fixedHasMixin = true

  // THE FIXED VIEW'S MEMBER OWNERS — which type really declares a member, IN THIS PROJECT.
  const repoMemberOwners = new Map<string, Set<string>>()
  for (const [t, members] of index.typeMembers) for (const m of members) {
    if (!repoMemberOwners.has(m)) repoMemberOwners.set(m, new Set())
    repoMemberOwners.get(m)!.add(t)
  }

  let done = 0
  for (const f of candidates) {
    const rel = path.relative(repo.dir, f)
    let r: any
    try { r = await parseFile(f, repo.dir, { projectIndex: analysisView, projectRoot: repo.dir } as any) } catch { continue }
    for (const s of Array.isArray(r?.symbols) ? r.symbols : []) {
      const name = String(s?.name ?? "")
      if (!name) continue
      declCount.set(name, (declCount.get(name) ?? 0) + 1)
    }
    for (const edge of (r?.relationships ?? [])) {
      if (String(edge.type) !== "overrides") continue
      const md = (edge as any).metadata ?? {}
      if (md.isExternalBase !== true) continue
      const target = String(edge.target ?? "")
      const dot = target.lastIndexOf(".")
      const owner = dot > 0 ? target.slice(0, dot) : target
      const member = dot > 0 ? target.slice(dot + 1) : ""
      rows.push({
        repo: repo.name, file: rel, line: Number(edge.line_number ?? 0), source: String(edge.source ?? ""),
        target, confidence: Number(edge.confidence ?? 0), owner, member, verdict: "",
        isObjectInterfaceBase: md.isObjectInterfaceBase === true,
        declaringTypes: [...(repoMemberOwners.get(member) ?? [])].sort(),
      })
    }
    done++
    if (done % 1000 === 0) console.log(`  … ${done}/${candidates.length} candidate files analysed`)
  }

  // ── PHASE 2 — THE KEY SPACE MUST BE COMPLETE FOR THE OWNER LOOKUP ──────────────────────────
  // The arbiter's question is "does the PROJECT declare this owner?", and the gate answers it from
  // the ANALYZER's OWN symbols over the whole project. The owner of a refuted row is a TYPE
  // declaration, and its declaring file is NOT necessarily a candidate file (the mixin that owns
  // the member is declared in a file that overrides nothing) — so the owner's declaring file is
  // found and analysed here. Without this the key space would be missing the very name the
  // refutation turns on, and every row would read `externalVerified`.
  const owners = [...new Set(rows.filter((r) => r.repo === repo.name).map((r) => r.owner))]
  let ownerFiles = 0
  for (const owner of owners) {
    const declRe = `^[[:space:]]*(abstract[[:space:]]+)?(class|mixin|enum|extension|typedef)[[:space:]]+${owner}\\b`
    let files: string[] = []
    try {
      files = execFileSync("git", ["-C", repo.dir, "grep", "-l", "-E", declRe, "--", "*.dart"], {
        encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
      }).split("\n").filter(Boolean).map((r) => path.join(repo.dir, r))
    } catch { files = [] }
    for (const f of files) {
      if (!repo.files.includes(f)) continue
      ownerFiles++
      let r: any
      try { r = await parseFile(f, repo.dir, { projectIndex: analysisView, projectRoot: repo.dir } as any) } catch { continue }
      for (const s of Array.isArray(r?.symbols) ? r.symbols : []) {
        const name = String(s?.name ?? "")
        if (!name) continue
        declCount.set(name, (declCount.get(name) ?? 0) + 1)
      }
    }
  }
  if (ownerFiles) console.log(`  key space: ${ownerFiles} owner-declaring file(s) analysed for ${owners.length} owner(s)`)
}

// ── THE REPORT ────────────────────────────────────────────────────────────────────────────────
// THE ARBITER IS ASKED **NOW**, with the key space COMPLETE. Asking per file would make the
// verdict depend on the ORDER the files were read in — a row whose owner's declaring file sorts
// later would read `externalVerified` (the owner not yet in the key space) and the same row would
// read `externalRefuted` if the file order changed. The gate asks after the whole population is in
// the key space, and so does this.
for (const r of rows) {
  const keySpace = declCounts.get(r.repo)
  if (!keySpace) { r.verdict = "NO KEY SPACE FOR THIS PROJECT"; continue }
  r.verdict = verifyExternalClaim(keySpace, r.target)
}
const refuted = rows.filter((r) => r.verdict === "externalRefuted")
const other = rows.filter((r) => r.verdict !== "externalRefuted")
const byTarget = new Map<string, Row[]>()
for (const r of refuted) {
  if (!byTarget.has(r.target)) byTarget.set(r.target, [])
  byTarget.get(r.target)!.push(r)
}
console.log(`\n=== THE ARBITER'S VERDICT ON EVERY COLLECTED isExternalBase ROW`)
console.log(`  candidate files analysed: ${candidateTotal} (every admitted file containing "@override")`)
console.log(`  collected isExternalBase rows: ${rows.length} · externalRefuted: ${refuted.length} · other: ${other.length}`)
console.log(`  distinct refuted targets: ${byTarget.size}  — the pre-fix arm PRINTED ${ARM_PRINTED.length}, and the gate's NAME_CAP is ${NAME_CAP}`)

console.log(`\n  target                                                    rows   the base that DECLARES the member`)
for (const t of [...byTarget.keys()].sort()) {
  const rs = byTarget.get(t)!
  const decl = [...new Set(rs.flatMap((r) => r.declaringTypes))].filter((d) => d !== t.slice(0, t.lastIndexOf("."))).slice(0, 5)
  console.log(`  ${t.padEnd(54)} ${String(rs.length).padStart(4)}   ${decl.join(", ")}`)
}

console.log(`\n=== EVERY REFUTED ROW, ONE BY ONE`)
for (const r of refuted.sort((a, b) => a.repo.localeCompare(b.repo) || a.file.localeCompare(b.file) || a.line - b.line)) {
  console.log(`  ${r.repo}/${r.file}:${r.line}  ${r.source} -> ${r.target}  conf=${r.confidence}  ${r.verdict}`)
}
if (other.length) {
  console.log(`\n=== THE isExternalBase ROWS THE ARBITER DID NOT REFUTE (${other.length}) — NOT extFAIL`)
  for (const r of other.slice(0, 40)) console.log(`  ${r.repo}/${r.file}:${r.line}  ${r.source} -> ${r.target}  ${r.verdict}`)
}

// ── THE CONTROLS ───────────────────────────────────────────────────────────────────────────────
let failures = 0
const fail = (m: string): void => { failures++; console.error(`FAIL ${m}`) }
const ok = (m: string): void => console.log(`  ok  ${m}`)

console.log(`\n=== CONTROL 1 — THE CENSUS OF THE STATE THIS RUN CLAIMS TO BE IN`)
if (VIEW === "pre") {
  if (!preFixHasMixin) ok("the derived pre-fix view's typeKinds census carries NO mixin — the measured pre-fix state (mixin 0)")
  else fail("the derived pre-fix view still carries a mixin — the derivation does not reproduce the pre-fix index")
  if (!preFixHasTypedef) ok("the derived pre-fix view's census carries NO typedef either — the pre-fix spec named neither a mixin nor an alias")
  else fail("the derived pre-fix view still carries a typedef — the derivation does not reproduce the pre-fix index")
  if (fixedHasMixin) ok("the fixed view's census DOES carry the mixins — so the fix's contribution is the difference")
  else fail("the fixed view carries no mixin either — the index was not built with the committed spec")
} else {
  if (fixedHasMixin) ok("the analysis view (the committed spec) carries the mixins — the FIXED state, which is what this run claims to measure")
  else fail("the analysis view carries no mixin — the index was not built with the committed spec, so a FIXED-state measurement is impossible")
  if (!preFixHasMixin) ok("the derived pre-fix view carries no mixin — so the two views really are different states")
  else fail("the derived pre-fix view carries a mixin — the derivation is broken")
}

console.log(`\n=== CONTROL 2 — THE PUBLISHED FIVE (dart-http)`)
const httpRows = refuted.filter((r) => r.repo === "dart-http").map((r) => `${r.file}:${r.line}`)
for (const k of KNOWN_FIVE) {
  if (VIEW === "pre") {
    if (httpRows.includes(k)) ok(k)
    else fail(`${k} — the published dart-http row is NOT among the rows found`)
  } else {
    // In the FIXED state the mixin IS named, so these five rows must NO LONGER be refuted. A row
    // that is still refuted here means the fix did not reach it — and that is the whole claim.
    if (!httpRows.includes(k)) ok(`${k} — no longer refuted in the FIXED state (the mixin is named, so the base is not "external")`)
    else fail(`${k} — STILL REFUTED in the FIXED state — the fix did not reach this row`)
  }
}

console.log(`\n=== CONTROL 3 — THE COUNT`)
if (VIEW === "pre") {
  if (refuted.length === 86) ok(`86 refuted rows — the number the pre-fix arm measured independently`)
  else fail(`${refuted.length} refuted rows, expected 86 (the pre-fix arm's own count)`)
} else {
  if (refuted.length === ALIAS_FIXED_EXTFAIL) ok(`ZERO refuted rows — the committed spec produces none, where the arm with the mixin fix alone produced ${FIXED_ARM_EXTFAIL} (the SDK's own ListMixin/SetMixin aliases), found independently by this instrument`)
  else if (refuted.length === FIXED_ARM_EXTFAIL) fail(`${refuted.length} refuted rows — the count the arm measured BEFORE the alias fix, so the alias fix did NOT reach the population`)
  else fail(`${refuted.length} refuted rows, expected ${ALIAS_FIXED_EXTFAIL} (the committed spec's own count)`)
}

console.log(`\n=== CONTROL 4 — THE ARM'S PRINTED LIST IS COVERED`)
const missing = ARM_PRINTED.filter((t) => !byTarget.has(t))
if (VIEW === "pre") {
  if (!missing.length) ok(`all ${ARM_PRINTED.length} targets the pre-fix arm printed are covered by the rows found`)
  else fail(`not covered: ${missing.join(" · ")}`)
} else {
  const overlap = ARM_PRINTED.filter((t) => byTarget.has(t))
  if (!overlap.length) ok(`NONE of the ${ARM_PRINTED.length} targets the pre-fix arm printed is still refuted — so the rows that survive the fix are a DIFFERENT CLASS from the 86, not a residue of them`)
  else fail(`still refuted from the pre-fix list: ${overlap.join(" · ")} — the fix did not clear these`)
}
if (ARM_PRINTED.length === NAME_CAP) ok(`the arm printed exactly NAME_CAP (${NAME_CAP}) names — the LIST was capped, so it is a SAMPLE of the ${byTarget.size} distinct targets, and the gate's own "printed whole" header is not true`)
else fail(`the arm printed ${ARM_PRINTED.length} names, which is not NAME_CAP (${NAME_CAP}) — the cap explanation is not the one to report`)

console.log(failures === 0 ? "\nPASS" : `\nFAIL — ${failures} control(s) failed`)
process.exit(failures === 0 ? 0 : 3)
