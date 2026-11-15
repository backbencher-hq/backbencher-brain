// Taint SINKS are receiver-based, exactly like the family rules they come from
// (java flags `stmt.executeQuery`, python flags `cursor.execute` — never a bare
// `execute()`). The pre-fix rules matched a bare name or a bare LEAF, so:
//
//   * `re.exec(input)` — RegExp.prototype.exec, not a shell — was reported as
//     command_injection, and because the store multiplies every taint SOURCE by
//     every SINK in a symbol, a single `req.body` read in the same function
//     manufactured a persisted command-injection flow in bb_security;
//   * a project's own `execute(q)` was reported as sql_injection;
//   * `this.spawn(cmd)` — the project's own method — was command_injection.
//
// The true positives are pinned alongside, including a BARE `exec(cmd)` whose
// only evidence is the file's child_process import: the rule must not lose it.
//
// Authored BEFORE the analyzer run: every pre-fix payload above was measured by
// probe, and the sink payload had NO fixture gate at all before this wave —
// that missing gate is why the false positives survived.
import { exec } from "node:child_process"

// FALSE POSITIVE 1: RegExp.prototype.exec.
export function parsePattern(input: string): RegExpExecArray | null {
  const re = /a(b)c/;
  return re.exec(input);
}

// FALSE POSITIVE 2: a project-local `execute`.
function execute(job: string): string {
  return job;
}

export function runJob(q: string): string {
  return execute(q);
}

// FALSE POSITIVE 3: the project's own spawn method.
export class Runner {
  spawn(command: string): number {
    return command.length;
  }
  runIt(command: string): number {
    return this.spawn(command);
  }
}

// TRUE POSITIVE 1: bare `exec`, proven by the child_process import above.
export function runShell(cmd: string): unknown {
  return exec(cmd);
}

// TRUE POSITIVE 2: a member call on a db-shaped receiver.
export function findUser(id: string): unknown {
  return db.query(id);
}

// TRUE POSITIVE 3: an actual taint flow — user input reaching a shell sink.
export function danger(req: any): unknown {
  return exec("ls " + req.query.dir);
}
