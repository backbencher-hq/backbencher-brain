// Ground truth: what does the RUNTIME see? A duplicate key is legal JS with last-wins
// semantics, so evaluating the module is the only way to know which corpus a lane will
// actually be measured on.
const { LANG_REPOS, LANGS } = await import(process.cwd() + "/script/m14/differential.ts")
for (const k of ["bash", "json", "scss", "c", "clean", "clojure"]) {
  console.log(`  LANG_REPOS[${k.padEnd(7)}] = ${JSON.stringify((LANG_REPOS as any)[k])}`)
}
console.log(`\n  LANG_REPOS entries: ${Object.keys(LANG_REPOS).length}   LANGS entries: ${Object.keys(LANGS).length}`)
