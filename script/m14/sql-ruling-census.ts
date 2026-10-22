#!/usr/bin/env bun
/**
 * THE NEAR-MISS CENSUS FOR sql's RULED TYPES. Each ruling names a construct that COMES CLOSEST to
 * the type in SQL, and this instrument COUNTS that construct over the whole admitted population, so
 * the near miss is a MEASUREMENT and not an adjective. The artifact is
 * `validation/m14/measurements/sql-ruling-census.json` and the six rulings cite it.
 *
 * THE COUNTS ARE NODE COUNTS over the served build's own parse, because the question each ruling
 * turns on is "does the construct exist in this language's grammar, and how often is it used".
 *
 * THE SYMLINK RULE: the walk uses `statSync` (which FOLLOWS a symlink) and PRINTS how many
 * symlinked directories it followed. A walk that uses `Dirent.isDirectory()` drops them.
 *
 * RUN: bun script/m14/sql-ruling-census.ts
 */

import fs from "node:fs"
import path from "node:path"
import { Parser, Language } from "web-tree-sitter"
import { resolveWasmAsset } from "../../src/util/wasm"

const ROOT = path.resolve(process.cwd())
const CORPUS = process.env.BB_CORPUS_ROOT || path.join(ROOT, ".corpus")
const SIZE_CAP = 1_048_576

/** Each ruled type, the construct that comes closest to it in SQL, the node types that carry it, and
 *  what the CONTRACT says the relation actually is — so the census answers "how close", and the
 *  contract answers "close enough, or not". */
const CANDIDATES: { type: string; nearMiss: string; nodeTypes: string[]; whyNot: string }[] = [
  {
    type: "part_of",
    nearMiss: "a TABLE PARTITION — `CREATE TABLE ... PARTITION OF <parent>` — a table that is a FRAGMENT of another table",
    nodeTypes: ["table_partition", "partition_by"],
    whyNot: "the contract (`src/ast/types.ts:164-190`) is about a library unit INCLUDING a part FILE: a part shares the library's single scope, imports nothing, and cannot be resolved as a separate module. A partition is a TABLE, it resolves as its own relation, and it is a row-level storage division — a table-level `part_of` candidate, not the file-level one the contract names.",
  },
  {
    type: "renders",
    nearMiss: "a VIEW — `CREATE VIEW v AS SELECT ...` — a named relation that RENDERS a query's result",
    nodeTypes: ["create_view", "create_materialized_view"],
    whyNot: "the contract (`src/ast/types.ts:146-154`) makes the TARGET a rendered COMPONENT that a renderer constructs. A view's target is a QUERY, and the view IS a relation rather than a renderer of a component; there is no component-shaped target in the construct at all.",
  },
  {
    type: "decorates",
    nearMiss: "a COMMENT ON <object> — text that DECORATES the object it is attached to",
    nodeTypes: ["comment_statement"],
    whyNot: "the contract (`src/ast/types.ts:137-144`) makes the SOURCE the decorated DECLARATION and the TARGET the decorator, applied by the runtime at creation. A COMMENT is text attached after the fact: it names no decorator, and the direction of the useful edge (object -> comment) is the opposite of the contract's.",
  },
  {
    type: "mixes_in",
    nearMiss: "a routine BODY — `CREATE FUNCTION ... $$ ... $$` — code MIXED INTO the routine's own scope",
    nodeTypes: ["create_function", "procedure_body", "function_body"],
    whyNot: "the contract (`src/ast/types.ts:155-162`) makes the SOURCE a class COMPOSING a mixin into its SUPERTYPE CHAIN. A routine body is not a mixin and there is no supertype chain in it; the only SQL construct that composes members into a type's chain is the inheritance clause, which is 0 sites and belongs to `extends`.",
  },
  {
    type: "exports",
    nearMiss: "a routine that RETURNS a result set — `RETURNS TABLE` / `RETURNS SETOF` — a unit PUBLISHING a named result",
    nodeTypes: ["create_function", "create_procedure", "function_declaration"],
    whyNot: "the contract's export is a MODULE's named export. A SQL routine publishes a result over a CALL, it does not export a name from a module scope, and the grammar carries no export node type at all (`keyword_export` is absent from the served build's 594).",
  },
  {
    type: "implements",
    nearMiss: "a DOMAIN or a base TYPE — `CREATE DOMAIN d AS <base>` / `CREATE TYPE ... (...)` — a type that CONFORMS to a base type",
    nodeTypes: ["create_type", "create_domain", "type_definition"],
    whyNot: "the contract's implements is a type DECLARING conformance to an INTERFACE — a named contract with no body. SQL declares no interface: a domain over a base type is a VALUE RESTRICTION, not a conformance declaration, and the served build carries no implement/interface/super node type (measured: 0 of 594).",
  },
]

function walk(dir: string, out: { files: string[]; symlinkedDirsFollowed: number; symlinkedTopLevelEntries: number }): void {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    let st: fs.Stats
    try {
      st = fs.statSync(p) // FOLLOWS a symlink — THE RULE
    } catch {
      continue
    }
    if (st.isDirectory()) {
      if (e.isSymbolicLink()) out.symlinkedDirsFollowed++
      walk(p, out)
    } else if (e.isFile() && e.name.toLowerCase().endsWith(".sql")) {
      out.files.push(p)
    }
  }
}

async function main() {
  const w = { files: [] as string[], symlinkedDirsFollowed: 0, symlinkedTopLevelEntries: 0 }
  const repos = new Set<string>()
  for (const d of fs.readdirSync(CORPUS, { withFileTypes: true })) {
    if (!d.isDirectory() && !d.isSymbolicLink()) continue
    // THE CORPUS'S OWN SYMLINKED CHECKOUTS. The repo loop took them as REPOS, so they were
    // never counted as symlinked directories, and the number the fleet's rule asks for was
    // UNDERCOUNTED by exactly this many.
    if (d.isSymbolicLink()) w.symlinkedTopLevelEntries++
    const dir = path.join(CORPUS, d.name)
    try {
      if (!fs.statSync(dir).isDirectory()) continue
    } catch {
      continue
    }
    const before = w.files.length
    walk(dir, w)
    if (w.files.length > before) repos.add(d.name)
  }
  const admitted: string[] = []
  let overCap = 0
  for (const f of w.files) {
    try {
      if (fs.statSync(f).size > SIZE_CAP) { overCap++; continue }
      admitted.push(f)
    } catch {
      overCap++
    }
  }

  await Parser.init({ locateFile: () => resolveWasmAsset("tree-sitter.wasm") })
  const lang = await Language.load(resolveWasmAsset("tree-sitter-sql/tree-sitter-sql.wasm"))
  const parser = new Parser()
  parser.setLanguage(lang)

  const wanted = new Set<string>()
  for (const c of CANDIDATES) for (const t of c.nodeTypes) wanted.add(t)
  const counts: Record<string, number> = {}
  const filesWith: Record<string, number> = {}
  for (const t of wanted) { counts[t] = 0; filesWith[t] = 0 }

  let parsed = 0
  let parseFailures = 0
  for (const f of admitted) {
    let content: string
    try {
      content = fs.readFileSync(f, "utf8")
    } catch {
      parseFailures++
      continue
    }
    let tree: any
    try {
      tree = parser.parse(content)
      parsed++
    } catch {
      parseFailures++
      continue
    }
    const seen = new Set<string>()
    const stack: any[] = [tree.rootNode]
    while (stack.length) {
      const n = stack.pop()
      if (!n) continue
      const t = String(n.type)
      if (wanted.has(t)) {
        counts[t]++
        seen.add(t)
      }
      for (let i = n.childCount - 1; i >= 0; i--) stack.push(n.child(i))
    }
    for (const t of seen) filesWith[t]++
  }

  const out = {
    language: "sql",
    rule: {
      population: "the WHOLE admitted population: every `.sql` file under the corpus root, walked with `statSync` (SYMLINK-FOLLOWING), admitted when present AND <= 1,048,576 bytes",
      counting: "NODE counts over the served build's own parse: how many times the construct's node type occurs, and in how many files",
      reading: "a count is the NEAR MISS's size, not the type's verdict: the contract decides whether the near miss IS the type, and the contract is cited in each `whyNot`",
    },
    population: {
      paths: w.files.length,
      distinctFiles: new Set(w.files).size,
      admitted: admitted.length,
      overCap,
      // THE THREE SYMLINK NUMBERS, each named. The repo loop took the corpus's own symlinked
      // checkouts as REPOS, so they were never counted as symlinked directories and the
      // number the fleet's rule asks for was UNDERCOUNTED by exactly that many.
      symlinkedDirsFollowed: w.symlinkedDirsFollowed + w.symlinkedTopLevelEntries,
      symlinkedDirsFollowedInsideRepos: w.symlinkedDirsFollowed,
      symlinkedTopLevelEntries: w.symlinkedTopLevelEntries,
      reposCarryingAdmittedFiles: repos.size,
      parsed,
      parseFailures,
    },
    rulings: CANDIDATES.map((c) => {
      const per = c.nodeTypes.map((t) => ({ nodeType: t, sites: counts[t] ?? 0, files: filesWith[t] ?? 0 }))
      const total = per.reduce((a, b) => a + b.sites, 0)
      const totalFiles = per.reduce((a, b) => Math.max(a, b.files), 0)
      return {
        type: c.type,
        nearMiss: c.nearMiss,
        nearMissSites: total,
        nearMissFiles: totalFiles,
        perNodeType: per,
        whyNot: c.whyNot,
      }
    }),
  }
  const p = "validation/m14/measurements/sql-ruling-census.json"
  fs.writeFileSync(p, JSON.stringify(out, null, 2) + "\n")
  console.log("THE NEAR-MISS CENSUS FOR sql's RULED TYPES")
  console.log(`  admitted ${out.population.admitted} · parsed ${parsed} · failures ${parseFailures} · ${out.population.reposCarryingAdmittedFiles} repos · symlinked dirs followed ${out.population.symlinkedDirsFollowed} (${out.population.symlinkedTopLevelEntries} top-level checkouts + ${out.population.symlinkedDirsFollowedInsideRepos} inside repos)`)
  for (const r of out.rulings) {
    console.log(`  ${r.type.padEnd(11)} near miss ${String(r.nearMissSites).padStart(6)} sites / ${String(r.nearMissFiles).padStart(4)} files  [${r.perNodeType.map((x) => `${x.nodeType}=${x.sites}`).join(", ")}]`)
  }
  console.log(`  → ${p}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
