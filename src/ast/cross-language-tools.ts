import { BrainDatabase } from "../brain/database"
import type { ProjectID } from "../project/schema"
import { eq, and, sql, or } from "drizzle-orm"
import { BrainSymbolTable, BrainRelationshipTable, BrainProjectHealthTable, BrainFileTable } from "../brain/brain.sql"

export namespace CrossLanguageTools {
  
  export async function getCrossLanguageRelationships(projectId: ProjectID, limit = 50) {
    const db = await BrainDatabase.getInstance(projectId)
    const types = [
      "api_call", "service_dependency", "database_access", "message_queue",
      "data_transfer", "schema_contract", "configuration_share",
      "ffi_binding", "native_interop", "protocol_buffer", "graphql_schema", "openapi_spec"
    ]
    
    // We join with BrainSymbolTable to get more info on source and target
    const query = sql`
      SELECT 
        r.id,
        r.relationship_type as type,
        r.confidence,
        r.context,
        r.source_symbol_id,
        s1.name as source_name,
        f1.language as source_language,
        f1.relative_path as source_file,
        r.target_symbol_id,
        s2.name as target_name,
        f2.language as target_language,
        f2.relative_path as target_file
      FROM ${BrainRelationshipTable} r
      LEFT JOIN ${BrainSymbolTable} s1 ON r.source_symbol_id = s1.id
      LEFT JOIN ${BrainFileTable} f1 ON s1.file_id = f1.id
      LEFT JOIN ${BrainSymbolTable} s2 ON r.target_symbol_id = s2.id
      LEFT JOIN ${BrainFileTable} f2 ON s2.file_id = f2.id
      WHERE r.project_id = ${projectId}
        AND r.relationship_type IN (${sql.join(types, sql`, `)})
      ORDER BY r.confidence DESC
      LIMIT ${limit}
    `
    
    return (await db.all(query)) as any[]
  }

  export async function getAPICalls(projectId: ProjectID, limit = 50) {
    const db = await BrainDatabase.getInstance(projectId)
    
    const query = sql`
      SELECT 
        r.id,
        r.relationship_type as type,
        r.metadata,
        r.source_symbol_id,
        s1.name as caller_name,
        f1.language as caller_language,
        r.target_symbol_id,
        s2.name as endpoint_name,
        f2.language as endpoint_language
      FROM ${BrainRelationshipTable} r
      LEFT JOIN ${BrainSymbolTable} s1 ON r.source_symbol_id = s1.id
      LEFT JOIN ${BrainFileTable} f1 ON s1.file_id = f1.id
      LEFT JOIN ${BrainSymbolTable} s2 ON r.target_symbol_id = s2.id
      LEFT JOIN ${BrainFileTable} f2 ON s2.file_id = f2.id
      WHERE r.project_id = ${projectId}
        AND r.relationship_type = 'api_call'
      ORDER BY r.confidence DESC
      LIMIT ${limit}
    `
    
    return (await db.all(query)) as any[]
  }

  export async function getServices(projectId: ProjectID, limit = 50) {
    const db = await BrainDatabase.getInstance(projectId)
    
    const query = sql`
      SELECT 
        s.id,
        s.name,
        s.symbol_type,
        
        f.language,
        f.relative_path as file
      FROM ${BrainSymbolTable} s
      LEFT JOIN ${BrainFileTable} f ON s.file_id = f.id
      WHERE s.project_id = ${projectId}
        AND s.symbol_type IN ('service', 'api_endpoint', 'database_entity')
      ORDER BY s.name ASC
      LIMIT ${limit}
    `
    
    return (await db.all(query)) as any[]
  }

  export async function getDataFlows(projectId: ProjectID, limit = 50) {
    const db = await BrainDatabase.getInstance(projectId)
    
    const query = sql`
      SELECT 
        s.id,
        s.name,
        
        f.language,
        f.relative_path as file
      FROM ${BrainSymbolTable} s
      LEFT JOIN ${BrainFileTable} f ON s.file_id = f.id
      WHERE s.project_id = ${projectId}
        AND s.symbol_type = 'data_model'
      ORDER BY s.name ASC
      LIMIT ${limit}
    `
    
    return (await db.all(query)) as any[]
  }

  export async function getSecurityAnalysis(projectId: ProjectID) {
    const db = await BrainDatabase.getInstance(projectId)
    
    const res = await db.select()
      .from(BrainProjectHealthTable)
      .where(eq(BrainProjectHealthTable.project_id, projectId))
      .limit(1)
      
    return res[0] || null
  }
}
