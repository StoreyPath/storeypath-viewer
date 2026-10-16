package storeypath

import (
	"archive/zip"
	"bytes"
	"compress/gzip"
	"encoding/binary"
	"encoding/json"
	"io"
	"math"
	"slices"
	"strings"
	"testing"
)

// drawnOffice is the corpus package that carries its drawings (format 0.11): two
// floors of one made-up sheet, the first floor's region of it moved onto the ground
// floor's (spec/conformance/make.py, drawings).
const drawnOffice = "drawn-office.storeypath"

func TestAPackageCarriesItsFloorsDrawingsInTheBuildingsFrame(t *testing.T) {
	p := open(t, drawnOffice)
	if problems := p.Validate(); len(problems) != 0 {
		t.Fatalf("problems: %v", problems)
	}
	if minor(p.Manifest.FormatVersion) < 11 || p.Manifest.Files["drawings"] != DrawingsDir || len(p.Floors) != 2 {
		t.Fatalf("format %s, files %v, %d floors", p.Manifest.FormatVersion, p.Manifest.Files, len(p.Floors))
	}
	frame, err := p.Frame(p.Buildings[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range p.Floors {
		if !p.HasDrawing(f.ID) {
			t.Fatalf("%s: no drawing", f.ID)
		}
		d, err := p.Drawing(f.ID)
		if err != nil || d == nil {
			t.Fatalf("%s: %v", f.ID, err)
		}
		h := d.Header
		if d.File != DrawingsDir+f.ID+".view" || len(d.Raw) < 2 || d.Raw[0] != 0x1f || d.Raw[1] != 0x8b {
			t.Fatalf("%s: %s, %d bytes: not gzip as the package holds it", f.ID, d.File, len(d.Raw))
		}
		if h.Format != DrawingViewFormat || h.Units == nil || *h.Units != "m" || h.Clip == nil || h.Counts.Texts != len(h.Words) {
			t.Fatalf("%s: format %d, units %v, clip %v, %d texts of %d words", f.ID, h.Format, h.Units, h.Clip, h.Counts.Texts, len(h.Words))
		}
		alone, err := ReadDrawingHeader(bytes.NewReader(d.Raw))
		if err != nil || alone.Bounds != h.Bounds || len(alone.Layers) != len(h.Layers) {
			t.Fatalf("%s: its head alone: %v %v", f.ID, alone.Bounds, err)
		}
		if !slices.ContainsFunc(h.Layers, func(l DrawingLayer) bool { return l.Name == "A-WALL" && l.Count > 0 }) {
			t.Fatalf("%s: layers %v", f.ID, h.Layers)
		}

		// its walls as drawn lie on the floor's walls, in the building's own metres
		lines, err := d.LinesOn("A-WALL")
		if err != nil || len(lines) == 0 {
			t.Fatalf("%s: walls %d, %v", f.ID, len(lines), err)
		}
		drawn := [4]float64{math.Inf(1), math.Inf(1), math.Inf(-1), math.Inf(-1)}
		for _, l := range lines {
			drawn = grown(drawn, l[0], l[1])
			drawn = grown(drawn, l[2], l[3])
		}
		polys, err := frame.PolygonsToLocal(f.Walls)
		if err != nil {
			t.Fatal(err)
		}
		read := [4]float64{math.Inf(1), math.Inf(1), math.Inf(-1), math.Inf(-1)}
		for _, poly := range polys {
			for _, ring := range poly {
				for _, q := range ring {
					read = grown(read, q[0], q[1])
				}
			}
		}
		for i := range drawn {
			if math.Abs(drawn[i]-read[i]) > 0.01 {
				t.Errorf("%s: its drawn walls %v, its walls read %v", f.ID, drawn, read)
				break
			}
		}
		// nothing beyond its region: what crosses its edge is cut there
		c := *h.Clip
		for _, l := range lines {
			if l[0] < c[0]-1e-3 || l[2] > c[2]+1e-3 || math.Min(l[1], l[3]) < c[1]-1e-3 || math.Max(l[1], l[3]) > c[3]+1e-3 {
				t.Fatalf("%s: a wall %v outside its clip %v", f.ID, l, c)
			}
		}

		// its texts: those of its own plan, none of the other's nor of the notes beside
		// them, and as the privacy rules leave them
		other := map[int]string{0: "FIRST FLOOR PLAN", 1: "GROUND FLOOR PLAN"}[f.Ordinal]
		own := map[int]string{0: "GROUND FLOOR PLAN", 1: "FIRST FLOOR PLAN"}[f.Ordinal]
		if !slices.Contains(h.Words, own) || slices.Contains(h.Words, other) {
			t.Errorf("%s: words %v", f.ID, h.Words)
		}
		for _, w := range h.Words {
			if strings.Contains(w, "TEL") || strings.Contains(w, "JOHN") || strings.Contains(w, "NOTES") {
				t.Errorf("%s: %q is in its drawing", f.ID, w)
			}
		}
		if f.Ordinal == 1 && !slices.Contains(h.Words, "SITE OFFICE") {
			t.Errorf("%s: the office beside its plan, its name taken out, is not there: %v", f.ID, h.Words)
		}
		a, err := d.Arrays()
		if err != nil || len(a.Texts) != 8*len(h.Words) || len(a.Styles) != 2*len(h.Words) || len(a.Lines) != 4*h.Counts.Lines {
			t.Fatalf("%s: arrays %v", f.ID, err)
		}
	}
}

func grown(box [4]float64, x, y float64) [4]float64 {
	return [4]float64{math.Min(box[0], x), math.Min(box[1], y), math.Max(box[2], x), math.Max(box[3], y)}
}

func TestAPackageWithoutDrawingsHasNone(t *testing.T) {
	p := open(t, "campus-hq.storeypath")
	for _, f := range p.Floors {
		if d, err := p.Drawing(f.ID); p.HasDrawing(f.ID) || d != nil || err != nil {
			t.Fatalf("%s: %v %v", f.ID, d, err)
		}
	}
}

// viewHead is a drawing view with its head changed (gzip again, its arrays as they were).
func viewHead(t *testing.T, raw []byte, change func(head map[string]any)) []byte {
	t.Helper()
	z, err := gzip.NewReader(bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	data, _ := io.ReadAll(z)
	n := binary.LittleEndian.Uint32(data[4:8])
	var head map[string]any
	if err := json.Unmarshal(data[8:8+n], &head); err != nil {
		t.Fatal(err)
	}
	change(head)
	text, _ := json.Marshal(head)
	for len(text)%4 != 0 {
		text = append(text, ' ')
	}
	var out bytes.Buffer
	w := gzip.NewWriter(&out)
	w.Write([]byte(drawingMagic))
	binary.Write(w, binary.LittleEndian, uint32(len(text)))
	w.Write(text)
	w.Write(data[8+n:])
	w.Close()
	return out.Bytes()
}

func TestBrokenDrawingsAreFound(t *testing.T) {
	p := open(t, drawnOffice)
	ground := p.Floors[0].ID
	view := DrawingsDir + ground + ".view"
	onView := func(change func(data []byte) []byte) func(string, []byte) []byte {
		return func(name string, data []byte) []byte {
			if name == view {
				return change(data)
			}
			return data
		}
	}
	headOf := func(change func(head map[string]any)) func(string, []byte) []byte {
		return onView(func(data []byte) []byte { return viewHead(t, data, change) })
	}
	sourceView := func(path any) func(string, []byte) []byte {
		return editJSON(FileManifest, func(doc map[string]any) {
			for _, s := range doc["sources"].([]any) {
				if s.(map[string]any)["floor_id"] == ground {
					s.(map[string]any)["view"] = path
				}
			}
		})
	}
	cases := []struct {
		name string
		edit func(string, []byte) []byte
	}{
		{"its file left out", onView(func([]byte) []byte { return nil })},
		{"its file cut short", onView(func(d []byte) []byte { return d[:len(d)/2] })},
		{"not gzip", onView(func([]byte) []byte { return []byte("a drawing") })},
		{"not a drawing view", onView(func([]byte) []byte {
			var out bytes.Buffer
			w := gzip.NewWriter(&out)
			w.Write([]byte("PK\x03\x04 something else"))
			w.Close()
			return out.Bytes()
		})},
		{"a format this reader does not read", headOf(func(h map[string]any) { h["format"] = 2 })},
		{"in millimetres", headOf(func(h map[string]any) { h["units"] = "mm" })},
		{"its lines past its end", headOf(func(h map[string]any) {
			h["arrays"].(map[string]any)["lines"].([]any)[0] = 1e9
		})},
		{"a batch past its array", headOf(func(h map[string]any) {
			b := h["batches"].([]any)[0].(map[string]any)
			b["count"] = 1e7
		})},
		{"a batch of a layer it does not have", headOf(func(h map[string]any) {
			h["batches"].([]any)[0].(map[string]any)["layer"] = 999
		})},
		{"a word more than its texts", headOf(func(h map[string]any) { h["words"] = append(h["words"].([]any), "EXTRA") })},
		{"the manifest's files not listing the folder", editJSON(FileManifest, func(doc map[string]any) {
			delete(doc["files"].(map[string]any), "drawings")
		})},
		{"a source naming another floor's file", sourceView(DrawingsDir + "ELSEWHERE.view")},
		{"a file no source names", sourceView(nil)}, // (the ground floor's source names none; its file is there)
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := rewriteFrom(t, drawnOffice, c.edit)
			if codes := codes(got.Validate()); !slices.Equal(codes, []string{ProblemDrawing}) {
				t.Fatalf("problems %v: %v", codes, got.Validate())
			}
		})
	}
	// a broken one is no drawing to show; the other floor's still is
	broken := rewriteFrom(t, drawnOffice, onView(func(d []byte) []byte { return d[:len(d)/2] }))
	if d, err := broken.Drawing(ground); d != nil || err == nil || broken.HasDrawing(ground) || !broken.HasDrawing(p.Floors[1].ID) {
		t.Fatalf("a drawing cut short: %v %v", d != nil, err)
	}
	// stored or deflated in the ZIP, the same
	data := zipFrom(t, drawnOffice, func(_ string, d []byte) []byte { return d }, zip.Store)
	stored, err := readZip(data, DefaultLimits)
	if err != nil || len(stored.Validate()) != 0 || !stored.HasDrawing(ground) {
		t.Fatalf("stored: %v", err)
	}
}
