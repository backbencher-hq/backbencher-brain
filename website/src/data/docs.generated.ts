// GENERATED FILE — do not edit by hand.
// npx tsx script/m56/generate-docs-data.ts --write
//
// Sources (all machine-read; see script/m56/generate-docs-data.ts):
//   - the real CLI help (run from source via script/m56/cli-probe.ts)
//   - src/cli/index.ts (.command/.option declarations — parity instrument)
//   - src/ast/parallel-indexer.ts (skip dirs, size tiers, derived phases, derivedPass)
//   - src/ast/auto-refresh.ts (auto-refresh budgets and the env allowlist)
//   - src/util/bb-data-dir.ts (storage shape, proven with a temp BB_DATA_DIR)
//
// Verified byte-for-byte by script/m56/verify-docs-completeness.ts.

export const DOCS_FACTS = {
  "schemaVersion": 1,
  "generatedBy": "npx tsx script/m56/generate-docs-data.ts --write",
  "generatedFrom": [
    "the real CLI help (run from source via script/m56/cli-probe.ts)",
    "src/cli/index.ts (.command/.option declarations — parity instrument)",
    "src/ast/parallel-indexer.ts (skip dirs, size tiers, derived phases, derivedPass)",
    "src/ast/auto-refresh.ts (auto-refresh budgets and the env allowlist)",
    "src/util/bb-data-dir.ts (storage shape, proven with a temp BB_DATA_DIR)"
  ],
  "indexing": {
    "skipDirs": [
      ".git",
      "node_modules",
      "dist",
      "build",
      "out",
      "coverage",
      ".next",
      "target",
      "__pycache__",
      ".venv",
      "venv"
    ],
    "structuralExtensions": [
      ".json",
      ".yaml",
      ".yml",
      ".toml",
      ".xml",
      ".xsd",
      ".dtd",
      ".md",
      ".proto"
    ],
    "fullAstBytes": 1048576,
    "structuralBytes": 5242880,
    "walkSizeLimit": 5242880,
    "defaultMaxFileBytes": 1048576,
    "structuralFormatsNote": ".json, .yaml, .yml, .toml, .xml, .xsd, .dtd, .md, .proto",
    "ignoreFiles": [
      ".gitignore",
      ".bbignore"
    ]
  },
  "freshness": {
    "autoRefresh": {
      "maxFiles": 25,
      "maxBytes": 2097152
    },
    "env": [
      "BB_NO_AUTO_REFRESH",
      "BB_AUTO_REFRESH_MAX_FILES",
      "BB_AUTO_REFRESH_MAX_BYTES"
    ],
    "derivedPhases": [
      "relationships",
      "enrichment",
      "gravity",
      "taint",
      "health",
      "analyze"
    ],
    "extraPhases": [
      "integrity"
    ],
    "derivedPassLabels": [
      "full",
      "bounded",
      "deferred",
      "skipped-unchanged"
    ]
  },
  "storage": {
    "dataDir": "~/.bb",
    "envOverride": "BB_DATA_DIR",
    "indexFile": "<data-dir>/projects/<project-id>/brain.db",
    "parserCache": "<data-dir>/wasm",
    "projectIdNote": "sha1 of the project's absolute path"
  },
  "cli": {
    "summary": "Backbencher Brain — evidence is the answer · code intelligence for 50 languages",
    "globalFlags": [
      {
        "flags": [
          "-v",
          "--version"
        ],
        "argument": null,
        "description": "output the version number"
      },
      {
        "flags": [
          "--verbose"
        ],
        "argument": null,
        "description": "show diagnostics (debug logs, per-file worker/WASM lines)"
      },
      {
        "flags": [
          "--quiet"
        ],
        "argument": null,
        "description": "suppress informational output (warnings/errors only)"
      }
    ],
    "commands": [
      {
        "name": "help",
        "usage": "bb help [options] [command...]",
        "summary": "display help for a command, or list all commands",
        "args": [
          {
            "name": "command",
            "description": "command to describe; include a subcommand for `bb help <cmd> <sub>` (omit for the command list)"
          }
        ],
        "flags": [],
        "subcommands": [],
        "examples": []
      },
      {
        "name": "tool",
        "usage": "bb tool [options] <name> [unexpected...]",
        "summary": "run one of the public tools with JSON arguments",
        "args": [
          {
            "name": "name",
            "description": "public tool name, e.g. bb_search or bb_doc"
          },
          {
            "name": "unexpected",
            "description": "rejected: tool arguments are passed with --args '<json>' so a stray positional is an error, not a silent no-op"
          }
        ],
        "flags": [
          {
            "flags": [
              "--dir"
            ],
            "argument": "dir",
            "description": "project directory (default: cwd)"
          },
          {
            "flags": [
              "--args"
            ],
            "argument": "json",
            "description": "tool arguments as a JSON object (default: \"{}\")"
          }
        ],
        "subcommands": [],
        "examples": []
      },
      {
        "name": "index",
        "usage": "bb index [options] [dir]",
        "summary": "index a project (default: current directory)",
        "args": [
          {
            "name": "dir",
            "description": "project directory (default: current directory)"
          }
        ],
        "flags": [
          {
            "flags": [
              "--force"
            ],
            "argument": null,
            "description": "wipe the existing index and rebuild"
          },
          {
            "flags": [
              "--no-setup"
            ],
            "argument": null,
            "description": "skip the first-run embedding setup prompt"
          },
          {
            "flags": [
              "--skip-post-processing"
            ],
            "argument": null,
            "description": "parse + store only; SKIP relationship resolution/enrichment/gravity/taint/health (derived data goes stale until: bb index --post)"
          },
          {
            "flags": [
              "--post"
            ],
            "argument": null,
            "description": "re-run relationship/enrichment/gravity/taint/health phases only — no re-parse (remediation for stale derived data after --changed/--resume/agent edits)"
          },
          {
            "flags": [
              "--file"
            ],
            "argument": "path",
            "description": "reindex a single file's symbols + relationships, relative to <dir> or absolute and must be inside the project (runs a scoped derived-data pass for that file; refuses a missing/outside path)"
          },
          {
            "flags": [
              "--changed"
            ],
            "argument": null,
            "description": "reindex only files changed since the last index (runs the bounded derived-data pass for touched files — relationships stay current)"
          },
          {
            "flags": [
              "--resume"
            ],
            "argument": null,
            "description": "continue from an interrupted run's checkpoint (incremental: only missing/changed files; runs the bounded derived-data pass)"
          },
          {
            "flags": [
              "--import"
            ],
            "argument": "db",
            "description": "adopt an existing brain.db file (re-home a moved project's index)"
          },
          {
            "flags": [
              "--exclude"
            ],
            "argument": "globs",
            "description": "skip files matching comma-separated globs during discovery (repeatable); NON-DESTRUCTIVE: files already indexed by an earlier run keep their rows (default: [])"
          },
          {
            "flags": [
              "--concurrency"
            ],
            "argument": "n",
            "description": "worker count for this run (1-64; default max(2, min(cpus-1, 12)))"
          }
        ],
        "subcommands": [],
        "examples": [
          "bb index                 # index the current directory",
          "bb index ../my-project   # index another directory",
          "bb index --changed       # reindex only changed files",
          "bb index --resume        # continue an interrupted run from its checkpoint",
          "bb index --file src/a.ts # reindex a single file",
          "bb index --post          # re-run derived phases only (no re-parse)",
          "bb index --force         # wipe and rebuild in place",
          "bb index import --db <path>  # adopt an existing DB for a moved project"
        ]
      },
      {
        "name": "setup",
        "usage": "bb setup [options] [command]",
        "summary": "embedding provider setup (API key, model)",
        "args": [],
        "flags": [],
        "subcommands": [
          {
            "name": "show",
            "summary": "show the embedding configuration (key as fingerprint only)"
          }
        ],
        "examples": []
      },
      {
        "name": "doctor",
        "usage": "bb doctor [options]",
        "summary": "diagnose embedding setup and index consistency (read-only)",
        "args": [],
        "flags": [
          {
            "flags": [
              "--dir"
            ],
            "argument": "dir",
            "description": "project directory (default: cwd)"
          },
          {
            "flags": [
              "--fix"
            ],
            "argument": null,
            "description": "repair permission problems (0600 only; this IS the explicit apply — without it doctor is read-only)"
          }
        ],
        "subcommands": [],
        "examples": []
      },
      {
        "name": "upgrade",
        "usage": "bb upgrade [options]",
        "summary": "check for a newer bb and report exactly how to install it",
        "args": [],
        "flags": [
          {
            "flags": [
              "--check"
            ],
            "argument": null,
            "description": "only report whether a newer version exists; change nothing"
          },
          {
            "flags": [
              "--to"
            ],
            "argument": "dist-tag-or-range",
            "description": "npm dist-tag or version range to compare against (default: latest)"
          }
        ],
        "subcommands": [],
        "examples": []
      },
      {
        "name": "stats",
        "usage": "bb stats [options] [dir]",
        "summary": "query index counts anytime: files/symbols/relationships/embeddings (default:",
        "args": [
          {
            "name": "dir",
            "description": "project directory (default: current directory)"
          }
        ],
        "flags": [
          {
            "flags": [
              "--json"
            ],
            "argument": null,
            "description": "machine-readable JSON output (stable keys for scripts)"
          }
        ],
        "subcommands": [],
        "examples": []
      },
      {
        "name": "status",
        "usage": "bb status [options] [dir]",
        "summary": "show in-flight/last-run index state and per-phase timings (default: cwd)",
        "args": [
          {
            "name": "dir",
            "description": "project directory (default: current directory)"
          }
        ],
        "flags": [
          {
            "flags": [
              "--json"
            ],
            "argument": null,
            "description": "machine-readable JSON output (stable keys for scripts)"
          }
        ],
        "subcommands": [],
        "examples": []
      },
      {
        "name": "projects",
        "usage": "bb projects [options]",
        "summary": "list every indexed project: DB path, size, counts, last index (default: all",
        "args": [],
        "flags": [
          {
            "flags": [
              "--sort"
            ],
            "argument": "field",
            "description": "sort by name|size|time (default: \"name\")"
          },
          {
            "flags": [
              "--remove"
            ],
            "argument": "id",
            "description": "remove one indexed project by id (reclaims its DB + embeddings)"
          },
          {
            "flags": [
              "--force"
            ],
            "argument": null,
            "description": "remove even if that project is currently being indexed"
          },
          {
            "flags": [
              "--json"
            ],
            "argument": null,
            "description": "machine-readable JSON output for the project list (stable keys for scripts)"
          }
        ],
        "subcommands": [],
        "examples": [
          "bb projects                # list all indexed projects with DB path + size",
          "bb projects --sort size    # biggest indexes first",
          "bb projects --remove 1a2b3c4d   # reclaim that project's index space"
        ]
      },
      {
        "name": "search",
        "usage": "bb search [options] [query]",
        "summary": "search the index (modes: symbols [default], content, symbol, file — parity with",
        "args": [
          {
            "name": "query",
            "description": "query text; in file mode, the file path to print (omit when --symbol-name or --file-path is given)"
          }
        ],
        "flags": [
          {
            "flags": [
              "--mode"
            ],
            "argument": "mode",
            "description": "retrieval mode: symbols (default), content, symbol, or file"
          },
          {
            "flags": [
              "--file-path"
            ],
            "argument": "path",
            "description": "file target for --mode file (overrides the positional query)"
          },
          {
            "flags": [
              "--symbol-name"
            ],
            "argument": "name",
            "description": "exact symbol name for --mode symbol (overrides the positional query)"
          },
          {
            "flags": [
              "--dir"
            ],
            "argument": "dir",
            "description": "project directory (default: cwd)"
          },
          {
            "flags": [
              "--limit"
            ],
            "argument": "n",
            "description": "max results (default: \"15\")"
          },
          {
            "flags": [
              "--language"
            ],
            "argument": "lang",
            "description": "filter by language"
          },
          {
            "flags": [
              "--no-auto-refresh"
            ],
            "argument": null,
            "description": "answer from the existing index with the staleness footer instead of auto-refreshing stale files within budget"
          }
        ],
        "subcommands": [],
        "examples": [
          "bb search handleRequest                 # symbol listing (default)",
          "bb search --mode content \"findUser(\"    # content matches with snippets",
          "bb search --mode symbol --symbol-name handleRequest",
          "bb search --mode file src/app.ts        # print an indexed file's content",
          "bb search --no-auto-refresh query      # never auto-refresh on read"
        ]
      },
      {
        "name": "health",
        "usage": "bb health [options] [dir]",
        "summary": "index health and freshness",
        "args": [
          {
            "name": "dir",
            "description": "project directory (default: cwd)"
          }
        ],
        "flags": [
          {
            "flags": [
              "--refresh"
            ],
            "argument": null,
            "description": "reindex the project before reporting"
          },
          {
            "flags": [
              "--force"
            ],
            "argument": null,
            "description": "force a full in-place reindex (implies --refresh)"
          },
          {
            "flags": [
              "--no-wait"
            ],
            "argument": null,
            "description": "do not wait for the refresh to finish"
          },
          {
            "flags": [
              "--complete"
            ],
            "argument": null,
            "description": "check freshness for all files (not just a sample)"
          },
          {
            "flags": [
              "--integrity"
            ],
            "argument": null,
            "description": "run the 12-point index integrity check"
          },
          {
            "flags": [
              "--sample-size"
            ],
            "argument": "n",
            "description": "freshness sample size (default: 200) (default: \"200\")"
          },
          {
            "flags": [
              "--verbose-config"
            ],
            "argument": null,
            "description": "show effective embedding config + per-field source (M40.A8)"
          }
        ],
        "subcommands": [],
        "examples": []
      },
      {
        "name": "onboard",
        "usage": "bb onboard [options] [dir]",
        "summary": "write the bb tools guidance section into <dir>/AGENTS.md (generated from the",
        "args": [
          {
            "name": "dir",
            "description": "project directory (default: current directory)"
          }
        ],
        "flags": [
          {
            "flags": [
              "--check"
            ],
            "argument": null,
            "description": "report drift/ghost tool names without writing (exit 1 when not current)"
          },
          {
            "flags": [
              "--print"
            ],
            "argument": null,
            "description": "print the generated section to stdout without writing"
          },
          {
            "flags": [
              "--file"
            ],
            "argument": "path",
            "description": "guide file to write (default: <dir>/AGENTS.md)"
          }
        ],
        "subcommands": [],
        "examples": [
          "bb onboard                # write/refresh AGENTS.md in the current project",
          "bb onboard ../my-project  # same for another directory",
          "bb onboard --check        # CI: fail when the guidance drifted or names a ghost tool",
          "bb onboard --print        # show the generated section"
        ]
      },
      {
        "name": "mcp",
        "usage": "bb mcp [options]",
        "summary": "start the MCP server over stdio (for Claude Code, Cursor, VS Code…)",
        "args": [],
        "flags": [
          {
            "flags": [
              "--dir"
            ],
            "argument": "dir",
            "description": "default project directory (default: cwd)"
          }
        ],
        "subcommands": [],
        "examples": []
      },
      {
        "name": "version",
        "usage": "bb version [options]",
        "summary": "print the bb version",
        "args": [],
        "flags": [],
        "subcommands": [],
        "examples": []
      }
    ]
  }
} as const

export type DocsFacts = typeof DOCS_FACTS
