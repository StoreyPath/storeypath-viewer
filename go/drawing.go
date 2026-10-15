package storeypath

import (
	"bytes"
	"compress/gzip"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"math"
)

// A package may carry each floor's drawing as drawn (format 0.10.1, spec/FORMAT.md
// "Drawings"): its part of its drawing, every layer and text, in the building's own
// metres, so that a system shows the real drawing under the plan. Each is a drawing
// view (spec/DRAWING-VIEW.md): gzip, a head of JSON, and its lines, triangles,
// points and texts in arrays of numbers. The floor's source in the manifest names it
// (Source.View); the manifest's files list the folder.
//
// Read reads them with the rest of the package, within its Limits (a building's
// drawings are a few MB), and checks each whole (unzipped, within MaxFileBytes, and let
// go): Drawing gives a floor's, its bytes as the package holds them (for a viewer to
// draw) and its head; Arrays and LinesOn open the rest when wanted. Validate says
// which could not be read.

// DrawingsDir is where a package keeps its floors' drawings: drawings/<floor-id>.view.
const DrawingsDir = "drawings/"

// DrawingViewFormat is the make-up of drawing views this module reads (the head's
// format).
const DrawingViewFormat = 1

// drawingMagic starts a drawing view, once unzipped.
const drawingMagic = "SPDV"

// DrawingLayer is a layer of a drawing with something on it.
type DrawingLayer struct {
	Name string `json:"name"`
	// Color is its colour in the drawing (#rrggbb), or nil.
	Color *string `json:"color"`
	// Count is how many things are drawn on it.
	Count int `json:"count"`
	// Off: off or frozen in the drawing (drawn, and hidden until a person shows it).
	Off bool `json:"off"`
}

// DrawingBatch is the lines, fills or points of one layer in one colour: points
// [First, First+Count) of its kind's array (two a line, three a triangle).
type DrawingBatch struct {
	Kind  string `json:"kind"`
	Layer int    `json:"layer"`
	Color int    `json:"color"`
	First int    `json:"first"`
	Count int    `json:"count"`
}

// DrawingHeader is a drawing view's head: what it holds and where it lies. Boxes are
// [x0, y0, x1, y1] in the view's coordinates: a package's, metres of the building's
// own frame (where LocalFrame turns its spaces).
type DrawingHeader struct {
	Format int `json:"format"`
	// Origin is what the arrays' points are from.
	Origin [2]float64 `json:"origin"`
	// Grid is the grid the points are kept to, in the view's units.
	Grid float64 `json:"grid"`
	// Bounds is where anything is drawn, Body where most of it is (to fit a window to).
	Bounds [4]float64 `json:"bounds"`
	Body   [4]float64 `json:"body"`
	// Clip is the box a floor's part was cut to (nil: a whole drawing).
	Clip *[4]float64 `json:"clip"`
	// Background is the ground the drawing's own colours are for (#rrggbb).
	Background string `json:"background"`
	// Units: mm, cm, m, in or ft; a package's are m. Nil when not known.
	Units       *string        `json:"units"`
	Layers      []DrawingLayer `json:"layers"`
	EmptyLayers int            `json:"empty_layers"`
	// Colors: #rrggbb, or #rrggbbaa for a tint.
	Colors  []string       `json:"colors"`
	Batches []DrawingBatch `json:"batches"`
	// Words is each text's words, in the order of the texts' arrays.
	Words  []string `json:"words"`
	Counts struct {
		Lines     int `json:"lines"`
		Triangles int `json:"triangles"`
		Points    int `json:"points"`
		Texts     int `json:"texts"`
		Entities  int `json:"entities"`
	} `json:"counts"`
	// Arrays is where each array is after the head: [offset, length] in bytes.
	Arrays map[string][2]int64 `json:"arrays"`
}

// DrawingView is a floor's drawing as a package carries it.
type DrawingView struct {
	Floor string
	// File is its name in the package (drawings/<floor-id>.view).
	File string
	// Raw is the file as the package holds it (gzip): what a viewer is given to draw.
	Raw    []byte
	Header DrawingHeader

	limits Limits
}

// DrawingArrays is a drawing view's arrays, its points from the head's Origin.
type DrawingArrays struct {
	Lines  []float32 // x, y: two points a line
	Fills  []float32 // x, y: three points a triangle
	Points []float32 // x, y
	// Texts: eight a text: x, y where its first line's baseline starts; a, b, c, d its
	// turn and stretch; its cap height; its width as the drawing sets it (0: not known).
	Texts []float32
	// Styles: two a text: its layer and its colour (indices into the head's lists).
	Styles []uint16
}

// drawingArrays: each array's name, the size of its numbers and how many a point (or a
// text) takes.
var drawingArrays = []struct {
	name        string
	size, width int64
}{{"lines", 4, 2}, {"fills", 4, 2}, {"points", 4, 2}, {"texts", 4, 8}, {"styles", 2, 2}}

// batchPoints: how many points each batch's kind takes a piece.
var batchPoints = map[string]int{"lines": 2, "fills": 3, "points": 1}

// drawingFile is a floor's drawing as Read found it: its bytes and head, or why not.
type drawingFile struct {
	file   string
	raw    []byte
	header DrawingHeader
	err    error // the file missing, or its head unreadable: Validate says so
}

// ReadDrawingHeader reads a drawing view's head from its file (gzip), unzipping no
// more of it than the head, within DefaultLimits: what a view holds and where it lies,
// without its arrays.
func ReadDrawingHeader(r io.Reader) (DrawingHeader, error) {
	return readDrawingHead(r, DefaultLimits.orDefault())
}

func readDrawingHead(r io.Reader, limits Limits) (DrawingHeader, error) {
	var h DrawingHeader
	z, err := gzip.NewReader(r)
	if err != nil {
		return h, fmt.Errorf("not gzip: %w", err)
	}
	defer z.Close()
	var start [8]byte
	if _, err := io.ReadFull(z, start[:]); err != nil || string(start[:4]) != drawingMagic {
		return h, errors.New("not a drawing view (no SPDV at its start)")
	}
	n := int64(binary.LittleEndian.Uint32(start[4:]))
	if n > limits.MaxFileBytes {
		return h, fmt.Errorf("%w: its head is larger than %d bytes", ErrTooLarge, limits.MaxFileBytes)
	}
	head := make([]byte, n)
	if _, err := io.ReadFull(z, head); err != nil {
		return h, errors.New("its head is cut short")
	}
	return parseDrawingHead(head, limits)
}

// parseDrawingHead is a view's head from its JSON, of a format this module reads.
func parseDrawingHead(head []byte, limits Limits) (DrawingHeader, error) {
	var h DrawingHeader
	if err := decodeJSON(head, &h, limits.MaxFeatures); err != nil {
		return h, fmt.Errorf("its head: %w", err)
	}
	if h.Format != DrawingViewFormat {
		return h, fmt.Errorf("format %d: this reader reads %d (update it)", h.Format, DrawingViewFormat)
	}
	return h, nil
}

// unzipDrawing is a drawing view unzipped, of at most max bytes.
func unzipDrawing(raw []byte, max int64) ([]byte, error) {
	z, err := gzip.NewReader(bytes.NewReader(raw))
	if err != nil {
		return nil, fmt.Errorf("not gzip: %w", err)
	}
	defer z.Close()
	data, err := io.ReadAll(io.LimitReader(z, max+1))
	if err != nil {
		return nil, fmt.Errorf("not gzip: %w", err)
	}
	if int64(len(data)) > max {
		return nil, fmt.Errorf("%w: larger than %d bytes unzipped", ErrTooLarge, max)
	}
	return data, nil
}

// openDrawing is a drawing view read whole and checked as spec/DRAWING-VIEW.md has it:
// its head, and its arrays' bytes (after the head), each where the head says and whole,
// each batch within its array, a text for each word and style, layers and colours
// that are there.
func openDrawing(raw []byte, limits Limits) (DrawingHeader, []byte, error) {
	var h DrawingHeader
	data, err := unzipDrawing(raw, limits.MaxFileBytes)
	if err != nil {
		return h, nil, err
	}
	if len(data) < 8 || string(data[:4]) != drawingMagic {
		return h, nil, errors.New("not a drawing view (no SPDV at its start)")
	}
	n := int64(binary.LittleEndian.Uint32(data[4:8]))
	if 8+n > int64(len(data)) {
		return h, nil, errors.New("its head is cut short")
	}
	if h, err = parseDrawingHead(data[8:8+n], limits); err != nil {
		return h, nil, err
	}
	rest := data[8+n:]
	points := map[string]int64{}
	for _, a := range drawingArrays {
		at, ok := h.Arrays[a.name]
		if !ok {
			return h, nil, fmt.Errorf("its head does not say where its %s are", a.name)
		}
		if at[0] < 0 || at[1] < 0 || at[0]+at[1] > int64(len(rest)) {
			return h, nil, fmt.Errorf("its %s are not where its head says", a.name)
		}
		if at[1]%(a.size*a.width) != 0 {
			return h, nil, fmt.Errorf("its %s are not whole", a.name)
		}
		points[a.name] = at[1] / (a.size * 2) // (x, y pairs; texts: eight numbers, styles: two)
	}
	texts, styles := points["texts"]/4, points["styles"]
	if texts != styles || texts != int64(len(h.Words)) {
		return h, nil, fmt.Errorf("%d texts, %d styles and %d words: not one each", texts, styles, len(h.Words))
	}
	for _, b := range h.Batches {
		per, ok := batchPoints[b.Kind]
		if !ok {
			return h, nil, fmt.Errorf("a batch of %q, not lines, fills or points", clip(b.Kind))
		}
		if b.First < 0 || b.Count < 0 || int64(b.First)+int64(b.Count) > points[b.Kind] || b.Count%per != 0 {
			return h, nil, fmt.Errorf("a batch of %s is not within them", b.Kind)
		}
		if b.Layer < 0 || b.Layer >= len(h.Layers) || b.Color < 0 || b.Color >= len(h.Colors) {
			return h, nil, errors.New("a batch is of a layer or colour it does not have")
		}
	}
	return h, rest, nil
}

// HasDrawing says whether the package carries a floor's drawing (format 0.10.1: its
// export was asked to carry them).
func (p *Package) HasDrawing(floorID string) bool {
	d, ok := p.drawings[floorID]
	return ok && d.err == nil
}

// Drawing is a floor's drawing as the package carries it: its bytes (gzip, for a
// viewer to draw: StoreyPath Viewer's DrawingView) and its head; nil when the package
// carries none of the floor. An error when its source names one the package does not
// hold, or one that is not a drawing view this module reads (Validate says so too).
func (p *Package) Drawing(floorID string) (*DrawingView, error) {
	d, ok := p.drawings[floorID]
	if !ok {
		return nil, nil
	}
	if d.err != nil {
		return nil, fmt.Errorf("%s: %w", clip(d.file), d.err)
	}
	return &DrawingView{Floor: floorID, File: d.file, Raw: d.raw, Header: d.header, limits: p.limits}, nil
}

// readDrawings reads the drawings the manifest's sources name (Read).
func (p *Package) readDrawings(a *archive) error {
	p.drawings = map[string]*drawingFile{}
	for _, s := range p.Manifest.Sources {
		if s.View == nil {
			continue
		}
		if _, seen := p.drawings[s.Floor]; seen {
			continue
		}
		d := &drawingFile{file: *s.View}
		p.drawings[s.Floor] = d
		raw, ok, err := a.read(d.file)
		if err != nil {
			if errors.Is(err, ErrTooLarge) {
				return fmt.Errorf("%s: %w", clip(d.file), err)
			}
			d.err = err
			continue
		}
		if !ok {
			d.err = errors.New("not in the package")
			continue
		}
		d.raw = raw
		if d.header, _, err = openDrawing(raw, a.limits); err != nil {
			if errors.Is(err, ErrTooLarge) {
				return fmt.Errorf("%s: %w", clip(d.file), err)
			}
			d.err = err
		}
	}
	return nil
}

// Arrays is the view's arrays, read from its bytes (each stored a byte at a time:
// put back together), within the package's limits.
func (v *DrawingView) Arrays() (*DrawingArrays, error) {
	limits := v.limits.orDefault()
	h, rest, err := openDrawing(v.Raw, limits)
	if err != nil {
		return nil, err
	}
	part := func(name string) []byte {
		at := h.Arrays[name]
		return rest[at[0] : at[0]+at[1]]
	}
	floats := func(name string) []float32 {
		b := part(name)
		n := len(b) / 4
		out := make([]float32, n)
		for i := range out {
			out[i] = math.Float32frombits(uint32(b[i]) | uint32(b[n+i])<<8 | uint32(b[2*n+i])<<16 | uint32(b[3*n+i])<<24)
		}
		return out
	}
	b := part("styles")
	n := len(b) / 2
	styles := make([]uint16, n)
	for i := range styles {
		styles[i] = uint16(b[i]) | uint16(b[n+i])<<8
	}
	return &DrawingArrays{Lines: floats("lines"), Fills: floats("fills"), Points: floats("points"), Texts: floats("texts"),
		Styles: styles}, nil
}

// LinesOn is the lines drawn on a layer (by its name), each [x0, y0, x1, y1] in the
// view's coordinates (a package's: metres of the building's own frame).
func (v *DrawingView) LinesOn(layer string) ([][4]float64, error) {
	a, err := v.Arrays()
	if err != nil {
		return nil, err
	}
	which := -1
	for i, l := range v.Header.Layers {
		if l.Name == layer {
			which = i
		}
	}
	ox, oy := v.Header.Origin[0], v.Header.Origin[1]
	var out [][4]float64
	for _, b := range v.Header.Batches {
		if b.Kind != "lines" || b.Layer != which {
			continue
		}
		for k := b.First; k+1 < b.First+b.Count; k += 2 {
			l := a.Lines[2*k : 2*k+4]
			out = append(out, [4]float64{float64(l[0]) + ox, float64(l[1]) + oy, float64(l[2]) + ox, float64(l[3]) + oy})
		}
	}
	return out, nil
}
