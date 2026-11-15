// #841 r24: minimal reconstructions of the five row-1 file suspects
import fs from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(fs.readFileSync("wasm/tree-sitter-groovy.wasm"))
const parser = new P(); parser.setLanguage(lang)

function verdict(src: string): string {
  const t = parser.parse(src).rootNode
  const errs: string[] = []
  const walk = (n: any): void => {
    if ((n.type === "ERROR" || n.isMissing) && n.endIndex > n.startIndex)
      errs.push(`${n.type}@r${n.startPosition.row + 1} len=${n.endIndex - n.startIndex}`)
    for (let i = 0; i < n.childCount; i++) walk(n.child(i))
  }
  walk(t)
  return errs.length === 0 ? "CLEAN" : `ERR ${errs.slice(0, 2).join(",")}`
}

const CASES: Array<[string, string]> = [
  ["S1 explicit-generic-member-juxt",
`class S {
    private transient LoadingCache<String, IndirectClient> clientCache = CacheBuilder.newBuilder().<String, IndirectClient> build { String provider ->
        log.debug "Creating OAuth client"
    }
}`],
  ["S1a explicit-generic no closure",
`class S {
    private transient LoadingCache<String, IndirectClient> clientCache = CacheBuilder.newBuilder().<String, IndirectClient> build()
}`],
  ["S1b plain member-juxt closure",
`class S {
    private transient LoadingCache<String, IndirectClient> clientCache = CacheBuilder.newBuilder().build { String provider ->
        log.debug "Creating OAuth client"
    }
}`],
  ["S2 generic-type-decl member",
`class C {
    def m() {
        def methods = builderClass.declaredMethods
        for (method in methods) { println method }
    }
}`],
  ["S3 doWithSpring closure head",
`class C {
    Closure doWithSpring() {
        { ->
            ReflectionUtils.application = grailsApplication
        }
    }
}`],
  ["S4 if-not-attr command",
`class C {
    def m() {
        if (!request.getAttribute(ALREADY_FILTERED_ATTR_NAME)) {
            invokeWithWrappedRequest request, response, filterChain
        } else {
            filterChainProxy.doFilter request, response, filterChain
        }
    }
}`],
  ["S5 destroy try listDatabaseNames",
`class C {
    void destroy() {
        try {
            mongoDatastore?.mongoClient?.listDatabaseNames()
        } catch (e) {
            log.error "x", e
        }
    }
}`],
]
for (const [name, src] of CASES) console.log(`${name.padEnd(38)} ${verdict(src)}`)
