# OPS — build, dist integrity, and MCP restart protocol (P2-7)

Owner: verifier/build-coordinator lane. Applies to `dist/` (the packaged build) and to every
long-lived process that loads it (MCP servers, editor extensions, `bb mcp` daemons, CLI runs).

## Why this exists

`tsup` builds `dist/` with `clean: true` and splits the bundle into **top-level hashed chunk files**
(`dist/chunk-XXXXXXXX.js`, `dist/database-HE6EE3VA.js`, …). Every dist file imports its neighbours by
relative `./<chunk>.js` path. Two failure classes follow from that:

1. **Mixed / stale dist** — an interrupted or *concurrent* build writes build N+1's files on top of
   build N's chunk directory (or vice versa). The bundle then references a chunk that does not exist:
   `Cannot find module .../dist/database-HE6EE3VA.js` at RUNTIME, mid-phase.
2. **Stale process** — a running MCP server resolves chunks lazily. If `dist/` is rebuilt under it,
   a later lazy `import()` may request a chunk name from the old graph that the new build no longer
   writes. The server fails mid-session even though `dist/` on disk is internally consistent.

The package must be self-consistent at rest **and** the process must be restarted after a rebuild.

## Build protocol (single builder — one build at a time)

```bash
# 0. Only ONE builder at a time. Never run a build while another build is in flight.
#    Never build under a running MCP server you do not intend to restart.
npm run build                                        # tsup (clean:true) — wipes and rewrites dist/
npm run verify:dist                                  # script/verify-dist-integrity.ts — clean check
node_modules/.bin/tsx script/verify-dist-integrity.ts --self-test   # prove the detector works
# Optional: record the shipped surface for comparison/rollback
find dist -name '*.js' -print0 | sort -z | xargs -0 sha256sum | sha256sum
```

- `npm run build` **exit 0** and `npm run verify:dist` **exit 0** are both required; a build that
  "succeeded" but leaves a dangling chunk is still broken.
- `prepublishOnly` and `prepack` already run the clean check **and** the self-test, so a broken dist
  cannot be packed. `--self-test` corrupts only a COPY under `.tools/verify-dist-integrity-selftest/`;
  the real `dist/` is never touched by verification.
- Do **not** hand-copy chunk files between builds, do not delete chunks from `dist/`, and do not try to
  "fix" a mixed dist by copying a chunk from another build — rebuild once with a single builder.

## MCP / editor restart protocol (after EVERY rebuild)

`bb mcp` (and any editor-hosted MCP integration) is a long-lived stdio process that loaded the
previous `dist/`. Treat a rebuild as invalidating every running process that loads `dist/`:

1. Stop the running MCP server(s) / reload the editor window so the process exits.
   - Editor-hosted MCP: reload the window / restart the extension host (the MCP client process).
   - Standalone `bb mcp`: stop the process (Ctrl-C / service manager stop).
2. Rebuild **once** and verify: `npm run build && npm run verify:dist`
   (add `--self-test` on release/packaging builds; `prepublishOnly`/`prepack` run it automatically).
3. Start the MCP server(s) again (restart the editor / start `bb mcp`).
4. Smoke-check the running surface if anything looks stale: `node bin/bb --version`,
   `node bin/bb tool bb_health --dir <project>` (or your editor's MCP tool list), then the tool call
   that failed.
5. CLI invocations (`node bin/bb tool …`) need **no** restart: each invocation is a fresh process.
   Gates/verifiers run source-level via `npm run typecheck` / `npx tsx` and do not use `dist/`.

## Symptom → action

| symptom | meaning | action |
|---|---|---|
| `Cannot find module '.../dist/<chunk>.js'` mid-phase (MCP server or long-running process) | stale process after a rebuild, or mixed dist on disk | restart the process; then run `npm run verify:dist`; if that fails, rebuild once (single builder) |
| `ERR_MODULE_NOT_FOUND` in `./chunk-*.js` from `node bin/bb …` (fresh CLI process) | `dist/` itself is inconsistent (interrupted/concurrent build) | rebuild once, `npm run verify:dist`, then retry |
| `--self-test` fails | the detector no longer detects a corrupted copy — verification environment broken | do not publish; investigate `script/verify-dist-integrity.ts` / node_modules before rebuilding |
| two builds racing | mixed dist by construction | kill one, rebuild once; enforce single-builder rule |

## Enforcement points

- `npm run verify:dist` — clean chunk-graph check (`script/verify-dist-integrity.ts`).
- `prepublishOnly`: `npm run build && npm run verify:dist && … --self-test`.
- `prepack`: `npm run typecheck && npm run build && verify-dist-integrity && … --self-test`.
- Campaign gate P2-7 (evidence `docs/bb-bettercap-fix/evidence/verifier/p2/`): clean dist passes, a
  deliberately corrupted COPY under `.tools/` exits 1 naming the missing chunk (the
  `database-HE6EE3VA.js` class), and the self-test proves all three corruption classes are caught.

## Build-coordinator rule (fix campaign)

Only the build coordinator (or the Lead) runs `npm run build`. Lanes run source-level gates
(`npx tsx` / `bun`) and **never** build concurrently: concurrent builds are the documented cause of the
mixed-dist class above. When a lane's change must be seen through `dist/` (bettercap symptom runs,
packaging), the coordinator builds once on the frozen tree, verifies, records the manifest, and states
the restart requirement in the same report.
