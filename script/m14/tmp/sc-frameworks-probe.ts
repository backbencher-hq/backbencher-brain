// #741 CONV-S-1 reproduction: scala's detectFrameworks has no Spring entry, so a
// Spring Boot Scala file reports detectedFrameworks=[]. verify-first: reproduce
// at HEAD before editing, and print the other three JVM languages for the same
// source shape so the divergence is measured rather than asserted.
//
// Usage: bun run script/m14/tmp/sc-frameworks-probe.ts
import * as fs from "fs"
import { ASTEngine } from "../../../src/ast/engine"

const SCALA = [
  "import org.springframework.boot.autoconfigure.SpringBootApplication",
  "import org.springframework.stereotype.Service",
  "class App",
].join("\n") + "\n"

const SCALA_MISSING = [
  "import org.springframework.boot.autoconfigure.SpringBootApplication",
  "import com.fasterxml.jackson.databind.ObjectMapper",
  "import com.github.plokhotnyuk.jsoniter_scala.core.JsonValueCodec",
  "import com.softwaremill.sttp.client3.HttpClient",
  "class App",
].join("\n") + "\n"

const JAVA = [
  "package app;",
  "import org.springframework.boot.autoconfigure.SpringBootApplication;",
  "import com.fasterxml.jackson.databind.ObjectMapper;",
  "public class App {}",
].join("\n") + "\n"

const KOTLIN = [
  "import org.springframework.boot.autoconfigure.SpringBootApplication",
  "import com.fasterxml.jackson.databind.ObjectMapper",
  "class App",
].join("\n") + "\n"

const GROOVY = [
  "import org.springframework.stereotype.Service",
  "class App {}",
].join("\n") + "\n"

// A negative control: user code whose module path merely CONTAINS a framework
// root must NOT be detected (the isRoot contract the detector documents).
const SCALA_NEGATIVE = [
  "import com.mycompany.springlike.internal.Thing",
  "import mycats.Custom",
  "class App",
].join("\n") + "\n"

async function run(lang: string, name: string, src: string) {
  const tmp = `/tmp/bb-fw-${lang}-${name}.${lang === "kotlin" ? "kt" : lang === "groovy" ? "groovy" : lang === "java" ? "java" : "scala"}`
  fs.writeFileSync(tmp, src)
  const parsed: any = await ASTEngine.parseFile(tmp, src)
  const fw = parsed?.metadata?.detectedFrameworks ?? parsed?.detectedFrameworks ?? []
  console.log(`  ${lang.padEnd(7)} ${name.padEnd(16)} -> ${JSON.stringify(fw)}`)
  return fw as string[]
}

async function main() {
  console.log("=== #741 reproduction (HEAD) ===")
  const scalaSpring = await run("scala", "spring", SCALA)
  await run("scala", "spring+others", SCALA_MISSING)
  await run("scala", "negative", SCALA_NEGATIVE)
  console.log("  --- other JVM languages, same ecosystem ---")
  await run("java", "spring", JAVA)
  await run("kotlin", "spring", KOTLIN)
  await run("groovy", "spring", GROOVY)

  console.log("")
  console.log("scala spring detected: " + (scalaSpring.length > 0 ? "YES" : "NO — #741 REPRODUCED"))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
