import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core"
import { Timestamps } from "../storage/schema.sql"
import type { ProjectID } from "../project/schema"
import { ProjectTable } from "../project/project.sql"
import { BrainSymbolTable, BrainFileTable } from "./brain.sql"

// ================================================================
// REVOLUTIONARY INTELLIGENCE FEATURES
// ================================================================

// Semantic Embeddings - Vector search for conceptual understanding
export const BrainSemanticEmbeddingTable = sqliteTable(
  "brain_semantic_embedding",
  {
    id: text().primaryKey(),
    project_id: text()
      .$type<ProjectID>()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    entity_id: text().notNull(), // Can be symbol_id, file_id, or pattern_id
    entity_type: text().notNull(), // "symbol", "file", "pattern", "comment", "documentation"
    embedding_model: text().notNull(), // "openai-ada-002", "sentence-transformers", etc.
    embedding_vector: text().notNull(), // JSON array of floats
    vector_dimension: integer().notNull(),
    content_hash: text().notNull(), // Hash of content that generated embedding
    semantic_context: text({ mode: "json" }), // Additional context for better search
    similarity_threshold: real().default(0.7), // Minimum similarity for matches
    last_updated: integer().notNull(),
    ...Timestamps,
  },
  (table) => [
    index("brain_embed_project_idx").on(table.project_id),
    index("brain_embed_entity_idx").on(table.entity_id),
    index("brain_embed_type_idx").on(table.entity_type),
    index("brain_embed_model_idx").on(table.embedding_model),
    index("brain_embed_hash_idx").on(table.content_hash),
  ],
)
