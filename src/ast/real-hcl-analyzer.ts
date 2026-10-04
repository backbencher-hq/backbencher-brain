import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"

/**
 * REAL HCL / TERRAFORM ANALYZER — pure Tree-sitter AST extraction.
 *
 * The vendored `tree-sitter-hcl` grammar (verified byte-exact against
 * `tree-sitter-grammars/tree-sitter-hcl@64ad6278`: 64 named node types, 2
 * fields `key`/`val`) emits a `config_file` → `body` tree:
 *   - `block`        = `identifier` (block type) + zero or more `string_lit`
 *                      labels + a nested `body` (siblings `block_start` /
 *                      `block_end` carry the braces).
 *   - `attribute`    = `identifier` (key) + `expression`.
 *   - expressions    = `variable_expr` (identifier base) with sibling `get_attr`
 *                      accessors, `function_call`, `collection_value`
 *                      (`object`/`tuple`), `template_expr` (`quoted_template` /
 *                      `heredoc_template` with `template_interpolation`),
 *                      `for_expr`, `conditional`, and `operation` →
 *                      `binary_operation` / `unary_operation`.
 *
 * Extraction contract:
 *   - A root `module` symbol named from the file, so the containment graph has a
 *     trunk (matching the JSON/YAML/SQL/XML convention) and every non-root
 *     symbol has an `ownerName`.
 *   - Symbols: every `block` (kind mapped from block type) and every `attribute`
 *     (`property`) with a stable leaf `name`, a dot-qualified `scope`, and the
 *     enclosing block as `ownerName`/`ownerKind`. Sibling blocks that share a
 *     leaf name (Terraform repeats `locals`/`moved`/`removed`/`provider` by
 *     design, and the HashiCorp DSLs repeat label-less blocks such as waypoint's
 *     `parameter`) are disambiguated by an ordinal suffix so identity stays
 *     unique; the unsuffixed address is kept in metadata.
 *   - Relationships:
 *       * `contains`   parent → child block / attribute (qualified).
 *       * `references` enclosing block → dotted reference path (var.x, local.x,
 *                      module.x, data.TYPE.NAME, RESOURCE_TYPE.NAME.attr, ...).
 *       * `uses`       enclosing block → a language builtin (count.index,
 *                      each.key, self.x, path.module, terraform.workspace).
 *       * `overrides`  an `override_resource` / `override_data` /
 *                      `override_module` block → the declaration its `target`
 *                      names. This RETYPES the reference the target used to
 *                      publish rather than adding to it: Terraform replaces the
 *                      values it points at, it does not read them.
 *       * `calls`      enclosing block → a `function` block the same file
 *                      declares. A global callee (`merge`, `length`,
 *                      `provider::test::is_true`) declares nothing, so it
 *                      produces no edge and therefore no dangling call advice.
 *       * `exports`    document root → each top-level block.
 *       * `imports`    a `module` block → its `source`.
 *       * every relationship carries `line`: the 1-based line of the node the
 *         TARGET NAME is written on (M59.A7 — the site, not the declaration
 *         start), so navigation lands on the reference, not the block header.
 *   - References are read from Tree-sitter nodes/fields only. Object keys
 *     (`object_elem`'s `key` FIELD), `for`-loop variables (`for_intro`),
 *     `dynamic`-block iterators (`iterator` = the `for` locals of the content
 *     block) and bare single-identifier paths (type-constraint keywords such as
 *     `type = string`) are excluded. No source-text regex is used.
 *
 * Reference paths are recognised as a run of `variable_expr` + `get_attr`
 * siblings under ANY parent, not only under a node literally named
 * `expression` — the grammar wraps arithmetic and comparison operands in
 * `operation` → `binary_operation`, whose children are the same sibling run.
 *
 * Complexity: one iterative DFS over the tree (O(nodes)) plus a recursive
 * expression walk that visits each expression node once (O(expression nodes));
 * relationship deduplication is O(1) via a Set key. Syntax errors are owned by
 * ASTEngine (tree-sitter ERROR/MISSING nodes) and are NOT re-emitted here; the
 * walk descends through them so nested blocks are still reached.
 */

/** Block types whose first two labels form the leaf name (`<type>.<name>`). */
const TYPE_NAME_BLOCKS = new Set(["resource", "data"])
/** Block types with exactly one label that IS the leaf name. */
const SINGLE_LABEL_BLOCKS = new Set(["variable", "output", "module", "provider"])
/** Block types that map to a non-`Class` symbol kind. */
const TOP_LEVEL_KINDS: Record<string, ASTEngine.SymbolKind> = {
  resource: ASTEngine.SymbolKind.Class,
  data: ASTEngine.SymbolKind.Class,
  variable: ASTEngine.SymbolKind.Variable,
  output: ASTEngine.SymbolKind.Variable,
  module: ASTEngine.SymbolKind.Module,
  provider: ASTEngine.SymbolKind.Module,
  terraform: ASTEngine.SymbolKind.Module,
  locals: ASTEngine.SymbolKind.Module,
}
/** Every top-level Terraform block type, for `hclBlockKind` and framework detection. */
const TERRAFORM_TOP_LEVEL = new Set(Object.keys(TOP_LEVEL_KINDS))
/** The framework name the three-key contract publishes, in one place so
 *  `detectedFrameworks` and `frameworkPatterns[i].framework` cannot disagree. */
const TERRAFRAMEWORK_NAME = "Terraform"

/**
 * HCL's language-level builtins — the reference roots that resolve to NOTHING in
 * the index, because no file can declare them. `count.index` exists wherever a
 * `count` argument does; `path.module` is the module directory; `each.key` and
 * `each.value` are the `for_each` key and value. Measured over the corpus at
 * 2,029 edges (4.6 % of all references), led by `path.module` (506),
 * `each.key` (325), `each.value` (285) and `count.index` (214).
 *
 * They are published as `uses`, not `references`, following the house precedent
 * at `real-sql-analyzer.ts:1569` — a target in a GLOBAL namespace is `uses`, a
 * project symbol is `references`. Labelling these `references` asserted a
 * declaration that does not exist, which is precisely the unexplained edge the
 * lane's own rules forbid. Every other root (`var`, `local`, `module`, `data`,
 * and the `<resource_type>.<name>` family) IS a project address and stays
 * `references`.
 */
const BUILTIN_ROOTS = new Set(["count", "each", "self", "path", "terraform"])

/**
 * Block types that DECLARE a callable the same file can then call.
 *
 * The HCL grammar itself has no function declaration — the container grammar
 * treats a function as a block, and the ecosystem layers the declaration on top
 * of that. `function "name" { … }` is docker-bake's spelling; Terraform 1.8+
 * spells the same construct `func "name" { … }`. Both parse as an ordinary
 * one-label block, which is why a block-driven walker reaches them without any
 * grammar support at all.
 *
 * MEASURED, not assumed: over 9,329 corpus files / 2,035,319 nodes there is
 * exactly ONE declaration of this shape — `function "bindir"` in
 * `docker/docker-bake.hcl:56` — and 4 call sites for it (lines 101, 106, 137,
 * 151). `func` occurs 0 times, so it is NOT read here; see the doc's declared
 * limitations for the probe that would change that.
 *
 * A callee only becomes a `calls` edge when a declaration in the SAME FILE
 * matches it, so `merge(…)` / `length(…)` / `provider::test::is_true(…)` —
 * 12,968 unqualified and 20 namespaced `function_call` nodes in this corpus,
 * every one of them a global — still produce no edge. That is the whole reason
 * this list has one entry and not two.
 */
const FUNCTION_DECL_BLOCKS = new Set(["function"])

/**
 * Terraform's dedicated override blocks, and what each one overrides.
 *
 * `override_resource` / `override_data` / `override_module` each carry a
 * `target` attribute naming the declaration whose values the block REPLACES.
 * That is an override in the only sense Terraform has one, and the spelling is
 * the language's own — this is not a heuristic keyed on a word.
 *
 * MEASURED: 71 such blocks across 33 corpus files (`override_resource` 38,
 * `override_module` 17, `override_data` 16), 68 of them carrying a `target`
 * (50 two-segment, 15 three-segment, 3 four-segment), and 51 of those 68
 * binding to a block-declared name under the indexer's own resolution
 * strategies. Before this the analyzer read the `target` as an ordinary
 * `references` read, which is the neighbouring label: Terraform does not READ
 * the declaration it overrides, it replaces its values. The reference edge is
 * therefore RETYPED, not duplicated — see the attribute branch.
 */
const OVERRIDE_BLOCK_KIND: Record<string, string> = {
  override_resource: "resource",
  override_data: "data",
  override_module: "module",
}

export class RealHclAnalyzer implements ASTEngine.LanguageAnalyzer {
  /** Per-analysis memo for `subtreeSize`, keyed by tree-sitter node id. */
  private sizeCache = new Map<number, number>()

  public analyze(rootNode: Node, content: string, filePath: string): ASTEngine.ParseResult {
    this.sizeCache.clear()
    const symbols: ASTEngine.UniversalSymbol[] = []
    const relationships: ASTEngine.UniversalRelationship[] = []
    const imports: ASTEngine.ImportInfo[] = []
    const exports: ASTEngine.ExportInfo[] = []
    const errors: ASTEngine.ParseError[] = []

    const relKeys = new Set<string>()
    const addRelationship = (
      source: string,
      target: string,
      type: ASTEngine.RelationshipType,
      lineNumber: number,
      metadata: Record<string, any> = {},
    ) => {
      const key = `${source}\u0000${type}\u0000${target}\u0000${lineNumber}`
      if (relKeys.has(key)) return
      relKeys.add(key)
      // Why this edge is the shape it is (the M14 honesty taxonomy, as C and C++
      // use it). HCL emits no heuristic edges at all: every fact below is read
      // off the tree, so `usage_contextual` and `inferred` do not apply here and
      // their absence is the honest record rather than an omission.
      if (!metadata.evidenceClass) {
        metadata.evidenceClass =
          type === ASTEngine.RelationshipType.Contains
            ? "structural"
            : type === ASTEngine.RelationshipType.Imports
              ? "import_based"
              : type === ASTEngine.RelationshipType.Uses
                ? "builtin_qualified"
                : type === ASTEngine.RelationshipType.References
                  ? "reference_qualified"
                  : "structural"
      }
      // `line_number` is the field the product reads: parallel-indexer.ts
      // (:2789, :4393) persists only `rel.line_number` and graph.ts (:526)
      // surfaces only `rel.line_number`. An edge carrying some other spelling
      // is stored as NULL and is invisible to navigation — which is exactly
      // what HCL's pre-fix 0-of-138,353 looked like from the product's side.
      relationships.push({ source, target, type, confidence: 1, line_number: lineNumber, metadata })
    }

    // Which Terraform top-level block kinds this document actually declares,
    // with their counts. This is the EVIDENCE for the framework contract below:
    // a `.hcl` file full of `terraform`/`resource`/`module` blocks is Terraform,
    // and a consul agent config or a packer template is HCL but not Terraform —
    // so the detection is made from the blocks present, never assumed from the
    // file extension.
    const terraformBlocks = new Map<string, number>()

    // The document root, so the containment graph has a trunk and every
    // non-root symbol has an owner (JSON/YAML/SQL/XML convention).
    const rootName = this.documentName(filePath)
    const rootRange = this.nodeToRange(rootNode)
    symbols.push({
      name: rootName,
      qualifiedName: rootName,
      kind: ASTEngine.SymbolKind.Module,
      range: rootRange,
      scope: "",
      visibility: "public",
      metadata: { hclRoot: true, hclLanguage: "hcl" },
    })
    exports.push({ name: rootName, kind: ASTEngine.SymbolKind.Module, range: rootRange, visibility: "public" })

    // Iterative DFS. Each frame carries the enclosing block path (leaf names)
    // and the enclosing block's kind so children get correct owners. `taken`
    // counts the leaf names already used by SIBLINGS at the current level, which
    // is what disambiguates legitimately repeated blocks. `iterators` carries
    // the `dynamic`-block loop locals in scope at this point in the tree.
    //
    // The top-level `taken` map is SEEDED with the root name: a file called
    // `moved.tf` holding a `moved {}` block, or `locals.tf` holding
    // `locals {}`, would otherwise give the document and the block one identity
    // (measured: 308 collisions over the 9,079-file corpus). The block's real
    // Terraform address is preserved in `hclAddress`.
    // Function declarations, `label -> declared name`, and the call sites that
    // have to be resolved against them. Both are collected DURING the one DFS
    // and joined at the end, rather than by a second tree walk: a call may
    // precede its declaration in the file (docker/docker-bake.hcl declares
    // `bindir` on line 56 and calls it on 101), and a pre-pass would double the
    // node visits the complexity envelope is written against. Unresolved call
    // sites are dropped, which is the pre-existing behaviour for a global.
    const functionDecls = new Map<string, string>()
    const pendingCalls: { callee: string; line: number; owner: string }[] = []

    const stack: {
      node: Node
      blockPath: string[]
      blockKind: ASTEngine.SymbolKind | undefined
      taken: Map<string, number>
      iterators: Set<string>
      shadowed: Map<string, number>
      overrideKind: string | null
    }[] = [
      {
        node: rootNode,
        blockPath: [],
        blockKind: undefined,
        taken: new Map([[rootName, 1]]),
        iterators: new Set(),
        shadowed: new Map(),
        overrideKind: null,
      },
    ]

    const pushChildren = (
      node: Node,
      blockPath: string[],
      blockKind: ASTEngine.SymbolKind | undefined,
      taken: Map<string, number>,
      iterators: Set<string>,
      shadowed: Map<string, number>,
      overrideKind: string | null,
    ) => {
      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
        if (child) stack.push({ node: child, blockPath, blockKind, taken, iterators, shadowed, overrideKind })
      }
    }

    while (stack.length > 0) {
      const { node, blockPath, blockKind, taken, iterators, shadowed, overrideKind } = stack.pop()!
      const type = node.type

      if (type === "block") {
        // First identifier is the block type; every subsequent `string_lit` /
        // `identifier` child is a label (`block_start`/`body`/`block_end`/
        // `comment` are neither and are skipped by construction). Identify the
        // block-type child by index — web-tree-sitter returns distinct wrapper
        // objects, so a `===` identity test would fail.
        let blockTypeIndex = -1
        for (let i = 0; i < node.namedChildCount; i++) {
          if (node.namedChild(i)?.type === "identifier") {
            blockTypeIndex = i
            break
          }
        }
        const blockType = blockTypeIndex >= 0 ? node.namedChild(blockTypeIndex)!.text : ""
        const labels: string[] = []
        for (let i = 0; i < node.namedChildCount; i++) {
          if (i === blockTypeIndex) continue
          const child = node.namedChild(i)
          if (!child) continue
          if (child.type === "string_lit") labels.push(this.readStringLit(child))
          else if (child.type === "identifier") labels.push(child.text)
        }

        if (!blockType) {
          // Malformed block: no type identifier. Descend so nested valid
          // nodes are still reachable; syntax errors are reported by the engine.
          // The sibling scope is preserved: a typeless block is still a level.
          pushChildren(node, blockPath, blockKind, taken, iterators, shadowed, overrideKind)
          continue
        }

        // Stable leaf name using Terraform's native addressing, with a
        // blockType fallback so a label-less `data {}` never yields "".
        const address = this.blockAddress(blockType, labels)
        const name = this.disambiguate(address, taken)
        const kind = TOP_LEVEL_KINDS[blockType] ?? ASTEngine.SymbolKind.Class
        const qualified = [...blockPath, name].join(".")
        const ownerPath = blockPath.length > 0 ? blockPath.join(".") : rootName
        // `ownerName` is the parent's LEAF name and `scope` is the parent's
        // QUALIFIED path — two different facts, and collapsing them is a
        // contract break (the m12 contract probe pins `ownerName === "lifecycle"`
        // against `scope === "aws_instance.web.lifecycle"` on the same symbol).
        // At the top level the parent is the document, whose leaf name IS the
        // root name.
        const ownerLeaf = blockPath.length > 0 ? blockPath[blockPath.length - 1] : rootName

        if (TERRAFORM_TOP_LEVEL.has(blockType)) {
          terraformBlocks.set(blockType, (terraformBlocks.get(blockType) ?? 0) + 1)
        }

        // A function DECLARATION. Recorded by the name the call site will write,
        // and FIRST-wins: a second `function "x"` in one file is an error in every
        // dialect that has the construct, so the first declaration is the one a
        // call can mean. The flag rides on the symbol because a consumer reading
        // the graph has no other way to tell a callable from any other block.
        const isFunctionDecl = FUNCTION_DECL_BLOCKS.has(blockType)
        if (isFunctionDecl && labels.length > 0 && !functionDecls.has(labels[0])) {
          functionDecls.set(labels[0], name)
        }

        symbols.push({
          name,
          qualifiedName: qualified,
          kind,
          complexity: this.subtreeSize(node),
          range: this.nodeToRange(node),
          scope: ownerPath,
          visibility: "public",
          ownerName: ownerLeaf,
          ownerKind: blockPath.length > 0 ? blockKind : ASTEngine.SymbolKind.Module,
          metadata: {
            hclBlockType: blockType,
            hclLabels: labels,
            hclBlockKind: TERRAFORM_TOP_LEVEL.has(blockType) ? blockType : "nested",
            hclAddress: address,
            // Ordinal among the entities sharing this address in this scope,
            // where the document root occupies slot 0 when its name collides
            // with the block's own address (`moved.tf` holding `moved {}`).
            hclDuplicateIndex: name === address ? 0 : (taken.get(address) ?? 1) - 1,
            ...(isFunctionDecl ? { hclFunctionDecl: true } : {}),
          },
        })

        addRelationship(ownerPath, qualified, ASTEngine.RelationshipType.Contains, node.startPosition.row + 1, {
          hclSite: "block",
        })

        // Module blocks import an external module source. The source is
        // published TWICE on purpose: as an `ImportInfo` (which the indexer
        // persists as a dependency row) and as an `imports` RELATIONSHIP (which
        // the graph draws), the same pairing C uses for its include edges. The
        // line is the `source` ATTRIBUTE's line, not the block header's, so
        // navigation lands on the line the module path is written on.
        if (blockType === "module") {
          const source = this.findModuleSource(node)
          imports.push({
            module: labels[0] ?? address,
            path: source,
            range: this.nodeToRange(node),
          })
          if (source) {
            addRelationship(qualified, source, ASTEngine.RelationshipType.Imports, this.findModuleSourceLine(node) ?? node.startPosition.row + 1, {
              hclSite: "module-source",
            })
          }
        }

        // A `dynamic` block's loop local is in scope for the block's OWN subtree
        // — it is bound by that block's `for_each` and dies with it. It is named
        // by the `iterator` attribute, or — when that is absent — by the block's
        // OWN LABEL, which is Terraform's documented default.
        //
        // The SHADOW COUNT is what makes the scope correct. Binding the name for
        // the whole enclosing subtree instead leaks it sideways: a resource with
        // TWO dynamic blocks (`dynamic "assume_role" { … }` and, further down,
        // `dynamic "vpc" { … }`) suppressed `vpc.foo` because an unrelated
        // sibling had happened to bind a loop local called `vpc` — measured at
        // 247 lost references over the 9,079-file corpus, 165 of them
        // `assume_role.value` across tf-aws-components' provider files alone.
        // Counting how many enclosing `dynamic` blocks bind each name means a
        // name is only suppressed while at least one such block is still open,
        // so a sibling's binding cannot silence its own subtree's sibling.
        let childIterators = iterators
        let childShadowed = shadowed
        if (blockType === "dynamic") {
          const found = new Set<string>()
          this.findDynamicIterators(node, labels, found)
          if (found.size > 0) {
            childIterators = new Set(iterators)
            childShadowed = new Map(shadowed)
            for (const it of found) {
              childIterators.add(it)
              childShadowed.set(it, (childShadowed.get(it) ?? 0) + 1)
            }
          }
        }

        pushChildren(node, [...blockPath, name], kind, new Map(), childIterators, childShadowed, OVERRIDE_BLOCK_KIND[blockType] ?? null)
        continue
      }

      if (type === "attribute") {
        const keyNode = this.findChild(node, (n) => n.type === "identifier")
        const key = keyNode?.text ?? ""
        if (key) {
          const ownerPath = blockPath.length > 0 ? blockPath.join(".") : rootName
          const ownerLeaf = blockPath.length > 0 ? blockPath[blockPath.length - 1] : rootName
          // A top-level attribute of a flat `.hcl`/`.tfvars` document can carry
          // the document's own name (`project = "hello"` inside `project.hcl`).
          // The document owns that name, so the attribute is disambiguated —
          // measured at 3 sites. A duplicate key INSIDE a block is deliberately
          // NOT disambiguated: Terraform rejects that outright, so the collision
          // is inherited from invalid input and is ruled, not papered over.
          const name = blockPath.length === 0 && key === rootName ? `${key}#2` : key
          const qualified = [...blockPath, name].join(".") || name
          const expr = this.findChild(node, (n) => n.type === "expression")
          const valueNode = expr ? expr.namedChild(0) : undefined

          symbols.push({
            name,
            qualifiedName: qualified,
            kind: ASTEngine.SymbolKind.Property,
            complexity: this.subtreeSize(node),
            range: this.nodeToRange(node),
            scope: ownerPath,
            visibility: "public",
            ownerName: ownerLeaf,
            ownerKind: blockPath.length > 0 ? blockKind : ASTEngine.SymbolKind.Module,
            metadata: { hclValueKind: this.readValueKind(expr), hclAddress: key },
          })

          addRelationship(ownerPath, qualified, ASTEngine.RelationshipType.Contains, keyNode!.startPosition.row + 1, {
            hclSite: "attribute",
          })

          if (expr) {
            const refs: { path: string; line: number }[] = []
            this.extractReferences(expr, iterators, shadowed, refs, pendingCalls, ownerPath)

            if (overrideKind !== null && key === "target") {
              // An override block's `target` is the declaration whose values this
              // block REPLACES, so the edge is `overrides` and the ordinary
              // `references` edge is SUPPRESSED rather than duplicated — the
              // retype costs the graph no edge, and publishing both would claim
              // Terraform reads what it in fact overwrites.
              //
              // `ownerPath` is the OVERRIDE BLOCK's own qualified path here (the
              // `target` attribute's owner), which is the precise actor: the
              // block that replaces the values, not whatever block happens to
              // enclose it. A `run "test" { override_resource { … } }` therefore
              // reads `run.test.override_resource -> aws_instance.first`.
              //
              // The line is the `target` KEY's line, matching every other
              // attribute-keyed edge, so navigation lands on the address.
              for (const ref of refs) {
                // A builtin cannot be overridden — `count.index` and friends are
                // not declarations. Measured: 0 sites; the guard is here so a
                // future corpus cannot turn this into a fabricated edge.
                if (BUILTIN_ROOTS.has(ref.path.split(".")[0])) continue
                addRelationship(ownerPath, ref.path, ASTEngine.RelationshipType.Overrides, keyNode!.startPosition.row + 1, {
                  hclSite: "override-target",
                  hclOverrideKind: overrideKind,
                  evidenceClass: "structural",
                })
              }
            } else {
              for (const ref of refs) {
                // A builtin root is a `uses` edge (global namespace, unresolvable);
                // anything else is a project address and is a `references` edge.
                const root = ref.path.split(".")[0]
                const builtin = BUILTIN_ROOTS.has(root)
                addRelationship(
                  ownerPath,
                  ref.path,
                  builtin ? ASTEngine.RelationshipType.Uses : ASTEngine.RelationshipType.References,
                  ref.line,
                  { hclSite: builtin ? "builtin-use" : "reference", ...(builtin ? { hclBuiltin: true } : {}) },
                )
              }
            }
          }
        }
        // Attributes are leaves: their expression subtree is handled above.
        continue
      }

      // config_file, body, and any other wrapper node are descended only, and
      // they PRESERVE the sibling scope: a wrapper introduces no new level, so
      // replacing the map here would drop the root-name reservation (and with
      // it the `moved.tf`-holding-`moved {}` disambiguation) at the top level.
      // Only entering a `block` starts a new level.
      pushChildren(node, blockPath, blockKind, taken, iterators, shadowed, overrideKind)
    }

    // `calls` — resolved here, after the DFS, because a call may precede its
    // declaration in the file. Only a callee a `function` block in THIS FILE
    // declares becomes an edge; every global callee (12,968 unqualified
    // `function_call` nodes in the measured corpus) is dropped, which is what
    // keeps the edge resolvable and the graph free of dangling call advice.
    for (const site of pendingCalls) {
      const declared = functionDecls.get(site.callee)
      if (!declared) continue
      addRelationship(site.owner, declared, ASTEngine.RelationshipType.Calls, site.line, {
        hclSite: "function-call",
        // The spelling AT the call site, kept because the target is the
        // declaration's index identity (`function.bindir`) rather than the bare
        // name the file writes.
        hclCallee: site.callee,
        evidenceClass: "structural",
      })
    }

    // The public interface of a module is its top-level blocks. Published as
    // `ExportInfo` (the declaration list the product reads) AND as `exports`
    // edges (the graph the product draws), so the public surface is navigable
    // and not merely listed. The `contains` edge from the same root is a
    // different fact and both are kept.
    for (const s of symbols) {
      if (s.metadata?.hclRoot === true) continue
      if (s.scope === rootName) {
        exports.push({ name: s.name, kind: s.kind, range: s.range, visibility: "public" })
        addRelationship(rootName, s.name, ASTEngine.RelationshipType.Exports, s.range.startLine, {
          hclSite: "export",
        })
      }
    }

    return {
      language: "hcl",
      symbols,
      relationships,
      imports,
      exports,
      errors,
      metadata: {
        complexity: symbols.length,
        linesOfCode: content.split("\n").length,
        patterns: [],
        framework: "HCL/Terraform",
        // The M60.R8 three-key family contract, and all three agree:
        // `framework` names the language's host ecosystem, `detectedFrameworks`
        // is ALWAYS an array (`[]` when nothing was detected) and
        // `frameworkPatterns` is aligned with it by `framework` name. Before this
        // the analyzer published only `framework`, which the gate records as
        // `missing-contract-key` and a consumer joining the two arrays by name
        // cannot do.
        //
        // The detection is structural, not an extension guess: HCL is the host
        // language of several distinct ecosystems, and the corpus proves they
        // need telling apart — consul's agent config and packer's
        // `.pkr.hcl` templates are HCL with no Terraform block in sight, while
        // `terraform@db4eef4` is Terraform throughout. `data`, `variable`,
        // `output`, `module`, `provider`, `terraform` and `locals` are the
        // Terraform top-level block set; a document declaring none of them is
        // published as HCL with an empty detection list rather than being
        // claimed as Terraform on the strength of its extension.
        detectedFrameworks: terraformBlocks.size > 0 ? [TERRAFRAMEWORK_NAME] : [],
        frameworkPatterns:
          terraformBlocks.size > 0
            ? [
                {
                  framework: TERRAFRAMEWORK_NAME,
                  patterns: [...terraformBlocks.entries()]
                    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
                    .map(([blockType, count]) => ({ blockType, count })),
                },
              ]
            : [],
        hasFrameworkIntelligence: true,
        hasTypeInference: false,
      },
    }
  }

  /**
   * Terraform's native address for a block, with a `blockType` fallback so a
   * label-less `data {}` / `resource "x" {}` never produces an empty name.
   */
  private blockAddress(blockType: string, labels: string[]): string {
    if (TYPE_NAME_BLOCKS.has(blockType)) {
      if (labels.length >= 2) return `${labels[0]}.${labels[1]}`
      if (labels.length === 1) return `${labels[0]}`
      return blockType
    }
    if (SINGLE_LABEL_BLOCKS.has(blockType)) {
      return labels[0] ?? blockType
    }
    // terraform, locals, and nested blocks (lifecycle, backend, dynamic,
    // content, connection, provisioner, ...) keep their block type as part of
    // the identity so nested labels are unambiguous.
    return labels.length > 0 ? `${blockType}.${labels.join(".")}` : blockType
  }

  /**
   * Make a leaf name unique among its siblings. Terraform repeats `locals`,
   * `moved`, `removed`, `import` and aliased `provider` blocks by design, and
   * the HashiCorp DSLs repeat label-less blocks (waypoint's `parameter`).
   * The first use keeps the bare address; later siblings get `#2`, `#3`, …
   */
  private disambiguate(address: string, taken: Map<string, number>): string {
    const seen = taken.get(address) ?? 0
    taken.set(address, seen + 1)
    if (seen === 0) return address
    let n = seen + 1
    let candidate = `${address}#${n}`
    while (taken.has(candidate)) {
      n += 1
      candidate = `${address}#${n}`
    }
    taken.set(candidate, 1)
    return candidate
  }

  /**
   * The grammar node type that actually describes the value — unwrapping the
   * `operation` container so a comparison is reported as `binary_operation`
   * rather than as a node type that names no value kind.
   */
  private readValueKind(expr: Node | null): string {
    if (!expr) return "missing_expression"
    const value = expr.namedChild(0)
    if (!value) return "empty_expression"
    if (value.type === "operation") {
      const inner = value.namedChild(0)
      return inner ? inner.type : "operation"
    }
    return value.type
  }

  /**
   * Walk an expression subtree and collect dotted reference paths with the line
   * each name is written on.
   *
   * A path is a maximal run of `variable_expr` (base identifier) followed by
   * `get_attr` accessors. The grammar places that run as a set of SIBLINGS under
   * whatever node owns the expression — `expression` for a plain value, but
   * `binary_operation` / `unary_operation` under an `operation` wrapper for
   * arithmetic and comparison, and `expression` again inside each
   * `template_interpolation`. So the run is read from ANY node's children, and
   * a parent that is itself part of a run is not re-read.
   *
   * `index` / `splat` / `attr_splat` / `full_splat` end the run without
   * contributing a segment: Terraform resolves `aws_instance.web[*].id` and
   * `var.list[0]` against the address accumulated so far, so publishing
   * `aws_instance.web` / `var.list` is the edge Terraform itself means.
   *
   * Real Terraform references are always qualified (`var.x`, `aws_instance.web.id`),
   * so a bare single-identifier path is a type-constraint keyword (`type = string`)
   * or a function name — not a reference — and is skipped. `loopVars` carries
   * `for`-intro identifiers and `dynamic` iterators so block-locals are never
   * mistaken for module/resource references.
   *
   * `callSites` collects every `function_call` CALLEE with the line it is
   * written on, and nothing decides here whether it becomes an edge: a callee is
   * only callable if a `function` block declares it, and that map is complete
   * only after the DFS finishes (a call may precede its declaration). So the
   * candidate is recorded and resolved by the caller.
   */
  private extractReferences(
    node: Node,
    loopVars: Set<string>,
    shadowed: Map<string, number>,
    out: { path: string; line: number }[],
    callSites: { callee: string; line: number; owner: string }[],
    owner: string,
  ): void {
    const type = node.type

    if (type === "function_call") {
      const callee = this.findChild(node, (n) => n.type === "identifier")
      if (callee) callSites.push({ callee: callee.text, line: callee.startPosition.row + 1, owner })
    }

    if (type === "for_expr" || type === "for_tuple_expr" || type === "for_object_expr") {
      const childLoopVars = new Set(loopVars)
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i)
        if (child?.type !== "for_intro") continue
        for (let j = 0; j < child.namedChildCount; j++) {
          const intro = child.namedChild(j)
          if (intro?.type === "identifier") childLoopVars.add(intro.text)
        }
      }
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i)
        if (child) this.extractReferences(child, childLoopVars, shadowed, out, callSites, owner)
      }
      return
    }

    if (type === "object_elem") {
      // The `key` FIELD is a data key, not a reference — read it through the
      // grammar's own field API, not by pairing a named-child index with
      // `fieldNameForChild` (which indexes over ALL children, anonymous
      // tokens included, so the two index spaces do not correspond).
      const val = node.childForFieldName?.("val")
      if (val) this.extractReferences(val, loopVars, shadowed, out, callSites, owner)
      return
    }

    // Read this node's children left to right as MAXIMAL CONSECUTIVE runs of
    // path tokens, and recurse only into the children that are not one.
    //
    // Two things force this shape, both found by the hcl fixtures:
    //  1. The run must be consecutive. `var.a + var.b` is
    //     `binary_operation → variable_expr, get_attr, +, variable_expr, get_attr`;
    //     reading only NAMED children walks over the `+` and welds the operands
    //     into `var.a.var.b`. So the scan is over ALL children.
    //  2. A node may hold SEVERAL runs. Recursing into the leftover
    //     `variable_expr`/`get_attr` of a second operand cannot work — a lone
    //     `variable_expr` has no sibling to pair with and forms no path — so the
    //     second operand has to be read here, in its parent's context.
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (!child) continue
      if (child.type !== "variable_expr" && child.type !== "get_attr") {
        if (child.isNamed) this.extractReferences(child, loopVars, shadowed, out, callSites, owner)
        continue
      }
      const parts: string[] = []
      const nameLines: number[] = []
      let j = i
      for (; j < node.childCount; j++) {
        const c = node.child(j)
        if (!c || (c.type !== "variable_expr" && c.type !== "get_attr")) break
        const id = this.findChild(c, (n) => n.type === "identifier")
        if (!id) break
        parts.push(id.text)
        nameLines.push(id.startPosition.row + 1)
      }
      if (parts.length >= 2 && !loopVars.has(parts[0])) {
        out.push({ path: parts.join("."), line: nameLines[0] })
      }
      i = j - 1
    }
  }

  /**
   * The loop local(s) a `dynamic` block binds: the `iterator` attribute's value
   * when present, otherwise the block's own first label — Terraform's documented
   * default, so `dynamic "egress" { content { x = egress.cidr } }` reads a
   * block-local, not a project symbol. Without the label fallback the emitter
   * published a false `egress.cidr` (caught by hcl/dynamic-iterator-scope).
   */
  private findDynamicIterators(blockNode: Node, labels: string[], out: Set<string>): void {
    const body = this.findChild(blockNode, (n) => n.type === "body")
    if (!body) return
    for (let i = 0; i < body.namedChildCount; i++) {
      const attr = body.namedChild(i)
      if (attr?.type !== "attribute") continue
      const key = this.findChild(attr, (n) => n.type === "identifier")
      if (key?.text !== "iterator") continue
      const expr = this.findChild(attr, (n) => n.type === "expression")
      const ve = expr?.namedChild(0)
      if (ve?.type !== "variable_expr") continue
      const id = this.findChild(ve, (n) => n.type === "identifier")
      if (id) {
        out.add(id.text)
        return
      }
    }
    if (labels.length > 0) out.add(labels[0])
  }

  /** Read a `string_lit` label/value without source-text regex (grammar field). */
  private readStringLit(node: Node): string {
    const literal = this.findChild(node, (n) => n.type === "template_literal")
    if (literal) return literal.text
    return node.text
  }

  /** Find a module block's `source` attribute value (unquoted via grammar field). */
  private findModuleSource(blockNode: Node): string | undefined {
    const body = this.findChild(blockNode, (n) => n.type === "body")
    if (!body) return undefined
    for (let i = 0; i < body.namedChildCount; i++) {
      const attr = body.namedChild(i)
      if (attr?.type !== "attribute") continue
      const key = this.findChild(attr, (n) => n.type === "identifier")
      if (key?.text !== "source") continue
      const expr = this.findChild(attr, (n) => n.type === "expression")
      if (!expr) return undefined
      // The value is `expression → literal_value → string_lit → template_literal`,
      // so search descendants rather than direct children.
      const literal = this.findDescendant(expr, (n) => n.type === "template_literal")
      if (literal) return literal.text
      return expr.text
    }
    return undefined
  }

  /** The line a module block's `source = …` key is written on. */
  private findModuleSourceLine(blockNode: Node): number | null {
    const body = this.findChild(blockNode, (n) => n.type === "body")
    if (!body) return null
    for (let i = 0; i < body.namedChildCount; i++) {
      const attr = body.namedChild(i)
      if (attr?.type !== "attribute") continue
      const key = this.findChild(attr, (n) => n.type === "identifier")
      if (key?.text !== "source") continue
      return key.startPosition.row + 1
    }
    return null
  }

  /** The document's root name, from the file stem (JSON/YAML convention). */
  private documentName(filePath: string): string {
    const slash = filePath.lastIndexOf("/")
    const base = slash >= 0 ? filePath.slice(slash + 1) : filePath
    const lower = base.toLowerCase()
    for (const suffix of [".tfvars", ".tofu", ".hcl", ".tf"]) {
      if (lower.endsWith(suffix)) {
        const stem = base.slice(0, base.length - suffix.length)
        return stem.length > 0 ? stem : base
      }
    }
    return base.length > 0 ? base : "hcl"
  }

  /**
   * Nodes in a symbol's own subtree. Memoised on node id so the whole analysis
   * stays O(nodes): the DFS already visits every node once, and a block's count
   * deliberately includes its nested blocks — that is what makes "the biggest
   * declaration in this file" a comparable number.
   */
  private subtreeSize(node: Node): number {
    const cached = this.sizeCache.get(node.id)
    if (cached !== undefined) return cached
    let total = 1
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child) total += this.subtreeSize(child)
    }
    this.sizeCache.set(node.id, total)
    return total
  }

  private nodeToRange(node: Node): ASTEngine.UniversalSymbol["range"] {
    return {
      startLine: node.startPosition.row + 1,
      startColumn: node.startPosition.column + 1,
      endLine: node.endPosition.row + 1,
      endColumn: node.endPosition.column + 1,
      startIndex: node.startIndex,
      endIndex: node.endIndex,
    }
  }

  private findChild(node: Node, predicate: (n: Node) => boolean): Node | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && predicate(child)) return child
    }
    return null
  }

  private findDescendant(node: Node, predicate: (n: Node) => boolean): Node | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (!child) continue
      if (predicate(child)) return child
      const found = this.findDescendant(child, predicate)
      if (found) return found
    }
    return null
  }
}
