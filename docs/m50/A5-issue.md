# A5 — Verify-chain truth (issue text, registration PENDING)

> **Registration status:** GitHub was unreachable from the delivery machine
> (`proxyconnect tcp: … connect: no route to host`, and `gh auth status`
> reports the keyring token invalid) at the time A5 was delivered. The issue
> number is therefore **unregistered**, not invented. Nothing in the code or
> evidence claims a number. When the network returns:
>
> ```bash
> gh issue create --milestone "M50: Tool Adoption Truth — used, useful, trusted" \
>   --title "M50.A5 — Verify-chain truth: two chain gates were RED at HEAD (frozen-baseline rot + a substring check)" \
>   --body-file docs/m50/A5-issue.md
> ```
>
> then replace `null` for `A5` in `script/m50/gates.json` with the returned
> number and add `#<num>` to `docs/m50/PLAN.md`.

## Title

M50.A5 — Verify-chain truth: two chain gates were RED at HEAD (frozen-baseline rot + a substring check)

## Body

Found while delivering A2 (#764); filed rather than silently patched.

### What was measured (at commit 15e4566a, before any repair)

| Gate | Verdict at HEAD | Cause |
|---|---|---|
| `script/verify-contract-diff.ts` | **FAIL (13 failures)** | `docs/data/m10-baseline.json` still froze 11 tools (M22 added `bb_index`; M28 added graph/impact/cross-language/annotate/annotations) and the category vocabulary only knew `search/analysis/operations/lifecycle`. |
| `script/verify-tool-registry.ts` | **FAIL (1 failure)** | `metadata is serializable without handlers` was a substring test (`!serialized.includes("handler")`) which `bb_search`'s own description ("the handler auto-refreshes …") defeats. It could not pass. |

Both live in the repo's own `npm run verify` chain, so the chain was red and the
failures were being read past — which is exactly how the next real regression
gets missed. `npm test` (verify-engine / verify-schema / verify-tool-registry /
verify-public-surface) also failed on the second one.

### Acceptance criteria

- A1. `docs/data/m10-baseline.json` is re-frozen from the live registry/CLI by
  a script (`script/m50/refreeze-baseline.ts`), and the re-freeze is recorded in
  `postBaselineRepairs`. Human decisions in the file (identity, library exports,
  legacy inventory, CLI option contracts) are untouched.
- A2. The contract gate's category vocabulary is the DECLARED union (adds
  `graph`, `annotations`); a category outside it still fails.
- A3. The tool-registry check asserts the property it means — no handler-ish key
  or function value anywhere in the advertised metadata, JSON round-trip stable —
  instead of a substring test.
- A4. `script/m50/verify-a5-verify-chain.ts` proves it live: drift comparator
  clean, all three gates exit 0, a degraded baseline COPY fails the comparator,
  and a real `handler` key injected into the registry source makes
  `verify-tool-registry.ts` fail (then the source is restored byte-for-byte).
- A5. Evidence `validation/m50/results/A5.json` (commit-stamped); gate wired into
  `npm run verify:m50` and `npm run verify`; registered in
  `script/m50/gates.json` and mutation-covered by `verify-gate-selftest.ts`.

### Definition of done

`npm test` green; `script/verify-contract-diff.ts`, `script/verify-m10-baseline.ts`,
`script/verify-tool-registry.ts` all green; `verify-a5-verify-chain.ts` 10/10 with
its two mutations.

---

# Delivered state (for the record, at delivery time)

- `script/m50/refreeze-baseline.ts` — re-freeze + `--check` drift comparator
  (11 → 16 tools, 6 → 14 CLI commands), recorded in `postBaselineRepairs`.
- `script/verify-contract-diff.ts` — category vocabulary widened to the declared
  union; still fails on an undeclared category.
- `script/verify-tool-registry.ts` — structural handler-leak check.
- `script/m50/verify-a5-verify-chain.ts` — 10/10: C1 drift clean, C2/C3/C4 live
  green, M1 degraded baseline copy fails, M1 frozen file byte-unchanged,
  M2 handler-key mutant fails the real gate and the source is restored.
- `validation/m50/results/A5.json` — commit-stamped evidence.
- `npm test` green; `verify:m50` and the full `verify` chain include A5.
