/**
 * VARIANT-DISCRIMINATOR PROBE — sizes the object-variant discriminator defect.
 *
 * ## The defect, in the source
 *
 * Nim's object variant is written `case <name>` … `of <ctor>: <fields>`. The
 * grammar also has to accept the BARE form, which Nim permits and which
 * `nimony/tests/nimony/object/tsumtype.nim` exercises with live `assert`
 * statements, so it is a positive test and not an error fixture:
 *
 *     type Node = ref object
 *       case
 *       of AddOpr, SubOpr:
 *         a, b: Node
 *
 * There is no slot for a missing name, so `tree-sitter-nim` attaches the NEXT
 * LINE to the `variant_discriminator_declaration` slot. On that file the
 * discriminator's name field then reads `of` — the anonymous keyword — and on
 * `L` in the same file it reads `Nil`, the first CONSTRUCTOR:
 *
 *     nimony/tests/nimony/object/tsumtype.nim:6   NAME = <<of>>
 *     nimony/tests/nimony/object/tsumtype.nim:74  NAME = <<Nil>>
 *
 * `buildFieldSymbols` (`src/ast/real-nim-analyzer.ts:994`) publishes whatever
 * that slot holds as a `property` of the owning type, so both rows become a
 * field the object does not have, plus a `contains` edge to it. `Node` has
 * fields `a`, `b` and `val`. Neither `of` nor `Nil` is one of them.
 *
 * This is the workstream's most-expensive error class — a FABRICATED edge — and
 * it is why the keyword spelling matters less than it looks: `of` is caught by
 * any reserved-word check, and `Nil` is not caught by anything.
 *
 * ## Why a keyword probe undercounts, which is what this instrument exists for
 *
 * `session8-endpoint-provenance` found 9 symbols published under a Nim reserved
 * word and 656 edges pointing at them. That is a true lower bound on the
 * defect and a poor measure of it, because the fabricated name is whatever the
 * parser's recovery happened to land on. So this probe counts DISCRIMINATORS,
 * not keywords, and reports both.
 *
 * ## The discrimination this probe is built to settle
 *
 * A mis-parsed discriminator is not merely mis-spelled; the parse RECOVERED,
 * and the recovery leaves a structural trace. The question the corpus has to
 * answer is WHICH trace is a reliable guard, so this probe scores every
 * candidate rule against a ground truth and prints all four cells.
 *
 * GROUND TRUTH is structural, not a keyword list: the slot is genuine exactly
 * when its first child is a `symbol_declaration`, the node the author writes
 * after `case`. On the bare form there is nothing to write, the parser absorbs
 * the following `of <Ctor>, <Ctor>:` line, and the first child becomes that
 * list's `expression_list` instead.
 *
 * CANDIDATES, all measured rather than assumed:
 *   - the slot is not a `symbol_declaration`      (the ground truth itself)
 *   - the discriminator is not on the `case` line
 *   - an ERROR CHILD of `variant_declaration`
 *   - an ERROR CHILD OR SIBLING
 *   - the name is a Nim reserved word
 *   - the name duplicates a constructor this variant names
 *
 * A rule ships only when it misses no fabrication AND loses no genuine field.
 * The ERROR-based rules are here because they are the intuitive answer and the
 * measurement is what settles it: the ERROR does not sit in a fixed position.
 * In `nimony/tests/nimony/object/deps/msumtype.nim` it is a child of
 * `variant_declaration`; in `nimony/tests/nimony/object/tsumtype.nim` it is a
 * SIBLING, one line down under `field_declaration_list`. A child-only read is
 * therefore wrong, and the table says by how much.
 *
 * ## Instrument
 *
 * NO REGEX over source text. Every count is a tree-sitter walk reading
 * `node.type`, `node.child()` and `node.childForFieldName()` only. The corpus
 * walk is the arbiter's own (git ls-files, detectLanguageFromPath, 512 KB cap),
 * so the file set is the same set `census.ts` walks.
 *
 * READ-ONLY. Writes nothing outside stdout and an optional JSON path (argv[2]).
 *
 *     npx tsx validation/m14/fixtures/nim/variant-discriminator.ts <out.json>
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import * as path from "node:path"
import * as wts from "web-tree-sitter"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const LANG = "nim"
const OUT = process.argv[2] && process.argv[2].endsWith(".json") ? process.argv[2] : null

/** Nim's reserved words, as the compiler spells them. Membership is a test on
 *  an already-parsed `identifier` node's text, never a search over source, so
 *  it cannot match a comment or a string literal — which is the failure mode
 *  that makes a regex census unusable. */
const RESERVED = new Set([
  "addr", "and", "as", "bind", "block", "break", "case", "concept", "const",
  "continue", "converter", "defer", "discard", "distinct", "div", "do", "elif",
  "else", "end", "enum", "except", "export", "finally", "for", "from", "func",
  "if", "import", "in", "include", "interface", "is", "isnot", "iterator", "let",
  "macro", "method", "mixin", "mod", "nil", "not", "notin", "object", "of", "or",
  "out", "proc", "ptr", "raise", "ref", "return", "shl", "shr", "static",
  "template", "try", "tuple", "type", "using", "var", "when", "while", "xor",
  "yield",
])

const ANALYZER = "src/ast/real-nim-analyzer.ts"
const sha = (): string => createHash("sha256").update(readFileSync(ANALYZER)).digest("hex")

// ─────────────────────────────────────────────────────────────── corpus walk
const files: { repo: string; abs: string }[] = []
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
      encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
    }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try { if (statSync(abs).size > 512 * 1024) continue; text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== LANG) continue
    files.push({ repo: e, abs })
  }
}

// ───────────────────────────────────────────────────────────────── the tally
interface Site {
  repo: string
  file: string
  line: number
owner: string
    name: string
  /** an ERROR among the variant_declaration's own children */
  errChild: boolean
  /** an ERROR among its children OR its immediate siblings under the field list */
  hasError: boolean
  nameIsReserved: boolean
  /** the discriminator and the `case` token on the SAME source line. A bare
   *  `case` has no discriminator, so a genuine one cannot share the line. */
  sameLineAsCase: boolean
  /** the name duplicates a CONSTRUCTOR this variant names — in the absorbed
   *  `of A, B:` line or in any real `of_branch`. An independent witness that the
   *  name was borrowed from the branch list rather than written by the author. */
  nameIsOwnConstructor: boolean
  slotIsSymbolDecl: boolean
  slotShape: string
  /** how many `symbol_declaration`s the slot's list holds: 1 for a real
   *  `case name`, 2+ when it absorbed a constructor list */
  declCount: number
  /** an ERROR inside the slot's own declaration list */
  errInSlot: boolean
}

const sites: Site[] = []
let variantDeclarations = 0
let parsedFiles = 0
let parseFileThrew = 0

/** What production `parseFile` published, per (file, name). */
const published = new Map<string, { kind: string; owner: string; edges: number }>()

/** Worker count. UNLIKE `endpoint-provenance.ts` and `census.ts`, EVERY count in
 *  this probe is worker-count invariant, and the reason is structural rather than
 *  asserted: each classification is a function of ONE file's parse tree plus ONE
 *  file's own `parseFile` result. Nothing here consults a cross-file symbol set,
 *  which is what made those two instruments' counts move with fan-out (doc
 *  Limitations 8 / 11). The key is `${rel}\u0001${name}` — never the bare name —
 *  so no two files can collide in `published`.
 *
 *  Claimed as invariant, so it is measured EXTERNALLY: the probe is run under two
 *  fan-out settings and the two JSON artifacts are diffed field by field. The
 *  doc section that records the result names the two settings. */
const WORKERS = Math.max(1, Number(process.env.BB_NIM_WORKERS ?? 6) || 6)

let parser: any

async function main(): Promise<void> {
  const WSP: any = (wts as any).Parser ?? (wts as any).default
  const WSL: any = (wts as any).Language ?? (wts as any).default
  await WSP.init({
    locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm"),
  })
  parser = new WSP()
  parser.setLanguage(
    await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-nim.wasm"))),
  )

  const digestBefore = sha()

  for (const f of files) {
    let src: string
    try { src = readFileSync(f.abs, "utf8") } catch { continue }
    let tree: any
    try { tree = parser.parse(src) } catch { continue }

    const stack: any[] = [tree.rootNode]
    while (stack.length > 0) {
      const n = stack.pop()
      if (n.type === "variant_declaration") {
        variantDeclarations++
        const caseTok = n.children.find((c: any) => c.type === "case")
        const vdisc = n.children.find((c: any) => c.type === "variant_discriminator_declaration")
        /* The recovery marker is NOT always in the same place, and this is the
         * single most important structural fact the probe records. Measured on
         * `nimony`:
         *
         *   tests/nimony/object/tsumtype.nim      ERROR is a SIBLING of
         *       variant_declaration, under field_declaration_list, one line down.
         *   tests/nimony/object/deps/msumtype.nim ERROR is a CHILD of
         *       variant_declaration, sitting between `case` and the slot.
         *
         * A probe that reads only `n.children` therefore misses every defect of
         * the first shape — which is 5 of 14 in that repo, and those 5 are
         * exactly the off-diagonal cell the contingency table is built to expose.
         * So the ERROR is looked for in both positions. */
        const errChild = n.children.some((c: any) => c.type === "ERROR")
        let errSibling = false
        if (n.parent && n.parent.type === "field_declaration_list") {
          const sibs = n.parent.children
          const at = sibs.findIndex((c: any) => c.id === n.id)
          for (let d = -1; d <= 1; d++) {
            const s2 = sibs[at + d]
            if (s2 && s2.type === "ERROR") errSibling = true
          }
        }
        const hasError = errChild || errSibling
        if (vdisc) {
          /* The slot's own shape, which is what actually separates a real
           * discriminator from a borrowed one. For a genuine `case name` the slot
           * holds a `symbol_declaration` whose `name` field is the author's
           * discriminator. For the bare `case` form the slot has no name to hold,
           * so the parser absorbs the following `of <Ctor>, <Ctor>:` line and the
           * first child becomes that list's `expression_list` instead — and
           * `childForFieldName("name")` then reaches into a constructor. */
          /* MEASURED SHAPE FACTS. The slot is `symbol_declaration_list >
           * symbol_declaration > identifier` in BOTH the genuine and the bare form
           * — verified against hand-read positives and negatives:
           *
           *   nimony/tests/nimony/object/tcaseobjectrange.nim:15  `case kind: Kind`
           *     -> symbol_declaration_list > symbol_declaration(kind), ONE decl, no ERROR
           *   nimony/lib/std/opt.nim:33-34                        bare `case` / `of None:`
           *     -> symbol_declaration_list > symbol_declaration(None), ONE decl, no ERROR
           *
           * Identical. So slot shape, decl count and ERROR presence are NOT the
           * discriminator, and the probe reports them so the table shows why. */
          const slotShape = vdisc.namedChildCount > 0 ? String(vdisc.namedChild(0).type) : ""
          const slotIsSymbolDecl = slotShape === "symbol_declaration"
          const sdl = slotShape === "symbol_declaration_list" ? vdisc.namedChild(0) : null
          let declCount = 0
          let errInSlot = false
          if (sdl) {
            for (let i = 0; i < sdl.childCount; i++) {
              const c = sdl.child(i)
              if (c.type === "symbol_declaration") declCount++
              if (c.type === "ERROR") errInSlot = true
            }
          }
          /* The discriminator is the FIRST `symbol_declaration` in the list. */
          let firstDecl: any = null
          if (sdl) for (let i = 0; i < sdl.childCount; i++) { if (sdl.child(i).type === "symbol_declaration") { firstDecl = sdl.child(i); break } }
          const nameNode = firstDecl ? firstDecl.childForFieldName("name") : null
          const name = nameNode ? String(nameNode.text) : ""
          /* INDEPENDENT WITNESS: the identifiers this variant names in its own
           * `of_branch` children — i.e. its real constructor list. Deliberately
           * NOT collected from the slot: an earlier revision of this probe
           * collected from both and so matched the discriminator's own name,
           * which made every genuine site look like a match and the witness
           * vacuous. A genuine discriminator is a plain field tag written by the
           * author and is never one of the constructors; a borrowed name is. */
          const ctors = new Set<string>()
          const collectIdents = (root: any): void => {
            const st: any[] = [root]
            while (st.length > 0) {
              const e2 = st.pop()
              if (e2.type === "identifier") ctors.add(String(e2.text))
              for (let k = 0; k < e2.namedChildCount; k++) { const c3 = e2.namedChild(k); if (c3) st.push(c3) }
            }
          }
          for (let i = 0; i < n.childCount; i++) {
            const c = n.child(i)
            if (c.type === "of_branch") collectIdents(c)
          }
          // the owning type: the nearest enclosing type_declaration's own name
          let owner = ""
          let up: any = n.parent
          for (let g = 0; up && g < 64; g++) {
            if (up.type === "type_declaration") {
              const sd = up.namedChildCount > 0 ? up.namedChild(0) : null
              const nm = sd && sd.type === "type_symbol_declaration" ? sd.childForFieldName("name") : null
              owner = nm ? String(nm.text) : ""
              break
            }
            up = up.parent
          }
          sites.push({
            repo: f.repo,
            file: f.abs.replace(CR + "/", ""),
            line: vdisc.startPosition.row + 1,
            owner,
            name,
            errChild,
            hasError,
            nameIsReserved: RESERVED.has(name),
            sameLineAsCase: caseTok ? caseTok.startPosition.row === vdisc.startPosition.row : false,
            nameIsOwnConstructor: ctors.has(name),
            slotIsSymbolDecl,
            slotShape,
            declCount,
            errInSlot,
          })
        }
      }
      for (let i = 0; i < n.childCount; i++) stack.push(n.child(i))
    }
  }

  // ── what the PRODUCTION entry point actually published for these sites
  // Fanned out. Each worker owns whole files and the `published` key carries the
  // repo-relative path, so there is no shared mutable state to race on. Edges
  // are folded before symbols so an edge pointing at a symbol of the SAME file
  // is counted even when the walk finds them in that order.
  let pIdx = 0
  await Promise.all(
    Array.from({ length: WORKERS }, async () => {
      for (;;) {
        const i = pIdx++
        if (i >= files.length) return
        const f = files[i]
        let r: any
        try { r = await parseFile(f.abs, path.dirname(f.abs)) } catch { parseFileThrew++; continue }
        parsedFiles++
        const rel = f.abs.replace(CR + "/", "")
        const mine = new Set<string>()
        for (const s of r.symbols ?? []) mine.add(`${rel}\u0001${String(s.name ?? "")}`)
        for (const e of r.relationships ?? []) {
          const key = `${rel}\u0001${String(e.target ?? "")}`
          if (!mine.has(key)) continue
          const cur = published.get(key) ?? { kind: "", owner: "", edges: 0 }
          cur.edges++
          published.set(key, cur)
        }
        for (const s of r.symbols ?? []) {
          const key = `${rel}\u0001${String(s.name ?? "")}`
          const cur = published.get(key) ?? { kind: "", owner: "", edges: 0 }
          cur.kind = String(s.kind ?? "")
          cur.owner = String(s.ownerName ?? "")
          published.set(key, cur)
        }
      }
    }),
  )

  const digestAfter = sha()

  // ─────────────────────────────────────────────────────────── the contingency
  /* GROUND TRUTH: the discriminator name sits on the SAME source row as the
   * `case` token.
   *
   * This is a property of the grammar, not a heuristic. Nim writes a
   * discriminator as `case <name>`, adjacent, so a genuine name cannot be on a
   * later row. The bare form is `case` + newline + `of A, B:`; there is no name
   * to write, error recovery attaches the next line to the slot, and that line
   * is necessarily a different row.
   *
   * Checked against hand-read positives and negatives rather than assumed:
   *   tcaseobjectrange.nim:15  `case kind: Kind`       -> same row   (GENUINE)
   *   opt.nim:33-34            bare `case` / `of None:`   -> next row (FABRICATED)
   *   msumtype.nim:4           bare `case` / `of AddOpr, SubOpr:` -> FABRICATED
   *   tsumtype.nim:6           bare `case` / `of AddOpr, SubOpr:` -> FABRICATED
   * The node SHAPE is identical across all four. That is the whole finding. */
  const genuine = sites.filter((s) => s.sameLineAsCase)
  const fabricated = sites.filter((s) => !s.sameLineAsCase)

  /* Every candidate rule is scored against that ground truth on all four cells,
   * because a rule is only shippable if BOTH off-diagonals are 0: it must catch
   * every fabrication and lose no genuine field. The intuitive rules are included
   * precisely so the measurement can show that they are wrong. */
  const candidates: { label: string; pred: (s: Site) => boolean }[] = [
    { label: "discriminator NOT on the 'case' row", pred: (s) => !s.sameLineAsCase },
    { label: "an ERROR child of the variant_declaration", pred: (s) => s.errChild },
    { label: "an ERROR child OR sibling", pred: (s) => s.hasError },
    { label: "an ERROR inside the slot declaration list", pred: (s) => s.errInSlot },
    { label: "slot holds more than one declaration", pred: (s) => s.declCount > 1 },
    { label: "slot first child is not a symbol_declaration", pred: (s) => !s.slotIsSymbolDecl },
    { label: "name is a Nim reserved word", pred: (s) => s.nameIsReserved },
    { label: "name is one of this variant constructors", pred: (s) => s.nameIsOwnConstructor },
  ]

  const byName = new Map<string, number>()
  for (const s of fabricated) byName.set(s.name, (byName.get(s.name) ?? 0) + 1)

  const publishedRows = fabricated
    .filter((s) => published.has(`${s.file}\u0001${s.name}`))
    .map((s) => {
      const p = published.get(`${s.file}\u0001${s.name}`)!
      return { file: s.file, line: s.line, owner: s.owner, name: s.name, kind: p.kind, publishedOwner: p.owner, edges: p.edges }
    })

  console.log(`nim variant-discriminator probe`)
  console.log(`analyzer    : ${ANALYZER} sha256:${digestBefore.slice(0, 16)}`)
  console.log(`corpus root : ${CR}`)
  console.log(`files       : ${files.length.toLocaleString()} (git ls-files, detectLanguageFromPath==="nim", <=512KB)`)
  console.log(`parseFile   : ${parsedFiles.toLocaleString()} walked, ${parseFileThrew} threw`)
  console.log(`workers     : ${WORKERS}  (BB_NIM_WORKERS; every count below is claimed invariant under fan-out — see the WORKERS comment)`)
  console.log(`\nvariant_declaration nodes : ${variantDeclarations}`)
  console.log(`discriminator slots found : ${sites.length}`)
  console.log(`  genuine   (name on the 'case' row) : ${genuine.length}`)
  console.log(`  fabricated(name on a LATER row)     : ${fabricated.length}`)
  const shapeKey = (st: Site): string => `${st.slotShape}/decls=${st.declCount}/errInSlot=${st.errInSlot ? 1 : 0}`
  const shapes = new Map<string, number>()
  for (const st of sites) shapes.set(shapeKey(st), (shapes.get(shapeKey(st)) ?? 0) + 1)
  console.log(`  slot shapes, each split by ground truth \u2014 identical shapes on both sides is the finding:`)
  for (const [k, v] of [...shapes.entries()].sort((a, b) => b[1] - a[1])) {
    const g = sites.filter((st) => shapeKey(st) === k && st.sameLineAsCase).length
    console.log(`    ${k.padEnd(52)} n=${String(v).padStart(3)}   genuine=${g}  fabricated=${v - g}`)
  }

  console.log(`\nCANDIDATE RULES vs GROUND TRUTH — TP fabrication caught, FN fabrication missed,`)
  console.log(`FP genuine field LOST, TN genuine kept. Shippable only when FN = 0 AND FP = 0.`)
  console.log(`  rule                                        TP    FN    FP    TN  shippable`)
  const ruleRows: Record<string, number[]> = {}
  for (const c of candidates) {
    let tp = 0, fn = 0, fp = 0, tn = 0
    for (const st of sites) {
      const flagged = c.pred(st)
      const actuallyFabricated = !st.sameLineAsCase
      if (flagged && actuallyFabricated) tp++
      else if (!flagged && actuallyFabricated) fn++
      else if (flagged && !actuallyFabricated) fp++
      else tn++
    }
    const ok = fn === 0 && fp === 0
    ruleRows[c.label] = [tp, fn, fp, tn]
    console.log(`  ${c.label.padEnd(44)} ${String(tp).padStart(4)} ${String(fn).padStart(5)} ${String(fp).padStart(5)} ${String(tn).padStart(5)}  ${ok ? "YES" : "no"}`)
  }

  console.log(`\nINDEPENDENT WITNESS — is the borrowed name one of this variant's own constructors?`)
  console.log(`  fabricated whose name duplicates a constructor it names : ${fabricated.filter((s) => s.nameIsOwnConstructor).length} of ${fabricated.length}`)
  console.log(`  genuine   whose name duplicates a constructor it names : ${genuine.filter((s) => s.nameIsOwnConstructor).length} of ${genuine.length}`)

  console.log(`\nTHE FABRICATED NAMES — the keyword probe only sees the first of these`)
  for (const [k, v] of [...byName.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(v).padStart(4)}  ${RESERVED.has(k) ? "of" === k ? "of     (RESERVED — caught by the keyword probe)" : `${k} (RESERVED)` : k}`)
  }

  console.log(`\nWHAT PRODUCTION parseFile PUBLISHED for these sites — the edge count is what the graph asserts`)
  console.log(`  sites whose fabricated name WAS published as a symbol : ${publishedRows.length} of ${fabricated.length}`)
  console.log(`  total edges pointing at a fabricated name             : ${publishedRows.reduce((a, b) => a + b.edges, 0)}`)
  const byKind = new Map<string, number>()
  for (const r of publishedRows) byKind.set(r.kind, (byKind.get(r.kind) ?? 0) + 1)
  for (const [k, v] of [...byKind.entries()].sort((a, b) => b[1] - a[1])) console.log(`    kind ${k.padEnd(12)} ${v}`)

  console.log(`\nEVERY SITE (all ${publishedRows.length}), so the finding is checkable rather than summarised:`)
  for (const r of publishedRows) {
    console.log(`  ${r.file}:${r.line}  owner=${r.owner} name=${r.name} kind=${r.kind} edges=${r.edges}`)
  }

  console.log(`\nanalyzer sha256 after the walk : ${digestAfter.slice(0, 16)}  (${digestBefore === digestAfter ? "unchanged" : "CHANGED — this artifact straddles an edit"})`)

  if (OUT) {
    writeFileSync(OUT, JSON.stringify({
      analyzer: ANALYZER, digestBefore, digestAfter, workers: WORKERS,
      corpusRoot: CR, files: files.length, parsedFiles, parseFileThrew,
      variantDeclarations, discriminatorSlots: sites.length,
      genuine: genuine.length, fabricated: fabricated.length,
      rules: ruleRows,
      fabricatedOwnConstructor: fabricated.filter((s) => s.nameIsOwnConstructor).length,
      genuineOwnConstructor: genuine.filter((s) => s.nameIsOwnConstructor).length,
      publishedSites: publishedRows.length,
      publishedEdges: publishedRows.reduce((a, b) => a + b.edges, 0),
      sites, publishedRows,
    }, null, 2))
    console.log(`\nwrote ${OUT}`)
  }
}
void main()