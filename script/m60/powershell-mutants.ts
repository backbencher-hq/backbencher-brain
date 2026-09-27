/**
 * M60 (#278) — the powershell mutant set.
 *
 * Every entry is a faithful REVERT of a shape this lane was MEASURED to emit
 * before its wave, written generically off the result's own fields and its own
 * file name — never a name filter, because a name filter silently stops matching
 * the moment a fixture is renamed, which is the failure mode that left
 * `swift/drop-container-subscript-uses` surviving. The two identities a powershell
 * revert needs are both derivable from the result: the file symbol is the
 * `module` row, and every pre-fix placeholder was the literal string `global`.
 *
 * The lane had ZERO mutants when this set was written, which is the finding:
 * 1,009 mutants existed across 28 other languages and none could fail on
 * anything PowerShell did, so all of the wave's work — the file owner, the line
 * contract, method scope, the read edges, the reserved-word guards, the
 * suppression fixes — was unverified against deliberate defect.
 *
 * Each `caughtBy` is named in the description so a reader can see which pin
 * carries the class, and each was proven load-bearing by running the suite with
 * the guard disabled (the census's own `--selftest` plus a full `run-fixtures`
 * with the corresponding revert applied).
 */

/** The file's own basename: the `module` symbol PS1 added. */
const psFileName = (r: any): string =>
  (r.symbols ?? []).find((s: any) => s.kind === "module")?.name ?? "script.ps1"

/** Does this edge carry the metadata key with the given value? */
const psHas = (rel: any, key: string, value: unknown): boolean =>
  (rel?.metadata ?? {})[key] === value

/** Strip a field from every relationship. */
const psDropRelField = (field: string) => (r: any) => ({
  ...r,
  relationships: (r.relationships ?? []).map((x: any) => {
    const { [field]: _dropped, ...rest } = x
    return rest
  }),
})

/**
 * The two export mutants below reproduce the SHAPE of the one-token reader and of
 * the un-deduplicated writer, generically, off the result's own fields rather than
 * off a fixture name. Writing them as literal deletions would have been simpler and
 * would have proved nothing: a mutant that hard-codes the fixture it was written
 * for measures that fixture, not the behaviour.
 */
/** Keep only the first export row per source line — what a one-token value reader yields for a comma list. */
const dedupeKeepFirstPerLine = (exports: any[]): any[] => {
  const seen = new Set<string>()
  const out: any[] = []
  for (const e of exports ?? []) {
    const key = `${e?.range?.start?.line ?? e?.line ?? "?"}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(e)
  }
  return out
}

/** The relationship half of the same revert: one `exports` edge per source line. */
const dedupeKeepFirstExportsRel = (rels: any[]): any[] => {
  const seen = new Set<string>()
  const out: any[] = []
  for (const x of rels ?? []) {
    if (x?.type === "exports") {
      const key = `exports|${x.line_number ?? "?"}`
      if (seen.has(key)) continue
      seen.add(key)
    }
    out.push(x)
  }
  return out
}

/** A second copy of each distinct export name — the un-deduplicated writer's output. */
const duplicateFirstOfEach = (names: string[]): any[] => {
  const seen = new Set<string>()
  const out: any[] = []
  for (const n of names) {
    const k = String(n).toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push({ name: n })
  }
  return out
}

/** The relationship half of the duplicate mutant. */
const duplicateFirstExportsRel = (rels: any[]): any[] => {
  const seen = new Set<string>()
  const out: any[] = []
  for (const x of rels ?? []) {
    if (x?.type !== "exports") continue
    const k = `${String(x.target ?? "").toLowerCase()}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push({ ...x, line_number: (x.line_number ?? 0) + 1 })
  }
  return out
}

import type { Mutant } from "../m14/mutate-analyzer"

export const POWERSHELL_MUTANTS: Mutant[] = [
  {
    id: "powershell/global-file-owner",
    language: "powershell",
    defectClass: "fabrication",
    description:
      "PS1 REVERT: the file-scope edge source goes back to the literal string `global`. That is the pre-wave shape verbatim (`relSource() || \"global\"`), and it is a fabrication by construction: `isIndexArtifactName` (src/ast/analysis-exclusions.ts:129) rejects `global` as a symbol name, so not one of those edges can ever resolve to a stored row — measured at the store as 4 of 7 relationships on a two-file project with `source_symbol_id = NULL`, and `bb_graph` on a method that IS called answering `callers: []`. Caught by the `global` forbid half of EVERY powershell fixture (9 fixtures), which is the point of forbidding it there rather than merely omitting it.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) =>
        x.source === psFileName(r) ? { ...x, source: "global" } : x),
    }),
  },
  {
    id: "powershell/drop-line-number",
    language: "powershell",
    defectClass: "payload-loss",
    description:
      "PS2 REVERT: no relationship carries a `line_number` at all. Measured pre-wave: 0 of 3,410 on the production draw, with the graph surface rendering `\"callSite\": {\"file\": \"Deploy.ps1\", \"line\": null}` as if it knew a position (M59 #825's per-language handoff, open for this lane). Caught by per-site-lines-psb2's eight line pins.",
    transform: psDropRelField("line_number"),
  },
  {
    id: "powershell/edge-key-per-set",
    language: "powershell",
    defectClass: "relationship-loss",
    description:
      "PS2 REVERT: the edge identity loses the line, going back to `source|type|target` — the pre-fix key verbatim, i.e. PER-SET, so the first site's line is kept and every later site of the same edge is swallowed. This is haskell's `edge-line-per-set` mutant in a second language. Caught by per-site-lines-psb2's `expectRelationshipCount` rows (THREE sites of `Invoke-Helper`, TWO of `Get-Thing`); a fixture pinning only `line_number: <one line>` would NOT catch it, which is why those counts are pinned in the same file.",
    transform: (r: any) => {
      const seen = new Set<string>()
      return {
        ...r,
        relationships: (r.relationships ?? []).filter((x: any) => {
          const k = `${x.source}|${x.type}|${x.target}`
          if (seen.has(k)) return false
          seen.add(k)
          return true
        }),
      }
    },
  },
  {
    id: "powershell/line-from-declaration-start",
    language: "powershell",
    defectClass: "misattribution",
    description:
      "PS2 REVERT: every edge takes the line of the ENCLOSING DECLARATION instead of the line its own name is written on. M60 #921's measured pre-fix shape, family-wide (366 csharp rows behind an attribute were exactly this). Caught by per-site-lines-psb2's forbid rows for `contains … @21` and `@27` and by the `calls Get-Thing -> Write-Host @20` row — the first version of that fixture asserted the wrapped-declaration trap on a row where start line and name line coincided, so the trap was added on the row where they differ.",
    transform: (r: any) => {
      // The first symbol of each owner is the enclosing declaration, and its
      // start line is what the pre-fix code stamped. Derived from the result's
      // own shape rather than from a fixture name.
      //
      // The FILE bucket needs seeding by hand: the `module` symbol PS1 added is
      // the file's own owner, so it carries no `ownerName` — the first version of
      // this transform therefore left every file-scope edge untouched and the
      // mutant SURVIVED, which is the outcome that caught it.
      const declLine = new Map<string, number>()
      const file = psFileName(r)
      for (const s of r.symbols ?? []) {
        if (s.kind === "module") { declLine.set(file, s.startLine ?? 1); continue }
        const owner = s.ownerName ?? s.scope ?? ""
        if (owner && !declLine.has(owner)) declLine.set(owner, s.startLine ?? 0)
      }
      return {
        ...r,
        relationships: (r.relationships ?? []).map((x: any) => {
          if (typeof x.line_number !== "number") return x
          const l = declLine.get(x.source)
          return l ? { ...x, line_number: l } : x
        }),
      }
    },
  },
  {
    id: "powershell/method-to-class-owner",
    language: "powershell",
    defectClass: "misattribution",
    description:
      "PS3 REVERT: a `method`/`constructor` symbol's outgoing edges are re-attributed to its OWNER (the class) — the pre-wave shape, because the pre-wave lane pushed no owner for `class_method_definition`. Measured at the SURFACE: `bb_graph Start` returned `callers: []` and `callees: []` at once, a dead end in both directions, and the class absorbed every method's calls. Caught by method-scope-psb3's three forbid rows (`calls Deployment -> Write-Host`, `calls TurboDeployment -> Write-Host`, `calls Deployment -> Write-Verbose`) and by its three method-sourced expect rows. Written generically off the symbol table, so it reverts whatever the fixture declares — the reason a name filter was not used.",
    transform: (r: any) => {
      const ownerOf = new Map<string, string>()
      for (const s of r.symbols ?? []) {
        const owner = s.ownerName ?? s.scope
        if (owner && (s.kind === "method" || s.kind === "constructor")) ownerOf.set(s.name, owner)
      }
      return {
        ...r,
        relationships: (r.relationships ?? []).map((x: any) =>
          ownerOf.has(x.source) ? { ...x, source: ownerOf.get(x.source) } : x),
      }
    },
  },
  {
    id: "powershell/ctor-named-after-class",
    language: "powershell",
    defectClass: "identity",
    description:
      "PS4 REVERT: a constructor symbol goes back to the CLASS's name and its containment edge is dropped as a self-edge. PowerShell writes a constructor with the class's own name, so this is the pre-wave state exactly — and the store then refused the owner as well, because its M51.A1 self-ownership guard compares `parentSymbol.name !== symbol.name`. Measured: every PowerShell class constructor stored with `owner_symbol_id = NULL` while the property and method beside it were linked, i.e. an orphan in the graph. Caught by method-scope-psb3's `contains Deployment -> Deployment` forbid row and its `forbidSymbols` constructor row.",
    transform: (r: any) => {
      const classes = new Set(
        (r.symbols ?? []).filter((s: any) => s.kind === "class").map((s: any) => s.name),
      )
      return {
        ...r,
        symbols: (r.symbols ?? []).map((s: any) =>
          s.kind === "constructor" ? { ...s, name: s.ownerName ?? s.owner ?? s.name } : s),
        relationships: (r.relationships ?? []).filter((x: any) => {
          if (x.type !== "contains") return true
          // The pre-wave guard: a constructor never contains itself.
          return !(classes.has(x.source) && x.target === x.source)
        }),
      }
    },
  },
  {
    id: "powershell/drop-member-reads",
    language: "powershell",
    defectClass: "relationship-loss",
    description:
      "PS9 REVERT: `member_access` contributes nothing, which is the pre-wave `case` whose entire body was `break` (\"Property reads ($obj.Prop) are not declarations or calls — no edge\"). Measured: 0 `uses` edges in 2,145 symbols and 3,410 relationships, with 20,188 `member_access` occurrences in the production draw unread. This is the #740 kotlin defect class in a second language, unregistered because no corpus lane existed to see it. Caught by member-reads-psb5's six read-form pins, method-scope-psb3's three member rows, and data-shapes-psb10's `$options.Label` read.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).filter(
        (x: any) => !(x.type === "uses" && psHas(x, "isMemberAccess", true)),
      ),
    }),
  },
  {
    id: "powershell/drop-member-writes",
    language: "powershell",
    defectClass: "relationship-loss",
    description:
      "PS9 REVERT, the write half: a member WRITE stops being a use. The pre-wave lane emitted no edge for `$this.Name = $x` at all, so a property's only appearance in the graph was its declaration — a class with a hundred assignments had one incoming edge. Caught by method-scope-psb3's two `isMemberWrite` rows and member-reads-psb5's `$s.Attempts = 1` row. Pinned separately from the read half because the two are DIFFERENT code paths: the write is found on the assignment's LHS subtree and the read on the `member_access` node itself, and a fix that lands one has repeatedly not landed the other in this repo's own history.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).filter(
        (x: any) => !(x.type === "uses" && psHas(x, "isMemberWrite", true)),
      ),
    }),
  },
  {
    id: "powershell/drop-element-access",
    language: "powershell",
    defectClass: "relationship-loss",
    description:
      "PS9 REVERT, element access: `$h['Key']`, `$a[0]` and `$m[$i][$j]` publish nothing. The pre-wave lane had no `element_access` case at all, so the second commonest subscript form in the language was dark even after the member-read work. The pre-wave measurement of this lane reported ZERO `uses` of any kind, so the whole class is the revert. Caught by member-reads-psb5's two element-access rows and data-shapes-psb10's numeric-index row. NOT paired with a `takes-receiver` mutant: the misattribution half (reading the RECEIVER instead of the key, which the first fix did because the search started at the node rather than at its second child) cannot be re-derived from the analyzer's RESULT — the pre-fix code saw a tree, and the result does not carry the receiver. That half is pinned by member-reads-psb5's `uses -> names @40` FORBID row instead, and a mutant that cannot be written faithfully is not written: an entry that cannot fail is decoration, which is the standard this repo holds its registry to.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).filter(
        (x: any) => !(x.type === "uses" && psHas(x, "isElementAccess", true)),
      ),
    }),
  },
  {
    id: "powershell/drop-subexpression-reads",
    language: "powershell",
    defectClass: "relationship-loss",
    description:
      "PS16 REVERT: an interpolated `sub_expression` (`$($obj.Member)`) and a bare interpolated variable in a double-quoted string contribute no read. The pre-wave lane never named `sub_expression` at all, so every interpolated subexpression was dark — 283 sites in the production draw. This is verbatim the class `reviews/m49-groovy-gstring-interpolation.md` found in groovy: parse-clean, line-clean, oracle-clean and GRAPH-INCOMPLETE, which is why every gate in the repo was green on it. Caught by member-reads-psb5's `\"user=$($s.User)\"` and `\"plain=$settings\"` rows.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).filter((x: any) => {
        if (x.type !== "uses") return true
        if (psHas(x, "isMemberAccess", true)) return true
        if (psHas(x, "isElementAccess", true)) return true
        if (psHas(x, "isReceiverReference", true)) return true
        if (psHas(x, "isTypeReference", true)) return true
        // What is left is a BARE variable read, and in this lane the only place
        // the analyzer emits one is inside an interpolated string or a
        // subexpression — an ordinary statement's `$x` is a DECLARATION, not a
        // read. So this filter is precisely the interpolation class, and the
        // first version of it returned `true` unconditionally, which is why the
        // mutant SURVIVED and had to be rewritten.
        return !(psHas(x, "isVariableReference", true))
      }),
    }),
  },
  {
    id: "powershell/keyword-becomes-a-call",
    language: "powershell",
    defectClass: "fabrication",
    description:
      "PS5 REVERT: the reserved-word guards are removed, so a language keyword in command position is published as a `calls` edge. Two measured classes, and the second is invisible to every gate in the repository: (a) the grammar models an advanced function's named blocks `begin`/`process`/`end`/`clean`/`dynamicparam` as `command` nodes — reproduced in isolation as `hasError=false`, `command nodes: [\"End\",\"Process\",\"Begin\"]` — so each was a fabricated edge, hand-confirmed at `dsc/pwsh.profile.resource.ps1:15-16`; (b) an `if` written as an EXPRESSION (`$x = if (…) { } elseif (…) { }`) parses with `hasError = false` and still leaves `elseif`/`else` as bare commands, which F1 (unknown node types), F10 (parse success) and the M12 corpus-errors census (ERROR nodes) all miss. Caught by reserved-words-psb4's ten keyword forbid rows. The census `script/m60/powershell-keyword-census.ts` catches the same class over the real corpora and is proven load-bearing by revert (10 named sites across 5 files).",
    transform: (r: any) => {
      // The pre-wave fabrication, reconstructed: every advanced function or script
      // published a `calls` edge for each of its named blocks. Built from the
      // DECLARATION the blocks belong to, which the result carries, so this needs
      // no fixture name and cannot silently stop matching when a fixture is
      // renamed. The first version of this transform was a no-op with a `.concat`
      // of nothing in it, which is why it SURVIVED.
      const blocks = ["begin", "process", "end", "clean", "dynamicparam"]
      const extra: any[] = []
      for (const s of r.symbols ?? []) {
        if (s.kind !== "function" && s.kind !== "module") continue
        const owner = s.ownerName ?? s.scope ?? psFileName(r)
        for (const b of blocks) {
          extra.push({
            source: owner,
            target: b,
            type: "calls",
            confidence: 0.6,
            line_number: s.startLine ?? 1,
            metadata: { powershellSpecific: true },
          })
        }
      }
      return { ...r, relationships: [...(r.relationships ?? []), ...extra] }
    },
  },
  {
    id: "powershell/switch-arg-becomes-module",
    language: "powershell",
    defectClass: "fabrication",
    description:
      "PS7 REVERT: the token after a `command_parameter` is taken as a value with no switch-argument filter, so `-ErrorAction Stop` publishes `Stop` as a second external module import. Measured on the pinned corpus at `tools/packaging/packaging.psm1`, where the pre-wave import table held a module named `Stop`. Caught by module-surface-psb9's `forbidImports` rows for `Stop` and `SilentlyContinue`.",
    // This one needs the SOURCE, and the Mutant interface provides it
    // (`transform(result, source)`) precisely for a defect class whose pre-fix
    // output was derived from the source text in a way the post-fix result no
    // longer records. The pre-wave reader emitted a module import for the VALUE
    // of every two-token parameter, and that value appears nowhere in the
    // post-fix result — the guard removed it, which is the whole point of the
    // fix. Reconstructing it from the analyzer's own imports instead would be a
    // fabrication in the other direction: the mutant would be guessing.
    transform: (r: any, source?: string) => {
      if (!source) return r
      const extra: any[] = []
      const imports: any[] = []
      // Every `-<Flag> <Value>` pair whose flag is a known switch-argument flag.
      const SWITCH_FLAGS = ["-ErrorAction", "-WarningAction", "-InformationAction", "-Verbose", "-Debug"]
      for (const m of source.matchAll(/(-ErrorAction|-WarningAction|-InformationAction)\s+([A-Za-z]+)/gi)) {
        const value = m[2]
        void SWITCH_FLAGS
        imports.push({
          module: value,
          items: ["*"],
          isDefault: true,
          metadata: { powershellSpecific: true, via: "Import-Module" },
        })
        extra.push({
          source: psFileName(r), target: value, type: "references",
          confidence: 0.9, line_number: 0, metadata: { powershellSpecific: true, import: true },
        })
      }
      return { ...r, imports: [...(r.imports ?? []), ...imports], relationships: [...(r.relationships ?? []), ...extra] }
    },
  },
  {
    id: "powershell/drop-exports",
    language: "powershell",
    defectClass: "relationship-loss",
    description:
      "PS20 REVERT: `Export-ModuleMember` publishes no `exports` edge and no export row, which is the pre-wave state — `exports: []` was hard-coded in the return. A module's public API was therefore invisible: nothing in the graph said which of a module's functions a consumer could call. Caught by module-surface-psb9's `expectExports`/`forbidExports` pair and its `exports` relationship row; the forbid half is what makes the list a SURFACE rather than a roll-call.",
    transform: (r: any) => ({
      ...r,
      exports: [],
      relationships: (r.relationships ?? []).filter((x: any) => x.type !== "exports"),
    }),
  },
  // NOT AN ENTRY, AND THE REASON IS THE POINT — a fourth instance of this lane's
  // "an entry that cannot fail is decoration" rule, after `emit-from-recovery-region`.
  //
  // There is a third mutation available here: revert the comma-list value read to
  // the single-token `valueAfterNode(elements, i)` it replaced, so
  // `Export-ModuleMember -Function A, B` publishes only `A`. It was written, and it
  // SURVIVED — 0 failures before, 0 after — because no fixture in the lane contains
  // a comma-separated export list. The obvious fix is to add one, and adding one
  // makes the FIXTURE UNPARSEABLE: the grammar cannot lex a comma-separated command
  // argument at all, which is the whole of the G6 class (245 parameter-form sites
  // across both corpora). So the construct this mutant reverts is not merely
  // unpinned, it is currently UNREACHABLE, and a fixture cannot assert on text the
  // parser cannot read.
  //
  // The comma-list read therefore stays in the analyzer — it is correct, and the
  // duplicate mutant below proves the code path is exercised — but its own revert is
  // not admitted as a mutant, because admitting it would put a permanently-green row
  // in the lane's mutation evidence and a permanently-green row is worse than no row:
  // it is read as coverage. This entry reappears the moment G6 lands and the form
  // becomes parseable, and the fixture row to go with it is written in
  // reviews/powershell/grammar-worklist.md under G6.
  {
    id: "powershell/export-allows-duplicate-name",
    language: "powershell",
    defectClass: "fabrication",
    description:
      "REVERT: `addExport` stops deduplicating on the exported name, so a name reachable by two paths in one statement is published twice. The comma-list fix is what made this reachable — a value in `command_elements` is preceded by a `command_argument_sep` that BOTH the flag's value walk and the bare-value branch match, so `Export-ModuleMember -Function F` sees `F` twice. Found by module-surface-psb9's export invariant (`duplicate export name(s)`) rather than by a count, which is the whole reason that invariant is in the harness: the corpus emits the same edge twice without any number changing shape. PowerShell identifiers are case-insensitive, so the real invariant is one export per name per module, and a reader keying the graph on the name would otherwise see two rows for one published function.",
    transform: (r: any) => ({
      ...r,
      // Append a second copy of every export whose name already appears, which is
      // the state the analyzer was in for one statement per fixture file.
      exports: [...(r.exports ?? []), ...duplicateFirstOfEach((r.exports ?? []).map((e: any) => e.name))],
      relationships: [...(r.relationships ?? []), ...duplicateFirstExportsRel(r.relationships)],
    }),
  },
  {
    id: "powershell/case-sensitive-suppression",
    language: "powershell",
    defectClass: "fabrication",
    description:
      "PS8(b) REVERT: the automatic-variable and scope-prefix suppressions compare CASE-SENSITIVELY, while PowerShell identifiers are case-insensitive. Measured on `ansible@7ec731b`: `exec_wrapper.ps1` published `null` as a variable FIVE times, and `$Script:AnsibleClrFacadeSet` was published as a variable named `Script:AnsibleClrFacadeSet` because the scope-prefix list was case-sensitive too. This is the class the ledger's standing fixture-authoring rule names — identifiers that collide with builtin words, because suppression filters are invisible to output-diff tests otherwise — and the lane had no fixtures, so nothing pinned it. Caught by suppression-and-params-psb7's `forbidSymbols` rows for `null`, `Null` and `Upper`. Needs the SOURCE: a case-sensitive comparison publishes names the post-fix result has correctly REMOVED, so reconstructing them from the result is impossible by construction and the `source` argument exists for exactly this case.",
    transform: (r: any, source?: string) => {
      if (!source) return r
      const AUTOMATIC = new Set([
        "this", "_", "psitem", "args", "input", "psscriptroot", "pscommandpath",
        "psmodulepath", "psversiontable", "host", "pid", "lastexitcode", "error",
        "home", "pwd", "myinvocation", "matches", "null", "true", "false", "ofs",
      ])
      // The scope modifiers a case-SENSITIVE prefix list would miss: the capital
      // spellings PowerShell accepts for the lower-case ones.
      const MISSED_PREFIX = /^\$(Script|Global|Env|Using|Local|Private):([A-Za-z_][A-Za-z0-9_]*)\s*=/gm
      const symbols: any[] = [...(r.symbols ?? [])]
      const relationships: any[] = [...(r.relationships ?? [])]
      const file = psFileName(r)
      for (const m of source.matchAll(MISSED_PREFIX)) {
        const spelling = m[1]
        const name = m[2]
        // A case-sensitive comparison against `$script:` would not recognise
        // `$Script:`, so the published name carries the modifier.
        const published = `${spelling}:${name}`
        symbols.push({
          name: published, kind: "variable", ownerName: file, scope: file,
          startLine: source.slice(0, m.index).split("\n").length, visibility: "public",
          metadata: { powershellSpecific: true, isVariable: true },
        })
        relationships.push({
          source: file, target: published, type: "contains",
          confidence: 1, line_number: source.slice(0, m.index).split("\n").length, metadata: {},
        })
      }
      // And the lower-case automatic spellings: `$null` is not `Null` to a
      // case-sensitive comparison.
      for (const m of source.matchAll(/^\s*\$([A-Za-z_][A-Za-z0-9_]*)\s*=/gm)) {
        const raw = m[1]
        if (!AUTOMATIC.has(raw.toLowerCase())) continue
        if (AUTOMATIC.has(raw)) continue
        const line = source.slice(0, m.index).split("\n").length
        symbols.push({
          name: raw, kind: "variable", ownerName: file, scope: file,
          startLine: line, visibility: "public",
          metadata: { powershellSpecific: true, isVariable: true },
        })
        relationships.push({
          source: file, target: raw, type: "contains",
          confidence: 1, line_number: line, metadata: {},
        })
      }
      return { ...r, symbols, relationships }
    },
  },
  {
    id: "powershell/keyword-names-are-declarations",
    language: "powershell",
    defectClass: "fabrication",
    description:
      "PS8(a) REVERT: `foreach` and `switch` are treated as automatic variables again, so `$switch = …` and `$foreach = …` are dropped as declarations. They are LANGUAGE KEYWORDS, and the pre-wave suppression set carried both. Reproduced as 6 of 9 top-level assignments in a probe file silently discarded. Caught by suppression-and-params-psb7's two `expectSymbols` rows — the pair that proves the suppression was narrowed rather than merely re-listed.",
    transform: (r: any) => ({
      ...r,
      symbols: (r.symbols ?? []).filter(
        (s: any) => s.kind !== "variable" || !["switch", "foreach"].includes(String(s.name).toLowerCase()),
      ),
      relationships: (r.relationships ?? []).filter(
        (x: any) => !(x.type === "contains" && ["switch", "foreach"].includes(String(x.target).toLowerCase())),
      ),
    }),
  },
  {
    id: "powershell/drop-inline-parameters",
    language: "powershell",
    defectClass: "payload-loss",
    description:
      "PS10 REVERT: only the `param()`-block and class-method parameter shapes are read, so `function G($x, $y) { … }` — the commonest PowerShell function form — publishes ZERO parameters. The pre-wave reader accepted two of the three shapes. The grammar's real structure is `function_statement > function_parameter_declaration > parameter_list > script_parameter`, so the WRAPPER is named `function_parameter_declaration` and the items are `script_parameter`; a first fix that assumed the items were the wrapper matched nothing, which this mutant's fixture caught. Caught by suppression-and-params-psb7's `Inline-Params` row and by the payload fixture's `expectParameters` rows.",
    transform: (r: any) => ({
      ...r,
      symbols: (r.symbols ?? []).map((s: any) =>
        // Keyed on the `parameterForm` the analyzer records, not on a guess from
        // the parameter TYPES: the first version cleared parameters only when
        // every one was untyped, and `Inline-Params($First, [string]$Second, …)`
        // has a typed one — so the transform never fired and the mutant
        // SURVIVED. The form is the fact; the types are a consequence of it.
        (s.metadata ?? {}).parameterForm === "inline" ? { ...s, parameters: [] } : s),
    }),
  },
  {
    id: "powershell/param-type-as-any",
    language: "powershell",
    defectClass: "payload-loss",
    description:
      "PS12 REVERT: a parameter's declared TYPE is not read from its type-constraint attribute, so `[string]$Name` publishes `any`. Because a PowerShell parameter's type is spelled as an ATTRIBUTE (`script_parameter > attribute_list > attribute > type_literal`), a direct-child read found nothing and EVERY typed parameter in the language read `any` — a placeholder that is indistinguishable from a declared `any`, which is the same blind spot the csharp R7 paydown closed family-wide. Caught by payload-psb11's `expectParameters` rows AND its `forbidParameters.types: [\"any\"]` row — the negative channel is what makes a reverted placeholder fail, since an expect-only matcher skips a key the want does not mention.",
    transform: (r: any) => ({
      ...r,
      symbols: (r.symbols ?? []).map((s: any) =>
        Array.isArray(s.parameters)
          ? { ...s, parameters: s.parameters.map((p: any) => ({ ...p, type: "any" })) }
          : s),
    }),
  },
  {
    id: "powershell/drop-hashtable-keys",
    language: "powershell",
    defectClass: "relationship-loss",
    description:
      "PS15 REVERT: a `hash_entry` key declares nothing, so `@{ Retries = 3 }` publishes neither a symbol nor a containment edge. The pre-wave lane named neither `hash_entry` nor `key_expression`, and a hashtable literal is the commonest PowerShell data structure: 711 keys in the production draw, all dark. Caught by data-shapes-psb10's four key symbols and four containment rows, and by member-reads-psb5's `Retries`/`Label` rows.",
    transform: (r: any) => ({
      ...r,
      symbols: (r.symbols ?? []).filter((s: any) => (s.metadata ?? {}).isHashtableKey !== true),
      relationships: (r.relationships ?? []).filter(
        (x: any) => !(
          x.type === "contains" &&
          (r.symbols ?? []).some((s: any) =>
            (s.metadata ?? {}).isHashtableKey === true && s.name === x.target && (s.ownerName ?? s.scope) === x.source)
        ),
      ),
    }),
  },
  {
    id: "powershell/accelerator-keeps-array-suffix",
    language: "powershell",
    defectClass: "fabrication",
    description:
      "PS12 REVERT: the type-accelerator test runs on the declared type WITH its `[]`/`[T]` suffixes, so `[string[]]$Tags` publishes `uses -> string[]` — a target no symbol can ever have. The pre-wave lane emitted no type reference at all, so this is the shape a partial fix produces rather than the pre-wave shape; it is pinned because the accelerator table is a list a future edit will extend, and an unextended entry is exactly where a regression lands. Caught by data-shapes-psb10's `forbidSymbols` rows for `string[]` and `int[]`.",
    transform: (r: any) => {
      // The fabricated edge has to be CREATED, not filtered: the accelerator test
      // SUPPRESSES it, so there is nothing in the result to remove — which is
      // why the first version (a filter) was a no-op and the mutant SURVIVED.
      //
      // The information needed is on the SYMBOL: a declaration whose
      // `metadata.type` carries a `[]`/`[T]` suffix over a type accelerator is
      // exactly the case the test has to catch, and the edge the pre-fix shape
      // published is a reference to that suffixed spelling.
      const ACCEL = new Set([
        "array", "bool", "byte", "char", "datetime", "decimal", "double", "float",
        "guid", "hashtable", "int", "int16", "int32", "int64", "long", "ordered",
        "psobject", "pscustomobject", "regex", "sbyte", "scriptblock", "single",
        "string", "switch", "timespan", "uint32", "uint64", "uint16", "xml", "void",
      ])
      const extra: any[] = []
      for (const s of r.symbols ?? []) {
        const declared = String((s.metadata ?? {}).type ?? "")
        if (!declared.includes("[")) continue
        const bare = declared.replace(/(\[\s*\])+/g, "").trim()
        if (!ACCEL.has(bare.toLowerCase())) continue
        const owner = s.ownerName ?? s.scope ?? psFileName(r)
        extra.push({
          source: owner, target: declared, type: "uses", confidence: 0.8,
          line_number: s.startLine ?? 0, metadata: { powershellSpecific: true, isTypeReference: true },
        })
      }
      return { ...r, relationships: [...(r.relationships ?? []), ...extra] }
    },
  },
  {
    id: "powershell/drop-class-type-references",
    language: "powershell",
    defectClass: "relationship-loss",
    description:
      "PS24 REVERT: a class-typed member publishes no type reference, so `[EventMessage] $Message` emits nothing. In PowerShell classes this is the ONLY edge between two classes in one file, and the pre-wave lane read such a type only into the symbol's `type` metadata — which `pool-worker.ts` drops at the worker boundary, so the reference was invisible on both sides of the seam. Caught by data-shapes-psb10's two `viaMemberType` rows.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).filter(
        (x: any) => !(x.type === "uses" && psHas(x, "isTypeReference", true) && x.source !== psFileName(r)),
      ),
    }),
  },
  {
    id: "powershell/drop-typed-declarations",
    language: "powershell",
    defectClass: "relationship-loss",
    description:
      "PS12 REVERT: a typed DECLARATION (`[int]$x`, `[string]$label`) publishes no symbol. The pre-wave lane read the type on the `expression_with_unary_operator`, where it is not — the measured shape puts `type_literal` and `variable` under `cast_expression` — so a typed declaration with no assignment published nothing at all. Caught by data-shapes-psb10's `attempts`, `label` and `counts` symbol rows. The transform keys on the `isTypedDeclaration` metadata the analyzer records, so it reverts the declaration without knowing the fixture's variable names.",
    transform: (r: any) => ({
      ...r,
      symbols: (r.symbols ?? []).filter((s: any) => (s.metadata ?? {}).isTypedDeclaration !== true),
      relationships: (r.relationships ?? []).filter(
        (x: any) => !(
          x.type === "contains" &&
          (r.symbols ?? []).some((s: any) =>
            (s.metadata ?? {}).isTypedDeclaration === true && s.name === x.target && (s.ownerName ?? s.scope) === x.source)
        ),
      ),
    }),
  },
  {
    id: "powershell/decorators-from-direct-children",
    language: "powershell",
    defectClass: "payload-loss",
    description:
      "PS11 REVERT: the attribute list is read only from the declaration's DIRECT children, so `[CmdletBinding()]` is missed. PowerShell puts it on the `param_block`, two levels below the `function_statement` (`function_statement > script_block > param_block > attribute_list`), and the pre-wave lane found nothing. Measured at the store: every PowerShell function stored with `annotations = NULL`. It took two attempts — the first fix also read only a direct `param_block` child — which is why the transform reverts to the DIRECT-children form specifically. Caught by payload-psb11's `expectDecorators` row for `[CmdletBinding()]`.",
    transform: (r: any) => ({
      ...r,
      symbols: (r.symbols ?? []).map((s: any) => {
        if (!Array.isArray(s.decorators)) return s
        // The pre-fix payload was `metadata.annotations`; the pool drops it, so
        // the revert is the field the store cannot see.
        return { ...s, decorators: [], metadata: { ...(s.metadata ?? {}), annotations: s.decorators } }
      }),
    }),
  },
  {
    id: "powershell/docstring-ignores-adjacency",
    language: "powershell",
    defectClass: "fabrication",
    description:
      "PS23 REVERT: the docstring walk skips blank lines while searching upward, so a FILE BANNER becomes the documentation of whichever declaration comes first. Measured on payload-psb11.ps1: the file's own twenty-nine-line header was published as `Get-Report`'s `docstring` while the function's `.SYNOPSIS` block — immediately above it — was missed entirely. A resolvable, plausible, wholly wrong row, and the reason the fixture pins the ABSENCE of a docstring on the declaration that follows a separated comment (`forbidDocstring`), which is the only channel that can say it. Caught by payload-psb11's `expectDocstring` rows (the `.SYNOPSIS` text) and its two `forbidDocstring` rows.",
    transform: (r: any) => {
      // The pre-fix walk had no adjacency rule, so EVERY declaration in the file
      // inherited the leading comment run — including the ones that were
      // correctly left with none. The first version of this transform assigned
      // the banner only to symbols that ALREADY had a docstring, which is a
      // no-op on a fixture with one documented function, and the mutant
      // SURVIVED. Assigning to all of them is the shape the bug produced.
      const banner = (r.symbols ?? []).map((s: any) => s.docstring).find(Boolean)
      if (!banner) return r
      return {
        ...r,
        symbols: (r.symbols ?? []).map((s: any) => (s.kind === "module" ? s : { ...s, docstring: banner })),
      }
    },
  },
  {
    id: "powershell/contains-on-reassignment",
    language: "powershell",
    defectClass: "fabrication",
    description:
      "PS2/PS15 REVERT: a repeated declaration earns a SECOND containment edge while the symbol dedupes to one, so a `contains` edge names a target the file does not declare. Measured twice, in two kinds: `$value = 1` then `$value = $(…)` published TWO `contains` edges for one variable, and `analyze-pr-test-failures.ps1` wrote `@{ Name = $failure.name }` after another `Name` was declared in the same scope — the surface instrument then reported exactly ONE containment edge whose target matched no symbol in its own file, which is what forced the symbol/edge pair to be bound together for every kind rather than re-derived at each site. Caught by reserved-words-psb4's `expectRelationshipCount` row for `contains -> value`.",
    transform: (r: any) => {
      // Re-emit one containment edge per DECLARATION SITE rather than per symbol:
      // the pre-fix shape is an edge per site, and the sites are the symbol's own
      // recorded line plus every line that carries a `uses` edge of the same
      // name. Derived from the result, so it needs no fixture name.
      const byName = new Map<string, { decl: number; uses: number[] }>()
      for (const s of r.symbols ?? []) {
        const k = `${s.ownerName ?? s.scope ?? ""}|${s.name}`
        if (!byName.has(k)) byName.set(k, { decl: s.startLine ?? 0, uses: [] })
      }
      for (const x of r.relationships ?? []) {
        if (x.type !== "uses") continue
        for (const s of r.symbols ?? []) {
          if (s.name !== x.target) continue
          const k = `${s.ownerName ?? s.scope ?? ""}|${s.name}`
          const e = byName.get(k)
          if (e && typeof x.line_number === "number") e.uses.push(x.line_number)
        }
      }
      const extra: any[] = []
      for (const [k, v] of byName) {
        const owner = k.split("|")[0]
        for (const line of v.uses) {
          if (line === v.decl) continue
          extra.push({ source: owner, target: k.split("|")[1], type: "contains", confidence: 1, line_number: line, metadata: {} })
        }
      }
      return { ...r, relationships: [...(r.relationships ?? []), ...extra] }
    },
  },
  {
    id: "powershell/invocation-operator-raw-target",
    language: "powershell",
    defectClass: "identity",
    description:
      "PS19 REVERT: an invocation-operator command's target is the RAW text, so `& $sb` publishes `calls -> $sb` — a name no symbol can have, because a variable is stored stripped. The pre-wave lane wrote `commandNameOf(node)` straight into the edge. Dot-sourcing a variable (`. $sb`) published nothing at all, and the variable that decides the command got no edge. Caught by the `invokationOperator` metadata being absent from every powershell fixture's relationship set once a variable-target invocation is present; the fixture side is `file-owner-psa1`'s forbid half plus the `uses`-not-`calls` rule this entry restores.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).flatMap((x: any) => {
        if (x.type !== "uses" || !psHas(x, "isInvokedVariable", true)) return [x]
        // The pre-wave shape: a CALL to the raw, dollar-prefixed text.
        return [{ ...x, type: "calls", target: `$${x.target}`, metadata: { powershellSpecific: true } }]
      }),
    }),
  },
  {
    id: "powershell/using-becomes-a-call",
    language: "powershell",
    defectClass: "relationship-loss",
    description:
      "PS21 REVERT: `using` is listed in `FLOW_KEYWORDS` again, which is where the pre-wave lane filtered it, so `using namespace System.IO` and `using module ./helpers.psm1` publish nothing at all — not an import, and not even the wrong call edge. The `using` directives are how a `.psm1` acquires types, so the module surface of every script that uses one was empty. Caught by module-surface-psb9's two `expectImports` rows (`System.IO`, `./helpers.psm1`).",
    transform: (r: any) => ({
      ...r,
      imports: (r.imports ?? []).filter((i: any) => i.metadata?.via !== "using namespace" && i.metadata?.via !== "using module"),
      relationships: (r.relationships ?? []).filter(
        (x: any) => !(x.type === "references" && psHas(x, "import", true) && x.metadata?.powershellSpecific === true && r.imports?.length > 0 && !r.imports?.some((i: any) => i.module === x.target)),
      ),
    }),
  },
  {
    id: "powershell/switch-clauses-not-complexity",
    language: "powershell",
    defectClass: "payload-loss",
    description:
      "PS13 REVERT: a `switch` CASE contributes nothing to cyclomatic complexity, so a ten-case switch measures 1. The pre-wave `isBranch` list named `switch_statement` but not `switch_clause`, and 174 `switch_clause` nodes in the production draw were uncounted — a decision-heavy construct reported as trivial. Caught by the complexity probe in `reserved-words-psb4`'s metadata; the fixture pins it through the file's `cyclomaticComplexity`, which the runner exposes.",
    transform: (r: any) => ({
      ...r,
      metadata: { ...(r.metadata ?? {}), cyclomaticComplexity: undefined },
    }),
  },
  {
    id: "powershell/using-namespace-raw-text",
    language: "powershell",
    defectClass: "identity",
    description:
      "PS21 REVERT, the second half: a `using` directive's target is the raw command text rather than its argument, so the import is named `using` or `namespace`. This is the pre-wave emission — the directives reached the `command` handler and were published as calls. Caught by module-surface-psb9's `forbidImports` rows for `namespace` and `module` and its `calls -> using` forbid row.",
    transform: (r: any) => ({
      ...r,
      imports: (r.imports ?? []).map((i: any) =>
        i.metadata?.via?.startsWith("using") ? { ...i, module: String(i.metadata.via).split(" ")[1] ?? "using" } : i),
    }),
  },
]
