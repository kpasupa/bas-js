10 CLS: COLOR 7,0
20 LOCATE 1,29: COLOR 0,7: PRINT " GW-BASIC: Commands ": COLOR 7,0
30 LOCATE 2,1: PRINT STRING$(80,45)
40 LOCATE 4,5: PRINT "1.  FILES        list files in the connected folder"
50 LOCATE 5,5: PRINT "2.  KILL / NAME  delete and rename a file"
60 LOCATE 6,5: PRINT "3.  RESET        close all open files"
70 LOCATE 7,5: PRINT "4.  SYSTEM       exit to host (info only)"
80 LOCATE 9,5: COLOR 8,0: PRINT "--- Skipped (editor/host-only) ---"
90 LOCATE 10,7: PRINT "LLIST  MERGE": COLOR 7,0
100 LOCATE 12,5: PRINT "0.  Back"
110 LOCATE 13,1: PRINT STRING$(80,45)
120 LOCATE 15,5: COLOR 0,7: PRINT " Choose (0-4): ": COLOR 7,0
130 LOCATE 15,21: INPUT "",N
140 IF N=0 THEN CHAIN "GWBASIC/MENU"
150 ON N GOSUB 200,300,400,500
160 GOTO 10
200 CLS: PRINT "FILES  (directory of the connected folder)": PRINT: FILES: GOTO 9000
300 CLS: PRINT "KILL / NAME  (on a scratch file)": PRINT
310 OPEN "ZZTEMP.DAT" FOR OUTPUT AS #1: PRINT #1,"hi": CLOSE #1
320 PRINT "  created ZZTEMP.DAT"
330 NAME "ZZTEMP.DAT" AS "ZZTEMP2.DAT": PRINT "  NAME -> ZZTEMP2.DAT"
340 KILL "ZZTEMP2.DAT": PRINT "  KILL ZZTEMP2.DAT  (cleaned up)": GOTO 9000
400 CLS: PRINT "RESET  (close all open files)": PRINT
410 OPEN "ZZR.DAT" FOR OUTPUT AS #1: RESET: KILL "ZZR.DAT"
420 PRINT "  Opened a file, RESET closed it — OK": GOTO 9000
500 CLS: PRINT "SYSTEM": PRINT
510 PRINT "  SYSTEM exits the running program back to the host."
520 PRINT "  (not called here — it would close this menu)": GOTO 9000
9000 PRINT: PRINT "  Press any key...": A$=INPUT$(1): RETURN
