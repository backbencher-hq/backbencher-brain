import { CrossLanguageMigrationAssistant as MA } from "../../../../src/ast/cross-language-migration-assistant"
const rows = MA.migrationDictionaryRows()
const specifierFor = (key: string, language: string): string => {
  if (language === "dart") return `package:${key}/index.dart`
  if (["python","r","elixir","haskell","scala","erlang","lua","julia"].includes(language)) return key.split(".")[0]
  return key
}
const unreachable = rows.filter((row: any) => {
  const canonical = MA.canonicalPackageName(specifierFor(row.library, row.sourceLanguage), row.sourceLanguage)
  return canonical.name !== row.library
}).map((row: any) => ({ key: row.library, source: row.sourceLanguage, target: row.targetLanguage, canonical: MA.canonicalPackageName(specifierFor(row.library, row.sourceLanguage), row.sourceLanguage).name, excluded: MA.canonicalPackageName(specifierFor(row.library, row.sourceLanguage), row.sourceLanguage).excluded }))
const keys = [...new Set(rows.map((r: any) => r.library))].sort()
const unreachableKeys = [...new Set(unreachable.map((u) => u.key))].sort()
console.log(JSON.stringify({ rows: rows.length, distinctKeys: keys.length, unreachableRows: unreachable.length, unreachableKeysCount: unreachableKeys.length, unreachableKeys, unreachable }, null, 1))
