/**
 * M14 ONTOLOGY, PASS 2 — the ADVERSARIAL probe for the css lane.
 *
 * ## Why this file exists
 *
 * Pass 1 established the ten verdicts and asked the six questions. All six were
 * answered in the affirmative with numbers, and a lane that only ever asks "does it
 * fire?" never finds out whether the edges it fires are TRUE. Pass 2 asks the opposite
 * question of every emitted edge: assume the label is WRONG, then go looking for the
 * case that proves it.
 *
 * Every probe below states, before it runs, the result that would make it a FINDING.
 * A probe whose finding condition is not written down can only ever confirm.
 *
 * ## The five attacks and the verdict each is capable of reaching
 *
 *   P1 `references` — the doc claims every unresolved `references` edge is a
 *      cross-file `var()` read. Testable: if an unresolved edge names a custom property
 *      the SAME FILE declares, the claim is false and the edge is an in-file failure
 *      wearing a cross-file explanation.
 *      FINDING if `unresolvedButDeclaredInFile > 0`.
 *
 *   P2 `contains` — a `@media` / `@supports` / `@layer` / `@container` / `@scope` scope
 *      is published ONCE per NAME (first-wins), so a file carrying the same condition
 *      twice sends the rules of BOTH blocks to the FIRST block's symbol. The
 *      fingerprint needs no oracle: the edge carries the contained rule's line and the
 *      source symbol carries a text range. If the rule's line is not inside that range,
 *      the edge asserts a containment the file does not have, at a location a reader
 *      would not check.
 *      FINDING if `lineOutsideRange > 0`.
 *
 *   P3 `uses` — two shapes the emitter may get wrong: a `font-family` FALLBACK LIST
 *      (`"A", "B"`), where only the first family is the one a reader is tracking, and a
 *      `font-family: var(--x)`, where the family is not knowable at parse time and an
 *      edge would be an invention.
 *      FINDING if a `var()`-valued font-family emits an edge, or a list naming two
 *      LOCAL `@font-face` families emits fewer than two.
 *
 *   P4 `imports` — the doc says 0% resolution "is the same handling every other
 *      language's top-level cross-file import gets". That is a CLAIM ABOUT OTHER LANES
 *      and it is measurable: is the name the edge names a symbol this analyzer
 *      publishes? FINDING if never, because then 0% is a lane-specific gap rather than
 *      a property of the language.
 *
 *   P5 `overrides` — the only type with no oracle, so the only type where a wrong label
 *      survives every gate. Attacks: (a) are the override SHAPES the rule never reaches
 *      present on the corpus — a custom property assigned twice in one block, a
 *      declaration repeated in one block, the same selector text written twice in one
 *      file, the same `@font-face` family declared twice; (b) does the emitted edge
 *      point at the declaration the spec says wins.
 *
 * ## Two limits stated before the numbers
 *
 *   - P2 reads the ANALYZER's symbol table, not the store. The store binds by NAME, so
 *     it will happily bind both `.foo` edges to one media symbol. P2 therefore compares
 *     LINE against RANGE: it asks whether the EDGE is true where it points, which is a
 *     question about the edge and not about the resolver.
 *   - P1's "declared in file" test is the STRICT one — the target must EXACTLY equal a
 *     published symbol name. The census's `binds()` is looser (leaf-after-colon,
 *     `endsWith`), so P1's unresolved count and the census's differ by construction and
 *     both are printed.
 *
 * ## READ-ONLY
 *
 * Writes nothing but the optional `--json` report.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../src/ast/language-detection"
import { parseFile } from "../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"

// ------------------------------------------------------------------------ corpus
// The admission rule is `ontology-coverage-gate.ts`'s, COPIED for the reason the census
// gives: shared machinery may change under this lane, and a probe whose file set drifts
// with someone else's edit cannot falsify anything.
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
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
    })
      .split("\0")
      .filter(Boolean)
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

// The census's own resolver, so P1 reads against the number the doc quotes.
const bindsLoose = (name: string, names: Set<string>): boolean => {
  if (!name) return false
  if (names.has(name)) return true
  const noLine = name.replace(/:\d+$/, "")
  const segs = noLine.split(":").filter((s) => s.length > 0)
  const leaf = (segs[segs.length - 1] ?? "").split(".").pop() ?? ""
  if (leaf && names.has(leaf)) return true
  for (let i = 0; i < name.length; i++) {
    const c = name[i]
    if (c !== ":" && c !== ".") continue
    const tail = name.slice(i + 1)
    if (tail.length > 0 && names.has(tail)) return true
  }
  return false
}

type Sample = { file: string; detail: string }
const add = (list: Sample[], cap: number, file: string, detail: string): void => {
  if (list.length < cap) list.push({ file, detail })
}

// --- P1: references -----------------------------------------------------------
// The doc claims every unresolved `references` edge is a cross-file `var()` read. The
// test is NOT "is the target an exact published symbol name" — that is vacuous, because
// an exact symbol name binds by construction and so the two answers cannot disagree.
// The test that can fail is against the PARSE TREE: a `--x` the file WRITES is
// declared here whatever the analyzer chose to publish, so an edge naming it is an
// in-file dependency, not a cross-file one.
const p1 = {
  variableRefEdges: 0,
  unresolvedLoose: 0,
  unresolvedButWrittenInThisFile: 0, // <-- the finding condition
  filesWithAWrittenButUnpublishedProp: 0,
  filesReadingAPropertyTheyWriteUnresolved: 0, // distinct (file, property) pairs
  resolvedButNotAnExactName: 0,
  otherRefEdges: 0,
  otherUnresolvedLoose: 0,
}
const p1Samples: Sample[] = []

// --- P2: contains / scope containment ----------------------------------------
const SCOPE_FLAGS = ["isMediaScope", "isSupportsScope", "isLayerScope", "isContainerScope", "isScopeScope"]
const p2: Record<string, { edges: number; lineOutsideRange: number; noLine: number }> = {}
for (const f of SCOPE_FLAGS) p2[f] = { edges: 0, lineOutsideRange: 0, noLine: 0 }
const p2Samples: Sample[] = []

// --- P3: uses ----------------------------------------------------------------
const p3 = {
  animationEdges: 0,
  fontFamilyEdges: 0,
  fontFamilyVarValues: 0,
  fontFamilyVarEdges: 0, // <-- a var()-valued font-family emitting an edge is a fabrication
  fontFamilyListsWith2Local: 0,
  localFamiliesInThoseLists: 0,
  edgesFromThoseLists: 0, // <-- fewer than `localFamiliesInThoseLists` means the list was truncated
  genericOnlyLists: 0,
}
const p3Samples: Sample[] = []

// --- P4: imports -------------------------------------------------------------
const p4 = { edges: 0, srcIsPublishedSymbol: 0, filesWithResolvableSource: 0 }
const p4Samples: Sample[] = []

/** unresolved `var()` target -> edge count, and the file it was unresolved in. */
const unresolvedVarRef = new Map<string, number>()
const unresolvedInFile = new Map<string, Set<string>>()

// --- P5: overrides + the shapes it may be missing ----------------------------
const p5 = {
  edges: 0,
  keyframesEdges: 0,
  propertyReregistrations: 0,
  filesWithRepeatedSelectorText: 0,
  repeatedSelectorGroups: 0,
  rulesInRepeatedSelectorGroups: 0,
  declRepeatedInOneBlock: 0,
  customPropAssignedTwiceInOneBlock: 0,
  filesWithCustomPropAssignedTwice: 0,
  fontFaceSameFamilyTwice: 0,
  counterStyleSameNameTwice: 0,
  customMediaSameNameTwice: 0,
  quotedKeyframesDeclarations: 0,
  commaListPropertyRule: 0,
}
const p5Samples: Sample[] = []

// --- lane-wide hygiene, re-measured rather than carried forward --------------
const hygiene = {
  filesParsed: 0,
  filesFailed: 0,
  symbols: 0,
  emptyName: 0,
  emptyKind: 0,
  placeholderEndpoint: 0,
  overrideSelfEdge: 0,
  overrideSelfEdgeDistinctSites: 0,
  overrideSupersedesLineNotBefore: 0,
}

const stripQ = (s: string): string => {
  let out = s.trim()
  while (out.length >= 2 && (out[0] === '"' || out[0] === "'") && out[out.length - 1] === out[0]) {
    out = out.slice(1, -1)
  }
  return out
}

// The tree walk must run in the SAME runtime state `parseFile` runs in, or a P1/P3/P5
// number describes a parser production does not have. Three things had to be got right
// and all three were wrong in earlier versions of this file, so each is recorded here
// rather than left as a mystery for whoever edits it next.
//
//  1. The grammar BYTES are `wasm/tree-sitter-css.wasm` — verified by sha256 against the
//     `/tmp/bb-wasm_tree-sitter-css_tree-sitter-css.wasm` the engine caches, and the only
//     css wasm on this machine.
//  2. `loadWebTreeSitter()` installs the WASI shim (`src/util/wasm.ts`) BEFORE importing
//     the runtime, and the init itself is done by `Parser.init` — web-tree-sitter 0.25.9
//     exports no top-level `init` (`loadWebTreeSitter`'s `initFn` is therefore undefined
//     and it silently relies on the engine having done it). A probe that imports
//     `web-tree-sitter` and calls `Parser.init` ITSELF gets neither the shim nor the
//     engine's core, and then `setLanguage` rejects the pinned css grammar with
//     "Incompatible language version 0. Compatibility range 13 through 15."
//  3. So the init is not duplicated here at all: ONE warm-up `parseFile` runs first,
//     which drives the engine's own memoised init. `new Parser()` after that is legal.
//
// Verified: after the warm-up, `setLanguage` on the same bytes succeeds and the tree has
// the production shape (`:root { --a: 1px } .x { color: var(--a) }` -> `stylesheet`).
const { loadWebTreeSitter, resolveWasmAsset } = await import("../../../src/util/wasm")
await loadWebTreeSitter()
if (files.length > 0) await parseFile(files[0].abs, files[0].dir)
const wts: any = await loadWebTreeSitter()
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
const cssParser = new WSP()
cssParser.setLanguage(await WSL.load(new Uint8Array(readFileSync(resolveWasmAsset("tree-sitter-css/tree-sitter-css.wasm")))))

let cursor = 0
async function worker(): Promise<void> {

  while (true) {
    const i = cursor++
    if (i >= files.length) return
    const f = files[i]
    const lbl = label(f)
    let r: any
    let tree: any
    let text: string
    try {
      text = readFileSync(f.abs, "utf8")
      r = await parseFile(f.abs, f.dir)
      tree = cssParser.parse(text)
    } catch {
      hygiene.filesFailed++
      continue
    }
    hygiene.filesParsed++
    if (hygiene.filesParsed % 50 === 0) {
      process.stderr.write(`  ...${hygiene.filesParsed}/${files.length}\n`)
    }
    const syms: any[] = r.symbols ?? []
    const rels: any[] = r.relationships ?? []
    hygiene.symbols += syms.length

    const exactNames = new Set<string>()
    const looseNames = new Set<string>()
    /** scope-flag symbol name -> the text range the analyzer gave it. */
    const scopeRange = new Map<string, { start: number; end: number }>()
    for (const s of syms) {
      if (String(s.kind ?? "").length === 0) hygiene.emptyKind++
      const nm = String(s.name ?? "")
      if (nm.trim().length === 0) {
        hygiene.emptyName++
        continue
      }
      exactNames.add(nm)
      looseNames.add(nm)
      if (s.scope) looseNames.add(`${s.scope}.${nm}`)
      const qn = s.qualifiedName
      if (typeof qn === "string" && qn.length > 0) looseNames.add(qn)
      const smd = (s.metadata ?? {}) as Record<string, unknown>
      for (const fl of SCOPE_FLAGS) {
        if (smd[fl] === true && !scopeRange.has(nm)) {
          const start = Number(s.range?.start?.line ?? 0)
          const end = Number(s.range?.end?.line ?? start)
          scopeRange.set(nm, { start, end })
        }
      }
    }

    // `uses` edges, by line, so P3 can ask how many came out of ONE declaration
    // without re-walking the value. Keyed by line because the font-family edge's
    // `line_number` is the VALUE's line (M59.A7), which is not the declaration's.
    const usesEdgeLines: number[] = []
    /** every `--x` the file WRITES, read off the tree. */
    const writtenProps = new Set<string>()

    for (const rel of rels) {
      const t = String(rel.type ?? rel.relationshipType ?? "").toLowerCase()
      const src = String(rel.source ?? rel.from ?? "")
      const tgt = String(rel.target ?? rel.to ?? "")
      const md = (rel.metadata ?? {}) as Record<string, unknown>
      const line = typeof rel.line_number === "number" ? rel.line_number : undefined
      if (src.length === 0 || tgt.length === 0 || src === "unknown" || tgt === "unknown") hygiene.placeholderEndpoint++

      if (t === "references") {
        if (md.isVariableRef === true) {
          p1.variableRefEdges++
          if (!bindsLoose(tgt, looseNames)) {
            p1.unresolvedLoose++
            unresolvedVarRef.set(tgt, (unresolvedVarRef.get(tgt) ?? 0) + 1)
            const f = unresolvedInFile.get(lbl) ?? new Set<string>()
            f.add(tgt)
            unresolvedInFile.set(lbl, f)
          } else if (!exactNames.has(tgt)) {
            p1.resolvedButNotAnExactName++
          }
        } else {
          p1.otherRefEdges++
          if (!bindsLoose(tgt, looseNames)) p1.otherUnresolvedLoose++
        }
      } else if (t === "contains") {
        for (const fl of SCOPE_FLAGS) {
          if (md[fl] !== true) continue
          const row = p2[fl]
          row.edges++
          const sym = scopeRange.get(src)
          if (!sym) continue
          if (line === undefined) {
            row.noLine++
            continue
          }
          if (line < sym.start || line > sym.end) {
            row.lineOutsideRange++
            add(
              p2Samples,
              25,
              lbl,
              `${fl} ${JSON.stringify(src)} contains ${JSON.stringify(tgt)} @L${line}, but ${JSON.stringify(src)}'s range is L${sym.start}-L${sym.end}`,
            )
          }
        }
      } else if (t === "uses") {
        if (md.isAnimationRef === true) p3.animationEdges++
        else if (md.isFontFamilyRef === true) {
          p3.fontFamilyEdges++
          if (line !== undefined) usesEdgeLines.push(line)
        }
      } else if (t === "imports") {
        p4.edges++
        if (exactNames.has(src) || looseNames.has(src)) {
          p4.srcIsPublishedSymbol++
          p4.filesWithResolvableSource++
        } else if (p4Samples.length < 8) {
          p4Samples.push({ file: lbl, detail: `source ${JSON.stringify(src)} is not a symbol in this file` })
        }
      } else if (t === "overrides") {
        p5.edges++
        if (md.isPropertyReregistration === true) p5.propertyReregistrations++
        else p5.keyframesEdges++
        if (src === tgt) {
          hygiene.overrideSelfEdge++
          if (md.distinctSites === true) hygiene.overrideSelfEdgeDistinctSites++
        }
        const sup = md.supersedesLine
        if (typeof sup === "number" && line !== undefined && !(sup < line)) hygiene.overrideSupersedesLineNotBefore++
      }
    }

    // ============================== tree probes ==============================
    const nameOf = (n: any, field: string, alt: string): string | null => {
      const c = n.childForFieldName?.(field) ?? n.namedChild(alt === "0" ? 0 : 1)
      return c ? c.text : null
    }
    const walk = (fn: (n: any) => void): void => {
      const st: any[] = [tree.rootNode]
      while (st.length > 0) {
        const n = st.pop()
        fn(n)
        for (let k = n.namedChildCount - 1; k >= 0; k--) {
          const c = n.namedChild(k)
          if (c) st.push(c)
        }
      }
    }

    // Every `--x` the file WRITES. Read off the tree rather than off the analyzer's
    // symbol list, which is the whole point: the question is whether the analyzer
    // published what the file declared.
    walk((n) => {
      if (n.type !== "property_name") return
      const t = n.text.trim()
      if (!t.startsWith("--")) return
      writtenProps.add(t)
    })
    if (writtenProps.size > 0 && exactNames.size > 0) {
      let unpublished = 0
      for (const t of writtenProps) if (!exactNames.has(t)) unpublished++
      if (unpublished > 0) {
        p1.filesWithAWrittenButUnpublishedProp++
        add(p1Samples, 20, lbl, `${unpublished} of ${writtenProps.size} custom properties this file WRITES are not published as symbols`)
      }
    }
    // The finding condition, tested per file: this file writes `--x` AND emits a
    // `references` edge naming `--x` that does not resolve.
    const unresHere = unresolvedInFile.get(lbl)
    if (unresHere) {
      for (const t of unresHere) {
        if (!writtenProps.has(t)) continue
        p1.filesReadingAPropertyTheyWriteUnresolved++
        p1.unresolvedButWrittenInThisFile += unresolvedVarRef.get(t) ?? 0
        add(p1Samples, 20, lbl, `${t} is WRITTEN in this file and READ unresolved ${unresolvedVarRef.get(t)}x`)
      }
    }

    // families this file declares with @font-face
    const fontFaceFamilies = new Map<string, number>()
    walk((n) => {
      if (n.type !== "font_face_statement") return
      const st: any[] = [n]
      while (st.length > 0) {
        const d = st.pop()
        if (d.type === "declaration") {
          const pn = d.childForFieldName?.("name") ?? d.namedChild(0)
          if (pn && pn.type === "property_name" && pn.text.trim().toLowerCase() === "font-family") {
            const v = d.childForFieldName?.("value") ?? d.namedChild(1)
            if (v) {
              const fam = stripQ(v.text)
              fontFaceFamilies.set(fam, (fontFaceFamilies.get(fam) ?? 0) + 1)
            }
          }
        }
        for (let k = d.namedChildCount - 1; k >= 0; k--) {
          const c = d.namedChild(k)
          if (c) st.push(c)
        }
      }
    })
    let fontFaceDupes = 0
    for (const [, c] of fontFaceFamilies) if (c > 1) fontFaceDupes++
    p5.fontFaceSameFamilyTwice += fontFaceDupes

    // at-rules: counter-style / custom-media repetition, quoted @keyframes, comma @property
    const seenCounter = new Set<string>()
    const seenCustomMedia = new Set<string>()
    walk((n) => {
      if (n.type === "keyframes_statement") {
        const nm = nameOf(n, "name", "1")
        if (nm && nm.length > 1 && (nm[0] === '"' || nm[0] === "'")) p5.quotedKeyframesDeclarations++
      }
      if (n.type !== "at_rule") return
      const kw = ((n.childForFieldName?.("at_keyword")?.text ?? n.text.split(/\s/)[0]) ?? "")
        .replace(/^@/, "")
        .toLowerCase()
      const prelude = (n.childForFieldName?.("prelude")?.text ?? "").trim()
      if (kw === "counter-style") {
        const nm = prelude.split(/\s+/)[0] ?? ""
        if (nm) {
          if (seenCounter.has(nm)) p5.counterStyleSameNameTwice++
          seenCounter.add(nm)
        }
      } else if (kw === "custom-media") {
        const first = prelude.split(/\s+/)[0] ?? ""
        if (first.startsWith("--")) {
          if (seenCustomMedia.has(first)) p5.customMediaSameNameTwice++
          seenCustomMedia.add(first)
        }
      } else if (kw === "property") {
        // Current ED: "a registration for each <custom-property-name> in the rule's prelude".
        const names = prelude.split(",").map((s) => s.trim()).filter((s) => s.startsWith("--"))
        if (names.length > 1) {
          p5.commaListPropertyRule++
          add(p5Samples, 10, lbl, `@property prelude names ${names.length} properties in ONE rule: ${prelude.slice(0, 90)}`)
        }
      }
    })

    // selector text multiplicity + duplicate declarations inside one block
    const selTextCount = new Map<string, number>()
    walk((n) => {
      if (n.type !== "rule_set") return
      const s = n.childForFieldName?.("selectors") ?? n.namedChild(0)
      if (s && s.type === "selectors") {
        const txt = s.text.trim()
        selTextCount.set(txt, (selTextCount.get(txt) ?? 0) + 1)
      }
    })
    let groups = 0
    let rules = 0
    for (const [, c] of selTextCount) {
      if (c > 1) {
        groups++
        rules += c
      }
    }
    if (groups > 0) {
      p5.filesWithRepeatedSelectorText++
      p5.repeatedSelectorGroups += groups
      p5.rulesInRepeatedSelectorGroups += rules
      if (groups <= 2) add(p5Samples, 20, lbl, `${groups} selector text(s) written more than once in this file`)
    }

    let customPropTwice = 0
    walk((n) => {
      if (n.type !== "rule_set" && n.type !== "keyframe_block" && n.type !== "keyframes_statement") return
      const per = new Map<string, number>()
      const st: any[] = [n]
      while (st.length > 0) {
        const d = st.pop()
        if (d.type === "declaration") {
          const pn = d.childForFieldName?.("name") ?? d.namedChild(0)
          if (pn && pn.type === "property_name") {
            const p = pn.text.trim()
            per.set(p, (per.get(p) ?? 0) + 1)
          }
        }
        for (let k = d.namedChildCount - 1; k >= 0; k--) {
          const c = d.namedChild(k)
          if (c) st.push(c)
        }
      }
      for (const [prop, c] of per) {
        if (c < 2) continue
        if (prop.startsWith("--")) {
          customPropTwice++
          add(p3Samples, 15, lbl, `${prop} assigned ${c}x inside ONE block — a same-scope redefinition`)
        } else p5.declRepeatedInOneBlock++
      }
    })
    if (customPropTwice > 0) {
      p5.customPropAssignedTwiceInOneBlock += customPropTwice
      p5.filesWithCustomPropAssignedTwice++
    }

    // `font-family` value shapes
    walk((n) => {
      if (n.type !== "declaration") return
      const pn = n.childForFieldName?.("name") ?? n.namedChild(0)
      if (!pn || pn.type !== "property_name") return
      if (pn.text.trim().toLowerCase() !== "font-family") return
      const v = n.childForFieldName?.("value") ?? n.namedChild(1)
      if (!v) return
      const txt = v.text
      // The edge's `line_number` is the VALUE's line, so the declaration's own line is
      // the right key only when they coincide. Counting over the declaration's whole
      // line range is the shape that cannot miss a multi-line value.
      const dStart = Number(n.startPosition?.row ?? 0) + 1
      const dEnd = Number(n.endPosition?.row ?? n.startPosition?.row ?? 0) + 1
      const edgesHere = usesEdgeLines.filter((l) => l >= dStart && l <= dEnd).length
      if (txt.indexOf("var(") !== -1) {
        p3.fontFamilyVarValues++
        if (edgesHere > 0) {
          p3.fontFamilyVarEdges += edgesHere
          add(p3Samples, 10, lbl, `font-family: ${txt.slice(0, 60)} emitted ${edgesHere} uses edge(s) — the family is not knowable here`)
        }
      }
      const fams = txt.split(",").map((s) => stripQ(s)).filter((s) => s.length > 0)
      const local = fams.filter((x) => fontFaceFamilies.has(x))
      if (local.length >= 2) {
        p3.fontFamilyListsWith2Local++
        p3.localFamiliesInThoseLists += local.length
        p3.edgesFromThoseLists += edgesHere
        add(p3Samples, 10, lbl, `font-family: ${txt.slice(0, 70)} names ${local.length} local families, emitted ${edgesHere}`)
      } else if (fams.length >= 2 && local.length === 0) {
        p3.genericOnlyLists++
      }
    })
  }
}
// Two workers, not eight: this process holds the engine's parser pool AND one parser
// per worker for the tree walk, and it shares a 15 GB box with every other lane's agent.
// The first version ran four and was killed without a report (no stdout, no stack, no
// JSON) partway through the corpus, which is a resource death and not a result — so the
// worker count is deliberately low and progress is printed so a silent death is visible.
await Promise.all(Array.from({ length: 2 }, () => worker()))

// ---------------------------------------------------------------------- report
const out = { p1, p2, p3, p4, p5, hygiene, files: files.length, repos: repos.size }
const jsonArg = process.argv.indexOf("--json")
if (jsonArg !== -1 && process.argv[jsonArg + 1]) writeFileSync(process.argv[jsonArg + 1], JSON.stringify(out, null, 2) + "\n")
const verdict = (n: number): string => (n === 0 ? "clean" : `FINDING (${n})`)
console.log(`css adversarial probe — ${files.length} admitted files across ${repos.size} repos`)
console.log(`parsed ${hygiene.filesParsed}, failed ${hygiene.filesFailed}, symbols ${hygiene.symbols}`)
console.log("")
console.log("P1  references — is every unresolved edge really a cross-file read?")
console.log(`    var() edges                          ${p1.variableRefEdges}`)
console.log(`    unresolved (census resolver)          ${p1.unresolvedLoose}`)
console.log(`    ...naming a property THIS FILE writes ${p1.unresolvedButWrittenInThisFile}   <- ${verdict(p1.unresolvedButWrittenInThisFile)}`)
console.log(`    ...across ${p1.filesReadingAPropertyTheyWriteUnresolved} (file, property) pairs`)
console.log(`    files writing >=1 custom property the analyzer does not publish: ${p1.filesWithAWrittenButUnpublishedProp}`)
console.log(`    resolved but not an exact symbol name ${p1.resolvedButNotAnExactName}`)
console.log(`    non-var references ${p1.otherRefEdges}, unresolved ${p1.otherUnresolvedLoose}`)
console.log("")
console.log("P2  contains — does a scope edge point at a range that contains its target?")
for (const fl of SCOPE_FLAGS) {
  const r = p2[fl]
  if (r.edges === 0) continue
  console.log(
    `    ${fl.padEnd(20)} edges ${String(r.edges).padStart(7)}   line outside source range ${String(r.lineOutsideRange).padStart(6)}   no line ${r.noLine}   <- ${verdict(r.lineOutsideRange)}`,
  )
}
console.log("")
console.log("P3  uses — font-family / animation value shapes")
console.log(`    animation edges                     ${p3.animationEdges}`)
console.log(`    font-family edges                   ${p3.fontFamilyEdges}`)
console.log(`    var()-valued font-family values ${p3.fontFamilyVarValues}, edges emitted from one ${p3.fontFamilyVarEdges}  <- ${verdict(p3.fontFamilyVarEdges)}`)
console.log(`    font-family lists naming 2+ LOCAL @font-face families: ${p3.fontFamilyListsWith2Local}, local families across them ${p3.localFamiliesInThoseLists}, edges emitted ${p3.edgesFromThoseLists}`)
console.log(`    font-family lists naming 0 local families (fallbacks/generics) ${p3.genericOnlyLists}`)
console.log("")
console.log("P4  imports — is the source a published symbol?")
console.log(`    edges ${p4.edges}, source is a published symbol ${p4.srcIsPublishedSymbol}, files with a resolvable source ${p4.filesWithResolvableSource}  <- ${verdict(p4.edges > 0 && p4.srcIsPublishedSymbol === 0 ? 1 : 0)}`)
console.log("")
console.log("P5  overrides — the type with no oracle")
console.log(`    edges ${p5.edges} (keyframes ${p5.keyframesEdges}, @property re-registrations ${p5.propertyReregistrations})`)
console.log(`    selector text written >1x: ${p5.filesWithRepeatedSelectorText} files, ${p5.repeatedSelectorGroups} groups, ${p5.rulesInRepeatedSelectorGroups} rules`)
console.log(`    a non-custom property repeated inside ONE block ${p5.declRepeatedInOneBlock}`)
console.log(`    a --custom-prop assigned twice inside ONE block ${p5.customPropAssignedTwiceInOneBlock} across ${p5.filesWithCustomPropAssignedTwice} files`)
console.log(`    @font-face family twice ${p5.fontFaceSameFamilyTwice}, @counter-style name twice ${p5.counterStyleSameNameTwice}, @custom-media name twice ${p5.customMediaSameNameTwice}`)
console.log(`    @keyframes declared with a QUOTED name ${p5.quotedKeyframesDeclarations}, @property prelude naming 2+ properties ${p5.commaListPropertyRule}`)
console.log("")
console.log("hygiene")
console.log(`    empty symbol name ${hygiene.emptyName}   empty kind ${hygiene.emptyKind}   placeholder endpoint ${hygiene.placeholderEndpoint}`)
console.log(`    overrides self-edges ${hygiene.overrideSelfEdge}, distinctSites ${hygiene.overrideSelfEdgeDistinctSites}, supersedesLine NOT strictly before the edge ${hygiene.overrideSupersedesLineNotBefore}`)
const show = (title: string, list: Sample[]): void => {
  if (list.length === 0) {
    console.log(`  ${title}: none`)
    return
  }
  console.log(`  ${title}:`)
  for (const s of list) console.log(`    ${s.file}\n      ${s.detail}`)
}
console.log("")
show("P1 samples", p1Samples)
show("P2 samples", p2Samples)
show("P3 samples", p3Samples)
show("P5 samples", p5Samples)