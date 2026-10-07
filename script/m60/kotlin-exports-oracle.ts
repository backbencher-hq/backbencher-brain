/**
 * KOTLIN EXPORTS ORACLE — the independent second opinion for the `exports`
 * relationship type on the kotlin lane.
 *
 * ## Why this file exists
 *
 * `script/m60/rel-type-coverage-gate.ts` CHECK 1 (DERIVATION) reported, the day
 * this lane added its `Exports` edge:
 *
 *     DERIVATION|kotlin|emits `exports` but the differential audits
 *     [calls contains extends implements instantiates overrides references uses]
 *     — the type is stored and compared against nothing
 *
 * That is the definition of the finding: an emitted type with no oracle is an
 * edge that ships a bug invisibly, because nothing ever asks whether it is right.
 * The gate is shared machinery (`script/m60/**`, the master agent's), so the
 * fix a lane can make for itself is to produce the missing second opinion and
 * measure the disagreement — not to edit the allowlist that excludes the label.
 * Editing the allowlist to admit a label with no truth derivation would make the
 * comparison read 0 truth edges, which `differential.ts:23679` correctly treats
 * as a fabricated pass and throws on.
 *
 * ## WHAT INDEPENDENCE THIS ORACLE HAS, AND WHAT IT DOES NOT
 *
 * It walks the SAME tree-sitter-kotlin grammar as the analyzer. So a grammar
 * bug shared by both is invisible to both, and this file cannot detect a node
 * type the pinned wasm never produces. That limitation is shared with every
 * oracle in `script/m14/differential.ts` and is the harness's declared one.
 *
 * What this oracle DOES establish, because it is written from the language's
 * rules and not from the analyzer's code:
 *
 *   1. It derives the published set from the AST alone. It never reads
 *      `symbols[]`, never reads `visibility`, and never reads the analyzer's
 *      `exports[]` array. So agreement is evidence about the RULE, not an echo.
 *   2. It re-derives the primary top-level type itself, from declaration order
 *      and node type, rather than trusting the analyzer's `primaryType` pick.
 *      If the analyzer picked a different file-identity, the `from` half of
 *      every edge disagrees and the differential says so.
 *   3. It reads visibility from the `visibility_modifier` WRAPPER's text, the
 *      indirection documented in `script/m60/kotlin-ontology-census.ts`'s
 *      `modifierInfo`. An earlier probe read the wrapper's TYPE instead and
 *      reported every declaration default-public — a false zero, which on a
 *      ruling is a verdict.
 *
 * ## THE RULE BEING DERIVED — Kotlin's own, not a keyword search
 *
 * Kotlin has no `export` statement. Measured: across a 600-file corpus walk the
 * grammar produced 233 distinct node types and none of `export_declaration`,
 * `export_list` or `export_statement` among them
 * (`validation/m14/results/kotlin-ontology-census.txt`, PROBE A).
 *
 * What Kotlin does define is that a top-level declaration is `public` unless it
 * says otherwise, and `internal` restricts it to the module while `private`
 * restricts it to the file. So the compilation unit's published surface is:
 *
 *     { top-level declaration whose visibility is `public` or absent }
 *
 * and nothing else. A member of a class is reachable through its owner, not
 * published separately; a `private` or `internal` top-level declaration is not
 * part of the consumer surface.
 *
 * ## Usage
 *
 *     bun script/m60/kotlin-exports-oracle.ts <file.kt> [...]
 *     KOT_ORACLE_N=200 bun script/m60/kotlin-exports-oracle.ts   # corpus draw
 */
import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from "node:fs"
import { join, relative } from "node:path"
import * as path from "node:path"

const ROOT = path.resolve((import.meta as any).dirname ?? path.dirname(process.argv[1] ?? "."), "..", "..")
const CORPUS = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const KOTLIN_DIR = process.env.BB_KOTLIN_DIR ?? join(CORPUS, "kotlin")
const N = Number(process.env.KOT_ORACLE_N ?? 0)

// NO REGEX ANYWHERE IN THIS FILE. Every read is node.type / named-child
// inspection or a `.text` read off a node the grammar produced.

/** Strip Kotlin's backtick quoting: `fun \`test\`() ` names `test`. */
function unquote(s: string): string {
  if (!s.includes("`")) return s
  let out = ""
  let i = 0
  while (i < s.length) {
    if (s.charCodeAt(i) === 96) {
      const close = s.indexOf("`", i + 1)
      if (close === -1) { out += s.slice(i); break }
      out += s.slice(i + 1, close)
      i = close + 1
    } else { out += s[i]; i++ }
  }
  return out
}

function firstNamed(n: any, types: string[]): any {
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c && types.includes(c.type)) return c
  }
  return null
}

/** The declaration's own name, per node type. `property_declaration` nests it. */
function declaredName(decl: any): string {
  if (!decl) return ""
  if (decl.type === "property_declaration") {
    const vd = firstNamed(decl, ["variable_declaration"])
    const id = vd ? firstNamed(vd, ["simple_identifier"]) : null
    return id ? unquote(id.text) : ""
  }
  const id = firstNamed(decl, ["simple_identifier", "type_identifier"])
  return id ? unquote(id.text) : ""
}

/**
 * The declaration's visibility, read from the `visibility_modifier` WRAPPER's
 * text, or "" when it says nothing — which in Kotlin means `public`.
 */
function visibilityOf(decl: any): string {
  const mods = firstNamed(decl, ["modifiers"])
  if (!mods) return ""
  for (let i = 0; i < mods.namedChildCount; i++) {
    const m = mods.namedChild(i)
    if (m && m.type === "visibility_modifier") return m.text.trim()
  }
  return ""
}

const TOP_LEVEL_TYPES = new Set([
  "class_declaration", "object_declaration",
  "function_declaration", "property_declaration",
])

export type TruthEdge = { label: "exports"; from: string; target: string }

export function deriveKotlinExportsTruth(root: any): TruthEdge[] {
  // 1. TOP-LEVEL declarations only. A declaration nested in a class body, a
  //    function body or an init block is a MEMBER and is reached through its
  //    owner, so it is not separately published. Read from the tree: walk up
  //    from the declaration and stop at `source_file`.
  const topLevel: any[] = []
  const collect = (n: any): void => {
    if (TOP_LEVEL_TYPES.has(n.type)) {
      let p = n.parent
      let isTop = true
      while (p) {
        if (p.type === "source_file") break
        // Anything that introduces a scope makes this a member.
        if (p.type === "class_body" || p.type === "function_body" ||
            p.type === "enum_class_body" || p.type === "anonymous_initializer" ||
            p.type === "secondary_constructor") { isTop = false; break }
        p = p.parent
      }
      if (isTop) topLevel.push(n)
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) collect(c)
    }
  }
  collect(root)

  // 2. PUBLICATION. `public` or unsaid is published; `internal` and `private`
  //    are withheld. Anything else a visibility_modifier can carry is also
  //    withheld rather than assumed published — an unknown keyword is not
  //    evidence of publication.
  const published: { name: string; kind: string }[] = []
  for (const decl of topLevel) {
    const v = visibilityOf(decl)
    if (v === "public" || v === "") {
      const nm = declaredName(decl)
      if (nm) published.push({ name: nm, kind: decl.type })
    }
  }

  // 3. The compilation unit's IDENTITY, re-derived here rather than read from
  //    the analyzer: the first top-level TYPE declaration in source order. This
  //    is the analyzer's own rule (primaryType at real-kotlin-analyzer.ts:566)
  //    restated from the language side, so if the analyzer picks differently the
  //    `from` half of every edge disagrees and the differential catches it.
  let identity = ""
  for (const decl of topLevel) {
    if (decl.type === "class_declaration" || decl.type === "object_declaration") {
      identity = declaredName(decl)
      if (identity) break
    }
  }
  // A file with no top-level type has no module symbol. The analyzer publishes
  // NO relationship for such a file and records the withheld count in
  // `metadata.exportsWithheldNoModuleIdentity`; this oracle mirrors that by
  // emitting no edge whose `from` is empty, and the runner below counts the
  // withheld population from that metadata field rather than guessing it.
  //
  // It is NOT a disagreement that this file published nothing: the file's
  // surface is carried by the ExportInfo array, which
  // `import-resolution.ts:314` gates symbol joins on. The relationship channel
  // has no module symbol to speak for it.
  const out: TruthEdge[] = []
  const seen = new Set<string>()
  for (const p of published) {
    if (!identity) continue
    const k = `exports|${identity}|${p.name}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push({ label: "exports", from: identity, target: p.name })
  }
  return out
}

// ---------------------------------------------------------------------------
// RUNNER — compare the oracle against production parseFile, and report BOTH
// directions, because one direction alone cannot tell a clean lane from a dead
// one.
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const wts: any = await import("web-tree-sitter")
  const WSP = wts.Parser ?? wts.default
  const WSL = wts.Language ?? wts.default?.Language
  await WSP.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const parser = new WSP()
  parser.setLanguage(await WSL.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-kotlin.wasm"))))
  const { parseFile } = await import("../../src/ast/pool-worker")

  // POPULATION IS DERIVED, never hand-listed.
  const files: string[] = []
  const want = N > 0 ? N : Number(process.argv[2] ?? 0)
  const SKIP = new Set([".git", "node_modules"])
  const walk = (d: string): void => {
    if (want > 0 && files.length >= want) return
    let ents: import("node:fs").Dirent[]
    try { ents = readdirSync(d, { withFileTypes: true }) } catch { return }
    ents.sort((a, b) => (a.name < b.name ? -1 : 1))
    for (const e of ents) {
      if (want > 0 && files.length >= want) return
      const p = join(d, e.name)
      if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(p); continue }
      if (!e.name.endsWith(".kt") && !e.name.endsWith(".kts")) continue
      try { if (statSync(p).size > 400_000) continue } catch { continue }
      files.push(p)
    }
  }
  walk(KOTLIN_DIR)

  let filesWithEither = 0
  let matched = 0, oracleOnly = 0, analyzerOnly = 0, withheldTotal = 0
  let truthTotal = 0, analyzerTotal = 0
  const examples: string[] = []

  for (const f of files) {
    let text = ""
    try { text = readFileSync(f, "utf8") } catch { continue }
    let truth: TruthEdge[] = []
    try {
      const t = parser.parse(text)
      if (t) { truth = deriveKotlinExportsTruth(t.rootNode); t.delete?.() }
    } catch { continue }

    let emitted: any[] = []
    let withheldByIdentity = 0
    try {
      const r: any = await parseFile(f, KOTLIN_DIR)
      emitted = (r.relationships ?? []).filter((x: any) => String(x.type) === "exports")
      withheldByIdentity = Number(r.metadata?.exportsWithheldNoModuleIdentity ?? 0)
    } catch { continue }

    truthTotal += truth.length
    analyzerTotal += emitted.length
    withheldTotal += withheldByIdentity
    if (!truth.length && !emitted.length) continue
    filesWithEither++

    // Both sides now agree that a file with no top-level type publishes no
    // relationship, so there is no unmatchable population left to excuse. The
    // count is still printed: "the oracle had N published names and no module
    // identity" is a fact about the corpus, and hiding it would let a future
    // regression hide in the same place.
    const truthFrom = truth.length ? truth[0].from : ""
    if (!truthFrom && emitted.length > 0) {
      examples.push(`IDENTITY MISMATCH ${f.replace(KOTLIN_DIR + "/", "")}: analyzer emitted ${emitted.length} edges with no module identity`)
      analyzerOnly += emitted.length
    }

    const emittedKeys = new Set(emitted.map((e: any) => `${e.source}|${e.target}`))
    const truthKeys = new Set(truth.map((e: any) => `${e.from}|${e.target}`))
    let m = 0, o = 0, a = 0
    for (const k of truthKeys) {
      if (emittedKeys.has(k)) m++
      else { o++; if (examples.length < 8) examples.push(`ORACLE-ONLY ${f.replace(KOTLIN_DIR + "/", "")}: ${k}`) }
    }
    for (const k of emittedKeys) { if (!truthKeys.has(k)) { a++; if (examples.length < 8) examples.push(`ANALYZER-ONLY ${f.replace(KOTLIN_DIR + "/", "")}: ${k}`) } }
    matched += m; oracleOnly += o; analyzerOnly += a
  }

  const out: string[] = []
  const P = (s = "") => { out.push(s); console.log(s) }
  P(`kotlin exports oracle vs production parseFile`)
  P(`POPULATION: ${files.length} files (derived by directory walk${want > 0 ? `, capped at ${want}` : ""})`)
  P(`files with an exports edge on either side: ${filesWithEither}`)
  P(`oracle truth edges   : ${truthTotal}`)
  P(`analyzer edges       : ${analyzerTotal}`)
  P(`matched (both)      : ${matched}`)
  P(`ORACLE-ONLY (miss)  : ${oracleOnly}`)
  P(`ANALYZER-ONLY (extra): ${analyzerOnly}`)
  P(`withheld by analyzer (file declares no top-level type, so no module identity): ${withheldTotal}`)
  const comparable = matched + oracleOnly + analyzerOnly
  P(`agreement on comparable edges: ${comparable === 0 ? "n/a (0 comparable)" : `${((matched / comparable) * 100).toFixed(1)}%`}`)
  P(`truth coverage (matched / oracle truth): ${truthTotal === 0 ? "n/a" : `${((matched / truthTotal) * 100).toFixed(1)}%`}`)
  if (examples.length) { P(`examples:`); for (const e of examples) P(`  ${e}`) }
  P("")
  P(`INDEPENDENCE: same grammar as the analyzer, so a shared grammar bug is invisible to both.`)
  P(`What this CAN falsify: a count, a label, an endpoint identity, a publication rule.`)
  P(`What it CANNOT: a node type the pinned wasm never produces.`)

  mkdirSync(path.join(ROOT, "validation", "m14", "results"), { recursive: true })
  writeFileSync(path.join(ROOT, "validation", "m14", "results", "kotlin-exports-oracle.txt"), out.join("\n") + "\n")
  P(`written: validation/m14/results/kotlin-exports-oracle.txt`)
  process.exitCode = oracleOnly + analyzerOnly === 0 ? 0 : 1
}

if (process.argv[1] && process.argv[1].includes("kotlin-exports-oracle")) {
  await main()
}
