# EVE HUD

A live EVE Online HUD for a second screen, as a desktop app for Windows, macOS and Linux. It shows your character, skill training, industry, market orders, chat, a star map with routes and hazards, Faction Warfare and more, from CCP/Fenris Creations's ESI and EVE's own log files. Designed for a portrait monitor such as 1200×1920, but any window size works and can be made full-screen.

![EVE HUD in demo mode: character, training queue, star map, chat, industry, market orders and warfare](documentation/images/hud.webp)

**▶ Try it in your browser: [danisxlab.github.io/eve-hud/demo](https://danisxlab.github.io/eve-hud/demo/)** (sample data, no download or login).

**📖 Documentation: [danisxlab.github.io/eve-hud/documentation](https://danisxlab.github.io/eve-hud/documentation/)**.
It covers installing, every module and setting, `config.json`, privacy, building and troubleshooting.

## Features

- **Modules you arrange yourself** on a grid: Character and wallet, Training Queue, Star Map, Chat, Industry, Market Orders, Warfare, and optional Activity & Income, Mining Ledger, Ships & Assets, Standings, and Kills & Losses.
- **Star map** of New Eden in CCP/Fenris Creations's 2D layout or real 3D positions, with search, routes and *Set destination* (the in-game Autopilot), a hazard overlay (incursions, kills, sovereignty and FW fights), and security, faction or region colouring.
- **Chat** from EVE's chat logs (Local, Corp, Militia), with clickable item and system names.
- **Combat alert:** ATTACK in the top bar and a short red flash when a fight starts, from EVE's game log. The game's autopilot shows on the map too.
- **Top bar:** alerts (skill queue, industry jobs, expiring orders), EVE notifications, mail, Tranquility status, EVE time, and ESI health.
- **Light on ESI:** only what's on screen is polled, at ESI's own cache times, within its rate limits.
- **Update Ready:** a new release on GitHub shows in the top bar, with its release notes (checked once an hour; can be turned off).
- **Private:** the tokens that give access to your character information are only stored on your computer, encrypted. EVE HUD doesn't send or use your data other than to make the app work, and connects only to CCP/Fenris Creations's servers, plus GitHub for the hourly update check. See [Data and privacy](https://danisxlab.github.io/eve-hud/documentation/#data-privacy).
- **EVE on another computer:** works through a shared logs folder.

## Quick start

Download the installer for your system from [Releases](https://github.com/danisxlab/eve-hud/releases/latest).

On the first start click **LOG IN with EVE Online** and log in in your browser. No developer account is needed: EVE HUD logs in through its own EVE application, and the tokens go straight from EVE to your computer ([The EVE HUD application](https://danisxlab.github.io/eve-hud/documentation/#eve-hud-application)).

Prefer your own application from the [EVE developers site](https://developers.eveonline.com)? Choose *Use your own EVE developer client credentials instead* on the login screen: it shows the callback URL and the scopes to enable, each with a *Copy* button. EVE HUD runs on port 4747; another port only works with your own application ([Port 4747 callback](https://danisxlab.github.io/eve-hud/documentation/#port-4747-and-the-login)). Details: [Getting started](https://danisxlab.github.io/eve-hud/documentation/#getting-started).

## Development

You need [Node.js](https://nodejs.org) 20 or later. In the project folder:

```sh
npm install    # Electron and electron-builder (dev dependencies only)
npm run demo   # sample data, no login
npm start      # your own character
```

All commands: [Commands](https://danisxlab.github.io/eve-hud/documentation/#commands).

- `npm test` runs all tests, without Electron, network or login.
- No build step and no frameworks: the page is plain JavaScript modules, the server and app are plain Node.js.
- Formatting: [Prettier](https://prettier.io) (`npx prettier --write .`).
- How the code is laid out: [Development](https://danisxlab.github.io/eve-hud/documentation/#development).

## Build the app yourself

```sh
npm run dist:win       # Windows installer: dist/EVE HUD Setup <version>.exe
npm run dist:win-zip   # Windows, no installer: dist/EVE HUD-<version>-win.zip
npm run dist:mac       # macOS (Apple silicon + Intel): dist/EVE HUD-<version>-universal.dmg
npm run dist:mac-dev   # the same, signed with your own Apple Development certificate
npm run dist:linux     # Linux: dist/EVE HUD-<version>-x86_64.AppImage and dist/eve-hud_<version>_amd64.deb
```

## License

EVE HUD is free software, © 2026 danisxlab, under the **GNU General Public License, version 3 or (at your option) any later version** ([`LICENSE`](LICENSE)). It comes with no warranty or liability.

EVE Online material (portraits, icons, the star map data and all ESI data) is CCP/Fenris Creations's, used under the [EVE Developer License Agreement](https://developers.eveonline.com/license-agreement) and fetched while the app runs; none of it is in this repository. © CCP/Fenris Creations. All rights reserved. "EVE", "EVE Online", "CCP/Fenris Creations", and all related logos and images are trademarks or registered trademarks of CCP/Fenris Creations. **This project is not made, endorsed or supported by CCP/Fenris Creations**.

The font _Saira Semi Condensed_ is under the SIL Open Font License 1.1 ([`hud/public/fonts/OFL.txt`](hud/public/fonts/OFL.txt)).
