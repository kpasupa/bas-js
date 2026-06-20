10 COMMON SC,TC,BACK
20 REM Arrived via CHAIN from PICK — SCREEN 0, colour TC on background SC already set
30 LOCATE 3,10: PRINT "You arrived here by CHAIN."
40 LOCATE 5,10: PRINT "Text colour:"; TC; "  Background:"; SC
50 LOCATE 7,10: PRINT "This text is displaying in your chosen colours."
60 LOCATE 9,10: PRINT "The colour survived the CHAIN boundary."
70 LOCATE 11,10: PRINT "Press a key to go back..."
80 A$=INPUT$(1)
90 BACK=1: CHAIN "GWBASIC/COLOR/PICK"
