// M14-HONESTY-CONTRACT §4 — every edge below confidence 1.0 carries a
// MACHINE-READABLE reason code.
//
// The measurement that produced this fixture, from
// script/cpp-review/ontology-census.ts over 929 corpus files (912 attributed to
// cpp) through the production entry:
//
//   type         below 1.0   of those, carrying NO reasonCode
//   overrides          103                     0    (signature-match)
//   references         625                   625    <- the violation
//   uses             3,012                 3,012    <- the violation
//
// 3,637 rows carried a number a consumer could bucket and not explain, and
// `classifyEvidenceTier` defaults a MISSING confidence to 1 — so the class was
// invisible from inside the analyzer and from the evidence tier at once. That is
// the same shape as the `calls` finding in the previous round (101,340 rows with
// no confidence field at all), caught here by asking the contract's own question
// instead of reading the table.
//
// Each code below states WHY the edge is under 1.0, in terms a reader can check:
//   - a member read names the member and the SCOPE; the receiver's TYPE is not
//     resolved anywhere in this analyzer, so which class declares it is unknown.
//   - a using-dependency binds the name the source spells and nothing inside the
//     named module; `using std::vector;` does not say which `vector`.
//   - a signature-matched override is an inference: the author did not write
//     `override`, so a same-name/same-parameter coincidence is indistinguishable
//     from a real override on this evidence.
//   - a keyword-asserted override IS a fact and is published at 1.0.
#include <vector>
#include <string>

using std::string;
using std::pair;

// A member read: `state.count` — a `uses` edge under 1.0.
struct Counter {
    int count;
    void bump(void) { count = count + 1; }
};

void readMember(Counter& state) {
    int n = state.count;   // a member READ, published at 0.9
    (void)n;
}

// NEGATIVE ARM: an assignment to a member is a WRITE, not a read, so it must not
// publish a `uses` edge at all — which also means it must not publish one with a
// reason code.
void writeMember(Counter& state) {
    state.count = 3;       // a member WRITE
}

// An interface with a pure virtual, a derived class that overrides it WITHOUT the
// keyword (an inference, 0.9) and one that overrides it WITH the keyword (a fact,
// 1.0). Same file, same base, so the two confidences are comparable.
struct Shape {
    virtual ~Shape() { }
    virtual int sides(void) const = 0;
    virtual double area(void) const = 0;
};

struct Silent : Shape {
    int sides(void) const { return 3; }          // no keyword: signature inference
    double area(void) const { return 0.0; }
};

struct Asserted : Shape {
    int sides(void) const override { return 4; } // the author asserted it
    double area(void) const override { return 0.0; }
};

// A construction: `instantiates` at 1.0, so it must NOT claim to be a heuristic.
struct Widget { int field; };

void construct(void) {
    Widget w;               // an aggregate init, not a new_expression
    (void)w.field;
}