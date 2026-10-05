# Lane 6 — status assessment of the recovered commit `e925e9138`

Written by the session that inherited `e925e9138` after the previous lane
crashed. Every number below is the output of a command run in this session at
this commit. Nothing here is carried over from the crashed session's claims.

Scope: this is a **step-zero assessment** (contract §11 F7: gate BEFORE fix). It
records what the recovered commit actually does, and it changes no product code.

## How the numbers were produced

```
cd $HOME/Documents/Default\ Project/ishaq/wt/lsp6
export PATH="$HOME/.local/node/bin:$PATH"
npx tsc --noEmit
npx tsx script/m24/verify-hover.ts
npx tsx script/m42/verify-rich-hover.ts
npx tsx script/m42/verify-enrichment-surface.ts
npx tsx script/m42/verify-hover-actions.ts
npx tsx script/m55/verify-signatures.ts
npx tsx script/m55/verify-relations.ts
npx tsx script/m55/verify-hover-coverage.ts
```

Machine: macOS (Darwin), Node from `$HOME/.local/node/bin`. Wall-clock per
gate is below. No gate hung; no gate was killed.

## The measured results

| command | wall | exit | verdict line |
| --- | --- | --- | --- |
| `npx tsc --noEmit` | — | 0 | no output — clean |
| `script/m24/verify-hover.ts` | 11.2 s | 0 | `L2: VERIFIED (45/45 passed, 6/6 mutants caught, 14 negative)` |
| `script/m42/verify-rich-hover.ts` | 7.4 s | 0 | `H2: VERIFIED (40/40 passed, 6/6 mutants)` |
| `script/m42/verify-enrichment-surface.ts` | 4.7 s | 0 | `H3: VERIFIED (29/29 passed, 5/5 mutants)` |
| `script/m42/verify-hover-actions.ts` | 6.8 s | 0 | `H4: VERIFIED (31/31 passed, 5/5 mutants caught)` |
| `script/m55/verify-signatures.ts` | 5.7 s | 0 | `T4 RESULT: VERIFIED — 67/67 passed, 4/4 mutants caught` |
| `script/m55/verify-relations.ts` | 9.6 s | **1** | `T3 RESULT: KNOWN-GAP — 55/57 passed, 3/3 mutants caught` |
| `script/m55/verify-hover-coverage.ts` | 22.1 s | 0 | `HOV-COVERAGE: VERIFIED (13/13 passed)` |

### Latency, measured as p95 over 200 samples

Both hover gates time **n=200 requests** and report a real percentile. Neither
reports a mean in place of a p95.

`verify-rich-hover.ts` R5:

```
warm hover over 200 requests: p50=6.45ms p95=10.36ms max=13.92ms mean=6.91ms
```

`verify-hover-coverage.ts` R6 — three busy shapes, all against the declared
`p95 <= 50 ms`:

| shape | n | p50 | p95 | p99 | max |
| --- | --- | --- | --- | --- | --- |
| A (many files: 32 distinct files, 32 stored locations) | 200 | 26.04 ms | **33.13 ms** | 40.45 ms | 45.79 ms |
| B (many rows, few files: 40 rows over 1 file) | 200 | 9.15 ms | 12.46 ms | — | — |
| C (one caller, many rows, one file) | 200 | 27.95 ms | 30.67 ms | — | — |

All three are under the §3 warm budget. The gate also asserts each timed shape
actually rendered a hover, so the p95 is not taken over declared absence.

## Verdict, part by part

### SOUND

1. **`npx tsc --noEmit` is clean.**
2. **`src/lsp/rich_hover.ts` call-site work is real and is the §14 rule 3 fix.**
   The collector reads `brain_relationship.line_number`, classifies it through
   the declared owner `src/intelligence/graph/line-address.ts`, and opens the
   CALL SITE when the store holds one (`rich_hover.ts:344-358`); a substitute
   address is labeled in the row's own text via `addressNoteSuffix`
   (`rich_hover.ts:206-212`, used by `siteLabel` at `:196-202`); the usages
   header declares which of the two every row is (`rich_hover.ts:488-493`).
   The measured effect, from the coverage gate's R4 differential: of 17 usage
   rows the address owner classifies as a real call site, 15 links open the
   call site, **0** open the declaration, and 2 are not rendered because of the
   3-row cap. 88.2% hit rate, gap 11.8% — and the 11.8% is the render cap,
   which the card states.
3. **The `locationOf` guard is placed correctly.** `rich_hover.ts:244-258` puts
   the `PositionError` guard inside the per-call memo, at the single choke
   point every resolution passes through. The comment records that a second
   try/catch at the call site was tried first and the mutant **survived**
   removing the inner guard — that is a non-vacuous catch, and the surviving
   mutant was fixed rather than accepted.
4. **Five of the six gates are genuinely green**, with mutant counts stated:
   L2 6/6, H2 6/6, H3 5/5, H4 5/5, T4 4/4. Every one of those mutants is a
   *behavioural* catch (the output names the stimulus), not a load failure.

### BROKEN

1. **`verify-relations.ts` exits 1. The repo has a red gate.** Two failures,
   both about the same fact — `bb/graph` reports `Greeter` as a caller of
   `greet`:
   - `R3: every bb/graph caller is a usage site or a stored referrer the index
     cannot locate` — `{"callers":["Greeter","describe","ghost","greetAll","main"],
     "allowed":["describe","ghost","greetAll","main"]}`
   - `R3: the hub's declared difference is exactly the referrers with no
     resolvable location` — `{"extra":["Greeter","ghost"],"unresolvable":["ghost"]}`

   The gate labels itself `KNOWN-GAP` rather than `verified`, and it exits
   non-zero, so it is not hiding anything. But it is not landed either. Note
   for whoever picks it up: the offending surface is `bb/graph`
   (`src/mcp/**`), which this lane does not own.

2. **§8.2 byte-identical regeneration is violated by two artifacts.** Running
   the gates at this commit dirties the evidence tree — `git status` after the
   battery above shows 8 modified files. Two of those drift for reasons that
   are **not** the declared timestamp class:
   - `docs/HOVER-KNOWLEDGE-AUDIT.md` embeds the fixture's `mkdtemp` path
     (`/var/folders/.../T/bb-hov-cov-<6 random chars>/src/hub.ts`) into every
     link on every card. Two runs at the same commit produce different bytes.
   - the same doc embeds the measured p95 (`33.23 ms` committed, `33.13 ms` on
     the first re-run here), so it drifts on timing noise alone.
   - `validation/m55/results/T3.json` embeds `fixture.workspace` (random temp
     dir) and `fixture.projectId` (content hash of a random path).

   `L2.json`/`H2.json`/`H3.json`/`H4.json`/`T4.json`/`HOV-COVERAGE.json` drift
   only in `currentCommit`, `generatedAt`, `sealedAt` and the seal's
   `contentSha256` — which is the class §8.2 declares as varying. Those are
   clean.

   This is the same bug class as the mutation-scratch leak below: a harness
   writing run-varying bytes into the evidence tree. Two instances,
   independently.

3. **A dangling fragment ships in a GENERATED document.**
   `docs/HOVER-KNOWLEDGE-AUDIT.md:383` is the last line of the file, a bare
   bullet under "What this gate does NOT prove":
   `- the warm p95 measured here is 33.23 ms against a declared 50 ms budget`
   It is lower-case, unpunctuated, states a measured FACT, and sits in a list of
   things the gate does not prove. It is generated, so the generator emits it.

4. **The mutation-scratch leak is live and COMMITTED.** Two files are tracked in
   the evidence tree:

   ```
   validation/m26/core.v1mutant.1789395009246.2.ts
   validation/m26/graph_request.mutant.1789359268925.ts
   ```

   `git check-ignore` says neither is ignored; `git ls-files` lists both. The
   scratch names carry a millisecond epoch, which is the signature of a
   mutation harness writing a mutated copy of a source file next to the
   evidence and never removing it.

### UNFINISHED

1. **The audit measured the gaps and closed none of them.** The gap table's own
   rows, written by the gate that produced it, record per symbol:
   - `rows carrying an enrichment record` → "not rendered" (`notifyHub` has 1)
   - `rows whose far end has no symbol (external / file-level)` → "not named
     anywhere on the card" (`count` has 1)
   - `annotations` → "none stored — declared absence"
   - `cross-language rows` → "none stored — declared absence"
   - `owning declaration` → "not named" (for every member symbol)
   - `outgoing rows, by kind` → "the connected summary renders no verb for these
     kinds" for `contains`, `uses` and `references`

   The last row is the live product gap: `OUT_VERB` in
   `src/lsp/rich_hover.ts:89-97` has no entry for `uses`, `references`,
   `contains` or `exports`, so those kinds are invisible on the card even
   though the index stores them. The audit states this; nothing changed it.
2. **Two of the six canonical relationship kinds have no verb at all** and the
   audit's own aggregate says so: `relationship kinds named 12 / known 17`,
   and `relationship rows the card can account for 13 / known 29` (44.8%).
3. **The audit's denominator is stated as 17 kinds, not 10.** The canonical
   list at `src/mcp/tool-registry.ts:259` is ten
   (`calls, extends, implements, uses, instantiates, overrides, contains,
   references, imports, exports`). The gate counts 17 "known" kinds against
   the six pinned symbols, so the 70.6% figure is not the ratio a reader would
   compute from the canonical list. Not wrong, but not the denominator the
   product question asks about.

## What this assessment does not claim

- It does not claim the §14 rule 3 fix is complete. It claims the specific
  measured numbers in the SOUND section, on this fixture, at this commit.
- It does not claim anything about an editor. No leg here runs VS Code.
- It does not attribute the two `verify-relations.ts` failures to this lane's
  recovered work. They concern `bb/graph`, which is outside the files this
  lane owns.
