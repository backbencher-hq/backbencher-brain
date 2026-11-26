// A MEMBER CALL'S RECEIVER MUST BE TYPED, AND THE RIVAL MUST NOT WIN.
// `Widget.run` and `Other.run` are declared in two files, so the name model cannot tell them
// apart — if the analyzer emits no owner, the store's tie-break may bind to Other, a class this
// file never imports. Each case below states WHICH class, and the fixture forbids the rival.

class Widget {
  run() {
    return 1;
  }
  get value() {
    return 2;
  }
}

class Other {
  run() {
    return 3;
  }
  get value() {
    return 4;
  }
}

// 1. new_expression receiver — the class is in the constructor field.
export function viaNew() {
  return new Widget().run();
}

// 2. parenthesized wrapper — the package is NOT part of the type.
export function viaParens() {
  return new Widget().run();
}

// 3. new_expression receiver on the READ channel (property access, not a call).
export function viaNewRead() {
  return new Widget().value;
}

// 4. a local typed by `new` — the assignment channel.
export function viaLocal() {
  const w = new Widget();
  return w.run();
}

// 5. the RIVAL must never appear as the owner of any row in this file.
export function rivalIsNeverOwner() {
  return new Other().run();
}
