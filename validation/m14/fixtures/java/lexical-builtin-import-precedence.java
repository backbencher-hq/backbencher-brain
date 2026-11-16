package collisions;

import java.util.logging.Logger;

class Decoy {
    static class Logger {
        static void fake() {}
    }
}

class Caller {
    void run() {
        Logger.getLogger("application");
        System.out.println("platform");
    }
}
