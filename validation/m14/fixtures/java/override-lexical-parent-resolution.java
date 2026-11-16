// The decoy is visited first; it must not become the inherited Base.
class Decoy {
    static class Base {
        void collide() {}
        void decoyOnly() {}
    }
}

class Owner {
    static class Base {
        void collide() {}
        void localOnly() {}
    }

    static class Middle extends Base {}

    static class Direct extends Base {
        @Override void collide() {}
        void decoyOnly() {}
    }

    static class Indirect extends Middle {
        @Override void collide() {}
        @Override void localOnly() {}
        void decoyOnly() {}
    }
}
