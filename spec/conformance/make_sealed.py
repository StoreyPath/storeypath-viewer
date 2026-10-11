"""A package sealed with a password (spec/SEALED.md), for every reader to open the same
way: packages/campus-hq.storeypath sealed as StoreyPath Studio seals it, but with a fixed
salt and nonce (so that this file is made again byte for byte), few rounds (a test need
not wait) and small pieces (so that it has several, the last shorter). sealed.json says
how, and what it opens to.

    python make_sealed.py      (needs the cryptography package)
"""

import hashlib
import json
import struct
import unicodedata
from pathlib import Path

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

HERE = Path(__file__).parent
PLAIN = "packages/campus-hq.storeypath"
SEALED = "sealed/campus-hq.storeypath.enc"
PASSWORD = "correct horse battery staple"
ROUNDS, PIECE = 1000, 16384
SALT, PREFIX = bytes(range(16)), bytes(range(100, 107))  # (fixed here alone: Studio's are random)


def seal(data: bytes) -> bytes:
    header = struct.pack(">8sBBI16s7sI", b"SPSEALED", 1, 1, ROUNDS, SALT, PREFIX, PIECE)
    key = hashlib.pbkdf2_hmac("sha256", unicodedata.normalize("NFC", PASSWORD).encode(), SALT, ROUNDS, 32)
    aead, out = AESGCM(key), [header]
    pieces = [data[i:i + PIECE] for i in range(0, len(data), PIECE)] or [b""]
    for n, piece in enumerate(pieces):
        nonce = PREFIX + struct.pack(">I", n) + (b"\1" if n == len(pieces) - 1 else b"\0")
        out.append(aead.encrypt(nonce, piece, header))
    return b"".join(out)


if __name__ == "__main__":
    plain = (HERE / PLAIN).read_bytes()
    (HERE / SEALED).parent.mkdir(exist_ok=True)
    (HERE / SEALED).write_bytes(seal(plain))
    (HERE / "sealed.json").write_text(json.dumps({
        "sealed": SEALED, "password": PASSWORD, "rounds": ROUNDS, "piece": PIECE,
        "pieces": -(-len(plain) // PIECE), "plain": PLAIN, "plain_sha256": hashlib.sha256(plain).hexdigest(),
    }, indent=2) + "\n")
    print(f"{SEALED}: {len(plain)} bytes sealed in {-(-len(plain) // PIECE)} pieces")
