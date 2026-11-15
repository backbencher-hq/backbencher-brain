/**
 * `public-id-census.mts` — how many `imports` edges rest on a PUBLIC IDENTIFIER rather
 * than on a file.
 *
 * ## THE QUESTION
 *
 * `extractExternalId` (src/ast/real-xml-analyzer.ts:2067) picks
 * `findDirectChild(externalId, "SystemLiteral") ?? findDirectChild(externalId, "PubidLiteral")`
 * and publishes the literal it finds as the edge's `target`. A `SystemLiteral` is a file
 * reference. A `PubidLiteral` is NOT: it is a symbolic name a parser matches against a
 * catalogue. XML's own grammar allows the two shapes
 *
 *     ExternalID ::= 'SYSTEM' SystemLiteral
 *                  | 'PUBLIC' PubidLiteral
 *                  | 'PUBLIC' PubidLiteral SystemLiteral
 *
 * so `PUBLIC "pubid"` with no system literal is a legal ExternalID that names no file at
 * all, and the fallback turns it into one.
 *
 * The corpus instance is one edge, and it is self-evident once named:
 *
 *     libxslt/tests/general/bug-52.xml
 *       <!NOTATION GIF PUBLIC "GIF">
 *       <!ENTITY graphic SYSTEM "graphic.gif" NDATA GIF>
 *     ->  GIF -imports-> GIF  role=notation_external_id  confidence=1
 *
 * `containment-ledger.mts` found it as the ONLY `imports` edge with no site on the tree
 * (§`imports` site ledger), which is what an invented edge looks like from the outside.
 * Confidence 1 is the second thing wrong with it: the tier table maps
 * `notation_external_id` to `import_based`, and an edge whose target was never read out of
 * a system identifier is not import-based at all.
 *
 * ## WHAT IT MEASURES, and it is two numbers, not one
 *
 *   A. the TREE count — every `ExternalID`/`PublicID` node in the corpus, split by whether
 *      a `SystemLiteral` is present. This is instrument A (grammar inventory) and it needs
 *      no analyzer at all.
 *   B. the EDGE count — every emitted `imports` edge whose `externalIdKind` is `public`,
 *      split the same way, from production `parseFile`.
 *
 * A and B are counted from different sources on purpose. If they disagree, one of them is
 * wrong, and the size of the disagreement is the size of the fabrication.
 *
 * ## WHAT IT CANNOT FIND
 *
 *   It cannot see a public id that the grammar dropped, for the reason every instrument in
 *   this lane carries: the tree walk and the analyzer share `tree-sitter-xml`.
 *
 * ## CLI
 *   npx tsx validation/m14/fixtures/xml/public-id-census.mts
 *   BB_PUBID_MAX=2000   bound the file count (0 = the whole admitted population)
 *   BB_XML_WORKERS=1     production parseFile concurrency
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const WORKERS = Number(process.env.BB_XML_WORKERS ?? "1")
const MAX_FILES = Number(process.env.BB_PUBID_MAX ?? "0")
const HERE = import.meta.dirname
const OUT = path.join(HERE, "public-id-census.json")

const { parseFile } = (await import("../../../../src/ast/pool-worker")) as any
const { ASTEngine } = (await import("../../../../src/ast/engine")) as any
const { detectLanguageFromPath } = (await import("../../../../src/ast/language-detection")) as any

// ── corpus discovery: the gate's rule, copied from containment-ledger.mts ───────
const files: { repo: string; dir: string; rel: string; abs: string; text: string }[] = []
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
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
      .split("\0")
      .filter(Boolean)
  } catch {
    continue
  }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try {
      if (statSync(abs).size > 512 * 1024) continue
      text = readFileSync(abs, "utf8")
    } catch {
      continue
    }
    if (detectLanguageFromPath(abs, text) !== "xml") continue
    files.push({ repo: e, dir, rel, abs, text })
  }
}
const admittedTotal = files.length
const admitted = MAX_FILES > 0 ? files.slice(0, MAX_FILES) : files
console.error(`public-id-census: ${admitted.length} admitted files (${admittedTotal} discovered), ${WORKERS} worker(s)`)
if (admittedTotal === 0) throw new Error("no files admitted — the corpus root is wrong")

const directChild = (n: any, type: string): any => {
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c && c.type === type) return c
  }
  return null
}

// ── A. the tree count ──────────────────────────────────────────────────────────
const treeTotal = { externalIdNodes: 0, withSystemLiteral: 0, pubidOnly: 0 }
const pubidOnlyExamples: string[] = []
const byParentType = new Map<string, number>()

// ── B. the edge count ──────────────────────────────────────────────────────────
const edgeTotal = { importsEdges: 0, publicKind: 0, systemKind: 0 }
const publicEdges: string[] = []
const selfTargetPublic: string[] = []
const parseFail = 0

let cursor = 0
const worker = async (): Promise<void> => {
  for (;;) {
    const i = cursor++
    if (i >= admitted.length) return
    const f = admitted[i]!
    const label = `${f.repo}/${f.rel}`

    let tree: any
    try {
      tree = (await ASTEngine.parseTree(f.abs, f.text)).tree
    } catch {
      /* counted by the parseFile pass below; the tree side is simply absent */
    }
    if (tree?.rootNode) {
      const stack: any[] = [tree.rootNode]
      while (stack.length) {
        const n = stack.pop()!
        for (let c = n.childCount - 1; c >= 0; c--) {
          const k = n.child(c)
          if (k) stack.push(k)
        }
        if (n.type !== "ExternalID" && n.type !== "PublicID") continue
        treeTotal.externalIdNodes++
        const sys = directChild(n, "SystemLiteral")
        const pub = directChild(n, "PubidLiteral")
        if (!sys && pub) {
          treeTotal.pubidOnly++
          const owner = n.parent?.type ?? "<none>"
          byParentType.set(owner, (byParentType.get(owner) ?? 0) + 1)
          if (pubidOnlyExamples.length < 25) {
            pubidOnlyExamples.push(`${label}:${pub.startPosition.row + 1} under <${owner}> pubid=${JSON.stringify(pub.text.slice(0, 60))}`)
          }
        } else if (sys) {
          treeTotal.withSystemLiteral++
        }
      }
      try {
        tree.delete()
      } catch {
        /* already released */
      }
    }

    try {
      const r = await parseFile(f.abs, f.dir)
      for (const rel of r.relationships ?? []) {
        if (rel.type !== "imports") continue
        edgeTotal.importsEdges++
        const kind = String((rel.metadata as any)?.externalIdKind ?? "")
        const role = String((rel.metadata as any)?.role ?? "")
        if (kind === "system") {
          edgeTotal.systemKind++
        } else if (kind === "public") {
          edgeTotal.publicKind++
          const line = `${label}: ${rel.source} -imports-> ${rel.target} role=${role || "<none>"} conf=${(rel as any).confidence}`
          if (publicEdges.length < 25) publicEdges.push(line)
          if (rel.source === rel.target && selfTargetPublic.length < 25) selfTargetPublic.push(line)
        }
      }
    } catch {
      parseFail++
    }
  }
}
await Promise.all(Array.from({ length: WORKERS }, () => worker()))

const report = {
  generatedBy: "validation/m14/fixtures/xml/public-id-census.mts",
  question: "how many `imports` edges name a PUBLIC IDENTIFIER instead of a file",
  corpus: {
    root: CR,
    admittedTotal,
    admitted: admitted.length,
    workers: WORKERS,
    method:
      "git-tracked files only, 512 KiB cap, detectLanguageFromPath(abs, text) — the arbiter's own rule",
    parseFailures: parseFail,
  },
  treeSide: {
    ...treeTotal,
    pubidOnlyByParentType: Object.fromEntries([...byParentType.entries()].sort((a, b) => b[1] - a[1])),
    pubidOnlyExamples,
    note:
      "instrument A, grammar inventory: counted from the parse tree with no reference to the analyzer, so it is the number a correct implementation would have to match",
  },
  edgeSide: {
    ...edgeTotal,
    publicEdges,
    publicEdgesWhereTargetEqualsSource: selfTargetPublic,
    note:
      "instrument B, from production parseFile; externalIdKind is the analyzer's own record of which literal it read",
  },
  disagreement: {
    pubidOnlyNodesOnTree: treeTotal.pubidOnly,
    importsEdgesWithKindPublic: edgeTotal.publicKind,
    edgesWithNoSystemLiteralOnTree: treeTotal.pubidOnly - edgeTotal.publicKind,
    reading:
      "A tree node with no SystemLiteral and an emitted edge carrying externalIdKind=public is the fabrication. If the two agree there is no bug and the rule is redundant; if the edge count exceeds the node count the analyzer is inventing edges the tree does not carry.",
  },
}
writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`)
console.error(`wrote ${OUT}`)
console.log(`tree   ExternalID/PublicID nodes=${treeTotal.externalIdNodes} withSystemLiteral=${treeTotal.withSystemLiteral} pubidOnly=${treeTotal.pubidOnly}`)
console.log(`       pubidOnly by parent: ${[...byParentType.entries()].map(([k, v]) => `${k}=${v}`).join(" ") || "(none)"}`)
for (const e of pubidOnlyExamples) console.log(`         ${e}`)
console.log(`edges  imports=${edgeTotal.importsEdges} externalIdKind=system ${edgeTotal.systemKind} externalIdKind=public ${edgeTotal.publicKind}`)
for (const e of publicEdges) console.log(`         ${e}`)
