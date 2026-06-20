10 CLS: COLOR 7,0
20 LOCATE 1,31: COLOR 0,7: PRINT " BASIC: Operators ": COLOR 7,0
30 LOCATE 2,1: PRINT STRING$(80,45)
40 LOCATE 4,5: PRINT "1.  + - * /       arithmetic"
50 LOCATE 5,5: PRINT "2.  MOD           modulo (remainder)"
60 LOCATE 6,5: PRINT "3.  = <> < > <= >= relational  (-1=true, 0=false)"
70 LOCATE 7,5: PRINT "4.  AND OR NOT    logical / bitwise"
80 LOCATE 8,5: PRINT "5.  +             string concatenation"
90 LOCATE 9,5: PRINT "6.  ^             exponentiation"
100 LOCATE 11,5: PRINT "0.  Back"
110 LOCATE 12,1: PRINT STRING$(80,45)
120 LOCATE 14,5: COLOR 0,7: PRINT " Choose (0-6): ": COLOR 7,0
130 LOCATE 14,21: INPUT "",N
140 IF N=0 THEN CHAIN "BASIC/MENU"
150 ON N GOSUB 200,300,400,500,600,700
160 GOTO 10
200 CLS: PRINT "Arithmetic  + - * /": PRINT
210 PRINT "  7+3 ="; 7+3, "  7-3 ="; 7-3
220 PRINT "  7*3 ="; 7*3, "  7/2 ="; 7/2: GOTO 9000
300 CLS: PRINT "MOD  (remainder)": PRINT
310 PRINT "  17 MOD 5  ="; 17 MOD 5
320 PRINT "  -7 MOD 3  ="; -7 MOD 3: GOTO 9000
400 CLS: PRINT "Relational  (-1 = true,  0 = false)": PRINT
410 PRINT "  3 > 2   ="; 3>2, "  3 = 2  ="; 3=2
420 PRINT "  3 <> 2  ="; 3<>2, "  3 <= 3 ="; 3<=3: GOTO 9000
500 CLS: PRINT "Logical  AND  OR  NOT": PRINT
510 PRINT "  1 AND 0 ="; 1 AND 0, "  1 OR 0 ="; 1 OR 0
520 PRINT "  NOT 0   ="; NOT 0, "  NOT -1 ="; NOT -1: GOTO 9000
600 CLS: PRINT "String concatenation  +": PRINT
610 PRINT "  ""AB"" + ""CD"" = "; "AB"+"CD": GOTO 9000
700 CLS: PRINT "Exponentiation  ^": PRINT
710 PRINT "  2^10   ="; 2^10
720 PRINT "  2^-3   ="; 2^-3
730 PRINT "  (-2)^3 ="; (-2)^3: GOTO 9000
9000 PRINT: PRINT "  Press any key...": A$=INPUT$(1): RETURN
