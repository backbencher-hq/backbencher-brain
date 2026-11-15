(ns clj.fixture.letfns)

(defn outer [] (letfn [(f [x] (g-inner x)) (g-inner [y] y)] (f 1)))
