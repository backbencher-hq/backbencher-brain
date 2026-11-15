// Ladder: reduce the real failing block one construct at a time.
import { ASTEngine } from "../../../src/ast/engine"

const CASES: Array<[string, string]> = [
  ["full", `dependencies {
    implementation platform(project(':grails-bom'))
    api project(':grails-async-core')
    api "org.codehaus.gpars:gpars:$gparsVersion", {
        exclude group: 'org.multiverse', module: 'multiverse-core'
    }
}
`],
  ["no-module-key", `dependencies {
    api "org.codehaus.gpars:gpars:$gparsVersion", {
        exclude group: 'org.multiverse', modulex: 'multiverse-core'
    }
}
`],
  ["no-trailing-brace", `dependencies {
    api "org.codehaus.gpars:gpars:$gparsVersion"
    exclude group: 'org.multiverse', module: 'multiverse-core'
}
`],
  ["exclude-only", `dependencies {
    exclude group: 'org.multiverse', module: 'multiverse-core'
}
`],
  ["exclude-only-renamed", `dependencies {
    exclude group: 'org.multiverse', modulex: 'multiverse-core'
}
`],
  ["bare-module-key", `exclude module: 'multiverse-core'
`],
  ["bare-module-key-renamed", `exclude modulex: 'multiverse-core'
`],
  ["bare-module-eq", `exclude module: 'a', module: 'b'
`],
  ["api-comma-brace", `api "org.codehaus.gpars:gpars:$gparsVersion", {
    x()
}
`],
  ["api-comma-brace-plain", `api "a:b:c", {
    x()
}
`],
  ["platform-project", `implementation platform(project(':grails-bom'))
`],
]

async function main(): Promise<void> {
  for (const [name, src] of CASES) {
    const parser = await ASTEngine.getParser("groovy" as any)
    const root = parser.parse(src)?.rootNode
    console.log(`${name.padEnd(24)} ${root?.hasError ? "FAIL" : "ok  "}`)
  }
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
