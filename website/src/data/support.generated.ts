// GENERATED FILE — do not edit by hand.
// npx tsx script/m56/generate-support-data.ts --write
//
// Single FAQ source (M56.S1): parsed from website/faq.md. Two consumers:
//   - website/src/app/support/page.tsx renders these QAs (grouped by section)
//   - website/src/components/SupportJsonLd.tsx derives FAQPage JSON-LD from the
//     SAME array — a search engine is never told anything the page does not show.
// Answers are normalized plain text (markdown stripped, links kept as "label (href)").
// The truth cross-check ran at generation time: every count faq.md states agrees
// with the engine registry (tables=16, tools=16, languages=50/53).

export interface SupportQA {
  q: string
  section: string
  a: string
}

export const FAQ_SECTIONS = [
  {
    "name": "The product",
    "questions": [
      "What is Backbencher?",
      "Does my code leave my machine?",
      "Is Backbencher open source?",
      "How much does it cost?"
    ]
  },
  {
    "name": "Indexing",
    "questions": [
      "Does the indexer skip `node_modules`, build output, and other junk?",
      "How big can files be?",
      "How long does indexing take?",
      "Why do I need an embedding API key? Can I use Backbencher without one?"
    ]
  },
  {
    "name": "Re-indexing after changes",
    "questions": [
      "I changed one line in one file. What happens?",
      "Do symbols, relationships, and embeddings get recomputed for everything again?",
      "My agent created a function seconds ago — will the DB know?",
      "How do I keep the index up to date?",
      "The indexer was interrupted (power cut, Ctrl+C). Do I start over?"
    ]
  },
  {
    "name": "Updates, uninstalling, and your data",
    "questions": [
      "Where does bb store my index?",
      "If the bb version is updated, is my index history erased?",
      "If I uninstall and reinstall bb, do I lose everything?",
      "How do I see and reclaim disk space used by indexes?"
    ]
  },
  {
    "name": "MCP / agent integration",
    "questions": [
      "Which MCP clients work with Backbencher?",
      "What is the difference between the CLI commands and the agent tools?",
      "Which tools does the MCP server expose?",
      "The tools feel slow on big repos — is that expected?"
    ]
  }
]

export const SUPPORT_QA: SupportQA[] = [
  {
    q: "What is Backbencher?",
    section: "The product",
    a: "Backbencher — bb for short — is a local-first code intelligence engine. It indexes your codebase into a local SQLite database (16 tables: symbols, source bounds, imports, relationships), and exposes 16 agent tools over MCP plus a CLI for code search, symbol extraction, call-graph analysis, relationship mapping, diagnostics, and guarded edits. It supports 50 languages (the registry carries 53 ids — TSX, Sass and Terraform are aliases served by the TypeScript, CSS and HCL analyzers, so every id resolves to a real grammar).",
  },
  {
    q: "Does my code leave my machine?",
    section: "The product",
    a: "No. Indexing, storage, and analysis are all local. The only optional network calls are the embedding provider calls you configure yourself (small vector requests, never your full source), and those exist only if you set up an API key. There is no Backbencher cloud. The privacy policy (/privacy) states exactly what stays on your machine and what leaves it.",
  },
  {
    q: "Is Backbencher open source?",
    section: "The product",
    a: "Not right now. The engine is being prepared for a future release; today it ships as installable binaries. We prefer to say that plainly rather than dress it up — honesty about the product is the same discipline we apply to the tool's own output.",
  },
  {
    q: "How much does it cost?",
    section: "The product",
    a: "Backbencher is free to use. The only optional cost is your own embedding provider's API usage if you choose a paid provider; free-tier providers work too.",
  },
  {
    q: "Does the indexer skip `node_modules`, build output, and other junk?",
    section: "Indexing",
    a: "Yes — by default, on three layers: 1. Built-in directory skips (always on): .git, node_modules, dist, build, out, coverage, .next, target, vendor, __pycache__, .venv, venv. 2. Your .gitignore is respected: anything git ignores, the indexer skips. 3. Your .bbignore (optional): a project-local file using gitignore syntax that overrides .gitignore with higher priority. Use it when you want git to track something but the indexer to skip it (e.g., large generated fixtures). You never need to configure anything for the common case. If you notice an unexpected directory in your index, add it to .bbignore at the project root and re-run bb index --changed (or a full bb index for a clean rebuild).",
  },
  {
    q: "How big can files be?",
    section: "Indexing",
    a: "Very large files are skipped by size tiers to protect memory and index quality (for example, YAML files over 1 MB are skipped by default). This prevents one generated blob from stalling an index run. If a file you care about is skipped for size, tell us — the tiers are tuned, not hardcoded dogma.",
  },
  {
    q: "How long does indexing take?",
    section: "Indexing",
    a: "- First index parses every discovered file and runs the derived-data phases (relationships, enrichment, patterns, taints, health). This is the expensive pass. - Re-index of an unchanged project is fast: files whose size + modification time are unchanged are not re-parsed at all (the run summary reports them as unchanged). - A live progress line shows files discovered and processed; bb stats shows committed index counts and bb status shows the last run's per-phase state, both after the run.",
  },
  {
    q: "Why do I need an embedding API key? Can I use Backbencher without one?",
    section: "Indexing",
    a: "You can use everything except high-quality semantic search without a key. Embeddings power bb_ask semantic mode — finding conceptually related code. Without a key, the indexer still works and semantic search falls back to weaker local vectors, and the CLI tells you so. Configure a provider with bb setup; the key is stored with owner-only permissions and never sent to any AI agent.",
  },
  {
    q: "I changed one line in one file. What happens?",
    section: "Re-indexing after changes",
    a: "Three mechanisms, in order of how you'll normally meet them: 1. Automatic (read paths): when a read tool (bb search, MCP bb_search, etc.) touches files that are stale or missing in the index, it auto-refreshes exactly those files within a budget before answering, and says so in an auto-refreshed N files in Xms line. Budgets are tunable via BB_AUTO_REFRESH_MAX_FILES / BB_AUTO_REFRESH_MAX_BYTES, and opt-out is BB_NO_AUTO_REFRESH=1 (or refresh=false on the MCP tool). If the repair exceeds the budget or another index run holds the lock, the tool answers honestly from existing data with a staleness footer instead of pretending. 2. Explicit and bounded: bb index --changed re-parses only files changed since the last index and runs the derived-data pass for the touched files, keeping relationships current. This is the routine \"I edited stuff, sync my index\" command. 3. Single file: bb index --file <path> re-indexes one file's symbols + relationships. Ideal right after an AI agent creates/edits a function and you want the DB to know immediately. If derived data got deferred or went stale (e.g., after --skip-post-processing), bb index --post re-runs the derived phases without re-parsing anything.",
  },
  {
    q: "Do symbols, relationships, and embeddings get recomputed for everything again?",
    section: "Re-indexing after changes",
    a: "No — only what the changed files touch. Here is exactly what an incremental run (bb index --changed, --file, or auto-refresh) updates, verified in code: - Symbols — changed files are re-parsed by the same analyzers and their symbol rows rewritten. Unchanged files are not touched. - Relationships — three mechanisms: the re-parsed file's own edges resolve at insert time; cross-file edges from other files pointing into the changed file are repaired; unresolved external targets are re-resolved scoped to the touched symbols. - Enrichment — re-run scoped to the touched source symbols. - Gravity scores — recomputed for touched symbols plus any symbol whose in-degree changed because of the edit. - Taint flows — resolution re-processes only unresolved flows. - Health — full recompute (cheap SQL aggregates). - Deleted files — purged from the index, including their derived rows. - Embeddings — new and changed symbols are queued for the embedding provider automatically during storage; vectors populate asynchronously with a local fallback if the provider is unavailable. The run summary labels this pass derivedPass: bounded so you can see it ran; if any derived phase fails, the index status becomes partial (visible, never silent). Two honest edges: (1) embeddings are asynchronous — immediately after an edit the new vectors may still be in flight, so semantic search may lag a few seconds behind symbol/relationship freshness; (2) on very large batches the embedding queue has a documented capacity cap (oversized batches are dropped with honest metrics and recoverable via bb index --force) — a normal edit-flow never hits it. Only a full rebuild (bb index --force) recomputes everything from scratch — you should almost never need it.",
  },
  {
    q: "My agent created a function seconds ago — will the DB know?",
    section: "Re-indexing after changes",
    a: "Reads auto-refresh stale/missing files on the fly (mechanism 1 above), so a fresh edit is typically picked up on the next query without you doing anything. For guaranteed freshness on a specific file, bb index --file <path> is instant and scoped.",
  },
  {
    q: "How do I keep the index up to date?",
    section: "Re-indexing after changes",
    a: "The agent tools reindex files they edit (bb_index). For manual workflows: bb index --changed reindexes only changed files, bb index --post re-runs derived phases without re-parsing, and bb status shows what the last run did. Search results carry a freshness block that names the exact remediation command when data is stale.",
  },
  {
    q: "The indexer was interrupted (power cut, Ctrl+C). Do I start over?",
    section: "Re-indexing after changes",
    a: "No. Progress is checkpointed. Resume with: bb index --resume It continues incrementally — only missing/changed files are processed, then the bounded derived-data pass runs.",
  },
  {
    q: "Where does bb store my index?",
    section: "Updates, uninstalling, and your data",
    a: "One directory, keyed per project: ~/.bb/projects/<project-id>/brain.db ← the index (symbols, relationships, embeddings) ~/.bb/wasm/ ← parser cache <project-id> is a stable hash of the project's absolute path. Override the whole location with the BB_DATA_DIR environment variable — recommended on machines where the home directory isn't reliably writable/persistent (sandboxes, CI).",
  },
  {
    q: "If the bb version is updated, is my index history erased?",
    section: "Updates, uninstalling, and your data",
    a: "No. The index lives in ~/.bb, completely separate from the installed program. On every open, the database runs idempotent schema migrations, so an upgraded bb either uses the existing index as-is or upgrades it in place — without wiping anything. Newer versions may add derived indexes transparently on first open (that's automatic and one-time).",
  },
  {
    q: "If I uninstall and reinstall bb, do I lose everything?",
    section: "Updates, uninstalling, and your data",
    a: "No. Uninstalling removes the program, not ~/.bb. Reinstall and your indexes, embeddings, and history are exactly where you left them. You start from zero only if the project moved to a different absolute path (the project id is path-derived). Two answers for that: - bb index --import <path-to-old-brain.db> — adopts (re-homes) an existing index for the project at the current location. - Index portability (moving a database between laptops) is supported via the codebase-fingerprint adoption flow; if the fingerprint matches, the index is re-homed automatically on the next index run.",
  },
  {
    q: "How do I see and reclaim disk space used by indexes?",
    section: "Updates, uninstalling, and your data",
    a: "bb projects # every indexed project, with size — sort by size or time bb projects --remove <id> # removes one project's DB + embeddings, reclaiming space bb stats # committed index counts for the current project",
  },
  {
    q: "Which MCP clients work with Backbencher?",
    section: "MCP / agent integration",
    a: "Any client that speaks MCP over stdio: Claude Code, Cursor, VS Code, opencode, and others. Run bb mcp to start the server and point your client's MCP configuration at it — see the MCP server docs (/docs#mcp). The 16 bb tools (all prefixed bb_) then appear in your client's tool list.",
  },
  {
    q: "What is the difference between the CLI commands and the agent tools?",
    section: "MCP / agent integration",
    a: "The CLI (bb index, bb stats, bb doctor, …) is what you run in a terminal. The 16 MCP tools (bb_search, bb_edit, …) are what your agent calls. Tool names are not shell subcommands — run them via bb tool <name> if you want to invoke one manually. The full command and flag reference is in the docs (/docs#cli-reference).",
  },
  {
    q: "Which tools does the MCP server expose?",
    section: "MCP / agent integration",
    a: "The server exposes the sixteen public tools: bb_search, bb_ask, bb_analyze, bb_graph, bb_impact, bb_patterns, bb_security, bb_doc, bb_visualize, bb_migrate, bb_edit, bb_index, bb_cross_language, bb_health, bb_annotate, bb_annotations. The docs table is generated from the same registry the server reads, so what you see here is what your client lists.",
  },
  {
    q: "The tools feel slow on big repos — is that expected?",
    section: "MCP / agent integration",
    a: "Read tools were re-verified to answer from committed indexes in milliseconds (warm bb_health on a 2,681-file / ~159k-symbol repo measures in the tens of milliseconds). The deep checks (--integrity, complete freshness scans) are opt-in and slower by design — the default path never pays for them.",
  },
]

export const SUPPORT_CHANNELS = [
  {
    "title": "Support",
    "body": "Questions about install, setup, or usage. Include the output of bb health and bb stats for the fastest answer.",
    "email": "support@backbencher.cc"
  },
  {
    "title": "Bug reports",
    "body": "Something broke or a result looks wrong? Email us with the command you ran, what you expected, and what happened.",
    "email": "support@backbencher.cc"
  },
  {
    "title": "Feedback",
    "body": "Feature requests, workflow ideas, and honest criticism are all welcome — they shape the roadmap.",
    "email": "support@backbencher.cc"
  },
  {
    "title": "General & press",
    "body": "Partnerships, licensing, the website, or anything that is not a support question.",
    "email": "info@backbencher.cc"
  }
]

export const SUPPORT_SOURCE = "website/faq.md"
