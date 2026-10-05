# If you are a new supervisor with no memory of this session

Everything needed to continue is on disk and on the remote. **Do not re-derive any of it,
and do not trust any summary — including a previous supervisor's — without checking it
against these sources.**

## Read these, in this order

| what you need | where |
|---|---|
| Which 23 languages are YOURS | `docs/analyzers/PROMPT-LAPTOP-B.md:15` |
| What is done, measured, and outstanding | `docs/analyzers/ONTOLOGY-WORKSTREAM-STATE.md` |
| The rules you must not break | `docs/M14-HONESTY-CONTRACT.md` |
| What every lane is told when it starts | `scripts/agent-orchestration/repo-facts.md`, `ruling-table-brief.md`, `anti-stall-brief.md` |
| How to run, watch and revive agents | `scripts/agent-orchestration/{launch-agent.sh,status.sh,watchdog.sh}` |

## The one-line state

`origin/main` is the integration branch and it is current. Never merge to it yourself and
never push over it — merge what is on `origin`, then push. Every lane lives on
`analyzer/<LANG>`, all 23 are pushed, and lane work arrives by cherry-pick or merge, with
registry conflicts resolved to the UNION.

## "Out of context" — what a previous supervisor meant

A supervisor's working context (this conversation) is FINITE. As the session grows, older
turns get summarised or dropped to make room. That is not a memory problem, it is a
window problem, and it has three concrete failure modes worth guarding against:

1. **Repeating work already done.** Guard: read `ONTOLOGY-WORKSTREAM-STATE.md` before
   starting anything, and check `git log` for whether it was already done.
2. **Losing the reason for a decision.** Guard: every non-obvious choice is in a commit
   message. If a decision looks arbitrary, `git log -S` will find why it was made.
3. **Reporting numbers from memory instead of re-measuring.** Guard: the honesty
   contract's population rule. A remembered number is a number about no particular tree.

**The mitigation is structural, and it is already in place:** no durable state lives in
the supervisor's context. The integration branch is pushed, all 23 lane branches are
pushed, agents' in-flight work lives in their own worktrees on disk, and the findings live
in committed markdown. A supervisor can be replaced mid-session with no loss beyond the
last few minutes of conversation.

**What a new supervisor must do first:** run `scripts/agent-orchestration/status.sh`. If
lanes are DEAD or STALLED, run `watchdog.sh` — it revives them from their worktrees. Do not
re-launch from scratch; that discards uncommitted work.

## The mistakes a previous supervisor made, so you do not repeat them

Recorded because each was caught late and each produced a FALSE PASS:

- **`npx tsc --noEmit` only ever checked `src/`.** `script/` was not in the tsconfig, so
  "tsc clean" said nothing about the instruments. Use `npm run typecheck:scripts`.
- **Piping tsc through `head` and reading no output as "passed".** Check `$?` from tsc.
- **An assertion (`as Promise<T>`, or a stale registry entry) silences the compiler
  instead of fixing anything.** Assertions convert compile errors into runtime ones.
- **Resolving a registry conflict to one side instead of the union** — deletes another
  lane's rulings, silently.
- **Counting the wrong population** — the recurring defect. A probe over 16 of 25 files, a
  census over 1,250 of 2,735, a 30-file sample used to judge cross-file resolution.
