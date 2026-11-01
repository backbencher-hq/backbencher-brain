# `script/` — the verification and measurement machinery

This directory is larger than the product source because the repository treats every claim as something a
script must be able to falsify. It contains **gates** (pass/fail contracts), **instruments** (measurement
probes that print numbers), **fixtures**, and the **curation sources** for generated documentation.

## Where to start

- `script/verify-*.ts` (top level) — gates for shipped surfaces: engine, schema, tool registry, public surface,
  indexer, embeddings, CLI, docs. `npm test` runs the first four.
- `script/mNN/` — milestone gates and instruments. Run the gate named in a page when you change what it
  measures; they are not all part of the default suite. `script/m62/verify-suite.mts` (`npm run verify:suite`)
  is the suite runner.
- `script/m14/` — the analyzer campaign: per-language specs (`spec/`), fixtures (`fixtures/`), differential and
  mutation instruments, the fleet guard matrix (`verify-fleet.ts`), and the analyzer documentation gate
  (`verify-analyzer-docs.ts`). Most of it is the evidence behind `docs/analyzers/`.
- `script/m60/` — the grammar/lane survey generators and their gate (`build-grammar-survey.ts` reads the one
  shared declaration parser in `grammar-lanes-source.ts`).
- `script/tool-docs/curation/` — the hand-written curation inputs for `docs/tools/` and
  `docs/data/public-tools.json`. **Edit here, then regenerate** (`npm run docs:generate`); never edit the
  generated output. `script/verify-tool-docs.ts` is the gate.
- `script/perf/` — bounded measurement probes (latency, phases, storage). They print figures; they are not
  gates unless the file says so.
- `script/lib/` — shared harnesses used by more than one gate.
- `script/git-hooks/`, `script/fixtures/` — hook installers and shared fixtures.

## Conventions every gate follows

- A `check`/`negative` counter, one `ok:`/`FAIL:` line per assertion, exit 1 when anything fails.
- **Negatives are mandatory**: where possible, a gate also shows a mutation that makes it fail, so a green gate
  is evidence it can go red.
- Results are written under `validation/`; the gate header names the population, command and method. Never edit
  those result files by hand — re-run the gate.
- Runtime: most gates run under `npx tsx` (Node). Some are Bun-specific (`bun script/...`); pool-worker gates
  exercise Node `fork`/`worker_threads` semantics and print an explicit runtime note when run under Bun.
- Gates that need a writable data directory use `BB_DATA_DIR` (default `~/.bb` is read-only in some sandboxes),
  and gates that need a corpus say so.

## Adding a gate

Put it where its milestone lives (`script/mNN/verify-<topic>.ts`), give it a header comment stating why it
exists, what it measures and what a green run is worth, make at least one negative case demonstrate that it can
fail, wire it into the owning milestone's governance/closure gate if that gate lists its suite, and commit the
result artifact it writes with your change.
