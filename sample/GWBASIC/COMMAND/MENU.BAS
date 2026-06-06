10 CLS
20 PRINT "===== GW-BASIC : Commands ====="
30 PRINT
40 PRINT "  1.  FILES        list this folder"
50 PRINT "  2.  KILL / NAME  delete / rename a file"
60 PRINT "  3.  RESET        close all open files"
70 PRINT "  4.  SYSTEM       exit to host (info only)"
80 PRINT
90 PRINT "  (LLIST, MERGE = SKIP, editor-only)"
100 PRINT "  0.  Back"
110 INPUT "Choose";N
120 IF N=0 THEN CHAIN "GWBASIC/MENU"
130 ON N GOSUB 200,300,400,500
140 GOTO 10
200 CLS:PRINT "FILES - directory of the connected folder:":PRINT:FILES:GOTO 9000
300 CLS:PRINT "KILL / NAME  (on a scratch file)":PRINT
310 OPEN "ZZTEMP.DAT" FOR OUTPUT AS #1:PRINT #1,"hi":CLOSE #1
320 PRINT "  created ZZTEMP.DAT"
330 NAME "ZZTEMP.DAT" AS "ZZTEMP2.DAT":PRINT "  NAME -> ZZTEMP2.DAT"
340 KILL "ZZTEMP2.DAT":PRINT "  KILL ZZTEMP2.DAT  (cleaned up)":GOTO 9000
400 CLS:PRINT "RESET  (close all open files)":PRINT
410 OPEN "ZZR.DAT" FOR OUTPUT AS #1:RESET:KILL "ZZR.DAT"
420 PRINT "  opened a file, RESET closed it - OK":GOTO 9000
500 CLS:PRINT "SYSTEM":PRINT
510 PRINT "  SYSTEM exits the program back to the host."
520 PRINT "  (not run here - it would close this menu)":GOTO 9000
9000 PRINT:PRINT "Press a key...":A$=INPUT$(1):RETURN
