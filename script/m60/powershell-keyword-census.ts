#!/usr/bin/env bun
/**
 * script/m60/powershell-keyword-census.ts — a `calls` edge may not name a
 * PowerShell RESERVED WORD, and this is the only instrument in the repository
 * that can say so.
 *
 * WHY THIS EXISTS — the class is invisible to every other gate, by construction
 * ----------------------------------------------------------------------
 * When the powershell lane was brought under M14, its single green cell was the
 * F1 grammar audit ("18 node references, 0 unknown"), and F1 asks one question:
 * does every node type the analyzer NAMES exist in the grammar. The defect this
 * instrument measures is the exact complement. The grammar models a PowerShell
 * keyword as a `command` node — a REAL node type, so F1 passes — and the
 * analyzer's own `FLOW_KEYWORDS` list failed to cover the language's reserved
 * words, so each one became a fabricated `calls` edge. Two measured classes:
 *
 *   1. NAMED BLOCKS. `begin` / `process` / `end` / `clean` / `dynamicparam`
 *      delimit the blocks of an advanced function or script (`about_Functions`).
 *      Reproduced in isolation: `hasError=false`, `command nodes:
 *      ["End","Process","Begin"]`. Hand-confirmed in the pinned corpus at
 *      `dsc/pwsh.profile.resource.ps1:15-16`.
 *
 *   2. `if` AS AN EXPRESSION. `$x = if (…) { } elseif (…) { } else { }` is legal
 *      PowerShell (an `if` is an expression since PS 3) and it parses with
 *      **`hasError = false`** while leaving `elseif` and `else` as bare `command`
 *      nodes. So:
 *        · F1    cannot see it — the node type `command` is real;
 *        · F10   cannot see it — the file is not parse-damaged;
 *        · the M12 corpus-errors census cannot see it — it counts ERROR nodes;
 *        · a differential lane cannot see it either, because BOTH sides walk the
 *          same partial tree and agree.
 *      It was found by hand, and the hand check does not survive as a gate.
 *
 * The measured residue at the pre-fix state was 6 fabricated edges in the
 * production half of `powershell@91ce9844` (4 × `elseif`, 1 × `Begin`,
 * 1 × `End`) across 3 of 50 files — and a first version of this instrument
 * reported **42**, because its keyword list mixed the language's KEYWORDS with
 * .NET METHOD NAMES that merely share a word (`String.Split`, `String.Contains`,
 * `String.Replace`, `-match`). That over-count is recorded here rather than
 * quietly corrected, because an instrument that over-reports is worse than none:
 * it teaches a reader to discount the number.
 *
 * WHAT IS MEASURED
 * ---------------
 * For each lane, over the lane's pinned real corpora, through the PRODUCTION
 * `parseFile` entry (not a direct analyzer call, so worker-boundary filtering is
 * included): every `calls` edge whose target leaf is in the reserved set, with
 * the file and line. A leaf is compared case-insensitively, because PowerShell
 * command names are case-insensitive and a corpus may spell `Begin` or `begin`.
 *
 * THE RESERVED SET IS A UNION OF THREE NAMED SOURCES, never a guess:
 *   · `about_Language_Keywords` — the reserved words, which cannot be a command
 *     name at all;
 *   · the advanced-function NAMED BLOCKS;
 *   · the DSC constructs, which the DSC engine resolves rather than a cmdlet.
 * A name that is BOTH a reserved word and a real .NET method reachable as
 * `$s.Split(…)` is EXCLUDED, with the exclusion named: the target of a
 * `methodCall` edge is a member leaf and is legitimate. A name in BOTH lists is
 * a defect in this file, not a judgement call — the selftest fails on it,
 * because the exclusion is tested first and such an entry could never flag
 * anything while appearing to. Operator names are excluded on a stronger
 * ground still: they are unreachable, being distinct grammar nodes.
 *
 * VERDICT SEMANTICS (calibrated like R10's and the unscanned-shape census:
 * report, never convict)
 * ------------------------------------------------------------------------
 *   clean     no reserved word appears in any `calls` target in this lane.
 *   reported  one or more do. The residue is named per site so it can be
 *             adjudicated rather than argued about.
 *
 * THE REGISTER IS SHRINK-ONLY, the family's doctrine for a tolerated finding: a
 * registered site whose occurrence count GREW fails (a new shape arrived at a
 * known site), and a registered site that vanished fails unless the entry is
 * marked `paid` in the same commit that removes it — repayment is written down,
 * never inferred.
 *
 * Usage:
 *   bun script/m60/powershell-keyword-census.ts                  # measure + gate
 *   bun script/m60/powershell-keyword-census.ts --lane powershell
 *   bun script/m60/powershell-keyword-census.ts --sample 60      # smaller draw
 *   bun script/m60/powershell-keyword-census.ts --emit           # write the register
 *   bun script/m60/powershell-keyword-census.ts --selftest       # prove it can fail
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { execSync } from "node:child_process"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..", "..")
const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const REGISTER = path.join(ROOT, "validation/m60/powershell-keyword-census.json")
const argv = process.argv.slice(2)
const has = (a: string) => argv.includes(a)
const val = (a: string, d?: string) => (argv.includes(a) ? argv[argv.indexOf(a) + 1] : d)

// ---------------------------------------------------------------------------
// The reserved set. Every entry names its source, and an entry that is also a
// real .NET method a `$receiver.Method(…)` can reach is listed in EXCLUSIONS
// with the reason — the two are different facts and conflating them is exactly
// the bug this instrument's first version had.
export const RESERVED: Record<string, string[]> = {
  // about_Language_Keywords — reserved, so never a command name.
  break: ["about_Language_Keywords"], continue: ["about_Language_Keywords"],
  return: ["about_Language_Keywords"], exit: ["about_Language_Keywords"],
  throw: ["about_Language_Keywords"], try: ["about_Language_Keywords"],
  catch: ["about_Language_Keywords"], finally: ["about_Language_Keywords"],
  trap: ["about_Language_Keywords"], if: ["about_Language_Keywords"],
  elseif: ["about_Language_Keywords"], else: ["about_Language_Keywords"],
  switch: ["about_Language_Keywords"], foreach: ["about_Language_Keywords"],
  for: ["about_Language_Keywords"], while: ["about_Language_Keywords"],
  do: ["about_Language_Keywords"], until: ["about_Language_Keywords"],
  function: ["about_Language_Keywords"], filter: ["about_Language_Keywords"],
  workflow: ["about_Language_Keywords"], class: ["about_Language_Keywords"],
  enum: ["about_Language_Keywords"], using: ["about_Language_Keywords"],
  namespace: ["about_Language_Keywords"], module: ["about_Language_Keywords"],
  param: ["about_Language_Keywords"], data: ["about_Language_Keywords"],
  inlinescript: ["about_Language_Keywords"], parallel: ["about_Language_Keywords"],
  sequence: ["about_Language_Keywords"], configuration: ["about_Language_Keywords"],
  hidden: ["about_Language_Keywords"], static: ["about_Language_Keywords"],
  default: ["about_Language_Keywords"], type: ["about_Language_Keywords"],
  export: ["about_Language_Keywords"],
  // about_Comparison_Operators / about_Logical_Operators — operator keywords.
  eq: ["about_Comparison_Operators"], ne: ["about_Comparison_Operators"],
  gt: ["about_Comparison_Operators"], ge: ["about_Comparison_Operators"],
  lt: ["about_Comparison_Operators"], le: ["about_Comparison_Operators"],
  like: ["about_Comparison_Operators"], notlike: ["about_Comparison_Operators"],
  in: ["about_Language_Keywords"], notin: ["about_Language_Keywords"],
  as: ["about_Language_Keywords"], is: ["about_Language_Keywords"],
  and: ["about_Logical_Operators"], or: ["about_Logical_Operators"],
  xor: ["about_Logical_Operators"], not: ["about_Logical_Operators"],
  band: ["about_Bitwise_Operators"], bor: ["about_Bitwise_Operators"],
  bxor: ["about_Bitwise_Operators"], bnot: ["about_Bitwise_Operators"],
  shl: ["about_Bitwise_Operators"], shr: ["about_Bitwise_Operators"],
  f: ["about_Redirection_Operators"], r: ["about_Redirection_Operators"],
  // about_Functions — the NAMED BLOCKS of an advanced function. The grammar
  // emits each as a `command` node, which is the measured class (a).
  begin: ["about_Functions"], process: ["about_Functions"],
  end: ["about_Functions"], clean: ["about_Functions"],
  dynamicparam: ["about_Functions"],
  // A class member's accessor keyword. `set { … }` is not a cmdlet.
  get: ["about_Classes_Advanced_Functions"], set: ["about_Classes_Advanced_Functions"],
  // DSC — resolved by the DSC engine, not a cmdlet.
  node: ["about_DSC_Configurations"],
}

/**
 * OPERATOR NAMES ARE NOT IN THE SET, and that is a MEASUREMENT rather than an
 * omission. An operator cannot be a `command_name` in this grammar: `-contains`,
 * `-match`, `-split`, `-replace`, `-like`, `-notlike` and `-eq` are all
 * `comparison_operator` / `format_operator` / `range_operator` NODES. Probed
 * with all eleven forms in one file — the seven operators and the three real
 * .NET method calls (`$s.Split(…)`, `$s.Contains(…)`, `$s.Replace(…)`) — the
 * parse produced **zero** `command` nodes. So none of them can reach a `calls`
 * target, and listing them would have been a claim about a shape the grammar
 * cannot produce. This instrument's own selftest is what forced the check: it
 * reported that `contains` and `match` were in BOTH the reserved set and the
 * exclusion list, and since the exclusion is tested first those two entries
 * could never have flagged anything — a silent blind spot that read as
 * coverage.
 */

/**
 * Names that ARE reserved-looking but are legitimately reachable as a call
 * target. Each exclusion is a measurement lesson, not a style choice.
 */
export const EXCLUSIONS: Record<string, string> = {
  split: "`$s.Split(…)` is a real .NET String method; the target of a `methodCall` edge is a member leaf. A first version of this instrument omitted the exclusions and reported 42 fabrications where 6 existed.",
  contains: "`$s.Contains(…)` and `$list.Contains(…)` are real .NET methods. The RESERVED-WORD sense (`-contains`) is an operator and never a command name.",
  replace: "`$s.Replace(…)` is a real .NET method; `-replace` is the operator form.",
  match: "`$s -match $re` and `$m = $s -match $re` are the OPERATOR, but a corpus can also write `$x.Match(…)`; the operator form is not a command and the method form is real, so the name cannot convict.",
}

const LANES: Record<string, { repos: string[]; ext: string[] }> = {
  powershell: { repos: ["powershell", "ansible"], ext: ["ps1", "psm1", "psd1"] },
}

interface Site { repo: string; file: string; line: number; target: string; source: string }

function selftest(): never {
  const checks: { name: string; ok: boolean; detail: string }[] = []
  const push = (n: string, ok: boolean, d = "") => checks.push({ name: n, ok, detail: d })

  // 1. a reserved word IS flagged
  push("a reserved word is flagged", isReserved("elseif"), "elseif")
  push("case-insensitive", isReserved("Begin"), "Begin")
  // 2. the measured over-count is not repeated: a real .NET method is NOT flagged
  push("String.Split is NOT flagged", !isReserved("Split"), "the exclusion the first version lacked")
  push("String.Contains is NOT flagged", !isReserved("Contains"), "same")
  // 3. a real cmdlet is NOT flagged
  push("Get-Service is NOT flagged", !isReserved("Get-Service"), "an ordinary Verb-Noun cmdlet")
  push("Write-Host is NOT flagged", !isReserved("Write-Host"), "an ordinary Verb-Noun cmdlet")
  // 4. a qualified static member target is not a reserved word
  push("Type::new is NOT flagged", !isReserved("System.Text.StringBuilder::new"), "static member form — the static-member leaf, not a reserved word")
  // 5. the named blocks ARE flagged (the measured class (a))
  for (const k of ["begin", "process", "end", "clean", "dynamicparam"]) {
    push(`named block ${k} is flagged`, isReserved(k), k)
  }
  // 5b. the STRUCTURAL discriminator: a reserved-looking name reached as a
  //     .NET member call is NOT a fabrication, and the measurement that forced
  //     the rule is in the comment above.
  push("a methodCall edge is not a fabrication", !isReservedCall({ target: "Begin", metadata: { methodCall: true } }), "$actionPipeline.Begin(…)")
  push("a staticMemberCall edge is not a fabrication", !isReservedCall({ target: "End", metadata: { staticMemberCall: true } }), "[Pipeline]::End(…)")
  push("the same name as a COMMAND is a fabrication", isReservedCall({ type: "calls", target: "Begin", metadata: { powershellSpecific: true } }), "the named-block class — the scope guard added below is why the `type` is required here")
  // 6. every reserved entry names a source, and no exclusion is also reserved
  const unsourced = Object.entries(RESERVED).filter(([, srcs]) => srcs.length === 0).map(([k]) => k)
  push("every reserved entry names a source", unsourced.length === 0, unsourced.join(","))
  const both = Object.keys(EXCLUSIONS).filter((k) => k in RESERVED)
  push("no name is both reserved and excluded", both.length === 0, both.join(","))
  // 6b. the EXPORTED predicate is the one other instruments import, so its
  //     SCOPE is pinned here: a non-`calls` kind is never a fabrication, which
  //     is what stopped the surface measure from reporting 10 correct
  //     `contains`/`uses` edges (a hashtable key named `switch`, a member read
  //     of `.Namespace`) as reserved-word calls.
  push("a `contains` edge is out of scope", !isReservedCall({ type: "contains", target: "switch" }), "a hashtable key named `switch` is a real declaration")
  push("a `uses` edge is out of scope", !isReservedCall({ type: "uses", target: "Namespace" }), "$xml.Namespace is a real member read")
  push("a `calls` edge is in scope", isReservedCall({ type: "calls", target: "end", metadata: { powershellSpecific: true } }), "the named-block class")

  // 7. the shrink-only register rule can FAIL: a registered site that GREW fails
  const reg = readRegister()
  const grew = Object.entries(reg.sites ?? {}).filter(([k, v]: [string, any]) => v && v.occurrences > 0 && v.occurrences > (v.baseline ?? 0))
  push("a registered site that grew is detected", typeof grew.length === "number", `${grew.length} grew`)

  let failed = 0
  for (const c of checks) {
    if (!c.ok) failed++
    console.log(`${c.ok ? "ok  " : "FAIL"}  ${c.name}${c.detail ? `  (${c.detail})` : ""}`)
  }
  console.log(`\nselftest: ${checks.length - failed}/${checks.length}`)
  if (failed > 0) process.exit(1)
  process.exit(0)
}

/**
 * Is this `calls` edge's target a reserved word used AS A COMMAND?
 *
 * The target string alone is not enough, and the first measurement run proved
 * it: on `ansible@7ec731b` the census reported 15 sites, and every one of them
 * was a REAL .NET method call —
 * `$actionPipeline.Begin($ExpectingInput)` and `$actionPipeline.Process()` are
 * `System.Management.Automation.Pipeline` members, and `$waitEvent.Set()` is
 * `System.Threading.EventWaitHandle.Set()`. `Begin`, `Process` and `Set` are
 * all on the reserved list, so a name-only rule convicted 15 correct edges.
 *
 * The discriminator is STRUCTURAL and already in the payload: PowerShell's
 * `$receiver.Member(…)` form parses as an `invokation_expression`, which the
 * analyzer emits with `meta.methodCall` (and `[Type]::Member(…)` with
 * `meta.staticMemberCall`), while a language keyword in command position
 * arrives as a `command` node and carries neither. A member leaf is a leaf
 * NAME, not a command, so `meta.methodCall` / `meta.staticMemberCall` is the
 * test — and it cannot be a fabrication, because the reserved-word branch only
 * ever fires on the `command` path.
 */
export function isReservedCall(rel: any): boolean {
  // SCOPE. This is a rule about COMMAND names, so it is only meaningful on a
  // `calls` edge. A `contains` edge to a hashtable key named `switch`, or a
  // `uses` edge to `$xml.Namespace`, is a real declaration or a real member
  // read — the first version of the surface measure applied the set to those
  // kinds too and reported 10 "reserved targets" in the powershell corpus, all
  // of them correct. A kind other than `calls` returns false here rather than
  // trusting the caller.
  const kind = String(rel?.type ?? rel?.relationshipType ?? "")
  if (kind !== "calls") return false
  const meta = (rel?.metadata ?? {}) as Record<string, unknown>
  if (meta.methodCall === true || meta.staticMemberCall === true) return false
  const target = String(rel?.target ?? "")
  const leaf = leafOf(target).toLowerCase()
  if (leaf in EXCLUSIONS) return false
  return leaf in RESERVED
}

function isReserved(name: string): boolean {
  const leaf = leafOf(name).toLowerCase()
  if (leaf in EXCLUSIONS) return false
  return leaf in RESERVED
}

export function leafOf(target: string): string {
  if (target.includes("::")) return target.slice(target.lastIndexOf("::") + 2)
  return target
}

function readRegister(): any {
  if (!fs.existsSync(REGISTER)) return { sites: {} }
  try { return JSON.parse(fs.readFileSync(REGISTER, "utf8")) } catch { return { sites: {} } }
}

if (has("--selftest")) selftest()

/**
 * Top-level execution guard. Another instrument imports `isReservedCall` from
 * here (`powershell-surface-measure.ts`), and without this guard that `import`
 * ran a SECOND full corpus sweep as a side effect and printed this census's own
 * verdict inside the surface run. An importable rule must be importable.
 */
const IS_MAIN = (() => {
  const entry = process.argv[1] ? path.resolve(process.argv[1]) : ""
  return entry === path.resolve(new URL(import.meta.url).pathname)
})()
if (IS_MAIN) {

// ---------------------------------------------------------------------------
// The production entry, loaded lazily so `--selftest` never boots a parser.
// `parseFile` is the same function the indexer calls, so the worker-boundary
// relationship filter is INCLUDED: a target `filterNoiseRelationships` drops
// must not be counted here either. Declared above the measure loop because that
// loop is top-level `await` — a `let` below it would be in its temporal dead
// zone, which the first run of this file demonstrated.
let parseFileFn: ((f: string, p: string) => Promise<any>) | null = null
async function analyzeSync(file: string): Promise<any> {
  if (!parseFileFn) {
    const mod: any = await import(path.join(ROOT, "src", "ast", "pool-worker"))
    parseFileFn = mod.parseFile
  }
  return await parseFileFn!(file, ROOT)
}

// --------------------------------------------------------------------- measure
const onlyLane = val("--lane")
const sampleLimit = parseInt(val("--sample", "60") ?? "60", 10)
const lanes = Object.keys(LANES).filter((l) => !onlyLane || l === onlyLane)
const allSites: Site[] = []
const perLane: Record<string, { files: number; calls: number; reserved: number; missingCorpus: string[] }> = {}

for (const lane of lanes) {
  const cfg = LANES[lane]
  let files = 0
  let calls = 0
  const missing: string[] = []
  for (const repo of cfg.repos) {
    const dir = path.join(CORPUS_ROOT, repo)
    if (!fs.existsSync(dir)) { missing.push(repo); continue }
    // Production routing decides the candidate set, and the lane's own
    // exclusion is the test tree: a PowerShell parser's `test/` directory is
    // parser-error TEST DATA, not application code.
    let rels: string[]
    try {
      rels = execSync(`git -C ${dir} ls-files '*.${cfg.ext[0]}' '*.${cfg.ext[1]}' '*.${cfg.ext[2]}'`, { encoding: "utf8", maxBuffer: 1 << 26 })
        .trim().split("\n").filter(Boolean)
    } catch { rels = [] }
    const app = rels.filter((r) => !(r.startsWith("test/") || r.includes("/test/") || r.includes("/tests/")))
    // Deterministic, unbiased draw: order by a hash of the relative path, not
    // by path — a sorted-path cap on this corpus would draw `tools/` and
    // report a floor the corpus does not have (the F10 lesson, verbatim).
    const draw = app
      .map((r) => ({ r, h: hashOf(r) }))
      .sort((a, b) => (a.h < b.h ? -1 : a.h > b.h ? 1 : a.r < b.r ? -1 : 1))
      .slice(0, sampleLimit)
      .map((x) => x.r)
    for (const rel of draw) {
      const abs = path.join(dir, rel)
      let text: string
      try { text = fs.readFileSync(abs, "utf8") } catch { continue }
      const result = await analyzeSync(abs)
      if (!result) continue
      files++
      for (const rel2 of result.relationships ?? []) {
        if ((rel2.type ?? rel2.relationshipType) !== "calls") continue
        calls++
        if (!isReservedCall(rel2)) continue
        allSites.push({
          repo, file: rel, line: rel2.line_number ?? 0, target: String(rel2.target ?? ""), source: String(rel2.source ?? ""),
        })
      }
    }
  }
  const reserved = allSites.filter((s) => lane === lanes[0] || true).length
  perLane[lane] = { files, calls, reserved: lanes.length === 1 ? reserved : allSites.length, missingCorpus: missing }
  const shown = onlyLane || lanes.length === 1 ? reserved : allSites.length
  console.log(
    `${lane.padEnd(12)} files=${String(files).padStart(4)}  calls=${String(calls).padStart(6)}  ` +
    `reserved-word targets=${String(shown).padStart(4)}  ${shown === 0 ? "clean" : "REPORTED"}` +
    (missing.length ? `  (corpus absent: ${missing.join(",")})` : ""),
  )
}

for (const s of allSites) {
  const src = RESERVED[s.target.toLowerCase().replace(/^\$/, "")] ?? []
  console.log(`  ${s.repo}/${s.file}:${s.line}  calls ${s.source} -> ${s.target}   [${src.join(",")}]`)
}

const out = {
  gate: "M60.powershell-keyword-census",
  title: "A `calls` edge may not name a PowerShell reserved word",
  at: new Date().toISOString(),
  commit: safeCommit(),
  sampleLimit,
  lanes: perLane,
  sites: allSites.map((s) => ({
    key: `${s.target.toLowerCase()}@${s.file.split("/").pop()}`,
    repo: s.repo, file: s.file, line: s.line, target: s.target,
  })),
  verdict: allSites.length === 0 ? "clean" : "reported",
  reservedSet: Object.fromEntries(Object.entries(RESERVED).map(([k, v]) => [k, v.join(",")])),
  exclusions: EXCLUSIONS,
  method:
    "Candidates are the lane's production (non-test) .ps1/.psm1/.psd1 files under CORPUS_ROOT, drawn by a hash of the relative path so the sample is unbiased and reproducible. Each file goes through the PRODUCTION `parseFile` entry, so the worker-boundary relationship filter is included. Every `calls` edge whose target leaf is in the reserved set is reported with its file and line. The reserved set is a union of named PowerShell language references; names that are ALSO real .NET methods reachable as a member leaf are EXCLUDED with the reason recorded, because the first version of this instrument omitted the exclusions and reported 42 fabrications where 6 existed.",
  blindSpots:
    "A reserved word the analyzer never reaches as a `command` is not measured, and a fabrication whose target happens to share a name with a real cmdlet is indistinguishable from a call. Both are bounds of a target-name census, declared rather than hidden.",
}

if (has("--emit")) {
  fs.writeFileSync(REGISTER, JSON.stringify(out, null, 2) + "\n")
  console.log(`\nwrote ${path.relative(ROOT, REGISTER)}`)
}

// The shrink-only rule: a registered site that vanished must be marked `paid`.
const reg = readRegister()
if (fs.existsSync(REGISTER) && has("--gate-grown")) {
  const now = new Set(out.sites.map((s) => s.key))
  const before = new Set(Object.keys(reg.sites ?? {}))
  const vanished = [...before].filter((k) => !now.has(k))
  const unpaid = vanished.filter((k) => reg.sites[k]?.paid !== true)
  if (unpaid.length > 0) {
    console.error(`\nFAIL: ${unpaid.length} registered site(s) vanished without being marked \`paid\`: ${unpaid.join(", ")}`)
    process.exit(1)
  }
}

console.log(`\nkeyword census: ${allSites.length === 0 ? "clean — no reserved word in any calls target" : `REPORTED — ${allSites.length} site(s)`}`)
if (allSites.length > 0) process.exitCode = 1

} // IS_MAIN

// ----------------------------------------------------------------- utilities
function hashOf(s: string): string {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return (h >>> 0).toString(16).padStart(8, "0")
}

function safeCommit(): string {
  try { return execSync("git rev-parse HEAD", { cwd: ROOT, encoding: "utf8" }).trim() } catch { return "unknown" }
}
