value = 4;
display(value);

function result = outer(seed)
result = inner(seed);
    function answer = inner(item)
    answer = item + 1;
    end
end
