// M49 #757/#759 regression fixture — TS wave 3. Authored before analyzer run.
//
// Pins three contracts:
//   1. #757 async-arrow returnType: async () => 1 is Promise<number>, NOT
//      "void" (pre-fix: async expression-bodied arrows reported "void" —
//      actively misleading). Sync expression arrows infer too (T3 precedent
//      now true: () => 1 is number). Async block bodies wrap: Promise<string>.
//      Explicit annotations stay authoritative and are never re-wrapped.
//   2. #757-2 bracket-form taint: req['body'] produces the same user_input
//      taint source as req.body (pre-fix: invisible — only dotted member
//      expressions matched).
//   3. #759 interface-heritage overrides: interface Spring extends Readable
//      with the same-name member emits overrides Spring.subscribe ->
//      Readable.subscribe (structural tier, 0.95), in plain .ts AND inside
//      .d.ts declare-module ambients (pre-fix: zero overrides anywhere —
//      the class-only metadata.isOverride pass never saw interfaces).

const f1 = async () => 1;
const f2 = () => 1;
const f3 = async () => { return "x"; };
const f4 = async (): Promise<number> => 1;
const f5 = (): string => "s";

const b1 = req['body'];
const b2 = req.body;
const b3 = req['unknown'];

interface Readable {
  subscribe(fn: () => void): void;
}

interface Spring extends Readable {
  subscribe(fn: () => void): void;
}

interface Unrelated {
  distinct(): void;
}
