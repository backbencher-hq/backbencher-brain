/**
 * Java self-contained production SQLite store proof.
 *
 * Two valid Java files import the same module on the same source line.
 * Both file-level rows must survive under separate file-qualified ids,
 * and both Java declarations must remain distinguishable after indexing.
 * No external corpus and no fake SQLite model are involved.
 */
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ASTEngine } from "../../src/ast/engine"
import { storeResults } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"

const root = mkdtempSync(join(tmpdir(), "bb-java-sqlite-proof-"))
const projectId = `java-sqlite-proof-${process.pid}-${Date.now()}` as any
const files = [
  {
    relative: "alpha/Alpha.java",
    content: `package alpha;
import java.util.List;
public class Alpha {
  public String identity(String x) { return x; }
  public int identity(int x) { return x; }
  public void use() { identity("a"); }
}`,
  },
  {
    relative: "beta/Beta.java",
    content: `package beta;
import java.util.List;
public class Beta {
  public String identity(String x) { return x; }
  public void use() { identity("b"); }
}`,
  },
]
function assertThat(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`JAVA_SQLITE_E2E_FAIL: ${message}`)
}
try {
  const results: any[] = []
  for (const f of files) {
    const filePath = join(root, f.relative)
    mkdirSync(join(root, f.relative.split("/")[0]), { recursive: true })
    writeFileSync(filePath, f.content)
    const st = statSync(filePath)
    const parsed: any = await ASTEngine.parseFile(filePath, readFileSync(filePath, "utf8"))
    assertThat((parsed.imports ?? []).length > 0, `${f.relative} has parsed imports`)
    results.push({
      filePath, success: true, symbols: parsed.symbols ?? [], relationships: parsed.relationships ?? [],
      imports: parsed.imports ?? [], exports: parsed.exports ?? [], language: "java",
      fileHash: "semantic-proof", sizeBytes: st.size, lastModified: st.mtimeMs,
    })
  }
  const emitted = results.flatMap((f) => f.relationships).filter((e: any) =>
    String(e.type ?? e.relationshipType) === "imports" && e.target === "java.util.List" &&
    e.metadata?.fileLevel === true)
  assertThat(emitted.length === 2,
    `expected exactly two file-level Java import edges, got ${emitted.length}`)
  await storeResults(projectId, root, results)
  const db: any = await BrainDatabase.getRawInstance(projectId)
  const rows: Array<{ id: string; source_external: string; target_external: string; source_symbol_id: string | null }> =
    db.prepare(`SELECT id, source_external, target_external, source_symbol_id
                FROM brain_relationship
                WHERE project_id = ? AND relationship_type = 'imports'
                  AND target_external = 'java.util.List' ORDER BY source_external`).all(projectId)
  console.log("JAVA_SQLITE_DIAG", JSON.stringify({ importsEmitted: emitted.map((e:any) => ({ source:e.source,target:e.target,fileLevel:e.metadata?.fileLevel,line:e.line_number })),rows }))
  assertThat(rows.length === 2, `two distinct file-level imports must survive storage; got ${rows.length}`)
  const actualSources = rows.map((row) => row.source_external).sort()
  assertThat(
    actualSources[0] === "alpha/Alpha.java" && actualSources[1] === "beta/Beta.java",
    `file-level edges attached to wrong files: ${actualSources.join(",")}`,
  )
  assertThat(rows.every((row) => row.source_symbol_id === null), "file-level import sources must be NULL symbol ids")
  assertThat(new Set(rows.map((row) => row.id)).size === 2, "two files must not collide on a relationship id")
  const symbols: Array<{ qualified_name: string; name: string }> =
    db.prepare(`SELECT qualified_name, name FROM brain_symbol
                WHERE project_id = ? AND name IN ('Alpha', 'Beta') ORDER BY qualified_name`).all(projectId)
  const qualified = symbols.map((row) => row.qualified_name)
  assertThat(qualified.includes("alpha.Alpha") && qualified.includes("beta.Beta"),
    `qualified Java class names must persist: ${JSON.stringify(symbols)}`)
  const ids: Array<{ qualified_name: string; name: string }> =
    db.prepare(`SELECT qualified_name, name FROM brain_symbol WHERE project_id = ? AND name = 'identity'`).all(projectId)
  assertThat(ids.length >= 3, `overloaded/cross-file method declarations lost during indexing: ${JSON.stringify(ids)}`)
  console.log(`JAVA_SQLITE_E2E_PASS: 2/2 imports and ${ids.length} overloaded/cross-file declarations stored`)
} finally {
  rmSync(root, { recursive: true, force: true })
}
