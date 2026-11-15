// M37 JSD1 write gate: CJS deep-export assignment is a WRITE — the member
// accesses below must NOT emit uses edges (pre-fix: uses module -> exports,
// uses module -> tag, uses exports -> direct).
module.exports.tag = 1
const svc = { limit: 1 }
svc.limit = 2
module.exports.sub = { a: 1 }
exports.direct = 2
