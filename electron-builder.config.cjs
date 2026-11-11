// SPDX-License-Identifier: GPL-3.0-or-later
// Build and signing settings for electron-builder (https://www.electron.build, version 26).
// (.cjs because this project is an ES-module project: electron-builder loads its config with require.)
//
//   npm run dist:win   -> dist/EVE HUD Setup <version>.exe          (build on Windows)
//   npm run dist:mac   -> dist/EVE HUD-<version>-universal.dmg      (build on a Mac)
//   npm run dist:linux -> dist/EVE HUD-<version>-x86_64.AppImage and dist/eve-hud_<version>_amd64.deb
//                                                                   (build on Linux or a Mac)
//
// The HUD itself is the hud/ folder (server.js, lib/, public/, config.example.json). Your
// config.json and data/ (Client ID, Secret Key, EVE login) live in the app's own folder, never here,
// so they can't end up in the installer.
//
// No secrets live in this file. Certificates and passwords come from environment variables, so
// the folder can be shared safely. Without any of them you get an unsigned build, which is fine
// for your own computers (the documentation, "Signing", explains the warnings and how to add it later).
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
const { execFileSync } = require('node:child_process');

// The commit you build from goes into the app's package.json as "gitCommit", for About
// (v1.0.3_8f2c1d0). Build from the commit your GitHub release (its tag) points to, and the two match.
function gitCommit() {
  try {
    return execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], {
      cwd: __dirname,
      encoding: 'utf8',
    }).trim();
  } catch {
    return undefined; // no git: About shows just the version
  }
}
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
  // No automatic updates, so no update files: no latest.yml / latest-mac.yml (electron-builder would
  // otherwise make them for the GitHub repository it finds) and no .blockmap files next to the
  // installers (the pieces an updater downloads). dist/ then holds just what you share.
  publish: null,
  extraMetadata: { gitCommit: gitCommit() },
  // Electron "fuses": switches in the app's own program file, set once at build time. With these the
  // program can't be started as plain Node (ELECTRON_RUN_AS_NODE, NODE_OPTIONS, --inspect), and it
  // only starts the app.asar it was built with: another program can't run its own code as "EVE HUD"
  // (and ask the Keychain for the login under that name). The asar check works on macOS and Windows.
  // resetAdHocDarwinSignature: an unsigned Mac build keeps a valid ad-hoc signature after the change
  // (Apple silicon doesn't start an app without one).
  electronFuses: {
    runAsNode: false,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
    resetAdHocDarwinSignature: true,
  },

  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: 'assets/icon.ico',
    ...windowsSigning(),
  },
  // A normal (assisted) Windows installer: the license (GPL, from LICENSE) to accept, install for
  // you only or for everyone, the folder to install to, shortcuts, and "Run EVE HUD" at the end.
  // Uninstalling asks whether to delete your settings and data too (build/installer.nsh).
  nsis: {
    oneClick: false,
    perMachine: false, // shows the "Only for me / Anyone who uses this computer" page
    allowToChangeInstallationDirectory: true,
    license: 'LICENSE',
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    runAfterFinish: true, // a "Run EVE HUD" tick box on the last page
    shortcutName: 'EVE HUD',
    include: 'build/installer.nsh',
    // in the HUD's style: the plexus with the logo, down the left of the last page (and the
    // uninstaller's first and last pages). A 24-bit BMP file of exactly 164×314
    installerSidebar: 'build/installerSidebar.bmp',
    uninstallerSidebar: 'build/installerSidebar.bmp',
    artifactName: '${productName} Setup ${version}.${ext}',
    differentialPackage: false, // no .exe.blockmap
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
  // The window that opens with the .dmg: the plexus background in the HUD's style, with an arrow
  // from the app to the Applications folder (build/background.png, and background@2x.png for Retina
  // screens; electron-builder combines the two). The icons sit on that picture's two plates.
  // electron-builder sizes the window from the picture (a "window" setting is ignored then), and
  // Finder counts its title bar in that size: so the picture is 600×460, with the design in the top
  // 600×400 and 60 px of background below it for the title bar.
  dmg: {
    artifactName: '${productName}-${version}-${arch}.${ext}',
    writeUpdateInfo: false, // no .dmg.blockmap
    title: '${productName} ${version}',
    background: 'build/background.png',
    iconSize: 96,
    iconTextSize: 13,
    contents: [
      { x: 160, y: 200 }, // the app
      { x: 440, y: 200, type: 'link', path: '/Applications' },
    ],
  },

  // Linux: an AppImage (one file that runs on most distributions: make it executable and start it)
  // and a .deb for Ubuntu, Debian, Mint… (a normal install with a menu entry, in /opt/EVE HUD).
  // syncDesktopName + desktopName in package.json: the window and the menu entry belong together, so
  // the desktop shows the HUD's icon for the running window.
  linux: {
    target: [
      { target: 'AppImage', arch: ['x64'] },
      { target: 'deb', arch: ['x64'] },
    ],
    icon: 'build/icon.png',
    executableName: 'eve-hud',
    syncDesktopName: true,
    category: 'Game',
    synopsis: 'Live EVE Online HUD for a second screen',
    // a .deb needs a maintainer; package.json's author has no e-mail address, so this is it
    maintainer: 'danisxlab (https://github.com/danisxlab/eve-hud)',
  },
  appImage: {
    artifactName: '${productName}-${version}-${arch}.${ext}', // EVE HUD-1.0.3-x86_64.AppImage
  },
  deb: {
    packageName: 'eve-hud', // sudo apt remove eve-hud
    artifactName: 'eve-hud_${version}_${arch}.${ext}', // eve-hud_1.0.3_amd64.deb
  },
};
