// GAD1/GAD3/GAD5/GAD6 fixture (M37 #599): read attribution, visibility from
// AST modifiers only, return-type refs under modifiers.
//
// - cap():   field read `cfg.limit` — JAD2 contract: the enclosing METHOD is
//            the read owner; the receiver variable (cfg) must NEVER become a
//            uses source.
// - leak():  contains the literal "this is private data" — raw-text visibility
//            would fabricate `private`; AST-only visibility keeps it public.
// - hidden(): `private def` — keyword-only modifiers are ANONYMOUS children;
//            GAD6 blindness would flip it public.
// - guard(): `protected def` — same anonymous-keyword path.
// - greet(): `public String greet()` — modifiers precede the return type;
//            GAD5 would stop collection at modifiers and lose the ref.
class Svc {
    Cfg cfg

    int cap() {
        cfg.limit
    }

    def leak() { return "this is private data" }

    private def hidden() { 1 }

    protected def guard() { 2 }

    public String greet() {
        "hi"
    }
}
