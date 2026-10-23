/**
 * TS GRAMMAR-BINDING PROBE — WHICH GRAMMAR BUILD DOES PRODUCTION ACTUALLY LOAD, AND WHAT DOES THE
 * DIFFERENCE COST OVER THE ADMITTED POPULATION (L-2026-10-21-11).
 *
 * ## THE FACT THIS INSTRUMENT EXISTS TO ESTABLISH — AND THIS HEADER HAS BEEN WRONG TWICE
 *
 * THE ONLY CITATION THAT SURVIVES IS THE DIGEST OF THE BYTES THE RESOLVER HANDS THE PARSER. Not a
 * path, not a directory someone believes is first in the candidate list, and not a log line's
 * `wasmPath` taken on trust — the log line names a path, and a path can be a file that is never
 * loaded. So this probe MEASURES: it calls the production resolver, reads the path the engine logs,
 * hashes THAT file, and prints the digest.
 *
 * MEASURED 2026-10-23, from a real script file so the resolver path is production's:
 *
 *   · **778025db5a8be0e70f8ccc3671e486dfeddd048c25d9e8a70c26de2e1bf6f97d** — 1,413,849 bytes —
 *     `node_modules/tree-sitter-typescript/tree-sitter-typescript.wasm`. ⇒⇒⇒ **THIS IS THE SERVED
 *     TYPESCRIPT BUILD.**
 *   · **8515404dceed38e1ed86aa34b09fcf3379fff1b4ff9dd3967bcd6d1eb5ac3d8f** — 2,342,690 bytes —
 *     `wasm/tree-sitter-typescript.wasm`. **Present, and NEVER SERVED for this language in this
 *     checkout**: the resolver walks past it. Three rounds of this lane cited it as production's
 *     build, and an earlier version of this very header declared 778025db "loaded by NOTHING".
 *     **Both statements were wrong, and each was wrong about the other file.**
 *   · **b75fa34cfde954d15429b39062d217e6fa99b425a0c3f1aaedd082116dd20335** — this lane's R2 patch,
 *     built from the npm package's own source; that source's shipped build is 778025db, which is why
 *     the patch is compared against 778025db and NOT against wasm/. A comparison against the wrong
 *     baseline produced a drift figure this lane had to withdraw.
 *   · **6aa3b2c70e76f5d48eafef1093e9c4de383e13f2fdde2f4e9b98a378f6a8f1b6** — the TSX build. The TSX
 *     grammar is a DIFFERENT BUILD and not interchangeable: a `.tsx` file parsed with the typescript
 *     grammar is a different population from the same file parsed with the tsx grammar, and mixing
 *     the two in one comparison is how the wrong drift figure was produced.
 *
 * ⇒⇒⇒ **A GRAMMAR CITATION IS A SHA-256 OF SERVED BYTES. THIS PROBE EXISTS TO COMPUTE IT, NOT TO
 * ASSERT IT** — because every assertion this lane has made about which build is served has been
 * wrong at least once, including in both directions.
 *
 * ## WHAT IT MEASURES
 *
 *   1 · **THE BINDING, as the production path actually resolves it** — the path
 *       `resolveWasmAsset` returns, its sha256, and the sha256 of the bytes the wasm REGISTRY
 *       actually serves for that name (the registry is keyed by FILE NAME, so two files with the
 *       same name in two directories are a live ambiguity and the probe reports which one won).
 *   2 · **THE NAMED-TYPE DELTA** between the two builds, through the fleet's own
 *       `grammar-remedy.ts` surface/delta machinery.
 *   3 · **THE PER-TYPE RELATIONSHIP DELTA OVER THE ADMITTED POPULATION** — every admitted file
 *       parsed with BOTH builds and analyzed with the SAME analyzer, and the per-type relationship
 *       counts differenced. **This is the population measurement the remedy ladder requires** (the
 *       new build against the old one OVER THE ADMITTED POPULATION), applied to the two builds
 *       that already exist.
 *   4 · **THE FIXTURE VERDICT UNDER EACH BUILD** — for named fixtures, the relationships each
 *       build produces, so a fixture failure can be attributed to the PARSER or to the ANALYZER
 *       rather than guessed at.
 *
 * ## WHAT IT DOES NOT CLAIM
 *
 * It does not say the two builds are interchangeable, and it does not say which one SHOULD be
 * used — that is the Lead's instrument and the Lead's call. It says WHAT THE DIFFERENCE IS, with a
 * count, so the cell can state it.
 *
 * ## USAGE
 *
 *   bun run script/m14/ts-grammar-binding-probe.ts --max-files 0
 *   bun run script/m14/ts-grammar-binding-probe.ts --max-files 200 --fixtures re-export-empty-clause,type-reference-uses-surfaces
 *   BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/ts-grammar-binding-probe.ts --max-files 0 --json out.json
 */

import { readFileSync, existsSync, writeFileSync, statSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import * as path from "node:path"
import { RealTypeScriptAnalyzer } from "../../src/ast/real-typescript-analyzer"
import { resolveWasmAsset, hasWasmInRegistry } from "../../src/util/wasm"

const ROOT = process.cwd()
const CR = process.env.BB_CORPUS_ROOT ?? path.join(ROOT, ".corpus")
const argv = process.argv.slice(2)
const argOf = (f: string): string | undefined => {
  const i = argv.indexOf(f)
  return i >= 0 ? argv[i + 1] : undefined
}
const MAX_FILES = Number(argOf("--max-files") ?? "0")
const JSON_OUT = argOf("--json")
const FIXTURES = (argOf("--fixtures") ?? "").split(",").map((s) => s.trim()).filter(Boolean)

const sha = (b: Uint8Array | Buffer): string => createHash("sha256").update(b).digest("hex")
const L: string[] = []
const say = (s = "") => L.push(s)

// ─── 1 · THE BINDING, AS PRODUCTION RESOLVES IT ───────────────────────────────────────────────
say("TS GRAMMAR-BINDING PROBE — which build PRODUCTION loads, and what the difference costs")
say()
say("== THE BINDING ==")
const productionAsset = "tree-sitter-typescript/tree-sitter-typescript.wasm"
const productionPath = resolveWasmAsset(productionAsset)
let productionSha = "(unreadable)"
try { productionSha = sha(readFileSync(productionPath)) } catch { /* declared below */ }
say(`  PRODUCTION's PATH  (src/ast/engine.ts:939 -> resolveWasmAsset("${productionAsset}"))`)
say(`    ${productionPath}`)
say(`    sha256 ${productionSha}`)
// THE BYTES ARE WHAT MATTER, AND THE ENGINE'S LOG LINE IS NOT THE BYTES. `getParser` resolves a
// PATH (`resolveWasm`) and then asks the REGISTRY for the bytes, and the registry is keyed by FILE
// NAME FIRST (`hasWasmInRegistry`: `_wasmRegistry[wasmName]` before `_wasmRegistry[name]`) — so two
// files with one name in two directories are a live ambiguity, and the one that is LOADED is the
// registry's. The engine's own "language parser loaded" log prints the PATH, which is NOT
// necessarily the file the bytes came from. **⇒ A LANE THAT CITES THE LOG CITES THE WRONG BUILD**,
// and this probe measures the bytes.
const registryBytes = hasWasmInRegistry(productionAsset)
const registrySha = registryBytes ? sha(registryBytes) : "(no registry bytes)"
say(`  PRODUCTION's BYTES (the wasm REGISTRY — the file-NAME key wins, and the engine asks the registry)`)
say(`    sha256 ${registrySha}`)
say(`    ${productionSha === registrySha ? "the PATH and the BYTES agree" : "the PATH and the BYTES DIFFER — the engine's LOG prints the path, and the BYTES that are actually loaded are the registry's"}`)
say(`    ⇒ THE BUILD PRODUCTION LOADS: ${registrySha.slice(0, 16)}`)
// THE TSX BUILD, the same way — the engine resolves it by a different relative path but the
// registry is keyed by file name, so it is measured the same way.
const tsxAsset = "tree-sitter-typescript/tree-sitter-tsx.wasm"
const tsxPath = resolveWasmAsset(tsxAsset)
const tsxRegistry = hasWasmInRegistry(tsxAsset)
say(`  THE TSX BUILD — path ${tsxPath}`)
say(`    path sha256   ${(() => { try { return sha(readFileSync(tsxPath)) } catch { return "(unreadable)" } })()}`)
say(`    REGISTRY sha256 ${tsxRegistry ? sha(tsxRegistry) : "(no registry bytes)"}`)

const FIXTURE_WASM = path.join(ROOT, "wasm", "tree-sitter-typescript.wasm")
let fixtureSha = "(unreadable)"
try { fixtureSha = sha(readFileSync(FIXTURE_WASM)) } catch { /* declared below */ }
say(`  THE FIXTURE SUITE's BUILD (script/m14/run-fixtures.ts:704 -> Language.load(wasm/${path.basename(FIXTURE_WASM)}))`)
say(`    ${FIXTURE_WASM}`)
say(`    sha256 ${fixtureSha}`)

const nodeModulesWasm = path.join(ROOT, "node_modules", "tree-sitter-typescript", "tree-sitter-typescript.wasm")
let nodeModulesSha = "(unreadable)"
try { nodeModulesSha = sha(readFileSync(nodeModulesWasm)) } catch { /* declared below */ }
say(`  THE NPM PACKAGE's BUILD (node_modules/tree-sitter-typescript/tree-sitter-typescript.wasm)`)
say(`    sha256 ${nodeModulesSha}`)
say(`  ⇒ THE TWO BUILDS IN THIS TREE: production ${productionSha.slice(0, 16)} · fixtures ${fixtureSha.slice(0, 16)} · npm ${nodeModulesSha.slice(0, 16)}`)
say(`    ${productionSha === fixtureSha ? "production and the fixtures run the SAME build" : "production and the fixtures run DIFFERENT builds — L-11: the cell must say which each of its numbers came from"}`)

console.log(L.join("\n"))   // THE BINDING IS PRINTED FIRST: a later failure must not take it with it
say()

// ─── THE TWO BUILDS, LOADED AS TWO GRAMMARS ───────────────────────────────────────────────────
// THE FIXTURE SUITE's OWN LOADER ROUTE, verbatim (`script/m14/run-fixtures.ts:698-707`): a direct
// `import("web-tree-sitter")` with the node_modules core wasm. MEASURED 2026-10-21: this route
// loads BOTH builds (the fixture build reports `nodeTypeCount: 385`), while the engine's own
// `loadWebTreeSitter()` route dies in `Language.load` with "C.loadWebAssemblyModule is undefined"
// — a HARNESS difference, not a grammar finding, and the probe uses the route that WORKS so the
// measurement is about the GRAMMAR and not about the loader.
const wts: any = await import("web-tree-sitter")
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })

type Build = { name: string; sha: string; path: string; language: any }
const builds: Build[] = []
for (const [name, p] of [["production", productionPath], ["fixtures", FIXTURE_WASM]] as const) {
  if (!existsSync(p)) { say(`  (the ${name} build at ${p} is absent — skipped)`); continue }
  const bytes = readFileSync(p)
  const language = await Language.load(bytes)
  builds.push({ name, sha: sha(bytes), path: p, language })
}
say()
say(`== THE NAMED-TYPE DELTA BETWEEN THE TWO BUILDS (the fleet's own grammar-remedy.ts) ==`)
if (builds.length === 2) {
  const { execFileSync: run } = await import("node:child_process")
  try {
    const out = run("bun", ["script/m14/grammar-remedy.ts", "delta", "--from", builds[0]!.path, "--to", builds[1]!.path], {
      cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
    })
    for (const line of out.split("\n")) {
      if (line.includes("added") || line.includes("removed") || line.includes("IDENTITY") || line.includes("TYPE SET") || line.includes("named types") || line.includes("fieldCount") || line.includes("Digest")) say(`  ${line.trim()}`)
    }
  } catch (e) { say(`  (the delta could not be run: ${(e as Error).message})`) }
}

// ─── THE ADMITTED POPULATION, THE GATE'S OWN RULE ──────────────────────────────────────────────
function admittedFiles(): string[] {
  const exts = new Set(["ts", "tsx", "mts", "cts"])
  const out: string[] = []
  let entries: string[] = []
  try { entries = (readdirSyncSafe(CR)).map((e) => e.name) } catch { entries = [] }
  for (const name of entries.sort()) {
    const dir = path.join(CR, name)
    try { if (!statSync(dir).isDirectory()) continue } catch { continue }
    try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
    let tracked: string[] = []
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
    } catch { continue }
    for (const rel of tracked) {
      const low = rel.toLowerCase()
      const dot = low.lastIndexOf(".")
      if (dot < 0 || !exts.has(low.slice(dot + 1))) continue
      const abs = path.join(dir, rel)
      if (!existsSync(abs)) continue
      try { if (statSync(abs).size > 1024 * 1024) continue } catch { continue }
      out.push(abs)
    }
  }
  return out
}
function readdirSyncSafe(dir: string): { name: string }[] {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require("node:fs")
  return fs.readdirSync(dir, { withFileTypes: true }) as { name: string }[]
}

// ─── 3 · THE PER-TYPE RELATIONSHIP DELTA OVER THE ADMITTED POPULATION ─────────────────────────
const files = admittedFiles()
const sample = MAX_FILES > 0 && files.length > MAX_FILES ? files.slice(0, MAX_FILES) : files
say()
say(`== THE PER-TYPE RELATIONSHIP DELTA OVER THE ADMITTED POPULATION ==`)
say(`  population: ${sample.length} file(s) — ${MAX_FILES > 0 ? `A DRAW (max-files ${MAX_FILES}), NOT a population` : "the WHOLE admitted population"}`)
say(`  admitted by the gate's rule: ${files.length} file(s)`)

const byType: Record<string, Record<string, number>> = {}
for (const b of builds) byType[b.name] = {}
const perFileDiffs: { file: string; a: number; b: number }[] = []
let parsedOk = 0
let parseFail = 0

for (const abs of sample) {
  let content = ""
  try { content = readFileSync(abs, "utf8") } catch { parseFail++; continue }
  const counts: Record<string, number> = {}
  let anyParsed = false
  for (const b of builds) {
    let n = 0
    try {
      // A FRESH PARSER PER FILE: a shared tree-sitter parser dies after a few hundred files
      // ("Out of bounds memory access"), and a dead parser would silently make one build look
      // EMPTY. The parser is per file; the GRAMMAR (the expensive part) is loaded once.
      const parser = new ParserClass()
      parser.setLanguage(b.language)
      const tree = parser.parse(content)
      const res = await new RealTypeScriptAnalyzer().analyze(tree.rootNode, content, path.relative(CR, abs))
      n = (res?.relationships ?? []).length
      anyParsed = true
    } catch { n = -1 }
    counts[b.name] = n
    const t = byType[b.name]!
    t.__files__ = (t.__files__ ?? 0) + 1
  }
  if (anyParsed) parsedOk++
  else parseFail++
  const names = builds.map((b) => b.name)
  if (names.length === 2 && counts[names[0]!] !== counts[names[1]!]) {
    if (perFileDiffs.length < 20) perFileDiffs.push({ file: path.relative(CR, abs), a: counts[names[0]!]!, b: counts[names[1]!]! })
  }
}

// THE PER-TYPE DELTA — computed by ANALYZING each build's tree and tallying the relationship TYPES,
// not by diffing the two totals. A difference in the total says something changed; a difference
// per TYPE says what.
if (builds.length === 2) {
  const names = builds.map((b) => b.name)
  const tally: Record<string, Record<string, number>> = { [names[0]!]: {}, [names[1]!]: {} }
  let deltaFiles = 0
  for (const abs of sample) {
    let content = ""
    try { content = readFileSync(abs, "utf8") } catch { continue }
    const per: Record<string, Record<string, number>> = {}
    for (const b of builds) {
      const t: Record<string, number> = {}
      try {
        const parser = new ParserClass()
        parser.setLanguage(b.language)
        const tree = parser.parse(content)
        const res = await new RealTypeScriptAnalyzer().analyze(tree.rootNode, content, path.relative(CR, abs))
        for (const r of (res?.relationships ?? []) as any[]) {
          const lt = String(r?.type ?? "")
          t[lt] = (t[lt] ?? 0) + 1
        }
      } catch { /* counted by the parse-failure bucket */ }
      per[b.name] = t
    }
    const keys = new Set([...Object.keys(per[names[0]!]!), ...Object.keys(per[names[1]!]!)])
    let fileDelta = 0
    for (const k of keys) {
      const a = per[names[0]!]![k] ?? 0
      const bb = per[names[1]!]![k] ?? 0
      tally[names[0]!]![k] = (tally[names[0]!]![k] ?? 0) + a
      tally[names[1]!]![k] = (tally[names[1]!]![k] ?? 0) + bb
      fileDelta += Math.abs(a - bb)
    }
    if (fileDelta > 0) deltaFiles++
  }
  const typeKeys = [...new Set([...Object.keys(tally[names[0]!]!), ...Object.keys(tally[names[1]!]!)])].sort()
  say(`  ${"type".padEnd(16)} ${names[0]!.padStart(12)} ${names[1]!.padStart(12)} ${"delta".padStart(10)}`)
  let totalDelta = 0
  for (const k of typeKeys) {
    const a = tally[names[0]!]![k] ?? 0
    const b = tally[names[1]!]![k] ?? 0
    totalDelta += Math.abs(a - b)
    say(`  ${k.padEnd(16)} ${String(a).padStart(12)} ${String(b).padStart(12)} ${String(a - b).padStart(10)}`)
  }
  say(`  files whose relationship set DIFFERS between the two builds: ${deltaFiles} of ${sample.length}`)
  say(`  THE TOTAL ABSOLUTE PER-TYPE DELTA: ${totalDelta} — ${totalDelta === 0 ? "A ZERO MEASURED, NOT A ZERO ASSUMED" : "the two builds are NOT interchangeable over this population"}`)
  for (const d of perFileDiffs) say(`    ${d.file}: ${names[0]}=${d.a} ${names[1]}=${d.b}`)
}

// ─── 4 · THE FIXTURE VERDICT UNDER EACH BUILD ────────────────────────────────────────────────
if (FIXTURES.length > 0) {
  say()
  say("== THE FIXTURE VERDICT UNDER EACH BUILD ==")
  for (const fx of FIXTURES) {
    const src = path.join(ROOT, "validation", "m14", "fixtures", "typescript", `${fx}.ts`)
    if (!existsSync(src)) { say(`  ${fx}: NOT FOUND`); continue }
    const content = readFileSync(src, "utf8")
    say(`  ${fx}:`)
    for (const b of builds) {
      try {
        const parser = new ParserClass()
        parser.setLanguage(b.language)
        const tree = parser.parse(content)
        const res = await new RealTypeScriptAnalyzer().analyze(tree.rootNode, content, `fixtures/typescript/${fx}.ts`)
        const rels = (res?.relationships ?? []) as any[]
        const imports = (res?.imports ?? []) as any[]
        say(`    under ${b.name} (${b.sha.slice(0, 16)}): ${rels.length} relationship(ies), ${imports.length} import(s)`)
        for (const r of rels) {
          const md = r?.metadata ?? {}
          const extra = Object.keys(md).length > 0 ? `  ${JSON.stringify(md).slice(0, 160)}` : ""
          say(`      ${String(r?.type)}  ${r?.source} -> ${r?.target}${extra}`)
        }
        for (const im of imports) {
          say(`      IMPORT ${JSON.stringify({ module: im.module, items: im.items, alias: im.alias, meta: im.metadata })}`)
        }
      } catch (e) {
        say(`    under ${b.name}: FAILED — ${(e as Error).message}`)
      }
    }
  }
}

function text(): string { return L.join("\n") }
console.log(text())
if (JSON_OUT) {
  writeFileSync(JSON_OUT, JSON.stringify({
    binding: { productionPath, productionSha, registrySha, fixturePath: FIXTURE_WASM, fixtureSha, nodeModulesSha, tsxPath, tsxRegistrySha: (() => { const b = hasWasmInRegistry(tsxAsset); return b ? sha(b) : null })() },
    builds: builds.map((b) => ({ name: b.name, sha: b.sha, path: b.path })),
    population: { kind: MAX_FILES > 0 ? "draw" : "whole-admitted-population", files: sample.length, admitted: files.length, parsedOk, parseFail },
  }, null, 2))
  console.log(`\nJSON written: ${JSON_OUT}`)
}
