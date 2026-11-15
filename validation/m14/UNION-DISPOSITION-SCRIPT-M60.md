# `script/m60` — 23 PATHS DISPOSITIONED, **ALL 23 KEEP HEAD**, EACH FOR A NAMED REASON

**And the dominant reason is the class this session spent hours sizing**: *main carries the hardcoded
`/home/ishaq2321/backbencher-brain` literal in **18 of the 23**, and HEAD carries the portable
`fileURLToPath(import.meta.url)` form.* **So the disposition is not a preference — it is the migration.**

## THE MEASUREMENT, PER PATH

    HEAD portable / MAIN hardcodes the literal         18 of 23   ->  KEEP HEAD
    both literal                                        3
    neither literal                                     2
                                                        --
                                                        23

## AND THE THREE "BOTH LITERAL" ARE HEAD'S FIX TOO — WITH THE INCIDENT WRITTEN IN THE FILE

**`php-line-contract.ts`** — *HEAD adds the import and this comment, which names the defect exactly:*

> ***"ROOT is the CHECKOUT this script ships in, derived from the script's own location rather than written down. It used
> to be the literal `/home/ishaq2321/backbencher-brain`, which is a path a lane worktree does not have — so on
> `…/mcp/backbencher-brain` this gate DIED ON ITS FIRST IMPORT (`Cannot find module …/src/ast/engine.ts`) and the lane
> had no line-contract reading at all WHILE READING AS 'NEVER RUN'. An instrument is…"***

**`php-oracle-independence.ts`** — *the same fix, with the one-line verdict:*

> ***"The checkout this script lives in, not a literal path — see `php-line-contract.ts`. A GATE THAT CANNOT START ON THE
> MACHINE IT IS COMMITTED TO IS NOT A GATE, and the hardcoded `/home/ishaq2321/backbencher-brain` made this one
> load-bearing on a directory that does not exist in a lane worktree."***

**`verify-lua-output-coverage.ts`** — *HEAD carries the note that the output path reads `ROOT` explicitly and **must not be
spelled with `REPO`, because `REPO` is a corpus repo name, not this project.***

## AND THE TWO "NEITHER LITERAL" ARE DECIDED BY OTHER AUTHORITIES

**`routing-outlier-census.ts`** — *HEAD has `sass: { relation: "other-format", lang: "sass" }`; main has `lang: "css"`.*
**AND THE ROUTER IS THE AUTHORITY**: `src/ast/language-detection.ts:78` reads **`scss: "scss", sass: "sass", less: "css"`** —
*so `sass` routes to `sass`, and main's `css` is wrong.* **This is one of the 23 router extensions fixed in this
programme, and the census table has to agree with the router it measures.**

**`yaml-mutants.ts`** — *HEAD has **122 lines main lacks**, and they carry the reasoning:*

> ***"The materialized-action re-route REVERTED. A `./D` target whose directory a prior same-job checkout materializes
> goes back to the literal path with `isExternal: true` — **the claim the fix replaced**, where a path the RUNNER creates
> is stated as an external name the arbiter can…"***

**SO HEAD HOLDS A REVERT WITH ITS REASON, AND MAIN HOLDS THE CLAIM THE REVERT UNDID.**

## AND THE SHAPE OF THIS BATCH IS THE SHAPE OF THE WHOLE UNION

**EIGHTEEN OF TWENTY-THREE ARE THE SAME DEFECT**: *a gate that **cannot start on the machine it is committed to**, and
**reads as "never run" rather than as broken.*** **That is the sixth instance this session of an instrument that reports
nothing while looking fine** — *after the corpus leg over a misspelled directory, the verifier dying at load, the probe
battery on `__dirname`, the census that dropped repo-root files, and the retarget verifier that could not run its own
SELECT.* **And the write-guard finding in this same family — 1,693 lines of evidence deleted by one flag — says the same
thing from the other side.**
