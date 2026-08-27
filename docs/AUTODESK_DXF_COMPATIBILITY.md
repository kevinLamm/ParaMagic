# Autodesk DXF Compatibility Gate

ParaMagic exports ASCII DXF using the AutoCAD R2000/AC1015 contract. Autodesk products parse that contract more strictly than many other CAD readers, so a file opening elsewhere is not sufficient compatibility evidence.

## Required checks

Run the portable DXF contract tests on every change:

```text
npm run test:dxf
```

The GitHub Pages workflow runs this command before building or deploying. It checks the complete symbol-table set, the `ACAD` APPID, handle ownership, named-object dictionaries, plot-style metadata, reciprocal model/paper layout links, common entity metadata, geometry conversion, text, dimensions, notches, construction-geometry exclusion, and derived geometry.

Before a release that changes DXF serialization, also run the Autodesk parser gate on a Windows machine with AutoCAD installed:

```text
npm run test:dxf:autodesk
```

The command generates one combined fixture containing every supported geometry path, `TEXT`, `MTEXT`, construction input that must be excluded, the seam layer, all notch shapes, and every exported dimension form. It opens that file in Autodesk AutoCAD Core Console, runs `AUDIT`, and fails unless Autodesk reports `Total errors found 0 fixed 0`.

If AutoCAD is installed in a nonstandard location, set `AUTOCAD_CORE_CONSOLE` to the full path of `accoreconsole.exe` before running the command.

## Maintenance rule

Any new DXF entity, table, object type, layer behavior, text mode, or dimension form must be added to the combined Autodesk fixture and the portable contract tests in the same change. Do not weaken or update these checks solely because another CAD reader accepts a changed file; Autodesk's parser result is the compatibility authority.

To generate the fixture without running AutoCAD:

```text
npm run fixture:dxf:autodesk -- path/to/output.dxf
```
