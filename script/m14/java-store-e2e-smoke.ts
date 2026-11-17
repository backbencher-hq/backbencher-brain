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
import { handleGraphRequest, GRAPH_SCHEMA_VERSION } from "../../src/lsp/graph_request"

const root = mkdtempSync(join(tmpdir(), "bb-java-sqlite-proof-"))
const projectId = `java-sqlite-proof-${process.pid}-${Date.now()}` as any
const files = [
  {
    relative: "alpha/Alpha.java",
    content: `package alpha;
import java.util.List;
import beta.Beta;
public class Alpha {
  public String identity(String x) { return x; }
  public int identity(int x) { return x; }
  public void use() { identity("a"); identity(7); }
}`,
  },
  {
    relative: "beta/Beta.java",
    content: `package beta;
import java.util.List;
import alpha.Alpha;
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
  // Both import channels are intentional: 2 declaration-evidence imports
  // and 2 file-level graph dependencies. The storage ID must preserve all 4.
  assertThat(rows.length === 4,
    `two Java files x two import channels must survive storage; got ${rows.length}`)
  const fileRows = rows.filter((row) =>
    row.source_external === "alpha/Alpha.java" || row.source_external === "beta/Beta.java")
  assertThat(fileRows.length === 2,
    `expected two file-level graph dependencies, got ${fileRows.length}`)
  const actualSources = fileRows.map((row) => row.source_external).sort()
  assertThat(
    actualSources[0] === "alpha/Alpha.java" && actualSources[1] === "beta/Beta.java",
    `file-level edges attached to wrong files: ${actualSources.join(",")}`,
  )
  assertThat(fileRows.every((row) => row.source_symbol_id === null), "file-level import sources must be NULL symbol ids")
  assertThat(new Set(rows.map((row) => row.id)).size === 4, "both import channels in both files must have distinct relationship ids")
  // Importing a project-owned class is a valid file dependency too.
  // The graph consumer explicitly requires *both* symbol endpoints NULL,
  // even if another resolver can identify the type declaration.
  // Only the declaration-evidence sibling may bind to that symbol.
  for (const [file, imported] of [
    ["alpha/Alpha.java", "beta.Beta"],
    ["beta/Beta.java", "alpha.Alpha"],
  ]) {
    const deps: Array<{ id: string; moduleSpecifier: string }> = db.prepare(
      "SELECT id, target_external AS moduleSpecifier FROM brain_relationship " +
      "WHERE project_id = ? AND relationship_type = 'imports' " +
      "AND source_symbol_id IS NULL AND source_external = ? " +
      "AND target_external = ?"
    ).all(projectId, file, imported)
    assertThat(deps.length === 1,
      `bb_graph file dependencies must include local project import ${file} -> ${imported}; rows=${deps.length}`)
    const oldQuery: Array<{ id: string }> = db.prepare(
      "SELECT id FROM brain_relationship WHERE project_id = ? " +
      "AND relationship_type = 'imports' AND source_symbol_id IS NULL " +
      "AND target_symbol_id IS NULL AND source_external = ? AND target_external = ?"
    ).all(projectId, file, imported)
    assertThat(oldQuery.length === 0,
      `negative control: old graph query should incorrectly hide resolved local import ${imported}`)

  }
  const symbols: Array<{ qualified_name: string; name: string }> =
    db.prepare(`SELECT qualified_name, name FROM brain_symbol
                WHERE project_id = ? AND name IN ('Alpha', 'Beta') ORDER BY qualified_name`).all(projectId)
  const qualified = symbols.map((row) => row.qualified_name)
  assertThat(qualified.includes("alpha.Alpha") && qualified.includes("beta.Beta"),
    `qualified Java class names must persist: ${JSON.stringify(symbols)}`)
  const ids: Array<{ qualified_name: string; name: string }> =
    db.prepare(`SELECT qualified_name, name FROM brain_symbol WHERE project_id = ? AND name = 'identity'`).all(projectId)
  assertThat(ids.length >= 3, `overloaded/cross-file method declarations lost during indexing: ${JSON.stringify(ids)}`)
  // Exercise the actual LSP bb/graph usages handler and grouping logic,
  // not a test-only copy of its SQL. Only graph traversal is stubbed because
  // this probe targets the real indexed file-dependency consumer.
  for (const [name, file, imported] of [
    ["Alpha", "alpha/Alpha.java", "beta.Beta"],
    ["Beta", "beta/Beta.java", "alpha.Alpha"],
  ]) {
    const symbol = db.prepare(
      "SELECT id FROM brain_symbol WHERE project_id = ? AND name = ? LIMIT 1"
    ).get(projectId, name) as { id: string } | undefined
    assertThat(symbol?.id, `class ${name} must be indexed to exercise graph usages`)
    const result: any = await handleGraphRequest(db, projectId,
      { schemaVersion: GRAPH_SCHEMA_VERSION, symbol: name, mode: "usages" },
      { traverse: async () => ({
        root: { id: symbol.id, name, file, language: "java", line: 3, symbolType: "class" },
        nodes: {}, callers: [], callees: [],
        summary: { truncated: false, truncationReason: null },
      }) as any }
    )
    const dependencies = result.fileLevel?.dependencies ?? []
    assertThat(dependencies.some((e: any) => e.moduleSpecifier === imported),
      `real bb/graph usages must include ${file} -> ${imported}; got ${JSON.stringify(dependencies)}`)
    // Unlike the assertion above, this call uses the actual graphTraversal
    // implementation rather than a controlled traversal payload.
    const liveResult: any = await handleGraphRequest(db, projectId,
      { schemaVersion: GRAPH_SCHEMA_VERSION, symbol: name, mode: "usages" })
    const liveDependencies = liveResult.fileLevel?.dependencies ?? []
    assertThat(liveDependencies.some((e: any) => e.moduleSpecifier === imported),
      `real traversal + graph usages lost local import ${file} -> ${imported}; ${JSON.stringify(liveDependencies)}`)

  }
  // Calls to a shared leaf must not silently bind to the wrong file.
  // Alpha and Beta both declare identity(...), while Alpha also overloads it.
  const callBindings: Array<{
    sourceName: string | null
    sourceFile: string | null
    targetQualified: string | null
    targetFile: string | null
    targetId: string | null
    targetExternal: string
  }> = db.prepare(`
    SELECT s.name AS sourceName, sf.relative_path AS sourceFile,
      t.qualified_name AS targetQualified, tf.relative_path AS targetFile,
      r.target_symbol_id AS targetId, r.target_external AS targetExternal
    FROM brain_relationship r
    LEFT JOIN brain_symbol s ON s.id = r.source_symbol_id
    LEFT JOIN brain_file sf ON sf.id = s.file_id
    LEFT JOIN brain_symbol t ON t.id = r.target_symbol_id
    LEFT JOIN brain_file tf ON tf.id = t.file_id
    WHERE r.project_id = ? AND r.relationship_type = 'calls'
      AND r.target_external = 'identity'
  `).all(projectId)
  console.log("JAVA_SQLITE_CALL_BINDINGS", JSON.stringify(callBindings))
  // The source has two distinct Alpha.identity overload declarations.
  // Literal arguments choose separate methods under javac: String vs int.
  // Reporting the SAME concrete declaration for both would be a fabricated
  // binding. Null is acceptable as a stated unresolved/ambiguous target.
  const alphaCalls = callBindings.filter(row => row.sourceName === "use" &&
    row.sourceFile === "alpha/Alpha.java")
  assertThat(alphaCalls.length === 2,
    `expected two distinct Alpha identity call sites, got ${alphaCalls.length}`)
  const boundAlpha = alphaCalls.map(row => row.targetId).filter((id): id is string => !!id)
  assertThat(new Set(boundAlpha).size === boundAlpha.length,
    `overload confusion: two different literal argument types both bound to the same concrete method: ${JSON.stringify(alphaCalls)}`)

  for (const [sourceFile, targetQualified] of [
    ["alpha/Alpha.java", "alpha.Alpha.identity"],
    ["beta/Beta.java", "beta.Beta.identity"],
  ]) {
    const calls = callBindings.filter(row => row.sourceName === "use" && row.sourceFile === sourceFile)
    assertThat(calls.length >= 1, `expected indexed identity call in ${sourceFile}`)
    for (const call of calls) {
      assertThat(call.targetId === null || call.targetQualified === targetQualified,
        `WRONG JAVA TARGET: ${sourceFile} must call ${targetQualified} or remain unresolved, got ${JSON.stringify(call)}`)
    }
  }
  console.log(`JAVA_SQLITE_E2E_PASS: 4/4 import channel rows, 2/2 file-level dependencies and ${ids.length} overloaded/cross-file declarations stored; real traversal and graph usages answered both project-local imports`)
} finally {
  rmSync(root, { recursive: true, force: true })
}
