# THREE GATES GREEN AT HEAD — and the third one SHOWS ITS OWN SELF-TESTS

**Run by the Lead at the end of 2026-10-12, each with its exit code read from `$?` and not from a pipe.**

## 1 · `npx tsc --noEmit` → **0**
**Types across `src/**`.**

## 2 · `npm run audit:script-typecheck` → **PASS, baseline 0**
> *"no file's error count rose, and the surface is at ZERO errors: **the canary proved diagnostics were reported, so the
> zero is a reading and not an absence of output.**"*

**The ratchet's own sentence is the standard this programme spent the day applying everywhere else**: *a zero from a
predicate that could have returned non-zero is a reading; a zero from a predicate that could not is nothing.*

## 3 · `npx tsx script/m60/unrouted-extension-gate.ts` → **PASS, exit 0**

    ok  : a new BINARY-ONLY key is classified and passes — verdict PASS, keys [".zzz8gate:binary-only"]
    ok  : a registered refused key (.pyx) passes as known — refused=true, newKeys=0, verdict PASS
    ok  : a routed extension (.ts) is not refused at all — refusedKeys=0, routed observed=true

    verdict: PASS

**THREE SELF-TESTS, PRINTED, EACH PROBING A DIRECTION THE GATE COULD FAIL IN**: **a NEW unknown key is classified**
(*so the gate sees novelty*) · **a REGISTERED refusal passes as known** (*so the register is consulted rather than
re-derived*) · **and a ROUTED extension is not refused at all** (*so the gate is not simply refusing everything*).
*Without the third, a gate that refused every extension would pass its own first two tests.*

> **AND IT IS NOW A STEP IN `npm run verify`** (`package.json`, resolved this round) — **so this is not a gate a lane
> remembers to run; it is a gate the fleet's verification chain runs.**

## AND THE THREE TOGETHER COVER THREE DIFFERENT SURFACES

    tsc                        the TYPE surface
    audit:script-typecheck     the SCRIPT surface, against a frozen baseline, canary-verified
    unrouted-extension-gate    the CORPUS's own extension surface, self-tested, now in the verify chain

**ALL THREE GREEN AT THIS REVISION** — *and each one names what it cannot see: the ratchet counts errors in files it
reads; the gate cannot see an extension no corpus here contains yet; `tsc` covers `src/**` and not the scripts, which
is why the ratchet exists.* **A gate that states its blind spot is worth more than one that does not, and all three
do.**
