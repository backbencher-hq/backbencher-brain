import Link from "next/link"
import type { Metadata } from "next"
import {
  Terminal,
  Database,
  KeyRound,
  Wrench,
  Server,
  Activity,
  HeartPulse,
  ArrowRight,
  EyeOff,
  HardDrive,
  Search,
  RefreshCw,
  Power,
  FileWarning,
} from "lucide-react"
import { TRUTH } from "@/data/truth.generated"
import { PARSERS } from "@/data/brain-languages"
import { DOCS_FACTS } from "@/data/docs.generated"
import { AtlasPage, PageHead } from "@/components/atlas/AtlasPage"
import { RichText, stripRichMarks } from "@/components/atlas/RichText"
// M56.D2: notes come from the shared Callout, whose tones mean something: a
// default note is context, `warn` is a real limitation, `safe` is a guarantee.
import { Callout } from "@/components/ui/callout"

export const metadata: Metadata = {
  title: "Docs — the Backbencher guide",
  description:
    "Install, first index, what gets indexed, keeping the index fresh, embeddings, the MCP server and the full CLI reference — generated against the real bb surface.",
  alternates: { canonical: "/docs" },
}

// M56.D1 — every fact in these sections is rendered from DOCS_FACTS, which
// script/m56/generate-docs-data.ts derives from the CLI itself and from the
// source constants. Nothing here is hand-typed: a flag, a size tier, a skip
// directory or a storage path that drifts from the product fails the gate.
const NAVIGATION = [
  ["installation", "Installation"],
  ["first-index", "First index"],
  ["how-the-index-works", "How the index works"],
  ["what-gets-indexed", "What gets indexed"],
  ["keeping-fresh", "Keeping the index fresh"],
  ["embeddings", "Embeddings setup"],
  ["agent-tools", "Agent tools"],
  ["mcp", "MCP server"],
  ["cli-reference", "CLI reference"],
  ["data-and-upgrades", "Data, upgrades & uninstall"],
  ["troubleshooting", "Troubleshooting"],
] as const

// Byte counts are rendered from the generated facts, never typed.
const mb = (bytes: number) => `${bytes / (1024 * 1024)} MB`
const mib = (bytes: number) => `${bytes / (1024 * 1024)} MiB`

// What each derived phase does for a changed file. The gate requires a row for
// every phase the indexer records, so a new phase cannot ship undocumented.
const PHASE_ROW: Record<string, string> = {
  relationships:
    "The re-parsed file's own edges resolve at insert time; cross-file edges from other files pointing into the changed file are repaired; unresolved external targets are re-resolved, scoped to the touched symbols.",
  enrichment: "Re-run scoped to the touched source symbols.",
  gravity:
    "Recomputed for the touched symbols, plus every symbol whose in-degree changed because of the edit.",
  taint: "Resolution re-processes only the flows that are still unresolved.",
  health: "Recomputed (cheap SQL aggregates).",
  analyze:
    "SQLite's own ANALYZE, so the query planner has statistics. Without sqlite_stat1 it guesses: measured on a real 4.8 GB index, that guess cost a full brain_symbol scan per graph hop — about 15s per bb_graph call, and bb_patterns timed out at 45s. With the statistics present the same hops are sub-millisecond. One-time cost around 8s on that index, covered by the single-flight index lock.",
}

function CodeBlock({ children }: { children: string }) {
  return <pre className="overflow-x-auto rounded-lg border border-[rgba(241,233,221,0.09)] bg-[rgba(0,0,0,0.32)] p-4 font-mono text-[13px] leading-6 text-[#F59E8A]"><code>{children}</code></pre>
}

// M56.I1 — the troubleshooting content moved here from its own page, so the
// docs page is the single source of symptom-based fixes and /troubleshooting
// redirects to this section. Every command below is part of the real bb CLI;
// verify-docs-completeness.ts scans the rendered <code> text for command and
// flag claims the product does not have, so a phantom fix cannot ship.
const FIXES = [
  {
    icon: Search,
    title: "Search results look stale",
    body: "Indexed results state their freshness. Reindex changed files, or re-run the derived phases without a full re-parse:",
    code: "bb index --changed\n# or, when only derived data (relationships, health) is stale:\nbb index --post",
  },
  {
    icon: Power,
    title: "Repair a corrupted index",
    body: "Wipes this project's index and rebuilds it in place. Your source files are never touched:",
    code: "bb index --force",
  },
  {
    icon: RefreshCw,
    title: "An index run was interrupted",
    body: "Check where the run stopped, then continue from its checkpoint:",
    code: "bb status\nbb index --resume",
  },
  {
    icon: HeartPulse,
    title: "Semantic search is weak or unavailable",
    body: "Without a configured embedding provider, semantic modes fall back to weaker local vectors. Check your setup and its consistency:",
    code: "bb setup show\nbb doctor",
    extra: "Configure a provider with bb setup. bb doctor --fix repairs file-permission problems only (0600 on the config) — it is explicit and changes nothing else.",
  },
  {
    icon: FileWarning,
    title: "A tool reports missing or fresh=false data",
    body: "Tool results carry a freshness block (fresh/stale/missing counts plus a remediation command). Run the remediation it names — usually bb index --changed or bb index --post:",
    code: "bb health",
  },
  {
    icon: Terminal,
    title: "Verbose diagnostics",
    body: "Show debug logs and per-file worker/WASM lines for any command; suppress informational output with --quiet:",
    code: "bb --verbose stats\nbb --quiet search createSession",
  },
]


export default function DocsPage() {
  return (
    <AtlasPage>
      <div className="container">
        <PageHead
          title="Backbencher guide"
          lead="Install, index your first project, understand what the indexer does with your files, keep it fresh, and read the generated CLI reference. Everything here is generated against the real bb surface."
          meta={`${TRUTH.cliCommands.length} commands · generated against the real bb CLI · verified by CI`}
        />
        <div className="docs-layout atlas-legacy">
        <aside className="w-full flex-shrink-0 md:w-72">
          <div className="sticky top-24 space-y-8">
            <nav aria-label="Documentation sections">
              <ul className="space-y-1 border-l border-[rgba(241,233,221,0.12)] pl-4">
                {NAVIGATION.map(([id, label]) => (
                  <li key={id}><Link href={`#${id}`} className="block py-1.5 text-sm text-[#8C8070] transition-colors hover:text-[#F5A18C]">{label}</Link></li>
                ))}
              </ul>
            </nav>
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          <section id="installation" className="mb-16 scroll-mt-24">
            <h2 className="font-display mb-5 flex items-center gap-3 text-[1.6rem] font-medium text-[#F1E9DD]"><Terminal className="h-5 w-5 text-[#E2553B]" /> Installation</h2>
            <p className="mb-6 leading-7 text-[#94897A]">Backbencher runs fully local: the <code className="text-[#F59E8A]">bb</code> CLI, the SQLite index, and the analysis all live on your machine. Your source code never leaves it.</p>
            <h3 className="mb-3 font-medium text-[#CFC2AE]">npm (primary path)</h3>
            <CodeBlock>{'npm install -g @backbencher/brain'}</CodeBlock>
            <p className="mb-1 mt-3 text-sm leading-6 text-[#94897A]">Requires Node.js 18 or newer. This is the published artifact every release ships, so the CLI and the package version always agree. Pin a release with <code className="text-[#F59E8A]">npm install -g @backbencher/brain@0.1.0</code>.</p>
            <h3 className="mb-3 mt-7 font-medium text-[#CFC2AE]">Shell installer (macOS and Linux, alternative)</h3>
            <CodeBlock>{'curl -fsSL https://backbencher.cc/install.sh | bash'}</CodeBlock>
            <h3 className="mb-3 mt-7 font-medium text-[#CFC2AE]">PowerShell installer (Windows, alternative)</h3>
            <CodeBlock>{'irm https://backbencher.cc/install.ps1 | iex'}</CodeBlock>
            <p className="mb-1 mt-3 text-sm leading-6 text-[#94897A]">
              Both installers prefer npm and install the same package. Only when npm is unavailable do they fall back to a
              release binary from the <code className="text-[#F59E8A]">backbencher-hq/backbencher-brain</code> GitHub releases,
              and only after its sha256 checksum verifies against the release&apos;s <code className="text-[#F59E8A]">checksums.txt</code>.
              Pin with <code className="text-[#F59E8A]">VERSION=0.1.0</code> in front of either command
              (<code className="text-[#F59E8A]">$env:VERSION=&quot;0.1.0&quot;</code> on Windows).
            </p>
            <h3 className="mb-3 mt-7 font-medium text-[#CFC2AE]">Verify</h3>
            <CodeBlock>{'bb --version'}</CodeBlock>
            <p className="mt-3 text-sm leading-6 text-[#94897A]">If <code>bb</code> is not found, check that your npm global prefix (<code>npm prefix -g</code>) or <code>~/.local/bin</code> is on your PATH, then run the absolute path to verify.</p>
          </section>

          <section id="first-index" className="mb-16 scroll-mt-24">
            <h2 className="mb-5 flex items-center gap-3 font-display text-[1.6rem] font-medium text-[#F1E9DD]"><Database className="h-6 w-6 text-[#E2553B]" /> First index</h2>
            <p className="mb-5 leading-7 text-[#C2B5A2]">Build the index for a project, then inspect it:</p>
            <CodeBlock>{`cd /path/to/project
bb index
bb stats`}</CodeBlock>
            <div className="mt-5 space-y-6">
              <div><h3 className="mb-2 font-medium text-[#CFC2AE]">Reindex changed files only</h3><CodeBlock>{'bb index --changed'}</CodeBlock><p className="mt-2 text-sm leading-6 text-[#94897A]">Incremental: only missing or changed files are reparsed.</p></div>
              <div><h3 className="mb-2 font-medium text-[#CFC2AE]">Clean rebuild</h3><CodeBlock>{'bb index --force'}</CodeBlock><p className="mt-2 text-sm leading-6 text-[#94897A]">Wipes the existing index for this project and rebuilds in place.</p></div>
              <div><h3 className="mb-2 font-medium text-[#CFC2AE]">Re-run derived phases only</h3><CodeBlock>{'bb index --post'}</CodeBlock><p className="mt-2 text-sm leading-6 text-[#94897A]">Re-runs relationship resolution, enrichment, and health phases without reparsing source files — the remediation for stale derived data.</p></div>
              <div><h3 className="mb-2 font-medium text-[#CFC2AE]">Resume an interrupted run</h3><CodeBlock>{'bb index --resume'}</CodeBlock></div>
            </div>
          </section>

          <section id="how-the-index-works" className="mb-16 scroll-mt-24">
            <h2 className="mb-5 flex items-center gap-3 font-display text-[1.6rem] font-medium text-[#F1E9DD]"><Database className="h-6 w-6 text-[#E2553B]" /> How the index works</h2>
            <p className="mb-5 leading-7 text-[#C2B5A2]">
              <code className="font-mono text-[#F59E8A]">bb index</code> walks your project, parses every file with the right
              grammar, extracts symbols and relationships, and persists them into one local database per project — the
              same store every read surface answers from. Nothing is sent anywhere: the index lives on your machine.
            </p>

            <div className="space-y-6">
              <div>
                <h3 className="mb-2 font-medium text-[#CFC2AE]">1 · Parse — a dedicated grammar per family</h3>
                <p className="text-sm leading-6 text-[#94897A]">
                  For {PARSERS.length} of the {TRUTH.languages.classified} registry ids a dedicated analyzer
                  (tree-sitter grammar or hand-written oracle) reads the file with AST precision. The other three —
                  TSX, Sass and Terraform — are aliases served by the TypeScript, CSS and HCL analyzers rather than
                  separate languages, so the editor lane can never exceed the analyzer set. See the{' '}
                  <Link href="/languages" className="text-[#F5A18C] hover:underline">language reference</Link> for the
                  per-family depth label.
                </p>
              </div>

              <div>
                <h3 className="mb-2 font-medium text-[#CFC2AE]">2 · Extract — symbols, bounds, relationships</h3>
                <p className="text-sm leading-6 text-[#94897A]">
                  Each analyzer records what it can prove: symbols with a kind and exact byte bounds (functions, classes,
                  modules, selectors, tables — whatever the family has), and the relationships between them — calls,
                  imports, references, instantiations, uses. Cross-language edges carry an explicit evidence label
                  (structural, import-based, usage-contextual, reference-qualified, or inferred), never a silent guess.
                  What a file could not be parsed into is declared, not invented.
                </p>
              </div>

              <div>
                <h3 className="mb-2 font-medium text-[#CFC2AE]">3 · Persist — one relational store per project</h3>
                <p className="text-sm leading-6 text-[#94897A]">
                  Extracted rows land in one local SQLite database per project (the brain): files, symbols,
                  relationships, imports, and index status as first-class tables; agent annotations and semantic
                  embedding vectors stored alongside when configured; lexical security leads and project health as
                  derived tables. A migration layer keeps the schema versioned.
                </p>
              </div>

              <div>
                <h3 className="mb-2 font-medium text-[#CFC2AE]">4 · Serve — every door reads the same store</h3>
                <p className="text-sm leading-6 text-[#94897A]">
                  One index, several doors: the{' '}
                  <Link href="/tools" className="text-[#F5A18C] hover:underline">{TRUTH.tools.length} MCP tools</Link> over
                  <code className="font-mono text-[#F59E8A]"> bb mcp</code>, the CLI
                  (<code className="font-mono text-[#F59E8A]">bb search</code>,{' '}
                  <code className="font-mono text-[#F59E8A]">bb stats</code>,{' '}
                  <code className="font-mono text-[#F59E8A]">bb health</code>), and the{' '}
                  <Link href="/editors" className="text-[#F5A18C] hover:underline">editor integration</Link>, which talks to
                  the same index through the LSP server — hover, symbol navigation, and call-graph views answer from the
                  same rows a tool call reads.
                </p>
              </div>

              <div>
                <h3 className="mb-2 font-medium text-[#CFC2AE]">5 · Guard — freshness and safe writes</h3>
                <p className="text-sm leading-6 text-[#94897A]">
                  Reads resolve freshness against the live working tree and say so when the index is behind (and how to
                  catch up). Writes are guarded: path checks, AST byte bounds, validation, and rollback, with{' '}
                  <code className="font-mono text-[#F59E8A]">dryRun</code> previews before risky edits. After an edit,
                  the changed file is reindexed so the agent answers from what it just wrote.
                </p>
              </div>
            </div>

            <Callout title="Depth is declared, never assumed">
              <p>
                Symbol kinds, relationship edges, and depth labels on this site are audited against the analyzers. If a
                family parses deeper or shallower than documented, that is a bug worth reporting.
              </p>
            </Callout>
          </section>

          <section id="what-gets-indexed" className="mb-16 scroll-mt-24">
            <h2 className="mb-5 flex items-center gap-3 font-display text-[1.6rem] font-medium text-[#F1E9DD]"><EyeOff className="h-6 w-6 text-[#E2553B]" /> What gets indexed</h2>
            <p className="mb-6 leading-7 text-[#C2B5A2]">
              The indexer walks your project once and then keeps up incrementally. Three layers decide what it reads —
              in this order:
            </p>

            <h3 className="mb-3 font-medium text-[#CFC2AE]">1 · Built-in directory skips</h3>
            <p className="mb-3 text-sm leading-6 text-[#94897A]">
              Always on, in every project, before any of your own rules are read. These directories never reach the
              parser:
            </p>
            <div className="flex flex-wrap gap-2">
              {DOCS_FACTS.indexing.skipDirs.map((dir) => (
                <code key={dir} className="rounded border border-[rgba(241,233,221,0.14)] bg-[rgba(0,0,0,0.28)] px-2 py-1 font-mono text-[12.5px] text-[#F59E8A]">{dir}</code>
              ))}
            </div>

            <h3 className="mb-3 mt-8 font-medium text-[#CFC2AE]">2 · Your gitignore rules are respected</h3>
            <p className="text-sm leading-6 text-[#94897A]">
              Anything git ignores, the indexer skips — a <code className="text-[#F59E8A]">{DOCS_FACTS.indexing.ignoreFiles[0]}</code> at any
              level of the tree is read as it walks, so a project that is already gitignored correctly needs no extra
              configuration.
            </p>

            <h3 className="mb-3 mt-8 font-medium text-[#CFC2AE]">3 · Your .bbignore overrides all of it</h3>
            <p className="text-sm leading-6 text-[#94897A]">
              A project-local <code className="text-[#F59E8A]">{DOCS_FACTS.indexing.ignoreFiles[1]}</code> file (gitignore syntax) has
              higher priority than <code className="text-[#F59E8A]">{DOCS_FACTS.indexing.ignoreFiles[0]}</code> — use it when you want git
              to track something but the indexer to skip it, like large generated fixtures. After you add it,{' '}
              <code className="text-[#F59E8A]">bb index --changed</code> applies it. If an unexpected directory shows up in
              your index, that is the fix — and it is a bug worth reporting.
            </p>

            <h3 className="mb-3 mt-8 font-medium text-[#CFC2AE]">Size tiers — a guardrail, not a silent cap</h3>
            <p className="mb-4 text-sm leading-6 text-[#94897A]">
              One generated blob can stall a whole run, so very large files are handled by tier instead of being parsed
              blindly:
            </p>
            <div className="overflow-x-auto rounded-xl border border-[rgba(241,233,221,0.09)]">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-[rgba(241,233,221,0.09)] bg-[rgba(241,233,221,0.03)]">
                    <th scope="col" className="p-4 text-left font-medium text-[#D9CDBC]">File size</th>
                    <th scope="col" className="p-4 text-left font-medium text-[#D9CDBC]">What the indexer does</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[rgba(241,233,221,0.09)]">
                  <tr>
                    <td className="p-4 align-top font-mono text-white">up to {mb(DOCS_FACTS.indexing.fullAstBytes)}</td>
                    <td className="p-4 text-[#94897A]">Full AST parse — symbols with byte bounds, and the relationships between them.</td>
                  </tr>
                  <tr>
                    <td className="p-4 align-top font-mono text-white">{mb(DOCS_FACTS.indexing.fullAstBytes)}–{mb(DOCS_FACTS.indexing.structuralBytes)}</td>
                    <td className="p-4 text-[#94897A]">Structural symbols only, for {DOCS_FACTS.indexing.structuralFormatsNote} — the formats where a huge file is usually machine-generated.</td>
                  </tr>
                  <tr>
                    <td className="p-4 align-top font-mono text-white">over {mb(DOCS_FACTS.indexing.structuralBytes)}</td>
                    <td className="p-4 text-[#94897A]">Skipped, never parsed ({mb(DOCS_FACTS.indexing.walkSizeLimit)} walk limit). The tiers are tuned, not dogma: if a file you care about is skipped, tell us.</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <h3 className="mb-3 mt-8 font-medium text-[#CFC2AE]">How long indexing takes</h3>
            <p className="text-sm leading-6 text-[#94897A]">
              The <strong className="font-medium text-[#CFC2AE]">first index</strong> is the expensive pass: it parses every
              discovered file and then runs the derived phases. A <strong className="font-medium text-[#CFC2AE]">re-run of an
              unchanged project</strong> is fast, because files whose size and modification time are unchanged are not
              re-parsed at all. Progress streams while it runs, and{' '}
              <code className="text-[#F59E8A]">bb status</code> reports per-phase timings of the last run.
            </p>
          </section>

          <section id="keeping-fresh" className="mb-16 scroll-mt-24">
            <h2 className="mb-5 flex items-center gap-3 font-display text-[1.6rem] font-medium text-[#F1E9DD]"><Activity className="h-6 w-6 text-[#E2553B]" /> Keeping the index fresh</h2>
            <p className="mb-6 leading-7 text-[#C2B5A2]">
              A code index is only useful while it matches the working tree. Three mechanisms, in the order you will
              normally meet them:
            </p>

            <h3 className="mb-3 font-medium text-[#CFC2AE]">1 · Reads refresh stale files inside a budget</h3>
            <p className="mb-3 text-sm leading-6 text-[#94897A]">
              When a read path touches files that are stale or missing in the index, it repairs exactly those files
              within a budget before answering, and says so in an{' '}
              <code className="text-[#F59E8A]">auto-refreshed N files in Xms</code> line. The budget is{' '}
              <strong className="font-medium text-[#CFC2AE]">{DOCS_FACTS.freshness.autoRefresh.maxFiles} files</strong> or{' '}
              <strong className="font-medium text-[#CFC2AE]">{mib(DOCS_FACTS.freshness.autoRefresh.maxBytes)} of changed bytes</strong>,
              whichever comes first, and it is tunable through the environment:
            </p>
            <div className="flex flex-wrap gap-2">
              {DOCS_FACTS.freshness.env.map((name) => (
                <code key={name} className="rounded border border-[rgba(241,233,221,0.14)] bg-[rgba(0,0,0,0.28)] px-2 py-1 font-mono text-[12.5px] text-[#F59E8A]">{name}</code>
              ))}
            </div>
            <p className="mt-3 text-sm leading-6 text-[#94897A]">
              <code className="text-[#F59E8A]">{DOCS_FACTS.freshness.env[0]}=1</code> opts out entirely. If the repair would exceed
              the budget, or another index run holds the lock, the tool answers from existing data with a staleness
              footer instead of pretending the index is current.
            </p>

            <h3 className="mb-3 mt-8 font-medium text-[#CFC2AE]">2 · Incremental, on purpose</h3>
            <div className="space-y-4">
              <div><CodeBlock>{'bb index --changed'}</CodeBlock><p className="mt-2 text-sm leading-6 text-[#94897A]">Re-parses only files changed since the last index, and runs the bounded derived-data pass so relationships stay current. This is the routine “I edited things, sync my index” command.</p></div>
              <div><CodeBlock>{'bb index --file src/session.ts'}</CodeBlock><p className="mt-2 text-sm leading-6 text-[#94897A]">Re-indexes one file’s symbols and relationships. Use it right after an agent creates or edits a function.</p></div>
              <div><CodeBlock>{'bb index --post'}</CodeBlock><p className="mt-2 text-sm leading-6 text-[#94897A]">Re-runs the derived phases without re-parsing anything — the remediation when derived data was skipped or went stale (for example after <code className="text-[#F59E8A]">--skip-post-processing</code>).</p></div>
              <div><CodeBlock>{'bb index --resume'}</CodeBlock><p className="mt-2 text-sm leading-6 text-[#94897A]">Continues an interrupted run from its checkpoint: only missing or changed files are processed, then the bounded derived pass runs.</p></div>
            </div>

            <h3 className="mb-3 mt-8 font-medium text-[#CFC2AE]">What a changed file recomputes</h3>
            <p className="mb-4 text-sm leading-6 text-[#94897A]">
              Only what the changed files touch — never the whole index. This is the exact list, phase by phase:
            </p>
            <div className="overflow-x-auto rounded-xl border border-[rgba(241,233,221,0.09)]">
              <table className="w-full min-w-[620px] text-sm">
                <thead>
                  <tr className="border-b border-[rgba(241,233,221,0.09)] bg-[rgba(241,233,221,0.03)]">
                    <th scope="col" className="p-4 text-left font-medium text-[#D9CDBC]">Data</th>
                    <th scope="col" className="p-4 text-left font-medium text-[#D9CDBC]">Updated for changed files</th>
                    <th scope="col" className="p-4 text-left font-medium text-[#D9CDBC]">How</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[rgba(241,233,221,0.09)]">
                  <tr>
                    <td className="p-4 align-top font-mono text-white">symbols</td>
                    <td className="p-4 align-top text-[#C2B5A2]">yes</td>
                    <td className="p-4 text-[#94897A]">Changed files are re-parsed by the same analyzers and their symbol rows are rewritten; unchanged files are not touched.</td>
                  </tr>
                  {DOCS_FACTS.freshness.derivedPhases.map((phase) => (
                    <tr key={phase}>
                      <td className="p-4 align-top font-mono text-white">{phase}</td>
                      <td className="p-4 align-top text-[#C2B5A2]">yes</td>
                      <td className="p-4 text-[#94897A]">{PHASE_ROW[phase] ?? ""}</td>
                    </tr>
                  ))}
                  <tr>
                    <td className="p-4 align-top font-mono text-white">deleted files</td>
                    <td className="p-4 align-top text-[#C2B5A2]">yes</td>
                    <td className="p-4 text-[#94897A]">Purged from the index, including their derived rows.</td>
                  </tr>
                  <tr>
                    <td className="p-4 align-top font-mono text-white">embeddings</td>
                    <td className="p-4 align-top text-[#C2B5A2]">queued</td>
                    <td className="p-4 text-[#94897A]">New and changed symbols are queued for the embedding provider during storage; vectors fill in asynchronously with a local fallback when no provider is configured.</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="mt-4 text-sm leading-6 text-[#94897A]">
              Two honest edges: embeddings are asynchronous, so semantic search can lag symbol and relationship freshness
              by a few seconds after an edit; and a derived phase that fails leaves the run’s status{' '}
              <code className="text-[#F59E8A]">partial</code> rather than silently claiming success. A run summary reports what
              it did as <code className="text-[#F59E8A]">{`derivedPass: ${DOCS_FACTS.freshness.derivedPassLabels.join(" | ")}`}</code>{' '}
              — a bounded pass covers the touched files, a full pass covers everything, and a deferred pass means the
              derived data is still owed (run <code className="text-[#F59E8A]">bb index --post</code>).
            </p>
            <Callout title="Only a full rebuild recomputes everything">
              <p>
                <code className="text-[#F59E8A]">bb index --force</code> wipes the project’s index and rebuilds it from
                scratch. Incremental runs cover every case below that, so you should rarely need it.
              </p>
            </Callout>
          </section>

          <section id="embeddings" className="mb-16 scroll-mt-24">
            <h2 className="mb-5 flex items-center gap-3 font-display text-[1.6rem] font-medium text-[#F1E9DD]"><KeyRound className="h-6 w-6 text-[#E2553B]" /> Embeddings setup</h2>
            <p className="mb-5 leading-7 text-[#C2B5A2]">Semantic search (<code>bb_ask</code> semantic mode) uses embedding vectors. Without a provider key, the indexer still works — semantic search just falls back to weaker local vectors, and the CLI tells you so honestly.</p>
            <CodeBlock>{`bb setup        # interactive: provider, API key, model
bb setup show   # inspect config — the key is shown as a fingerprint only`}</CodeBlock>
            <p className="mb-5 mt-5 leading-7 text-[#C2B5A2]">Diagnose a broken setup or inconsistent index:</p>
            <CodeBlock>{'bb doctor'}</CodeBlock>
            <p className="mt-3 text-sm leading-6 text-[#94897A]"><code>bb doctor</code> is read-only. <code>bb doctor --fix</code> repairs file-permission problems only (0600 on the config); it changes nothing else. The first <code>bb index</code> run also offers the setup wizard interactively — skip it once with <code>bb index --no-setup</code>.</p>
            <Callout tone="safe" title="Keys stay on your machine"><p>The API key is stored with owner-only permissions (0600) and is never sent to any AI agent — tools see a fingerprint only.</p></Callout>
          </section>

          <section id="agent-tools" className="mb-16 scroll-mt-24">
            <h2 className="mb-5 flex items-center gap-3 font-display text-[1.6rem] font-medium text-[#F1E9DD]"><Wrench className="h-6 w-6 text-[#E2553B]" /> Agent tools ({TRUTH.tools.length})</h2>
            <p className="mb-5 leading-7 text-[#C2B5A2]">Backbencher exposes {TRUTH.tools.length} public MCP tools for indexed discovery, analysis, documentation, guarded mutation, diagnostics, security lead review, migration planning, and graph export. These are tool calls an MCP client invokes — not shell subcommands. Each row carries the tool's full registry description; the <Link href="/tools" className="text-[#F5A18C] hover:underline">tool reference</Link> adds modes, defaults, parameters and examples.</p>
            <div className="mt-5 overflow-x-auto rounded-xl border border-[rgba(241,233,221,0.09)]">
              <table className="w-full min-w-[620px] text-sm"><thead><tr className="bg-[rgba(241,233,221,0.03)] border-b border-[rgba(241,233,221,0.09)]"><th scope="col" className="p-4 text-left font-medium text-[#D9CDBC]">Tool</th><th scope="col" className="p-4 text-left font-medium text-[#D9CDBC]">What it does</th></tr></thead>
                <tbody className="divide-y divide-[rgba(241,233,221,0.09)]">
                  {TRUTH.tools.map((t) => (
                    <tr key={t.name}><td className="p-4 align-top font-mono text-white">{t.name}</td><td className="p-4 text-[#94897A]"><RichText text={t.description} /></td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Link href="/tools" className="mt-6 inline-flex items-center gap-2 font-medium text-[#E2553B] hover:text-[#FF7F5E]">Full schemas, defaults, safety behavior, and limitations <ArrowRight className="h-4 w-4" /></Link>
            <div className="mt-8">
              <p className="mb-3 leading-7 text-[#C2B5A2]">From the terminal, run any tool with JSON arguments:</p>
              <CodeBlock>{'bb tool bb_search --args \'{"mode":"symbol","query":"createSession"}\''}</CodeBlock>
            </div>
          </section>

          <section id="mcp" className="mb-16 scroll-mt-24">
            <h2 className="mb-5 flex items-center gap-3 font-display text-[1.6rem] font-medium text-[#F1E9DD]"><Server className="h-6 w-6 text-[#E2553B]" /> MCP server</h2>
            <p className="mb-5 leading-7 text-[#C2B5A2]"><code>bb mcp</code> starts the Backbencher MCP server over stdio. Point any MCP client at it — Claude Code, Cursor, VS Code, opencode, and others:</p>
            <CodeBlock>{`# Claude Code
claude mcp add backbencher -- bb mcp --dir /path/to/project

# Generic MCP client configuration
{
  "mcpServers": {
    "backbencher": {
      "command": "bb",
      "args": ["mcp", "--dir", "/path/to/project"]
    }
  }
}`}</CodeBlock>
            <Callout tone="warn" title="bb mcp starts a server, it does not configure clients"><p><code>bb mcp</code> is the server process. Client registration happens in your MCP client&apos;s own configuration, as shown above.</p></Callout>
          </section>

          <section id="cli-reference" className="mb-16 scroll-mt-24">
            <h2 className="mb-5 flex items-center gap-3 font-display text-[1.6rem] font-medium text-[#F1E9DD]"><Terminal className="h-6 w-6 text-[#E2553B]" /> CLI reference</h2>
            <p className="mb-5 leading-7 text-[#C2B5A2]">
              All {DOCS_FACTS.cli.commands.length} top-level commands and every flag they accept. This reference is
              generated from the CLI&apos;s own help text, so it cannot list a flag the binary does not have — run{' '}
              <code>bb &lt;command&gt; --help</code> for the same output on your machine.
            </p>
            <div className="space-y-4">
              {DOCS_FACTS.cli.commands.map((cmd) => (
                <div key={cmd.name} className="plate scroll-mt-24 p-5 transition-colors hover:border-[rgba(241,233,221,0.18)]">
                  <code className="font-mono text-sm text-[#F5A18C]">{`bb ${cmd.usage.replace(/^bb\s*/, "")}`}</code>
                  <p className="mt-2 text-sm leading-6 text-[#94897A]"><RichText text={cmd.summary} /></p>
                  {cmd.args.length > 0 && (
                    <p className="mt-2 text-sm leading-6 text-[#94897A]">
                      Arguments:{' '}
                      {cmd.args.map((a) => `${a.name} — ${stripRichMarks(a.description)}`).join('; ')}
                    </p>
                  )}
                  {cmd.subcommands.length > 0 && (
                    <p className="mt-2 text-sm leading-6 text-[#94897A]">
                      Subcommands:{' '}
                      {cmd.subcommands.map((s) => (
                        <code key={s.name} className="font-mono text-[13px] text-[#F59E8A]">{`bb ${cmd.name} ${s.name}`}</code>
                      ))}
                    </p>
                  )}
                  {cmd.flags.length > 0 && (
                    <div className="mt-4 overflow-x-auto">
                      <table className="w-full min-w-[520px] text-sm">
                        <thead>
                          <tr className="border-b border-[rgba(241,233,221,0.09)]">
                            <th scope="col" className="p-3 text-left font-medium text-[#D9CDBC]">Flag</th>
                            <th scope="col" className="p-3 text-left font-medium text-[#D9CDBC]">What it does</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[rgba(241,233,221,0.09)]">
                          {cmd.flags.map((f) => (
                            <tr key={f.flags.join(' ')}>
                              <td className="whitespace-nowrap p-3 align-top font-mono text-[13px] text-[#F59E8A]">
                                {f.flags.join(', ') + (f.argument ? ` <${f.argument}>` : '')}
                              </td>
                              <td className="p-3 text-[13px] leading-6 text-[#94897A]"><RichText text={f.description} /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-8">
              <p className="mb-3 leading-7 text-[#C2B5A2]">
                Global flags, accepted by every command: {DOCS_FACTS.cli.globalFlags.map((f) => f.flags.join(', ')).join(' · ')}.
              </p>
              <p className="mb-3 leading-7 text-[#C2B5A2]">Daily diagnostics:</p>
              <CodeBlock>{`bb stats          # counts
bb status         # is an index running? what did the last run do?
bb health         # is the index healthy and fresh?
bb doctor         # is the embedding setup consistent?`}</CodeBlock>
            </div>
          </section>

          <section id="data-and-upgrades" className="mb-16 scroll-mt-24">
            <h2 className="mb-5 flex items-center gap-3 font-display text-[1.6rem] font-medium text-[#F1E9DD]"><HardDrive className="h-6 w-6 text-[#E2553B]" /> Data, upgrades &amp; uninstall</h2>

            <h3 className="mb-3 font-medium text-[#CFC2AE]">Where the index lives</h3>
            <p className="mb-3 leading-7 text-[#C2B5A2]">
              One directory, keyed per project, outside your repository and outside the installed program:
            </p>
            <CodeBlock>{`${DOCS_FACTS.storage.dataDir}/${DOCS_FACTS.storage.indexFile.replace('<data-dir>/', '')}     # the index: symbols, relationships, embeddings\n${DOCS_FACTS.storage.dataDir}/${DOCS_FACTS.storage.parserCache.replace('<data-dir>/', '')}                               # parser cache`}</CodeBlock>
            <p className="mt-3 text-sm leading-6 text-[#94897A]">
              The <code className="text-[#F59E8A]">&lt;project-id&gt;</code> is a {DOCS_FACTS.storage.projectIdNote}, so two checkouts
              of the same repository at different paths have separate indexes. Override the whole location with{' '}
              <code className="text-[#F59E8A]">{DOCS_FACTS.storage.envOverride}</code> — recommended where the home directory is not
              reliably writable or persistent (sandboxes, CI, editor hosts).
            </p>

            <h3 className="mb-3 mt-8 font-medium text-[#CFC2AE]">Upgrading keeps your data</h3>
            <p className="text-sm leading-6 text-[#94897A]">
              New releases run idempotent schema migrations when they open the database: an upgraded{' '}
              <code className="text-[#F59E8A]">bb</code> either uses the existing index as it is or upgrades it in place — it
              never wipes it. To move to a new release, run <code className="text-[#F59E8A]">npm install -g @backbencher/brain@latest</code>{" "}
              (or re-run the installer, which does the same thing through npm); <code className="text-[#F59E8A]">npm install -g @backbencher/brain@0.1.0</code>{" "}
              pins a specific release. There is no separate in-place upgrade subcommand.
            </p>

            <h3 className="mb-3 mt-8 font-medium text-[#CFC2AE]">Uninstall and reinstall</h3>
            <p className="text-sm leading-6 text-[#94897A]">
              Uninstalling removes the program, not <code className="text-[#F59E8A]">{DOCS_FACTS.storage.dataDir}</code>. Reinstall and every
              index, embedding and history entry is exactly where you left it. You start from zero only if the project moved
              to a different absolute path — then:
            </p>
            <div className="mt-3">
              <CodeBlock>{'bb index --import /path/to/old-brain.db'}</CodeBlock>
              <p className="mt-2 text-sm leading-6 text-[#94897A]">
                adopts (re-homes) an existing index for the project at its current location. Moving a database between
                machines works the same way when the codebase fingerprint matches.
              </p>
            </div>

            <h3 className="mb-3 mt-8 font-medium text-[#CFC2AE]">See and reclaim disk space</h3>
            <CodeBlock>{`bb projects                  # every indexed project: DB path, size, counts, last index\nbb projects --sort size      # biggest indexes first\nbb projects --remove <id>    # delete one project's index + embeddings\nbb stats                     # committed counts for the current project`}</CodeBlock>
            <p className="mt-3 text-sm leading-6 text-[#94897A]">
              Removing a project is the only operation that deletes an index. Nothing else in the CLI does, and no
              command sends your code or your index anywhere.
            </p>
          </section>

          <section id="troubleshooting" className="mb-16 scroll-mt-24">
            <h2 className="mb-5 flex items-center gap-3 font-display text-[1.6rem] font-medium text-[#F1E9DD]"><HeartPulse className="h-6 w-6 text-[#E2553B]" /> Troubleshooting</h2>
            <p className="mb-6 leading-7 text-[#94897A]">
              Symptom-based fixes. Each one names a real command that resolves it.
            </p>
            <div className="space-y-5">
              {FIXES.map((f) => (
                <div key={f.title} className="rounded-lg border border-[rgba(241,233,221,0.09)] bg-[rgba(0,0,0,0.18)] p-5">
                  <h3 className="mb-2 flex items-center gap-2.5 font-medium text-[#CFC2AE]">
                    <f.icon className="h-[18px] w-[18px] text-[#E2553B]" />
                    {f.title}
                  </h3>
                  <p className="mb-4 text-sm leading-[1.75] text-[#94897A]">{f.body}</p>
                  <CodeBlock>{f.code}</CodeBlock>
                  {f.extra && <p className="mt-3 text-sm leading-[1.75] text-[#8C8070]">{f.extra}</p>}
                </div>
              ))}
            </div>
            <p className="mt-5 text-sm leading-6 text-[#8C8070]">
              Still stuck? Send the output of <code className="font-mono text-[#F59E8A]">bb health</code> and{" "}
              <code className="font-mono text-[#F59E8A]">bb stats</code> to{" "}
              <Link href="/support#still-have-questions" className="text-[#F5A18C] hover:underline">support</Link>.
            </p>
            <Callout tone="safe" title="Upgrading keeps your data"><p>To move to a new release, run <code className="text-[#F59E8A]">npm install -g @backbencher/brain@latest</code> — it replaces the installed package in place, leaves your index untouched, and there is no separate in-place upgrade subcommand. Details in <Link href="#data-and-upgrades" className="text-[#F5A18C] hover:underline">Data, upgrades &amp; uninstall</Link>.</p></Callout>
          </section>

          <footer className="border-t border-[rgba(241,233,221,0.1)] pt-8 text-sm text-[#8C8070]">Documentation is generated against the current CLI surface and verified by CI. Some safety and semantic features depend on index freshness, grammar availability, and an active language server.</footer>
        </div>
        </div>
      </div>
    </AtlasPage>
  )
}
