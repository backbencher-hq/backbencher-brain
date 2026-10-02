/**
 * Language registration audit.
 *
 * Question: is every analyzer that EXISTS also REACHABLE? Three ways a language
 * can be silently dead:
 *
 *   1. an analyzer file exists but the engine's switch never returns it
 *      -> `bb` never runs it, no error, the language just has no symbols
 *   2. a grammar is registered but the wasm is not shipped
 *      -> parse fails at runtime, per-file, on that language only
 *   3. a file extension is not mapped to any language
 *      -> the file is never discovered, so it is never indexed at all
 *
 * Each of these fails SILENTLY: no exception, no non-zero exit, and an index
 * that reports success. This turns them into explicit assertions.
 */

import { existsSync, readdirSync, readFileSync } from "fs"
import path from "path"
import { fileURLToPath } from "url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
// This file lives in <repo>/script/, so the repo root is one level up — the
// first draft used "../ast" and resolved to <repo>/ast, which does not exist.
const ROOT = path.resolve(HERE, "..")
const AST_DIR = path.join(ROOT, "src", "ast")
const WASM_DIR = path.join(ROOT, "wasm")

let failures = 0
function check(name: string, ok: boolean, detail = "") {
  if (ok) console.log(`  ok: ${name}`)
  else {
    console.log(`  FAIL: ${name}${detail ? ` — ${detail}` : ""}`)
    failures++
  }
}

// The engine dispatches on a language key, not on a filename, and the two do
// not always match. `real-makefile-analyzer.ts` is reached by the case "make",
// because language-detection.ts maps "makefile" -> "make". The first version of
// this audit assumed filename == language key and reported makefile as a dead
// analyzer; it is alive. Read the alias table so the check follows the real
// mapping instead of guessing.
const DETECTION_SRC = readFileSafe(path.join(AST_DIR, "language-detection.ts"))
const LANG_ALIASES = new Map<string, string>() // analyzer file stem -> language key
for (const m of DETECTION_SRC.matchAll(/"([a-z0-9+#_-]+)"\s*:\s*"([a-z0-9+#_-]+)"/g)) {
  LANG_ALIASES.set(m[1], m[2])
}

// ── 1. analyzer files vs engine registration ──────────────────────────────────
const analyzerFiles = readdirSync(AST_DIR)
  .filter((f) => /^real-.*-analyzer\.ts$/.test(f))
  .map((f) => f.replace(/^real-/, "").replace(/-analyzer\.ts$/, ""))

const engineSrc = readFileSafe(path.join(AST_DIR, "engine.ts"))

function readFileSafe(p: string): string {
  try {
    return readFileSync(p, "utf8")
  } catch {
    return ""
  }
}

console.log(`A1. every analyzer file is imported by the engine (${analyzerFiles.length} analyzers)`)
const notImported = analyzerFiles.filter((name) => {
  // engine.ts imports "./real-<name>-analyzer"
  return !engineSrc.includes(`real-${name}-analyzer`)
})
check(
  `all ${analyzerFiles.length} analyzers are referenced by engine.ts`,
  notImported.length === 0,
  notImported.length ? `unreferenced: ${notImported.join(", ")}` : "",
)

console.log(`\nA2. every analyzer imported by the engine is dispatched by a language key`)
// An import that is never assigned to any `case "<lang>"` is dead weight: the
// module loads, the branch that uses it is unreachable.
const caseLangs = new Set<string>()
for (const m of engineSrc.matchAll(/case\s+"([a-z0-9+#_-]+)"\s*:/g)) caseLangs.add(m[1])

const importedButUndispatched = analyzerFiles.filter((name) => {
  if (!engineSrc.includes(`real-${name}-analyzer`)) return false
  // The dispatch key may be the filename stem OR an alias declared in
  // language-detection.ts (e.g. makefile -> make).
  const key = LANG_ALIASES.get(name) ?? name
  return !caseLangs.has(key) && !caseLangs.has(name)
})
check(
  "no analyzer is imported but never dispatched",
  importedButUndispatched.length === 0,
  importedButUndispatched.length
    ? `imported but no matching case: ${importedButUndispatched.join(", ")}`
    : "",
)

// ── 2. grammar wasm actually shipped ──────────────────────────────────────────
console.log(`\nA3. every grammar the engine resolves exists as a wasm`)
const referencedWasm = new Set<string>()
for (const m of engineSrc.matchAll(/resolveWasm\(\s*"(tree-sitter-[a-z0-9_+-]+\.wasm)"\s*\)/g)) {
  referencedWasm.add(m[1])
}
const missingWasm = [...referencedWasm].filter((w) => !existsSync(path.join(WASM_DIR, w)))
check(
  `all ${referencedWasm.size} engine-referenced grammars are shipped`,
  missingWasm.length === 0,
  missingWasm.length ? `missing: ${missingWasm.join(", ")}` : "",
)

// ── 3. extension → language coverage ──────────────────────────────────────────
console.log(`\nA4. extension map has no entry pointing at an unknown language`)
// EXT_TO_LANGUAGE-style maps in the engine/discovery code.
const extMaps: Array<[string, string]> = []
for (const f of ["engine.ts", "project-index.ts", "index.ts"]) {
  const p = path.join(AST_DIR, f)
  if (!existsSync(p)) continue
  const src = readFileSafe(p)
  for (const m of src.matchAll(/"\.([a-z0-9]+)"\s*:\s*"([a-z0-9+#_-]+)"/g)) extMaps.push([m[1], m[2], f])
}
const unknownLang = extMaps.filter(([, lang]) => !caseLangs.has(lang))
check(
  `all ${extMaps.length} extension mappings target a dispatched language`,
  unknownLang.length === 0,
  unknownLang.length
    ? unknownLang.map(([ext, lang, f]) => `.${ext} -> ${lang} (${f})`).join("; ")
    : "",
)

// ── 4. grammars shipped with NO analyzer ──────────────────────────────────────
// A shipped grammar that nothing references is not a silent correctness bug —
// nothing depends on it — but it is shipped weight in every install, and it
// advertises a language the product cannot actually parse. That second part is
// the real cost: a user with a `.rescript` file is told nothing about why it is
// not indexed.
//
// Grammars are resolved BY NAME (resolveWasm("tree-sitter-x.wasm")); no code
// scans the wasm/ directory to load them, so "not referenced" genuinely means
// "never loaded". Verified: the only readdirSync(wasmDir) calls are in
// util/wasm.ts (asset lookup helpers) and audit scripts, not in the parse path.
console.log(`\nA5. every shipped grammar has a consumer (no dead weight)`)
const shipped = readdirSync(WASM_DIR)
  .filter((f) => f.endsWith(".wasm"))
  .map((f) => f.replace(/^tree-sitter-/, "").replace(/\.wasm$/, ""))
const unconsumed = shipped.filter((g) => !engineSrc.includes(g) && !readFileSafe(path.join(AST_DIR, "language-detection.ts")).includes(g))
if (unconsumed.length) {
  console.log(
    `  note: ${unconsumed.length} grammar(s) ship in every install but no code references them —`,
  )
  console.log(`        ${unconsumed.join(", ")}`)
  console.log(
    `        They are never loaded (resolution is by name, not by directory scan). Removing them shrinks the`,
  )
  console.log(
    `        package; leaving them implies support that does not exist. Reported, not failed: this is a`,
  )
  console.log(`        packaging decision, and deleting shipped assets is not this script's call.`)
} else {
  console.log(`  ok: all ${shipped.length} shipped grammars are referenced`)
}

console.log(
  `\n${failures === 0 ? "PASS" : `FAIL — ${failures} check(s) failed`} — language registration audit`,
)
if (failures > 0) process.exitCode = 1
