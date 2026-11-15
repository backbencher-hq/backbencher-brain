// The OTHER file of the local-read demonstration: it declares a member named `counter` and
// has nothing whatsoever to do with reads.dart. It exists so the store's own bare-name rule
// has exactly one declaration named `counter` to bind to.
//
// The shape is deliberately the most ordinary one available: a class, one field, a common
// English name. Nothing about it is unusual, which is the point — the defect it demonstrates
// needs no unusual input.

class Telemetry {
  int counter = 0;
}
