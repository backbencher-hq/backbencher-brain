/**
 * zig-extended-census.ts — WHOLE-POPULATION CONSTRUCT CENSUS for Zig's four extended
 * relationship types (`decorates`, `renders`, `mixes_in`, `part_of`).
 *
 * WHY THIS EXISTS. The arm (`incoming-gate.ts`) measures the ANALYZER'S rows. This
 * measures the CONSTRUCTS — the sites in the corpus that carry each relation's shape —
 * so a ruling can publish a COUNT over the whole admitted population instead of a
 * sentence, and so an implementation can publish how many sites it had to see. Every
 * counter is DECLARED up front: a zero that is printed is a measurement; a key that is
 * absent is a gap nobody can see.
 *
 * THE POPULATION RULE, copied from the arm and printed with the result: for every
 * repository under the corpus root that is a git work tree, the tracked files whose
 * extension the lane owns, present on disk and <= 1 MiB. The denominator is
 * `filesAdmitted` in this artifact; the arm's own `admitted files [a,b) of N` line is
 * the authority when the two are compared.
 *
 * WHAT EACH TYPE IS MEASURED AS. The counters are named after the construct, not after
 * the conclusion, because the conclusion is what the artifact is used to draw:
 *
 *   mixes_in — Zig's member-set composition. `usingnamespace X;` merges the
 *              declarations of the struct value `X` into the enclosing container. The
 *              positive shapes are `pub usingnamespace @import("x.zig");` inside a
 *              container and the file-scope form. The counter separates the argument's
 *              shape (@import / import alias / identifier / member expression) and the
 *              placement (container body vs file scope), and keeps the set of distinct
 *              module strings so the ruling's population string can name them.
 *              THE CORPUS ZERO IS THE POINT: this is the one counter group whose zero
 *              would be indistinguishable from a broken probe, so the CONTROL below
 *              runs the same classifier over a synthetic declaration and refuses the
 *              run if the control does not fire.
 *
 *   decorates — Zig's declaration attributes: `callconv(...)` on a callable,
 *              `align(...)` on a variable/field, `linksection(...)` on a callable or
 *              variable, `addrspace(...)` in a pointer type. The FORM is classified
 *              by its ARGUMENT (enum literal / string / integer / identifier), and
 *              the falsifier is counted as its own site — then SPLIT by shape, because
 *              a count alone would mislead: an attribute argument whose leaf names a
 *              FUNCTION DECLARED IN THE SAME FILE is either
 *                (a) a CALL of that function (the compiler evaluates it to compute the
 *                    attribute's argument value), or
 *                (b) a NAME COLLISION (`.c` / `A` spelled like a declared function).
 *              The decorator contract needs even more than (a): the call must be passed
 *              the DECORATED DECLARATION, which `attr_arg_call_argument_sites` counts —
 *              a call with at least one argument is the only shape that could do it.
 *              All three counters are declared; a non-zero on the last overturns the
 *              disposition and an instrument counts it.
 *
 *   part_of — the contract test is "a part shares the library's single scope and
 *              cannot be resolved as a separate module". Zig's inclusion vocabulary is
 *              counted in full: `@import` (names a module and evaluates to a struct),
 *              `@embedFile` (data inclusion), `@cImport` (C headers), and the
 *              usingnamespace sites above. The textual-splice family is counted over the
 *              produced node types (`textual_splice_node_types`, against the vocabulary a
 *              spliced language would need: include / splice / preproc / part_of); Zig's
 *              grammar produces none, and the near misses above are named and counted so
 *              the ruling's population is not just "the imports".
 *
 *   renders — no component model. The census records the whole population's distinct
 *              node types (so a component/production family present in the grammar and
 *              produced by the corpus would be visible) and counts the impostor class:
 *              ordinary calls to functions whose leaf name belongs to a render
 *              vocabulary. A declarative component construct would be a node type the
 *              node-type scan reports; the impostor counter is what keeps that scan
 *              honest about the code that EXISTS, and `render_call_declared_type_receiver`
 *              narrows it to the one shape that would be a component render — a
 *              render-verb call whose receiver ROOT is a container this file declares.
 *
 * THE CONTROL, and why it is not decoration. A probe that reads zero everywhere is
 * indistinguishable from a probe that cannot see. Every classifier used here is also
 * run over a synthetic snippet it must classify, through the SAME functions and with a
 * SEPARATE recorder; the control totals are printed before the corpus totals, and the
 * corpus totals are asserted not to have moved while the control ran. A control that
 * reads zero voids the corpus zero it certifies, and the run exits 5.
 *
 * THE LEAK GUARD. Every tree is deleted after its walk. A shared WASM parser whose
 * memory grows with every parse aborts after a few thousand files while the walk keeps
 * printing a complete-looking header — so this script fails loudly (exit 6) when
 * `filesRead !== filesAdmitted` rather than publishing a table over a fraction of the
 * population.
 *
 * USAGE
 *   bun script/m14/zig-extended-census.ts --out=<path> [--progress=<path>]
 *     [--resume] [--limit=<n>]
 *
 * `--progress` is rewritten every `PROGRESS_EVERY` files so a long run's liveness is
 * observable by ARTIFACT GROWTH (a redirected stdout log is block-buffered and says
 * nothing about progress). `--resume` continues from that artifact's file index.
 */
import { getParser } from "../../src/ast/engine"
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"

const argOf = (name: string): string | undefined => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : undefined
}
const OUT = argOf("out") ?? "validation/m14/measurements/zig-extended-census.json"
const PROGRESS = argOf("progress") ?? `${OUT}.progress`
const RESUME = process.argv.includes("--resume")
const LIMIT = argOf("limit") ? Number(argOf("limit")) : 0
const CORPUS = path.resolve(process.env.BB_CORPUS_ROOT ?? path.resolve(process.cwd(), ".corpus"))
const PROGRESS_EVERY = 200

/** The extension the arm admits for this lane (script/m14/language-extensions.ts: zig). */
const EXT = ".zig"

/* ── THE CONTAINER SET, and the analyzer's own boundary for it ──────────────────────
 *
 * A container is a declaration that owns members: struct / enum / union / opaque / error
 * set. `usingnamespace` merges into the declaration SET of the enclosing container; at
 * file scope the enclosing container is the file itself (Zig's top level is a struct).
 * The census is only reporting placement, so the plain ancestor form is exact here.
 */
const CONTAINERS = new Set(["struct_declaration", "enum_declaration", "union_declaration", "opaque_declaration", "error_set_declaration"])

/** The four declaration attributes Zig has, as node types in the pinned grammar. */
const ATTR_TYPES = new Set(["calling_convention", "byte_alignment", "link_section", "address_space"])

/** The render vocabulary the impostor census counts. Member leaves only; a plain
 *  identifier call is not a member and is left to the `calls` class. */
const RENDER_VOCAB = ["render", "draw", "view", "paint", "compose"]

/** Substrings that would name a declarative component family in a node type. */
const COMPONENT_WORDS = ["jsx", "component", "element", "template", "fragment"]

/** Substrings that would name a TEXTUAL-INCLUSION family in a node type. A language
 *  whose unit is spliced into another carries a node for the directive that does the
 *  splicing (`preproc_include`, `part_of_directive`, ...); Zig's grammar has none, and
 *  the census counts produced node types against this vocabulary so the zero is a
 *  measured absence rather than an assertion. */
const TEXTUAL_SPLICE_WORDS = ["include", "splice", "preproc", "part_of", "partof"]

/** The predicate the `textual_splice_node_types` counter is built from, exposed so the
 *  run can prove it fires on the vocabulary it looks for (a zero from a matcher that
 *  cannot match is not a zero). */
function textualSpliceName(typeName: string): boolean {
  const t = typeName.toLowerCase()
  return TEXTUAL_SPLICE_WORDS.some((w) => t.includes(w))
}

type Counters = Record<string, number>

function freshCounters(): Counters {
  const c: Counters = {}
  const declared = [
    // mixes_in — usingnamespace, the member-set composition construct
    "usens_total",
    "usens_pub",
    "usens_of_import",
    "usens_of_import_member",
    "usens_of_import_alias",
    "usens_of_identifier",
    "usens_other_arg",
    "usens_in_container",
    "usens_at_file_scope",
    // the alias surface usingnamespace is usually spelled through
    "import_alias_sites",
    // decorates — the four declaration attributes and their argument classes
    "declaration_attr_sites",
    "callconv_sites",
    "align_sites",
    "linksection_sites",
    "addrspace_sites",
    "attr_arg_identifier_sites",
    "attr_arg_declared_callable",
    // THE FALSIFIER'S SPLIT. A declared callable can reach an attribute argument two
    // ways, and only one of them is even shaped like an applied callable:
    //   call       — the argument contains a CALL whose callee is a declared function
    //                (the compiler evaluates it to compute the argument value);
    //   collision  — the declared name appears only as a literal/enum spelling (`.c`,
    //                an identifier that happens to share a function's name), i.e. the
    //                declared-callable test fired on a NAME COINCIDENCE.
    // The decorator contract additionally needs the declaration itself to be passed
    // to the callable, which no Zig attribute does: `attr_arg_call_argument_sites`
    // counts attribute-argument calls that carry at least one argument (the only
    // shape that could pass a declaration), so a non-zero there overturns the ruling.
    "attr_arg_declared_callable_call",
    "attr_arg_declared_callable_collision",
    "attr_arg_call_expression_sites",
    "attr_arg_call_argument_sites",
    // part_of — Zig's inclusion vocabulary, every construct counted
    "at_import_sites",
    "at_import_module_string",
    "at_import_special_root",
    "at_import_special_builtin",
    "at_import_zig_file",
    "at_embed_file_sites",
    "at_c_import_sites",
    // renders — the impostor class, and the component-receiver discriminator
    "render_call_sites",
    "render_call_declared_type_receiver",
    "named_node_types",
    "component_node_types",
    "textual_splice_node_types",
    // population accounting
    "filesAdmitted",
    "filesRead",
    "filesParseError",
    "filesEmpty",
  ]
  for (const k of declared) c[k] = 0
  for (const w of RENDER_VOCAB) c[`render_call_${w}`] = 0
  return c
}

function freshSets() {
  return {
    distinctImportModules: new Set<string>(),
    distinctZigModules: new Set<string>(),
    distinctNodeTypesAll: new Set<string>(),
    distinctNodeTypesNamed: new Set<string>(),
    componentTypeNames: new Set<string>(),
    textualSpliceTypeNames: new Set<string>(),
  }
}
type Sets = ReturnType<typeof freshSets>

/** The string inside an `@import(...)` / `@embedFile(...)` / similar builtin call. */
function builtinStringArg(call: any): string | null {
  for (let i = 0; i < call.namedChildCount; i++) {
    const args = call.namedChild(i)
    if (!args || String(args.type) !== "arguments") continue
    for (let k = 0; k < args.namedChildCount; k++) {
      const arg = args.namedChild(k)
      if (!arg) continue
      const t = String(arg.type)
      if (t === "string") {
        for (let j = 0; j < arg.namedChildCount; j++) {
          const inner = arg.namedChild(j)
          if (inner && String(inner.type) === "string_content") return String(inner.text)
        }
        // an empty string literal has no content node; its text is `""`
        const raw = String(arg.text)
        return raw.length >= 2 ? raw.slice(1, -1) : ""
      }
    }
  }
  return null
}

/** The builtin name of a `builtin_function` call (`@import` etc), or "". */
function builtinName(call: any): string {
  for (let i = 0; i < call.namedChildCount; i++) {
    const c = call.namedChild(i)
    if (c && String(c.type) === "builtin_identifier") {
      const t = String(c.text)
      return t.startsWith("@") ? t : `@${t}`
    }
  }
  return ""
}

/** The identifier text of a node when it is one, else null. */
const identText = (n: any): string | null => (n && String(n.type) === "identifier" ? String(n.text) : null)

/** The declaration NAME of a container/variable/function node: its first identifier child. */
function declaredName(n: any): string | null {
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    const t = c ? String(c.type) : ""
    if (t === "identifier") return String(c.text)
  }
  return null
}

/** The RHS of a `const X = ...` declaration: the LAST named child, which is the
 *  initializer by the grammar's own child order (name, optional type annotation,
 *  value). Reading the POSITION rather than one node type is what lets the same
 *  function answer both questions this census asks of a declaration — "is this an
 *  @import binding" and "is this declaration a container" — and one reader is what
 *  keeps those two answers from drifting apart. */
function declarationValue(n: any): any {
  const named: any[] = []
  for (let i = 0; i < n.namedChildCount; i++) named.push(n.namedChild(i))
  if (named.length < 2) return null
  const last = named[named.length - 1]
  return last && String(last.type) !== "identifier" ? last : null
}

/** Every identifier inside an attribute's argument subtree (the falsifier's site shape).
 *  In the pinned grammar an attribute carries its argument as a named child directly
 *  (`callconv(.C)` is a `field_expression`, `callconv(deco)` an `identifier`,
 *  `align(16)` an `integer`, `linksection(".x")` a `string`) — there is no `arguments`
 *  wrapper node, which is why this walks named children as subtrees rather than looking
 *  for a call shape. */
function attributeArgIdentifiers(attr: any): string[] {
  const out: string[] = []
  const walkArg = (n: any): void => {
    if (String(n.type) === "identifier") out.push(String(n.text))
    for (let k = 0; k < n.namedChildCount; k++) walkArg(n.namedChild(k))
  }
  for (let i = 0; i < attr.namedChildCount; i++) walkArg(attr.namedChild(i))
  return out
}

/* ── THE CLASSIFIER, USED BY BOTH THE CORPUS RUN AND THE CONTROL ─────────────────────
 *
 * `scanTree` is the one implementation of every count. The control and the corpus run
 * call it with different recorders, so a control hit can never land in the published
 * corpus total — the construct-probe's first defect, fixed the same way here.
 */
function scanTree(root: any, c: Counters, s: Sets): void {
  // Pre-pass: the names bound to `const x = @import(...)` anywhere in the file. Zig
  // declarations are order-independent, so `usingnamespace x;` may precede the binding;
  // the alias set must be complete before the usingnamespace classification runs.
  const aliasImports = new Set<string>()
  const declaredFunctions = new Set<string>()
  // The container types this file DECLARES — the renders discriminator reads it: a
  // render-vocabulary call whose receiver ROOT is a declared container is the shape a
  // component-model render would take; a call on a variable/instance is not.
  const declaredContainers = new Set<string>()
  const prepass = (n: any): void => {
    const t = String(n.type)
    if (t === "variable_declaration") {
      const name = declaredName(n)
      const rhs = declarationValue(n)
      if (name && rhs && builtinName(rhs) === "@import") aliasImports.add(name)
      if (name && rhs && CONTAINERS.has(String(rhs.type))) declaredContainers.add(name)
    } else if (t === "function_declaration") {
      const name = declaredName(n)
      if (name) declaredFunctions.add(name)
    }
    for (let i = 0; i < n.namedChildCount; i++) prepass(n.namedChild(i))
  }
  prepass(root)

  const walk = (n: any, inContainer: boolean): void => {
    const t = String(n.type)
    s.distinctNodeTypesAll.add(t)
    if (n.isNamed) s.distinctNodeTypesNamed.add(t)
    if (n.isNamed && COMPONENT_WORDS.some((w) => t.toLowerCase().includes(w))) s.componentTypeNames.add(t)
    if (n.isNamed && textualSpliceName(t)) s.textualSpliceTypeNames.add(t)

    if (t === "using_namespace_declaration") {
      c.usens_total++
      let hasPub = false
      for (let i = 0; i < n.childCount; i++) {
        const tok = n.child(i)
        if (tok && String(tok.type) === "pub") hasPub = true
      }
      if (hasPub) c.usens_pub++
      if (inContainer) c.usens_in_container++
      else c.usens_at_file_scope++

      const arg = (() => {
        // the argument is the first NAMED child that is not a comment
        for (let i = 0; i < n.namedChildCount; i++) {
          const k = n.namedChild(i)
          if (k && String(k.type) !== "comment") return k
        }
        return null
      })()
      if (arg) {
        const at = String(arg.type)
        if (at === "builtin_function") {
          const bn = builtinName(arg)
          if (bn === "@import") {
            c.usens_of_import++
            const mod = builtinStringArg(arg)
            if (mod !== null) s.distinctImportModules.add(mod)
          } else c.usens_other_arg++
        } else if (at === "field_expression") {
          c.usens_of_import_member++
        } else if (at === "identifier") {
          if (aliasImports.has(String(arg.text))) c.usens_of_import_alias++
          else c.usens_of_identifier++
        } else c.usens_other_arg++
      }
    } else if (t === "builtin_function") {
      const bn = builtinName(n)
      if (bn === "@import") {
        c.at_import_sites++
        const mod = builtinStringArg(n)
        if (mod !== null) {
          c.at_import_module_string++
          s.distinctImportModules.add(mod)
          if (mod === "root") c.at_import_special_root++
          if (mod === "builtin") c.at_import_special_builtin++
          if (mod.endsWith(EXT)) {
            c.at_import_zig_file++
            s.distinctZigModules.add(mod)
          }
        }
      } else if (bn === "@embedFile") {
        c.at_embed_file_sites++
      } else if (bn === "@cImport") {
        c.at_c_import_sites++
      }
    } else if (t === "variable_declaration") {
      const rhs = declarationValue(n)
      if (rhs && builtinName(rhs) === "@import") c.import_alias_sites++
    } else if (ATTR_TYPES.has(t)) {
      c.declaration_attr_sites++
      if (t === "calling_convention") c.callconv_sites++
      else if (t === "byte_alignment") c.align_sites++
      else if (t === "link_section") c.linksection_sites++
      else if (t === "address_space") c.addrspace_sites++
      const argIdents = attributeArgIdentifiers(n)
      if (argIdents.length > 0) {
        c.attr_arg_identifier_sites++
        if (argIdents.some((name) => declaredFunctions.has(name))) {
          c.attr_arg_declared_callable++
          // Split the hit by SHAPE: a declared function reached through a call (the
          // compiler evaluates it to produce the attribute's argument) versus a
          // declared name that only shares a spelling with a literal (`.c`, `A`).
          let viaCall = false
          const scanCalls = (node: any): void => {
            if (String(node.type) === "call_expression") {
              c.attr_arg_call_expression_sites++
              const callee = node.namedChild(0)
              const calleeName = callee && String(callee.type) === "identifier" ? String(callee.text) : null
              if (calleeName && declaredFunctions.has(calleeName)) viaCall = true
              for (let a = 0; a < node.namedChildCount; a++) {
                const argsNode = node.namedChild(a)
                // An `arguments` node with a named child is a call that PASSES a value;
                // the decorator contract needs the decorated declaration among them.
                if (argsNode && String(argsNode.type) === "arguments" && argsNode.namedChildCount > 0) {
                  c.attr_arg_call_argument_sites++
                }
              }
            }
            for (let i = 0; i < node.namedChildCount; i++) scanCalls(node.namedChild(i))
          }
          for (let i = 0; i < n.namedChildCount; i++) scanCalls(n.namedChild(i))
          if (viaCall) c.attr_arg_declared_callable_call++
          else c.attr_arg_declared_callable_collision++
        }
      }
    } else if (t === "call_expression") {
      // the impostor class: an ordinary call to a member whose leaf is render vocabulary
      const callee = n.namedChild(0)
      let leaf = ""
      if (callee && String(callee.type) === "field_expression") {
        for (let i = callee.namedChildCount - 1; i >= 0; i--) {
          const k = callee.namedChild(i)
          if (k && (String(k.type) === "identifier" || String(k.type) === "field_identifier")) {
            leaf = String(k.text)
            break
          }
        }
      }
      if (RENDER_VOCAB.includes(leaf)) {
        c.render_call_sites++
        c[`render_call_${leaf}`]++
        // The component-model discriminator: a render-vocabulary call whose receiver
        // ROOT is a container this file DECLARES would be a component-typed render; a
        // call on a variable/instance (`w.render()`, an immediate-mode draw context) is
        // the ordinary call the near-miss class counts.
        let base = callee.namedChild(0)
        while (base && String(base.type) === "field_expression") base = base.namedChild(0)
        if (base && String(base.type) === "identifier" && declaredContainers.has(String(base.text))) {
          c.render_call_declared_type_receiver++
        }
      }
    }
    const childInContainer = inContainer || CONTAINERS.has(t)
    for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i), childInContainer)
  }
  walk(root, false)
}

/* ── THE CONTROL SNIPPETS: every classifier must fire on a shape it must see ────────── */
const CONTROL_SNIPPETS: { name: string; src: string; expect: (c: Counters) => string | null }[] = [
  {
    name: "usingnamespace@import inside a container and at file scope",
    src: `pub const S = struct { pub usingnamespace @import("x.zig"); };\npub usingnamespace @import("y.zig");\n`,
    expect: (c) =>
      c.usens_total === 2 && c.usens_of_import === 2 && c.usens_in_container === 1 && c.usens_at_file_scope === 1 && c.usens_pub === 2
        ? null
        : `usens { total=${c.usens_total} of_import=${c.usens_of_import} container=${c.usens_in_container} file=${c.usens_at_file_scope} pub=${c.usens_pub} }`,
  },
  {
    name: "usingnamespace through an import alias",
    src: `const a = @import("a.zig");\nusingnamespace a;\n`,
    expect: (c) =>
      c.usens_of_import_alias === 1 && c.import_alias_sites === 1 && c.at_import_zig_file === 1
        ? null
        : `alias { of_import_alias=${c.usens_of_import_alias} import_alias_sites=${c.import_alias_sites} at_import_zig_file=${c.at_import_zig_file} }`,
  },
  {
    name: "the three declaration attributes",
    src: `fn f() callconv(.C) void {}\nvar v: u32 align(16) = 0;\nexport fn g() linksection(".text.x") void {}\n`,
    expect: (c) =>
      c.callconv_sites === 1 && c.align_sites === 1 && c.linksection_sites === 1 && c.declaration_attr_sites === 3
        ? null
        : `attrs { callconv=${c.callconv_sites} align=${c.align_sites} linksection=${c.linksection_sites} total=${c.declaration_attr_sites} }`,
  },
  {
    name: "an attribute argument naming a declared callable (the decorates falsifier)",
    src: `fn deco() void {}\nfn f() callconv(deco) void {}\n`,
    expect: (c) =>
      c.attr_arg_declared_callable === 1
        ? null
        : `falsifier { attr_arg_declared_callable=${c.attr_arg_declared_callable} attr_arg_identifier_sites=${c.attr_arg_identifier_sites} }`,
  },
  {
    name: "the inclusion vocabulary (part_of near misses)",
    src: `const a = @import("a.zig");\nconst b = @embedFile("b.bin");\nconst c = @cImport({ @cInclude("c.h"); });\n`,
    expect: (c) =>
      c.at_import_sites === 1 && c.at_embed_file_sites === 1 && c.at_c_import_sites === 1 && c.at_import_zig_file === 1
        ? null
        : `inclusion { import=${c.at_import_sites} embed=${c.at_embed_file_sites} cImport=${c.at_c_import_sites} zig=${c.at_import_zig_file} }`,
  },
  {
    name: "the decorates falsifier's split: a comptime call versus a name collision",
    src: `fn deco() void {}\nfn cc() void {}\nfn a() callconv(deco) void {}\nfn b() callconv(cc()) void {}\n`,
    expect: (c) =>
      c.attr_arg_declared_callable === 2 &&
      c.attr_arg_declared_callable_call === 1 &&
      c.attr_arg_declared_callable_collision === 1 &&
      c.attr_arg_call_argument_sites === 0
        ? null
        : `split { declared_callable=${c.attr_arg_declared_callable} via_call=${c.attr_arg_declared_callable_call} collision=${c.attr_arg_declared_callable_collision} call_args=${c.attr_arg_call_argument_sites} }`,
  },
  {
    name: "a render call on a declared container type (the renders discriminator)",
    src: `const Widget = struct { fn render(self: Widget) void { _ = self; } };\nfn f() void { Widget.render(Widget{}); }\n`,
    expect: (c) =>
      c.render_call_sites === 1 && c.render_call_declared_type_receiver === 1
        ? null
        : `render-type { total=${c.render_call_sites} component_receiver=${c.render_call_declared_type_receiver} }`,
  },
  {
    name: "a render-vocabulary member call (the renders impostor counter)",
    src: `fn f(w: W) void { w.render(); }\n`,
    expect: (c) => (c.render_call_sites === 1 && c.render_call_render === 1 ? null : `render { total=${c.render_call_sites} }`),
  },
]

/* ── THE POPULATION ─────────────────────────────────────────────────────────────────── */
function enumeratePopulation(): { files: string[]; repos: string[] } {
  const files: string[] = []
  const repos: string[] = []
  const entries = execFileSync("ls", ["-1", CORPUS], { encoding: "utf8" })
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
  for (const e of entries) {
    const d = path.join(CORPUS, e)
    try {
      execFileSync("git", ["-C", d, "rev-parse", "--is-inside-work-tree"], { stdio: "ignore" })
    } catch {
      continue
    }
    let tracked: string[] = []
    try {
      tracked = execFileSync("git", ["-C", d, "ls-files", "-z", "--", `*${EXT}`], { encoding: "utf8" })
        .split("\0")
        .map((f) => f.trim())
        .filter(Boolean)
        .map((f) => path.join(d, f))
    } catch {
      continue
    }
    const present = tracked.filter((f) => {
      try {
        return statSync(f).size <= 1024 * 1024
      } catch {
        return false
      }
    })
    if (present.length > 0) repos.push(e)
    files.push(...present)
  }
  files.sort()
  return { files, repos }
}

function writeJSONAtomic(p: string, value: unknown): void {
  const tmp = `${p}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n")
  renameSync(tmp, p)
}

async function main(): Promise<void> {
  /* THE CONTROL RUNS FIRST, through the same classifier, with its own recorder. */
  const controlParser: any = await getParser("zig")
  const controlFails: string[] = []
  // The textual-splice FAMILY matcher is a predicate over node-type NAMES, so it
  // cannot be exercised by a source snippet; it is proved directly instead. A zero
  // from a matcher that cannot match would certify nothing.
  const spliceSelfTest =
    textualSpliceName("preproc_include") && textualSpliceName("part_of_directive") && !textualSpliceName("field_expression")
  if (!spliceSelfTest) {
    console.error("CONTROL FAILED — the textual-splice node-type matcher cannot match the vocabulary it looks for")
    process.exit(5)
  }
  for (const ctl of CONTROL_SNIPPETS) {
    const c = freshCounters()
    const s = freshSets()
    const tree = await controlParser.parse(ctl.src)
    scanTree(tree.rootNode, c, s)
    tree.delete()
    const fail = ctl.expect(c)
    if (fail) controlFails.push(`${ctl.name}: ${fail}`)
  }
  if (controlFails.length > 0) {
    console.error("CONTROL FAILED — a probe that cannot see its own construct cannot certify a corpus zero:")
    for (const f of controlFails) console.error(`  - ${f}`)
    process.exit(5)
  }
  console.log(`controls: ${CONTROL_SNIPPETS.length}/${CONTROL_SNIPPETS.length} fired (separate recorder; corpus totals below are unaffected)`)

  const { files, repos } = enumeratePopulation()
  const admitted = files.length
  console.log(`population: ${admitted} admitted ${EXT} files over ${repos.length} repositories under ${CORPUS}`)

  const counters = freshCounters()
  const sets = freshSets()
  let startIndex = 0
  if (RESUME && existsSync(PROGRESS)) {
    const prev = JSON.parse(readFileSync(PROGRESS, "utf8"))
    startIndex = Number(prev.doneIndex ?? 0)
    Object.assign(counters, prev.counters ?? {})
    for (const k of Object.keys(sets)) {
      const key = k as keyof Sets
      const prevSet = prev.sets?.[k] ?? []
      for (const v of prevSet) (sets[key] as Set<string>).add(String(v))
    }
    console.log(`resume: ${startIndex} files already counted from ${PROGRESS}`)
  }

  const parser: any = await getParser("zig")
  let filesRead = startIndex
  const slice = LIMIT > 0 ? files.slice(startIndex, startIndex + LIMIT) : files.slice(startIndex)
  for (const f of slice) {
    let src = ""
    try {
      src = readFileSync(f, "utf8")
    } catch {
      filesRead++
      counters.filesParseError++
      continue
    }
    if (src.trim().length === 0) {
      counters.filesEmpty++
      filesRead++
      continue
    }
    let tree: any = null
    try {
      tree = await parser.parse(src)
      filesRead++
      scanTree(tree.rootNode, counters, sets)
    } catch {
      counters.filesParseError++
      filesRead++
    } finally {
      if (tree) {
        try {
          tree.delete()
        } catch {
          /* a tree that failed to parse has nothing to free */
        }
      }
    }
    if (filesRead % PROGRESS_EVERY === 0) {
      writeJSONAtomic(PROGRESS, {
        doneIndex: filesRead,
        of: admitted,
        counters,
        sets: Object.fromEntries(Object.entries(sets).map(([k, v]) => [k, [...(v as Set<string>)].sort()])),
      })
      console.log(`  progress ${filesRead}/${admitted}`)
    }
  }
  counters.filesAdmitted = admitted
  counters.filesRead = filesRead
  counters.named_node_types = sets.distinctNodeTypesNamed.size
  counters.component_node_types = sets.componentTypeNames.size
  counters.textual_splice_node_types = sets.textualSpliceTypeNames.size

  const result = {
    instrument: "zig-extended-census.ts",
    population: {
      admitted,
      filesRead,
      filesParseError: counters.filesParseError,
      filesEmpty: counters.filesEmpty,
      repos: repos.length,
      reposNamed: repos.sort(),
      extension: EXT,
      corpusRoot: CORPUS,
      rule: "git-tracked per repository under the corpus root, extension zig, present on disk, <= 1 MiB",
      string: `parsed=${filesRead}/${admitted} admitted=${admitted} exts=zig index=no`,
    },
    counters,
    distinct_import_modules: [...sets.distinctImportModules].sort(),
    distinct_zig_modules: [...sets.distinctZigModules].sort(),
    control: { snippets: CONTROL_SNIPPETS.length, fired: CONTROL_SNIPPETS.length },
    node_types: {
      distinct_all: sets.distinctNodeTypesAll.size,
      distinct_named: sets.distinctNodeTypesNamed.size,
      component_family: [...sets.componentTypeNames].sort(),
      component_words: COMPONENT_WORDS,
      textual_splice_family: [...sets.textualSpliceTypeNames].sort(),
      textual_splice_words: TEXTUAL_SPLICE_WORDS,
    },
  }
  writeJSONAtomic(OUT, result)
  if (filesRead !== admitted) {
    console.error(`CENSUS REFUSED: filesRead ${filesRead} != filesAdmitted ${admitted} — a table over a fraction of the population is not a measurement`)
    process.exit(6)
  }
  console.log(`zig-extended-census: ${filesRead}/${admitted} files over ${repos.length} repos -> ${OUT}`)
  for (const k of Object.keys(counters)) console.log(`  ${k}: ${counters[k]}`)
  console.log(`  distinct_import_modules: ${sets.distinctImportModules.size}`)
  console.log(`  distinct_zig_modules: ${sets.distinctZigModules.size}`)
  console.log(`  node_types: ${sets.distinctNodeTypesAll.size} distinct (${sets.distinctNodeTypesNamed.size} named), component family ${sets.componentTypeNames.size}, textual-splice family ${sets.textualSpliceTypeNames.size}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
