import { CrossLanguageMigrationAssistant as MA } from "../../../../src/ast/cross-language-migration-assistant"
const rows = MA.migrationDictionaryRows() as any[]
const keys = new Set(rows.map((r) => r.library))
const idioms = ["pool.query","logger.error","Date.now","JSON.stringify","jest.fn"]
const framework = ["asp.net"]
const widgets = ["Container","Card","Center","CircularProgressIndicator","Column","BoxDecoration","Expanded","GestureDetector","Icon","ListView","MaterialApp","Padding","Row","Scaffold","SizedBox","Text"]
const displays = ["android jetpack","entity framework","redux toolkit","svelte motion","type providers"]
const count = (list: string[]) => list.filter((key) => keys.has(key) && rows.some((r) => r.library === key)).length
console.log(JSON.stringify({ rows: rows.length, distinctKeys: keys.size, idioms: count(idioms), framework: count(framework), widgets: count(widgets), displays: count(displays), knowledgeRows: rows.filter((r) => [...idioms,...framework,...widgets,...displays].includes(r.library)).length, unreachableRows: rows.filter((r) => ["flutter/material","shadcn/ui"].includes(r.library)).length }, null, 1))
