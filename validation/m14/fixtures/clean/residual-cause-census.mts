#!/usr/bin/env bun
/**
 * CLEAN lane — WHAT THE RESIDUAL *IS*, per gate row. A CENSUS, not a re-classifier.
 *
 * The incoming gate says WHERE an edge went (resolved / external / ambiguous / unresolved); it does not
 * say WHAT the target's declaration set is. This instrument takes the gate's OWN dump (`--dump`, the
 * same command the lane's arm runs) and joins every residual row to the project-scoped declaration
 * census that the gate built its key space from, so each bucket below is a fact about declarations
 * rather than a reading of a target's spelling.
 *
 * WHY IT REPLICATES THE COLLAPSE RATHER THAN ASKING FOR IT. The gate applies `--binding-collapse` to
 * its count and reports the count, not the declaration list. The rule is short and is restated here
 * FROM THE GATE: a key is ONE declaration iff EVERY declaration answering to it carries the same
 * non-empty `qualifiedName`, and that name must differ from the bare name (the store's file-scope
 * fallback is `qualifiedName = name`, and a fallback is not a qualification). If this file's
 * replication ever disagrees with the gate's count, the run FAILS rather than reporting — that control
 * is `--strict`, and it is on by default.
 *
 * THE CAUSES (each is a claim about the declaration set, and each is falsifiable):
 *
 *   module-halves            every declaration answering the target is a MODULE symbol — the `.dcl` and
 *                            `.icl` halves of one module. The language has ONE module per name; the
 *                            gate cannot collapse the key because a module's qualified identity IS its
 *                            name (`qualifiedName = name`, the fallback the rule must ignore).
 *   module-name-as-a-type    a MODULE symbol plus one or more NON-module declarations of the same name —
 *                            Clean projects name their central type after the module (`Diagnostic.icl`
 *                            declares `Diagnostic`), so a type position answers the module symbol too.
 *   class-and-its-members    one class/interface plus N members that spell the class's own name (the
 *                            class IS in the set, e.g. `toString`); name-keyed resolution still cannot
 *                            pick the class, because every instance contributes a same-named member.
 *   instance-member-collision no class declaration answers the target at all: every declaration is a
 *                            MEMBER (ownerName is a type), in two or more owners. For an operator class
 *                            this is also the parenthesised-declaration effect: the class is declared as
 *                            `(<)`, the instance spells it `<`, so only the instance MEMBERS answer `<`.
 *   module-level-collision   module-scope declarations of the same name in DIFFERENT modules (a function
 *                            `List` in `UtilOptions` and a type `List` in `UtilStrictLists`).
 *   `twin-not-collapsed`     a module-level `.dcl`/`.icl` pair the collapse did NOT merge. This one is a
 *                            DEFECT by construction: the pair is one declaration, and a non-zero count
 *                            means the qualified spelling did not reach it.
 *   module-in-this-project   the target is a `Module:item` / `Module:*` import whose MODULE this edge's
 *                            own project declares, but whose file the claim's candidate spellings did not
 *                            reach (the module sits on a Clean SEARCH PATH, not at the project root or
 *                            beside the importing file — `UtilStrictLists` lives in `cleantools/Util/`).
 *                            This is the one import bucket a project-wide file search would close; it is
 *                            counted, not closed, because the analyzer is per-file by contract.
 *   module-in-another-project  the target is a module the CORPUS carries, in a project that is not the
 *                            edge's. At production's project scope it is genuinely unreachable — and the
 *                            fact is checkable, so the count is stated rather than folded into "nowhere".
 *   symbol-in-another-project  the target is declared by name in another project of the corpus (the
 *                            stdlib / platform libraries) and not in the edge's.
 *   declared-nowhere         the target is declared by no admitted file in any project. For clean this
 *                            is dominated by the platform names whose StdEnv declaration is not in the
 *                            corpus at all (`_system.dcl` is 0 bytes: `Pointer`, `Property`, `FilePath`).
 *
 * Usage:
 *   bun validation/m14/fixtures/clean/residual-cause-census.mts [--dump <gate-dump.txt>] [--json <out>]
 * Without --dump it RUNS the lane's arm and captures the dump (the gate is the authority; this file
 * never re-implements its classification).
 */
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { execFileSync } from "node:child_process"
import { parseFile } from "../../../../src/ast/pool-worker"

const argOf = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const CORPUS = argOf("corpus") ?? process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const JSON_OUT = argOf("json")
const DUMP_ARG = argOf("dump")
const STRICT = !process.argv.includes("--no-strict")

type Admitted = { abs: string; project: string; rel: string }
const files: Admitted[] = []
for (const entry of fs.readdirSync(CORPUS)) {
  const repoRoot = path.join(CORPUS, entry)
  try { if (!fs.statSync(repoRoot).isDirectory()) continue } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", repoRoot, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 1 << 28 })
      .split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) if (/\.(icl|dcl)$/.test(rel)) files.push({ abs: path.join(repoRoot, rel), project: entry, rel })
}

type Decl = {
  project: string; rel: string; name: string; kind: string; ownerName: string; scope: string
  qualifiedName: string; local: boolean; module: string
}
/** project -> key -> declarations answering it (name OR store qualifiedName, exactly the gate's two keys) */
const keyspace = new Map<string, Map<string, Decl[]>>()
/** module name -> projects that declare it */
const moduleProjects = new Map<string, Set<string>>()
/** symbol name -> projects that declare it */
const symbolProjects = new Map<string, Set<string>>()
let parsed = 0
const parseFailed: string[] = []

for (const f of files) {
  let r: any
  try { r = await parseFile(f.abs, path.join(CORPUS, f.project), { projectRoot: path.join(CORPUS, f.project) } as any) } catch { parseFailed.push(f.rel); continue }
  if (!r) { parseFailed.push(f.rel); continue }
  parsed++
  const modSym = (r.symbols ?? []).find((s: any) => String(s?.kind ?? "").toLowerCase() === "module")
  const module = modSym ? String(modSym.name) : ""
  if (module) {
    const set = moduleProjects.get(module) ?? new Set<string>()
    set.add(f.project)
    moduleProjects.set(module, set)
  }
  let ks = keyspace.get(f.project)
  if (!ks) keyspace.set(f.project, (ks = new Map()))
  for (const s of r.symbols ?? []) {
    const name = String(s?.name ?? "")
    if (!name) continue
    const kind = String(s?.kind ?? "")
    const scope = String(s?.scope ?? "")
    const local = String(s?.visibility ?? "") === "local" || s?.metadata?.isLocalDefinition === true
    const declared = String(s?.qualifiedName ?? "")
    const qualifiedName = declared || (scope ? `${scope}.${name}` : name)
    const d: Decl = {
      project: f.project, rel: f.rel, name, kind, ownerName: String(s?.ownerName ?? ""), scope,
      qualifiedName, local, module,
    }
    for (const key of new Set([name, qualifiedName])) {
      if (!key) continue
      const at = ks.get(key)
      if (at) at.push(d); else ks.set(key, [d])
    }
    if (kind.toLowerCase() !== "module") {
      const set = symbolProjects.get(name) ?? new Set<string>()
      set.add(f.project)
      symbolProjects.set(name, set)
    }
  }
}

/** THE GATE'S COLLAPSE RULE, restated from `incoming-gate.ts` (see the header for why). */
function collapsed(decls: Decl[], key: string): Decl[] {
  if (decls.length < 2) return decls
  const names = new Set<string>()
  for (const d of decls) {
    const genuine = d.qualifiedName && d.qualifiedName !== key ? d.qualifiedName : ""
    if (!genuine) return decls
    names.add(genuine)
  }
  return names.size === 1 ? [decls[0]] : decls
}

function declsOf(project: string, target: string): Decl[] {
  return collapsed(keyspace.get(project)?.get(target) ?? [], target)
}

// ---------------------------------------------------------------------------------------------
// THE DUMP. Run the lane's own arm when no dump was supplied.
// ---------------------------------------------------------------------------------------------
let dumpPath = DUMP_ARG
let temp: string | null = null
if (!dumpPath) {
  temp = path.join(os.tmpdir(), `clean-residual-cause-${process.pid}.txt`)
  // THE GATE EXITS 1 WHEN THE VERDICT IS FAIL, AND A FAILING VERDICT IS THE EXPECTED STATE for a lane
  // with a residual — so the non-zero exit is caught and its STDOUT is the dump. Letting the throw escape
  // would make this instrument unusable exactly when it is needed.
  let out = ""
  try {
    out = execFileSync("bun", ["run", "script/m14/incoming-gate.ts", "clean", "icl,dcl", "0", "--binding-collapse", "--dump"], {
      encoding: "utf8", maxBuffer: 1 << 30,
      env: { ...process.env, BB_DUMP_LIMIT: "2000000" },
    })
  } catch (e: any) {
    out = String(e?.stdout ?? "")
    if (!out) throw e
  }
  fs.writeFileSync(temp, out)
  dumpPath = temp
  process.stderr.write(`ran the arm; dump at ${temp}\n`)
}

const rows = fs.readFileSync(dumpPath, "utf8").split("\n").filter((l) => l.startsWith("DUMP\t")).map((l) => {
  const [, type, outcome, target, loc] = l.split("\t")
  const m = /\/repositories\/([^/]+)\//.exec(loc)
  return { type, outcome, target, loc, project: m?.[1] ?? "?" }
})

const CAUSES = [
  "module-halves",
  "module-name-as-a-type",
  "class-and-its-members",
  "instance-member-collision",
  "member-name-collision",
  "module-level-collision",
  "twin-not-collapsed",
  "module-in-this-project",
  "module-in-another-project",
  "symbol-in-another-project",
  "declared-nowhere",
] as const
type Cause = (typeof CAUSES)[number]

function causeOf(row: { type: string; outcome: string; target: string; project: string }): Cause {
  const decls = declsOf(row.project, row.target)
  if (decls.length === 0) {
    // A `Module:item` / `Module:*` import target never equals a symbol name. The MODULE is the
    // question, so it is looked up on its own — the same split the gate's claim machinery makes.
    const colon = row.target.indexOf(":")
    const moduleName = colon > 0 ? row.target.slice(0, colon) : row.target
    const modProj = moduleProjects.get(moduleName)
    if (modProj) return modProj.has(row.project) ? "module-in-this-project" : "module-in-another-project"
    const symProj = symbolProjects.get(moduleName)
    if (symProj && !symProj.has(row.project)) return "symbol-in-another-project"
    return "declared-nowhere"
  }
  const moduleSyms = decls.filter((d) => d.kind.toLowerCase() === "module")
  if (moduleSyms.length === decls.length) return "module-halves"
  if (moduleSyms.length > 0) return "module-name-as-a-type"
  const classish = decls.filter((d) => ["interface", "class"].includes(d.kind.toLowerCase()))
  const owned = decls.filter((d) => d.ownerName && d.ownerName !== d.module)
  if (classish.length === 1 && owned.length === decls.length - 1 && owned.length > 0) return "class-and-its-members"
  if (owned.length === decls.length && new Set(owned.map((d) => d.ownerName)).size > 1) return "instance-member-collision"
  const moduleLevel = decls.filter((d) => !d.ownerName || d.ownerName === d.module)
  if (moduleLevel.length === decls.length) {
    const quals = new Set(moduleLevel.map((d) => `${d.module}.${d.name}`))
    if (quals.size === 1 && decls.length > 1) return "twin-not-collapsed"
    return "module-level-collision"
  }
  return "member-name-collision"
}

const table = new Map<string, Map<Cause, { n: number; targets: Map<string, number> }>>()
let rowsChecked = 0
const controlFailures: string[] = []
for (const row of rows) {
  if (!["ambDeclOnly", "ambBoth", "unresolved"].includes(row.outcome)) continue
  rowsChecked++
  const cause = causeOf(row)
  let byType = table.get(row.type)
  if (!byType) table.set(row.type, (byType = new Map()))
  let cell = byType.get(cause)
  if (!cell) byType.set(cause, (cell = { n: 0, targets: new Map() }))
  cell.n++
  cell.targets.set(row.target, (cell.targets.get(row.target) ?? 0) + 1)
}

// THE CONTROL: every ambiguous target must have >= 2 declarations under this census, and every
// unresolved one 0. A disagreement means the replication above is not the gate's rule any more.
if (STRICT) {
  for (const row of rows) {
    if (row.outcome !== "ambDeclOnly" && row.outcome !== "unresolved") continue
    const n = declsOf(row.project, row.target).length
    if (row.outcome === "ambDeclOnly" && n < 2) controlFailures.push(`ambDeclOnly ${row.target} has ${n} declaration(s) in ${row.project} (${row.loc})`)
    if (row.outcome === "unresolved" && n !== 0) controlFailures.push(`unresolved ${row.target} has ${n} declaration(s) in ${row.project} (${row.loc})`)
  }
}

const totalByCause = new Map<Cause, number>()
const topByType = new Map<string, Array<{ cause: Cause; n: number; top: Array<[string, number]> }>>()
for (const [type, byType] of table) {
  const list: Array<{ cause: Cause; n: number; top: Array<[string, number]> }> = []
  for (const cause of CAUSES) {
    const cell = byType.get(cause)
    if (!cell) continue
    totalByCause.set(cause, (totalByCause.get(cause) ?? 0) + cell.n)
    list.push({ cause, n: cell.n, top: [...cell.targets.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6) })
  }
  list.sort((a, b) => b.n - a.n)
  topByType.set(type, list)
}

console.log(`CLEAN residual-cause census — ${parsed} files parsed of ${files.length} admitted (${parseFailed.length} failed), ${rowsChecked} residual rows classified`)
console.log(`corpus ${CORPUS} · collapse replicated from the gate (strict=${STRICT})`)
console.log()
for (const [type, list] of topByType) {
  const total = list.reduce((s, x) => s + x.n, 0)
  console.log(`${type}: ${total} residual row(s)`)
  for (const x of list) {
    console.log(`  ${x.cause.padEnd(26)} ${String(x.n).padStart(6)}   ${x.top.map(([t, n]) => `${t} ${n}`).join(" · ")}`)
  }
}
console.log()
console.log("BY CAUSE (all types)")
for (const cause of CAUSES) {
  const n = totalByCause.get(cause) ?? 0
  if (n > 0) console.log(`  ${cause.padEnd(26)} ${String(n).padStart(6)}`)
}
if (controlFailures.length) {
  console.log(`\nCONTROL FAILED — ${controlFailures.length} row(s) disagree with the replicated collapse:`)
  for (const f of controlFailures.slice(0, 12)) console.log(`  ${f}`)
  process.exitCode = 2
} else if (STRICT) {
  console.log("\ncontrol: every ambiguous row has >=2 declarations and every unresolved row has 0 — PASS")
}

if (JSON_OUT) {
  fs.writeFileSync(JSON_OUT, JSON.stringify({
    corpus: CORPUS, dump: dumpPath, parsed, admitted: files.length, parseFailed,
    rows: rowsChecked,
    perType: Object.fromEntries([...topByType].map(([t, list]) => [t, { total: list.reduce((s, x) => s + x.n, 0), causes: list }])),
    byCause: Object.fromEntries([...totalByCause].map(([k, v]) => [k, v])),
    control: controlFailures.length ? { ok: false, failures: controlFailures } : { ok: true },
  }, null, 2))
}
if (temp) fs.unlinkSync(temp)
