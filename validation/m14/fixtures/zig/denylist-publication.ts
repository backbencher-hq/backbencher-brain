/**
 * DID THE `keepSymbol` REPAIR PUBLISH ZIG'S `Self`, AND DO THE EDGES THAT NAME IT RESOLVE?
 *
 * ## WHY THIS EXISTS
 *
 * `keepSymbol` (`src/ast/pool-worker.ts:427`) refuses symbols by NAME. Its UNIVERSAL denylist
 * held `Self`, `self`, `root` and `unknown`, and this lane's §8 item 8 asked for a zig
 * exemption for three of them, with counts: `Self` declared in 169 of 3,834 corpus files and
 * named by 240 edges, `root` by 157 edges in 57 files, `unknown` by 39 edges in 33 files.
 *
 * Commit `0a65d2b48` ("keepSymbol's denylist deleted real declarations in six languages")
 * answered it — by splitting the list and moving all four names OUT of `UNIVERSAL` into a
 * per-language `RESERVED` map that contains only `php` and `sql`. Zig is in neither, so for
 * `lang === "zig"` all four now survive. That is a SHARED-file change (§8, not this lane's),
 * and it changes the resolution of 436 of this lane's edges.
 *
 * Nobody has measured what it did to zig. This probe does, and it is separable from the fix:
 * the deltas below are computed by asking the PRODUCTION `keepSymbol` about each name, so the
 * pre-fix column is not a reconstruction of the old list from a comment — it is the name the
 * old list recorded, checked against the function that decides.
 *
 * ## WHAT IT MEASURES
 *
 *  1. **The unit row.** `keepSymbol(s, "zig")` for every name on the pre-fix UNIVERSAL list,
 *     read from the function itself. This is the falsifier: if `Self` still reads `false` the
 *     §8 item is open, and the corpus rows below are about a repair that did not happen.
 *
 *  2. **The corpus rows**, through production `parseFile` (never `analyze()`) over the same
 *     admitted population the coverage gate tallies — `git ls-files -- '*.zig'` per repo,
 *     `<= 512 KB`. For each probed name:
 *       - `declared`  — the TREE declares it (a tree-sitter walk for the declaration node, no
 *                        regex). This is the `neverIndexed` discriminator: a name is only
 *                        "never indexed" when the tree declares it and nothing was published.
 *       - `published` — production `parseFile` returned a symbol with that name.
 *       - `edges`     — relationships whose `target` is exactly that name.
 *       - `file-local` / `corpus` — of those edges, how many bind to a published symbol in the
 *                        edge's OWN file, and how many bind to a uniquely-named one corpus-wide.
 *       - `under prefix` — the same edge counts had the pre-fix list still applied, which is
 *                        `0` for a name the old list dropped and identical for a name it kept.
 *
 *  3. **The ambiguity question, per the incoming-edge brief's requirement B.** `Self` is
 *     declared once per file that has it, so `corpus`-wide resolution is ambiguous by
 *     construction (N files, one name). The brief's rule is that an ambiguous target is ONE
 *     edge attributed to ONE declaration — so the file-local count is the one that matters and
 *     the corpus-wide count is printed beside it to show the gap rather than hidden in an
 *     average.
 *
 * ## WHAT IT CANNOT SEE
 *
 * It measures `parseFile`'s OUTPUT, not the store's `target_symbol_id`. `src/ast/engine.ts`
 * (shared, §8) is where a target STRING becomes an id and it matches by name across the whole
 * corpus, so the `corpus` column here is a name-match census the store would perform, not a
 * readout of what it did. It also cannot see whether a resolved binding is the RIGHT one —
 * that is the misbinding question §8 item 6 measures (151,004 breakable ambiguous edges
 * corpus-wide), and it is not re-decided here.
 *
 * It inherits the pinned wasm's ERROR-node rate, so a declaration inside an ERROR node is
 * invisible to both the walk and the analyzer and these counts are a floor on the population.
 *
 * ## USAGE
 *
 *   npx tsx validation/m14/fixtures/zig/denylist-publication.ts
 *   npx tsx validation/m14/fixtures/zig/denylist-publication.ts --sample 400
 */
import { readFileSync, statSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { join, dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { readdirSync } from "node:fs"
import { Parser, Language } from "web-tree-sitter"
import { parseFile, keepSymbol } from "../../../../src/ast/pool-worker"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, "../../../..")
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"

const argv = process.argv.slice(2)
const arg = (n: string, d: string) => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}
const SAMPLE = Number(arg("sample", "0")) // 0 = whole admitted population
const CEILING = 524288

/**
 * The names `keepSymbol`'s UNIVERSAL denylist held BEFORE `0a65d2b48`, transcribed from the
 * comment the commit left in place at `src/ast/pool-worker.ts:483-499` — that comment names
 * every removed entry (`self, Self, me, My, destructor, root, program, source_file, unknown`)
 * and the commit left the five survivors visible above it. Kept as a literal on purpose: a
 * counterfactual rebuilt by asking the CURRENT function what it would decide is not a
 * counterfactual at all, it is the present tense twice.
 */
const PRE_FIX_UNIVERSAL = [
  "this", "super",
  "SCSS_FILE_SCOPE", "GlobalScope", "module_declaration", "package_manifest",
  "self", "Self", "me", "My", "destructor", "root", "program", "source_file", "unknown",
]

/** The names this lane's §8 item 8 actually asked about. */
const PROBED = ["Self", "root", "unknown", "self", "this", "super"]

await Parser.init({
  locateFile: () => join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm"),
})
const language: any = await Language.load(readFileSync(join(ROOT, "wasm", "tree-sitter-zig.wasm")))
const parser = new Parser()
parser.setLanguage(language)

function trackedZig(dir: string): string[] {
  try {
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    return []
  }
  try {
    return execFileSync("git", ["-C", dir, "ls-files", "-z", "--", "*.zig"], {
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
    })
      .split("\0")
      .filter(Boolean)
  } catch {
    return []
  }
}

/**
 * Does the TREE BIND `name`? Walked on `node.type` and field names — no regex over source
 * text, which is the whole point of the census: a text probe for `Self` matches the identifier
 * inside every `return @TypeOf(self_val)` as well as the declaration itself.
 *
 * "Binds", not "appears". An earlier revision of this function accepted ANY named child whose
 * text equalled the name, which counted `root.method()` and `return Self` as declarations and
 * inflated `root` from an unmeasured number to "declared in 43 files, published 0" — a
 * neverIndexed claim built on identifier USES. The binding slots are exactly four, read off
 * the pinned grammar's own tree:
 *
 *   const Self = @This();      variable_declaration, binding = the identifier after const/var
 *   fn f(root: u32)            parameter,           field `name`
 *   struct { root: u32 }       container_field,    field `name`
 *   fn f() void                function_declaration, field `name`
 *
 * `variable_declaration` gives its binding NO field name — it is child 0 = the `const`/`var`
 * keyword, child 1 = the identifier — so it is read positionally and only at index 1, which is
 * what keeps `const _ = root` (a use) out of the count.
 */
function bindsName(root: any, text: string, name: string): boolean {
  let found = false
  const visit = (node: any): void => {
    if (found) return
    const t = node.type
    if (t === "variable_declaration") {
      // child 0 is `const` or `var`; the binding identifier follows it. Zig destructuring
      // (`x, const y, var z: u64 = .{1,2,3}`) is ONE declaration carrying several slots, and
      // each slot is its own `variable_declaration`, so position 1 is correct per node.
      const id = node.child(1)
      if (id && id.type === "identifier" && text.slice(id.startIndex, id.endIndex) === name) {
        found = true
        return
      }
    } else if (t === "parameter" || t === "container_field" || t === "function_declaration") {
      const n = node.childForFieldName?.("name")
      if (n && text.slice(n.startIndex, n.endIndex) === name) {
        found = true
        return
      }
    }
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (c) visit(c)
    }
  }
  try {
    visit(root)
  } catch {
  }
  return found
}

/**
 * How many TIMES does the grammar bind `name` in one file? This is the decision variable for
 * any repair: a file that binds exactly one `Self` can publish it unambiguously, a file that
 * binds three has no way to say which one an edge meant without positional disambiguation.
 */
function bindCount(root: any, text: string, name: string): number {
  let n = 0
  const visit = (node: any): void => {
    const t = node.type
    if (t === "variable_declaration") {
      const id = node.child(1)
      if (id && id.type === "identifier" && text.slice(id.startIndex, id.endIndex) === name) n++
    } else if (t === "parameter" || t === "container_field" || t === "function_declaration") {
      const id = node.childForFieldName?.("name")
      if (id && text.slice(id.startIndex, id.endIndex) === name) n++
    }
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (c) visit(c)
    }
  }
  try {
    visit(root)
  } catch {
  }
  return n
}

type Row = {
    filesDeclared: Set<string>
    filesPublished: Set<string>
    published: number
    edges: number
    edgesFileLocal: number
    edgesCorpusUnique: number
    edgesCorpusAmbiguous: number
    /** Per file: does the grammar BIND this name? Set for every file holding a probe edge. */
    boundIn: Map<string, boolean>
    /** Files holding a probe edge for this name that production did NOT publish. */
    missDeclared: Set<string>
    missUndeclared: Set<string>
    /** For each missDeclared file: how many times the grammar binds the name there. */
    bindsPerMissFile: Map<string, number>
  }

  function newRow(): Row {
    return {
      filesDeclared: new Set(),
      filesPublished: new Set(),
      published: 0,
      edges: 0,
      edgesFileLocal: 0,
      edgesCorpusUnique: 0,
      edgesCorpusAmbiguous: 0,
      boundIn: new Map(),
      missDeclared: new Set(),
      missUndeclared: new Set(),
      bindsPerMissFile: new Map(),
    }
  }

async function main() {
  // ── 1. THE UNIT ROW ────────────────────────────────────────────────────
  console.log("denylist-publication: what keepSymbol's repair did to zig's Self/root/unknown edges")
  console.log(`commit under test: pool-worker.ts keepSymbol, at HEAD\n`)
  console.log("1. THE UNIT ROW — keepSymbol(s, \"zig\") per pre-fix UNIVERSAL name")
  console.log("   (the falsifier: if Self reads false the repair did not reach zig)\n")
  console.log("   name".padEnd(22) + "pre-fix".padEnd(9) + "kept now".padEnd(11) + "pre-fix dropped it")
  console.log("   " + "-".repeat(72))
  const droppedNow: string[] = []
  const survivedNow: string[] = []
  for (const n of PRE_FIX_UNIVERSAL) {
    const s: any = { name: n, kind: "variable", startLine: 1, endLine: 1, startByte: 0, endByte: 1 }
    const kept = keepSymbol(s, "zig")
    const wasDropped = !kept
    if (wasDropped) droppedNow.push(n)
    else survivedNow.push(n)
    console.log(
      "   " + n.padEnd(20) + "denied".padEnd(9) + String(kept).padEnd(11) +
      (wasDropped ? "YES — still deleted" : "no — now published"),
    )
  }
  console.log(
    `\n   ${survivedNow.length} of ${PRE_FIX_UNIVERSAL.length} pre-fix denials are GONE for zig; ` +
    `${droppedNow.length} remain: ${droppedNow.join(", ") || "(none)"}\n`,
  )

  // ── corpus ─────────────────────────────────────────────────────────────
  const files: string[] = []
  for (const repo of ["zig", "zls", "ghostty"]) {
    const root = join(CR, repo)
    try {
      if (!statSync(root).isDirectory()) continue
    } catch {
      continue
    }
    for (const rel of trackedZig(root)) files.push(join(root, rel))
  }
  files.sort()

  let admitted = 0
  let overCeiling = 0
  let parsed = 0
  let degraded = 0
  let failures = 0
  let totalSymbols = 0
  let totalEdges = 0
  const rows = new Map<string, Row>(PROBED.map(n => [n, newRow()]))
  // name -> how many published symbols corpus-wide carry it (the ambiguity denominator)
  const nameMultiplicity = new Map<string, number>()
  // Per-file cached facts, so the corpus-wide columns are resolved in a SECOND pass over the
  // whole population. Resolving them inline would score an edge against a corpus that is only
  // half-read: a file early in the sorted order sees a name as unique because the files that
  // also publish it have not been parsed yet. That ordering bias is the defect pass 4 measured
  // in another instrument; it is not repeated here.
  type Cached = { file: string; local: Set<string>; probeTargets: string[] }
  const cache: Cached[] = []

  for (const f of files) {
    let size = 0
    try { size = statSync(f).size } catch { }
    if (size > CEILING) { overCeiling++; continue }
    admitted++
    if (SAMPLE > 0 && admitted > SAMPLE) { admitted--; continue }

    let res: any
    try {
      res = await parseFile(f, "zig")
    } catch {
      failures++
      continue
    }
    if (!res) { failures++; continue }
    parsed++
    if (res.fallback) degraded++
    const syms = res.symbols ?? []
    const rels = res.relationships ?? []
    totalSymbols += syms.length
    totalEdges += rels.length

    const local = new Set<string>()
    for (const s of syms) {
      const n = String(s.name ?? "")
      if (!n) continue
      local.add(n)
      nameMultiplicity.set(n, (nameMultiplicity.get(n) ?? 0) + 1)
      const row = rows.get(n)
      if (row) {
        row.published++
        row.filesPublished.add(f)
      }
    }
    cache.push({ file: f, local, probeTargets: [] })

    // The tree BINDS it? Only worth asking for a probed name. This is the `neverIndexed`
    // discriminator: a name is only "never indexed" when the grammar binds it and production
    // published nothing.
    const probeTargets: string[] = []
    for (const r of rels) {
      const t = String(r.target ?? "")
      if (PROBED.includes(t)) probeTargets.push(t)
    }
    if (probeTargets.length > 0) {
      cache[cache.length - 1].probeTargets = probeTargets
      let text: string | null = null
      for (const n of new Set(probeTargets)) {
        const row = rows.get(n)!
        if (text === null) {
          try { text = readFileSync(f, "utf8") } catch { text = "" }
        }
        let tree: any = null
        try { tree = parser.parse(text) } catch { }
        const bound = !!(tree && bindsName(tree.rootNode, text, n))
        // The decision variable is about the files production did NOT publish, so the count is
        // taken for those files only. An earlier revision recorded it for every bound file,
        // which made the histogram cover 162 files while the denominator beside it was 92 and
        // printed "122 of 92 are unambiguous" — a comparison between two different sets.
        if (bound && !local.has(n)) row.bindsPerMissFile.set(f, bindCount(tree.rootNode, text, n))
        try { tree?.delete?.() } catch { }
        row.boundIn.set(f, bound)
        if (bound) row.filesDeclared.add(f)
        if (local.has(n)) continue
        // Requirement C's discriminator, recorded per file rather than as one total: the
        // grammar binds it and production published nothing, so the analyzer dropped a real
        // declaration — versus the file never declaring it, which is a hopeless-string target
        // and not a defect.
        if (bound) row.missDeclared.add(f)
        else row.missUndeclared.add(f)
      }
    }
  }

  // Second pass: every edge scored against the WHOLE population's name multiplicity.
  for (const c of cache) {
    for (const t of c.probeTargets) {
      const row = rows.get(t)!
      row.edges++
      if (c.local.has(t)) row.edgesFileLocal++
      const mult = nameMultiplicity.get(t) ?? 0
      if (mult === 1) row.edgesCorpusUnique++
      else if (mult > 1) row.edgesCorpusAmbiguous++
    }
  }

  console.log("2. THE CORPUS ROWS — production parseFile over the admitted population\n")
  console.log(
    `   repos: zig, zls, ghostty   admitted (<= ${CEILING / 1024} KB): ${admitted}   ` +
    `over ceiling (excluded): ${overCeiling}`,
  )
  console.log(`   parseFile: ${parsed} parsed, ${degraded} degraded, ${failures} failed`)
  console.log(`   population: ${totalSymbols} symbols, ${totalEdges} relationships\n`)
  console.log(
    "   name".padEnd(10) +
    "binds".padEnd(9) + "published".padEnd(11) + "files pub".padEnd(11) +
    "edges".padEnd(9) + "file-local".padEnd(12) + "corpus×1".padEnd(11) + "corpus×N",
  )
  console.log("   " + "-".repeat(84))
  for (const n of PROBED) {
    const r = rows.get(n)!
    console.log(
      "   " + n.padEnd(8) +
      String(r.filesDeclared.size).padEnd(9) +
      String(r.published).padEnd(11) +
      String(r.filesPublished.size).padEnd(11) +
      String(r.edges).padEnd(9) +
      String(r.edgesFileLocal).padEnd(12) +
      String(r.edgesCorpusUnique).padEnd(11) +
      String(r.edgesCorpusAmbiguous),
    )
  }

  console.log("\n3. THE SAME EDGES UNDER THE PRE-FIX DENYLIST")
  console.log("   A name the old list dropped could not be published, so its file-local count was 0.")
  console.log("   The corpus-wide columns are unaffected by the repair and are shown for reference.\n")
  console.log("   name".padEnd(10) + "edges".padEnd(9) + "file-local now".padEnd(17) + "file-local pre-fix" + "delta")
  console.log("   " + "-".repeat(70))
  let totalDelta = 0
  let probedEdges = 0
  for (const n of PROBED) {
    const r = rows.get(n)!
    // The pre-fix list denied every name in PRE_FIX_UNIVERSAL. A denied name cannot be
    // published, so its file-local count was 0; a name the list did not hold is unaffected.
    // An earlier revision of this probe tested membership of the names STILL denied, which
    // inverted the column and printed a delta of 0 on every row — including `Self`, whose
    // file-local binds are impossible under the pre-fix list by construction. The unit row
    // above is what made that visible: it says `Self` is kept NOW, so the pre-fix value had
    // to be 0.
    const wasDenied = PRE_FIX_UNIVERSAL.includes(n)
    const before = wasDenied ? 0 : r.edgesFileLocal
    const delta = r.edgesFileLocal - before
    totalDelta += delta
    probedEdges += r.edges
    console.log(
      "   " + n.padEnd(8) + String(r.edges).padEnd(9) +
      String(r.edgesFileLocal).padEnd(17) + String(before).padEnd(17) +
      (delta === 0 ? "0" : `+${delta}`),
    )
  }
  console.log(`\n   -> ${totalDelta} of ${probedEdges} edges naming these ${PROBED.length} names became`)
  console.log("      file-locally resolvable as a result of a change made in a shared file this")
  console.log("      lane does not own.")

  const selfRow = rows.get("Self")!
  console.log("\n4. REQUIREMENT B — IS THE AMBIGUOUS TARGET CLOSED?")
  console.log(
    `   Self: declared in ${selfRow.filesDeclared.size} files, published ${selfRow.published} times,` +
    ` named by ${selfRow.edges} edges.`,
  )
  console.log(
    `   file-local binds ${selfRow.edgesFileLocal}; corpus-wide name match is AMBIGUOUS for ` +
    `${selfRow.edgesCorpusAmbiguous} of them`,
  )
  console.log(
    `   (${nameMultiplicity.get("Self") ?? 0} published symbols share the one name), so ` +
    `${selfRow.edgesCorpusUnique} bind uniquely.`,
  )
  console.log(
    selfRow.edgesFileLocal === selfRow.edges
      ? "   -> every Self edge binds inside its own file: the ambiguity is closed by position, not by name."
      : `   -> ${selfRow.edges - selfRow.edgesFileLocal} Self edges do NOT bind file-locally and are`,
  )
  if (selfRow.edgesFileLocal !== selfRow.edges) {
    console.log("      left to a corpus-wide name match that is ambiguous by construction. Section 5")
    console.log("      separates the two reasons, and only one of them is a defect.")
  }
  console.log("\n5. REQUIREMENT C — FOR EVERY EDGE THAT DOES NOT BIND FILE-LOCALLY, WHY NOT?")
  console.log("   `grammar binds it, no symbol published` — production declined to publish a real")
  console.log("   declaration. Whether that is a DEFECT or this lane's declared scope is question 6.")
  console.log("   `file never binds it` — a hopeless-string target: no analyzer change can make it")
  console.log("   bind, and the edge should not claim to.\n")
  console.log("   name".padEnd(10) + "edges".padEnd(9) + "no bind".padEnd(11) + "bound, unpublished" + "never bound here")
  console.log("   " + "-".repeat(84))
  let droppedDeclarations = 0
  for (const n of PROBED) {
    const r = rows.get(n)!
    const miss = r.edges - r.edgesFileLocal
    droppedDeclarations += r.missDeclared.size
    console.log(
      "   " + n.padEnd(8) + String(r.edges).padEnd(9) + String(miss).padEnd(11) +
      String(r.missDeclared.size).padEnd(23) + String(r.missUndeclared.size),
    )
  }
  console.log(
    `\n   -> ${droppedDeclarations} file(s) bind a probed name in the grammar and production published`
  )
  console.log("      no symbol for it.")

  console.log("\n6. THE DECISION VARIABLE FOR ANY REPAIR — how many times does each such file bind it?")
  console.log("   One binding in a file is publishable unambiguously. Two or more is not, without")
  console.log("   positional disambiguation the edge does not carry.\n")
  for (const n of PROBED) {
    const r = rows.get(n)!
    if (r.missDeclared.size === 0) continue
    const hist = new Map<number, number>()
    for (const c of r.bindsPerMissFile.values()) hist.set(c, (hist.get(c) ?? 0) + 1)
    const parts = [...hist.entries()].sort((a, b) => a[0] - b[0])
      .map(([k, v]) => `${v} file(s) bind it ${k}×`)
    const single = hist.get(1) ?? 0
    console.log(`   ${n}: ${parts.join(", ")}`)
    console.log(
      `      ${single} of ${r.missDeclared.size} are unambiguous at file scope` +
      (single === r.missDeclared.size ? " — every one." : `; ${r.missDeclared.size - single} are not.`),
    )
  }
}

main()