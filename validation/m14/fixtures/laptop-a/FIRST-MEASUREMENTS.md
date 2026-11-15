# LAPTOP A — THE FIRST THREE MEASUREMENTS EVER TAKEN

**Laptop A's 23 analyzers have no lane entries, no status file, and no verification record since
`ontology-union-laptop-a-2026-10-07.json`** — which records only *which analyzer revision was integrated*, not
whether anything resolves. **This is the first time any of them has been through the gate.**

## THE TABLE

    lane   ext    edges    resolved     amb(decl)  unresolved   residual
    rust   rs     42,930      9,225        9,700      24,005      78.5%
    java   java   50,039     11,292        3,154      35,593      77.4%
    go     go     43,201     15,401        4,360      23,440      64.4%

**All three are 400-FILE PROBES, not population runs** — java's corpus alone is **11,152 `.java` files across 19
repos** and rust's is larger. **So these are comparable to each other and to nothing else**, and the extension
list defines the population (java's gate line says *"ONE spelling — check the lane does not carry another"*).

**AND ALL THREE ARE TOUGH.** **64–79% residual** is what the programme owner meant by *"the tough ones of Laptop
A"* — against Laptop B, where the verified lanes sit at **0.001% (yaml) to 36.3% (bash)**. **That is the scale
difference between the two halves, and it is now measured rather than assumed.**

## WHAT THE PROBES ALSO ESTABLISH

* **The instrument works on A lanes with no infrastructure** — `incoming-gate.ts <lang> <ext> 400` prints its
  POPULATION and INTENT blocks and a full per-type row. **`LANES_B` is used only by the `--all` board.**
* **java's instrument self-test PASSED** — *"control fired"* — so its numbers are a reading rather than an
  absence.
* **The java worklist is CAPPED and says so**: *"unres: showing 4 of 25 collected + **1059 omitted by the cap**.
  THIS LIST IS A SAMPLE"* — the disclosure is working.
* **java's two key spaces are both reported**: **`resolved against the file's OWN PROJECT (production's scope)`**
  gives **amb 3,154 / unres 35,593**, while *"the same edges under the pooled corpus key space: 4230 ambiguous +
  34780 unresolved — that number is about the CORPUS's name space, not about production."* **Quoting the wrong
  one would misstate the lane by ~2,800 edges**, and the gate prints both.
* **Every lane reports `extFAIL`/`bindFAIL`/`causeFAIL` at 0** on these probes.

## WHAT IS NOT EARNED, so nobody reads the table as more than it is

* **Probes, not populations** — no lane has been run at `maxFiles 0`, and **for anything file-scoped a stride is
  a lower bound by construction** (the gate's own measured pair: **0.4% sampled vs 46.8% whole-corpus**).
* **No cause is named for any of the three.** The table says *how much* fails, not *why* — **each of the three
  needs the four-clause bar**: named causes with measured counts, each fixed with a same-population before/after
  or ruled with evidence whose falsifier was RUN.
* **No per-type breakdown has been read yet.** A type resolving **zero** is **a mechanism absent or never
  reached**, not an ambiguity — and that is the first thing to look for, because it is the category that produced
  python's `imports 0 of 4,972` and `overrides 0 of 1,915`.
* **The extension lists are unchosen by policy** — each is a claim about the lane's population and none has been
  checked against the analyzer's own admission rule.
