# CL3 — `bb_cross_language`: a second corpus, two guards that could not fire, and a leak on the other door

**Status** — CL1 VERIFIED (303/303, 13/13 mutants) on BOTH corpora · CL1 wiring
VERIFIED (22/22, 13/13 anchors live) · M26 W3 (the hover door) VERIFIED 21/21,
5/5 mutants · production path (`node bin/bb mcp` over stdio, from `dist/`) VERIFIED
on both corpora · tool docs PASS (16 tools, 18 artifacts) · typecheck clean
**Supersedes** — `docs/m63/CL2.md` §"Still open" items 1–4. CL1's four defects and
CL2's member-cascade ruling both remain in force and are re-measured here on an
index and a corpus neither had seen.
**Evidence** — `validation/m63/results/CL1.json`, `CL1-wiring.json`,
`hover-leak.json`, `mcp-stdio-*.json`, `residue-*.json`, `dead-branches-*.json`,
`self-edges-*.json`
**Verifiers** — `npm run verify:m63`, `npm run verify:m63-wiring` (in
`verify:fast`, so CI runs it)

---

## 1. Why this round exists

CL2 closed with four items open. Three of them were about *the tool*; the fourth
was about the gate's own reachability. This round took them in that order, and the
order mattered, because item 1 changed what every later claim could rest on.

| item | outcome |
|---|---|
| 1. a second, non-JVM polyglot corpus | indexed and re-verified — see §2 |
| 2. the two never-fired branches | fired, by seeding the state each guards — §3 |
| 3. the hover door's project leak | fixed in both directions — §4 |
| 4. the gate wired into the verify chain | two entries, one of which CI runs — §5 |

Nothing here changed what the tool *reports* for ordinary symbols. The member
section, the union-over-copies rule, the bound and the declared absence are as
CL2 left them. What changed is how much of the tool is actually known to work.

## 2. A second corpus, and what it bought

CL1's corpus is a JVM one: 230 files, three language pairs, `clojure ↔ java` plus
`java ↔ xml`. Every defect it found could have been an artifact of that shape.
The second corpus is the Elixir language repository — a different language family,
a different analyzer path, and a **much wider** pair table:

| | corpus 1 (`jvm-interop`) | corpus 2 (`elixir`) |
|---|---|---|
| files / symbols / relationships | 230 / 9,329 / 53,676 | 692 / 14,775 / 70,708 |
| stored cross-language rows | 1,642 | 1,168 |
| distinct language pairs | 3 | **16** |
| index time | — | 382s |

The pair table is the interesting part. It includes `erlang → elixir implements`
(504), `markdown → yaml contains` (262), `erlang → make calls` (194),
`elixir → erlang calls` (77), and a scattering down to `elixir → kotlin` (5) and
`bash → erlang` (2). CL1 never saw `implements`, never saw a pair where neither
side is code, and never saw more than three pairs at once.

**Result: the gate passes unchanged.** 303/303 and 13/13 mutants on both corpora,
with no corpus-specific assertion anywhere in it. The specific things CL1 and CL2
found are re-measured fixed rather than remembered:

- counterparty identity holds on `ELIXIRC` (make) → `ELIXIRC_OPTS` (yaml);
- the union-over-copies rule holds — all five ambiguous names probed returned
  `hiddenRows = 0` (e.g. `project`, 78 copies, 5 stored rows, 5 emitted);
- the bound fires and declares itself (`elixir`, 260 stored → 200 emitted,
  156,671 bytes, `truncated: true`; `format`, 201 → 200, 145,573 bytes);
- the cross-project leak is closed on the agent door;
- `bridge_mechanism` is still 100% `name-resolution` — 1,168 of 1,168 — on a
  completely different corpus. That is now a *systemic* property of the
  analyzer's bridge vocabulary, not a quirk of one repository, and §7 keeps it
  declared.

One probe discrepancy is worth recording so it is not re-investigated: the older
probe reported `install` as 32 stored rows against the tool's 34 facts. The probe
counts rows coalesced onto a *single* symbol; the tool reports own rows plus
member rows, which is more by design. The gate's independent union query is the
one that agrees, and it is the gate's number that is quoted anywhere.

## 3. Two branches that had never fired — and cannot

CL2's branch-coverage sweep over 909 names found `unpairableRowCount` and
`collapsedRowCount` at 0 on every single name. Two readings were possible —
"unverified" or "impossible" — and they call for different responses, so the store
was asked directly (`lane/cl-dead-branches.ts`, `lane/cl-self-edges.ts`).

**`unpairableRowCount` — not reachable.** It needs an endpoint file with no
detected language, or both endpoints sharing a language.

- all 922 indexed files across the two corpora carry a language (0 without);
- 0 rows are flagged `is_cross_language = 1` with equal endpoint languages;
- the only writer that creates a null-language file is
  `src/ast/cross-language-intelligence-persister.ts`, which `parallel-indexer`
  imports and never calls.

**`collapsedRowCount` — not reachable, and for a structural reason.** It needs a
row matched by both the by-name query and the owner-cascade query. The obvious
guess is a self-edge, and that guess is wrong twice over: a self-edge is one
symbol in one file, so both ends share a language, so the row is dropped as
*unpairable* before the counter is reached. (The store is full of self-edges —
2,856 and 1,720 — and not one carries the cross-language flag, which the indexer
cannot set on a self-edge because it only flags rows whose files' languages
differ.) The member route is excluded by the member query's own
`m.name <> owner.name` filter. **The reachable route is a row between two
different same-named symbols in different-language files** — the ordinary shape of
a name-resolution cross-language edge between two copies of a common name — and
that is what the fixture seeds.

**Treatment: seeded store states, each proved breakable.** Both counters are
guards against states the current writers do not produce; deleting them would
remove real protection for a state the schema permits. So they stay, and each is
verified by building the state it guards (`CL1 S1`, `CL1 S2`), in its own project
inside its own temp data dir so it cannot touch the corpus. Two mutants come with
them, because a guard nobody can break is a comment: **M11** removes the unpairable
rule (the unlabelled row would get a fabricated `unknown → unknown` pair) and
**M12** removes the collapse rule (the same-named row would be emitted twice).
Both are caught.

The documentation was changed to match. `returns` said the counters "report rows
that could not name a pair and rows matched from both sections", which reads as
activity; it now says they are guards, states that they are 0 across 1,662 names,
and says how each was verified.

## 4. The hover door leaked another project's rows, and now cannot

CL1 fixed the cross-project leak on the agent door and declared the hover door
**latent** — on the reasoning that a hover symbol id is project-prefixed, so it
names one row's world. That reasoning had a hole: the id being project-scoped says
nothing about the **rows**. `storedCrossLanguageRows` joined the opposite symbol
with `ss.project_id = r.project_id`, which reads like a project filter and is not
one, and the row itself was never constrained.

**The fix takes no `projectId` parameter, deliberately.** `hover()` has no project
in scope — it resolves everything by file path — so threading one would touch the
LSP surface for a property the SQL can carry itself, and a parameter a caller can
forget is a weaker guarantee than a filter that cannot be omitted:

```sql
AND r.project_id = (SELECT s2.project_id FROM brain_symbol s2 WHERE s2.id = ?)
```

with the symbol id bound a second time, in both directions.

**Proven three ways**, which is the part that matters:

1. a direct measurement (`lane/cl-hover-leak.ts`) injecting a foreign row, with
   two controls — the row really is stored, and it really is another project's —
   because "no leak" is otherwise indistinguishable from "the insert failed";
2. gate section **I**, which seeds one row *per direction* with those controls for
   each, and asserts the door still returns exactly its own rows;
3. **two mutants, M13 and M14**, one per direction, each proved caught. A single
   mutant removing both filters would be caught by a check looking at either arm,
   so neither predicate would be *proved load-bearing*; two filters need two
   removals.

**The wrong way is worth recording.** M13's first draft removed the caller arm's
filter and seeded a row shaped for the *callee* arm. It survived — which read like
a robust tool and was in fact an unexercised mutant: the caller query's
pre-existing JOIN pins the SOURCE's project to the row's, so a row with *our*
source and a foreign row's project is discarded before the mutated WHERE is
evaluated at all. Each arm only ever sees a row whose opposite endpoint is
foreign, so each mutant must seed the shape its own arm matches. A mutant that is
not reached is neither caught nor surviving; it is unverified, and the gate now
distinguishes that case explicitly (`UNVERIFIABLE`) rather than banking it.

## 5. Wiring, and what CI will and will not run

The framing "nothing runs the gate" is true, but the fix is not "add it to
`verify`":

- the main `verify` chain references **no** `verify:mXX` script at all, so adding
  one there would be off-convention rather than a fix;
- CI runs only `build`, `verify` and `verify:fast`, and **no milestone gate is in
  CI either** — `verify:m40`, `verify:m44`, `verify:m50` … are run by hand;
- the full gate needs a corpus index and takes minutes to build one, which is why
  no corpus-dependent gate sits in `verify:fast`.

So there are two entries, not one:

| script | what it does | where it runs |
|---|---|---|
| `verify:m63` | the full gate: 303 checks, 13 mutants, two corpora | by hand, like its siblings |
| `verify:m63-wiring` | corpus-free: every mutant still has a **live anchor**, the extractor agrees with `MUTANT_FLOOR`, the seeded states are present, and the hover door scopes the row in both directions | **`verify:fast`, so CI** |

`verify:m63-wiring` earns its place because anchor-level failure is the failure
mode that keeps recurring here and is invisible until it costs a run. It catches
M13's class of problem in two seconds instead of six minutes, and its one
vulnerability — that it extracts anchors from source with a pattern — is closed by
checking the extracted count against `MUTANT_FLOOR` read from the gate itself, so
an extractor that stops understanding the gate fails loudly instead of agreeing
with it.

The first draft of that check asserted each mutant's *replacement* text was absent
from the source, and failed **M12** — correctly, because M12 is a deletion mutant
and its replacement is necessarily a substring of what it removes. The property
worth asserting is that the file *changes*, which subsumes the no-op case. This is
in the record because the checker was wrong in the safe-looking direction.

## 6. The production path, and residue

### 6.1 Through the real MCP server, over stdio, from `dist/`

Everything above exercises the handler **in process**. That proves the function
behaves and nothing more: the production path dispatches the tool by name from the
registry, frames the answer as MCP `content` over a pipe, and runs `dist/` built
by tsup from the committed source. A fix verified only in-process has not been
verified in the program that ships.

`lane/cl-mcp-stdio.ts` spawns `node bin/bb mcp --dir <workspace>`, performs the
JSON-RPC handshake, lists tools, and calls `bb_cross_language` for the heaviest
symbol in each corpus. **Both corpora pass**: 16 tools listed with
`bb_cross_language` among them, `isError: false`, one text block, every required
envelope field present, every fact naming both ends, and no duplicated `rowId`.

| corpus | symbol | copies | facts | own / member | bytes | distinct rowIds |
|---|---|---|---|---|---|---|
| jvm-interop | `invoke` | 227 | 50 | 50 / 0 | 94,747 | 50 |
| elixir | `elixir` | 4 | 200 | 200 / 0 | 156,671 | 200 |

Two ways this probe was wrong before it was right, both worth keeping:

- it spawned `dist/index.js mcp`, which does not exist. The server never started,
  `initialize` timed out, and the probe reported `FAIL` **without saying that
  nothing had run** — the same vacuous-pass shape as everything else this round.
- it passed the *db* directory as `--dir`. `getProjectId` is `sha1(realpath(dir))`,
  so the server re-derives the project id from the path it is given; passing the
  db made it resolve a project that does not exist and answer every call with "No
  index found…" — a correct answer to the wrong question. The probe now derives
  the id from the workspace and refuses to run if it does not match.

### 6.2 Teardown and residue

The gate's teardown lived on its success path: last lines before `process.exit`,
inside `main()`. A failing gate is a normal outcome here — this round produced
three — and any throw before that line reached `main().catch()`, which prints and
exits without cleaning up. That left a `cl1-seed-*` directory in `TMPDIR` and,
more to the point, the corpus directories `built` had already created. **A leftover
corpus directory is not cosmetic: it is a second index on disk that a later
measurement can pick up.** One `process.once("exit")` hook now drives a registry
of temp dirs, verified by injecting a throw into a copy of the gate and confirming
the *named* fixture directory existed at the throw and was gone afterwards
(`lane/run_teardown_test.sh`) — a test that would have passed vacuously if the
gate had failed to start, which the first draft of it did.

Residue is now measured, not assumed (`lane/run_residue.ts`): both corpora clean,
0 rows matching any id the gate can mint, with a control that the corpora do have
the rows of that shape to lose.

## 7. Still open, and whose it is

Unchanged from CL2 §6 and re-confirmed on the second corpus:

1. **`name-resolution` is 100% of stored bridges** — 1,642/1,642 and 1,168/1,168 on
   two different corpora. The field is data, not a communication mechanism, and
   the doc says so wherever it is shown. *Analyzer's to close.*
2. **52% of cross rows carry no analyzer `evidenceClass`**, so their tier is
   derived by the shared rule rather than claimed. *Analyzer's.*
3. **`cross-language-intelligence-persister.ts` mints non-project-prefixed ids**
   and is imported by `parallel-indexer` without being called — a latent wiring
   that would also make `unpairableRowCount` reachable. *Analyzer's.*
4. **M48.C1's predicate should be replaced for all 16 tools**, not just this one.
   *Governance's.*

## 8. Three mistakes this round made, kept because each was instructive

1. **A self-edge was seeded to make the collapse counter fire.** It cannot: one
   file means one language, so the row is dropped as unpairable first. `pairCount=0`
   and the gate said so. The reachable state is two *different* same-named symbols
   in different-language files.
2. **M11's probe looked for its subject state in the corpus**, where no unlabelled
   file exists, so it returned "not caught" for a mutant that had simply never
   been planted. A mutant that cannot be probed is neither caught nor surviving.
   The probe now reads the seeded fixture and *throws* `UNVERIFIABLE` if it is
   absent, and the harness no longer banks that case as caught.
3. **`BB_DATA_DIR` was scoped around the fixture's WRITES but not its READS.** The
   handler then resolved the seeded project inside the corpus's data dir and
   answered with a text error where JSON was expected; the gate died in
   `JSON.parse` with nothing pointing at the cause. One `withSeeded()` helper now
   scopes it for both, and it is used by every call site so none can forget.
