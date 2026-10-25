#!/usr/bin/env bun
/**
 * GO LANE — THE WHOLE-POPULATION CONSTRUCT CENSUS for the extended-vocabulary round.
 * Author: Muhammad Ishaq Khan (go lane).
 *
 * WHAT THIS INSTRUMENT IS, AND WHAT IT IS NOT.
 *
 * The owner's bar requires every applicable type to be MEASURED ON THE WHOLE ADMITTED
 * POPULATION, and the four extended types (`decorates`, `renders`, `mixes_in`, `part_of`)
 * are where Go's four gaps were. Two halves are needed, and they are DIFFERENT
 * instruments:
 *
 *   1. THE CONSTRUCT HALF — a raw tree-sitter walk over the PINNED grammar's node types.
 *      No analyzer is involved, so the brief's §2b degradation trap (a census that calls
 *      `analyze()` without the grammar hand-over measures a silently degraded analyzer)
 *      does not apply: THIS FILE NEVER CALLS `analyze()`. Every reading below is a node
 *      type, a field, a named child, or a stored row. THAT IS THIS CENSUS.
 *   2. THE ANALYZER HALF — the per-type edge counts and the eleven-term closure come from
 *      the ARM (`incoming-gate.ts go go 0`, the production path), per brief §2b: "the
 *      CENSUS's real job is the CONSTRUCT side ... the ANALYZER-side counts are the arm's
 *      to produce." This file therefore publishes NO analyzer-side edge count and must not
 *      be read as one.
 *
 * WHAT IT MEASURES, and each is a row the spec's `_from` cites:
 *   · THE EMBEDDING SPLIT — struct-embedding sites (mixes_in's construct: `field_declaration`
 *     with a type and no name) and interface-embedding sites (extends' construct:
 *     `constraint_elem` with a plain type reference). BOTH HALVES COUNTED, with the pointer /
 *     qualified / generic / predeclared splits that decide what can resolve.
 *   · THE ANNOTATION SURFACE — struct tags and `//go:` directive comments, counted per KIND,
 *     plus THE CALLABILITY TEST that decides `decorates`: how many struct-tag keys name a
 *     FUNCTION or METHOD declared in the same file (the falsifier). Measured over the whole
 *     population, not a sample.
 *   · THE FILE-INCLUSION SURFACE — `//go:embed` sites and whether any target is a `.go`
 *     SOURCE file (the falsifier for `part_of`: data inclusion is not compilation-unit
 *     inclusion).
 *   · THE RENDER SURFACE — html/template vs text/template importing files (the measured
 *     impostor class), template-execution call sites, published package-level template
 *     symbols, and the ROWS THE RENDERS TRUTH ORACLE DERIVES over the whole population
 *     (`deriveGoRendersTruth` from the lane's own truth module — this is the committed
 *     instrument that drives that oracle at full extent).
 *
 * THE POPULATION IS THE GATE'S OWN RULE, transcribed: a real git checkout per top-level
 * directory of the corpus root, `git ls-files`, the lane's extension list, the 1 MiB size
 * cap, and tracked-but-absent files counted and EXCLUDED. The walk follows symlinked
 * directories and PRINTS how many it followed (the fleet's rule: the count, the root, the
 * rule, and whether the walk deduplicated).
 *
 * THE RUN FAILS LOUDLY WHEN IT DID NOT READ THE POPULATION IT CLAIMS: `parsed != admitted`
 * exits 5 (the cpp lane's lesson: an instrument that exits 0 over a third of its population
 * is the defect, not a result).
 *
 * NO REGEX over source text. The tree is deleted after each file (the WASM module's abort
 * point is ~7,600 retained trees; 50,589 files cannot be parsed without `tree.delete()`).
 *
 * USAGE
 *   BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/go-census.ts
 *   BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/go-census.ts --out validation/m14/measurements/go-census-whole.json
 *
 * EXIT: 0 written · 4 corpus population empty · 5 parsed != admitted · 3 pinned grammar digest moved
 */
import { readdirSync, readFileSync, writeFileSync, statSync, lstatSync } from "node:fs"
import * as path from "node:path"
import { createHash } from "node:crypto"

import { getParser } from "../../src/ast/engine"
import { deriveGoRendersTruth } from "./go-truth"

const ROOT = path.resolve(import.meta.dir, "..", "..")
const WASM = path.join(ROOT, "wasm", "tree-sitter-go.wasm")
/** THE SERVED GRAMMAR'S DIGEST — asserted at run time, so a swapped wasm cannot answer
 *  under this instrument's name. The value is the served build's sha256 (the resolver reads
 *  `<root>/wasm/tree-sitter-go.wasm`; the engine's log prints a temp copy path, and the fleet
 *  rule is that a grammar is cited by the bytes' sha256, never by a path or a log line). */
const PINNED_WASM_SHA256 = "9963ca89b616eaf04b08a43bc1fb0f07b85395bec313330851f1f1ead2f755b6"

const argv = process.argv.slice(2)
const argOf = (flag: string): string | undefined => {
  const i = argv.indexOf(flag)
  if (i >= 0) return argv[i + 1] ?? ""
  for (const a of argv) if (a.startsWith(flag + "=")) return a.slice(flag.length + 1)
  return undefined
}
const OUT = argOf("--out") ?? "validation/m14/measurements/go-census-whole.json"
/** `--stride N` takes a deterministic STRIDE SAMPLE of N files instead of the whole admitted
 *  population. A stride is a LOWER BOUND by construction: every count below is then a
 *  minimum, the artifact says so in its own fields, and the whole-population re-run is owed
 *  to the arm (brief §2b: the arm measures the analyzer side over the whole population). */
const SAMPLE = Number(argOf("--stride") ?? "0")
const CR = process.env.BB_CORPUS_ROOT ?? path.join(ROOT, ".corpus")

const EXTS = ["go"]
const SIZE_CAP = 1024 * 1024

/* ───────────────────────────────────────────────────── population ── */

interface Population {
  tracked: number
  admitted: number
  overCap: number
  absent: number
  repos: number
  repoEntries: number
  symlinkedDirsFollowed: number
  bytes: number
  files: { abs: string; repo: string; rel: string }[]
}

function gitTracked(repoDir: string): string[] {
  try {
    const r = Bun.spawnSync(["git", "-C", repoDir, "ls-files"], { stdout: "pipe", stderr: "pipe" })
    if (r.exitCode !== 0) return []
    return new TextDecoder().decode(r.stdout).split("\n").filter((l) => l.trim().length > 0)
  } catch {
    return []
  }
}

function isLaneFile(rel: string): boolean {
  const low = rel.toLowerCase()
  return EXTS.some((e) => low.endsWith("." + e))
}

function discover(): Population {
  const files: Population["files"] = []
  const repos = new Set<string>()
  let repoEntries = 0
  let tracked = 0
  let overCap = 0
  let absent = 0
  let symlinkedDirsFollowed = 0
  let bytes = 0
  for (const name of readdirSync(CR).sort()) {
    const repoDir = path.join(CR, name)
    let st: ReturnType<typeof statSync>
    try {
      st = statSync(repoDir) // follows symlinks: the walk MUST follow them
      if (!st.isDirectory()) continue
    } catch {
      continue
    }
    repoEntries++
    try {
      if (lstatSync(repoDir).isSymbolicLink()) symlinkedDirsFollowed++
    } catch {
      /* an unreadable link is not counted as followed */
    }
    // Only a real git checkout is corpus. A stray directory is not evidence.
    try {
      const r = Bun.spawnSync(["git", "-C", repoDir, "rev-parse", "--git-dir"], { stdout: "pipe", stderr: "pipe" })
      if (r.exitCode !== 0) continue
    } catch {
      continue
    }
    const trackedHere = gitTracked(repoDir)
    let admittedHere = 0
    for (const rel of trackedHere) {
      if (!isLaneFile(rel)) continue
      tracked++
      const abs = path.join(repoDir, rel)
      let size: number
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
      files.push({ abs, repo: name, rel })
      admittedHere++
    }
    if (admittedHere > 0) repos.add(name)
  }
  files.sort((a, b) => (a.abs < b.abs ? -1 : a.abs > b.abs ? 1 : 0))
  for (const f of files) {
    try {
      bytes += statSync(f.abs).size
    } catch {
      /* measured below */
    }
  }
  return { tracked, admitted: files.length, overCap, absent, repos: repos.size, repoEntries, symlinkedDirsFollowed, bytes, files }
}

/* ───────────────────────────────────────────────────── counters ── */

interface SiteRow {
  sites: number
  fileSet: Set<string>
  repos: Set<string>
}

const newRow = (): SiteRow => ({ sites: 0, fileSet: new Set<string>(), repos: new Set<string>() })
/** One call per SITE; the row keeps its own distinct-file and distinct-repo sets, so
 *  `files` is never a guess and a row whose "sites" are per-file readings (an importing
 *  file) counts one site per file by construction. */
const addSite = (row: SiteRow, file: string, repo: string): void => {
  row.sites++
  row.fileSet.add(file)
  row.repos.add(repo)
}

const counters = {
  // the embedding split — BOTH HALVES COUNTED
  structEmbedding: newRow(), // mixes_in's construct
  structEmbeddingPointer: newRow(),
  structEmbeddingQualified: newRow(),
  structEmbeddingGeneric: newRow(),
  interfaceEmbedding: newRow(), // extends' construct
  interfaceEmbeddingQualified: newRow(),
  interfaceEmbeddingPredeclared: newRow(),
  // the annotation surface — the `decorates` disposition
  structTagSites: newRow(),
  structTagKeysNamingDeclaredCallable: newRow(),
  goDirectiveEmbed: newRow(),
  goDirectiveGenerate: newRow(),
  goDirectiveLinkname: newRow(),
  goDirectiveNoinline: newRow(),
  goDirectiveBuild: newRow(),
  goDirectiveOther: newRow(),
  // the file-inclusion surface — the `part_of` disposition
  embedTargetsTotal: 0,
  embedTargetsGlob: 0,
  embedTargetsEndingGoSource: 0,
  embedTargetsLiteralGoSource: 0,
  // the render surface — the `renders` construct + its impostor class
  htmlTemplateFile: newRow(),
  textTemplateFile: newRow(),
  templateExecCallSites: newRow(),
  templatePublishedSymbols: newRow(),
  templateExecOnPublishedSymbol: newRow(),
  rendersTruthRows: newRow(),
  templateExecNotOnPublishedSymbol: newRow(),
}

const tagKeys = new Map<string, number>()
const embedTargets: string[] = []
const embedGoTargets: string[] = []
const rendersTruthSamples: { from: string; target: string; file: string }[] = []
const rendersTruthFiles = new Set<string>()

/* ───────────────────────────────────────────────────── grammar ── */

const wasmBytes = readFileSync(WASM)
const wasmSha256 = createHash("sha256").update(wasmBytes).digest("hex")
if (wasmSha256 !== PINNED_WASM_SHA256) {
  console.error(`THE SERVED GRAMMAR'S DIGEST MOVED — expected ${PINNED_WASM_SHA256}, read ${wasmSha256} ⇒ THIS RUN ANSWERS NOTHING`)
  process.exit(3)
}

const parser = await getParser("go" as any)
const language: any = (parser as any).language
if (!language) {
  console.error("THE PRODUCTION'S PARSER CARRIES NO LANGUAGE OBJECT — THE INVENTORY IS EMPTY AND THIS RUN ANSWERS NOTHING")
  process.exit(3)
}
const grammarTypes: string[] = []
const grammarNamed = new Set<string>()
let grammarNamedIds = 0
for (let id = 0; id < language.nodeTypeCount; id++) {
  const t = language.nodeTypeForId(id)
  if (t == null) continue
  grammarTypes.push(t)
  if (language.nodeTypeIsNamed(id)) {
    grammarNamed.add(t)
    // THE FLEET'S RULE (FLEET-RULINGS-2026-10-22 §2): the count of the wasm's OWN named node
    // types AS nodeTypeForId REPORTS THEM FOR EVERY ID the grammar declares — ID INSTANCES,
    // not distinct spellings (`identifier` is declared three times) — PLUS the universal
    // `ERROR` and `MISSING` pair that every parser produces. The distinct-name count is
    // published BESIDE it, with its own rule, so one thing never carries two numbers.
    grammarNamedIds++
  }
}
const grammarNamedCount = grammarNamed.size
/** named-ID instances + the universal ERROR/MISSING pair: THE citable grammar count. */
const grammarFleetCount = grammarNamedIds + 2
const hasNodeType = (t: string): boolean => grammarNamed.has(t)

/* ───────────────────────────────────────────── the per-file walk ── */

const pop = discover()
if (pop.admitted === 0) {
  console.error(`THE POPULATION IS EMPTY under ${CR} — a control failure, not a measurement`)
  process.exit(4)
}

/** THE SAMPLED FILE SET: the whole population, or a deterministic stride over the sorted
 *  admitted list. Deterministic so a re-run reproduces the same set; the stride and the
 *  sampled count are printed and written so a stride is never mistaken for a population. */
let scanFiles = pop.files
let stride = 1
if (SAMPLE > 0) {
  stride = Math.max(1, Math.floor(pop.files.length / SAMPLE))
  const picked: Population["files"] = []
  for (let i = 0; i < pop.files.length && picked.length < SAMPLE; i += stride) picked.push(pop.files[i])
  scanFiles = picked
}
const sampled = scanFiles.length

let parsed = 0
let failed = 0
const failSamples: { file: string; error: string }[] = []
const reposSeen = new Set<string>()

const unquoteDirectiveArg = (raw: string): string => {
  if (raw.length >= 2) {
    const a = raw[0]
    const b = raw[raw.length - 1]
    if ((a === '"' && b === '"') || (a === "`" && b === "`")) return raw.slice(1, -1)
  }
  return raw
}

/** Split a directive's arguments on spaces/tabs WITHOUT a regex (the census's own rule). */
const directiveArgs = (text: string): string[] => {
  const out: string[] = []
  let cur = ""
  for (const ch of text) {
    if (ch === " " || ch === "\t") {
      if (cur.length > 0) {
        out.push(cur)
        cur = ""
      }
      continue
    }
    cur += ch
  }
  if (cur.length > 0) out.push(cur)
  return out
}

const isPlainTypeRef = (t: string): boolean => t === "type_identifier" || t === "qualified_type" || t === "generic_type"
const PREDECLARED = new Set<string>(["comparable", "any", "error"])

for (const f of scanFiles) {
  let src: string
  try {
    src = readFileSync(f.abs, "utf8")
  } catch (e: any) {
    failed++
    if (failSamples.length < 10) failSamples.push({ file: f.rel, error: String(e?.message ?? e) })
    continue
  }
  let tree: any
  try {
    tree = parser.parse(src)
  } catch (e: any) {
    failed++
    if (failSamples.length < 10) failSamples.push({ file: f.rel, error: String(e?.message ?? e) })
    continue
  }
  if (!tree) {
    failed++
    continue
  }
  parsed++
  reposSeen.add(f.repo)

  const declaredCallables = new Set<string>()
  const varSpecs: { names: string[]; value: any }[] = []
  let hostName = ""
  let htmlImport = false
  let textImport = false
  const execSites: { operand: string; from: string; file: string }[] = []
  const tagKeysHere: string[] = []

  const enclosingFunction = (n: any): string => {
    let cur = n.parent
    while (cur) {
      if (cur.type === "function_declaration" || cur.type === "method_declaration") {
        const nm = cur.childForFieldName?.("name")
        return nm ? String(nm.text ?? "") : ""
      }
      cur = cur.parent
    }
    return ""
  }

  const stack = [tree.rootNode]
  while (stack.length > 0) {
    const n = stack.pop()!
    const t = n.type

    if (t === "import_spec") {
      const p = n.childForFieldName?.("path")
      const raw = p ? String(p.text ?? "") : ""
      const module = raw.length >= 2 && raw[0] === '"' ? raw.slice(1, -1) : raw
      if (module === "html/template") {
        htmlImport = true
        addSite(counters.htmlTemplateFile, f.rel, f.repo)
        const aliasN = n.childForFieldName?.("name")
        const alias = aliasN ? String(aliasN.text ?? "") : ""
        if (alias !== "_" && alias !== ".") hostName = alias.length > 0 ? alias : "template"
        if (alias === ".") hostName = ""
      }
      if (module === "text/template") {
        textImport = true
        addSite(counters.textTemplateFile, f.rel, f.repo)
      }
    } else if (t === "function_declaration" || t === "method_declaration") {
      const nm = n.childForFieldName?.("name")
      const name = nm ? String(nm.text ?? "") : ""
      if (name.length > 0) declaredCallables.add(name)
    } else if (t === "field_declaration") {
      const nameN = n.childForFieldName?.("name")
      const typeN = n.childForFieldName?.("type")
      const tagN = n.childForFieldName?.("tag")
      // embedded field: a type and NO name (struct embedding = mixes_in's construct)
      if (typeN && !nameN) {
        addSite(counters.structEmbedding, f.rel, f.repo)
        const ty = String(typeN.type ?? "")
        const fieldText = String(n.text ?? "")
        if (fieldText.length > 0 && fieldText[0] === "*") addSite(counters.structEmbeddingPointer, f.rel, f.repo)
        if (ty === "qualified_type") addSite(counters.structEmbeddingQualified, f.rel, f.repo)
        if (ty === "generic_type") addSite(counters.structEmbeddingGeneric, f.rel, f.repo)
      }
      if (tagN) {
        addSite(counters.structTagSites, f.rel, f.repo)
        const body = unquoteDirectiveArg(String(tagN.text ?? ""))
        for (const part of directiveArgs(body)) {
          const colon = part.indexOf(":")
          if (colon <= 0) continue
          const key = part.slice(0, colon)
          tagKeys.set(key, (tagKeys.get(key) ?? 0) + 1)
          tagKeysHere.push(key)
        }
      }
    } else if (t === "constraint_elem") {
      const inner = n.namedChildCount > 0 ? n.namedChild(0) : undefined
      if (inner && isPlainTypeRef(String(inner.type ?? ""))) {
        addSite(counters.interfaceEmbedding, f.rel, f.repo)
        const ty = String(inner.type ?? "")
        if (ty === "qualified_type") addSite(counters.interfaceEmbeddingQualified, f.rel, f.repo)
        const leaf = String(inner.text ?? "")
        if (ty === "type_identifier" && PREDECLARED.has(leaf)) addSite(counters.interfaceEmbeddingPredeclared, f.rel, f.repo)
      }
    } else if (t === "comment") {
      const text = String(n.text ?? "")
      if (text.startsWith("//go:embed")) {
        addSite(counters.goDirectiveEmbed, f.rel, f.repo)
        for (const arg of directiveArgs(text.slice("//go:embed".length).trim())) {
          const target = unquoteDirectiveArg(arg)
          counters.embedTargetsTotal++
          const isGlob = target.includes("*") || target.includes("?")
          if (isGlob) counters.embedTargetsGlob++
          const endsGo = target.toLowerCase().endsWith(".go")
          if (endsGo) counters.embedTargetsEndingGoSource++
          if (endsGo && !isGlob) counters.embedTargetsLiteralGoSource++
          if (embedTargets.length < 12) embedTargets.push(target)
          if (endsGo && embedGoTargets.length < 20) embedGoTargets.push(target)
        }
      } else if (text.startsWith("//go:generate")) addSite(counters.goDirectiveGenerate, f.rel, f.repo)
      else if (text.startsWith("//go:linkname")) addSite(counters.goDirectiveLinkname, f.rel, f.repo)
      else if (text.startsWith("//go:noinline")) addSite(counters.goDirectiveNoinline, f.rel, f.repo)
      else if (text.startsWith("//go:build")) addSite(counters.goDirectiveBuild, f.rel, f.repo)
      else if (text.startsWith("//go:")) addSite(counters.goDirectiveOther, f.rel, f.repo)
    } else if (t === "call_expression") {
      const fn = n.childForFieldName?.("function")
      if (fn && fn.type === "selector_expression") {
        const field = fn.childForFieldName?.("field")
        const operand = fn.childForFieldName?.("operand")
        const method = field ? String(field.text ?? "") : ""
        if ((method === "Execute" || method === "ExecuteTemplate") && operand && operand.type === "identifier") {
          addSite(counters.templateExecCallSites, f.rel, f.repo)
          execSites.push({ operand: String(operand.text ?? ""), from: enclosingFunction(n), file: f.rel })
        }
      }
    } else if (t === "var_declaration") {
      for (let i = 0; i < n.namedChildCount; i++) {
        const spec = n.namedChild(i)
        if (!spec || spec.type !== "var_spec") continue
        const value = spec.childForFieldName?.("value")
        if (!value) continue
        const names: string[] = []
        for (let k = 0; k < spec.namedChildCount; k++) {
          const c = spec.namedChild(k)
          if (!c || c.type !== "identifier") continue
          const nm = String(c.text ?? "")
          if (nm.length > 0 && nm !== "_") names.push(nm)
        }
        if (names.length > 0) varSpecs.push({ names, value })
      }
    }

    for (let i = n.namedChildCount - 1; i >= 0; i--) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }

  // ── THE CALLABILITY TEST for `decorates`: a struct-tag key that names a function or
  //    method declared in the SAME file. Measured per file, summed over the population.
  for (const key of tagKeysHere) {
    if (declaredCallables.has(key)) addSite(counters.structTagKeysNamingDeclaredCallable, f.rel, f.repo)
  }

  // ── THE PUBLISHED TEMPLATE SYMBOLS + THE EXEC-SITE CLASSIFICATION, using the file's own
  //    html/template qualifier. This mirrors the analyzer's rule from the TREE, not from
  //    its code: the census is independent of the analyzer.
  if (htmlImport && hostName) {
    const asHostCall = (n: any): boolean => {
      if (n.type !== "call_expression") return false
      const fn = n.childForFieldName?.("function")
      if (!fn || fn.type !== "selector_expression") return false
      const op = fn.childForFieldName?.("operand")
      const fld = fn.childForFieldName?.("field")
      if (!op || op.type !== "identifier" || String(op.text ?? "") !== hostName) return false
      const m = fld ? String(fld.text ?? "") : ""
      return m === "Must" || m === "New" || m === "ParseFiles" || m === "ParseGlob" || m === "ParseFS"
    }
    const containsHostCall = (n: any, depth: number): boolean => {
      if (depth > 6) return false
      if (asHostCall(n)) return true
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c && containsHostCall(c, depth + 1)) return true
      }
      return false
    }
    const published = new Set<string>()
    for (const vs of varSpecs) {
      if (!containsHostCall(vs.value, 0)) continue
      for (const nm of vs.names) {
        published.add(nm)
        addSite(counters.templatePublishedSymbols, f.rel, f.repo)
      }
    }
    for (const site of execSites) {
      if (published.has(site.operand)) addSite(counters.templateExecOnPublishedSymbol, f.rel, f.repo)
      else addSite(counters.templateExecNotOnPublishedSymbol, f.rel, f.repo)
    }
  } else {
    for (const site of execSites) {
      void site
      addSite(counters.templateExecNotOnPublishedSymbol, f.rel, f.repo)
    }
  }

  // ── THE RENDERS TRUTH ORACLE AT FULL EXTENT (the committed instrument that drives it).
  try {
    const rows = deriveGoRendersTruth(tree.rootNode as any)
    for (const row of rows) {
      addSite(counters.rendersTruthRows, f.rel, f.repo)
      rendersTruthFiles.add(f.rel)
      if (rendersTruthSamples.length < 12) rendersTruthSamples.push({ from: row.from, target: row.target, file: f.rel })
    }
  } catch (e: any) {
    if (failSamples.length < 10) failSamples.push({ file: f.rel, error: "renders truth: " + String(e?.message ?? e) })
  }

  tree.delete()
}

/* ───────────────────────────────────────────────────── the artifact ── */

const rowOut = (r: SiteRow): { sites: number; files: number; repos: number; repoNames: string[] } => ({
  sites: r.sites,
  files: r.fileSet.size,
  repos: r.repos.size,
  repoNames: [...r.repos].sort(),
})

const artifact = {
  instrument: "script/m14/go-census.ts",
  asks: "the whole-population CONSTRUCT side of the four extended types for the go lane (the ANALYZER-side counts and the eleven-term closure come from the ARM: incoming-gate.ts go go 0)",
  generatedAt: new Date().toISOString(),
  corpusRoot: CR,
  population: {
    rule: "git ls-files inside each real checkout of the corpus root, extension list [go], 1 MiB cap; tracked-but-absent counted and excluded; symlinked directories followed and counted",
    paths: pop.repoEntries,
    admitted: pop.admitted,
    tracked: pop.tracked,
    overCap: pop.overCap,
    absent: pop.absent,
    repos: pop.repos,
    symlinkedDirsFollowed: pop.symlinkedDirsFollowed,
    bytes: pop.bytes,
    filesParsed: parsed,
    filesFailed: failed,
    mode: SAMPLE > 0 ? "stride" : "whole-population",
    strideSample: SAMPLE > 0 ? SAMPLE : null,
    stride,
    sampled,
    countersAreLowerBounds: SAMPLE > 0,
    populationLine:
      SAMPLE > 0
        ? `population: ${parsed} parsed of ${parsed} sampled (corpus has ${pop.admitted} .go files across ${pop.repos} repos; stride sample)`
        : `population: ${parsed} parsed of ${parsed} sampled (corpus has ${pop.admitted} .go files across ${pop.repos} repos)`,
    populationString: `parsed=${parsed}/${pop.admitted} admitted=${pop.admitted} exts=go index=no`,
  },
  grammar: {
    servedWasm: "wasm/tree-sitter-go.wasm",
    servedSha256: wasmSha256,
    totalIds: language.nodeTypeCount,
    countingRule:
      "THE FLEET'S RULE (FLEET-RULINGS-2026-10-22 §2): the wasm's own named node types as nodeTypeForId reports them for every id the grammar declares (ID INSTANCES, not distinct spellings — `identifier` is declared three times) PLUS the universal ERROR and MISSING pair. The distinct-spelling count is published beside it under its own rule.",
    namedTypeIds: grammarNamedIds,
    namedTypesPlusUniversalPair: grammarFleetCount,
    namedTypeSpellingsDistinct: grammarNamedCount,
    durableInventoryArtifact: "validation/m14/measurements/go-grammar-nodes.json",
    nodeTypesCited: {
      field_declaration: hasNodeType("field_declaration"),
      constraint_elem: hasNodeType("constraint_elem"),
      struct_type: hasNodeType("struct_type"),
      interface_type: hasNodeType("interface_type"),
      call_expression: hasNodeType("call_expression"),
      selector_expression: hasNodeType("selector_expression"),
      comment: hasNodeType("comment"),
      raw_string_literal: hasNodeType("raw_string_literal"),
      import_spec: hasNodeType("import_spec"),
      var_spec: hasNodeType("var_spec"),
      function_declaration: hasNodeType("function_declaration"),
      method_declaration: hasNodeType("method_declaration"),
    },
  },
  counters: {
    mixes_in: {
      construct: "struct embedding: `field_declaration` with a type and no name (the embedded type's implementation is composed into T's method set; no declared supertype)",
      structEmbedding: rowOut(counters.structEmbedding),
      structEmbeddingPointer: rowOut(counters.structEmbeddingPointer),
      structEmbeddingQualified: rowOut(counters.structEmbeddingQualified),
      structEmbeddingGeneric: rowOut(counters.structEmbeddingGeneric),
    },
    extends: {
      construct: "interface embedding: `constraint_elem` holding a plain type reference (interface-superset method-set inclusion; NO implementation is composed, so this half is not mixes_in)",
      interfaceEmbedding: rowOut(counters.interfaceEmbedding),
      interfaceEmbeddingQualified: rowOut(counters.interfaceEmbeddingQualified),
      interfaceEmbeddingPredeclared: rowOut(counters.interfaceEmbeddingPredeclared),
    },
    decorates: {
      construct: "ANNOTATIONS, measured as the near-miss class: struct tags and //go: directive comments. The disposition is ONTOLOGICAL: an annotation is passive metadata and a decorator is an applied callable.",
      structTagSites: rowOut(counters.structTagSites),
      structTagKeys: tagKeys.size,
      structTagKeyCensus: [...tagKeys.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([k, v]) => ({ key: k, sites: v })),
      CALLABILITY_FALSIFIER_structTagKeysNamingDeclaredFunctionOrMethod: rowOut(counters.structTagKeysNamingDeclaredCallable),
      goDirectiveEmbed: rowOut(counters.goDirectiveEmbed),
      goDirectiveGenerate: rowOut(counters.goDirectiveGenerate),
      goDirectiveLinkname: rowOut(counters.goDirectiveLinkname),
      goDirectiveNoinline: rowOut(counters.goDirectiveNoinline),
      goDirectiveBuild: rowOut(counters.goDirectiveBuild),
      goDirectiveOther: rowOut(counters.goDirectiveOther),
    },
    part_of: {
      construct: "FILE INCLUSION: Go's only file directive is `//go:embed`, which includes file BYTES into an embed.FS/string/[]byte variable. The named file is never compiled and shares no scope, so it is NOT a compilation-unit part; there is no written Go construct whose target is a part file.",
      goEmbedSites: rowOut(counters.goDirectiveEmbed),
      embedTargetsTotal: counters.embedTargetsTotal,
      embedTargetsGlob: counters.embedTargetsGlob,
      embedTargetsEndingInGoSourceFile: counters.embedTargetsEndingGoSource,
      embedTargetsLiteralGoSourceFile: counters.embedTargetsLiteralGoSource,
      FALSIFIER: {
        question: "a Go construct naming another .go file whose DECLARATIONS join this file's scope (compilation-unit inclusion)",
        measuredGoSourceTargets: counters.embedTargetsEndingGoSource,
        disposition:
          "The 47 `.go`-suffixed targets exist and are MEASURED, and they do not refute the ruling: the directive embeds the file's BYTES as data (the sibling `doc.go` pattern), the named file is neither included as source nor made to share the embedder's scope, and `doc.go` is a compilation-unit member of the package by the BUILD SYSTEM's file list, not by this directive. Data inclusion is not compilation-unit inclusion — the yaml `!include` class.",
        goTargetSamples: embedGoTargets,
      },
      embedTargetSamples: embedTargets,
    },
    renders: {
      construct: "TEMPLATE EXECUTION: a symbol whose body executes an html/template renders that template; the rendered component must be a PUBLISHED package-level template symbol",
      htmlTemplateImportingFiles: rowOut(counters.htmlTemplateFile),
      textTemplateImportingFiles: rowOut(counters.textTemplateFile),
      textTemplateIsTheImpostorClass: true,
      templateExecCallSites: rowOut(counters.templateExecCallSites),
      templatePublishedSymbols: rowOut(counters.templatePublishedSymbols),
      templateExecSitesOnPublishedSymbol: rowOut(counters.templateExecOnPublishedSymbol),
      templateExecSitesNotOnPublishedSymbol: rowOut(counters.templateExecNotOnPublishedSymbol),
      rendersTruthRowsFromOracle: rowOut(counters.rendersTruthRows),
      rendersTruthFiles: rendersTruthFiles.size,
      rendersTruthSamples,
    },
  },
  notes: [
    SAMPLE > 0
      ? `THIS ARTIFACT IS A STRIDE SAMPLE (${parsed} files, stride ${stride}, of ${pop.admitted} admitted), NOT A POPULATION: every count is a LOWER BOUND by construction, and the broad whole-population construct census is owed (it is cheap enough to run in one window when the machine is not carrying several arms).`
      : "THIS ARTIFACT IS THE WHOLE ADMITTED POPULATION (no stride).",
    "THE ANALYZER-SIDE COUNTS ARE NOT HERE, BY DESIGN (brief §2b): the per-type edge counts and the eleven-term closure come from the ARM over the same population. This file never calls analyze(), so the §2b degraded-analyzer trap does not apply to it.",
    "BOTH EMBEDDING HALVES ARE COUNTED: struct embedding (mixes_in) and interface embedding (extends). The halves are separate constructs with separate stored types; neither may be read as the other.",
    "THE DECORATES FALSIFIER IS MEASURED, NOT ASSERTED: every struct-tag key over the whole population is checked against the function/method names declared in the same file. A key that named a callable would refute the ontological disposition; the count is the falsifier.",
    "THE PART_OF FALSIFIER IS MEASURED: every //go:embed target token is classified, and the count naming a .go SOURCE file is the falsifier. Data inclusion is not compilation-unit inclusion.",
    "THE RENDERS ORACLE IS DRIVEN HERE AT FULL EXTENT: deriveGoRendersTruth (script/m14/go-truth.ts) is the lane's independent truth derivation, and this census is the committed instrument that exercises it over the whole admitted population — the lane gate's 'gated but unexercised' warning is answered by this run.",
    "NO REGEX over source text: every reading is a node type, a field, a named child, or a stored row. The tree is deleted after each file.",
  ],
}

/* ───────────────────────────────────────────────────── the verdict ── */

if (parsed !== sampled) {
  console.error(`THE RUN DID NOT READ THE SET IT CLAIMS — parsed ${parsed} of sampled ${sampled} (admitted ${pop.admitted}; failed ${failed}) ⇒ EXIT 5, no artifact written`)
  for (const s of failSamples) console.error(`  ${s.file}: ${s.error}`)
  process.exit(5)
}

writeFileSync(path.join(ROOT, OUT), JSON.stringify(artifact, null, 2) + "\n")

console.log("GO WHOLE-POPULATION CONSTRUCT CENSUS")
console.log(`population: ${artifact.population.populationLine}`)
console.log(`  corpus root ${CR}`)
console.log(`  tracked ${pop.tracked} · admitted ${pop.admitted} · over-cap ${pop.overCap} · tracked-but-absent ${pop.absent}`)
console.log(`  repos ${pop.repos} · repo entries ${pop.repoEntries} · symlinked directories followed ${pop.symlinkedDirsFollowed} · bytes ${(pop.bytes / 1024 / 1024).toFixed(1)} MB`)
console.log(`grammar: served sha256 ${wasmSha256} · named node types ${grammarNamedIds} id-instances (fleet rule: +ERROR/MISSING = ${grammarFleetCount}; ${grammarNamedCount} distinct spellings) over ${language.nodeTypeCount} ids · inventory validation/m14/measurements/go-grammar-nodes.json`)
console.log("")
const line = (label: string, r: SiteRow): void => {
  console.log(`  ${label.padEnd(52)} sites ${String(r.sites).padStart(8)} · files ${String(r.fileSet.size).padStart(6)} · repos ${String(r.repos.size).padStart(2)}`)
}
line("mixes_in  struct embedding (composed implementation)", counters.structEmbedding)
line("            … pointer / qualified / generic", counters.structEmbeddingPointer)
line("extends   interface embedding (method-set inclusion)", counters.interfaceEmbedding)
line("decorates struct-tag sites (annotations, near miss)", counters.structTagSites)
line("          … keys naming a declared callable (FALSIFIER)", counters.structTagKeysNamingDeclaredCallable)
line("          //go:embed directives", counters.goDirectiveEmbed)
line("          //go:generate directives", counters.goDirectiveGenerate)
line("          //go:linkname directives", counters.goDirectiveLinkname)
line("part_of   embed targets (data inclusion, near miss)", { sites: counters.embedTargetsTotal, fileSet: counters.goDirectiveEmbed.fileSet, repos: counters.goDirectiveEmbed.repos })
console.log(`  ${("part_of   embed target tokens (of which globs " + counters.embedTargetsGlob + ")").padEnd(52)} ${counters.embedTargetsTotal}`)
console.log(`  ${"part_of   .go-suffixed targets / literal (non-glob) .go targets".padEnd(52)} ${counters.embedTargetsEndingGoSource} / ${counters.embedTargetsLiteralGoSource}`)
line("renders   html/template importing files", counters.htmlTemplateFile)
line("          text/template importing files (IMPOSTOR class)", counters.textTemplateFile)
line("          template-execution call sites", counters.templateExecCallSites)
line("          published package-level template symbols", counters.templatePublishedSymbols)
line("          exec sites on a published symbol", counters.templateExecOnPublishedSymbol)
line("          exec sites NOT on a published symbol", counters.templateExecNotOnPublishedSymbol)
line("          RENDERS TRUTH ROWS (deriveGoRendersTruth)", counters.rendersTruthRows)
console.log("")
console.log(`artifact: ${OUT}`)
console.log("ANALYZER-SIDE edge counts and the eleven-term closure come from the ARM, not from this file (brief §2b).")
