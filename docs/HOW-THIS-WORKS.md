# How this works

An orientation to `backbencher-brain` — what it is, how it is put together, how
the verification regime actually works, and what is honestly true right now.

Written for the owner. Everything in here is either a fact you can check with a
command given alongside it, or it is explicitly labelled as not established.

---

## 1. What this is

`bb` indexes a codebase into a SQLite graph of **files, symbols and
relationships**, then answers questions about it through five surfaces: a CLI, an
LSP server, an MCP server, editor packages, and the gate suite that verifies the
product itself.

The unusual part is not the code intelligence. It is that **almost nothing in
this repository may be claimed without a gate that can fail.**

Check it yourself:

```bash
node bin/bb --help          # the CLI surface
node bin/bb stats           # index counts
node bin/bb doctor          # read-only health report
```

---

## 2. The five surfaces

| Surface | Entry point | What it is for |
|---|---|---|
| CLI | `bin/bb` → `src/cli/` | `bb tool <name> '<json>'` runs any tool directly |
| LSP | `src/lsp/` (24 files) | hover, definition, references, symbols for editors |
| MCP | `src/mcp/` | the same tools over Model Context Protocol |
| Editors | `ide/helix`, `ide/vscode`, `ide/zed`, `ide/lsp4ij` | packaging + launchers |
| Gates | `script/` (624 `verify-*` scripts) | prove the first four work |

```bash
ls ide                                  # the four shipped editor targets
ls src/lsp                              # the LSP implementation
find script -name 'verify-*.ts' | wc -l # 624 gates
```

---

## 3. How the engine works

```
source files
    │  src/ast/        (98 files)  tree-sitter parse, per language
    ▼
AST
    │  src/ast/parallel-indexer.ts   concurrent walk, writes to SQLite
    ▼
brain.db   ← src/storage/, src/brain/ (query layer)
    │
    ▼
graph queries  ← src/intelligence/ (33 files)  graph-engine.ts
    │
    ├─→ LSP    (src/lsp)
    ├─→ MCP    (src/mcp)
    └─→ CLI    (bin/bb)
```

The graph engine is what the LSP sits on. `graph-engine.ts` answers
`outgoingCalls`, callers, callees, and similar walks directly in SQL — this is
why an LSP request is milliseconds rather than a re-parse.

**Your index right now** (`~/.bb/projects/<hash>/brain.db`):

```bash
DB=~/.bb/projects/064be526733c31e95c0ac2beb42d209af9bab8e6/brain.db
sqlite3 "$DB" "select count(*) from brain_symbol"        # 10463
sqlite3 "$DB" "select count(*) from brain_relationship"  # 62043
sqlite3 "$DB" "select count(*) from brain_taint_flow"    # 1438
sqlite3 "$DB" "select count(*) from brain_file"          # 202
```

All tables are prefixed `brain_`. The index covers **this repository only** —
202 files, all TypeScript. The "40+ languages" claim in the CLI help refers to
grammars the indexer supports, not to what is currently indexed here.

> Copying `brain.db` on its own reads a **stale schema** when a WAL file exists.
> Copy `-wal` and `-shm` alongside it. This bit during development.

---

## 4. The verification regime

This is the part worth understanding, because it shapes everything else.

### Milestones and ledgers

Work is grouped into milestones (`M25`, `M26`, … `M63`, plus `mA`). Each has a
directory `validation/m<N>/` holding its **evidence**, and most have a **ledger**
(`results/manifest.json`) listing every issue in that milestone.

```bash
ls validation | head -20        # the milestones
cat validation/m25/results/manifest.json | head -40
```

A ledger row is one issue. Its `status` is the claim; its `evidence` is the
receipt.

### The four statuses, and what each one demands

This is the heart of it. The bar differs by status, deliberately, because one bar
for all four would make honest states unrecordable — and an unrecordable honest
state gets laundered into a false claim.

| Status | Means | Must have |
|---|---|---|
| `planned` | not started | nothing |
| `verified` | it works | green run **and a can-fail proof** |
| `known-gap` | it ran and something failed | green *or* failing run, plus **the reason** |
| `blocked` | it could not run at all | the reason; **no passes required** |

Two rules here were defects until 2026-10-08 and are worth knowing about:

- **`verified` needs a can-fail proof.** Not "the gate passed" — proof the gate
  *can* fail. Either `negativeCases > 0` (the gate deliberately plants defects
  and confirms they are caught) or a fully-caught mutant set
  (`mutantsCaught > 0 && mutantsCaught === mutantsTotal`). A gate that cannot
  fail has verified nothing.
- **`blocked` must not require passes.** A blocked leg is one that *could not
  run* — "cursor CLI not found on PATH", "no Linux hardware". It has zero passes
  by definition. Requiring `passed > 0` made an honest blocked row
  impossible to record, which pushes you to either fake a pass or drop the
  reason. `known-gap` still demands passes, because `known-gap` means it ran.

The rule lives in `isClosable()` in `script/m25/verify-governance.ts`:

```bash
grep -n -A40 'function isClosable' script/m25/verify-governance.ts
```

### Sealed evidence

Every evidence file carries a `bbSeal` — a hash binding its content to the
commit it was produced at. A reader that cannot verify the seal **refuses the
record** rather than trusting it. So an evidence file cannot be quietly edited
after the fact.

```bash
npx tsx script/m62/verify-ledger-reseal.ts    # 13 legs, PASS
```

### Projections

A governance gate does not just check the ledger, it **rewrites** it: each row's
status is projected from its own evidence record, so the ledger cannot drift from
what actually ran. The projection is idempotent — running the gate twice
converges, it does not oscillate.

```bash
grep -n -B2 -A6 'postLabel' script/m61/ledger_gate_wiring.ts
```

### The vocabulary ban

Contract §1 bans words like "production-ready", "battle-tested", "rock-solid"
and "complete" from milestone artifacts. The reasoning: a ledger that *claims*
those is lying about what was checked. The lint is scoped to prose fields and
deliberately does not scan `blockedReason`, which is machine-derived and quotes
gate output verbatim — otherwise the lint matches its own pattern text and can
never pass.

---

## 5. How to check things

```bash
export PATH="$HOME/.local/node/bin:$PATH"   # node is not on the default PATH

npm run typecheck                             # tsc --noEmit — src/ ONLY, see below
npm run typecheck:scripts                     # the gate suite's typecheck ratchet
npx tsx script/m25/verify-governance.ts       # a milestone governance gate
npx tsx script/m62/verify-path-encoding.ts    # a focused gate
npx tsx script/m62/reseal-ledger.ts validation/m25/results/manifest.json --apply
```

> **`npm run typecheck` does not check the gates.** `tsconfig.json` includes
> `src/**/*.ts` and nothing else, so `tsc` never loads a file under `script/`.
> Proven on 2026-10-08: a gate file containing
> `const n: number = "not a number"` and a call to a function that does not exist
> left `npm run typecheck` reporting **0 errors**. Every "tsc clean" ever said
> about a gate was vacuous.
>
> `script/m60/verify-script-surface.ts` found this on 2026-09-25, and
> `script/m14/verify-script-typecheck-baseline.ts` ratchets `script/m12` + `m14`
> (716 errors worked down to 180). The rest — m11, m13, m15–m63, `lanes/`,
> `incoming-*`, about 3,000 files — had no typecheck and no ratchet at all.
> `npm run typecheck:scripts` now covers those, tracking **765 errors across 219
> files** so the number can only shrink. A pass there means *no file got worse*,
> not that the scripts typecheck, and it prints that in as many words.
>
> The most alarming number in this document: **one unparseable file in the program
> makes `tsc` report 0 semantic diagnostics instead of 521.** `tsc` emits syntactic
> errors and then drops semantic checking for the entire program. Every ratchet
> would pass. Both gates that count type errors therefore plant a canary and
> refuse to publish a verdict if it does not come back.

A gate that cannot fail is worse than no gate, because it is believed. Every
gate written in this regime carries at least one negative: a leg that plants a
defect and requires the gate to notice. The path-encoding gate is the clearest
example — it plants a defect in a real directory, requires the walk to find it,
and separately fails if it read **zero** files:

```bash
npx tsx script/m62/verify-path-encoding.ts    # 22 legs
```

That last pair of legs exists because the gate was briefly green while examining
nothing: `readdirSync` had never been imported into the scan module, the walk's
`catch { return out }` swallowed the `ReferenceError`, and an empty result read
as a clean repository. **A green gate that examined zero files is worse than no
gate**, because it gets believed.

---

## 6. What is true right now

Verified this session, re-runnable:

| Claim | Gate | Result |
|---|---|---|
| Module URLs are decoded everywhere | `script/m62/verify-path-encoding.ts` | PASS, 5628 files, 0 defects |
| Ledger rows are re-derivable from evidence | `script/m62/verify-ledger-reseal.ts` | PASS |
| Extension packaging | `script/m25/verify-packaging.ts` | 56/56, 5/5 mutants |
| Extension skeleton / auto-index / status surface | `verify-extension-skeleton`, `verify-auto-index`, `verify-status-surface` | 44/44, 43/43, 32/32 |
| Type safety | `npm run typecheck` | 0 errors |

**Not established — real open defects, each with a gate that shows it:**

| Defect | Where you see it |
|---|---|
| Usage link has no index-backed `file:line` target | fails in `script/m25/verify-harness-core.ts` **and** in the VS Code in-editor run |
| Budget gate has no measurements for hover / definition / references / documentSymbol / workspaceSymbol | `verify-harness-core.ts` |
| Backup-copy import does not rewrite `project_id`; move rewrites 600 of 701 `brain_file.path` rows | `script/m23/verify-p3-edge-cases.ts` |
| No embedding provider configured, so semantic search falls back to local word vectors | `bb doctor` |

The last one is worth acting on: run `bb setup` and semantic search gets
measurably better. Until then it is a weaker fallback, and `bb doctor` says so.

---

## 7. Two things that will bite you

**This repository's path contains a space.** That is not incidental — it is why
a whole class of bug existed here and may never have shown up for you. A module's
own location is derived with `fileURLToPath(import.meta.url)`. The naive form,
`new URL(import.meta.url).pathname`, is percent-encoded, so `Default Project`
arrives as `Default%20Project` and every `existsSync` against it answers about a
directory that does not exist. 99 sites did this. The symptom was a gate saying
"VSIX not found", which reads like a missing build artifact — and in one case it
meant the gate **could not run at all**, so its checks were never evaluated.

**A gate that reports green for the wrong reason is the main hazard.** Two more
instances found in one session: a lint that matched its own pattern text, and a
check scoped so that five planted defects still read `ok`. Both looked fine from
the outside. Both were caught only by deliberately breaking something on purpose.

---

## 8. Where things are

```
src/            the engine (ast → brain → intelligence → lsp/mcp/cli)
ide/            helix, vscode, zed, lsp4ij
script/         624 gates, one directory per milestone
validation/     evidence, one directory per milestone
docs/           this file, ARCHITECTURE.md, per-tool references, UNMERGED-WORK.md
docs/IDE-OWNER-TEST-PLAN.md    the manual editor test steps
```

`docs/UNMERGED-WORK.md` inventories work that exists on other branches and has
**not** been merged.