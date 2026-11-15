library(dplyr)
library(ggplot2)

source("utils.R")

GLOBAL_BATCH_SIZE <- 1000
.GlobalEnv$app_name <- "orders"

order_total <- function(items) {
  sum(items$price * items$qty)
}

OrderBook <- R6::R6Class(
  "OrderBook",
  public = list(
    orders = NULL,
    initialize = function() {
      self$orders <- data.frame(
        id = integer(),
        total = numeric(),
        status = character()
      )
    },
    add_order = function(id, total) {
      self$orders <- rbind(self$orders, data.frame(id = id, total = total, status = "pending"))
    },
    summary = function() {
      self$orders %>%
        group_by(status) %>%
        summarise(count = n(), value = sum(total))
    }
  )
)

analyze <- function(orders) {
  orders %>%
    filter(status == "pending") %>%
    mutate(priority = ifelse(total > 100, "high", "low")) %>%
    arrange(desc(total))
}

plot_orders <- function(df, outfile) {
  p <- ggplot(df, aes(x = status, y = total)) +
    geom_boxplot()
  ggsave(outfile, plot = p)
}

compute_metrics <- function(df) {
  list(
    count = nrow(df),
    mean_total = mean(df$total),
    max_total = max(df$total)
  )
}

# S3 method
summary.OrderBook <- function(object, ...) {
  object$summary()
}

model <- lm(total ~ qty, data = mtcars)
