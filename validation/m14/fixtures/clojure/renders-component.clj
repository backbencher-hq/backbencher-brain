(ns clj.fixture.renders)

(defn widget []
  [:span "hello"])

(defn page []
  [:div [:p "text"] [widget]])

(defn bare-child []
  [:div widget])

(defn not-an-element []
  [widget])

(defn plain-call []
  (widget))

;; widget is named here in a comment
(defn string-mention []
  "widget")
