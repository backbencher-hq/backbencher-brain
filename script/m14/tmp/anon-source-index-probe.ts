// #855 corrected diagnosis probe.
//
// Claim under test: the scala analyzer DOES emit `calls <anon> -> target` for a
// call inside an anonymous-class member initialiser; the INDEX drops the
// attribution (artifact-name filter nulls the source) and the TOOL then cannot
// report the site. This probe prints all three layers for one tiny project.
//
//   bun script/m14/tmp/anon-source-index-probe.ts
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
const ROOT = "<corpus-root>/mcp/backbencher-brain"

const SRC = [
  "object F {", //                                    1
  "  def targetScala(): Int = 1", //                  2
  "", //                                              3
  "  def plainCaller(): Int =", //                    4
  "    targetScala()", //                             5  control: normal next-line call
  "", //                                              6
  "  def anonCaller(delegate: Delegate): Unit = {", // 7
  "    val anon = new Runnable {", //                 8
  "      val cancel =", //                            9
  "        targetScala()", //                        10  the #855 shape (val, anon body, next line)
  "      def run2(): Int =", //                      11
  "        targetScala()", //                        12  def in the same anon body
  "    }", //                                        13
  "    anon.hashCode()", //                          14
  "  }", //                                          15
  "}", //                                            16
].join("\n") + "\n"

const project = mkdtempSync(path.join(tmpdir(), "bb-anon-probe-"))
mkdirSync(path.join(project, "src"), { recursive: true })
writeFileSync(path.join(project, "src", "F.scala"), SRC)
const file = path.join(project, "src", "F.scala")

// ── layer 1: the analyzer ────────────────────────────────────────────────────
const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
const res: any = await ASTEngine.parseFile(file, SRC)
console.log("=== LAYER 1: analyzer symbols ===")
for (const s of (res.symbols ?? []).slice().sort((a: any, b: any) => a.range.startLine - b.range.startLine))
  console.log(`   L${String(s.range.startLine).padStart(3)}-${String(s.range.endLine).padEnd(3)} ${String(s.kind).padEnd(11)} ${String(s.name).padEnd(20)} owner=${s.ownerName ?? "-"}`)
console.log("=== LAYER 1: analyzer relationships (target or source mentions targetScala / anon) ===")
for (const r of res.relationships ?? [])
  if (
    String(r.target).includes("targetScala") ||
    String(r.source).includes("anonymous") ||
    String(r.target).includes("anonymous") ||
    String(r.target) === "cancel" ||
    String(r.target) === "run2"
  )
    console.log(
      `   ${String(r.type).padEnd(12)} ${String(r.source).padEnd(18)} -> ${String(r.target).padEnd(20)} @ ${r.line_number}`,
    )

// ── layer 2 + 3: the index and the tool ──────────────────────────────────────
const { getProjectId } = await import(path.join(ROOT, "src/cli/index.ts"))
const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer.ts"))
const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))
const { graphTraversal } = await import(path.join(ROOT, "src/intelligence/graph/graph-engine.ts"))

const pid = getProjectId(project) as any
const stats: any = await indexProjectParallel(pid, project, {})
console.log(`\nindexed: files=${stats.totalFiles} rels=${stats.relationshipsFound} errors=${stats.errorFiles}`)
const craw: any = await BrainDatabase.getRawInstance(pid)

console.log("=== LAYER 2: indexed symbols ===")
for (const s of craw
  .prepare("SELECT id,name,qualified_name,symbol_type,line_start,line_end,owner_symbol_id FROM brain_symbol WHERE file_id IN (SELECT id FROM brain_file WHERE relative_path LIKE '%F.scala') ORDER BY line_start")
  .all())
  console.log(`   L${String(s.line_start).padStart(3)}-${String(s.line_end).padEnd(3)} ${String(s.symbol_type).padEnd(11)} ${String(s.name).padEnd(20)} owner=${s.owner_symbol_id ?? "NULL"}`)

console.log("=== LAYER 2: indexed rows for targetScala (source attribution) ===")
for (const r of craw
  .prepare(
    `SELECT r.id, r.relationship_type t, r.line_number ln, r.source_symbol_id ss, r.source_external se, r.target_symbol_id ts,
            r.metadata md, s.name sname, s.line_start sline
     FROM brain_relationship r
     LEFT JOIN brain_symbol s ON s.id = r.source_symbol_id
     LEFT JOIN brain_symbol ts ON ts.id = r.target_symbol_id
     WHERE r.relationship_type IN ('calls','call')
       AND (ts.name = 'targetScala' OR r.target_external LIKE '%targetScala%')
     ORDER BY r.line_number`,
  )
  .all())
  console.log(
    `   L${String(r.ln).padStart(3)} src=${r.sname ?? "NULL"}(L${r.sline ?? "-"}) src_ext=${r.se ?? "-"} tgt=${r.ts ? "resolved" : "NULL"}${r.md && r.md.includes("synthetic") ? " meta=" + r.md : ""}`,
  )

console.log("=== LAYER 3: tool (graphTraversal callers of targetScala) ===")
const t: any = await graphTraversal(pid, "targetScala", {})
for (const c of t.callers ?? [])
  console.log(`   depth=${c.depth ?? "?"} from=${String(c.from).split(":").slice(-2).join(":")} rowId=${c.rowId ? "yes" : "no"} site=${c.callSite?.file?.split("/").slice(-1)[0]}:${c.callSite?.line}`)
console.log(`   tool sites: ${JSON.stringify([...new Set((t.callers ?? []).filter((x: any) => (x.depth ?? 0) === 0).map((x: any) => x.callSite?.line))].sort())}`)
console.log(`\nproject dir: ${project}`)
