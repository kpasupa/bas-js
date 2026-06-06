10 CLS
20 PRINT "===== BASIC : Commands ====="
30 PRINT
40 PRINT "  1.  RUN"
50 PRINT "  2.  TRON / TROFF"
60 PRINT
70 PRINT "  --- SKIP (editor-only, not in a file runner) ---"
80 PRINT "  NEW  LIST  LOAD  SAVE  AUTO  RENUM"
90 PRINT "  DELETE  EDIT  CONT"
100 PRINT
110 PRINT "  0.  Back"
120 PRINT
130 INPUT "Choose";N
140 IF N=0 THEN CHAIN "BASIC/MENU"
150 ON N GOSUB 200,300
160 GOTO 10
200 CLS:PRINT "RUN":PRINT
210 PRINT "  Executes the program. This menu is itself"
220 PRINT "  running, so RUN already worked.":GOTO 9000
300 CLS:PRINT "TRON / TROFF  (execution trace)":PRINT
310 TRON
320 FOR I=1 TO 3:PRINT "  loop";I:NEXT
330 TROFF
340 PRINT:PRINT "  [nn] markers above = the traced line numbers":GOTO 9000
9000 PRINT:PRINT "Press a key...":A$=INPUT$(1):RETURN
