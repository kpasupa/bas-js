10 CLS
20 PRINT "===== BASIC : Operators ====="
30 PRINT
40 PRINT "  1.  + - * /        arithmetic"
50 PRINT "  2.  MOD            modulo"
60 PRINT "  3.  = <> < > <= >= relational"
70 PRINT "  4.  AND OR NOT     logical"
80 PRINT "  5.  +              string concat"
90 PRINT "  6.  ^              power"
100 PRINT
110 PRINT "  0.  Back"
120 PRINT
130 INPUT "Choose";N
140 IF N=0 THEN CHAIN "BASIC/MENU"
150 ON N GOSUB 200,300,400,500,600,700
160 GOTO 10
200 CLS:PRINT "Arithmetic  + - * /":PRINT
210 PRINT "  7+3 =";7+3,"  7-3 =";7-3
220 PRINT "  7*3 =";7*3,"  7/2 =";7/2
230 GOTO 9000
300 CLS:PRINT "MOD  (remainder)":PRINT:PRINT "  17 MOD 5 =";17 MOD 5:GOTO 9000
400 CLS:PRINT "Relational  (-1 = true, 0 = false)":PRINT
410 PRINT "  3>2  =";3>2,"  3=2 =";3=2
420 PRINT "  3<>2 =";3<>2,"  3<=3=";3<=3
430 GOTO 9000
500 CLS:PRINT "Logical  AND OR NOT":PRINT
510 PRINT "  1 AND 0 =";1 AND 0,"  1 OR 0 =";1 OR 0
520 PRINT "  NOT 0   =";NOT 0
530 GOTO 9000
600 CLS:PRINT "String concatenation  +":PRINT:PRINT "  ";"AB"+"CD":GOTO 9000
700 CLS:PRINT "Power  ^":PRINT
710 PRINT "  2^10 =";2^10,"  -2^2 =";-2^2,"  2^-3 =";2^-3
720 GOTO 9000
9000 PRINT:PRINT "Press a key...":A$=INPUT$(1):RETURN
