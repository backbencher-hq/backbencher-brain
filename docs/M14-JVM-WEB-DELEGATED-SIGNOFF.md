# M14 JVM/Web delegated sign-off record

Status: delegated owner authorization recorded; no personal owner execution is claimed.

Authorization: on 2026-08-28, the project owner authorized the agent to sign on the owner's behalf for the JVM and web analyzer issues listed below.

This record is a governance disposition, not a substitute for machine-emitted evidence. Supporting machine evidence remains under `validation/m14/results/`.

## Scope

| Issue | Analyzer | Fixture rerun | Delegated disposition | Discrepancies |
|---|---|---:|---|---|
| #251 | Java | 31/31 pass | delegated sign-off authorized | none observed |
| #252 | Groovy | 34/34 pass | delegated sign-off authorized | none observed |
| #253 | Kotlin | 35/35 pass | delegated sign-off authorized | none observed |
| #254 | Scala | 36/36 pass | delegated sign-off authorized | none observed |
| #255 | TypeScript/TSX | 45/45 pass | delegated sign-off authorized | none observed |
| #256 | JavaScript | 37/37 pass | delegated sign-off authorized | none observed |
| #257 | Vue | 14/14 pass | delegated sign-off authorized | none observed |
| #258 | Svelte | 18/18 pass | delegated sign-off authorized | none observed |

## Supporting gates

The delegated review relied on the following passing machine checks and their recorded limitations:

- `M14.0.F1.json` — grammar audit evidence.
- `M14.0.F2.json` — evidence-harness validation evidence.
- `M14.0.F3.json` — fixture evidence.
- `M14.0.F4.json` — mutation evidence.
- `M14.0.F5.json` — differential evidence.
- `M14.0.WC1.json` — web-cluster E2E evidence.
  *Cited as `M14.0.F8.json` until 2026-09-12: `M14.0.F8` belongs to the
  corpus-census gate (the ledger's F8 definition and `verify-honesty.ts`'s own
  F8 comment), so every `audit:cluster` run destroyed the census evidence. It now
  has its own id (M49 W8; see `script/m49/verify-evidence-identity.ts`).*
- `M14.0.SPEC.json` — completeness A–H evidence.
- `M14.CC1.json` — cross-language consistency evidence.

The fixture reruns used the repository's official `owner-spot-check.ts` helper with three sampled claims per analyzer; the full fixture counts above were also observed during the official fixture gate.

## Limitations and honesty boundary

- This is delegated verification authorized by the project owner; it must not be described as the owner personally executing the samples.
- The record does not close the entire M14 milestone. Other analyzer families and explicitly pending ledger cells remain outside this scope.
- GitHub issue state is external to this repository and is not changed by this artifact.
- Declared analyzer limitations remain those recorded in the referenced M14 evidence and completeness artifacts.
