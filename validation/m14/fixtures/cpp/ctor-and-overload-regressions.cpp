// CPPD9/CPPD10/CPPD11 regressions (deep review 2026-09-05).
// CPPD9: constructor-body calls must be sourced to the "constructor" symbol
//        (normalized), never to the Class symbol; the qualified_calls payload
//        must land on the constructor, not the class.
// CPPD10: qualified_calls attach to the exact caller symbol (no cross-class
//         pollution when two classes have same-named methods).
// CPPD11: overloaded virtuals — Derived overriding the FIRST-declared base
//         overload must resolve (per-name signature LIST, not last-sig-wins).
class Engine {
public:
    Engine() { start(); warm(5); }
    void start() {}
    void warm(int x) {}
};

class Alpha {
public:
    void run() { aFn(); }
};

class Beta {
public:
    void run() { bFn(); }
};

class Base {
public:
    virtual void f(int) {}
    virtual void f(double) {}
    virtual void g() {}
};

class Derived : public Base {
public:
    void f(int) override {}
    void f(double) override {}
    void g() override {}
};

// CPPD13: template calls must emit the bare callee leaf (`func`, not
// `func<int>`); functor-temporary and pointer-to-member invocations have no
// named callee and emit nothing.
namespace ns {
template <typename T>
void func() {}
}

template <typename T>
struct Gadget
{
    template <typename U>
    void apply(U u) {}
    int operator()(int a, int b) { return a + b; }
};

void drive()
{
    ns::func<int>();
    Gadget<int> g;
    g.apply<double>(1.5);
    (void)g;
}
