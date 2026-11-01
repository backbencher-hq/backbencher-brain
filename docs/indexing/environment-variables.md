# Environment variables that change indexing

This page documents the `BB_*` knobs read by the indexer and by the language analyzers that the other
indexing pages do not cover. Precedence, defaults and the embedding resolver are documented in
`docs/indexing/embeddings.md`; worker/queue variables are in `docs/indexing/troubleshooting.md`; the
resume/checkpoint variables are in `docs/indexing/resume.md`. Everything here is read by `src/`.

There are three classes, and the class matters more than the name:

1. **Operational knobs** — safe to set; they change cost/latency, not what the index claims.
2. **Test-only injection** — only a gate sets these; they deliberately corrupt or freeze a run to prove
   the failure path. Never export them in a shell that indexes a real project.
3. **Analyzer claim flags** — default OFF and **byte-identical when off**. Each flag enables one
   metadata claim inside one language analyzer; its lane's gate verifies the claim. Turning a flag on
   without that gate's evidence is how a claim ships unverified.

## Operational knobs

| Variable | Default | What it does |
| --- | --- | --- |
| `BB_DB_FLUSH_CHUNK` | `20` | Files per store-batch flush during indexing. Lowering it (e.g. `4`) bounds how long one store block can hold the event loop, at the cost of more commits; raising it amortizes commit overhead. This is a throughput/latency knob, not a correctness one. |
| `BB_EMBEDDING_DRAIN_WAIT_MS` | `300000` | How long `bb index` waits for the background embedding queue after the index itself is complete. The wait is announced before it starts; on timeout the remaining queue count is reported and semantic search is declared partial for those symbols. Raise it for slow providers, lower it for CI. |
| `BB_INDEX_VACUUM` | unset | `=0` disables the post-wipe `VACUUM` that `reclaimSpace` runs after a `--force` reindex. The index is correct either way; the file keeps the pages the wipe freed. Useful when a very large `--force` must finish quickly on a disk with room to spare. |
| `BB_DEBUG_DOTTED` | unset | `=1` prints the error when `resolveDottedTargets` (dotted import-path resolution) fails. Off by design: a dotted import that cannot be resolved is a data limitation, not a crash, and must not spam every run. |
| `BB_INDEX_CONCURRENCY` | unset | Worker count for the parse pool, overriding the built-in plateau `max(2, min(cpus - 1, 12))`. Bounded 1–64; the CLI's `bb index --concurrency <n>` sets the same number for one run. Lower it to keep a machine responsive, raise it only when the index is truly CPU-bound. |

## Test-only injection (gates only)

These exist so the failure paths are exercised on purpose. They are not production features.

| Variable | Used by | What it does |
| --- | --- | --- |
| `BB_TEST_FAIL_STORE_ONCE` | `script/perf/verify-store-failure-honesty.ts` | Makes the FIRST store batch throw. Proves a rolled-back batch is recovered, counted, and reported as an incomplete index rather than as a clean run. |
| `BB_TEST_FAIL_STORE_ALWAYS` | `script/perf/verify-store-failure-honesty.ts` | Makes EVERY store batch throw — the full-disk case. Proves the run exits non-zero and never claims `complete`. |
| `BB_TEST_FORCE_EDGE_RESOLVE` | edge-resolution A/B probes | Forces the legacy per-edge resolution arm of the bounded derived pass, for comparison against the current decider path. Changes derived rows by design; measurement only. |
| `BB_TEST_SKIP_EDGE_RESOLVE` | edge-resolution A/B probes | Skips the bounded edge-resolution pass entirely, for measurement. The index is left with unresolved edges it would otherwise re-point; never use it for an index you intend to query. |

Test-only variables are often read alongside `BB_TEST_HOOKS=1` (the umbrella switch documented in
`docs/indexing/troubleshooting.md`); a run with `BB_TEST_HOOKS=1` exported can take diagnostic
short-circuits inside MCP tool handlers and the worker fixtures.

## Analyzer claim flags (default OFF, byte-identical when off)

Each of these enables one **metadata claim** in one language analyzer. The analyzer's accepted output
(the lane's D1–D6 verdict) was measured with the flag off, so off means "no change of any kind". With
the flag on, the analyzer attaches declaration facts it can verify — never a new or suppressed row —
and the lane's gate is responsible for checking the claim.

| Variable | Analyzer | Claim it enables |
| --- | --- | --- |
| `BB_CPP_CITATION` | C++ | `metadata.languageNamespace` (+ strict-absent policy) on calls whose bare target is an exact committed standard-library root. |
| `BB_CPP_PACKAGE_SCOPE` | C++ | Package-scope claims for qualified spellings, but ONLY when the caller supplies the governing manifest's package names in `context.cppPackageScopePackages`; with no package list it emits nothing. |
| `BB_CPP_INDEX_CONSUME` | C++ | Consumes the project index's declaration facts (call provenance, heritage kind, inheritance-closed declaring base for overrides) onto rows the analyzer already emits. Requires an index whose `complete` flag is strictly true; metadata only, never a row change. |
| `BB_DART_CITATION` | Dart | Namespace citation claims on rows whose bare target is an exact committed Dart SDK core-vocabulary name (`languageNamespace` + `"strict-absent"` policy on annotation rows and capitalized type-shaped targets). |
| `BB_KOTLIN_IMPORT_CLAIM` | Kotlin | Imported-binding claims derived from Kotlin import declarations. |
| `BB_PY_OWNER_MEMBER_ABSENT` | Python | Owner-member absence claims; fail-closed — without a COMPLETE project index it returns immediately, so the no-index arm is byte-identical. |
| `BB_RUBY_INDEX_CONSUME` | Ruby | Project-index consumption (overrides verification, declared constant paths for instantiates/extends/mixes_in). Fail-closed on an absent or incomplete index; calls are deliberately not touched. |
| `BB_JULIA_BIND_SHOW` | Julia (diagnostic) | An integer N: prints up to N one-binding key representatives while collapsing Julia bindings. This is read-only diagnostics; it does not change analyzer output. |

If you are not that analyzer's gate, leave these flags alone. A claim emitted without its gate's
evidence is exactly the failure mode these pages exist to prevent.
