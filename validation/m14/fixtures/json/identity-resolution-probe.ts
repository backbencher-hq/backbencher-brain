/**
 * IDENTITY-RESOLUTION PROBE — shows the edges the `$id` / `$anchor` fix produces, and the
 * declaration each emitted target actually binds, so a reader can hand-check every one.
 *
 * ## Why this exists
 *
 * `JSON-FIX.md` §5 hand-reads the edges the change moves. A count cannot tell "resolved to a
 * candidate" from "resolved to the intended declaration", so this probe prints, per `references`
 * edge, the SOURCE line, the emitted TARGET, whether the external claim is still on it, and the
 * declaration(s) in the same parse that the target names (kind + line + qualifiedName) — or says
 * NO DECLARATION if nothing answers it.
 *
 * It also prints the identity-unaware form for comparison: the raw `$ref` string. If the emitted
 * target is still the raw string, the fix did not fire; if it is a qualified path, the output
 * shows WHICH declaration that path is.
 *
 * ## The files it reads (read-only)
 *
 *   1. `validation/m14/fixtures/json/DocumentIdentity.json` — the new pin, analyzed the way the
 *      fixture harness analyzes it (`analyzer.analyze` directly, no project root).
 *   2. `gql-graphql-mesh/.../petstore-3.1.json` — the 4 corpus edges the fix moves out of `ext?`.
 *   3. `powershell/dsc/pwsh.profile.dsc.resource.json` — the 2 corpus edges whose target changes
 *      from the raw URI to the declaring `$defs` object's qualified path.
 *
 * Corpus files are parsed through the same entry the incoming gate uses (`parseFile` with
 * `{ projectRoot: repoRoot }`), so the qualified paths here are the gate's own key space.
 *
 * Usage:
 *   npx tsx validation/m14/fixtures/json/identity-resolution-probe.ts
 */
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"
import { ASTEngine, getParser } from "../../../../src/ast/engine"

const HERE = (import.meta as any).dirname ?? process.cwd()
const REPO_ROOT = join(HERE, "..", "..", "..", "..")
const CORPUS = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"

type RefEdge = {
  source: string
  target: string
  line: number
  refPath: string
  external: boolean | undefined
  reasonCode: string | undefined
  confidence: number
}

function refEdges(result: any): RefEdge[] {
  const out: RefEdge[] = []
  for (const r of result.relationships ?? []) {
    if (r.type !== ASTEngine.RelationshipType.References) continue
    const md = r.metadata ?? {}
    out.push({
      source: String(r.source ?? ""),
      target: String(r.target ?? ""),
      line: Number(r.line_number ?? 0),
      refPath: String(md.refPath ?? ""),
      external: md.isExternal as boolean | undefined,
      reasonCode: md.reasonCode as string | undefined,
      confidence: Number(r.confidence ?? 0),
    })
  }
  return out.sort((a, b) => a.line - b.line)
}

/** The declarations the emitted target names: exact qualifiedName first, then exact name. */
function declarationsFor(result: any, target: string): any[] {
  const symbols: any[] = result.symbols ?? []
  const byQn = symbols.filter((s) => String(s.qualifiedName ?? "") === target)
  if (byQn.length > 0) return byQn
  return symbols.filter((s) => String(s.name ?? "") === target)
}

function show(label: string, file: string, result: any): void {
  console.log(`\n=== ${label} ===`)
  console.log(`file: ${file}`)
  const edges = refEdges(result)
  console.log(`references edges: ${edges.length}`)
  for (const e of edges) {
    const decls = declarationsFor(result, e.target)
    const bound = decls.length === 0
      ? "NO DECLARATION"
      : decls.map((d) => `${String(d.kind)} "${String(d.name)}" qn=${String(d.qualifiedName)} line=${d.range?.startLine ?? "?"}`).join(" | ")
    const raw = e.target === e.refPath ? `  (raw spelling, NOT resolved)` : ""
    console.log(
      `  L${String(e.line).padEnd(4)} source=${e.source}\n` +
      `        refPath=${JSON.stringify(e.refPath)}\n` +
      `        target =${JSON.stringify(e.target)}${raw}\n` +
      `        isExternal=${e.external === undefined ? "(unset)" : String(e.external)} reasonCode=${e.reasonCode ?? "?"} confidence=${e.confidence}\n` +
      `        binds -> ${bound}`,
    )
  }
}

async function main(): Promise<void> {
  // 1 · the fixture, through the analyzer directly — the harness's own entry for fixtures
  const fixture = join(REPO_ROOT, "validation", "m14", "fixtures", "json", "DocumentIdentity.json")
  if (existsSync(fixture)) {
    const content = readFileSync(fixture, "utf8")
    const parser = await getParser("json")
    const analyzer = new (await import("../../../../src/ast/real-json-analyzer")).RealJsonAnalyzer()
    const result = analyzer.analyze(parser.parse(content).rootNode, content, "fixtures/json/DocumentIdentity.json")
    show("FIXTURE DocumentIdentity.json", "fixtures/json/DocumentIdentity.json", result)
  } else {
    console.log(`fixture absent: ${fixture}`)
  }

  // 2/3 · the two corpus files, through the gate's own entry (projectRoot set)
  const corpusFiles = [
    ["CORPUS gql petstore-3.1.json", "gql-graphql-mesh", "gql-graphql-mesh/packages/json-machete/tests/fixtures/petstore-3.1.json"],
    ["CORPUS powershell DSC profile", "powershell", "powershell/dsc/pwsh.profile.dsc.resource.json"],
  ] as const
  for (const [label, repo, rel] of corpusFiles) {
    const abs = join(CORPUS, repo, rel.slice(repo.length + 1))
    if (!existsSync(abs)) {
      console.log(`\n${label}: file absent (${abs}) — not measured`)
      continue
    }
    const result = await parseFile(abs, join(CORPUS, repo), { projectRoot: join(CORPUS, repo) } as any)
    show(label, rel, result)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
