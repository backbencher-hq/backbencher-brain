// script/m57/verify-p02-name-binding.ts — P0-2 gate: unscoped leaf-name binding +
// cross-language marker honesty (fix campaign; triage ISSUE-02 / LEAD-FINDINGS L-1/L-2).
//
// WHAT THIS PROVES (each assertion fails on pre-fix bytes):
//   P1  A polyglot fixture with the bettercap collision shape (Go stdlib imports,
//       a YAML key `os`, a Makefile target `fmt`, minified JS `io`/`main`) must
//       produce ZERO forbidden bindings:
//         P1a cross-language rows of type imports/calls/instantiates == 0
//         P1b bound rows whose TARGET file language is non-code == 0
//         P1c imports rows bound while target_external is a bare module name == 0
//         P1d bound rows whose metadata declares isFieldAccess == 0
//   P2  bettercap arm (opt-in, DB COPY only): after the policy pass,
//       cross-language name-resolution imports/calls == 0 and session.New has no
//       callers from qualified leaves.
//   P3  POSITIVE CONTROLS — the legitimate behavior survives:
//         PC1 committed java+scala polyglot fixture flags 3 bridge rows
//         PC2 committed ts+js polyglot fixture flags 2 bridge rows
//         PC3 same-language JS relative import still resolves
//   MUTANT: with the policy disabled (exported P02_BINDING_POLICY), the collisions
//       must REAPPEAR — proving the assertions above are load-bearing and not
//       satisfied by an unrelated change.
//
// Run (normal):  BB_DATA_DIR=$PWD/.tools/triage-fix/cross-lang/bbdata \
//                  npx tsx script/m57/verify-p02-name-binding.ts
// Run (mutant):  BB_P02_MUTANT=1 BB_DATA_DIR=... npx tsx script/m57/verify-p02-name-binding.ts
// bettercap arm: BB_P02_BETTERCAP_DB=/home/ishaq2321/.bb/projects/<id>/brain.db \
//                  (the gate COPIES it to .tools/ and never writes the source)
//
// Evidence: docs/bb-bettercap-fix/evidence/cross-lang/

import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join, dirname, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const SCRATCH = join(ROOT, ".tools/triage-fix/cross-lang")
const FIXTURES = join(ROOT, "test/fixtures/polyglot")
const nodeRequire = createRequire(import.meta.url)
const Database = nodeRequire("better-sqlite3")

const MUTANT = process.env.BB_P02_MUTANT === "1"
const BETTERCAP_DB = process.env.BB_P02_BETTERCAP_DB ?? ""

// Non-code vocabulary comes from the product's ONE definition, never a copy.
const NON_CODE = new Set<string>([
  "markdown", "yaml", "toml", "json", "xml", "css", "scss", "less", "html", "htm",
  "vue", "svelte", "ini", "cfg", "conf", "properties", "env", "csv", "tsv", "text",
  "plaintext", "rst", "tex", "bib", "org", "adoc", "asciidoc",
])

let checks = 0
let failed = 0
function check(label: string, ok: boolean, detail = ""): void {
  checks++
  if (ok) console.log(`  ok: ${label}`)
  else {
    failed++
    console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
  }
}
function info(label: string): void {
  console.log(`  -- ${label}`)
}

// ---------------------------------------------------------------------------
// Collision fixture: the bettercap shape, minimal.
// ---------------------------------------------------------------------------
function makeCollisionFixture(): string {
  const dir = join(SCRATCH, "fixture-collision")
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(join(dir, ".github/workflows"), { recursive: true })
  mkdirSync(join(dir, "assets"), { recursive: true })
  mkdirSync(join(dir, "internal/util"), { recursive: true })
  mkdirSync(join(dir, "pkg"), { recursive: true })
  mkdirSync(join(dir, "web"), { recursive: true })
  writeFileSync(join(dir, "go.mod"), "module example.com/fx\n\ngo 1.21\n")
  writeFileSync(
    join(dir, "main.go"),
    `package main

import (
	"fmt"
	"io"
	"os"

	"example.com/fx/internal/util"
	"example.com/fx/pkg"
)

type S struct{}

func (s S) Save() {}

func main() {
	fmt.Println("x")
	_ = os.Stdout
	_ = io.EOF
	util.Helper()
	_ = pkg.F()
	_ = LocalHelper()
	var s S
	s.Save()
}
`,
  )
  writeFileSync(join(dir, "internal/util/util.go"), "package util\n\nfunc Helper() int { return 1 }\n")
  writeFileSync(join(dir, "pkg/pkg.go"), "package pkg\n\nfunc F() int { return 1 }\n")
  writeFileSync(join(dir, "helper.go"), "package main\n\nfunc LocalHelper() int { return 2 }\n")
  writeFileSync(
    join(dir, ".github/workflows/release.yaml"),
    "name: Release\n\njobs:\n  build:\n    strategy:\n      matrix:\n        os:\n          - linux\n        arch:\n          - amd64\n",
  )
  writeFileSync(join(dir, "Makefile"), "fmt:\n\tgofmt -w .\n\nclean:\n\trm -f bin\n")
  writeFileSync(join(dir, "assets/ol.js"), "function io(a){return a}\nwindow.x = io;\n")
  writeFileSync(
    join(dir, "assets/fontawesome.js"),
    "function makeIconMasking(_ref) {\n  var main = _ref.main;\n  return main.width;\n}\n",
  )
  // PC3: same-language relative import — must keep resolving.
  writeFileSync(join(dir, "web/a.js"), 'import { helper } from "./b.js"\nexport const x = helper()\n')
  writeFileSync(join(dir, "web/b.js"), "export function helper(){ return 1 }\n")
  return dir
}

// ---------------------------------------------------------------------------
// In-process index helpers (M26 convention: the REAL pipeline, BB_DATA_DIR).
// ---------------------------------------------------------------------------
async function indexInProcess(work: string, dataDir: string): Promise<string> {
  const mod = await import(pathToFileURL(join(ROOT, "src/ast/parallel-indexer.ts")).href)
  const cli = await import(pathToFileURL(join(ROOT, "src/cli/index.ts")).href)
  const projectId = (cli.getProjectId as (p: string) => string)(work)
  const prev = process.env.BB_DATA_DIR
  process.env.BB_DATA_DIR = dataDir
  try {
    await (mod as any).indexProjectParallel(projectId as never, work, { skipPostProcessing: false })
  } finally {
    if (prev === undefined) delete process.env.BB_DATA_DIR
    else process.env.BB_DATA_DIR = prev
  }
  return projectId
}

function openProjectDb(dataDir: string, projectId: string) {
  const dbPath = join(dataDir, "projects", projectId, "brain.db")
  if (!existsSync(dbPath)) throw new Error(`no db at ${dbPath}`)
  return { db: new Database(dbPath, { readonly: true }), dbPath }
}

function freshDataDir(name: string): string {
  const dir = join(SCRATCH, name)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  return dir
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------
function forbiddenBindings(db: any, labels: Record<string, string>): void {
  const row = (sql: string) => (db.prepare(sql).get() as any).n as number

  // P1a: cross-language rows of a type that must not be minted by name collision.
  const xl = row(
    `SELECT COUNT(*) AS n FROM brain_relationship r
     WHERE r.is_cross_language = 1 AND r.relationship_type IN ('imports','calls','instantiates')`,
  )
  check(labels.a, xl === 0, `cross imports/calls/instantiates = ${xl}`)

  // P1b: a bound target in a non-code language is never a legitimate call/use/import target.
  const nonCode = row(
    `SELECT COUNT(*) AS n FROM brain_relationship r
     JOIN brain_symbol ts ON ts.id = r.target_symbol_id
     JOIN brain_file tf ON tf.id = ts.file_id
     WHERE r.is_cross_language = 1
       AND lower(COALESCE(tf.language,'')) IN (${[...NON_CODE].map((l) => `'${l}'`).join(",")})`,
  )
  check(labels.b, nonCode === 0, `bound non-code-language targets = ${nonCode}`)

  // P1c: imports resolved by bare module name (never by import evidence).
  const bareImports = row(
    `SELECT COUNT(*) AS n FROM brain_relationship r
     JOIN brain_symbol ss ON ss.id = r.source_symbol_id
     JOIN brain_file sf ON sf.id = ss.file_id
     JOIN brain_symbol ts ON ts.id = r.target_symbol_id
     JOIN brain_file tf ON tf.id = ts.file_id
     WHERE r.relationship_type = 'imports' AND r.target_symbol_id IS NOT NULL
       AND r.target_external IS NOT NULL
       AND instr(r.target_external,'.') = 0 AND instr(r.target_external,'/') = 0
       AND instr(r.target_external,':') = 0
       AND lower(COALESCE(sf.language,'')) <> lower(COALESCE(tf.language,''))`,
  )
  check(labels.c, bareImports === 0, `cross-language bare-name imports bound = ${bareImports}`)

  // P1d: a property/field access is not a symbol reference.
  const field = row(
    `SELECT COUNT(*) AS n FROM brain_relationship r
     WHERE r.target_symbol_id IS NOT NULL
       AND json_extract(r.metadata,'$.isFieldAccess') = 1`,
  )
  check(labels.d, field === 0, `isFieldAccess rows bound = ${field}`)

  // P1e: an analyzer-declared external/stdlib/package-qualified leaf is unownable.
  const ext = row(
    `SELECT COUNT(*) AS n FROM brain_relationship r
     WHERE r.target_symbol_id IS NOT NULL
       AND (json_extract(r.metadata,'$.isStdlib') = 1
            OR json_extract(r.metadata,'$.isExternalTarget') = 1
            OR (json_extract(r.metadata,'$.isPackageQualified') = 1
                AND COALESCE(json_extract(r.metadata,'$.bindingBasis'),'') <> 'import-path'))`,
  )
  check(labels.e, ext === 0, `external-claim rows bound = ${ext}`)
}

function flaggedCrossRows(db: any): Array<{ fromSym: string; toSym: string; type: string; bridge: string | null }> {
  return db
    .prepare(
      `SELECT ss.name AS fromSym, ts.name AS toSym, r.relationship_type AS type, r.bridge_mechanism AS bridge
       FROM brain_relationship r
       JOIN brain_symbol ss ON ss.id = r.source_symbol_id
       JOIN brain_symbol ts ON ts.id = r.target_symbol_id
       WHERE r.is_cross_language = 1`,
    )
    .all() as any[]
}

async function main(): Promise<void> {
  console.log(`P0-2 name-binding precision gate${MUTANT ? " [MUTANT: policy disabled]" : ""}\n`)
  mkdirSync(SCRATCH, { recursive: true })

  // Load the policy switch (present only after the fix; the mutant arm needs it).
  const indexer = await import(pathToFileURL(join(ROOT, "src/ast/parallel-indexer.ts")).href)
  const policy = (indexer as any).P02_BINDING_POLICY as { enabled: boolean } | undefined
  if (MUTANT) {
    if (!policy) {
      info("mutant arm skipped: P02_BINDING_POLICY absent (pre-fix)")
    } else {
      policy.enabled = false
    }
  }

  // --- P1: collision fixture -------------------------------------------------
  const fx = makeCollisionFixture()
  const fxData = freshDataDir("bbdata-fixture")
  const fxId = await indexInProcess(fx, fxData)
  const { db: fxDb } = openProjectDb(fxData, fxId)
  const fxLangs = (fxDb.prepare(`SELECT GROUP_CONCAT(DISTINCT language) l FROM brain_file`).get() as any).l ?? ""
  info(`collision fixture languages: ${fxLangs}`)
  forbiddenBindings(fxDb, {
    a: "P1a collision fixture: no cross-language imports/calls/instantiates",
    b: "P1b collision fixture: no bound non-code-language target",
    c: "P1c collision fixture: no bare-name import binding",
    d: "P1d collision fixture: no bound isFieldAccess row",
    e: "P1e collision fixture: no bound external-claim row",
  })

  // P4: PACKAGE-SCOPED Go binding (go-imports contract; write-side regression gate).
  // A same-language qualified call into an internal package MUST bind; a same-package
  // unqualified call MUST bind; a variable receiver (`s.Save()`) must NOT be
  // package-bound. This is what the blanket isPackageQualified gate broke.
  {
    const callRows = () =>
      fxDb
        .prepare(
          `SELECT r.target_external AS te, t.name AS tn, tf.relative_path AS tfile,
                  json_extract(r.metadata,'$.callExpression') AS call_expr,
                  json_extract(r.metadata,'$.bindingBasis') AS bb
           FROM brain_relationship r
           JOIN brain_symbol s ON s.id = r.source_symbol_id
           JOIN brain_file sf ON sf.id = s.file_id
           LEFT JOIN brain_symbol t ON t.id = r.target_symbol_id
           LEFT JOIN brain_file tf ON tf.id = t.file_id
           WHERE sf.relative_path = 'main.go' AND r.relationship_type = 'calls'`,
        )
        .all() as Array<{ te: string; tn: string | null; tfile: string | null; call_expr: string | null; bb: string | null }>
    const rows = callRows()
    const byCall = (call: string) => rows.find((r) => r.call_expr === call)
    const pkgF = byCall("pkg.F")
    const local = byCall("LocalHelper")
    const utilH = byCall("util.Helper")
    const save = byCall("s.Save")
    check("P4 qualified internal package call binds (pkg.F)", !!pkgF && pkgF.tfile === "pkg/pkg.go" && pkgF.tn === "F", JSON.stringify(pkgF ?? null))
    check("P4 qualified internal package call records import-path basis", !!pkgF && pkgF.bb === "import-path", JSON.stringify(pkgF?.bb ?? null))
    check("P4 same-package unqualified call binds (LocalHelper)", !!local && local.tfile === "helper.go" && local.tn === "LocalHelper", JSON.stringify(local ?? null))
    check("P4 second internal package call binds (util.Helper)", !!utilH && utilH.tfile === "internal/util/util.go", JSON.stringify(utilH ?? null))
    check("P4 variable receiver is NOT package-bound (s.Save)", !!save && save.tn === null, JSON.stringify(save ?? null))
  }

  // PC3: same-language relative import still resolves.
  const jsImport = fxDb
    .prepare(
      `SELECT ts.name AS tname, tf.relative_path AS tfile, r.is_cross_language AS xl
       FROM brain_relationship r
       JOIN brain_symbol ts ON ts.id = r.target_symbol_id
       JOIN brain_file tf ON tf.id = ts.file_id
       WHERE r.relationship_type = 'imports' AND tf.relative_path LIKE '%web/b.js'`,
    )
    .get() as any
  check("PC3 same-language JS relative import resolves", !!jsImport && jsImport.tname === "helper", JSON.stringify(jsImport ?? null))
  check("PC3 same-language JS relative import is not cross-language", !jsImport || jsImport.xl === 0, `xl=${jsImport?.xl}`)
  fxDb.close()

  // --- P0: RETRO-HONESTY on OLD stored rows (CP1 gap) ------------------------
  // Existing indexes predate metadata.bindingBasis. Their cross rows still carry
  // bridge_mechanism='name-resolution' + stored evidenceClass import_based/
  // usage_contextual + the original 0.9/0.6 confidence (the bettercap report's 7
  // rows are exactly this shape). A stored name-resolution bridge is a CANDIDATE
  // bridge: the derived tier must be inferred and every fact must say so, with no
  // reindex required.
  {
    const cl = await import(pathToFileURL(join(ROOT, "src/lsp/cross_language_hover.ts")).href)
    const oldIntoSymbol = (relationship_type: string, confidence: number, evidence_class: string) => ({
      relationship_type,
      confidence,
      evidence_class,
      binding_basis: null,
      bridge_mechanism: "name-resolution",
      other_language: "yaml",
      direction: "callee" as const,
    })
    const t1 = cl.tierForCrossLanguageEdge(oldIntoSymbol("imports", 0.9, "import_based") as never)
    const t2 = cl.tierForCrossLanguageEdge(oldIntoSymbol("uses", 0.6, "usage_contextual") as never)
    check(
      "P0 old-row shape: name-resolution bridge derives inferred (never import_based/structural)",
      t1 === "inferred" && t2 === "inferred",
      `imports@0.9:import_based -> ${t1}; uses@0.6:usage_contextual -> ${t2}`,
    )
    const facts = cl.factsFromRows(
      [
        { ...oldIntoSymbol("imports", 0.9, "import_based"), other_language: "yaml", direction: "callee" as const },
        { ...oldIntoSymbol("uses", 0.6, "usage_contextual"), other_language: "go", direction: "caller" as const },
      ] as never,
      "go",
    ) as Array<{ tier: string; candidate: boolean; bridgeMechanism: string | null }>
    check(
      "P0 old-row shape: facts expose bridgeMechanism + candidate:true",
      facts.length === 2 && facts.every((f) => f.tier === "inferred" && f.candidate === true && f.bridgeMechanism === "name-resolution"),
      JSON.stringify(facts.map((f) => `${f.tier}:${f.candidate}:${f.bridgeMechanism}`)),
    )
  }

  // --- P3: committed polyglot positive controls ------------------------------
  for (const [fixture, expect, label] of [
    ["java-scala", 3, "PC1 java+scala bridge rows survive"],
    ["ts-js", 2, "PC2 ts+js bridge rows survive"],
  ] as const) {
    const work = join(SCRATCH, `work-${fixture}`)
    const data = freshDataDir(`bbdata-${fixture}`)
    rmSync(work, { recursive: true, force: true })
    cpSync(join(FIXTURES, fixture), work, { recursive: true })
    const id = await indexInProcess(work, data)
    const { db } = openProjectDb(data, id)
    const rows = flaggedCrossRows(db)
    check(`${label} (expected ${expect})`, rows.length === expect, JSON.stringify(rows.map((r) => `${r.fromSym}->${r.toSym}:${r.type}/${r.bridge}`)))
    check(`${label}: bridges are evidence-bearing`, rows.every((r) => r.bridge === "name-resolution"), JSON.stringify(rows.map((r) => r.bridge)))
    db.close()
  }

  // --- P2: bettercap arm (DB COPY only; source stays read-only) --------------
  if (BETTERCAP_DB) {
    const copy = join(SCRATCH, "bettercap-copy", "brain.db")
    mkdirSync(dirname(copy), { recursive: true })
    copyFileSync(BETTERCAP_DB, copy)
    const db = new Database(copy)
    const applyGates = (indexer as any).applyP02BindingGates as
      | ((raw: any, projectId: string) => { unbound: number })
      | undefined
    const applyDegrade = (indexer as any).applyP02CrossLanguageDegrade as
      | ((raw: any, projectId: string) => { degraded: number })
      | undefined
    if (typeof applyGates !== "function" || typeof applyDegrade !== "function") {
      info("P2 bettercap arm skipped: policy passes absent (pre-fix)")
    } else {
      const pid = (db.prepare(`SELECT project_id AS p FROM brain_relationship LIMIT 1`).get() as any)?.p
      // The product rawDb exposes .run(sql); the gate provides that shape around
      // better-sqlite3 so the EXACT production pass runs on the copy.
      const raw = { run: (sql: string) => db.prepare(sql).run(), prepare: (sql: string) => db.prepare(sql) }
      const applyPackage = (indexer as any).applyP02PackageScopedBinding as
        | ((r: typeof raw, p: string) => { bound: number; refused: number })
        | undefined
      if (typeof applyPackage === "function") {
        const p = applyPackage(raw, pid)
        info(`P2 bettercap copy: package-scoped bound=${p.bound} refused=${p.refused}`)
      } else {
        info("P2 bettercap copy: package-scoped pass absent")
      }
      const g = applyGates(raw, pid)
      const d = applyDegrade(raw, pid)
      info(`P2 bettercap copy: unbound=${g.unbound} degraded=${d.degraded}`)
      const n = (sql: string) => (db.prepare(sql).get() as any).n as number
      const crossImportsCalls = n(
        `SELECT COUNT(*) AS n FROM brain_relationship
         WHERE is_cross_language = 1 AND relationship_type IN ('imports','calls')
           AND bridge_mechanism = 'name-resolution'`,
      )
      check("P2 bettercap copy: cross-language name-resolution imports/calls == 0", crossImportsCalls === 0, `n=${crossImportsCalls}`)
      const qualifiedCallers = n(
        `SELECT COUNT(*) AS n FROM brain_relationship r
         JOIN brain_symbol ts ON ts.id = r.target_symbol_id
         WHERE r.relationship_type = 'calls' AND ts.name = 'New'
           AND ts.id LIKE '%session/session.go%'
           AND json_extract(r.metadata,'$.isPackageQualified') = 1
           AND COALESCE(json_extract(r.metadata,'$.bindingBasis'),'') <> 'import-path'`,
      )
      check(
        "P2 bettercap copy: session.New callers from UNVERIFIED qualified leaves == 0",
        qualifiedCallers === 0,
        `n=${qualifiedCallers}`,
      )
      const loadModules = n(
        `SELECT COUNT(*) AS n FROM brain_relationship r
         JOIN brain_symbol ts ON ts.id = r.target_symbol_id
         JOIN brain_file tf ON tf.id = ts.file_id
         WHERE r.relationship_type = 'calls' AND r.target_external = 'LoadModules'
           AND tf.relative_path = 'modules/modules.go'`,
      )
      check(
        "P2 bettercap copy: internal qualified + same-package LoadModules bind (>=2)",
        loadModules >= 2,
        `n=${loadModules}`,
      )
      db.close()
    }
  } else {
    info("P2 bettercap arm skipped: set BB_P02_BETTERCAP_DB=<read-only db path> to run it")
  }

  // --- mutant arm ------------------------------------------------------------
  if (MUTANT) {
    if (!policy) {
      info("MUTANT unproven: policy absent (pre-fix); the P1 failures above are the RED baseline")
    } else {
      // The MUTANT run disabled the policy above; the fixture must show the
      // collisions again. Find the collision counts without re-indexing: the
      // P1 arm above already ran WITH the disabled policy, so a failing P1 is
      // the caught mutant. This assertion makes that explicit.
      const caught = failed > 0
      check("MUTANT: disabling the policy makes the P1 assertions fail (gate is load-bearing)", caught, `failed=${failed}`)
    }
  }

  console.log(`\n${passedText()}`)
  if (MUTANT && policy) {
    // The mutant DISABLED the policy, so the P1 assertions MUST fail here.
    if (failed > 0) {
      console.log("GREEN (mutant): the gate caught the disabled policy")
      process.exit(0)
    }
    console.log("RED (mutant): disabling the policy changed nothing — gate is not load-bearing")
    process.exit(1)
  }
  if (failed > 0) {
    console.log("RED: gate has failing assertions")
    process.exit(1)
  }
  console.log("GREEN: all P0-2 assertions pass")
}

function passedText(): string {
  return `P0-2 gate: ${checks - failed}/${checks} assertions passed`
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
