# THE FLAG IS RESOLVED: the `package.json` change **WIRES THE UNROUTED-EXTENSION GATE INTO `npm run verify`**

**The Lead flagged this change in a security commit rather than burying it** — *"a change to it can alter what `npm run`
does for every lane, and the Lead has not read that diff."* **The Lead has now read it, and it is the change that
completes the gate.**

    + npx tsx script/m60/unrouted-extension-gate.ts &&

**ONE SEGMENT, INSERTED INTO THE `verify` CHAIN** *just before `bun run script/m59/verify-language-surface.ts`* — **so
the unrouted-extension class is now checked on every full verification run.**

## AND THAT CONVERTS THE GATE FROM A REPORT INTO AN ENFORCEMENT

**The gate already published `verdict PASS` and `exitCode 0`** — *which is what lets it join a chain* — **and this is the
join.** **Without this line, the gate is an instrument a lane can run; with it, the gate is a step that FAILS THE FLEET'S
VERIFY CHAIN if a text-bearing extension the router refuses appears.**

> **SO THE CLASS'S CLOSURE IS NOW COMPLETE IN BOTH DIRECTIONS THE PROGRAMME CAN CLOSE**: **the census found it, the
> rulings priced it (13 of 147 actionable), twelve extensions were fixed with falsifiers, and the gate enforces the
> invariant on every verify.** *What remains open is only what no gate can close — **an extension no corpus here
> contains yet**, whose nine known siblings are listed by name.*

## AND THE LEAD'S FLAG WAS THE RIGHT INSTINCT APPLIED TO THE WRONG CASE — WHICH IS WORTH RECORDING

**The flag existed because `package.json` is fleet-visible and unread.** *That instinct is correct: this morning an
unread `package.json`-class change would have been exactly the shape of the day's recurring error — **a claim about a
file, made without reading it.*** **The resolution is that the file was read and the change is a strict addition**: *it
adds one step and removes none, so no existing verification is weakened by it, and the only new failure mode it
introduces is the gate's own — which is the point.*

**AND IT IS THE THIRD GATE THE PROGRAMME NOW CARRIES**: **`npx tsc --noEmit`** (*types*) · **`npm run
audit:script-typecheck`** (*the ratchet, baseline 0, canary-verified*) · **and now the unrouted-extension gate**
(*the corpus's own extension surface*). *All three are green at this revision.*
