import { CrossLanguageMigrationAssistant as MA } from "../../../../src/ast/cross-language-migration-assistant"
const rows = MA.migrationDictionaryRows()
const keys = [...new Set(rows.map((r: any) => r.library))]
console.log(JSON.stringify({ rows: rows.length, keys: keys.length, keysSample: keys.filter(k => ["react","next","tailwindcss","tailwind","next.js","react context"].includes(k)) }))
