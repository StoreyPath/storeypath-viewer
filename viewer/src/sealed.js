// Files sealed with a password (spec/SEALED.md): a package StoreyPath Studio encrypted for
// sending where others could read it. AES-256-GCM, its key from the password by
// PBKDF2-HMAC-SHA256, in pieces each numbered and the last marked; read here with the
// browser's own cryptography (WebCrypto: a secure page, https or localhost; Node 20+).

const MAGIC = "SPSEALED";
const HEADER = 41; // magic 8 · version 1 · kdf 1 · rounds 4 · salt 16 · nonce prefix 7 · piece size 4
const TAG = 16;

/** Why a sealed file was not opened: ``needsPassword`` when its password is needed, or
 * the one given is not its (ask for it again); otherwise the file is damaged or of a
 * kind not read here. */
export class SealedError extends Error {
  constructor(message, needsPassword = false) {
    super(message);
    this.name = "SealedError";
    this.needsPassword = needsPassword;
  }
}

/** Whether bytes (a Uint8Array) are a file sealed with a password. */
export function isSealed(bytes) {
  if (!bytes || bytes.length < MAGIC.length) return false;
  for (let i = 0; i < MAGIC.length; i++) if (bytes[i] !== MAGIC.charCodeAt(i)) return false;
  return true;
}

/** A sealed file's bytes opened with its password (a string, or a function giving one,
 * called only when needed): a Uint8Array. Throws SealedError. */
export async function unseal(bytes, password) {
  if (!isSealed(bytes)) throw new SealedError("not a file sealed with a password");
  if (bytes.length < HEADER + TAG) throw new SealedError("the sealed file is cut short");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint8(8), kdf = view.getUint8(9), rounds = view.getUint32(10);
  const piece = view.getUint32(37);
  if (version !== 1 || kdf !== 1 || rounds < 1000 || rounds > 10_000_000 || piece < 1 || piece > 1 << 26) {
    throw new SealedError("a sealed file of a kind this viewer does not read (made by a newer Studio?)");
  }
  const given = typeof password === "function" ? await password() : password;
  if (!given) throw new SealedError("the file is sealed: its password is needed", true);
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new SealedError("this page cannot open sealed files: it must be served over https (or localhost)");
  const header = bytes.subarray(0, HEADER);
  const salt = bytes.slice(14, 30), prefix = bytes.slice(30, 37);
  const base = await subtle.importKey("raw", new TextEncoder().encode(String(given).normalize("NFC")), "PBKDF2", false, ["deriveKey"]);
  const key = await subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations: rounds }, base,
    { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  const size = piece + TAG, out = [];
  let total = 0;
  for (let at = HEADER, n = 0; ; at += size, n++) {
    const last = at + size >= bytes.length;
    const nonce = new Uint8Array(12);
    nonce.set(prefix);
    new DataView(nonce.buffer).setUint32(7, n);
    nonce[11] = last ? 1 : 0;
    let plain;
    try {
      plain = new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv: nonce, additionalData: header, tagLength: 128 },
        key, bytes.subarray(at, Math.min(at + size, bytes.length))));
    } catch {
      throw n === 0 ? new SealedError("the password is not this file's (or the file was changed)", true)
        : new SealedError("the sealed file was changed or cut short");
    }
    out.push(plain);
    total += plain.length;
    if (last) break;
  }
  const whole = new Uint8Array(total);
  let at = 0;
  for (const p of out) {
    whole.set(p, at);
    at += p.length;
  }
  return whole;
}
