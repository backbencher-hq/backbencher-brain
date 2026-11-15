// THE BASE HALF of the cpp cross-file `overrides` pin. Pinned for its own sake,
// as php/cross-file-override-base is: the subclass fixture's forbid rows are only
// meaningful against a KNOWN declaration set. `inheritedOnly` and `neverRedeclared`
// are here precisely so that "the base does not declare it" is checkable.
class ExternalInterface {
public:
    virtual ~ExternalInterface() {}
    // redeclared with the `override` keyword in the subclass fixture: a genuine
    // cross-file override, provable from the keyword + this declaration
    virtual void step(int times) = 0;
    // redeclared there too, with a DIFFERENT parameter type: this is a HIDE, not
    // an override, and the two must not be confused
    virtual void tune(int level) { }
    // redeclared there WITHOUT the `override` keyword: indistinguishable from a
    // hide on a name-only companion, so no edge may be published for it
    virtual void probe(int depth) { }
    // NOT redeclared: inheriting is not overriding
    virtual void inheritedOnly(int n) { }
    int neverRedeclared = 0;
};

class ExternalSidecar {
public:
    // a base with the SAME method name as ExternalInterface::step, in a different
    // class — the leaf-name collision a cross-file lookup has to survive
    virtual void step(int times) { }
};

// a base that is NOT virtual anywhere: a same-name method here is plain hiding
// and no `overrides` edge may ever name it
class NonVirtualBase {
public:
    void step(int times) { }
    void tune(int level) { }
};