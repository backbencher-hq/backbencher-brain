// script/m59/probe-anon-init-regression.ts — M59.ACC follow-up
//
// The acceptance harness's `scala-anon-initializer` fixture passed at 9c8b9b83
// (toolSites 2 @ [6,8]) and returns 0 at the current tree. This probe decides
// WHY, on the fixture alone, by printing all three layers separately:
//
//   1. ANALYZER — what ASTEngine emits for Fanon.scala (source spelling + line)
//   2. STORE    — what brain_relationship actually persisted (source id, its
//                 symbol name if resolvable, source_external, line_number)
//   3. TOOL     — what graphTraversal answers for the callee, with `from`
//
// The three answers separate "the fixture's expectation went stale" (analyzer
// and store are right, the tool reports a finer source) from "the #855
// attribution defect came back" (store has NULL source again).
//
// Usage: npx tsx script/m59/probe-anon-init-regression.ts

process.env.BB_DATA_DIR = "/tmp/m59-anon-probe-" + Date.now()

const SRC = [
  "object Fanon {",
  "  def targetScalaAnon(): Int = 1",
  "  def callerScalaAnon(): Unit =",
  "    new Runnable {",
  "      val a =",
  "        targetScalaAnon()",
  "      val b =",
  "        targetScalaAnon()",
  "    }",
  "}",
  "",
].join("\n")

async function main() {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs")
  const { tmpdir } = await import("node:os")
  const path = await import("node:path")
  const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")

  const { getProjectId } = await import(path.join(ROOT, "src/cli/index.ts"))
  const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer.ts"))
  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))
  const { graphTraversal } = await import(path.join(ROOT, "src/intelligence/graph/graph-engine.ts"))

  const project = mkdtempSync(path.join(tmpdir(), "m59-anon-proj-"))
  mkdirSync(path.join(project, "src"), { recursive: true })
  writeFileSync(path.join(project, "src", "Fanon.scala"), SRC)

  console.log("=== fixture (lines numbered as the harness numbers them) ===")
  SRC.split("\n").forEach((l, i) => console.log(String(i + 1).padStart(3), l))

  const pid = getProjectId(project) as any
  await indexProjectParallel(pid, project, {})

  const db: any = await BrainDatabase.getRawInstance(pid)

  // ── 2. STORE ──────────────────────────────────────────────────────────────
  const cols = (db.prepare("PRAGMA table_info(brain_relationship)").all() as any[]).map((c) => c.name)
  console.log("\n=== brain_relationship columns ===")
  console.log(cols.join(", "))

  const symCols = (db.prepare("PRAGMA table_info(brain_symbol)").all() as any[]).map((c) => c.name)
  console.log("\n=== brain_symbol columns ===")
  console.log(symCols.join(", "))

  const rels = db
    .prepare(
      `SELECT r.id, r.source_symbol_id, r.target_symbol_id, r.source_external, r.target_external,
              r.relationship_type, r.line_number,
              s.name AS source_name, s.line_start AS source_start, s.symbol_type AS source_type, s.scope_kind AS source_scope,
              t.name AS target_name
       FROM brain_relationship r
       LEFT JOIN brain_symbol s ON s.id = r.source_symbol_id
       LEFT JOIN brain_symbol t ON t.id = r.target_symbol_id
       WHERE r.target_external LIKE '%targetScalaAnon%'
          OR t.name LIKE '%targetScalaAnon%'`,
    )
    .all() as any[]

  console.log(`\n=== STORE: ${rels.length} row(s) mentioning the callee (ALL relationship types) ===`)
  for (const r of rels) {
    console.log(
      JSON.stringify({
        type: r.relationship_type,
        line: r.line_number,
        source_symbol_id: r.source_symbol_id,
        source_name: r.source_name,
        source_start: r.source_start,
        source_type: r.source_type,
        source_scope: r.source_scope,
        source_external: r.source_external,
        target_name: r.target_name ?? r.target_external,
        id: String(r.id).slice(-60),
      }),
    )
  }

  // ── every symbol this file stored (is the anon body's field member one?) ──
  const syms = db
    .prepare(
      `SELECT s.id, s.name, s.symbol_type, s.scope_kind, s.line_start, s.line_end, s.owner_symbol_id, o.name AS owner_name
       FROM brain_symbol s LEFT JOIN brain_symbol o ON o.id = s.owner_symbol_id
       WHERE s.file_id = (SELECT id FROM brain_file WHERE relative_path LIKE '%Fanon.scala')
       ORDER BY s.line_start`,
    )
    .all() as any[]
  console.log(`\n=== STORE: ${syms.length} symbol(s) stored for Fanon.scala ===`)
  for (const s of syms) {
    console.log(
      JSON.stringify({
        name: s.name,
        type: s.symbol_type,
        scope: s.scope_kind,
        lines: `${s.line_start}-${s.line_end}`,
        owner: s.owner_name,
      }),
    )
  }

  // ── 3. TOOL ───────────────────────────────────────────────────────────────
  const t: any = await graphTraversal(pid, "targetScalaAnon", {})
  console.log("\n=== TOOL: graphTraversal('targetScalaAnon') ===")
  const callers = (t.callers ?? []) as any[]
  console.log(`callers: ${callers.length}`)
  for (const c of callers) {
    console.log(
      JSON.stringify({
        from: c.from,
        fromKind: c.fromKind ?? c.kind,
        to: c.to,
        type: c.type ?? c.relationshipType,
        callSite: c.callSite,
        rowId: c.rowId,
      }),
    )
  }

  const withCallerName = callers.filter((c) => String(c.from).includes("callerScalaAnon"))
  console.log(`\ncallers whose \`from\` includes 'callerScalaAnon': ${withCallerName.length}  (the harness's filter)`)

  const inits = rels.filter((r) => r.relationship_type === "calls" || r.relationship_type === "call")
  console.log(`\nVERDICT INPUTS: call rows in store: ${inits.length}`)
  console.log(JSON.stringify({
    analyzerEmittedCalls: inits.length,
    storedLines: inits.map((r) => r.line_number),
    storedSourceNames: [...new Set(inits.map((r) => r.source_name ?? `NULL(source_external=${r.source_external})`))],
    toolCallers: callers.length,
    toolCallersMatchingFixtureFilter: withCallerName.length,
  }, null, 2))
}

main().catch((e) => {
  console.error("PROBE ERROR:", e?.stack ?? e)
  process.exit(1)
})
