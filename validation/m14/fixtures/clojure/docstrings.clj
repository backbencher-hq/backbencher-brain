(ns clj.fixture.docs)

;; Leading block line one.
;; Leading block line two.
(defn commented [x] x)

(defn documented "Doc string wins." [x] x)

(def documented-var "Doc var." 1)

(def greeting "hello")
