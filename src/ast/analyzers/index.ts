// Analyzer registry — maps language to analyzer class
// Each analyzer is lazily imported on first use
// Ported analyzers keep their original class names (e.g., RealTypeScriptAnalyzer)

import type { LanguageAnalyzer } from "../types.js"

type AnalyzerFactory = () => Promise<LanguageAnalyzer>

const registry = new Map<string, AnalyzerFactory>()

// M2: TypeScript/TSX — first analyzers ported
registry.set("typescript", async () => {
  const mod = await import("./typescript.js")
  return new mod.RealTypeScriptAnalyzer()
})
registry.set("tsx", async () => {
  const mod = await import("./typescript.js")
  return new mod.RealTypeScriptAnalyzer()
})
registry.set("javascript", async () => {
  const mod = await import("./typescript.js")
  return new mod.RealTypeScriptAnalyzer()
})

// Remaining analyzers will be registered in M3

export async function getAnalyzer(language: string): Promise<LanguageAnalyzer> {
  const factory = registry.get(language)
  if (!factory) {
    const { GenericAnalyzer } = await import("./generic.js")
    return new GenericAnalyzer()
  }
  return factory()
}
