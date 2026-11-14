# Prime Video Better Search

A Chrome extension that improves browsing Prime Video (`www.primevideo.com`). On every title card it shows:

- **W pakiecie / Poza pakietem**: whether the title is included in your subscription,
- **PL audio / No PL audio**: whether the title has an audio track in the chosen language (Polish by default),
- **PL subtitles / No PL subtitles**: whether the title has subtitles in the chosen language.

The texts above are examples: the badge and panel texts exist in Polish, English, German, Spanish, French, Italian and Czech.

It works on every page with title cards: search results, the home page (`/storefront`), Movies (`/movie`), TV (`/tv`), genres (`/genre/...`), collections (`/collection/...`), the watchlist and the carousels on title detail pages. That covers regular cards, the tall posters of the "super carousel" and the rotating banner at the top of the page.

On a title's own page (`/detail/<id>`) the same three checks are also shown as a large banner at the top of the page, above the title art.

A panel in the bottom-right corner can hide titles outside your subscription, titles without audio and/or without subtitles in the chosen language. While a filter is on, a card that is not checked yet is dimmed until it is either hidden or shown normally. In long grids that Prime Video loads in parts (such as "Więcej do odkrycia" in search), a hidden card leaves an empty slot instead of the next cards moving up, otherwise the grid would scroll into an empty screen. The banner at the top is never hidden, and a carousel whose cards are all hidden stays on the page, empty.

Everything the extension adds to the page carries its icon, so it is clear what is not Prime Video's own: the panel has the icon and the name "Prime Video Better Search" in its header and a blue border, and the badges (including the large ones on a title's page) sit in a dark frame with the icon on the left, separated from them by a thin line. The icon is embedded in `content.css` as a data URI, so the extension needs no `web_accessible_resources`.

Below the header, the panel has a **language picker** (PL, EN, DE, ES, FR, IT or CS). It sets both the language looked for in audio and subtitles and the language of the panel and badges. Until you pick one, the browser's language is used if it is on the list, otherwise Polish. The filter and language settings are remembered.

## Installation

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked** and pick this directory. From Windows Chrome with the project in WSL, the path is
   `\\wsl.localhost\Ubuntu-24.04\home\andrzej\projekty\AmazonPrimeBetterSearch`.
4. Open (or reload) a Prime Video page.

After changing the code, click the reload icon on the extension's card in `chrome://extensions` and reload the Prime Video tab.

## How it works

The extension is a single content script (`content.js` + `content.css`), with no build step. Its icon (a magnifier with a play triangle) is in `icons/`. Its only permission is `storage`, for the cache.

- **Subscription**: a regular card is an `article[data-testid="card"]` with a `data-card-entitlement` attribute: `Entitled` means "included with Prime", `Unentitled` means rent/buy or a channel trial. No request is needed. Super carousel posters and banner cards do not have this attribute, so their status comes from the detail JSON below (`body.atf.state.action.atf[<title id>].messages.entitlementType`).
- **Audio language**: listing pages do not include audio languages. The script fetches each title's detail page in its JSON form, the same request the Prime Video web app makes when you navigate in-app:

  ```
  GET /detail/<id>?dvWebAppClientVersion=<any>
  accept: application/json
  x-requested-with: WebAppSPA
  ```

  The language list is at `body.atf.state.detail.headerDetail[<title id>].audioTracks`, for example `["Polski", "English", ...]`. A track counts as the chosen language if its name starts with that language's own name (`Polski`, `English`, `Deutsch`, `Español`, `Français`, `Italiano`, `Čeština`, case-insensitive), so variants such as "English [Audio Description]" or "Español (España)" match too. The cache keeps the full list, so changing the language needs no new requests.
- **Subtitles**: they come from the same response, at `headerDetail[<title id>].subtitles` (for example `["Polski", "Dansk", ...]`), so they need no extra request. They are matched the same way as audio tracks. A missing key counts as no subtitles.
- Requests are made only for cards that are on the screen or within 200 px of it, at most 3 at a time. When a filter needs a card's data (the audio or subtitles filter, or the "included only" filter for cards whose status is not in the DOM), cards up to one screen height above and below are checked too, with the cards on the screen first. Hidden cards make the next ones move up (except in long grids, where they leave empty slots), so they are checked in turn. Titles that scroll away or leave the page before their request starts are dropped from the queue.
- **Cache**: each title is fetched at most once every 14 days. The result (audio list, subtitle list, subscription status, time) is kept in the extension's storage (`chrome.storage.local`, keys `audio:<detail id>`), shared by all Prime Video tabs. Expired entries, and entries saved before subtitles were added, are deleted when a page loads. Removing the extension clears the cache.

## Documentation

- [docs/ANALYSIS.md](docs/ANALYSIS.md) - how the Prime Video pages were analysed
- [docs/PRIME_VIDEO_DATA.md](docs/PRIME_VIDEO_DATA.md) - the page structure and data the extension relies on
- [docs/DECISIONS.md](docs/DECISIONS.md) - design decisions and open questions

## Limitations

- It relies on Prime Video's undocumented page structure and data, which can change at any time.
- Matching is by name prefix, so an "English [Audio Description]" track alone would count as English audio. If a language is ever not detected, check its name in `audioTracks` and fix its pattern in `TRACK_LANGUAGES`.
- Hiding cards inside a horizontal carousel can leave the carousel's scroll arrows slightly off.
- In long grids such as "Więcej do odkrycia", hidden cards leave empty slots, so with a strict filter you scroll past gaps.
- With a filter on, the "hidden" count in the panel covers only the cards checked so far (those that have been near the screen), not the whole page.
- The audio and subtitle lists come from the title's detail page. For a series, that is the season the card links to, and other seasons may differ.
- The audio and subtitle lists are what Prime Video's detail data says. They can list a track that the player does not offer when you press play (seen once on a title that was about to leave Prime); the extension cannot detect that.
- Cached results can be up to 14 days old: a dub in your language added in the meantime, or a title that left Prime, shows up only after that. For regular cards, the subscription status is always read live from the page.
