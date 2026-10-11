package storeypath

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

// sealedVector is spec/conformance/sealed.json: a package sealed with a password, what
// it opens to, and how it was sealed (make_sealed.py).
type sealedVector struct {
	Sealed      string `json:"sealed"`
	Password    string `json:"password"`
	Piece       int    `json:"piece"`
	Pieces      int    `json:"pieces"`
	Plain       string `json:"plain"`
	PlainSHA256 string `json:"plain_sha256"`
}

func sealedSample(t *testing.T) (sealedVector, []byte, []byte) {
	t.Helper()
	var v sealedVector
	data, err := os.ReadFile(filepath.Join(corpus, "sealed.json"))
	if err == nil {
		err = json.Unmarshal(data, &v)
	}
	if err != nil {
		t.Fatal(err)
	}
	sealed, err := os.ReadFile(filepath.Join(corpus, v.Sealed))
	if err != nil {
		t.Fatal(err)
	}
	plain, err := os.ReadFile(filepath.Join(corpus, v.Plain))
	if err != nil {
		t.Fatal(err)
	}
	return v, sealed, plain
}

func TestASealedPackageOpensWithItsPasswordAsThePackageItWas(t *testing.T) {
	v, sealed, plain := sealedSample(t)
	var out bytes.Buffer
	if err := Unseal(bytes.NewReader(sealed), &out, v.Password); err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(out.Bytes())
	if hex.EncodeToString(sum[:]) != v.PlainSHA256 || !bytes.Equal(out.Bytes(), plain) {
		t.Fatalf("unsealed: %d bytes, not the package it was", out.Len())
	}
	got, err := OpenSealed(filepath.Join(corpus, v.Sealed), v.Password)
	if err != nil {
		t.Fatal(err)
	}
	want, err := Open(filepath.Join(corpus, v.Plain))
	if err != nil {
		t.Fatal(err)
	}
	if got.Manifest.Project.ID != want.Manifest.Project.ID || len(got.Spaces) != len(want.Spaces) || len(got.Spaces) == 0 {
		t.Fatalf("opened sealed: %s, %d spaces; plain: %s, %d", got.Manifest.Project.ID, len(got.Spaces), want.Manifest.Project.ID, len(want.Spaces))
	}
	// a package that is not sealed opens as it is, its password not used
	if p, err := OpenSealed(filepath.Join(corpus, v.Plain), "anything"); err != nil || len(p.Spaces) != len(want.Spaces) {
		t.Fatalf("plain through OpenSealed: %v", err)
	}
}

func TestASealedPackageWithoutItsPasswordOrWithAnotherSaysSo(t *testing.T) {
	v, sealed, _ := sealedSample(t)
	path := filepath.Join(corpus, v.Sealed)
	if _, err := Open(path); !errors.Is(err, ErrNeedsPassword) {
		t.Fatalf("Open: %v", err)
	}
	if _, err := ReadManifest(bytes.NewReader(sealed), int64(len(sealed)), DefaultLimits); !errors.Is(err, ErrNeedsPassword) {
		t.Fatalf("ReadManifest: %v", err)
	}
	for _, password := range []string{"", "correct horse battery stable"} {
		if _, err := OpenSealed(path, password); !errors.Is(err, ErrNeedsPassword) {
			t.Fatalf("OpenSealed(%q): %v", password, err)
		}
	}
	if !IsSealed(sealed) || IsSealed([]byte("PK\x03\x04")) {
		t.Fatal("IsSealed")
	}
}

func TestASealedPackageChangedCutShortOrTooLargeIsRefused(t *testing.T) {
	v, sealed, _ := sealedSample(t)
	if v.Pieces < 3 {
		t.Fatalf("the sample has %d pieces: it needs several", v.Pieces)
	}
	size := v.Piece + 16
	changed := append([]byte(nil), sealed...)
	changed[41+size*2+5] ^= 1 // a byte of its third piece
	cut := sealed[:41+size*2] // after a whole piece: its last is missing
	for name, data := range map[string][]byte{"changed": changed, "cut": cut, "header": sealed[:20]} {
		if _, err := ReadSealed(data, v.Password, DefaultLimits); !errors.Is(err, ErrSealedDamaged) {
			t.Fatalf("%s: %v", name, err)
		}
	}
	small := DefaultLimits
	small.MaxTotalBytes = 1000
	if _, err := ReadSealed(sealed, v.Password, small); !errors.Is(err, ErrTooLarge) {
		t.Fatalf("over its limits: %v", err)
	}
}
