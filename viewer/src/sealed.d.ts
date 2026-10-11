/** Why a sealed file was not opened: `needsPassword` when its password is needed, or the
 * one given is not its; otherwise the file is damaged or of a kind not read here. */
export declare class SealedError extends Error {
  readonly needsPassword: boolean;
  constructor(message: string, needsPassword?: boolean);
}
/** A password, or a function giving one (called only when the file is sealed). */
export type Password = string | (() => string | Promise<string>);
/** Whether bytes are a file sealed with a password (spec/SEALED.md). */
export declare function isSealed(bytes: Uint8Array): boolean;
/** A sealed file's bytes opened with its password. Throws SealedError. */
export declare function unseal(bytes: Uint8Array, password: Password | null | undefined): Promise<Uint8Array>;
