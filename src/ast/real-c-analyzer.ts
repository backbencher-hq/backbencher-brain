function inArray(arr: any[], val: any): boolean {
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] === val) return true
  }
  return false
}

function stringIncludes(str: string, val: string): boolean {
  return str.indexOf(val) !== -1
}

// Strip `<`, `>`, and `"` characters from an include-path node text
// (`<stddef.h>` → `stddef.h`, `"CoreApi.h"` → `CoreApi.h`). Pure-String
// scan — replaces the legacy `/[<>"']/g` regex used by getIncludePath and
// extractInclude.
function stripIncludeChars(text: string): string {
  let out = ""
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c !== "<" && c !== ">" && c !== '"' && c !== "'") out += c
  }
  return out
}

import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"

// Pre-allocated lookup arrays — avoids per-node allocation overhead
const MALLOC_FUNCTIONS = ["malloc", "calloc", "realloc", "kmalloc", "vmalloc"]
const FREE_FUNCTIONS = ["free", "kfree", "vfree"]
const UNSAFE_STRINGS = ["strcpy", "sprintf", "gets"]
const SAFE_STRINGS = ["strncpy", "snprintf"]
const EXPORT_MACROS = ["EXPORT_SYMBOL", "EXPORT_SYMBOL_GPL"]
const FORMAT_FUNCTIONS = ["printf", "fprintf", "sprintf", "snprintf", "scanf", "fscanf", "sscanf", "syslog", "dprintf"]
const DANGEROUS_FUNCTIONS = ["system", "popen", "execve", "execvp", "execl", "execlp"]
const SIGNAL_FUNCTIONS = ["signal", "sigaction", "sigprocmask", "sigemptyset", "sigfillset", "sigaddset", "sigdelset", "sigwait", "sigpending", "sigsuspend"]
const ASM_KEYWORDS = ["__asm__", "__asm", "asm", "__volatile__"]
const COMPLEXITY_NODES = ["if_statement", "for_statement", "while_statement", "do_statement", "case_statement", "conditional_expression"]
// CGD9 (M37 #601 dead-code sweep): DECLARATION_NODES, STRUCT_TYPE_NODES,
// DECLARATOR_NODES, TYPE_NODES were declared and never referenced anywhere —
// disconnected constants that suggested coverage that did not exist. Removed.

enum ScopeKind {
  Global = "global",
  Function = "function",
  Block = "block",
  Struct = "struct",
  Union = "union",
}

interface ScopeEntry {
  kind: ScopeKind
  name: string
  node: Node
}

// CGD22 (M37 #601): a C keyword can NEVER be a declared name. ERROR recovery
// glues `else if(...)` fragments into pseudo function_definition shapes whose
// "declarator" is the keyword itself (resolve.c: three `function "if"`
// symbols fabricated from #ifdef-glued else-if chains, each seeding a bogus
// `uses` edge). Names are filtered at the extraction dispatch.
const C_KEYWORDS = new Set([
  "if", "else", "for", "while", "do", "switch", "case", "default", "break",
  "continue", "return", "goto", "sizeof", "typedef", "struct", "union",
  "enum", "static", "extern", "inline", "register", "volatile", "const",
  "auto", "signed", "unsigned", "void", "char", "short", "int", "long",
  "float", "double", "_Bool", "_Complex", "_Imaginary", "restrict",
  "_Alignas", "_Alignof", "_Atomic", "_Generic", "_Noreturn",
  "_Static_assert", "_Thread_local",
])

class CScopeManager {
  private stack: ScopeEntry[] = []

  constructor() {
    this.pushScope(ScopeKind.Global, "global", null as any)
  }

  // CGD20 (M37 #601): does the current scope chain sit inside a FUNCTION
  // body? Function locals (block vars, local struct/union/enum/typedef
  // definitions) are execution artifacts (C-D1) — only file-scope
  // declarations become symbols.
  isInsideFunction(): boolean {
    for (let i = this.stack.length - 1; i >= 0; i--) {
      if (this.stack[i].kind === ScopeKind.Function) return true
    }
    return false
  }

  pushScope(kind: ScopeKind, name: string, node: Node): void {
    this.stack.push({ kind, name, node })
  }

  popScope(): ScopeEntry | undefined {
    if (this.stack.length > 1) {
      return this.stack.pop()
    }
    return undefined
  }

  currentScope(): ScopeEntry {
    return this.stack[this.stack.length - 1]
  }

  getScopeName(): string {
    const parts = []
    for (let i = 1; i < this.stack.length; i++) {
      parts.push(this.stack[i].name)
    }
    return parts.length > 0 ? parts.join(".") : "global"
  }

  getCurrentFunctionName(): string | null {
    for (let i = this.stack.length - 1; i >= 0; i--) {
      if (this.stack[i].kind === ScopeKind.Function) return this.stack[i].name
    }
    return null
  }

  // Relationship source identity: the enclosing FUNCTION name, not the block
  // scope (`core_init.block_211` would be a dangling identity that never
  // resolves to a symbol). Top-level (file-scope) relationships use "global".
  getRelationshipSource(): string {
    const fn = this.getCurrentFunctionName()
    return fn || "global"
  }
}

export class RealCAnalyzer implements ASTEngine.LanguageAnalyzer {
  analyze(rootNode: Node, content: string, filePath: string): ASTEngine.ParseResult {
    // 1. ISOLATED STATE (Thread-Safe)
    // HC5 (deepest review): the CGD19 per-ERROR-span memo is instance state
    // keyed by span startIndex — WITHOUT this clear, a reused instance
    // (differential lanes, F4 runs, batch indexing) reuses file A's verdict
    // for file B's same-offset ERROR span and silently drops B's legitimate
    // declarations (probe: file-A glue@0/14 suppresses file-B clean@24).
    // Fresh instances (engine per-file path) were never affected.
    this.cgd19HeaderIdx.clear()
    // #907 round 2: same per-file hygiene for the recovered-definition name
    // offsets — a reused instance must not carry file A's name offsets into
    // file B's identifier dispatch.
    this.gluedDefNameOffsets.clear()
    // CGD40 (M49 W17): the line-anchor gate needs the raw file text — a
    // directive line spliced into code by parse recovery is physically a
    // '#' line even with no surviving preproc_* ancestor.
    this.analyzeContent = content
    const symbols: ASTEngine.UniversalSymbol[] = []
    const relationships: ASTEngine.UniversalRelationship[] = []
    const imports: ASTEngine.ImportInfo[] = []
    const errors: ASTEngine.ParseError[] = []
    const scopeManager = new CScopeManager()
    const emittedUseRelationships = new Set<string>()
    const functionLocals = new Map<string, Set<string>>()
    // #383 payload: call targets per enclosing function
    const qcByFunction = new Map<string, string[]>()

    const structs: Record<string, any[]> = {}
    const globalVars: Record<string, boolean> = {}
    const unions: Record<string, any[]> = {}
    const enums: Record<string, boolean> = {}
    const patterns: Record<string, boolean> = {}

    // Pre-pass: collect every type DECLARATION name in the file (struct/union/
    // enum names and typedef aliases). Type-identifier resolution is then
    // order-independent — `typedef struct Point Point;` before `struct Point
    // { ... }` still resolves, while a never-defined forward declaration
    // (`struct ForwardOnly;`) emits no dangling use edge.
    const declaredTypes = new Set<string>()
    {
      // CGD20-mirror (PERF, measured): function-local type declarations are
      // execution artifacts (C-D1) — they must not enter declaredTypes, else
      // a `references` edge fires for a type whose SYMBOL was correctly
      // suppressed (measured: test_backup.c backupTestCmd ->
      // BackupSubCommandEnum dangled after the CGD20 symbol fix). The
      // in-function state is carried IN THE STACK (per-node parent walks
      // crossed the WASM boundary millions of times: vdbe.c 3.6s/file →
      // differential timeout).
      const preStack: { n: Node; inFn: boolean }[] = [{ n: rootNode, inFn: false }]
      while (preStack.length > 0) {
        const { n, inFn } = preStack.pop()!
        const nextInFn = inFn || n.type === "function_definition"
        if (!inFn) {
        if (n.type === "struct_specifier" || n.type === "union_specifier") {
          if (n.childForFieldName("body")) {
            const nm = n.childForFieldName("name")
            if (nm && nm.text.trim()) declaredTypes.add(nm.text)
          }
        } else if (n.type === "enum_specifier") {
          const nm = n.childForFieldName("name")
          if (nm && nm.text.trim()) declaredTypes.add(nm.text)
        } else if (n.type === "type_definition") {
          const identNode = this.getIdentifierFromDeclarator(n.childForFieldName("declarator"))
          if (identNode && identNode.text.trim()) declaredTypes.add(identNode.text)
        }
        }
        for (let i = n.namedChildCount - 1; i >= 0; i--) {
          const c = n.namedChild(i)
          if (c) preStack.push({ n: c, inFn: nextInFn })
        }
      }
    }

    // CGD26 (M37 #601): file-scope DECLARED-NAME pre-pass — order
    // independence for file-scope value names (globals, functions,
    // prototypes, enum members, macros). Mirrors the oracle's declaredNames:
    // a static initializer table (`{ DupStringInternalRep, ... }`, jimsh0.c)
    // or a callback reference walks BEFORE the later function/typedef symbol
    // exists, so symbol-based resolution silently dropped the edge. Uses of
    // names in this set resolve order-independently; the symbol walk still
    // provides scoped/shadowed resolution and kind/visibility payloads.
    // NOTE (M60, #908): a first attempt at the jq lane's single UNEXPLAINED row
    // (`uses yyparse -> YY_INITIAL_VALUE`, src/parser.c L2229-2230) suppressed
    // `uses` for every function-like macro NAME collected here. That traded one
    // UNEXPLAINED row for FOUR MISSING rows (isleap, YYDPRINTF, decFinish,
    // CFUNC) because the truth counts a macro INVOCATION as both `calls (expr)`
    // and `uses (expr)` — the analyzer's identifier-path `uses` was load-bearing
    // for the second row. The attempt was reverted and the residual registered
    // as #908. Do not re-add a blanket macro-name suppression here.
    const declaredNames = new Set<string>()
    {
      const preStack: { n: Node; inFn: boolean }[] = [{ n: rootNode, inFn: false }]
      while (preStack.length > 0) {
        const { n, inFn } = preStack.pop()!
        const nextInFn = inFn || n.type === "function_definition"
        if (n.type === "identifier" || n.type === "field_identifier") {
          const p = n.parent
          // CGD36 (M37 #601, measured vdbeaux.c/expr.c/loadext.c): a
          // function DEFINITION name is a file-scope declaration even though
          // the pre-pass carries inFn=true into the function_definition
          // subtree — so a VALUE read of a function BEFORE its definition
          // (`p->xDel==sqlite3VdbeFrameMemDel` at vdbeaux L2220 reads the fn
          // defined at L2258; `sqlite3ExprListDeleteGeneric` passed as a
          // callback; function-pointer tables) resolved only through the
          // ORDER-DEPENDENT Function symbol and silently dropped. The oracle
          // admits fn names (its isFunctionLocal excludes only compound/
          // parameter ancestry), so the analyzer must too. Distinguish from
          // LOCAL fn-pointer declarations: walk up from the name's
          // function_declarator — hitting compound_statement/parameter_list
          // first means a body-local declaration (excluded, C-D1); hitting
          // function_definition first means the defining name.
          const isFnDefName = (() => {
            if (!p || p.type !== "function_declarator") return false
            let mid: Node | null = p
            while (mid) {
              if (mid.type === "compound_statement" || mid.type === "parameter_list") return false
              if (mid.type === "function_definition") return true
              mid = mid.parent
            }
            return false
          })()
          // HC6 (deepest review): parameter names are never file-scope
          // declarations — `int f(int count);` admitted `count` into
          // declaredNames, fabricating a dangling `uses -> count` for any
          // later read (the oracle's isFunctionLocal already excludes
          // parameter ancestry, so this also restores mirror parity).
          // #901 (M60, second half of the basexx.c miss): the directive gate
          // below (`!isDirectiveConditionText`) walks UP to the first
          // `preproc_*` ancestor — and a macro definition's NAME has
          // `preproc_def` as its direct parent, so the gate returned true and
          // killed every macro name before the `isMacroName` branch could add
          // it. That branch has therefore been DEAD CODE since CGD26, and the
          // measured consequence is order dependence for exactly one symbol
          // class: a macro READ above its `#define` (basexx.c: read at L40,
          // `#define` at L48) resolved through the order-dependent Constant
          // symbol and dropped the edge, while a function call or global read
          // in the same position resolved through declaredNames and emitted
          // (measured probes: `later()`/`gv2` forward refs emit, `FWD` macro
          // forward ref does not). The oracle's declaredNames has always
          // admitted macros (its own isDeclaringIdentifier excludes only
          // function-local ancestry), so this restores mirror parity.
          // Narrowed to the NAME field by the helper: macro-body identifiers
          // (`preproc_arg` is an opaque blob, C-D2) and every "mention in
          // directive text" case keep the suppression — the definition site
          // is the one place a `preproc_*`-ancestored name DECLARES.
          if (p && (!inFn || isFnDefName) && this.isDeclarationLikeIdentifier(n) && (!this.isDirectiveConditionText(n) || this.isMacroDefinitionName(n)) && !this.isInsideParameterList(n)) {
            // Prototype names declare even inside ERROR-glued spans
            // (CGD19 scope refinement); the glue-name test below handles
            // bare-fd artifacts.
            const isProto = (() => {
              if (p.type !== "function_declarator") return false
              let mid: Node | null = p
              while (mid) {
                if (mid.type === "function_definition") return true
                if (mid.type === "declaration") return false
                mid = mid.parent
              }
              return false
            })()
            const isGlueFdName = (() => {
              if (p.type !== "function_declarator") return false
              const gp = p.parent
              if (!gp || gp.type !== "ERROR") return false
              // POSITION comparison (KAD2/TSD2 class, hygiene F7):
              // web-tree-sitter returns FRESH node objects per property
              // access, so `m !== gp` could never terminate — this gate was
              // dead code. Reach the ERROR span by comparing spans.
              const errStart = gp.startIndex
              const errEnd = gp.endIndex
              let m: Node | null = n
              while (m) {
                if (m.startIndex === errStart && m.endIndex === errEnd) return true
                if (m.type === "declaration") return false
                m = m.parent
              }
              return false
            })()
            const isMacroName = !!(p.type === "preproc_def" || p.type === "preproc_function_def")
            // CGD37 (M49 W17, measured jq src/builtin.c): a declaration inside
            // a compound_statement is a FUNCTION-BODY local even when parse-
            // recovery glue swallowed the enclosing function_definition —
            // tree-sitter-c folds gen_last_1's body into one top-level
            // `declaration` with a nested compound_statement, so no
            // function_definition ancestor exists and `inFn` never rises.
            // The oracle's isFunctionLocal excludes on the compound ancestor
            // ALONE, so the analyzer must too: otherwise the body reads
            // resolve order-independently through declaredNames and emit
            // `uses -> <local>` edges attributed to source=global (last_var,
            // init, call_arg, rangevar...). C has no file-scope blocks: a
            // decl inside a compound is NEVER file-scope. Macro definitions
            // stay textually file-scoped (C-D2); fn-def names and prototypes
            // have no compound ancestor between name and function_definition.
            const isInsideCompoundStatement = (() => {
              let c: Node | null = n
              while (c) {
                if (c.type === "compound_statement") return true
                c = c.parent
              }
              return false
            })()
            if (isProto || isMacroName || !(isInsideCompoundStatement || isGlueFdName || this.isCgd19SuppressedVarDecl(n))) {
              declaredNames.add(n.text)
            }
          }
        }
        for (let i = n.namedChildCount - 1; i >= 0; i--) {
          const c = n.namedChild(i)
          if (c) preStack.push({ n: c, inFn: nextInFn })
        }
      }
    }

    // Track current active function for localized metadata updates
    let activeFunctionSymbol: ASTEngine.UniversalSymbol | null = null

    // 2. METRICS TRACKED IN-PASS
    let cyclomaticComplexity = 1
    let mallocCount = 0
    let freeCount = 0
    let hasUnsafeStrings = false
    let hasSafeStrings = false
    let isKernelExport = false
    let hasGotoStatements = false
    let hasVolatileQualifier = false
    let hasRestrictQualifier = false
    let hasInlineAsm = false
    let hasSignalHandlers = false
    let hasSetjmpLongjmp = false
    let hasAtomicTypes = false
    let hasVariableFormatString = false  // printf(user_input) security risk
    let hasDangerousCalls = false        // system(), popen(), exec*()

    // ABI heuristics: default to LP64, adjust with architecture hints and platform headers
    let is64Bit = this.inferIs64Bit(content, filePath)
    let isLLP64 = this.inferIsLLP64(content)

    // 3. THE TRUE SINGLE-PASS UNIFIED WALK
    const stack: { node: Node; isConditional: boolean; isExit: boolean; pushedScope: boolean }[] = [
      { node: rootNode, isConditional: false, isExit: false, pushedScope: false },
    ]

    while (stack.length > 0) {
      const { node, isConditional, isExit, pushedScope } = stack.pop()!

      if (!node) continue

      if (isExit) {
        // --- Scope Management (Leave) ---
        if (pushedScope) {
          if (scopeManager.currentScope().kind === ScopeKind.Function) {
            activeFunctionSymbol = null
          }
          scopeManager.popScope()
        }
        continue
      }

      let willPushScope = false

      // --- Scope Management (Enter) ---
      switch (node.type) {
        case "function_definition": {
          // CGD38 (M37 #601, measured mem3.c/malloc.c/loadext.c): a
          // macro-qualified struct definition — `static SQLITE_WSD struct
          // Mem3Global {` (SQLITE_WSD is an unknown identifier) — recovers
          // as a function_definition whose DECLARATOR FIELD is a BARE
          // identifier (the struct TAG). Real function_definition
          // declarators are always function_declarator (possibly wrapped in
          // pointer_declarator/array_declarator). Treating the bare-identifier
          // shape as a function fabricated phantom Function symbols
          // (`Mem3Global`, `sqlite3AutoExtList`) whose "body" is the struct.
          // Only a declarator chain that CONTAINS a function_declarator is
          // a real callable.
          const rawDecl = node.childForFieldName("declarator")
          const declIsCallable = (() => {
            if (!rawDecl) return false
            if (rawDecl.type === "function_declarator") return true
            // pointer_declarator / array_declarator / parenthesized wrappers:
            // descend the declarator chain for a function_declarator.
            let d: Node | null = rawDecl
            while (d && d.type !== "function_declarator") d = d.childForFieldName("declarator")
            return !!d
          })()
          const nameNode = declIsCallable ? this.getIdentifierFromDeclarator(rawDecl) : null
          // CGD22: ERROR-glued pseudo definitions can carry a KEYWORD as the
          // "function name" — no scope, no symbol, no locals for it.
          if (nameNode && nameNode.text.trim() && !C_KEYWORDS.has(nameNode.text)) {
            scopeManager.pushScope(ScopeKind.Function, nameNode.text, node)
            willPushScope = true
            activeFunctionSymbol = this.extractFunction(
              node,
              content,
              symbols,
              scopeManager.getScopeName(),
              isConditional,
            )
            const locals = new Set<string>()
            if (activeFunctionSymbol?.parameters) {
              for (let i = 0; i < activeFunctionSymbol.parameters.length; i++) {
                const p = activeFunctionSymbol.parameters[i]
                if (p && p.name && p.name !== "...") locals.add(p.name)
              }
            }
            functionLocals.set(nameNode.text, locals)
          }
          break
        }
        case "ERROR": {
          // #907 (M60-C, measured jq src/jv_print.c): a top-level definition that
          // parse recovery absorbs into a preceding function's body survives only as
          // an ERROR holding a type node plus a bare function_declarator — no
          // function_definition wrapper, so the walk never emits it and the public
          // API function vanishes from the catalog (jv_dumpf/jv_dump).
          this.recoverGluedDefinitionHeader(node, content, symbols)
          break
        }
        case "compound_statement": {
          // KAD2 sweep: comparing a STORED wrapper (scope entry) to a fresh
          // `node.parent` never matched — the guard was dead and nested
          // blocks always pushed a new scope. Span comparison restores the
          // merge behavior for consecutive same-scope compounds.
          // CGD21 (M37 #601): the GLOBAL scope carries node=null —
          // dereferencing its .node crashed 7/125 sqlite files on VALID C
          // (a top-level or ERROR-glued compound reached while global is
          // current). A null-node scope never merges.
          const cur = scopeManager.currentScope()
          if (!cur.node ||
              cur.node.startIndex !== node.parent?.startIndex ||
              cur.node.endIndex !== node.parent?.endIndex) {
            scopeManager.pushScope(ScopeKind.Block, `block_${node.startIndex}`, node)
            willPushScope = true
          }
          break
        }
        case "struct_specifier": {
          // CGD20: function-local struct definitions are execution artifacts
          // (C-D1) — no scope, no symbol, no field registration.
          if (scopeManager.isInsideFunction()) break
          const nameNode = node.childForFieldName("name")
    let structName = "anonymous_struct"
    if (nameNode && nameNode.text.trim()) {
      structName = nameNode.text
    } else if (node.parent && node.parent.type === "type_definition") {
      const declNode = this.getIdentifierFromDeclarator(node.parent.childForFieldName("declarator"))
      if (declNode && declNode.text.trim()) structName = declNode.text.trim()
    }
          // Only a struct WITH a body is a definition site — forward/reference
          // declarations (`struct Point;`, `typedef struct Point Point;`) push
          // no scope so the typedef name cannot self-reference its own scope.
          if (node.childForFieldName("body")) {
            scopeManager.pushScope(ScopeKind.Struct, structName, node)
            willPushScope = true
          }
          this.extractStruct(
            node,
            symbols,
            structs,
            unions,
            is64Bit,
            isLLP64,
            scopeManager.getScopeName(),
            isConditional,
          )
          break
        }
        case "union_specifier": {
          // CGD20: function-local unions are execution artifacts (C-D1).
          if (scopeManager.isInsideFunction()) break
          const nameNode = node.childForFieldName("name")
    let unionName = "anonymous_union"
    if (nameNode && nameNode.text.trim()) {
      unionName = nameNode.text
    } else if (node.parent && node.parent.type === "type_definition") {
      const declNode = this.getIdentifierFromDeclarator(node.parent.childForFieldName("declarator"))
      if (declNode && declNode.text.trim()) unionName = declNode.text.trim()
    }
          if (node.childForFieldName("body")) {
        scopeManager.pushScope(ScopeKind.Union, unionName, node)
        willPushScope = true
      }
          this.extractUnion(node, symbols, unions, scopeManager.getScopeName(), isConditional)
          break
        }
        case "enum_specifier":
          // CGD20: function-local enums are execution artifacts (C-D1) —
          // their members must not leak as file-scope EnumMember symbols
          // (measured: BackupSubCommandEnum/MB_enum members in sqlite).
          if (scopeManager.isInsideFunction()) break
          this.extractEnum(node, symbols, enums, scopeManager.getScopeName(), isConditional)
          break
        case "declaration":
          {
            const currentFunction = scopeManager.getCurrentFunctionName()
            if (currentFunction) {
              const locals = functionLocals.get(currentFunction) || new Set<string>()
              // CGD7 (M37 #601): only names actually BOUND by this declaration
              // enter locals — the old collectDeclaredIdentifiers walked the
              // ENTIRE declaration subtree, so `int y = g;` collected `g` (the
              // RHS initializer identifier) as a "local", and every later
              // genuine read of `g` in the same function was silently dropped
              // (probe c-emit2 B1: `return g + 1` emitted nothing). A local
              // variable shadowing a global is legitimately filtered; a
              // READ of the global is not.
              const bound = this.collectBoundLocals(node)
              for (let i = 0; i < bound.length; i++) {
                locals.add(bound[i])
              }
              functionLocals.set(currentFunction, locals)
            }
          }
          this.extractDeclaration(
            node,
            symbols,
            globalVars,
            scopeManager.getScopeName(),
            scopeManager.currentScope().kind === ScopeKind.Global,
            isConditional,
          )
          break
        case "type_definition":
          // CGD20: function-local typedefs are execution artifacts (C-D1).
          if (scopeManager.isInsideFunction()) break
          this.extractTypedef(node, symbols, structs, scopeManager.getScopeName(), isConditional)
          break
        case "preproc_def":
        case "preproc_function_def":
          patterns["Preprocessor Macros"] = true
          this.extractMacro(node, symbols, isConditional)
          // CGD5 (M37 #601): preproc_arg is an OPAQUE token blob in the
          // pinned grammar (probe c-emit2 B8 — zero named children; the C
          // preprocessor is textual, and expansion is C-D2's recorded
          // non-goal). Walking its text would fabricate identifiers out of
          // macro bodies; treating it as AST would miss that every macro
          // reference in real code IS parsed (as ordinary identifiers at
          // use sites, post-expansion by the compiler). The honest ruling:
          // the blob is neither walked nor re-parsed; macro USE sites resolve
          // through the ordinary identifier path when the macro name is a
          // declared Constant/Macro symbol (extractMacro above).
          break
        case "preproc_include": {
          this.extractInclude(node, imports, (path) => {
            if (stringIncludes(path, "windows.h")) {
              isLLP64 = true
              is64Bit = true
            }
            if (stringIncludes(path, "sys/types.h") || stringIncludes(path, "stddef.h")) {
              // keep existing architecture assumption; these headers are cross-platform
              is64Bit = is64Bit
            }
          })
          // depends: #include creates a compile-time dependency on the header
          // CGD4: isSystem must come from the RAW path text ("<stdio.h>"),
          // never the stripped path — the stripped text never starts with
          // '<', so every include edge carried isSystem=false.
          const includePath = this.getIncludePath(node)
          if (includePath) {
            const rawPathNode =
              node.childForFieldName("path") ||
              this.findChild(node, (c) => c?.type === "string_literal" || c?.type === "system_lib_string")
            const isSystemInclude = rawPathNode ? rawPathNode.text.trimStart().startsWith("<") : false
            relationships.push({
              source: scopeManager.getRelationshipSource(),
              target: includePath,
              type: ASTEngine.RelationshipType.References,
              confidence: 1.0,
              // M59.A7 (#825): the include directive is the source construct and
              // its written name is the path token — take THAT node's line, not
              // the directive's (multi-line directives put the path last).
              line_number: this.nodeLine(rawPathNode ?? node),
              metadata: { relationshipType: "include_dependency", isSystem: isSystemInclude, isImport: true },
            })
          }
          break
        }
      }

      stack.push({ node, isConditional, isExit: true, pushedScope: willPushScope })

      // --- Error Tracking ---
      if (node.type === "ERROR" || node.isMissing) {
        errors.push({
          message: "Syntax Error/Missing Node bypassed - Recovering AST Bounds",
          range: this.nodeToRange(node),
          severity: "warning",
        })
      }

      // --- In-Pass Metrics & Graph Detection ---
      if (
        inArray(COMPLEXITY_NODES, node.type)
      ) {
        cyclomaticComplexity++
      } else if (node.type === "goto_statement") {
        // goto is not a DECISION POINT (family T1 contract: branch constructs
        // + short-circuit operators only) - it no longer inflates the
        // cyclomatic count; maintainability tracking keeps hasGotoStatements.
        hasGotoStatements = true
      } else if (node.type === "labeled_statement") {
        // labels are jump TARGETS, not decisions - same T1 rationale.
        hasGotoStatements = true
      } else if (node.type === "type_qualifier") {
        if (node.text === "volatile") hasVolatileQualifier = true
        if (node.text === "restrict" || node.text === "__restrict") hasRestrictQualifier = true
        if (node.text === "_Atomic") hasAtomicTypes = true
      } else if (node.type === "gnu_asm_expression") {
        // Pinned wasm emits gnu_asm_expression; 'asm_expression' was a dead
        // literal (grammar audit).
        hasInlineAsm = true
        patterns["Inline Assembly"] = true
      } else if (node.type === "binary_expression") {
        const op = node.childForFieldName("operator")
        if (op && (op.text === "&&" || op.text === "||")) cyclomaticComplexity++
      } else if (node.type === "call_expression") {
        const fnNode = node.childForFieldName("function")
        // CGD3: a parenthesized callee is NEVER a resolvable call by name —
        // it is either a vendor-macro cast `(Unit)(x)` (typedef from an
        // untracked header; census: ~100% of paren callees in sqlite/jq are
        // header typedefs like u8/Unit/sqlite3_int64) or a computed
        // function-pointer deref `(*fp)(x)`. Both are dropped as call edges
        // (oracle deriveCCalls already dropped them). CGD2: the old cast
        // branch `continue`d the WALK, which skipped the entire call
        // subtree — calls INSIDE cast arguments vanished. The walk now
        // always recurses; only the calls edge is suppressed.
        let suppressCall = false
        if (fnNode) {
          let target = fnNode.text
          let isFuncPtr = false
          // M59.A7 (#825): the line belongs to the name, never to the construct
          // that contains it. `obj->method()`'s call_expression starts at the
          // RECEIVER, so a newline-continued member call would take the line the
          // receiver is written on (the scala/java/groovy defect class, in C's
          // node shape); the callee leaf is the naming node.
          let targetNode: Node | null = fnNode

          if (fnNode.type === "field_expression") {
            const field = fnNode.childForFieldName("field")
            if (field) {
              target = field.text
              targetNode = field
            }
            isFuncPtr = true
          } else if (fnNode.type === "subscript_expression") {
            // Dispatch-table invocation handlers[i]() - no static callee
            // NAME exists (family contract with cpp: computed/dynamic
            // calls are filtered rather than emitting bracket-text noise).
            target = ""
          } else if (fnNode.type === "call_expression") {
            // CGD32 (M37 #601, measured libcmpp.c ×90): a NESTED call as the
            // callee — `CMPP__EXPORT(bool, cmpp_isspace)(...)` — is a
            // macro-wrapped declaration whose inner call_expression text
            // (`CMPP__EXPORT(bool, cmpp_isspace)`) leaked as a composite
            // bogus call target (parens/commas; nothing can resolve it). The
            // inner call still walks and emits its own `calls CMPP__EXPORT`
            // edge — suppress only the composite outer target, mirroring the
            // parenthesized-callee ruling (CGD3): a callee that is itself a
            // call has no static NAME.
            suppressCall = true
          } else if (fnNode.type === "parenthesized_expression") {
            // CAST vs FUNCTION POINTER (CGD3): `(Type)expr` through vendor
            // macros parses as a call with a parenthesized callee whose child
            // is a type — a CAST, not a callable (census: ~100% of paren
            // callees in sqlite/jq are header typedefs: u8, Unit,
            // sqlite3_int64). Deref calls ((*fp)(x)) hold a pointer
            // expression. Neither shape has a resolvable call NAME, so the
            // EDGE is suppressed; unlike the old `continue`, the WALK still
            // descends — a call inside a cast argument, `(Unit)(make())`,
            // still emits its own `calls make` (probe c-emit3 C1: previously
            // the entire subtree was skipped).
            suppressCall = true
          }

          if (
            !suppressCall &&
            target && target.trim() !== "" &&
            // Malformed recovery guard: include-adjacent macros produced
            // targets containing quotes/newlines (never real callees).
            !target.includes('"') && !target.includes("\n") && !target.includes("{")
          ) {
            relationships.push({
              source: scopeManager.getRelationshipSource(),
              target: target,
              type: ASTEngine.RelationshipType.Calls,
              confidence: 1.0,
              line_number: this.nodeLine(targetNode),
              metadata: { relationshipType: "c_function_call", isFunctionPointer: isFuncPtr },
            })

            // #383 payload: calls of the enclosing function (C has no
            // qualification - the plain call target IS the qualified path).
            const qcFn = scopeManager.getCurrentFunctionName()
            if (qcFn) {
              const list = qcByFunction.get(qcFn) ?? []
              list.push(target)
              qcByFunction.set(qcFn, list)
            }

            // Single pass security tracking
            if (inArray(MALLOC_FUNCTIONS, target)) {
              mallocCount++
              patterns["Dynamic Memory Management"] = true
              if (activeFunctionSymbol && activeFunctionSymbol.metadata) {
                activeFunctionSymbol.metadata.usesMalloc = true
              }
              // malloc allocates BYTES, not a named type - an Instantiates
              // edge to the literal 'malloc' could never resolve to a type
              // symbol and was pure noise (removed; allocation tracking
              // lives in metadata + patterns).
            } else if (inArray(FREE_FUNCTIONS, target)) {
              freeCount++
            } else if (inArray(UNSAFE_STRINGS, target)) {
              hasUnsafeStrings = true
            } else if (inArray(SAFE_STRINGS, target)) {
              hasSafeStrings = true
            } else if (inArray(EXPORT_MACROS, target)) {
              isKernelExport = true
              const arg = node.childForFieldName("arguments")?.namedChild(0)
              if (arg && arg.text.trim()) {
                relationships.push({
                  source: arg.text,
                  target: "KERNEL_EXPORT",
                  type: ASTEngine.RelationshipType.Exports,
                  confidence: 1.0,
                  // M59.A7: the exported NAME is written in the macro argument;
                  // the marker target (KERNEL_EXPORT) is synthesised and the
                  // oracle verifies this edge by its SOURCE token.
                  line_number: this.nodeLine(arg),
                  metadata: { relationshipType: "linux_kernel_export", exportMacro: target },
                })
              }
            } else if (inArray(FORMAT_FUNCTIONS, target)) {
              // Format string security: detect variable format arg (e.g., printf(user_input))
              const args = node.childForFieldName("arguments")
              if (args) {
                const firstArg = args.namedChild(0)
                if (firstArg && firstArg.type === "string_literal") {
                  patterns["Formatted I/O"] = true
                } else if (firstArg && firstArg.type !== "string_literal") {
                  hasVariableFormatString = true
                  patterns["Format String Vulnerability Risk"] = true
                }
              }
            } else if (inArray(DANGEROUS_FUNCTIONS, target)) {
              hasDangerousCalls = true
              patterns["Shell Command Execution Risk"] = true
            } else if (inArray(SIGNAL_FUNCTIONS, target)) {
              hasSignalHandlers = true
              patterns["Signal Handling"] = true
            } else if (target === "setjmp" || target === "longjmp" || target === "sigsetjmp" || target === "siglongjmp") {
              hasSetjmpLongjmp = true
              patterns["Non-Local Jumps"] = true
            }
          }
        }
      } else if (node.type === "field_expression") {
        // struct->field or struct.field access → References + field_access metadata
        // SCD1 (M37 #599 pre-wave addendum 2): an assignment LHS is a
        // WRITE, never a read — `c->count = 0` and `c->count += 1` both
        // leaked a bogus `uses count` (the dedup key merged the two
        // writes into one edge, hiding the leak). Gate by exact LHS span:
        // assignment_expression (the pinned grammar folds compound-assign
        // into it), RHS reads stay genuine (java JAD1 family contract).
        const parent = node.parent
        const lhs = parent ? parent.namedChild(0) : null
        const isWrite = parent && parent.type === "assignment_expression" && lhs && lhs.startIndex === node.startIndex && lhs.endIndex >= node.endIndex
        // CGD17 (M37 #601): a field_expression in the CALLEE position is a
        // CALL, not a read — `p->xClose(p)` emitted BOTH `calls xClose`
        // (from the call_expression branch) and `uses xClose [field_access]`
        // here, doubling every member-function invocation (family contract:
        // one edge per pair). Span-match the call's `function` field.
        const isCallee = parent?.type === "call_expression" &&
          parent.childForFieldName("function")?.startIndex === node.startIndex
        const field = node.childForFieldName("field")
        const obj = node.childForFieldName("argument") || node.namedChild(0)
        if (field && field.text.trim() && !isWrite && !isCallee) {
          const sourceScope = scopeManager.getRelationshipSource()
          const relKey = `${sourceScope}::uses::${field.text}`
          if (!emittedUseRelationships.has(relKey)) {
            emittedUseRelationships.add(relKey)
            relationships.push({
              source: sourceScope,
              target: field.text,
              type: ASTEngine.RelationshipType.Uses,
              confidence: 0.9,
              line_number: this.nodeLine(field),
              metadata: { relationshipType: "field_access", accessedFrom: obj?.text },
            })
          }
        }
      } else if (node.type === "init_declarator") {
        // CGD8 (M37 #601): the old init_from_call edge — `p -uses->
        // make_thing` for `Type *p = make_thing();` — is REMOVED. Measured
        // on sqlite @60: 945 distinct dangling edges, every one duplicating
        // the same-site `f -calls-> make_thing` (the enclosing function's
        // call edge already carries the semantic). The dataflow claim
        // ("p receives make_thing's return value") is real but needs
        // cross-file signature resolution to name the return TYPE — a
        // recorded non-goal (C-D2: no macro expansion, no cross-TU
        // resolution). Worse, the source is the LOCAL variable `p`, which
        // never becomes a symbol (extractDeclaration: execution artifact),
        // so the edge could never resolve in the graph. If dataflow edges
        // are wanted later, they must source the enclosing FUNCTION and be
        // gated by resolvable return types.
      } else if (
        inArray(
          [
            "identifier",
            "field_identifier",
            "type_identifier",
            "struct_specifier",
            "union_specifier",
            "enum_specifier",
          ],
          node.type,
        )
      ) {
        let text = node.text
        if (inArray(["struct_specifier", "union_specifier", "enum_specifier"], node.type)) {
          const nameNode = node.childForFieldName("name")
          if (nameNode) text = nameNode.text
        }
        const sourceScope = scopeManager.getRelationshipSource()
        const currentFunction = scopeManager.getCurrentFunctionName()
        const locals = currentFunction ? functionLocals.get(currentFunction) : undefined
        // CGD12 re-route (M37 #601): a plain identifier in a TYPE position
        // (sizeof(X) argument, `(i64)x` cast) that resolves as a TYPE
        // (declaredTypes) emits a REFERENCES edge — one contract for type
        // usage regardless of grammar accident (type_identifier vs
        // identifier-in-type-position). Value resolution is untouched.
        const resolvesAsType =
          this.isTypePositionIdentifier(node) &&
          this.isResolvableUseTarget(text, "type_identifier", symbols, globalVars, structs, unions, enums, declaredTypes, declaredNames)

        if (
          text &&
          text.trim() !== "" &&
          sourceScope !== "" &&
          !this.isDeclarationLikeIdentifier(node) &&
          !(locals && locals.has(text)) &&
          // CGD27 (M37 #601): a designated-initializer field designator —
          // `.nKeySize = KVRECORD_KEY_SZ` parses as field_designator >
          // field_identifier — NAMES the field being initialized (a write
          // target), it does not read it. The old code emitted `uses
          // nKeySize [field_identifier]` for every designated initializer
          // (os_kv.c's entire method table). The VALUE side of the
          // initializer still walks and emits its own edges.
          node.parent?.type !== "field_designator" &&
          // CGD12 (M37 #601): a plain-identifier TYPE position —
          // `sizeof(VfslogFile)` parses the argument as identifier inside
          // parenthesized_expression inside sizeof_expression (probe
          // c-ref-src) — is a TYPE REFERENCE, not a value read. RE-ROUTED
          // (not dropped): resolvesAsType forces the references emission
          // below; a value-only name keeps its normal path.
          // CGD11 (M37 #601): an identifier inside PREPROCESSOR CONDITION
          // TEXT (`#if SQLITE_ENABLE_LOCKING_STYLE>0`, `#ifdef X`,
          // `defined(A) && defined(B)`) is not a code-level read — the
          // preprocessor is textual (C-D2) and the condition vanishes or
          // selects code; it never executes. Gate mirrors the oracle's
          // isDirectiveConditionText: path to the first preproc_* ancestor
          // through NO code container (statement/declaration/declarator/
          // specifier/enumerator). Conditional CODE inside `#ifdef` blocks
          // still walks and emits — test files are one giant #ifdef block.
          !(this.isDirectiveConditionText(node)) &&
          // CGD40-mirror (M49 W17, measured jq src/builtin.c L2056-2061):
          // parse recovery SPLICES directive lines into continuing code —
          // `#undef LIBM_DDD` survives as an argument_list operand with no
          // preproc_* ancestor, so isDirectiveConditionText is blind. The
          // preprocessor is line-anchored text (C-D2): a mention whose
          // PHYSICAL source line starts with '#' is directive text. Mirrors
          // the oracle's CGD40 use-truth gate one-for-one.
          !(this.isHashLineMention(node)) &&
          // A call-target identifier already emits a `calls` edge from the
          // call_expression branch — skipping it here avoids the redundant
          // `uses` pair (family contract: one edge per pair).
          node.parent?.type !== "call_expression" &&
          // CGD34 (M37 #601, measured mem3.c/malloc.c/loadext.c): a bare
          // identifier DIRECTLY under function_definition is the NAME of a
          // phantom function recovered from a macro-mangled declaration —
          // `static SQLITE_WSD struct Mem3Global {` parses as a
          // function_definition whose direct children are
          // [storage_class, type_identifier(SQLITE_WSD), ERROR, identifier
          // (Mem3Global = the recovered "name"), compound_statement]. In
          // well-formed C a function name is always wrapped in a
          // function_declarator (suppressed via isDeclarationLikeIdentifier);
          // only error recovery produces the bare child, and reading it as a
          // value use fabricated `uses Mem3Global` sourced at the phantom
          // function itself.
          node.parent?.type !== "function_definition" &&
          // CGD31 (M37 #601, measured os_kv.c): a `field_identifier` LEAF
          // under a callee-position field_expression
          // (`sqlite3KvvfsMethods.xRcrdRead(...)`) fired a redundant `uses`
          // here — the call_expression branch already emits `calls
          // xRcrdRead` (isFuncPtr), and CGD17 gated only the field_expression
          // NODE, never its leaf (whose parent is field_expression, so the
          // rule above cannot see the call). Span-match the call's `function`
          // field exactly, as CGD17 does.
          !(node.parent?.type === "field_expression" &&
            node.parent.parent?.type === "call_expression" &&
            node.parent.parent.childForFieldName("function")?.startIndex === node.parent.startIndex &&
            // Only the FIELD leaf is a callee — the OBJECT leaf
            // (`sqlite3KvvfsMethods.xRcrdRead(...)` → sqlite3KvvfsMethods) is
            // a genuine value read of the table variable and must keep its
            // `uses` edge (CGD31 over-suppressed it on first draft,
            // measured missing `uses sqlite3KvvfsMethods` in os_kv.c).
            node.parent.childForFieldName("field")?.startIndex === node.startIndex
          ) &&
          // CGD37 (M37 #601, measured os_kv.c L363): when a designated
          // initializer's VALUE is itself an identifier, tree-sitter-c
          // parses `.xRcrdRead = kvrecordRead` as field_expression under
          // assignment_expression (not field_designator) — the designator
          // NAMES the field being initialized (a WRITE), so the leaf must
          // stay silent while the value side (`kvrecordRead`) still walks.
          // Mirrors CGD1's LHS-span test one level up (field_expression is
          // the assignment LHS here).
          !(node.parent?.type === "field_expression" &&
            node.parent.parent?.type === "assignment_expression" &&
            node.parent.parent.namedChild(0)?.startIndex === node.parent.startIndex &&
            (node.parent.parent.namedChild(0)?.endIndex ?? 0) >= node.parent.endIndex &&
            node.parent.childForFieldName("field")?.startIndex === node.startIndex
          ) &&
          // CGD1 (M37 #601): an assignment LHS is a WRITE, never a read —
          // plain and compound assignments both parse as
          // assignment_expression with the LHS as its first named child
          // (probe c-shapes1 P5). `g_counter += 1` / `g_counter = 5` leaked a
          // bogus `uses g_counter` (SCD1 class; C was the last unprobed
          // systems language for that sweep). Span-match the LHS exactly —
          // web-tree-sitter returns FRESH node objects per child() call, so
          // reference identity never matches (the DAD3 oracle lesson).
          !(node.parent?.type === "assignment_expression" &&
            node.parent.namedChild(0)?.startIndex === node.startIndex &&
            (node.parent.namedChild(0)?.endIndex ?? 0) >= node.endIndex) &&
          (this.isResolvableUseTarget(text, node.type, symbols, globalVars, structs, unions, enums, declaredTypes, declaredNames) || resolvesAsType) &&
          // CGD33 (M37 #601, measured jimsh0.c ×101 / libcmpp.c ×86): a
          // plain `identifier` that resolves ONLY as a TYPE declaration
          // (struct/union/enum tag or typedef alias — type maps, declaredTypes,
          // Type/Enum symbols) with NO value declaration cannot be a
          // legitimate value read in well-formed C (C has no first-class
          // type values; sizeof/cast/_Alignof positions are detected type
          // positions and re-routed to REFERENCES by CGD12/CGD28). Every
          // `uses <typeName>` emission is a parse artifact of macro-mangled
          // regions (jimsh0: 37/37 plain `Jim_Obj` identifiers sit inside
          // ERROR spans while the 1105 real uses parse as type_identifier).
          // Suppression mirrors the oracle's declaredNames-gated uses truth
          // and keeps the one-edge-per-semantic contract.
          !(node.type === "identifier" && !resolvesAsType && this.isTypeOnlyName(text, symbols, globalVars, structs, unions, enums, declaredTypes, declaredNames)) &&
          // #907 round 2: the NAME of a recovered glued definition is a
          // declaration of that name, never a read of it. Without this the use
          // path resolves the definition header's own identifier against the
          // symbol the recovery just added and fabricates a `uses` edge from the
          // enclosing function (F5 flagged exactly these; see gluedDefNameOffsets).
          !this.gluedDefNameOffsets.has(node.startIndex)
        ) {
          // Family contract (matches Java M12.01): a type identifier is a
          // REFERENCES edge (type usage); a value identifier (global var, enum
          // member) is a USES edge — never both for the same pair.
          const isTypeNode =
            resolvesAsType ||
            inArray(
              ["type_identifier", "struct_specifier", "union_specifier", "enum_specifier"],
              node.type,
            )
          const relKey = `${sourceScope}::${isTypeNode ? "ref" : "use"}::${text}`
          if (!emittedUseRelationships.has(relKey)) {
            emittedUseRelationships.add(relKey)
            relationships.push({
              source: sourceScope,
              target: text,
              type: isTypeNode ? ASTEngine.RelationshipType.References : ASTEngine.RelationshipType.Uses,
              confidence: isTypeNode ? 0.8 : 1.0,
              // M59.A7: the identifier node the name came from — a type
              // expression's start is not the line of the types inside it.
              line_number: this.nameLine(node),
              metadata: isTypeNode
                ? { relationshipType: "type_reference", nodeType: node.type }
                : { relationshipType: "identifier_usage", nodeType: node.type },
            })
          }
        }
      }

      // --- Recurse ---
      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
        if (child) {
          const isCond =
            isConditional ||
            inArray(["preproc_ifdef", "preproc_if", "preproc_elif", "preproc_else"], child.parent?.type || "")
          stack.push({ node: child, isConditional: isCond, isExit: false, pushedScope: false })
        }
      }
    }

    // Patterns
    if (
      (function (o) {
        for (let k in o) return true
        return false
      })(structs)
    )
      patterns["Structured Data Types"] = true
    if (
      (function (o) {
        for (let k in o) return true
        return false
      })(unions)
    )
      patterns["Memory-Efficient Unions"] = true
    if (
      (function (o) {
        for (let k in o) return true
        return false
      })(enums)
    )
      patterns["Enumerated Constants"] = true

    // Frameworks & Phantoms
    const frameworks = this.detectCFrameworks(imports)

    // 4. METRIC CALCULATION
    let security = 50
    let maintainability = 50

    if (mallocCount > 0 && freeCount > 0) {
      if (mallocCount === freeCount) security += 25
      else security += 10
    }

    if (hasUnsafeStrings) security -= 30
    if (hasSafeStrings) security += 15
    if (hasGotoStatements) maintainability -= 10
    if (hasVolatileQualifier) patterns["Hardware-Aware Code"] = true
    if (hasRestrictQualifier) patterns["Strict Aliasing Optimization"] = true
    if (hasInlineAsm) { security -= 15; maintainability -= 10 }
    if (hasSignalHandlers) patterns["Signal-Driven Architecture"] = true
    if (hasSetjmpLongjmp) { security -= 20; patterns["Non-Local Control Flow"] = true }
    if (hasVariableFormatString) security -= 25
    if (hasDangerousCalls) security -= 20
    if (hasAtomicTypes) patterns["Lock-Free Concurrency"] = true

    if (cyclomaticComplexity > 15) maintainability -= 20
    if (cyclomaticComplexity > 50) maintainability -= 30

    const score = Math.round((security + maintainability) / 2)
    const patternsArray = (function (o) {
      const arr: string[] = []
      for (let k in o) arr.push(k)
      return arr
    })(patterns)

    const insights: any[] = []

    // Post-loop: add contains for REAL container ownership only
    // (struct→field, union→field, enum→member). Top-level symbols carry the
    // synthetic scope name "global" — `global contains core_init` would be a
    // dangling edge (no symbol named `global` exists) and pollutes the graph,
    // matching the Java family ontology where contains is container→member.
    //
    // HC2 (holy-c second review): merge same-entity file-scope duplicates —
    // tentative definitions (`int x; int x;`), extern+definition pairs, and
    // prototype+definition pairs (`int f(int); int f(int){...}`) each emitted
    // one symbol PER OCCURRENCE (the prototype case even double-exported).
    // In one TU these are a single entity: keep the definition (a Function
    // without isDeclaration, a Variable with an initializer is still just a
    // Variable — first occurrence wins there), else the first occurrence.
    // Scoped/owned symbols (fields, members) are a different namespace and
    // never merge; cross-kind collisions (illegal C) are left alone.
    {
      const best = new Map<string, number>()
      const drop = new Set<number>()
      const isDefinition = (s: ASTEngine.UniversalSymbol): boolean =>
        !(s.metadata as any)?.isDeclaration
      for (let i = 0; i < symbols.length; i++) {
        const s = symbols[i]
        if (!s || (s as any).ownerName || s.scope !== "global") continue
        if (s.kind !== ASTEngine.SymbolKind.Function && s.kind !== ASTEngine.SymbolKind.Variable) continue
        const key = `${s.kind}::${s.name}`
        const prev = best.get(key)
        if (prev === undefined) {
          best.set(key, i)
        } else if (isDefinition(s) && !isDefinition(symbols[prev])) {
          drop.add(prev)
          best.set(key, i)
        } else {
          drop.add(i)
        }
      }
      if (drop.size > 0) {
        const kept = symbols.filter((_, i) => !drop.has(i))
        symbols.length = 0
        symbols.push(...kept)
      }
    }
    for (const s of symbols) {
      if (!s.ownerName) continue
      relationships.push({
        source: s.ownerName,
        target: s.name,
        type: ASTEngine.RelationshipType.Contains,
        confidence: 1.0,
        // M59.A7 (#825): a contains edge moves WITH its symbol — the child's own
        // declaration line, so the edge and the symbol range can never disagree
        // (the JVM lesson). Measured: 0/7,974 sqlite+jq symbols carry a name that
        // is absent from this line, so the contract's name-on-line rule holds.
        line_number: s.range?.startLine,
        metadata: {},
      })
    }

    // #383 payload attach: calls per enclosing function.
    for (const sym of symbols) {
      const qc = qcByFunction.get(sym.name)
      if (qc && qc.length > 0) sym.qualified_calls = [...new Set(qc)]
    }

    // #419-D evidence tiers on EVERY edge (family classifier).
    this.classifyEvidenceTier(relationships)

    return {
      language: "c",
      symbols,
      relationships,
      imports,
      exports: symbols.filter((s) => s.visibility === "public" && (s.kind === ASTEngine.SymbolKind.Function || s.kind === ASTEngine.SymbolKind.Variable)).map((s) => ({
        name: s.name,
        type: s.kind,
        range: s.range,
        isType: false,
      })),
      errors,
      metadata: {
        // REAL cyclomatic complexity - the old 'complexity' field was the
        // synthetic symbols+relationships heuristic (fifth analyzer with
        // that disease).
        complexity: cyclomaticComplexity,
        linesOfCode: content.split("\n").length,
        cyclomaticComplexity,
        framework: frameworks[0] || "Standard C",
        patterns: patternsArray,
        detectedFrameworks: frameworks,
        frameworkPatterns: [{ framework: frameworks[0] || "C", patterns: patternsArray }],
        architecturalInsights: insights,
        architecturalScore: Math.min(100, Math.max(0, score)),
        codeQuality: score >= 80 ? "Excellent" : score >= 60 ? "Good" : "Fair",
        hasTypeInference: false,
        hasFrameworkIntelligence: true,
        memorySafetyScore: Math.min(100, Math.max(0, security)),
        performanceScore: Math.min(100, Math.max(0, maintainability)),
        portabilityScore: 75,
        analysisVersion: "5.0-c-native-ast-pure-single-pass",
      },
    }
  }

  // --- O(1) Extractor Helpers ---

  /**
   * T1 family contract: 1 + decision points (branch constructs +
   * short-circuit operators; goto/labels are NOT decisions).
   */
  private functionComplexity(node: Node): number {
    const decisionTypes = new Set([
      "if_statement", "for_statement", "while_statement", "do_statement",
      "case_statement", "conditional_expression",
    ])
    let c = 1
    const st: Node[] = [node]
    while (st.length) {
      const n = st.pop()!
      if (decisionTypes.has(n.type)) c++
      else if (n.type === "binary_expression") {
        const op = n.childForFieldName("operator")?.text
        if (op === "&&" || op === "||") c++
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const ch = n.namedChild(i)
        if (ch) st.push(ch)
      }
    }
    return c
  }

  /**
   * #419-D evidence-tier classification for EVERY emitted relationship
   * (family rules).
   */
  private classifyEvidenceTier(relationships: ASTEngine.UniversalRelationship[]): void {
    for (const r of relationships) {
      const md = r.metadata ?? (r.metadata = {})
      if (md.evidenceClass) continue
      const t = String(r.type ?? "")
      const conf = typeof r.confidence === "number" ? r.confidence : 1
      if (t === "contains" || t === "exports") { md.evidenceClass = "structural"; continue }
      if (t === "references") {
        md.evidenceClass =
          md.includeDependency || md.isImport ? "import_based"
          : md.relationshipType === "type_reference" ? "reference_qualified"
          : "usage_contextual"
        continue
      }
      if (t === "extends" || t === "implements" || t === "overrides") {
        md.evidenceClass = conf >= 1 ? "structural" : conf >= 0.85 ? "usage_contextual" : "inferred"
        continue
      }
      if (t === "instantiates") { md.evidenceClass = "structural"; continue }
      md.evidenceClass = "usage_contextual"
    }
  }

  private findChild(node: Node, predicate: (child: Node) => boolean): Node | null {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (child && predicate(child)) return child
    }
    return null
  }

  private getIncludePath(node: Node): string | null {
    let pathNode = node.childForFieldName("path")
    // M49 W22 (measured sqlite3-wasm.c L262): tree-sitter-c parses a
    // macro-COMPOSED include argument (`#include INC__STRINGIFY(SQLITE_C)`)
    // as a call_expression under the same `path` field a literal path uses.
    // A composed path is not a statically resolvable header name (C-D2: the
    // preprocessor is textual; the expansion needs the build's -D set), so
    // it must not be emitted as an include_dependency target — mirrors the
    // oracle's CGD16 literal-only mirror. Literal forms (string_literal /
    // system_lib_string) keep every existing behavior.
    if (pathNode && pathNode.type !== "string_literal" && pathNode.type !== "system_lib_string") pathNode = null
    if (!pathNode) {
      pathNode = this.findChild(node, (c) => c?.type === "string_literal" || c?.type === "system_lib_string") || null
    }
    return pathNode ? stripIncludeChars(pathNode.text) : null
  }

  private extractInclude(node: Node, imports: ASTEngine.ImportInfo[], onPath: (path: string) => void) {
    let pathNode = node.childForFieldName("path")
    // M49 W22: same literal-only contract as getIncludePath — a
    // macro-composed include argument parses as a call_expression under the
    // `path` field and is not a resolvable module name.
    if (pathNode && pathNode.type !== "string_literal" && pathNode.type !== "system_lib_string") pathNode = null
    if (!pathNode) {
      pathNode = this.findChild(node, (c) => c?.type === "string_literal" || c?.type === "system_lib_string") || null
    }
    if (pathNode && pathNode.text.trim()) {
      const rawPath = pathNode.text
      const isSystem = rawPath[0] === "<"
      onPath(rawPath)
      imports.push({
        module: stripIncludeChars(rawPath),
        items: ["*"],
        range: this.nodeToRange(node),
        metadata: { isSystemInclude: isSystem, isImport: true },
      })
    }
  }

  private extractFunction(
    node: Node,
    content: string,
    symbols: ASTEngine.UniversalSymbol[],
    scope: string,
    isConditional: boolean,
  ): ASTEngine.UniversalSymbol | null {
    const declaratorNode = node.childForFieldName("declarator")
    const nameNode = this.getIdentifierFromDeclarator(declaratorNode)
    if (!nameNode) return null

    const isStatic = this.hasStorageClass(node, "static")
    const isInline = this.hasStorageClass(node, "inline")
    let usesPointers = this.isPointerType(declaratorNode)

    let returnTypeNode =
      node.childForFieldName("type") ||
      this.findChild(node, (c) =>
        inArray(
          [
            "primitive_type",
            "type_identifier",
            "sized_type_specifier",
            "struct_specifier",
            "enum_specifier",
            "union_specifier",
          ],
          c?.type || "",
        ),
      )

    const parameters: ASTEngine.Parameter[] = []

    // Deeper parameter scan without crashing loops
    let pList = this.findFirstChildOfType(declaratorNode, "parameter_list")

    if (pList) {
      for (let i = 0; i < pList.namedChildCount; i++) {
        const paramNode = pList.namedChild(i)
        // HC3 (holy-c second review): K&R / untyped parameter names parse
        // as bare identifiers (`int add(a, b)`), which the scan skipped —
        // the params payload lost them (names also feed functionLocals via
        // the K&R declaration path, so reads were already correct; this
        // completes the payload with an honest `any` type).
        if (paramNode && paramNode.type === "identifier") {
          if (paramNode.text.trim()) parameters.push({ name: paramNode.text, type: "any" })
          continue
        }
        if (paramNode && (paramNode.type === "parameter_declaration" || paramNode.type === "variadic_parameter")) {
          if (paramNode.type === "variadic_parameter") {
            parameters.push({ name: "...", type: "variadic", modifiers: [] })
            continue
          }
          const typeNode = paramNode.childForFieldName("type")
          const pDeclNode = this.getIdentifierFromDeclarator(paramNode.childForFieldName("declarator"))
          let paramType = typeNode ? typeNode.text : "any"
          const isFuncPtr = paramNode.text.includes("(*") || paramNode.text.includes("(^") || !!this.findFirstChildOfType(paramNode.childForFieldName("declarator"), "function_declarator")
          if (isFuncPtr) paramType = "function_pointer"
          
          parameters.push({
            name: pDeclNode ? pDeclNode.text : "unknown",
            type: paramType,
          })
          if (this.isPointerType(paramNode.childForFieldName("declarator"))) {
            usesPointers = true
          }
        }
      }
    }

    const symbol: ASTEngine.UniversalSymbol = {
      name: nameNode.text,
      kind: ASTEngine.SymbolKind.Function,
      range: this.recoverFunctionRange(node, content),
      scope: "global",
      complexity: this.functionComplexity(node),
      visibility: isStatic ? "private" : "public",
      isStatic,
      returnType: returnTypeNode ? returnTypeNode.text : "any",
      parameters,
      metadata: { cSpecific: true, usesPointers, isInline, isConditional },
    }

    symbols.push(symbol)
    return symbol
  }

  private extractStruct(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    structs: Record<string, any[]>,
    unions: Record<string, any[]>,
    is64Bit: boolean,
    isLLP64: boolean,
    scope: string,
    isConditional: boolean,
  ) {
    const nameNode = node.childForFieldName("name")
    let structName = "anonymous_struct"
    if (nameNode && nameNode.text.trim()) {
      structName = nameNode.text
    } else if (node.parent && node.parent.type === "type_definition") {
      const declNode = this.getIdentifierFromDeclarator(node.parent.childForFieldName("declarator"))
      if (declNode && declNode.text.trim()) structName = declNode.text.trim()
    }
    // A struct_specifier without a body is a forward/reference declaration
    // (e.g. `typedef struct Point Point;` or `struct Point *p;`). It is not a
    // definition site — skip it to avoid phantom duplicates; the definition
    // with a body emits the symbol once.
    if (!node.childForFieldName("body")) return
    const isPacked = this.isPacked(node)

    const fields: any[] = []
    const bodyList = node.childForFieldName("body")
    if (bodyList) {
      for (let i = 0; i < bodyList.namedChildCount; i++) {
        const field = bodyList.namedChild(i)
        if (field && field.type === "field_declaration") {
          let typeNode =
            field.childForFieldName("type") ||
            this.findChild(field, (c) =>
              inArray(
                [
                  "primitive_type",
                  "type_identifier",
                  "sized_type_specifier",
                  "struct_specifier",
                  "enum_specifier",
                  "union_specifier",
                ],
                c?.type || "",
              ),
            )

          for (let j = 0; j < field.childCount; j++) {
            const rawDecl = field.child(j)
            if (
              rawDecl &&
              !inArray(
                [
                  "primitive_type",
                  "type_identifier",
                  ";",
                  "type_qualifier",
                  "storage_class_specifier",
                  "sized_type_specifier",
                  "struct_specifier",
                  "union_specifier",
                  "enum_specifier",
                  ",",
                  "bitfield_clause",
                ],
                rawDecl.type,
              )
            ) {
              let arraySize = 1
              let isPointer = this.isPointerType(rawDecl)
              let declNode: Node | null = rawDecl

              while (declNode && declNode.type !== "field_identifier" && declNode.type !== "identifier") {
                if (declNode.type === "array_declarator") {
                  const sizeNode =
                    declNode.childForFieldName("size") || this.findChild(declNode, (c) => c?.type === "number_literal")
                  if (sizeNode && !isNaN(parseInt(sizeNode.text))) arraySize *= parseInt(sizeNode.text)
                }
                declNode = declNode.childForFieldName("declarator") || declNode.namedChild(0)
              }

              if (declNode && declNode.text.trim()) {
                fields.push({ name: declNode.text, type: typeNode ? typeNode.text : "unknown", arraySize, isPointer })
                symbols.push({
                  name: declNode.text,
                  kind: ASTEngine.SymbolKind.Property,
                  range: this.nodeToRange(rawDecl),
                  scope: structName,
                  ownerName: structName,
                  ownerKind: ASTEngine.SymbolKind.Type,
                  visibility: "public",
                  metadata: { isStructField: true, cSpecific: true, isConditional },
                })
              }
            }
          }
        }
      }
    }

    if (structName !== "anonymous_struct") {
      structs[structName] = fields
    }

    symbols.push({
      name: structName,
      kind: ASTEngine.SymbolKind.Struct,
      range: this.nodeToRange(node),
      scope: scope,
      visibility: "public",
      metadata: {
        isStruct: true,
        cSpecific: true,
        isPacked,
        isConditional,
        memorySize: this.calculateMemorySize(fields, isPacked, structs, unions, is64Bit, isLLP64),
        alignment: this.calculateAlignment(fields, structs, unions, is64Bit, isLLP64),
      },
    })
  }

  private extractUnion(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    unions: Record<string, any[]>,
    scope: string,
    isConditional: boolean,
  ) {
    const nameNode = node.childForFieldName("name")
    let unionName = "anonymous_union"
    if (nameNode && nameNode.text.trim()) {
      unionName = nameNode.text
    } else if (node.parent && node.parent.type === "type_definition") {
      const declNode = this.getIdentifierFromDeclarator(node.parent.childForFieldName("declarator"))
      if (declNode && declNode.text.trim()) unionName = declNode.text.trim()
    }

    const fields: any[] = []
    const bodyList = node.childForFieldName("body")
    if (bodyList) {
      for (let i = 0; i < bodyList.namedChildCount; i++) {
        const field = bodyList.namedChild(i)
        if (field && field.type === "field_declaration") {
          let typeNode =
            field.childForFieldName("type") ||
            this.findChild(field, (c) =>
              inArray(
                [
                  "primitive_type",
                  "type_identifier",
                  "sized_type_specifier",
                  "struct_specifier",
                  "enum_specifier",
                  "union_specifier",
                ],
                c?.type || "",
              ),
            )

          for (let j = 0; j < field.childCount; j++) {
            const rawDecl = field.child(j)
            if (
              rawDecl &&
              !inArray(
                [
                  "primitive_type",
                  "type_identifier",
                  ";",
                  "type_qualifier",
                  "storage_class_specifier",
                  "sized_type_specifier",
                  "struct_specifier",
                  "union_specifier",
                  "enum_specifier",
                  ",",
                  "bitfield_clause",
                ],
                rawDecl.type,
              )
            ) {
              let arraySize = 1
              let isPointer = this.isPointerType(rawDecl)
              let declNode: any = rawDecl

              while (declNode && declNode.type !== "field_identifier" && declNode.type !== "identifier") {
                if (declNode.type === "array_declarator") {
                  const sizeNode =
                    declNode.childForFieldName("size") ||
                    this.findChild(declNode, (c: any) => c?.type === "number_literal")
                  if (sizeNode && !isNaN(parseInt(sizeNode.text))) arraySize *= parseInt(sizeNode.text)
                }
                declNode = declNode.childForFieldName("declarator") || declNode.namedChild(0)
              }

              if (declNode && declNode.text.trim()) {
                fields.push({ name: declNode.text, type: typeNode ? typeNode.text : "unknown", arraySize, isPointer })
                symbols.push({
                  name: declNode.text,
                  kind: ASTEngine.SymbolKind.Property,
                  range: this.nodeToRange(rawDecl),
                  scope: unionName,
                  ownerName: unionName,
                  ownerKind: ASTEngine.SymbolKind.Type,
                  visibility: "public",
                  metadata: { isUnionField: true, cSpecific: true, isConditional },
                })
              }
            }
          }
        }
      }
    }

    if (unionName !== "anonymous_union") {
      unions[unionName] = fields
    }

    symbols.push({
      name: unionName,
      kind: ASTEngine.SymbolKind.Type,
      range: this.nodeToRange(node),
      scope: scope,
      visibility: "public",
      metadata: { isUnion: true, cSpecific: true, isConditional },
    })
  }

  private extractEnum(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    enums: Record<string, boolean>,
    scope: string,
    isConditional: boolean,
  ) {
    const nameNode = node.childForFieldName("name")
    let enumName = nameNode && nameNode.text.trim() ? nameNode.text : "anonymous_enum"
    // Anonymous `typedef enum { ... } Name;` — name the enum from the typedef
    // declarator so the symbol identity is the exported type name.
    if (enumName === "anonymous_enum" && node.parent && node.parent.type === "type_definition") {
      const declNode = this.getIdentifierFromDeclarator(node.parent.childForFieldName("declarator"))
      if (declNode && declNode.text.trim()) enumName = declNode.text.trim()
    }
    enums[enumName] = true

    const values: string[] = []
    let hasExplicitValues = false
    let isFlagEnum = false

    let listNode = node.childForFieldName("body") || this.findFirstChildOfType(node, "enumerator_list")

    if (listNode) {
      for (let i = 0; i < listNode.namedChildCount; i++) {
        const enumerator = listNode.namedChild(i)
        if (enumerator && enumerator.type === "enumerator") {
          const enumNameNode = enumerator.childForFieldName("name") || enumerator.namedChild(0)

          if (enumNameNode && enumNameNode.text.trim()) {
            values.push(enumNameNode.text)

            const valueNode = enumerator.childForFieldName("value")
            if (valueNode) {
              hasExplicitValues = true
              if (
                this.findFirstChildOfType(
                  valueNode,
                  "binary_expression",
                  (n) => n.childForFieldName("operator")?.text === "<<",
                )
              ) {
                isFlagEnum = true
              }
            }

            symbols.push({
              name: enumNameNode.text,
              kind: ASTEngine.SymbolKind.EnumMember,
              range: this.nodeToRange(enumerator),
              scope: enumName,
              ownerName: enumName,
              ownerKind: ASTEngine.SymbolKind.Enum,
              visibility: "public",
              metadata: { isEnumValue: true, cSpecific: true, isConditional },
            })
          }
        }
      }
    }

    symbols.push({
      name: enumName,
      kind: ASTEngine.SymbolKind.Enum,
      range: this.nodeToRange(node),
      scope: scope,
      visibility: "public",
      metadata: { isEnum: true, cSpecific: true, values, hasExplicitValues, isFlagEnum, isConditional },
    })
  }

  private extractDeclaration(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    globalVars: Record<string, boolean>,
    scope: string,
    isGlobal: boolean,
    isConditional: boolean,
  ) {
    const isStatic = this.hasStorageClass(node, "static")

    // Function-local declarations (variables inside function bodies) are
    // execution artifacts, not declaration sites — only file/global-scope
    // declarations become symbols.
    if (!isGlobal) return

    // CGD19 (M37 #601): an ERROR ancestor that glues a FUNCTION HEADER to a
    // body makes the following top-level declarations mis-scope as
    // file-scope when they are really function locals (measured:
    // tokenize.c — `int sqlite3RunParser(Parse*, const char*){ int nErr =
    // 0; ...` recovers with the header inside the ERROR span, so `nErr`,
    // `pEngine`, `db`, `lastTokenParsed`, ... leaked as Variable symbols
    // even though they are locals of sqlite3RunParser). Discriminator: the
    // innermost ERROR that contains this declaration must itself contain a
    // function_definition or a declaration whose declarator is a
    // function_declarator — i.e. the recovery swallowed a function HEADER.
    // Real declarations inside a big ERROR-swallowed REGION (status.c: the
    // SQLITE_WSD static struct recovery spans L31-L446 but contains no
    // glued function header before its declarations) stay extracted —
    // blanket ERROR exclusion would drop 13 real symbols there.
    // PERF (measured regression): walking the ERROR subtree per declaration
    // crossed the WASM boundary millions of times on big files (vdbe.c
    // 3.6s/file, differential timeout) — the verdict is memoized PER ERROR
    // span (keyed by startIndex) and answered per declaration by position.
    if (this.isCgd19SuppressedVarDecl(node)) return

    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (
        child &&
        inArray(
          ["init_declarator", "identifier", "pointer_declarator", "array_declarator", "function_declarator"],
          child.type,
        )
      ) {
        let isFuncType = false
        let c: Node | null = child
        while (c) {
          if (c.type === "function_declarator") {
            isFuncType = true
            const innerDecl = c?.childForFieldName("declarator")
            if (innerDecl && innerDecl.type === "parenthesized_declarator") {
              isFuncType = false // function pointer
            }
            break
          }
          c = c?.childForFieldName("declarator") || (c.namedChildCount > 0 ? c.namedChild(0) : null)
        }
        let declNode = this.getIdentifierFromDeclarator(child)

        if (declNode && declNode.text.trim()) {
          if (isFuncType) {
            symbols.push({
              name: declNode.text,
              kind: ASTEngine.SymbolKind.Function,
              range: this.nodeToRange(node),
              scope: isGlobal ? "global" : scope,
              // HC1 (holy-c second review): the prototype branch hardcoded
              // public — a `static` prototype leaked as public API AND into
              // the export list, while a static DEFINITION is private.
              visibility: isStatic ? "private" : "public",
              metadata: { isDeclaration: true, cSpecific: true, isConditional },
            })
          } else {
            if (isGlobal) globalVars[declNode.text] = true
            symbols.push({
              name: declNode.text,
              kind: ASTEngine.SymbolKind.Variable,
              range: this.nodeToRange(child),
              scope: isGlobal ? "global" : scope,
              visibility: isStatic ? "private" : "public",
              metadata: { isVariable: true, cSpecific: true, isGlobal, isConditional },
            })
          }
        }
      }
    }
  }

  private extractTypedef(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    structs: Record<string, any[]>,
    scope: string,
    isConditional: boolean,
  ) {
    const identNode = this.getIdentifierFromDeclarator(node.childForFieldName("declarator"))
    if (!identNode || !identNode.text.trim()) return
    const typeName = identNode.text

    // The typedef alias points at a struct/union/enum specifier.
    const specNode = this.findChild(node, (c) =>
      inArray(["struct_specifier", "union_specifier", "enum_specifier"], c?.type || ""),
    )
    if (specNode) {
      const specNameNode = specNode.childForFieldName("name")
      const specName = specNameNode && specNameNode.text.trim() ? specNameNode.text.trim() : null
      // Anonymous definition (`typedef struct {...} Buffer;`): the struct/union/
      // enum extractor already emitted the symbol under the typedef name — do
      // not emit a duplicate type alias.
      if (!specName) return
      // Self-alias (`typedef struct Point Point;`): identical identity — skip
      // the redundant alias symbol; the struct definition is the declaration.
      if (specName === typeName) return
    }

    symbols.push({
      name: typeName,
      kind: ASTEngine.SymbolKind.Type,
      range: this.nodeToRange(node),
      scope: scope,
      visibility: "public",
      metadata: { isTypedef: true, cSpecific: true, isConditional },
    })
  }

  private extractMacro(node: Node, symbols: ASTEngine.UniversalSymbol[], isConditional: boolean) {
    const nameNode = node.childForFieldName("name")
    if (!nameNode || !nameNode.text.trim()) return

    const isFunctionLikeMacro = node.type === "preproc_function_def"

    // #901 (M60, measured on the sqlite pin): a `#define NAME` with no value body
    // was skipped entirely — the old comment called these "include guards ... file
    // artifacts, not symbols". The intent was guard-noise reduction; the CODE was
    // body-based, so it skipped EVERY value-less define, including macros that are
    // later READ in expression position. Measured: `SQLITE_EXTENSION_INIT1;`
    // (ext/misc/basexx.c L40, where the define sits at L48) and `SQLITE_TCLAPI`
    // between the return type and the function name (src/tclsqlite.c L277, defined
    // by a `#ifndef SQLITE_TCLAPI / #define SQLITE_TCLAPI` pair at L43-45) are both
    // real reads the F5 truth counts — the c lane was the only 100%-coverage lane
    // in the sweep with MISSING=2, both edges of this shape.
    //
    // The rule is now the honest one: a `#define` DECLARES a name whatever its
    // body, exactly as the pre-pass already treated macro names
    // (`isMacroName` never looked at the body). Minting the symbol is what makes
    // the read resolvable; the alternative — leaving the name unresolvable so the
    // read stays silent — is a missing true edge, and the family's contract is
    // that a missing edge is a defect while a DECLARATION is not an edge.
    // Measured blast radius: 30 value-less defines across sqlite's src/*.c +
    // ext/misc/*.c, each now one Constant symbol (object-like, the same kind a
    // VALUED object-like macro gets — `MAXN` is a Constant, only function-like
    // macros are Macro-kind), no new edge unless the name is genuinely read.
    // Include guards are therefore minted too; they cost one symbol per guarded
    // file and produce no edge, which is the right trade for not losing reads.

    const parameters: ASTEngine.Parameter[] = []
    if (isFunctionLikeMacro) {
      const paramsNode = node.childForFieldName("parameters") || this.findFirstChildOfType(node, "preproc_params")
      if (paramsNode) {
        for (let i = 0; i < paramsNode.childCount; i++) {
          const param = paramsNode.child(i)
          if (param && param.isNamed) {
            parameters.push({ name: param.text, type: "any" })
          } else if (param && (param.type === "..." || param.text === "...")) {
            parameters.push({ name: "...", type: "variadic", modifiers: [] })
          }
        }
      }
    }

    symbols.push({
      name: nameNode.text,
      kind: isFunctionLikeMacro ? ASTEngine.SymbolKind.Macro : ASTEngine.SymbolKind.Constant,
      range: this.nodeToRange(node),
      scope: "global",
      visibility: "public",
      parameters: isFunctionLikeMacro ? parameters : undefined,
      metadata: { isMacro: true, isFunctionLikeMacro, cSpecific: true, isConditional },
    })
  }

  // --- Shallow Memory Math ---
  private calculateMemorySize(
    fields: any[],
    isPacked: boolean,
    structs: Record<string, any[]>,
    unions: Record<string, any[]>,
    is64Bit: boolean,
    isLLP64: boolean,
    isUnion: boolean = false,
  ): number {
    let currentOffset = 0
    let maxAlign = 1
    let maxSize = 0
    const ptrSize = is64Bit ? 8 : 4
    const longSize = is64Bit && !isLLP64 ? 8 : 4

    for (let i = 0; i < fields.length; i++) {
      const field = fields[i]
      const type = field.type
      let fieldSize = 4
      let align = 4

      if (field.isPointer) {
        fieldSize = ptrSize
        align = ptrSize
      } else if (inArray(["char", "int8_t", "uint8_t", "bool"], type)) {
        fieldSize = 1
        align = 1
      } else if (inArray(["short", "int16_t", "uint16_t"], type)) {
        fieldSize = 2
        align = 2
      } else if (inArray(["long"], type)) {
        fieldSize = longSize
        align = longSize
      } else if (inArray(["double", "int64_t", "uint64_t", "size_t", "ssize_t"], type)) {
        fieldSize = 8
        align = 8
      } else if (structs[type]) {
        fieldSize = this.calculateMemorySize(structs[type], false, structs, unions, is64Bit, isLLP64, false)
        align = this.calculateAlignment(structs[type], structs, unions, is64Bit, isLLP64)
      } else if (unions[type]) {
        fieldSize = this.calculateMemorySize(unions[type], false, structs, unions, is64Bit, isLLP64, true)
        align = this.calculateAlignment(unions[type], structs, unions, is64Bit, isLLP64)
      }

      if (isPacked) align = 1
      maxAlign = Math.max(maxAlign, align)

      const totalFieldSize = fieldSize * (field.arraySize || 1)
      if (isUnion) {
        maxSize = Math.max(maxSize, totalFieldSize)
      } else {
        const padding = (align - (currentOffset % align)) % align
        currentOffset += padding + totalFieldSize
      }
    }

    if (isUnion) {
      currentOffset = maxSize
    }

    if (!isPacked && maxAlign > 1) {
      currentOffset += (maxAlign - (currentOffset % maxAlign)) % maxAlign
    }
    return currentOffset
  }

  private calculateAlignment(
    fields: any[],
    structs: Record<string, any[]>,
    unions: Record<string, any[]>,
    is64Bit: boolean,
    isLLP64: boolean,
  ): number {
    let align = 1
    for (let i = 0; i < fields.length; i++) {
      const field = fields[i]
      if (field.isPointer || inArray(["size_t", "ssize_t"], field.type)) align = Math.max(align, is64Bit ? 8 : 4)
      else if (field.type === "long") align = Math.max(align, is64Bit && !isLLP64 ? 8 : 4)
      else if (inArray(["double", "int64_t", "uint64_t"], field.type)) align = Math.max(align, 8)
      else if (inArray(["int", "float", "int32_t", "uint32_t"], field.type)) align = Math.max(align, 4)
      else if (inArray(["short", "int16_t", "uint16_t"], field.type)) align = Math.max(align, 2)
      else if (structs[field.type])
        align = Math.max(align, this.calculateAlignment(structs[field.type], structs, unions, is64Bit, isLLP64))
      else if (unions[field.type])
        align = Math.max(align, this.calculateAlignment(unions[field.type], structs, unions, is64Bit, isLLP64))
    }
    return align
  }

  // --- Safe Shallow Helpers ---

  private getIdentifierFromDeclarator(node: Node | null): Node | null {
    let current = node
    while (current && !inArray(["identifier", "field_identifier", "type_identifier"], current.type)) {
      current = current.childForFieldName("declarator") || current.namedChild(0)
    }
    return current
  }

  /**
   * CGD7 (M37 #601): names actually BOUND by a local declaration — the
   * declarator identifiers of its init_declarator children, plus bare
   * declarator identifiers. NOT the RHS initializer identifiers: `int y = g;`
   * must bind only `y`. Binding `g` (the old collectDeclaredIdentifiers
   * behavior) suppressed every later genuine read of `g` in the function.
   */
  private collectBoundLocals(node: Node): string[] {
    const names: string[] = []
    const seen: Record<string, boolean> = {}
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (!child) continue
      if (
        inArray(
          ["init_declarator", "identifier", "pointer_declarator", "array_declarator", "function_declarator"],
          child.type,
        )
      ) {
        // For init_declarator the declarator (first named child chain) is the
        // bound name; the `value` field is the initializer and is excluded.
        const decl =
          child.type === "init_declarator"
            ? this.getIdentifierFromDeclarator(child.childForFieldName("declarator"))
            : this.getIdentifierFromDeclarator(child)
        if (decl && decl.text.trim() && !seen[decl.text]) {
          seen[decl.text] = true
          names.push(decl.text)
        }
      }
    }
    return names
  }

  // CGD19 PERF memo: per-ERROR-span verdict (last glued function-header
  // position, or -1 when the span holds no glued header). Keyed by the
  // span's startIndex; lives for the lifetime of one analyze() call.
  private cgd19HeaderIdx = new Map<number, number>()

  // #907 round 2: startIndex of every NAME that recoverGluedDefinitionHeader
  // emitted this file. The use path reads a bare identifier under an ERROR as a
  // read, which is right for the swallowed body's real references and wrong for
  // the definition header's own name — F5 measured the fabrication this way:
  // `decNumberPower uses decNumberQuantize` at the header's own line
  // (vendor/decNumber/decNumber.c L2284/2304/2306) and the os_win.c dispatch
  // table's `uses winRead` / `uses winWrite` pair. This set is what tells the
  // two apart, and it is filled before those identifiers are walked because the
  // ERROR node is processed before its children are pushed.
  private gluedDefNameOffsets = new Set<number>()

  // CGD19 (M37 #601): positional ERROR-span discriminator for VARIABLE
  // declarations. The innermost ERROR ancestor containing `node` is scanned
  // ONCE (memoized per span by startIndex): glue = the FIRST
  // function_definition OR bare function_declarator (direct ERROR child).
  // Everything declared AFTER that glue is body text of the glued function
  // (tokenize.c sqlite3RunParser locals) and must not surface as file-scope
  // symbols. Prototypes (function_declarator inside a declaration wrapper)
  // are NOT glue — os_win.c's winMemMalloc/... are real file-scope names —
  // and function NAMES declare regardless (extractFunction path). status.c
  // (big recovery region, no glue) keeps all 13 real symbols.
  private isCgd19SuppressedVarDecl(node: Node): boolean {
    let cur: Node | null = node
    let innermostError: Node | null = null
    while (cur) {
      if (cur.type === "ERROR") innermostError = cur
      cur = cur.parent
    }
    if (!innermostError) return false
    const key = innermostError.startIndex
    let headerIdx = this.cgd19HeaderIdx.get(key)
    if (headerIdx === undefined) {
      headerIdx = -1
      const st: Node[] = [innermostError]
      const errStart0 = innermostError.startIndex
      const errEnd0 = innermostError.endIndex
      while (st.length > 0) {
        const m = st.pop()!
        // POSITION comparison (KAD2/TSD2 class, hygiene F7): web-tree-sitter
        // hands out fresh wrappers per access, so object identity only ever
        // holds for the very root object we pushed — compare spans to skip it.
        const isSpanRoot = m.startIndex === errStart0 && m.endIndex === errEnd0
        if (!isSpanRoot) {
          if (m.type === "function_definition") {
            if ((headerIdx as number) < 0 || m.startIndex < (headerIdx as number)) headerIdx = m.startIndex
          } else if (m.type === "function_declarator") {
            // BARE fd = no declaration/function_definition wrapper between
            // the fd and the ERROR span (tokenize.c: direct child; jimsh0.c:
            // nested inside preproc_ifdef < ERROR — the direct-child test
            // missed it and 80+ post-glue locals leaked as globals). An fd
            // inside a declaration wrapper is an ordinary prototype
            // (os_win.c L331 winMemMalloc) — NOT glue. POSITION comparison
            // throughout: web-tree-sitter recreates node objects per access
            // and object identity NEVER holds (the same trap that broke the
            // direct-child test).
            let w: Node | null = m
            let bare = true
            const errStart = innermostError.startIndex
            const errEnd = innermostError.endIndex
            while (w) {
              if (w.startIndex === errStart && w.endIndex === errEnd) break
              if (w.type === "declaration" || w.type === "function_definition") {
                bare = false
                break
              }
              w = w.parent
            }
            if (bare && w) {
              if ((headerIdx as number) < 0 || m.startIndex < (headerIdx as number)) headerIdx = m.startIndex
            }
          }
        }
        for (let k = 0; k < m.namedChildCount; k++) {
          const c = m.namedChild(k)
          if (c) st.push(c)
        }
      }
      this.cgd19HeaderIdx.set(key, headerIdx as number)
    }
    return (headerIdx as number) >= 0 && node.startIndex > (headerIdx as number)
  }

  // HC6: is this identifier inside a parameter list? Parameter names
  // (prototype or definition) are bound by the function, never file-scope
  // declarations — they must not enter the declaredNames pre-pass.
  private isInsideParameterList(node: Node): boolean {
    let cur: Node | null = node.parent
    while (cur) {
      const t: string = cur.type
      if (t === "parameter_list" || t === "parameter_declaration") return true
      if (t === "function_definition" || t === "declaration") return false
      cur = cur.parent
    }
    return false
  }

  // CGD11: preprocessor CONDITION text vs conditional CODE. An identifier
  // is directive text iff the path from it to the first preproc_* ancestor
  // passes through no code container node. `#if (X>0)` → expression chain
  // only → text; `int y = F_OK;` inside #ifndef → init_declarator on path
  // → code. Mirrors the differential oracle exactly (one contract).
  private isDirectiveConditionText(node: Node): boolean {
    let cur: Node | null = node.parent
    while (cur) {
      const t: string = cur.type
      // ≡ /statement|declaration|definition|declarator|specifier|enumerator|compound/ — unanchored alternation ≡ includes() per disjunct.
      if (
        t.includes("statement") ||
        t.includes("declaration") ||
        t.includes("definition") ||
        t.includes("declarator") ||
        t.includes("specifier") ||
        t.includes("enumerator") ||
        t.includes("compound")
      ) return false
      if (t.startsWith("preproc_")) return true
      cur = cur.parent
    }
    return false
  }

  // #901: is `node` the NAME field of a macro definition (`#define NAME ...`
  // or `#define NAME(...) ...`)? Field-identity by SPAN (web-tree-sitter
  // hands back fresh node objects per property access — the KAD2/TSD2 lesson
  // cited in isGlueFdName), not by object identity. A macro body is an
  // opaque preproc_arg (C-D2) and never the name field, so this cannot admit
  // a body mention; `#undef NAME` is a preproc_call with no name field, so it
  // cannot admit an undef target either (the oracle does not treat `#undef`
  // as a declaration).
  private isMacroDefinitionName(node: Node): boolean {
    const p = node.parent
    if (!p) return false
    if (p.type !== "preproc_def" && p.type !== "preproc_function_def") return false
    const nameNode = p.childForFieldName("name")
    if (!nameNode) return false
    return nameNode.startIndex === node.startIndex && nameNode.endIndex === node.endIndex
  }

  // CGD40-mirror helper (see the use-emission gate): the C preprocessor is
  // line-anchored text (C-D2). A mention whose PHYSICAL source line starts
  // with '#' is directive text even when parse recovery spliced the node
  // into surviving code containers (no preproc_* ancestor remains for
  // isDirectiveConditionText). One lastIndexFrom(0) per mention — measured
  // negligible on the vdbe.c perf budget.
  private analyzeContent = ""
  private isHashLineMention(node: Node): boolean {
    const bol = this.analyzeContent.lastIndexOf("\n", node.startIndex - 1) + 1
    let i = bol
    while (i < node.startIndex && (this.analyzeContent[i] === " " || this.analyzeContent[i] === "\t")) i++
    return this.analyzeContent[i] === "#"
  }

  // CGD12: is this plain `identifier` really a TYPE position? The pinned
  // grammar parses `sizeof(VfslogFile)` and C++-style template args as a
  // bare identifier chain; the honest classification is the first
  // code-container ancestor. If we reach a sizeof_expression (or the type
  // slot of a cast/type_descriptor) before any statement/declaration
  // container, the identifier names a type.
  private isTypePositionIdentifier(node: Node): boolean {
    let cur: Node | null = node.parent
    while (cur) {
      const t: string = cur.type
      if (t === "sizeof_expression") return true
      if (t === "cast_expression") {
        // CGD28 (M37 #601): only the cast's TYPE OPERAND is a type position
        // — `(i64)x` → i64 yes, x no. The VALUE operand is the LAST named
        // child of the cast_expression; anything starting before it sits in
        // the type operand. (Measured hole: `(sqlite3_syscall_ptr)ts_open`
        // — the function-name VALUE must stay a `uses` read, test_syscall.c
        // syscall tables.)
        const kids: (Node | null)[] = []
        for (let i = 0; i < cur.namedChildCount; i++) kids.push(cur.namedChild(i))
        const valid = kids.filter((k): k is Node => !!k)
        if (valid.length >= 2) {
          const value = valid[valid.length - 1]
          return node.startIndex < value.startIndex
        }
        return false
      }
      // ≡ /statement|declaration|declarator|specifier|enumerator|compound|argument_list|init/ — includes() per disjunct ("init" also hits init_declarator, as before).
      if (
        t.includes("statement") ||
        t.includes("declaration") ||
        t.includes("declarator") ||
        t.includes("specifier") ||
        t.includes("enumerator") ||
        t.includes("compound") ||
        t.includes("argument_list") ||
        t.includes("init")
      ) return false
      cur = cur.parent
    }
    return false
  }

  // CGD12-mirror (M37 #601): within a declarator-chain parent, only the
  // LEFTMOST identifier declares. `int x = F_OK;` parses as declaration >
  // init_declarator with children [declarator(x), value(F_OK)] — the old
  // any-child rule treated the initializer VALUE as declaring too, so the
  // read was suppressed and the edge never emitted (measured: F_OK in
  // test_demovfs, pTestCollateInterp in test1.c, and the
  // `*(*const autolockIoFinder)(...) = autolockIoFinderImpl` value in
  // os_unix.c were all silent while the oracle derived truth → MISSING).
  // Same chain walk as the oracle's isDeclaringIdentifier (one contract).
  private isDeclaringChainLeftmost(node: Node): boolean {
    const p = node.parent
    // ≡ /declarator$/ — matches declarator, init_declarator, abstract_declarator, field_declarator, …
    if (!p || !p.type.endsWith("declarator")) return false
    let cur: Node | null = p
    while (cur) {
      if (cur.type === "identifier" || cur.type === "field_identifier") {
        return cur.startIndex === node.startIndex
      }
      let next: Node | null = null
      for (let k = 0; k < cur.namedChildCount; k++) {
        const c = cur.namedChild(k)
        if (c && (c.type.endsWith("declarator") || c.type === "identifier" || c.type === "field_identifier")) {
          next = c
          break
        }
      }
      cur = next
    }
    return false
  }

  private isDeclarationLikeIdentifier(node: Node): boolean {
    const p = node.parent
    if (!p) return false
    // CGD35 (M37 #601, measured showwal.c/fossildelta.c/showdb.c ×15): a
    // TYPE_identifier inside a declaration/parameter is a USE of the type,
    // never the declaring occurrence — the NAME of a typedef alias or struct
    // tag parses as type_identifier (the grammar tracks in-file typedefs),
    // and only the alias/TAG declaration itself (declaredTypes pre-pass) is
    // the declaration. The old any-parent rule classified `i64 x` / the
    // return type of `static i64 f(...)` as "declaring", suppressing the
    // references-truth the oracle derives (`typedef long long int i64;` in
    // showwal.c → every real `i64` read vanished → references i64 missing).
    // Mirrors the oracle's isDeclaringIdentifier exclusion exactly
    // (`if (n.type === "type_identifier") return false`).
    if (node.type === "type_identifier") return false
    const declParents = [
      "declaration",
      "parameter_declaration",
      "field_declaration",
      "init_declarator",
      "function_declarator",
      "pointer_declarator",
      "array_declarator",
      "type_definition",
      "enumerator",
      "preproc_def",
      "preproc_function_def",
    ]
    if (!inArray(declParents, p.type)) return false
    // CGD12-mirror: within a declarator-chain parent only the leftmost
    // identifier declares — an initializer value is a READ (see
    // isDeclaringChainLeftmost for the measured defects).
    // ≡ /declarator$/ (endsWith — same match set as above).
    if (p.type.endsWith("declarator") || p.type === "init_declarator") {
      return this.isDeclaringChainLeftmost(node)
    }
    return true
  }

  // CGD33: does `name` resolve ONLY as a type declaration (no value
  // declaration anywhere)? Value evidence = a global variable, a declared
  // value name (globals/functions/prototypes/enum members/macros — the
  // CGD26 pre-pass), or a VALUE symbol. VALUE kinds are the ones that name
  // run-time entities a C expression can read: Variable/Constant/Macro
  // (globals + preprocessor constants), Function (callbacks read as
  // values), EnumMember. Everything else is a TYPE-ish kind — Type, Enum,
  // Struct, Union, Class, Trait, Interface, Property (struct FIELDS are
  // member declarations, never bare-value names in well-formed C) — and
  // NEVER counts as value evidence, even when the symbol's scope is
  // "global" (a top-level tagged `struct Mem3Global {...}` carries scope
  // global and kind Struct — the exact class that leaked `uses
  // Mem3Global`). Type evidence = the structs/unions/enums type maps, a
  // declaredTypes entry, or a type-ish symbol. See the emission-gate
  // comment for the measured defect.
  private isTypeOnlyName(
    name: string,
    symbols: ASTEngine.UniversalSymbol[],
    globalVars: Record<string, boolean>,
    structs: Record<string, any[]>,
    unions: Record<string, any[]>,
    enums: Record<string, boolean>,
    declaredTypes: Set<string>,
    declaredNames?: Set<string>,
  ): boolean {
    if (globalVars[name] || declaredNames?.has(name)) return false
    const VALUE_KINDS = new Set([
      ASTEngine.SymbolKind.Variable,
      ASTEngine.SymbolKind.Constant,
      ASTEngine.SymbolKind.Macro,
      ASTEngine.SymbolKind.Function,
      ASTEngine.SymbolKind.EnumMember,
    ])
    const TYPE_KINDS = new Set([
      ASTEngine.SymbolKind.Type,
      ASTEngine.SymbolKind.Enum,
      ASTEngine.SymbolKind.Struct,
      ASTEngine.SymbolKind.Union,
      ASTEngine.SymbolKind.Class,
      ASTEngine.SymbolKind.Trait,
      ASTEngine.SymbolKind.Interface,
      ASTEngine.SymbolKind.Property,
    ])
    let hasValueSymbol = false
    let hasTypeSymbol = false
    for (let i = 0; i < symbols.length; i++) {
      const s = symbols[i]
      if (!s || s.name !== name) continue
      if (TYPE_KINDS.has(s.kind)) hasTypeSymbol = true
      if (VALUE_KINDS.has(s.kind)) {
        hasValueSymbol = true
        break
      }
    }
    if (hasValueSymbol) return false
    return !!structs[name] || !!unions[name] || !!enums[name] || hasTypeSymbol || declaredTypes.has(name)
  }

  private isResolvableUseTarget(
    name: string,
    nodeType: string,
    symbols: ASTEngine.UniversalSymbol[],
    globalVars: Record<string, boolean>,
    structs: Record<string, any[]>,
    unions: Record<string, any[]>,
    enums: Record<string, boolean>,
    declaredTypes: Set<string>,
    declaredNames?: Set<string>,
  ): boolean {
    if (!name || !name.trim()) return false
    if (inArray(["NULL", "true", "false", "..."], name)) return false

    // Type identifiers resolve only when the type is actually DECLARED in this
    // file (pre-pass set — order-independent). A bare forward declaration that
    // is never defined (`struct ForwardOnly;`) has no symbol to resolve to, so
    // it must not produce a dangling use edge.
    if (inArray(["type_identifier", "struct_specifier", "union_specifier", "enum_specifier"], nodeType))
      return declaredTypes.has(name)
    if (globalVars[name] || structs[name] || unions[name] || enums[name]) return true
    // CGD26: order-independent file-scope name resolution (static
    // initializer tables reference later symbols; see the pre-pass).
    if (declaredNames?.has(name)) return true

    for (let i = 0; i < symbols.length; i++) {
      const s = symbols[i]
      if (!s || s.name !== name) continue
      if (
        s.scope === "global" ||
        s.kind === ASTEngine.SymbolKind.Type ||
        s.kind === ASTEngine.SymbolKind.Enum ||
        // Enum members are global constants in C — usage (e.g. `return
        // STATUS_OK;`) must resolve (matches the Java family: `Status uses
        // ACTIVE`). Their scope is the enum name, not "global".
        s.kind === ASTEngine.SymbolKind.EnumMember ||
        s.kind === ASTEngine.SymbolKind.Function ||
        s.kind === ASTEngine.SymbolKind.Constant
      ) {
        return true
      }
    }
    return false
  }

  private inferIs64Bit(content: string, filePath: string): boolean {
    const hints64 = ["__LP64__", "_LP64", "__x86_64__", "__aarch64__", "__ppc64__", "__s390x__"]
    for (let i = 0; i < hints64.length; i++) {
      if (stringIncludes(content, hints64[i])) return true
    }

    const hints32 = ["__ILP32__", "__i386__", "__arm__", "__mips__"]
    for (let i = 0; i < hints32.length; i++) {
      if (stringIncludes(content, hints32[i])) return false
    }

    if (stringIncludes(content, "_WIN64")) return true
    if (stringIncludes(content, "_WIN32")) return false
    if (stringIncludes(filePath, "x86_64") || stringIncludes(filePath, "aarch64")) return true
    if (stringIncludes(filePath, "i386") || stringIncludes(filePath, "armv7")) return false

    return true
  }

  private inferIsLLP64(content: string): boolean {
    return stringIncludes(content, "_WIN64") || stringIncludes(content, "windows.h")
  }

  private recoverFunctionRange(node: Node, content: string): ASTEngine.UniversalSymbol["range"] {
    const base = this.nodeToRange(node)
    const body = node.childForFieldName("body")

    let openBraceIdx = -1
    if (body) {
      openBraceIdx = content.indexOf("{", body.startIndex)
    }

    if (openBraceIdx < 0) {
      const declarator = node.childForFieldName("declarator")
      const searchFrom = declarator ? declarator.endIndex : node.startIndex
      openBraceIdx = content.indexOf("{", searchFrom)
      if (openBraceIdx < 0 || openBraceIdx > node.startIndex + 32768) return base
    }

    let depth = 0
    let inLineComment = false
    let inBlockComment = false
    let inSingleQuote = false
    let inDoubleQuote = false
    let escaped = false

    for (let i = openBraceIdx; i < content.length; i++) {
      const ch = content[i]
      const next = i + 1 < content.length ? content[i + 1] : ""

      if (inLineComment) {
        if (ch === "\n") inLineComment = false
        continue
      }
      if (inBlockComment) {
        if (ch === "*" && next === "/") {
          inBlockComment = false
          i++
        }
        continue
      }

      if (inSingleQuote) {
        if (escaped) {
          escaped = false
        } else if (ch === "\\") {
          escaped = true
        } else if (ch === "'") {
          inSingleQuote = false
        }
        continue
      }

      if (inDoubleQuote) {
        if (escaped) {
          escaped = false
        } else if (ch === "\\") {
          escaped = true
        } else if (ch === '"') {
          inDoubleQuote = false
        }
        continue
      }

      if (ch === "/" && next === "/") {
        inLineComment = true
        i++
        continue
      }
      if (ch === "/" && next === "*") {
        inBlockComment = true
        i++
        continue
      }
      if (ch === "'") {
        inSingleQuote = true
        continue
      }
      if (ch === '"') {
        inDoubleQuote = true
        continue
      }

      if (ch === "{") depth++
      else if (ch === "}") {
        depth--
        if (depth === 0) {
          const endIndex = i + 1
          const pos = this.indexToLineColumn(content, endIndex)
          return {
            startLine: base.startLine,
            startColumn: base.startColumn,
            endLine: pos.line,
            endColumn: pos.column,
            startIndex: base.startIndex,
            endIndex,
          }
        }
      }
    }

    return base
  }

  private indexToLineColumn(content: string, index: number): { line: number; column: number } {
    let line = 1
    let column = 1
    const max = Math.min(index, content.length)
    for (let i = 0; i < max; i++) {
      if (content[i] === "\n") {
        line++
        column = 1
      } else {
        column++
      }
    }
    return { line, column }
  }

  private isPointerType(node: Node | null): boolean {
    let current = node
    while (current) {
      if (current.type === "pointer_declarator") return true
      current = current.childForFieldName("declarator") || (current.namedChildCount > 0 ? current.namedChild(0) : null)
    }
    return false
  }

  private hasStorageClass(node: Node, className: string): boolean {
    return !!this.findChild(node, (c) => c?.type === "storage_class_specifier" && c.text === className)
  }

  private isPacked(node: Node): boolean {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (!child) continue
      if (child.type === "attribute_specifier" || child.type === "attribute") {
        if (stringIncludes(child.text, "packed")) return true
      }
    }
    return false
  }

  private findFirstChildOfType(node: Node | null, type: string, condition?: (n: Node) => boolean): Node | null {
    if (!node) return null
    const stack: Node[] = [node]
    while (stack.length > 0) {
      const current = stack.pop()!
      if (current.type === type && (!condition || condition(current))) return current
      for (let i = current.namedChildCount - 1; i >= 0; i--) {
        const child = current.namedChild(i)
        if (child) stack.push(child)
      }
    }
    return null
  }

  private detectCFrameworks(imports: ASTEngine.ImportInfo[]): string[] {
    const frameworks: Record<string, boolean> = {}
    for (let idx = 0; idx < imports.length; idx++) {
      const i = imports[idx]
      const m = i.module
      if (!m) continue
      if (stringIncludes(m, "stdio.h") || stringIncludes(m, "stdlib.h")) frameworks["Standard C Library"] = true
      if (stringIncludes(m, "unistd.h") || stringIncludes(m, "pthread.h")) frameworks["POSIX"] = true
      if (stringIncludes(m, "windows.h")) frameworks["Windows API"] = true
      if (m.startsWith("gtk/")) frameworks["GTK"] = true
      if (stringIncludes(m, "glib.h")) frameworks["GLib"] = true
      if (m.startsWith("SDL")) frameworks["SDL"] = true
      if (stringIncludes(m, "linux/module.h")) frameworks["linux_kernel"] = true
      if (stringIncludes(m, "FreeRTOS.h")) frameworks["freertos"] = true
    }
    const arr: string[] = []
    for (const f in frameworks) arr.push(f)
    return arr
  }

  /**
   * #907 (M60-C): recover a definition HEADER that parse recovery glued into a
   * preceding function's body. Measured shape (jq src/jv_print.c L389/L393, where a
   * `} else {` at L262 pairs with a closing brace living inside a later
   * `#ifdef USE_DECNUM`, so the `case` at L254 runs away to L394):
   *
   *   ERROR { primitive_type "void", function_declarator "jv_dumpf(...)" }  then `{`
   *
   * The invariant that makes emission safe: **C has no nested functions.** A
   * definition header inside a body can therefore only be recovery glue for a
   * FILE-SCOPE definition, so the symbol is emitted at global scope rather than
   * into the block that swallowed it.
   *
   * The discriminator is the character after the declarator — `{` means definition,
   * while `;`/`,`/`)` means prototype, call, or initializer. That single test is what
   * keeps this from fabricating: recovery ALSO misparses ordinary calls as
   * function_declarators (jv_dump's body holds `jv_dumpf(x, stdout, flags)` as one),
   * and those are followed by `;`.
   *
   * Deliberately SILENT about anything else: no symbol, no scope push, no local
   * re-attribution. The swallowed bodies keep the attribution they already have, so
   * this adds catalog entries without moving a single relationship (which is what
   * keeps it F5-neutral).
   */
  private recoverGluedDefinitionHeader(
    node: Node,
    content: string,
    symbols: ASTEngine.UniversalSymbol[],
  ): void {
    // Never a parameter list: a declarator there is a function-pointer parameter.
    // A `compound_statement` on the path is NOT required — round 2 of #907 measured
    // the same loss at ROOT scope (jq `jv.c:673` `jv jv_number(double x) {`, whose
    // ERROR is a direct child of `translation_unit`) and in `jv_dtoa.c`'s
    // `ERROR[2-4277]`, so gating on "swallowed into a body" left four sites unfixed.
    // What carries the safety is the brace test below, not the ancestor shape: a
    // prototype, call, or initializer ends in `;`, `,`, `)`, or `=`.
    let macroAncestor: Node | null = null
    let insideBody = false
    let w: Node | null = node.parent
    while (w) {
      if (w.type === "parameter_list") return
      if (w.type === "preproc_def" || w.type === "preproc_function_def") macroAncestor = w
      if (w.type === "compound_statement") insideBody = true
      w = w.parent
    }

    for (const { id, wrapped, rangeNode } of this.gluedDeclaratorNames(node, content)) {
      const name = id.text.trim()
      if (!name || C_KEYWORDS.has(name)) continue
      // Definition iff the name's own parameter list is followed by the body's
      // opening brace. The test is made on the TEXT from the name rather than on
      // the declarator node's end, because when recovery degrades far enough the
      // name is a bare `identifier` whose parent is the whole ERROR region — using
      // the parent's end makes every such site look like `…}` and refuses it (that
      // was measured: decNumber.c's three public functions were still lost after
      // the identifier rule was added for exactly this reason).
      if (!this.definitionBodyFollows(content, id)) continue
      // A `#define` body can write a definition-shaped sequence too (`#define
      // DEF(name) void name(void) {`), and `name` there is the macro PARAMETER, not
      // a symbol. A declarator inside the macro's own logical line is therefore
      // skipped; one that lives past the last backslash-continuation is not — that
      // is how jq's `parser.c` reaches `void yyerror(...)` (macro ends at L403, the
      // definition is L406).
      if (macroAncestor && this.insideMacroContinuation(macroAncestor, id, content)) continue
      if (symbols.some((s) => s.name === name && s.kind === ASTEngine.SymbolKind.Function)) continue
      this.gluedDefNameOffsets.add(id.startIndex)
      symbols.push({
        name,
        kind: ASTEngine.SymbolKind.Function,
        range: this.nodeToRange(rangeNode ?? id),
        scope: "global",
        visibility: this.isStaticInDeclaration(id, content) ? "private" : "public",
        // The arrival is recorded because it is what round 2 added, and because
        // a mutant can only target one arrival if the result says which it was.
        metadata: {
          cSpecific: true,
          recoveredFromGlue: true,
          glueArrival: insideBody ? "body" : "file-scope",
          glueWrapped: wrapped,
          glueNameShape: rangeNode.type === "function_declarator" ? "declarator" : "bare-identifier",
        },
      })
    }
  }

  /**
   * #907: the identifiers a glued definition header can expose, unwrapping the
   * declarator forms the damaged tree actually produces. Two measured arrivals:
   *   ERROR > function_declarator                       (jv.c `jv_number`)
   *   ERROR > pointer_declarator > function_declarator  (util.c `strptime`,
   *                                                      jv_dtoa.c `jvp_dtoa`)
   * Only the ERROR's own children are visited, and only through declarator
   * wrappers — a `function_declarator` nested in a struct or an argument list is
   * NOT a file-scope definition header and is deliberately unreachable here.
   */
  private gluedDeclaratorNames(error: Node, content: string): Array<{ id: Node; wrapped: boolean; rangeNode: Node }> {
    const found: Array<{ id: Node; wrapped: boolean; rangeNode: Node }> = []
    const unwrap = (n: Node, depth: number, wrapped: boolean): void => {
      if (depth > 3) return
      if (n.type === "function_declarator") {
        const id = n.childForFieldName("declarator")
        if (id && id.type === "identifier") found.push({ id, wrapped, rangeNode: n })
        return
      }
      // A more degraded recovery drops the declarator node entirely: the name
      // arrives as a BARE identifier under the ERROR (jq decNumber.c:2303
      // `decNumber * decNumberNormalize(...) {` inside a swallowed body; jq
      // parser.c:406 `void yyerror(...) {` under a macro's ERROR). Calls are the
      // same shape — which is why an identifier is only accepted when the text
      // before it still reads as a DECLARATION (see declarationHeaderBefore
      // below): `FOREACH(item) {` and `foo(x) {` have no return type and are
      // refused, while `void yyerror(...)` and `decNumber * decNumberNormalize(...)`
      // are not.
      if (n.type === "identifier" && this.declarationHeaderBefore(n, content)) {
        found.push({ id: n, wrapped, rangeNode: n })
        return
      }
      if (
        n.type === "pointer_declarator" ||
        n.type === "parenthesized_declarator" ||
        n.type === "attributed_declarator"
      ) {
        const inner = n.childForFieldName("declarator")
        if (inner) unwrap(inner, depth + 1, true)
      }
    }
    for (let i = 0; i < error.namedChildCount; i++) {
      const c = error.namedChild(i)
      if (c) unwrap(c, 0, false)
    }
    return found
  }

  /**
   * #907: does this name's own parameter list end at a `{`? Walked on the text so
   * it works the same for a proper declarator node and for the bare-identifier
   * arrival. Anything else after the parameter list (`;`, `,`, `)`, `=`, or a
   * trailing attribute/initialiser) means prototype, call, or initialiser.
   */
  private definitionBodyFollows(content: string, id: Node): boolean {
    let j = id.endIndex
    if (!(j >= 0 && j <= content.length)) return false
    while (j < content.length && /\s/.test(content[j])) j++
    if (content[j] !== "(") return false
    let depth = 0
    for (; j < content.length; j++) {
      if (content[j] === "(") depth++
      else if (content[j] === ")") {
        depth--
        if (depth === 0) break
      }
    }
    if (depth !== 0) return false
    j++
    while (j < content.length && /\s/.test(content[j])) j++
    return content[j] === "{"
  }

  /**
   * #907: is there a declaration header — a return type and/or storage class —
   * between the previous statement terminator and this name? This is the guard
   * that lets a bare `identifier` be read as a definition without swallowing mere
   * CALLS, which arrive in exactly the same AST shape. Comments are stripped and
   * whitespace does not count, so a macro invocation at the start of a line
   * (`FOREACH(item) {`, nothing but the name before it) yields an empty header and
   * is refused, while `void yyerror(`, `decNumber * decNumberNormalize(`, and
   * `static block gen_last_1(` all keep a type token.
   */
  private declarationHeaderBefore(id: Node, content: string): boolean {
    const from = Math.max(0, id.startIndex - 400)
    const window = content.slice(from, id.startIndex)
    let cut = -1
    for (const ch of [";", "{", "}"]) {
      const at = window.lastIndexOf(ch)
      if (at > cut) cut = at
    }
    const header = window.slice(cut + 1)
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ") // eslint-disable-line no-useless-escape
    return /[A-Za-z_]\w*/.test(header)
  }

  /**
   * #907: is the declarator inside the `#define` macro's own logical line? True
   * only while every line from the directive to the declarator ends with a
   * backslash continuation — the macro's body. A declarator reached after a line
   * that does NOT continue is ordinary file text the damaged tree merely reparented.
   */
  private insideMacroContinuation(macroNode: Node, id: Node, content: string): boolean {
    const startRow = macroNode.startPosition.row
    const declRow = id.startPosition.row
    if (declRow <= startRow) return true
    let lineStart = macroNode.startIndex
    for (let row = startRow; row < declRow; row++) {
      const nl = content.indexOf("\n", lineStart)
      if (nl < 0) return false
      let end = nl - 1
      if (end >= lineStart && content[end] === "\r") end--
      if (content[end] !== "\\") return false
      lineStart = nl + 1
    }
    return true
  }

  /**
   * #907: `static` belongs to the declaration, not to the ERROR that swallowed it —
   * a root-level ERROR can span thousands of lines (jv.c `ERROR[673-2185]`,
   * jv_dtoa.c `ERROR[2-4277]`), so testing the ERROR's whole text marks public
   * functions private. The storage class is looked for in the window since the
   * previous statement/brace terminator, which is where a wrapped header writes it
   * (`static double` on the line above `ulp`).
   */
  private isStaticInDeclaration(id: Node, content: string): boolean {
    const from = Math.max(0, id.startIndex - 400)
    const window = content.slice(from, id.startIndex)
    let cut = -1
    for (const ch of [";", "{", "}"]) {
      const at = window.lastIndexOf(ch)
      if (at > cut) cut = at
    }
    const blank = window.lastIndexOf("\n\n")
    if (blank > cut) cut = blank
    return /\bstatic\b/.test(window.slice(cut + 1))
  }

  /**
   * M59.A7 (#825): the 1-based line of the node that NAMES a relationship.
   * The contract (reviews/m49-callsite-line-gap.md) is "the line belongs to the
   * name, never to the construct that contains it": a call takes its callee
   * leaf, a type reference the node the name came from, an include its path.
   * Returns undefined — the honest value — when no node can derive a line; a
   * synthesised target must never be given an enclosing declaration's line.
   */
  private nodeLine(node: Node | null | undefined): number | undefined {
    if (!node || !node.startPosition || typeof node.startPosition.row !== "number") return undefined
    return node.startPosition.row + 1
  }

  /**
   * M59.A7 (#825): a type expression's start is not the line of the names inside
   * it. A `struct_specifier` starts at its KEYWORD, and a wrapped declaration
   * puts the tag on the following line — measured on jq `jv_dtoa.c`:
   *
   *   struct        <- 512 (the specifier's start)
   *   Bigint {      <- 513 (where the name is written)
   *
   * The grammar's `name` field is the site when it exists; otherwise the node is.
   */
  private nameLine(node: Node | null | undefined): number | undefined {
    if (!node) return undefined
    const nameField =
      typeof (node as any).childForFieldName === "function" ? node.childForFieldName("name") : null
    return this.nodeLine(nameField ?? node)
  }

  private nodeToRange(node: Node): ASTEngine.UniversalSymbol["range"] {
    const startRow =
      node && node.startPosition && typeof node.startPosition.row === "number" ? node.startPosition.row : 0
    const startCol =
      node && node.startPosition && typeof node.startPosition.column === "number" ? node.startPosition.column : 0
    const endRow =
      node && node.endPosition && typeof node.endPosition.row === "number" ? node.endPosition.row : startRow
    const endCol =
      node && node.endPosition && typeof node.endPosition.column === "number" ? node.endPosition.column : startCol
    const startIndex = node && typeof node.startIndex === "number" ? node.startIndex : 0
    const endIndex = node && typeof node.endIndex === "number" ? node.endIndex : startIndex

    return {
      startLine: startRow + 1,
      startColumn: startCol + 1,
      endLine: endRow + 1,
      endColumn: endCol + 1,
      startIndex,
      endIndex,
    }
  }
}
