// M49 W2 (#769) regression fixture — a member's identity includes its
// CONTAINING CONTAINER, not just its bare name in the module.
//
// Pre-fix the JS method dedup key was `${owner ?? "module"}:${name}`, and
// `scopeOwnerName` only knows CLASS scopes — so every object-literal member of
// a module shared ONE slot. The second `init()` of a SIBLING object literal
// replaced the first, dead-spanning its body and dropping its calls
// (lane-visible on vue-element-admin MarkdownEditor, whose props block has two
// `default()` factories: truth derived random/toFixed, the analyzer neither).
// TypeScript already kept both symbols; the family convergence contract
// requires the same graph for the same shape.
//
// Both contracts are pinned here: SIBLING containers never collide, while true
// duplicates INSIDE one container still collapse last-wins (family ruling
// Option A — JS executes the LAST same-key declaration).

const one = () => 1;
const two = () => 2;
const three = () => 3;
const four = () => 4;

const cfg = {
  alpha: { init() { return one(); } },
  beta: { init() { return two(); } },
};

const dup = {
  run() { return three(); },
  run() { return four(); },
};
