/**
 * THE RECEIVER AVAILABILITY CUT — dart lane, the measurement the roadmap is written on.
 *
 * `docs/analyzers/dart.md` says the next instrument must answer, for the edges whose
 * target stayed a BARE MEMBER NAME, how many have a receiver whose type is (a) knowable in the
 * emitting file, (b) knowable only from the project index, (c) not knowable at all — because those
 * three answers are three different pieces of work, and (c) is bucket 3's true population, the only
 * one of the three that indexing does not move.
 *
 * WHAT THIS READS. `metadata.receiverCause`, produced inside `qualifiedTarget` at the branch that
 * decides (`real-dart-analyzer.ts`), on the rows that stayed bare:
 *
 *   receiverUnnamed            no owner text at the site (a call result, an index expression, a
 *                              cascade, a bare callee in library scope)          -> (c)
 *   receiverTypeOutsideRun     a CAPITALIZED head: a type NAME written in the source
 *                              that this run cannot see — the spelling can carry it  -> (b)
 *   receiverTypeUnknown        a lowercase head: a VALUE whose declared type the run
 *                              did not resolve; no spelling at the site reaches a
 *                              declaration — the receiver-TYPING gap               -> (c')
 *   receiverMemberOutsideRun   the type is visible and does not declare the member,
 *                              so the DECLARING type is outside the run            -> (b)
 *   libraryScopeCallee         the bare name IS a library-scope declaration of this
 *                              file: correctly spelled, not a receiver problem    -> (d)
 *   receiverInFileNotSpelled   the declaring owner is in this file and the qualified
 *                              spelling is not in its published symbol table — the
 *                              ONE branch that is an analyzer gap                  -> (a)
 *
 * A row the analyzer QUALIFIED carries no cause, so (a)/(b)/(c) are read off rows that are bare by
 * construction, and this census needs no second implementation of the qualification rule — which is
 * the point of reporting it inside that rule instead of re-deriving it here.
 *
 * WHAT IT ADDS ON TOP. Whether each bare row is, in the GATE's own counting rule
 * (`declCount.get(target)`), resolved / ambiguous / unresolved in the file's OWN PROJECT scope.
 *
 * THE KEY SPACE IS THE GATE'S, and this instrument now gets it by CALLING THE SAME CODE the gate
 * does (`pool-worker.parseFile`) instead of rebuilding it. It took THREE key-space bugs to learn
 * that, and they were one mistake wearing three hats — mirroring an upstream projection rather than
 * reading it:
 *
 *   1. `Owner.member` only, so bare member names matched no key: 60,367 of 79,667 bare calls read
 *      UNRESOLVED against the gate's whole-corpus 59,531 for six repos.
 *   2. Counting the member's `name` fixed the bare side, but the direct path (`new RealDartAnalyzer`)
 *      does not SET `qualifiedName` for a member — `pool-worker.ts:1069` derives it
 *      (`qualifiedName || fqn || scope.name`) — so `Type.member` keys did not exist and the FIRST
 *      PRICE OF THE SPELLING CHANGE read `0 wins, every spelling -> unres` on two whole repos. A
 *      price that says "the fix never helps" because its key space is missing the keys the fix
 *      produces is the most dangerous shape a measurement can take: it agrees with itself.
 *   3. The pool path also drops SYMBOL metadata (it projects onto the DB's columns), which is why
 *      an earlier probe went direct — but this census reads RELATIONSHIP metadata, and that survives
 *      (`incoming-gate.ts` reads every marker through the same path, and the per-file arm's
 *      `causeOK 27,479` came out of it).
 *
 * So: `parseFile` per file, keys = `name` plus `qualifiedName` when they differ (the gate's rule),
 * counted as the SAME declaration. What is measured is now what the gate measures.
 *
 * WHAT IT DOES NOT SAY. The split is about the TARGET's spellability in the project, not about
 * whether an index would help: a `receiverTypeOutsideRun` row whose target is unresolved names a
 * member no file in this project declares, which means the TYPE is out of the project entirely
 * (dart:core, a package) — an index of this project cannot reach it, and that is why the cause and
 * the outcome must be read TOGETHER rather than one at a time.
 *
 * Run: npx tsx validation/m14/fixtures/dart/receiver-availability-cut.ts [repo,repo,...]
 */
import { execFileSync } from "node:child_process"
import { statSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"
import { BINDING_SEP } from "../../../../src/ast/types"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const repos = (process.argv[2] ?? "dart-http,riverpod,proxicall").split(",")

/** THE GATE'S ADMISSION RULE, so the two populations are the same population: a tracked `.dart`
 *  file, present in the working tree, not over `SIZE_CAP`. Both exclusions are COUNTED and NAMED
 *  rather than silently dropped — `pb-reference/examples/{add,list}_people.dart` are tracked and
 *  absent from the working tree, and a census that fails to open them and reports "0 files" would
 *  be claiming the repository has nothing in it (`incoming-gate.ts:287` says the same thing). */
const SIZE_CAP = 1024 * 1024
function filesOf(name: string): { files: string[]; absent: number; overCap: number } | null {
  const dir = path.join(CR, name)
  try { if (!statSync(dir).isDirectory()) return null } catch { return null }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
      .split("\0").filter(Boolean).filter((r) => r.endsWith(".dart"))
  } catch { return null }
  const files: string[] = []
  let absent = 0
  let overCap = 0
  for (const r of tracked) {
    const abs = path.join(dir, r)
    let size: number
    try { size = statSync(abs).size } catch { absent++; continue }
    if (size > SIZE_CAP) { overCap++; continue }
    files.push(abs)
  }
  return { files, absent, overCap }
}

type Bucket = { bare: number; resolved: number; amb: number; unres: number }
const empty = (): Bucket => ({ bare: 0, resolved: 0, amb: 0, unres: 0 })
const CAUSES = [
  "receiverUnnamed", "receiverTypeOutsideRun", "receiverTypeUnknown", "receiverMemberOutsideRun",
  "libraryScopeCallee", "receiverInFileNotSpelled",
  // THE NON-RECEIVER READ SHAPES, named from the markers the edges ALREADY carry — no analyzer
  // change and no second implementation of the qualification rule. The first version of this
  // census left them in one `(no cause: other bare shape)` bucket of 3,901 rows on riverpod's
  // `uses` alone, which is 40.5 % of that project's `uses` ambiguity reported as "unknown" when
  // the edge was saying all along that it was an interpolation read or a global read. A shape is
  // not a `receiverCause` and is printed under its own prefix: these rows never REACHED the
  // decision the cause is produced at, which is itself the distinction a reader needs.
  "shape: interpolation read", "shape: global read", "shape: subscript base",
  "shape: bare read", "shape: cascade", "(no cause: other bare shape)",
] as const

for (const repoName of repos) {
  const admitted = filesOf(repoName)
  if (admitted === null) continue
  const { files, absent, overCap } = admitted
  const repo = path.join(CR, repoName)
  // The project's key space, by the gate's rule: key -> how many declarations answer it.
  const declCount = new Map<string, number>()
  const emitted: { label: string; target: string; cause: string | null; typeName: string | null; kind: string }[] = []
  let parsed = 0
  /** DEGRADED FILES ARE COUNTED AND NAMED, exactly as the gate does — the pool's fallback path returns
   *  a regex extractor's handful of rows, and the gate's whole point is that a number over a
   *  population no analyzer read means nothing. MEASURED, and it is why the direct-analyzer version of
   *  this census over-counted: `dart-http`'s `pkgs/cupertino_http/lib/src/native_cupertino_bindings.dart`
   *  yields 5,807 relationships called directly and 24 through the pool, with `fallback: true` for
   *  every call shape — one file, 5,783 rows, and the difference between the two tables. */
  let degraded = 0
  let failed = 0
  const degradedFiles: string[] = []
  for (const f of files) {
    let out: any
    try {
      // THE GATE'S CALL SHAPE, ARGUMENT FOR ARGUMENT (`incoming-gate.ts:685`):
      // `parseFile(f, repoOf(f), { projectRoot: repoOf(f) })`. The third argument is not decoration —
      // it is how the pool hands a parse the project root the analyzer builds its library site from,
      // and a census that omitted it would measure a different analyzer than the gate measured.
      out = await parseFile(f, repo, { projectRoot: repo } as any)
      // A THROW IS COUNTED, exactly as the gate counts it (`incoming-gate.ts:688` `failed++`): a
      // population number that silently shrinks when a file cannot be read is the defect this
      // instrument exists to avoid.
    } catch { failed++; continue }
    parsed++
    if (out?.fallback === true || out?.metadata?.analysisVersion === "2.0-basic-fallback") {
      degraded++
      degradedFiles.push(path.relative(repo, f))
    }
    // The gate's rule, verbatim (`incoming-gate.ts:595-620`): a symbol contributes its `name`, and
    // its `qualifiedName` when that differs — as the SAME declaration.
    for (const s of (Array.isArray(out?.symbols) ? out.symbols : []) as any[]) {
      const n = String(s?.name ?? "")
      if (!n) continue
      declCount.set(n, (declCount.get(n) ?? 0) + 1)
      const q = String(s?.qualifiedName ?? "")
      if (q.length > 0 && q !== n) declCount.set(q, (declCount.get(q) ?? 0) + 1)
    }
    for (const r of (Array.isArray(out?.relationships) ? out.relationships : []) as any[]) {
      const label = String(r?.type ?? "")
      if (label !== "calls" && label !== "uses") continue
      const md = r?.metadata ?? {}
      if (md[BINDING_SEP] === true || md.localBinding === true || md.isLocalRead === true) continue
      const tgt = String(r?.target ?? "")
      if (tgt.length === 0) continue
      if (tgt.includes(BINDING_SEP)) continue
      /** The shape label, read off the edge's own markers — in the gate's own order of
       *  specificity (an interpolation read that is also a member read is an interpolation read:
       *  the site, not the access, is what the reader needs named). */
      const shape = md.isInterpolationRead === true ? "shape: interpolation read"
        : md.isGlobalRead === true ? "shape: global read"
        : md.isSubscriptBase === true ? "shape: subscript base"
        : md.isCascade === true ? "shape: cascade"
        : md.isBareRead === true ? "shape: bare read"
        : null
      emitted.push({
        label,
        target: tgt,
        cause: typeof md.receiverCause === "string" ? md.receiverCause : shape,
        // THE WRITTEN TYPE NAME, when the run had one — the price of the spelling change is read
        // off this and nothing else, so the instrument cannot price a spelling the analyzer would
        // not produce.
        typeName: typeof md.receiverType === "string" ? md.receiverType : null,
        kind: String(md.isBareRead ? "bareRead" : md.isMemberRead ? "memberRead" : md.isInterpolationRead ? "interpolation" : md.isGlobalRead ? "globalRead" : md.isSubscriptBase ? "subscriptBase" : "call"),
      })
    }
  }

  const perLabel = new Map<string, Map<string, Bucket>>()
  /** rows the analyzer QUALIFIED — the other half of the same population, so a reader can see the
   *  ratio this cut exists to explain rather than only its numerator. */
  const qualifiedByLabel = new Map<string, number>()
  /** THE PRICE OF THE SPELLING CHANGE, as a TRANSITION MATRIX rather than a single number: today's
   *  outcome (bare) -> the outcome the same row would get spelled `Type.member`, by the gate's own
   *  counting rule. A spelling can LOSE a resolution as well as win one — if the member name is
   *  unique in the project but the type name is not, the more precise target is the ambiguous one —
   *  and a price that only counted the wins would not say so. */
  const price = new Map<string, Map<string, number>>()
  const outcomeOf = (n: number): "resolved" | "amb" | "unres" => (n === 0 ? "unres" : n === 1 ? "resolved" : "amb")
  for (const e of emitted) {
    const isBare = !e.target.includes(".")
    if (!isBare) {
      qualifiedByLabel.set(e.label, (qualifiedByLabel.get(e.label) ?? 0) + 1)
      continue
    }
    const cause = e.cause ?? "(no cause: other bare shape)"
    let m = perLabel.get(e.label)
    if (!m) perLabel.set(e.label, (m = new Map()))
    const b = m.get(cause) ?? empty()
    b.bare++
    const today = outcomeOf(declCount.get(e.target) ?? 0)
    if (today === "unres") b.unres++
    else if (today === "resolved") b.resolved++
    else b.amb++
    m.set(cause, b)
    if (e.typeName) {
      const proposed = outcomeOf(declCount.get(`${e.typeName}.${e.target}`) ?? 0)
      let t = price.get(e.label)
      if (!t) price.set(e.label, (t = new Map()))
      const k = `${today} -> ${proposed}`
      t.set(k, (t.get(k) ?? 0) + 1)
    }
  }

  console.log(`\n=== ${repoName} — ${parsed} files READ of ${files.length} admitted, ${declCount.size} project keys ===`)
  if (absent > 0 || overCap > 0 || failed > 0) {
    console.log(`  population exclusions / failures, by the gate's rule (SIZE_CAP ${SIZE_CAP}):`)
    if (absent > 0) console.log(`    ${absent} tracked .dart file(s) absent from the working tree — not openable, not measured`)
    if (overCap > 0) console.log(`    ${overCap} file(s) over SIZE_CAP — the gate excludes them too, so the key spaces agree`)
    if (failed > 0) console.log(`    ${failed} file(s) threw in parseFile — counted here, not dropped`)
  }
  if (degraded > 0) {
    console.log(`  ${degraded} DEGRADED file(s) — counted, named, and the reason the gate refuses a PASS over this population:`)
    for (const d of degradedFiles.slice(0, 10)) console.log(`    ${d}`)
  } else {
    console.log(`  0 degraded files — every row below came from a real analyze()`)
  }
  for (const label of ["calls", "uses"]) {
    const m = perLabel.get(label)
    if (!m) continue
    const total = [...m.values()].reduce((a, b) => a + b.bare, 0)
    const qual = qualifiedByLabel.get(label) ?? 0
    console.log(`${label}: ${total} bare + ${qual} qualified = ${total + qual} rows`)
    console.log(`  (the ${qual} qualified rows carry no cause BY CONSTRUCTION — the cut labels only the rows that stayed bare)`)
    console.log(`  ${"cause".padEnd(30)}${"bare".padStart(9)}${"resolved".padStart(10)}${"amb".padStart(10)}${"unres".padStart(9)}`)
    for (const c of CAUSES) {
      const b = m.get(c)
      if (!b) continue
      console.log(`  ${c.padEnd(30)}${String(b.bare).padStart(9)}${String(b.resolved).padStart(10)}${String(b.amb).padStart(10)}${String(b.unres).padStart(9)}`)
    }
    const agg = { bare: 0, resolved: 0, amb: 0, unres: 0 }
    for (const [, b] of m) { agg.bare += b.bare; agg.resolved += b.resolved; agg.amb += b.amb; agg.unres += b.unres }
    console.log(`  ${"TOTAL".padEnd(30)}${String(agg.bare).padStart(9)}${String(agg.resolved).padStart(10)}${String(agg.amb).padStart(10)}${String(agg.unres).padStart(9)}`)
    const t = price.get(label)
    if (t) {
      const rows = [...t.entries()].sort((a, c) => c[1] - a[1])
      const tot = rows.reduce((a, c) => a + c[1], 0)
      console.log(`  PRICE of spelling \`<written type>.<member>\` on the ${tot} rows that carry a type name:`)
      for (const [k, v] of rows) console.log(`    today -> spelled: ${k.padEnd(24)}${String(v).padStart(7)}`)
    }
  }
}
