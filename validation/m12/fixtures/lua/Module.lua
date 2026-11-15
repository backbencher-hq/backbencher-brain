local M = {}
local config = { name = "demo", nested = { enabled = true } }
M.__index = M

function M.new(value, ...)
  local self = setmetatable({ value = value }, M)
  return self
end

function M:add_item(item)
  self.items = self.items or {}
  table.insert(self.items, item)
end

local function helper(x)
  return x
end

function run(items)
  local module = require("demo.core")
  local result = M:new(module)
  local callback = function(x) return helper(x) end
  coroutine.create(callback)
  return result
end

return M
