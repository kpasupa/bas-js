10 REM CIRCLE demo — concentric circles, an arc, and an ellipse (aspect)
20 SCREEN 1:CLS
30 FOR R=10 TO 95 STEP 12
40 CIRCLE (160,100),R,(R/12) MOD 4
50 NEXT
60 REM half-circle arc (start angle .. end angle, radians)
70 CIRCLE (160,100),99,2,0,3.14159
80 REM squashed ellipse via aspect ratio
90 CIRCLE (60,100),50,3,,,0.4
100 A$=INPUT$(1)
110 CHAIN "LIST"
