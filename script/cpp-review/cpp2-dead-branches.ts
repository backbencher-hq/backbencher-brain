/**
 * CPP2 — DEAD-BRANCH REGISTER. Branches in this analyzer that the pinned corpus never
 * reaches, counted as NODES rather than argued about in prose.
 *
 * WHY IT IS A FILE. `docs/analyzers/ONTOLOGY-WORKSTREAM.md` Part 1 question 2 asks
 * "does the branch actually FIRE, or is it dead code", and answers that derivation
 * cannot see. A branch that never matches is indistinguishable from a rule that is
 * correct and simply rare, so every entry here is a COUNT over the two pinned
 * corpora plus the exact node predicate — not a claim.
 *
 * The first entry is the interesting one. It was found while proving D20's THIRD site:
 * the accessor mismatch at `returnTypeIsClassDefinition` was fixed, a fixture row was
 * written for it, and a mutant that reverted it SURVIVED — because the guard is never
 * true on this corpus. Reporting that as "fixed and gated" would have been false; the
 * measurement is the finding, and the honest disposition is: fix the accessor because
 * it is the same count/accessor argument as two sites that ARE exercised, and record
 * that no fixture can cover it.
 *
 *   BB_CORPUS_ROOT=$HOME/fixtures/repositories CPP_REPOS=sqlite,cpp-sample \
 *     bun run script/cpp-review/cpp2-dead-branches.ts
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs"
import path from "node:path"
import { ASTEngine } from "../../src/ast/engine"

const CORPUS = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const OUT = process.env.CPP_OUT ?? "/tmp/opencode/cpp-review"
const EXTS = new Set([".cpp", ".cc", ".cxx", ".c++", ".hpp", ".hxx", ".hh", ".h++", ".h", ".ipp", ".tpp"])
const SKIP = new Set([".git", "build", "node_modules", ".github", "cmake-build-debug", "bazel-bin", "CMakeFiles"])
const arg = (f: string): string | undefined => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : undefined }

function walkFiles(root: string): string[] {
  const out: string[] = []
  const stack = [root]
  while (stack.length) {
    const d = stack.pop()!
    let entries: import("node:fs").Dirent[]
    try { entries = readdirSync(d, { withFileTypes: true }) } catch { continue }
    for (const e of entries) {
      if (SKIP.has(e.name)) continue
      const full = path.join(d, e.name)
      if (e.isDirectory()) stack.push(full)
      else if (EXTS.has(path.extname(e.name))) out.push(full)
    }
  }
  return out.sort()
}

interface Branch { id: string; guard: string; predicate: string; count: number; denominator: number; samples: string[]; disposition: string }

async function main() {
  const repoNames = (process.env.CPP_REPOS ?? "sqlite,cpp-sample").split(",").map((s) => s.trim()).filter(Boolean)
  const files: string[] = []
  for (const r of repoNames) files.push(...walkFiles(path.join(CORPUS, r)))

  let fnDefinitions = 0
  const branch: Branch = {
    id: "returnTypeIsClassDefinition",
    guard: "real-cpp-analyzer.ts: `if (type === \"function_definition\" && this.returnTypeIsClassDefinition(node))`",
    predicate: "the node's `type` FIELD is a class/struct/union specifier (directly, or a class_specifier inside a `macro_prefixed_type_specifier`) that carries a `field_declaration_list` child",
    count: 0,
    denominator: 0,
    samples: [],
    disposition: "DEAD on this corpus. The accessor at this decline site was matched to its count bound (ONTOLOGY/D22) because it is the same mismatch as two sites that ARE exercised, but NO fixture can fail on it and `script/cpp-review/cpp2-source-mutants.ts` records the reverting mutant as a DISCLOSED SURVIVOR with this count attached. Reported to master as a dead branch; closing it means deciding whether the guard should exist at all.",
  }
  const nodeTypeCounts = new Map<string, number>()
  const nodeTypeFiles = new Map<string, Set<string>>()

  for (const f of files) {
    let content: string
    try { content = readFileSync(f, "utf8") } catch { continue }
    if (content.length > 4_000_000) continue
    let tree: any
    try { tree = await ASTEngine.parseTree(f, content) } catch { continue }
    const root = tree?.tree?.rootNode
    if (!root) continue
    const rel = `${path.basename(path.dirname(f))}/${path.basename(f)}`
    const stack: any[] = [root]
    while (stack.length) {
      const n = stack.pop()
      nodeTypeCounts.set(n.type, (nodeTypeCounts.get(n.type) ?? 0) + 1)
      if (!nodeTypeFiles.has(n.type)) nodeTypeFiles.set(n.type, new Set())
      nodeTypeFiles.get(n.type)!.add(rel)
      if (n.type === "function_definition") {
        fnDefinitions++
        const ty = n.childForFieldName?.("type")
        const spec = ty?.type === "macro_prefixed_type_specifier"
          ? (ty.namedChildren ?? []).find((c: any) => /^(class|struct|union)_specifier$/.test(c.type))
          : ty
        const hasBody = spec ? (spec.namedChildren ?? []).some((c: any) => c.type === "field_declaration_list") : false
        if (ty && /specifier$/.test(ty.type) && hasBody) {
          branch.count++
          if (branch.samples.length < 8) branch.samples.push(`${rel}:${n.startPosition.row + 1} namedChildCount=${n.namedChildCount} childCount=${n.childCount}`)
        }
      }
      for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) stack.push(c) }
    }
  }
  branch.denominator = fnDefinitions

  // A small tail of node types the fork DECLARES that this corpus never produces.
  // These are the "watched node type the grammar has and the corpus does not" cases
  // that a verdict may legitimately rest on, so they are listed rather than hidden.
  let grammar = ""
  try { grammar = readFileSync(path.join(process.cwd(), "grammars", "tree-sitter-cpp", "grammar.js"), "utf8") } catch { /* recorded */ }
  const declaredNeverProduced = ["concept_definition", "requires_clause", "requires_expression", "requires_parameter_list",
    "pure_virtual_clause", "module_declaration", "export_declaration", "import_declaration", "ms_declspec_modifier", "attribute_specifier"]
    .filter((k) => grammar.includes(`${k}:`) && !nodeTypeCounts.has(k))

  const out = {
    at: new Date().toISOString(),
    corpus: CORPUS, repos: repoNames, filesWalked: files.length,
    distinctNodeTypesObserved: nodeTypeCounts.size,
    deadBranches: [branch],
    declaredByGrammarNeverProduced: declaredNeverProduced,
    note: "A node type the fork DECLARES and the corpus never produces is not a dead branch in the analyzer — it is a construct the corpus does not exercise, and `cpp2-implements-instrument.ts` ARM C is what measures the ones an `implements` verdict rests on. The two lists are kept apart because conflating them is how a construct gets declared absent on the strength of a parser gap.",
  }
  const outPath = arg("--out") ?? path.join(OUT, "cpp2-dead-branches.json")
  mkdirSync(path.dirname(outPath), { recursive: true })
  writeFileSync(outPath, JSON.stringify(out, null, 2))

  console.log(`files ${files.length} | distinct node types observed ${nodeTypeCounts.size} | function_definition nodes ${fnDefinitions}`)
  console.log(`DEAD  ${branch.id}: ${branch.count}/${branch.denominator} nodes trip the guard`)
  console.log(`      ${branch.predicate}`)
  console.log(`      ${branch.disposition}`)
  console.log(`declared by the grammar, never produced by this corpus: ${JSON.stringify(declaredNeverProduced)}`)
  console.log(`evidence: ${outPath}`)
}
await main()
