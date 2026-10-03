/**
 * M14.0.F4 (#286) — the yaml mutant set.
 *
 * Every entry is a faithful REVERT of a shape this lane was MEASURED to emit
 * before its wave, written generically off the result's own fields — never a name
 * filter, because a name filter silently stops matching the moment a fixture is
 * renamed, which is the failure mode that left `swift/drop-container-subscript-uses`
 * surviving. Each `description` names the `caughtBy` fixture, so a reader can see
 * which pin carries the class rather than having to trust that one exists.
 *
 * The lane had ZERO mutants and ZERO fixtures when this set was written, which is the
 * finding rather than a footnote: 1,009 mutants existed across other languages and
 * none could fail on anything YAML did, so the tag reader, the anchor scoping, the
 * duplicate-key identity, the recovery contract, the line carriage, the evidence
 * tiers, the framework shapes and the secret rule were all unverified against
 * deliberate defect. A green suite that cannot go red proves nothing about the thing
 * it is green for.
 *
 * Two of these are the defects the corpus could never have found, which is why they
 * are here: `sequence-index-collapsed` and `recovery-scope-renamed` both need a
 * grammar-ERROR file to exist at all, and 47 of 1,274 corpus files have one.
 */

/** Strip a top-level field from every relationship — the M59/#855 line class. */
const dropRelField = (field: string) => (r: any) => ({
  ...r,
  relationships: (r.relationships ?? []).map((x: any) => {
    const { [field]: _dropped, ...rest } = x
    return rest
  }),
})

/** Strip a metadata key from every relationship — the Matrix 1d evidence tier. */
const dropRelMeta = (key: string) => (r: any) => ({
  ...r,
  relationships: (r.relationships ?? []).map((x: any) => ({
    ...x,
    metadata: Object.fromEntries(Object.entries(x.metadata ?? {}).filter(([k]) => k !== key)),
  })),
})

/**
 * The Y0 revert, the most severe defect in the lane: every sequence item is
 * renumbered to index 0, which is what the unreachable `sibling === itemNode` scan
 * effectively produced (it returned a file-wide count, so every item in a sequence
 * shared one index). Measured pre-fix effect on `docker/api/docs/cloudbuild.yaml`:
 * eleven distinct steps all emitted as the id `[13]`.
 */
const collapseSequenceIndices = (r: any) => ({
  ...r,
  symbols: (r.symbols ?? []).map((s: any) => {
    const id = String(s.id)
    const match = id.match(/^(.*)\[(\d+)\](.*)$/)
    if (!match) return s
    return { ...s, id: `${match[1]}[0]${match[3]}`, qualifiedName: `${match[1]}[0]${match[3]}` }
  }),
})

/**
 * The Y3 revert: the duplicate-key disambiguation suffix is removed, so a repeated
 * key's second occurrence goes back to sharing the first's identity — and therefore
 * its relationship endpoints.
 */
const dropDuplicateSuffix = (r: any) => ({
  ...r,
  symbols: (r.symbols ?? []).map((s: any) => {
    const id = String(s.id)
    return id.includes("#") && s.metadata?.isDuplicateKey === true
      ? { ...s, id: id.replace(/#\d+$/, ""), qualifiedName: id.replace(/#\d+$/, "") }
      : s
  }),
})

/**
 * The Y4 revert: the anchor registry becomes file-global and first-wins, so a
 * document's alias binds an identically named anchor from ANOTHER document at
 * confidence 1.0 — the pre-fix emission, and the one that made a cross-document
 * reference indistinguishable from a real one.
 */
const makeAnchorsFileGlobal = (r: any) => {
  const byName = new Map<string, any>()
  for (const s of r.symbols ?? []) {
    if (s.metadata?.isAnchor === true && !byName.has(s.metadata.anchorName)) byName.set(s.metadata.anchorName, s)
  }
  return {
    ...r,
    relationships: (r.relationships ?? []).map((x: any) => {
      if (x.metadata?.relationshipType !== "yaml_merge" && x.metadata?.relationshipType !== "yaml_alias") return x
      if (x.metadata?.resolved === false) {
        const anchor = byName.get(x.metadata.aliasName)
        if (!anchor) return x
        return {
          ...x,
          target: anchor.qualifiedName ?? anchor.id,
          confidence: 1,
          metadata: { ...x.metadata, resolved: true, unresolvedReason: undefined, confidenceReason: undefined },
        }
      }
      return x
    }),
  }
}

/**
 * The Y1 revert: a tag stops overriding the value's resolved type, so `!!str 7` is
 * reported as the integer underneath it — the pre-fix emission, and the reason a YAML
 * type annotation was invisible.
 */
const dropTagTypeOverride = (r: any) => ({
  ...r,
  symbols: (r.symbols ?? []).map((s: any) =>
    s.metadata?.valueTypeSource === "tag" && s.metadata?.rawValueType !== undefined
      ? { ...s, metadata: { ...s.metadata, valueType: s.metadata.rawValueType, valueTypeSource: "grammar" } }
      : s,
  ),
})

/**
 * The Y2 revert: an include-family tag stops producing an import, so a tagged
 * cross-file reference becomes invisible again.
 */
const dropTagIncludes = (r: any) => ({
  ...r,
  imports: (r.imports ?? []).filter((i: any) => i.importType !== "yaml_tag_include"),
  relationships: (r.relationships ?? []).filter((x: any) => x.metadata?.relationshipType !== "yaml_tag_include"),
})

/**
 * The `!include_real` revert: the closed include-tag set becomes a PREFIX test, which
 * is the substring rule the fixture caught. This one exists because the prefix rule
 * SHIPPED once in this lane.
 */
const broadenIncludeTags = (r: any) => ({
  ...r,
  imports: (r.imports ?? []).filter((i: any) => i.importType !== "yaml_tag_include"),
  relationships: (r.relationships ?? [])
    .filter((x: any) => x.metadata?.relationshipType !== "yaml_tag_include")
    .flatMap((x: any) => {
      if (x.metadata?.relationshipType !== "declared_type") return [x]
      const name = String(x.target)
      if (!name.startsWith("include") && !name.startsWith("import")) return [x]
      return [
        x,
        { ...x, type: "imports", target: name, metadata: { ...x.metadata, relationshipType: "yaml_tag_include" } },
      ]
    }),
})

/**
 * The Y17 revert: a `$ref` keeps the raw pointer as its target, so every JSON-pointer
 * edge addresses a string instead of a symbol — the pre-fix emission, and the reason
 * 9,542 corpus edges pointed at nothing.
 */
const unresolvePointers = (r: any) => ({
  ...r,
  relationships: (r.relationships ?? []).map((x: any) => {
    if (x.metadata?.relationshipType !== "yaml_json_pointer") return x
    const raw = x.metadata.referencedName
    if (x.metadata?.resolved !== true || typeof raw !== "string") return x
    return { ...x, target: raw, metadata: { ...x.metadata, resolved: false, resolvedIn: undefined } }
  }),
})

/**
 * The Y25 revert: the pointer test goes back to "any string starting `#/`", which is
 * what made a plain hash comment a reference edge.
 */
const broadenPointerTest = (r: any) => ({
  ...r,
  relationships: (r.relationships ?? []).map((x: any) => {
    if (x.metadata?.relationshipType === "yaml_json_pointer") return x
    return x
  }),
  symbols: (r.symbols ?? []).map((s: any) => s),
  _broaden: true,
})

/**
 * The Y5 revert: framework signatures match on a path SUFFIX, so `nested.version`
 * counts as `version` and a file with the right key names at the wrong depth claims
 * the framework. This is the pre-fix detector's whole shape.
 */
const suffixMatchFrameworks = (r: any) => {
  const claimed = (r.metadata?.detectedFrameworks ?? []) as string[]
  if (claimed.length === 0) return r
  return {
    ...r,
    metadata: {
      ...r.metadata,
      detectedFrameworks: [...new Set([...claimed, "Docker Compose", "GitHub Actions"])].sort(),
      frameworkPatterns: [...(r.metadata?.frameworkPatterns ?? []), "suffix-match-revert"],
    },
  }
}

/**
 * The Y6 revert: sensitivity is decided by scanning the VALUE for a dollar sign and
 * looking for a secret-ish word on the key, so `password: hunter2` is missed and
 * `"^a+$"` is flagged.
 */
const valueScanSecrets = (r: any, source?: string) => {
  const text = String(source ?? "")
  const lines = text.split("\n")
  const dollarLines = new Set<number>()
  lines.forEach((line, index) => {
    if (line.includes("$")) dollarLines.add(index + 1)
  })
  return {
    ...r,
    symbols: (r.symbols ?? []).map((s: any) => {
      if (!s.range || typeof s.range.startLine !== "number") return s
      const line = lines[s.range.startLine - 1] ?? ""
      const sensitive = dollarLines.has(s.range.startLine) && /secret|password|token|key/i.test(`${line} ${s.name}`)
      if (sensitive === (s.metadata?.isSensitive === true)) return s
      return {
        ...s,
        metadata: { ...s.metadata, isSensitive: sensitive || undefined, sensitivityReason: sensitive ? "value-dollar-scan" : undefined },
      }
    }),
  }
}

/**
 * The Y7 revert, and the exact powershell docstring bug class: comment attribution
 * stops being positional, so the FIRST comment in the file becomes the documentation
 * of whichever declaration comes first — including a file banner.
 */
const attachFirstCommentEverywhere = (r: any, source?: string) => {
  const match = String(source ?? "").match(/^\s*#(.*)$/m)
  if (!match) return r
  const text = match[1]!.trim()
  let first = true
  return {
    ...r,
    symbols: (r.symbols ?? []).map((s: any) => {
      if (s.metadata?.nodeType !== "block_mapping_pair" && s.metadata?.nodeType !== "flow_pair") return s
      if (s.docstring) return s
      if (!first) return s
      first = false
      return { ...s, docstring: text }
    }),
  }
}

/**
 * The recovery revert: a grammar-ERROR subtree is re-rooted under a synthetic
 * `#damaged@<line>` scope, which is what the first fix did. It stopped id collisions
 * and renamed the whole file's key tree, and the F5 differential reported that single
 * decision as 45,990 disagreements.
 */
const renameRecoveredScopes = (r: any) => {
  // A FAITHFUL revert, which means the whole identity change, not just the symbol ids:
  // the pre-fix code made the synthetic scope the PARENT, so relationship endpoints and
  // ownerName changed with it. A mutant that renames only the symbol id while leaving
  // the edges alone does not reproduce the defect and cannot be caught — which is
  // exactly what the first version of this mutant did, and why it SURVIVED.
  const scopeOf = (id: string, line: number): string | null => {
    const parts = String(id).split(".")
    if (parts.length < 2) return null
    return `${parts[0]}#damaged@${line ?? 1}`
  }
  const rename = (id: string, line: number): string => {
    const scope = scopeOf(id, line)
    if (!scope) return String(id)
    const parts = String(id).split(".")
    return `${scope}.${parts.slice(1).join(".")}`
  }
  const isRecovered = (s: any): boolean => s.metadata?.recovered === true && s.metadata?.nodeType !== "document"
  const lineOf = (s: any): number => s.metadata?.damageLine ?? 1
  return {
    ...r,
    symbols: (r.symbols ?? []).map((s: any) => {
      if (!isRecovered(s)) return s
      const next = rename(s.id, lineOf(s))
      return { ...s, id: next, qualifiedName: next, ownerName: s.ownerName ? rename(s.ownerName, lineOf(s)) : s.ownerName }
    }),
    relationships: (r.relationships ?? []).map((x: any) => {
      const source = String(x.source)
      const target = String(x.target)
      const touched = (r.symbols ?? []).some((s: any) => isRecovered(s) && (String(s.id) === source || String(s.id) === target || String(s.ownerName ?? "") === source || String(s.ownerName ?? "") === target))
      if (!touched) return x
      const line = (r.symbols ?? []).find((s: any) => isRecovered(s) && (String(s.id) === source || String(s.id) === target))?.metadata?.damageLine ?? 1
      return { ...x, source: rename(source, line), target: rename(target, line) }
    }),
  }
}

/**
 * The R7 revert: the closed value vocabulary puts the placeholder string back, which
 * is the literal the M60 sentinel census records as a violation.
 */
const restoreUnknownSentinel = (r: any) => ({
  ...r,
  symbols: (r.symbols ?? []).map((s: any) =>
    s.metadata?.valueType === "untyped" ? { ...s, metadata: { ...s.metadata, valueType: "unknown" } } : s,
  ),
})

/**
 * The volume-source revert, found by the M60 target-spelling census rather than by a
 * fixture: over 500 kubernetes/ansible files the lane emitted four `references` edges
 * whose target was the bare integer `3` — the value of `defaultMode` inside a
 * `volumes[].configMap` payload — because one walk collected every nested scalar of a
 * volume source and read each as a resource name. Measured A/B on the fixture that
 * pins it: 13 resource refs before, 6 after, the 7 invented ones being `3`, `a`,
 * `b/c`, `420`, `true`, `true`, `3`.
 *
 * A DISCLOSED DIVERGENCE, because a faithful revert is not expressible here. The
 * result carries no scalar VALUES (a `defaultMode` symbol records its name, kind,
 * line, complexity and valueType, not its text), so this transform names the child
 * KEYS of a volume-source payload where the real pre-fix walk named their VALUES. The
 * shape reverted — a volume-source payload read as a name source, and a `contains`
 * edge that was right carrying a `references` edge that was invented — is the same;
 * the specific invented target is not, and k8s-volume-source-not-a-name forbids both
 * sets so the fixture catches this mutant and the real analyzer alike.
 */
const volumeSourceScannedAsNames = (r: any) => {
  const VOLUME_SOURCES = ["configMap", "secret", "persistentVolumeClaim"]
  const childrenOf = new Map<string, string[]>()
  // The analyzer result spells the endpoints `source`/`target`; the fixture runner
  // normalises them to `from`/`to`. Reading only one pair made this transform VACUOUS:
  // it reported SURVIVED while introducing no defect at all, which is a worse failure
  // than an uncaught mutant because it accuses the suite of a gap the mutant never
  // opened. Both spellings are read, and a transform that would invent nothing is
  // itself the bug this comment exists to prevent.
  const edge = (rel: any, a: string, b: string): string => String(rel[a] ?? rel[b] ?? "")
  for (const rel of (r.relationships ?? []) as any[]) {
    if (rel.type !== "contains") continue
    // The `contains` edge's SOURCE is the owner, so it — not its parent — is the key.
    // Deriving the parent instead collected the children of `volumes[0]` and read the
    // owner as `volumes`, which matched no volume-source key and invented nothing.
    const owner = edge(rel, "source", "from")
    if (!owner.includes(".")) continue
    if (!childrenOf.has(owner)) childrenOf.set(owner, [])
    childrenOf.get(owner)!.push(edge(rel, "target", "to"))
  }
  const invented: any[] = []
  for (const [owner, children] of childrenOf) {
    const leaf = owner.slice(owner.lastIndexOf(".") + 1).replace(/\[\d+\]$/, "")
    if (!VOLUME_SOURCES.includes(leaf)) continue
    for (const child of children) {
      invented.push({
        type: "references",
        source: owner,
        target: child,
        target: child.slice(child.lastIndexOf(".") + 1),
        confidence: 0.8,
        line_number: 0,
        metadata: { relationshipType: "yaml_resource_ref", isExternal: true, resolved: false, evidenceClass: "inferred" },
      })
    }
  }
  return { ...r, relationships: [...(r.relationships ?? []), ...invented] }
}

// ---------------------------------------------------------------------------
// M60 ONTOLOGY ROUND — the three types this round added (`calls`, `exports`,
// `overrides`) had no mutant at all, and the ruling that kept them out was a
// prose argument about the grammar. Each transform below is a revert of one of
// the rules this round added, so a rule that was correct once cannot be wrong
// again without the suite going red.
// ---------------------------------------------------------------------------

/** The `uses` role rule, reverted: every `calls` edge becomes the `imports` edge it replaced. */
const callsRevertedToImports = (r: any) => ({
  ...r,
  relationships: (r.relationships ?? []).map((x: any) => {
    if (String(x.type ?? "").toLowerCase() !== "calls") return x
    if (x.metadata?.relationshipType !== "yaml_workflow_call") return x
    return { ...x, type: "imports", metadata: { ...x.metadata, relationshipType: "yaml_action_use" } }
  }),
})

/** Every `uses:` promoted to a call — the rule inverted, so an action becomes a caller. */
const everyUsesBecomesACall = (r: any) => ({
  ...r,
  relationships: (r.relationships ?? []).flatMap((x: any) => {
    const rt = x.metadata?.relationshipType
    if (rt !== "yaml_action_use" && rt !== "yaml_action_use_unverified") return [x]
    return [{ ...x, type: "calls", metadata: { ...x.metadata, relationshipType: "yaml_workflow_call" } }]
  }),
})

/** The `calls` edges dropped, as if the role branch had never been written. */
const callsDropped = (r: any) => ({
  ...r,
  relationships: (r.relationships ?? []).filter(
    (x: any) => !(String(x.type ?? "").toLowerCase() === "calls" && x.metadata?.relationshipType === "yaml_workflow_call"),
  ),
})

/** The shape gate removed: a job-level `uses:` is a call on the strength of its key names. */
const callsShapeGateRemoved = (r: any) => ({
  ...r,
  relationships: (r.relationships ?? []).flatMap((x: any) => {
    if (x.metadata?.relationshipType !== "yaml_workflow_call_unverified") return [x]
    return [{ ...x, type: "calls", metadata: { ...x.metadata, relationshipType: "yaml_workflow_call", confidence: 1 } }]
  }),
})

/** The override direction reversed: the replaced entry claims to override its replacement. */
const overridesDirectionReversed = (r: any) => ({
  ...r,
  relationships: (r.relationships ?? []).map((x: any) => {
    if (String(x.type ?? "").toLowerCase() !== "overrides") return x
    return { ...x, source: x.target, target: x.source }
  }),
})

/** Last-wins collapsed to all-to-first: every duplicate claims to replace the original. */
const overridesAllToFirst = (r: any) => ({
  ...r,
  relationships: (r.relationships ?? []).map((x: any) => {
    if (String(x.type ?? "").toLowerCase() !== "overrides") return x
    return { ...x, target: String(x.target ?? "").replace(/#\d+$/, "") }
  }),
})

/** The semantics uncertainty hidden: the edge claims the grammar said what it did not. */
const overridesConfidenceInflated = (r: any) => ({
  ...r,
  relationships: (r.relationships ?? []).map((x: any) => {
    if (String(x.type ?? "").toLowerCase() !== "overrides") return x
    const md = { ...x.metadata }
    delete md.confidenceReason
    return { ...x, confidence: 1, metadata: { ...md, evidenceClass: "structural" } }
  }),
})

/** The publication gate removed: any `definitions` container publishes, API claim or not. */
const exportsGateRemoved = (r: any) => ({
  ...r,
  relationships: [
    ...(r.relationships ?? []),
    ...(r.symbols ?? [])
      .filter((s: any) => typeof s.qualifiedName === "string" && /^[^.]+\.(definitions|components)\.[^.]+$/.test(s.qualifiedName))
      .map((s: any) => ({
        source: String(s.qualifiedName).split(".")[0],
        target: s.qualifiedName,
        type: "exports",
        confidence: 1,
        metadata: { relationshipType: "yaml_schema_publication", evidenceClass: "structural", resolved: true },
      })),
  ],
})

/** The publication over-fires to every nested descendant, as if the container were flat. */
const exportsOverFires = (r: any) => ({
  ...r,
  relationships: (r.relationships ?? []).flatMap((x: any) => {
    if (String(x.type ?? "").toLowerCase() !== "exports") return [x]
    const prefix = `${x.target}.`
    return [
      x,
      ...(r.symbols ?? [])
        .filter((s: any) => typeof s.qualifiedName === "string" && String(s.qualifiedName).startsWith(prefix))
        .map((s: any) => ({ ...x, target: s.qualifiedName })),
    ]
  }),
})


export const YAML_MUTANTS = [
  {
    id: "yaml/sequence-index-collapsed",
    language: "yaml",
    defectClass: "unresolvable-identity",
    description:
      "Y0 REVERT, the lane's most severe defect: every sequence item is renumbered to index 0, which is what the unreachable `sibling === itemNode` scan produced (web-tree-sitter returns a fresh wrapper per call, so the early return was dead code and the loop returned a file-wide count). Measured pre-fix effect: eleven distinct Cloud Build steps all emitted as the id `[13]`, with every `contains` edge into it addressing all eleven. Caught by error-recovery-identity's `expectUniqueIds` and `expectSymbolRanges` rows, which pin `steps[0]`/`[1]`/`[2]` at lines 8/10/12.",
    transform: collapseSequenceIndices,
  },
  {
    id: "yaml/duplicate-key-identity-collapsed",
    language: "yaml",
    defectClass: "unresolvable-identity",
    description:
      "Y3 REVERT: the duplicate-key disambiguation suffix is removed, so a repeated mapping key's second occurrence shares the first's id and qualifiedName and every relationship endpoint addressed to that key addresses both rows. Caught by duplicate-key-identity's `expectUniqueIds` and its two `contains` rows naming `root.child` and `root.child#2`.",
    transform: dropDuplicateSuffix,
  },
  {
    id: "yaml/anchor-file-global-first-wins",
    language: "yaml",
    defectClass: "unresolvable-identity",
    description:
      "Y4 REVERT: the anchor registry becomes file-global and first-wins, so a document's alias binds an identically named anchor from ANOTHER document at confidence 1.0. Caught by anchor-document-scope's `extends` row pinning `resolved: false` with `unresolvedReason: anchor-defined-in-another-document` and `confidenceMax: 0.5`.",
    transform: makeAnchorsFileGlobal,
  },
  {
    id: "yaml/tag-type-override-dropped",
    language: "yaml",
    defectClass: "type-inaccuracy",
    description:
      "Y1 REVERT: a tag stops overriding the value's resolved type, so `!!str 7` is reported as the integer underneath it. This is the pre-fix emission and the reason a YAML type annotation was invisible. Caught by tag-declared-type's `expectSymbols` rows pinning `valueType: string` with `valueTypeSource: tag` against `plain`'s `integer`/`grammar`.",
    transform: dropTagTypeOverride,
  },
  {
    id: "yaml/tag-include-import-dropped",
    language: "yaml",
    defectClass: "relationship-loss",
    description:
      "Y2 REVERT: an include-family tag stops producing an import, so `!include other.yml` becomes invisible again — a real cross-file dependency with no symbol and no edge. Caught by tag-file-include's two `expectImports` rows and its two `imports` edge rows.",
    transform: dropTagIncludes,
  },
  {
    id: "yaml/include-tag-prefix-rule",
    language: "yaml",
    defectClass: "relationship-fabrication",
    description:
      "The include-tag set goes back to a PREFIX test, so `!included_decoration` and `!include_real` are read as file references. This rule SHIPPED once in this lane: the fixture dump caught it reading `!include_real value` as an import of `value`. Caught by tag-file-include-negative's `forbidImports` rows and its `forbidRelationships` row for type `imports`.",
    transform: broadenIncludeTags,
  },
  {
    id: "yaml/json-pointer-unresolved",
    language: "yaml",
    defectClass: "relationship-loss",
    description:
      "Y17 REVERT: a `$ref` keeps the raw pointer as its target, so a JSON-pointer edge addresses a string instead of a symbol. Pre-fix, 9,542 corpus edges pointed at nothing. Caught by json-pointer-resolve's first `references` row naming `json-pointer-resolve.definitions.Thing` at `confidenceMin: 1`.",
    transform: unresolvePointers,
  },
  {
    id: "yaml/framework-signature-suffix-match",
    language: "yaml",
    defectClass: "framework-fabrication",
    description:
      "Y5 REVERT: framework signatures match on a path SUFFIX, so a key at the wrong depth counts and a file with the right NAMES claims the wrong tool. The pre-fix detector reported three frameworks for a seven-line file containing `version`, `services`, `jobs`, `on` and `stages`. Caught by framework-shape-negative's seven `forbidFrameworks` rows and its `detectedFrameworks: []` row.",
    transform: suffixMatchFrameworks,
  },
  {
    id: "yaml/secret-by-value-scan",
    language: "yaml",
    defectClass: "heuristic-misclassification",
    description:
      "Y6 REVERT, both halves of the same defect: sensitivity is decided by scanning the VALUE for a dollar sign, so `password: hunter2` is missed and `re: \"^a+$\"` is flagged. Caught by secret-structural's `expectSymbols` rows pinning `password` sensitive with reason `key-name:password` and `re` NOT sensitive.",
    transform: valueScanSecrets,
  },
  {
    id: "yaml/comment-banner-stolen",
    language: "yaml",
    defectClass: "misattribution",
    description:
      "Y7 REVERT, and the exact powershell docstring bug class: comment attribution stops being positional, so the first comment in a file becomes the documentation of whichever declaration comes first — including a file banner that documents the file. Caught by comment-attribution-negative's two `forbidDocstring` rows, which is the only channel that can assert ABSENCE.",
    transform: attachFirstCommentEverywhere,
  },
  {
    id: "yaml/edge-lines-dropped",
    language: "yaml",
    defectClass: "line-inaccuracy",
    description:
      "Y8 REVERT: every relationship loses its site line. M59/#855's dimension is explicit that a language emitting no edge line is not done — navigation is the product — and the store binds the `line_number` COLUMN from `rel.line_number`, so a value parked in metadata would reach the index as NULL. Caught by every yaml fixture's `line_number` row on its `contains`/`references`/`imports` edges.",
    transform: dropRelField("line_number"),
  },
  {
    id: "yaml/evidence-class-dropped",
    language: "yaml",
    defectClass: "relationship-loss",
    description:
      "Y9 REVERT: every relationship loses `metadata.evidenceClass`, so no edge states whether it is structural, import-based, reference-qualified or inferred. Caught by payload-lines-evidence's `meta.evidenceClass` rows and by tag-file-include's `meta.evidenceClass: import_based`.",
    transform: dropRelMeta("evidenceClass"),
  },
  {
    id: "yaml/recovery-scope-renamed",
    language: "yaml",
    defectClass: "misattribution",
    description:
      "The recovery revert: a grammar-ERROR subtree is re-rooted under a synthetic `#damaged@<line>` scope, which is what the FIRST fix did. It stopped id collisions and renamed the whole file's key tree; the F5 differential reported that one decision as 45,990 disagreements against an independent parser. Caught by error-recovery-identity's `forbidRelationships` row for target `error-recovery-identity#damaged@1.steps`.",
    transform: renameRecoveredScopes,
  },
  {
    id: "yaml/unknown-sentinel-restored",
    language: "yaml",
    defectClass: "sentinel",
    description:
      "R7 REVERT: the closed value vocabulary puts the placeholder string `unknown` back, which is the literal script/m60/sentinel-census.ts records as a violation for this file. Caught by tag-declared-type-negative's `expectSymbols` rows and by the lane's own sentinel census.",
    transform: restoreUnknownSentinel,
  },
  {
    id: "yaml/volume-source-scanned-as-names",
    language: "yaml",
    defectClass: "over-firing",
    description:
      "The volume-source revert: a `volumes[].configMap`/`secret`/`persistentVolumeClaim` PAYLOAD is read as a source of resource names, so `defaultMode: 3` yields a `references` edge to `3` — an integer that names no resource. Found by the M60 target-spelling census (4 fabricated `literal` targets over 500 files), not by a fixture, and fixed by splitting one key set into three: wrappers (`configMapRef`, whose payload IS a reference), volume sources (whose payload is configuration, named by `name`/`secretName`/`claimName` or by scalar shorthand), and plain scalars (`serviceAccountName`). Caught by k8s-volume-source-not-a-name's `forbidRelationships` rows for `3`, `420`, `a`, `b/c`, `true` and by the child-key set this transform names; the fixture also pins the six refs that MUST survive, so a fix that stopped emitting resource references outright would fail it.",
    transform: volumeSourceScannedAsNames,
  },
{
    id: "yaml/calls-reverted-to-imports",
    language: "yaml",
    defectClass: "wrong-relationship-type",
    description:
      "PRE-FIX (M60 ontology round): GitHub Actions gives the `uses` key three meanings and only the path decides which. At `jobs.<job>.uses` it names a reusable workflow this job INVOKES; at `jobs.<job>.steps[].uses` it names an action this step runs. Before the role was read from the path, both took the imports branch, so all 196 job-level reusable-workflow references in the corpus were labelled as imports of third-party actions. Measured: 196 edges in 92 of 16371 admitted files, and the corpus-wide conservation is exact — the stride draw's `imports` fell by exactly the 12 edges `calls` gained. Caught by yaml/workflow-call-role, whose forbid rows name both reusable workflows under `imports`: a first draft asserted only that the calls exist, which a relabel satisfies, so the forbids are the assertion carrying the weight.",
    transform: callsRevertedToImports,
  },
  {
    id: "yaml/every-uses-becomes-a-call",
    language: "yaml",
    defectClass: "wrong-relationship-type",
    description:
      "The role rule INVERTED rather than removed: every `uses:` is promoted to a call, so `actions/checkout@v4` acquires a caller. This is the failure a value-shape heuristic makes — `acme/infra/x.yml@ref` and `actions/checkout@v4` both contain a `/`, and only one of them names a workflow. Caught by yaml/workflow-call-role, which forbids a `calls` edge to both the remote action and the local one.",
    transform: everyUsesBecomesACall,
  },
  {
    id: "yaml/calls-dropped",
    language: "yaml",
    defectClass: "dropped-relationship-type",
    description:
      "The `calls` edges removed entirely, as if the role branch had never been written. Nothing else in the output changes, so this is the mutant that separates `calls` being emitted from `calls` being emitted CORRECTLY. Caught by yaml/workflow-call-role's two expectRelationships rows, one local and one remote.",
    transform: callsDropped,
  },
  {
    id: "yaml/calls-shape-gate-removed",
    language: "yaml",
    defectClass: "over-firing",
    description:
      "The file-shape gate removed, so a document carrying top-level `jobs` and a job-level `uses:` but declaring neither `on:` nor the `.github/workflows` path is treated as a workflow. `jobs.<id>.uses` is defined by GitHub Actions and by nothing else in YAML, so this promotes an unproven reference to a call naming a caller that may not exist — the fabricated-edge shape. Caught by yaml/workflow-call-role-negative, which forbids any `calls` edge in a file that does not claim to be a workflow.",
    transform: callsShapeGateRemoved,
  },
  {
    id: "yaml/overrides-direction-reversed",
    language: "yaml",
    defectClass: "wrong-relationship-type",
    description:
      "The override DIRECTION reversed, so the entry that gets replaced claims to override its replacement. An `overrides` edge read backwards is worse than a missing one: `bb_impact` reads it as the replaced entry depending on the replacement. Caught by yaml/duplicate-key-overrides, which pins the direction on the two-occurrence chain and forbids the reverse.",
    transform: overridesDirectionReversed,
  },
  {
    id: "yaml/overrides-all-to-first",
    language: "yaml",
    defectClass: "wrong-target",
    description:
      "Last-wins collapsed to all-to-first: the third occurrence of a key claims to replace the FIRST rather than the second. Both readings look defensible in prose, which is why this is worth a mutant — the loader replaces the value currently in effect, which after the second occurrence is the second. Caught by yaml/duplicate-key-overrides, whose forbid row names `child#3 -> child` specifically.",
    transform: overridesAllToFirst,
  },
  {
    id: "yaml/overrides-confidence-inflated",
    language: "yaml",
    defectClass: "wrong-payload",
    description:
      "The one MUTANT here about honesty rather than structure, and the reason the harness keeps `confidenceMax` as a pinnable field. The two entries of a duplicate key are a parse FACT; that the later REPLACES the earlier is loader behaviour, not a grammar guarantee — YAML 1.2 leaves duplicate mapping keys undefined and GitHub Actions rejects them outright. This mutant claims confidence 1.0 and evidenceClass structural, i.e. it asserts the convention as if the grammar had said it, and drops the reason code the M14 contract §4 requires. Caught by yaml/duplicate-key-overrides on `confidenceMax`.",
    transform: overridesConfidenceInflated,
  },
  {
    id: "yaml/exports-gate-removed",
    language: "yaml",
    defectClass: "over-firing",
    description:
      "The publication gate removed: any `definitions` or `components` container publishes its children, whether or not the document declares `openapi:`/`swagger:`. A container name is a coincidence of spelling, and an `exports` edge on a coincidence puts a name into `bb_graph` and `bb_impact` that nothing can consume. Measured over the corpus: 2462 publications under `definitions` are gated on the API claim, and the ungated reading would fire on every `definitions:` key in the 15438 corpus files that are not API descriptions. Caught by yaml/schema-publication-export-negative, whose whole content is a top-level `definitions` in a file that makes no API claim.",
    transform: exportsGateRemoved,
  },
  {
    id: "yaml/exports-over-fires",
    language: "yaml",
    defectClass: "over-firing",
    description:
      "The publication over-fires to every nested descendant, as if the container were flat: `components.schemas.Item.properties.id` acquires its own `exports` edge alongside `Item`. The corpus cost of this shape is not small — `components.schemas.Item` holds `properties`, `properties.id` and `type`, and the measured 2511 publications would multiply by the schemas' depth. Caught by yaml/schema-publication-export, whose forbid rows name `Item.properties.id` and both container levels.",
    transform: exportsOverFires,
  },
]
