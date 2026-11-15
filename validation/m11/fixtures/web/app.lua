local config = require("config")

local Order = {}
Order.__index = Order

function Order.new(customer_id, items)
    local self = setmetatable({}, Order)
    self.customer_id = customer_id
    self.items = items or {}
    self.status = "pending"
    return self
end

function Order:add_item(product_id, qty)
    table.insert(self.items, { product_id = product_id, qty = qty })
end

function Order:total()
    local sum = 0
    for _, item in ipairs(self.items) do
        sum = sum + item.qty
    end
    return sum
end

local OrderBook = {}
OrderBook.__index = OrderBook

function OrderBook.new()
    return setmetatable({ orders = {} }, OrderBook)
end

function OrderBook:submit(order)
    order.status = "submitted"
    table.insert(self.orders, order)
    return #self.orders
end

function OrderBook:find_by_customer(customer_id)
    for _, order in ipairs(self.orders) do
        if order.customer_id == customer_id then
            return order
        end
    end
    return nil
end

local M = {
    Order = Order,
    OrderBook = OrderBook,
    version = config.version,
}

function M.process(order)
    local book = OrderBook.new()
    return book:submit(order)
end

return M
