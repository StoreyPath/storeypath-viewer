package storeypath

import (
	"slices"
	"strings"
	"testing"
)

// roofOver makes a floor the building's roof (format 0.11): RF, "Roof".
func roofOver(floor map[string]any) {
	floor["type"], floor["code"], floor["name"] = FloorTypeRoof, "RF", "Roof"
}

// alsoEdit runs two edits of a corpus package's files, one after the other.
func alsoEdit(first, then func(string, []byte) []byte) func(string, []byte) []byte {
	return func(name string, data []byte) []byte { return then(name, first(name, data)) }
}

// floorProblems is what Validate says of floors.geojson, by code.
func floorProblems(p *Package, codes ...string) []Problem {
	var out []Problem
	for _, pr := range p.Validate() {
		if pr.File == FileFloors && slices.Contains(codes, pr.Code) {
			out = append(out, pr)
		}
	}
	return out
}

func TestARoofIsItsBuildingsTopLevel(t *testing.T) {
	// campus-hq's top floor (floor 2) made its roof
	p := rewriteFrom(t, "campus-hq.storeypath", floorsByOrdinal(func(f map[int]map[string]any, _ map[int]string) {
		roofOver(f[2])
	}))
	if got := floorProblems(p, ProblemRoof, ProblemMezzanine, ProblemFloorOrdinal, ProblemValue); len(got) != 0 {
		t.Errorf("a roof as it should be: %v", got)
	}
	b := p.Buildings[0].ID
	floors := p.FloorsOf(b)
	if len(floors) != 3 {
		t.Fatalf("%d floors", len(floors))
	}
	ground, first, roof := floors[0], floors[1], floors[2]
	if ground.Type != FloorTypeFloor || first.Type != FloorTypeFloor || !roof.IsRoof() || roof.IsMezzanine() ||
		roof.Code != "RF" || roof.Ordinal != 2 {
		t.Errorf("not Ground, First, Roof: %+v %+v %+v", *ground, *first, *roof)
	}
	if g := p.GroundFloor(b); g == nil || g.ID != ground.ID {
		t.Errorf("the ground floor is %v", g)
	}
	// a package's floors with no type (before 0.11) are floors
	old := rewriteFrom(t, "campus-hq.storeypath", editJSON(FileFloors, func(doc map[string]any) {
		for _, f := range features(doc) {
			delete(props(f), "type")
		}
	}))
	for _, f := range old.Floors {
		if f.Type != FloorTypeFloor || f.IsRoof() || f.IsMezzanine() {
			t.Errorf("%s with no type: %q", f.ID, f.Type)
		}
	}
}

func TestARoofAndTheLevelsRoundItAreChecked(t *testing.T) {
	cases := []struct {
		name, want, says string
		change           func(f map[int]map[string]any, ids map[int]string)
	}{
		{"a floor above a roof", ProblemRoof, "above the roof", func(f map[int]map[string]any, _ map[int]string) {
			roofOver(f[1])
		}},
		{"a mezzanine on a roof", ProblemMezzanine, "is a roof", func(f map[int]map[string]any, ids map[int]string) {
			roofOver(f[2])
			mezzanineOver(f[1], f[2], ids[2], 1.0)
		}},
		{"a level of a type the format does not have", ProblemValue, "floor types", func(f map[int]map[string]any, _ map[int]string) {
			f[2]["type"] = "attic"
		}},
		{"a roof and a floor of one ordinal", ProblemFloorOrdinal, "only a mezzanine shares", func(f map[int]map[string]any, _ map[int]string) {
			roofOver(f[2])
			f[2]["ordinal"] = 1.0
		}},
		{"a roof with a host", ProblemMezzanine, "not a mezzanine", func(f map[int]map[string]any, ids map[int]string) {
			roofOver(f[2])
			f[2]["host_floor_id"] = ids[1]
		}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			problems := rewriteFrom(t, "campus-hq.storeypath", floorsByOrdinal(c.change)).Validate()
			found := slices.ContainsFunc(problems, func(pr Problem) bool {
				return pr.Code == c.want && pr.File == FileFloors && strings.Contains(pr.Message, c.says)
			})
			if !found {
				t.Errorf("want %s (%q): %v", c.want, c.says, problems)
			}
		})
	}
	// two roofs, the second over the rooms standing on the first: no floor above a roof
	p := rewriteFrom(t, "campus-hq.storeypath", floorsByOrdinal(func(f map[int]map[string]any, _ map[int]string) {
		roofOver(f[1])
		roofOver(f[2])
		f[2]["code"] = "RF2"
	}))
	if got := floorProblems(p, ProblemRoof, ProblemFloorOrdinal); len(got) != 0 {
		t.Errorf("a roof over a roof: %v", got)
	}
	// a level of a type a later version adds is read as a floor's
	q := rewriteFrom(t, "campus-hq.storeypath", floorsByOrdinal(func(f map[int]map[string]any, _ map[int]string) {
		f[0]["type"] = "attic"
	}))
	if g := q.GroundFloor(q.Buildings[0].ID); g == nil || g.Ordinal != 0 || g.Type != "attic" {
		t.Errorf("the ground floor of an unknown type: %v", g)
	}
}

func TestARoofsOpenDeckIsASpaceOfTypeRoof(t *testing.T) {
	// the top floor made the roof, a space on it its open deck (outdoor), the manifest's
	// types listing the format's, as a package of 0.11 does
	var deck string
	p := rewriteFrom(t, "campus-hq.storeypath", alsoEdit(
		alsoEdit(
			floorsByOrdinal(func(f map[int]map[string]any, _ map[int]string) { roofOver(f[2]) }),
			editJSON(FileManifest, func(doc map[string]any) {
				types := doc["types"].(map[string]any)
				for _, kind := range []string{"space", "zone"} {
					if names, _ := types[kind].([]any); !slices.Contains(names, any("roof")) {
						types[kind] = append(names, "roof")
					}
				}
				types["floor"] = []any{FloorTypeFloor, FloorTypeMezzanine, FloorTypeRoof}
			})),
		editJSON(FileSpaces, func(doc map[string]any) {
			for _, f := range features(doc) {
				q := props(f)
				if q["type"] == "corridor" && strings.HasSuffix(q["floor_id"].(string), "-F02") && deck == "" {
					q["type"], q["outdoor"] = "roof", true
					deck = f.(map[string]any)["id"].(string)
				}
			}
		})))
	if deck == "" {
		t.Fatal("no corridor on the top floor")
	}
	for _, pr := range p.Validate() {
		if pr.Code == ProblemValue || pr.Code == ProblemRoof {
			t.Errorf("a roof's deck: %v", pr)
		}
	}
	if s := p.Space(deck); s == nil || s.Type != "roof" || !s.Outdoor {
		t.Errorf("the deck: %+v", s)
	}
}

func TestARoofsFloorCodeIsAnIDSegment(t *testing.T) {
	// RF, and RF2 for a second roof over the rooms on the first: segments as any floor's
	for _, id := range []string{"K7Q2XM-RUH-HQ-RF", "K7Q2XM-RUH-HQ-RF-0001", "K7Q2XM-RUH-HQ-RF2-0007"} {
		pid, err := ParseID(id)
		if err != nil {
			t.Errorf("%s: %v", id, err)
			continue
		}
		if f, _ := pid.Prefix(LevelFloor); !strings.HasPrefix(f, "K7Q2XM-RUH-HQ-RF") {
			t.Errorf("%s: its floor %s", id, f)
		}
	}
}
