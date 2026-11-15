// #867 index-consequence probe. The owner ruling moves kotlin's anonymous-type
// owners from the enclosing CLASS to the enclosing METHOD (or, for a top-level
// function, from no owner to that function), and the sweep showed import
// reference edges move off the anon type onto the file's real primary type /
// the `root` placeholder. `anonymous_*` names are refused by the store's
// artifact filter, so what the INDEX persists is a separate question from what
// the analyzer emits — this probe answers it by indexing a two-file kotlin
// project through the real pipeline and dumping the rows.
//
// Run twice: --root=/tmp/pre867 (pre-ruling) and against the working tree.
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const ROOT =
  process.argv.find((a) => a.startsWith("--root="))?.slice("--root=".length) ??
  "/home/ishaq2321/mcp/backbencher-brain"

// A.kt: both contexts the ruling pins (class-level literal vs in-method literal).
const A = [
  "class P {", //                         1
  "  fun target(): Int = 1", //           2
  "  fun inMethod() {", //                 3
  "    val t = object : IntIdTable() {", //4  in-method literal
  "      val name = target()", //          5
  "      override fun run() { target() }", //6
  "    }", //                              7
  "    t.name", //                         8
  "  }", //                                9
  "  val inField = object : IntIdTable() {", //10 class-level literal
  "    val city = target()", //           11
  "  }", //                               12
  "}", //                                 13
].join("\n") + "\n"

// B.kt: NO top-level class — a top-level function's literal, plus an import whose
// reference edge the anonymous type used to claim.
const B = [
  "package com.acme.hasno", //            1
  "", //                                  2
  "import kotlin.coroutines.Continuation", //3
  "", //                                  4
  "fun topLevel(): Continuation<Unit>? {", //5
  "    val r = object : Runnable {", //   6
  "        override fun run() { }", //    7
  "    }", //                             8
  "    return null", //                   9
  "}", //                                10
].join("\n") + "\n"

const project = mkdtempSync(path.join(tmpdir(), "bb-867-index-"))
mkdirSync(path.join(project, "src"), { recursive: true })
writeFileSync(path.join(project, "src", "A.kt"), A)
writeFileSync(path.join(project, "src", "B.kt"), B)

const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
console.log(`=== LAYER 1 (ROOT=${ROOT}): analyzer symbols for anonymous types ===`)
for (const [file, src] of [["A.kt", A], ["B.kt", B]] as const) {
  const res: any = await ASTEngine.parseFile(path.join(project, "src", file), src)
  for (const s of res.symbols ?? []) {
    if (String(s.name).startsWith("anonymous_") || s.name === "inField" || s.name === "classLevel") {
      console.log(`   ${file} L${String(s.range?.startLine).padStart(2)} ${String(s.kind).padEnd(8)} ${String(s.name).padEnd(18)} owner=${s.ownerName ?? "-"}`)
    }
  }
  for (const r of res.relationships ?? []) {
    const src_ = typeof r.source === "object" ? r.source?.name : r.source
    const tgt = typeof r.target === "object" ? r.target?.name : r.target
    if (String(tgt).startsWith("anonymous_") || String(src_).startsWith("anonymous_") || (r.metadata?.isImportDep && String(src_) !== "root")) {
      console.log(`   ${file} rel L${r.line_number} ${String(r.type).padEnd(9)} ${String(src_).padEnd(20)} -> ${tgt}`)
    }
  }
}

const { getProjectId } = await import(path.join(ROOT, "src/cli/index.ts"))
const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer.ts"))
const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))

const pid = getProjectId(project) as any
const stats: any = await indexProjectParallel(pid, project, {})
console.log(`\n=== LAYER 2: index (files=${stats.totalFiles} rels=${stats.relationshipsFound} errors=${stats.errorFiles}) ===`)
const craw: any = await BrainDatabase.getRawInstance(pid)

console.log("   persisted symbols (both files):")
for (const s of craw
  .prepare(
    "SELECT f.relative_path rp, s.name, s.symbol_type, s.line_start FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id ORDER BY f.relative_path, s.line_start",
  )
  .all())
  console.log(`   ${String(s.rp).padEnd(14)} L${String(s.line_start).padStart(3)} ${String(s.symbol_type).padEnd(8)} ${s.name}`)

console.log("   ALL persisted rows of the two files (relationship_type | line | source -> target):")
for (const r of craw
  .prepare(
    `SELECT f.relative_path rp, r.relationship_type t, r.line_number ln,
            COALESCE(s.name, r.source_external) sname, COALESCE(ts.name, r.target_external) tname
     FROM brain_relationship r
     LEFT JOIN brain_symbol s ON s.id=r.source_symbol_id
     LEFT JOIN brain_symbol ts ON ts.id=r.target_symbol_id
     JOIN brain_file f ON f.id=COALESCE(s.file_id, ts.file_id)
     ORDER BY f.relative_path, r.line_number, r.relationship_type`,
  )
  .all())
  console.log(
    `   ${String(r.rp).padEnd(12)} L${String(r.ln).padStart(3)} ${String(r.t).padEnd(10)} ${String(r.sname ?? "NULL").padEnd(22)} -> ${String(r.tname ?? "NULL")}`,
  )
console.log(`\nproject dir: ${project}`)
