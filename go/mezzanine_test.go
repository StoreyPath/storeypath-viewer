package storeypath

import (
	"slices"
	"strings"
	"testing"
)

// floorsByOrdinal edits campus-hq's floors (its Headquarters: floors 0, 1 and 2), each
// found by its ordinal as the corpus has it, its properties given to change.
func floorsByOrdinal(change func(byOrdinal map[int]map[string]any, ids map[int]string)) func(string, []byte) []byte {
	return editJSON(FileFloors, func(doc map[string]any) {
		byOrdinal, ids := map[int]map[string]any{}, map[int]string{}
		for _, f := range features(doc) {
			n := int(props(f)["ordinal"].(float64))
			byOrdinal[n], ids[n] = props(f), f.(map[string]any)["id"].(string)
		}
		change(byOrdinal, ids)
	})
}

// mezzanineOver makes a floor a mezzanine (format 0.11) of the floor with ordinal host,
// above metres above it: its ordinal the host's, its elevation the host's and above.
func mezzanineOver(floor, host map[string]any, hostID string, above float64) {
	floor["mezzanine"], floor["host_floor_id"], floor["above_host_m"] = true, hostID, above
	floor["ordinal"], floor["elevation"] = host["ordinal"], host["elevation"].(float64)+above
}

func TestAMezzanineStandsInItsHostAndComesBetweenItAndTheFloorAbove(t *testing.T) {
	// a made-up warehouse with a mezzanine: the corpus's second floor up made a
	// mezzanine 2.5 m over the ground floor
	p := rewriteFrom(t, "campus-hq.storeypath", floorsByOrdinal(func(f map[int]map[string]any, ids map[int]string) {
		f[2]["name"] = "Mezzanine"
		mezzanineOver(f[2], f[0], ids[0], 2.5)
	}))
	for _, pr := range p.Validate() {
		if pr.Code == ProblemMezzanine || pr.Code == ProblemFloorOrdinal {
			t.Errorf("a mezzanine as it should be: %v", pr)
		}
	}
	b := p.Buildings[0].ID
	floors := p.FloorsOf(b)
	if len(floors) != 3 {
		t.Fatalf("%d floors", len(floors))
	}
	ground, mezz, first := floors[0], floors[1], floors[2]
	if ground.Ordinal != 0 || ground.Mezzanine || !mezz.Mezzanine || mezz.Ordinal != 0 || first.Ordinal != 1 {
		t.Errorf("not Ground, Mezzanine, First: %+v %+v %+v", *ground, *mezz, *first)
	}
	if mezz.Host == nil || *mezz.Host != ground.ID || mezz.AboveHost == nil || *mezz.AboveHost != 2.5 ||
		mezz.Elevation != ground.Elevation+2.5 {
		t.Errorf("its host and height above it: %+v", *mezz)
	}
	if ground.Host != nil || ground.AboveHost != nil || !FloorBefore(ground, mezz) || !FloorBefore(mezz, first) {
		t.Errorf("the ground floor: %+v", *ground)
	}
	if g := p.GroundFloor(b); g == nil || g.ID != ground.ID {
		t.Errorf("the ground floor is %v, not the mezzanine on it", g)
	}
}

func TestAMezzanineAndAFloorOfOneOrdinalAreChecked(t *testing.T) {
	cases := []struct {
		name, want, says string
		change           func(f map[int]map[string]any, ids map[int]string)
	}{
		{"two floors that are not mezzanines on one ordinal", ProblemFloorOrdinal, "only a mezzanine shares",
			func(f map[int]map[string]any, _ map[int]string) { f[2]["ordinal"] = 1.0 }},
		{"two floors of one code", ProblemFloorOrdinal, "code", func(f map[int]map[string]any, _ map[int]string) {
			f[2]["code"] = f[1]["code"]
		}},
		{"a mezzanine of a floor not in the package", ProblemMezzanine, "not another floor",
			func(f map[int]map[string]any, ids map[int]string) {
				mezzanineOver(f[2], f[0], ids[0], 2.5)
				f[2]["host_floor_id"] = ids[0][:strings.LastIndex(ids[0], "-")] + "-F09"
			}},
		{"a mezzanine of itself", ProblemMezzanine, "not another floor", func(f map[int]map[string]any, ids map[int]string) {
			mezzanineOver(f[2], f[0], ids[0], 2.5)
			f[2]["host_floor_id"] = ids[2]
		}},
		{"a mezzanine with no host", ProblemMezzanine, "no host", func(f map[int]map[string]any, ids map[int]string) {
			mezzanineOver(f[2], f[0], ids[0], 2.5)
			f[2]["host_floor_id"] = nil
		}},
		{"a mezzanine of a mezzanine", ProblemMezzanine, "is a mezzanine", func(f map[int]map[string]any, ids map[int]string) {
			mezzanineOver(f[1], f[0], ids[0], 2.5)
			mezzanineOver(f[2], f[1], ids[1], 1.0)
		}},
		{"a mezzanine of another ordinal than its host's", ProblemMezzanine, "ordinal 2", func(f map[int]map[string]any, ids map[int]string) {
			mezzanineOver(f[2], f[0], ids[0], 2.5)
			f[2]["ordinal"] = 2.0
		}},
		{"a mezzanine not above its host", ProblemMezzanine, "more than 0", func(f map[int]map[string]any, ids map[int]string) {
			mezzanineOver(f[2], f[0], ids[0], 0)
		}},
		{"a mezzanine with no height above its host", ProblemMezzanine, "more than 0", func(f map[int]map[string]any, ids map[int]string) {
			mezzanineOver(f[2], f[0], ids[0], 2.5)
			delete(f[2], "above_host_m")
		}},
		{"a mezzanine whose elevation is not its host's and its height above it", ProblemMezzanine, "is not its host's",
			func(f map[int]map[string]any, ids map[int]string) {
				mezzanineOver(f[2], f[0], ids[0], 2.5)
				f[2]["elevation"] = f[2]["elevation"].(float64) + 0.5
			}},
		{"a floor that is not a mezzanine with a host", ProblemMezzanine, "not a mezzanine", func(f map[int]map[string]any, ids map[int]string) {
			f[2]["host_floor_id"] = ids[1]
		}},
		{"a floor that is not a mezzanine with a height above a host", ProblemMezzanine, "not a mezzanine",
			func(f map[int]map[string]any, ids map[int]string) { f[2]["above_host_m"] = 3.0 }},
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
}

func TestAMezzaninesFloorCodeIsAnIDSegment(t *testing.T) {
	// M00 over F00, M01 over F01, MB01 over B01, a second on one floor M00B: an ID's
	// segments as any other floor's
	for _, id := range []string{"K7Q2XM-RUH-HQ-M00", "K7Q2XM-RUH-HQ-M00-0001", "K7Q2XM-RUH-HQ-MB01-0142", "K7Q2XM-RUH-HQ-M00B"} {
		pid, err := ParseID(id)
		if err != nil {
			t.Errorf("%s: %v", id, err)
			continue
		}
		if f, _ := pid.Prefix(LevelFloor); !strings.HasPrefix(f, "K7Q2XM-RUH-HQ-M") {
			t.Errorf("%s: its floor %s", id, f)
		}
	}
}
