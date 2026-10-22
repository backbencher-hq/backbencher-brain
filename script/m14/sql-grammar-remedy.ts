/**
 * script/m14/sql-grammar-remedy.ts — THE R2 GRAMMAR REMEDY FOR SQL, MEASURED.
 *
 * WHAT THIS IS. The R2 rung of the remedy ladder for the `sql` lane: get the grammar, patch it, and
 * verify the patch BY MEASUREMENT — the new build against the old one OVER THE ADMITTED POPULATION,
 * plus a behavioural edge that exists only when the construct reaches the analyzer as a REAL NODE.
 * The Lead's `script/m14/grammar-remedy.ts` owns the LADDER (fetch / generate / build / prove / delta);
 * this owns the LANE'S PATCH and the LANE'S VERIFICATION, because only the lane knows what its
 * analyzer must see.
 *
 * THE PATCH, AND WHY IT IS THIS PATCH. PostgreSQL's table inheritance has THREE forms:
 *   CREATE TABLE child ( ... ) INHERITS ( parent [, ...] )   — the parent LIST
 *   ALTER TABLE child INHERIT parent                         — ONE parent
 *   ALTER TABLE child NO INHERIT parent                      — the REMOVAL of one parent
 * The wired grammar had NO production for any of them, so the words were lexed as identifiers and the
 * clauses ERROR-recovered. MEASURED against the wired build (the probe below reproduces it):
 *   `CREATE TABLE c (id INT) INHERITS (p);`  → 1 ERROR node, and the parent name does NOT survive.
 *   `ALTER TABLE c NO INHERIT p;`            → 1 ERROR node (the `keyword_no`).
 *   `ALTER TABLE c INHERIT p;`               → no ERROR, but the clause arrives as a MIS-PARSE — a
 *     `column_definition` whose name is literally `INHERIT` and whose type is the parent table.
 * So the construct EXISTS in the language and was only PARTIALLY readable in the grammar: exactly the
 * R2 case. The patch adds an `inherit_clause` node (the parent list) and an `inherit_specification`
 * node (one parent, with `keyword_no` marking the removal), and wires them into `create_table` and
 * `alter_table`. The analyzer reads BOTH, so the `extends` edge exists only when the construct
 * arrives as a real node — never as recovery text.
 *
 * THE THREE BUILDS COMPARED, AND WHY THERE ARE THREE. This is the part the record has to carry:
 *
 *   A  PUBLISHED       `@derekstride/tree-sitter-sql@0.3.11`, the npm package, unmodified.
 *   B  PUBLISHED+PATCH A + the inheritance patch. THIS IS THE PATCH'S OWN EFFECT.
 *   C  WIRED           `wasm/tree-sitter-sql.wasm` — what the product actually loads.
 *
 * **A AND C ARE NOT THE SAME GRAMMAR, AND THE DIFFERENCE IS 67 NAMED TYPES.** C is a LOCAL FORK of
 * the published grammar carrying the whole `plpgsql_*` family (13 types), `grant_statement`,
 * `revoke_statement`, `do_statement`, `create_policy`/`drop_policy`/`alter_policy`, `procedure_body`,
 * `psql_meta_command`, `tablespace`, `tablet_split`, `var_declaration(s)`, `while_statement`,
 * `not_rlike` and 29 `keyword_*` tokens — none of which the published package has. The fork's SOURCE
 * is not in `grammars/`, is not in this repository's history, is not a public fork of the upstream
 * (124 forks probed, measured), and is not `@l1xnan/tree-sitter-sql@0.4.7` (measured). **⇒ THE PATCH
 * CANNOT BE WIRED ON TOP OF THE FORK AS THE RECORD STANDS, AND THE REGRESSION A SWAP WOULD COST IS
 * MEASURED HERE, NOT ASSERTED.**
 *
 * WHAT THIS INSTRUMENT MEASURES:
 *   1. the named-type surface and the THREE DIGESTS of every build;
 *   2. the per-type EDGE delta over the whole admitted population for A → B (the patch's own effect)
 *      and for C → B (what wiring the patch onto the fork would cost);
 *   3. the BEHAVIOURAL red/green: the `extends` edges the analyzer publishes for the inheritance
 *      forms under each build, and whether the construct reached the analyzer as a real node.
 *
 * IT DOES NOT swap the wired wasm, does not claim the patch is wired, and does not decide the ruling.
 * The ruling is the Lead's; this is the measurement the ruling needs.
 *
 * USAGE:
 *   BB_CORPUS_ROOT="$PWD/.corpus" bun run script/m14/sql-grammar-remedy.ts \
 *        [--patched <patched.wasm>] [--published <published.wasm>] [--json <out>] [--sample N]
 */
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { loadWebTreeSitter, resolveWasmAsset } from "../../src/util/wasm.ts"
import { RealSqlAnalyzer } from "../../src/ast/real-sql-analyzer.ts"
import { measureSurface } from "./verify-grammar-pins.ts"

const args = process.argv.slice(2)
const argOf = (f: string) => {
  const i = args.indexOf(f)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined
}
const jsonOut = argOf("--json")
const PATCHED_WASM = argOf("--patched") ?? ".tmp-census/sql-inherits.wasm"
const PUBLISHED_WASM = argOf("--published") ?? ".tmp-census/sql-pristine.wasm"
const SAMPLE = Number(argOf("--sample") ?? 0)
const BEHAVIOUR_ONLY = args.includes("--behaviour-only")
const ROOT = process.env.BB_CORPUS_ROOT ?? join(process.cwd(), ".corpus")
const CAP = 1_048_576
const FOURTEEN = [
  "calls", "extends", "implements", "uses", "imports", "exports", "contains", "references",
  "overrides", "instantiates", "decorates", "renders", "mixes_in", "part_of",
]

// ── the three builds
const WTS: any = await loadWebTreeSitter()
const initFn = WTS.init ?? WTS.Parser?.init
if (initFn) await initFn({ locateFile: () => resolveWasmAsset("tree-sitter.wasm") })
const Language: any = WTS.Language ?? WTS.default?.Language
const Parser: any = WTS.Parser ?? WTS.default?.Parser

async function makeParser(wasmPath: string) {
  const lang = await Language.load(new Uint8Array(readFileSync(wasmPath)))
  const p = new Parser()
  p.setLanguage(lang)
  return p
}
const parsers: Record<string, any> = {
  A_published: await makeParser(PUBLISHED_WASM),
  B_published_plus_patch: await makeParser(PATCHED_WASM),
  C_wired: await makeParser("wasm/tree-sitter-sql.wasm"),
}

/** THE GRAMMAR HAND-OVER, on the CLASS, for the parser this tree came from. Without it the resync
 *  and EXECUTE-literal passes are SILENTLY INERT and every count is understated (measured: 260
 *  edges across the four affected types). */
function handOver(parser: any) {
  ;(RealSqlAnalyzer as any).setGrammar(parser.language, parser.constructor)
}

// ── the population, walked the way the lane's own census walks it (THE SYMLINK RULE)
function isRepo(dir: string): boolean {
  try {
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}
function tracked(dir: string): string[] {
  try {
    return execFileSync("git", ["-C", dir, "ls-files", "-z"], {
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
    })
      .split("\0")
      .filter(Boolean)
  } catch {
    return []
  }
}
const admitted: string[] = []
const seen = new Set<string>()
let overCap = 0
let absent = 0
let duplicate = 0
let paths = 0
let symlinkedDirsFollowed = 0
let repos = new Set<string>()
for (const name of readdirSync(ROOT).sort()) {
  const dir = join(ROOT, name)
  // `statSync` FOLLOWS a symlink; `Dirent.isDirectory()` does not, and that difference once cost
  // this lane 439 files in silence.
  let isDir = false
  try { isDir = statSync(dir).isDirectory() } catch { isDir = false }
  if (!isDir) continue
  if (!isRepo(dir)) continue
  symlinkedDirsFollowed++
  /**
   * THE REPO COUNT IS 21, NOT 202 — AND THE RULE IS "REPOSITORIES CARRYING AN ADMITTED FILE".
   * A repository that carries NO admitted `.sql` does not count, and a first version of this
   * instrument counted every git checkout it walked (202) and had it published. The rule is L-13 and
   * the gate's own walk agrees (`incoming-gate.ts:526` adds a repo per ADMITTED file), so the repo is
   * counted ONLY once it has actually contributed an admitted file.
   */
  let contributed = 0
  for (const rel of tracked(dir)) {
    if (!rel.endsWith(".sql")) continue
    paths++
    const abs = join(dir, rel)
    let real = abs
    try { real = realpathSync(abs) } catch { absent++; continue }
    if (seen.has(real)) { duplicate++; continue }
    seen.add(real)
    let size = -1
    try { size = statSync(abs).size } catch { absent++; continue }
    if (size > CAP) { overCap++; continue }
    admitted.push(abs)
    contributed++
  }
  if (contributed > 0) repos.add(name)
}

// ── the behavioural red/green: the inheritance forms, per build
/**
 * THE PROBES DECLARE THEIR TABLES, and that is not decoration: the analyzer publishes an `extends`
 * edge only when its SOURCE is a DECLARED table — on the real-node path and on the mis-parse path
 * alike — so a probe whose table was never declared would measure a dangling edge rather than the
 * clause. Each probe below is a two-statement file: the parent is declared, and then the clause.
 */
const DECL = "CREATE TABLE parent (id INT);\n"
const CHILD = "CREATE TABLE child (id INT);\n"
const FORMS: [string, string][] = [
  ["CREATE TABLE ... INHERITS (parent)", DECL + "CREATE TABLE child (id INT) INHERITS (parent);"],
  ["CREATE TABLE ... INHERITS (p1, p2)", DECL + "CREATE TABLE child (id INT) INHERITS (parent, parent2);"],
  ["ALTER TABLE ... INHERIT parent", DECL + CHILD + "ALTER TABLE child INHERIT parent;"],
  ["ALTER TABLE ... NO INHERIT parent", DECL + CHILD + "ALTER TABLE child NO INHERIT parent;"],
  ["CONTROL: ALTER TABLE ... ADD COLUMN inherit int", DECL + CHILD + "ALTER TABLE child ADD COLUMN inherit int;"],
  ["CONTROL: CREATE TABLE ... (LIKE parent INCLUDING ALL)", DECL + "CREATE TABLE child (LIKE parent INCLUDING ALL);"],
]
function walk(node: any, visit: (n: any) => void) {
  if (!node) return
  visit(node)
  for (let i = 0; i < node.childCount; i++) walk(node.child(i), visit)
}
function errorNodes(tree: any): number {
  let c = 0
  walk(tree.rootNode, (n) => { if (n.type === "ERROR") c++ })
  return c
}
function realInheritNode(tree: any): string[] {
  const found: string[] = []
  walk(tree.rootNode, (n) => {
    if (n.type === "inherit_clause" || n.type === "inherit_specification") found.push(n.type)
  })
  return found
}
function extendsOf(tree: any, content: string, file: string, parser: any): string[] {
  handOver(parser)
  let r: any
  try { r = new RealSqlAnalyzer().analyze(tree.rootNode, content, file) } catch { r = { relationships: [] } }
  return (r.relationships ?? [])
    .filter((x: any) => String(x.relationshipType ?? x.type) === "extends")
    .map((x: any) => `${x.source ?? x.from}->${x.target ?? x.to}`)
    .sort()
}
const behaviour: any[] = []
for (const [title, sql] of FORMS) {
  const row: any = { form: title, sql }
  for (const key of Object.keys(parsers)) {
    const tree: any = parsers[key].parse(sql)
    row[key] = {
      errorNodes: errorNodes(tree),
      realInheritNode: realInheritNode(tree),
      extends: extendsOf(tree, sql, "probe.sql", parsers[key]),
    }
  }
  behaviour.push(row)
}

// ── the per-type EDGE delta over the whole admitted population
const files = BEHAVIOUR_ONLY ? [] : SAMPLE > 0 ? admitted.slice(0, SAMPLE) : admitted
const perType: Record<string, Record<string, number>> = {}
for (const t of FOURTEEN) perType[t] = { A_published: 0, B_published_plus_patch: 0, C_wired: 0 }
/**
 * THE AST-LEVEL QUESTION THE OWNER ASKED, ANSWERED OVER THE WHOLE ADMITTED POPULATION:
 * **"would the patched rule FIRE over the AST?"** — not over the TEXT, because text lies (a word in a
 * comment or a string is not a construct). So this counts the NODES the patch's rules would bind,
 * per build, over every admitted file:
 *   `inherit_clause`       — the CREATE TABLE form's parent list (the patched build only);
 *   `inherit_specification`— the ALTER TABLE form (the patched build only);
 *   `mis_parsed_inherit`   — the ALTER TABLE form's MIS-PARSE in the WIRED build: an `add_column`
 *                            whose `column_definition` is named `INHERIT`. This is the shape the
 *                            analyzer reads today, so it is the near-miss count at AST level.
 * The answer decides whether the patch is load-bearing on this corpus at all.
 */
const nodeCounts: Record<string, Record<string, number>> = {
  A_published: { inherit_clause: 0, inherit_specification: 0, mis_parsed_inherit: 0, alter_table: 0, create_table: 0 },
  B_published_plus_patch: { inherit_clause: 0, inherit_specification: 0, mis_parsed_inherit: 0, alter_table: 0, create_table: 0 },
  C_wired: { inherit_clause: 0, inherit_specification: 0, mis_parsed_inherit: 0, alter_table: 0, create_table: 0 },
}
const fileDeltas: any[] = []
let parsed = 0
let failures = 0
const t0 = Date.now()
for (const abs of files) {
  let content = ""
  try { content = readFileSync(abs, "utf8") } catch { failures++; continue }
  const per: Record<string, Record<string, number>> = {}
  for (const key of Object.keys(parsers)) {
    let tree: any
    try { tree = parsers[key].parse(content) } catch { failures++; continue }
    // THE AST-LEVEL NODE COUNTS, before the analyzer runs.
    {
      const stack: any[] = [tree.rootNode]
      while (stack.length) {
        const n = stack.pop()
        const t = String(n.type)
        const nc = nodeCounts[key]
        if (t === "inherit_clause") nc.inherit_clause++
        else if (t === "inherit_specification") nc.inherit_specification++
        else if (t === "alter_table") nc.alter_table++
        else if (t === "create_table") nc.create_table++
        else if (t === "add_column") {
          // THE MIS-PARSE SHAPE: an `add_column` whose column_definition is named `INHERIT`.
          const def = n.child(0) && n.child(0).type === "column_definition" ? n.child(0) : null
          if (def) {
            let name = ""
            const inner: any[] = [def]
            while (inner.length) {
              const c2 = inner.pop()
              if (c2.type === "identifier" && !name) name = String(c2.text ?? "")
              for (let i = 0; i < c2.childCount; i++) { const k = c2.child(i); if (k) inner.push(k) }
            }
            if (name.toLowerCase() === "inherit") nc.mis_parsed_inherit++
          }
        }
        for (let i = 0; i < n.childCount; i++) { const k = n.child(i); if (k) stack.push(k) }
      }
    }
    handOver(parsers[key])
    let r: any
    try { r = new RealSqlAnalyzer().analyze(tree.rootNode, content, abs) } catch { r = { relationships: [] } }
    const c: Record<string, number> = {}
    for (const x of r.relationships ?? []) {
      const t = String(x.relationshipType ?? x.type)
      if (!perType[t]) continue
      c[t] = (c[t] ?? 0) + 1
    }
    per[key] = c
    for (const t of FOURTEEN) perType[t][key] += c[t] ?? 0
  }
  parsed++
  for (const t of FOURTEEN) {
    const a = per.B_published_plus_patch?.[t] ?? 0
    const c = per.C_wired?.[t] ?? 0
    if (a !== c) fileDeltas.push({ file: abs, type: t, patched: a, wired: c })
  }
}
const ms = Date.now() - t0

// ── THE FIXTURE, RUN AGAINST EVERY BUILD: the red/green in fixture form.
const FIXTURE_DIR = "validation/m14/measurements/sql-grammar-remedy"
const FIXTURE_SQL = join(FIXTURE_DIR, "sqld31-inheritance-real-node.sql")
const FIXTURE_EXP = join(FIXTURE_DIR, "sqld31-inheritance-real-node.expectation.json")
const fixtureRun: any = existsSync(FIXTURE_SQL) && existsSync(FIXTURE_EXP) ? await runFixture() : null
async function runFixture() {
  const content = readFileSync(FIXTURE_SQL, "utf8")
  const exp = JSON.parse(readFileSync(FIXTURE_EXP, "utf8"))
  const out: any = { fixture: FIXTURE_SQL, expectation: FIXTURE_EXP, builds: {} }
  for (const key of Object.keys(parsers)) {
    const tree: any = parsers[key].parse(content)
    handOver(parsers[key])
    let r: any
    try { r = new RealSqlAnalyzer().analyze(tree.rootNode, content, FIXTURE_SQL) } catch { r = { relationships: [] } }
    const rels = (r.relationships ?? []).map((x: any) => ({
      type: String(x.relationshipType ?? x.type),
      from: String(x.source ?? x.from),
      target: String(x.target ?? x.to),
    }))
    const extendsRels = rels.filter((x: any) => x.type === "extends")
    const missing = (exp.expectRelationships ?? []).filter(
      (w: any) => !extendsRels.some((x: any) => x.from === w.from && x.target === w.target),
    )
    const forbidden = (exp.forbidRelationships ?? []).filter(
      (w: any) => extendsRels.some((x: any) => x.from === w.from && x.target === w.target),
    )
    const wantCount = (exp.expectRelationshipCount ?? []).find((w: any) => w.type === "extends")?.equals
    out.builds[key] = {
      extends: extendsRels.map((x: any) => `${x.from}->${x.target}`).sort(),
      missingEdges: missing.map((w: any) => `${w.from}->${w.target}`),
      forbiddenEdgesPresent: forbidden.map((w: any) => `${w.from}->${w.target}`),
      countMatches: wantCount === undefined ? null : extendsRels.length === wantCount,
      pass: missing.length === 0 && forbidden.length === 0 && (wantCount === undefined || extendsRels.length === wantCount),
    }
  }
  return out
}

const digests: any = {}
for (const [key, path] of Object.entries({
  A_published: PUBLISHED_WASM,
  B_published_plus_patch: PATCHED_WASM,
  C_wired: "wasm/tree-sitter-sql.wasm",
})) {
  const s = await measureSurface(path)
  digests[key] = {
    wasm: path,
    bytes: existsSync(path) ? statSync(path).size : null,
    surface: s.surface,
    namedUnique: s.namedUnique.length,
  }
}

const report = {
  instrument: "script/m14/sql-grammar-remedy.ts",
  when: new Date().toISOString().slice(0, 10),
  patch: "grammars/tree-sitter-sql/grammar.js — the inheritance clause as a real node",
  builds: {
    A_published: { wasm: PUBLISHED_WASM, what: "@derekstride/tree-sitter-sql@0.3.11, unmodified" },
    B_published_plus_patch: { wasm: PATCHED_WASM, what: "A + the inheritance patch" },
    C_wired: { wasm: "wasm/tree-sitter-sql.wasm", what: "what the product loads — a LOCAL FORK of A" },
  },
  population: {
    rule_PATHS: "every tracked `.sql` path under a git checkout in the corpus root (git ls-files)",
    rule_DISTINCT: "PATHS deduped by realpath",
    rule_ADMITTED: "DISTINCT files present on disk AND <= 1,048,576 bytes",
    symlinkRule: "statSync (FOLLOWING) — Dirent.isDirectory() is FALSE for a symlink",
    paths,
    distinctFiles: seen.size,
    admitted: admitted.length,
    overCap,
    absent,
    duplicate,
    reposCarryingAdmittedFiles: repos.size,
    reposRule: "a repository counts ONLY if it contributed at least one ADMITTED .sql file (L-13), and the gate's own walk counts the same way (incoming-gate.ts:526 adds a repo per ADMITTED file). A repository with no admitted .sql does not count.",
    parsed,
    failures,
    ms,
    sampleLimit: SAMPLE || null,
  },
  digests,
  behaviour,
  fixture: fixtureRun,
  astLevelNodeCounts: nodeCounts,
  edge_delta: {
    note: "perType holds the per-relationship-type EDGE counts each build publishes over the admitted population",
    perType,
    filesWherePatchedAndWiredDiffer: fileDeltas.length,
    rows: fileDeltas.slice(0, 200),
  },
}
console.log("═".repeat(78))
console.log("SQL — THE R2 GRAMMAR REMEDY, MEASURED")
console.log("═".repeat(78))
console.log(
  `population: PATHS ${paths} · DISTINCT ${seen.size} · ADMITTED ${admitted.length} · overCap ${overCap} · repos ${repos.size} · parsed ${parsed} · failures ${failures} · ${ms} ms`,
)
console.log("\n-- the three digests --")
for (const [key, d] of Object.entries(digests)) {
  const s: any = (d as any).surface
  console.log(`   ${key.padEnd(24)} named ${s.namedUnique ?? "?"} ids ${s.ids} fields ${s.fieldCount} idOrder ${String(s.idOrderDigest).slice(0, 8)} typeSet ${String(s.typeSetDigest).slice(0, 8)} fieldSet ${String(s.fieldSetDigest).slice(0, 8)}`)
}
console.log("\n-- the behavioural red/green (the edge must exist only where the construct is a REAL NODE) --")
for (const b of behaviour) {
  console.log(b.form)
  for (const key of Object.keys(parsers)) {
    const v = b[key]
    console.log(`   ${key.padEnd(24)} errors=${v.errorNodes} realNode=[${v.realInheritNode.join(",")}] extends=[${v.extends.join(", ")}]`)
  }
}
console.log("\n-- THE AST-LEVEL QUESTION: would the patched rule FIRE over the admitted population? --")
for (const [key, nc] of Object.entries(nodeCounts)) {
  console.log(`   ${key.padEnd(24)} inherit_clause=${nc.inherit_clause}  inherit_specification=${nc.inherit_specification}  mis_parsed_inherit=${nc.mis_parsed_inherit}  (alter_table=${nc.alter_table}, create_table=${nc.create_table})`)
}
if (fixtureRun) {
  console.log("\n-- THE FIXTURE, RUN AGAINST EVERY BUILD (the red/green in fixture form) --")
  for (const [key, v] of Object.entries(fixtureRun.builds) as [string, any][]) {
    console.log(`   ${key.padEnd(24)} ${v.pass ? "PASS" : "FAIL"}  extends=[${v.extends.join(", ")}]`)
    if (v.missingEdges.length) console.log(`        missing: ${v.missingEdges.join(", ")}`)
    if (v.forbiddenEdgesPresent.length) console.log(`        FORBIDDEN PRESENT: ${v.forbiddenEdgesPresent.join(", ")}`)
  }
}
console.log("\n-- the per-type edge counts over the admitted population --")
for (const t of FOURTEEN) {
  const d = perType[t]
  console.log(
    `   ${t.padEnd(14)} A=${String(d.A_published).padStart(7)}  B=${String(d.B_published_plus_patch).padStart(7)}  C(wired)=${String(d.C_wired).padStart(7)}` +
      `   B→C ${d.C_wired - d.B_published_plus_patch >= 0 ? "+" : ""}${d.C_wired - d.B_published_plus_patch}`,
  )
}
console.log(`\nfiles where the patched build and the wired build disagree: ${fileDeltas.length}`)
if (jsonOut) {
  mkdirSync(dirname(jsonOut), { recursive: true })
  writeFileSync(jsonOut, JSON.stringify(report, null, 2))
  console.log(`JSON written: ${jsonOut}`)
}
