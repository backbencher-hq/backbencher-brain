;; PINS the clojure wave fixture pack (M29 wave 3, language-onboarding protocol).
;; Uniform wave convention: a greeter namespace with a greet function,
;; exercised in main, plus a named constant whose references must be resolvable.

(ns greeter)

(def greeting "hello")

(defn greet [items]
  (str greeting " " (count items)))

(defn -main []
  (println (greet ["a" "b"]))
  (println greeting))
