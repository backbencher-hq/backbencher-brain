interface Box<T> {
  value: T;
}

function wrap<T>(x: T): Box<T> {
  return { value: x };
}

const w = wrap<Baz>(qux);

// M37 TSD3 leaf-identity contract: qualified `new ns.Thing()` — the target
// is the LEAF (Thing), matching JS parity; pre-fix emitted "ns.Thing".
import * as ns from "./ns";
export function make(): Thing {
  return new ns.Thing();
}
