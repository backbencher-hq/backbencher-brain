// Analyzer registry — maps language to analyzer class
// Each analyzer is lazily imported on first use

import type { LanguageAnalyzer } from "../types.js"

const registry = new Map<string, () => Promise<new () => LanguageAnalyzer>>()

// Will be populated in M3 as analyzers are ported
// Example:
// registry.set("typescript", () => import("./typescript.js").then(m => m.RealTypeScriptAnalyzer))
// registry.set("python", () => import("./python.js").then(m => m.RealPythonAnalyzer))

export async function getAnalyzer(language: string): Promise<LanguageAnalyzer> {
  const factory = registry.get(language)
  if (!factory) {
    const { GenericAnalyzer } = await import("./generic.js")
    return new GenericAnalyzer()
  }
  const AnalyzerClass = await factory()
  return new AnalyzerClass()
}
