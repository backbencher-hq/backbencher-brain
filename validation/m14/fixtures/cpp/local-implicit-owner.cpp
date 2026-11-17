// LOCAL ENCLOSING-CLASS RECEIVER EVIDENCE — the per-file half of receiver typing.
//
// The analyzer's receiver channel has three shapes that need a COMPLETE project
// index (constructor temp, `new` expression, typed local) and one — implicit
// `this` — that needs nothing but the file it is already parsing: a member
// function body calling a bare name is bound by C++ name lookup to the enclosing
// class's own member. That fact is checkable against the analyzer's OWN
// published symbols, so it must not wait for an index the caller may not have.
//
// `this->shapeThis()` is the same fact spelled out: the receiver IS the enclosing
// class object, and the class publishes the member.
//
// THE POSITIVES all live in `run()`, `withLambda()` and `Widget::outOfLine()`, and
// `shapeLate`/`shapeThis` are declared BELOW the bodies that call them: the class's
// member list is only complete AFTER the file's symbols are collected, so the
// evidence has to be a post-pass over the finished symbol table. An implementation
// that attached the owner during the walk would pass on `shapeBare` and silently
// drop the late ones (mutant cpp/local-implicit-owner-walk-time-table).
//
// THE NEGATIVES are half the contract, one per way of over-claiming:
//   * `helper()` inside a member body — a name the class does NOT declare;
//   * `shared()` from `freeCaller` — a name that IS a Widget member, called with no
//     enclosing class, so there is no anchor;
//   * `w.shapeUnknown()` — a receiver whose type the index-free analyzer cannot
//     know (the typed-local shape is the INDEX arm's job);
//   * a LOCAL lambda named `shapeBare` shadows the member inside `withShadow()` —
//     block scope hides class scope, so the call names the lambda;
//   * a block-scope `using std::swap;` in `withUsing()` introduces `swap` and HIDES
//     the member of the same spelling — the idiom that must resolve to std::swap;
//   * `alpha::Pair` and `beta::Pair` are two classes with one spelling in one file:
//     a member table keyed by the owner NAME cannot tell them apart, so neither
//     gets a claim.

int helper();

void shared();          // free function, same NAME as the Widget member below

class Widget {
public:
    void shapeBare() const { }      // declared ABOVE run()

    void run() {
        shapeBare();        // member declared ABOVE the caller
        shapeLate();        // member declared BELOW the caller — the post-pass proof
        this->shapeThis();  // receiver spelled `this`; declared BELOW the caller too
        shared();           // the MEMBER wins name lookup over the free function
        helper();           // a free function, not a member
    }

    void shapeLate() const { }      // declared BELOW run()
    void shapeThis() const { }      // ditto
    void shapeLambda() const { }
    void shapeOutOfLine() const { }
    void shapeUnknown() const { }
    void shared() const { }
    void swap(int a, int b) const { }

    void withLambda() {
        auto f = [this]() { shapeLambda(); };
        f();
    }

    void withShadow();
    void withUsing();
    void outOfLine();
};

void Widget::outOfLine() {
    shapeOutOfLine();
}

void Widget::withShadow() {
    auto shapeBare = [] {};     // a block-scope binding of the member's name
    shapeBare();                // names the lambda, NOT Widget::shapeBare
}

void Widget::withUsing() {
    using std::swap;            // [namespace.udecl]/11: introduces `swap` here
    swap(1, 2);                 // names std::swap, NOT Widget::swap
}

void takeRef(Widget& w) {
    w.shapeUnknown();       // receiver type unknown to the index-free analyzer
}

void shared() { }

int helper() { return 1; }

void freeCaller() {
    shared();               // no enclosing class anchor
    helper();
}

namespace alpha {
class Pair {
public:
    void compute() const { }
    void runPairAlpha() { compute(); }   // `Pair` is declared TWICE in this file
};
}  // namespace alpha

namespace beta {
class Pair {
public:
    void other() const { }
};
}  // namespace beta
