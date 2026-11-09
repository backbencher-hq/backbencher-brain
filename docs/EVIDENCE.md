# Evidence

<!-- Author: Muhammad Ishaq Khan -->
<!-- Public evidence policy. Sealed records live in this repository; the raw material
     behind them is published as a release asset. A claim points at a record; the record
     points at this document for its raw inputs. -->

Every claim in this project is backed by a record. The records live in the repository
under `validation/**/results/` and are the files the gates read; the raw material that
produced them (measurement dumps, verification logs, generated corpora) is large and
does not belong in git, so it is published as one archive per release.

## What is in the repository

- `validation/<lane>/results/**` — sealed records: `{ status, checks, currentCommit,
  generatedAt, ... }` written by the verifier scripts. A record whose inputs changed
  since it was written is *stale* and is not read as a pass; the gates refuse it.
- `docs/m*/` — each lane's plan, findings and closure documents.
- `docs/m29/PRECISION-LEDGER.md` — the per-language claim table: claim level, feature
  matrix, measured latency, analyzer precision and the evidence path behind each row.
- `validation/**/fixtures/**`, `validation/**/measurements/**`,
  `validation/**/verification/**` — **not** in the public repository. They are in the
  release archive below.

## Fetch the raw material

```bash
VERSION=0.1.0
curl -fsSLO https://github.com/backbencher-hq/backbencher-brain/releases/download/v$VERSION/evidence-$VERSION.tar.zst
curl -fsSLO https://github.com/backbencher-hq/backbencher-brain/releases/download/v$VERSION/evidence-$VERSION.tar.zst.sha256
sha256sum -c evidence-$VERSION.tar.zst.sha256
tar --zstd -xf evidence-$VERSION.tar.zst
```

The archive extracts to `validation/` and restores the excluded paths at the release's
tag. Verify the checksum before extracting: the archive is the raw input to a sealed
record, and an unverified archive is not evidence.

## Running the chain

```bash
npm ci && npm run build     # builds dist/ and fetches the grammar wasm
npx tsx script/m53/verify-r1-ladder.ts --resume   # the lane ladder (M24-M44)
npx tsx script/m53/verify-closure.ts              # M53 closure
npx tsx script/m55/verify-governance.ts           # M55 bar audit
npx tsx script/m55/verify-closure.ts              # M55 closure
```

A gate that needs a raw input which is absent must report a **declared blocked read**
(naming the missing path), never a silent pass. That rule is enforced by the gates
themselves: absence is declared, and a record whose relevant inputs are missing is
reported as `known-gap`, not `verified`.

## What the numbers mean

Claim levels follow `docs/IDE-HONESTY-CONTRACT.md` §2: I0 unverified, I1 protocol-passed,
I2 cross-checked, I3 editor-verified, I4 fork-verified, I5 scoped-verified. A language
listed in the launch set is either editor-verified or carries a sealed disposition that
names why the surface is limited; it is never counted as verified for a surface that was
not measured. `docs/KNOWN-ISSUES.md` records the limitations the current release ships
with.
