// task-22 project-index fixture — the CONSUMER file. Every read below is a row the analyzer already
// emits; the index consumes it to ATTACH declaration facts, never to add or drop a row.
#include "base.h"

struct Derived : public Base {
    void run() override;
    // IMPLICIT-THIS: bare call to an inherited member inside a method. The enclosing class is the
    // owner; the index's inheritance-closed member view proves Base declares `start`.
    void viaImplicit() { start(); }
};

// constructor-temp: the owner type is SPELLED at the call site.
int ctorTemp() { return Factory().start(); }
// typed-local: the receiver's written declaration type is the owner.
int typedLocal() { Factory f; return f.start(); }
// NEGATIVE (opaque): `make` is a function, not a type -> the receiver's type is NOT spelled.
int chainedNegative() { return make().start(); }
// NEGATIVE (typed local whose type does not declare the method): no owner may be attached.
int otherNegative() { Other o; o.start(); }
// A member that stays UNIQUE under the inheritance closure (`nothing` is Other's alone): the
// `memberOfProjectType` fact must be populated here, while `create` (inherited by Derived from Base
// now that the closure is correct) must explicitly read NOT-unique.
int uniqueMember() { Other o; o.nothing(); return 0; }

int make() {
    // QUALIFIED call: the owner is named by the spelling (`Base::create`). Consumption must attach
    // metadata.owner=Base here, and must NOT attach it to the bare member call below.
    return Base::create();
}

int use(Base& b, int x) {
    b.start();
    int y = compute(x);
    return y + printf("x");
}
