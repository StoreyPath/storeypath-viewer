# Drawing views — format 1

A drawing view (`*.view`) is a drawing (DWG, DXF) as its own program shows it: every
line, curve, hatch, solid fill, point and text of its model space, on every layer, worked
out once by the program that made the view (StoreyPath Studio, with ezdxf's drawing
frontend, as it prints) and packed small for a browser to draw with WebGL. It holds what
the drawing draws, not the drawing: no entities, blocks or dimensions as such, only the
lines, triangles, points and texts they come to.

StoreyPath Studio makes one of a whole drawing for its drawing viewer. A package may carry
each floor's part of its drawing, cut to the floor's region of it and in the building's
own frame, so that a reader shows the real drawing under the plan (FORMAT.md, "Drawings",
format 0.11). The viewer reads both (`viewer/src/drawing/`: `readDrawingView`, and
`DrawingView` draws one); the Go module reads a package's (`Package.Drawing`).

## The file

The file is gzip (RFC 1952). Unzipped, it is:

| Bytes | |
|---|---|
| 4 | `SPDV` (ASCII) |
| 4 | the head's length *n* in bytes: an unsigned 32-bit integer, little-endian |
| *n* | the head: JSON (UTF-8), padded with spaces to a multiple of 4 bytes |
| the rest | the arrays, each where the head's `arrays` says |

A reader reads the head without the arrays to learn what a view holds and where it lies:
it unzips no more than its first 8 + *n* bytes.

## The arrays

| Array | Numbers | Each |
|---|---|---|
| `lines` | float32 | x, y: two points a line (a curve is its straight pieces) |
| `fills` | float32 | x, y: three points a triangle (a hatch or solid cut into triangles, its holes left empty) |
| `points` | float32 | x, y |
| `texts` | float32 | eight a text: x, y where its first line's baseline starts; *a*, *b*, *c*, *d*, its turn and stretch (a point *u* along its line and *v* up from it, of letters one unit tall, is at x + *a*·*u* + *c*·*v*, y + *b*·*u* + *d*·*v*); its cap height; its width as the drawing sets it (0: not known) |
| `styles` | uint16 | two a text: its layer and its colour (indices into the head's `layers` and `colors`) |

The head's `arrays` gives each as `[offset, length]` in bytes, the offset counted from the
end of the head. An array is padded with zero bytes to a multiple of 4; its length does not
count them. Its numbers are little-endian and stored a byte at a time, so that numbers alike
compress well: for an array of *N* numbers of *s* bytes, first the first byte of every
number, then the second byte of every number, and so on. Byte *j* of number *i* is at
*j*·*N* + *i*.

A point of an array is from the head's `origin`: (x, y) is at (`origin`[0] + x,
`origin`[1] + y) in the view's coordinates. A float32 holds a building's millimetres
there to well under one. Points are kept to the head's `grid` (a power of two of the
view's units), so the same line drawn a hair apart is one.

`texts`, `styles` and the head's `words` have one entry each for every text, in the same
order. A text is one line: a text of several lines in the drawing is a text a line.

## The head

| Key | |
|---|---|
| `format` | `1`: this make-up |
| `origin` | `[x, y]`: what the arrays' points are from (the middle of the main body) |
| `grid` | the grid the points are kept to, in the view's units |
| `bounds` | `[x0, y0, x1, y1]`: where anything at all is drawn, every stray included |
| `body` | `[x0, y0, x1, y1]`: where most of it is, for a viewer to fit to its window (a line left far off does not shrink the drawing to a speck); a floor's part: all of it |
| `clip` | `[x0, y0, x1, y1]`: the box a floor's part was cut to (what crossed its edge is cut there; a text is kept by where it starts), or null for a whole drawing |
| `background` | `#rrggbb`: the ground the drawing's own colours are for (CAD programs draw model space on dark; a colour that is white on it is ink on paper) |
| `units` | the view's units: `mm`, `cm`, `m`, `in` or `ft`, or null when not known; a package's: `m` |
| `layers` | each layer with something on it: `name`, `color` (its colour in the drawing, `#rrggbb`, or null), `count` (the things drawn on it), `off` (off or frozen in the drawing: drawn, and hidden until a person shows it) |
| `empty_layers` | how many layers of the drawing have nothing on them |
| `colors` | the colours used: `#rrggbb`, or `#rrggbbaa` for a tint (a hatch of more dots than anyone sees is a tint of its colour, a quarter opaque) |
| `batches` | the lines, fills and points of one layer in one colour, in the order they are drawn: `kind` (`lines`, `fills` or `points`), `layer` and `color` (indices), `first` and `count` (points of that kind's array: two a line, three a triangle) |
| `words` | each text's words |
| `counts` | `lines`, `triangles`, `points`, `texts`, and the `entities` drawn |
| `arrays` | where each array is: `[offset, length]` |

## Drawing one

Fills first, then lines, then points, each kind's batches in their order, then the texts
over them, as a print has them. A line is a pixel wide at any zoom; a point a little square
of about two. Texts are written in the reader's own letters, made as wide as the drawing
sets them (`width`), and a reader may leave out those too small to read.

Two looks are usual: the drawing's own colours on its `background`, as a CAD program shows
it, and black on white, as it prints (a tint is grey then). A layer that is `off` is hidden
until a person shows it.

## Coordinates

y is up. A whole drawing's view is in the drawing's own units and coordinates. A floor's
part in a package is in metres of the building's own frame (FORMAT.md, Coordinates), where
its spaces, walls and items' `local` are: drawn under the floor's plan, it lies on it.

## Versions

`format` is the make-up's version. A reader reads the formats it knows and refuses
another, saying it must be updated. Within a format, a reader ignores keys of the head it
does not know (and of its layers and batches), entries of `arrays` it does not know, and
bytes between the arrays.

A view does not say how it was made: a program that keeps views (Studio's cache) makes
them again when it draws them otherwise, under the same format.
