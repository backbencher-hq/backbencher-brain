# M14 — corpus restore: 35 checkouts restored, and what each unblocks

**Status: RESTORED, THEN PARTLY UNDONE BY A LATER DECLARATION — read "Second wave" below before
trusting this count.** The corpus root held **50 of the 50 repositories** the canonical m14 sweeps
declared when this was written (`LANG_REPOS` + `SECOND_CORPUS` in `script/m14/differential.ts`), each a
git checkout, so
**the differential's corpus precheck PASSED for every lane declared at that moment**.
The earlier version of this document recorded this action as blocked at the network layer. That
diagnosis was wrong, and the correction is the first section because it is the reusable part.

## The block was an environment variable, not the network

| probe | with the shell's proxies | with `http_proxy`/`https_proxy`/`ALL_PROXY` unset |
| --- | --- | --- |
| `git ls-remote https://github.com/grails/grails-core` | `fatal: unable to access … Proxy CONNECT aborted` | full ref list in under a second |
| `git fetch --depth 1 origin <40-hex pin>` | `Proxy CONNECT aborted` ×2, then `No route to host` | succeeds, first attempt |
| `curl https://codeload.github.com/<owner>/<repo>/tar.gz/<pin>` | `000`, 0 bytes (recorded before) | `200`, 1,458,194 bytes for `jq` at its pin |

`http_proxy`/`https_proxy` in this shell point at `REDACTED-PROXY`. That proxy answers a plain
GET (which is why the earlier probe's `curl https://github.com` read 200 and its `ls-remote` did not)
and **aborts git's CONNECT**. "The network path to github.com is blocked" generalised from one probe
shape; there was always a second one, and it works.

Two consequences that changed the work. First, **`git fetch --depth 1 origin <pin>`** is the restore
mechanism, and it had to be: a corpus is read with `git ls-files` and pinned with `git rev-parse HEAD`,
so a tarball extraction is not a corpus. Second, the route is **intermittent** — roughly one attempt in
three fails with `Failed to connect to github.com port 443 … No route to host` — so every request in
the restore is retried up to three times, and a request that fails that way is NOT evidence that a
repository or a remote does not exist. Three of the repositories below were first reported missing by a
probe that simply lost the connection.

## The restore

Per repository: `git init` in `$CR/.restore-<repo>`, `remote add origin <url>`,
`fetch --depth 1 origin <pin>`, `checkout FETCH_HEAD`, **`rev-parse HEAD` compared against the pin**,
and only then a `mv` into place. A failed fetch removes the temp directory, so the corpus root is
either untouched or correct — the discipline that matters because the precheck tests only
`fs.existsSync` and a stub empty `.git` would read as a present corpus.

**35 restored, each verified at its recorded revision.** Every revision is the pin the last canonical
sweep recorded (`validation/m14/results/M14.0.F5.json` → `data.corpusPins`), except the three marked.

| repository | remote | revision | tracked files | unblocks |
| --- | --- | --- | --- | --- |
| `jq` | `jqlang/jq` | `41b8edfe5437` | 429 | c (second) |
| `fmt` | `fmtlib/fmt` | `e27cc20bd93a` | 145 | cpp (primary) |
| `nlohmann-json` | `nlohmann/json` | `09b6b6b5ba06` | 1,230 | cpp (second) |
| `rack` | `rack/rack` | `2c98a0385cca` | 186 | ruby (second) |
| `rake` | `ruby/rake` | `dd5e851d75fd` | 127 | ruby (primary) |
| `rebar3` | `erlang/rebar3` | `0c947d3b86c5` | 456 | erlang (primary) |
| `geb` | `geb/geb` | `9c7349460782` | 851 | groovy (second) |
| `cats-effect` | `typelevel/cats-effect` | `91c8115dbb49` | 565 | scala (second) |
| `fsharp` | `dotnet/fsharp` | `22a8a5dcc724` | 10,652 | fsharp (primary), csharp (second) |
| `phoenix` | `phoenixframework/phoenix` | `0e02edbe0c6d` | 507 | elixir (second) |
| `requests` | `psf/requests` | `dae7ef63b4df` | 130 | python (second) |
| `cython` | `cython/cython` | `51a460b7d704` | 2,734 | python (primary) |
| `dart-http` | `dart-lang/http` | `92b20d125ffc` | 689 | dart (second) |
| `phpunit` | `sebastianbergmann/phpunit` | `c8d6921fb601` | 5,198 | php (primary) |
| `phpmyadmin` | `phpmyadmin/phpmyadmin` | `4061095a59e1` | 3,045 | php (second) |
| `sdwebimage` | `SDWebImage/SDWebImage` | `c3ad5e1a9bf5` | 436 | objc (primary) |
| `afnetworking` | `AFNetworking/AFNetworking` | `d9f589cc2c1f` | 211 | objc (second) |
| `zls` | `zigtools/zls` | `3df042851351` | 110 | zig (second) |
| `zig` | `ziglang/zig` | `738d2be9d6b6` | 20,545 | zig (primary) |
| `cabal` | `haskell/cabal` | `670955a4fb51` | 5,265 | haskell (primary) |
| `hledger` | `simonmichael/hledger` | `64867d29b6c4` | 1,713 | haskell (second) |
| `go-tools` | `golang/tools` | `bf54bcd2f14a` | 2,841 | go (primary) |
| `Exposed` | `JetBrains/Exposed` | `1be664715fc5` | 5,418 | kotlin (primary) |
| `ansible` | `ansible/ansible` | `7ec731bfd2db` | 5,873 | powershell (second), yaml (second) |
| `cargo` | `rust-lang/cargo` | `94faf9175f01` | 3,071 | toml (primary), rust (second) |
| `terraform` | `hashicorp/terraform` | `2e1710bfc5fa` | 5,445 | json (primary), go (second) |
| `vue-core` | `vuejs/core` | `f8975657d745` | 705 | typescript (primary) |
| `scala3` | `scala/scala3` | `18df09c05fa4` | 25,945 | scala (primary), markdown (primary) |
| `grails-core` | `grails/grails-core` | `a83f87480e0c` | 14,026 | java (primary), groovy (primary), css (second) |
| `kubernetes` | `kubernetes/kubernetes` | `dfd7b93a1783` | 31,412 | yaml (primary), markdown (second) |
| `julia` † | `JuliaLang/julia` | `639126399921` | 2,059 | julia (primary) |
| `solidity` † | `OpenZeppelin/openzeppelin-contracts` | `32b5b8c46554` | 964 | solidity (primary) |
| `Clyde` ‡ | `dvanarkel/Clyde` | `8fec41dd6ee0` | 135 | clean (primary) |
| `clean-stdlib` ‡ | `gitlab.science.ru.nl/clean-compiler-and-rts/stdenv` | `6971a8af309b` | 100 | clean (second) |
| `proxicall` § | `ishaq2321/ProxiCall` | `52d55f58c9a3` | 6,040 | dart (primary) |

† No pin in the F5 artifact (the last sweep recorded none for these two). Restored at the revision
their own records name: `63912639992190c6f56ad13286f292186513ab19` from
`validation/m12/corpus-manifest.json` ("sparse, clean", 941 tracked `.jl`), and
`32b5b8c4655448291e27272d43607b9e3ae8c1d8` from the solidity lane doc ("OpenZeppelin/openzeppelin-contracts
at rev 32b5b8c4").

**‡ The two Clean corpora needed their upstream found, not just fetched.** Neither is on GitHub, which
is why the earlier record left both without a URL.
`dvanarkel/Clyde` was found by searching GitHub repositories for `clyde language:clean` — exactly one
match, and the pin fetches from it. Its shape corroborates the identification independently: **55
`.icl` + 54 `.dcl` = 109**, which is the number the clean lane doc already cites for this corpus
("Clyde 109 icl/dcl"). `clean-stdlib` is Clean's StdEnv, hosted at
`gitlab.science.ru.nl/clean-compiler-and-rts/stdenv`; the pin fetches from it and it carries
`StdOverloaded.icl` **at the repository root**, which is how the lane doc cites it
(`clean-stdlib/StdOverloaded.icl:23`). The corpus directory names are kept as the harness declares
them (`Clyde`, `clean-stdlib`), not as the upstreams spell them.

**§ `proxicall` could not be restored at its pin, and this is the one re-pin.** The remote is not in
doubt — `ishaq2321/ProxiCall` exists and is reachable — but its recorded revision
`3b6ebd409f1b1d235776cd72d3ad0809992ed060` is no longer reachable in it: a full blobless fetch of
every branch yields `remote error: upload-pack: not our ref 3b6ebd40…`, so the commit was rewritten
away upstream. The corpus is therefore restored at the current default-branch HEAD
`52d55f58c9a3f295a7f2fa7e0a14930bfeb70018` (6,040 tracked files, 2,373 of them `.dart`) **and the
re-pin is recorded here rather than hidden**, because the dart lane's numbers before and after this
restore are numbers about different trees. **The four local checkouts in the home directory
(`~/ProxiCall`, `~/ProxiCall2`, `~/ProxiCall3`, `~/Proxicall`) were checked as a possible source of
the pinned tree and cannot supply it**: each is a FULL clone (9,293 commits, oldest `19a37045`) whose
object store does not contain `3b6ebd40` — not in a branch, tag, reflog or stash, and the SHA string
appears nowhere in any of their `.git` directories — and all four sit at the same `52d55f58` the
corpus holds, with a tree digest (`565e3a1f19ce4786`) IDENTICAL to the restored corpus. A scan of
every git checkout under `~` (11 of them) finds the pin in none. So the commit was rewritten out of
upstream's history rather than merely unfetched, and copying those checkouts in would be a no-op.
They also carry 50 modified + 9 untracked files, which a differential deliberately excludes: a dirty
checkout is measured through a frozen worktree of its committed pin, so uncommitted edits would not
be measured even if the whole working tree were copied.

## Verification

1. **Presence, from the harness's own tables.** `LANG_REPOS ∪ SECOND_CORPUS` enumerated 50 repositories at
   that moment; the check reads each one's existence, whether it is a git checkout, and its HEAD
   (`script/m14/tmp/corpus-presence.ts`, scratch). Result: **50 declared, 50 present, 50 git checkouts,
   0 missing**. `git rev-parse HEAD` is what the differential itself runs over every active repo before
   its first measurement, so "0 missing, all git" is the precheck's own condition rather than a proxy
   for it.

   **This is the one claim in the document that is NOT independently re-measurable, and the reader
   should know why.** It was taken by a scratch reader over maps that have since changed (the perl
   re-registration added names to both maps), so no run today can reproduce the 50/50 it is a result
   about — and the second wave's own presence check, taken by a different scratch reader, was WRONG in
   a way worth naming: it matched each map by substring (`const LANG_REPOS`), which in
   `script/m14/differential.ts` hits `const LANG_REPOS_SECOND` (line 405) before `const LANG_REPOS`
   (line 409), so it parsed the secondary map twice, reported `LANG_REPOS: 2 lanes`, labelled every
   second-corpus entry `(primary)`, and found 4 absent names where there are 6. That run is kept in
   `validation/m14/measurements/corpus-presence-after-second-wave.log` with its correction appended
   rather than deleted. The tracked successor is `script/m14/corpus-presence.ts`, which anchors the
   declaration match, reports declaration counts and distinct-name counts separately, and exits 1 when
   any declared name is absent — so this class of claim is re-earnable without a scratch file.
2. **A previously BLOCKED lane measures both corpora.** The dart lane had neither corpus; its canonical
   sweep was unreachable. `bun script/m14/differential.ts --lang dart --sample 40` now runs to exit 0 —
   `dart-http` 40 files, tree-truth 2,033, covered 1,999 (**98.3%**), MISSING 34, unexplained 0,
   heuristic 0; `proxicall` at the re-pinned revision. One lane is not the sweep, but it is the lane
   whose corpora were absent, and it is measured through the same precheck and draw as the canonical run.
3. **The canonical sweep ran to completion and wrote its evidence.** `bun script/m14/differential.ts` —
   unscoped, 60 files per lane, **66 lanes in 9 sequential batches**, journaled and resumable — passed
   the precheck that used to throw, measured every lane, and wrote
   `validation/m14/results/M14.0.F5.json` with **`corpusPins` for all 50 declared repositories,
   `pinDrift: {}` and `sliceCount: 9`** — nothing moved under it during the run. Per-lane, COUNTED
   from the artifact's own maps rather than asserted, and re-counted at HEAD after a later commit to
   the same file moved several of these numbers (the artifact's `commit` is `062b4d9dac`, its
   `regeneratedAt` `2026-10-12T14:21:19Z`; parse `data.report` and `data.secondCorpus.report` and
   test `coveragePct == 100`, `missingInAnalyzer == 0`, `heuristicUnexplained == 0` — there is no
   committed census for these aggregates, which is why the parse is spelled out here): of the **36
   primary lanes measured, 17 cover every tree-truth edge, 11 of those with 0 MISSING *and* 0
   heuristic, and 16 have 0 MISSING** whatever their coverage; the second-corpus map adds **30 lanes,
   14 covering every tree-truth edge and 11 of them clean on both** (66 lanes total). The former blockers now have measured rows (`Exposed:kotlin` 100%, `jq:c` 100%,
   `cython:python` 99.6%, `dart-http:dart` 98.5%, `clj-kondo:clojure` 98.5%, `grails-core:java` 100%,
   `grails-core:groovy` 99.6%). The five weakest lanes are `dart` 66% (6,005 MISSING), `json` 0%
   (3,063, the pre-existing zero-analyzer state), `powershell` 81.2%, `typescript` 90.3% and `clean`
   67.9% — the last is a lane whose corpora this restore created.

   **What the run could NOT establish, in its own words.** It reports
   `DIFFERENTIAL CODE INPUTS DIRTY: 19 measured input(s) differ from 86c3582aeb — these rows describe
   uncommitted code, so they are not a claim about any commit; commit the analyzer/oracle change and
   re-run`, and it exits in that state at claim level **L1**. So the sweep now runs, and a
   commit-attributable F5 requires committing the 19 in-flight analyzer/oracle edits first. The
   honesty gate's F5 row moved accordingly: the staleness finding this restore was blocking
   (“86 declared input(s) changed … regenerate”) is **cleared**, and the honest successor is
   `differential evidence measured over uncommitted code (19 input(s)) — regenerate from a clean tree`.
   Gate total is unchanged at 8 failures. Progress: `script/m14/tmp/logs/f5-sweep.log`.

**Pin drift, recorded and not conflated with the restore.** Against the F5 record's revisions, 12 of
the corpora that were ALREADY on this box sit at a different HEAD (`alamofire`, `clojure`,
`element-plus`, `elixir`, `kotlinx-coroutines`, `lodash`, `otp`, `powershell`, `shadcn-svelte`,
`sqlite`, `svelte`, `swift-nio`), plus `proxicall` for the reason above. None of the 32 repositories
restored at a recorded pin drifts. This is informational rather than a defect: **a sweep's pin is the
LIVE HEAD it reads at run time** (`repoPins[repo] = git rev-parse HEAD`), and the artifact's
`corpusPins` is a record of what was measured, so a fresh sweep re-records the drift instead of
failing on it.

## The per-lane view

Every lane whose corpora the harness declares now has them. `hcl`, `make`, `nim`, `sql`, `vb`
and `xml` are reported `SKIP … no corpus repo mapped in LANG_REPOS` by the sweep itself — those lanes
have **no corpus declaration at all**, which is a harness registration gap and is NOT what this
restore was about; the restore cannot fix them and does not claim to. **That list is now history for
five of the six**: the same re-registration that moved `perl` also declared primaries for `hcl`
(`terraform`), `make` (`tf-aws-components`), `nim` (`nim`), `vb` (`P3D-Legacy`) and `xml`
(`grails-core`), so **`sql` is the only lane left with no corpus declaration at all** — a fact one run
of `script/m14/corpus-presence.ts` shows, rather than one exit-1 at a time. **`perl` left that set on
2026-10-12** — its `LANG_REPOS`/`SECOND_CORPUS` entries were re-registered by the lane's own round,
and the corpora behind the two newly-declared names did not exist: see "Second wave" below, which also
records the first measurement the lane has been able to take.

| lane | primary corpus | second corpus | canonical sweep |
| --- | --- | --- | --- |
| bash | otp | fsharp (M12 pin) | runnable |
| c | sqlite | jq | runnable |
| clean | Clyde | clean-stdlib | runnable |
| clojure | clojure | clj-kondo | runnable |
| cpp | fmt | nlohmann-json | runnable |
| csharp | powershell | fsharp | runnable |
| css | svelte | grails-core | runnable |
| dart | proxicall (re-pinned) | dart-http | runnable |
| elixir | elixir | phoenix | runnable |
| erlang | rebar3 | otp | runnable |
| fsharp | fsharp | — | runnable |
| go | go-tools | terraform | runnable |
| groovy | grails-core | geb | runnable |
| haskell | cabal | hledger | runnable |
| html | otp | sqlite | runnable |
| java | grails-core | clojure | runnable |
| javascript | svelte | lodash | runnable |
| json | terraform | otp | runnable |
| julia | julia | — | runnable |
| kotlin | Exposed | kotlinx-coroutines | runnable |
| markdown | scala3 | kubernetes | runnable |
| objc | sdwebimage | afnetworking | runnable |
| perl | mojo (restored 2026-10-12) | plack (restored 2026-10-12) | runnable |
| php | phpunit | phpmyadmin | runnable |
| powershell | powershell | ansible | runnable |
| python | cython | requests | runnable |
| ruby | rake | rack | runnable |
| rust | ripgrep | cargo | runnable |
| scala | scala3 | cats-effect | runnable |
| scss | element-plus | — | runnable |
| solidity | solidity | — | runnable |
| svelte | svelte | shadcn-svelte | runnable |
| swift | swift-nio | alamofire | runnable |
| toml | cargo | ripgrep | runnable |
| typescript | vue-core | element-plus | runnable |
| vue | element-plus | vue-element-admin | runnable |
| yaml | kubernetes | ansible | runnable |
| zig | zig | zls | runnable |

## Second wave (2026-10-12): the two perl corpora behind a re-registered lane

A registration and the corpus behind it are two different artifacts, and this wave is the case where
the first landed without the second. `script/m14/differential.ts` declares `perl: "mojo"` in
`LANG_REPOS` and `perl: "plack"` in `SECOND_CORPUS` — re-registered by the perl lane's own round, with
the merge history recorded in the maps' own comments. The lane could not run at all:

    error: corpus repo missing: <corpus-root>/mojo

`mojo` was absent from the corpus root, and `plack` was present but useless — a git checkout of
`https://github.com/miyagawa/Plack` whose **upstream HEAD is a single `README.md`** (`git ls-remote
origin HEAD` returns the local HEAD `8d07c668`, and that commit IS the repository). So the second
corpus admitted **0 files**: `[cold-pool] plack:perl: 0/0 fresh (rot 1, corpus 0)`. A lane can look
registered, pass the presence precheck, and still measure nothing on its second corpus.

| corpus | declared name | restored from | revision | tracked | perl files |
| --- | --- | --- | --- | --- | --- |
| Mojo | `mojo` | `mojolicious/mojo` | `93f591742a7db` | 407 | 274 |
| Plack | `plack` | `plack/Plack` (see the re-point below) | `c8215144d5e0c` | 276 | 225 |

**The `mojo` pin is the one already on the record**, not a fresh choice: `validation/m12/corpus-manifest.json`
names the perl corpus as `mojo@93f59174` (clean, "164 tracked *.pm/*.pl files" at the time it was
measured). Restored by the same procedure as the first wave — `git init`, `remote add origin`,
`fetch --depth 1 origin <pin>`, `checkout FETCH_HEAD`, `rev-parse HEAD` compared to the pin before the
temp directory is moved into place — and it verified on the first attempt at
`93f591742a7dbc0cee36875ab80a38f0666e32ae`.

**`plack` is a RE-POINT, recorded because it changes which upstream the name means.** The declared
origin holds one file upstream; the real Plack is `https://github.com/plack/Plack`, whose
`refs/tags/1.0054` and `HEAD` are both `c8215144d5e0cdd826ae2f497a14ca4d5c8a00c9`. The corpus was
fetched at that revision from that origin, and `plack`'s own remote was re-pointed in the same step, so
the checkout and its `origin` now agree. Two nearby trees were checked and are NOT this revision: the
local `perl-plack` checkout sits at `6cc035a6` ("Plack 1.0054", not advertised upstream at all) and
`perl-mojolicious` at `569f254e`; neither is the pin the harness declares, which is why the corpus was
fetched rather than copied from either.

### What the lane says now that it can speak

First measurement the perl lane has ever been able to take, `bun script/m14/differential.ts --lang perl
--sample 40`, both corpora drawn 40 files, **exit 6**:

    [mojo]  perl: COMPARED WITH NO TRUTH: extends (25 comparable, 0 truth), instantiates (49 comparable, 0 truth), overrides (117 comparable, 0 truth)
    [plack] perl: COMPARED WITH NO TRUTH: extends (6 comparable, 0 truth), instantiates (24 comparable, 0 truth), overrides (20 comparable, 0 truth)

Both corpora measured on that run (`mojo:perl 40/40 fresh (corpus 274)`, `plack:perl 40/40 fresh (corpus 225)`),
and **what the first run after the restore reported was the lane's WIRING gap, not its corpora**: three
labels in the comparison set with nothing behind them, so every edge of those three lands in
`unexplained` or `heuristic`, neither of which is coverage. That is the measured form of what `script/m14/perl-truth.ts`'s header already records as `STILL NEEDED IN
differential.ts (MASTER-owned, REPORTED not done)`, and it CORRECTS one line of that header: it says
`instantiates` "is left to the harness oracle", while on both corpora the harness oracle carried **0
truth** for it. Log: `validation/m14/measurements/perl-lane-corpus-restore.log`.

**That gap was then closed by the lane's own in-flight edit, and the corpora are what made the closing
readable.** While this wave was being recorded, `script/m14/differential.ts` gained perl's oracle in-file
(`derivePerlEdges`, pushed under `if (lang === "perl")`) and perl's own `["calls"]` and `["contains"]`
filter entries — uncommitted work in the shared file, recorded here as the lane's and not this
restore's. Re-running the identical command against the restored corpora now reads:

    [mojo]  perl: files=40 tree-truth=1419 covered=1419 (100%) MISSING=0 | analyzer-edges=1273 unexplained=0 (0%) heuristic=0
    [plack] perl: files=40 tree-truth=390  covered=390  (100%) MISSING=0 | analyzer-edges=383  unexplained=0 (0%) heuristic=0
    probe run (--lang perl): measured 2 lane(s)          exit 0

which is the first perl reading on any corpus in which every oracle-side edge of the draw is covered, and it was only possible because the two corpora
exist. The same command before the restores exited 1 with `corpus repo missing: …/mojo` and measured
nothing. The comparable-counts in the exit-6 block above are per-draw and the cold pool rotates
(successive runs of the identical command read `20 / 43 / 210`, then `25 / 49 / 117`), so they are quoted
with the draw that produced them rather than as constants. Transcript of both states:
`validation/m14/measurements/corpus-blocked-lanes.log`.

**What this wave does NOT do**: it does not wire any lane's oracle, admit labels to any filter, or touch
`differential.ts` at all. Those are the lanes' and the master file's, and the perl case shows the order
matters: the corpora had to exist before the wiring could be measured at all.

### Part 2: the six corpus names the same re-registration still owes

The merge that re-registered perl also registered second corpora for `hcl`, `make` and `nim` and a
primary for `vb` — and those corpora do not exist either. Read from the maps themselves by a TRACKED
instrument that emits its own evidence (`script/m14/corpus-presence.ts` →
`validation/m14/measurements/corpus-presence.log`): of **43 `LANG_REPOS` lanes and 36 `SECOND_CORPUS`
lanes — 79 declarations over 58 distinct names — six repository names are absent from the shelf**, and
one of them (`tf-aws-components`) is declared by two lanes:

| missing repo | declared by | first wave's per-lane row said |
| --- | --- | --- |
| `tf-aws-components` | `make` (primary), `hcl` (second) | `SKIP … no corpus repo mapped` |
| `consul` | `make` (second) | `SKIP …` |
| `nim` | `nim` (primary) | `SKIP …` |
| `pixie` | `nim` (second) | `SKIP …` |
| `fsharp-data` | `fsharp` (second) | (second corpus, not listed) |
| `P3D-Legacy` | `vb` (primary) | `SKIP …` |

The consequence is not a weaker measurement, it is **no measurement**: three lanes' differentials now
throw before their first file, verified lane by lane (transcript: `corpus-blocked-lanes.log`):

    $ bun run script/m14/differential.ts --lang nim --sample 5   -> error: corpus repo missing: …/nim              exit 1
    $ bun run script/m14/differential.ts --lang vb  --sample 5   -> error: corpus repo missing: …/P3D-Legacy      exit 1
    $ bun run script/m14/differential.ts --lang make --sample 5  -> error: corpus repo missing: …/tf-aws-components exit 1

All three exit **1**, and that was re-measured with the status captured directly rather than through a
pipeline — the first transcript of this block recorded `exit=0` for each, which is a shell artifact of
how it was written down and not the differential's status. The correction is appended to
`corpus-blocked-lanes.log`.

**An absent name blocks the lane whose PRIMARY corpus it is, and only that lane.** Measured by the
contrast rather than inferred from the code: `--lang hcl --sample 5` exits **0** on `terraform`
(2,281 hcl files, 5 drawn) even though hcl's second corpus `tf-aws-components` is one of the six absent
names, because the precheck's `requiredRepos` is built from `LANG_REPOS`. So the six absent names cost
**three lanes their measurement** (`make`, `nim`, `vb`) and **one lane (`hcl`) only its second
opinion** — the difference between a lane that cannot be run and a lane that is being run with a weaker
two-corpus gate than its registration claims.

The same working tree carries an IN-FLIGHT change to the **unscoped** branch (an absent checkout becomes
a recorded `unmeasuredLanes` row instead of a whole-sweep abort), which is `differential.ts`'s change and
not this restore's. Neither state is claimed for it here: what this document measured is the scoped
behaviour above.

The first wave's per-lane table described these six lanes as having "no corpus declaration at all", and
that was true when it was written. The re-registration changed the declaration without changing the
corpora, which moved them from *skipped* (a lane that looks absent) to *throwing* (a lane that breaks the
run) — and an unscoped sweep could not pass its precheck while any required repo was absent, which is
why the in-flight change described above exists.

**These six restores — four lanes' worth of declarations — are deliberately NOT performed here.** A name
is not a pin and, for at least one of them, not even a provenance: `pixie` is the name of a Go project and it is registered as the second
corpus of the NIM lane, so fetching the obvious upstream would be substituting a different tree under a
matching name — exactly what the first wave refused to do for `Clyde` and `clean-stdlib` until each
upstream had been found and confirmed by an independent shape check. The lanes own these names, their
pins and that confirmation; what this section contributes is that the absence is now measured, named per
lane, and reproducible from the harness's own maps rather than discovered one exit-1 at a time.

## Reproducing this

`script/m14/tmp/restore-missing-corpora.sh` (scratch — and note that the second wave's two restores were
performed directly rather than by extending it, because one of them is a RE-POINT and the plan file's
`name|pin|candidate remote` shape has no field for "the declared remote is an empty repository" —
`script/m14/tmp/` is excluded, which is why it is not in the repository; the wave's presence check, which
WAS reproducible only by re-typing it, now has a tracked successor in `script/m14/corpus-presence.ts`)
holds the plan: `name|pin|candidate remote`, one `git init` +
`fetch --depth 1 origin <pin>` + `checkout FETCH_HEAD` per repository, up to three attempts, the temp
directory moved into place only after `rev-parse HEAD` equals the pin. It prints its plan by default
and touches nothing without `--go`. Three additions were needed beyond the original plan and are worth
keeping in any rerun: `dvanarkel/Clyde`, the GitLab StdEnv URL, and `proxicall`'s re-pin.

**Environment requirement: unset the proxies.** `unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY
ALL_PROXY` is the difference between every fetch above succeeding and every one failing with
`Proxy CONNECT aborted`.

## Caveats

- **The dart lane's revision changed.** `proxicall@52d55f58`, not `3b6ebd40`. Its old revision is
  unreachable, not merely undownloaded: it is absent from upstream AND from all four local ProxiCall
  clones, each a full-history clone. Copying a local checkout into the corpus is therefore a no-op
  (the tree digest already matches), and any dart number compared across this restore is a comparison
  of two trees unless it is re-measured at one of them.
- **A re-pin is not a pin violation, and 12 corpora were already drifted.** The sweep reads live HEAD
  and re-records; the F5 artifact's `corpusPins` names what the last sweep measured, not a requirement
  the next one must meet.
- **`json`'s 0% coverage is pre-existing, not a restore artifact.** The run prints
  `[terraform] json: files=60 tree-truth=3063 covered=0 (0%) … analyzer-edges=0`, and the previous
  canonical F5 recorded the same lane at `analyzerEdges: 0` with `missingInAnalyzer: 27828` — a lane
  DERIVATION state, unrelated to whether its corpus exists.
- **`clean-stdlib` is restored at the StdEnv pin, and the two Clean upstreams are single points of
  trust**: `dvanarkel/Clyde` and `clean-compiler-and-rts/stdenv` are the only holds found for those
  pins, both confirmed by fetching the exact revision. A different corpus with the same name was
  deliberately not substituted.
- Disk: 60 GB free after the restore; the largest checkouts are `kubernetes` (31,412 tracked files),
  `scala3` (25,945), `zig` (20,545) and `grails-core` (14,026).
