package p;

// Both references are legal: private access is shared by this top-level nest.
class Outer {
    static class Holder {
        private static class Deep {
            void ping() {}
        }
    }

    static class Direct extends Holder.Deep {
        @Override void ping() {}
    }

    static class Ancestor {
        static class InnerBase {
            private static class Nested {
                void work() {}
            }
        }
    }

    static class Descendant extends Ancestor {
        static class ThroughMember extends InnerBase.Nested {
            @Override void work() {}
        }
    }
}
