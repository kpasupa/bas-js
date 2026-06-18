10 REM MATH.BAS — number facts; value comes from CHAIN or the keyboard
20 COMMON QN, QF
30 CLS
40 LOCATE 2,33: PRINT "MATH"
50 IF QF=1 THEN N = QN: GOTO 80
60 LOCATE 4,5:  INPUT "Enter a number: ", N
80 LOCATE 6,5:  PRINT "Number      :"; N
90 LOCATE 7,5:  PRINT "Squared     :"; N*N
100 LOCATE 8,5: PRINT "Doubled     :"; N+N
110 IF N < 0 THEN LOCATE 9,5: PRINT "Square root : undefined (negative)": GOTO 130
120 LOCATE 9,5: PRINT "Square root :"; SQR(N)
130 IF QF=1 THEN LOCATE 11,5: PRINT "You arrived here via CHAIN — ENTER returns to MENU."
140 LOCATE 13,5: INPUT "Press ENTER to continue...", X$
150 IF QF=1 THEN QF = 0: CHAIN "MENU"
160 END
