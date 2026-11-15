/** WHY THE CROSS-FILE MECHANISM IS INERT: build a real scss index with the (now exported) spec,
 *  then check the two gates `resolveModuleImports` passes through. */
import { readFileSync } from "node:fs"
import * as mod from "../src/ast/project-index"
const R = "/home/ishaq2321/bb_tests/repositories/bulma/sass"
const files = [
  "/home/ishaq2321/bb_tests/repositories/bulma/sass/utilities/functions.scss",
  "/home/ishaq2321/bb_tests/repositories/bulma/sass/utilities/derived-variables.scss",
  "/home/ishaq2321/bb_tests/repositories/bulma/sass/utilities/css-variables.scss",
]
const built: any = await mod.buildProjectIndexFromDisk("/home/ishaq2321/mcp/backbencher-brain/wasm/tree-sitter-scss.wasm", files, (mod as any).SCSS_DECLARATION_SPEC)
console.log("BUILT index: typeMembers keys =", JSON.stringify([...built.typeMembers.keys()]))
console.log("BUILT index: __closedMembers present?", built.__closedMembers !== undefined, "| symbolNames sample:", JSON.stringify([...built.symbolNames].slice(0, 6)))
const round: any = mod.deserializeProjectIndex(mod.serializeProjectIndex(built))
console.log("ROUND-TRIPPED (what pool-worker hands the analyzer): typeMembers keys =", JSON.stringify([...round.typeMembers.keys()]))
console.log("ROUND-TRIPPED: __closedMembers present?", round.__closedMembers !== undefined, "-> resolveModuleImports returns at `if (!closedMembers) return`")
console.log("serialized keys:", JSON.stringify(Object.keys(mod.serializeProjectIndex(built))))
console.log("a real @use specifier would be e.g. '../utilities/css-variables' — does any key end with '/../utilities/css-variables'?",
  [...round.typeMembers.keys()].some((k: string) => k.endsWith("/../utilities/css-variables")))

const cm: any = (round as any).__closedMembers
console.log("ROUND-TRIPPED closed members: size", cm?.size ?? 0, "| functions.scss ->", JSON.stringify([...(cm?.get("functions.scss") ?? [])].slice(0, 8)))
console.log("ROUND-TRIPPED typeMembers['functions.scss'] size:", (round.typeMembers.get("functions.scss")?.size ?? 0))
