// SPDX-License-Identifier: GPL-3.0-or-later
// Build and signing settings for electron-builder (https://www.electron.build, version 26).
// (.cjs because this project is an ES-module project: electron-builder loads its config with require.)
//
//   npm run dist:win   -> dist/EVE HUD Setup <version>.exe          (build on Windows)
//   npm run dist:mac   -> dist/EVE HUD-<version>-universal.dmg      (build on a Mac)
//
// The HUD itself is the hud/ folder (server.js, lib/, public/, config.example.json). Your
// config.json and data/ (Client ID, Secret Key, EVE login) live in the app's own folder, never here,
// so they can't end up in the installer.
//
// No secrets live in this file. Certificates and passwords come from environment variables, so
// the folder can be shared safely. Without any of them you get an unsigned build, which is fine
// for your own computers (README.md, "Signing", explains the warnings and how to add it later).
//
// Windows, pick one:
//   a) certificate in the Windows certificate store (USB token or cloud HSM from your CA):
//        WIN_CERT_SUBJECT="Your Name"   (the certificate's subject / common name)
//   b) Azure Artifact Signing (formerly Trusted Signing), if it becomes available to you:
//        AZURE_SIGN_ENDPOINT, AZURE_SIGN_ACCOUNT, AZURE_SIGN_PROFILE, AZURE_SIGN_PUBLISHER
//        plus AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET
//   c) a .pfx file: CSC_LINK=/path/cert.pfx  CSC_KEY_PASSWORD=...
//
// macOS, just for your own Macs (a free Apple account is enough):
//   MAC_SIGN=development   signs with your "Apple Development" certificate (Xcode → Settings →
//   Accounts → Manage Certificates → +), no notarization. Every build then has the same signature,
//   so the Keychain keeps trusting it and doesn't ask again after each new build.
//   (npm run dist:mac-dev does this.)
//
// macOS (signing + notarization, needs the paid Apple Developer Program):
//   CSC_NAME="Developer ID Application: Your Name (TEAMID)"   optional; found in the keychain otherwise
//   APPLE_API_KEY=/path/AuthKey_XXXX.p8  APPLE_API_KEY_ID=XXXX  APPLE_API_ISSUER=uuid
//     or APPLE_ID=you@example.com  APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx  APPLE_TEAM_ID=TEAMID

'use strict';

const env = process.env;
const macDev = env.MAC_SIGN === 'development';

function windowsSigning() {
  if (env.AZURE_SIGN_ENDPOINT) {
    return {
      azureSignOptions: {
        endpoint: env.AZURE_SIGN_ENDPOINT, // e.g. https://weu.codesigning.azure.net
        codeSigningAccountName: env.AZURE_SIGN_ACCOUNT,
        certificateProfileName: env.AZURE_SIGN_PROFILE,
        publisherName: env.AZURE_SIGN_PUBLISHER, // must match the certificate's common name exactly
      },
    };
  }
  if (env.WIN_CERT_SUBJECT) {
    return {
      signtoolOptions: { certificateSubjectName: env.WIN_CERT_SUBJECT, signingHashAlgorithms: ['sha256'] },
    };
  }
  return { signtoolOptions: { signingHashAlgorithms: ['sha256'] } }; // CSC_LINK is picked up automatically
}

module.exports = {
  appId: 'com.evehud.app', // change to your own reverse domain before the first signed release
  productName: 'EVE HUD',
  copyright: 'Copyright © 2026 danisxlab',
  directories: { output: 'dist', buildResources: 'build' },
  files: ['src/**/*', 'assets/**/*', 'package.json', 'LICENSE', 'hud/**/*'],

  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: 'assets/icon.ico',
    ...windowsSigning(),
  },
  nsis: {
    oneClick: true, // installs for the current user, no admin rights, no questions
    perMachine: false,
    runAfterFinish: true,
    createDesktopShortcut: true,
    shortcutName: 'EVE HUD',
    deleteAppDataOnUninstall: true,
    artifactName: '${productName} Setup ${version}.${ext}',
  },

  mac: {
    target: [{ target: 'dmg', arch: ['universal'] }], // one app for Apple silicon and Intel
    category: 'public.app-category.games',
    icon: 'build/icon.png',
    hardenedRuntime: true, // required for notarization
    gatekeeperAssess: false,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
    // Notarization runs automatically when the APPLE_* variables above are set.
    // MAC_SIGN=development: an "Apple Development" certificate instead of "Developer ID
    // Application", and no notarization (Apple only notarizes Developer ID builds).
    ...(macDev ? { type: 'development', notarize: false } : {}),
  },
  dmg: {
    artifactName: '${productName}-${version}-${arch}.${ext}',
  },
};
