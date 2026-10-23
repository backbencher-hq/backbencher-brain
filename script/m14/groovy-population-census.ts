#!/usr/bin/env bun
/**
 * script/m14/groovy-population-census.ts
 *
 * THE GROOVY LANE'S OWN POPULATION CENSUS — the counter every groovy ruling's
 * FALSIFIER cites, and the population claim the lane publishes.
 *
 * WHY A LANE-OWNED CENSUS AND NOT ONLY THE SHARED INSTRUMENT. The shared
 * incoming-gate measures the ANALYZER's edges and their resolution. The
 * extended types need a DIFFERENT question answered: does the language have a
 * CONSTRUCT for this relation at all, and if not, is there a NEAR MISS — a
 * construct that LOOKS like it and is counted? A near-miss count is a claim
 * about the CORPUS, so it needs a counter in the tree, and the counter has to
 * walk the SAME population the lane publishes, or the ruling and the count are
 * about two different sets.
 *
 * THE POPULATION RULE, and it is the one the brief states: the ADMITTED SET is
 * the GIT-TRACKED set (`git ls-files`) restricted to the router's extensions
 * for this language and to files under the 1 MB cap (the engine's own
 * FULL_AST_LIMIT). A cell's REPO COUNT is the number of repositories that
 * CARRY an admitted file. A directory walk is a DIFFERENT population and is
 * reported beside it, never mixed into it — and the SYMLINKED DIRECTORIES the
 * two walks treat differently are printed, because a population claim that
 * does not say which walk it came from is a claim about nothing.
 *
 * WHAT IT COUNTS, and why each count is a falsifier's anchor:
 *
 *   `traitDeclarations`      the trait construct. It is what makes Groovy's
 *                            `mixes_in` question a Groovy question.
 *   `traitAppliedByImplements` / `traitAppliedByExtends`
 *                            the two WAYS a trait is applied in Groovy, with
 *                            the trait names resolved across the whole
 *                            population (two passes: collect the trait names,
 *                            then read the applications).
 *   `gstringTemplateExpressions`
 *                            the NEAR MISS for `renders`: a Groovy string
 *                            interpolation renders a VALUE into a string, not
 *                            a COMPONENT into a page.
 *   `partTokenOccurrences`   the NEAR MISS for `part_of`: the `part` token, in
 *                            the shapes `part 'x'` / `part of` would have.
 *   `heritageShapes`         THE HERITAGE BLIND-SPOT CENSUS. The analyzer's
 *                            superclass lookup is a FOUR-WAY DIRECT-CHILDREN
 *                            read (src/ast/real-groovy-analyzer.ts: the
 *                            `type_identifier || identifier || generic_type ||
 *                            scoped_type_identifier` pair over the DIRECT named
 *                            children of `superclass`). A base that is spelled
 *                            in any other shape — `extends (Base)`, a
 *                            call-shaped base — would publish NO EDGE AT ALL,
 *                            and the fleet's own heritage blind-spot probe
 *                            (script/m14/heritage-blindspot-probe.ts) CANNOT
 *                            MEASURE IT FOR GROOVY: that table has no `groovy`
 *                            entry, so the probe answers "groovy IS NOT
 *                            CONFIGURED ... NOTHING IS MEASURED". ⇒ SO THIS
 *                            CENSUS IS THE LANE'S OWN, and it counts the SHAPE
 *                            DISTRIBUTION of every `superclass` clause and how
 *                            many of them the lookup pair would miss.
 *
 * RUN: bun script/m14/groovy-population-census.ts [--limit=N] [--json]
 *      --limit=N caps the number of files MEASURED (a sample; the report says
 *      so). The default is the WHOLE admitted population.
 */
import { execFileSync } from "node:child_process"
import { statSync, readFileSync, existsSync, readdirSync, lstatSync } from "node:fs"
import { createHash } from "node:crypto"
import * as path from "node:path"

const ROOT = path.resolve(import.meta.dir, "../..")
const CORPUS = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const SIZE_CAP = 1024 * 1024
// ★ THE ROUTER'S OWN TABLE, AND IT IS READ, NOT COPIED. `script/m14/language-extensions.ts` is the
// ONE table the fleet's consumers read (the extension set MOVED there from the incoming-gate, so
// that a second copy is impossible to get right by memory — the heritage probe carried its own and
// had no `cpp` entry, so it measured an EMPTY POPULATION and printed a clean-looking zero). ⇒ A
// census that hard-codes its extensions would be a second copy, and a second copy is a population
// claim that can drift away from the lane it claims to measure.
const { extensionsFor } = await import("./language-extensions")
const EXTENSIONS = extensionsFor("groovy").map((e) => e.replace(/^\./, ""))

const argv = process.argv.slice(2)
const LIMIT = Number(argv.find((a) => a.startsWith("--limit="))?.slice(8) ?? "0") || 0
// ★ THE CHUNK MODE, AND IT IS THE GATE'S CONVENTION, NOT A NEW ONE: `--offset=N` measures a
// DISJOINT SLICE of ONE SORTED admitted list, so the slices COVER the population when walked from
// offset 0, and the SUM of the slices' counts IS the population's counts. The census is a WHOLE-CORPUS
// PARSE, so it runs under the small arm slot in slices of at most 2,000 files, exactly as the
// incoming-gate does. The report says which slice it measured, so a slice is never read as a
// population.
const OFFSET = Number(argv.find((a) => a.startsWith("--offset="))?.slice(9) ?? "0") || 0
const AS_JSON = argv.includes("--json")

function gitLsFiles(dir: string): string[] {
  try {
    return execFileSync("git", ["-C", dir, "ls-files", "-z"], {
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
    })
      .split("\0")
      .filter(Boolean)
  } catch {
    return []
  }
}

/** The ADMITTED SET: git-tracked, one of the router's extensions, under the size cap. */
function admitted(): { files: string[]; repos: string[]; overCap: number; absent: number; perRepo: Map<string, number> } {
  const files: string[] = []
  const perRepo = new Map<string, number>()
  const repos: string[] = []
  let overCap = 0
  let absent = 0
  for (const name of readdirSync(CORPUS, { withFileTypes: true })) {
    if (!name.isDirectory()) continue
    const dir = path.join(CORPUS, name.name)
    let tracked: string[]
    try {
      execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
      tracked = gitLsFiles(dir)
    } catch {
      continue
    }
    for (const rel of tracked) {
      const low = rel.toLowerCase()
      if (!EXTENSIONS.some((e) => low.endsWith(`.${e}`))) continue
      const abs = path.join(dir, rel)
      let size = -1
      try {
        size = statSync(abs).size
      } catch {
        absent++
        continue
      }
      if (size > SIZE_CAP) {
        overCap++
        continue
      }
      files.push(abs)
      perRepo.set(name.name, (perRepo.get(name.name) ?? 0) + 1)
    }
  }
  for (const [repo, n] of perRepo) if (n > 0) repos.push(repo)
  files.sort()
  return { files, repos: repos.sort(), overCap, absent, perRepo }
}

/** How many git-tracked files in the corpus carry this extension (any repo). */
function countTrackedByExtension(ext: string): number {
  let n = 0
  for (const e of readdirSync(CORPUS, { withFileTypes: true })) {
    if (!e.isDirectory()) continue
    const dir = path.join(CORPUS, e.name)
    let tracked: string[]
    try {
      execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
      tracked = gitLsFiles(dir)
    } catch {
      continue
    }
    for (const rel of tracked) if (rel.toLowerCase().endsWith(ext)) n++
  }
  return n
}

function countSymlinkedDirectories(): number {
  let n = 0
  const walk = (dir: string, depth = 0) => {
    if (depth > 12) return
    // ★ THE ENTRY'S NAME AND ITS KIND ARE DIFFERENT TYPES, AND THE COMPILER IS RIGHT ABOUT THAT.
    // `readdirSync(dir, { withFileTypes: true })` returns Dirent objects whose `name` is the
    // ENTRY'S NAME - the path segment - while `isDirectory()` / `isSymbolicLink()` are its KIND.
    // => An annotation of the form `ReturnType<typeof readdirSync>` resolves the OVERLOAD
    // WITHOUT the options and pins the element type to a buffer-flavoured Dirent, so `e.name`
    // stops being a string. => THE FIX IS TO LET THE INFERRED TYPE STAND: the options object is
    // what selects the Dirent overload, so the declaration has to keep it.
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.name === ".git") continue
      const abs = path.join(dir, e.name)
      let st
      try {
        st = lstatSync(abs)
      } catch {
        continue
      }
      if (st.isSymbolicLink()) {
        let isDir = false
        try {
          isDir = statSync(abs).isDirectory()
        } catch {
          isDir = false
        }
        if (isDir) {
          n++
          walk(abs, depth + 1)
        }
        continue
      }
      if (st.isDirectory()) walk(abs, depth + 1)
    }
  }
  for (const e of readdirSync(CORPUS, { withFileTypes: true })) {
    if (e.isDirectory()) walk(path.join(CORPUS, e.name))
  }
  return n
}

async function main() {
  const wts: any = await import("web-tree-sitter")
  const ParserClass = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const wasmBytes = readFileSync(path.join(ROOT, "wasm", "tree-sitter-groovy.wasm"))
  const grammar = await Language.load(wasmBytes)
  const parser = new ParserClass()
  parser.setLanguage(grammar)

  const pop = admitted()
  // The SYMLINKED DIRECTORIES the corpus holds, counted, so a reader can see
  // how the two walks differ. The git-tracked walk follows NONE of them.
  const symlinkedDirs = countSymlinkedDirectories()
  // THE OTHER DIALECT'S NEAR MISS, COUNTED: the Grails Server Page templates
  // that DO render components, and that the M60 #913 ruling (2026-09-24)
  // stopped routing to groovy because the Groovy grammar has no productions
  // for them. They are git-tracked files in the corpus that are NOT in the
  // admitted set, and the count is what makes the `renders` ruling a
  // MEASUREMENT rather than a preference.
  const gspTemplateFiles = countTrackedByExtension(".gsp")
  const sliced = pop.files.slice(OFFSET, LIMIT > 0 ? OFFSET + LIMIT : undefined)
  const measured = sliced

  // PASS 1 — the trait names, collected over the MEASURED files.
  const traitNames = new Set<string>()
  let traitDeclarations = 0
  const typeNames: string[] = []
  // THE HERITAGE SHAPE CENSUS — the blind-spot question, counted.
  const HERITAGE_LOOKUP = new Set(["type_identifier", "identifier", "generic_type", "scoped_type_identifier"])
  const heritageShapes = new Map<string, number>()
  let heritageClauses = 0
  let heritageCovered = 0
  let heritageMissed = 0
  const heritageMissedExamples: string[] = []
  for (const f of measured) {
    let content: string
    try {
      content = readFileSync(f, "utf8")
    } catch {
      continue
    }
    const tree = parser.parse(content)
    const walk = (n: any) => {
      if (n.type === "trait_declaration") {
        traitDeclarations++
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c && c.type === "identifier") {
            traitNames.add(c.text)
            break
          }
        }
      }
      if (n.type === "type_identifier") typeNames.push(n.text)
      if (n.type === "superclass") {
        heritageClauses++
        const kids: string[] = []
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c) kids.push(c.type)
        }
        const shape = kids.length === 0 ? "(no named children)" : kids.join("+")
        heritageShapes.set(shape, (heritageShapes.get(shape) ?? 0) + 1)
        // THE ANALYZER'S OWN PAIR: findChild over the DIRECT named children.
        if (kids.some((k) => HERITAGE_LOOKUP.has(k))) heritageCovered++
        else {
          heritageMissed++
          if (heritageMissedExamples.length < 20) {
            heritageMissedExamples.push(`${path.relative(CORPUS, n.file ?? "")}: ${String(n.text).slice(0, 90).replace(/\n/g, " ")}`)
          }
        }
      }
      for (const c of n.children) walk(c)
    }
    walk(tree.rootNode)
  }

  // PASS 2 — the applications, and the near misses, over the same files.
  let traitAppliedByImplements = 0
  let traitAppliedByExtends = 0
  let gstringTemplateExpressions = 0
  let partTokenOccurrences = 0
  let parseFailures = 0
  const appliedTraitNames = new Set<string>()

  for (const f of measured) {
    let content: string
    try {
      content = readFileSync(f, "utf8")
    } catch {
      continue
    }
    const tree = parser.parse(content)
    let failed = false
    const walk = (n: any) => {
      if (n.type === "ERROR") failed = true
      if (n.type === "template_expression") gstringTemplateExpressions++
      if (n.type === "super_interfaces" || n.type === "superclass" || n.type === "extends_interfaces") {
        const isImplements = n.type === "super_interfaces"
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (!c) continue
          const collect = (m: any) => {
            if (m.type === "type_identifier") {
              if (traitNames.has(m.text)) {
                if (isImplements) traitAppliedByImplements++
                else traitAppliedByExtends++
                appliedTraitNames.add(m.text)
              }
            }
            for (const g of m.children) collect(g)
          }
          collect(c)
        }
      }
      for (const c of n.children) walk(c)
    }
    walk(tree.rootNode)
    if (failed) parseFailures++
    // the `part` NEAR MISS, counted on the TEXT because the grammar has no node
    // for it (the served build's inventory names 0 of them) — so a text count
    // is the only place a near miss CAN live.
    partTokenOccurrences += (content.match(/(^|[^\w$])part\s+['"][^'"]+['"]|(^|[^\w$])part\s+of\b/g) ?? []).length
  }

  const report = {
    population: {
      rule: "the ADMITTED SET is the GIT-TRACKED set (git ls-files) restricted to the router's extensions (.groovy, .gvy, .gradle) and to files under the 1 MB cap; the REPO COUNT is the repositories carrying an admitted file",
      corpus_root: CORPUS,
      extensions: EXTENSIONS,
      size_cap_bytes: SIZE_CAP,
      admitted_files: pop.files.length,
      repos: pop.repos.length,
      repo_names: pop.repos,
      per_repo: Object.fromEntries([...pop.perRepo.entries()].sort((a, b) => b[1] - a[1])),
      excluded_over_cap: pop.overCap,
      excluded_absent: pop.absent,
      measured_files: measured.length,
      measured_slice: measured.length ? [measured[0], measured[measured.length - 1]] : [],
      slice_offset: OFFSET,
      is_whole_population: measured.length === pop.files.length,
      symlinked_directories_found_corpuswide: symlinkedDirs,
      symlinked_directories_followed: 0,
      symlinked_directories_note:
        "ZERO, by construction: `git ls-files` lists a symlink as an ENTRY, never the files under it, so the git-tracked walk cannot reach a file through a symlinked directory.",
    },
    grammar: {
      served_wasm: "wasm/tree-sitter-groovy.wasm",
      sha256: createHash("sha256").update(wasmBytes).digest("hex"),
      bytes: wasmBytes.length,
      node_inventory: "validation/m14/measurements/groovy-grammar-nodes.json",
    },
    counts: {
      traitDeclarations,
      distinctTraitNames: traitNames.size,
      traitAppliedByImplements,
      traitAppliedByExtends,
      distinctAppliedTraitNames: appliedTraitNames.size,
      gstringTemplateExpressions,
      partTokenOccurrences,
      parseFailures,
      heritageClauses,
      heritageCoveredByTheAnalyzerLookup: heritageCovered,
      heritageMissedByTheAnalyzerLookup: heritageMissed,
      heritageShapes: Object.fromEntries([...heritageShapes.entries()].sort((a, b) => b[1] - a[1])),
      heritageMissedExamples,
      gspTemplateFiles,
    },
    trait_names: [...traitNames].sort(),
    applied_trait_names: [...appliedTraitNames].sort(),
  }

  if (AS_JSON) {
    console.log(JSON.stringify(report, null, 2))
    return
  }
  console.log(`GROOVY POPULATION CENSUS`)
  console.log(`  corpus root        ${CORPUS}`)
  console.log(`  admitted set       git-tracked · .groovy,.gvy,.gradle · <= ${SIZE_CAP} bytes`)
  console.log(`  admitted files     ${pop.files.length} across ${pop.repos.length} repositories`)
  console.log(`  per repo           ${[...pop.perRepo.entries()].sort((a, b) => b[1] - a[1]).map(([r, n]) => `${r}=${n}`).join(" · ")}`)
  console.log(`  excluded           ${pop.overCap} over the cap · ${pop.absent} tracked-but-absent`)
  console.log(`  measured           ${measured.length}${measured.length === pop.files.length ? " (the WHOLE admitted set)" : ` (A SLICE [${OFFSET}, ${OFFSET + measured.length}) of ${pop.files.length} — a slice is never a population)`}`)
  console.log(`  symlinked dirs     ${symlinkedDirs} exist corpus-wide; 0 followed (the git-tracked walk lists a symlink as an entry, never the files under it)`)
  console.log(`  served wasm        ${report.grammar.sha256}`)
  console.log(`  TRAIT CONSTRUCT    ${traitDeclarations} declarations · ${traitNames.size} distinct names`)
  console.log(`  trait via implements ${traitAppliedByImplements} · via extends ${traitAppliedByExtends} · ${appliedTraitNames.size} distinct names`)
  console.log(`  NEAR MISS renders  ${gstringTemplateExpressions} template_expression nodes (a GString renders a VALUE, not a COMPONENT)`)
  console.log(`  NEAR MISS part_of  ${partTokenOccurrences} 'part <file>' / 'part of' occurrences`)
  console.log(`  HERITAGE CLAUSES   ${heritageClauses} superclass clauses · ${heritageCovered} covered by the analyzer's 4-way lookup · ${heritageMissed} MISSED`)
  for (const [shape, n] of [...heritageShapes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`     ${String(n).padStart(6)}  ${shape}`)
  }
  console.log(`  NEAR MISS .gsp     ${gspTemplateFiles} git-tracked Grails Server Page templates (they render components, and the M60 #913 ruling stopped routing them to groovy)`)
  console.log(`  parse failures     ${parseFailures}`)
}

main()
