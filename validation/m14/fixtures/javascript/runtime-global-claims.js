// RUNTIME + TEST-RUNNER GLOBAL CLAIMS — the SECOND closed, cited list
// (`src/ast/js-runtime-globals.ts`), beside the platform HOST_GLOBALS list.
//
// POSITIVE: a bare documented Node.js global (`process`, `Buffer`) and a bare documented
// test-runner global (`describe`, `it`, `test`, `expect`, `beforeEach`) are claimed, with their
// citation as the claim reason.
// NEGATIVE 1 — BINDING: `shadowed(context)` binds the name in this file, so the file's own
// binding refuses the claim (a local parameter is not the runner's global). The bound name is a
// table name that is NOT used as a positive in this file: the bound set is FILE-WIDE by design
// (over-collecting can only refuse a claim, never make one), so binding `describe` here would
// suppress the file's positive `describe` claim too.
// NEGATIVE 2 — MEMBER: a member of such a global is NOT claimed from this table — `process.env`
// emits a read of `env` whose leaf a project may genuinely declare as a property, and
// `expect(1).toBe(1)` names the leaf `toBe`. Only the bare ROOT is claimed.
// (Name-declaration refusal is pinned by javascript/host-global-claims for `setTimeout`; the guard
//  is the same file-wide bound-name test.)

describe('suite', () => {
  it('works', () => {
    expect(1).toBe(1)
  })
})

test('top', () => {})

beforeEach(() => {
  queueMicrotask(() => {})
})

function readNodeState() {
  return process.env.NODE_ENV
}

function makeBuffer() {
  return Buffer.from('x')
}

function shadowed(context) {
  context()
  return context
}
