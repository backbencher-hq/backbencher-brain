import {
  Activity,
  FileText,
  Database,
  GitBranch,
  HeartPulse,
  Languages,
  Highlighter,
  RefreshCw,
  Search,
  SearchCheck,
  Sparkles,
  StickyNote,
  Target,
  Waypoints,
  Wrench,
  Zap,
} from "lucide-react"
import { TOOL_FACTS, type ToolFact } from "./tools.generated"

// M56.T1 (#781) — presentation-only join layer.
//
// Every tool FACT (name, summary, description, parameters, defaults, examples,
// returns, errors, limitations, performance, safety, evidence, staleness,
// cross-tool relations) is machine-generated into ./tools.generated.ts by
// `bun run docs:generate` from the executable registry and docs/tools/*.md.
// Nothing factual is written by hand here.
//
// What remains hand-written is navigation only: which display group a tool is
// filed under, which icon it carries, and the group blurbs. Those are not
// claims about behaviour, and verify-tools-truth.ts enforces that this file
// covers the registry exactly and contains no fact-shaped keys.

export type ToolParameter = ToolFact["parameters"][number]
export type ToolGroup = "Discovery" | "Analysis" | "Diagnostics" | "Operations"

export type BrainTool = ToolFact & { icon: typeof Search; group: ToolGroup }

// Display grouping is navigation, not behaviour. Keys must equal the public
// registry exactly — a phantom or missing key is a gate failure.
export const TOOL_GROUPS: Record<string, ToolGroup> = {
  bb_search: "Discovery",
  bb_ask: "Discovery",
  bb_analyze: "Analysis",
  bb_doc: "Analysis",
  bb_patterns: "Analysis",
  bb_migrate: "Analysis",
  bb_graph: "Analysis",
  bb_impact: "Analysis",
  bb_cross_language: "Analysis",
  bb_annotate: "Analysis",
  bb_annotations: "Analysis",
  bb_health: "Diagnostics",
  bb_security: "Diagnostics",
  bb_visualize: "Diagnostics",
  bb_edit: "Operations",
  bb_index: "Operations",
}

const TOOL_ICONS: Record<string, typeof Search> = {
  bb_search: Search,
  bb_ask: Sparkles,
  bb_analyze: Activity,
  bb_doc: FileText,
  bb_edit: Wrench,
  bb_index: RefreshCw,
  bb_health: HeartPulse,
  bb_patterns: GitBranch,
  bb_security: SearchCheck,
  bb_migrate: Database,
  bb_visualize: Zap,
  bb_graph: Waypoints,
  bb_impact: Target,
  bb_cross_language: Languages,
  bb_annotate: Highlighter,
  bb_annotations: StickyNote,
}

export const GROUP_ORDER: ToolGroup[] = ["Discovery", "Analysis", "Diagnostics", "Operations"]

export const GROUP_META: Record<ToolGroup, { icon: typeof Search; blurb: string }> = {
  Discovery: { icon: Search, blurb: "find symbols, files, and answers fast" },
  Analysis: { icon: Activity, blurb: "graph, impact, and evidence-backed reports" },
  Diagnostics: { icon: HeartPulse, blurb: "health, lead review, and architecture views" },
  Operations: { icon: Wrench, blurb: "guarded index and source mutations" },
}

for (const tool of TOOL_FACTS) {
  if (!TOOL_GROUPS[tool.name]) throw new Error(`brain-tools: no display group for ${tool.name}`)
  if (!TOOL_ICONS[tool.name]) throw new Error(`brain-tools: no icon for ${tool.name}`)
}
const generatedNames = new Set(TOOL_FACTS.map((t) => t.name))
for (const name of Object.keys(TOOL_GROUPS)) {
  if (!generatedNames.has(name)) throw new Error(`brain-tools: display group for unknown tool ${name}`)
}

export const BRAIN_TOOLS: BrainTool[] = TOOL_FACTS.map((tool) => ({
  ...tool,
  icon: TOOL_ICONS[tool.name]!,
  group: TOOL_GROUPS[tool.name]!,
}))

export function toolsInGroup(group: ToolGroup): BrainTool[] {
  return BRAIN_TOOLS.filter((tool) => tool.group === group)
}
