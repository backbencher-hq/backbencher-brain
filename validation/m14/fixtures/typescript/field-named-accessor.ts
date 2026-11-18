// A class FIELD legitimately NAMED `accessor` — valid TypeScript, and the pinned grammar loses
// the name: it reads `accessor` as the auto-accessor keyword and emits a MISSING name token.
// Before the 2026-11-18 recovery this file produced a symbol named "" and a
// `contains Config -> ""` edge (the whole-population arm's single NO-TARGET LANE DEFECT).
// The control is the field BESIDE it: a name the grammar carries normally must be untouched.
class Config {
  accessor: number = 1
  other: string = "x"
}

const instance = new Config()
const fromField = instance.accessor
export { Config, fromField }
