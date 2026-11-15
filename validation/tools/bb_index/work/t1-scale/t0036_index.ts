export { BrainDatabase } from "./brain/database"
export * as BrainSchema from "./brain/brain.sql"
export * as ProjectSchema from "./project/project.sql"
export { ProjectID } from "./project/schema"
export type { ProjectID as ProjectIDType } from "./project/schema"
export * as CoreStorage from "./storage/db.bun"
export { ASTEngine } from "./ast/engine"
export { indexProjectParallel } from "./ast/parallel-indexer"
export { BrainTools } from "./ast/tools"
export { SemanticEngine } from "./brain/semantic/engine"
export { checkFileFreshness, checkResultsFreshness, hashFileContent } from "./brain/freshness"
export { getProjectId } from "./cli/index"
export { BACKBENCHER_BRAIN_VERSION } from "./version"
export {
  TOOL_DESCRIPTORS,
  serializeToolMetadata,
  toMcpToolList,
  validateToolDescriptors,
} from "./mcp/tool-registry"
export type { ToolDescriptor, ToolDocumentation, ToolInputSchema } from "./mcp/tool-registry"
