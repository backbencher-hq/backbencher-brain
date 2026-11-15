function [total, doubled] = summarize(values)
total = sum(values);
doubled = scale(total);
end

function result = scale(value)
result = value * 2;
end
