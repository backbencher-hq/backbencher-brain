// M14 ONTOLOGY — `implements`: a base with a PURE VIRTUAL member (`= 0`) is
// C++'s interface, and `Derived : public IFace` is the spelling that says
// "implements this contract".
//
// Every case here exists because the previous ruling was PROSE ("C++ has no
// separate interface construct") and the ontology gate exists because prose lost
// that argument once already, for `overrides`. The corpus measurement that
// overturns it: 127 pure-virtual members in 26 files, 28 classes that declare at
// least one, 171 (derived -> contract) pairs — 12 of them inside the lane's own
// `cpp-example` corpus.
class Reader {
public:
    virtual ~Reader() {}
    virtual int read(char* buf, int n) = 0;   // PURE: the contract
    virtual void seek(int off) { }            // virtual with a body: not pure
    int fd = 0;                               // state: a base with state is still a base
};

class Writer {
public:
    virtual void write(char c) = 0;
};

class Concrete : public Reader {
public:
    int read(char* buf, int n) override { return 0; }
};

class Both : public Reader, public Writer {
public:
    int read(char* buf, int n) override { return 0; }
    void write(char c) override {}
};

// NEGATIVE: `Plain` has NO base at all, so there is nothing to implement.
class Plain {
public:
    virtual void ping() = 0;
};

// NEGATIVE: `Impostor : Plain` DOES inherit a pure-virtual base, and it is a
// real `implements` edge — asserted below. What must NOT happen is an
// `implements` edge to a base with no pure virtual: `Derived2 : ReaderLike`
// where ReaderLike declares only virtuals WITH bodies.
class ReaderLike {
public:
    virtual int read(char* buf, int n) { return 0; }
};

class Derived2 : public ReaderLike {
public:
    int read(char* buf, int n) override { return 1; }
};

// NEGATIVE: a defaulted ARGUMENT is not a pure specifier. `int read(char*, int n = 0)`
// puts the `=` inside the parameter_list, and reading "a `= 0` on a declaration"
// without that distinction would classify every defaulted-int function as a
// contract member.
class Defaulted {
public:
    virtual int width(int n = 0) { return n; }
};

class UsesDefaulted : public Defaulted {
public:
    int width(int n = 0) override { return n + 1; }
};

// NEGATIVE, and the arm the mutation run actually needed. `virtual int width(
// int n = 0);` — a class-scope method DECLARATION, not a definition — parses as a
// `field_declaration` whose `function_declarator` holds an
// `optional_parameter_declaration`, and the `=` + `0` live INSIDE that
// parameter_list. So it is a `field_declaration` carrying a `= 0` two levels
// down, which is exactly what a subtree scan for a pure specifier finds and a
// direct-child scan does not.
//
// The `Defaulted` arm above does NOT catch that, because a defaulted argument on
// a method DEFINITION lives on a `function_definition`, and
// `isPureVirtualDeclaration` refuses that node type before it looks at any
// children. So this arm exists because the first version of
// `cpp/ontology-pure-virtual-subtree-scan` SURVIVED against the fixture without
// it.
class DeclaredDefaulted {
public:
    virtual int width(int n = 0);
};

class UsesDeclaredDefaulted : public DeclaredDefaulted {
public:
    int width(int n = 0) override;
};

// NEGATIVE: a member INITIALIZER is not a pure specifier either. `int x = 0;`
// is a `field_declaration` with an `init_declarator` and no function declarator.
struct WithInit {
    int counter = 0;
    int other{0};
};

struct Derived3 : public WithInit {
    int counter = 1;
};

// The derived class may appear BEFORE the base it implements — the registry has
// to be filled first and adjudicated after the walk, or this pair is lost.
class ForwardDerived : public LaterInterface {
public:
    void ping() override {}
};

class LaterInterface {
public:
    virtual void ping() = 0;
};