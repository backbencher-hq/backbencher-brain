/**
 * script/m14/csharp-grammar-binding.ts
 *
 * CSHARP GRAMMAR BINDING - WHICH BYTES DOES PRODUCTION ACTUALLY LOAD, AND WHICH BYTES DOES THE
 * FIXTURE SUITE RUN (the fleet's L-2026-10-21-11, corrected by the typescript lane's measurement).
 *
 * WHY THIS INSTRUMENT EXISTS. The fleet's rule is now: **A GRAMMAR CITATION IS THE sha256 OF THE
 * BYTES THE REGISTRY SERVES - never a path, and never a log line.** The trap is measured: the
 * engine resolves a PATH and then asks the wasm REGISTRY for the bytes, and the registry is keyed
 * by FILE NAME first (`src/util/wasm.ts:197` - `hasWasmInRegistry` tries `_wasmRegistry[wasmName]`
 * before `_wasmRegistry[name]`, and `bbWasmCandidates` puts the repo's own `wasm/` first for every
 * spelling, `src/util/bb-data-dir.ts:28`), so the engine's own "language parser loaded" log can
 * print a path that is NOT the file the bytes came from. A lane that cites the log cites the wrong
 * build. This probe measures the BYTES, and prints the four shas side by side:
 *
 *   1 · the PRODUCTION PATH's sha        - what `resolveWasmAsset` returns for the asset name
 *   2 · the REGISTRY's BYTES' sha        - what the engine ACTUALLY loads (`hasWasmInRegistry`)
 *   3 · the FIXTURE SUITE's build's sha  - what `script/m14/run-fixtures.ts` loads
 *   4 · the NPM PACKAGE's build's sha    - what is installed under node_modules (if any)
 *
 * The Lead's own instrument for the typescript lane is `script/m14/ts-grammar-binding-probe.ts`;
 * it is the typescript lane's to run, and the Lead owns it. This is the CSHARP lane's own probe,
 * built on the same registry API, and it measures the same four things for the C# grammar.
 *
 * NO REGEX. Four sha256 digests and a Set of equality answers.
 */
import { createHash } from "node:crypto"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { hasWasmInRegistry, resolveWasmAsset } from "../../src/util/wasm"

const ROOT = process.cwd()
const argv = process.argv.slice(2)
const argOf = (f: string): string | undefined => {
  const i = argv.indexOf(f)
  return i >= 0 ? argv[i + 1] : undefined
}
const JSON_OUT = argOf("--json")

const sha = (b: Uint8Array | Buffer): string => createHash("sha256").update(b).digest("hex")
const shaOfFile = (p: string): string => {
  try { return sha(readFileSync(p)) } catch { return "(unreadable)" }
}

/** THE ASSET NAME the production path resolves for C# (`src/ast/engine.ts:1096`). */
const ASSET = "tree-sitter-c-sharp/tree-sitter-c_sharp.wasm"
const WASM_NAME = "tree-sitter-c_sharp.wasm"

const productionPath = resolveWasmAsset(ASSET)
const productionPathSha = shaOfFile(productionPath)
const registryBytes = hasWasmInRegistry(ASSET)
const registrySha = registryBytes ? sha(registryBytes) : "(no registry bytes)"

// THE FIXTURE SUITE's build: `script/m14/run-fixtures.ts` loads `wasm/<cfg.wasm>`.
const fixturePath = path.join(ROOT, "wasm", WASM_NAME)
const fixtureSha = shaOfFile(fixturePath)

// THE NPM PACKAGE's build, if the package is installed in this tree.
const nodeModulesPath = path.join(ROOT, "node_modules", "tree-sitter-c-sharp", WASM_NAME)
const nodeModulesSha = existsSync(nodeModulesPath) ? shaOfFile(nodeModulesPath) : "(not installed in this tree)"

const pathAndBytesAgree = productionPathSha === registrySha
const productionAndFixturesAgree = registrySha === fixtureSha

const out = {
  lane: "csharp",
  instrument: "script/m14/csharp-grammar-binding.ts",
  rule: "a grammar citation is the sha256 of the BYTES THE REGISTRY SERVES - never a path, never a log line (L-2026-10-21-11, corrected)",
  asset: ASSET,
  productionPath: { path: productionPath, sha256: productionPathSha },
  registryBytes: { sha256: registrySha },
  fixtureSuiteBuild: { path: fixturePath, sha256: fixtureSha },
  nodeModulesBuild: { path: nodeModulesPath, sha256: nodeModulesSha },
  pathAndBytesAgree,
  productionAndFixturesAgree,
  citation: {
    /** THE SHA TO PUBLISH BESIDE EVERY NUMBER: the registry's bytes. */
    sha256: registrySha,
    namedNodeTypes: 239,
    nodeTypeIds: 533,
    inventory: "validation/m14/measurements/csharp-grammar-inventory.json",
  },
  verdict: pathAndBytesAgree && productionAndFixturesAgree
    ? "MEASURED: production and the fixture suite load the SAME bytes, and the path and the bytes agree - the sha256 of the registry's bytes is the citation"
    : "MEASURED: the path and the bytes DISAGREE (or production and the fixtures disagree) - every number must say which build it came from",
}

const L: string[] = []
L.push("CSHARP GRAMMAR BINDING - which BYTES production loads, and which the fixture suite runs")
L.push("")
L.push("== THE FOUR SHA256s, SIDE BY SIDE ==")
L.push(`  PRODUCTION's PATH   ${productionPath}`)
L.push(`    sha256 ${productionPathSha}`)
L.push(`  PRODUCTION's BYTES (the wasm REGISTRY - what the engine actually loads)`)
L.push(`    sha256 ${registrySha}`)
L.push(`    ${pathAndBytesAgree ? "the PATH and the BYTES agree" : "the PATH and the BYTES DIFFER - the engine's log prints the path, and the loaded bytes are the registry's"}`)
L.push(`  THE FIXTURE SUITE's BUILD  ${fixturePath}`)
L.push(`    sha256 ${fixtureSha}`)
L.push(`  THE NPM PACKAGE's BUILD   ${nodeModulesPath}`)
L.push(`    sha256 ${nodeModulesSha}`)
L.push("")
L.push(`  => THE BUILD PRODUCTION LOADS: ${registrySha}`)
L.push(`  => production and the fixtures run the ${productionAndFixturesAgree ? "SAME" : "DIFFERENT"} bytes`)
L.push("")
L.push(out.verdict)
console.log(L.join("\n"))

if (JSON_OUT) {
  writeFileSync(path.resolve(JSON_OUT), JSON.stringify(out, null, 2) + "\n")
  console.log(`  written              ${path.relative(ROOT, path.resolve(JSON_OUT))}`)
}
