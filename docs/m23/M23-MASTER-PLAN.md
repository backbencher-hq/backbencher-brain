# M23 — Index Portability, Project Registry & Space Management

**Status:** proposed; no production claim.
**Purpose:** solve the user-reported gaps around *where indexes live and how they travel*:

1. Users don't know where a project's indexed database is, how to remove it, or
   that many indexed projects are consuming disk (verified on this machine:
   `~/.bb/projects` = **16 GB / 1,178 project dirs** with **no list, no size, no
   removal** surface — the CLI has only `version/tool/index/stats/status/search/
   health/mcp`).
2. Portability is broken by design: project id = `sha1(realpath)`. Moving a
   project changes the realpath → a different id → the old DB is orphaned and
   `bb index` silently starts from zero. Users who copy an index to another
   laptop hit exactly this.
3. A moved/shared codebase can be queried by a `bb` that doesn't know the
   checkout changed — the binding must be explicit and stale-checked.

## Authority and evidence policy

Same as M22: every issue produces a persisted evidence file (command/commit,
positive+negative checks, real or controlled fixture), no auto-pass/tautology,
Missing measurements never zero, known-gap stays open. The governance gate is
mirrored from M22.G1 (validated against the M23 ledger).

## Verified baseline (measured / code-verified, not assumed)

- CLI surface: only `version tool index stats status search health mcp` — **no `projects`, no removal, no import/rebind, no DB-path display** (grep of
  `src/cli/index.ts`).
- Project identity: `getProjectId` = `sha1(realpathSync(path))` with a legacy→
  canonical rename migration for *symlink* differences only. A **move** (new
  realpath) is a new id → orphaned DB + reindex from zero.
- On-disk layout: `~/.bb/{projects,status,wasm}`; `brain.db` per project id;
  `brain_file.path` stores absolute paths (usable as a move-stable fingerprint
  via *relative* paths).
- Removal safety: deleting/recreating a `brain.db` file orphans a running MCP
  server's open handle (documented in `cmdIndex --force` in-place-wipe comment),
  so removal must warn on in-flight/live handles and prefer in-place wipe.

## Issue families

- **G — governance:** M23 ledger, evidence schema, fail-closed closure gate
  (mirrors M22.G1).
- **P — project registry & space:**
  - **P1:** `bb projects` — list every indexed project: human path (from a
    stored path or file sample), DB path, DB size, symbols/files, last-indexed.
    Also print the data dir total. `bb status`/`bb stats` additionally print the
    DB path (kills "we don't know where the index lives").
  - **P2:** safe removal — `bb projects --remove <id>` (in-place wipe or delete
    with clear warning + `--force` when a live status file shows an in-flight
    run). Verify DB gone, MCP-open caveat documented, no accidental data loss.
  - **P3:** portability/rebind — store a **codebase fingerprint** (sha1 over
    sorted *relative* file paths, optionally git remote+HEAD when present) in
    the project DB; on `bb index` at a path whose id has no DB, scan
    `~/.bb/projects` for a DB whose fingerprint matches this checkout and
    **adopt it** (rebind) instead of reindexing from zero; plus explicit
    `bb index import --db <path>` for manual binding. A stale binding (file set
    changed vs stored fingerprint) warns, never silently serves wrong data.
  - **P4 (folded into P1):** DB-path visibility everywhere.

## Closure requirements

M23 cannot close until: `bb projects` lists every indexed project with DB path
+ size; `bb status`/`bb stats` print the DB path; removal works with safety
warnings and is verified; a moved project reuses its existing DB (fingerprint
adopt or explicit import) instead of reindexing from zero — verified by moving a
real fixture — and a stale binding warns instead of silently serving; the final
gate passes from a clean source state with only intended M23 files staged.

## Required resources

- `~/.bb/projects` (this machine: 16 GB / 1,178 dirs) — read-only inspection.
- Controlled fixtures (temp projects) for move/rebind/removal; optionally a real
  repo from `$HOME/fixtures/repositories` for the portability test.
