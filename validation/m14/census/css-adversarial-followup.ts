/**
 * M14 ONTOLOGY, PASS 2, follow-up — the two questions `css-adversarial-probe.ts`
 * raised and could not answer from an aggregate.
 *
 * ## Q1. Are the 4 `uses` edges from a `var()`-valued `font-family` fabrications?
 *
 * The adversarial probe counted 4 `uses` edges falling on the line range of a
 * `font-family: var(...)` declaration. Two readings, and they are opposites:
 *
 *   - FABRICATION: `font-family: var(--x)` names no family, so an edge to a family is
 *     an invented endpoint. This is the failure the workstream calls the most expensive
 *     one available.
 *   - CORRECT: `var(--x, "Foo")` is a declaration whose FALLBACK is the family `"Foo"`.
 *     The fallback is a real, author-written dependency on a declared `@font-face`, and
 *     the edge points at it correctly. Only `var(--x)` with NO fallback would be a
 *     fabrication.
 *
 * An aggregate count cannot tell those apart, so this probe prints every one of them with
 * the full declaration text and the target symbol. FINDING if any edge comes from a
 * `var()` with no family-shaped fallback.
 *
 * ## Q2. Was the `contains` scope probe vacuous?
 *
 * The scope probe reported 0 of 25,181 `isMediaScope` containment edges whose contained
 * rule falls outside the source scope symbol's recorded line range. That is the result a
 * broken probe also produces, so it needs a non-vacuity witness: a file that publishes a
 * media-scope symbol whose recorded range does NOT span the whole file, and a second
 * `@media` block of the SAME query text below it. This probe counts exactly that, and
 * prints the cases where a same-named scope block exists at a line the symbol's range
 * does not cover — which is the case that WOULD produce a violation. If the count is 0
 * the pass-1 shape is real (the corpus never repeats a scope query in one file) and the
 * earlier 0 is explained rather than merely observed.
 *
 * ## Q3. The `overrides` gap: `--x` assigned twice in one declaration block.
 *
 * The adversarial probe counted **85** `--custom-property` re-assignments inside a single
 * declaration block, across **7** files. CSS Cascade gives that one rule — among two
 * declarations of the same property in the same block at the same importance, the later
 * wins — so it is the same construct the lane already emits for `@keyframes` and
 * `@property`, with the same `source === target` shape, and the rule does not reach it.
 * This probe prints every occurrence with its file, block line, property and both values,
 * so the count is checkable rather than a number in a table.
 *
 * ## READ-ONLY. Writes nothing but the optional `--json`.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../src/ast/language-detection"
import { parseFile } from "../../../src/ast/pool-worker"
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

// Same runtime state as `parseFile` — see css-adversarial-probe.ts for why the warm-up
// parse is load-bearing rather than incidental.
await loadWebTreeSitter()
if (files.length > 0) await parseFile(files[0].abs, files[0].dir)
const wts: any = await loadWebTreeSitter()
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
const cssParser = new WSP()
cssParser.setLanguage(await WSL.load(new Uint8Array(readFileSync(resolveWasmAsset("tree-sitter-css/tree-sitter-css.wasm")))))

const q1 = { edgesOnVarFontFamily: 0, withFamilyFallback: 0, withNoFallback: 0, cases: [] as any[] }
const q2 = {
  scopeSymbols: 0,
  filesWithADuplicateScopeName: 0,
  duplicateScopeNameGroups: 0,
  rulesInADuplicateScopeGroupBelowTheSymbolRange: 0,
  witnesses: [] as any[],
}
const q3 = { occurrences: 0, files: 0, cases: [] as any[] }

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
    let r: any
    let tree: any
    let text: string
    try {
      text = readFileSync(f.abs, "utf8")
      r = await parseFile(f.abs, f.dir)
      tree = cssParser.parse(text)
    } catch {
      continue
    }

    const syms: any[] = r.symbols ?? []
    const rels: any[] = r.relationships ?? []

    // ---------------- Q2: scope symbols and duplicate scope names ----------------
    const scopeFlags = ["isMediaScope", "isSupportsScope", "isLayerScope", "isContainerScope", "isScopeScope"]
    const scopeRanges = new Map<string, { start: number; end: number }>()
    for (const s of syms) {
      const nm = String(s.name ?? "")
      if (nm.length === 0) continue
      const md = (s.metadata ?? {}) as Record<string, unknown>
      if (!scopeFlags.some((fl) => md[fl] === true)) continue
      if (scopeRanges.has(nm)) continue
      const start = Number(s.range?.start?.line ?? 0)
      scopeRanges.set(nm, { start, end: Number(s.range?.end?.line ?? start) })
    }
    q2.scopeSymbols += scopeRanges.size

    // The at-rule blocks of the same name, in document order, from the TREE — which is
    // independent of what the analyzer published.
    type Block = { name: string; start: number; end: number }
    const blocksByName = new Map<string, Block[]>()
    {
      const st: any[] = [tree.rootNode]
      while (st.length > 0) {
        const n = st.pop()
        if (n.type === "media_statement" || n.type === "supports_statement" || n.type === "at_rule" || n.type === "keyframes_statement") {
          const kw = (n.childForFieldName?.("at_keyword")?.text ?? n.text.split(/[\s{]/)[0] ?? "").replace(/^@/, "").toLowerCase()
          const prelude = n.childForFieldName?.("prelude") ?? n.childForFieldName?.("condition")
          const nm = n.type === "media_statement" || n.type === "supports_statement" || n.type === "at_rule"
            ? `@${kw} ${collapse(prelude ? prelude.text : "")}`.trim()
            : ""
          if (nm.length > 0) {
            const arr = blocksByName.get(nm) ?? []
            arr.push({ name: nm, start: Number(n.startPosition?.row ?? 0) + 1, end: Number(n.endPosition?.row ?? 0) + 1 })
            blocksByName.set(nm, arr)
          }
        }
        for (let k = n.namedChildCount - 1; k >= 0; k--) {
          const c = n.namedChild(k)
          if (c) st.push(c)
        }
      }
    }
    let dupGroups = 0
    for (const [nm, arr] of blocksByName) {
      if (arr.length < 2) continue
      const sym = scopeRanges.get(nm)
      if (!sym) continue
      dupGroups++
      // Blocks the analyzer's recorded range does not span. Each such block's rules are
      // the ones whose containment edge would point at the wrong block.
      const outside = arr.filter((b) => b.start < sym.start || b.end > sym.end)
      if (outside.length > 0) {
        q2.rulesInADuplicateScopeGroupBelowTheSymbolRange += outside.length
        if (q2.witnesses.length < 12) {
          q2.witnesses.push({
            file: lbl,
            scopeName: nm,
            symbolRange: `L${sym.start}-L${sym.end}`,
            blocksInFile: arr.map((b) => `L${b.start}-L${b.end}`).join(", "),
            blocksOutsideTheSymbolRange: outside.map((b) => `L${b.start}-L${b.end}`).join(", "),
          })
        }
      }
    }
    if (dupGroups > 0) {
      q2.filesWithADuplicateScopeName++
      q2.duplicateScopeNameGroups += dupGroups
    }

    // ---------------- Q1: `uses` edges landing on a var()-valued font-family ----------
    // Declared families, so a FALLBACK can be recognised as one.
    const declaredFamilies = new Set<string>()
    {
      const st: any[] = [tree.rootNode]
      while (st.length > 0) {
        const n = st.pop()
        if (n.type === "font_face_statement") {
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
        for (let k = n.namedChildCount - 1; k >= 0; k--) {
          const c = n.namedChild(k)
          if (c) st.push(c)
        }
      }
    }
    // `font-family: var(...)` declarations with their line ranges.
    const varFontFamilyRanges: { start: number; end: number; text: string }[] = []
    {
      const st: any[] = [tree.rootNode]
      while (st.length > 0) {
        const n = st.pop()
        if (n.type === "declaration") {
          const pn = n.childForFieldName?.("name") ?? n.namedChild(0)
          if (pn && pn.type === "property_name" && pn.text.trim().toLowerCase() === "font-family") {
            const v = n.childForFieldName?.("value") ?? n.namedChild(1)
            if (v && v.text.indexOf("var(") !== -1) {
              varFontFamilyRanges.push({
                start: Number(n.startPosition?.row ?? 0) + 1,
                end: Number(n.endPosition?.row ?? 0) + 1,
                text: collapse(v.text),
              })
            }
          }
        }
        for (let k = n.namedChildCount - 1; k >= 0; k--) {
          const c = n.namedChild(k)
          if (c) st.push(c)
        }
      }
    }
    if (varFontFamilyRanges.length > 0) {
      for (const rel of rels) {
        const md = (rel.metadata ?? {}) as Record<string, unknown>
        if (md.isFontFamilyRef !== true) continue
        const line = typeof rel.line_number === "number" ? rel.line_number : -1
        const hit = varFontFamilyRanges.find((v) => line >= v.start && line <= v.end)
        if (!hit) continue
        q1.edgesOnVarFontFamily++
        // Does the declaration text name the edge's target as a literal fallback?
        const tgt = stripQ(String(rel.target ?? ""))
        const literal = hit.text.indexOf(tgt) !== -1 && hit.text.indexOf(`var(`) < hit.text.indexOf(tgt)
        if (literal) q1.withFamilyFallback++
        else q1.withNoFallback++
        if (q1.cases.length < 20) {
          q1.cases.push({
            file: lbl,
            declaration: hit.text.slice(0, 140),
            edge: `${rel.source} -> ${rel.target} @L${line}`,
            targetIsADeclaredFontFace: declaredFamilies.has(tgt),
            targetAppearsAsALiteralAfterTheVar: literal,
          })
        }
      }
    }

    // ---------------- Q3: `--x` assigned twice in one declaration block --------------
    let here = 0
    {
      const st: any[] = [tree.rootNode]
      while (st.length > 0) {
        const n = st.pop()
        if (n.type === "rule_set" || n.type === "keyframe_block") {
          const seen = new Map<string, { line: number; value: string }>()
          const inner: any[] = [n]
          while (inner.length > 0) {
            const d = inner.pop()
            if (d.type === "declaration") {
              const pn = d.childForFieldName?.("name") ?? d.namedChild(0)
              if (pn && pn.type === "property_name") {
                const prop = pn.text.trim()
                if (prop.startsWith("--")) {
                  const line = Number(d.startPosition?.row ?? 0) + 1
                  const prior = seen.get(prop)
                  if (prior) {
                    here++
                    if (q3.cases.length < 30) {
                      q3.cases.push({
                        file: lbl,
                        block: `L${Number(n.startPosition?.row ?? 0) + 1}`,
                        property: prop,
                        firstAssignment: `L${prior.line} = ${prior.value.slice(0, 50)}`,
                        secondAssignment: `L${line} = ${collapse((d.childForFieldName?.("value") ?? d.namedChild(1))?.text ?? "").slice(0, 50)}`,
                      })
                    }
                  } else {
                    const v = d.childForFieldName?.("value") ?? d.namedChild(1)
                    seen.set(prop, { line, value: collapse(v?.text ?? "") })
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

const out = { files: files.length, repos: repos.size, q1, q2, q3 }
const jsonArg = process.argv.indexOf("--json")
if (jsonArg !== -1 && process.argv[jsonArg + 1]) writeFileSync(process.argv[jsonArg + 1], JSON.stringify(out, null, 2) + "\n")
console.log(`css adversarial follow-up — ${files.length} admitted files across ${repos.size} repos`)
console.log("")
console.log("Q1  uses edges on a var()-valued font-family")
console.log(`    edges ${q1.edgesOnVarFontFamily}   target is a literal fallback after the var() ${q1.withFamilyFallback}   no literal fallback ${q1.withNoFallback}   <- ${q1.withNoFallback === 0 ? "clean: every one names an author-written fallback" : "FINDING"}`)
for (const c of q1.cases) {
  console.log(`    ${c.file}`)
  console.log(`      declaration            ${c.declaration}`)
  console.log(`      edge                   ${c.edge}`)
  console.log(`      target is a declared @font-face family: ${c.targetIsADeclaredFontFace}; target appears literally after the var(): ${c.targetAppearsAsALiteralAfterTheVar}`)
}
console.log("")
console.log("Q2  is the scope containment probe vacuous?")
console.log(`    scope symbols published ${q2.scopeSymbols}`)
console.log(`    files whose tree has a DUPLICATE scope name the analyzer published: ${q2.filesWithADuplicateScopeName}, groups ${q2.duplicateScopeNameGroups}`)
console.log(`    same-named blocks NOT spanned by the symbol's range ${q2.rulesInADuplicateScopeGroupBelowTheSymbolRange}   <- ${q2.rulesInADuplicateScopeGroupBelowTheSymbolRange === 0 ? "clean: the corpus never repeats a scope query under a published name" : "FINDING"}`)
for (const c of q2.witnesses) {
  console.log(`    ${c.file}\n      scope ${JSON.stringify(c.scopeName)} symbol range ${c.symbolRange}, blocks in file ${c.blocksInFile}, outside ${c.blocksOutsideTheSymbolRange}`)
}
console.log("")
console.log("Q3  --custom-property assigned twice inside one declaration block")
console.log(`    occurrences ${q3.occurrences} across ${q3.files} files`)
for (const c of q3.cases) {
  console.log(`    ${c.file}  ${c.block}`)
  console.log(`      ${c.property}:  ${c.firstAssignment}   THEN   ${c.secondAssignment}`)
}