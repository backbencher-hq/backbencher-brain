// #612 store-phase: DECLARATION vs DEFINITION.
//
// A declaration and its definition can live in different files, and before this
// pin the store had nothing but the NAME to resolve a call with — so a
// prototype could win name resolution against the definition that implements it
// (the M14.0.SC1 shape: a c `extern` prototype in the caller's own file beat the
// cpp definition in another file, and the cross-language edge disappeared).
//
// This file carries BOTH sides of the rule at fixture scale:
//   only_declared  — a prototype with no definition anywhere: DECLARATION
//   Engine::run    — an in-class declaration (field_declaration): DECLARATION
//   only_defined   — a definition with no prototype: DEFINITION
//   Engine::stop   — an in-class definition with a body: DEFINITION
// The four together make the rule two-sided: marking everything (or nothing)
// fails the fixture either way.

int only_declared(int a);

int only_defined(int a) {
  return a * 2;
}

class Engine {
public:
  int run();
  int stop() { return run(); }
};
