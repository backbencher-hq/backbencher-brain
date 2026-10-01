import { readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { Parser, Language } from "web-tree-sitter"
import { RealXmlAnalyzer } from "./src/ast/real-xml-analyzer"
await Parser.init()
const p = new Parser(); p.setLanguage(await Language.load("./wasm/tree-sitter-xml.wasm"))
const REPOS = "$HOME/fixtures/xml/repos"
const EXTS = ["*.xml","*.xsd","*.xsl","*.xslt","*.dtd","*.rng","*.wsdl","*.svg"]
const files: string[] = []
for (const repo of ["grails-core","docx4j","libxml2","maven","cxf","libxslt"]) {
  let list: string[] = []
  try { list = execFileSync("git", ["-C", REPOS+"/"+repo, "-c","core.quotepath=false","ls-files","-z", ...EXTS], { encoding: "utf8", maxBuffer: 1<<28 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of list) files.push(REPOS+"/"+repo+"/"+rel)
}
let edges = 0, occSum = 0, linesRecorded = 0, noOccurrences = 0
const worst: {a:number;b:number;k:string}[] = []
for (const abs of files) {
  let content = "", r: any
  try { content = readFileSync(abs, "utf8"); r = await (new RealXmlAnalyzer() as any).analyze(p.parse(content).rootNode, content, abs) } catch { continue }
  for (const e of r.relationships ?? []) {
    if (String(e.metadata?.role) !== "entity_reference") continue
    edges++
    const o = e.metadata?.occurrences
    if (typeof o !== "number") { noOccurrences++; continue }
    occSum += o
    linesRecorded += (e.metadata?.lines?.length ?? 0)
    if (o > 2 && worst.length < 5) worst.push({a:o,b:e.metadata?.lines?.length ?? 0,k:abs.replace(REPOS+"/","")+" "+e.source+"->"+e.target})
  }
}
console.log("edges:", edges, "| occurrences summed:", occSum, "| lines recorded:", linesRecorded, "| edges with no occurrences:", noOccurrences)
console.log("=> every use is accounted for:", occSum === 12066 ? "YES (12,066)" : "NO — " + occSum + " of 12,066")
for (const w of worst) console.log("   collapsed", w.a+"x ->", w.b+"distinct lines |", w.k)
