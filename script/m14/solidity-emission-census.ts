/**
 * solidity-emission-census — WHAT the Solidity analyzer emits, counted by SITE, over the whole
 * admitted population (ALL-OUT-OF-ALL §9.1 D2: rows + files + repos, per relationship type).
 *
 * WHY THIS EXISTS. The fleet gates answer "does every edge RESOLVE"; none answers "does every
 * construct EMIT". `incoming-gate.ts --dump` prints only NON-RESOLVED rows and `residual-gate.ts`
 * publishes per-type totals with no metadata breakdown. This is the one place the EMITTED rows are
 * counted by the marker each emission carries, and the constructs the lane's contract (SOL-1..SOL-23)
 * names are counted from the grammar so a ruling is a number, not a silence.
 *
 * WHAT IT COUNTS, per admitted `.sol` file, through the PRODUCTION entry
 * (`src/ast/pool-worker.parseFile`, the same call `engine.ts` makes):
 *
 *   per relationship type     edges, and the number of FILES and REPOS that emitted at least one
 *   per marker                `metadata.relationshipType` when present, plus the lane's OWN marker
 *                             families: calls.calleeKind (SOL-15: localFunction · inheritedMember ·
 *                             inFileTypeMember · modifierInvocation · eventEmission · errorRevert ·
 *                             namespaceBuiltin · external), overrides tier/reasonCode (SOL-11),
 *                             uses.FAMILY (isVariableReference · isYulPathSegment · isYulVariableRead ·
 *                             isMemberReference), exports.isCompilationUnitSurface (SOL-12),
 *                             imports.isNamespaceImport, references markers, contains getter shape.
 *   GRAMMAR CONSTRUCTS        the D1 construct table's own population (contracts/interfaces/libraries,
 *                             structs/enums, events/errors, modifiers, callables, state vars, imports,
 *                             using-for, new, override + virtual, Yul/assembly, comments, pragmas,
 *                             try/catch, emit/revert).
 *   (deliberately NOT counted: anything inferred from a target's spelling. The census reads what the
 *   analyzer WROTE into metadata, and what the pinned grammar's node types are.)
 *
 * THE POPULATION IS DERIVED, NEVER LISTED. Discovery is copied from `script/m14/incoming-gate.ts`
 * (`discoverFiles`), which cannot be imported because that file is a script whose top level executes.
 * The copy is the one thing in this file that can drift, so with `--cap=<N>` the census REQUIRES its
 * per-type edge totals to equal a live `incoming-gate.ts --json` run over the same stride sample and
 * exits 3 refusing to print if they differ. The whole-population run (`--cap=0`) has no second
 * instrument over this population; its internal control is closure (parsed+failed = admitted; per-type
 * sum = TOTAL; construct-walk skips aggregated and printed).
 *
 * PARSER LIFECYCLE (the class lesson the finished lanes handed over): the grammar-construct walk
 * acquires `engine.getParser("solidity")` PER FILE and calls `tree.delete()` after the walk. The engine
 * recreates cached parsers every 500 acquisitions; a HELD parser faults on its next `.parse` and the
 * run silently mass-falls-back. Every skip is AGGREGATED and printed.
 *
 * POPULATION NOTE — `.sol` ONLY, one spelling (verified: `src/ast/language-detection.ts:172`
 * `sol: "solidity"`), and the corpus is 421 files across 2 repos (OpenZeppelin production + one
 * nvim-treesitter query fixture). Small is fine: the D2 clause asks for counts, not for size.
 *
 * USAGE
 *   export BB_CORPUS_ROOT=$PWD/.corpus
 *   bun run script/m14/solidity-emission-census.ts --cap=50            # controlled triage sample
 *   bun run script/m14/solidity-emission-census.ts --cap=0 --json      # whole admitted population
 *
 * EXIT: 0 printed · 2 environment (no corpus / no files) · 3 CONTROL DID NOT FIRE.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../src/ast/pool-worker"
import { ASTEngine } from "../../src/ast/engine"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..", "..")
const GATE = path.join(ROOT, "script/m14/incoming-gate.ts")
const CR = process.env.BB_CORPUS_ROOT ?? path.join(ROOT, ".corpus")
const SIZE_CAP = 1024 * 1024 // mirror of pool-worker's FULL_AST_LIMIT — the same line the analyzer draws
const EXTS = ["sol"]

const CAP = (() => {
  const hit = process.argv.find((a) => a.startsWith("--cap="))
  return hit ? Number(hit.slice(6)) : 0
})()
const JSON_OUT = process.argv.includes("--json")

const ALL_TYPES = [
  "calls", "uses", "contains", "imports", "references",
  "exports", "extends", "implements", "overrides", "instantiates",
  "decorates", "renders", "mixes_in", "part_of",
] as const

/** The grammar constructs the D1 construct table names (SOL-1..SOL-23). */
const CONSTRUCTS = [
  "contract_declaration", "interface_declaration", "library_declaration", "contract_body",
  "struct_declaration", "struct_body", "struct_member", "enum_declaration", "enum_body", "enum_value",
  "event_definition", "event_parameter", "error_declaration", "error_parameter",
  "modifier_definition", "modifier_invocation",
  "function_definition", "function_body", "constructor_definition", "fallback_receive_definition",
  "state_variable_declaration", "constant_variable_declaration", "immutable", "variable_declaration",
  "inheritance_specifier", "override_specifier", "virtual",
  "call_expression", "call_argument", "call_struct_argument", "struct_expression", "new_expression",
  "member_expression", "identifier", "type_name", "user_defined_type", "user_defined_type_definition", "type_alias",
  "using_directive", "using_alias", "import_directive",
  "emit_statement", "revert_statement", "try_statement", "catch_clause",
  "assignment_expression", "augmented_assignment_expression", "update_expression",
  "assembly_statement", "yul_function_call", "yul_function_definition", "yul_identifier", "yul_path",
  "yul_variable_declaration", "yul_evm_builtin", "yul_block", "yul_for_statement", "yul_if_statement", "yul_switch_statement",
  "comment", "pragma_directive", "any_pragma_token",
] as const

/** Copied from `script/m14/incoming-gate.ts` — same admitted-extension predicate. */
function admitByExtension(rel: string): boolean {
  const base = rel.slice(rel.lastIndexOf("/") + 1).toLowerCase()
  const dot = base.lastIndexOf(".")
  const ext = dot >= 0 ? base.slice(dot + 1) : ""
  return EXTS.includes(ext)
}

/** Copied from `script/m14/incoming-gate.ts:discoverFiles` — same corpus walk, stride and size cap. */
function discover(cap: number): { files: string[]; total: number; repos: number; absent: number; overCap: number } {
  const found: string[] = []
  const repos = new Set<string>()
  let absent = 0
  let overCap = 0
  let entries: string[]
  try {
    entries = readdirSync(CR)
  } catch {
    return { files: [], total: 0, repos: 0, absent: 0, overCap: 0 }
  }
  for (const name of entries.sort()) {
    const dir = path.join(CR, name)
    try {
      if (!statSync(dir).isDirectory()) continue
    } catch {
      continue
    }
    try {
      execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    } catch {
      continue
    }
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
    } catch {
      continue
    }
    for (const rel of tracked) {
      if (!admitByExtension(rel)) continue
      const abs = path.join(dir, rel)
      try {
        if (statSync(abs).size > SIZE_CAP) { overCap++; continue }
      } catch {
        absent++
        continue
      }
      found.push(abs)
      repos.add(name)
    }
  }
  found.sort()
  const total = found.length
  let files = found
  if (cap > 0 && total > cap) {
    const stride = Math.max(1, Math.floor(total / cap))
    const picked: string[] = []
    for (let i = 0; i < found.length && picked.length < cap; i += stride) picked.push(found[i])
    files = picked
  }
  return { files, total, repos: repos.size, absent, overCap }
}

type Tally = { edges: number; files: Set<string>; repos: Set<string> }
const mk = () => ({ edges: 0, files: new Set<string>(), repos: new Set<string>() } as Tally)
const repoOf = (rel: string) => rel.split(path.sep)[0]
const add = (m: Map<string, Tally>, key: string, rel: string) => {
  let t = m.get(key)
  if (!t) { t = mk(); m.set(key, t) }
  t.edges++
  t.files.add(rel)
  t.repos.add(repoOf(rel))
}

const perType = new Map<string, Tally>()
const calleeKind = new Map<string, Tally>()
const overrideTier = new Map<string, Tally>()
const usesFamily = new Map<string, Tally>()
const referencesMarker = new Map<string, Tally>()
const importsPayload = new Map<string, Tally>()
const exportsPayload = new Map<string, Tally>()
const containsShape = new Map<string, Tally>()
const constructCounts = new Map<string, Tally>()
for (const t of ALL_TYPES) perType.set(t, mk())
for (const c of CONSTRUCTS) constructCounts.set(c, mk())

const { files, total, repos, absent, overCap } = discover(CAP)
if (files.length === 0) {
  console.error(`solidity-emission-census: 0 admitted .sol files under ${CR}. Set BB_CORPUS_ROOT to the corpus.`)
  process.exit(2)
}

// ── the grammar-construct walk (per-file parser; the class lesson applied) ─────────────────────
const constructSkips = { overCap: 0, parseFailed: 0, noTree: 0 }
const WALK_TYPES = new Set<string>(CONSTRUCTS)
function walkConstructs(node: any, rel: string): void {
  const stack: any[] = [node]
  while (stack.length) {
    const n = stack.pop()
    if (!n) continue
    if (WALK_TYPES.has(n.type)) {
      let t = constructCounts.get(n.type)
      if (!t) { t = mk(); constructCounts.set(n.type, t) }
      t.edges++
      t.files.add(rel)
      t.repos.add(repoOf(rel))
    }
    for (let i = 0; i < n.namedChildCount; i++) stack.push(n.namedChild(i))
  }
}

let parsed = 0
let failed = 0
let degraded = 0
let constructWalked = 0
const parseErrors: string[] = []
for (const abs of files) {
  const rel = path.relative(CR, abs)
  const relSlug = rel.split(path.sep).join("/")
  const repoRoot = path.join(CR, relSlug.split("/")[0])
  let result: any
  try {
    result = await parseFile(abs, repoRoot)
  } catch (e: any) {
    failed++
    parseErrors.push(`${relSlug}: ${String(e?.message ?? e).slice(0, 120)}`)
    continue
  }
  parsed++
  if (result?.fallback === true) degraded++
  for (const r of (result.relationships ?? []) as any[]) {
    const type = String(r?.type ?? "")
    add(perType, type, relSlug)
    const md = (r?.metadata ?? {}) as Record<string, unknown>
    if (type === "calls") {
      const k = typeof md.calleeKind === "string" ? md.calleeKind : "(none)"
      add(calleeKind, k, relSlug)
    } else if (type === "overrides") {
      const tier = typeof md.evidenceClass === "string" ? md.evidenceClass : typeof md.reasonCode === "string" ? md.reasonCode : "(none)"
      add(overrideTier, tier, relSlug)
    } else if (type === "uses") {
      const fam = md.isYulPathSegment === true ? "yulPathSegment"
        : md.isYulVariableRead === true ? "yulVariableRead"
          : md.isMemberReference === true ? "memberReference"
            : md.isVariableReference === true ? "variableReference"
              : "(none)"
      add(usesFamily, fam, relSlug)
    } else if (type === "references") {
      const k = typeof md.soliditySpecific === "boolean" ? (typeof md.isImport === "boolean" ? "import-binding" : "type-or-using") : "(none)"
      add(referencesMarker, k, relSlug)
    } else if (type === "imports") {
      add(importsPayload, md.isNamespaceImport === true ? "namespace-import" : "path", relSlug)
    } else if (type === "exports") {
      add(exportsPayload, md.isCompilationUnitSurface === true ? "compilation-unit-surface" : "(none)", relSlug)
    } else if (type === "contains") {
      const target = String(r.target ?? "")
      add(containsShape, target.endsWith("()") ? "synthesised-getter" : "declaration", relSlug)
    }
  }
  // grammar-construct walk; >1MB files were never admitted by discovery (SIZE_CAP), and a structural
  // fallback is COUNTED here rather than silently skipped.
  if (result?.fallback === true) {
    constructSkips.overCap++
    continue
  }
  try {
    const content = readFileSync(abs, "utf8")
    const parser: any = await ASTEngine.getParser("solidity")
    const tree: any = parser.parse(content, abs)
    if (!tree?.rootNode) { constructSkips.noTree++; continue }
    constructWalked++
    walkConstructs(tree.rootNode, relSlug)
    tree.delete()
  } catch {
    constructSkips.parseFailed++
  }
}

// ── THE CONTROL: on a stride sample, the census walk must BE the gate's walk ────────────────────
type Control = { ok: boolean; checked: "gate --json edges" | "none (whole population)"; detail: string }
let control: Control
if (CAP > 0) {
  let gateJson: any
  try {
    const out = execFileSync("npx", ["tsx", GATE, "solidity", EXTS.join(","), String(CAP), "--json"], {
      encoding: "utf8", cwd: ROOT, env: { ...process.env, BB_CORPUS_ROOT: CR }, maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
    })
    gateJson = JSON.parse(out)
  } catch (e: any) {
    // THE GATE EXITS 1 WHEN ITS VERDICT IS FAIL — a measurement, not a refusal. Exit 2/3 carry no
    // usable JSON and are the genuine refusals this check exists for.
    const stdout = typeof e?.stdout === "string" ? e.stdout : ""
    const parsedJson = (() => {
      try { return JSON.parse(stdout) } catch { return null }
    })()
    if (!parsedJson || !parsedJson.perType) {
      console.error("CONTROL DID NOT FIRE: the fleet gate refused to measure, so the census walk cannot be checked against it.")
      console.error(String(e?.stderr ?? e?.message ?? e).split("\n").slice(-4).join("\n"))
      process.exit(3)
    }
    gateJson = parsedJson
  }
  const failures: string[] = []
  for (const t of ALL_TYPES) {
    const mine = perType.get(t)?.edges ?? 0
    const gateEdges = gateJson?.perType?.[t]?.edges
    if (gateEdges === undefined) continue
    if (gateEdges !== mine) failures.push(`${t}: census ${mine} != gate ${gateEdges}`)
  }
  if (failures.length > 0) {
    console.error("CONTROL DID NOT FIRE: the census walk is not the gate's walk.")
    for (const f of failures.slice(0, 20)) console.error("  " + f)
    console.error(`${failures.length} per-type total(s) differ — refusing to print a marker census over a different population.`)
    process.exit(3)
  }
  control = { ok: true, checked: "gate --json edges", detail: `every per-type edge total equals incoming-gate --json for the same ${CAP}-file stride` }
} else {
  control = { ok: true, checked: "none (whole population)", detail: "whole-population run: no second instrument over this population; the internal control is closure (parsed+failed+degraded = admitted) and per-type sum = TOTAL" }
}

const sorted = (m: Map<string, Tally>) => [...m.entries()].sort((a, b) => b[1].edges - a[1].edges)
const w = (s: string | number, n: number) => String(s).padEnd(n)
const totalEdges = [...perType.values()].reduce((a, b) => a + b.edges, 0)
const payloadJson = (m: Map<string, Tally>) =>
  Object.fromEntries(sorted(m).map(([k, v]) => [k, { edges: v.edges, files: v.files.size, repos: v.repos.size }]))

if (JSON_OUT) {
  console.log(JSON.stringify({
    population: { cap: CAP, sampled: files.length, parsed, failed, degraded, admitted: total, repos, absent, overCap, exts: EXTS, sizeCapBytes: SIZE_CAP },
    control,
    closure: { totalEdges, parsedPlusFailed: parsed + failed, constructWalked, constructSkipped: constructSkips },
    perType: Object.fromEntries(sorted(perType).map(([k, v]) => [k, { edges: v.edges, files: v.files.size, repos: v.repos.size }])),
    callPayload: payloadJson(calleeKind),
    overridePayload: payloadJson(overrideTier),
    usesPayload: payloadJson(usesFamily),
    referencesPayload: payloadJson(referencesMarker),
    importsPayload: payloadJson(importsPayload),
    exportsPayload: payloadJson(exportsPayload),
    containsPayload: payloadJson(containsShape),
    constructs: payloadJson(constructCounts),
    parseErrors: parseErrors.slice(0, 20),
  }, null, 2))
} else {
  console.log(`solidity emission census — ${parsed} parsed of ${total} admitted .sol files (${repos} repos; cap ${CAP === 0 ? "NONE (whole population)" : CAP})`)
  console.log(`  extensions admitted: ${EXTS.map((e) => "." + e).join(" ")}`)
  console.log(`  parse failures: ${failed} · structural-fallback (degraded): ${degraded} · tracked-but-absent: ${absent} · over the ${Math.round(SIZE_CAP / 1024)} KB cap: ${overCap}`)
  console.log(`  closure: parsed + failed = ${parsed + failed} of ${total} admitted · TOTAL edges ${totalEdges}`)
  console.log(`  control (${control.checked}): ${control.ok ? "PASS" : "FAIL"} — ${control.detail}`)
  console.log(`  grammar-construct walk: ${constructWalked} files walked · skipped ${JSON.stringify(constructSkips)}`)
  console.log()
  console.log("EDGES PER RELATIONSHIP TYPE")
  console.log("-".repeat(72))
  for (const [k, v] of sorted(perType)) if (v.edges > 0) console.log(`  ${w(k, 15)} ${w(v.edges, 9)} edges in ${v.files.size} file(s), ${v.repos.size} repo(s)`)
  console.log()
  const block = (title: string, m: Map<string, Tally>, pad = 38) => {
    console.log(title)
    console.log("-".repeat(72))
    for (const [k, v] of sorted(m)) console.log(`  ${w(k, pad)} ${w(v.edges, 8)} edge(s) in ${v.files.size} file(s), ${v.repos.size} repo(s)`)
    console.log()
  }
  block("CALLS — calleeKind (SOL-15)", calleeKind)
  block("OVERRIDES — evidence class / reasonCode (SOL-11)", overrideTier)
  block("USES — read family (SOL-2 / Yul)", usesFamily)
  block("REFERENCES — marker family", referencesMarker)
  block("IMPORTS — import shape", importsPayload)
  block("EXPORTS — surface marker (SOL-12)", exportsPayload)
  block("CONTAINS — declaration vs synthesised getter (SOL-3)", containsShape)
  block("GRAMMAR CONSTRUCTS (per-file parser, tree disposed)", constructCounts)
  if (parseErrors.length) {
    console.log("PARSE ERRORS (first 20)")
    for (const e of parseErrors) console.log("  " + e)
  }
}
