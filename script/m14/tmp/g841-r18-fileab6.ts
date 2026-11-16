import fs from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const R = "<corpus-root>/bb_tests/repositories/grails-core/"
const FILES = [
 'grails-databinding-core/src/test/groovy/org/grails/databinding/converters/DateConversionHelperSpec.groovy',
 'grails-spring-security/rest/core/grails-app/services/grails/plugin/springsecurity/rest/RestOauthService.groovy',
 'grails-test-examples/async-events-pubsub-demo/grails-app/controllers/pubsub/demo/SumController.groovy',
 'grails-test-examples/hibernate7/async-events-pubsub-demo/grails-app/controllers/pubsub/demo/SumController.groovy',
 'grails-test-examples/spring-security/core/integration-test-app/src/integration-test/groovy/grails/plugin/springsecurity/GormPersistentTokenRepositorySpec.groovy',
 'grails-views-gson/src/test/groovy/grails/plugin/json/view/JsonViewTestSpec.groovy',
]
for (const wasm of process.argv.slice(2)) {
  const lang = await L.load(fs.readFileSync(wasm))
  const parser = new P(); parser.setLanguage(lang)
  console.log(`=== ${wasm.replace(/^.*\//, '')}`)
  for (const f of FILES) {
    const t = parser.parse(fs.readFileSync(R + f, 'utf8'))
    const errs: string[] = []
    const walk = (x: any) => { if (x.type === "ERROR" || x.isMissing) errs.push(`${x.type}[${x.startPosition.row+1}:${x.startPosition.column+1}..${x.endPosition.row+1}:${x.endPosition.column+1}]`); for (let i = 0; i < x.childCount; i++) walk(x.child(i)) }
    walk(t.rootNode)
    console.log(`  ${errs.length} err | ${f.split('/').pop()}`)
    for (const e of errs.slice(0, 3)) console.log(`     ${e}`)
  }
}
