// Analyzer registry — maps language to analyzer class
// All 40 language analyzers with lazy dynamic imports
// Ported from backbencher — kept structurally identical via @ts-nocheck

import type { LanguageAnalyzer } from "../types.js"

type AnalyzerFactory = () => Promise<LanguageAnalyzer>

const registry = new Map<string, AnalyzerFactory>()

// ========================================================================
// WEB TECHNOLOGIES
// ========================================================================
registry.set("typescript", async () => { const m = await import("./typescript.js"); return new m.RealTypeScriptAnalyzer() })
registry.set("tsx", async () => { const m = await import("./typescript.js"); return new m.RealTypeScriptAnalyzer() })
registry.set("javascript", async () => { const m = await import("./javascript.js"); return new m.RealJavaScriptAnalyzer() })

// ========================================================================
// SCRIPTING & DYNAMIC
// ========================================================================
registry.set("python", async () => { const m = await import("./python.js"); return new m.RealPythonAnalyzer() })
registry.set("ruby", async () => { const m = await import("./ruby.js"); return new m.RealRubyAnalyzer() })
registry.set("php", async () => { const m = await import("./php.js"); return new m.RealPhpAnalyzer() })
registry.set("lua", async () => { const m = await import("./lua.js"); return new m.RealLuaAnalyzer() })
registry.set("perl", async () => { const m = await import("./perl.js"); return new m.RealPerlAnalyzer() })
registry.set("elixir", async () => { const m = await import("./elixir.js"); return new m.RealElixirAnalyzer() })
registry.set("erlang", async () => { const m = await import("./erlang.js"); return new m.RealErlangAnalyzer() })

// ========================================================================
// SYSTEMS PROGRAMMING
// ========================================================================
registry.set("c", async () => { const m = await import("./c.js"); return new m.RealCAnalyzer() })
registry.set("cpp", async () => { const m = await import("./cpp.js"); return new m.RealCppAnalyzer() })
registry.set("rust", async () => { const m = await import("./rust.js"); return new m.RealRustAnalyzer() })
registry.set("go", async () => { const m = await import("./go.js"); return new m.RealGoAnalyzer() })
registry.set("zig", async () => { const m = await import("./zig.js"); return new m.RealZigAnalyzer() })

// ========================================================================
// ENTERPRISE & JVM
// ========================================================================
registry.set("java", async () => { const m = await import("./java.js"); return new m.RealJavaAnalyzer() })
registry.set("kotlin", async () => { const m = await import("./kotlin.js"); return new m.RealKotlinAnalyzer() })
registry.set("scala", async () => { const m = await import("./scala.js"); return new m.RealScalaAnalyzer() })
registry.set("groovy", async () => { const m = await import("./groovy.js"); return new m.RealGroovyAnalyzer() })

// ========================================================================
// MICROSOFT ECOSYSTEM
// ========================================================================
registry.set("csharp", async () => { const m = await import("./csharp.js"); return new m.RealCSharpAnalyzer() })
registry.set("fsharp", async () => { const m = await import("./fsharp.js"); return new m.RealFsharpAnalyzer() })
registry.set("powershell", async () => { const m = await import("./powershell.js"); return new m.RealPowershellAnalyzer() })

// ========================================================================
// MOBILE & MODERN
// ========================================================================
registry.set("swift", async () => { const m = await import("./swift.js"); return new m.RealSwiftAnalyzer() })
registry.set("dart", async () => { const m = await import("./dart.js"); return new m.RealDartAnalyzer() })

// ========================================================================
// FUNCTIONAL PROGRAMMING
// ========================================================================
registry.set("haskell", async () => { const m = await import("./haskell.js"); return new m.RealHaskellAnalyzer() })
registry.set("clojure", async () => { const m = await import("./clojure.js"); return new m.RealClojureAnalyzer() })
registry.set("clean", async () => { const m = await import("./clean.js"); return new m.RealCleanAnalyzer() })

// ========================================================================
// DATA SCIENCE & STATS
// ========================================================================
registry.set("r", async () => { const m = await import("./r.js"); return new m.RealRAnalyzer() })
registry.set("sql", async () => { const m = await import("./sql.js"); return new m.RealSqlAnalyzer() })

// ========================================================================
// SHELL & INFRASTRUCTURE
// ========================================================================
registry.set("bash", async () => { const m = await import("./bash.js"); return new m.RealBashAnalyzer() })
registry.set("hcl", async () => { const m = await import("./hcl.js"); return new m.RealHclAnalyzer() })
registry.set("terraform", async () => { const m = await import("./hcl.js"); return new m.RealHclAnalyzer() })

// ========================================================================
// WEB COMPONENTS & MARKUP
// ========================================================================
registry.set("html", async () => { const m = await import("./html.js"); return new m.RealHtmlAnalyzer() })
registry.set("css", async () => { const m = await import("./css.js"); return new m.RealCssAnalyzer() })
registry.set("scss", async () => { const m = await import("./css.js"); return new m.RealCssAnalyzer() })
registry.set("sass", async () => { const m = await import("./css.js"); return new m.RealCssAnalyzer() })
registry.set("json", async () => { const m = await import("./json.js"); return new m.RealJsonAnalyzer() })
registry.set("yaml", async () => { const m = await import("./yaml.js"); return new m.RealYamlAnalyzer() })
registry.set("graphql", async () => { const m = await import("./graphql.js"); return new m.RealGraphqlAnalyzer() })
registry.set("vue", async () => { const m = await import("./vue.js"); return new m.RealVueAnalyzer() })
registry.set("svelte", async () => { const m = await import("./svelte.js"); return new m.RealSvelteAnalyzer() })

// ========================================================================
// APPLE ECOSYSTEM
// ========================================================================
registry.set("objective-c", async () => { const m = await import("./objective-c.js"); return new m.RealObjectiveCAnalyzer() })

// ========================================================================
// PUBLIC API
// ========================================================================

export async function getAnalyzer(language: string): Promise<LanguageAnalyzer> {
  const factory = registry.get(language)
  if (!factory) {
    const { GenericAnalyzer } = await import("./generic.js")
    return new GenericAnalyzer()
  }
  return factory()
}

export function getRegisteredLanguages(): string[] {
  return Array.from(registry.keys()).sort()
}
