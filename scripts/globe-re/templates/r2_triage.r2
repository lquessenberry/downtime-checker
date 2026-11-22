# radare2 / rizin triage. Usage:
#   r2 -i scripts/globe-re/templates/r2_triage.r2 ./target/debug/downtime-globe
aaa
e scr.color=0
echo ## binary info
iI
echo ## imports (cap)
ii~:50
echo ## exports
iE
echo ## functions (afl, cap 200)
afl
echo ## strings matching globe / cesium / wgs / tile
iz~globe
iz~cesium
iz~wgs
iz~tile
iz~ellipsoid
echo ## done — follow one function with pdf @ sym.NAME
