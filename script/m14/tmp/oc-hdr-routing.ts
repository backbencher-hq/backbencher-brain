// script/m14/tmp/oc-hdr-routing.ts — who parses an Objective-C header?
//
// `src/ast/language-detection.ts` has a content-sniffing branch written for
// exactly this: a `.h` carrying `@interface`/`@protocol`/`@implementation` is
// routed to `objective-c`. But it only fires when a caller passes CONTENT, and
// the ingestion path does not:
//
//   parallel-indexer.ts:842   const parseFile = (poolWorker as any).parseFile
//   pool-worker.ts:431        detectLanguageFromPath(filePath)          // no content
//   engine.ts:1155/1164       detectLanguage(filePath, content)         // content
//
// `EXTENSION_LANGUAGE.h` is `"c"`, so on the indexer path every Objective-C
// header is parsed by the C grammar. This measures both paths on real files.
//
// Run: bun script/m14/tmp/oc-hdr-routing.ts
import { parseFile as workerParseFile } from "../../../src/ast/pool-worker"
import { ASTEngine } from "../../../src/ast/engine"
import * as fs from "node:fs"

const ROOT = "<corpus-root>/bb_tests/repositories"
const FILES = [
  "sdwebimage/SDWebImage/Core/SDImageCache.h",
  "sdwebimage/SDWebImage/include/SDWebImage/SDImageTransformer.h",
  "afnetworking/AFNetworking/AFHTTPSessionManager.h",
  "sdwebimage/SDWebImage/Core/SDImageCache.m", // control: an implementation file
]

async function main() {
  const pad = (s: string, n: number) => s.padEnd(n)
  console.log(pad("file", 46) + pad("indexer path (.h as ?)", 24) + pad("engine path", 14) + "worker symbols / edges")
  for (const rel of FILES) {
    const abs = `${ROOT}/${rel}`
    const src = fs.readFileSync(abs, "utf8")

    const worker = await workerParseFile(abs, ROOT).catch((e: any) => ({ error: e.message, language: "THREW", symbols: [] }))
    const engineLang = ASTEngine.detectLanguage(abs, src)

    const syms = (worker as any).symbols ?? []
    const rels = (worker as any).relationships ?? []
    console.log(
      pad(rel.split("/").slice(-2).join("/"), 46) +
      pad(String((worker as any).language ?? (worker as any).error ?? "?"), 24) +
      pad(String(engineLang ?? "(null)"), 14) +
      `${syms.length} / ${rels.length}` +
      ((worker as any).errors?.length ? `   errors=${(worker as any).errors.length}` : ""),
    )
  }
  console.log("\n(engine path = engine.detectLanguage(file, content): the content sniff M49 added)")
}
main()
