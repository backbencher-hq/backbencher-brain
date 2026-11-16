// A nested type declared within an INHERITED member type is nameable
// by the relative chain (InnerBase.Deep), not just by the leaf (Deep).
// A same-named decoy outside the hierarchy must not be selected.
class Decoy {
    static class InnerBase {
        static class Deep {
            void decoyOnly() {}
        }
    }
}

class Ancestor {
    static class InnerBase {
        static class Deep {
            void ping() {}
            void ancestorOnly() {}
        }
    }
}

class Middle extends Ancestor {}

class Descendant extends Middle {
    class Nested extends InnerBase.Deep {
        @Override void ping() {}
        @Override void ancestorOnly() {}
        void decoyOnly() {}
    }
}
