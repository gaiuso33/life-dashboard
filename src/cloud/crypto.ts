/**
 * End-to-end encryption for the cloud copy. The passphrase never leaves the device: it is turned into a key
 * (PBKDF2) and the data is sealed with AES-GCM before upload, so the server only ever stores unreadable text.
 * A wrong passphrase fails the GCM check, so it can't be confused with damaged data.
 */
const ITERATIONS = 600_000;
const enc = new TextEncoder();
const dec = new TextDecoder();

export class WrongKeyError extends Error {
  constructor() {
    super('wrong passphrase or damaged cloud copy');
    this.name = 'WrongKeyError';
  }
}

export const toB64 = (bytes: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
export const fromB64 = (b64: string): Uint8Array<ArrayBuffer> => {
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

export const newSalt = (): string => toB64(crypto.getRandomValues(new Uint8Array(16)));

/** `extractable` is false so a key kept on a device can be used but never read out. */
export async function deriveKey(passphrase: string, salt: string, iterations = ITERATIONS): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: fromB64(salt), iterations, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/** Output is a small JSON envelope (version, iv, ciphertext) so the format can change later. */
export async function seal(key: CryptoKey, plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plain)));
  return JSON.stringify({ v: 1, iv: toB64(iv), ct: toB64(ct) });
}

export async function open(key: CryptoKey, envelope: string): Promise<string> {
  let parsed: { v?: number; iv?: string; ct?: string };
  try {
    parsed = JSON.parse(envelope);
  } catch {
    throw new WrongKeyError();
  }
  if (parsed.v !== 1 || typeof parsed.iv !== 'string' || typeof parsed.ct !== 'string') throw new WrongKeyError();
  try {
    return dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(parsed.iv) }, key, fromB64(parsed.ct)));
  } catch {
    throw new WrongKeyError();
  }
}

/** Same data always gives the same text, so two copies can be compared without caring about key order. */
export function stable(value: unknown): string {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return JSON.stringify(walk(value));
}
