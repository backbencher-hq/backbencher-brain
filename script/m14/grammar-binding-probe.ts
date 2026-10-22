#!/usr/bin/env bun
/**
 * THE SHARED, LANGUAGE-AGNOSTIC BYTE-LEVEL GRAMMAR BINDING PROBE.
 *
 * THIS IS A LEAD-OWNED INSTRUMENT, and it exists because of a defect the campaign paid for twice.
 *
 * THE DEFECT: the engine's "language parser loaded" LOG prints a PATH, and that path is NOT
 * necessarily the file the BYTES came from. `src/ast/engine.ts:677-700` resolves the wasm asset,
 * `:808-830` handles the registry and the temp-file path, and `:939/943/947` are the three asset
 * spellings it tries. So a citation of that log line cites a SPELLING, not the artifact.
 *
 * THE RULING THAT CAME OUT OF IT (L-20): a grammar is cited by THE SHA256 OF THE BYTES THE REGISTRY
 * SERVES — never by a path, never by a log line. And the Lead's own L-11 was BACKWARDS when it was
 * written (it named the npm build as the production build; the measurement said the opposite, and
 * the measurement was right). The Lead's first probe of the sql fork was ALSO wrong — a
 * directory-level grep reported the fork's distinctive names as present, and the matching file was
 * PROSE in PIN.md rather than grammar.js. A directory-level match must be attributed to a FILE
 * before it is believed. So this instrument attributes every fact to a file and prints the file
 * beside the bytes.
 *
 * WHAT IT REPORTS, PER LANGUAGE:
 *   1. THE PATH `resolveWasmAsset` returns for the spelling asked for.
 *   2. THE SHA256 of the bytes `hasWasmInRegistry` serves for that spelling.
 *   3. THE SHA256 of the FILE AT THAT PATH, read independently from disk.
 *   4. WHETHER PATH AND BYTES AGREE — the digest of 2 against the digest of 3. This is the single
 *      most important line in the output: it is the check that catches the log-line defect.
 *   5. THE NAMED AND ANONYMOUS ID COUNTS, from the grammar's own node-type inventory.
 *   6. THE NPM BUILD'S SHA, when the package is installed, so the three digests can be compared.
 *
 * THE NAMED/ANONYMOUS TRAP IS HANDLED HERE, because it has cost two lanes a wrong number:
 * `nodeTypeForId` returns the type NAME as a STRING, and a string has no `.named`, so `t.named`
 * counts EVERY type as anonymous. The accessor is `nodeTypeIsNamed(id)`. THE TELL is that TOTAL
 * agrees with a prior measurement while the named-count is 0 — that is a classification bug, not a
 * finding, and this instrument prints both numbers side by side so it is visible.
 *
 * RUN:  `bun script/m14/grammar-binding-probe.ts [language ...]`
 *       With no arguments it probes EVERY language in the fleet.
 * EXIT: 0 when every probed language's path and bytes AGREE (or the language has no wasm at all);
 *       5 when any language's path and bytes DISAGREE — because that is a real defect and a
 *       citation built on it would be false.
 */

import { createHash } from "node:crypto"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { resolveWasmAsset, hasWasmInRegistry } from "../../src/util/wasm"
import { bbWasmCandidates } from "../../src/util/bb-data-dir"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const sha256 = (b: Uint8Array | Buffer) => createHash("sha256").update(b).digest("hex")

/** The fleet's languages, in the fixed order. Each entry names the wasm file the engine asks for. */
/**
 * `wasm` is the FILE the repo ships. `engine` is the SPELLING the engine asks the resolver for —
 * and they DIFFER for some languages (`tree-sitter-c-sharp/tree-sitter-c_sharp.wasm` resolves to
 * `tree-sitter-c_sharp.wasm`), so the probe reports BOTH: the spelling is what a reader must cite
 * alongside the digest, and the file is where the bytes are.
 */
const LANGUAGES: Array<{ lang: string; wasm: string; engine?: string; pkg?: string; engineKey?: string }> = [
  { lang: "bash", wasm: "tree-sitter-bash.wasm", pkg: "tree-sitter-bash" },
  { lang: "c", wasm: "tree-sitter-c.wasm", pkg: "tree-sitter-c" },
  { lang: "clean", wasm: "tree-sitter-clean.wasm", pkg: "tree-sitter-clean" },
  { lang: "clojure", wasm: "tree-sitter-clojure.wasm", pkg: "tree-sitter-clojure" },
  { lang: "cpp", wasm: "tree-sitter-cpp.wasm", engine: "tree-sitter-cpp/tree-sitter-cpp.wasm", pkg: "tree-sitter-cpp" },
  { lang: "csharp", wasm: "tree-sitter-c_sharp.wasm", engine: "tree-sitter-c-sharp/tree-sitter-c_sharp.wasm", pkg: "tree-sitter-c-sharp" },
  { lang: "css", wasm: "tree-sitter-css.wasm", pkg: "tree-sitter-css" },
  { lang: "dart", wasm: "tree-sitter-dart.wasm", engine: "tree-sitter-dart/tree-sitter-dart.wasm", pkg: "tree-sitter-dart" },
  { lang: "elixir", wasm: "tree-sitter-elixir.wasm", pkg: "tree-sitter-elixir" },
  { lang: "erlang", wasm: "tree-sitter-erlang.wasm", pkg: "tree-sitter-erlang" },
  { lang: "fsharp", wasm: "tree-sitter-fsharp.wasm", pkg: "tree-sitter-fsharp" },
  { lang: "go", wasm: "tree-sitter-go.wasm", pkg: "tree-sitter-go" },
  { lang: "graphql", wasm: "tree-sitter-graphql.wasm", pkg: "tree-sitter-graphql" },
  { lang: "groovy", wasm: "tree-sitter-groovy.wasm", pkg: "tree-sitter-groovy" },
  { lang: "haskell", wasm: "tree-sitter-haskell.wasm", pkg: "tree-sitter-haskell" },
  { lang: "hcl", wasm: "tree-sitter-hcl.wasm", pkg: "tree-sitter-hcl" },
  { lang: "html", wasm: "tree-sitter-html.wasm", pkg: "tree-sitter-html" },
  { lang: "java", wasm: "tree-sitter-java.wasm", pkg: "tree-sitter-java" },
  { lang: "javascript", wasm: "tree-sitter-javascript.wasm", engine: "tree-sitter-javascript/tree-sitter-javascript.wasm", pkg: "tree-sitter-javascript" },
  { lang: "json", wasm: "tree-sitter-json.wasm", pkg: "tree-sitter-json" },
  { lang: "julia", wasm: "tree-sitter-julia.wasm", pkg: "tree-sitter-julia" },
  { lang: "kotlin", wasm: "tree-sitter-kotlin.wasm", pkg: "tree-sitter-kotlin" },
  { lang: "lua", wasm: "tree-sitter-lua.wasm", pkg: "tree-sitter-lua" },
  { lang: "make", wasm: "tree-sitter-make.wasm", pkg: "tree-sitter-make" },
  { lang: "markdown", wasm: "tree-sitter-markdown.wasm", pkg: "tree-sitter-markdown" },
  { lang: "nim", wasm: "tree-sitter-nim.wasm", pkg: "tree-sitter-nim" },
  { lang: "objc", wasm: "tree-sitter-objc.wasm", engine: "tree-sitter-objc/tree-sitter-objc.wasm", pkg: "tree-sitter-objc", engineKey: "objective-c" },
  { lang: "perl", wasm: "tree-sitter-perl.wasm", pkg: "tree-sitter-perl" },
  { lang: "php", wasm: "tree-sitter-php.wasm", pkg: "tree-sitter-php" },
  { lang: "powershell", wasm: "tree-sitter-powershell.wasm", pkg: "tree-sitter-powershell" },
  { lang: "protobuf", wasm: "tree-sitter-protobuf.wasm", pkg: "tree-sitter-protobuf" },
  { lang: "python", wasm: "tree-sitter-python.wasm", engine: "tree-sitter-python/tree-sitter-python.wasm", pkg: "tree-sitter-python" },
  { lang: "r", wasm: "tree-sitter-r.wasm", pkg: "tree-sitter-r" },
  { lang: "ruby", wasm: "tree-sitter-ruby.wasm", engine: "tree-sitter-ruby/tree-sitter-ruby.wasm", pkg: "tree-sitter-ruby" },
  { lang: "rust", wasm: "tree-sitter-rust.wasm", pkg: "tree-sitter-rust" },
  { lang: "scala", wasm: "tree-sitter-scala.wasm", pkg: "tree-sitter-scala" },
  { lang: "scss", wasm: "tree-sitter-scss.wasm", pkg: "tree-sitter-scss" },
  { lang: "solidity", wasm: "tree-sitter-solidity.wasm", pkg: "tree-sitter-solidity" },
  { lang: "sql", wasm: "tree-sitter-sql.wasm", engine: "tree-sitter-sql/tree-sitter-sql.wasm", pkg: "tree-sitter-sql" },
  { lang: "svelte", wasm: "tree-sitter-svelte.wasm", pkg: "tree-sitter-svelte" },
  { lang: "swift", wasm: "tree-sitter-swift.wasm", pkg: "tree-sitter-swift" },
  { lang: "toml", wasm: "tree-sitter-toml.wasm", pkg: "tree-sitter-toml" },
  { lang: "typescript", wasm: "tree-sitter-typescript.wasm", engine: "tree-sitter-typescript/tree-sitter-typescript.wasm", pkg: "tree-sitter-typescript" },
  { lang: "vb", wasm: "tree-sitter-vbnet.wasm", pkg: "tree-sitter-vbnet" },
  { lang: "vue", wasm: "tree-sitter-vue.wasm", pkg: "tree-sitter-vue" },
  { lang: "xml", wasm: "tree-sitter-xml.wasm", pkg: "tree-sitter-xml" },
  { lang: "yaml", wasm: "tree-sitter-yaml.wasm", pkg: "tree-sitter-yaml" },
  { lang: "zig", wasm: "tree-sitter-zig.wasm", pkg: "tree-sitter-zig" },
]

/**
 * THE NODE-TYPE INVENTORY, READ FROM THE SAME BYTES AS THE DIGEST.
 *
 * This is the part that was WRONG in the first run of this instrument, and the correction matters
 * more than the counts do. The first run read the counts from the repo's own
 * `grammars/<name>/src/node-types.json` — a DIFFERENT ARTIFACT from the wasm the registry serves.
 * For sql it printed 527 named types beside the digest of the served build, which is the FORK and
 * carries more than the published grammar does; for ruby it printed the published grammar's counts
 * beside the served build's digest. Two artifacts, two sets of numbers, printed side by side as if
 * they were one. That is the same class of error as citing a path for bytes.
 *
 * So the counts are read from the LIVE LANGUAGE the parser holds, which is the same wasm the
 * registry served, and the accessor is `nodeTypeIsNamed(id)` — NOT `t.named`. `nodeTypeForId`
 * returns the type NAME as a string, and a string has no `.named`, so `t.named` counts every type as
 * anonymous. THE TELL is that TOTAL agrees with a prior measurement while the named-count is 0.
 */
async function inventoryOf(lang: string): Promise<{ namedTypes: number; totalIds: number } | null> {
  try {
    const { getParser } = await import("../../src/ast/engine")
    // The engine's own key is not always the lane's name: objc's lane key is `objc` and the
    // engine's is `objective-c` (`src/ast/engine.ts:329`), so the probe carries both.
    const parser = await getParser((lang === "objc" ? "objective-c" : lang) as any)
    // `parser.language` is a PROPERTY on web-tree-sitter's Parser, not a method. (`getLanguage()`
    // does not exist on this binding, and calling it would throw rather than return null, which
    // is why the probe wraps this in a try.) The engine's own comment at src/ast/engine.ts:1702
    // records that 0.25 exposes no `getLanguage()` — this is that fact, still true.
    const language = (parser as any).language
    if (!language) return null
    const totalIds: number = language.nodeTypeCount
    let namedTypes = 0
    for (let id = 0; id < totalIds; id++) {
      if (language.nodeTypeIsNamed(id)) namedTypes++
    }
    return { namedTypes, totalIds }
  } catch {
    return null
  }
}

const args = process.argv.slice(2).filter((a) => !a.startsWith("-"))
const selected = args.length
  ? LANGUAGES.filter((l) => args.includes(l.lang))
  : LANGUAGES

if (args.length) {
  const unknown = args.filter((a) => !LANGUAGES.some((l) => l.lang === a))
  if (unknown.length) {
    console.error(`unknown language(s): ${unknown.join(", ")}`)
    console.error(`known: ${LANGUAGES.map((l) => l.lang).join(", ")}`)
    process.exit(2)
  }
}

console.log("grammar binding probe — the bytes the REGISTRY serves, and the file they came from")
console.log(`  L-20: cite a grammar by the sha256 of the BYTES THE REGISTRY SERVES, never by a path,`)
console.log(`  never by the engine's "language parser loaded" log line — that log prints a SPELLING,`)
console.log(`  and the file the bytes came from is not always the file the log names.`)
console.log()

interface Row {
  lang: string
  spelling: string
  file: string
  resolvedPath: string
  pathExists: boolean
  registrySha: string | null
  fileSha: string | null
  agree: boolean | null
  namedTypes: number | null
  totalIds: number | null
  npmSha: string | null
  note: string
}

const rows: Row[] = []

for (const { lang, wasm, engine, pkg } of selected) {
  // THE SPELLING THE ENGINE USES is what the resolver and the registry are asked for; the FILE is
  // what the bytes are read from. They are reported side by side because a citation needs both.
  const spelling = engine ?? wasm
  const resolvedPath = resolveWasmAsset(spelling)
  const pathExists = resolvedSync(resolvedPath)
  let registrySha: string | null = null
  let fileSha: string | null = null
  let note = ""

  try {
    const bytes = hasWasmInRegistry(spelling)
    if (bytes && bytes.length) registrySha = sha256(bytes)
    else note = "the registry served NO BYTES for this spelling"
  } catch (e) {
    note = `the registry threw: ${String(e).slice(0, 80)}`
  }

  if (pathExists) {
    try {
      fileSha = sha256(readFileSync(resolvedPath))
    } catch (e) {
      note = note || `the file could not be read: ${String(e).slice(0, 60)}`
    }
  } else {
    note = note || "resolveWasmAsset returned a path that does not exist"
  }

  const agree = registrySha && fileSha ? registrySha === fileSha : null

  // THE INVENTORY, from the live language of the SAME wasm the digest is of.
  let namedTypes: number | null = null
  let totalIds: number | null = null
  const inv = await inventoryOf(lang)
  if (inv) {
    namedTypes = inv.namedTypes
    totalIds = inv.totalIds
  }

  // THE NPM BUILD, when the package is installed in this tree.
  let npmSha: string | null = null
  const npmWasm = path.join(ROOT, "node_modules", pkg ?? "", "tree-sitter-*.wasm")
  const nmDir = path.join(ROOT, "node_modules", pkg ?? "")
  if (existsSync(nmDir)) {
    try {
      for (const f of readdirSync(nmDir)) {
        if (f.endsWith(".wasm")) {
          npmSha = sha256(readFileSync(path.join(nmDir, f)))
          break
        }
      }
    } catch {
      /* unreadable package dir is an unknown */
    }
  }
  void npmWasm

  rows.push({ lang, spelling, file: wasm, resolvedPath, pathExists, registrySha, fileSha, agree, namedTypes, totalIds, npmSha, note })
}

function resolvedSync(p: string): boolean {
  try {
    return existsSync(p)
  } catch {
    return false
  }
}

const short = (s: string | null) => (s ? s.slice(0, 12) : "—")
const width = Math.max(...rows.map((r) => r.lang.length), 8)

console.log(
  "lane".padEnd(width) + "  registry sha   file sha       agree   named/total   npm sha        path",
)
console.log("-".repeat(width + 74))
for (const r of rows) {
  const agreeMark = r.agree === null ? "n/a" : r.agree ? "YES" : "*** NO ***"
  const inv = r.namedTypes === null ? "—" : `${r.namedTypes}/${r.totalIds}`
  console.log(
    r.lang.padEnd(width) +
      "  " +
      short(r.registrySha).padEnd(14) +
      "  " +
      short(r.fileSha).padEnd(13) +
      "  " +
      agreeMark.padEnd(7) +
      "  " +
      inv.padEnd(12) +
      "  " +
      short(r.npmSha).padEnd(13) +
      "  " +
      (r.pathExists ? path.relative(ROOT, r.resolvedPath) : "(no file)"),
  )
  if (r.note) console.log(" ".repeat(width + 2) + "note: " + r.note)
}

const spellings = rows.filter((r) => r.spelling !== r.file)
if (spellings.length) {
  console.log()
  console.log("THE SPELLING THE ENGINE ASKS FOR, BESIDE THE FILE THE BYTES ARE IN (they differ for these):")
  for (const r of spellings) {
    console.log(`  ${r.lang.padEnd(width)}  spelling: ${r.spelling}`)
    console.log(`  ${" ".repeat(width)}  file:     ${path.relative(ROOT, r.resolvedPath)}`)
  }
}

console.log()
const disagreements = rows.filter((r) => r.agree === false)
const missing = rows.filter((r) => r.agree === null)
const served = rows.filter((r) => r.registrySha !== null)

console.log(`${served.length} of ${rows.length} languages served bytes from the registry.`)
console.log(`  path and bytes AGREE for ${served.length - disagreements.length} of them.`)
console.log(`  ${disagreements.length} DISAGREE — a citation built on either digest would be FALSE: ${disagreements.map((r) => r.lang).join(", ") || "(none)"}`)
console.log(`  ${missing.length} served no comparable bytes: ${missing.map((r) => r.lang).join(", ") || "(none)"}`)

// THE CANDIDATE LIST, printed for the languages whose path and bytes disagree, because the whole
// point of the disagreement is usually that a DIFFERENT candidate was taken. The candidate order is
// `bbWasmCandidates` (src/util/bb-data-dir.ts:28): the repo's own wasm/ directory is FIRST, so the
// path and the bytes normally agree — and when they do not, the list says which candidate won.
if (disagreements.length) {
  console.log()
  console.log("THE CANDIDATE LISTS FOR THE DISAGREEING LANGUAGES (bbWasmCandidates, src/util/bb-data-dir.ts:28):")
  const modDir = path.join(ROOT, "src", "util")
  for (const r of disagreements) {
    console.log(`  ${r.lang}:`)
    for (const c of bbWasmCandidates(modDir, r.spelling)) {
      let cSha = "—"
      try {
        if (existsSync(c)) cSha = short(sha256(readFileSync(c)))
      } catch {}
      console.log(`    ${cSha}  ${c}`)
    }
  }
}

if (disagreements.length) {
  console.log()
  console.log("FAIL: at least one language's PATH and BYTES disagree. The citation for that language is")
  console.log("      not trustworthy until this is explained and fixed.")
  process.exit(5)
}
console.log()
console.log("PASS: every language that served bytes has path and bytes in agreement.")
process.exit(0)
