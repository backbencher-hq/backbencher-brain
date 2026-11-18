# ISSUE-12 — Output contradictions: security “39 leads” vs “0 stored”, and visualize’s “whole project”

Lane: `payload-honesty`. Issue 12 of 12. Date: 2026-11-18 (UTC).
Product: repo `/home/ishaq2321/mcp/backbencher-brain`, HEAD `be4c0ef25`, `node bin/bb --version` = `0.1.6`.
Specimen: bettercap index projectId `4c7590f1cba319aac298a50453c0ec440f2dc857`; cross-checks on
workspace index `1d3d57103be91b8f9716d70199fe28a3f39245d9` (`.corpus/` JS) and
`bb_tests/repositories/gql-gqlgen/graphql` (`3cc41674…`).
Raw evidence: `docs/bb-bettercap-triage/evidence/payload-honesty/`.
Read-only: no product source edited, no reindex.

## Verdict

**REAL (composite)**, severity **medium**, confidence **high** — both surfaces reproduce, but the two
sub-claims have different mechanisms and different severities:

| # | Sub-claim (report) | Verdict | Severity | Summary |
|---|---|---|---|---|
| a | “security header says 39 leads while body says 0 stored and history says 0” | **REAL-BUT-MISDESCRIBED** | **low** | The output really does print `tiers: 0 scan / 39 leads / 14 unsupported (of 53 analyzers)` above `security leads: 0 stored lead(s)`. But `39` is the number of **languages (analyzers) in the registry whose tier is “leads”**, not stored leads; it is a *project-independent analyzer census*, while the body is *this project's stored lead count* (0 on bettercap, 3 on the workspace project). The numbers do not contradict each other — the **label** conflates two units, and docs reproduce the same label. |
| b | “visualize says ‘this graph is the whole project’ while scoped to module(session)” | **REAL** | **medium** | The string is unconditional in the empty-exclusion branch: every text answer tested (scope project/module/file/symbol, 3 projects, including an EMPTY/ABSENT module) ends with `excluded: nothing — this graph is the whole project …`. In the module(session) answer the same output states `scope: module (session)`, `200 returned` of `495`, `truncated: yes`; in the gql answer it states `absent: no indexed symbol matches … this is an empty PAGE, not an empty project` and then claims the graph is the whole project. The claim is false whenever scope ≠ project or the page is truncated or offset > 0. |

## Reproduce

```bash
cd /home/ishaq2321/mcp/backbencher-brain
E=docs/bb-bettercap-triage/evidence/payload-honesty
# (a) security: header tier line vs stored leads vs history
node bin/bb tool bb_security --dir /home/ishaq2321/bettercap --args '{"limit":5}'                > $E/security-limit5.out
node bin/bb tool bb_security --dir /home/ishaq2321/bettercap --args '{"limit":5,"history":true}' > $E/security-limit5-history.out
# (b) visualize: unconditional "whole project" claim across scopes
node bin/bb tool bb_visualize --dir /home/ishaq2321/bettercap --args '{"scope":"module","target":"session","format":"text"}'      > $E/viz-module-session-text.out
node bin/bb tool bb_visualize --dir /home/ishaq2321/bettercap --args '{"scope":"project","format":"text"}'                        > $E/viz-project-text.out
node bin/bb tool bb_visualize --dir /home/ishaq2321/bettercap --args '{"scope":"file","target":"session/session.go","format":"text"}' > $E/viz-file-sessiongo-text.out
node bin/bb tool bb_visualize --dir /home/ishaq2321/bettercap --args '{"scope":"symbol","target":"New","format":"text"}'          > $E/viz-symbol-New-text.out
node bin/bb tool bb_visualize --dir /home/ishaq2321/bb_tests/repositories/gql-gqlgen/graphql --args '{"scope":"module","target":"graphql","format":"text"}' > $E/viz-gql-module-text.out
node bin/bb tool bb_visualize --dir /home/ishaq2321/mcp/backbencher-brain --args '{"scope":"file","target":".corpus/axios/lib/axios.js","format":"text"}' > $E/viz-workspace-file-axios-text.out
```

## Observed (bounded raw output, HEAD)

### (a) `bb_security --limit 5` on bettercap — verbatim (636 B)

```text
⚠️  LEXICAL TOKEN CO-OCCURRENCE — NOT DATA FLOW; NOT A VULNERABILITY FINDING
tiers: 0 scan / 39 leads / 14 unsupported (of 53 analyzers) — unsupported languages are NOT scanned by bb_security; leads require manual validation
not scanned by bb_security (no executable source model): css, html, json, markdown, scss, xml, yaml — stylesheet text; no executable source/sink surface
leads tier: 5 language(s) present; lexical output only
security leads: 0 stored lead(s) (none stored for this project — declared empty, not a clean result)
  no stored leads on this page
[leads: showing 0 of 0; offset 0; page size 5; tier=leads]
```

`--args '{"limit":5,"history":true}'` on the same project:

```json
{"runs":[],"findings":[],"findingsTotal":0,"findingsShown":0,"findingsTruncated":0,
 "summary":{"open":0,"resolved":0,"suppressed":0,"reopened":0,"mitigated":0,"stale":0},
 "census":{"runsTotal":0,"runLimit":5,"findingsTotal":0,"findingsShown":0,"findingsBeyondCap":0}}
```

What the three numbers actually are, measured across projects:

| project | header line | project language line | stored-lead body | stored leads in history |
|---|---|---|---|---|
| bettercap (Go) | `0 scan / 39 leads / 14 unsupported (of 53 analyzers)` | `leads tier: 5 language(s) present` | `0 stored lead(s)` | 0 runs / 0 findings |
| workspace (`1d3d5710…`, JS/TS + corpora) | `0 scan / 39 leads / 14 unsupported (of 53 analyzers)` | `leads tier: 39 language(s) present` | `3 stored lead(s)` | n/a |
| gql-gqlgen/graphql (Go, older index) | `0 scan / 39 leads / 14 unsupported (of 53 analyzers)` | `leads tier: 1 language(s) present` | `engine not initialized — security engine not initialized; run bb index --post` | n/a |

`39` is **constant across projects** (it counts the static analyzer registry, see root cause); the
project language line and the stored-lead count vary. On the workspace answer the *same number 39*
appears two lines apart with two names: `39 leads` (header) and `39 language(s) present` (project
line) — the second is the correct unit, which is the cleanest proof the header label is wrong.

### (b) `bb_visualize` — the claim vs the same answer’s own scope/truncation lines

bettercap `scope=module target=session` (1,511 B; shortened here to the contradicting lines; full
file in evidence, Lead corroboration `evidence/lead/issue12-visualize-module-session.txt`):

```text
graph: 200 nodes, 513 links
scope: module (session)
available: 495 symbol(s) match, 399 reached the projection, 200 returned — limits 200 nodes / 5000 links
page: symbols 1-200 (offset 0, limit 200, page 1; 495 symbol(s) match this scope) — next page: offset=200
excluded: nothing — this graph is the whole project (build output and VCS metadata are filtered on whole path segments; test sources are included)
truncated: yes — 399 nodes and 1050 links reached the projection, the limits kept fewer
```

The claim also appears in every other scope:

| call | answer’s own facts | claim line present? |
|---|---|---|
| scope=project (bettercap) | `55785 symbol(s) match, 390 reached the projection, 200 returned`, `truncated: yes`, page 1/279 | **yes** (`… this graph is the whole project …`) |
| scope=module session (bettercap) | 495 match / 200 returned, `truncated: yes`, nextOffset 200 | **yes** |
| scope=file `session/session.go` | `scope: file`, `60 nodes`, 61 match / 60 returned | **yes** |
| scope=symbol `New` | `scope: symbol (New)`, 2 nodes, 0 links | **yes** |
| scope=module `graphql` on gql-gqlgen | `absent: no indexed symbol matches scope=module target="graphql" — absence declared, never guessed`; `0 symbol(s) match this scope, so this is an empty PAGE, not an empty project` | **yes** — “this graph is the whole project” two lines below “empty PAGE, not an empty project” |
| scope=file `.corpus/axios/lib/axios.js` (workspace) | `scope: file`, 2 nodes, `this is the LAST page` | **yes** |

## Expected vs observed

- **Expected (documented):** `docs/BB_VISUALIZE.md:59-61` — the answer declares
  `totalNodesAvailable` (what scope/filters matched), `truncation.originalNodes`/`nodes` and the
  `truncation` block; scope semantics at `:26-29` (`module` = “every symbol under that directory”,
  `file`, `symbol`); `docs/BB_SECURITY.md:41-55` calls the tiers line “The project-independent tier
  declaration, printed verbatim from `formatSecurityTierDeclaration()`” and its example block at
  `:51` contains the literal `tiers: 0 scan / 39 leads / 14 unsupported (of 53 analyzers)`; the
  headline at `:76-80` is documented as `security leads: <N> stored lead(s)`.
- **Observed:** the security surface mixes two units under one word (“leads”) and its own docs
  repeat the label; the visualize surface prints a global completeness claim that its own same-answer
  `scope:`/`truncated:`/`absent:` lines contradict. Neither is a data-computation error; both are
  **emitted-claim errors** — exactly the class this campaign is triaging.

## Root cause (file:line, quoted)

### (a) security: analyzer-census counts labelled as leads

`src/intelligence/security/rebuild/registry.ts:143-163` — the counted population is the language
registry, not stored rows:

```ts
/** Counts over the registry, deterministic and sorted. */
export function securityTierCounts(): SecurityTierCounts {
  const languages = Object.keys(LANGUAGE_SECURITY_ENTRIES).sort()
  const scan: string[] = []
  const leads: string[] = []
  const unsupported: string[] = []
  for (const language of languages) {
    const tier = LANGUAGE_SECURITY_ENTRIES[language]!.tier
    if (tier === "scan") scan.push(language)
    else if (tier === "leads") leads.push(language)
    else unsupported.push(language)
  }
  return { total: languages.length, scan: scan.length, leads: leads.length, unsupported: unsupported.length, ... }
}
```

`src/intelligence/security/rebuild/registry.ts:166-171` — the label that turns those three language
counts into “N scan / N leads / N unsupported”:

```ts
export function formatSecurityTierDeclaration(): string {
  const c = securityTierCounts()
  return (
    `tiers: ${c.scan} scan / ${c.leads} leads / ${c.unsupported} unsupported (of ${c.total} analyzers) — ` +
    `unsupported languages are NOT scanned by bb_security; leads require manual validation`
  )
}
```

`src/mcp/tools/bb_security/handler.ts:298` (and `:346`, `:406`) prepends that declaration to every
live answer (`const tierNote = formatSecurityTierDeclaration() + projectLanguageDeclaration(raw,
projectId)`), while the store count is emitted at `:320-322`:

```ts
const head =
  `security leads: ${page.total} stored lead(s)` +
  (page.total === 0 ? " (none stored for this project — declared empty, not a clean result)" : "")
```

and the *project-dependent language* count at `handler.ts:201-224` (`projectLanguageDeclaration`)
prints `leads tier: ${leads} language(s) present; lexical output only` — the same population counted
again, with the correct unit. So three “lead-ish” numbers are emitted per answer: 39 (registry
languages, mislabelled “leads”), N (present languages, labelled correctly), and stored leads
(0/3, labelled correctly). The contradiction is a **unit/label conflation in one static string**,
not an inconsistent computation; and it is *documented* (`docs/BB_SECURITY.md:51,75,186`), so the
fix touches the formatter plus the generated/curated doc text.

### (b) visualize: unconditional global claim in the empty-exclusion branch

`src/intelligence/visualization/visualization-engine.ts:1015-1024` — the comment says the intent is
“nothing was excluded”, but the string asserts project-wide completeness:

```ts
  // The exclusion is ALWAYS stated, including when it is empty. "Nothing was
  // excluded" is information a reader needs in order to trust that the graph is
  // the whole project, and a line that appears only when there is something to
  // report makes silence and zero indistinguishable — which is the same class of
  // defect as the slice being called "the original".
  if (result.excluded) {
    const byPattern = Object.entries(result.excluded.byPattern).map(([pattern, n]) => `${pattern} (${n})`).join(", ")
    lines.push(
      result.excluded.symbols > 0
        ? `excluded: ${result.excluded.symbols} symbol(s) as noise by ${byPattern}${result.excluded.includesTestFiles ? "" : " (test sources excluded)"} — this graph is not the whole project`
        : "excluded: nothing — this graph is the whole project (build output and VCS metadata are filtered on whole path segments; test sources are included)",
    )
  }
```

The branch has no access test on `result.scope`, `result.truncation.truncated`, or `result.truncation.offset`
— all of which the same payload carries (`src/intelligence/visualization/visualization-engine.ts:910`:
`return { scope, target, format, view, layout, nodes, links, excluded, declaredAbsent, …, considered,
truncation, freshness }`) and all of which the text formatter itself already prints two lines later
(`truncated: yes — …`). Root cause: the “nothing was excluded” fact was promoted into a completeness
claim about the whole project, while completeness is a property of three other fields.

## Generality table

| language | project / scope | fixture / repro | same class? | evidence |
|---|---|---|---|---|
| Go | bettercap — security | `bb_security --limit 5`, `history:true` | **yes**, header/examples reproduce | `security-limit5.out`, `security-limit5-history.out` |
| JS/TS + corpora | workspace index — security | `bb_security --limit 5` | **yes**; header still 39 while project line says `39 language(s) present` and body `3 stored` | `security-workspace-limit5.out` |
| Go (older index) | gql-gqlgen/graphql — security | `bb_security --limit 5` | **yes**, identical 39; body differs (`engine not initialized`) | `security-gql-graphql-limit5.out` |
| Go | bettercap — visualize | scope project / module(session) / file(session.go) / symbol(New) | **yes in all four scopes** | `viz-project-text.out`, `viz-module-session-text.out`, `viz-file-sessiongo-text.out`, `viz-symbol-New-text.out` |
| Go (older index) | gql-gqlgen/graphql — visualize | scope=module graphql (ABSENT) | **yes**, sharper: “empty PAGE, not an empty project” + “whole project” in one answer | `viz-gql-module-text.out` |
| JavaScript | workspace — visualize | scope=file `.corpus/axios/lib/axios.js` | **yes**, file scope still claims whole project | `viz-workspace-file-axios-text.out` |

Both defects are **tool-level text emitters, not analyzer- or project-specific**: security's 39 is a
static registry census (identical on 3 projects), and visualize's claim appears in every scope on
2 projects/languages.

## Fix sketch (implementation-ready)

### (a) security
`src/intelligence/security/rebuild/registry.ts:166-171` — make the unit explicit and scope-normal:

```ts
return (
  `tiers (analyzer registry census, project-independent): ${c.scan} scan / ` +
  `${c.leads} lead-tier analyzers / ${c.unsupported} unsupported (of ${c.total} analyzer specs) — ` +
  `unsupported languages are NOT scanned by bb_security; stored leads are counted below, not here`
)
```

Then regenerate the three literal examples in `docs/BB_SECURITY.md:51,75,186`
(`npx tsx script/verify-tool-docs.ts --only bb_security --write` if the doc is generated/curated by
that path; otherwise edit the curation source). No computation changes — this is a label fix plus a
doc fix; if the owner wants a real count instead, emit the registry census as one line and the
stored-lead count as the only “leads” number.

### (b) visualize
`src/intelligence/visualization/visualization-engine.ts:1023` — describe the noise filter, not
completeness; and add a gated completeness line:

```ts
: "excluded: nothing — no symbol was filtered as build/VCS noise (test sources included)")
...
const scopedPage = result.scope !== "project" || result.truncation.truncated || result.truncation.offset > 0
if (scopedPage) lines.push(
  `completeness: this is a ${result.scope} PAGE — ${result.nodes.length} of ${result.totalNodesAvailable} matching symbol(s) drawn; not the whole project`)
```

Keep the noise branch's “not the whole project” wording (it is true, but re-word to
“not the complete project” so the phrase is never the only completeness statement).

## Gate proposal (would have caught it)

1. **Security label gate** (extend `script/verify-tool-docs.ts`/security verifier): run
   `bb_security --limit 1` against a fixture project and assert (i) the header tier line matches
   `/\b\d+ lead-tier analyzers\b/` and never the bare `/\b\d+ leads\b/`; (ii) the payload's stored-lead
   line is the only line matching `/\b\d+ stored lead\(s\)/`; (iii) the two numbers are allowed to
   differ (0 stored vs N analyzers) — i.e. assert the units, not equality; and (iv) the same
   assertion over the doc's example blocks in `docs/BB_SECURITY.md` so the doc cannot drift back.
2. **Visualize scope/claim matrix gate** (`script/m66/verify-visualize-claims.ts` or the existing
   visualizer gate): for each scope `project/module/file/symbol` × {truncated page, last page} ×
   {present, absent target}, assert the text contains the string `whole project` only when
   `scope === "project" && !truncation.truncated && truncation.offset === 0 && excluded.symbols === 0`;
   assert every non-project or truncated answer carries the `completeness:` line; and assert the text
   never simultaneously contains `empty PAGE` and `whole project`. The current formatter fails the
   module/file/symbol/absent cases (5 of the 6 probes above), so the gate has a live negative control.

## Evidence index (`docs/bb-bettercap-triage/evidence/payload-honesty/`)

`security-limit5.out`, `security-limit5-history.out`, `security-workspace-limit5.out`,
`security-gql-graphql-limit5.out`, `viz-module-session-text.out`, `viz-module-session-json.out`,
`viz-project-text.out`, `viz-file-sessiongo-text.out`, `viz-symbol-New-text.out`,
`viz-gql-module-text.out`, `viz-workspace-file-axios-text.out`.
Cross-reference: Lead corroboration `evidence/lead/issue12-visualize-module-session.txt` matches this
lane's `viz-module-session-text.out`.

## Open / CANNOT-VERIFY

- Whether the security tier line is intended as an analyzer census in some other consumer of
  `formatSecurityTierDeclaration()`: the function's only callers are the three `bb_security` answer
  paths (`src/mcp/tools/bb_security/handler.ts:298,346,406`), so the relabel has no other blast
  radius — but the docs repeat the string, so the doc update is mandatory, not optional.
- Wire-level contract for `bb_visualize` HTML artifact (does the HTML sidebar repeat the claim?):
  **not probed** (out of scope for the reported text claim); text and json were captured.
