(ns clj.fixture.toplevelcalls)

(def state (make-state))
(defonce once (make-once))

(deftest behavior
  (is (works))
  (checks))

(defn after [] (ok))
