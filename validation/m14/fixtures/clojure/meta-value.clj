(ns clj.fixture.meta)

(def ^{:doc (meta-fn)} x 1)

(defn ^{:custom (meta-fn2)} f [] (real-call))
