public class ArrayAccessUses {
    int[] xs;
    int[][] grid;

    void f(int i, int j) {
        xs[i] = 5;
        int v = xs[i];
        grid[i][j] = v;
    }
}
