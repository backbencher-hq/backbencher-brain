// @ts-nocheck — Ported from backbencher. Kept structurally identical for sync.
import { sql, eq, like, and } from "drizzle-orm"

export class TestIntelligence {
  static isTestFile(filePath: string): boolean {
    const lower = filePath.toLowerCase()
    return (
      lower.includes(".test.") ||
      lower.includes(".spec.") ||
      lower.endsWith("_test.go") ||
      lower.endsWith("_test.py") ||
      lower.endsWith("_test.rs") ||
      lower.includes("/tests/") ||
      lower.includes("/__tests__/")
    )
  }

  static guessImplementationFile(testFilePath: string): string {
    let impl = testFilePath
      .replace(/\.spec\./, ".")
      .replace(/\.test\./, ".")
      .replace(/_test\.go$/, ".go")
      .replace(/_test\.py$/, ".py")
      .replace(/_test\.rs$/, ".rs")
      .replace(/\/__tests__\//, "/")
      .replace(/\/tests\//, "/src/")
      .replace(/\/test\//, "/src/")
    return impl
  }

  static async linkTestsToImplementation(projectId: ProjectID): Promise<number> {
    const db = await BrainDatabase.getInstance(projectId)
    const files = await db
      .select()
      .from(BrainFileTable)
      .where(eq(BrainFileTable.project_id, projectId as any))
    const testFiles = files.filter((f) => this.isTestFile(f.path))

    if (testFiles.length === 0) return 0

    let linkedCount = 0

    for (const tf of testFiles) {
      const relationships = await db
        .select()
        .from(BrainRelationshipTable)
        .where(
          and(
            eq(BrainRelationshipTable.project_id, projectId as any),
            sql`${BrainRelationshipTable.source_symbol_id} IN (SELECT id FROM brain_symbol WHERE file_id = ${tf.id})`,
          ),
        )

      const calledImplIds = [
        ...new Set(relationships.filter((r) => r.target_symbol_id).map((r) => r.target_symbol_id as string)),
      ]

      const inserts = []
      for (const targetId of calledImplIds) {
        inserts.push({
          id: `testcov_${tf.id}_${targetId}`.substring(0, 50).replace(/[^a-zA-Z0-9]/g, ""),
          project_id: projectId as any,
          source_symbol_id: tf.id,
          target_symbol_id: targetId,
          relationship_type: "covers_test",
          confidence: 0.9,
          time_created: Date.now(),
          time_updated: Date.now(),
        })
      }

      if (inserts.length > 0) {
        await db.insert(BrainRelationshipTable).values(inserts).onConflictDoNothing()
        linkedCount += inserts.length
      }
    }

    return linkedCount
  }

  static async getTestCoverageForSymbol(projectId: ProjectID, symbolOrFile: string): Promise<any> {
    const db = await BrainDatabase.getInstance(projectId)
    const targets = await db
      .select()
      .from(BrainSymbolTable)
      .where(and(eq(BrainSymbolTable.project_id, projectId as any), like(BrainSymbolTable.name, `%${symbolOrFile}%`)))
      .limit(10)

    if (targets.length === 0) return { error: `Could not find symbol or file matching ${symbolOrFile}` }

    const targetIds = targets.map((t) => t.id)

    const coverage = await db
      .select({
        test_file_id: BrainRelationshipTable.source_symbol_id,
        target_name: BrainSymbolTable.name,
        target_file: BrainSymbolTable.file_id,
      })
      .from(BrainRelationshipTable)
      .innerJoin(BrainSymbolTable, eq(BrainRelationshipTable.target_symbol_id, BrainSymbolTable.id))
      .where(
        and(
          eq(BrainRelationshipTable.project_id, projectId as any),
          eq(BrainRelationshipTable.relationship_type, "covers_test"),
          sql`${BrainRelationshipTable.target_symbol_id} IN ${targetIds}`,
        ),
      )

    return {
      targetsFound: targets.length,
      isCovered: coverage.length > 0,
      coverageRelationships: coverage,
    }
  }

  static async getUncoveredTestGaps(projectId: ProjectID): Promise<any[]> {
    const db = await BrainDatabase.getInstance(projectId)
    const gaps = await db.all(sql`
        SELECT s.name, s.symbol_type, f.path as file_path, s.complexity
        FROM brain_symbol s
        JOIN brain_file f ON s.file_id = f.id
        WHERE s.project_id = ${projectId}
          AND s.symbol_type IN ('function', 'class')
          AND s.complexity > 5
          AND s.id NOT IN (
             SELECT target_symbol_id FROM brain_relationship 
             WHERE project_id = ${projectId} AND relationship_type = 'covers_test' AND target_symbol_id IS NOT NULL
          )
          AND f.path NOT LIKE '%test%'
          AND f.path NOT LIKE '%spec%'
        ORDER BY s.complexity DESC
        LIMIT 10
     `)
    return gaps
  }
}
