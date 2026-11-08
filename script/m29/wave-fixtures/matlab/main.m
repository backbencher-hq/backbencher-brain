% PINS the matlab wave fixture pack (M29.R2 wave 3, wave-onboarding lane C).
% Uniform wave convention: class Greeter with method greet, exercised in main.

classdef Greeter
    % A greeter that reports the number of items it stores.
    properties (SetAccess = private)
        items
    end

    methods
        function obj = Greeter(items)
            obj.items = items;
        end

        % Returns the greeting for the stored items.
        function text = greet(obj)
            text = sprintf('hello %d', numel(obj.items));
        end
    end
end
