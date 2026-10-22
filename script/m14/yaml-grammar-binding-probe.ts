/**
 * script/m14/yaml-grammar-binding-probe.ts — WHICH BYTES DOES THE YAML LANE ACTUALLY PARSE WITH?
 *
 * THE RULE THIS INSTRUMENT EXISTS TO SATISFY (L-20). A grammar citation is the **sha256 of the bytes
 * the REGISTRY SERVES** — never a path, and never a log line. The fleet-wide trap: the engine's
 * "language parser loaded" log prints a PATH, and `src/ast/engine.ts:677-700` resolves the wasm
 * through `resolveWasm`, `:808-830` handles the registry and its temp-file path, and `:939/943/947`
 * are three different asset spellings. The registry is `src/util/wasm.ts` (`_wasmRegistry`, keyed by
 * FILE NAME) and `bbWasmCandidates` (`src/util/bb-data-dir.ts:28`) returns
 * `[<root>/wasm/<n>, <dist>/wasm/<n>, ~/.bb/wasm/<n>, <cwd>/wasm/<n>]` — so the repo's own `wasm/`
 * is FIRST for every spelling and PATH and BYTES agree. THAT IS A CLAIM, AND THIS INSTRUMENT
 * MEASURES IT rather than inheriting it.
 *
 * WHAT IT MEASURES, SIDE BY SIDE, IN ONE PROCESS:
 *
 *   (A) THE REGISTRY'S BYTES — `hasWasmInRegistry("tree-sitter-yaml/tree-sitter-yaml.wasm")`
 *       returns the Uint8Array the engine actually serves. THE CITATION THAT MATTERS.
 *   (B) THE RESOLVED PATH — `resolveWasmAsset(...)`, the engine's own resolution, and the sha256 of
 *       the file at that path. THE "PATH" HALF OF THE TRAP.
 *   (C) THE REPO'S OWN FILE — `wasm/tree-sitter-yaml.wasm` relative to the repo root, which is what
 *       a path-based citation names.
 *   (D) THE FIXTURE SUITE'S BUILD — `script/m14/run-fixtures.ts` reads `<root>/wasm/`.
 *   (E) THE NPM PACKAGE'S BUILD — `node_modules/@tree-sitter-grammars/tree-sitter-yaml/…`, if it is
 *       installed and if it ships a wasm at all. A build that is served by NOTHING is still a build,
 *       and the difference between it and (A) is the difference between the pin and the wire.
 *
 * AND — the half the ruby lane added and the sql lane's surface check relies on — THE FOURTH
 * MEASUREMENT THAT PROVES THE CITATION IS ABOUT THE SAME GRAMMAR THE ANALYZER USES:
 *
 *   (F) THE PRODUCTION PARSER'S OWN LANGUAGE — the node-type inventory is read from
 *       `getParser("yaml").language`, the PRODUCTION parser's own `Language` object, and its
 *       id-order digest is compared against the digest computed from the SERVED BYTES' own
 *       tree-sitter language. The citation and the inventory therefore cannot drift apart.
 *
 * THE NAMED/ANONYMOUS TRAP (the instrument's own first run read 0 named). `nodeTypeForId` returns
 * the type NAME as a string, and a string has no `.named` property, so `t.named` counts EVERY type
 * as anonymous. The accessor is `nodeTypeIsNamed(id)`. The tell is that TOTAL agrees with a prior
 * measurement while the named-count is 0 — a classification bug, not a finding.
 *
 * EXIT CODE: 0 when every measurement agrees (the citation is sound); 3 when they do not (the
 * citation is WRONG, and the lane says so rather than publishing it).
 */
import { createHash } from "node:crypto"
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..")
const OUT_DIR = path.join(ROOT, "validation", "m14", "measurements")
const OUT = path.join(OUT_DIR, "yaml-grammar-binding.json")

const sha256 = (b: Uint8Array | Buffer): string => createHash("sha256").update(b).digest("hex")
const sha256Text = (s: string): string => createHash("sha256").update(s).digest("hex")

const { hasWasmInRegistry, resolveWasmAsset } = await import("../../src/util/wasm")
const { getParser } = await import("../../src/ast/engine")

const NAME = "tree-sitter-yaml/tree-sitter-yaml.wasm"
const FILE_NAME = "tree-sitter-yaml.wasm"

// ── (A) THE REGISTRY'S BYTES — the citation that matters ──────────────────────────────────────────
const served = hasWasmInRegistry(NAME)
const servedSha = served ? sha256(served) : null
const servedBytes = served ? served.byteLength : 0

// ── (B) THE RESOLVED PATH — the engine's own resolution ───────────────────────────────────────────
const resolved = resolveWasmAsset(NAME)
const resolvedPath = resolved && resolved !== NAME ? resolved : null
const resolvedSha = resolvedPath && existsSync(resolvedPath) ? sha256(readFileSync(resolvedPath)) : null

// ── (C) THE REPO'S OWN FILE — what a path-based citation names ────────────────────────────────────
const repoFile = path.join(ROOT, "wasm", FILE_NAME)
const repoSha = existsSync(repoFile) ? sha256(readFileSync(repoFile)) : null

// ── (D) THE FIXTURE SUITE's BUILD ────────────────────────────────────────────────────────────────
const fixtureSha = repoSha

// ── (E) THE NPM PACKAGE's BUILD ───────────────────────────────────────────────────────────────────
const npmCandidates = [
  path.join(ROOT, "node_modules", "@tree-sitter-grammars", "tree-sitter-yaml", "tree-sitter-yaml.wasm"),
  path.join(ROOT, "node_modules", "tree-sitter-wasms", "out", "tree-sitter-yaml.wasm"),
  path.join(ROOT, "node_modules", "tree-sitter-wasm-prebuilt", "lib", "tree-sitter-yaml.wasm"),
]
const npmPath = npmCandidates.find((p) => existsSync(p)) ?? null
const npmSha = npmPath ? sha256(readFileSync(npmPath)) : null

// ── (F) THE NODE-TYPE INVENTORY, from the SERVED BYTES ───────────────────────────────────────────
/* SELF-CONTAINED ON PURPOSE. `script/m14/verify-grammar-pins.ts` is Bun-only (`import.meta.dir ??
 * path.dirname(Bun.main)`), so importing it makes this probe unrunnable under node/tsx. The
 * measurement is a dozen lines against `web-tree-sitter` directly, and the point of the instrument
 * is that it can be re-run by anyone — so it does not borrow a Bun-only module to do it. */

/** Load web-tree-sitter and return its `Language` class. */
async function wtsLanguage() {
  const wtsMod: any = await import("web-tree-sitter")
  const ParserClass = wtsMod.Parser ?? wtsMod.default ?? wtsMod
  await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
  return wtsMod.Language ?? wtsMod.default?.Language
}

/** The inventory of a tree-sitter Language, by the SAME rules the pin verifier uses. */
function inventoryOf(lang: any) {
  const ids: string[] = []
  const pairs: string[] = []
  const named: string[] = []
  const anon: string[] = []
  const typeCount = lang.nodeTypeCount
  for (let id = 0; id < typeCount; id++) {
    const name = String(lang.nodeTypeForId(id) ?? "")
    // THE ACCESSOR IS `nodeTypeIsNamed(id)`, NOT `.named` ON THE STRING `nodeTypeForId(id)` RETURNS.
    const isNamed = !!lang.nodeTypeIsNamed(id)
    ids.push(`${id}\u0000${name}\u0000${isNamed ? 1 : 0}`)
    pairs.push(`${isNamed ? 1 : 0}\u0000${name}`)
    ;(isNamed ? named : anon).push(name)
  }
  const fields: string[] = []
  for (let i = 1; i <= lang.fieldCount; i++) {
    const f = lang.fieldNameForId(i)
    if (f) fields.push(f)
  }
  return {
    ids: typeCount,
    uniqueNames: new Set([...named, ...anon]).size,
    namedIds: named.length,
    namedUnique: new Set(named).size,
    anonIds: anon.length,
    anonUnique: new Set(anon).size,
    fieldCount: lang.fieldCount,
    idOrderDigest: sha256Text(ids.join("\n")),
    typeSetDigest: sha256Text(pairs.slice().sort().join("\n")),
    fieldSetDigest: sha256Text(fields.slice().sort().join("\n")),
    namedTypes: [...new Set(named)].sort(),
    allTypes: [...new Set([...named, ...anon])].sort(),
  }
}

/** Read the inventory from the SERVED BYTES' own tree-sitter language. */
async function inventoryFromServedBytes() {
  if (!served) return null
  const Language = await wtsLanguage()
  const g = await Language.load(served)
  const inv = inventoryOf(g)
  g.delete?.()
  return inv
}

/** Read the inventory from the PRODUCTION parser's own Language object. */
async function inventoryFromProduction() {
  const parser = await getParser("yaml" as any)
  const lang = (parser as any).language
  return inventoryOf(lang)
}

const fromBytes = await inventoryFromServedBytes()
const production = await inventoryFromProduction()

// ── THE REPORT ───────────────────────────────────────────────────────────────────────────────────
const allAgree =
  servedSha !== null && resolvedSha !== null && servedSha === resolvedSha &&
  (repoSha === null || repoSha === servedSha) &&
  (npmSha === null || npmSha === servedSha) &&
  fromBytes !== null && production.idOrderDigest === fromBytes.idOrderDigest

const report = {
  instrument: "script/m14/yaml-grammar-binding-probe.ts",
  lane: "yaml",
  rule: "L-20: a grammar citation is the sha256 of the BYTES THE REGISTRY SERVES, never a path and never a log line.",
  at: new Date().toISOString(),
  asset: { registryKey: NAME, fileName: FILE_NAME },
  measurements: {
    A_registryBytes: { sha256: servedSha, bytes: servedBytes },
    B_resolvedPath: { path: resolvedPath, sha256: resolvedSha },
    C_repoOwnFile: { path: path.relative(ROOT, repoFile), sha256: repoSha },
    D_fixtureSuiteBuild: { path: path.relative(ROOT, repoFile), sha256: fixtureSha },
    E_npmPackageBuild: { path: npmPath ? path.relative(ROOT, npmPath) : null, sha256: npmSha },
  },
  pathAndBytesAgree: servedSha !== null && servedSha === resolvedSha,
  allBuildsAgree: allAgree,
  surfaceFromServedBytes: fromBytes,
  surfaceFromProductionParser: {
    ids: production.ids,
    uniqueNames: production.uniqueNames,
    namedIds: production.namedIds,
    namedUnique: production.namedUnique,
    anonIds: production.anonIds,
    anonUnique: production.anonUnique,
    fieldCount: production.fieldCount,
    idOrderDigest: production.idOrderDigest,
    typeSetDigest: production.typeSetDigest,
    fieldSetDigest: production.fieldSetDigest,
  },
  productionParserInventoryMatchesServedBytes:
    fromBytes !== null && production.idOrderDigest === fromBytes.idOrderDigest,
  NAMED_NODE_TYPES: production.namedTypes,
  ALL_NODE_TYPES: production.allTypes,
}

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(OUT, JSON.stringify(report, null, 2) + "\n")

console.log("== THE YAML GRAMMAR BINDING — WHICH BYTES ARE ACTUALLY LOADED ==")
console.log("")
console.log(`  (A) REGISTRY's BYTES  hasWasmInRegistry("${NAME}")`)
console.log(`      sha256 ${servedSha}   (${servedBytes} bytes)`)
console.log(`  (B) RESOLVED PATH     resolveWasmAsset("${NAME}")`)
console.log(`      ${resolvedPath}`)
console.log(`      sha256 ${resolvedSha}`)
console.log(`      ${servedSha === resolvedSha ? "the PATH and the BYTES AGREE" : "the PATH and the BYTES DIFFER — the engine's LOG prints the path, and the BYTES actually loaded are the registry's"}`)
console.log(`  (C) REPO OWN FILE     ${path.relative(ROOT, repoFile)}`)
console.log(`      sha256 ${repoSha}   ${repoSha === servedSha ? "(byte-identical to the served bytes)" : "(DIFFERENT from the served bytes)"}`)
console.log(`  (D) FIXTURE SUITE     ${path.relative(ROOT, repoFile)}`)
console.log(`      sha256 ${fixtureSha}   ${fixtureSha === servedSha ? "(the fixtures parse with the SAME bytes)" : "(DIFFERENT from the served bytes)"}`)
console.log(`  (E) NPM PACKAGE       ${npmPath ? path.relative(ROOT, npmPath) : "(no npm wasm installed)"}`)
console.log(`      sha256 ${npmSha}   ${npmSha === null ? "(no build to compare)" : npmSha === servedSha ? "(the same bytes)" : "(a DIFFERENT build — served by nothing)"}`)
console.log("")
console.log("  == THE SURFACE OF THE BYTES THE REGISTRY SERVES ==")
console.log(`      ids ${fromBytes?.ids} · namedUnique ${fromBytes?.namedUnique} · anonUnique ${fromBytes?.anonUnique} · fields ${fromBytes?.fieldCount}`)
console.log(`      idOrderDigest ${fromBytes?.idOrderDigest}`)
console.log(`      typeSetDigest ${fromBytes?.typeSetDigest}`)
console.log(`      fieldSetDigest ${fromBytes?.fieldSetDigest}`)
console.log("  == THE PRODUCTION PARSER'S OWN INVENTORY (getParser(\"yaml\").language) ==")
console.log(`      ids ${production.ids} · namedUnique ${production.namedUnique} · anonUnique ${production.anonUnique} · fields ${production.fieldCount}`)
console.log(`      idOrderDigest ${production.idOrderDigest}`)
console.log(`      ⇒ the production parser's inventory MATCHES the served bytes: ${report.productionParserInventoryMatchesServedBytes}`)
console.log("")
console.log(`  ⇒ THE BUILD PRODUCTION LOADS: ${String(servedSha).slice(0, 16)}`)
console.log(`  ⇒ report written: ${path.relative(ROOT, OUT)}`)
process.exit(allAgree ? 0 : 3)
