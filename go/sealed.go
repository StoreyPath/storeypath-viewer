package storeypath

// Packages sealed with a password (spec/SEALED.md): a package StoreyPath Studio
// encrypted for sending where others could read it, ".storeypath.enc". AES-256-GCM,
// its key from the password by PBKDF2-HMAC-SHA256, in pieces each numbered and the
// last marked; the standard library alone reads it.

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/pbkdf2"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"os"
)

const (
	sealedMagic  = "SPSEALED"
	sealedHeader = 41 // magic 8 · version 1 · kdf 1 · rounds 4 · salt 16 · nonce prefix 7 · piece size 4
	sealedTag    = 16
)

// ErrNeedsPassword: a package sealed with a password, read without its password, or
// with one that is not its (errors.Is: ask for it again). Read, ReadManifest and Open
// return it for a sealed package; OpenSealed and ReadSealed take the password.
var ErrNeedsPassword = errors.New("the package is sealed with a password: its password is needed")

// ErrSealedDamaged: a sealed file changed, cut short, or of a kind this module does
// not read.
var ErrSealedDamaged = errors.New("the sealed file cannot be opened")

// IsSealed reports whether a file's first bytes are those of a file sealed with a
// password.
func IsSealed(head []byte) bool {
	return len(head) >= len(sealedMagic) && string(head[:len(sealedMagic)]) == sealedMagic
}

func isSealedAt(r io.ReaderAt) bool {
	head := make([]byte, len(sealedMagic))
	n, _ := r.ReadAt(head, 0)
	return IsSealed(head[:n])
}

// Unseal writes a sealed file's contents to w, a piece at a time (each checked before
// it is written; after an error, what was written is not to be used). The password as
// it was given to Studio, in UTF-8; Studio takes it in Unicode normal form C (as typed
// text is): one in another form is to be normalized first. A wrong password is
// ErrNeedsPassword.
func Unseal(r io.Reader, w io.Writer, password string) error {
	header := make([]byte, sealedHeader)
	if _, err := io.ReadFull(r, header); err != nil || !IsSealed(header) {
		if IsSealed(header) {
			return fmt.Errorf("%w: cut short", ErrSealedDamaged)
		}
		return fmt.Errorf("%w: not a file sealed with a password", ErrSealedDamaged)
	}
	version, kdf := header[8], header[9]
	rounds := binary.BigEndian.Uint32(header[10:14])
	salt, prefix := header[14:30], header[30:37]
	piece := binary.BigEndian.Uint32(header[37:41])
	if version != 1 || kdf != 1 || rounds < 1000 || rounds > 10_000_000 || piece < 1 || piece > 1<<26 {
		return fmt.Errorf("%w: of a kind this module does not read (made by a newer Studio?)", ErrSealedDamaged)
	}
	if password == "" {
		return ErrNeedsPassword
	}
	key, err := pbkdf2.Key(sha256.New, password, salt, int(rounds), 32)
	if err != nil {
		return err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return err
	}
	size := int(piece) + sealedTag
	chunk, after := make([]byte, size), make([]byte, size)
	n, err := io.ReadFull(r, chunk)
	if err != nil && err != io.ErrUnexpectedEOF {
		return fmt.Errorf("%w: cut short", ErrSealedDamaged)
	}
	chunk = chunk[:n]
	nonce := make([]byte, 12)
	copy(nonce, prefix)
	for i := uint32(0); ; i++ {
		m, _ := io.ReadFull(r, after) // (a piece is the last when none follows it)
		last := m == 0
		binary.BigEndian.PutUint32(nonce[7:11], i)
		nonce[11] = 0
		if last {
			nonce[11] = 1
		}
		plain, err := gcm.Open(nil, nonce, chunk, header)
		if err != nil {
			if i == 0 {
				return fmt.Errorf("%w (the one given is not its, or the file was changed)", ErrNeedsPassword)
			}
			return fmt.Errorf("%w: changed or cut short", ErrSealedDamaged)
		}
		if _, err := w.Write(plain); err != nil {
			return err
		}
		if last {
			return nil
		}
		chunk, after = after[:m], chunk[:cap(chunk)]
	}
}

// ReadSealed reads a package from its bytes, sealed with a password or not (a plain
// one's password is not used), within limits; unsealed, it is held to
// limits.MaxTotalBytes.
func ReadSealed(data []byte, password string, limits Limits) (*Package, error) {
	if !IsSealed(data) {
		return Read(bytes.NewReader(data), int64(len(data)), limits)
	}
	limits = limits.orDefault()
	var plain bytes.Buffer
	if err := Unseal(bytes.NewReader(data), &capped{w: &plain, left: limits.MaxTotalBytes}, password); err != nil {
		return nil, err
	}
	return Read(bytes.NewReader(plain.Bytes()), int64(plain.Len()), limits)
}

// OpenSealed reads a package file, sealed with a password or not, within DefaultLimits.
func OpenSealed(path, password string) (*Package, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	return ReadSealed(data, password, DefaultLimits)
}

// capped writes up to left bytes: more is ErrTooLarge.
type capped struct {
	w    io.Writer
	left int64
}

func (c *capped) Write(p []byte) (int, error) {
	if int64(len(p)) > c.left {
		return 0, fmt.Errorf("%w: the sealed package unsealed", ErrTooLarge)
	}
	c.left -= int64(len(p))
	return c.w.Write(p)
}
