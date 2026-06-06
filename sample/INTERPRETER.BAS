10 CLS
20 PRINT "============================================"
30 PRINT "   GW-BASIC interpreter - command test menu"
40 PRINT "============================================"
50 PRINT
60 PRINT "  1.  BASIC      (portable core)"
70 PRINT "  2.  GW-BASIC   (PC / MS-DOS extensions)"
80 PRINT
90 PRINT "  0.  Quit"
100 PRINT
110 PRINT "(blank = done; else SKIP / TODO / PART / DUMMY)"
120 PRINT
130 INPUT "Choose";N
140 IF N=1 THEN CHAIN "BASIC/MENU"
150 IF N=2 THEN CHAIN "GWBASIC/MENU"
160 IF N=0 THEN CLS:PRINT "Bye.":END
170 GOTO 10
