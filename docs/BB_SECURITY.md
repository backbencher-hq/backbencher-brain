<!--
Author: Muhammad Ishaq Khan

WHAT THIS DOCUMENT IS — the reference for bb_security: what the tool actually
reports (M72 spec-engine lexical leads), the per-language tier registry, the exact
answer/pagination/store contract, the measured false-positive classes the engine
retires, and what remains for Phase 2.
WHO IT IS FOR — callers of bb_security (agents and operators) and the maintainer
changing its evidence model.
EDIT TOGETHER WHEN THIS CHANGES — src/mcp/tools/bb_security/{handler,descriptor}.ts,
src/intelligence/security/rebuild/{engine,store,registry,spec-types}.ts,
src/intelligence/security/rebuild/specs/**, script/tool-docs/curation/bb_security.ts,
docs/tools/bb_security.md (generated), docs/m72-security-rebuild/**, and the
security verifier scripts.
-->

# bb_security Reference

**`bb_security` is a lead generator, not a vulnerability scanner.** The default
path reads the M72 spec-engine store (`brain_security_flow`): a lead is one sink
token whose dangerous argument is dynamic and reached by a source token inside
the *same symbol*, matched by that language's security spec
(`src/intelligence/security/rebuild/specs/`). It does **not** perform data-flow
analysis, does **not** prove that a value reaches the sink across statements or
functions, and does **not** prove exploitability. Nothing it prints is a finding,
an exploit, or a risk verdict — every result is a lead to validate by hand.

The Phase 0 tier registry below states exactly which languages can produce a lead
(36 of 53), which are unsupported and therefore **not scanned at all** (17), and
which are measured scanners (0 — promotion is a Phase 2 gate). The measurement
that forced this demotion, the engine that replaced the old token cross-product,
and the exact answer contract are stated below rather than left to be discovered
from the output.

## The answer contract

Every live answer (a read, and `recordRun`) begins with the same three
declarations, in this order, before any result is listed:

1. The banner — the analyzer class, in one line:

   ```text
   ⚠️  LEXICAL TOKEN CO-OCCURRENCE — NOT DATA FLOW; NOT A VULNERABILITY FINDING
   ```

2. The project-independent tier declaration, printed verbatim from
   `formatSecurityTierDeclaration()` in
   `src/intelligence/security/rebuild/registry.ts`:

   ```text
   tiers: 0 scan / 39 leads / 14 unsupported (of 53 analyzers) — unsupported languages are NOT scanned by bb_security; leads require manual validation
   ```

3. The per-project declaration, computed from the languages actually present in
   the indexed project (`brain_file.language`):

   ```text
   not scanned by bb_security (no executable source model): <language>, … — <registry reason>
   leads tier: <N> language(s) present; lexical output only
   ```

   The first line appears only when at least one indexed language is in the
   `unsupported` tier; it names those languages and the registry's reason. The
   second appears only when at least one indexed language is in the `leads` tier.
   Neither line is ever substituted by a clean-looking zero: a project whose
   languages are all unsupported says so instead of printing "0 leads".

### A live read (the default answer)

A default read (`{}` or `{ limit, offset }`) reads the store with
`tier = "leads"`, computes the pre-page total, and renders one page:

```text
⚠️  LEXICAL TOKEN CO-OCCURRENCE — NOT DATA FLOW; NOT A VULNERABILITY FINDING
tiers: 0 scan / 39 leads / 14 unsupported (of 53 analyzers) — unsupported languages are NOT scanned by bb_security; leads require manual validation
leads tier: 1 language(s) present; lexical output only
security leads: 12 stored lead(s)
  [exec] lead: command injection @ src/app.ts:41 <- source:37; rule=ts.child_process.exec; symbol=run [reach: cmd]
  [high] lead: sql injection @ src/db.ts:12 <- source:9; rule=ts.sql.concat; symbol=find [stale]
[leads: showing 2 of 12; offset 0; page size 50; tier=leads; more available — pass offset to page]
```

- The headline is `security leads: <N> stored lead(s)`. When the store holds
  none for the project it is `security leads: 0 stored lead(s) (none stored for
  this project — declared empty, not a clean result)`.
- Each lead line is
  `[exec|high|medium|low|unknown] lead: <vulnerability> @ <file>:<sinkLine> <- source:<sourceLine>; rule=<ruleId>; symbol=<symbol>`,
  plus ` [reach: a -> b]` when the engine recorded the assignment chain that
  connects the source to the sink argument, and ` [stale]` when the lead's file
  changed after indexing. The vulnerability label is the spec's id with
  underscores turned back into spaces (`sql_injection` renders `sql injection`).
- The page line is
  `[leads: showing N of T; offset O; page size L; tier=leads; more available — pass offset to page]`.
  A page is never the whole store: `T` is the pre-page census for the applied
  filter, and `more available` appears when `offset + N < T`.
- An empty page is stated as `no stored leads on this page` — it is not printed
  as a clean result, and the census still carries the real total.
- Reads render at most `limit` leads (default 50, clamped to 200) from `offset`
  (default 0).

### The declared uninitialized state

A read-only handle never runs DDL. On a project indexed before M72 the table is
absent, and the answer says so instead of returning a clean zero:

```text
security leads: engine not initialized — security engine not initialized; run bb index --post
```

`recordRun` declares the same state (`recordRun: engine not initialized — …`)
and writes nothing. The fix is to run the indexer so the M72 pipeline creates
`brain_security_flow` and its derived phase runs.

### `recordRun` (the one write)

`{ "recordRun": true }` reads the store's **census** (up to 50,000 leads, not
the display page), persists that set into the analysis-history tables, and
renders the same banner and declarations plus:

```text
recorded run: <run id>
new=<n> repeated=<n> resolved=<n>
<N> leads recorded
  [exec] lead: command injection @ src/app.ts:41 <- source:37; rule=ts.child_process.exec
[recordRun: <N> lead(s) persisted; preview shows <M>]
```

The preview shows up to 20 persisted leads; the persisted set is the census.
Each persisted row's fingerprint is the stored lead id (`m72:<lead id>`), which
is line-number-free: re-running is a repeat rather than a new record, a resolved
lead is one that disappeared from the census, and moving a function does not
create a new record. When the store holds no leads, the answer says
`no stored leads to record` rather than persisting an empty success.

### `{ "history": true }` (the persisted page)

History returns JSON, not a scan answer, so it carries no banner. The page shape
is stable:

- `runs` — the completed runs, newest first, bounded by `limit` (default 20);
- `findings` — the persisted lead rows, capped at 200 per page;
- `findingsTotal`, `findingsShown`, `findingsTruncated` — the page and its true
  total, so a capped page can never read as the whole set;
- `summary` — the stored-state counts over the **whole** persisted set;
- `census` — `{ runsTotal, runLimit, findingsTotal, findingsShown, findingsBeyondCap }`.

The persisted rows are leads (title `lead: <vulnerability>`, evidence kind
`security_lead`, limitations `Lexical lead: not a dataflow proof; validate
manually.`). They retain the stored severity name, which can be `critical` for a
command/code-execution rule — a stored grade, not a verdict. The live text
answer is the surface that prints `exec`; the JSON page prints the stored value
because it is a record of what was persisted.

Two requests are refused rather than silently reinterpreted: `offset` together
with `history: true` (the history page has its own bounded shape) and `history`
together with `recordRun` (they are different answers). `limit` must be a
positive integer; `offset` must be a non-negative integer.

### The legacy read (`BB_SECURITY_LEGACY=1`)

The retired token co-occurrence detector is still reachable for one release as a
rollback/comparison path. It reads `brain_taint_flow` and renders the old
observation split. It is **not** a supported mode and the default path never
reads that table, so a pre-M72 row cannot be re-presented as an M72 lead. The
properties and false-positive classes documented below describe that retired
detector unless stated otherwise.

## The tier registry (single source of truth)

Tiers are defined in `src/intelligence/security/rebuild/registry.ts`; the tool
answer, the language × tool matrix, these docs and the public site read the same
registry. The counts below are its exact Phase 0 state and are reproducible
(see the command after the table):

| Tier | Count | What it means in an answer |
| --- | --- | --- |
| `scan` | **0** | Real rules + reachability + per-language fixtures + oracle passing. Vulnerability vocabulary allowed; a result may be called a finding. No language is promoted yet. |
| `leads` | **36** | Lexical rules only, no reachability proof. The banner and tier line are mandatory; the result is a lead, never a finding. |
| `unsupported` | **17** | No executable source/sink model. The answer must say "not scanned by bb_security" — never a clean zero. |
| **total** | **53** | Every language derived from the engine's supported-language table has one entry. |

Reproduce (the tool prints this line verbatim):

```text
npx tsx -e 'import {formatSecurityTierDeclaration} from "./src/intelligence/security/rebuild/registry"; console.log(formatSecurityTierDeclaration())'
→ tiers: 0 scan / 39 leads / 14 unsupported (of 53 analyzers) — unsupported languages are NOT scanned by bb_security; leads require manual validation
```

Aliases resolve before lookup: `tsx` → `typescript`, and `jsx`/`mjs`/`cjs` →
`javascript`. A language the registry does not contain resolves to `unsupported`
with a declared reason — never to a silent default.

### The 36 `leads` languages

bash, c, clean, clojure, cpp, csharp, dart, elixir, erlang, fsharp, go, groovy,
haskell, java, javascript, julia, kotlin, lua, matlab, nim, objective-c, perl,
php, powershell, python, r, ruby, rust, scala, solidity, swift, tsx, typescript,
vb, vba, zig.

The registry is the policy contract for all 36. What the pipeline stores is a
separate, narrower fact: the engine persists a lead only for a language with a
loaded spec (`specs/index.ts`), and the store records why it dropped anything it
did not persist — `test_file`, `no_spec`, `unsupported_tier`, `malformed`. A
language whose spec is not yet loaded therefore contributes no stored rows while
still counting as `leads` in the declaration; the declaration is about the tier,
not a promise that the language produced leads. The 17 `unsupported` languages
are never analysed.

### The 17 `unsupported` languages (not scanned — never reported as clean)

| Language | Registry reason |
| --- | --- |
| css | stylesheet text; no executable source/sink surface |
| graphql | schema/query text; not an execution context for taint |
| hcl | configuration language; no tainted execution model |
| html | markup; no executable source/sink surface |
| json | data format; no executable source/sink surface |
| make | build recipes are shell text; make is not parsed as an execution context |
| markdown | prose; no executable source/sink surface |
| protobuf | schema language; no executable source/sink surface |
| sass | stylesheet text; no executable source/sink surface |
| scss | stylesheet text; no executable source/sink surface |
| sql | SQL text is the sink language, not an execution context with tainted inputs |
| svelte | component format; script-block extraction is not wired to the security engine |
| terraform | configuration language; no tainted execution model |
| toml | data format; no executable source/sink surface |
| vue | component format; script-block extraction is not wired to the security engine |
| xml | markup/data; no executable source/sink surface |
| yaml | data format; no executable source/sink surface |

## Known false-positive classes the engine retires

The classes below are properties of the **retired token co-occurrence detector**
(and of the legacy path still available under `BB_SECURITY_LEGACY=1`), retained
here because they are what the M72 engine is built to exclude. The engine
excludes them by construction: comment/string masking, self-pair rejection,
dynamic-argument requirement, same-symbol reachability, constant-argument
exclusion, sanitizer/parameterized forms, spec-only languages, and test-file
skipping at persistence. A rule can still mis-model a language idiom; the class
list is the honest ceiling.

1. **Self-pairs — one token is both a source and a sink.** The legacy analyzer's
   source and sink rule families overlap: `.Query\b` was matched by a *source*
   rule and by a *sink* rule, so a single `.Query(` token could be paired with
   itself and reported as `database_read → database_write`. The most common
   single finding shape on this repository used to be exactly this shape.
2. **`.exec(` is not a shell.** `RegExp.prototype.exec` in JavaScript/TypeScript
   matched the command-execution sink rules, so a regex loop became a
   command-injection lead.
3. **The bare word `execute`.** The universal SQL-sink rule matched
   `\bexecute\b` case-insensitively — which matches `db.execute`, but also a
   method named `execute`, an i18n string, a test title, or prose. On real
   corpora this produced critical `sql_injection` findings where no SQL was
   involved; the phantom sink is an analyzer/indexer-domain defect the spec
   rules replace.
4. **`.Query()` ignored the receiver.** A receiver-shaped rule matched the
   suffix, so Go's `r.URL.Query()` (URL parsing) and a database handle's
   `Query()` were indistinguishable to the matcher.
5. **Comments and string literals were text too.** The token matchers scanned
   raw text, so a sink keyword inside a comment or a quoted string could pair
   with a source in the same body. The engine masks comments and strings first.
6. **Test, vendor and data files were indexed like code.** The legacy taint
   stage gated on language, not on path, so test files participated. Before the
   language allow-list, 326 of 3,190 findings (10.2%) were in Markdown, JSON,
   YAML, HTML and CSS — prose reported as `sql_injection`, including a finding
   whose "symbol name" was parsed out of a Markdown table cell. The store now
   skips test files before persistence.
7. **Constant arguments.** Co-location did not inspect the argument, so
   `fopen("/etc/hosts")` paired a file-read source with a path-traversal sink
   even though the path was a literal. The engine requires a dynamic argument.
8. **Symbol-level cross product.** `src/ast/parallel-indexer.ts` built the
   intra-symbol flow as the **cartesian product of every source token and every
   sink token in the symbol body**, storing one `brain_taint_flow` row per pair
   and hardcoding `critical` for SQL and command-injection sinks. The M72 engine
   has no source × sink product: one lead per sink occurrence, using the
   earliest deterministic reaching source and a bounded assignment chain.
9. **Parameterized and sanitized sinks.** On the legacy path, a parameterized or escaped sink can still be reported, because the matcher did not track sanitizers. A spec now carries sanitizer/parameterized forms and the flow decision excludes them; a rule can still be wrong for an idiom it does not model, so validate the lead against the actual data flow.

The cost of a false positive here is bounded — validate before acting. The cost
of silence would be worse, which is why the tool keeps reporting what the engine
stored and states the class instead of suppressing rows.

## The measurement behind the demotion

`docs/m48/SECURITY-PRECISION-PROPOSAL.md` measured the retired detector against
this repository's own 168k-symbol index:

```text
4,046 taint flows → 3,190 findings → 817 critical
456 of 2,847 code findings (16.0%) whose reported line contains any sink call
326 findings (10.2%) in Markdown / JSON / YAML / HTML / CSS
213 of 1,433 symbol names span more than one file
mitigated: 0    crossLanguage: 0
```

This repository has no SQL injection — it calls `better-sqlite3` in verifier
scripts — yet the tool reported **817 criticals** with a **16.0% hit rate** even
on a test as lenient as "is a sink token near the reported line". That is the
number this document exists to publish: a security tool with a 16% lexical hit
rate on a corpus with no such vulnerability is a tool that gets ignored, or,
worse, one that gets trusted. `confirmed` in the legacy vocabulary meant only
"both endpoints resolved to indexed symbols"; it was the single most misleading
thing the answer printed, and the M72 lead path has no such state or word.

## What M72 replaces — and what is now the default

The Phase 1 engine is wired as the default path (see
`docs/m72-security-rebuild/PLAN.md`):

- `spec-types.ts` freezes the contract; `specs/<language>.ts` carries per-language
  source/sink/sanitizer rules and the lexical comment/string syntax.
- `matcher.ts` masks comments and strings before matching tokens; `flow.ts`
  requires the sink argument to be dynamic and to be reached by a source-derived
  value (directly or through a bounded assignment chain); `engine.ts` emits
  per-symbol leads with complete evidence.
- There is no source × sink cartesian product: one lead per sink occurrence,
  using the earliest deterministic reaching source. Constant arguments, comment
  or string text, self-token pairs, and sanitized/parameterized sinks are
  excluded.
- Severity is rule-defined, never token-class-only: `critical` requires a
  code/command-execution rule with dynamic external input and no sanitizer.
- Leads persist to `brain_security_flow` (stable id, evidence JSON, rule id,
  tier, source/sink lines). The old `brain_taint_flow` is no longer written by
  the default path; stale lead rows are deleted per reindexed file, so an edit
  that removes a lead removes its row.
- Test files are skipped at persistence; a language without a loaded spec stores
  nothing and says why (`no_spec`), instead of returning a clean-looking zero.

Still Phase 2: per-language vulnerable/clean/sanitized fixtures for all 36 code
languages, and a CVE-fix oracle so precision/recall can be published per
language. A language becomes `scan` — and only then may its results be called
findings — after those gates pass; the registry, the matrix and every public
claim are generated from the same counts so the claim cannot drift from the
measurement.

## Evidence model

Each stored lead is one `brain_security_flow` row: the spec engine ran once per
symbol at index time and persisted the leads it produced. The row's evidence
carries the rule id, vulnerability and severity, the source and sink token
matches (byte offsets relative to the symbol body and symbol-relative lines),
the reaching-assignment `reachPath` when one was found, and the spec sanitizer
decision. The store adds what a reader would otherwise re-derive: the absolute
source/sink lines, the stored symbol id, the file language, the tier and the
file's project-relative path.

The engine is intra-symbol by contract: the source and the sink are in the same
symbol, so the row's source and sink symbol ids both name the producing symbol.
It never reads the filesystem, skips test paths, or invents an offset; a lead
whose evidence lacks a sink token is dropped (`malformed`) rather than stored
with made-up coordinates. The legacy `brain_taint_flow` rows and their
cross-symbol stitching are readable only through the legacy path.

## Stored lead schema

`brain_security_flow` (DDL in `src/brain/schema-ddl.ts`):

| Column | Meaning |
| --- | --- |
| `id` | Stable lead id `sec:<projectId>:<fileId>:<ruleId>:<byteStart>:<byteEnd>`; the offsets are the sink token's, relative to the symbol body, so a line move does not change the id |
| `project_id`, `file_id` | Owning project and file |
| `source_symbol_id`, `sink_symbol_id` | The producing symbol's stored id on both sides (intra-symbol engine) |
| `vulnerability_type` | Spec vulnerability id (e.g. `sql_injection`) |
| `severity` | Rule-defined grade: `critical` / `high` / `medium` / `low` / `unknown` |
| `state` | `lead` (the Phase 1 engine emits no `candidate`/`mitigated` row yet) |
| `tier` | Producing spec's tier (`leads` at Phase 0/1) |
| `rule_id` | The spec rule that produced the lead |
| `source_line`, `sink_line` | Absolute file lines (store-joined from symbol-relative engine lines) |
| `evidence` | JSON: the engine's `SecurityLeadEvidence` plus the store join context |
| `time_created`, `time_updated` | Row timestamps |

The reader's view (`SecurityFlowView`) exposes the same fields plus resolved
`file`, `symbolName` and `language`, and the pre-page `total` computed by the
store for the applied filter.

## States

The M72 store persists one state today:

- **lead** — the Phase 1 engine's only output: a speculative lexical match with
  a reaching source inside the symbol. Stored so the answer can page it, never
  as a finding.

`candidate` and `mitigated` exist in the DDL as the two states a later phase may
write; the Phase 1 engine emits neither, and no writer sets them today. The four
legacy states below are reachable only on the `BB_SECURITY_LEGACY=1` path:

- **confirmed** — legacy: both source and sink resolved to indexed files. It
  meant "both endpoints are indexed symbols", never "these values are
  connected".
- **mitigated** — legacy: both endpoints resolved and `is_mitigated = 1`; every
  legacy write site hardcodes `0`, so measured `mitigated: 0`.
- **source_only** — legacy: the source resolves but no sink endpoint is reachable (isolated-source observation).
- **unresolved** — legacy: a sink endpoint resolves but the source does not
  (isolated sink).

Legacy observations (`source_only` and `unresolved`) are excluded from persisted history. Endpoint resolution takes precedence over the legacy mitigation flag: a
partial flow marked `is_mitigated = 1` is classified `unresolved`, never
`mitigated`.

## Grades and confidence

`severity` is a rule-defined lexical grade. The spec clamps it so `critical`
requires a code/command-execution rule with dynamic input and no sanitizer; the
live text answer prints `critical` as `[exec]` (with `high`, `medium`, `low`,
`unknown` passing through) because a co-occurrence lead is not evidence that
code executes. The `{ "history": true }` JSON page retains the stored severity
name because it is a page of persisted records, not a verdict.

M72 leads persist with `confidence: null`: the engine has no calibrated
probability to publish, and a made-up number would be a claim. The legacy path's
confidence values (`confirmed` = 0.7, `unresolved`/`source_only` = 0.4,
`mitigated` = 0.3) are calibrated by endpoint resolution, not exploitability,
and are not part of the default answer.

## Determinism and identity

The engine is deterministic: leads are ordered by rule id, sink byte offsets and
source byte offsets, and the store reads `ORDER BY f.id`, so a page is stable
across runs. One lead is emitted per sink occurrence (the earliest deterministic
reaching source wins), which removes the legacy duplicate-per-source-variant
rows and their dedup step.

Identity is the stored lead id, which does not contain a line number: moving a
function or inserting lines above it does not change which lead it is. On
reindex, the pipeline deletes this file's rows (as source or sink endpoint)
before inserting its fresh set, so a lead removed by an edit cannot survive as a
stale row.

## Bounds and the census

| Surface | Bound |
| --- | --- |
| Live lead page | `limit` default 50, clamped to 1..200; `offset` default 0. `total` is the store's pre-page count for `tier = leads`, and `more available` is printed when `offset + shown < total`. |
| `recordRun` | Reads the store's census up to 50,000 leads; the preview renders at most 20, and `[recordRun: N lead(s) persisted; preview shows M]` declares both numbers. |
| History | `limit` bounds runs (default 20); the persisted-lead array is capped at 200 rows with `findingsTotal`/`findingsShown`/`findingsTruncated`. |
| Legacy path | 500 flows per live read, 50,000 for a recorded run, with the explicit `CAPPED at …` sentence when the cap drops rows. |

The headline and the page line are the two numbers a reader must not confuse:
`security leads: T stored lead(s)` is the pre-page census, and
`[leads: showing N of T; …]` says how much of it is on screen. An empty page with
a non-zero total is declared (`no stored leads on this page`), not printed as a
clean zero.

## The history answer

`{ "history": true }` returns the persisted run history as a JSON page:

- `runs` — completed runs, newest first, bounded by `limit` (default 20);
- `findings` — the persisted lead rows, capped at 200 per page;
- `findingsTotal`, `findingsShown`, `findingsTruncated` — the page and its true
  total;
- `summary` — state counts over the whole persisted set;
- `census` — `{ runsTotal, runLimit, findingsTotal, findingsShown, findingsBeyondCap }`.

Each persisted row carries the fingerprint, rule, title, severity, evidence,
location and the state history tracks. `recordRun` persists with the stored lead
id as fingerprint, so a re-run reports repeats rather than duplicating records.
The page is a record of what a run persisted, not a fresh scan — which is why it
carries no banner.

## The recorded run

`{ "recordRun": true }` is bb_security's one write. It reads the store's census
and persists it into the analysis-history tables, then renders the citation
above. The identity rule is what makes the history useful: fingerprint =
`m72:<stored lead id>`. Severity is not part of it (re-grading a lead is a
repeat, not a new record), and a line move does not change the id, so it does
not create a new record either. A lead absent from the new census is resolved by
`completeAnalysisRun`, which is why the snapshot must be the census rather than
the display page.

## Read/write boundary

Reads are read-only in the filesystem sense: the index is opened with the
driver's read-only mode, so a read runs no migrations and moves no WAL. An
unindexed project is refused by name at every door — MCP, CLI (`bb tool
bb_security`) and the library (`createToolHandlers`) — because the handler
performs a read-only preflight before it reads; a read never creates an index.
A read-only handle also never runs the DDL for the M72 table, which is why a
pre-M72 index gets the declared uninitialized answer instead of a silent empty
store.

`recordRun` is the one write. It stores analysis-history rows, and because it
opens the database for writing it may also run the additive open-path migrations
every write path runs. No source file is ever modified.

## Staleness

Leads are resolved against the index's file metadata. A lead whose file changed
after indexing is marked `[stale]`, and the answer carries a footer of the form
`N stale, M missing of K referenced file(s)` followed by the **manual** repair
command: `bb index --changed` (or the `bb_index` tool with the project path —
incremental, changed files only). Nothing stale means no footer at all.

This tool does not auto-refresh and has no `refresh` option. A read does not
reindex a file to make an answer fresh; the flags and the footer describe the
index as it stands.

## Vulnerability-type normalization

M72 leads carry the spec's vulnerability id directly (`sql_injection`,
`command_injection`, `xss`, `path_traversal`, `insecure_deserialization`,
`ssrf`, `open_redirect`, `code_execution`, …); the store does not rewrite it.
The legacy `brain_taint_flow` rows were normalized at the engine boundary
(`sqli`/`sql` → `sql_injection`, `rce` → `code_injection`,
`xss_reflected`/`xss_stored` → `xss`, `cmd_injection`/`cmdi` →
`command_injection`, `lfi` → `path_traversal`, `pii` → `pii_leak`); that
normalization applies only to the legacy path.

## Modes

**One executable mode: `findings`.** The registry keeps that mode name; the
answer it produces is a lead page. There is no per-mode dispatch. `flow`,
`summary` and `hotspots` are **planned, not executable**: they are declared in
the registry's `plannedModes` (not `modes`) and the generated page marks them as
roadmap. Planned modes are `flow`, `summary`, `hotspots`.

Options honoured by the typed legacy engine API: `minConfidence`,
`includeMitigated`, `includeUnresolved`, `maxResults`. None are exposed on the
`bb_security` MCP schema (which accepts only `history`, `recordRun`, `limit`,
`offset`); they are reachable from the typed API, not from the agent-facing
tool.

## What the tool does NOT detect

Stated explicitly, because a security answer is misread in exactly these places:

- **Data flow across statements or functions — not implemented.** The engine
  proves only that a source-derived value reaches a sink argument inside one
  symbol through a bounded assignment chain. Interprocedural flow, cross-symbol
  stitching and cross-language proof are not modelled; the lead answer says
  this on its first line rather than in a footnote.
- **Hardcoded secrets — not implemented.** No writer emits any secret
  vulnerability type. The legacy `sensitive_data` taint *source* rule marked a
  symbol as a data source; it never produced a lead. A `hardcoded_secret` rule
  exists in the pattern engine and is reported by `bb_patterns`, a different
  tool.
- **Cross-language taint is not a language comparison.** On the legacy path the
  `crossLanguage` field is `cross_language_boundaries > 0`, and the only legacy
  writer of a non-zero value set the column to the constant `1` for any flow
  stitched across a `brain_relationship` edge. Read it as "stitched across
  symbols", not "crosses languages". M72 leads carry no such field.
- **Weak crypto is not a lead.** `weak_crypto` is a *sink*; a spec lead requires
  a co-located source reaching the sink argument. A standalone `md5(x)` has no
  source, so it produces no row.
- **Languages outside the `leads` tier — not analysed.** The 17 `unsupported`
  languages are stated as "not scanned by bb_security"; they are never reported
  as a clean zero.
- **Not every `leads`-tier language is wired yet.** A language with no loaded
  spec stores nothing and the store declares the skip (`no_spec`); the tier
  declaration still names the language's tier. Phase 2 wires the remaining
  specs and fixtures.
- **It is not runtime testing or a penetration test.** Nothing is executed and
  no exploit is attempted.
- This tool reports **project-code** leads. Hardening of the MCP server itself
  is a separate concern and is not mixed into these results.

## Verification

The M72 engine and store have their own verifiers, and the legacy suite still
gates the legacy path:

- `script/m72/engine/run.ts` — the engine unit matrix: self-pair rejection,
  comment/string masking, constant-argument exclusion, sanitizer/parameterized
  exclusion, same-symbol reachability, deterministic ordering.
- `script/m72/verify-security-engine.ts` — runs that matrix and reports its real
  exit code; absent engine tests are a declared skip with a path and a reason,
  never a silent pass.
- `script/m72/store/run.ts` — the store proof on a temporary project: a lead is
  persisted to `brain_security_flow` with its stable id and evidence; editing
  the sink away deletes the old row on reindex; moving the function keeps the
  same id; a second file's row survives the first file's reindex; test files and
  spec-less languages are skipped explicitly; the legacy writer is off by
  default (`brain_taint_flow` stays empty).
- `script/m72/verify-security-matrix.ts` — one row per language with the tier
  contract, reconciled against the registry; an unsupported language must answer
  "not scanned", never a clean zero, and any lead line must use the demoted
  grade/lead/evidence shape.
- `script/m72/verify-security-fixtures.ts` — the per-language fixture oracle: for
  every `validation/m72/fixtures/<language>/` it runs the real engine over the
  vulnerable, clean and sanitized files and asserts the vulnerable one emits the
  README's declared `Expected lead: <vulnerability> rule=<rule id>`, while clean
  and sanitized emit **zero**; a missing expectation is a failure, not a skip, and
  a mutated expectation is the negative control that proves the gate can go red.
  Current result: 39 languages, 39/39 PASS.
- `script/m72/verify-security-phase0.ts` — the static Phase-0 honesty contract:
  lead-generator wording, the tier baseline, the banner/tier/per-project answer
  strings, and the public claim files. It also asserts the real-corpus
  `parameterized-sql-negative` case: the pre-M72 evidence recorded a parameterized
  safe query as a `[critical] SQL injection` with `pass: true`, which this gate
  reported as a KNOWN-GAP until the corpus was regenerated with the M72 engine;
  it now passes on evidence (37/37 checks, 0 KNOWN-GAP).
- `script/m72/lib/security-answer-contract.ts` — the shared answer-contract
  helper those gates read instead of re-spelling the strings.
- `docs/m72-security-rebuild/PLAN.md` §6 also names
  `verify-security-answer.ts` and `verify-security-store.ts`; those are part of
  the same planned set and are being added by the gates workstream.

The legacy suite remains runnable for the rollback path: the m13 contract,
handler, adversarial and docs verifiers; the m15 deep, precision and regression
verifiers; the m20 flow-boundary, adversarial and history verifiers; the m17
corpus/history gates; and `script/verify-security.ts` end to end. Their evidence
records live under `validation/`, and the release-grade real-corpus record is
`validation/tools/bb_security/REAL-CORPUS.json` (five repositories — TypeScript,
Ruby, Erlang, Python and C — indexed in isolation and scanned through the real
MCP stdio door).

## Safe interpretation

The stored leads are **indexer heuristics**, not verdicts: token matching inside one symbol is not a data-flow proof, and a rule can be wrong for an idiom it does not model. Treat an `[exec]` lead as a place to look first, especially in
the languages whose specs are newest. A reading that a lead is not exploitable
is expected behaviour, documented above — not a defect. The tier line tells you
which half of the contract applies to the project you are reading: `leads` means
"validate these by hand", and `unsupported` means "not scanned at all".
