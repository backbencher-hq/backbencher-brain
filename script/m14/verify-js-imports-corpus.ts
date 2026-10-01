// script/m14/verify-js-imports-corpus.ts — corpus-scale audit of javascript `imports`.
//
// WHY THIS EXISTS, and why it is not a differential oracle.
//
// `imports` is the one label in the compared set that a per-file tree-truth CANNOT
// state. For c and bash the analyzer publishes the RAW path text, so both sides of
// the comparison are the literal path and they match. javascript publishes the
// resolver's CROSS-FILE output — `<resolvedPath>:<item>` — and the path half is
// computed over the whole file set, so no per-file truth could ever match it. That
// is the structural reason the label sits outside the differential's compare set.
//
// The consequence is a coverage hole, not an exemption: measured on the two
// javascript corpora, `imports` is 6.5% of the analyzer's output (1,497 edges on
// 300 svelte files) and the only instrument covering it was `m40/
// verify-import-resolution.ts` — 7 assertions measured end to end on a 2-FILE
// project. A unit gate on the resolver is not a corpus audit of the edges.
//
// What IS per-file is a module's EXPORT SURFACE, and exports is itself audited
// (JD15). So this instrument answers the question that actually matters at scale,
// for every import edge the analyzer emits:
//
//   1. does the target's PATH part resolve to a real file?
//   2. if it does, does the named ITEM actually appear in that file's exports?
//
// A "no" on (2) is a fabricated import target: the edge names a symbol the module
// never exported, and bb_graph / bb_impact / hover all repeat it verbatim.
//
// A `*` item is NOT a fabrication — it is the honest refusal JD2b introduced for
// namespace imports, require, re-export and dynamic import, where the source names
// a module and not a member. Those are counted separately and reported as
// `unresolved`, never as wrong.

import * as fs from "fs"
import * as path from "path"
import { RealJavaScriptAnalyzer } from "../../src/ast/real-javascript-analyzer"

const argv = process.argv.slice(2)
const argOf = (name: string, dflt: string) => {
  const i = argv.indexOf(name)
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : dflt
}
const REPO = argOf("--repo", "$HOME/fixtures/repositories/svelte")
const LIMIT = parseInt(argOf("--files", "300"), 10)
// Build-time TEMPLATE directories. Their relative imports only resolve AFTER
// the files are copied and rewritten into the target tree, so they are not
// modules and their specifiers are not dead references. Verified on svelte:
// `packages/svelte/scripts/process-messages/process-messages.js:102` reads
// `./templates/${name}.js` as TEXT and writes it elsewhere, and the templates
// directory has no `utils/` or `state.js` of its own — the 6 "dead" rows this
// excluded were all in it.
const EXCLUDE_DIRS = argOf("--exclude-dir", "templates").split(",").map((s) => s.trim()).filter(Boolean)

/** Every .js/.mjs/.cjs under `dir`, skipping vendored trees. */
function collect(dir: string, out: string[] = []): string[] {
  let entries: fs.Dirent[] = []
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const f = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".git") continue
      if (EXCLUDE_DIRS.includes(e.name)) continue
      collect(f, out)
    } else if (/\.(js|mjs|cjs)$/.test(e.name) && !/\.test\.|\.spec\.|\.min\./.test(e.name)) {
      out.push(f)
    }
  }
  return out
}

/** The file a specifier names, or null. Relative specifiers only — a bare
 *  specifier (`esm-env`, `svelte/internal/client`) is a PACKAGE, not a path in
 *  this repo, and the resolver reaches it through the package map, which a
 *  filesystem walk cannot reconstruct. Those are counted as `external`, never
 *  as wrong. */
function resolveSpecifier(fromFile: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null
  const base = path.resolve(path.dirname(fromFile), spec)
  const tries = [base, `${base}.js`, `${base}.mjs`, `${base}.cjs`, path.join(base, "index.js")]
  for (const t of tries) {
    try {
      if (fs.statSync(t).isFile()) return t
    } catch {
      /* keep trying */
    }
  }
  return null
}

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const lang = await L.load(fs.readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-javascript.wasm")))
  const parser = new P()
  parser.setLanguage(lang)
  const analyzer = new RealJavaScriptAnalyzer() as any

  const all = collect(REPO).sort()
  const sample = all.slice(0, LIMIT)
  console.log(`  repo ${REPO}: ${all.length} js files, auditing the first ${sample.length}`)

  // Pass 1 — every file's EXPORT SURFACE, from the audited `exports` edges.
  const exportsOf = new Map<string, Set<string>>()
  const parseCache = new Map<string, any>()
  for (const f of all) {
    let src = ""
    try {
      src = fs.readFileSync(f, "utf8")
    } catch {
      continue
    }
    if (src.length > 2_000_000) continue
    let tree: any
    try {
      tree = parser.parse(src).rootNode
      parseCache.set(f, tree)
    } catch {
      continue
    }
    const set = new Set<string>()
    try {
      const r = await analyzer.analyze(tree, src, f, undefined)
      for (const e of r.relationships ?? []) {
        if (String(e.type) !== "exports") continue
        const leaf = String(e.target).split(":").pop()!
        set.add(leaf === "*" ? "*" : leaf.replace(/^.*\./, ""))
      }
    } catch {
      continue
    }
    exportsOf.set(f, set)
  }
  console.log(`  export surfaces indexed for ${exportsOf.size} files`)

  // Pass 2 — every import edge in the sample, adjudicated.
  let edges = 0, named = 0, unresolvedStar = 0, external = 0, pathDead = 0, fabricated = 0
  const fabSamples: string[] = []
  const deadSamples: string[] = []

  for (const f of sample) {
    let src = ""
    try {
      src = fs.readFileSync(f, "utf8")
    } catch {
      continue
    }
    if (src.length > 2_000_000) continue
    const tree = parseCache.get(f) ?? parser.parse(src).rootNode
    let r: any
    try {
      r = await analyzer.analyze(tree, src, f, undefined)
    } catch {
      continue
    }
    for (const e of r.relationships ?? []) {
      if (String(e.type) !== "imports") continue
      edges++
      const target = String(e.target)
      const cut = target.lastIndexOf(":")
      if (cut < 0) continue
      const spec = target.slice(0, cut)
      const item = target.slice(cut + 1)
      if (item === "*") {
        unresolvedStar++
        continue
      }
      // Compare the DECLARED name, not the LOCAL BINDING. The edge's target leaf
      // is the local binding — `import { parse as _parse }` publishes
      // `...:_parse` — while the module exports `parse`. JD2b already records the
      // remote name additively as `metadata.declaredName` / `declaredKind`, which
      // is exactly what this check needs.
      //
      // Getting this wrong manufactured BOTH fabrications in the first run, and
      // measurement is what caught them:
      //   compiler/index.js: `import { parse as _parse, Parser }` -> the module
      //     exports `parse`; checking for `_parse` called it wrong.
      //   utils/html.js: `import entities from './entities.js'` -> a DEFAULT
      //     import of `export default {...}`; checking for `entities` called it
      //     wrong, because the remote name is `default`.
      // Both were the verifier's bug, not the analyzer's — the same shape of
      // mistake the three java oracles made, and the reason the first run's
      // numbers were not believed before being diagnosed.
      const md = (e as any).metadata ?? {}
      const remote = typeof md.declaredName === "string" && md.declaredName !== "*" ? md.declaredName : item
      const kind = typeof md.declaredKind === "string" ? md.declaredKind : "named"
      named++
      const hit = resolveSpecifier(f, spec)
      if (hit === null) {
        // Either a bare package specifier (external) or a relative path that
        // resolves to nothing. Distinguish: a specifier starting with "." that
        // resolves to no file is a DEAD target.
        if (spec.startsWith(".") || spec.startsWith("/")) {
          pathDead++
          if (deadSamples.length < 10) deadSamples.push(`  ${path.relative(REPO, f)}: ${target}`)
        } else {
          external++
        }
        continue
      }
      const surface = exportsOf.get(hit)
      if (!surface) continue // target outside the audited set; not adjudicable here
      // A default import is satisfied by the target's `default` export whatever
      // the local binding is called; a named/aliased import needs the DECLARED name.
      const wanted = kind === "default" ? "default" : remote
      if (surface.has(wanted) || surface.has("*")) continue
      fabricated++
      if (fabSamples.length < 10) {
        fabSamples.push(`  ${path.relative(REPO, f)}: ${target} (declaredName=${md.declaredName ?? "-"} kind=${kind})  ->  ${path.relative(REPO, hit)} exports [${[...surface].slice(0, 8).join(",")}]`)
      }
    }
  }

  const verifiable = named - external
  console.log("")
  console.log(`  import edges examined      ${edges}`)
  console.log(`  item is \`*\` (unresolved)   ${unresolvedStar}   — the honest refusal, never counted wrong`)
  console.log(`  named item                ${named}`)
  console.log(`    external package        ${external}          not adjudicable by a filesystem walk`)
  console.log(`    relative, target DEAD   ${pathDead}`)
  console.log(`    FABRICATED item         ${fabricated}          names a symbol the module never exported`)
  if (verifiable > 0) {
    console.log(`\n  fabrication rate among adjudicable named items: ${fabricated}/${verifiable} = ${(100 * fabricated / verifiable).toFixed(2)}%`)
  }
  if (deadSamples.length) {
    console.log(`\n  DEAD path samples:`)
    for (const s of deadSamples) console.log(s)
  }
  if (fabSamples.length) {
    console.log(`\n  FABRICATED item samples:`)
    for (const s of fabSamples) console.log(s)
  }
  console.log("")
  console.log(`IMPORT CORPUS AUDIT: ${fabricated === 0 && pathDead === 0 ? "PASS" : `FAIL — ${fabricated} fabricated, ${pathDead} dead`}`)
  if (fabricated !== 0 || pathDead !== 0) process.exit(5)
}

main()
