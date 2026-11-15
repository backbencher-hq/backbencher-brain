package Outer {
  sub in_outer { 1 }
}
sub after_block { 2 }
package Second;
sub in_second { 3 }
1;
