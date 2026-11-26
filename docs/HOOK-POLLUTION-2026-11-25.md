# The pre-commit hook that reformatted other lanes' work

**Author: Muhammad Ishaq Khan.** Recorded 2026-11-25.

## What happened

This checkout's `.git/hooks/` contained **19 husky hooks** (pre-commit, commit-msg, post-commit, …) that
were **not the repository's**. Every one of them carried the same provenance line:

```
Directory: /home/ishaq2321/mcp/backbencher-brain/benchmarks/.work/deps/ts-project2@484f5cfa1990/node_modules/husky
```

That is another lane's **benchmark scratch install** — a clone of a third-party TypeScript project under
`benchmarks/.work/`. Its `package.json` declares
`husky.hooks["pre-commit"] = "pretty-quick --staged"`, and running `prepare` in that directory wrote hooks
into **our** shared `.git/hooks/`, because `.git` is shared and `core.hooksPath` was unset.

`pretty-quick --staged` runs prettier with **prettier's defaults** — which include semicolons. This repo's
source style is prettier with `semi: false` (verified: running `prettier --no-semi` over the pre-incident
revision of `real-typescript-analyzer.ts` reproduces it **byte-for-byte**, diff 0 lines). So every commit
made in this checkout silently reformatted its **staged** files to decorated style.

## Damage measured

| file | semicolon-terminated lines before | after |
|---|---|---|
| `src/ast/real-typescript-analyzer.ts` | 30 | **3,134** |
| `src/ast/real-javascript-analyzer.ts` | 29 | 1,535 (repaired) |
| `src/ast/member-owner-resolution.ts` | 6 | repaired |
| `script/bench/grade.ts` | 0 | **148** — NOT repaired, another lane's file |
| `script/bench/lib/profile.ts` | 0 | **85** — NOT repaired, another lane's file |
| `script/bench/replay-anchor.ts` | 3 | **213** — NOT repaired, another lane's file |

The TypeScript analyzer's reformat entered at `c53664ea8` (16:39), i.e. an **earlier** instance of the
same hook; JavaScript's entered at my own commit `87dd8c98d` (21:47) before I noticed.

## The harm is not stylistic

A 10,070-line diff for what was a ~90-line semantic change hides the change. Worse, the reformat makes
later semantic commits read as enormous and makes `git log -p` / blame useless for the affected range.

## Repair

For the two files I own, restored by running the same formatter with the repo's actual style:

```
prettier --no-semi --parser typescript <file>
```

Proven cosmetic rather than assumed: the formatter's output and the pre-incident file have **identical
token streams** (59,035 tokens each) once trailing commas are normalised — prettier's `trailingComma`
default removed a handful that the repo style keeps. `tsc` 0 and the fixtures unchanged after each
restore.

## Prevention

1. **The 19 foreign hooks are deleted.** Backed up to `.tmp-lead/hook-backup/` (untracked). Git's own
   `*.sample` files are untouched, so nothing legitimate was lost. `core.hooksPath` remains unset.
2. **The repository declares no hook system of its own** — no `.husky/`, no `husky` or `lint-staged` key
   in `package.json` — so removing them removes nothing the project wanted.
3. **If hooks are wanted later**, they must come from this repo's own `package.json` and must pin
   `semi: false` in a committed prettier config; a formatter with defaults that contradict the codebase
   is a bug, not a style opinion.
4. **Check `git config core.hooksPath` and `ls .git/hooks` after any `npm install` or `prepare` run in a
   subdirectory of this checkout.** A scratch install under `benchmarks/.work/` can write here.

## Still outstanding

`script/bench/grade.ts`, `script/bench/lib/profile.ts` and `script/bench/replay-anchor.ts` still carry the
hook's reformat. They belong to the benchmarks lane, not to me, so I have **not** edited them; the same
one-command repair applies:
`prettier --no-semi --parser typescript <file>`, verified to take them to 0 / 0 / 4 semicolon lines.
