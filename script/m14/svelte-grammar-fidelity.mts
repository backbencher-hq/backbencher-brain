// SVELTE GRAMMAR-FIDELITY PROBE — which tree-sitter-svelte did a measurement
// actually load, and what that changes about the score.
//
// WHY THIS FILE EXISTS. `script/m14/svelte-census.mts` declares its FILE
// population (6,439 .svelte files, derived by readdir) and prints it on every
// run. It does not declare its GRAMMAR population, and the grammar it loads is
// not a property of the code under test — it is a property of the FILESYSTEM
// the process can see. MEASURED on 2026-10-05, same script, same corpus, same
// production path, same commit:
//
//   grammar                                  md5              bytes   rel   score
//   repo fork (wasm/tree-sitter-svelte.wasm) 48fc0307...       47,873  47,594  9/10
//   npm tree-sitter-svelte@0.11.0            22ffdf58...       35,635  14,729  4/10
//
// 4/10 is a correct number about the wrong population. The npm grammar predates
// Svelte 5 and emits no sub-parseable <script> body, so `imports[]` reads 0
// against 8,684 and six relationship types read 0 for a reason that has nothing
// to do with Svelte. Reporting that as a Svelte verdict would be a fabrication.
//
// THE CAUSE, named so a reader can check it. engine.ts resolveWasm() tries
//   (1) require.resolve(relativePath)      <- the FILESYSTEM decides
//   (2) hasWasmInRegistry / bbWasmCandidates  <- the REPO decides
// and census.mts defaults REPO to $HOME/backbencher-brain, so a run
// from any other checkout asks that checkout's filesystem first. In the main
// checkout require.resolve throws (no tree-sitter-svelte in its node_modules)
// and the registry supplies the repo grammar. In a worktree without
// node_modules, bun satisfies it from the global install cache instead.
// engine.ts is not this lane's file; this probe measures, it does not fix.
//
// NO REGEX (master rule 1). node types, field names, Set membership, `includes`
// on literal strings, md5 via node:crypto. Nothing here matches source text.
//
//   bun script/m14/svelte-grammar-fidelity.mts
//   SCORE=1 bun script/m14/svelte-grammar-fidelity.mts    # also tally the two channels

import { readFileSync, readdirSync, statSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { createHash } from "node:crypto"
import { join } from "node:path"

const REPO = process.env.BB_REPO || fileURLToPath(new URL("../..", import.meta.url))
const CORPUS = process.env.BB_CORPUS || "$HOME/fixtures/repositories"
const WANT_SCORE = process.env.SCORE === "1"
const MAXBYTES = 512 * 1024

// ---------------------------------------------------------------------------
// PART 1 — the resolved grammar, by identity not by assumption.
// ---------------------------------------------------------------------------

function md5(p: string): string {
  try {
    return createHash("md5").update(readFileSync(p)).digest("hex")
  } catch {
    return "(unreadable)"
  }
}

/** The grammar the ENGINE will actually load, read out of the resolver itself. */
async function resolvedGrammarPath(): Promise<string> {
  const engineSrc = readFileSync(join(REPO, "src/ast/engine.ts"), "utf8")
  // The resolver's registry key for svelte is a literal in engine.ts; find it
  // by walking the language table rather than by pattern-matching a path.
  const key = "tree-sitter-svelte/tree-sitter-svelte.wasm"
  if (!engineSrc.includes(key)) {
    console.log(`  NOTE: engine.ts does not mention ${key}; the resolver path may have changed.`)
  }
  const { ASTEngine }: any = await import(`${REPO}/src/ast/engine.ts`)
  await ASTEngine.getParser("svelte")
  // getParser logs the resolved path; recompute it deterministically instead of
  // scraping a log, so the answer does not depend on log configuration.
  const { resolveWasmAsset, hasWasmInRegistry }: any = await import(`${REPO}/src/util/wasm.ts`)
  const assetPath = resolveWasmAsset("tree-sitter-svelte.wasm")
  if (assetPath !== "tree-sitter-svelte.wasm" && statSync(assetPath).isFile()) {
    return assetPath
  }
  const bytes = hasWasmInRegistry("tree-sitter-svelte.wasm")
  if (!bytes) return "(registry empty)"
  // Attribute the registry bytes to a file by digest, so the number printed is
  // tied to bytes that were actually loaded and not to a path that merely exists.
  const digest = createHash("md5").update(bytes).digest("hex")
  for (const p of candidateGrammars()) {
    if (md5(p) === digest) return p
  }
  return `(registry bytes ${digest.slice(0, 12)}, source file not identified)`
}

function candidateGrammars(): string[] {
  const out: string[] = []
  for (const root of [REPO, "$HOME/backbencher-brain"]) {
    out.push(join(root, "wasm/tree-sitter-svelte.wasm"))
    out.push(join(root, "node_modules/tree-sitter-svelte/tree-sitter-svelte.wasm"))
  }
  // The bun global install cache, DERIVED by scanning it for the package rather
  // than by writing the version into this file.
  const cache = join(process.env.HOME || "/root", ".bun/install/cache")
  try {
    for (const e of readdirSync(cache)) {
      if (!e.includes("tree-sitter-svelte")) continue
      out.push(join(cache, e, "tree-sitter-svelte.wasm"))
    }
  } catch {
    /* cache absent: reported as a missing population, not as a zero */
  }
  return out
}

console.log(`svelte-grammar-fidelity  REPO=${REPO}`)
console.log("")
console.log("GRAMMARS ON DISK (md5 is the identity; sizes alone do not identify a grammar)")
for (const p of candidateGrammars()) {
  let size = 0
  try {
    size = statSync(p).size
  } catch {
    continue
  }
  console.log(`  ${md5(p)}  ${String(size).padStart(7)} B  ${p}`)
}
const resolved = await resolvedGrammarPath()
console.log("")
console.log(`THE GRAMMAR THE ENGINE RESOLVES FOR \"svelte\": ${resolved}`)
console.log(`  md5 ${md5(resolved)}`)
console.log("")
console.log("If the digest above is NOT the repo's wasm/tree-sitter-svelte.wasm digest, every number")
console.log("this lane produces describes a grammar the production checkout does not use. Re-run with")
console.log("node_modules present so require.resolve throws and the repo registry answers.")

// ---------------------------------------------------------------------------
// PART 2 — optional: what the score does with each grammar.
// ---------------------------------------------------------------------------

if (!WANT_SCORE) {
  console.log("")
  console.log("(SCORE=1 also tallies the relationship channel per file through production parseFile)")
  process.exit(0)
}

function svelteFiles(dir: string, out: string[], depth = 0): void {
  if (depth > 20) return
  let ents: any[]
  try {
    ents = readdirSync(dir, { withFileTypes: true }) as any[]
  } catch {
    return
  }
  for (const e of ents) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".git") continue
      svelteFiles(p, out, depth + 1)
    } else if (e.name.endsWith(".svelte")) out.push(p)
  }
}

const engine: any = await import(`${REPO}/src/ast/engine.ts`)
const files: string[] = []
for (const e of readdirSync(CORPUS).sort()) {
  const d = join(CORPUS, e)
  try {
    if (statSync(d).isDirectory()) svelteFiles(d, files)
  } catch {
    continue
  }
}
files.sort()

const tally = new Map<string, number>()
let importRows = 0
let symbols = 0
let parsed = 0
for (const f of files) {
  let content: string
  try {
    if (statSync(f).size > MAXBYTES) continue
    content = readFileSync(f, "utf8")
  } catch {
    continue
  }
  if (content.length === 0) continue
  try {
    const res = await engine.parseFile(f, content)
    parsed++
    symbols += res.symbols?.length ?? 0
    importRows += res.imports?.length ?? 0
    for (const r of res.relationships ?? []) {
      const t = String(r.relationshipType ?? r.type ?? "")
      if (t) tally.set(t, (tally.get(t) ?? 0) + 1)
    }
  } catch {
    /* counted in the census's `threw` column; this probe tallies types only */
  }
}
const TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"]
const fired = TYPES.filter((t) => tally.has(t))
console.log("")
console.log(`TALLY over ${files.length} files, ${parsed} parsed, grammar md5 ${md5(resolved)}`)
console.log(`  symbols ${symbols}  imports[] rows ${importRows}`)
console.log(`  RELATIONSHIP CHANNEL ${fired.length}/10`)
for (const t of TYPES) {
  console.log(`    ${t.padEnd(13)} ${tally.has(t) ? String(tally.get(t)).padStart(7) : "SILENT"}`)
}