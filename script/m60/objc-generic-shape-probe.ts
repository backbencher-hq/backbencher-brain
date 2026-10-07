/**
 * script/m60/objc-generic-shape-probe.ts — WHERE DOES THE GRAMMAR PUT A `<...>` LIST?
 *
 * WHY. `implements` is published from every `parameterized_arguments` child of a
 * `class_interface`, and Objective-C uses ONE syntax for two different lists:
 *
 *   @interface SDMemoryCache <KeyType, ObjectType> : NSCache <KeyType, ObjectType> <SDMemoryCache>
 *              ^^^^^^^^^^^^^^^^^^^^^^^ TYPE PARAMETERS   ^^^^^^^^^^^^^^^^^^^^^^ TYPE ARGUMENTS  ^^^^^^^^^ PROTOCOLS
 *
 * All three are `parameterized_arguments`, so the lane currently publishes
 * `implements SDMemoryCache -> KeyType` and `-> ObjectType` — type parameters named as
 * adopted protocols. This probe dumps the exact tree shape of each of the three
 * positions, from the pinned wasm, so a rule can be written against STRUCTURE rather
 * than against a source-text reading of a declaration that no two Apple headers spell
 * the same way.
 *
 * READ-ONLY. Writes nothing.
 */
import { readFileSync } from "node:fs"
import * as path from "node:path"
const ROOT = path.resolve((import.meta as any).dirname, "..", "..")
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default, L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new P()
parser.setLanguage(await L.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-objc.wasm"))))

const SOURCES: Record<string, string> = {
  "class with type params + superclass type args + protocols": `
@interface SDMemoryCache <KeyType, ObjectType> : NSCache <KeyType, ObjectType> <SDMemoryCache>
@end
`,
  "class with only protocols": `
@interface SDDiskCache : NSObject <SDDiskCache>
@end
`,
  "class with only type params": `
@interface Box <T> : NSObject
@end
`,
  "plain class": `
@interface Plain : NSObject
@end
`,
  "category with protocols": `
@interface SDImageCache (SDImageCache) <SDImageCache>
@end
`,
  "class EXTENSION carrying a type-parameter list": `
@interface SDMemoryCache <KeyType, ObjectType> ()
@end
`,
  "category (non-empty label) with a protocol list": `
@interface NSString (Trim) <NSCopying>
@end
`,
  "protocol with inherited protocols": `
@protocol P1 <NSObject, NSCopying>
@end
`,
}

const sexp = (n: any, depth = 0): string => {
  const pad = "  ".repeat(depth)
  if (!n.isNamed) return `${pad}"${n.type}"${n.text.startsWith("\n") ? "" : ""}`
  let s = `${pad}(${n.type}`
  const field = (n as any).parent ? "" : ""
  s += "\n"
  for (let i = 0; i < n.childCount; i++) s += sexp(n.child(i), depth + 1) + "\n"
  return s + pad + ")"
}

for (const [k, src] of Object.entries(SOURCES)) {
  const t = parser.parse(src)
  console.log(`\n=== ${k} ===`)
  console.log(src.trim())
  console.log(sexp(t!.rootNode))
  t!.delete?.()
}
