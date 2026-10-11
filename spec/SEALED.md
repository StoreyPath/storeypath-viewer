# Packages sealed with a password

StoreyPath Studio can encrypt a package with a password before it is sent somewhere
others could read it: `<name>.storeypath.enc`. Its contents are an ordinary package
(FORMAT.md); only the wrapping is different. The viewer's readers open one when they are
given its password:

| Reader | Without its password, or with another | With it |
|---|---|---|
| 3D world, map (`loadPackage`, `world.open`, `viewer.open`) | a `SealedError`, its `needsPassword` true | `{ password }`: a string, or a function giving one (called only when the package is sealed) |
| 2D plan (`readPackage`) | the same | `readPackage(source, { password })` |
| Go (`Open`, `Read`, `ReadManifest`) | `ErrNeedsPassword` (`errors.Is`) | `OpenSealed(path, password)`, `ReadSealed(data, password, limits)`, `Unseal(r, w, password)` |

A changed, cut-short or unknown kind of sealed file is refused: `SealedError` with
`needsPassword` false, or Go's `ErrSealedDamaged`. A package that is not sealed opens as
it always did, its password not used (nor asked for). The password goes from whoever
exported the package to whoever opens it by another way than the file; no reader keeps
it.

In a browser, unsealing uses WebCrypto, which a page has only when it is served over
HTTPS (or from localhost).

## The format

AES-256-GCM, with a key made from the password by PBKDF2-HMAC-SHA256. These are in every
platform's own cryptography (a browser's WebCrypto, Go's `crypto/aes`, `crypto/cipher`
and `crypto/pbkdf2`, Python's `cryptography`). The file is sealed in pieces, so that a
large one is sealed as it is written and opened as it is read; each piece is numbered and
the last one marked, so a piece changed, reordered, left out or added is caught, as is a
wrong password.

```
header (41 bytes)
  magic        8 bytes   "SPSEALED"
  version      1 byte    1
  kdf          1 byte    1 = PBKDF2-HMAC-SHA256
  rounds       4 bytes   big-endian; Studio writes 600,000 (readers take 1,000 to 10,000,000)
  salt         16 bytes  random
  nonce prefix 7 bytes   random
  piece size   4 bytes   big-endian; Studio writes 1,048,576 (readers take up to 64 MiB)

pieces, one after another, to the end of the file
  each: AES-256-GCM(key, nonce, plaintext, associated data = the header) → ciphertext ‖ 16-byte tag
  nonce (12 bytes) = nonce prefix ‖ the piece's number (4 bytes, big-endian, from 0) ‖ 1 for the last piece, else 0
  every piece but the last holds exactly `piece size` bytes of plaintext; the last holds
  the rest: from 1 up to piece size bytes, or none when the file is empty
```

The key is `PBKDF2-HMAC-SHA256(password, salt, rounds, 32 bytes)`, the password in UTF-8
in Unicode normal form C (Studio and the JavaScript readers normalize it; Go's standard
library cannot, so a Go caller passes it as typed, which is that form almost always).

To read one: read the header and check its magic, version and kdf; derive the key; then
read `piece size + 16` bytes at a time. A piece is the last when nothing follows it. Open
each with its nonce and the header as associated data. If the first piece fails, the
password is wrong (or the file was changed); if a later one fails, the file was changed
or cut short, and what was read of it is not to be used.

## The conformance sample

`conformance/sealed/campus-hq.storeypath.enc` is `conformance/packages/campus-hq.storeypath`
sealed with the password in `conformance/sealed.json`, in four pieces (a fixed salt and
nonce, few rounds and small pieces, so that `make_sealed.py` makes it again byte for
byte; Studio's are random, many and large). Every reader must open it to exactly that
package, and refuse it without its password, with another, or with a byte changed.
