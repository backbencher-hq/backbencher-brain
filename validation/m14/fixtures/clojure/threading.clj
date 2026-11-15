(ns clj.fixture.threads)

(defn f [x] (-> x (step1 1) step2 (step3)))

(defn g [x] (->> x (fltr odd?)))

(defn h [x] (cond-> x (pred? x) (step4 1)))
