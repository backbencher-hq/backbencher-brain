// What routes the running migration module actually supports, for the corpus languages
// the real-corpus evidence uses. Data from the module, never from a text scan.
import { CrossLanguageMigrationAssistant as MA } from "../../../src/ast/cross-language-migration-assistant"
const sources = ["elixir", "erlang", "clojure", "javascript", "typescript", "ruby", "python", "go", "rust"]
const targets = ["typescript", "python", "go", "rust", "erlang", "elixir", "clojure", "javascript", "ruby"]
const rows = MA.migrationDictionaryRows()
const dictionaries = new Set(rows.map((r: any) => `${r.sourceLanguage}->${r.targetLanguage}`))
console.log(JSON.stringify({
  rows: rows.length,
  sourceLanguages: [...new Set(rows.map((r: any) => r.sourceLanguage))].sort(),
  targetsFor: Object.fromEntries(sources.map((s) => [s, [...new Set(rows.filter((r: any) => r.sourceLanguage === s).map((r: any) => r.targetLanguage))].sort()])),
  routes: Object.fromEntries(sources.map((s) => [s, Object.fromEntries(targets.map((t) => [t, MA.hasMigrationRoute(s, t)]))])),
  resolveSourceLanguage: Object.fromEntries(["elixir", "erlang", "clojure", "javascript", "typescript"].map((l) => [l, MA.resolveSourceLanguage(l)])),
  dictPairs: dictionaries.size,
}, (_, v) => typeof v === "bigint" ? Number(v) : v, 1))
