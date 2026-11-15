// task-22 project-index fixture — DECLARATIONS ONLY, deliberately in a header the analyzer's own
// population does not parse (extension-only index first; the .h boundary is a separate ruling).
#pragma once

struct Base {
    virtual void start();
    virtual void run();
    // A STATIC member, so a QUALIFIED call `Base::create()` is legal C++ and names its owner
    // syntactically — the shape the owner-channel consumption must feed.
    static int create();
    int value;
};

// task-22 milestone 5 (receiver typing) declarations:
//   Factory().start()  -> constructor-temp owner Factory
//   Factory f; f.start() -> typed-local owner Factory
//   Base& b; b.start()   -> typed-local (parameter) owner Base
//   make().start()       -> OPAQUE receiver: `make` is a FUNCTION, not a type -> NO owner
//   Other o; o.start()   -> typed local whose type does NOT declare start -> NO owner
struct Factory {
    int start();
};
struct Other {
    void nothing();
};
Factory make();

int compute(int x);
