# StoreyPath Viewer

**The StoreyPath package format, and everything that reads it.** A `.storeypath`
package is one building as plain JSON, GeoJSON and CSV in a ZIP: its floors, rooms,
doors and windows, furniture and equipment with their asset tags, floor and wall
finishes, and the walking network between them. Every object has an ID that never
changes. Packages are made with
[StoreyPath Studio](https://github.com/StoreyPath/storeypath-studio). This
repository holds the format and the code that shows packages and finds the way
through them, for any system that wants to:

| Folder | What it is |
|---|---|
| [spec/](spec) | **The format**: [FORMAT.md](spec/FORMAT.md) (format 0.9), JSON Schemas, the list of finishes, and conformance packages with the ways every reader must find the same |
| [viewer/](viewer) | **The viewers**, to embed in a web app: the 3D world (dollhouse, cutaway, x-ray, a walk through it; a Real or architectural-model look), a map view, and a 2D plan ([viewer/svg](viewer/svg)) that needs no WebGL, and the walking routes ([viewer/src/navigation.js](viewer/src/navigation.js)) |
| [go/](go) | **A Go module** that reads and validates packages and finds the way in a building, standard library only |

Studio and wayfinder each pin a version of this repository, so a package and the
code that reads it always agree on the format.

## Use

```go
import storeypath "github.com/storeypath/storeypath-viewer/go"
```

The viewers are ES modules: `@storeypath/viewer-world` is the 3D world as one
module, with three.js inside it ([viewer/world](viewer/world)), and
`@storeypath/viewer-svg` is the 2D plan ([viewer/svg](viewer/svg)). Nothing is
downloaded at run time: they work offline. See [viewer/README.md](viewer/README.md).

```sh
cd viewer/svg && npm ci && npm test      # the 2D plan
cd viewer/world && npm ci && npm test    # the 3D world (headless Chrome)
cd go && go test ./...                   # the Go reader
node spec/finishes.mjs --check           # the finishes' copies agree with spec/finishes.json
```

## Coming

A standalone viewer app (2D, 3D, walking and navigation in one view, read-only),
installable on phones and tablets and usable as a kiosk, built from these viewers.

## Licence

Apache 2.0 ([LICENSE](LICENSE)). The vendored libraries keep their own licences
([viewer/vendor](viewer/vendor)).
