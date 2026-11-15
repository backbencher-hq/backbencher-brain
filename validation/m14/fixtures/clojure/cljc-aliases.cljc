(ns clj.fixture.cljc
  #?(:clj (:require [clojure.string :as s]))
  (:require #?(:clj [clj.fixture.dual :as d] :cljs [clj.fixture.dual :as d]))
  (:require-macros [clj.fixture.macros :as m])
  (:require [clj.fixture.alias :as-alias aa]))

(defn f [] (s/join "," [1]))

(defn g [] (m/go))

(defn h [] (d/x))

(defn i [] (aa/x))
