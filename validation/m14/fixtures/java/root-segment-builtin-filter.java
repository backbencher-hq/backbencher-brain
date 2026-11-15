// M37.21 C5 fixture: the builtin/stdlib exclusion checks the ROOT segment of
// a qualified call only. `A.Logger.bar()` has root segment `A` (a user type)
// and a MID-CHAIN segment `Logger` (a stdlib root name) — the call is a USER
// call and must be emitted. The pre-C5 per-segment walk dropped it because
// `Logger` matched the stdlib root list.
class A {
    static class Logger {
        static void bar() {}
    }

    void m() {
        A.Logger.bar();
    }
}
