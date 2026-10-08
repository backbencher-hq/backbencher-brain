# AMBIG_IMPORTS_DEF — the imports-edge contract, defined and measured

Lane: `analyzer/AMBIG_IMPORTS_DEF` · analyzer: `src/ast/real-go-analyzer.ts` (lane-owned)
Corpus: `go-stdlib` @ `6f5c275e` at `$HOME/fixtures/repositories/go-stdlib`

Every number below is re-derived by the commands in §7, through the production path
(`ASTEngine.parseFile` → `getParser("go")` → `getAnalyzer("go")` → `RealGoAnalyzer.analyze`).

---

## 0. JOB 1 baseline — firing-check-v2, recorded before any change

The brief's command names the lane `AMBIG_IMPORTS_DEF`; `firing-check-v2.mjs`'s own lane
resolver rejects it and exits 2 with the list of lane keys (the instrument refuses an
unmatched lane by design — "an unmatched lane used to print an empty table and
`unmeasured: none`, which reads as success"). The lane key for this analyzer is `GO`.

```
cd $HOME/backbencher-brain && NFILES=200 bun script/m14/firing-check-v2.mjs GO
```

| | value |
| --- | --- |
| relationship channel | **10 of 10 fired**, 0 silent |
| parsed | 200 / 200 |
| off-enum types emitted | none |
| `imports[]` (the separate channel) | **781 entries in 183 files** |

Both vocabularies agree at this commit: `types.ts` and `engine.ts` both read `imports`
(see §5, item 1 — the divergence the review reported is not present on this tree).

`firing-check-v2.mjs` hardcodes `REPO = $HOME/backbencher-brain`. At this lane's
start that checkout was on `main` at the SAME commit (`1a19e8a5e`) with a byte-identical
analyzer blob, so the measurement is of this lane's tree. Re-verified, not assumed: the
analyzer file md5s equal across the two checkouts. **Any later run must re-check that,
because the moment the main checkout moves the number stops describing this branch.**

Per-type relationship-channel counts at NFILES=200 (the draw `firing-check-v2` chose —
`src/strconv/*_test.go`, i.e. test files, which is a sampling artefact of its
directory-walk order and not a corpus property):

```
calls:6718  uses:3890  references:3010  contains:1216  instantiates:850
imports:781  exports:736  extends:41
```

`implements` and `overrides` fire but fall outside the top-8 the instrument prints; §2
measures every type over the whole admitted population rather than this 200-file draw.
