// The companion to `taint-sink-require-child-process`: that file proves the
// CommonJS `require("child_process")` form now sets the signal, and this one
// proves the signal is not set by anything that merely LOOKS like it.
//
// The rule accepts a `call_expression` whose callee is the bare `require`
// identifier or the `import` keyword. A `member_expression` callee is somebody
// else's method — `loader.require("child_process")` is a custom method call, not
// the module loader — so it must not arm the rule. If it did, every project
// with a `require` method on any object would get a bare `exec` reported as
// Node's own shell execution.
//
// The signals are per-FILE, which is why this needs its own fixture: a file
// containing one real `require` would have the signal set no matter what, and
// the negative would be unobservable.
//
// Authored BEFORE the analyzer run.
class Loader {
  require(_name: string): unknown {
    return null;
  }
}

export function load(name: string): unknown {
  return new Loader().require(name);
}

// A bare exec-family name with NO child_process import anywhere in this file:
// the rule's evidence never arrives, so this must not be reported as a shell
// sink. (`cmd` here is the project's own function, and the receiver rules
// applied to `this`/`new` receivers keep it out on their own as well.)
function exec(_command: string): string {
  return "";
}

export function runLocally(command: string): string {
  return exec(command);
}
