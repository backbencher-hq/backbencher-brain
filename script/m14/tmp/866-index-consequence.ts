// #866 index-consequence probe. The analyzer sweep proved the kotlin fix ADDS
// anon-body member symbols and MOVES 3539 call sources from the enclosing method
// onto the anonymous type. The anonymous NAME is refused by the store's artifact
// filter, so the question this probe answers is: what does the INDEX actually
// persist for those edges, and do the newly emitted members become rows?
//
// Run twice — once with --root=/tmp/bb-866 (pre-fix) and once against the
// working tree — and compare.
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const ROOT =
  process.argv.find((a) => a.startsWith("--root="))?.slice("--root=".length) ??
  "<corpus-root>/mcp/backbencher-brain"

const SRC =
  [
    "class P {", //                                  1
    "  fun target(): Int = 1", //                    2
    "  fun inMethod() {", //                         3
    "    val t = object : IntIdTable() {", //        4
    "      val name = target()", //                  5  member initialiser (the #866 shape)
    "      override fun run() { target() }", //      6  member function (control: already attributed to run)
    "    }", //                                      7
    "    t.name", //                                 8
    "  }", //                                        9
    "  val inField = object : IntIdTable() {", //   10
    "    val city = target()", //                   11  class-level anon body
    "  }", //                                       12
    "}", //                                         13
  ].join("\n") + "\n"

const project = mkdtempSync(path.join(tmpdir(), "bb-866-index-"))
mkdirSync(path.join(project, "src"), { recursive: true })
const file = path.join(project, "src", "P.kt")
writeFileSync(file, SRC)

const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
const res: any = await ASTEngine.parseFile(file, SRC)
console.log(`=== LAYER 1 (ROOT=${ROOT}): analyzer ===`)
for (const s of (res.symbols ?? []).slice().sort((a: any, b: any) => a.range.startLine - b.range.startLine))
  console.log(`   L${String(s.range.startLine).padStart(3)} ${String(s.kind).padEnd(9)} ${String(s.name).padEnd(16)} owner=${s.ownerName ?? "-"}`)
for (const r of res.relationships ?? []) {
  const src = typeof r.source === "object" ? r.source?.name : r.source
  const tgt = typeof r.target === "object" ? r.target?.name : r.target
  if (String(tgt) === "target")
    console.log(`   ${String(r.type).padEnd(9)} ${String(src).padEnd(20)} -> ${tgt} @ ${r.line_number}`)
}

const { getProjectId } = await import(path.join(ROOT, "src/cli/index.ts"))
const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer.ts"))
const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))

const pid = getProjectId(project) as any
const stats: any = await indexProjectParallel(pid, project, {})
console.log(`\n=== LAYER 2: index (files=${stats.totalFiles} rels=${stats.relationshipsFound} errors=${stats.errorFiles}) ===`)
const craw: any = await BrainDatabase.getRawInstance(pid)

console.log("   persisted symbols:")
for (const s of craw
  .prepare(
    "SELECT name,symbol_type,line_start,line_end,owner_symbol_id FROM brain_symbol WHERE file_id IN (SELECT id FROM brain_file WHERE relative_path LIKE '%P.kt') ORDER BY line_start",
  )
  .all())
  console.log(`   L${String(s.line_start).padStart(3)}-${String(s.line_end).padEnd(3)} ${String(s.symbol_type).padEnd(9)} ${String(s.name).padEnd(16)} owner=${s.owner_symbol_id ?? "NULL"}`)

console.log("   persisted call rows targeting `target`:")
for (const r of craw
  .prepare(
    `SELECT r.relationship_type t, r.line_number ln, r.source_symbol_id ss, r.source_external se, r.metadata md,
            s.name sname, s.line_start sline
     FROM brain_relationship r
     LEFT JOIN brain_symbol s ON s.id = r.source_symbol_id
     WHERE r.relationship_type IN ('calls','call') AND (r.target_external LIKE '%target%' OR r.target_symbol_id IN (SELECT id FROM brain_symbol WHERE name='target'))
     ORDER BY r.line_number`,
  )
  .all())
  console.log(
    `   L${String(r.ln).padStart(3)} src=${String(r.sname ?? "NULL").padEnd(18)}(L${r.sline ?? "-"}) src_ext=${String(r.se ?? "-").padEnd(14)}${r.md && r.md.includes("synthetic") ? " meta=has-synthetic" : ""}`,
  )
console.log(`\nproject dir: ${project}`)
