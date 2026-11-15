/* #907 round 2 (M60-C) — the bare-identifier arrival.
 *
 * Verbatim jq vendor/decNumber/decNumber.c L1939-2320 (the enclosing damaged
 * function and the definitions it swallowed). This is the most degraded arrival
 * measured: the damaged region is `ERROR[2284-2346]`, whose 132 named children
 * are ALL flat identifiers — the `decNumber *` return type and the
 * `function_declarator` node are gone, so a bare name is all the tree offers.
 *
 * The enclosing function is part of the fixture on purpose. Taking the
 * definitions alone makes the slice parse cleanly and the fixture stops
 * exercising the rule at all: measured, every slice starting at or after L2000
 * recovers these names at the pre-round-2 tree, and only a slice carrying L1939
 * reproduces the loss (script/m14/tmp/c907-slice-hunt.ts and the round-2 A/B).
 *
 * Safety is textual: a bare identifier is accepted only if (a) a type/storage
 * token sits between the previous statement terminator and the name, and (b) the
 * name's own parameter list is followed by `{`. A call has the identical AST
 * shape — `forbidSymbols` pins the macro-invocation form that this guard refuses.
 */
decNumber * decNumberPower(decNumber *res, const decNumber *lhs,
                           const decNumber *rhs, decContext *set) {
  #if DECSUBSET
  decNumber *alloclhs=NULL;        // non-NULL if rounded lhs allocated
  decNumber *allocrhs=NULL;        // .., rhs
  #endif
  decNumber *allocdac=NULL;        // -> allocated acc buffer, iff used
  decNumber *allocinv=NULL;        // -> allocated 1/x buffer, iff used
  Int   reqdigits=set->digits;     // requested DIGITS
  Int   n;                         // rhs in binary
  Flag  rhsint=0;                  // 1 if rhs is an integer
  Flag  useint=0;                  // 1 if can use integer calculation
  Flag  isoddint=0;                // 1 if rhs is an integer and odd
  Int   i;                         // work
  #if DECSUBSET
  Int   dropped;                   // ..
  #endif
  uInt  needbytes;                 // buffer size needed
  Flag  seenbit;                   // seen a bit while powering
  Int   residue=0;                 // rounding residue
  uInt  status=0;                  // accumulators
  uByte bits=0;                    // result sign if errors
  decContext aset;                 // working context
  decNumber dnOne;                 // work value 1...
  // local accumulator buffer [a decNumber, with digits+elength+1 digits]
  decNumber dacbuff[D2N(DECBUFFER+9)];
  decNumber *dac=dacbuff;          // -> result accumulator
  // same again for possible 1/lhs calculation
  decNumber invbuff[D2N(DECBUFFER+9)];

  #if DECCHECK
  if (decCheckOperands(res, lhs, rhs, set)) return res;
  #endif

  do {                             // protect allocated storage
    #if DECSUBSET
    if (!set->extended) { // reduce operands and set status, as needed
      if (lhs->digits>reqdigits) {
        alloclhs=decRoundOperand(lhs, set, &status);
        if (alloclhs==NULL) break;
        lhs=alloclhs;
        }
      if (rhs->digits>reqdigits) {
        allocrhs=decRoundOperand(rhs, set, &status);
        if (allocrhs==NULL) break;
        rhs=allocrhs;
        }
      }
    #endif
    // [following code does not require input rounding]

    // handle NaNs and rhs Infinity (lhs infinity is harder)
    if (SPECIALARGS) {
      if (decNumberIsNaN(lhs) || decNumberIsNaN(rhs)) { // NaNs
        decNaNs(res, lhs, rhs, set, &status);
        break;}
      if (decNumberIsInfinite(rhs)) {   // rhs Infinity
        Flag rhsneg=rhs->bits&DECNEG;   // save rhs sign
        if (decNumberIsNegative(lhs)    // lhs<0
         && !decNumberIsZero(lhs))      // ..
          status|=DEC_Invalid_operation;
         else {                         // lhs >=0
          decNumberZero(&dnOne);        // set up 1
          dnOne.lsu[0]=1;
          decNumberCompare(dac, lhs, &dnOne, set); // lhs ? 1
          decNumberZero(res);           // prepare for 0/1/Infinity
          if (decNumberIsNegative(dac)) {    // lhs<1
            if (rhsneg) res->bits|=DECINF;   // +Infinity [else is +0]
            }
           else if (dac->lsu[0]==0) {        // lhs=1
            // 1**Infinity is inexact, so return fully-padded 1.0000
            Int shift=set->digits-1;
            *res->lsu=1;                     // was 0, make int 1
            res->digits=decShiftToMost(res->lsu, 1, shift);
            res->exponent=-shift;            // make 1.0000...
            status|=DEC_Inexact|DEC_Rounded; // deemed inexact
            }
           else {                            // lhs>1
            if (!rhsneg) res->bits|=DECINF;  // +Infinity [else is +0]
            }
          } // lhs>=0
        break;}
      // [lhs infinity drops through]
      } // specials

    // Original rhs may be an integer that fits and is in range
    n=decGetInt(rhs);
    if (n!=BADINT) {                    // it is an integer
      rhsint=1;                         // record the fact for 1**n
      isoddint=(Flag)n&1;               // [works even if big]
      if (n!=BIGEVEN && n!=BIGODD)      // can use integer path?
        useint=1;                       // looks good
      }

    if (decNumberIsNegative(lhs)        // -x ..
      && isoddint) bits=DECNEG;         // .. to an odd power

    // handle LHS infinity
    if (decNumberIsInfinite(lhs)) {     // [NaNs already handled]
      uByte rbits=rhs->bits;            // save
      decNumberZero(res);               // prepare
      if (n==0) *res->lsu=1;            // [-]Inf**0 => 1
       else {
        // -Inf**nonint -> error
        if (!rhsint && decNumberIsNegative(lhs)) {
          status|=DEC_Invalid_operation;     // -Inf**nonint is error
          break;}
        if (!(rbits & DECNEG)) bits|=DECINF; // was not a **-n
        // [otherwise will be 0 or -0]
        res->bits=bits;
        }
      break;}

    // similarly handle LHS zero
    if (decNumberIsZero(lhs)) {
      if (n==0) {                            // 0**0 => Error
        #if DECSUBSET
        if (!set->extended) {                // [unless subset]
          decNumberZero(res);
          *res->lsu=1;                       // return 1
          break;}
        #endif
        status|=DEC_Invalid_operation;
        }
       else {                                // 0**x
        uByte rbits=rhs->bits;               // save
        if (rbits & DECNEG) {                // was a 0**(-n)
          #if DECSUBSET
          if (!set->extended) {              // [bad if subset]
            status|=DEC_Invalid_operation;
            break;}
          #endif
          bits|=DECINF;
          }
        decNumberZero(res);                  // prepare
        // [otherwise will be 0 or -0]
        res->bits=bits;
        }
      break;}

    // here both lhs and rhs are finite; rhs==0 is handled in the
    // integer path.  Next handle the non-integer cases
    if (!useint) {                      // non-integral rhs
      // any -ve lhs is bad, as is either operand or context out of
      // bounds
      if (decNumberIsNegative(lhs)) {
        status|=DEC_Invalid_operation;
        break;}
      if (decCheckMath(lhs, set, &status)
       || decCheckMath(rhs, set, &status)) break; // variable status

      decContextDefault(&aset, DEC_INIT_DECIMAL64); // clean context
      aset.emax=DEC_MAX_MATH;           // usual bounds
      aset.emin=-DEC_MAX_MATH;          // ..
      aset.clamp=0;                     // and no concrete format

      // calculate the result using exp(ln(lhs)*rhs), which can
      // all be done into the accumulator, dac.  The precision needed
      // is enough to contain the full information in the lhs (which
      // is the total digits, including exponent), or the requested
      // precision, if larger, + 4; 6 is used for the exponent
      // maximum length, and this is also used when it is shorter
      // than the requested digits as it greatly reduces the >0.5 ulp
      // cases at little cost (because Ln doubles digits each
      // iteration so a few extra digits rarely causes an extra
      // iteration)
      aset.digits=MAXI(lhs->digits, set->digits)+6+4;
      } // non-integer rhs

     else { // rhs is in-range integer
      if (n==0) {                       // x**0 = 1
        // (0**0 was handled above)
        decNumberZero(res);             // result=1
        *res->lsu=1;                    // ..
        break;}
      // rhs is a non-zero integer
      if (n<0) n=-n;                    // use abs(n)

      aset=*set;                        // clone the context
      aset.round=DEC_ROUND_HALF_EVEN;   // internally use balanced
      // calculate the working DIGITS
      aset.digits=reqdigits+(rhs->digits+rhs->exponent)+2;
      #if DECSUBSET
      if (!set->extended) aset.digits--;     // use classic precision
      #endif
      // it's an error if this is more than can be handled
      if (aset.digits>DECNUMMAXP) {status|=DEC_Invalid_operation; break;}
      } // integer path

    // aset.digits is the count of digits for the accumulator needed
    // if accumulator is too long for local storage, then allocate
    needbytes=sizeof(decNumber)+(D2U(aset.digits)-1)*sizeof(Unit);
    // [needbytes also used below if 1/lhs needed]
    if (needbytes>sizeof(dacbuff)) {
      allocdac=(decNumber *)malloc(needbytes);
      if (allocdac==NULL) {   // hopeless -- abandon
        status|=DEC_Insufficient_storage;
        break;}
      dac=allocdac;           // use the allocated space
      }
    // here, aset is set up and accumulator is ready for use

    if (!useint) {                           // non-integral rhs
      // x ** y; special-case x=1 here as it will otherwise always
      // reduce to integer 1; decLnOp has a fastpath which detects
      // the case of x=1
      decLnOp(dac, lhs, &aset, &status);     // dac=ln(lhs)
      // [no error possible, as lhs 0 already handled]
      if (ISZERO(dac)) {                     // x==1, 1.0, etc.
        // need to return fully-padded 1.0000 etc., but rhsint->1
        *dac->lsu=1;                         // was 0, make int 1
        if (!rhsint) {                       // add padding
          Int shift=set->digits-1;
          dac->digits=decShiftToMost(dac->lsu, 1, shift);
          dac->exponent=-shift;              // make 1.0000...
          status|=DEC_Inexact|DEC_Rounded;   // deemed inexact
          }
        }
       else {
        decMultiplyOp(dac, dac, rhs, &aset, &status);  // dac=dac*rhs
        decExpOp(dac, dac, &aset, &status);            // dac=exp(dac)
        }
      // and drop through for final rounding
      } // non-integer rhs

     else {                             // carry on with integer
      decNumberZero(dac);               // acc=1
      *dac->lsu=1;                      // ..

      // if a negative power the constant 1 is needed, and if not subset
      // invert the lhs now rather than inverting the result later
      if (decNumberIsNegative(rhs)) {   // was a **-n [hence digits>0]
        decNumber *inv=invbuff;         // assume use fixed buffer
        decNumberCopy(&dnOne, dac);     // dnOne=1;  [needed now or later]
        #if DECSUBSET
        if (set->extended) {            // need to calculate 1/lhs
        #endif
          // divide lhs into 1, putting result in dac [dac=1/dac]
          decDivideOp(dac, &dnOne, lhs, &aset, DIVIDE, &status);
          // now locate or allocate space for the inverted lhs
          if (needbytes>sizeof(invbuff)) {
            allocinv=(decNumber *)malloc(needbytes);
            if (allocinv==NULL) {       // hopeless -- abandon
              status|=DEC_Insufficient_storage;
              break;}
            inv=allocinv;               // use the allocated space
            }
          // [inv now points to big-enough buffer or allocated storage]
          decNumberCopy(inv, dac);      // copy the 1/lhs
          decNumberCopy(dac, &dnOne);   // restore acc=1
          lhs=inv;                      // .. and go forward with new lhs
        #if DECSUBSET
          }
        #endif
        }

      // Raise-to-the-power loop...
      seenbit=0;                   // set once a 1-bit is encountered
      for (i=1;;i++){              // for each bit [top bit ignored]
        // abandon if had overflow or terminal underflow
        if (status & (DEC_Overflow|DEC_Underflow)) { // interesting?
          if (status&DEC_Overflow || ISZERO(dac)) break;
          }
        // [the following two lines revealed an optimizer bug in a C++
        // compiler, with symptom: 5**3 -> 25, when n=n+n was used]
        n=n<<1;                    // move next bit to testable position
        if (n<0) {                 // top bit is set
          seenbit=1;               // OK, significant bit seen
          decMultiplyOp(dac, dac, lhs, &aset, &status); // dac=dac*x
          }
        if (i==31) break;          // that was the last bit
        if (!seenbit) continue;    // no need to square 1
        decMultiplyOp(dac, dac, dac, &aset, &status); // dac=dac*dac [square]
        } /*i*/ // 32 bits

      // complete internal overflow or underflow processing
      if (status & (DEC_Overflow|DEC_Underflow)) {
        #if DECSUBSET
        // If subset, and power was negative, reverse the kind of -erflow
        // [1/x not yet done]
        if (!set->extended && decNumberIsNegative(rhs)) {
          if (status & DEC_Overflow)
            status^=DEC_Overflow | DEC_Underflow | DEC_Subnormal;
           else { // trickier -- Underflow may or may not be set
            status&=~(DEC_Underflow | DEC_Subnormal); // [one or both]
            status|=DEC_Overflow;
            }
          }
        #endif
        dac->bits=(dac->bits & ~DECNEG) | bits; // force correct sign
        // round subnormals [to set.digits rather than aset.digits]
        // or set overflow result similarly as required
        decFinalize(dac, set, &residue, &status);
        decNumberCopy(res, dac);   // copy to result (is now OK length)
        break;
        }

      #if DECSUBSET
      if (!set->extended &&                  // subset math
          decNumberIsNegative(rhs)) {        // was a **-n [hence digits>0]
        // so divide result into 1 [dac=1/dac]
        decDivideOp(dac, &dnOne, dac, &aset, DIVIDE, &status);
        }
      #endif
      } // rhs integer path

    // reduce result to the requested length and copy to result
    decCopyFit(res, dac, set, &residue, &status);
    decFinish(res, set, &residue, &status);  // final cleanup
    #if DECSUBSET
    if (!set->extended) decTrim(res, set, 0, 1, &dropped); // trailing zeros
    #endif
    } while(0);                         // end protected

  if (allocdac!=NULL) free(allocdac);   // drop any storage used
  if (allocinv!=NULL) free(allocinv);   // ..
  #if DECSUBSET
  if (alloclhs!=NULL) free(alloclhs);   // ..
  if (allocrhs!=NULL) free(allocrhs);   // ..
  #endif
  if (status!=0) decStatus(res, status, set);
  #if DECCHECK
  decCheckInexact(res, set);
  #endif
  return res;
  } // decNumberPower

/* ------------------------------------------------------------------ */
/* decNumberQuantize -- force exponent to requested value             */
/*                                                                    */
/*   This computes C = op(A, B), where op adjusts the coefficient     */
/*   of C (by rounding or shifting) such that the exponent (-scale)   */
/*   of C has exponent of B.  The numerical value of C will equal A,  */
/*   except for the effects of any rounding that occurred.            */
/*                                                                    */
/*   res is C, the result.  C may be A or B                           */
/*   lhs is A, the number to adjust                                   */
/*   rhs is B, the number with exponent to match                      */
/*   set is the context                                               */
/*                                                                    */
/* C must have space for set->digits digits.                          */
/*                                                                    */
/* Unless there is an error or the result is infinite, the exponent   */
/* after the operation is guaranteed to be equal to that of B.        */
/* ------------------------------------------------------------------ */
decNumber * decNumberQuantize(decNumber *res, const decNumber *lhs,
                              const decNumber *rhs, decContext *set) {
  uInt status=0;                        // accumulator
  decQuantizeOp(res, lhs, rhs, set, 1, &status);
  if (status!=0) decStatus(res, status, set);
  return res;
  } // decNumberQuantize

/* ------------------------------------------------------------------ */
/* decNumberReduce -- remove trailing zeros                           */
/*                                                                    */
/*   This computes C = 0 + A, and normalizes the result               */
/*                                                                    */
/*   res is C, the result.  C may be A                                */
/*   rhs is A                                                         */
/*   set is the context                                               */
/*                                                                    */
/* C must have space for set->digits digits.                          */
/* ------------------------------------------------------------------ */
// Previously known as Normalize
decNumber * decNumberNormalize(decNumber *res, const decNumber *rhs,
                               decContext *set) {
  return decNumberReduce(res, rhs, set);
  } // decNumberNormalize

decNumber * decNumberReduce(decNumber *res, const decNumber *rhs,
                            decContext *set) {
  #if DECSUBSET
  decNumber *allocrhs=NULL;        // non-NULL if rounded rhs allocated
  #endif
  uInt status=0;                   // as usual
  Int  residue=0;                  // as usual
  Int  dropped;                    // work

  #if DECCHECK
  if (decCheckOperands(res, DECUNUSED, rhs, set)) return res;
  #endif

/* ===== authored controls (NOT the corpus slice) =====
 * A macro invocation whose AST shape is IDENTICAL to the bare-identifier arrival
 * above (bare identifier + argument list + block). The declaration-header guard
 * is what refuses it: no type/storage token sits between the previous statement
 * terminator and the name. Both the file-scope and the in-function form are
 * present because both were the fabrication risk the rule had to survive.
 */
#define C907_LOOP(x) for (x = 0; x < 4; x++)
static void c907_control(void) { int i; C907_LOOP(i) { i++; } }
C907_LOOP(2)
{
}
