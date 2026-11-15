// M49.S1 #715 regression fixture: groovy heritage + nested-interface override
// contracts (geb CachingDriverFactory real-corpus shape).
//
// Pins two wave rulings:
//   1. Oracle heritage targets are CLEAN head names — groovy's pinned grammar
//      folds type args into the supertype token (`Cache<T>`), and the pre-S1
//      oracle emitted the bracketed target raw, so decls matching died and
//      SimpleCache.get -> Cache.get surfaced unexplained.
//   2. Nested interface implementations resolve overrides transitively
//      (SimpleCache/ThreadLocalCache implement nested Cache).

package geb.driver

abstract class DriverFactory {
    abstract org.openqa.selenium.WebDriver getDriver()
}

class CachingDriverFactory extends DriverFactory {
    private interface Cache<T> {
        T get(Closure<? extends T> factory)
        T clear()
    }

    static private class SimpleCache<T> implements Cache<T> {
        private T cached

        synchronized T get(Closure<? extends T> factory) {
            if (cached == null) {
                cached = factory()
            }
            cached
        }

        synchronized T clear() {
            def prev = cached
            cached = null
            prev
        }
    }

    static private class ThreadLocalCache<T> implements Cache<T> {
        private ThreadLocal<T> threadLocal = new ThreadLocal()

        T get(Closure<? extends T> factory) {
            def cached = threadLocal.get()
            if (cached == null) {
                cached = factory()
                threadLocal.set(cached)
            }
            cached
        }

        T clear() {
            def prev = threadLocal.get()
            threadLocal.set(null)
            prev
        }
    }

    org.openqa.selenium.WebDriver getDriver() {
        null
    }
}
