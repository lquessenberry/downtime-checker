# @category GlobeRe
# Ghidra headless post-script. Run:
#   analyzeHeadless /tmp/ghidra-proj GlobeRe -import PATH_TO_BIN \
#     -postScript ghidra_headless.py \
#     -scriptPath scripts/globe-re/templates
#
# Lists functions and strings one batch at a time. The MCP agent should still
# decompile a single function per tool call after this triage dump.

from ghidra.program.model.listing import FunctionManager  # type: ignore  # noqa: F401

LIMIT = 200
out = []
fm = currentProgram.getFunctionManager()  # type: ignore  # noqa: F821
count = 0
for fn in fm.getFunctions(True):
    out.append("%s @ %s" % (fn.getName(), fn.getEntryPoint()))
    count += 1
    if count >= LIMIT:
        break

listing = currentProgram.getListing()  # type: ignore  # noqa: F821
print("## functions (%d, cap %d)" % (count, LIMIT))
for line in out:
    print(line)

print("## defined strings (cap 80)")
n = 0
for ds in listing.getDefinedData(True):
    dt = ds.getDataType()
    if dt is not None and "string" in dt.getName().lower():
        print("%s %s" % (ds.getAddress(), ds.getDefaultValueRepresentation()[:120]))
        n += 1
        if n >= 80:
            break
