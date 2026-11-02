// SPDX-License-Identifier: GPL-3.0-or-later
// Encryption of the secrets on disk: the Client ID and Secret Key in config.json, and the EVE login
// in data/tokens.json.
//
// The app (src/main.js) hands in a "box" built on Electron's safeStorage: Windows' built-in data
// protection (DPAPI) or the macOS Keychain. The key belongs to your user account on this computer
// and is kept by the operating system, never in a file. Encrypted values look like "enc:<base64>".
//
// Plain values (from an older version, or an imported folder) are read as they are and encrypted the
// first time they are loaded. Values encrypted on another computer or user account can't be read:
// the HUD then asks for the Client ID / Secret Key or the login again.
//
// Without a box (the tests) everything stays plain.

export const PREFIX = 'enc:';
let box = null;

export function useSecretBox(next) {
  box = next || null;
}
export const canEncrypt = () => Boolean(box);
export const isSealed = (v) => typeof v === 'string' && v.startsWith(PREFIX);

export function seal(text) {
  if (!box || typeof text !== 'string' || !text || isSealed(text)) return text;
  return PREFIX + box.encrypt(text);
}

// Throws when the value can't be decrypted here.
export function unseal(value) {
  if (!isSealed(value)) return value;
  if (!box) throw new Error('encrypted, and encryption is not available');
  return box.decrypt(value.slice(PREFIX.length));
}
