//
// CP3 (loss audit) — a friend DEFINITION is a function the SOURCE writes.
//
// Per C++ [class.friend] `friend bool operator==(w, w) { … }` defines a free
// function in the enclosing namespace, invisible to ordinary lookup and found
// through ADL — which is how nlohmann's `to_json`/`from_json`/`operator==`
// serializers are picked up. Publishing nothing for it meant every edge naming
// one was unresolvable, so the definition is published as a `Function` owned by
// the scope that ENCLOSES the class, never by the class that befriended it, and
// its body's reads belong to the friend itself.
//
// CP2 stands for a friend DECLARATION, and it still does: a declaration defines
// nobody's function, so it mints no symbol. The two are told apart by the node
// type alone (`friend_declaration > function_definition` for a definition,
// `friend_declaration > declaration` for a declaration).
//
namespace ns {
class widget
{
    int size_ = 0;

    // Published: `operator==`, kind Function, owner `ns`.
    friend bool operator==(widget lhs, widget rhs)
    {
        return lhs.size_ == rhs.size_;
    }
};

class gadget
{
    int weight_ = 0;

    // CONTROL 1 — the SECOND friend in the file. Its owner must be `ns` too, and
    // it must NOT be owned by the first friend. Without the scope pop after the
    // friend's body, the first friend stayed on the scope stack for the rest of
    // the file: this definition published `operator==::operator!=` and the walk
    // emitted `contains operator== -> operator!=`, a containment edge between two
    // unrelated free functions whose endpoints are both real published symbols —
    // invisible to every endpoint-shape audit.
    friend bool operator!=(gadget lhs, gadget rhs)
    {
        return lhs.weight_ != rhs.weight_;
    }
};

class handle
{
    int id_ = 0;

    // NOT published (CP2): a friend declaration defines nobody's function.
    friend bool operator<(handle lhs, handle rhs);
};

// The out-of-line DEFINITION of the `operator<` declared above is one function
// with the declaration, spelled twice. CONTROL 2 — exactly ONE `operator<`
// symbol may exist in this file, and it must be this one: the first cut of the
// arm asked a helper that walked UP the ancestors for any `function_definition`,
// so the declaration inherited this body and published a SECOND `operator<` with
// the declaration's range, claiming a body it does not have.
bool operator<(handle lhs, handle rhs)
{
    return lhs.id_ < rhs.id_;
}
} // namespace ns

class free_widget
{
    int slot_ = 0;

    // CONTROL 3 — a friend defined where NOTHING but the file encloses it. Its
    // owner must be the file-scope answer (`global`), never the class, and the
    // walk must not invent a name for it.
    friend bool operator>(free_widget lhs, free_widget rhs)
    {
        return lhs.slot_ > rhs.slot_;
    }
};
