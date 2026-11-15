# M62 spot-check pack — for the owner

The achieved/not-achieved verdict is the owner's, never the gate's (IDE
Honesty Contract §8.5). Below is what to try and what is explicitly not
claimed, so the verdict can be made on evidence.

## What to try

1. Index a project whose analyzers store no call-site line (every language
   today except the ones M59 covers). Hover a symbol and open the graph: no
   row anywhere may read `line 0`, and the graph's rows say which position
   they are showing.
2. Ask an agent for `bb_graph` on a symbol that calls others: every edge
   carries a `callSite` with a `kind` (`call-site` only when a real line was
   stored) and a `note` for every non-exact kind.
3. Index a Scala project (the one analyzer that stores real call-site lines
   today) and repeat: the same surfaces show exact call sites, with no code
   change and no re-verification of this milestone.
4. Read `docs/m62/LINE-ADDRESS.md` (generated) beside the behaviour you saw.

## What is explicitly NOT claimed

Per-language real-line COVERAGE is M59's lane (M59.A7). This milestone claims
the consumption contract: whatever the store writes is interpreted honestly.
M59.A2/A4/A8 (NULL-vs-0 write rule, multiplicity, row identity) land in the
co-agent lane; `script/m62/verify-arrival.ts` is the acceptance for their
arrival and shows the upgrade needs no consumer change.

## The issues

- **G1** (#874, known-gap): the M62 ledger; the bar re-audit that re-executes A1/A2/A3/D1 on every run; the chain wiring audit; the lane's prerequisites (M55 + M61 bars)
- **A1** (#875, verified): the address owner: CallSiteAddress contract, pure derivation, one formatter, the 0-based projection
- **A2** (#876, verified): consumer adoption: the engine, the hub payload, bb_graph, the webview mirror and the declared kinds; the permanence lint
- **A3** (#877, verified): the generated address doc and the M59 arrival hook (three store states, the no-code-change upgrade, multiplicity, declared coverage)
- **X1** (#878, verified): the lane closure audit: M62 plus the IDE lane re-audited at one HEAD, with generated packs
