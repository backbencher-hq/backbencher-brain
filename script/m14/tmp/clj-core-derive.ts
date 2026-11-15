// CLJ-DEEP · the core-surface EXPLORER — a thin printer over the gate's derivation.
//
// THE DERIVATION MOVED. It lives in ONE place —
// `script/m49/verify-clj-core-list.ts` → `deriveFromCorpus` — because a second
// copy of a rule is a second answer to the same question, and that is the lesson
// of CLJ-D17 itself: `CLOJURE_CORE_BUILTINS` was hand-typed once and IMPORTED BY
// THE ORACLE, so a wrong answer was invisible on BOTH sides of the comparison
// that was supposed to catch it.
//
// This file remains because a derivation wants an interactive reader: it prints
// the per-file contribution, the kept/skipped split, the declared extras and the
// full gap, which a pass/fail gate should not. The gate is what runs in CI; this
// is what you open when the gate goes red.
//
// The rules it reports, unchanged: keep only files whose `ns`/`in-ns` is
// clojure.core (or clojure.core.protocols / clojure.core.reducers — the two
// sub-namespaces the reader itself makes available to core code); within those,
// keep only def-family forms that are TOP-LEVEL children of the file, so an
// internal helper defined inside a `defn` body (`binary-op`,
// `check-valid-options`, …) is not mistaken for public API; and drop whatever the
// analyzer's own privacy rule calls private. AST only — no regex, no human-typed
// name list.
import { writeFileSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")

async function main() {
  const out = process.argv[2] ?? "/tmp/opencode/clj-core-vars.json"
  const gate: any = await import(path.join(ROOT, "script/m49/verify-clj-core-list.ts"))
  const engine: any = await import(path.join(ROOT, "src/ast/engine.ts"))
  const mod: any = await import(path.join(ROOT, "src/ast/real-clojure-analyzer.ts"))
  const shipped: string[] = Object.keys(mod.CLOJURE_CORE_BUILTINS)
  const parser = await engine.ASTEngine.getParser("clojure")
  const d = await gate.deriveFromCorpus(parser, gate.CORE_DIR)
  const c = gate.compare(d.names, shipped)
  const derived = [...d.names].sort()

  writeFileSync(out, JSON.stringify({
    coreDir: gate.CORE_DIR,
    filesScanned: d.fileCount,
    filesInCoreNamespaces: d.keptFiles,
    filesSkipped: d.skipped,
    errorFiles: d.errorFiles,
    derivedCount: d.names.size,
    declaredExtras: gate.DECLARED_EXTRAS,
    analyzerListCount: shipped.length,
    missingFromAnalyzer: c.missing,
    shippedButUndeclared: c.undeclared,
    staleExtras: c.staleExtras,
    derived,
  }, null, 1))

  console.log(`core dir files: ${d.fileCount} (${d.errorFiles} with ERROR nodes)`)
  console.log(`files declaring a core namespace: ${d.keptFiles.length}`)
  for (const f of d.keptFiles) console.log(`   KEEP ${f}`)
  console.log(`\nderived clojure.core public vars: ${d.names.size}   shipped constant: ${shipped.length}`)
  console.log(`MISSING from the constant: ${c.missing.length}${c.missing.length ? " -> " + c.missing.join(" ") : ""}`)
  console.log(`shipped but UNDECLARED  : ${c.undeclared.length}${c.undeclared.length ? " -> " + c.undeclared.join(" ") : ""}`)
  console.log(`stale declared extras    : ${c.staleExtras.length}`)
  console.log(`\nwritten: ${out}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
