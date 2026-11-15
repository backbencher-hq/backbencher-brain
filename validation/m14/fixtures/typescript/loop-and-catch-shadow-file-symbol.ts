// A LOOP VARIABLE and a CATCH BINDING shadow a same-named file-level symbol,
// and a read of that name inside the loop or the catch block resolves to the
// binding — never to the declaration that happens to share the name.
//
// This is the same principle the parameter case (R12) established, and the same
// reason it did not fall to one fix. Neither binding is reachable through the
// `variable_declarator` handler that covers `const x = …` inside a function:
// tree-sitter puts a for-of/for-in loop variable in as a DIRECT child of
// `for_in_statement` (a for-of head contains no `variable_declarator` node at
// all), and a catch binding hangs off `catch_clause`. So the shapes that
// pattern-handled correctly and the shapes that did not sat one node type apart.
//
// Measured before the fix: 81 `references` edges over 1200 tracked files, every
// one of a function referencing a file-level symbol whose name its own loop
// variable or catch parameter had just bound. After: 0, with 0 edges added and
// `uses`, `calls`, `contains`, `imports` and `exports` all at delta 0.
//
// WHY THE POSITIVES ARE PINNED AS HARD AS THE NEGATIVES: the obvious fix —
// seed `locals` with these names — silently deletes 891 `uses` edges over the
// same 1200 files, because `locals` also gates `uses` and a use of a loop
// variable is a real use (a template interpolation of a catch binding is a
// `uses` edge to the catch binding, exactly as R12 keeps `greet -> name` for a
// parameter). The suppression has to live in the `references` guard alone, and
// the pins below are what hold that line.
//
// Authored BEFORE the analyzer run.
function file(): string {
  return "module-level file";
}

function repo(): string {
  return "module-level repo";
}

function e(): string {
  return "module-level e";
}

function names(): string[] {
  return ["a", "b"];
}

// FALSE POSITIVE 1: the for-of loop variable shadows the module function.
export function forOfBare(): string {
  let acc = "";
  for (const file of names()) {
    acc += file;
  }
  return acc;
}

// FALSE POSITIVE 2: the for-in loop variable shadows the module function.
export function forInBare(): string {
  let acc = "";
  for (const repo in names()) {
    acc += repo;
  }
  return acc;
}

// FALSE POSITIVE 3: the catch binding shadows the module function.
export function catchBare(): string {
  try {
    return names().join();
  } catch (e) {
    return e;
  }
}

// FALSE POSITIVE 4: `for (k in obj)` with no declaration keyword still binds.
export function forInNoKeyword(): string {
  let acc = "";
  for (repo in names()) {
    acc += repo;
  }
  return acc;
}

// ALREADY CORRECT, pinned so a later change cannot regress it: a destructuring
// loop variable was always handled, because the pattern node reaches the
// object_pattern/array_pattern handler. This is the shape one node type over
// from FALSE POSITIVE 1, and it is the control that shows the gap was about
// reachability, not about patterns.
export function forOfPattern(): string {
  let acc = "";
  for (const { length } of [names()]) {
    acc += length;
  }
  return acc;
}

// TRUE POSITIVE 1: a bare `catch { … }` binds NOTHING, so the read genuinely
// does reach the module-level declaration. A fix that assumed every catch
// clause binds its first identifier would delete this edge.
export function catchWithoutBinding(): string {
  try {
    return names().join();
  } catch {
    return e();
  }
}

// TRUE POSITIVE 2: a read of the same name AFTER the loop is still the loop
// variable in the same function scope, and the module function is referenced
// only when the name is not bound at all in that scope.
export function afterLoopStillShadowed(): string {
  for (const file of names()) {
    void file;
  }
  return file();
}

// TRUE POSITIVE 3: the module function called with its own name, untouched by
// any loop or catch binding.
export function callsFile(): string {
  return file();
}

// TRUE POSITIVE 4: `uses` to a catch binding is wanted, and a fix that seeded
// `locals` instead of the reference guard would delete it. This is the pin that
// distinguishes the correct fix from the tempting one.
export function usesCatchBindingInTemplate(): string {
  try {
    return names().join();
  } catch (e) {
    return `${e}`;
  }
}
