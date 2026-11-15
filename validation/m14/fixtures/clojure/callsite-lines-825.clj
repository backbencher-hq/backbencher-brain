(ns clj.fixture.lines)

(defn pick
  ([] :none)
  ([x] x))

(defn sites []
  (pick)
  (pick 1)
  (pick 2))

(defn qualified-sites []
  (clojure.string/join "," [])
  (clojure.string/join ";" []))
