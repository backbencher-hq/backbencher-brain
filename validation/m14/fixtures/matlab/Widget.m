% Object construction in MATLAB is the class name applied to arguments. The
% constructor is a method whose name IS the class name; a local function in the
% class file can construct the class, and that call site is an instantiation.
classdef Widget
    properties
        value
    end
    methods
        function obj = Widget(v)
            obj.value = v;
        end
        function out = read(obj)
            out = obj.value;
        end
    end
end

function obj = makeWidget()
    obj = Widget(42);
end
