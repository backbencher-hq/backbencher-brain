//
// CP3 (loss audit) — a destructor is DECLARED BY THE SOURCE.
//
// `~lexer();` inside the class and `lexer::~lexer() { … }` outside it are a name
// the source writes, a member of the class like any other member function, and a
// body whose reads belong to the destructor. The old rule — "compiler-managed
// lifecycle members; exclude them from the declaration symbol set" — was not true
// of the construct: excluding it cost 15 definitions corpus-wide, left every edge
// naming one unresolvable, and dropped the member from its class's `contains`
// edge. The name keeps the SOURCE spelling (`~lexer`), as operator overloads do;
// only constructors are normalized, because a constructor's spelling IS the class
// name and would collide with the class symbol.
//
class lexer
{
public:
    int pos_ = 0;
    int depth_ = 0;

    // The in-class DECLARATION is published like the rest of the member
    // declarations (kind method, owner `lexer`, `isDeclaration` set), and it is
    // what carries the containment edge.
    ~lexer();
};

// The OUT-OF-LINE definition: a second symbol for the same declaration, with the
// same owner/kind/name and its own range, and every edge written in its body
// sourced at `~lexer` — the discipline every member function already gets.
lexer::~lexer()
{
    while (depth_ > 0)
    {
        pos_ = pos_ + depth_;
        depth_ = depth_ - 1;
    }
}

class scope_guard
{
public:
    int armed_ = 0;

    // CONTROL — a destructor DEFINED in the class: its body's reads are owned by
    // the destructor itself, never by the class that contains it.
    ~scope_guard()
    {
        if (armed_ > 0)
        {
            armed_ = 0;
        }
    }
};
