/**
 * NIM BARE-`case` CORPUS DELTA — which published symbols the guard removed, per file.
 *
 * ## Why this exists
 *
 * Two instruments disagreed and the disagreement is a finding, not noise:
 *
 *   `variant-discriminator.ts` at the pre-fix blob   19 of 20 slots published,
 *                                                     30 edges total
 *   `census.ts` HEAD~1 -> HEAD, same 6,063 files      property -33,
 *                                                     contains -32, 2 files
 *
 * 19/30 vs 33/32. The probe keys its `published` map on `${rel}\u0001${name}`, so
 * it counts a NAME once per file and cannot see a slot that published two
 * properties, nor a name published at two lines. The census counts every
 * published symbol instance. Both are right about their own quantity and neither
 * is the per-site answer, so this script measures it directly.
 *
 * ## Method, and why the file set is narrowed rather than the corpus walked twice
 *
 * The guard is one early `return out` inside `buildFieldSymbols`, reachable only
 * when `node.type === "variant_discriminator_declaration"`, and commit 1f443af19
 * added nothing else. So the set of files whose publication can differ is exactly
 * the set holding at least one discriminator SLOT, which is a property of the
 * grammar and the corpus — identical under either analyzer blob. This script
 * enumerates that set with a plain tree walk, then runs production `parseFile`
 * only on those files, at whichever analyzer is on disk, and prints every
 * published symbol carrying `metadata.nimVariantDiscriminator`.
 *
 * Run once per blob and diff the output. A one-line `git checkout` of the
 * analyzer between runs is the whole A/B; the census is the independent check
 * that the narrowing did not hide a file.
 *
 * READ-ONLY. Writes nothing outside stdout and an optional JSON path (argv[2]).
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
const ANALYZER = "src/ast/real-nim-analyzer.ts"
const OUT = process.argv[2] && process.argv[2].endsWith(".json") ? process.argv[2] : null

/** Fan-out. Worker-count INVARIANT by construction, and the reason is structural:
 *  the file set comes from a tree walk, and each worker owns whole files, so no
 *  two workers can contribute the same key. Counted externally by running this at
 *  two fan-out settings and diffing, which is what `session10-*workers6` is. */
const WORKERS = Math.max(1, Number(process.env.BB_NIM_WORKERS ?? 1) || 1)

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

/** The `case` token's row vs the slot's row, per discriminator slot — the
 *  ground truth the shipped guard implements, recorded here so the published
 *  symbols can be attributed to a slot rather than to a name. */
interface Slot {
  file: string
  line: number
  owner: string
  name: string
  declCount: number
  sameLineAsCase: boolean
}

const slots: Slot[] = []
const slotFiles: { repo: string; abs: string }[] = []
let parser: any

async function main(): Promise<void> {
  const WSP: any = (wts as any).Parser ?? (wts as any).default
  const WSL: any = (wts as any).Language ?? (wts as any).default
  await WSP.init({
    locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm"),
  })
  parser = new WSP()
  parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-nim.wasm"))))

  const digestBefore = createHash("sha256").update(readFileSync(ANALYZER)).digest("hex")

  // ── pass 1: which files hold a slot, and what each slot looks like
  for (const f of files) {
    let src: string
    try { src = readFileSync(f.abs, "utf8") } catch { continue }
    let tree: any
    try { tree = parser.parse(src) } catch { continue }
    const mine: Slot[] = []
    const stack: any[] = [tree.rootNode]
    while (stack.length > 0) {
      const n = stack.pop()
      if (n.type === "variant_declaration") {
        const caseTok = n.children.find((c: any) => c.type === "case")
        const vdisc = n.children.find((c: any) => c.type === "variant_discriminator_declaration")
        if (vdisc) {
          const sdl = vdisc.namedChildCount > 0 && vdisc.namedChild(0).type === "symbol_declaration_list"
            ? vdisc.namedChild(0) : null
          let declCount = 0
          let firstDecl: any = null
          if (sdl) {
            for (let i = 0; i < sdl.childCount; i++) {
              const c = sdl.child(i)
              if (c.type === "symbol_declaration") { declCount++; if (!firstDecl) firstDecl = c }
            }
          }
          const nm = firstDecl ? firstDecl.childForFieldName("name") : null
          let owner = ""
          let up: any = n.parent
          for (let g = 0; up && g < 64; g++) {
            if (up.type === "type_declaration") {
              const sd = up.namedChildCount > 0 ? up.namedChild(0) : null
              const o = sd && sd.type === "type_symbol_declaration" ? sd.childForFieldName("name") : null
              owner = o ? String(o.text) : ""
              break
            }
            up = up.parent
          }
          mine.push({
            file: f.abs.replace(CR + "/", ""),
            line: vdisc.startPosition.row + 1,
            owner,
            name: nm ? String(nm.text) : "",
            declCount,
            sameLineAsCase: caseTok ? caseTok.startPosition.row === vdisc.startPosition.row : false,
          })
        }
      }
      for (let i = 0; i < n.childCount; i++) stack.push(n.child(i))
    }
    if (mine.length > 0) { slotFiles.push(f); slots.push(...mine) }
  }

  // ── pass 2: what production parseFile published for those files
  const published: Record<string, { name: string; kind: string; owner: string; line: number; edges: number }[]> = {}
  let symbolRows = 0
  let edgeRows = 0
  let parsedFiles = 0
  let parseFileThrew = 0
  let idx = 0

  await Promise.all(Array.from({ length: WORKERS }, async () => {
    for (;;) {
      const i = idx++
      if (i >= slotFiles.length) return
      const f = slotFiles[i]
      let r: any
      try { r = await parseFile(f.abs, path.dirname(f.abs)) } catch { parseFileThrew++; continue }
      parsedFiles++
      const rel = f.abs.replace(CR + "/", "")
      /* EVERY symbol the run publishes for this file, keyed by name and line.
       *
       * Deliberately NOT filtered on `metadata.nimVariantDiscriminator`: that
       * marker was introduced BY the fix under test, so filtering on it measures
       * nothing at the pre-fix blob — and that is exactly the trap this script was
       * written to avoid. An earlier revision of it filtered on the marker and
       * reported "0 published" at BOTH blobs, which agrees with the post-fix
       * number and says nothing at all about the pre-fix one. The blob-independent
       * criterion is the tree-derived slot list computed in pass 1, and the set
       * dumped here is unfiltered so the delta is whatever production changed.
       *
       * `line` reads `startLine` BEFORE `range.startLine`: production `parseFile`
       * FLATTENS a symbol's range to top-level `startLine`/`endLine`
       * (`pool-worker.ts:871`), so an earlier revision of this script reading only
       * `range.startLine` recorded line -1 for all 12,401 rows and its per-site
       * table could not distinguish two same-named fields in one file. */
      const rows: { name: string; kind: string; owner: string; line: number; edges: number }[] = []
      for (const s of r.symbols ?? []) {
        rows.push({
          name: String(s.name), kind: String(s.kind), owner: String(s.ownerName ?? ""),
          line: Number(s.startLine ?? s.range?.startLine ?? -1), edges: 0,
        })
      }
      /* A `contains` edge is attributed to a published row by TARGET NAME.
       *
       * Matching on `line_number` instead would be wrong: a `contains` edge's
       * `line_number` is the edge's own line and need not equal the symbol's
       * `range.startLine`. Matching on name is exact whenever the name is unique
       * among the file's discriminator rows; where one name is published at two
       * lines in one file the split is genuinely ambiguous, and the rows are
       * keyed by `name:line` so `diff` still shows the multiset changing even
       * though the per-row edge split is not claimed to be exact. */
      for (const e of r.relationships ?? []) {
        if (e.type !== "contains") continue
        const cands = rows.filter((x) => x.name === String(e.target))
        if (cands.length > 0) cands[0].edges++
      }
      for (const row of rows) { symbolRows++; edgeRows += row.edges }
      if (rows.length) published[rel] = rows
    }
  }))

  const digestAfter = createHash("sha256").update(readFileSync(ANALYZER)).digest("hex")

  // ───────────────────────────────────────────────────────────────── the report
  const fabricated = slots.filter((s) => !s.sameLineAsCase)
  const genuine = slots.filter((s) => s.sameLineAsCase)
  const byOwner = new Map<string, number>()
  for (const r of fabricated) byOwner.set(r.owner, (byOwner.get(r.owner) ?? 0) + 1)

  const L: string[] = []
  L.push("nim bare-`case` corpus delta — production publication of variant discriminators")
  L.push(`analyzer    : ${ANALYZER} sha256:${digestBefore.slice(0, 16)}`)
  L.push(`corpus root : ${CR}`)
  L.push(`files       : ${files.length} scanned -> ${slotFiles.length} hold >=1 discriminator slot`)
  L.push(`workers     : ${WORKERS}`)
  L.push(`digest after the walk : ${digestAfter.slice(0, 16)}  ${digestBefore === digestAfter ? "(unchanged)" : "*** CHANGED MID-RUN ***"}`)
  L.push(`parsed ${parsedFiles} slot files, parseFile threw: ${parseFileThrew}`)
  L.push("")
  L.push(`slots ${slots.length}   genuine ${genuine.length}   fabricated ${fabricated.length}`)
  L.push(`published symbols in slot files (unfiltered)        : ${symbolRows}`)
  L.push(`  contains edges pointing at those symbols            : ${edgeRows}`)
  L.push(`  of those, matching a FABRICATED slot's name (name not on the 'case' row):`)
  const fabKeys = new Set(fabricated.map((s) => `${s.file}\u0001${s.name}`))
  let fabSyms = 0
  let fabEdges = 0
  for (const [rel, rows] of Object.entries(published)) {
    for (const r of rows) {
      if (!fabKeys.has(`${rel}\u0001${r.name}`)) continue
      fabSyms++; fabEdges += r.edges
    }
  }
  L.push(`    symbols ${fabSyms}   contains edges ${fabEdges}`)
  L.push(`  files with >=1 published discriminator symbol            : ${Object.keys(published).length}`)
  L.push("")
  L.push("DECLARATIONS HELD BY FABRICATED SLOTS — the census delta should equal their sum,")
  L.push("because the guard drops the WHOLE slot, not just its first declaration:")
  const declTotal = fabricated.reduce((a, s) => a + s.declCount, 0)
  L.push(`  ${declTotal} declarations across ${fabricated.length} fabricated slots`)
  L.push("")
  L.push("EVERY FABRICATED SLOT, with what production published for it:")
  for (const s of fabricated.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line))) {
    const rows = published[s.file] ?? []
    const hit = rows.filter((r) => r.name === s.name)
    const edgeSum = rows.reduce((a, r) => a + r.edges, 0)
    const hitTxt = hit.length ? `PUBLISHED name=${s.name} kind=${hit[0].kind} edges=${hit[0].edges}` : "not published"
    L.push(`  ${s.file}:${s.line}  owner=${s.owner} decls=${s.declCount} name=${s.name}  ${hitTxt}   (file total ${rows.length} syms / ${edgeSum} edges)`)
  }
  L.push("")
  L.push("OWNERS CARRYING A FABRICATED SLOT:")
  for (const [o, c] of [...byOwner].sort((a, b) => b[1] - a[1])) L.push(`  ${o}  ${c}`)
  L.push("")
  L.push("FULL PUBLISHED SET — diff this between two analyzer blobs:")
  for (const rel of Object.keys(published).sort()) L.push(`  ${rel}  ${JSON.stringify(published[rel])}`)

  process.stdout.write(L.join("\n") + "\n")
  if (OUT) {
    writeFileSync(OUT, JSON.stringify({
      analyzer: digestBefore, digestAfter, workers: WORKERS, filesScanned: files.length,
      slotFiles: slotFiles.length, slots, genuine: genuine.length, fabricated: fabricated.length,
      fabricatedDeclarations: declTotal, symbolRows, edgeRows, parseFileThrew, parsedFiles, published,
    }, null, 2))
    L.push(`\nwrote ${OUT}`)
  }
}

main()