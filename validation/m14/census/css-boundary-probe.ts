/**
 * M14 ONTOLOGY, PASS 2, third probe — the production boundary, and two corrections.
 *
 * ## Why this file exists
 *
 * `css-adversarial-probe.ts` reported 0 of 25,181 `isMediaScope` containment edges whose
 * contained rule falls outside the source scope symbol's range. That result was
 * VACUOUS, and the file says so in its own P2 line rather than leaving the number to be
 * quoted: the probe read the scope symbol's extent as `s.range.start.line`, and
 * `parseFile` returns NO `range` object at all — it flattens the range to top-level
 * `startLine` / `endLine` / `startIndex` / `endIndex`. Every lookup therefore missed,
 * every edge took the `if (!sym) continue` branch, and 0 violations is what a broken
 * probe also returns.
 *
 * Chasing that miss produced the finding this file is really about.
 *
 * ## THE FINDING: CSS at-rule metadata does not survive the production boundary
 *
 * `src/ast/pool-worker.ts` rebuilds every symbol and forwards a DELIBERATELY NARROW
 * allowlist of `metadata` keys (its own comment: "Deliberately NARROW, and deliberately
 * CSS-only… the keys below are the ones the CSS lane's F6/F8/CC1 checks read"). The
 * allowlist carries `isAtRule` and `atKeyword`. It does NOT carry `isMediaScope`,
 * `mediaCondition`, `isSupportsScope`, `isContainerScope`, `isLayerScope`,
 * `isScopeScope`, `isCounterStyleDeclaration`, `isCustomMediaDeclaration`,
 * `isFontFeatureValuesDeclaration` or `isPropertyRegistration`.
 *
 * The observable consequence, measured here: an `@font-face` symbol arrives from
 * `parseFile` still carrying `isAtRule` and `atKeyword`, while an `@media` scope symbol
 * arrives with `metadata` UNDEFINED. So at the production entry point a media scope is
 * distinguishable from a layer scope only by the literal `@media ` in its NAME, and the
 * condition text the analyzer published is gone. The `pool-worker.ts` file is SHARED
 * machinery this lane does not own, so this is written up as a report with the exact
 * keys and the exact counts rather than patched.
 *
 * `analyze()` -> `parseFile` key survival is measured per file here, which is the only
 * place the difference is visible: a fixture calls `parseFile` too, but no fixture
 * asserts a media scope's metadata, which is why the suite is green.
 *
 * ## The two corrections
 *
 *   P2 (redone). Identify a scope symbol by its NAME PREFIX rather than by a metadata
 *   flag — the flags are exactly what the boundary drops, so keying on them cannot work
 *   here — and read the extent from the flattened `startLine` / `endLine`. This is the
 *   same question as before, asked in a way that can return non-zero.
 *
 *   Q1 (redone). `css-adversarial-followup.ts` decided "is this `uses` edge a
 *   fabrication?" by testing whether the edge's TARGET string appeared in the
 *   declaration text. The target is the SYMBOL name `@font-face Font Awesome 6 Free`
 *   while the declaration reads `var(--fa-style-family, "Font Awesome 6 Free")`, so the
 *   substring test could never match and 4 edges were reported as having "no literal
 *   fallback" when all four are a fallback. The test now strips the symbol-name prefix
 *   first. This is recorded because a probe that manufactures a finding is worse than no
 *   probe: it costs a reader a real defect hunt.
 *
 * ## READ-ONLY. Writes nothing but the optional `--json`.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../src/ast/language-detection"
import { parseFile } from "../../../src/ast/pool-worker"
import { RealCssAnalyzer } from "../../../src/ast/real-css-analyzer"
import { loadWebTreeSitter, resolveWasmAsset } from "../../../src/util/wasm"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"

type File = { repo: string; dir: string; rel: string; abs: string }
const files: File[] = []
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    continue
  }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch {
    continue
  }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    try {
      if (statSync(abs).size > 512 * 1024) continue
      if (statSync(abs).size === 0) continue
      if (detectLanguageFromPath(abs) !== "css") continue
    } catch {
      continue
    }
    files.push({ repo: e, dir, rel, abs })
  }
}
files.sort((a, b) => (a.repo + a.rel < b.repo + b.rel ? -1 : 1))
const repos = new Set(files.map((f) => f.repo))
const label = (f: File): string => `${f.repo}/${f.rel}`

await loadWebTreeSitter()
if (files.length > 0) await parseFile(files[0].abs, files[0].dir)
const wts: any = await loadWebTreeSitter()
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
const cssParser = new WSP()
cssParser.setLanguage(await WSL.load(new Uint8Array(readFileSync(resolveWasmAsset("tree-sitter-css/tree-sitter-css.wasm")))))

/** The at-rule scope name prefixes `parseFile` still lets a reader key on. */
const SCOPE_PREFIXES = ["@media ", "@supports ", "@layer ", "@container ", "@scope "]
/** edge metadata flag -> the name prefix of the symbol that flag describes. */
const FLAG_TO_PREFIX: Record<string, string> = {
  isMediaScope: "@media ",
  isSupportsScope: "@supports ",
  isLayerScope: "@layer ",
  isContainerScope: "@container ",
  isScopeScope: "@scope ",
}

const boundary = {
  keysEmittedByAnalyze: new Map<string, number>(),
  keysSurvivingParseFile: new Map<string, number>(),
  symbolsFromAnalyze: 0,
  symbolsFromParseFile: 0,
  /** symbols whose metadata is non-empty at analyze() and ABSENT at parseFile. */
  symbolsLosingAllMetadata: 0,
  /** ...of those, how many are at-rule scope symbols (name starts with a scope prefix). */
  scopeSymbolsLosingAllMetadata: 0,
  scopeSymbolsTotal: 0,
  filesWithAScopeSymbolLosingAllMetadata: 0,
  witnesses: [] as any[],
}

const p2: Record<string, { edges: number; lineOutsideRange: number; symbolNotFound: number; noLine: number }> = {}
for (const f of Object.keys(FLAG_TO_PREFIX)) p2[f] = { edges: 0, lineOutsideRange: 0, symbolNotFound: 0, noLine: 0 }
const p2Samples: any[] = []

const q1 = { edgesOnVarFontFamily: 0, targetIsTheVarFallback: 0, targetNotTheVarFallback: 0, cases: [] as any[] }
const q3 = { occurrences: 0, files: 0, occurrencesWithEqualImportance: 0, occurrencesWithDifferingImportance: 0, cases: [] as any[] }

const collapse = (s: string): string => s.trim().replace(/\s+/g, " ")
const stripQ = (s: string): string => {
  let out = s.trim()
  while (out.length >= 2 && (out[0] === '"' || out[0] === "'") && out[out.length - 1] === out[0]) out = out.slice(1, -1)
  return out
}

let cursor = 0
async function worker(): Promise<void> {
  while (true) {
    const i = cursor++
    if (i >= files.length) return
    const f = files[i]
    const lbl = label(f)
    let text: string
    let tree: any
    let pf: any
    try {
      text = readFileSync(f.abs, "utf8")
      tree = cssParser.parse(text)
      pf = await parseFile(f.abs, f.dir)
    } catch {
      continue
    }
    let an: any
    try {
      an = new RealCssAnalyzer().analyze(tree.rootNode, text, f.abs)
    } catch {
      continue
    }

    const aSyms: any[] = an.symbols ?? []
    const pSyms: any[] = pf.symbols ?? []
    boundary.symbolsFromAnalyze += aSyms.length
    boundary.symbolsFromParseFile += pSyms.length
    const pByName = new Map<string, any>()
    for (const s of pSyms) {
      const nm = String(s.name ?? "")
      if (nm.length > 0 && !pByName.has(nm)) pByName.set(nm, s)
    }
    let sawScopeLoss = false
    for (const s of aSyms) {
      const md = (s.metadata ?? {}) as Record<string, unknown>
      for (const k of Object.keys(md)) {
        boundary.keysEmittedByAnalyze.set(k, (boundary.keysEmittedByAnalyze.get(k) ?? 0) + 1)
      }
      const nm = String(s.name ?? "")
      const isScope = SCOPE_PREFIXES.some((p) => nm.startsWith(p))
      if (isScope) boundary.scopeSymbolsTotal++
      const p = pByName.get(nm)
      if (!p) continue
      const pm = (p.metadata ?? {}) as Record<string, unknown>
      for (const k of Object.keys(pm)) {
        boundary.keysSurvivingParseFile.set(k, (boundary.keysSurvivingParseFile.get(k) ?? 0) + 1)
      }
      const aHas = Object.keys(md).length > 0
      const pHas = Object.keys(pm).length > 0
      if (!aHas || pHas) continue
      boundary.symbolsLosingAllMetadata++
      if (isScope) {
        boundary.scopeSymbolsLosingAllMetadata++
        sawScopeLoss = true
        if (boundary.witnesses.length < 10) {
          boundary.witnesses.push({
            file: lbl,
            symbol: nm,
            kindAtParseFile: p.kind,
            analyzeMetadata: md,
            parseFileMetadata: pm,
          })
        }
      }
    }
    if (sawScopeLoss) boundary.filesWithAScopeSymbolLosingAllMetadata++

    // ---------------- P2, redone: extent from the FLATTENED range, scope by name prefix
    for (const rel of (pf.relationships ?? [])) {
      const md = (rel.metadata ?? {}) as Record<string, unknown>
      for (const [flag, prefix] of Object.entries(FLAG_TO_PREFIX)) {
        if (md[flag] !== true) continue
        const row = p2[flag]
        row.edges++
        const src = String(rel.source ?? "")
        const sym = pByName.get(src)
        if (!sym || !src.startsWith(prefix)) {
          row.symbolNotFound++
          continue
        }
        const line = typeof rel.line_number === "number" ? rel.line_number : undefined
        if (line === undefined) {
          row.noLine++
          continue
        }
        const start = Number(sym.startLine ?? -1)
        const end = Number(sym.endLine ?? -1)
        if (start < 0 || end < 0) {
          row.symbolNotFound++
          continue
        }
        if (line < start || line > end) {
          row.lineOutsideRange++
          if (p2Samples.length < 20) {
            p2Samples.push({ file: lbl, flag, scope: src, target: String(rel.target ?? ""), edgeLine: line, symbolRange: `L${start}-L${end}` })
          }
        }
      }
    }

    // ---------------- Q1, redone: the fallback test on the FAMILY, not the symbol name
    {
      const varRanges: { start: number; end: number; text: string }[] = []
      const declaredFamilies = new Set<string>()
      const st: any[] = [tree.rootNode]
      while (st.length > 0) {
        const n = st.pop()
        if (n.type === "font_face_statement" || n.type === "declaration") {
          const decl = n.type === "declaration" ? n : undefined
          if (decl) {
            const pn = decl.childForFieldName?.("name") ?? decl.namedChild(0)
            if (pn && pn.type === "property_name" && pn.text.trim().toLowerCase() === "font-family") {
              const v = decl.childForFieldName?.("value") ?? decl.namedChild(1)
              if (v && v.text.indexOf("var(") !== -1) {
                varRanges.push({
                  start: Number(decl.startPosition?.row ?? 0) + 1,
                  end: Number(decl.endPosition?.row ?? 0) + 1,
                  text: collapse(v.text),
                })
              }
            }
          } else {
            const inner: any[] = [n]
            while (inner.length > 0) {
              const d = inner.pop()
              if (d.type === "declaration") {
                const pn = d.childForFieldName?.("name") ?? d.namedChild(0)
                if (pn && pn.type === "property_name" && pn.text.trim().toLowerCase() === "font-family") {
                  const v = d.childForFieldName?.("value") ?? d.namedChild(1)
                  if (v) declaredFamilies.add(stripQ(v.text))
                }
              }
              for (let k = d.namedChildCount - 1; k >= 0; k--) {
                const c = d.namedChild(k)
                if (c) inner.push(c)
              }
            }
          }
        }
        for (let k = n.namedChildCount - 1; k >= 0; k--) {
          const c = n.namedChild(k)
          if (c) st.push(c)
        }
      }
      for (const rel of (pf.relationships ?? [])) {
        const md = (rel.metadata ?? {}) as Record<string, unknown>
        if (md.isFontFamilyRef !== true) continue
        const line = typeof rel.line_number === "number" ? rel.line_number : -1
        const hit = varRanges.find((v) => line >= v.start && line <= v.end)
        if (!hit) continue
        q1.edgesOnVarFontFamily++
        // The symbol is published as `@font-face <Family>`; the declaration names
        // `<Family>`. Compare the FAMILY, which is the part the author wrote.
        const rawTarget = String(rel.target ?? "")
        const family = rawTarget.startsWith("@font-face ") ? rawTarget.slice("@font-face ".length) : rawTarget
        const varAt = hit.text.indexOf("var(")
        const famAt = hit.text.indexOf(family)
        const isFallback = varAt !== -1 && famAt > varAt
        if (isFallback) q1.targetIsTheVarFallback++
        else q1.targetNotTheVarFallback++
        if (q1.cases.length < 12) {
          q1.cases.push({
            file: lbl,
            declaration: hit.text.slice(0, 120),
            edge: `${rel.source} -> ${rawTarget} @L${line}`,
            familyIsDeclaredByThisFilesFontFace: declaredFamilies.has(family),
            familyIsTheVarFallback: isFallback,
          })
        }
      }
    }

    // ---------------- Q3: `--x` twice in ONE declaration block, importance-aware
    let here = 0
    {
      const st: any[] = [tree.rootNode]
      const visitBlock = (n: any): void => {
        const seen = new Map<string, { line: number; value: string; important: boolean }>()
        const inner: any[] = [n]
        while (inner.length > 0) {
          const d = inner.pop()
          if (d.type === "declaration") {
            const pn = d.childForFieldName?.("name") ?? d.namedChild(0)
            if (pn && pn.type === "property_name") {
              const prop = pn.text.trim()
              if (prop.startsWith("--")) {
                const line = Number(d.startPosition?.row ?? 0) + 1
                const important = d.text.indexOf("!important") !== -1
                const v = d.childForFieldName?.("value") ?? d.namedChild(1)
                const prior = seen.get(prop)
                if (prior) {
                  here++
                  if (prior.important === important) q3.occurrencesWithEqualImportance++
                  else q3.occurrencesWithDifferingImportance++
                  if (q3.cases.length < 24) {
                    q3.cases.push({
                      file: lbl,
                      blockLine: Number(n.startPosition?.row ?? 0) + 1,
                      property: prop,
                      first: `L${prior.line}${prior.important ? " !important" : ""} = ${prior.value.slice(0, 44)}`,
                      second: `L${line}${important ? " !important" : ""} = ${collapse(v?.text ?? "").slice(0, 44)}`,
                    })
                  }
                } else {
                  seen.set(prop, { line, value: collapse(v?.text ?? ""), important })
                }
              }
            }
          }
          for (let k = d.namedChildCount - 1; k >= 0; k--) {
            const c = d.namedChild(k)
            if (c) inner.push(c)
          }
        }
      }
      while (st.length > 0) {
        const n = st.pop()
        // ONLY a `rule_set` or `keyframe_block` IS a declaration block. `@media` bodies
        // are `rule_set`s and get visited on their own, so recursing into every node
        // here and then visiting each nested block again would count a nested block's
        // declarations twice — which is how the first probe undercounted (85) against
        // this shape's true 106.
        if (n.type === "rule_set" || n.type === "keyframe_block") {
          visitBlock(n)
          for (let k = n.namedChildCount - 1; k >= 0; k--) {
            const c = n.namedChild(k)
            if (c) st.push(c)
          }
          continue
        }
        for (let k = n.namedChildCount - 1; k >= 0; k--) {
          const c = n.namedChild(k)
          if (c) st.push(c)
        }
      }
    }
    if (here > 0) {
      q3.occurrences += here
      q3.files++
    }
  }
}
await Promise.all(Array.from({ length: 2 }, () => worker()))

const dropped = [...boundary.keysEmittedByAnalyze.entries()]
  .filter(([k]) => !boundary.keysSurvivingParseFile.has(k))
  .sort((a, b) => b[1] - a[1])
const out = {
  files: files.length,
  repos: repos.size,
  boundary: {
    symbolsFromAnalyze: boundary.symbolsFromAnalyze,
    symbolsFromParseFile: boundary.symbolsFromParseFile,
    keysEmittedByAnalyze: Object.fromEntries([...boundary.keysEmittedByAnalyze.entries()].sort((a, b) => b[1] - a[1])),
    keysSurvivingParseFile: Object.fromEntries([...boundary.keysSurvivingParseFile.entries()].sort((a, b) => b[1] - a[1])),
    droppedKeys: Object.fromEntries(dropped),
    symbolsLosingAllMetadata: boundary.symbolsLosingAllMetadata,
    scopeSymbolsTotal: boundary.scopeSymbolsTotal,
    scopeSymbolsLosingAllMetadata: boundary.scopeSymbolsLosingAllMetadata,
    filesWithAScopeSymbolLosingAllMetadata: boundary.filesWithAScopeSymbolLosingAllMetadata,
  },
  p2,
  q1,
  q3,
}
const jsonArg = process.argv.indexOf("--json")
if (jsonArg !== -1 && process.argv[jsonArg + 1]) writeFileSync(process.argv[jsonArg + 1], JSON.stringify(out, null, 2) + "\n")

console.log(`css boundary probe — ${files.length} admitted files across ${repos.size} repos`)
console.log("")
console.log("BOUNDARY  analyze() metadata keys -> parseFile")
console.log(`  symbols ${boundary.symbolsFromAnalyze} from analyze(), ${boundary.symbolsFromParseFile} from parseFile`)
console.log("  keys DROPPED at the boundary (occurrences at analyze, key -> count):")
for (const [k, v] of dropped) console.log(`    ${k.padEnd(32)}${v}`)
console.log(`  symbols with metadata at analyze() and NONE at parseFile: ${boundary.symbolsLosingAllMetadata}`)
console.log(`  ...of which at-rule SCOPE symbols (name starts @media/@supports/@layer/@container/@scope): ${boundary.scopeSymbolsLosingAllMetadata} of ${boundary.scopeSymbolsTotal} total`)
console.log(`  files with at least one such symbol: ${boundary.filesWithAScopeSymbolLosingAllMetadata}`)
for (const c of boundary.witnesses.slice(0, 3)) {
  console.log(`    ${c.file}\n      symbol ${JSON.stringify(c.symbol)} kind ${c.kindAtParseFile}\n      analyze()  metadata ${JSON.stringify(c.analyzeMetadata)}\n      parseFile metadata ${JSON.stringify(c.parseFileMetadata)}`)
}
console.log("")
console.log("P2 REDONE  contains — does a scope edge point at a range containing its target?")
for (const [flag, r] of Object.entries(p2)) {
  if (r.edges === 0) continue
  console.log(`  ${flag.padEnd(20)} edges ${String(r.edges).padStart(7)}  line outside range ${String(r.lineOutsideRange).padStart(6)}  symbol not found ${r.symbolNotFound}  no line ${r.noLine}   <- ${r.lineOutsideRange === 0 ? "clean" : "FINDING"}`)
}
for (const c of p2Samples) {
  console.log(`    ${c.file}\n      ${c.flag} ${JSON.stringify(c.scope)} contains ${JSON.stringify(c.target)} @L${c.edgeLine}, symbol range ${c.symbolRange}`)
}
console.log("")
console.log("Q1 REDONE  uses edges on a var()-valued font-family")
// The remaining caveat is the INSTRUMENT's, not the analyzer's, and it is stated here
// rather than left for the number to be read as a defect. An edge is attributed to a
// `var()`-valued `font-family` by matching its `line_number` against the declaration's
// line RANGE — which is sound in an ordinary stylesheet and unsound in a MINIFIED one,
// where every declaration in the file shares one line. `bulma/docs/vendor/
// fontawesome-free-6.5.2-web/css/all.min.css` is 9 lines and 103 KB. There, the edge
// `.fa-brands, .fab -> @font-face Font Awesome 6 Brands` is attributed to
// `font-family: var(--fa-style-family, "Font Awesome 6 Free")` while it in fact comes
// from a DIFFERENT declaration on the same line,
// `.fa-brands,.fab{font-family:"Font Awesome 6 Brands"}` (read out of the file directly).
// So the edge is correct and the attribution is wrong. Hand-verified against the file,
// not inferred.
console.log(`  edges ${q1.edgesOnVarFontFamily}  target IS the var() fallback ${q1.targetIsTheVarFallback}  target is NOT ${q1.targetNotTheVarFallback}`)
console.log(`  <- ${q1.targetNotTheVarFallback === 0 ? "clean" : "SEE THE CAVEAT BELOW: line-range attribution is unsound inside a minified file"}`)
console.log("  caveat: the attribution keys on the edge's line, which is exact for a normal stylesheet and")
console.log("  ambiguous in a minified one. Hand-checked against")
console.log("  bulma/docs/vendor/fontawesome-free-6.5.2-web/css/all.min.css (9 lines, 103 KB): the one edge")
console.log("  counted as 'not the fallback' is `.fa-brands,.fab -> @font-face Font Awesome 6 Brands`, and the")
console.log("  declaration it really comes from is `.fa-brands,.fab{font-family:\"Font Awesome 6 Brands\"}` —")
console.log("  a literal family on the same line, not the var() one. The edge is correct; the probe's")
console.log("  attribution is not. No `uses` fabrication was found in this lane.")
for (const c of q1.cases) {
  console.log(`    ${c.file}\n      declaration ${c.declaration}\n      edge        ${c.edge}\n      family declared by this file's @font-face: ${c.familyIsDeclaredByThisFilesFontFace}; family is the var() fallback: ${c.familyIsTheVarFallback}`)
}
console.log("")
console.log("Q3  --custom-property assigned twice inside ONE declaration block")
console.log(`  occurrences ${q3.occurrences} across ${q3.files} files; equal importance ${q3.occurrencesWithEqualImportance}, differing importance ${q3.occurrencesWithDifferingImportance}`)
for (const c of q3.cases) {
  console.log(`    ${c.file}  block@L${c.blockLine}\n      ${c.property}:  ${c.first}   THEN   ${c.second}`)
}