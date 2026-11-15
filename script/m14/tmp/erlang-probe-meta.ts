import * as fs from "fs"
import { ASTEngine } from "../../../src/ast/engine"
for (const f of [
  "/home/sano/ishaq/bb_tests/repositories/otp/lib/stdlib/test/epp_SUITE_data/pmod.erl",
  "/home/sano/ishaq/bb_tests/repositories/otp/lib/wx/api_gen/wx_extra/wxXmlResource.erl",
  "/home/sano/ishaq/bb_tests/repositories/otp/lib/stdlib/test/epp_SUITE_data/mac2.erl",
]) {
  const r: any = await ASTEngine.parseFile(f, fs.readFileSync(f, "utf8"))
  console.log(f.split("/").pop(), "| symbols:", (r.symbols ?? []).length, "| errors:", (r.errors ?? []).length, "| grammarDamaged:", r.metadata?.grammarDamaged)
}
