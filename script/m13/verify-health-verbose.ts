// script/m13/verify-health-verbose.ts — M13.30 (H2).
//
// The advertised verbose flag must actually change output: verbose=true adds
// the per-language breakdown and stale/missing file names; verbose=false must
// NOT include them. Proves the wiring schema → provider → output end to end.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { getUnifiedHealth, formatUnifiedHealth } from "../../src/intelligence/health/health-provider"
import { PUBLIC_TOOL_DESCRIPTORS } from "../../src/mcp/tool-registry"
import { Harness } from "./harness"

const harness = new Harness({
  issue: "M13.30",
  code: "H2",
  tool: "bb_health",
  title: "bb_health: wire verbose (schema -> provider -> output)",
  layers: ["unit", "integration"],
  decisions: {
    wiring: "registry advertises verbose; handler passes args.verbose; provider reads options.verbose into the report; formatter prints the verbose sections only when verbose=true",
    bidirectional: "verbose=true output contains the per-language breakdown and stale/missing file names; verbose=false output contains neither",
  },
  limitations: [
    "The stale-file name list reflects the sampled freshness check (default sampled mode), which is the advertised behavior.",
  ],
})

// ── 1. Static wiring: schema → handler → provider → formatter ─────────────
const descriptor = PUBLIC_TOOL_DESCRIPTORS.find((t) => t.name === "bb_health")!
harness.check("schema: verbose is a declared boolean input", (descriptor.inputSchema as any).properties?.verbose?.type === "boolean", "not declared")
harness.check("schema: verbose is documented with its effect", ((descriptor.inputSchema as any).properties?.verbose?.description ?? "").includes("stale/missing file names"), "undocumented")

const handlers = readFileSync(path.resolve("src/mcp/tool-handlers.ts"), "utf8")
harness.check("handler: passes args.verbose to the provider", handlers.includes("verbose: args.verbose === true"), "not passed")

const provider = readFileSync(path.resolve("src/intelligence/health/health-provider.ts"), "utf8")
harness.check("provider: UnifiedHealthOptions declares verbose", provider.includes("verbose?: boolean"), "not in options")
harness.check("provider: report carries verbose and languages", provider.includes("verbose: options.verbose === true") && provider.includes("languages:"), "not in report")
// M64: this asserted on the literal template strings `languages: ${` and
// `stale files: ${`, so it broke on a refactor that capped the stale list into
// a bounded renderer — a change that made the section BETTER, not worse. The
// wiring it means to check (the verbose sections exist and are gated on
// report.verbose) is asserted structurally, and the OUTPUT is asserted
// behaviourally a few lines below, which is where a real regression would show.
harness.check(
  "formatter: prints verbose sections only when verbose=true",
  provider.includes("if (report.verbose)") && /languages:/.test(provider) && /stale files/.test(provider) && /renderFileList\("stale files"/.test(provider),
  "verbose sections missing or no longer gated on report.verbose",
)

// ── 2. Runtime: verbose actually changes output ────────────────────────────
const root = mkdtempSync(path.join(tmpdir(), "bb-health-verbose-"))
const projectId = getProjectId(root)
mkdirSync(path.join(root, "src"), { recursive: true })
writeFileSync(path.join(root, "src", "a.ts"), "export function alpha(): number { return 1 }\n")
writeFileSync(path.join(root, "src", "b.ts"), "export function beta(): number { return 2 }\n")
await indexProjectParallel(projectId, root, {})

// Make b.ts stale so the stale-file list is non-empty.
const bPath = path.join(root, "src", "b.ts")
writeFileSync(bPath, readFileSync(bPath, "utf8") + "\n// verbose-probe\n")

{
  const report = await getUnifiedHealth(projectId, root, { verbose: true })
  const out = formatUnifiedHealth(report)
  harness.check("verbose=true: per-language breakdown present", out.includes("languages:") && out.includes("typescript"), out.slice(0, 200))
  harness.check("verbose=true: stale file names present", out.includes("stale files:") && out.includes("b.ts"), out.slice(0, 200))
  harness.check("verbose=true: missing file line present", out.includes("missing files:"))
  harness.check("verbose=true: report carries the language breakdown", Array.isArray(report.languages) && report.languages.some((l) => l.language === "typescript" && l.files === 2), JSON.stringify(report.languages).slice(0, 140))
}

{
  const report = await getUnifiedHealth(projectId, root, {})
  const out = formatUnifiedHealth(report)
  harness.negative("verbose=false: NO per-language breakdown leaks", !out.includes("languages:"), out.slice(0, 160))
  harness.negative("verbose=false: NO stale-file names leak", !out.includes("stale files:"), out.slice(0, 160))
  harness.check("verbose=false: report still carries the standard health summary", out.includes("files=") && out.includes("freshness:"), out.slice(0, 120))
}

// Handler-level: the MCP surface must honor verbose too (real handler).
{
  const { createToolHandlers } = await import("../../src/mcp/tool-handlers")
  const health = createToolHandlers().bb_health
  const verboseOut = await health({ verbose: true }, { projectId, projectPath: root } as any)
  const verboseText = (verboseOut.content ?? []).map((c: any) => c.text ?? "").join("\n")
  harness.check("handler: verbose=true output includes the breakdown", verboseText.includes("languages:"), verboseText.slice(0, 160))
}

rmSync(root, { recursive: true, force: true })
harness.emit()
