import { execFileSync } from "node:child_process"
import { statSync } from "node:fs"
import path from "node:path"
import * as mod from "../src/ast/project-index"
import { cssFileScopeOf } from "../src/ast/real-css-analyzer"
import { parseFile } from "../src/ast/pool-worker"
const CR = "/home/ishaq2321/bb_tests/repositories"
const DIR = path.join(CR, "bulma")
const WASM = "/home/ishaq2321/mcp/backbencher-brain/wasm/tree-sitter-scss.wasm"
const rels = execFileSync("git", ["-C", DIR, "ls-files", "-z"], { encoding: "utf8" }).split("\0").filter((f) => f.endsWith(".scss"))
const abs = rels.map((f) => path.join(DIR, f)).filter((f) => { try { return statSync(f).size <= 1024 * 1024 } catch { return false } })
const idx: any = await mod.buildProjectIndexFromDisk(WASM, abs, (mod as any).SCSS_DECLARATION_SPEC)
const F = path.join(DIR, "docs/_sass/docs/backers.scss")
const r: any = await parseFile(F, DIR, { projectIndex: idx, projectRoot: DIR } as any)
const modSym = (r.symbols ?? []).find((s: any) => s.metadata?.isScssModule)
console.log("module symbol name:", modSym?.name, "| scssModulePath:", modSym?.metadata?.scssModulePath)
console.log("cssFileScopeOf(that path):", JSON.stringify(cssFileScopeOf(String(modSym?.metadata?.scssModulePath ?? ""))))
const scoped = (r.symbols ?? []).filter((s: any) => String(s.qualifiedName ?? "").includes("::")).length
console.log("symbols:", (r.symbols ?? []).length, "| with :: in qualifiedName:", scoped)
const ex = (r.relationships ?? []).filter((e: any) => String(e.type) === "exports")
console.log("exports edges:", ex.length, "| scoped targets:", ex.filter((e: any) => String(e.target).includes("::")).length)
console.log("sample targets:", JSON.stringify(ex.slice(0, 4).map((e: any) => e.target)))

const unscoped = ex.filter((e: any) => !String(e.target).includes("::"))
console.log("UNSCOPED targets:", JSON.stringify(unscoped.slice(0, 6).map((e: any) => ({ t: e.target, line: e.line_number, meta: Object.keys(e.metadata ?? {}) }))))
console.log("unscoped count:", unscoped.length, "| of which metadata has isScssModuleMember:", unscoped.filter((e: any) => e.metadata?.isScssModuleMember).length)
console.log("scoped count  :", ex.length - unscoped.length, "| of which metadata has isScssModuleMember:", ex.filter((e: any) => e.metadata?.isScssModuleMember).length)
