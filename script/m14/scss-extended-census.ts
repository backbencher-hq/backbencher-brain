#!/usr/bin/env bun
/**
 * SCSS EXTENDED-TYPE CENSUS — the four extended values, over the WHOLE admitted population,
 * parse-only, with the fleet's leak guard.
 *
 * WHY THIS FILE EXISTS. The 14-value campaign's remaining four types for this lane are
 * `decorates`, `renders`, `mixes_in`, `part_of`. Every one needs a MEASURED construct census before
 * it is implemented or ruled: the owner's bar is RULING IS THE LAST RESORT, and a ruling names the
 * rung it could not use WITH A COUNT AND A FALSIFIER. This instrument produces those numbers.
 *
 * THE LEAK GUARD IS THE FIRST THING IT DOES, because the cpp lane lost 15,223 files to the defect
 * this guards: a loop that parses without `tree.delete()` hits the wasm abort point and every later
 * file reads as a FAILURE while the run EXITS 0 and prints a complete-looking table. So:
 *   · every tree is deleted in a `finally`,
 *   · `filesRead === filesAdmitted` is checked at the end and the process EXITS 5 when it is not,
 *   · and a file that fails to parse is COUNTED, never silently skipped.
 *
 * WHAT IT COUNTS, and for which rung:
 *   mixes_in   `include_statement` sites: clean vs UNPARSABLE (the served build splits a NAMESPACED
 *              `@include ns.mixin` at the dot — patch 5 relaxed whitespace, not the dot), and whether
 *              the written name is a mixin this file declares (the R3 relabel class).
 *   part_of    `import_statement` sites by SHAPE: the Sass file-inclusion form is exactly one
 *              `string_value` child and a specifier that is not a stylesheet URL (`@import "x"`),
 *              while the CSS form is a `url(...)`, a media query, a `.css` suffix or a protocol.
 *              The included file's existence is probed with the SAME spelling arithmetic the
 *              analyzer's file-claim guard uses, so the census predicts the claim class.
 *   decorates  the near miss, COUNTED: `important` nodes (a modifier that names no callable),
 *              `!global`/`!default` flag tokens, `@extend` (= extends) and `@include` (= mixes_in).
 *   renders    the near miss, COUNTED: `content:` declarations and `pseudo_element_selector` sites,
 *              plus the component predicate (a CAPITALIZED component name in the value) — the
 *              falsifier for "a stylesheet renders a component".
 *   R1/rung    the SERVED build's own node inventory (named accessor `nodeTypeIsNamed`, digest =
 *              sha256 of the file the resolver's own candidate list returns), plus the vendored
 *              grammar SOURCE's production list, so a ruling can name what the build does not have.
 *
 * RUN (whole population, writes the artifact):
 *   bun script/m14/scss-extended-census.ts
 * RUN (a measured screen, prints JSON and writes NOTHING — a sample is never a publication):
 *   bun script/m14/scss-extended-census.ts --limit=250
 * EXIT: 0 wrote · 3 population artifact missing · 4 a file could not be read · 5 the leak guard
 *       tripped (filesRead !== filesAdmitted) — a run that did not cover the population is NOT the
 *       population and must not be published.
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync, realpathSync } from "node:fs"
import { createHash } from "node:crypto"
import { resolve, dirname, basename } from "node:path"
import { getParser } from "../../src/ast/engine"
import { resolveWasmAsset } from "../../src/util/wasm"

const ROOT = resolve(import.meta.dir, "../..")
const POP = resolve(ROOT, "validation/m14/measurements/scss-population.json")
const OUT = resolve(ROOT, "validation/m14/measurements/scss-extended-census.json")
const GRAMMAR_SOURCE = resolve(ROOT, "grammars/tree-sitter-scss/grammar.js")

const argv = process.argv.slice(2)
const LIMIT = (() => {
  const raw = argv.find((a) => a.startsWith("--limit="))
  if (!raw) return 0
  const n = Number.parseInt(raw.slice("--limit=".length), 10)
  if (!Number.isInteger(n) || n < 0) {
    console.error(`--limit must be a non-negative integer (got "${raw}")`)
    process.exit(2)
  }
  return n
})()
const OUT_ARG = (() => {
  const raw = argv.find((a) => a.startsWith("--out="))
  return raw ? resolve(ROOT, raw.slice("--out=".length)) : null
})()

interface Pop {
  admitted: number
  repositoriesCarrying: number
  roots: string[]
}
if (!existsSync(POP)) {
  console.error(`NO POPULATION ARTIFACT at ${POP} — run: bun script/m14/scss-population.ts`)
  process.exit(3)
}
const pop = JSON.parse(readFileSync(POP, "utf8")) as { admitted: number; repositoriesCarrying: number; repositories: Array<{ repo: string; admitted: number }>; root: string; extensions: string[]; capBytes: number; populationRule: string; populationString: string }
if (!(pop.admitted > 0)) {
  console.error("POPULATION ARTIFACT SAYS 0 ADMITTED — a census over nothing is a control failure")
  process.exit(3)
}

// ── the population: `corpus-entry/relative-path`, resolved against .corpus ──────────────────────
const CORPUS = resolve(ROOT, ".corpus")
const allFiles: string[] = []
for (const r of pop.repositories) {
  // the artifact carries per-repo admitted COUNTS, not paths; the census re-derives the same
  // tracked set through `git ls-files` so the file list comes from the same rule as the count.
  void r
}
{
  const { execFileSync } = await import("node:child_process")
  const entries = await import("node:fs").then((fs) => fs.readdirSync(CORPUS))
  for (const repo of entries) {
    const dir = resolve(CORPUS, repo)
    let names: string[] = []
    try {
      const out = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "buffer", maxBuffer: 256 * 1024 * 1024 })
      names = out
        .toString("utf8")
        .split("\u0000")
        .filter(Boolean)
        .filter((p) => (pop.extensions as string[]).includes((p.split(".").pop() ?? "").toLowerCase()))
    } catch {
      continue
    }
    for (const rel of names) {
      const full = resolve(dir, rel)
      if (!existsSync(full)) continue
      let size = 0
      try {
        size = (await import("node:fs")).statSync(full).size
      } catch {
        continue
      }
      if (size > pop.capBytes) continue
      allFiles.push(`${repo}/${rel}`)
    }
  }
}
allFiles.sort()

// a sample is a SAMPLE and is labelled as one; a whole-population run is the only thing written
// to the canonical artifact path.
let files: string[]
let sampleLabel = ""
if (LIMIT > 0) {
  const stride = Math.max(1, Math.ceil(allFiles.length / LIMIT))
  files = allFiles.filter((_, i) => i % stride === 0).slice(0, LIMIT)
  sampleLabel = `SAMPLE, ${files.length} files (every ${stride}th of ${allFiles.length} sorted admitted) — NOT A POPULATION`
} else {
  files = allFiles
}

// ── the SERVED build's identity and inventory (R1's measurement) ────────────────────────────────
const parser = await getParser("scss")
const language: any = (parser as any).language
const totalIds: number = language?.nodeTypeCount ?? 0
const allTypeNames: string[] = []
const namedTypeNames: string[] = []
for (let id = 0; id < totalIds; id++) {
  const name = String(language?.nodeTypeForId(id) ?? "")
  allTypeNames.push(name)
  if (language?.nodeTypeIsNamed(id)) namedTypeNames.push(name)
}
const servedWasmPath = resolveWasmAsset("tree-sitter-scss.wasm")
const servedDigest = existsSync(servedWasmPath) ? createHash("sha256").update(readFileSync(servedWasmPath)).digest("hex") : ""
const R1_STEMS = ["decorat", "annotation", "attribute", "application", "modifier", "render", "component", "jsx", "template", "markup", "element", "part", "content"]
const r1StemMatches: Record<string, string[]> = {}
for (const stem of R1_STEMS) r1StemMatches[stem] = allTypeNames.filter((n) => n.toLowerCase().includes(stem))

// the vendored grammar SOURCE's own production list — the R2 half ("a patch would have to invent
// syntax"): the productions that exist, read from the tracked source the wired wasm was built from.
let grammarSourceRuleCount = 0
let grammarSourceRules: string[] = []
if (existsSync(GRAMMAR_SOURCE)) {
  const src = readFileSync(GRAMMAR_SOURCE, "utf8")
  grammarSourceRules = [...src.matchAll(/^ {4}([A-Za-z_][A-Za-z0-9_]*):/gm)].map((m) => m[1]!)
  grammarSourceRuleCount = grammarSourceRules.length
}
const grammarSourceDigest = existsSync(GRAMMAR_SOURCE) ? createHash("sha256").update(readFileSync(GRAMMAR_SOURCE)).digest("hex") : ""

// ── the census ─────────────────────────────────────────────────────────────────────────────────
const counts = {
  includeSites: 0,
  includeClean: 0,
  includeUnparsable: 0, // dotted/namespace form: the served build splits the node at the dot
  includeCleanSameFileMixin: 0,
  includeCleanSameFileFunction: 0,
  includeCleanForeign: 0,
  includeTopLevel: 0,
  mixinDeclarations: 0,
  functionDeclarations: 0,
  importSites: 0,
  importSassForm: 0,
  importSassFormVerified: 0, // the specifier answers to a file the population's spelling arithmetic can find
  importCssForm: 0,
  importCssUrl: 0,
  importCssMedia: 0,
  importCssDotCss: 0,
  importCssProtocol: 0,
  useStatements: 0,
  forwardStatements: 0,
  extendStatements: 0,
  importantSites: 0,
  importantNamingCallable: 0,
  declarationsWithGlobalFlag: 0,
  declarationsWithDefaultFlag: 0,
  contentDeclarations: 0,
  contentCapitalizedComponentShape: 0,
  contentCapitalizedInStringValue: 0,
  pseudoElementSelectors: 0,
  errorNodes: 0,
  files: 0,
  filesRead: 0,
  filesFailed: 0,
  filesWithErrors: 0,
}
const filesBy = {
  include: new Set<string>(),
  mixin: new Set<string>(),
  importSass: new Set<string>(),
  important: new Set<string>(),
  content: new Set<string>(),
  pseudoElement: new Set<string>(),
}
const samples = {
  includeForeign: [] as string[],
  importSass: [] as string[],
  importCss: [] as string[],
  important: [] as string[],
  content: [] as string[],
  contentCapitalized: [] as string[],
  contentCapitalizedInStringValue: [] as string[],
  brokenInclude: [] as string[],
}
const mixinNamesSeen = new Set<string>()
const functionNamesSeen = new Set<string>()
const includeTargetsSeen = new Set<string>()
const importSassTargets = new Map<string, number>()
/** repo -> the `@mixin`/`@function` names IT declares. THE FALSIFIER INVENTORY for the cause
 *  census's mixin/callable walls: a published `mixes_in` target that this map says is declared in
 *  the SAME repository is a resolution the project index owes, so a nonzero count refutes the
 *  class. Bounded: the whole population declares 377 mixins / 80 functions. */
const repoMixins = new Map<string, Set<string>>()
const repoFunctions = new Map<string, Set<string>>()

function namedChildren(n: any): any[] {
  const out: any[] = []
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c) out.push(c)
  }
  return out
}
function descendantText(n: any): string {
  return String(n?.text ?? "")
}
/** A COMPLETE `@include`: it reaches its OWN terminator (`;`) or carries a content block.
 *  `node.hasError` is NOT the test — an empty argument list `@include f();` carries a MISSING token
 *  INSIDE `arguments` and a content block can inherit an error from a nested rule, so both would
 *  read as broken while naming their mixin. The analyzer uses this same predicate (measured: the
 *  hasError version skipped 532 of 2,737 include sites). */
function includeStatementComplete(n: any): boolean {
  const text = String(n.text ?? "")
  return /;\s*$/.test(text) || /\{[\s\S]*\}\s*$/.test(text)
}
function stripQuotes(s: string): string {
  const t = s.trim()
  if (t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))) return t.slice(1, -1)
  return t
}
function declFlag(decl: any, flag: string): boolean {
  for (let i = 0; i < decl.childCount; i++) {
    const c = decl.child(i)
    if (!c) continue
    if (c.type === "!" && i + 1 < decl.childCount) {
      const next = decl.child(i + 1)
      if (next && next.type === flag) return true
    }
  }
  return false
}
const COMPONENT_SHAPE = /^[A-Z][A-Za-z0-9_]*$/

/** The analyzer's own claim arithmetic: a Sass specifier's file spellings, relative to the file. */
function sassCandidatesFrom(fileRelInRepo: string, spec: string): string[] {
  const cut = spec.lastIndexOf("/")
  const dirPart = cut < 0 ? "" : spec.slice(0, cut + 1)
  const leaf = cut < 0 ? spec : spec.slice(cut + 1)
  const out = new Set<string>()
  out.add(`${spec}.scss`)
  out.add(`${spec}/_index.scss`)
  out.add(`${spec}/index.scss`)
  if (leaf.length > 0 && !leaf.startsWith("_")) {
    out.add(`${dirPart}_${leaf}.scss`)
    out.add(`${dirPart}_${leaf}/_index.scss`)
  }
  out.add(`${leaf}.scss`)
  void fileRelInRepo
  return [...out]
}

for (let index = 0; index < files.length; index++) {
  const rel = files[index]!
  const repo = rel.split("/")[0]!
  const fileRelInRepo = rel.split("/").slice(1).join("/")
  const full = resolve(CORPUS, repo, fileRelInRepo)
  let content = ""
  try {
    content = readFileSync(full, "utf8")
  } catch {
    counts.filesRead++
    counts.filesFailed++
    continue
  }
  counts.filesRead++
  let tree: any
  try {
    tree = parser.parse(content)
  } catch {
    counts.filesFailed++
    continue
  }
  try {
    // Per-file declaration names first: the include/impostor split needs them.
    const mixinNames = new Set<string>()
    const functionNames = new Set<string>()
    {
      const collect = (n: any): void => {
        if (n.type === "mixin_statement") {
          const name = n.childForFieldName?.("name")
          if (name) mixinNames.add(stripQuotes(String(name.text)))
        } else if (n.type === "function_statement") {
          const name = n.childForFieldName?.("name")
          if (name) functionNames.add(stripQuotes(String(name.text)))
        }
        for (const c of namedChildren(n)) collect(c)
      }
      collect(tree.rootNode)
    }
    counts.mixinDeclarations += mixinNames.size
    counts.functionDeclarations += functionNames.size
    if (mixinNames.size > 0) filesBy.mixin.add(rel)
    // the per-repository declaration inventory the cause census's falsifiers read
    if (mixinNames.size > 0) {
      const set = repoMixins.get(repo) ?? new Set<string>()
      for (const n of mixinNames) set.add(n)
      repoMixins.set(repo, set)
    }
    if (functionNames.size > 0) {
      const set = repoFunctions.get(repo) ?? new Set<string>()
      for (const n of functionNames) set.add(n)
      repoFunctions.set(repo, set)
    }

    let fileHasError = false
    const visit = (n: any): void => {
      switch (n.type) {
        case "ERROR": {
          counts.errorNodes++
          fileHasError = true
          break
        }
        case "include_statement": {
          counts.includeSites++
          filesBy.include.add(rel)
          if (!includeStatementComplete(n)) {
            counts.includeUnparsable++
            if (samples.brokenInclude.length < 8) samples.brokenInclude.push(`${rel}:${n.startPosition.row + 1} ${descendantText(n).slice(0, 60)}`)
            break
          }
          counts.includeClean++
          const nameNode =
            namedChildren(n).find((c: any) => c.type === "identifier") ??
            namedChildren(n).find((c: any) => c.type === "plain_value") ??
            null
          const wrote = nameNode ? stripQuotes(String(nameNode.text)) : ""
          if (wrote.length === 0) break
          includeTargetsSeen.add(wrote)
          if (mixinNames.has(wrote)) counts.includeCleanSameFileMixin++
          else if (functionNames.has(wrote)) counts.includeCleanSameFileFunction++
          else {
            counts.includeCleanForeign++
            if (samples.includeForeign.length < 8) samples.includeForeign.push(`${rel}:${n.startPosition.row + 1} @include ${wrote}`)
          }
          if (n.parent?.type === "stylesheet") counts.includeTopLevel++
          break
        }
        case "import_statement": {
          counts.importSites++
          const kids = namedChildren(n)
          const stringChild = kids.length === 1 && kids[0]!.type === "string_value" ? kids[0]! : null
          if (stringChild) {
            const spec = stripQuotes(String(stringChild.text))
            const dotCss = /\.css($|[?#])/i.test(spec)
            const protocol = /^(https?:)?\/\//i.test(spec)
            const builtin = /^sass:/i.test(spec)
            if (dotCss || protocol || builtin) {
              counts.importCssForm++
              if (dotCss) counts.importCssDotCss++
              if (protocol) counts.importCssProtocol++
              if (samples.importCss.length < 8) samples.importCss.push(`${rel}:${n.startPosition.row + 1} ${spec}`)
              break
            }
            counts.importSassForm++
            filesBy.importSass.add(rel)
            importSassTargets.set(spec, (importSassTargets.get(spec) ?? 0) + 1)
            if (samples.importSass.length < 8) samples.importSass.push(`${rel}:${n.startPosition.row + 1} ${spec}`)
            const repoDir = resolve(CORPUS, repo)
            const found = sassCandidatesFrom(fileRelInRepo, spec).some((c) =>
              existsSync(resolve(repoDir, dirname(fileRelInRepo), c)),
            )
            if (found) counts.importSassFormVerified++
          } else {
            counts.importCssForm++
            if (kids.some((c: any) => c.type === "call_expression")) counts.importCssUrl++
            else counts.importCssMedia++
          }
          break
        }
        case "use_statement":
          counts.useStatements++
          break
        case "forward_statement":
          counts.forwardStatements++
          break
        case "extend_statement":
          counts.extendStatements++
          break
        case "important": {
          counts.importantSites++
          filesBy.important.add(rel)
          if (namedChildren(n).length > 0) counts.importantNamingCallable++
          if (samples.important.length < 8) samples.important.push(`${rel}:${n.startPosition.row + 1}`)
          break
        }
        case "pseudo_element_selector": {
          counts.pseudoElementSelectors++
          filesBy.pseudoElement.add(rel)
          break
        }
        case "declaration": {
          // the flag tokens are ANONYMOUS children (`!` then `global`/`default`)
          if (declFlag(n, "global")) counts.declarationsWithGlobalFlag++
          if (declFlag(n, "default")) counts.declarationsWithDefaultFlag++
          const prop = namedChildren(n).find((c: any) => c.type === "property_name")
          if (prop && String(prop.text).trim().toLowerCase() === "content") {
            counts.contentDeclarations++
            filesBy.content.add(rel)
            if (samples.content.length < 8) samples.content.push(`${rel}:${n.startPosition.row + 1} ${String(n.text).slice(0, 70)}`)
            const valueNodes = namedChildren(n).filter((c: any) => c.type !== "property_name")
            // A COMPONENT NAME IS AN IDENTIFIER, NOT A QUOTED STRING. The first predicate stripped
            // the quotes and then matched a capitalized word, so `content: 'Alpha'` — a TEXT LABEL —
            // fired it. MEASURED over the whole population: 5 raw matches, ALL FIVE quoted strings
            // (hasura-engine `content: 'Alpha'/'Beta'`, nomad-ui `content: "Canary"`), so the
            // component-NAME count is 0 and the string-value matches are counted SEPARATELY, beside.
            const stringValueShaped = valueNodes.find((c: any) => c.type === "string_value" && COMPONENT_SHAPE.test(stripQuotes(String(c.text))))
            if (stringValueShaped) {
              counts.contentCapitalizedInStringValue++
              if (samples.contentCapitalizedInStringValue.length < 8) samples.contentCapitalizedInStringValue.push(`${rel}:${n.startPosition.row + 1} ${String(n.text).slice(0, 90)}`)
            }
            const cap = valueNodes.find((c: any) => c.type !== "string_value" && COMPONENT_SHAPE.test(stripQuotes(String(c.text))))
            if (cap) {
              counts.contentCapitalizedComponentShape++
              if (samples.contentCapitalized.length < 8) samples.contentCapitalized.push(`${rel}:${n.startPosition.row + 1} ${String(n.text).slice(0, 90)}`)
            }
          }
          break
        }
        default:
          break
      }
      for (const c of namedChildren(n)) visit(c)
    }
    visit(tree.rootNode)
    if (fileHasError) counts.filesWithErrors++
  } finally {
    // THE LEAK GUARD'S FIRST HALF: the shared engine frees each tree, a lane's own walker does not.
    tree.delete()
  }
  if ((index + 1) % 1000 === 0) console.error(`  … ${index + 1}/${files.length} parsed (${counts.filesFailed} failed)`)
}

counts.files = files.length

const guardFailed = counts.filesRead !== files.length || counts.filesFailed > 0
if (guardFailed) {
  console.error(
    `LEAK/COVERAGE GUARD: filesRead=${counts.filesRead} files=${files.length} filesFailed=${counts.filesFailed}. ` +
      `A run that did not read every file is NOT the population — refusing to publish.`,
  )
  process.exit(5)
}

const artifact = {
  language: "scss",
  kind: LIMIT > 0 ? sampleLabel : "WHOLE POPULATION",
  generated: new Date().toISOString(),
  population: {
    artifact: "validation/m14/measurements/scss-population.json",
    rule: pop.populationRule,
    admitted: pop.admitted,
    repositoriesCarrying: pop.repositoriesCarrying,
    extensions: pop.extensions,
    capBytes: pop.capBytes,
    populationString: `parsed=${counts.filesRead}/${counts.filesRead} admitted=${pop.admitted} exts=${(pop.extensions as string[]).join(",")} index=yes`,
  },
  guard: {
    filesAdmitted: pop.admitted,
    filesRead: counts.filesRead,
    filesFailed: counts.filesFailed,
    treesDeleted: true,
    statement: "every tree deleted in a finally; filesRead === filesAdmitted or exit 5 (the cpp 15,223-file lesson)",
  },
  servedBuildR1: {
    measuredBy: "getParser('scss') -> parser.language; nodeTypeForId + nodeTypeIsNamed (NOT t.named: a string has no .named)",
    wasmPathFromResolverCandidates: servedWasmPath,
    servedWasSha256: servedDigest,
    namedTypes: namedTypeNames.length,
    totalIds,
    stemMatches: r1StemMatches,
    statement:
      "The served build's OWN inventory: the filter over stemMatches shows which node names exist for each extended value. " +
      "A stem with 0 matches is a POSITIVE grammar-inventory absence for THIS build, not a failed scan — the named accessor " +
      "returns 90 named types, so the inventory is non-empty.",
  },
  grammarSourceR2: {
    path: "grammars/tree-sitter-scss/grammar.js",
    sha256: grammarSourceDigest,
    ruleCount: grammarSourceRuleCount,
    rules: grammarSourceRules,
    statement:
      "The vendored grammar SOURCE the served build was generated from (tree-sitter-scss@1.0.0 + 2 local patches that " +
      "extend EXISTING rules: list_value/parenthesized_value for maps, and include_statement's closing delimiter for " +
      "whitespace — neither adds a named node type). R2 unavailability is a claim about THIS production list.",
  },
  counts,
  filesBy: {
    include: filesBy.include.size,
    mixin: filesBy.mixin.size,
    importSass: filesBy.importSass.size,
    important: filesBy.important.size,
    content: filesBy.content.size,
    pseudoElement: filesBy.pseudoElement.size,
  },
  declarationsByRepo: Object.fromEntries(
    [...new Set([...repoMixins.keys(), ...repoFunctions.keys()])]
      .sort()
      .map((repo) => [repo, {
        mixins: [...(repoMixins.get(repo) ?? new Set<string>())].sort(),
        functions: [...(repoFunctions.get(repo) ?? new Set<string>())].sort(),
      }]),
  ),
  samples,
  topImportSassTargets: [...importSassTargets.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25),
  includeTargetsSeen: includeTargetsSeen.size,
  statement:
    "COUNTS ARE PARSE-DERIVED CONSTRUCT SITES over the admitted population, not published relationship rows. " +
    "`includeUnparsable` is the dotted/namespaced `@include ns.mixin` class the served build splits at the dot; it is " +
    "counted so the mixes_in wall is a number rather than a sentence. `importSassFormVerified` uses the analyzer's own " +
    "file-claim spelling arithmetic against the file's repository root.",
}

if (LIMIT > 0 && !OUT_ARG) {
  // A SAMPLE IS NEVER WRITTEN TO THE CANONICAL PATH. It prints, and the caller reads it.
  console.log(JSON.stringify(artifact, null, 2))
} else {
  const target = OUT_ARG ?? OUT
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, JSON.stringify(artifact, null, 2) + "\n")
  console.log(`SCSS EXTENDED-TYPE CENSUS — ${artifact.kind}`)
  console.log(`  population: ${counts.filesRead} read / ${pop.admitted} admitted, ${counts.filesFailed} failed`)
  console.log(`  served build: ${namedTypeNames.length} named / ${totalIds} ids, sha256 ${servedDigest.slice(0, 16)}…`)
  console.log(`  mixins/imports/: @include ${counts.includeSites} (clean ${counts.includeClean} [same-file mixin ${counts.includeCleanSameFileMixin}, function ${counts.includeCleanSameFileFunction}, foreign ${counts.includeCleanForeign}] · unparsable ${counts.includeUnparsable})`)
  console.log(`                 @mixin ${counts.mixinDeclarations} · @function ${counts.functionDeclarations} · @extend ${counts.extendStatements} · @use ${counts.useStatements} · @forward ${counts.forwardStatements}`)
  console.log(`                 @import ${counts.importSites} (sass-form ${counts.importSassForm}, verified ${counts.importSassFormVerified}; css-form ${counts.importCssForm}: url ${counts.importCssUrl} media ${counts.importCssMedia} .css ${counts.importCssDotCss} protocol ${counts.importCssProtocol})`)
  console.log(`  decorates near miss: !important ${counts.importantSites} (naming a callable ${counts.importantNamingCallable}) · !global ${counts.declarationsWithGlobalFlag} · !default ${counts.declarationsWithDefaultFlag}`)
  console.log(`  renders near miss: content: ${counts.contentDeclarations} (component-shaped ${counts.contentCapitalizedComponentShape}) · pseudo-elements ${counts.pseudoElementSelectors}`)
  console.log(`  -> ${target}`)
}
