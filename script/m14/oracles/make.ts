/**
 * The MAKE oracle — LANE-OWNED.
 *
 * It lives here rather than in `script/m14/differential.ts` for the reason `oracles/json.ts` records:
 * the shared file is edited by several lane owners at once (measured while this was written: it grew
 * 26,289 → 26,883 lines in minutes, with a `sql` branch and a `lua` entry landing mid-edit), so every
 * line a lane keeps out of it is a line that cannot conflict. The shared file's footprint is one
 * import and one `if (lang === "make")` registration.
 *
 * WHY THIS EXISTS AT ALL: `make` was one of the lanes with no `derive<Lane>Edges` in the differential,
 * so its E/F could never be measured — the harness reported NO truth rather than a clean floor. The
 * census is the branch: `truth` comes from a per-language `if (lang === …)` that calls a
 * `derive<Lane>Edges`. No branch, no truth, no E/F.
 *
 * DERIVED FROM PARSE-TREE SEMANTICS, never from `real-makefile-analyzer.ts`: it shares no rule table,
 * no key set and no helper with the analyzer. That is the only property that makes a MATCH mean
 * something — an oracle copied from the analyzer cannot disagree with it.
 *
 * ## What the language says
 *
 *   declarations  a `variable_assignment`/`shell_assignment` word, a `define_directive` name, a literal
 *                 `rule` target, and the `VPATH` a `vpath` directive declares. Meta-targets
 *                 (`.PHONY`, `.SUFFIXES`, …) are not buildable output and declare nothing.
 *   exports       a target is PUBLIC SURFACE — an including makefile invokes it by name — so every
 *                 declared target is an export, as is every name an `export` directive publishes.
 *                 `unexport NAME` RETRACTS the row: a graph that keeps it contradicts itself (this is
 *                 `make`'s own construct — GNU Make's `unexport` is the language saying the name is no
 *                 longer surface).
 *   references /  a `prerequisites` entry, a computed target's expansion, and every
 *   uses          `variable_reference`/`substitution_reference`/`automatic_variable`/`function_call`
 *                 READ is a name-claim, and ONE rule decides the label: `references` iff THIS FILE
 *                 declares the name, `uses` otherwise. A prerequisite that is a file, or a builtin
 *                 make variable, is a `uses` — not a reference to a declaration the file does not hold.
 *   imports       `include`/`-include`/`sinclude` entries. A computed include (`$(RULES)`,
 *                 `$(shell …)`) names its EXPRESSION: a name no parse can know is a fact, not a
 *                 dropped row.
 *   calls         `$(call NAME,…)` invocations of a USER MACRO. A builtin function name is a language
 *                 verb (`$(if …)`, `$(wildcard …)`), not a callee.
 *   overrides     the ONE construct among the four silent kinds this language has: `override NAME := v`
 *                 is a REDEFINITION only when this file already holds a base declaration of NAME.
 *                 Where it does not, the replaced binding is the command line or the environment — not
 *                 a symbol in the graph — so the edge would dangle by construction and is refused
 *                 (the ruling the `json` lane made for a re-declared key).
 *
 * KINDS REFUSED, stated because an absent label needs a reason: `extends`, `implements` and
 * `instantiates` are not derivable from this grammar at all — a makefile declares targets and
 * variables; it constructs no value, inherits from nothing and implements no interface.
 *
 * Matching in the harness is site-agnostic (label + target, never the source line), so each
 * (label,target) pair is one row; the per-site contract is the fixture lane's job.
 */

export interface MakeTruthEdge {
  label: string
  from: string
  target: string
}

/** Keywords the grammar hands back inside `word`/`list` nodes; capturing one as a name is a phantom. */
const KEYWORDS = new Set([
  "export", "unexport", "override", "private", "define", "endef", "include",
  "-include", "sinclude", "vpath", "undefine", "ifeq", "ifneq", "ifdef",
  "ifndef", "else", "endif", "silent", "quiet",
])

/** Make's builtin functions: a name here is a language verb, not a user callee. */
const BUILTIN_FUNCTIONS = new Set([
  "subst", "patsubst", "strip", "findstring", "filter", "filter-out", "sort",
  "word", "wordlist", "words", "firstword", "lastword", "dir", "notdir",
  "suffix", "basename", "addsuffix", "addprefix", "join", "wildcard",
  "realpath", "abspath", "if", "or", "and", "foreach", "file", "call",
  "value", "eval", "origin", "flavor", "shell", "error", "warning", "info",
])

export function deriveMakeTruth(root: any, moduleName: string): MakeTruthEdge[] {
  const edges: MakeTruthEdge[] = []
  const seen = new Set<string>()
  const push = (label: string, from: string, target: string) => {
    from = from.trim()
    target = target.trim()
    if (!from || !target) return
    const k = `${label}|${from}|${target}`
    if (seen.has(k)) return
    seen.add(k)
    edges.push({ label, from, target })
  }

  const textOf = (n: any): string => (n && typeof n.text === "string" ? n.text : "")
  const namedKids = (n: any): any[] => {
    const out: any[] = []
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) out.push(c) }
    return out
  }
  const firstOfType = (n: any, types: Set<string>): any => {
    for (const c of namedKids(n)) if (types.has(String(c.type))) return c
    return null
  }
  const parentTypeOf = (n: any): string => (n.parent ? String(n.parent.type) : "")
  const isAllDigits = (s: string): boolean => {
    if (s.length === 0) return false
    for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); if (c < 48 || c > 57) return false }
    return true
  }
  const okIdent = (c: number) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95
  const isPlainIdentifier = (s: string): boolean => {
    if (s.length === 0) return false
    if (!okIdent(s.charCodeAt(0))) return false
    for (let i = 1; i < s.length; i++) {
      const c = s.charCodeAt(i)
      if (!okIdent(c) && !(c >= 48 && c <= 57) && c !== 46 && c !== 45 && c !== 47) return false
    }
    return true
  }
  /** Strip a trailing assignment operator from a captured name (`NAME :=` / `NAME ?=` / `NAME +=`). */
  const trimOperator = (raw: string): string => {
    let end = raw.length
    while (end > 0) {
      const c = raw.charCodeAt(end - 1)
      if (c === 63 || c === 43 || c === 61 || c === 33 || c === 58) end--
      else break
    }
    return raw.slice(0, end).trim()
  }
  /** `$(NAME)` / `${NAME}` -> NAME when the inner text is a plain identifier; otherwise the inner text. */
  const normaliseExpression = (raw: string): string => {
    const t = raw.trim()
    const braced = t.length > 3 && t.startsWith("$(") && t.endsWith(")")
    const curly = t.length > 3 && t.startsWith("${") && t.endsWith("}")
    if (braced || curly) return t.slice(2, -1).trim()
    return t
  }
  const declaredName = (node: any): string => {
    const w = firstOfType(node, new Set(["word"]))
    if (!w) return ""
    const trimmed = trimOperator(textOf(w).trim())
    if (!trimmed || KEYWORDS.has(trimmed)) return ""
    return trimmed
  }
  const firstToken = (raw: string): string => {
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i]
      if (c === " " || c === "\t" || c === "," || c === "(") return raw.slice(0, i)
    }
    return raw
  }
  const isLiteralTargetWord = (raw: string): boolean =>
    raw.length > 0 && !KEYWORDS.has(raw) && !raw.startsWith(".") && raw.indexOf("$") === -1

  // ---- pass 1: this file's own declarations (one pass, so a forward reference resolves) ----
  const declared = new Set<string>()
  const declLines = new Map<string, number[]>()
  const declaredTargets: string[] = []
  const exported = new Set<string>()
  const unexported = new Set<string>()
  const overrideSites: { name: string; line: number }[] = []
  let sawVpath = false

  const declStack: any[] = [root]
  while (declStack.length > 0) {
    const n: any = declStack.pop()
    const t = String(n.type)
    if (t === "variable_assignment" || t === "shell_assignment") {
      const nm = declaredName(n)
      if (nm) {
        declared.add(nm)
        declLines.set(nm, [...(declLines.get(nm) ?? []), n.startPosition.row + 1])
      }
    } else if (t === "define_directive") {
      const nm = declaredName(n)
      if (nm) declared.add(nm)
    } else if (t === "rule") {
      const targetsNode = firstOfType(n, new Set(["targets"]))
      if (targetsNode) {
        for (const c of namedKids(targetsNode)) {
          if (String(c.type) !== "word") continue
          const raw = textOf(c).trim()
          if (!isLiteralTargetWord(raw)) continue
          declaredTargets.push(raw)
        }
      }
    } else if (t === "export_directive") {
      const list = firstOfType(n, new Set(["list"]))
      if (list) {
        for (const w of namedKids(list)) {
          const nm = trimOperator(textOf(w).trim())
          if (nm && !KEYWORDS.has(nm)) exported.add(nm)
        }
      } else {
        const inner = firstOfType(n, new Set(["variable_assignment", "shell_assignment"]))
        const nm = inner ? declaredName(inner) : ""
        if (nm) exported.add(nm)
      }
    } else if (t === "unexport_directive") {
      const list = firstOfType(n, new Set(["list"]))
      if (list) {
        for (const w of namedKids(list)) {
          const nm = trimOperator(textOf(w).trim())
          if (nm) unexported.add(nm)
        }
      }
    } else if (t === "override_directive") {
      const inner = firstOfType(n, new Set(["variable_assignment", "shell_assignment"]))
      const nm = inner ? declaredName(inner) : ""
      if (nm) overrideSites.push({ name: nm, line: n.startPosition.row + 1 })
    } else if (t === "vpath_directive") {
      sawVpath = true
    }
    for (const c of namedKids(n)) declStack.push(c)
  }
  // an `export NAME` with no assignment IS the declaration (the directive declares the name)
  for (const nm of exported) if (!declared.has(nm)) declared.add(nm)
  // AND A TARGET IS A DECLARATION TOO — this is the half the first version missed, and the corpus
  // said so in one line: `all: deps build run` where `deps` is itself a target below. A prerequisite
  // that names another target of THIS file is a `references` (the file holds the declaration), and
  // without this the oracle derived 59 `uses` rows against analyzer `references` rows on a 53-file
  // draw — every one of them a name the file declares. The analyzer's symbol set includes targets,
  // so the classifier must too; the distinction is "does this file declare it", not "is it a variable".
  for (const t of declaredTargets) declared.add(t)

  // ---- pass 2: the edges ----
  const claim = (target: string) => {
    const t = target.trim()
    if (!t) return
    push(declared.has(t) ? "references" : "uses", moduleName, t)
  }

  const emitRefNode = (n: any) => {
    const t = String(n.type)
    if (t === "variable_reference" || t === "substitution_reference") {
      if (textOf(n).startsWith("$$")) return // `$$` is Make's escaped dollar: the SHELL's variable
      const w = firstOfType(n, new Set(["word"]))
      const nm = w ? textOf(w).trim() : ""
      if (nm && !isAllDigits(nm)) { claim(nm); return }
      // A reference with no `word` is a CONCATENATED name (`$(PAPEROPT_$(PAPER))`): the name is built
      // at expand time and no file can declare it, so it is a fact and lands on `uses`.
      const cat = firstOfType(n, new Set(["concatenation"]))
      const cn = cat ? textOf(cat).trim() : ""
      if (cn && !isAllDigits(cn)) claim(cn)
      return
    }
    if (t === "automatic_variable") {
      const w = firstOfType(n, new Set(["word"]))
      const nm = w ? textOf(w).trim() : textOf(n).trim()
      if (nm) claim(nm)
      return
    }
    if (t === "function_call") {
      const argsNode = firstOfType(n, new Set(["arguments"]))
      const raw = textOf(n)
      const nameEnd = argsNode ? argsNode.startIndex - n.startIndex : Math.max(0, raw.length - 1)
      const name = firstToken(raw.slice(2, nameEnd).trim())
      if (name === "call") {
        // `$(call NAME,…)` — the callee is the first comma-separated field, and only a USER MACRO is
        // a callee: a builtin function name is a language verb.
        const callee = argsNode ? (textOf(argsNode).split(",")[0] ?? "").trim() : ""
        if (callee && !BUILTIN_FUNCTIONS.has(callee) && !isAllDigits(callee)) push("calls", moduleName, callee)
      } else if (name && !BUILTIN_FUNCTIONS.has(name)) {
        claim(name)
      }
    }
  }

  const includeEdges = (node: any) => {
    const list = firstOfType(node, new Set(["list"]))
    if (list) {
      for (const c of namedKids(list)) {
        const ct = String(c.type)
        if (ct === "word") {
          const lit = textOf(c).trim()
          if (lit && !KEYWORDS.has(lit)) push("imports", moduleName, lit)
          continue
        }
        if (ct === "function_call" || ct === "variable_reference" || ct === "shell_function") {
          // computed include: the EXPRESSION is the fact (`include $(shell …)` names no file a parse
          // can know, and dropping it would make the include invisible)
          const expr = textOf(c).trim()
          if (expr) push("imports", moduleName, expr)
          continue
        }
        // any other expansion the grammar did not name: record the references it carries
        const inner: any[] = [c]
        while (inner.length > 0) {
          const x: any = inner.pop()
          const xt = String(x.type)
          if (xt === "variable_reference" || xt === "substitution_reference") {
            const w = firstOfType(x, new Set(["word"]))
            const nm = w ? textOf(w).trim() : ""
            if (nm && !KEYWORDS.has(nm)) push("imports", moduleName, nm)
          }
          for (const k of namedKids(x)) inner.push(k)
        }
      }
      return
    }
    const expr = textOf(node).trim()
    if (expr) push("imports", moduleName, expr)
  }

  const walkStack: any[] = [root]
  while (walkStack.length > 0) {
    const n: any = walkStack.pop()
    const t = String(n.type)
    if (t === "variable_assignment" || t === "shell_assignment") {
      const nm = declaredName(n)
      if (nm) push("contains", moduleName, nm)
    } else if (t === "define_directive") {
      const nm = declaredName(n)
      if (nm) push("contains", moduleName, nm)
    } else if (t === "rule") {
      const targetsNode = firstOfType(n, new Set(["targets"]))
      if (targetsNode) {
        for (const c of namedKids(targetsNode)) {
          if (String(c.type) !== "word") continue
          const raw = textOf(c).trim()
          if (!isLiteralTargetWord(raw)) continue
          push("contains", moduleName, raw)
        }
      }
      for (const c of namedKids(n)) {
        if (String(c.type) !== "prerequisites") continue
        for (const p of namedKids(c)) {
          const raw = textOf(p).trim()
          if (!raw) continue
          const nm = normaliseExpression(raw)
          if (!nm || KEYWORDS.has(nm)) continue
          claim(nm)
        }
      }
    } else if (t === "include_directive") {
      includeEdges(n)
    } else if (t === "export_directive") {
      const list = firstOfType(n, new Set(["list"]))
      if (list) {
        for (const w of namedKids(list)) {
          const nm = trimOperator(textOf(w).trim())
          if (!nm || KEYWORDS.has(nm)) continue
          push("exports", moduleName, nm)
          push("contains", moduleName, nm)
        }
      } else {
        const inner = firstOfType(n, new Set(["variable_assignment", "shell_assignment"]))
        const nm = inner ? declaredName(inner) : ""
        if (nm) push("exports", moduleName, nm)
      }
    } else if (t === "vpath_directive") {
      if (sawVpath) push("contains", moduleName, "VPATH")
    } else if (t === "variable_reference" || t === "substitution_reference" ||
      t === "automatic_variable" || t === "function_call") {
      const pt = parentTypeOf(n)
      // A reference that IS a prerequisite or a target was already handled by its own branch; reading
      // it again here would publish the same fact twice under one label or two.
      if (pt !== "prerequisites" && pt !== "targets") emitRefNode(n)
    }
    for (const c of namedKids(n)) walkStack.push(c)
  }

  // every declared target is public surface (`exports`)
  for (const t of declaredTargets) push("exports", moduleName, t)
  // `unexport NAME` retracts the surface row
  if (unexported.size > 0) {
    for (let i = edges.length - 1; i >= 0; i--) {
      if (edges[i].label === "exports" && unexported.has(edges[i].target)) edges.splice(i, 1)
    }
  }
  // `override NAME := v` is a redefinition only when this file holds a base declaration of NAME
  for (const site of overrideSites) {
    const base = (declLines.get(site.name) ?? []).filter((l) => l !== site.line)
    if (base.length > 0) push("overrides", moduleName, site.name)
  }

  return edges
}
