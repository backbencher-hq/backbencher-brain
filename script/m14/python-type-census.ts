/**
 * PYTHON TYPE CENSUS — the all-out-of-all classification instrument for the python lane.
 *
 * WHAT THIS FILE IS. One instrument, TWO modes, and every number it prints carries its
 * population, its root and the digests it was read at.
 *
 *   --grammar   the PINNED-GRAMMAR node-type inventory (cheap; no corpus; no parse).
 *               This is the CITATION for a grammar-absence ruling: it enumerates every node
 *               type the PRODUCTION parser is configured with, through the production
 *               `getParser("python")` — the same `wasm/tree-sitter-python.wasm` bytes the
 *               analyzer parses with, whose sha256 is printed beside the inventory. A node
 *               type that is not in this list CANNOT be produced by the grammar, so a corpus
 *               count of the construct it would carry is not a missing measurement: it is
 *               an impossibility, and the inventory is what makes it checkable.
 *
 *   --corpus    the WHOLE admitted population, parsed with the production parser and read
 *               with the production analyzer, counting every emitted edge by relationship
 *               type (rows · files · repos). This is the "implemented — with a measured
 *               whole-population count" half of the classification.
 *
 * WHY IT EXISTS AS ITS OWN FILE, and not as a number in a page. The lane's bar is the
 * all-out-of-all rule: `n/n` where `n` is the language's OWN expressible set, and every type
 * outside `n` must be ruled with a citation. A ruling that lives only in prose is not
 * reproducible, and the fleet's coverage-block gate checks the CITED ARTIFACT EXISTS. So the
 * census writes its artifact, and the page cites the artifact.
 *
 * THE POPULATION RULE IS THE GATE'S, copied not shared: the gate (`script/m14/incoming-gate.ts`)
 * is the Lead's file and this lane does not edit it, so this instrument re-implements the
 * same rule and PRINTS the rule beside the count — a corpus that admits a different file
 * count under a different rule is not the same population, and the reader must be able to
 * see the rule rather than trust it:
 *
 *   · the corpus root is `BB_CORPUS_ROOT` (the campaign's FARM root, `$PWD/.corpus`) or the
 *     gate's default root; the ABSOLUTE path is printed;
 *   · a corpus entry is a REPO only if it is a directory AND a real git checkout
 *     (`git rev-parse --git-dir`) — a stray directory is not evidence;
 *   · the file set is `git ls-files` (TRACKED paths), not a filesystem walk, so an untracked
 *     file is not in the population;
 *   · an admitted file is one whose extension the lane admits (`.py`, `.pyi`, `.pyw`) AND
 *     whose size is at or under the engine's own 1 MB full-AST limit; the over-cap and
 *     absent counts are PRINTED, never silently dropped;
 *   · a symlinked corpus root entry is a repository: `statSync(dir).isDirectory()` FOLLOWS
 *     the link (a `readdirSync(...,{withFileTypes:true}).isDirectory()` walk does NOT, and
 *     silently drops whole repositories — the trap the campaign has paid for on lane after
 *     lane), and the number of symlinked entries followed is PRINTED.
 *
 * NO REGEX. The extension test is a suffix comparison; the path rules are path operations.
 *
 * Usage:
 *   bun run script/m14/python-type-census.ts --grammar
 *   bun run script/m14/python-type-census.ts --corpus --out <path.json>
 */
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { createHash } from "node:crypto"

import { getParser } from "../../src/ast/engine"
import { RealPythonAnalyzer } from "../../src/ast/real-python-analyzer"
import { buildOverrideCompanion } from "../../src/ast/override-context"

const HERE = (import.meta as any).dir ?? path.dirname(new URL(import.meta.url).pathname)
const ROOT = path.resolve(HERE, "..", "..")

/** THE ADMITTED EXTENSIONS — the gate's own map for this lane (`incoming-gate.ts`: `python: "py,pyi,pyw"`). */
const ADMITTED_EXTENSIONS = [".py", ".pyi", ".pyw"]
/** THE ENGINE'S OWN FULL-AST LIMIT — the same number the gate's SIZE_CAP uses, because the cap is
 *  a population claim and the population is "the files the analyzer can read". */
const SIZE_CAP = 1024 * 1024

/** The corpus root: the campaign's FARM root by default, the gate's default otherwise. */
const CORPUS_ROOT = path.resolve(process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories")

const argv = process.argv.slice(2)
const WANT_GRAMMAR = argv.includes("--grammar")
const WANT_CORPUS = argv.includes("--corpus")
const OUT_INDEX = argv.indexOf("--out")
const REPO_ONLY = argv.includes("--repo") ? argv[argv.indexOf("--repo") + 1] : null

/** THE ARM'S OWN LOG — the production path's TABLE 1, read by `readArmTable` so the census's own
 *  per-type counts are compared against the PRODUCTION path, not against nothing. */
const ARM_LOG = path.resolve(
  process.cwd(),
  "validation/m14/measurements/python-cell-noindex-2026-10-21.log",
)
const OUT = OUT_INDEX >= 0 ? argv[OUT_INDEX + 1] : null

function sha256File(p: string): string {
  return createHash("sha256").update(readFileSync(p)).digest("hex")
}
function gitHead(): string {
  try {
    return execFileSync("git", ["-C", ROOT, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()
  } catch {
    return "UNKNOWN"
  }
}
function blobSha(p: string): string {
  try {
    return execFileSync("git", ["-C", ROOT, "hash-object", p], { encoding: "utf8" }).trim()
  } catch {
    return "UNKNOWN"
  }
}

/**
 * THE VIEW — the digests the numbers were read at. A number without them is not reproducible.
 */
const VIEW = {
  head: gitHead(),
  analyzer: blobSha("src/ast/real-python-analyzer.ts"),
  grammarWasm: "wasm/tree-sitter-python.wasm",
  grammarSha256: sha256File(path.join(ROOT, "wasm/tree-sitter-python.wasm")),
  corpusRoot: CORPUS_ROOT,
}

/* ──────────────────────────────────────────────────────────────────────────────
 * THE GRAMMAR HALF — the node-type and field inventory of the PINNED grammar.
 * ────────────────────────────────────────────────────────────────────────────── */

/**
 * THE THREE RULED-OUT FAMILIES, and the node types each would need.
 *
 * Each entry is a list of the node types a construct would have to be spelled with. The
 * ruling is: the pinned grammar's node-type inventory contains NONE of them, so the
 * construct cannot be written in this language, so no corpus can contain an instance of
 * it. The list is EXPLICIT rather than a prefix test, so the ruling is checkable by eye
 * against the printed inventory — and so a future grammar that adds one of them FAILS
 * this instrument instead of silently leaving a stale ruling behind.
 */
const CANDIDATE_NODE_FAMILIES: {
  value: string
  why: string
  nodes: string[]
  /** the node types that SOUND like the construct and are NOT it — named, disambiguated, and
   *  reported as PRESENT so a reader can see the ruling did not fire on a decoy. */
  decoys: { node: string; why: string }[]
  /** the name markers a prefix test uses, and why each is or is not a marker. */
  markers: { marker: string; why: string; isMarker: boolean }[]
}[] = [
  {
    value: "renders",
    why:
      "A component RENDERS another component: the source is the rendering symbol and the target is " +
      "the rendered component. The measured population of the value is TSX/JSX, where the construct " +
      "is an ELEMENT node. Python's pinned grammar has no element/component node of any kind: a " +
      "python template (Django, Jinja2) is a STRING LITERAL, so the rendered tree is not in the AST " +
      "at all, and the nearest python construct that produces another object from a name is a CALL, " +
      "which this lane already publishes as `calls`.",
    nodes: [
      "jsx_element", "jsx_self_closing_element", "jsx_fragment", "jsx_opening_element",
      "jsx_closing_element", "jsx_attribute", "jsx_expression", "jsx_namespace_name",
      "element", "self_closing_element", "component", "component_element", "html_element",
      "template_element", "markup_element",
    ],
    decoys: [],
    markers: [
      { marker: "jsx", why: "the JSX element family — a python template is a STRING LITERAL, not a node", isMarker: true },
      { marker: "element", why: "an element node of any spelling", isMarker: true },
      { marker: "component", why: "a component node of any spelling", isMarker: true },
    ],
  },
  {
    value: "mixes_in",
    why:
      "A class COMPOSES a mixin into its supertype chain. The measured population is Dart's " +
      "`class C with M`, where the mixin list is a CLAUSE SEPARATE from the `extends` clause — " +
      "that separation is what lets the relationship be stated at all. Python's pinned grammar has " +
      "ONE superclass clause (`class_definition.superclasses`, an `argument_list`) and NO mixin " +
      "clause and NO mixin field: python's source cannot say which base is the mixin and which is " +
      "the superclass, so the DISTINCTION the relationship denotes is not expressible. The nearest " +
      "python construct is multiple inheritance (`class C(A, B)`), whose bases are all published as " +
      "`extends` — the same clause, the same relation.",
    nodes: [
      "mixins", "mixin", "mixin_application", "mixin_class", "mixin_declaration", "mixin_body",
      "mixin_application_class", "mixin_clause", "trait", "trait_declaration", "with_traits",
    ],
    decoys: [
      {
        node: "with_statement",
        why:
          "python's CONTEXT MANAGER statement (`with open(f) as fh:`) — the `with` KEYWORD binds a " +
          "context manager's `__enter__`/`__exit__`. It is NOT a supertype composition and it shares " +
          "nothing with Dart's `class C with M` beyond the spelling of the keyword. NAMED here " +
          "because a prefix test on `with` would have fired on it, and a ruling that fires on a " +
          "decoy is not a ruling.",
      },
      {
        node: "with_clause",
        why:
          "the clause INSIDE python's context-manager statement — the `with` keyword's own clause. " +
          "Same decoy as `with_statement`, one level down.",
      },
      {
        node: "with_item",
        why: "one `as` binding inside a python context-manager statement — the same decoy again.",
      },
    ],
    markers: [
      { marker: "mixin", why: "the mixin family — a supertype composed by a separate clause", isMarker: true },
      { marker: "trait", why: "the trait family — Ruby's spelling of the same composition", isMarker: true },
      { marker: "with_", why: "NOT a marker: python's `with` is the CONTEXT MANAGER statement, a different construct", isMarker: false },
    ],
  },
  {
    value: "part_of",
    why:
      "A library unit INCLUDES a part file: the source is the including library/file symbol and " +
      "the target is the part's file or module symbol. The measured population is Dart's " +
      "`part 'x.dart';` / `part of my.lib;` — a COMPILE-UNIT directive that shares the library's " +
      "scope and imports nothing. Python's pinned grammar has no part/include directive and no " +
      "`part_*` node of any kind; python's unit of inclusion is an IMPORT, which names a module and " +
      "creates binding scope, and this lane publishes it as `imports`.",
    nodes: [
      "part_directive", "part_of_directive", "part", "parts", "part_spec", "part_of",
      "include_directive", "include", "library_directive", "library", "library_name",
      "source_file", "fragment",
    ],
    decoys: [],
    markers: [
      { marker: "part", why: "the part family — a compile-unit inclusion", isMarker: true },
      { marker: "include", why: "an include directive of any spelling", isMarker: true },
      { marker: "fragment", why: "a fragment node — an XML/HTML construct, not a unit inclusion", isMarker: false },
    ],
  },
]

async function grammarHalf(): Promise<any> {
  const parser = await getParser("python" as any)
  const language = parser.language
  if (!language) throw new Error("NO LANGUAGE for python — the pinned grammar did not load")
  const named: string[] = []
  const anonymous: string[] = []
  const total = language.nodeTypeCount
  for (let id = 1; id < total; id++) {
    const t = language.nodeTypeForId(id)
    if (t == null) continue
    if (language.nodeTypeIsNamed(id)) named.push(t)
    else anonymous.push(t)
  }
  named.sort()
  anonymous.sort()
  const uniqueNamed = [...new Set(named)].sort()
  const uniqueAnon = [...new Set(anonymous)].sort()

  // THE FIELD INVENTORY — the grammar's own field names, by id. A construct that had its own
  // clause would have its own field here (`mixins`, `part`, `jsx`), so this is the second
  // half of the absence: not only is there no NODE, there is no FIELD to hang it on.
  const fields: { id: number; name: string }[] = []
  for (let id = 1; id < 256; id++) {
    const n = language.fieldNameForId(id)
    if (n) fields.push({ id, name: n })
  }
  fields.sort((a, b) => a.id - b.id)

  const namedSet = new Set(uniqueNamed)
  const anonSet = new Set(uniqueAnon)
  const fieldNames = fields.map((f) => f.name)

  const rulings = CANDIDATE_NODE_FAMILIES.map((fam) => {
    const presentNamed = fam.nodes.filter((n) => namedSet.has(n))
    const presentAnon = fam.nodes.filter((n) => anonSet.has(n))
    // A PREFIX TEST, as a second net, over the MARKERS THAT ARE MARKERS. A marker that is not a
    // marker (`with_` in python) is reported as a decoy instead, because a prefix test that fired
    // on python's context-manager statement would have "found" a construct the language does not
    // have — and a ruling that fires on a decoy is not a ruling.
    const prefixHits = [...namedSet, ...anonSet].filter((n) => {
      for (const m of fam.markers) {
        if (!m.isMarker) continue
        if (n.startsWith(m.marker)) return true
      }
      return false
    })
    const fieldHits = fieldNames.filter((f) => {
      for (const m of fam.markers) {
        if (!m.isMarker) continue
        if (f.startsWith(m.marker)) return true
      }
      return false
    })
    const decoysPresent = fam.decoys
      .filter((d) => namedSet.has(d.node) || anonSet.has(d.node))
      .map((d) => ({ node: d.node, why: d.why, present: true, disambiguated: true }))
    return {
      value: fam.value,
      why: fam.why,
      nodesChecked: fam.nodes,
      markers: fam.markers,
      presentNamed,
      presentAnonymous: presentAnon,
      prefixHits,
      fieldHits,
      decoysPresent,
      absent: presentNamed.length === 0 && presentAnon.length === 0 && prefixHits.length === 0 && fieldHits.length === 0,
    }
  })

  return {
    view: VIEW,
    grammar: {
      nodeTypeCount: total,
      namedIds: named.length,
      uniqueNamed: uniqueNamed.length,
      anonymousIds: anonymous.length,
      uniqueAnonymous: uniqueAnon.length,
      fieldCount: fields.length,
      names: uniqueNamed,
      anonymous: uniqueAnon,
      fields: fieldNames,
    },
    rulings,
  }
}

/* ──────────────────────────────────────────────────────────────────────────────
 * THE CORPUS HALF — the whole admitted population, parsed and read.
 * ────────────────────────────────────────────────────────────────────────────── */

type Population = {
  admitted: string[]
  total: number
  repos: number
  absent: number
  overCap: number
  overCapLargest: number
  symlinkedRepos: number
  nonGitEntries: number
  rule: string
}

function discover(): Population {
  const found: string[] = []
  const repos = new Set<string>()
  let absent = 0
  let overCap = 0
  let overCapLargest = 0
  let symlinkedRepos = 0
  let nonGitEntries = 0
  let entries: string[]
  try {
    entries = readdirSync(CORPUS_ROOT)
  } catch {
    return {
      admitted: [], total: 0, repos: 0, absent: 0, overCap: 0, overCapLargest: 0,
      symlinkedRepos: 0, nonGitEntries: 0,
      rule: "corpus root unreadable",
    }
  }
  for (const name of entries.sort()) {
    const dir = path.join(CORPUS_ROOT, name)
    // `statSync` FOLLOWS a symlink, so a symlinked corpus entry is a directory. A
    // `readdirSync(...,{withFileTypes:true}).isDirectory()` test would be FALSE for it and
    // would drop the whole repository — the trap the campaign has paid for repeatedly.
    let isDir = false
    try {
      isDir = statSync(dir).isDirectory()
    } catch {
      continue
    }
    if (!isDir) continue
    try {
      const st = statSync(dir)
      if (st.isSymbolicLink()) symlinkedRepos++
    } catch {
      /* counted by the stat above */
    }
    try {
      execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    } catch {
      nonGitEntries++
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
      const lower = rel.toLowerCase()
      let admitted = false
      for (const ext of ADMITTED_EXTENSIONS) {
        if (lower.endsWith(ext)) { admitted = true; break }
      }
      if (!admitted) continue
      const abs = path.join(dir, rel)
      try {
        const size = statSync(abs).size
        if (size > SIZE_CAP) {
          overCap++
          overCapLargest = Math.max(overCapLargest, size)
          continue
        }
      } catch {
        absent++
        continue
      }
      found.push(abs)
      repos.add(name)
    }
  }
  found.sort()
  return {
    admitted: found,
    total: found.length,
    repos: repos.size,
    absent,
    overCap,
    overCapLargest,
    symlinkedRepos,
    nonGitEntries,
    rule:
      `BB_CORPUS_ROOT=${CORPUS_ROOT} · one REPO per corpus entry that is a directory AND a real git ` +
      `checkout (git rev-parse --git-dir) · the file set is \`git ls-files\` (TRACKED paths) · ` +
      `admitted extensions ${ADMITTED_EXTENSIONS.join(",")} · size cap ${SIZE_CAP} B (the engine's own ` +
      `full-AST limit) · over-cap and absent counted, never dropped`,
  }
}

/** ONE PASS over the whole admitted population: parse with the production parser, read with the
 *  production analyzer, count every emitted edge by value, and walk the parse tree for the
 *  construct-site census. `label` names the pass in the artifact, so a reader can never mistake
 *  one pass's numbers for another's. */
async function runPass(
  pop: Population,
  parser: any,
  analyzer: any,
  label: string,
  context?: any,
): Promise<any> {
  /** rows / files / repos per relationship type, over the whole admitted population. */
  const rows = new Map<string, number>()
  const files = new Map<string, Set<string>>()
  const repos = new Map<string, Set<string>>()
  /** the ANALYZER's own reader sites, per node type — the corpus half of a grammar ruling is
   *  "how many times does the construct's node family occur in the corpus", so the candidate
   *  families are COUNTED here, not asserted. */
  const familySites = new Map<string, number>()
  const familyFiles = new Map<string, Set<string>>()
  /** the NEAREST python construct per ruled value, counted — the shape the construct WOULD
   *  have if the language could express it. */
  const nearest: Record<string, { sites: number; files: number; note: string }> = {
    renders: {
      sites: 0, files: 0,
      note:
        "python has no element node; a template is a string literal and the nearest construct that " +
        "produces an object from a name is a CALL, published as `calls`",
    },
    mixes_in: {
      sites: 0, files: 0,
      note:
        "python's ONE superclass clause: `class C(A, B)` — every base is published as `extends`, and " +
        "the source cannot say which base is the mixin",
    },
    part_of: {
      sites: 0, files: 0,
      note: "python's unit of inclusion is an IMPORT, published as `imports`",
    },
  }
  const nearestFiles = new Map<string, Set<string>>()
  const nearestSites = new Map<string, number>()
  let parsed = 0
  let failed = 0
  let degraded = 0
  let totalEdges = 0
  /** THE PERF MEASUREMENT — the lane's own, on the whole admitted population: the wall clock and
   *  the rate, split into the two phases that matter (the grammar's parse, and the analyzer's
   *  read of the parse). A perf number without its population and its instrument is not a
   *  measurement, so all three travel together. */
  const perf = { discoverMs: 0, setupMs: 0, parseReadMs: 0, files: 0, bytes: 0 }
  let bytes = 0

  const tPass = Date.now()

  for (const abs of pop.admitted) {
    if (REPO_ONLY && !abs.includes(`/${REPO_ONLY}/`)) continue
    const tFile = Date.now()
    let content: string
    try {
      content = readFileSync(abs, "utf8")
    } catch {
      failed++
      continue
    }
    bytes += content.length
    let tree: any
    try {
      tree = parser.parse(content)
    } catch {
      failed++
      continue
    }
    if (!tree) { failed++; continue }
    parsed++
    const rel = abs
    const repo = repoOf(abs, pop)
    let result: any
    try {
      result = analyzer.analyze(tree.rootNode, content, abs, context)
    } catch (e) {
      degraded++
      if (degraded <= 3) {
        console.log(`  DEGRADED (${label}): ${abs} — ${String((e as any)?.message ?? e).slice(0, 200)}`)
      }
      continue
    }
    const rels = Array.isArray(result?.relationships) ? result.relationships : []
    totalEdges += rels.length
    for (const r of rels) allRels.push(r)
    const syms = Array.isArray(result?.symbols) ? result.symbols : []
    for (const sy of syms) allSymbols.push(sy)
    for (const r of rels) {
      const t = String(r.type ?? r.relationshipType ?? "UNKNOWN")
      rows.set(t, (rows.get(t) ?? 0) + 1)
      if (!files.has(t)) files.set(t, new Set())
      files.get(t)!.add(rel)
      if (!repos.has(t)) repos.set(t, new Set())
      repos.get(t)!.add(repo)
    }
    // THE CONSTRUCT-SITE COUNTS — walked on the PARSE TREE, so the count is the grammar's
    // own node census, not a text search.
    walkSites(tree.rootNode, rel, familySites, familyFiles, nearest, nearestFiles, nearestSites, repo)
    perf.parseReadMs += Date.now() - tFile
    perf.files++
    // THE TREE IS FREED HERE, AND THE MEASUREMENT PROVES WHY IT MUST BE. web-tree-sitter keeps
    // ONE parse buffer per parser and the previous tree must be released before the next parse;
    // a pass that holds 11,559 trees alive exhausts the parser, and the NEXT parse THROWS — which
    // is exactly what the first two-pass run measured: the with-context pass read 718 files and
    // FAILED 10,841, with no error and no counter anywhere but `failed`. ⇒ the release is not
    // hygiene, it is what makes the second pass measurable at all.
    try { (tree as any)?.delete?.() } catch { /* a tree that cannot be freed is not an error here */ }
  }

  perf.setupMs = Date.now() - tPass
  perf.bytes = bytes

  const types: Record<string, { rows: number; files: number; repos: number }> = {}
  for (const t of [...rows.keys()].sort()) {
    types[t] = { rows: rows.get(t) ?? 0, files: files.get(t)?.size ?? 0, repos: repos.get(t)?.size ?? 0 }
  }
  const families: Record<string, { sites: number; files: number }> = {}
  for (const fam of CANDIDATE_NODE_FAMILIES) {
    let sites = 0
    const fset = new Set<string>()
    for (const n of fam.nodes) {
      sites += familySites.get(n) ?? 0
      for (const f of familyFiles.get(n) ?? []) fset.add(f)
    }
    families[fam.value] = { sites, files: fset.size }
  }
  for (const v of ["renders", "mixes_in", "part_of"]) {
    nearest[v].sites = nearestSites.get(v) ?? 0
    nearest[v].files = nearestFiles.get(v)?.size ?? 0
  }

  /* THE NEAR-MISS CENSUS, MEASURED — the sites, the merging pairs, and the answer to "is this
   * relation ALREADY PUBLISHED UNDER ANOTHER LABEL", with that label's MEASURED edge count. */
  const extendsPairs = new Set<string>()
  for (const r of allRels) {
    if (String(r.type ?? "") !== "extends") continue
    extendsPairs.add(`${String(r.from ?? "")}\u0000${String(r.target ?? "")}`)
  }
  let mixinAlready = 0
  for (const [cls, base] of mixinPairs) if (extendsPairs.has(`${cls}\u0000${base}`)) mixinAlready++
  const nearMiss: Record<string, NearMiss> = {}
  for (const v of ["renders", "mixes_in", "part_of"]) {
    const rec = { ...NEAR_MISS[v] }
    rec.sites = nearMissSites.get(v) ?? 0
    rec.files = nearMissFiles.get(v)?.size ?? 0
    rec.mergingPairs = mergePairs.get(v) ?? 0
    rec.mergingPairsExample = mergeExample.get(v) ?? ""
    if (v === "mixes_in") {
      rec.alreadyPublishedEdges = types.extends?.rows ?? 0
      rec.sitesAlreadyPublished = mixinAlready
    } else if (v === "part_of") {
      rec.alreadyPublishedEdges = types.imports?.rows ?? 0
      rec.sitesAlreadyPublished = rec.sites
    } else {
      rec.alreadyPublishedUnder = "calls (the RENDER CALL is a call); the component-to-component relation has NO carrier, and a template's placeholders are published under NO label"
      rec.alreadyPublishedEdges = types.calls?.rows ?? 0
      rec.sitesAlreadyPublished = 0
    }
    nearMiss[v] = rec
  }

  return {
    label,
    view: VIEW,
    population: {
      rule: pop.rule,
      corpusRoot: CORPUS_ROOT,
      total: pop.total,
      repos: pop.repos,
      absent: pop.absent,
      overCap: pop.overCap,
      overCapLargest: pop.overCapLargest,
      symlinkedReposFollowed: pop.symlinkedRepos,
      nonGitEntriesSkipped: pop.nonGitEntries,
      parsed,
      failed,
      degraded,
      totalEdges,
    },
    perf: {
      discoverMs: perf.discoverMs,
      setupMs: perf.setupMs,
      parseReadMs: perf.parseReadMs,
      files: perf.files,
      bytes: perf.bytes,
      filesPerSecond: perf.parseReadMs > 0 ? (perf.files / (perf.parseReadMs / 1000)) : null,
      megaBytesPerSecond:
        perf.parseReadMs > 0 ? (perf.bytes / (1024 * 1024)) / (perf.parseReadMs / 1000) : null,
    },
    types,
    candidateFamilySites: families,
    nearestConstructSites: nearest,
    nearMissCensus: nearMiss,
  }
}

/* ── THE DEGRADATION CHECK ──────────────────────────────────────────────────────────────
 *
 * THE DEFECT (measured on the sql lane, 2026-10-21): a census that calls `analyze()` DIRECTLY,
 * without handing the grammar over, can measure a SILENTLY DEGRADED analyzer — sql's was 260
 * edges light over the whole population, with NO error and NO visible counter, because sql's
 * `analyze()` calls `acquireParser()` INTERNALLY, that call FAILS outside the pool worker, and
 * the declaration-resync and EXECUTE-literal passes take their `resyncSkipped` / `executeSkipped`
 * branch while the file is reported as analysed anyway.
 *
 * ⇒ THE QUESTION THIS INSTRUMENT ANSWERS, AND PRINTS: how many parser-acquisition sites does
 * THIS analyzer have INSIDE `analyze()`? Zero means the direct call cannot be degraded that way,
 * and the count is a NUMBER WITH A ROOT rather than an assumption.
 *
 * ⇒ AND THE DELTA IS MEASURED, NOT ASSUMED EITHER: the pass is run TWICE — once with the grammar
 * handed over and once without — and the PER-TYPE DELTA is printed. When the hand-over is NOT
 * available (an analyzer that takes an ALREADY-PARSED tree has no grammar to hand over), the
 * instrument PRINTS THAT, WITH THE REASON, rather than reporting a zero delta it did not measure.
 */

/** the analyzer's own source, read once — the trigger-site count is a SOURCE FACT and is counted
 *  by a character scan, not by a regex-based guess. */
const ANALYZER_SOURCE = path.resolve(process.cwd(), "src/ast/real-python-analyzer.ts")

/** Count the parser-acquisition tokens in the analyzer's source, and SPLIT the count by whether
 *  the call sits inside the `analyze(` method's body. The split is the whole question: a call
 *  outside `analyze()` cannot degrade a direct `analyze()` call. */
function countParserAcquisitionSites(sourcePath: string): {
  total: number
  insideAnalyze: number
  outsideAnalyze: number
  tokens: string[]
} {
  const src = readFileSync(sourcePath, "utf8")
  const TOKENS = ["acquireParser(", "getParser("]
  const counts = new Map<string, number>()
  let total = 0
  let inside = 0
  // The `analyze(` method's body: from the first `analyze(` that is followed by a parameter list
  // and a `{`, to the matching close brace, counted by a character scan with a depth counter.
  const methodStart = findMethodBody(src, "analyze(")
  for (const tok of TOKENS) {
    let idx = src.indexOf(tok)
    while (idx >= 0) {
      total++
      counts.set(tok, (counts.get(tok) ?? 0) + 1)
      if (methodStart && idx >= methodStart.start && idx <= methodStart.end) inside++
      idx = src.indexOf(tok, idx + 1)
    }
  }
  return {
    total,
    insideAnalyze: inside,
    outsideAnalyze: total - inside,
    tokens: [...counts.entries()].map(([k, v]) => `${k}×${v}`),
  }
}

/** the byte range of a method's BODY, by brace counting (a character scan, not a regex). */
function findMethodBody(src: string, signature: string): { start: number; end: number } | null {
  const sig = src.indexOf(signature)
  if (sig < 0) return null
  const open = src.indexOf("{", sig)
  if (open < 0) return null
  let depth = 0
  for (let i = open; i < src.length; i++) {
    const ch = src.charAt(i)
    if (ch === "{") depth++
    else if (ch === "}") {
      depth--
      if (depth === 0) return { start: open, end: i }
    }
  }
  return null
}

/** Hand the grammar over, the way the pool worker does, and REPORT what happened. The class-level
 *  `setGrammar` is `Function.setGrammar` on a class that does not define it, so it THROWS — and a
 *  throw is the FACT that answers the question, not a failure of the instrument. */
function attemptGrammarHandOver(parser: any, analyzer: any): { ok: boolean; status: string; message: string } {
  try {
    const ctor: any = (analyzer as any).constructor
    if (typeof ctor?.setGrammar !== "function") {
      return {
        ok: false,
        status: "NOT AVAILABLE (this analyzer's class defines no `setGrammar`)",
        message:
          "⇒ this analyzer RECEIVES AN ALREADY-PARSED TREE (`analyze(rootNode, content, filePath)`) " +
          "and never acquires a parser, so there is no grammar to hand over and no pass that could " +
          "differ from the one measured. The direct call IS the production call for this analyzer.",
      }
    }
    ctor.setGrammar(parser.language, ctor)
    return { ok: true, status: "OK — the grammar was handed to the analyzer class", message: "" }
  } catch (e: any) {
    return {
      ok: false,
      status: `THREW — ${String(e?.message ?? e)}`,
      message:
        "⇒ `Class.constructor.setGrammar` is `Function.setGrammar` and it throws for a class that " +
        "does not define it, so there is no second pass to compare: this analyzer RECEIVES AN " +
        "ALREADY-PARSED TREE and never acquires a parser. The direct call IS the production call.",
    }
  }
}


/** THE CORPUS HALF — the driver. It discovers the population with the GATE'S OWN admission rules,
 *  runs the pass, runs the DEGRADATION CHECK, and prints the per-type delta against the ARM's own
 *  TABLE 1 (the production path) when the arm's log is present. */
async function corpusHalf(): Promise<any> {
  const tDiscover = Date.now()
  const pop = discover()
  const tPop = Date.now()
  const parser = await getParser("python" as any)
  const analyzer = new RealPythonAnalyzer()
  const tSetup = Date.now()

  /* ── THE DEGRADATION CHECK, MEASURED AND NOT ASSUMED ──────────────────────────────────────
   *
   * THE DEFECT (measured on the sql lane, 2026-10-21): a census that calls `analyze()` DIRECTLY,
   * without handing the grammar over, can measure a SILENTLY DEGRADED analyzer — sql's was 260
   * edges light over the whole population, with NO error and NO visible counter, because sql's
   * `analyze()` calls `acquireParser()` INTERNALLY, that call FAILS outside the pool worker, and
   * the declaration-resync and EXECUTE-literal passes take their `resyncSkipped` / `executeSkipped`
   * branch while the file is reported as analysed anyway.
   *
   * ⇒ THE QUESTION THIS INSTRUMENT ANSWERS, AND PRINTS: how many parser-acquisition sites does
   * THIS analyzer have INSIDE `analyze()`? Zero means the direct call cannot be degraded that
   * way, and the count is a NUMBER WITH A ROOT rather than an assumption.
   *
   * ⇒ AND THE DELTA IS MEASURED, NOT ASSUMED EITHER: the pass is run TWICE — once with the
   * grammar handed over and once without — and the PER-TYPE DELTA is printed. When the hand-over
   * is not available (an analyzer that takes an ALREADY-PARSED tree has no grammar to hand over),
   * the instrument PRINTS THAT, WITH THE REASON, rather than reporting a zero delta it did not
   * measure. */
  const triggerSites = countParserAcquisitionSites(ANALYZER_SOURCE)
  const handOver = attemptGrammarHandOver(parser, analyzer)
  console.log(
    "\nTHE DEGRADATION CHECK — an analyzer that calls `acquireParser()`/`getParser()` INSIDE " +
      "`analyze()` can be measured SILENTLY DEGRADED by a direct call (the sql lane's was 260 " +
      "edges light, with no error and no counter).",
  )
  console.log(`  parser-acquisition sites in ${path.basename(ANALYZER_SOURCE)}: ${triggerSites.total}`)
  console.log(`    inside \`analyze()\`: ${triggerSites.insideAnalyze}   elsewhere: ${triggerSites.outsideAnalyze}`)
  console.log(`    tokens: ${triggerSites.tokens.join(", ") || "none"}`)
  console.log(`  grammar hand-over: ${handOver.status}`)
  if (handOver.message) console.log(`    ${handOver.message}`)

  /* THE TWO PASSES. The FIRST is the direct call with NO context — what a census measures when it
   * calls `analyze()` and stops there. The SECOND is the direct call with the PRODUCTION CONTEXT
   * (`overrideCompanion`, which the engine's fourth argument carries and which the analyzer reads
   * at `src/ast/real-python-analyzer.ts:1106`), built from the first pass's own symbols the way
   * `src/ast/override-context.ts`'s `buildOverrideCompanion` builds it.
   * ⇒ THE PER-TYPE DELTA BETWEEN THEM IS THE MEASUREMENT THE LEAD ASKED FOR: "the test is the
   * hand-over plus the printed per-type delta, always, because a delta of zero is a fact only
   * because it was printed." For python the hand-over is not available (the analyzer takes an
   * already-parsed tree), so the DELTA is the measurement — and it is NOT zero, and its root is
   * named below. */
  const passNoContext = await runPass(pop, parser, analyzer, "direct call, NO context (overrideCompanion absent)")
  const companion = buildOverrideCompanion(allSymbols)
  console.log(
    `\nTHE PRODUCTION CONTEXT — the overrideCompanion map, built from the first pass's own ` +
      `${allSymbols.length} symbol(s) by src/ast/override-context.ts's own buildOverrideCompanion:` +
      ` ${companion.size} owner type(s)`,
  )
  const passWithContext = await runPass(pop, parser, analyzer, "direct call WITH the production context", {
    overrideCompanion: companion,
  })
  /** THE PER-TYPE DELTA, measured on the same population, the same parser, the same analyzer. */
  const contextDelta: Record<string, { without: number; with: number; delta: number }> = {}
  for (const t of new Set<string>([
    ...Object.keys(passNoContext.types),
    ...Object.keys(passWithContext.types),
  ])) {
    const w = passNoContext.types[t]?.rows ?? 0
    const wi = passWithContext.types[t]?.rows ?? 0
    contextDelta[t] = { without: w, with: wi, delta: wi - w }
  }

  /** THE PER-TYPE DELTA, two ways, both with a root:
   *   (a) hand-over MINUS no-hand-over — the degradation question, measured on the same rows;
   *   (b) this census MINUS the ARM's TABLE 1 — the direct-call question, against the PRODUCTION
   *       path (the gate gets its rows through `pool-worker.parseFile`). A non-zero delta here is
   *       not a defect: the arm applies the project index and the arbiter, the census does not. */
  const arm = readArmTable(ARM_LOG)
  const deltaByType: Record<string, { census: number; arm: number; delta: number }> = {}
  const allTypes = new Set<string>([...Object.keys(passWithContext.types), ...Object.keys(arm)])
  for (const t of [...allTypes].sort()) {
    const c = passWithContext.types[t]?.rows ?? 0
    const a = arm[t]?.edges ?? 0
    deltaByType[t] = { census: c, arm: a, delta: c - a }
  }

  return {
    view: VIEW,
    degradationCheck: {
      triggerSites,
      handOver: { ok: handOver.ok, status: handOver.status, message: handOver.message },
      handOverDeltaByType: null,
      handOverNote:
        "the hand-over is NOT AVAILABLE for this analyzer (its class defines no `setGrammar`, and it " +
        "RECEIVES AN ALREADY-PARSED TREE), so there is no hand-over pass to difference. THE " +
        "MEASUREMENT THAT ANSWERS THE SAME QUESTION IS THE CONTEXT DELTA BELOW: the per-type " +
        "difference between the direct call WITHOUT the production context and the direct call WITH " +
        "it, over the same population, the same parser and the same analyzer.",
      contextDeltaByType: contextDelta,
      pass1: {
        parsed: passNoContext.population.parsed,
        failed: passNoContext.population.failed,
        degraded: passNoContext.population.degraded,
        totalEdges: passNoContext.population.totalEdges,
      },
      pass2: {
        parsed: passWithContext.population.parsed,
        failed: passWithContext.population.failed,
        degraded: passWithContext.population.degraded,
        totalEdges: passWithContext.population.totalEdges,
      },
      companionOwners: companion.size,
      companionSymbols: allSymbols.length,
    },
    armComparison: {
      armLog: ARM_LOG,
      armLogPresent: Object.keys(arm).length > 0,
      byType: deltaByType,
    },
    ...passWithContext,
    population: {
      ...passWithContext.population,
      discoverMs: tPop - tDiscover,
      setupMs: tSetup - tPop,
    },
  }
}

/** THE ARM'S OWN TABLE 1, read from the arm's log — the production path's per-type edges, so the
 *  census's own per-type counts have something to be compared WITH. The parse is a whitespace
 *  split on the table's own fixed columns; a line that does not have all fourteen columns is not
 *  a table row and is skipped, so a stray line cannot become a number. */
function readArmTable(logPath: string): Record<string, { edges: number; resolved: number }> {
  const out: Record<string, { edges: number; resolved: number }> = {}
  let raw: string
  try {
    raw = readFileSync(logPath, "utf8")
  } catch {
    return out
  }
  for (const line of raw.split("\n")) {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 15) continue
    if (!/^[a-z_]+$/.test(parts[0] ?? "")) continue
    const edges = Number(parts[1])
    const resolved = Number(parts[2])
    if (!Number.isFinite(edges) || !Number.isFinite(resolved)) continue
    out[parts[0]] = { edges, resolved }
  }
  return out
}

/** THE NEAR-MISS CENSUS — HOW A RULING IS EARNED (L-2026-10-21-17). Every ruled value carries:
 *   (1) the NEAR-MISS CONSTRUCT, NAMED — the node type whose sites are the construct's nearest
 *       spelling in python, COUNTED over the whole admitted population;
 *   (2) the MERGING PAIRS — the (subject, member) pairs the construct merges, COUNTED;
 *   (3) whether the relation is ALREADY PUBLISHED UNDER ANOTHER LABEL — answered with the
 *       label and its MEASURED edge count over the same population, and with the count of
 *       near-miss sites already covered by it.
 * => A ruling without this census is prose. */
interface NearMiss {
  /** the node type whose sites are the construct's nearest spelling */
  nodeType: string
  /** the construct, named in words */
  construct: string
  /** the discriminator python's grammar has no node type for */
  missingDiscriminator: string
  sites: number
  files: number
  /** the (subject, member) pairs the construct merges */
  mergingPairs: number
  mergingPairsExample: string
  /** the label under which the relation is ALREADY published, and its MEASURED edge count */
  alreadyPublishedUnder: string | null
  alreadyPublishedEdges: number
  /** the near-miss sites that are ALREADY covered by that label */
  sitesAlreadyPublished: number
}

const NEAR_MISS: Record<string, NearMiss> = {
  mixes_in: {
    nodeType: "class_definition (superclasses > 1)",
    construct:
      "python's MULTIPLE-INHERITANCE class statement `class C(A, B)` — one class, several bases " +
      "merged into one supertype chain. The near-miss is not the spelling; it is the MERGE.",
    missingDiscriminator:
      "python has NO syntax that separates 'the base' from 'the composed member': every base in " +
      "`class C(A, B)` is a NOMINAL SUPERTYPE (python's MRO makes `issubclass(C, B)` true), so a " +
      "`mixes_in` edge would have to name a member that IS a supertype — which is the `extends` " +
      "edge the analyzer already publishes.",
    sites: 0,
    files: 0,
    mergingPairs: 0,
    mergingPairsExample: "",
    alreadyPublishedUnder: "extends",
    alreadyPublishedEdges: 0,
    sitesAlreadyPublished: 0,
  },
  part_of: {
    nodeType: "import_statement",
    construct:
      "python's UNIT OF INCLUSION is the IMPORT — `import a.b` pulls another module's source into " +
      "the program. The near-miss is the construct that INCLUDES another unit.",
    missingDiscriminator:
      "a Dart `part` SHARES the library's single scope; a python import CREATES binding scope and " +
      "names a module — the two are different relations, and python's grammar has no node type " +
      "that can express the shared-scope one.",
    sites: 0,
    files: 0,
    mergingPairs: 0,
    mergingPairsExample: "",
    alreadyPublishedUnder: "imports",
    alreadyPublishedEdges: 0,
    sitesAlreadyPublished: 0,
  },
  renders: {
    nodeType: "string (a template — it carries {{ ... }})",
    construct:
      "python's nearest 'a thing that renders another thing' is the TEMPLATE — a string that " +
      "carries placeholders, and the call that renders it. python has no COMPONENT and no " +
      "ELEMENT LITERAL.",
    missingDiscriminator:
      "the relation is between a COMPONENT and the component it renders; python has no component " +
      "type and no element literal, so there is no node type that could carry the relation — only " +
      "a template string and a call.",
    sites: 0,
    files: 0,
    mergingPairs: 0,
    mergingPairsExample: "",
    alreadyPublishedUnder: null,
    alreadyPublishedEdges: 0,
    sitesAlreadyPublished: 0,
  },
}

/** every emitted relationship, kept for the near-miss census's "already published under another
 *  label" measurement — the count is MEASURED, not asserted */
const allRels: any[] = []

/** every emitted symbol, kept to build the production `overrideCompanion` map — the context the
 *  production path hands the analyzer and a direct call does not */
const allSymbols: any[] = []

/** the (class, merged base) pairs — the merges python's multiple inheritance performs */
const mixinPairs: Array<[string, string]> = []

/** the merge counters, per ruled value — filled by the walk */
const mergePairs = new Map<string, number>()
const mergeExample = new Map<string, string>()
const nearMissFiles = new Map<string, Set<string>>()
const nearMissSites = new Map<string, number>()

/** the repo name of a file, read from the admitted list's own repo boundaries */
function repoOf(abs: string, pop: Population): string {
  const rel = path.relative(CORPUS_ROOT, abs)
  const slash = rel.indexOf("/")
  return slash < 0 ? rel : rel.slice(0, slash)
}

/** count one near-miss site, and the file it lives in */
function countNearMiss(value: string, file: string): void {
  nearMissSites.set(value, (nearMissSites.get(value) ?? 0) + 1)
  if (!nearMissFiles.has(value)) nearMissFiles.set(value, new Set())
  nearMissFiles.get(value)!.add(file)
}

function walkSites(
  n: any,
  file: string,
  familySites: Map<string, number>,
  familyFiles: Map<string, Set<string>>,
  nearest: Record<string, { sites: number; files: number; note: string }>,
  nearestFiles: Map<string, Set<string>>,
  nearestSites: Map<string, number>,
  repo: string,
): void {
  const t = n.type
  familySites.set(t, (familySites.get(t) ?? 0) + 1)
  if (!familyFiles.has(t)) familyFiles.set(t, new Set())
  familyFiles.get(t)!.add(file)
  // THE NEAREST CONSTRUCT — measured, not asserted.
  if (t === "class_definition") {
    const sup = n.childForFieldName("superclasses")
    if (sup) {
      let bases = 0
      for (let i = 0; i < sup.namedChildCount; i++) if (sup.namedChild(i)) bases++
      if (bases >= 2) {
        nearestSites.set("mixes_in", (nearestSites.get("mixes_in") ?? 0) + 1)
        if (!nearestFiles.has("mixes_in")) nearestFiles.set("mixes_in", new Set())
        nearestFiles.get("mixes_in")!.add(file)
        /* THE NEAR-MISS CENSUS — the MERGING PAIRS. A class with N bases merges N-1 members into
         * its supertype chain; the pair is (the class, the member merged in). Counted, not
         * asserted — and the example is kept so a reader can SEE one. */
        const clsName = (() => {
          const nm = n.childForFieldName("name")
          return nm ? String(nm.text ?? "") : "<anonymous>"
        })()
        const baseNames: string[] = []
        for (let i = 0; i < sup.namedChildCount; i++) {
          const c = sup.namedChild(i)
          if (c) baseNames.push(String(c.text ?? ""))
        }
        for (let i = 1; i < baseNames.length; i++) {
          mergePairs.set("mixes_in", (mergePairs.get("mixes_in") ?? 0) + 1)
          const leaf = baseNames[i].split(".").pop() ?? baseNames[i]
          mixinPairs.push([clsName, leaf])
          if (!mergeExample.has("mixes_in")) mergeExample.set("mixes_in", `class ${clsName}(${baseNames.join(", ")}) → the pair (${clsName}, ${baseNames[i]})`)
        }
        countNearMiss("mixes_in", file)
      }
    }
  }
  /* THE NEAR-MISS CENSUS — `part_of`: python's unit of inclusion is the IMPORT, and the merge is
   * the (importing module, imported module) pair — the scope the import brings in. */
  if (t === "import_statement") {
    mergePairs.set("part_of", (mergePairs.get("part_of") ?? 0) + 1)
    if (!mergeExample.has("part_of")) mergeExample.set("part_of", `import ${String(n.text ?? "").slice(0, 60).replace(/\n/g, " ")}`)
    countNearMiss("part_of", file)
  }
  /* THE NEAR-MISS CENSUS — `renders`: python's nearest is the TEMPLATE — a string carrying
   * `{{ ... }}` — and the merge is the (template, placeholder) pair. Counted over the population. */
  if (t === "string" || t === "concatenated_string" || t === "f_string" || t === "string_content") {
    const text = String(n.text ?? "")
    if (text.indexOf("{{") >= 0 && text.indexOf("}}") >= 0) {
      let placeholders = 0
      for (let i = text.indexOf("{{"); i >= 0; i = text.indexOf("{{", i + 2)) {
        placeholders++
        if (text.indexOf("}}", i) < 0) break
      }
      mergePairs.set("renders", (mergePairs.get("renders") ?? 0) + placeholders)
      if (!mergeExample.has("renders")) mergeExample.set("renders", `a template string carrying ${placeholders} placeholder(s)`)
      countNearMiss("renders", file)
    }
  }
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c) walkSites(c, file, familySites, familyFiles, nearest, nearestFiles, nearestSites, repo)
  }
}

/* ────────────────────────────────────────────────────────────────────────────── */

async function main(): Promise<void> {
  if (!WANT_GRAMMAR && !WANT_CORPUS) {
    console.error("usage: python-type-census.ts --grammar | --corpus [--out <path.json>]")
    process.exit(2)
  }
  const out: any = { instrument: "script/m14/python-type-census.ts" }
  if (WANT_GRAMMAR) {
    const g = await grammarHalf()
    out.grammar = g.grammar
    out.rulings = g.rulings
    console.log("THE PINNED GRAMMAR'S NODE-TYPE INVENTORY")
    console.log(`  wasm            ${g.view.grammarWasm}`)
    console.log(`  sha256          ${g.view.grammarSha256}`)
    console.log(`  nodeTypeCount   ${g.grammar.nodeTypeCount}`)
    console.log(`  named ids       ${g.grammar.namedIds} (${g.grammar.uniqueNamed} unique)`)
    console.log(`  anonymous ids   ${g.grammar.anonymousIds} (${g.grammar.uniqueAnonymous} unique)`)
    console.log(`  fields          ${g.grammar.fieldCount}`)
    console.log(`  HEAD            ${g.view.head}`)
    console.log(`  analyzer blob   ${g.view.analyzer}`)
    console.log("\nTHE RULED-OUT FAMILIES — a node type that is not in the inventory cannot be produced")
    for (const r of g.rulings) {
      console.log(`\n  ${r.value}: ${r.absent ? "ABSENT (grammar-absence holds)" : "PRESENT — THE RULING IS STALE"}`)
      console.log(`    nodes checked   ${r.nodesChecked.length}`)
      console.log(`    present named   ${r.presentNamed.length === 0 ? "none" : r.presentNamed.join(", ")}`)
      console.log(`    present anon    ${r.presentAnonymous.length === 0 ? "none" : r.presentAnonymous.join(", ")}`)
      console.log(`    prefix hits     ${r.prefixHits.length === 0 ? "none" : r.prefixHits.join(", ")}`)
      console.log(`    field hits      ${r.fieldHits.length === 0 ? "none" : r.fieldHits.join(", ")}`)
      if (r.decoysPresent.length > 0) {
        console.log(`    NEAR-MISS DECOYS PRESENT (named, disambiguated — a ruling that fires on a decoy is not a ruling):`)
        for (const d of r.decoysPresent) console.log(`      ${d.node}: ${d.why}`)
      }
    }
  }
  if (WANT_CORPUS) {
    const c = await corpusHalf()
    out.corpus = c
    console.log("\nTHE WHOLE ADMITTED POPULATION")
    console.log(`  corpus root     ${c.population.corpusRoot}`)
    console.log(`  admitted files  ${c.population.total}`)
    console.log(`  repos           ${c.population.repos}`)
    console.log(`  parsed          ${c.population.parsed} · failed ${c.population.failed} · degraded ${c.population.degraded}`)
    console.log(`  over cap        ${c.population.overCap} (largest ${c.population.overCapLargest} B) · absent ${c.population.absent}`)
    console.log(`  symlinked repos followed  ${c.population.symlinkedReposFollowed}`)
    console.log(`  total edges     ${c.population.totalEdges}`)
    console.log("\nPERF (the whole admitted population, one process, this instrument)")
    console.log(`  discover        ${c.perf.discoverMs} ms`)
    console.log(`  setup           ${c.perf.setupMs} ms`)
    console.log(`  parse + read    ${c.perf.parseReadMs} ms for ${c.perf.files} file(s), ${(c.perf.bytes / 1024 / 1024).toFixed(1)} MiB`)
    console.log(`  rate            ${c.perf.filesPerSecond?.toFixed(1)} file(s)/s · ${c.perf.megaBytesPerSecond?.toFixed(2)} MiB/s`)
    console.log("\nPER RELATIONSHIP TYPE (rows / files / repos)")
    for (const [t, v] of Object.entries(c.types as Record<string, { rows: number; files: number; repos: number }>)) {
      console.log(`  ${t.padEnd(12)} ${String(v.rows).padStart(9)} / ${String(v.files).padStart(6)} / ${String(v.repos).padStart(3)}`)
    }
    console.log("\nTHE RULED-OUT FAMILIES' SITE COUNTS (the corpus half of a grammar ruling)")
    for (const [v, s] of Object.entries(c.candidateFamilySites as Record<string, { sites: number; files: number }>)) {
      console.log(`  ${v.padEnd(12)} sites ${s.sites} · files ${s.files}`)
    }
    console.log("\nTHE NEAREST PYTHON CONSTRUCT, MEASURED")
    for (const [v, s] of Object.entries(c.nearestConstructSites as Record<string, { sites: number; files: number; note: string }>)) {
      console.log(`  ${v.padEnd(12)} sites ${s.sites} · files ${s.files} — ${s.note}`)
    }
    console.log(`\nTHE TWO PASSES, EACH WITH ITS OWN DEGRADATION COUNT (a pass that DEGRADES is a`)
    console.log(`pass that measured something else, and the count is printed, never assumed:`)
    console.log(`  pass 1 (NO context)  : parsed ${(c.degradationCheck.pass1 as any)?.parsed} · failed ${(c.degradationCheck.pass1 as any)?.failed} · DEGRADED ${(c.degradationCheck.pass1 as any)?.degraded} · edges ${(c.degradationCheck.pass1 as any)?.totalEdges}`)
    console.log(`  pass 2 (WITH context): parsed ${(c.degradationCheck.pass2 as any)?.parsed} · failed ${(c.degradationCheck.pass2 as any)?.failed} · DEGRADED ${(c.degradationCheck.pass2 as any)?.degraded} · edges ${(c.degradationCheck.pass2 as any)?.totalEdges}`)
    console.log("\nTHE PER-TYPE DELTA — the direct call WITH the production context MINUS the")
    console.log("direct call WITHOUT it (the same population, the same parser, the same analyzer)")
    console.log("  type          without        with     delta")
    for (const [t, d] of Object.entries(c.degradationCheck.contextDeltaByType as Record<string, { without: number; with: number; delta: number }>)) {
      console.log(`  ${t.padEnd(12)} ${String(d.without).padStart(9)} ${String(d.with).padStart(9)} ${String(d.delta).padStart(9)}`)
    }
    const cd = c.degradationCheck.contextDeltaByType as Record<string, { without: number; with: number; delta: number }>
    const cdTotal = Object.values(cd).reduce((a, d) => a + d.delta, 0)
    console.log(`  ⇒ the context's price, measured: ${cdTotal} edge(s). A delta of zero is a fact only because it was PRINTED.`)
    console.log(`    the root: the analyzer reads \`context.overrideCompanion\` (src/ast/real-python-analyzer.ts:1106),`)
    console.log(`    and the production path (pool-worker.parseFile) hands it the engine's fourth argument.`)
    console.log("\nTHE NEAR-MISS CENSUS — HOW A RULING IS EARNED (the construct NAMED and COUNTED, the")
    console.log("merging pairs, and whether the relation is ALREADY PUBLISHED UNDER ANOTHER LABEL)")
    for (const [v, nm] of Object.entries(c.nearMissCensus as Record<string, NearMiss>)) {
      console.log(`  ${v}:`)
      console.log(`    near-miss node type   ${nm.nodeType}`)
      console.log(`    construct            ${nm.construct}`)
      console.log(`    sites                ${nm.sites} in ${nm.files} file(s) — MEASURED over the whole admitted population`)
      console.log(`    merging pairs        ${nm.mergingPairs}${nm.mergingPairsExample ? ` — e.g. ${nm.mergingPairsExample}` : ""}`)
      console.log(`    already published as ${nm.alreadyPublishedUnder ?? "(no label)"} — ${nm.alreadyPublishedEdges} edge(s) measured; near-miss sites already covered: ${nm.sitesAlreadyPublished}`)
      console.log(`    the missing thing    ${nm.missingDiscriminator}`)
    }
    console.log("\nTHE PER-TYPE DELTA — this census MINUS the ARM's own TABLE 1 (the PRODUCTION path)")
    if (!c.armComparison.armLogPresent) {
      console.log(`  the arm's log is not present: ${c.armComparison.armLog}`)
    } else {
      console.log(`  arm log: ${c.armComparison.armLog}`)
      console.log("  type          census       arm      delta")
      for (const [t, d] of Object.entries(c.armComparison.byType as Record<string, { census: number; arm: number; delta: number }>)) {
        console.log(`  ${t.padEnd(12)} ${String(d.census).padStart(9)} ${String(d.arm).padStart(9)} ${String(d.delta).padStart(9)}`)
      }
      console.log("  ⇒ a non-zero delta here is NOT a defect: the arm applies the project index and the")
      console.log("    arbiter, and the census is the analyzer's own per-file read. The DELTA IS the")
      console.log("    measure of that difference, on the same population.")
    }
  }
  if (OUT) {
    writeFileSync(OUT, JSON.stringify(out, null, 1))
    console.log(`\nwrote ${OUT}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
