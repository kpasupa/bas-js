10 COMMON SC,TC,BACK
20 REM arrived by CHAIN - screen is still in graphics mode with the picked colours
30 CLS
40 LOCATE 4,4:PRINT "You came here by CHAIN."
50 LOCATE 6,4:PRINT "Your screen colour is";SC
60 LOCATE 7,4:PRINT "Your text   colour is";TC
70 LOCATE 9,4:PRINT "Both carried over from the picker."
80 LOCATE 10,4:PRINT "This very text is your picked colour"
90 LOCATE 11,4:PRINT "on your picked background."
100 LOCATE 14,4:PRINT "Press a key to go back..."
110 A$=INPUT$(1)
120 BACK=1:CHAIN "GWBASIC/COLOR/PICK"
