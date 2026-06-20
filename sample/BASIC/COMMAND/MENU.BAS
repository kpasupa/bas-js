10 CLS: COLOR 7,0
20 LOCATE 1,31: COLOR 0,7: PRINT " BASIC: Commands ": COLOR 7,0
30 LOCATE 2,1: PRINT STRING$(80,45)
40 LOCATE 4,5: PRINT "1.  RUN          execute the program"
50 LOCATE 5,5: PRINT "2.  TRON/TROFF   trace execution with line numbers"
60 LOCATE 7,5: COLOR 8,0: PRINT "--- Editor-only (not used inside a running program) ---"
70 LOCATE 8,7: PRINT "LIST  NEW  LOAD  SAVE  AUTO  RENUM  DELETE  EDIT  CONT"
80 COLOR 7,0
90 LOCATE 10,5: PRINT "0.  Back"
100 LOCATE 11,1: PRINT STRING$(80,45)
110 LOCATE 13,5: COLOR 0,7: PRINT " Choose (0-2): ": COLOR 7,0
120 LOCATE 13,21: INPUT "",N
130 IF N=0 THEN CHAIN "BASIC/MENU"
140 ON N GOSUB 200,300
150 GOTO 10
200 CLS: PRINT "RUN": PRINT
210 PRINT "  Executes the program from the start (or a given line number)."
220 PRINT "  This menu is itself running — RUN already worked.": GOTO 9000
300 CLS: PRINT "TRON / TROFF  (execution trace)": PRINT
310 TRON
320 FOR I=1 TO 3: PRINT "  loop "; I: NEXT
330 TROFF
340 PRINT: PRINT "  The [nn] markers above are the traced line numbers.": GOTO 9000
9000 PRINT: PRINT "  Press any key...": A$=INPUT$(1): RETURN
