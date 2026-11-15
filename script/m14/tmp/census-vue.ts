import { scanAnalyzers } from "../../m12/regex-census-core"
async function main() {
  const fresh: any[] = await scanAnalyzers()
  for (const e of fresh) if (String(e.file).includes("vue")) console.log(e.line + " :: " + e.source)
}
main()
