/**
 * THE MIXIN SITE MODEL — one shared reading of "where is this mixin call, and what is `self` here?".
 *
 * ⇒ WHY THIS FILE IS SEPARATE, AND WHY IT IS NOT THE TRUTH. This lane now holds THREE
 * derivations of the same question, and the whole point of the differential is that they are
 * NOT the same computation:
 *
 *   1. THE ANALYZER (`src/ast/real-ruby-analyzer.ts`) answers by walking the AST's PARENT
 *      links from the call node — `mixinSelfKind`.
 *   2. THE ORACLE (`script/m14/ruby-truth.ts`) answers by carrying the answer in the WALK
 *      FRAME it already maintains — `Frame.selfType`.
 *   3. THIS MODULE answers by carrying the answer in a SCOPE STACK built by a separate walk
 *      of the tree — the census's own reading.
 *
 * ⇒ All three describe the same LANGUAGE, so they must agree; none of them is a copy of
 * another, so their agreement is EVIDENCE and their disagreement is a FINDING. A rule
 * transcribed from the analyzer would agree by construction and measure nothing.
 *
 * ⇒ AND WHAT THIS MODULE IS FOR: it is the READING, and it decides nothing. It enumerates
 * the mixin call sites and classifies each one — the receiver's shape, the static self-type,
 * whether the enclosing class defines a method of the same name — so that a disagreement
 * between the analyzer and the oracle can be NAMED rather than merely counted.
 */
import { readFileSync, statSync, readdirSync } from "node:fs"
import { execFileSync } from "node:child_process"
import * as path from "node:path"

/** The three mixin keywords. */
export const MIXIN_METHODS = new Set(["include", "extend", "prepend"])

/** THE STATIC SELF-TYPE at a call site — what `self` denotes there. */
export type MixinSelfKind = "class" | "singleton" | "instance" | "top"

/** THE RECEIVER'S SHAPE — the shape decides whether a row can be attributed at all. */
export type MixinReceiverShape = "none" | "self" | "constant" | "local" | "call" | "other"

/** ONE MIXIN CALL SITE, with everything three derivations need to talk about it. */
export type MixinSite = {
  file: string
  /** The CALL node's line. */
  line: number
  /** The ARGUMENT node's line — the line the analyzer publishes as `line_number`. */
  argLine: number
  keyword: string
  receiver: string | null
  receiverShape: MixinReceiverShape
  /** TRUE when the receiver names a CLASS (a constant), so a row could be RE-SOURCED to it. */
  receiverIsConstant: boolean
  selfKind: MixinSelfKind
  /** The enclosing class/module's name, when there is one. */
  enclosingClass: string | null
  /** Does the enclosing class define a method of the SAME NAME? (`def include(x)`) */
  selfDefinesSameName: boolean
  argIsConstant: boolean
  argText: string
  /** The mixin target's LEAF — what the analyzer publishes as the target. */
  argLeaf: string
}

/** A scope in the census's own model. */
type Scope = { kind: "class" | "module" | "def"; name: string; singleton: boolean }

/** The leaf of a dotted/spaced path — `A::B` -> `B`. */
export function leafOfPath(s: string): string {
  const t = String(s ?? "")
  const i = Math.max(t.lastIndexOf("."), t.lastIndexOf(":"), t.lastIndexOf("#"))
  return (i >= 0 ? t.slice(i + 1) : t).trim()
}

/**
 * EVERY MIXIN CALL SITE IN A TREE, with the census's own reading of each one.
 *
 * ⇒ THE TWO WALKS, AND WHY TWO. The first collects the method names each class or module
 * DEFINES, which is what makes impostor class (B) — a class that defines `def include(x)`
 * has its own `include`, and `include Foo` inside it calls THAT, not `Module#include` —
 * decidable at all. The second enumerates the call sites and attributes each one the
 * static self-type at its position.
 */
export function collectMixinSites(root: any, rel: string): MixinSite[] {
  const sites: MixinSite[] = []

  // WALK 1 — the method names each class/module defines.
  const definesOf = new Map<Scope, Set<string>>()
  {
    const stack: Scope[] = []
    const walk1 = (n: any) => {
      if (n.type === "class" || n.type === "module" || n.type === "singleton_class") {
        const nameNode = n.namedChild(0)
        const s: Scope = { kind: n.type === "module" ? "module" : "class", name: nameNode ? nameNode.text : "(anonymous)", singleton: n.type === "singleton_class" }
        definesOf.set(s, new Set())
        stack.push(s)
        for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walk1(c) }
        stack.pop()
        return
      }
      if (n.type === "method" || n.type === "singleton_method") {
        const nameNode = n.namedChild(0)
        const name = nameNode ? nameNode.text : ""
        // THE ENCLOSING CLASS/MODULE — the nearest scope that is not a def.
        for (let i = stack.length - 1; i >= 0; i--) {
          if (stack[i].kind !== "def") { definesOf.get(stack[i])?.add(name); break }
        }
        for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walk1(c) }
        return
      }
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walk1(c) }
    }
    walk1(root)
  }

  // WALK 2 — the call sites, each carrying the static self-type at its position.
  const walk3 = (n: any, curClass: Scope | null, curDef: Scope | null, selfKind: MixinSelfKind, parentNode: any = null) => {
    let nextClass = curClass
    let nextDef = curDef
    let nextSelf = selfKind

    if (n.type === "class" || n.type === "module" || n.type === "singleton_class") {
      const nameNode = n.namedChild(0)
      nextClass = { kind: n.type === "module" ? "module" : "class", name: nameNode ? nameNode.text : "(anonymous)", singleton: n.type === "singleton_class" }
      nextDef = null
      // A `class << self` BODY is a class body: `self` there is the SINGLETON CLASS, and
      // `include M` inside it composes a mixin into the class.
      nextSelf = "class"
    } else if (n.type === "method" || n.type === "singleton_method") {
      const nameNode = n.namedChild(0)
      const name = nameNode ? nameNode.text : ""
      // THE DISCRIMINATOR'S INPUT: is this a SINGLETON method (`def self.x` / `def x.y`)?
      const isSingleton = n.type === "singleton_method" || name.includes(".")
      nextDef = { kind: "def", name, singleton: isSingleton }
      nextSelf = isSingleton ? "singleton" : "instance"
    } else if (n.type === "do_block" || n.type === "block") {
      // A `Class.new { }` / `Module.new { }` BLOCK IS A CLASS BODY: `self` inside it is the new class.
      //
      // ⇒ THE NODE TYPE IS `do_block`, NOT `block`, AND THE FIRST VERSION CHECKED `block` — so the
      // branch NEVER FIRED for a `do ... end` block, and every `Class.new(base) do ... end` was
      // misread as an instance method. The tree is:
      //     call                      "Class.new(base) do ... end"
      //       constant                "Class"
      //       identifier              "new"
      //       argument_list           "(base)"
      //       do_block                "do ... end"
      //         body_statement       "include Bar"
      // ⇒ SO THE DISCRIMINATOR IS THE ENCLOSING `call`'s RECEIVER AND METHOD, READ FROM THE PARENT.
      const parent = parentNode
      if (parent && parent.type === "call") {
        const recv = parent.namedChild(0)
        const meth = parent.namedChild(1)
        const recvText = recv ? recv.text : ""
        const methText = meth ? meth.text : ""
        if ((recvText === "Class" || recvText === "Module") && methText === "new") nextSelf = "class"
      }
    }

    if (n.type === "call") {
      // ⇒ THE METHOD NODE IS THE ONE THE FIELD NAMES — `namedChild(0)` is the RECEIVER for a
      // receivered call, so reading it as the method name skips every receivered call.
      const m = n.childForFieldName ? n.childForFieldName("method") : n.namedChild(0)
      const methodName = m ? m.text : ""
      if (MIXIN_METHODS.has(methodName)) {
        let receiver: string | null = null
        let receiverShape: MixinReceiverShape = "none"
        let receiverIsConstant = false
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (!c) continue
          if (c.id === (m as any).id) break
          receiver = c.text
          if (c.type === "self") receiverShape = "self"
          else if (c.type === "constant" || c.type === "scope_resolution") { receiverShape = "constant"; receiverIsConstant = true }
          else if (c.type === "identifier") receiverShape = "local"
          else if (c.type === "call" || c.type === "method_call") receiverShape = "call"
          else receiverShape = "other"
        }
        let argIsConstant = false
        let argText = ""
        let argLine = 0
        const args = n.namedChild(n.namedChildCount - 1)
        if (args && args.type === "argument_list") {
          for (let i = 0; i < args.namedChildCount; i++) {
            const a = args.namedChild(i)
            if (a && (a.type === "constant" || a.type === "scope_resolution")) { argIsConstant = true; argText = a.text; argLine = a.startPosition.row + 1 }
          }
        }
        const selfDefinesSameName = nextClass ? (definesOf.get(nextClass)?.has(methodName) ?? false) : false
        sites.push({
          file: rel,
          line: n.startPosition.row + 1,
          argLine,
          keyword: methodName,
          receiver,
          receiverShape,
          receiverIsConstant,
          selfKind: nextSelf,
          enclosingClass: nextClass?.name ?? null,
          selfDefinesSameName,
          argIsConstant,
          argText,
          argLeaf: leafOfPath(argText),
        })
      }
    }

    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walk3(c, nextClass, nextDef, nextSelf, n) }
  }

  walk3(root, null, null, "top")
  return sites
}

/** THE ADMITTED POPULATION — the corpus is MANY git repos under the root, not one repo. */
export function discoverRubyFiles(corpusRoot: string, maxBytes = 1024 * 1024): { files: string[]; repos: number; absent: number; overCap: number } {
  const files: string[] = []
  let absent = 0
  let overCap = 0
  const seen = new Set<string>()
  let entries: string[] = []
  try { entries = readdirSync(corpusRoot) } catch { entries = [] }
  for (const name of entries.sort()) {
    const dir = path.join(corpusRoot, name)
    try { if (!statSync(dir).isDirectory()) continue } catch { continue }
    try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
    } catch { continue }
    for (const rel of tracked) {
      if (!rel.endsWith(".rb")) continue
      const abs = path.join(dir, rel)
      try { if (statSync(abs).size > maxBytes) { overCap++; continue } } catch { absent++; continue }
      if (seen.has(abs)) continue
      seen.add(abs)
      files.push(abs)
    }
  }
  return {
    files,
    repos: new Set(files.map(f => path.relative(corpusRoot, f).split(path.sep)[0])).size,
    absent,
    overCap,
  }
}

/** Read a file, or return null when it cannot be read. */
export function readOrNull(abs: string): string | null {
  try { return readFileSync(abs, "utf8") } catch { return null }
}
