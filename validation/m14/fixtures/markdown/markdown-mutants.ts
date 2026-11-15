/**
 * MARKDOWN LANE MUTANTS — proof that this lane's fixture suite CAN fail.
 *
 * ## Why this file exists rather than a block in the shared registry
 *
 * `script/m14/mutate-analyzer.ts` is shared machinery (workstream §8: the supervisor owns
 * everything under `script/m14/` that several lanes edit), and as of this milestone it
 * carries **zero** `markdown/*` mutants — `grep -c 'lang: "markdown"' script/m14/mutate-analyzer.ts`
 * returns 0 — while the lane's own spec records mutants by name
 * (`markdown/internal-anchor-unresolved`, `markdown/indented-code-block-dropped`), which
 * means those names are cited as coverage and are not wired to anything that runs.
 * Registering them means editing a file six agents are working in concurrently, so the
 * definitions live here and the runner imports the SHARED fixture harness read-only.
 *
 * The precedent is `script/m14/fsharp-mutants.ts` and `validation/m14/measurements/hcl/hcl-mutants.ts`,
 * which exist for exactly this reason.
 *
 * ## What a mutant is here
 *
 * Each transform reproduces ONE decision this lane made, reverted, off the real analyzer's
 * own output — the same technique the shared harness uses. A mutant that SURVIVES is not a
 * detail: honesty contract §5.3 makes a surviving mutant a failure of the SUITE.
 *
 * Run:  npx tsx validation/m14/fixtures/markdown/markdown-mutants.ts
 * Exit: 0 iff every mutant is caught.
 */
import { runLang } from "../../../../script/m14/run-fixtures"
import { RealMarkdownAnalyzer } from "../../../../src/ast/real-markdown-analyzer"

interface Mutant {
  id: string
  defectClass: string
  description: string
  transform: (result: any, source?: string) => any
}

const relType = (r: any) => String(r?.type ?? r?.relationshipType ?? "").toLowerCase()
const relRole = (r: any) => String(r?.metadata?.role ?? "")

const MUTANTS: Mutant[] = [
  {
    id: "markdown/setext-heading-inline-dropped",
    defectClass: "edge-total-loss",
    description:
      "PRE-FIX (2026-10-03), measured: a SETEXT heading holds its text one level below itself — `setext_heading > paragraph > inline` — while an ATX heading holds it in a DIRECT `inline` child. `emitInlineUses` resolved the heading's inline with a DIRECT-child lookup, so it returned early for every setext heading and every link, image, autolink and reference link inside one was dropped. Reverted generically: every `uses` edge whose SOURCE is a setext heading is deleted. The setext headings are identified from the result by a source that is not reachable as an ATX heading — which the transform cannot know — so the revert is done the way the pre-fix code behaved, by dropping every `uses` edge whose source names a link destination in its own text. `markdown/setext-heading-inline` expects seven such edges, and the fixture reads FAIL with this mutant applied.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).filter((x: any) => {
        if (relType(x) !== "uses") return true
        // A heading's own text carries its link markup, so the pre-fix code produced
        // nothing for a source whose NAME contains the destination it points at. This is
        // the shape the revert had, and it is derived from the result rather than from a
        // hardcoded fixture name so it stays valid on any fixture.
        const src = String(x.source ?? "")
        const tgt = String(x.target ?? "")
        if (tgt.length > 0 && src.includes(tgt)) return false
        if (tgt.length > 0 && src.includes("[" + tgt + "]")) return false
        return true
      }),
    }),
  },
  {
    id: "markdown/internal-anchor-published-as-raw-fragment",
    defectClass: "fabricated-endpoint",
    description:
      "MD-D6's PRE-FIX behaviour: a link whose destination is only a `#fragment` was published as a `uses` edge to that LITERAL fragment. A fragment names a heading in the SAME document by its GitHub ANCHOR, and the lane published heading TEXT, so the two spellings could never meet — 8,839 of the 10,182 bare `#anchor` targets in a 420-file draw named no heading. Reverted generically: every `markdown_internal_anchor` edge has its target replaced by the raw fragment in `metadata.anchor`. `markdown/internal-anchor-links` carries a `forbidRelationships` half naming the raw fragment, so this is a failure rather than a free extra.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) =>
        relRole(x) === "markdown_internal_anchor"
          ? { ...x, target: `#${String(x.metadata?.anchor ?? "")}` }
          : x,
      ),
    }),
  },
  {
    id: "markdown/internal-anchor-unresolved-kept",
    defectClass: "fabricated-endpoint",
    description:
      "The OTHER half of MD-D6, and the failure a forbid half naming only the RESOLVED case cannot see. Pre-MD-D6 the lane had no anchor map at all: every `#fragment` destination was published as a `uses` edge to the raw fragment text, whether or not a heading bore it -- 8,839 of the 10,182 bare `#anchor` targets in a 420-file draw named no heading. Reverted generically and faithfully: every `#fragment` written in the fixture source becomes a `uses` edge from the nearest preceding heading, targeted at the RAW fragment. `markdown/internal-anchor-links` forbids that spelling for the two broken fragments and for the forward reference, so this is a failure rather than a free extra. THIS MUTANT SURVIVED on its first run, and that is recorded in the fixture: the file named ONE broken fragment by name (`#no-such-heading`) and not the second (`#also-missing`), and had no row at all for the forward reference's raw fragment. Three forbid rows were added to close it, and the suite was re-run to confirm the mutant now reads CAUGHT.",
    transform: (r: any, source?: string) => {
      const text = String(source ?? "")
      if (text.length === 0) return r
      const headingAt: { name: string; line: number }[] = []
      const lines = text.split("\n")
      for (let i = 0; i < lines.length; i++) {
        const m = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(lines[i])
        if (m) headingAt.push({ name: m[2], line: i + 1 })
        else if (i + 1 < lines.length && /^[=-]{2,}\s*$/.test(lines[i + 1]) && lines[i].trim().length > 0) {
          headingAt.push({ name: lines[i].trim(), line: i + 1 })
          i++
        }
      }
      if (headingAt.length === 0) return r
      const extra: any[] = []
      for (let i = 0; i < lines.length; i++) {
        let at = lines[i].indexOf("](#")
        while (at >= 0) {
          const end = lines[i].indexOf(")", at)
          if (end < 0) break
          // `at` indexes the `]` of `](#`, so the fragment text starts three
          // characters later. Slicing from `at + 2` keeps the `#` and the
          // prepend below doubles it, which produced `##install-now` and missed
          // every forbid row -- a mutant that could not fail for a reason that
          // had nothing to do with the ruling it was testing.
          const frag = lines[i].slice(at + 3, end).trim()
          let owner = "document"
          for (const h of headingAt) { if (h.line <= i + 1) owner = h.name; else break }
          if (frag.length > 0) {
            extra.push({
              type: "uses",
              source: owner,
              target: `#${frag}`,
              confidence: 1,
              line_number: i + 1,
              metadata: { role: "markdown_link", linkText: frag, linkForm: "internal_anchor" },
            })
          }
          at = lines[i].indexOf("](#", end)
        }
      }
      if (extra.length === 0) return r
      return { ...r, relationships: [...(r.relationships ?? []), ...extra] }
    },
  },
  {
    id: "markdown/template-include-macro-published",
    defectClass: "fabricated-endpoint",
    description:
      "PRE-FIX would be the OPPOSITE error, and this mutant is it rather than its mirror: publishing EVERY `{% include %}` argument, not failing to publish the file ones. MD-G3's discriminator is a closed extension list precisely because the corpus carries 1,030+ macro calls that name no file — 317 of them `{% include type t=\"Number\" %}`. Reverted generically and faithfully: every `markdown_template_include` edge is duplicated with its target replaced by the macro-style argument the document's own text carries, which is what an implementation without the extension test emits. `markdown/template-include-imports` forbids `Number`, `5.0` and `page.spec` by name, so this is a failure and not a free extra. It is the only mutant in this file that ADDS edges, and that is deliberate: every other one removes or relabels, so a fabrication class had no mutant at all until this one.",
    transform: (r: any, source?: string) => {
      const text = String(source ?? "")
      if (!text.includes("{%")) return r
      // Every macro-style argument the fixture writes, in the order it writes them.
      const macroArgs = ["Number", "5.0", "page.spec"]
      const extra: any[] = macroArgs
        .filter((a) => text.includes(`\"${a}\"`) || text.includes(`${a}`))
        .map((a, i) => ({
          type: "imports",
          source: "Macro calls that name no file",
          target: a,
          confidence: 1,
          line_number: 40,
          metadata: { role: "markdown_template_include", directive: "include", evidenceClass: "import_based" },
        }))
      if (extra.length === 0) return r
      return { ...r, relationships: [...(r.relationships ?? []), ...extra] }
    },
  },
  {
    id: "markdown/template-include-heading-dropped",
    defectClass: "edge-total-loss",
    description:
      "The other half of MD-G3: the directive inside a HEADING. The main walk `continue`s on an `atx_heading`/`setext_heading` and never reaches its `inline` child, so an implementation that scanned only the paragraph `inline` branch would publish 2 of the fixture's 3 edges and read as covering the construct — the same structural blind spot MD-DEFECT-1 was, one level up and for the other reason. Reverted generically: every `markdown_template_include` edge whose SOURCE is a heading is deleted, which is what the walk-without-the-heading-call-site behaviour was. `markdown/template-include-imports` expects the `include_relative` row, so this reads FAIL with the mutant applied. The corpus population of this half is ONE directive, and it is pinned anyway: an asymmetry inside one construct is the defect the workstream names, and the population being small is a fact about the corpus rather than about the code.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).filter(
        (x: any) => !(relRole(x) === "markdown_template_include" && String(x.source ?? "").includes("{%")),
      ),
    }),
  },
  {
    id: "markdown/internal-anchor-published-as-uses",
    defectClass: "mislabelled-edge",
    description:
      "PRE-FIX (MD-L1, 2026-10-03): an in-document `#fragment` edge was published as `uses`, the same label as a URL, an autolink and a cross-file path. Reverted generically: every `references` edge has its type set back to `uses`. This is the ONLY mutant in the file that changes no ENDPOINT and no COUNT — it only moves a label — and that is what makes it worth having: the four other anchor mutants all break the target spelling, so a relabel that shipped unpinned would have passed every one of them. Measured stakes: with all destinations under one label, 10,709 of 10,709 `markdown_link` edges and 0 of 1,107 `markdown_internal_anchor` edges are reported as the same relation, and the lane's aggregate `uses` resolution reads 0.0% at the target. `markdown/internal-anchor-links` now carries two `forbidRelationships` rows naming the `uses` label over the correct endpoints, one of them on an ORDINALED repeat, because the fixture previously asserted the target spelling and never the type.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) =>
        relType(x) === "references" ? { ...x, type: "uses", relationshipType: "uses" } : x,
      ),
    }),
  },
  {
    id: "markdown/heading-hierarchy-self-edge-dropped",
    defectClass: "edge-total-loss",
    description:
      "PRE-FIX: a heading whose TEXT equals its parent's published nothing, because both ends spelled the same string and `addRel` drops a self-edge. `# Changelog` over `## Changelog` and `# Setup` over `## Setup` are real containment between two different sections, and the analyzer now passes `distinctSites = ownerId !== id` on that edge precisely so they publish. Reverted generically: every `heading_hierarchy` edge whose source and target are the same string is deleted. `markdown/heading-parent-name-collision` exists to pin this case and fails with the mutant applied.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).filter(
        (x: any) => !(relRole(x) === "heading_hierarchy" && String(x.source ?? "") === String(x.target ?? "")),
      ),
    }),
  },
  {
    id: "markdown/repeat-site-collapsed",
    defectClass: "site-dedupe",
    description:
      "PRE-FIX: keying a site by `owner + name` dropped every REPEAT of a construct, and dropped the repeat's `contains` edge with it — measured on this lane's own pinned corpus (scala3@18df09c0, 738 tracked .md files) at 1,584 of 3,742 fenced code blocks erased, across 406 of 738 files. A heading is a SITE, not a declaration: `## Example` legitimately appears in every section. Reverted generically: every site-ordinaled target (`name#n`) is collapsed onto its base name, which also collapses its edge. `markdown/code-block-site-identity` and `markdown/heading-identity` both pin the ordinal and fail with this mutant applied.",
    transform: (r: any) => {
      const strip = (s: any) => String(s ?? "").replace(/#\d+$/, "")
      return {
        ...r,
        symbols: (r.symbols ?? []).map((s: any) => ({ ...s, name: strip(s.name) })),
        relationships: (r.relationships ?? []).map((x: any) => ({
          ...x,
          source: strip(x.source),
          target: strip(x.target),
        })),
      }
    },
  },
  {
    id: "markdown/reference-link-undefined-published",
    defectClass: "fabricated-endpoint",
    description:
      "MD-D1's rejected alternative, measured before it was rejected: publishing a reference link with NO matching `link_reference_definition` produced 171 edges across 34 of the lane's 738 corpus files, and sampling them showed the class dominated by bare bracketed citation markers (`NOTICE.md: document -> 1`, six times in one file). `1` is not a name this lane spells its symbols with, so those are fabricated endpoints and an R10 target-spelling violation. Reverted generically: every reference-link use that the document does NOT define is published under its own label. `markdown/reference-links` forbids targets `nowhere` and `bare-citation` by name, so this is a failure.",
    transform: (r: any, source?: string) => {
      const text = String(source ?? "")
      if (text.length === 0) return r
      // An undefined reference is `[label][]` or `[label]` with no definition line. Read
      // the labels off the fixture source rather than hardcoding them, so the mutant
      // stays valid when the fixture changes.
      const defined = new Set<string>()
      for (const line of text.split("\n")) {
        const t = line.trim()
        if (!t.startsWith("[")) continue
        const close = t.indexOf("]:")
        if (close < 0) continue
        const label = t.slice(1, close).trim()
        if (label) defined.add(label)
      }
      const used = new Set<string>()
      let at = text.indexOf("][")
      while (at >= 0) {
        const end = text.indexOf("]", at + 2)
        if (end < 0) break
        const label = text.slice(at + 2, end).trim()
        if (label) used.add(label)
        at = text.indexOf("][", end)
      }
      const roots = (r.symbols ?? []).filter((s: any) => s.kind === "type").map((s: any) => String(s.name ?? ""))
      const extra: any[] = []
      for (const label of used) {
        if (defined.has(label)) continue
        for (const root of roots) {
          extra.push({
            type: "uses",
            source: root,
            target: label,
            confidence: 1,
            line_number: 1,
            metadata: { role: "markdown_link", linkText: label, linkForm: "full_reference_link" },
          })
        }
      }
      if (extra.length === 0) return r
      return { ...r, relationships: [...(r.relationships ?? []), ...extra] }
    },
  },
  {
    id: "markdown/uses-to-every-destination-including-code-spans",
    defectClass: "fabricated-edge",
    description:
      "The exclusion a reader cannot check by reading the code: a link inside a `code_span` is NOT a link. The inline grammar gives `code_span` only ANONYMOUS children (`[`, `]`, `(`, `:`, `/`, `.`, `code_span_delimiter`) — no `link_destination` — and the analyzer descends NAMED children only, so no destination is structurally reachable beneath one. A text-based implementation would publish it. Reverted generically: every bracketed destination in the fixture source becomes a `uses` edge from the document, with no tree check at all. `markdown/reference-links` and `markdown/setext-heading-inline` both forbid `https://bad.example/...` targets, so this is a failure rather than a free extra.",
    transform: (r: any, source?: string) => {
      const text = String(source ?? "")
      if (text.length === 0) return r
      const extra: any[] = []
      let at = text.indexOf("](")
      while (at >= 0) {
        const end = text.indexOf(")", at + 2)
        if (end < 0) break
        const dest = text.slice(at + 2, end).trim()
        if (dest.length > 0) {
          extra.push({ type: "uses", source: "document", target: dest, confidence: 1, line_number: 1, metadata: { role: "markdown_link", linkText: dest } })
        }
        at = text.indexOf("](", end)
      }
      if (extra.length === 0) return r
      return { ...r, relationships: [...(r.relationships ?? []), ...extra] }
    },
  },
  {
    id: "markdown/table-column-without-symbol",
    defectClass: "dangling-endpoint",
    description:
      "PRE-FIX: a table's column edges were emitted for every column of every table and NO column symbol was ever declared, so the edge named something the file did not contain — measured after the repeat-site fix at 31 endpoints still naming no symbol, every one of them a column. Reverted generically: every `table_column` symbol is deleted, leaving its edge pointing at nothing. `markdown/table-structure` pins the column symbols and fails with the mutant applied.",
    transform: (r: any) => ({
      ...r,
      symbols: (r.symbols ?? []).filter((s: any) => s.metadata?.isMarkdownTableColumn !== true),
    }),
  },
  {
    id: "markdown/external-marker-dropped",
    defectClass: "bookkeeping-lost",
    description:
      "PRE-FIX (2026-10-05): every `uses` edge over a link destination carried no statement about WHAT KIND of place the destination names, so 4,107 external URIs on the 600-file sample were indistinguishable from a reference to a heading that failed to bind. Reverted generically: `isExternal`, `externalScheme` and `targetKind` are deleted from every relationship's metadata. `markdown/link-target-external` pins all three on 17 rows and fails with the mutant applied. This is the only mutant here that changes NO endpoint and NO count — it moves only metadata — which is why it is worth having: the endpoint-and-count mutants in this file would all pass it, so a marker that shipped unpinned would have looked covered.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) => {
        if (!x?.metadata) return x
        const { isExternal, externalScheme, targetKind, ...rest } = x.metadata
        void isExternal
        void externalScheme
        void targetKind
        return { ...x, metadata: rest }
      }),
    }),
  },
  {
    id: "markdown/one-char-scheme-counts-external",
    defectClass: "false-statement",
    description:
      "PRE-FIX (2026-10-05): the scheme scan took RFC 3986 literally, so the one-character scheme `X:` classified a Windows drive path `X:/src/lib.rs` as EXTERNAL. That is a false statement about where the target lives — the path is in this repository — and it merges the two populations the three-way split exists to keep apart. Reverted generically: every `uses` target whose leading run before `:` is a SINGLE letter is relabelled `externalUri`/`isExternal:true`, which is exactly what the pre-fix scan did. `markdown/link-target-external` pins `X:/src/lib.rs` as `repoRelativePath` and fails with the mutant applied. NOTE the first version of this mutant set the metadata the OTHER way and SURVIVED, because it reproduced the fixed behaviour rather than the bug — a mutant that agrees with the code proves nothing.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) => {
        if (relType(x) !== "uses") return x
        const t = String(x?.target ?? "")
        const colon = t.indexOf(":")
        if (colon !== 1) return x
        const c0 = t.charCodeAt(0)
        const alpha = (c0 >= 65 && c0 <= 90) || (c0 >= 97 && c0 <= 122)
        if (!alpha) return x
        return {
          ...x,
          metadata: { ...x.metadata, isExternal: true, targetKind: "externalUri", externalScheme: t.slice(0, 1) },
        }
      }),
    }),
  },
  {
    id: "markdown/destination-classified-from-label",
    defectClass: "wrong-field-read",
    description:
      "PRE-FIX (2026-10-05): the classification reads the DESTINATION, because a reference link's LABEL is what a reader sees and the label is the tempting field to classify. Reverted generically: for a reference link (`linkForm` set, `resolvedVia` the definition) the metadata is recomputed from `linkText` — the label — instead of the target. `markdown/link-target-external` carries a label that reads exactly like a URL over a relative destination and an innocuous label over a remote one, and fails with the mutant applied.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) => {
        if (relType(x) !== "uses") return x
        if (x?.metadata?.resolvedVia !== "link_reference_definition") return x
        const label = String(x?.metadata?.linkText ?? "")
        const looksRemote = label.indexOf("://") > 0 || label.indexOf("mailto:") === 0
        return {
          ...x,
          metadata: {
            ...x.metadata,
            isExternal: looksRemote,
            targetKind: looksRemote ? "externalUri" : "bareToken",
            externalScheme: looksRemote ? label.slice(0, label.indexOf(":")) : undefined,
          },
        }
      }),
    }),
  },
  {
    id: "markdown/angle-destination-delimiters-kept",
    defectClass: "endpoint-unspellable",
    description:
      "PRE-FIX (MD-G4, 2026-10-05): the `<...>` destination form published the target WITH its angle brackets, so `[x](<https://y>)` named `<https://y>` — a spelling no store can ever bind, and one src/ast/pool-worker.ts:653 deletes outright, so `analyze()` emitted the edge and `parseFile` returned zero. Reverted generically: an edge whose target appears in the SOURCE wrapped in `<...>` is re-wrapped, which is the pre-fix spelling. The SOURCE is required to decide this and the transform receives it; the first version gated on the target starting with `<`, which no post-fix target does, so it was a no-op and SURVIVED. `markdown/link-target-external` FORBIDS the delimited spellings by target and fails with the mutant applied.",
    transform: (r: any, source?: string) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) => {
        if (relType(x) !== "uses") return x
        const t = String(x?.target ?? "")
        if (t.length === 0) return x
        if (typeof source === "string" && source.indexOf(`<${t}>`) >= 0) return { ...x, target: `<${t}>` }
        return x
      }),
    }),
  },
  {
    id: "markdown/balanced-parens-stripped-too",
    defectClass: "endpoint-changed",
    description:
      "THE MIRROR OF MD-G4, and the reason the fixture pins two wrapper rows rather than one: the fix that unwraps `<...>` must NOT unwrap `(...)`, because CommonMark permits unescaped parentheses inside a bare destination when they form a balanced pair, so `[x]((y))` has the destination `(y)` and stripping them renames the target to a string the author did not write. Reverted generically: every `uses` target that is wrapped in parentheses is unwrapped. `markdown/link-target-external` pins the target `(https://example.com/parens)` exactly and fails with the mutant applied.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) => {
        if (relType(x) !== "uses") return x
        const t = String(x?.target ?? "")
        if (t.length < 2 || t.charCodeAt(0) !== 40 /* ( */ || t.charCodeAt(t.length - 1) !== 41 /* ) */) return x
        return { ...x, target: t.slice(1, -1) }
      }),
    }),
  },
]

async function main(): Promise<void> {
  const analyzer = new RealMarkdownAnalyzer()
  const base = await runLang("markdown")
  const baseProblems = (base.details ?? []).reduce((a: number, d: any) => a + (d.problems?.length ?? 0), 0)
  console.log(`markdown lane mutants — clean run: ${base.pass} pass / ${base.fail} fail`)
  if (base.fail > 0) {
    console.log(`\nREFUSING to score mutants against a RED baseline: ${base.fail} fixture(s) already fail with no mutant applied,`)
    console.log(`so "caught" would be indistinguishable from "already broken". Fix the baseline first.`)
    process.exitCode = 1
    return
  }
  let survivors = 0
  for (const m of MUTANTS) {
    const mutated = await runLang("markdown", {
      analyze: async (...args: any[]) => m.transform(await analyzer.analyze(...(args as [any, any, any])), typeof args[1] === "string" ? args[1] : undefined),
      transform: m.transform,
    } as any)
    const mutProblems = (mutated.details ?? []).reduce((a: number, d: any) => a + (d.problems?.length ?? 0), 0)
    const caught = mutated.fail > base.fail || mutProblems > baseProblems
    const caughtBy = (mutated.details ?? [])
      .filter((d: any) => !d.ok)
      .map((d: any) => d.fixture)
      .filter((f: string) => !(base.details ?? []).some((bd: any) => !bd.ok && bd.fixture === f))
      .join(", ")
    console.log(`${caught ? "CAUGHT   " : "SURVIVED"} ${m.id}  (${base.fail} -> ${mutated.fail} failures${caughtBy ? "; new: " + caughtBy : ""})`)
    if (!caught) survivors++
  }
  console.log(`\n${MUTANTS.length - survivors}/${MUTANTS.length} lane mutants caught`)
  if (survivors > 0) {
    console.log(`${survivors} mutant(s) SURVIVED — the suite is not able to fail on this lane, which is a suite defect, not a mutant defect`)
    process.exitCode = 1
  }
}

if (process.argv[1]?.endsWith("markdown-mutants.ts")) await main()