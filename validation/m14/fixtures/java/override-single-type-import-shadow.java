import java.util.ArrayList;

class Decoy {
    static class ArrayList {
        void marker() {}
    }

    static class LocalChild extends ArrayList {
        @Override void marker() {}
    }
}

class ImportedChild extends ArrayList {
    void marker() {}
}
