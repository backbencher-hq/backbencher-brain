# R5 reference classes: fields= data members and methods= list.
Account <- setRefClass("Account",
  fields = list(balance = "numeric", owner = "character"),
  methods = list(
    deposit = function(amount) {
      balance <<- balance + amount
    },
    show = function() print(balance)
  ),
  contains = "Ledger"
)
