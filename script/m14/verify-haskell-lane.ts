/**
 * Is the Haskell lane DONE? A checklist that can be run, not an opinion.
 *
 * Modelled on verify-vb-lane.ts, and it exists for the same reason plus one more.
 * Several numbers in this lane's documentation were true when written and stopped
 * being true silently — most importantly the corpus mapping, which a merge deleted
 * so that the differential could not run at all, and nothing said so for as long as
 * anyone was willing to read the doc.
 *
 * And the two findings this gate exists to make impossible to miss again:
 *   - FIVE of the product's ten relationship types were never emitted by this lane,
 *     and `overrides` was in the AUDITED label set with zero rows on BOTH sides, so
 *     the audit was comparing nothing to nothing and reading green.
 *   - 4,510 `contains`/`references` edges had no second implementation to disagree
 *     with them, so they were assertions rather than measurements.
 * Criteria 8 and 9 are the two that would have caught those.
 *
 *   1. zero regex in the analyzer           — proven, not asserted
 *   2. no unknown symbol kinds
 *   3. no empty symbol names
 *   4. every relationship has a 1-based line
 *   5. every relationship's line is CORRECT
 *   6. no unexplained relationships         — the F5 differential, run HERE
 *   7. every node type the grammar emits is classified in the completeness spec
 *   8. every product relationship type is emitted by the lane
 *   9. every audited label has an INDEPENDENT oracle derivation
 *  10. every mutant is caught                — the suite can fail
 *  11. the F5 artifact is committed          — a scoped run must not write it
 *  12. M60 surfaces carry the lane
 *  13. the documentation matches the code
 *  14. the grammar pin is intact
 *
 * Every measurement is computed INLINE from the production entry and the oracle.
 * Nothing here reads a log, a cache, or a file outside the repo: the VB gate's
 * criterion 6 used to read /tmp and consequently failed on a clean tree and passed
 * on a stale one, which is the failure this file is written to not repeat.
 *
 * Exit 0 only when every criterion passes.
 */
import { readFileSync, existsSync } from "node:fs"
import { execFileSync } from "node:child_process"

const ANALYZER = "src/ast/real-haskell-analyzer.ts"
const ANALYZER_DOC = "docs/analyzers/real-haskell-analyzer.md"
const REVIEW = "reviews/haskell/master-review.md"
const SPEC = "script/m14/spec/haskell-completeness.json"
const PIN = "validation/m14/grammar-pins.json"
const CORPUS_ROOT = "$HOME/fixtures/repositories/postgrest"
const F5 = "validation/m14/results/M14.0.F5.json"
const PRODUCT_TYPES = ["calls", "extends", "implements", "uses", "imports", "exports",
                       "contains", "references", "overrides", "instantiates"] as const

type Row = { n: number; name: string; ok: boolean; detail: string; blocking: boolean }
const rows: Row[] = []
const add = (n: number, name: string, ok: boolean, detail: string, blocking = true) =>
  rows.push({ n, name, ok, detail, blocking })

const run = (cmd: string, args: string[], env: Record<string, string> = {}): { code: number; out: string } => {
  try {
    const out = execFileSync(cmd, args, {
      encoding: "utf8", env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"], maxBuffer: 256 * 1024 * 1024,
    })
    return { code: 0, out }
  } catch (e: any) {
    return { code: typeof e.status === "number" ? e.status : 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` }
  }
}

const KNOWN_KINDS = new Set(["module", "function", "class", "interface", "type", "struct", "enum",
  "variable", "property", "field", "method", "constructor", "constant", "namespace", "trait",
  "object", "union", "record", "protocol", "data", "newtype", "typeclass", "instance", "signature",
  "operator", "pattern", "case", "module_parameter", "import", "fold"])
// Contract literals: a relationship target the SOURCE names differently. Haskell
// has neither today (`constructor`/`operator` are the vb/csharp spelling), so this
// list is empty on purpose — an empty exclusion is itself the check.
const CONTRACT_TARGETS = new Set<string>([])
// RESOLVED targets: the analyzer publishes a canonical name for a construct the
// source spells differently, so a literal search for it can never succeed. There
// is exactly one in this lane today: Haskell's list type constructor is named
// `[]`, and `instance Mergeable [a] where` resolves its instance head to `[]`.
// The committed fixture declares this on purpose ("List-parametrized instance:
// target resolves to []"), so it is a designed resolution and not a defect.
// Named and counted rather than folded into the check, because a loosened
// criterion that nobody can audit is how a real wrong line gets waved through.
const RESOLVED_TARGETS = new Map<string, string>([["[]", "Haskell's list type constructor, resolved from `[a]`"]])

// ---------------------------------------------------------------------------
// one corpus sweep, reused by criteria 2-5, 8 and 9
const { parseFile, getParser } = await import("../../src/ast/engine.ts")
const { deriveHaskellEdges } = await import("./differential.ts")
const AUDITED = ["calls", "extends", "implements", "instantiates", "overrides",
                 "contains", "imports", "exports", "uses", "references"] as const

// The corpus PLUS the committed fixtures. The fixtures are not padding: the
// postgrest corpus contains no superclass context at all, so `extends` — which
// the analyzer DOES implement and the fixture exercises — is emitted nowhere in
// it. Measuring the corpus alone made a working relationship type read as
// "never emitted", which is the same shape of false negative as the audited-but-
// empty label that read green. A construct the corpus lacks is not a construct
// the lane cannot do.
const FIXTURES = ["validation/m12/fixtures/haskell/Service.hs",
                  "validation/m12/fixtures/haskell/Negative.hs",
                  "validation/m14/fixtures/haskell/payload-and-complexity.hs"]
const files = [
  ...run("bash", ["-lc", `find ${CORPUS_ROOT} -name '*.hs' -not -path '*/.git/*' | sort`])
    .out.trim().split("\n").filter(Boolean),
  ...FIXTURES.filter((f) => existsSync(f)),
]

let swept = 0, crashed = 0
let syms = 0, rels = 0
let unknownKinds = 0, unknownNames = new Set<string>()
let noLine = 0, wrongLine = 0, resolved = 0
const wrongSamples: string[] = []
const typeCounts = new Map<string, number>()
const emittedTypes = new Set<string>()
const truth = new Map<string, Set<string>>()
const got = new Map<string, Set<string>>()
for (const l of AUDITED) { truth.set(l, new Set()); got.set(l, new Set()) }

const parser = await getParser("haskell")
for (const f of files) {
  const src = readFileSync(f, "utf8")
  let tree: any, r: any
  try {
    tree = (parser as any).parse(src)
    r = await parseFile(f, src)
  } catch { crashed++; continue }
  swept++

  const lines = src.split("\n")
  const census = (n: any) => {
    typeCounts.set(n.type, (typeCounts.get(n.type) ?? 0) + 1)
    for (let i = 0; i < n.childCount; i++) census(n.child(i))
  }
  census(tree.rootNode)

  for (const s of (r as any).symbols ?? []) {
    syms++
    if (!KNOWN_KINDS.has(String(s.kind))) { unknownKinds++; unknownNames.add(String(s.kind)) }
    if (!s.name || String(s.name).trim() === "") unknownNames.add("<empty>")
  }
  for (const x of (r as any).relationships ?? []) {
    rels++
    emittedTypes.add(x.type)
    got.get(x.type)?.add(`${x.source}|${x.target}`)
    // the product reads `line_number` (parallel-indexer.ts:2954); `line` is not it
    const ln = x.line_number
    if (typeof ln !== "number" || ln <= 0) { noLine++; continue }
    if (CONTRACT_TARGETS.has(String(x.target))) continue
    if (RESOLVED_TARGETS.has(String(x.target))) { resolved++; continue }
    const leaf = String(x.target).split(".").pop()!.split("(")[0]!.slice(-40)
    if (leaf && !lines[ln - 1]?.includes(leaf)) {
      wrongLine++
      if (wrongSamples.length < 4) wrongSamples.push(`${x.type} ${x.source} -> ${x.target} @${ln}`)
    }
  }
  for (const e of deriveHaskellEdges(tree.rootNode) as any[]) {
    if ((truth.get(e.label) as Set<string> | undefined)) truth.get(e.label)!.add(`${e.from}|${e.target}`)
  }
}

// 1 — zero regex, proven
{
  const code = readFileSync(ANALYZER, "utf8")
    .split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*")).join("\n")
  const found: string[] = []
  if (/new RegExp/.test(code)) found.push("new RegExp")
  // Only a REGEX LITERAL counts. A plain string argument is not a pattern:
  // `content.split("\n")` is a line count, not a match, and including `"` in the
  // character class flagged it — a false positive in the gate, which is the one
  // place a false positive is most expensive, because it teaches people to ignore
  // the gate. A backtick template is still treated as pattern-like.
  if (/\.(match|matchAll|replace|replaceAll|split|search)\(\s*[/`]/.test(code)) found.push("pattern-taking string method")
  if (/\.(test|exec)\(\s*[/`]/.test(code)) found.push("RegExp.test/exec")
  add(1, "zero regex in the analyzer", found.length === 0,
    found.length ? `found: ${found.join(", ")}` : `no RegExp and no pattern-taking method in ${code.split("\n").length} lines`)
}

// 2/3/4/5 — from the sweep above
add(2, "no unknown symbol kinds", unknownKinds === 0,
  unknownKinds === 0 ? `0 of ${syms} symbols have a kind outside the product's own set`
                     : `${unknownKinds} symbols: ${[...unknownNames].slice(0, 5).join(", ")}`)
add(3, "no empty symbol names", !unknownNames.has("<empty>"),
  unknownNames.has("<empty>") ? "at least one symbol has an empty name" : `0 of ${syms} symbols have an empty name`)
add(4, "every relationship has a 1-based line", noLine === 0,
  noLine === 0 ? `0 of ${rels} relationships lack a positive line_number` : `${noLine} of ${rels} lack one`)
add(5, "relationship lines are CORRECT", wrongLine === 0,
  wrongLine === 0 ? `0 of ${rels} cite a line where the target name is absent` +
      (resolved ? ` (${resolved} resolved-target edges excluded and named: ${[...RESOLVED_TARGETS.keys()].join(", ")})` : "")
    : `${wrongLine} of ${rels} do: ${wrongSamples.join("; ")}`)

// 6 — the differential, RUN HERE (never read from a file)
{
  const { out } = run("bun", ["run", "script/m14/differential.ts", "--lang", "haskell", "--sample", "60"],
    { BB_F5_FREEZE_POOL: "1" })
  const m = /files=(\d+) tree-truth=(\d+) covered=\d+ \([\d.]+%\)(?: covered)? MISSING=(\d+) \| analyzer-edges=(\d+) unexplained=(\d+)/.exec(out)
  if (!m) {
    const err = /corpus repo missing: (\S+)/.exec(out)?.[1]
    add(6, "no unexplained relationships (F5)", false,
      err ? `corpus repo missing: ${err}` : `the differential produced no summary line — ${out.trim().split("\n").slice(-1)[0]?.slice(0, 90)}`)
  } else {
    const unexplained = Number(m[5])
    add(6, "no unexplained relationships (F5)", unexplained === 0,
      `${m[1]} files, ${m[2]} truth edges, MISSING=${m[3]}, analyzer-edges=${m[4]}, unexplained=${unexplained}`)
  }
}

// 7 — every node type the grammar emits is classified in the spec
{
  const spec = JSON.parse(readFileSync(SPEC, "utf8"))
  const declared = new Set<string>([
    ...(spec.handled_verified?.types ?? []),
    ...(spec.internal_silent?.types ?? []),
    ...(spec.gap?.gaps ?? []).flatMap((g: any) => String(g.node_type ?? "").split(",").map((t: string) => t.trim())),
  ])
  const emitted = [...typeCounts.keys()]
  const unclassified = emitted.filter((t) => !declared.has(t))
  add(7, "every emitted node type is classified", unclassified.length === 0,
    unclassified.length === 0
      ? `all ${emitted.length} node types emitted over ${swept} files are classified (${spec.handled_verified.types.length} handled, ${spec.internal_silent.types.length} silent, ${spec.gap.gaps.length} gaps)`
      : `${unclassified.length} unclassified: ${unclassified.slice(0, 8).join(", ")}`)
}

// 8 — every product relationship type is emitted
{
  const missing = PRODUCT_TYPES.filter((t) => !emittedTypes.has(t))
  add(8, "every product relationship type is emitted", missing.length === 0,
    missing.length === 0
      ? `all ${PRODUCT_TYPES.length} of the product's relationship types appear over ${swept} files`
      : `${missing.length} never emitted: ${missing.join(", ")}`)
}

// 9 — every audited label has an independent oracle derivation
{
  const per: string[] = []
  let totalTruth = 0, totalCovered = 0, totalExtra = 0, labelsWithRows = 0
  for (const l of AUDITED) {
    const T = truth.get(l)!, G = got.get(l)!
    let covered = 0
    for (const k of T) if (G.has(k)) covered++
    const extra = [...G].filter((k) => !T.has(k)).length
    totalTruth += T.size; totalCovered += covered; totalExtra += extra
    if (T.size || G.size) labelsWithRows++
    if (covered !== T.size || extra) per.push(`${l} ${covered}/${T.size}+${extra}`)
  }
  // an audited label with NO oracle row is the failure that read green once:
  // `overrides` was audited, and both sides were empty, and it passed.
  const noDerivation = AUDITED.filter((l) => truth.get(l)!.size === 0 && got.get(l)!.size === 0)
  add(9, "every audited label has an independent oracle derivation", noDerivation.length === 0,
    noDerivation.length === 0
      ? `${labelsWithRows}/${AUDITED.length} audited labels derive rows; ${totalCovered}/${totalTruth} covered, ${totalExtra} analyzer-only${per.length ? ` — differs on: ${per.join(", ")}` : " — zero discrepancy on every label"}`
      : `audited but neither side derived a row: ${noDerivation.join(", ")} — the audit was comparing nothing to nothing`)
}

// 10 — mutants
{
  const { out } = run("bun", ["run", "script/m14/mutate-analyzer.ts"], { BB_MUTANT_ONLY: "haskell/" })
  const all = /all (\d+) mutants caught/.exec(out)
  const surv = /(\d+) SURVIVING/.exec(out)
  add(10, "every mutant is caught", !!all && !surv,
    all ? `${all[1]} mutants, 0 surviving` : "no 'all caught' line — survivors or no mutants ran")
}

// 11 — the canonical F5 artifact, and it must describe the CURRENT analyzer
{
  const has = existsSync(F5)
  let detail = "artifact absent"
  let ok = false
  if (has) {
    const j = JSON.parse(readFileSync(F5, "utf8"))
    const report = j.data?.report ?? {}
    const lanes = Object.keys(report)
    if (!lanes.includes("haskell")) {
      detail = `artifact present but NO haskell row (it carries ${lanes.length} lanes)`
    } else {
      // PRESENCE IS NOT ENOUGH. This lane's artifact row was measured against an
      // analyzer that emitted 417 edges on the sample; the current one emits
      // ~10,000, because `imports`, `exports`, `overrides` and `uses` did not exist
      // when the row was written. A row that is present and STALE is a worse green
      // than a missing row, because it looks like the work was measured.
      //
      // So the row must also POSTDATE the last change to the lane's analyzer and
      // oracle. Compared against the artifact's own recorded `commit`.
      const artCommit = String(j.commit ?? "")
      const lastTouch = run("git", ["log", "-1", "--format=%H",
        "--", "src/ast/real-haskell-analyzer.ts", "script/m14/differential.ts"]).out.trim()
      const stale = !!artCommit && !!lastTouch && artCommit !== lastTouch
      // is the analyzer's last change an ANCESTOR of the artifact's commit?
      const ancestor = stale
        ? run("git", ["merge-base", "--is-ancestor", lastTouch, artCommit]).code === 0
        : false
      ok = !stale || ancestor
      detail = ok
        ? `artifact carries a haskell row and it postdates the last analyzer change (${lanes.length} lanes)`
        : `artifact row is STALE — measured at ${artCommit.slice(0, 12)}, but the analyzer/oracle last changed at ${lastTouch.slice(0, 12)}. ` +
          `The row describes an analyzer that emitted 417 edges on its sample; this one emits far more. ` +
          `A present-but-stale row is a worse green than a missing one.`
    }
  }
  add(11, "M14.0.F5 artifact carries the lane", ok,
    `${detail} — a scoped \`--lang haskell\` run deliberately refuses to write it, so this needs the 42-language sweep`)
}

// 12 — M60 surfaces
{
  const gaps: string[] = []
  const art = "validation/m60/haskell/lane-surface-audit.json"
  let detail = "no lane artifact"
  if (!existsSync("validation/m60/haskell")) gaps.push("no validation/m60/haskell/ lane directory")
  if (existsSync(art)) {
    const j = JSON.parse(readFileSync(art, "utf8"))
    const arr = Array.isArray(j) ? j : [j]
    const r = arr.find((x: any) => x.lang === "haskell") ?? arr[0]
    const labels = Object.keys(r?.labels ?? {}).length
    const bad = (r?.badNames ?? []).length
    const ghosts = r?.ghostCount ?? 0
    detail = `${r?.files} files, ${r?.edges} edges over ${labels} labels, ${bad} names-not-in-source, ${ghosts} ghost targets`
    if (bad > 0) gaps.push(`${bad} symbol names not written in their own file`)
    if (ghosts > 0) gaps.push(`${ghosts} relationship targets whose name is in no source file`)
    if (labels < 5) gaps.push(`only ${labels} relationship labels exercised`)
  } else {
    gaps.push("no validation/m60/haskell/lane-surface-audit.json")
  }
  add(12, "M60 surfaces carry the lane", gaps.length === 0, gaps.length ? gaps.join("; ") : detail)
}

// 13 — docs match the code
{
  const missing: string[] = []
  if (!existsSync(ANALYZER_DOC) || !/Relationship ontology/.test(readFileSync(ANALYZER_DOC, "utf8")))
    missing.push(`missing or stale: ${ANALYZER_DOC}`)
  if (!existsSync(REVIEW)) missing.push(`missing: ${REVIEW}`)
  const specFresh = existsSync(SPEC) && /HS-D1[01]/.test(readFileSync(SPEC, "utf8"))
  if (!specFresh) missing.push(`stale: ${SPEC} records no M60-HK decision`)
  add(13, "documentation present and current", missing.length === 0,
    missing.length ? missing.join("; ")
      : `analyzer doc + master review + completeness spec all present and carrying the M60-HK wave`)
}

// 14 — the grammar pin
{
  const pin = existsSync(PIN) ? JSON.parse(readFileSync(PIN, "utf8")) : null
  const lane = pin?.lanes?.haskell
  const dirty = run("git", ["status", "--short", "grammars/tree-sitter-haskell", "wasm/tree-sitter-haskell.wasm"]).out.trim()
  add(14, "grammar pin intact and unmodified", !!lane && dirty === "",
    lane ? `pinned, ${dirty === "" ? "working tree clean" : `DIRTY: ${dirty}`}` : "no pin entry for haskell")
}

// ---------------------------------------------------------------------------
const blocking = rows.filter((r) => !r.ok && r.blocking)
const width = Math.max(...rows.map((r) => r.name.length))
console.log(`Haskell lane completion audit — ${rows.length - blocking.length}/${rows.length} criteria met`)
console.log(`corpus: ${swept} files swept, ${crashed} unreadable, ${syms} symbols, ${rels} relationships\n`)
for (const r of rows) console.log(`  ${String(r.n).padStart(2)}. ${r.ok ? "PASS" : "FAIL"}  ${r.name.padEnd(width)}  ${r.detail}`)
console.log("")
if (blocking.length) {
  console.log(`NOT DONE. ${blocking.length} criterion/criteria open: ${blocking.map((r) => r.n).join(", ")}`)
  process.exit(2)
}
console.log("Every criterion met. The lane is done by this checklist's definition.")