# M32: Diagnostics & Self-Heal

Status: `open`
GitHub milestone: `32`
Parent program: none (user-demand driven; standalone milestone)
Governing contract: [M14 Honesty Contract](../M14-HONESTY-CONTRACT.md) (vocabulary and
claim-level rules apply to all M32 artifacts) plus the M10 evidence-governance standard.

## Purpose

M30 got users *into* a working embedding config (wizard, first-run hook, pre-save
validation, rate-limit resilience). But when semantic quality is still poor — or when a
user simply wants to confirm their setup — there is no diagnostic surface. Today:

- When semantic search silently falls back to keyword ranking, `bb search` output says
  nothing about why; only MCP provenance metadata carries a terse `fallbackReason`.
- There is no way to *view* the saved embedding config (provider, model, key
  fingerprint, which precedence tier wins). "Did my key actually save?" is unanswerable.
- The model-mismatch failure mode (index built with model X, config now says Y, so
  vectors are never compared) has no detection and no guidance to `bb index --force`.
- The 0600 permission rule is only enforced at save time; a config created by other
  means stays world-readable forever.

M32 ships: `bb setup show` (safe config view), `bb doctor` (concrete degradation
diagnosis with fix commands), `bb doctor --fix` (permission self-heal only), and a
built-binary smoke gate that permanently closes the "works under tsx, broken in the
bundle" defect class found during M30.

## Non-goals / ownership boundary

- No MCP tool surface changes (`src/mcp/` is M21 territory). M32 touches CLI
  (`src/cli/`), setup/config (`src/setup/`, `src/config/`), and new verifier scripts
  under `script/m32/` only.
- No analyzer work (M14), no LSP/IDE work (M24–M29), no M31 territory.
- No self-heal beyond file permissions: `--fix` never edits key material, base URLs,
  models, or the index. Everything else is advice naming the exact command to run.
- No new provider integrations and no network calls from doctor/show (diagnosis reads
  local state only; it never contacts providers).

## Issue groups

| Code | Issue | Deliverable |
|------|-------|-------------|
| G1 | Governance | master plan, ledger, closure gate wiring in `npm run verify`, secret-hygiene guard |
| SM1 | Built-binary smoke gate | compile `dist`, drive the real `bin/bb` through the pty first-run flow (prompt-once, skip persistence, 0600 save, non-TTY honesty) as a permanent `npm run verify` gate |
| S1 | `bb setup show` | view the effective embedding config: provider, model, base-URL host, key fingerprint (last 4 chars only), winning precedence tier; never prints the key |
| S2 | `bb doctor` | diagnosis with evidence from real local state: no config / never-validated key / model mismatch with stored embeddings / wrong file permissions — each with the exact fix command |
| S3 | Self-heal | `bb doctor --fix` repairs config file mode to 0600 only; a dry-run report for everything else; every mutation is printed |
| H1 | Honesty docs | README/EMBEDDINGS document both commands; docs-truth check pins the verbatim output strings and the "advice, not auto-fix" rule |
| X1 | Gate | closure gate: planted mutants + full suite in `npm run verify` |

## Smoke-test protocol (SM1)

The smoke gate exists because M30's fixture verifiers ran through tsx on source, where
a dynamic `require("node:fs")` silently worked — while the shipped ESM bundle threw on
every key save. The gate therefore runs the **compiled** CLI:

- The verifier rebuilds `dist` first (fresh bundle, no stale-artifact passes).
- All smoke flows run against an isolated `BB_DATA_DIR` temp dir; the developer's real
  `~/.bb` config is never read or written.
- Interactive flows run under a pseudo-TTY (`script -qec`) and are driven to the skip
  option; every invocation is timeout-guarded so a hanging binary fails the gate
  instead of hanging `npm run verify`.
- Negative cases plant deliberately broken binaries (exit-nonzero stub, silent stub
  that writes nothing) and assert the suite catches them.
- No provider keys and no network: the wizard path is validated with the skip choice
  and, where a key is needed, a local mock `/embeddings` server on loopback.

## Authority order

1. Executable implementation and CLI behavior
2. Versioned machine-readable evidence and the verifier that produced it
3. This master plan
4. Per-feature documentation (EMBEDDINGS.md, README sections)
5. GitHub issue text and human summaries

A lower authority cannot upgrade a higher-authority failure. Documentation may explain
a limitation but cannot turn a failed or missing behavioral check into `verified`.

## GitHub issue numbers

M32's issues are filed on GitHub as milestone 32: G1=#561, SM1=#562, S1=#563,
S2=#564, S3=#565, H1=#566, X1=#567. The ledger and `REAL_ISSUE_NUMBERS` in
`script/m32/verify-governance.ts` enforce these values exactly — a placeholder
or unknown number is a gate failure, so the ledger cannot drift from GitHub.

## Ledger states

- `planned`: no executable evidence yet; never a release claim.
- `verified`: a real check passed on the current commit with a persisted evidence file,
  positive AND negative check counts, current commit, and evidence file recorded.
- `known-gap`: a real check or required environment failed; the limitation remains open.
- `blocked`: required environment (e.g. `script` pty utility absent) was unavailable,
  with reason recorded — never silently skipped.

## Protocol (every issue)

1. Verifier first — script under `script/m32/` that CAN FAIL; no auto-pass.
2. Evidence file `validation/m32/results/<CODE>.json`: currentCommit,
   sourceFingerprint, verifierCommand, evidenceFile, generatedAt, passed, failed,
   negativeCases, limitations — machine-emitted, never hand-edited.
3. Non-TTY behavior is a first-class negative test: piped stdin / CI must never hang.
4. Diagnosis must never invent state: every `bb doctor` claim in tests is checked
   against real files/DB rows planted by the fixture.
5. Closure comment quotes real run output + evidence path.
6. Ledger: `validation/m32/results/manifest.json`; only closed issues require clean
   evidence.

## Issue order

G1 first (governance prerequisite, M20 #428 pattern). SM1 may proceed in parallel
after G1 (it gates the binary contract everything else builds on). S1 follows SM1.
S2 requires S1 (it reports what S1 shows, plus index state). S3 requires S2 (it is
`bb doctor`'s mutation arm). H1 requires S1+S2+S3 output to be final. X1 closes last;
nothing closes without it.

## Completion bar

1. `bb setup show` answers "did my key save and which config wins?" without ever
   printing the key (fingerprint only), verified against real config states.
2. `bb doctor` names the concrete cause and the exact fix command for every degradation
   mode it detects — no vague advice, no invented state.
3. `bb doctor --fix` mutates only file permissions, prints every change, and refuses
   everything else; dry-run is the default.
4. The built-binary smoke gate is a permanent part of `npm run verify`: the compiled
   CLI's first-run, skip-persistence, 0600-save, and non-TTY honesty behaviors are
   verified on every full run.
5. README/EMBEDDINGS document both commands with verbatim outputs and pass the
   docs-truth check.
