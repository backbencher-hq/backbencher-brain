import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"

export interface ContractFixture {
  root: string
  sourceFile: string
  duplicateFiles: string[]
  testFile: string
  documentationFile: string
}

export function createContractFixture(root: string): ContractFixture {
  const src = path.join(root, "src")
  const tests = path.join(root, "tests")
  const docs = path.join(root, "docs")
  mkdirSync(src, { recursive: true })
  mkdirSync(tests, { recursive: true })
  mkdirSync(docs, { recursive: true })

  const sourceFile = path.join(src, "app.ts")
  writeFileSync(
    sourceFile,
    `/** Returns the request body. */
export function handleRequest(req: { body?: string }): string {
  return req.body ?? ""
}

export function helper(): number {
  return 42
}

export class RequestHandler {
  handle(req: { type?: string }): string {
    return this.respond(req)
  }

  private respond(req: { type?: string }): string {
    return req.type ?? ""
  }
}

export function orphanedFunction(): void {
  console.log("not referenced")
}
`,
  )

  const duplicateFiles = [path.join(src, "alpha.ts"), path.join(src, "beta.ts")]
  writeFileSync(duplicateFiles[0], `export function duplicateName(): string { return "alpha" }\n`)
  writeFileSync(duplicateFiles[1], `export function duplicateName(): string { return "beta" }\n`)

  writeFileSync(
    path.join(src, "bridge.py"),
    `def python_bridge(value: str) -> str:\n    \"\"\"Return a value from the Python boundary.\"\"\"\n    return value\n`,
  )
  writeFileSync(path.join(src, "worker.go"), `package fixture\n\nfunc ProcessValue(value string) string { return value }\n`)

  const testFile = path.join(tests, "app.test.ts")
  writeFileSync(
    testFile,
    `import { handleRequest } from "../src/app"\n\nexport function testHandleRequest(): void {\n  if (handleRequest({ body: "ok" }) !== "ok") throw new Error("failed")\n}\n`,
  )

  const documentationFile = path.join(docs, "architecture.md")
  writeFileSync(
    documentationFile,
    `# Fixture architecture\n\nThe request handler reads an optional body and returns a string.\n`,
  )

  return { root, sourceFile, duplicateFiles, testFile, documentationFile }
}
