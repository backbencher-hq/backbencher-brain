local sum = 0
local T = {}
T.__index = T

function process(items)
  local value = 1
  value = value + 1
  items.value = 2
  External:new(items)
  Unknown(items)
  local function inner(x)
    return x
  end
  return inner(value)
end

local callback = function(x) return x end
