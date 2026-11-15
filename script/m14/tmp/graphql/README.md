# The GraphQL lane's evidence

Every number in `docs/analyzers/graphql.md` and in `REVIEW.md` is
produced by a probe in this directory, and `probe/doc-truth.mts` fails if a
documented number and its artifact disagree. That only means anything because the
probes are **here, in the repository**.

They used not to be. The lane lived in `/home/ishaq2321/bb_tests/graphql`, which
is not a git repository, so a clone had no probes, no ground truth and no
artifacts, and all 42 documented claims were unverifiable from a checkout. The
hcl lane's commit message states the rule this directory exists to satisfy:

> a probe lives in a TRACKED location so the next reader can re-run it

## Running it

```sh
./script/m14/tmp/graphql/run-all.sh            # gates 1-6, 11
./script/m14/tmp/graphql/run-all.sh --corpus   # + 8, 8b, 8c, 8d, 9, 10, 10b
```

`BB_ROOT` overrides the repository root and `GQL_CORPORA` the corpus location.
Nothing else is configurable, and nothing hardcodes a path: `paths.mts` derives
this directory from its own location and the repository root from that.

**It runs from a clean checkout**, and with no corpus at all: the artifacts are
tracked, so all 44 documented claims are verifiable without fetching anything.
That is the property the whole move was for, and it was proved by running the lane
in a `git worktree` rather than by asserting it — which is also how two claims that
read a cross-lane artifact the lane cannot regenerate were caught.

**The one input you must fetch** is the third-party corpus — 1.2 GB of cloned
`graphql-js`, `graphiql` and `neo4j/graphql` checkouts, deliberately untracked.
`clone.sh` fetches it and `repositories.json` records the exact revision of each,
so a measurement can be re-run and get the same bytes. Gates 8, 8b and 9 need it;
the rest do not, and `run-all.sh` says so rather than silently measuring nothing.

## The gates

| # | gate | what it holds true |
|---|---|---|
| 1 | `probe/no-text-scan.mts` | zero regex, no structural text scan; **2 negative controls** |
| 2 | `probe/grammar-census.mts` | every node type the grammar produces |
| 3 | `probe/grammar-gaps.mts` | 113 specification constructs: 0 valid rejected, 8 invalid still rejected |
| 4 | `probe/contract-battery.mts` | 59 hand-audited cases |
| 5 | `differential/differential.mts` | 377 hand-derived facts over 8 fixtures, P=1.000 R=1.000 |
| 6 | `differential/mutation.mts` | 43 mutants, 37 caught, **0 survived, 0 unapplied** |
| 8 | `probe/corpus-sweep.mts` | 47 real files: 0 phantoms, 0 duplicate identities |
| 8b | `probe/project-resolution.mts` | every relationship at **project** scope, **sources included** |
| 8c | `probe/master-relationships.mts` | all 15 referenceable families, each provoked then required |
| 8d | `script/m14/run-fixtures.ts --lang graphql` | the lane's three m14 fixtures, run **scoped** so no milestone evidence is written |
| 9 | `probe/extraction-ab.mts` | the wired grammar against the one it replaced |
| 10b | `probe/perf-interleaved.mts` | the counted accessor budget — fails if the O(n log n) walk returns |
| 10c | `probe/declared-type-roundtrip.mts` | the R9 relabel moved labels, not facts: tree-derived set vs emitted set, both directions, **0 fabricated / 0 lost** over 7,890 |
| 10d | `probe/ontology-census.mts` | all ten types through production `parseFile`: 426 files, 34,023 edges, the grammar inventory, the parse-tree probes, per-type resolution, the constructibility block |
| 11 | `probe/doc-truth.mts` | every documented number in the analyzer doc AND in `reviews/graphql/master-review.md`, re-derived from its artifact |

Gate 11 runs **last** and that ordering is load-bearing: it reads four artifacts
(`corpus-sweep`, `project-resolution`, `perf-accessors`, `extraction-ab`) that
gates 8, 8b, 9 and 10b produce. It used to be gate 7, which passed only because
those artifacts were left over from an earlier run — so on a clean checkout the
one gate whose job is to catch a stale claim was the gate that could not run.

## What is an input and what is an output

`fixtures/` and `fixtures-constructs/` are **inputs** — hand-derived truth and a
file written to provoke every family. `out/` holds generated artifacts and is
tracked, because the documents cite them by path. `baseline/` holds the
pre-optimisation analyzer the interleaved A/B compares against, and
`grammar-rebuild/` the grammar the wired one replaced, kept byte-for-byte
(`9cd70f69…`) so the A/B is reproducible rather than remembered.

## Two habits worth keeping

**A gate that cannot fail is not a gate.** Every gate here has a negative control
that has been *run*: removing the `directive_argument_type` edge makes 8c report
`MISS` and exit non-zero; an unresolvable source makes 8b report 30 and exit
non-zero; a stale mutant anchor makes 6 exit non-zero with `UNAPPLIED=n` rather
than quietly reporting a no-op as a survival. Two of these controls failed to fail
on their first attempt, and both times the instrument — not the analyzer — was
what was wrong.

**Do not derive truth from the implementation.** `fixtures/ground-truth.json` is
authored from the specification and the fixture source, line by line, and says so
in its own `authored` field. When the master review found three missing
relationship families, the analyzer was right and the *ground truth* was
incomplete — and each added row was verified against the source, never by accepting
analyzer output.
