/**
 * OWNER SCOPING, PRICED — how many php edges a receiver the tree already knows would disambiguate.
 *
 * ## THE QUESTION
 *
 * Cause A of the incoming-side work: "the published name is not an identifier … an ambiguous target
 * is ONE edge the reverse walk attributes to ONE declaration; picking which is a rule nobody
 * chose." For php the published form of a member is `(bare name, ownerName)` — `real-php-analyzer.ts`
 * sets `ownerName` on every method — and `pool-worker.ts:1007` carries it into the store. So the
 * identity that disambiguates is ALREADY PUBLISHED on the symbol side, and the EDGE side does not
 * carry it. `processMethodCall` and `processScopedCall` both take the receiver node and discard it:
 *
 *     $this->render()          ->  calls -> "render"        (owner dropped)
 *     self::render()           ->  calls -> "render"        (owner dropped)
 *     parent::render()         ->  calls -> "render"        (owner dropped)
 *     Widget::render()         ->  calls -> "render"        (owner dropped)
 *     $svc->render()           ->  calls -> "render"        (owner genuinely unknown)
 *
 * All five publish the same target string, and `render` is a method on many classes at once, so the
 * reverse walk must pick one. This probe prices how much of the ambiguous edge population sits in
 * the first FOUR rows — where the receiver determines the owner outright and no inference is needed.
 *
 * ## THREE NUMBERS, THREE INSTRUMENTS, AND THEY DO NOT OVERLAP
 *
 *   1. PUBLISHED (instrument A) — for every name the walk published, how many DISTINCT `ownerName`s
 *      declare it. This is the ceiling: a name declared by one owner cannot be disambiguated by an
 *      owner, so it is excluded from every recovery count below.
 *   2. EDGES (production `parseFile`) — per type, how many edges sit at a target with 1 / 2+ / 0
 *      published declarations, and of the 2+ edges how many sit at a target whose declarations span
 *      2+ distinct owners. That last count is the RECOVERABLE population: an owner on the edge
 *      decides it, and nothing else does.
 *   3. RECEIVERS (instrument B, parse-tree count) — how many member-position call/read SITES the
 *      grammar produces with a receiver that determines the owner, by receiver shape. This is an
 *      upper bound on what (2) can recover, measured on the tree rather than through `parseFile`, so
 *      it CANNOT confirm any edge count. It bounds; it does not attribute.
 *
 * The intersection — edges that are ambiguous AND carry a receiver-determined owner — is what the
 * AFTER run of this same probe measures, because after the fix the edge carries the owner itself.
 * Before the fix that intersection is not observable, and this file says so rather than
 * estimating it: two bounded populations and no product.
 *
 * ## WHY IT RUNS BEFORE ANY EDIT
 *
 * The change under consideration is additive (one metadata key), so it cannot change an edge count
 * by construction — which is exactly the kind of claim that should be checked rather than believed.
 * Running this file at the pre-change commit and at the post-change commit over the same population
 * gives the control: `edges` per type must be IDENTICAL, and `ownerResolved` must go from 0 to the
 * recovered number. `--out` writes the JSON both sides are compared from.
 *
 * ## TWO PHASES, AND WHY
 *
 * `--phase edges` runs production `parseFile`. `--phase receivers` runs the raw tree walk. They are
 * separate invocations, joined at print time by `--merge`, for two reasons that are not tidiness:
 *
 *   MEMORY. The raw walk OWNS its tree and must call `tree.delete()` — `engine.ts:2095` does it in
 *   a `finally` and `:1601` states the convention ("caller owns tree.delete()"). A first draft of
 *   this file did not, and the whole-corpus run was killed with the machine at 10/15 GB and six
 *   other lanes resident. Deleting the tree fixes the leak; splitting the phases halves the peak
 *   on top of it, because one WASM heap now serves one traversal at a time.
 *
 *   INSTRUMENT SEPARATION. The two halves are separate instruments (A/B vs production). Running
 *   them in one process would invite reading the receiver census as an edge count, which is the
 *   mistake this file's header is written to prevent.
 *
 * `--from`/`--to` slice the SORTED sample so a killed run resumes instead of restarting, and
 * `--progress N` prints a line per N files to stderr so a stalled run is visible.
 *
 * ## METHOD
 *
 * Corpus: every git-tracked file under `BB_CORPUS_ROOT` (default
 * /home/ishaq2321/bb_tests/repositories) that `detectLanguageFromPath` admits as `php`, enumerated
 * over `git ls-files` so build output is excluded by construction. Deterministic stride over the
 * sorted population with `--files N` (default 5094, i.e. the whole admitted population).
 *
 * Zero regex: node types, named children and field names only. The receiver classification reads
 * `childForFieldName("object")` / `childForFieldName("scope")` and compares `node.type` against
 * node-type strings.
 */
import { execFileSync } from "node:child_process"
import { readdirSync, statSync, readFileSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import * as ASTEngine from "../../../../src/ast/engine"
import { parseFile } from "../../../../src/ast/pool-worker"
import { phpInternalKind } from "../../../../src/ast/php-internal-symbols"

/**
 * The digest of the analyzer this process is ABOUT TO run, and the one on disk when it finishes.
 *
 * This exists because of a mistake this file's own author made on its first full run. The PRE
 * walk was launched in the background and the analyzer was edited WHILE it walked. The artifact
 * came back with a non-zero `carrying owner` column, which is impossible for the pre-change
 * analyzer — and the reason is that `parseFile` can reach the analyzer through a FORKED worker
 * (`pool-worker.ts` `parse_batch` handler), which imports the analyzer from DISK at fork time. A
 * forked child therefore picks up an edit made after the parent started.
 *
 * A "pre" run whose code changed underneath it is not a pre run, and the failure is silent: the
 * artifact still has every declared field and still passes its controls. So the digest is
 * RECORDED, and compared again after the walk; `digestStable: false` means the number belongs to
 * no single analyzer and the run must be discarded. That is the same discipline the 26-lane
 * firing sweep used, and it belongs here for the same reason.
 */
const ANALYZER_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../src/ast/real-php-analyzer.ts",
)
const digestOf = (): string => createHash("sha256").update(readFileSync(ANALYZER_PATH)).digest("hex").slice(0, 16)
const DIGEST_BEFORE = digestOf()

const argv = process.argv.slice(2)
const fail = (m: string): never => {
  console.error(`owner-scoping-prize: ${m}`)
  process.exit(2)
}
const argOf = (f: string) => {
  const i = argv.indexOf(f)
  if (i < 0) return undefined
  const v = argv[i + 1]
  if (v == null || v.startsWith("--")) fail(`\`${f}\` has no value`)
  return v
}
const N = Number(argOf("--files") ?? 5094)
if (!Number.isInteger(N) || N < 1) fail("--files must be a positive integer")
const OUT = argOf("--out")
const EDGES_OUT = argOf("--edges-out")
const RECEIVERS_OUT = argOf("--receivers-out")
const MERGE = argv.includes("--merge")
const PHASE = argOf("--phase") ?? (MERGE ? "merge" : "both")
const FROM = Number(argOf("--from") ?? 0)
const TO = Number(argOf("--to") ?? Number.MAX_SAFE_INTEGER)
const PROGRESS = Number(argOf("--progress") ?? 250)
if (!Number.isInteger(FROM) || FROM < 0) fail("--from must be a non-negative integer")
if (!Number.isInteger(TO) || TO < FROM) fail("--to must be an integer >= --from")
if (!Number.isInteger(PROGRESS) || PROGRESS < 1) fail("--progress must be a positive integer")
if (!["edges", "receivers", "both", "merge"].includes(PHASE)) fail(`--phase must be edges|receivers|both|merge`)
const CORPUS = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 512 * 1024

const admitted: { label: string; abs: string }[] = []
for (const entry of readdirSync(CORPUS)) {
  const dir = path.join(CORPUS, entry)
  let tracked: string[] = []
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
    }).split("\0").filter(Boolean)
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
const stride = Math.max(1, Math.floor(admitted.length / N))
const picked: typeof admitted = []
for (let i = 0; i < admitted.length && picked.length < N; i += stride) picked.push(admitted[i])

/** name -> how many SYMBOLS publish it (the fleet's `multiSymbol` counter). */
const declCount = new Map<string, number>()
/** name -> the distinct `ownerName`s that declare it. A name with one owner cannot be owner-resolved. */
const ownerSet = new Map<string, Set<string>>()
/** `type\ttarget` -> edge count. */
const edgeByTarget = new Map<string, number>()
/** `type\ttarget\towner` -> edge count, for edges that CARRY a metadata.owner. */
const edgeByOwner = new Map<string, number>()
const perType = new Map<string, number>()

/**
 * The receiver shapes, and what each one determines. Named to match the five rows of the header.
 *
 *   thisReceiver     `$this->m()`, `$this?->m()`      owner = the enclosing class
 *   namedClassScope  `Foo::m()`, `\A\B\Cls::m()`      owner = the named class
 *   relativeSelf     `self::m()`, `static::m()`       owner = the enclosing class
 *   relativeParent   `parent::m()`                    owner = the declared base
 *   plainVariable    `$obj->m()`, `$cls::m()`         owner NOT statically determined
 *   otherExpression  `$this->svc->inner()`, …         the object's type needs inference
 */
type ReceiverShape =
  | "thisReceiver"
  | "namedClassScope"
  | "relativeSelf"
  | "relativeParent"
  | "plainVariable"
  | "otherExpression"
  | "notMemberPosition"

const receivers = new Map<ReceiverShape, number>()

/** Classify a member call / scoped call / member read receiver. Node types and field names only. */
function classifyReceiver(kind: "member_call" | "scoped_call" | "member_read", node: any): ReceiverShape {
  if (kind === "scoped_call") {
    const scope = node.childForFieldName("scope")
    if (!scope) return "otherExpression"
    if (scope.type === "relative_scope") {
      // Probe-verified against the pinned grammar: self / static / parent each arrive as
      // `relative_scope` carrying that literal text.
      if (scope.text === "parent") return "relativeParent"
      if (scope.text === "self" || scope.text === "static") return "relativeSelf"
      return "otherExpression"
    }
    // A `name` / `qualified_name` scope names a class outright — `\App\Deep\Cls::m()` arrives as
    // `qualified_name`, which is why this half is not read from source text.
    if (scope.type === "name" || scope.type === "qualified_name") return "namedClassScope"
    return "otherExpression"
  }
  const object = node.childForFieldName("object")
  if (!object) return "otherExpression"
  if (object.type === "variable_name") return object.text === "$this" ? "thisReceiver" : "plainVariable"
  // `$cls::m()` is a `scoped_call_expression` whose scope is a variable, so it lands here.
  if (kind === "member_call" && object.type === "variable_name") return "plainVariable"
  return "otherExpression"
}

const runEdges = PHASE === "edges" || PHASE === "both"
const runReceivers = PHASE === "receivers" || PHASE === "both"
const parser = runReceivers ? await ASTEngine.getParser("php") : null
let parseFailures = 0
let memberReadSites = 0
const memberReadReceivers = new Map<ReceiverShape, number>()
const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1)

const slice = picked.slice(Math.min(FROM, picked.length), Math.min(TO, picked.length))
if (slice.length !== picked.length) {
  console.error(`slice [${FROM},${TO}) of ${picked.length} sampled files -> ${slice.length}`)
}

for (const [fi, f] of slice.entries()) {
  if (fi > 0 && fi % PROGRESS === 0) {
    console.error(`… ${fi}/${slice.length} files  rss=${Math.round(process.memoryUsage().rss / 1048576)}MB`)
  }
  let text = ""
  try {
    text = readFileSync(f.abs, "utf8")
  } catch {
    continue
  }
  // --- (2) EDGES, through the production entry point ---
  if (runEdges) {
    let r: any
    try {
      r = await parseFile(f.abs, "php")
    } catch {
      parseFailures++
      continue
    }
    for (const s of r?.symbols ?? []) {
      const name = (s as { name?: unknown }).name
      if (typeof name !== "string" || name.length === 0) continue
      bump(declCount, name)
      const ownerName = (s as { ownerName?: unknown }).ownerName
      if (typeof ownerName === "string" && ownerName.length > 0) {
        let set = ownerSet.get(name)
        if (!set) ownerSet.set(name, (set = new Set()))
        set.add(ownerName)
      }
    }
    for (const e of r?.relationships ?? []) {
      const rel = e as { type?: unknown; target?: unknown; metadata?: Record<string, unknown> }
      const t = typeof rel.type === "string" ? rel.type : String(rel.type)
      const target = typeof rel.target === "string" ? rel.target : undefined
      if (!target) continue
      bump(perType, t)
      bump(edgeByTarget, `${t}\t${target}`)
      const owner = rel.metadata?.owner
      if (typeof owner === "string" && owner.length > 0) bump(edgeByOwner, `${t}\t${target}\t${owner}`)
    }
  }

  // --- (3) RECEIVERS, on the parse tree (instrument B) ---
  //
  // `tree.delete()` is REQUIRED, not hygiene: `engine.ts:2095` calls it in a `finally` and
  // `:1601` states the convention ("caller owns tree.delete()"). web-tree-sitter allocates the
  // tree in the WASM heap, so a walk that never deletes it grows that heap by one whole parse per
  // file until the process is killed. That is not hypothetical — the first draft of this file did
  // exactly that and the whole-corpus run died on it.
  if (runReceivers && parser) {
    let tree: any
    try {
      tree = parser.parse(text)
    } catch {
      continue
    }
    try {
      const stack: any[] = [tree.rootNode]
      while (stack.length > 0) {
        const n = stack.pop()!
        const t = n.type
        if (t === "member_call_expression" || t === "nullsafe_member_call_expression") {
          bump(receivers, classifyReceiver("member_call", n))
        } else if (t === "scoped_call_expression") {
          bump(receivers, classifyReceiver("scoped_call", n))
        } else if (t === "member_access_expression" || t === "nullsafe_member_access_expression") {
          memberReadSites++
          bump(memberReadReceivers, classifyReceiver("member_read", n))
        }
        for (const c of n.children) stack.push(c)
      }
    } finally {
      try { tree.delete() } catch {}
    }
  }
}
if (parser) { try { parser.delete() } catch {} }

const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0)

// --- (1) PUBLISHED: how many distinct owners declare each name ---
let namesMultiDecl = 0
let namesMultiOwner = 0
for (const [name, n] of declCount) {
  if (n < 2) continue
  namesMultiDecl++
  if ((ownerSet.get(name)?.size ?? 0) >= 2) namesMultiOwner++
}

// --- (2) EDGES, resolved against the published set ---
interface TypeRow {
  edges: number
  resolve0: number
  resolve1: number
  resolveMulti: number
  resolveMultiMultiOwner: number
  ownerCarrying: number
  ownerResolvedExactly1: number
  ownerResolvedStillMulti: number
  ownerResolvedUndeclared: number
}
const rows = new Map<string, TypeRow>()
const rowFor = (t: string): TypeRow =>
  rows.get(t) ?? rows.set(t, {
    edges: 0, resolve0: 0, resolve1: 0, resolveMulti: 0, resolveMultiMultiOwner: 0,
    ownerCarrying: 0, ownerResolvedExactly1: 0, ownerResolvedStillMulti: 0, ownerResolvedUndeclared: 0,
  }).get(t)!
for (const [key, count] of edgeByTarget) {
  const [t, target] = key.split("\t")
  const row = rowFor(t)
  row.edges += count
  const decls = declCount.get(target) ?? 0
  if (decls === 0) row.resolve0 += count
  else if (decls === 1) row.resolve1 += count
  else {
    row.resolveMulti += count
    if ((ownerSet.get(target)?.size ?? 0) >= 2) row.resolveMultiMultiOwner += count
  }
}
for (const [key, count] of edgeByOwner) {
  const [t, target, owner] = key.split("\t")
  const row = rowFor(t)
  row.ownerCarrying += count
  // (target, owner) is the published identity of a member: `ownerName` on the symbol, `owner` on
  // the edge. A consumer joining the two is the disambiguation this probe prices.
  const owners = ownerSet.get(target)
  if (!owners) row.ownerResolvedUndeclared += count
  else if (owners.size === 1 && owners.has(owner)) row.ownerResolvedExactly1 += count
  else if (owners.size >= 2) row.ownerResolvedStillMulti += count
  else row.ownerResolvedStillMulti += count
}

const receiverTotal = sum(receivers)
const ownerDetermined = receiverTotal - (receivers.get("plainVariable") ?? 0) - (receivers.get("otherExpression") ?? 0)

const population = {
  corpusRoot: CORPUS,
  analyzerDigestBefore: DIGEST_BEFORE,
  analyzerDigestAfter: digestOf(),
  analyzerDigestStable: DIGEST_BEFORE === digestOf(),
  admittedFiles: admitted.length,
  sampleFiles: picked.length,
  slice: [FROM, TO] as [number, number],
  sliceFiles: slice.length,
  stride,
}
const edgesReport = {
  instrument: "owner-scoping-prize.mts --phase edges",
  entryPoint: "parseFile (src/ast/pool-worker.ts)",
  ...population,
  parseFailures,
  published: {
    distinctNames: declCount.size,
    namesMultiDeclaration: namesMultiDecl,
    namesMultiDistinctOwner: namesMultiOwner,
  },
  perTypeEdges: Object.fromEntries([...rows.entries()].sort()),
  perTypeTotals: Object.fromEntries([...perType.entries()].sort()),
}
const receiversReport = {
  instrument: "owner-scoping-prize.mts --phase receivers",
  entryPoint: "web-tree-sitter via ASTEngine.getParser('php') — parse-tree count, NOT production parseFile",
  ...population,
  receivers: {
    note: "instrument B — bounds what the edge side can recover; attributes nothing to an edge",
    total: receiverTotal,
    byShape: Object.fromEntries([...receivers.entries()].sort()),
    ownerDetermined,
  },
  memberReads: {
    total: memberReadSites,
    byShape: Object.fromEntries([...memberReadReceivers.entries()].sort()),
  },
}
if (OUT && PHASE !== "merge") writeFileSync(OUT, JSON.stringify(PHASE === "receivers" ? receiversReport : edgesReport, null, 2) + "\n")
if (EDGES_OUT && runEdges) writeFileSync(EDGES_OUT, JSON.stringify(edgesReport, null, 2) + "\n")
if (RECEIVERS_OUT && runReceivers) writeFileSync(RECEIVERS_OUT, JSON.stringify(receiversReport, null, 2) + "\n")

/**
 * The top unresolved and top ambiguous targets per type.
 *
 * Printed because the two big `0 decls` columns are OPPOSITE findings wearing one number: a name no
 * repo in the walk declares is either external (a builtin, a vendored package, another project's
 * API — legitimately outside the corpus) or a declaration this analyzer failed to publish (a defect).
 * A flat count cannot tell them apart, and the difference decides whether the remaining work is an
 * indexing fix or a labelling one. `ambiguousTargets` is the same reason: a name declared by 20
 * owners is where an owner on the edge pays, and a name declared by 2 is not worth a fixture.
 */
if (runEdges) {
  const unresolvedTop = new Map<string, number>()
  const ambiguousTop = new Map<string, number>()
  for (const [key, count] of edgeByTarget) {
    const [t, target] = key.split("\t")
    const decls = declCount.get(target) ?? 0
    if (decls === 0) bump(unresolvedTop, `${t}\t${target}`)
    else if (decls >= 2) bump(ambiguousTop, `${t}\t${target}`)
  }
  const top = (m: Map<string, number>, n: number) =>
    [...m.entries()].sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : 1)).slice(0, n)
  for (const [t, list] of [
    ["UNRESOLVED targets (0 published declarations)", top(unresolvedTop, 30)],
    ["AMBIGUOUS targets (2+ published declarations)", top(ambiguousTop, 30)],
  ] as const) {
    console.log(`--- top ${t} ---`)
    for (const [key, c] of list) {
      const [type, target] = key.split("\t")
      const decls = declCount.get(target) ?? 0
      const owners = ownerSet.get(target)?.size ?? 0
      const phpInternal = phpInternalKind(target)
      console.log(
        `  ${String(c).padStart(6)}  ${type.padEnd(12)} ${target.padEnd(34)} decls=${String(decls).padStart(4)} owners=${String(owners).padStart(4)}` +
        `${phpInternal ? `  php-internal:${phpInternal}` : ""}`,
      )
    }
    console.log("")
  }
}

/**
 * `--merge` joins two already-written artifacts. It exists so the two instruments are printed
 * side by side WITHOUT having shared a process, and so a re-print never re-walks 5,094 files.
 * A merge over mismatched populations is refused rather than printed: the two halves describe
 * different slices otherwise and the side-by-side table would be two populations wearing one
 * header.
 */
let edgesShown = edgesReport
let receiversShown = receiversReport
if (PHASE === "merge") {
  if (!EDGES_OUT || !RECEIVERS_OUT) fail("--merge needs --edges-out and --receivers-out")
  edgesShown = JSON.parse(readFileSync(EDGES_OUT, "utf8"))
  receiversShown = JSON.parse(readFileSync(RECEIVERS_OUT, "utf8"))
  const pe = edgesShown.population ?? edgesShown
  const pr = receiversShown.population ?? receiversShown
  if (pe.sampleFiles !== pr.sampleFiles || JSON.stringify(pe.slice ?? null) !== JSON.stringify(pr.slice ?? null)) {
    console.error(
      `CONTROL FAILED: the two artifacts are over different populations ` +
        `(sampleFiles ${pe.sampleFiles} vs ${pr.sampleFiles}; slice ${JSON.stringify(pe.slice)} vs ${JSON.stringify(pr.slice)}). ` +
        `The side-by-side table would be two populations under one header.`,
    )
    process.exit(3)
  }
}

console.log(`owner scoping, priced — php`)
console.log(`corpus root            ${edgesShown.corpusRoot ?? receiversShown.corpusRoot}`)
console.log(`analyzer digest        ${String((edgesShown.analyzerDigestBefore ?? receiversShown.analyzerDigestBefore) as string).padStart(16)}  (stable across the walk: ${(edgesShown.analyzerDigestStable ?? receiversShown.analyzerDigestStable) as boolean})`)
console.log(`admitted php files     ${String((edgesShown.admittedFiles ?? receiversShown.admittedFiles) as number).padStart(8)}  (git-tracked, detectLanguageFromPath === "php")`)
console.log(`sample                 ${String((edgesShown.sampleFiles ?? receiversShown.sampleFiles) as number).padStart(8)}  (deterministic stride ${(edgesShown.stride ?? receiversShown.stride) as number} over the sorted population)`)
console.log(`slice walked           ${String(((edgesShown.sliceFiles ?? receiversShown.sliceFiles) as number)).padStart(8)}`)
console.log(`files that failed       ${String((edgesShown.parseFailures ?? "-") as string).padStart(8)}`)
console.log("")
console.log("--- (1) PUBLISHED: name -> distinct ownerName  [instrument A, from production parseFile] ---")
console.log(`distinct names published        ${String((edgesShown.published as any)?.distinctNames ?? "-").padStart(8)}`)
console.log(`names with 2+ declarations      ${String((edgesShown.published as any)?.namesMultiDeclaration ?? "-").padStart(8)}`)
console.log(`  …of those, 2+ DISTINCT OWNERS ${String((edgesShown.published as any)?.namesMultiDistinctOwner ?? "-").padStart(8)}  (only these are owner-resolvable)`)
console.log("")
console.log("--- (2) EDGES per type, resolved against the published set  [production parseFile] ---")
console.log(`  type          edges      0 decls      1 decl   2+ decl   2+decl&2+owner  carrying owner  owner->1  owner->multi`)
for (const [t, r] of Object.entries(edgesShown.perTypeEdges as Record<string, TypeRow>).sort()) {
  console.log(
    `  ${t.padEnd(12)}${String(r.edges).padStart(9)}${String(r.resolve0).padStart(13)}${String(r.resolve1).padStart(12)}` +
    `${String(r.resolveMulti).padStart(11)}${String(r.resolveMultiMultiOwner).padStart(15)}${String(r.ownerCarrying).padStart(16)}` +
    `${String(r.ownerResolvedExactly1).padStart(10)}${String(r.ownerResolvedStillMulti).padStart(13)}`,
  )
}
console.log("")
console.log("--- (3) RECEIVERS on the parse tree  [instrument B — a bound, not an attribution] ---")
const rv = receiversShown.receivers as { total: number; byShape: Record<string, number>; ownerDetermined: number }
for (const [k, v] of Object.entries(rv.byShape).sort()) console.log(`  ${k.padEnd(18)}${String(v).padStart(8)}`)
console.log(`  ${"TOTAL".padEnd(18)}${String(rv.total).padStart(8)}`)
console.log(`  receiver determines the owner  ${String(rv.ownerDetermined).padStart(8)}  (${((rv.ownerDetermined / rv.total) * 100).toFixed(1)}% of sites)`)
console.log("")
console.log(`member READ sites  ${(receiversShown.memberReads as any).total}`)
for (const [k, v] of Object.entries((receiversShown.memberReads as any).byShape as Record<string, number>).sort()) {
  console.log(`  ${k.padEnd(18)}${String(v).padStart(8)}`)
}
console.log("")
console.log(`CONTROL — a vacuous 0 here would be a probe bug, not a finding:`)
if (runEdges || PHASE === "merge") {
  const digE = edgesShown.analyzerDigestStable
  const digR = receiversShown.analyzerDigestStable
  console.log(`  analyzer digest stable  edges=${digE}  receivers=${digR}`)
  if (digE === false || digR === false) {
    console.error(
      "CONTROL FAILED: the analyzer file changed WHILE this walk ran. Every number below " +
        "belongs to no single analyzer — `parseFile` can reach the analyzer through a forked " +
        "worker that imports it from disk, so a mid-walk edit is picked up silently. Re-run.",
    )
    process.exit(3)
  }
}
if (runReceivers || PHASE === "merge") {
  console.log(`  member/scoped call sites seen ${rv.total}`)
  console.log(`  member read sites seen        ${(receiversShown.memberReads as any).total}`)
  if (rv.total === 0 || (receiversShown.memberReads as any).total === 0) {
    console.error("CONTROL FAILED: no member-position sites. Nothing in section 3 can be believed.")
    process.exit(3)
  }
}
if (runEdges || PHASE === "merge") {
  const nm = (edgesShown.published as any).namesMultiDistinctOwner as number
  console.log(`  names with 2+ distinct owners  ${nm}`)
  if (nm === 0) {
    console.error("CONTROL FAILED: no name is declared by 2+ owners. Owner scoping could not help by construction.")
    process.exit(3)
  }
}