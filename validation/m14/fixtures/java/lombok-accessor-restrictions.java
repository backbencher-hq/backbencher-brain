package audit;

import lombok.Data;

@Data
class AccessorRestrictions {
    private final String id = "stable";
    private static int counter;
    private long amount;
}
