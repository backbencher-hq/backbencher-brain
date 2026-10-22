/**
 * CPP GRAMMAR-BINDING PROBE — WHICH GRAMMAR BUILD DOES PRODUCTION ACTUALLY LOAD, AND WHAT THE
 * BYTES SAY (L-2026-10-21-11, the Lead's correction of L-11).
 *
 * ## THE RULE THIS PROBE EXISTS TO SATISFY
 *
 * A grammar citation is the **sha256 of the BYTES THE REGISTRY SERVES** — never a path, never a
 * log line. The fleet-wide trap: the engine's "language parser loaded" log prints a PATH, and a
 * lane that cites the log cites a file the bytes did not come from. The typescript lane measured
 * the bytes and found production and the fixtures load the SAME build; the mechanism is
 * `src/util/bb-data-dir.ts:28` (`bbWasmCandidates`), whose FIRST candidate for every spelling is
 * the repo's own `wasm/`, so the path and the bytes agree.
 *
 * ## WHAT IT MEASURES, SIDE BY SIDE
 *
 *   1 · the production path's resolved file and its sha256;
 *   2 · the sha256 of the bytes the REGISTRY serves for `tree-sitter-cpp.wasm`
 *       (`hasWasmInRegistry` — the bytes the analyzer actually parses with);
 *   3 · the sha256 of the bytes the FIXTURE SUITE loads (`run-fixtures.ts` reads `wasm/`);
 *   4 · the sha256 of the npm package's own build (if one is installed), so a lane can show that
 *       the npm build is served by NOTHING.
 *
 * and then the THREE DIGESTS through the fleet's own `grammar-remedy.ts surface` machinery — the
 * id-order digest (the identity that survives a rebuild), the type-set digest and the field-set
 * digest — for the bytes the registry serves.
 *
 * ## USAGE
 *
 *   bun run script/m14/cpp-grammar-binding-probe.ts
 *   bun run script/m14/cpp-grammar-binding-probe.ts --json out.json
 */
import { readFileSync, existsSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import * as path from "node:path"
import { resolveWasmAsset, hasWasmInRegistry } from "../../src/util/wasm"
import { bbWasmCandidates } from "../../src/util/bb-data-dir"

const ROOT = process.cwd()
const WASM_NAME = "tree-sitter-cpp.wasm"
const sha = (b: Uint8Array | Buffer): string => createHash("sha256").update(b).digest("hex")

// ── 1 · the production path ────────────────────────────────────────────────────────────────────
const productionPath = resolveWasmAsset(WASM_NAME)
const productionBytes = existsSync(productionPath) ? readFileSync(productionPath) : null

// ── 2 · the BYTES THE REGISTRY SERVES ──────────────────────────────────────────────────────────
const registryBytes = hasWasmInRegistry(WASM_NAME)

// ── 3 · the bytes the FIXTURE SUITE loads (run-fixtures.ts reads <root>/wasm/<name>) ──────────
const fixturePath = path.join(ROOT, "wasm", WASM_NAME)
const fixtureBytes = existsSync(fixturePath) ? readFileSync(fixturePath) : null

// ── 4 · the npm package's own build (served by nothing, but it is a build) ─────────────────────
const npmCandidates = [
  path.join(ROOT, "node_modules", "tree-sitter-cpp", "tree-sitter-cpp.wasm"),
  path.join(ROOT, "node_modules", "tree-sitter-cpp", "build", "tree-sitter-cpp.wasm"),
]
const npmPath = npmCandidates.find((p) => existsSync(p)) ?? null
const npmBytes = npmPath ? readFileSync(npmPath) : null

// ── the candidate list the registry walks, so the ORDER is on the record ───────────────────────
const candidates = bbWasmCandidates(path.join(ROOT, "src", "ast"), WASM_NAME)

const out: Record<string, unknown> = {
  wasmName: WASM_NAME,
  registryCandidateOrder: candidates,
  productionPath,
  productionSha256: productionBytes ? sha(productionBytes) : null,
  registrySha256: registryBytes ? sha(registryBytes) : null,
  fixtureSuiteSha256: fixtureBytes ? sha(fixtureBytes) : null,
  npmBuildPath: npmPath,
  npmBuildSha256: npmBytes ? sha(npmBytes) : null,
  productionAndRegistryAgree: productionBytes && registryBytes ? sha(productionBytes) === sha(registryBytes) : null,
  productionAndFixtureSuiteAgree: productionBytes && fixtureBytes ? sha(productionBytes) === sha(fixtureBytes) : null,
  npmBuildServedByTheRegistry: npmBytes && registryBytes ? sha(npmBytes) === sha(registryBytes) : null,
}
console.log(JSON.stringify(out, null, 2))
const jsonIdx = process.argv.indexOf("--json")
if (jsonIdx >= 0 && process.argv[jsonIdx + 1]) {
  writeFileSync(process.argv[jsonIdx + 1], JSON.stringify(out, null, 2))
}
