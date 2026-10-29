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

/** Drop every relationship of one type. PS-A2: written generically so it reverts
 *  whatever the fixture declares rather than a hard-coded target. */
const psDropRelType = (type: string, only?: (rel: any) => boolean) => (r: any) => ({
  ...r,
  relationships: (r.relationships ?? []).filter((x: any) =>
    x.type !== type || (only ? !only(x) : false)),
})

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
      //
      // RE-AIMED 2026-10-27. The original keyed on `s.line ?? s.range?.start?.line`
      // and compared `x.target` to the BARE symbol name. Neither exists in the
      // published shape: a symbol carries `startLine`, and a `uses` target is the
      // store-qualified name (`reserved-words-psb4.ps1.value`), which is what the
      // variable-read retarget pass publishes. The transform therefore matched
      // nothing and reported SURVIVED at 0 -> 0 — a no-op, not a missing fixture.
      // The `contains` SOURCE is read off the symbol's own containment edge rather
      // than rebuilt from `ownerName`, so the re-emitted row has the same source a
      // per-site emission would have had.
      const byName = new Map<string, { key: string; decl: number; name: string; qualified: string; uses: number[] }>()
      for (const s of r.symbols ?? []) {
        // NATIVE SHAPE: this transform runs inside `runLang`'s analyzer path, where a
        // symbol carries `range.startLine`; only the STORE's normalized result has a
        // top-level `startLine`. Reading one field alone is why the re-aimed transform
        // still reported 0 -> 0 on its first run after the fixture was added.
        const line = s.range?.startLine ?? s.startLine
        if (typeof line !== "number") continue
        const k = `${s.ownerName ?? s.scope ?? ""}|${s.name}`
        if (!byName.has(k)) byName.set(k, {
          key: k, decl: line, name: s.name,
          qualified: typeof s.qualifiedName === "string"
            ? s.qualifiedName
            : `${s.ownerName ?? s.scope ?? ""}.${s.name}`,
          uses: [],
        })
      }
      const containsSource = new Map<string, string>()
      for (const x of r.relationships ?? []) {
        if (x.type !== "contains") continue
        if (typeof x.target === "string" && typeof x.source === "string") containsSource.set(x.target, x.source)
      }
      for (const x of r.relationships ?? []) {
        if (x.type !== "uses" || typeof x.target !== "string") continue
        for (const v of byName.values()) {
          if (x.target !== v.name && x.target !== v.qualified && !x.target.endsWith(`.${v.name}`)) continue
          if (typeof x.line_number === "number") v.uses.push(x.line_number)
          break
        }
      }
      const extra: any[] = []
      for (const v of byName.values()) {
        const owner = containsSource.get(v.name) ?? v.key.split("|")[0]
        if (!owner) continue
        for (const line of v.uses) {
          if (line === v.decl) continue
          extra.push({ source: owner, target: v.name, type: "contains", confidence: 1, line_number: line, metadata: {} })
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
  {
    id: "powershell/drop-class-implements",
    language: "powershell",
    defectClass: "identity",
    description:
      "PS-A2 REVERT: a class's interface list publishes no `implements` edge. This is the lane's widest hole and it was found by an AUDIT, not a report: asked whether all relationship types were carried out, `implements` turned out to be emitted by live code with ZERO fixture rows and ZERO mutants, so deleting the loop that produces it would have left every gate in the repository green. The class header cannot say which base is a class and which are interfaces — PowerShell resolves that at runtime — so the grammar's positional shape is the only information there is. Caught by class-inherit-psa2's `implements Circle -> IShape` row and by its `implements == 1` count, which is the half that survives a fix that keeps the row but also emits the base class as an interface.",
    transform: psDropRelType("implements"),
  },
  {
    id: "powershell/drop-class-extends",
    language: "powershell",
    defectClass: "identity",
    description:
      "PS-A2 REVERT: a class's base publishes no `extends` edge. `extends` had a fixture row (method-scope-psb3) but no mutant that could fail it, so the row was documentation rather than a gate. Caught by class-inherit-psa2's two `extends` rows and its `extends == 2` count.",
    transform: psDropRelType("extends"),
  },
  {
    id: "powershell/drop-class-overrides",
    language: "powershell",
    defectClass: "identity",
    description:
      "PS-A2 REVERT: a same-named subclass member publishes no `overrides` edge. The pre-wave lane emitted ZERO `overrides` edges in the language, so this is the revert verbatim. `overrides` had two fixture rows and no mutant; it also carries the `overridesMember` metadata that says WHICH member is overridden, and dropping the edges drops the evidence with them. Caught by class-inherit-psa2's three `overrides` rows (each pinning `overridesMember`) and its `overrides == 3` count, whose value is chosen so that a rule matching 'the base has a member of any name' emits 4 and fails — `Area` is in the base and overridden in `Circle` but deliberately absent from `Square`.",
    transform: psDropRelType("overrides"),
  },
  {
    id: "powershell/interface-keyword-as-call",
    language: "powershell",
    defectClass: "fabrication",
    description:
      "PS-A2 REVERT: the `interface` KEYWORD is published as a callable again. The grammar has no node for a PowerShell 5.0 interface, so `interface IShape { … }` parses as a plain `command` named `interface` and reaches the generic call edge — the PS5 keyword-fabrication class reached through a grammar gap rather than a missing guard, which is why `interface` was absent from LANGUAGE_KEYWORD_COMMANDS while its siblings `class` and `enum` were both present. The GRAMMAR-side fix was built and REJECTED (an `interface_statement` rule with an optional method body reshaped 491 of 550 clean corpus files), so the guard is analyzer-side. The transform keys on the presence of an `interface` SYMBOL, so it re-derives the pre-fix state from the result without hard-coding this fixture's names. Caught by class-inherit-psa2's two `calls -> interface` / `calls -> IShape` forbid rows and its `interface` forbidSymbol row.",
    transform: (r: any) => {
      const ifaces = (r.symbols ?? []).filter((s: any) => s.kind === "interface").map((s: any) => s.name)
      if (ifaces.length === 0) return r
      const file = psFileName(r)
      return {
        ...r,
        relationships: [
          ...(r.relationships ?? []),
          ...ifaces.map((n: any) => ({
            type: "calls", source: file, target: "interface", line_number: 0, confidence: 0.6,
            metadata: { powershellSpecific: true },
          })),
          ...ifaces.map((n: any) => ({
            type: "calls", source: file, target: n, line_number: 0, confidence: 0.6,
            metadata: { powershellSpecific: true },
          })),
        ],
      }
    },
  },
  {
    id: "powershell/interface-scope-leak",
    language: "powershell",
    defectClass: "misattribution",
    description:
      "PS-A2 REVERT, the regression: an interface's scope frame is pushed and never popped, so every class declared AFTER an interface in the same file is re-owned by the interface. This is the defect the FIX introduced, recorded as a mutant rather than quietly corrected, because it is the reason the fixture puts a class after an interface and pins three `contains IShape -> <class>` forbid rows: scoping without an exit is not a narrower fix, it is a different defect, and it was invisible until a file exercised the order. The first version of the fix leaked exactly this way and the measured damage was `contains IShape -> Shape`, `-> Circle` and `-> Square`. Caught by class-inherit-psa2's three forbid rows.",
    transform: (r: any) => {
      const ifaces = (r.symbols ?? []).filter((s: any) => s.kind === "interface")
      if (ifaces.length === 0) return r
      const file = psFileName(r)
      const leaked = (r.symbols ?? [])
        .filter((s: any) => s.kind === "class" && (s.ownerName ?? s.owner) === file)
        .map((s: any) => s.name)
      return {
        ...r,
        symbols: (r.symbols ?? []).map((s: any) =>
          s.kind === "class" && (s.ownerName ?? s.owner) === file
            ? { ...s, ownerName: ifaces[0].name, owner: ifaces[0].name }
            : s),
        relationships: [
          ...(r.relationships ?? []).filter((x: any) => x.type !== "contains" || x.source !== file || !leaked.includes(x.target)),
          ...leaked.map((n: any) => ({
            type: "contains", source: ifaces[0].name, target: n, line_number: 0, confidence: 1.0,
            metadata: {},
          })),
        ],
      }
    },
  },
  {
    id: "powershell/new-object-com-and-positional",
    language: "powershell",
    defectClass: "identity",
    description:
      "PS-A3 REVERT: `New-Object` reads only `-TypeName`, so `-ComObject <ProgID>` and the POSITIONAL form `New-Object System.Collections.ArrayList` publish no edge at all. Found by hand-auditing the F5 differential's MISSING samples — `instantiates Extract-ZipLegacy -> Shell.Application` appears on ansible's own Windows modules — then confirmed in isolation. The pre-fix state produced no edge rather than a wrong one, which is why ERROR-keyed gates never saw it and why a fixture was needed. Caught by new-object-psa3's two missing rows and, independently, by its `instantiates == 3` count: a fix that read `-ComObject` but not the positional form scores 2.",
    transform: psDropRelType("instantiates", (x: any) => x.metadata?.viaNewObject === true),
  },
  {
    id: "powershell/com-object-keyed-on-a-dot",
    language: "powershell",
    defectClass: "misattribution",
    description:
      "PS-A3 REVERT, the mistake this work made: `isComObject` is derived from the CONSTRUCTED NAME containing a dot rather than from the FLAG that was used. A dotted .NET type name and a COM ProgID look alike and mean different things, so `-TypeName System.Text.StringBuilder` — a managed type — is published as a COM object. This is recorded as a mutant rather than quietly corrected because it is the more interesting half of the finding: the fix that closed a real gap introduced a different one, and the two metadata rows in new-object-psa3 are the only thing that distinguishes them. Caught by that fixture's `Shell.Application` row expecting `isComObject: true` AND its `System.Text.StringBuilder` row expecting the flag to be ABSENT.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) =>
        x.type === "instantiates" && x.metadata?.viaNewObject
          ? { ...x, metadata: { ...(x.metadata ?? {}), ...(String(x.target).includes(".") ? { isComObject: true } : { isComObject: undefined }) } }
          : x),
    }),
  },
  {
    id: "powershell/variable-argument-not-read",
    language: "powershell",
    defectClass: "identity",
    description:
      "PS-A4 REVERT: a variable passed as a command ARGUMENT is not read. The largest of the five defects the F9 completeness audit found, and the most consequential: `Write-Host $a` published the call edge and no `uses` at all, so every variable handed to a cmdlet was invisible in the graph while the same variable interpolated in a string was read. Measured rather than estimated — reading command arguments took the corpora from 114,096 to 129,259 relationships across 760 files, and a line-level check over all 25,023 variable-reference edges then read 100.00% justified.\n\nScoped to the `isArgumentReference` marker rather than deleting every variable read, because an argument read and an interpolation read are the same row shape (`uses` + `isVariableReference`); without the marker a mutant for this defect would silently revert three others. That is the same standard the PS9 entry in this file already states — a mutant that cannot be attributed faithfully is not written. Caught by variable-reads-psa4's argument rows and its `uses == 9` count.",
    transform: psDropRelType("uses", (x: any) => x.metadata?.isArgumentReference === true),
  },
  {
    id: "powershell/braced-variable-keeps-braces",
    language: "powershell",
    defectClass: "identity",
    description:
      "PS-A4 REVERT: a BRACED variable keeps its braces, so `${a}` and `$a` become two different symbols. Measured on a probe: `$a = 1` declared `a`, and a string containing `${a}` published `uses -> {a}` — a read naming a symbol nothing declares, so the reference was lost rather than merely misspelled. The braced spelling is how PowerShell writes a variable whose name would otherwise run into adjacent text, so it is not rare. Caught by variable-reads-psa4's `braced` rows and its `{braced}` forbidSymbol, which pins the DECLARATION side too because the name reaches the graph two ways.",
    // Keyed on `isBracedVariable`, and the transform is the READ half only — stated
    // plainly because the first draft of this entry was the opposite mistake: it
    // re-braced any name that ALREADY had braces, which after the fix matches
    // nothing, and the mutant SURVIVED at 0 failures. That is the whole reason a
    // mutant is run rather than written and assumed. The DECLARATION half of the
    // defect is pinned by the fixture's `forbidSymbols` row for `{braced}`, which a
    // read-only transform cannot reach; naming that here rather than implying a
    // coverage the entry does not have.
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) =>
        x.metadata?.isBracedVariable ? { ...x, target: `{${x.target}}` } : x),
    }),
  },
  {
    id: "powershell/here-string-interpolation-unread",
    language: "powershell",
    defectClass: "identity",
    description:
      "PS-A4 REVERT: an EXPANDABLE HERE-STRING is not interpolated. A here-string published no read at all while the identical text in a double-quoted string did, because `expandable_here_string_literal` is a different node type from `expandable_string_literal` and only the latter was in the switch. The second half of the defect was a LINE off-by-one with the line break and the sigil inside the target: the grammar gives the interpolation a span starting at the end of the previous line (`variable [6,8]-[7,8]` for a `$message` written on line 7), so the edge was published one line high. Caught by variable-reads-psa4's two here-string rows, whose line numbers ARE the assertion.",
    transform: psDropRelType("uses", (x: any) => x.metadata?.isHereStringInterpolation === true),
  },
  {
    id: "powershell/splat-keeps-at-sign",
    language: "powershell",
    defectClass: "identity",
    description:
      "PS-A4 REVERT: a SPLAT keeps its `@`, so `@name` and `$name` become two different symbols. The grammar models `@name` as a `variable` node whose text carries NO sigil, so the dollar-strip did nothing to it and `New-PSOptions @OptionsArguments` published `uses -> @OptionsArguments`. Found by the line-level check, where the splat rows were the one real defect hiding among its false negatives. Caught by variable-reads-psa4's splat row and its `@splatArgs` forbidSymbol.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) =>
        x.type === "uses" && x.metadata?.isVariableReference ? { ...x, target: `@${x.target}` } : x),
    }),
  },
  {
    id: "powershell/dynamic-method-target-as-call",
    language: "powershell",
    defectClass: "misattribution",
    description:
      "PS-A4 REVERT: a DYNAMIC method target is published as a call to a sigil-bearing name. `$type::$method()` wrote `calls -> $method`, which is wrong twice: a variable is stored stripped, so `$method` is a name no symbol can have, and the source says the method is CHOSEN AT RUNTIME, so calling a method named `$method` asserts a fact the code does not contain. The correct edge is a `uses` of the variable holding the name. Found on ConstrainedLanguageRestriction.Tests.ps1:513 — the last row of the line-level check's residue, at which point it read 100.00%. Caught by variable-reads-psa4's `isDynamicMethodTarget` row and its `calls -> $method` forbid row.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) =>
        x.type === "uses" && x.metadata?.isDynamicMethodTarget
          ? { ...x, type: "calls", target: `$${x.target}`, metadata: { ...(x.metadata ?? {}), isDynamicMethodTarget: undefined, isVariableReference: undefined } }
          : x),
    }),
  },
  {
    id: "powershell/counter-update-operand-unread",
    language: "powershell",
    defectClass: "identity",
    description:
      "PS-A4 REVERT: an INCREMENT or DECREMENT publishes no read of its operand. All four types were in the F9 audit's \"the analyzer never names it\" set, and probing them confirmed every one emitted nothing, so `$count++` left the graph with a declaration and no read. Keyed on `isCounterUpdate` so the revert is attributable to this defect alone; the increment and the compound-assignment reads are separate rows with separate markers and separate mutants. Caught by variable-reads-psa4's four counter rows.",
    transform: psDropRelType("uses", (x: any) => x.metadata?.isCounterUpdate === true),
  },
  {
    id: "powershell/compound-assignment-read-dropped",
    language: "powershell",
    defectClass: "identity",
    description:
      "PS-A4 REVERT: a COMPOUND assignment publishes no read of its left side. `$total += 1` is a read of `$total` and a write to it; the write is the declaration, and the read was nowhere, so a variable the graph could see being created had a use it could not. The operator is the whole distinction — a plain `=` gains no read edge, which is what the count row pins. Caught by variable-reads-psa4's two compound rows and their `assignmentOperator` metadata.",
    transform: psDropRelType("uses", (x: any) => x.metadata?.isCompoundAssignmentRead === true),
  },
  {
    id: "powershell/prefix-counter-missed",
    language: "powershell",
    defectClass: "identity",
    description:
      "PS-A4 REVERT, the half-defect: a PREFIX counter update is missed because the operand is found by a direct-child lookup. `$count++` puts its variable directly under the increment node, but `++$count` nests it as `pre_increment_expression > unary_expression > variable`, so a direct lookup finds the postfix pair and silently misses the prefix pair. That is the same shape of miss as `sub_expression` (PS16) and `left_assignment_expression` (PS2), and it is invisible in a count — two of four sites missing reads as an error count looks like a partial success. Caught by variable-reads-psa4's two `isPostfix: false` rows, which fail on their own if the prefix forms are the ones dropped.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) =>
        x.metadata?.isCounterUpdate && x.metadata?.isPostfix === true ? { ...x, metadata: { ...x.metadata, isPostfix: false } } : x),
    }),  },
  {
    id: "powershell/scoped-read-suppressed-again",
    language: "powershell",
    defectClass: "identity",
    description:
      "PS-A4 REVERT, the RULING half: a scope-qualified READ is suppressed again, because the read path reuses PS8's DECLARATION guard. Measured on the F5 non-test sample: 7 rows from Sign-Package.ps1 expecting `uses -> env:Temp` and `uses -> {env:ProgramFiles(x86)}`, with the analyzer publishing nothing for either.\n\nThis reverses part of an existing ruling, which is why it is pinned as a decision and not as a defect fix. PS8's own text is about declarations — \"a scope-qualified name (`$global:x`) is never a local declaration\" — and that still stands: `$env:FOO = 'x'` declares no symbol, which the fixture pins as a forbidSymbol. What changed is only that a READ is a dependency on something outside the file, of the same kind as a `calls -> Write-Host` target, which is equally unresolvable. The scope prefix is KEPT on the target so it can never collide with a project variable.\n\nNeeds owner confirmation: it is a change to a standing lane ruling, taken on the evidence of an independent oracle plus the reasoning, and recorded as a decision for that reason.",
    transform: psDropRelType("uses", (x: any) => x.metadata?.isScopedEnvironmentRead === true),
  },
  {
    id: "powershell/evidence-tier-downgraded",
    language: "powershell",
    defectClass: "misattribution",
    description:
      "PS-A4 REVERT: every relationship's EVIDENCE TIER is dropped, and `overrides` is relabelled `structural`. The tier is how the edge was derived, which is analyzer knowledge, and the one relationship in this lane that is genuinely INFERRED is `overrides` — PowerShell has no `override` keyword, so it is a name match between a subclass member and the base's declared member set. Calling it `structural` overstates the evidence, which is the whole reason a tier exists.\n\nEmitted centrally in `addRel` rather than per call site, so no call site can forget it, with the caller's metadata spread LAST so a call site may still override. The SPEC gate's section D requires two DISTINCT tiers pinned, so collapsing them all to one is caught there as well as here.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) =>
        ({ ...x, metadata: { ...(x.metadata ?? {}), evidenceClass: x.metadata?.overridesMember ? "structural" : "usage_contextual" } })),
    }),  },
  // ---------------------------------------------------------------- PS23 wave
  // The `imports` relationship type. Before this wave the lane emitted it ZERO times
  // across a 1,092-file corpus while `imports[]` held every module name, so a mutant
  // that drops the type reproduces the PRE-FIX state exactly — which is the only
  // kind of revert worth writing for a type that was absent rather than wrong.
  {
    id: "powershell/imports-edge-not-emitted",
    language: "powershell",
    defectClass: "missing-whole-kind",
    description:
      "PS23 REVERT: no `imports` edge is published, and the module dependency is carried by `references` alone. This is the pre-fix shape verbatim — `addImport` filled `imports[]` for all four PowerShell import forms (`Import-Module`, `using module`, `using namespace`, `#requires -Module`) and published one `references` row, so the ontology's `imports` type was EMITTED 0 TIMES across the whole corpus. `script/m60/powershell-surface-measure.ts:223` derives its `absent` list as `ONTOLOGY.filter(k => !kinds[k])` and `:243` prints it as the types 'all implemented + gated'; a type with zero edges corpus-wide is in that list for every draw, so the parenthetical asserted `imports` was implemented while `grep -c 'RelationshipType.Imports' src/ast/real-powershell-analyzer.ts` returned 0. Keyed on the TYPE rather than on a module name or a fixture, so it reverts the whole kind wherever it is emitted. Caught by imports-psb12's eleven `imports` rows and its `imports == 6` count; the count matters because a `forbid` alone would not notice a type that vanished, and the eleven rows matter because a count alone would not name the target.",
    transform: psDropRelType("imports"),
  },
  {
    id: "powershell/imports-tier-short-circuit-removed",
    language: "powershell",
    defectClass: "misattribution",
    description:
      "PS23 REVERT, the half that is easy to ship by accident: the `imports` edge keeps its type and every row count stays right, but its evidence TIER becomes `usage_contextual`. The edge now claims it was derived from a node's POSITION, which is the opposite of where an import comes from. `usage_contextual` is defined in this lane as 'settled by what the construct means', a true statement about `New-Object -ComObject Shell.Application` and a false one about `#requires -Module Pester`. Honesty contract §4 makes the tier a countable fact rather than a label, so a wrong tier on a whole type is a defect even when the edge itself is real.\n\nIT IS AIMED AT `evidenceClassFor`'s `if (isImport) return \"import_based\"` LINE, and the journey to that target is the record. The first two attempts aimed at a `case ASTEngine.RelationshipType.Imports:` added to the switch beside the `References` case, and BOTH SURVIVED — once while the two shared a fallthrough return, and once after they were split into separate cases with separate returns. Both mutants changed a line no edge's tier depended on, because `isImport` is true for every `imports` edge `addImport` emits and the function returns before the switch is reached. Reading a survivor as 'the fixtures do not check the tier' would have been wrong twice: the fixtures checked it and the tier had a different home. The `Imports` case was then DELETED as an L2 dead branch and the tier is decided, and tested, at the one line that actually decides it. Caught by imports-psb12's `meta.evidenceClass: \"import_based\"` constraint on all six `imports` rows.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) =>
        x.type === "imports"
          ? { ...x, metadata: { ...(x.metadata ?? {}), evidenceClass: "usage_contextual" } }
          : x),
    }),
  },
  {
    id: "powershell/imports-references-edge-dropped",
    language: "powershell",
    defectClass: "missing-whole-kind",
    description:
      "PS23 REVERT, the other direction, and the reason this wave did not REPLACE the `references` edge: the module dependency is published as `imports` only. That is the shape a lane reaches by 'fixing' the missing type with a rename, and it is a regression rather than a repair — bash emits both channels for `source ./x.sh` (`imports` for module resolution, `references` for a general dependency edge) and the store's M60/#910 file-level seam keys on the `references` row's `metadata.fileLevel`. Removing the `references` edge would leave the module dependency present in the graph and invisible to every consumer that reads the channel the lane already published. Caught by imports-psb12's `references` row on `Pester` with `meta.import: true`, and by its `references == 7` count.",
    transform: psDropRelType("references", (x: any) => x.metadata?.import === true),
  },
  // ---------------------------------------------------------------- PS24 wave
  // The `#requires` MODULE LIST reader, which answered neither list-shaped declaration.
  //
  // These two are keyed on `metadata.via`, a field this wave ADDED to the import
  // edges, and the addition is the reason they can be written at all. Before it, an
  // `imports` row said `file -> Module` and nothing about which of the four
  // declarations produced it; a `#requires` HASHTABLE row and a bare
  // `#requires -Module X` row were identical in every field the result carries, so a
  // faithful revert of one could not be told from a mutation of the other without a
  // module-name filter — which this file's own header forbids, because a name filter
  // silently stops matching the moment a fixture is renamed.
  {
    id: "powershell/requires-modules-first-token-only",
    language: "powershell",
    defectClass: "missing-whole-kind",
    description:
      "PS24 REVERT, the COMMA LIST: at most one module name per `#requires` declaration. That is the pre-PS24 reader verbatim — `extractRequiresValue` scanned forward from the flag and stopped at the first space, tab or comma, so `#requires -Modules CimCmdlets, PSReadLine` published `CimCmdlets` and dropped `PSReadLine`, which the file genuinely declares and which therefore did not appear in `imports[]` or in the graph at all. Measured over the 1,092-file admitted corpus: ONE occurrence of a comma-separated `#requires` module list — `#Requires -Modules PSScriptAnalyzer, PSSA-PSCustomUseLiteralPath` at `ansible/test/lib/ansible_test/_util/controller/sanity/pslint/pslint.ps1:2` — so `PSSA-PSCustomUseLiteralPath` was a declared dependency the lane read and dropped. The fixture's line 61 is a second copy of that shape. Caught by imports-psb12's `imports`/`references` row on `PSReadLine` at line 61 and by its `imports == 9` count — the count is what makes it unmissable, because the `via` of `CimCmdlets` and `PSReadLine` is identical (`requires_list`) and only the count distinguishes one from two.\n\nTHE POINT OF THE COUNT ROW. A reader keyed on (source, line) sees ONE dependency at line 61 and cannot tell that the file declares two, because both edges carry the declaration's line and the TARGET is the only thing that separates them. An `expectRelationships` row alone would be satisfied by any implementation that emitted `CimCmdlets` and dropped the rest, so the assertion that carries this class is the count.",
    transform: (r: any) => {
      const seenLine = new Set<string>()
      const keep = (x: any): boolean => {
        if (x.type !== "imports" && x.type !== "references") return true
        if (x.metadata?.via !== "requires_list" && x.metadata?.via !== "requires_hashtable") return true
        const key = `${x.type}|${x.source}|${x.line_number ?? "?"}`
        if (seenLine.has(key)) return false
        seenLine.add(key)
        return true
      }
      return {
        ...r,
        relationships: (r.relationships ?? []).filter(keep),
        imports: (r.imports ?? []).filter((i: any) => {
          const key = `imp|${i.metadata?.via}|${i.range?.start?.line ?? i.line ?? "?"}`
          if (seenLine.has(key)) return false
          seenLine.add(key)
          return true
        }),
      }
    },
  },
  {
    id: "powershell/requires-hashtable-name-read-as-flag-value",
    language: "powershell",
    defectClass: "fabrication",
    description:
      "PS24 REVERT, the HASHTABLE, and the one that wrote a garbage name rather than losing one: a `#requires -Modules @{ ModuleName = 'X'; ModuleVersion = '1.0' }` names its module inside the hashtable, and the pre-PS24 reader had no hashtable reader at all — it took the token after the flag, which is the `@{` that opens the hashtable. So the published row was `file -> \"@{\"` and `imports[]` stored `path: \"@{\"`. Measured on the corpus: 2 of 1,092 admitted files carry the form (both under `ansible/test/integration/targets/win_app_control/files/`, both `@{ ModuleName = 'OpenAuthenticode'; … }`) and they were the ENTIRE gap between `imports[] 552` and `imports 550` edges, because `filterNoiseRelationships` in `src/ast/pool-worker.ts` drops any relationship target whose leaf contains `{`.\n\nWHY IT IS STILL A FABRICATION DESPITE THE DOWNSTREAM DROP. The filter removed the EDGE; it did not remove the ImportInfo row, so the store received a dependency on a module named `@{`, and an edge that only a later stage declines to publish is an edge this lane asserted. The two corpus files name a real dependency (`OpenAuthenticode`) that the analyzer was reading and discarding. Caught by imports-psb12's `imports` row on `OpenAuthenticode` with `meta.via: \"requires_hashtable\"`, and by its `forbidImports` row for `@{` — which is the half that fires if the name is ever wrong in the other direction.",
    transform: (r: any) => {
      const garble = (name: string): string => "@{"
      const rels = (r.relationships ?? []).map((x: any) =>
        (x.type === "imports" || x.type === "references") && x.metadata?.via === "requires_hashtable"
          ? { ...x, target: garble(x.target) }
          : x)
      const imps = (r.imports ?? []).map((i: any) =>
        i.metadata?.via === "requires_hashtable" ? { ...i, module: garble(i.module) } : i)
      return { ...r, relationships: rels, imports: imps }
    },
  },

  // ---------------------------------------------------------------- PS29 / PS30
  //
  // These four are a different shape from the 47 above, and the difference is worth
  // stating rather than leaving to be inferred. Every earlier powershell mutant reverts
  // a MISSING edge or a WRONG TARGET. These revert a LABEL: the edge exists either way,
  // it names the same symbol either way, and only the relationship TYPE and one metadata
  // key differ. A mutant of that shape cannot be caught by a count and cannot be caught
  // by a resolution rate, because the resolution rate of `instantiates -> typeName` and
  // `uses -> typeName` against the same file's symbol table is identical — `typeName` is
  // declared in both cases. They are caught by `forbidRelationships` rows only, which is
  // the one vocabulary in the fixture schema that can say "this label must NOT be here".
  //
  // They are also the only reason the twin rows in psb14 and psb15 exist. Each of the
  // four has a counterpart that fails in the OPPOSITE direction, and a fix that simply
  // hardcoded the label would pass one and fail the other.

  {
    id: "powershell/new-object-variable-published-as-instantiates",
    language: "powershell",
    defectClass: "mislabel",
    description:
      "PS29 REVERT. `New-Object`'s constructed name is read as text by all three readers, so `New-Object $type` published `instantiates -> type`: an edge asserting the target IS a type, where the source says \"constructs whatever that variable holds\", resolved at run time. Measured over all 1,108 admitted files through production `parseFile`, cross-referenced against the symbol table OF THE FILE THAT PUBLISHED IT: 123 of 1,268 `instantiates` edges — 9.70% — named a `variable` symbol their own file declares.\n\nThis is the class the lane already fixed for `calls`: F9 turned `$type::$method()` from `calls -> $method` into `uses -> method` because a `$`-prefixed member is a VARIABLE, not a name. `instantiates` is the channel that did not get the same treatment.\n\nWHY A COUNT ROW CANNOT CATCH IT. `instantiates == 8` would have held pre-fix and holds post-fix on a file with four of each, because the edge did not move — only its label did. Caught by new-object-variable-psb14's `forbidRelationships` row for `instantiates -> typeName`, which is the only vocabulary that can assert a label is ABSENT.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) =>
        x.type === "uses" && x.metadata?.isDynamicTypeName === true
          ? { ...x, type: "instantiates", metadata: { ...x.metadata, isDynamicTypeName: undefined } }
          : x),
    }),
  },
  {
    id: "powershell/new-object-literal-downgraded-to-uses",
    language: "powershell",
    defectClass: "mislabel",
    description:
      "PS29 REVERT, the OTHER DIRECTION, and the one that keeps the fix from being a blanket reclassification. A literal type name read by `New-Object` — `New-Object System.Version`, `-TypeName System.Text.StringBuilder`, `-TypeName 'System.Collections.ArrayList'` — is a CONSTRUCTION, not a name read, so downgrading every `instantiates` row to `uses` would be a different mislabel of the same size and would satisfy every positive row in new-object-variable-psb14.\n\nIt is also the mutant that a text-based implementation would survive: `New-Object $type` and `New-Object System.Version` differ only in the string once it has been `stripQuotes`-ed, so a `$`-in-text test routes the first correctly and cannot tell the second from a fourth literal. Caught by the `uses -> System.Version` and `uses -> System.Collections.ArrayList` forbid rows.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) =>
        x.type === "instantiates" && x.metadata?.viaNewObject === true
          ? { ...x, type: "uses" }
          : x),
    }),
  },
  {
    id: "powershell/export-flag-via-reverts-to-command-name",
    language: "powershell",
    defectClass: "mislabel",
    description:
      "PS30 REVERT. `Export-ModuleMember` publishes a name under one of four flags — `-Function`, `-Variable`, `-Alias`, `-Cmdlet` — and the reader COMPUTED the flag (`if (!isFlag(flag)) continue` is a test on the very string it then discarded) but passed `leaf`, the COMMAND NAME, as `via`. So `via` was the literal `Export-ModuleMember` on every row: measured over all 1,108 admitted files, 106 of 106 `exports` rows carried `via: \"Export-ModuleMember\"` and 0 named the flag.\n\nThe four flags are not the same kind of thing, which is what makes the loss a loss: a `-Cmdlet` target is a name the file cannot declare at all, so a consumer cannot tell whether it should go looking for it. This is the argument PS23 made for `imports`, on the sibling channel.\n\nNOT catchable by a count: the edge count is identical either way. Caught by export-flag-psb15's `forbidRelationships` row for `meta.via: \"Export-ModuleMember\"`, on both the edge and the `exports[]` record.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) =>
        x.type === "exports" && x.metadata?.via !== undefined
          ? { ...x, metadata: { ...x.metadata, via: "Export-ModuleMember" } }
          : x),
      exports: (r.exports ?? []).map((e: any) =>
        e?.metadata?.via !== undefined
          ? { ...e, metadata: { ...e.metadata, via: "Export-ModuleMember" } }
          : e),
    }),
  },
  {
    id: "powershell/export-flag-hardcoded-to-function",
    language: "powershell",
    defectClass: "mislabel",
    description:
      "PS30 REVERT, the OTHER DIRECTION. A change that hardcoded `via: \"-function\"` would satisfy every positive row in export-flag-psb15 — both of which are `-Function` or `-Variable`, and the `-Variable` row is the one positive row a hardcode fails. This mutant exists so the fix is pinned as READING the flag rather than writing a constant: it rewrites every `exports` row's `via` to `-function` regardless of the declaration, which is exactly what an implementation that never threaded the flag through would produce.\n\nCaught by export-flag-psb15's `forbidRelationships` row for `exports -> cacheRoot` with `meta.via: \"-function\"`, and by the `expectExports` row for the same target with `meta.via: \"-variable\"`.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) =>
        x.type === "exports" && x.metadata?.via !== undefined
          ? { ...x, metadata: { ...x.metadata, via: "-function" } }
          : x),
      exports: (r.exports ?? []).map((e: any) =>
        e?.metadata?.via !== undefined
          ? { ...e, metadata: { ...e.metadata, via: "-function" } }
          : e),
    }),
  },

  // ---------------------------------------------------------------- PS-B16, cause C
  //
  // Every revert below re-derives its trigger from the RESULT's own fields, never from a
  // fixture name, because a name filter stops matching the moment a fixture is renamed and
  // a mutant that measures one fixture instead of a behaviour is a fixture with extra steps.
  // The byte predicates duplicate `externalReadingOf` in the analyzer on purpose: a mutant
  // that imported the analyzer's own helper could not survive the helper being deleted, and
  // the point of these four is to fail when that helper's LOGIC changes.
  {
    id: "powershell/externality-guard-removed",
    language: "powershell",
    defectClass: "mislabel",
    description:
      "PS-B16 REVERT: the declaration guard is deleted, so a mark is published on SHAPE alone — every Verb-Noun or qualified-looking target, whether or not the emitting file declares it. That is the pre-fix shape rule and it is the mislabel the guard exists to prevent: measured over 1,181 of 1,181 admitted files, the unguarded Verb-Noun reading marks 32,368 live edges of which **7,040 (21.75%) point at a name the EMITTING FILE declares**. `Get-Thing` in externality-psb16 is one of them, declared at line 19 and called at line 26 with a spelling byte-identical to the `Get-ChildItem` on line 13.\n\nCaught by externality-psb16's positive row for `calls -> Get-Thing` at line 26 (`meta.externalTarget: null`) and its forbid row for the same edge with `meta.externalTarget: true`.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) => {
        const t = String(x.target ?? "")
        if (t.length === 0) return x
        if (!psByteIsCmdlet(t) && !psHasQualifierByte(t)) return x
        const { externalTarget, externalVia, noDeclarationInFile, ...meta } = x.metadata ?? {}
        void externalTarget; void externalVia; void noDeclarationInFile
        return { ...x, metadata: { ...meta, externalTarget: true, externalVia: psByteIsCmdlet(t) ? "cmdlet" : "qualified" } }
      }),
    }),
  },
  {
    id: "powershell/externality-partition-removed",
    language: "powershell",
    defectClass: "noise",
    description:
      "PS-B16 REVERT, the PAYLOAD shape: both keys are published on every row instead of partitioning them. The fact is identical on both rows — `externalTarget` fires only where the guard passed, so it already implies 'no declaration in this file' — and the duplication is not free: over the same 1,181-file walk the payload counterfactual in `ambiguity-split.mts` prices the partition at **3,216,966 B (+9.23%)** and publishing both on every row at **3,888,591 B (+11.15%)**, so 671,625 B of the lane's relationship payload is the same fact written twice.\n\nCaught by externality-psb16's forbid row for `calls -> Get-ChildItem` with `meta.noDeclarationInFile: true`, and by the positive rows asserting `meta.noDeclarationInFile: null` on the same edges.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) => {
        const meta = x.metadata ?? {}
        if (meta.externalTarget === true && meta.noDeclarationInFile === undefined) {
          return { ...x, metadata: { ...meta, noDeclarationInFile: true } }
        }
        return x
      }),
    }),
  },
  {
    id: "powershell/externality-quote-exclusion-removed",
    language: "powershell",
    defectClass: "mislabel",
    description:
      "PS-B16 REVERT: the leading-QUOTE exclusion is deleted, so any target carrying a `.` `\\` `/` or `:` is read as qualified — including the string literals this analyzer publishes as property and variable names. It publishes hashtable keys and command arguments verbatim, so `'Content-Type'` (43 corpus edges), `\"Authorization\"` (18), `'User-Agent'` (14) and `\"it:skip\"` (7) all arrive as names, and a quoted literal is not an identifier. externality-psb16 declares `'Content-Type'` as a property at line 61 precisely so this reading has something to be wrong about.\n\nCaught by externality-psb16's forbid row for `uses -> 'Content-Type'` with `meta.externalTarget: true`.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) => {
        const t = String(x.target ?? "")
        if (t.length === 0) return x
        if (t.charCodeAt(0) !== 34 && t.charCodeAt(0) !== 39) return x
        if (!psHasQualifierByte(t)) return x
        return { ...x, metadata: { ...(x.metadata ?? {}), externalTarget: true, externalVia: "qualified" } }
      }),
    }),
  },
  {
    id: "powershell/externality-scope-exclusion-removed",
    language: "powershell",
    defectClass: "mislabel",
    description:
      "PS-B16 REVERT: the SCOPE-PREFIX exclusion is deleted, so `global:Helper`, `script:Foo`, `local:Foo`, `private:Foo` and `function:prompt` are marked external. All five name scopes a declaration IN THE EMITTING FILE can bind — `function global:Helper {…}` is ordinary PowerShell, which externality-psb16 writes at line 41 and calls at line 49, so the mark would be falsified by the very file that carries it. 881 corpus edges carry such a prefix. `env:`/`variable:`/`using:` are deliberately NOT in the exclusion set and this mutant leaves them marked: those are runtime tables and the caller's scope.\n\nCaught by externality-psb16's forbid row for `calls -> global:Helper` with `meta.externalTarget: true`, and by the positive row for the same edge asserting `meta.externalTarget: null`.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) => {
        const t = String(x.target ?? "")
        if (t.length === 0 || !psHasScopePrefix(t, ["global", "script", "local", "private", "function"])) return x
        return { ...x, metadata: { ...(x.metadata ?? {}), externalTarget: true, externalVia: "qualified" } }
      }),
    }),
  },
  {
    id: "powershell/externality-no-declaration-dropped",
    language: "powershell",
    defectClass: "undercount",
    description:
      "PS-B16 REVERT, the bare-fact arm: every `noDeclarationInFile` key is deleted from every edge. The field is the lane's answer to cause A as well as cause C — of the 70,139 corpus edges that resolve against no published symbol, **41,686 (59.43%)** carry it, and it is the only statement the analyzer can make about a name a file does not declare. Dropping it leaves the edge looking exactly as it did before this change, which is the point of the mutant: an additive key that vanishes is indistinguishable from one that never shipped.\n\nCaught by externality-psb16's positive rows, every one of which asserts a `meta.*` value that this transform removes.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) => {
        const meta = x.metadata ?? {}
        if (!("noDeclarationInFile" in meta)) return x
        const { noDeclarationInFile, ...rest } = meta
        void noDeclarationInFile
        return { ...x, metadata: rest }
      }),
    }),
  },
  {
    id: "powershell/drop-assignment-reads",
    language: "powershell",
    defectClass: "relationship-loss",
    description:
      "PS36 REVERT: every `uses` edge carrying `isAssignmentRead` is deleted, i.e. a bare assignment publishes nothing for its right-hand side again. Measured before the fix on a deterministic 120-file stride of the 1,181 admitted files: 699 bare right-hand-side variable reads, of which **61 (8.73%)** had a `uses` edge and **638 (91.27%)** had none. Written generically off the result's own field rather than off a fixture name, so it keeps biting when the fixture is renamed or a new one is added.",
    transform: psDropRelType("uses", (rel: any) => psHas(rel, "isAssignmentRead", true)),
  },
  {
    id: "powershell/assignment-read-pre-empts-new-object",
    language: "powershell",
    defectClass: "mislabel",
    description:
      "PS36 REVERT, the OVERLAP arm: the `command` stop in `emitAssignmentReads` is deleted, so the assignment reader descends into a command invocation and republishes each argument as a plain `isAssignmentRead`. This is NOT an edge-count change, which is why it needs its own mutant: `addRel` dedupes on source|type|target|line, so the republished row REPLACES the dedicated one rather than adding to it. The defect is therefore a LOSS OF THE DEDICATED KEYS, and that is what this transform re-derives — an argument read sitting on an assignment line gives up its own metadata.\n\nThe defect shipped once: `$d = New-Object \"$typeName\"` kept `isAssignmentRead` and lost `isDynamicTypeName` + `viaNewObject`, and `new-object-variable-psb14` lost all four of its expected rows as a result. A revert that merely deleted the edges would be caught by `powershell/drop-assignment-reads`; only the metadata assertion separates the two, which is why both exist.\n\nLIMITATION, stated because it is a real narrowing: this harness transforms analyzer OUTPUT, never analyzer source, so it cannot literally re-run the source-side revert. What is faithful is the OBSERVABLE SHAPE — the keys the revert costs — not the control flow that costs them. The source-side proof is the fixture failure itself, recorded in the commit that fixed it.",
    transform: (r: any) => {
      // The set of lines carrying an assignment to a variable: the lines where the
      // assignment reader and the argument reader overlap, measured off the result's
      // own symbol table rather than off a fixture name.
      // RE-AIMED 2026-10-27, twice over. The original read `s.kind === "Variable"`
      // and `s.line ?? s.range?.start?.line`; the published symbol kind is lowercase
      // `variable` and the line field is `startLine`, so the assignment set was
      // EMPTY and the transform could not fire on any fixture (SURVIVED 0 -> 0).
      // It also keyed on `isArgumentReference`, which is the key the dedicated
      // `New-Object` reader REPLACES: the rows this defect costs are marked
      // `viaNewObject` / `isDynamicTypeName` and carry no `isArgumentReference` at
      // all. Both corrections make the transform describe the measured pre-fix shape
      // rather than a shape the analyzer used to have.
      const assignmentLines = new Set<number>()
      for (const s of r.symbols ?? []) {
        if (s.kind !== "variable") continue
        // `range.startLine` is the NATIVE shape this transform sees (see the note on
        // `contains-on-reassignment`); `startLine` is kept as the normalized fallback.
        const l = s.range?.startLine ?? s.startLine
        if (typeof l === "number") assignmentLines.add(l)
      }
      return {
        ...r,
        relationships: (r.relationships ?? []).map((x: any) => {
          const meta = x.metadata ?? {}
          if (x.type !== "uses") return x
          if (meta.viaNewObject !== true && meta.isDynamicTypeName !== true) return x
          if (!assignmentLines.has(x.line_number)) return x
          const {
            isArgumentReference, isDynamicTypeName, viaNewObject, ...rest
          } = meta
          void isArgumentReference; void isDynamicTypeName; void viaNewObject
          return { ...x, metadata: { ...rest, isAssignmentRead: true } }
        }),
      }
    },
  },
  {
    id: "powershell/member-numeric-leaf-published",
    language: "powershell",
    defectClass: "fabrication",
    description:
      "F9 AT THE MEMBER LEAF: a numeric dotted chain publishes a member read. `$1.2.3.4` and `$intKeys.1.2.3.4` are a parse shape, and the grammar hands the numeric runs (`2.3`, `3.4`, `1.2`) to the member pass as `member_name` nodes. The pre-fix pass published them verbatim as `uses`, so the graph named symbols no project can declare; the whole-population incoming gate counted the rows as EXTERNAL CLAIMS ITS OWN PROJECT REFUTED (measured 2026-10-27: 3 `uses` names from PSScriptAnalyzer's InvalidMultiDotValue fixture). `isPlausibleSymbolName` does not catch this — it permits digits and dots because a DECLARED name may contain both — so the fix adds the member-only test that a leaf must contain at least one letter or underscore. Caught by member-reads-psb5's three forbid rows (`2.3`, `3.4`, `1.2`) and by its `uses == 6` count, which a re-add would push to 9.",
    transform: (r: any, source?: string) => {
      if (typeof source !== "string") return r
      const lines = source.split("\n")
      const mod = (r.symbols ?? []).find((s: any) => s.kind === "module")?.name
      if (typeof mod !== "string" || mod === "") return r
      const extra: any[] = []
      const seen = new Set<string>()
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].indexOf(".1.2.3.4") < 0) continue
        for (const target of ["1.2", "2.3", "3.4"]) {
          const key = `${i + 1}|${target}`
          if (seen.has(key)) continue
          seen.add(key)
          extra.push({
            source: mod, target, type: "uses", confidence: 0.8, line_number: i + 1,
            metadata: {
              powershellSpecific: true, isMemberAccess: true, isMemberReference: true,
              externalTarget: true, externalVia: "qualified",
            },
          })
        }
      }
      return { ...r, relationships: [...(r.relationships ?? []), ...extra] }
    },
  },
  {
    id: "powershell/static-call-target-source-spelling",
    language: "powershell",
    defectClass: "mislabel",
    description:
      "PS-B22 REVERT: every static member call's target is rewritten to the SOURCE spelling `Type::Member` instead of the store's qualified `Type.Member`. That is the pre-fix shape and it is wrong in both directions: a class method is stored with `qualifiedName = \"Counter.Add\"`, so `Counter::Add` can never bind, and the externality pass then reads a same-file callee as an external claim. Written generically off `metadata.staticMemberCall`/`staticType`, not off this fixture's names, so it keeps biting wherever a static call is pinned. Caught by static-call-psb22's four expect rows (the two in-file calls and the two external twins) and its three target forbid rows.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) => {
        const meta = x.metadata ?? {}
        if (x.type !== "calls" || meta.staticMemberCall !== true) return x
        const type = typeof meta.staticType === "string" ? meta.staticType : ""
        if (!type || !String(x.target).startsWith(`${type}.`)) return x
        return { ...x, target: `${type}::${String(x.target).slice(type.length + 1)}` }
      }),
    }),
  },
  {
    id: "powershell/assignment-read-reads-the-left",
    language: "powershell",
    defectClass: "fabrication",
    description:
      "PS36 REVERT, the FABRICATION arm, and the worst of the three: the right-hand side is read as if the left-hand side were excluded by NODE TYPE rather than by identity, so the LHS is read too and `$a = New-Object $typeName` publishes `uses -> a` for the variable it is DEFINING. A write is not a read, and an edge asserting a read of a variable at the moment of its declaration is exactly the fabricated edge the contract forbids — it is counted `unexplained` by the oracle and poisons `bb_graph` and `bb_impact`, where it reads as a self-loop.\n\nThis defect was MEASURED, not hypothesised: `namedChild(i)` returns a fresh wrapper object per call, so the original `child === left` guard was false for every child and never excluded anything (a.id === b.id and a.startIndex === b.startIndex while a === b is false). Transformed here as 'every `uses` edge whose target is the variable the same file declares on the assignment's own line becomes an assignment read', which is the observable shape.",
    transform: (r: any) => {
      // RE-AIMED 2026-10-27. This transform used to MUTATE an existing `uses` row
      // whose target equalled a bare symbol name on the same line. Neither half of
      // that predicate can be true in the published shape: a `uses` target is the
      // store-qualified name (`New-Dynamic.a`), and the symbol's line is `startLine`,
      // not `line`. So it matched nothing and reported SURVIVED at 0 -> 0.
      //
      // The defect ADDS an edge, so the faithful reconstruction adds one: a fabricated
      // `uses` to the LEFT-hand variable, from its owner, on the assignment's own line.
      // A line qualifies only where an assignment exists AND the RHS was read — the
      // same overlap the pre-fix identity bug produced. Deriving both from the result
      // keeps the transform fixture-agnostic.
      const extra: any[] = []
      for (const s of r.symbols ?? []) {
        if (s.kind !== "variable") continue
        // `range.startLine` is the NATIVE shape (this transform is applied to
        // `analyzer.analyze`'s output, not to the store-normalized result).
        const line = s.range?.startLine ?? s.startLine
        if (typeof line !== "number") continue
        const owner = s.ownerName ?? s.scope
        if (typeof owner !== "string" || owner === "") continue
        const target = typeof s.qualifiedName === "string" && s.qualifiedName !== ""
          ? s.qualifiedName
          : `${owner}.${s.name}`
        const rhsRead = (r.relationships ?? []).some(
          (x: any) => x.type === "uses" && x.line_number === line && x.target !== target,
        )
        if (!rhsRead) continue
        extra.push({
          source: owner, target, type: "uses", confidence: 0.9,
          line_number: line,
          metadata: { powershellSpecific: true, isVariableReference: true, isAssignmentRead: true },
        })
      }
      return { ...r, relationships: [...(r.relationships ?? []), ...extra] }
    },
  },
  {
    id: "powershell/dotnet-shorthand-root-unclaimed",
    language: "powershell",
    defectClass: "claim-loss",
    description:
      "PS-B27 REVERT (half one): every `instantiates` row loses `languageNamespace`, which is the pre-fix state verbatim — a bracketed .NET type literal carried ONLY the generic owner reading, so the arbiter answered it by looking up the target's OWNER (`Text`, `Diagnostics`, `System`) and refuted 40 rows over the whole population on project symbols that merely share that spelling. Caught by dotnet-shorthand-psb27's two `meta.languageNamespace` pins, which assert the LIST on both the shorthand and the qualified spelling; the `Foo.Bar` row is the negative twin that must NOT gain one, so a revert to 'claim every dotted root' also fails the fixture rather than passing it.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) => {
        if (x.type !== "instantiates") return x
        const { languageNamespace: _drop, ...md } = (x.metadata ?? {})
        return { ...x, metadata: md }
      }),
    }),
  },
  {
    id: "powershell/bare-command-unmarked",
    language: "powershell",
    defectClass: "claim-loss",
    description:
      "PSD10 REVERT: a bare command-position call stops carrying the externality reading, which is the pre-fix state verbatim — the reading was shape-based (Verb-Noun or a qualifier byte), so `git`, `cd`, `mkdir` and `dotnet` carried nothing at all. MEASURED over the whole admitted population: 34,158 rows named nothing in their own project and 28,597 of them moved to `externalVerified` when the channel reading landed, with extFAIL unchanged at 60 and resolved unchanged at 98,975. Caught by command-position-psd10's three positive rows (`git`, `cd`, `whoami`), which assert both keys.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) => {
        const md = (x.metadata ?? {}) as Record<string, unknown>
        if (md.externalVia !== "command") return x
        const { externalTarget: _t, externalVia: _v, isExternalTarget: _i, ...rest } = md
        return { ...x, metadata: rest }
      }),
    }),
  },
  {
    id: "powershell/command-reading-on-member-call",
    language: "powershell",
    defectClass: "false-claim",
    description:
      "PSD10 REVERT (the other side): the command reading is published on a MEMBER call's leaf too, so `$list.Add(1)` carries `externalVia: \"command\"` on `Add`. A member name is not a command name — the channel is the whole fact — and the widened rule would claim every .NET member the corpus calls on a receiver whose type the one-file parse cannot see. Caught by command-position-psd10's row 5 (`Add` with `methodCall: true`) and by its forbid row, which is why the fixture pins a member call beside the command rows rather than relying on the positives alone.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) => {
        const md = (x.metadata ?? {}) as Record<string, unknown>
        if (md.methodCall !== true) return x
        return { ...x, metadata: { ...md, externalTarget: true, externalVia: "command", isExternalTarget: true } }
      }),
    }),
  },
  {
    id: "powershell/numeric-index-published",
    language: "powershell",
    defectClass: "fabrication",
    description:
      "PS-B28 REVERT: a numeric element access publishes `uses -> <digits>` again, which is the pre-fix shape verbatim — PS-B10 published `$tags[0]` as `uses -> 0` with `isNumericIndex: true`, arguing the site was worth recording. The record it produces is a DEPENDENCY ON A SYMBOL NAMED `0`, a target no declaration can have, and MEASURED over the whole admitted population it was 3,734 permanently unresolvable rows (7.6% of the lane's unresolved wall). The transform re-derives the rows from the SOURCE text the way the analyzer saw them, so it reverts the shape and not a name. Caught by data-shapes-psb10's `forbidRelationships` row on `uses -> 0`, which its sibling rows make specific: the string key (`$options.Label`) and the variable key (`$names[$index]`) must still publish.",
    transform: (r: any, source?: string) => {
      if (typeof source !== "string") return r
      const lines = source.split("\n")
      const mod = (r.symbols ?? []).find((s: any) => s.kind === "module")?.name
      if (typeof mod !== "string" || mod === "") return r
      const extra: any[] = []
      for (let i = 0; i < lines.length; i++) {
        const text = lines[i]
        for (let j = 0; j < text.length; j++) {
          if (text.charCodeAt(j) !== 91 /* [ */) continue
          let k = j + 1
          while (k < text.length && text.charCodeAt(k) >= 48 && text.charCodeAt(k) <= 57) k++
          if (k === j + 1) continue
          if (text.charCodeAt(k) !== 93 /* ] */) continue
          const target = text.slice(j + 1, k)
          // A STRING OR VARIABLE KEY IS NOT THIS SHAPE — only a bare numeric run between brackets.
          extra.push({
            source: mod, target, type: "uses", confidence: 0.7, line_number: i + 1,
            metadata: { powershellSpecific: true, isElementAccess: true, isNumericIndex: true },
          })
        }
      }
      return { ...r, relationships: [...(r.relationships ?? []), ...extra] }
    },
  },
  {
    id: "powershell/letterless-target-marked",
    language: "powershell",
    defectClass: "false-claim",
    description:
      "PS-B27 REVERT (half two): a command-position target with NO ASCII letter carries the qualified externality reading again, which is the pre-fix state — `#Requires -Version 5.1` published `references -> 5.1` with `externalTarget: true` and `externalVia: \"qualified\"`, because a version separator is a dot. A version is not a name, so the arbiter's owner question asked about `5` (the MAJOR VERSION) and refuted 13 rows across the population on whatever symbol happened to carry that spelling. Caught by dotnet-shorthand-psb27's `references -> 5.1` pin, which asserts BOTH keys absent, and by its forbid row.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) => {
        if (x.type !== "references") return x
        const t = String(x.target ?? "")
        let hasLetter = false
        for (let i = 0; i < t.length; i++) {
          const c = t.charCodeAt(i)
          if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122)) { hasLetter = true; break }
        }
        if (hasLetter) return x
        return { ...x, metadata: { ...(x.metadata ?? {}), externalTarget: true, externalVia: "qualified" } }
      }),
    }),
  },
  {
    id: "powershell/env-provider-unclaimed",
    language: "powershell",
    defectClass: "claim-loss",
    description:
      "PSD11 REVERT: an environment-provider read carries only the generic externality marker, which is the pre-fix state verbatim — `$env:PSModulePath` published `externalTarget`/`externalVia: \"qualified\"` and nothing the arbiter could CHECK, because `verifyExternalClaim` treats a colon in the owner as a path byte and answers UNVERIFIABLE rather than guessing. Those rows sat in `ext?` — a claim no check can reach — on the least doubtful fact in the language. The transform is keyed on the TARGET's shape (three case-folded letters then a colon), not on a fixture or a name, so it stays live when the fixture is renamed. Caught by env-provider-psd11's two positive rows, which pin `meta.languageNamespace`; a revert that left the generic marker in place would keep every other row in the lane green, which is why the claim and not the marker is the pinned half.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) => {
        const md = (x.metadata ?? {}) as Record<string, unknown>
        const t = String(x.target ?? "")
        if (!envProviderShaped(t)) return x
        if (!Array.isArray(md.languageNamespace)) return x
        const { languageNamespace: _n, ...rest } = md
        return { ...x, metadata: rest }
      }),
    }),
  },
  {
    id: "powershell/type-accelerator-literal-kept",
    language: "powershell",
    defectClass: "claim-loss",
    description:
      "PSD12 REVERT: a static call on a TYPE ACCELERATOR keeps the written spelling and publishes `ownerMemberAbsent {owner: <literal>}` again, which is the pre-fix state verbatim. The claim says \"the owner is published and the member is not\" about a type NO admitted file declares, so the arbiter can only answer UNVERIFIED: over the whole population that was 2,256 rows, the largest single class in `ext?`. The transform re-derives the shape from the result (a `staticMemberCall` whose published target has a one-segment owner and carries `staticTypeResolved`), so it reverts the mechanism rather than naming a fixture. Caught by type-accelerator-psd12's two resolved-target expect rows and by its forbid row on the pre-fix spelling.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) => {
        const md = (x.metadata ?? {}) as Record<string, unknown>
        if (md.staticMemberCall !== true) return x
        if (typeof md.staticTypeResolved !== "string") return x
        const t = String(x.target ?? "")
        const dot = t.lastIndexOf(".")
        if (dot <= 0) return x
        const owner = t.slice(0, dot)
        const { staticTypeResolved: _res, typeAccelerator: _acc, languageNamespace: _ns, ...rest } = md
        return {
          ...x,
          target: `${String(md.typeAccelerator ?? md.staticType)}.${t.slice(dot + 1)}`,
          metadata: {
            ...rest,
            staticType: String(md.typeAccelerator ?? md.staticType),
            ownerMemberAbsent: { owner: String(md.typeAccelerator ?? md.staticType), member: t.slice(dot + 1) },
          },
        }
      }),
    }),
  },
  {
    id: "powershell/type-accelerator-shadows-declaration",
    language: "powershell",
    defectClass: "misattribution",
    description:
      "PSD12 REVERT (the other side): the accelerator table is consulted BEFORE the file's own classes, so `[Regex]::Pattern()` in a file that declares `class Regex` is republished as `System.Text.RegularExpressions.Regex.Pattern` with a `System` namespace claim. The claim is false — PowerShell's class lookup is case-insensitive and the local class wins — and the direction matters: a resolvable in-file call is laundered into an external claim, which is where a defect hides best. Written off the RESULT (a static call whose owner is a class this file declares), not off a fixture name. Caught by type-accelerator-psd12's `Regex.Pattern` row and by its forbid row on the rewritten target.",
    transform: (r: any) => {
      const classes = new Set<string>(
        (r.symbols ?? [])
          .filter((s: any) => s.kind === "class" && typeof s.name === "string")
          .map((s: any) => String(s.name).toLowerCase()),
      )
      return {
        ...r,
        relationships: (r.relationships ?? []).map((x: any) => {
          const md = (x.metadata ?? {}) as Record<string, unknown>
          if (md.staticMemberCall !== true) return x
          const t = String(x.target ?? "")
          const dot = t.lastIndexOf(".")
          if (dot <= 0) return x
          const owner = t.slice(0, dot)
          if (!classes.has(owner.toLowerCase())) return x
          return {
            ...x,
            target: `System.Fake.${owner}.${t.slice(dot + 1)}`,
            metadata: { ...md, languageNamespace: ["System"] },
          }
        }),
      }
    },
  },
  {
    id: "powershell/dotted-owner-keeps-absent-claim",
    language: "powershell",
    defectClass: "claim-loss",
    description:
      "PSD12 REVERT (the dotted half): a static call on a DOTTED literal goes back to `ownerMemberAbsent`, which the arbiter cannot check — the owner (`System.IO.Path`, `IO.File`) is a type no admitted file declares, so the claim is UNVERIFIED forever. MEASURED: the dotted-owner split moved 1,038 population rows from `ext?` to `extOK` with extFAIL unchanged at 60, because a dotted name cannot be a published symbol (PowerShell class names cannot contain `.`; variables, functions and parameters are stored as bare identifiers). Caught by externality-arbiter-psb17's expect row and its forbid row, and independently by type-accelerator-psd12's `IO.Path.GetFullPath` row.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) => {
        const md = (x.metadata ?? {}) as Record<string, unknown>
        if (md.staticMemberCall !== true) return x
        const t = String(x.target ?? "")
        const dot = t.lastIndexOf(".")
        if (dot <= 0) return x
        const owner = t.slice(0, dot)
        if (owner.indexOf(".") < 0) return x
        const { externalTarget: _t, externalVia: _v, isExternalTarget: _i, ...rest } = md
        return {
          ...x,
          metadata: { ...rest, ownerMemberAbsent: { owner, member: t.slice(dot + 1) } },
        }
      }),
    }),
  },
  {
    id: "powershell/env-root-folded",
    language: "powershell",
    defectClass: "false-claim",
    description:
      "PSD11 REVERT (the mistake this change made): the namespace list carries a FOLDED root (`\"env\"`) instead of the spelling the source writes. PowerShell's provider prefixes are case-insensitive, so folding looks like normalisation rather than a decision — and it is a FALSE CLAIM, because the arbiter compares the target's own first segment against the list byte for byte (measured against `namespaceMatchOf`: `(\"ENV:TEMP\", [\"env\"])` is null, `(\"ENV:TEMP\", [\"ENV\"])` is `ENV`). A lane that folds converts every mixed-case row from 'verified' to 'REFUTED', i.e. it trades an unverifiable claim for a false one. Caught by env-provider-psd11's `ENV:TEMP` positive AND its forbid row on the folded list; the forbid is the half that survives a fix which lists both spellings.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) => {
        const md = (x.metadata ?? {}) as Record<string, unknown>
        if (!Array.isArray(md.languageNamespace)) return x
        const folded = (md.languageNamespace as unknown[]).map((v: unknown) =>
          typeof v === "string" ? v.toLowerCase() : v)
        return { ...x, metadata: { ...md, languageNamespace: folded } }
      }),
    }),
  },
]

/**
 * IS THIS TARGET SHAPED LIKE AN ENVIRONMENT-PROVIDER READ (`env:NAME`, any case)?
 *
 * Shared by the two PSD11 mutants so neither hard-codes the fixture's variable names. The test is
 * the analyzer's own: a case-folded three-letter prefix then a colon at index 3, and something after
 * it. Written as a byte scan because this file's zero-regex rule applies to the lane's instruments
 * as well as to the analyzer (script/m14/powershell-zero-regex.ts reads both).
 */
const envProviderShaped = (t: string): boolean => {
  if (t.length <= 4) return false
  if (t.charCodeAt(3) !== 58 /* : */) return false
  const a = t.charCodeAt(0) | 0x20, b = t.charCodeAt(1) | 0x20, c = t.charCodeAt(2) | 0x20
  return a === 101 /* e */ && b === 110 /* n */ && c === 118 /* v */
}

/** PS-B16 — the three byte predicates the four cause-C mutants re-derive. They duplicate
 *  `externalReadingOf` in the analyzer on purpose: a revert that called the analyzer's own
 *  helper could not fail when the helper's LOGIC changed, which is the only thing these
 *  mutants are for. No regex, matching the analyzer's own constraint. */
const psUpper = (c: number): boolean => c >= 65 && c <= 90
/** A hyphen with an ASCII uppercase letter on BOTH sides — PowerShell's Verb-Noun spelling. */
const psByteIsCmdlet = (t: string): boolean => {
  for (let i = 1; i < t.length; i++) {
    if (t.charCodeAt(i) === 45 && psUpper(t.charCodeAt(0)) && psUpper(t.charCodeAt(i + 1))) return true
  }
  return false
}
/** A byte no bare PowerShell identifier has. */
const psHasQualifierByte = (t: string): boolean => {
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i)
    if (c === 46 || c === 92 || c === 47 || c === 58) return true
  }
  return false
}
/** A case-insensitive `prefix:` match. */
const psHasScopePrefix = (t: string, prefixes: string[]): boolean => {
  for (const p of prefixes) {
    if (t.length <= p.length + 1 || t.charCodeAt(p.length) !== 58) continue
    let eq = true
    for (let i = 0; i < p.length; i++) {
      let c = t.charCodeAt(i)
      if (c >= 65 && c <= 90) c += 32
      if (c !== p.charCodeAt(i)) { eq = false; break }
    }
    if (eq) return true
  }
  return false
}
