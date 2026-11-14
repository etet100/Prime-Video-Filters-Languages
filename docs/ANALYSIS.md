# How the Prime Video pages were analysed

This is a record of the investigation (2026-11-14) that the extension is based on. The resulting data reference is in [PRIME_VIDEO_DATA.md](PRIME_VIDEO_DATA.md).

## Goal

The user wanted the Prime Video search to show, for every result:

1. whether the title is included in their subscription,
2. whether the title has Polish audio.

To do that, we first had to find where Prime Video stores both pieces of information.

## Tools and setup

- **Browser MCP** drove the user's own Chrome (Windows), logged in to Prime Video with the UI in Polish (`lc-main-av=pl_PL`, region PL).
- Most of the probing was done with `eval`, which runs a JavaScript function in the page and returns its result as JSON. Network traffic was inspected with `requests --filter` and `request <id>`.
- Test titles: "Rambo: First Blood Part II" (`/detail/0MNNJQM8AWU2MYTWXF9D000KEA`, no Polish audio), "Rambo: First Blood" (`/detail/0ME5SP2M6G7RTZC6TFMCNL2X9U`, has Polish audio), the series "Reacher" (`/detail/0K16R3PLUFGC2JUE457C26O4OD`, has Polish audio), and the search for `Rambo` (`/search?phrase=Rambo`).

## Steps

### 1. Login check

On the detail page there was no "Zaloguj się" link. The nav had "Profil, ustawienia i konto" and "Moje materiały", and the title showed a "Wznów" (resume) button. So the session was logged in, and every later finding reflects a logged-in user.

### 2. Audio languages in the visible UI

The detail page's **"Szczegóły"** tab has a **"Języki dźwięku"** section (plus "Napisy" for subtitles). Reading `main`'s text showed the list for Rambo II: `English, English Dialogue Boost: Medium, English Dialogue Boost: High, Italiano, 日本語`. Language names are written in their own language.

### 3. Where the detail page stores the data

Searching the page HTML (`document.documentElement.outerHTML`, about 866 KB) for keywords found:

- `"audioTracks":["English",...]` inside a JSON blob,
- the rendered "Języki dźwięku" markup (hashed class names, so not usable as selectors),
- the entitlement message `W pakiecie z Prime` in `[data-testid="entitlement-message"]`,
- flags such as `"isPrime":true`, `"isUhd":true`, `"isDolby51":true`.

The JSON blob is `<script type="application/json" id="dv-web-page-hydration-data">` (about 208 KB). It also contains `"entitlementCues":{"entitlementType":"Entitled","focusMessage":{"message":"W pakiecie z Prime",...}}`. Note that the page contains several `entitlementCues`: one for the main title, the rest for the titles in the recommendation carousels.

### 4. What the search page contains

On `/search?phrase=Rambo`, the same hydration script exists (about 412 KB). Parsing it and walking the tree for objects with `entitlementCues` showed:

- Results are grouped in `init.preparations.body.containers` (details in PRIME_VIDEO_DATA.md).
- Every result entity has `entitlementCues.entitlementType` (`Entitled` / `Unentitled`) and a message. The counts for "Rambo" were: 55 × Entitled "W pakiecie z Prime", 14 × Unentitled "Wypożycz lub kup", 6 × Unentitled "Wypróbuj bezpłatnie, wypożycz lub kup", 3 × Unentitled "Bezpłatny okres próbny". 3 container-level objects had no type.
- **`audioTracks` occurs 0 times**, so the search page has no audio data.

So the subscription status is free, but Polish audio needs one extra request per title.

### 5. Fetching a detail page from the search page

`fetch('/detail/<id>')` from the search page (same origin, session cookies sent automatically) returned the full HTML page: status 200, about 605 KB, about 1.5 s. Its hydration script contained `audioTracks` (for Rambo I: `["Polski","English",...]`). This works, but it is heavy.

### 6. Finding a lighter request

We clicked a search result and listed the network requests (`requests --filter detail`). The in-app navigation made this request:

```
GET /detail/0MNNJQM8AWU2MYTWXF9D000KEA?ref_=...&dvWebAppClientVersion=1.0.136034.0
accept: application/json
x-requested-with: WebAppSPA
```

Its response is `application/json`. Repeating it with `fetch` for Rambo I gave about 208 KB in about 0.5 to 1 s, with top-level keys `head, body, globalStore, config`. Walking the JSON for `audioTracks` found it in three places, all identical:

- `body.atf.state.detail.headerDetail[<gti>]` (the one the extension uses),
- `body.btf.state.detail.detail[<gti>]`,
- `body.btf.state.detail.btfMoreDetails[<gti>]`.

`<gti>` is the catalog id, for example `amzn1.dv.gti.7a403381-8cc6-4155-a589-f01fab5245f2`. `headerDetail` had exactly one key.

### 7. The `dvWebAppClientVersion` parameter

- Without the parameter, the JSON response was only 58 bytes and had no data.
- The version string `1.0.136034.0` could not be found in the page HTML, script URLs or globals. It is probably compiled into the JS bundle.
- Values `1.0.0.0`, `1.0.100000.0` and even `x` all returned the full data (about 208 KB). **The parameter must be present, but its value is not checked.** The extension sends `dvWebAppClientVersion=1`.

### 8. Search result cards in the DOM

The result grid is rendered as `article[data-testid="card"]` elements. The useful part is that each card has `data-card-entitlement="Entitled|Unentitled"`, `data-card-entity-type="Movie|TV Show"` and `data-card-title`. So the subscription status can be read straight from the DOM. That also works for cards added later by infinite scroll, without parsing JSON. For "Rambo": 83 cards, 51 Entitled, 32 Unentitled, 81 Movie, 2 TV Show.

The image container `[data-testid="packshot"]` is `position: relative; overflow: hidden`, so absolutely positioned badges can be pinned inside it.

### 9. Series

For the TV Show card "Reacher", the JSON request gave a `headerDetail` with one entry and 24 `audioTracks`, including `Polski`, `English [Audio Description]` and duplicates such as `English` twice. The same lookup works for series. The data is for the season the card links to.

### 10. Other pages (later the same day)

The user asked whether the badges could also appear on `/storefront`. The probes, all with `eval`:

- Counting `article[data-testid="card"]` and their `data-card-entitlement`, `/detail/` links and packshots on `/storefront`, `/movie`, `/tv`, `/genre/action`, `/collection/newandupcoming`, `/mystuff/watchlist` and a detail page. Regular cards are the same as on the search page everywhere (counts in PRIME_VIDEO_DATA.md).
- Counting all `data-testid` values on `/storefront` showed two more card types: `top-hero-card` (the banner) and `super-carousel-card`. A tree dump of one of each (tag, `data-testid`, `href`, computed `position`, leaf text) gave the structures in PRIME_VIDEO_DATA.md.
- Neither of the two has `data-card-entitlement`. Fetching the detail JSON for a super carousel title showed that `headerDetail[<gti>]` has **no** `entitlementCues` (the first analysis assumed it did). Searching the JSON text for `entitlementType` found it in `body.atf.state.action.atf[<gti>].messages`. This was confirmed on one Entitled and two Unentitled titles (a channel trial and a rent/buy title).
- The parent of each card: in carousels an `<li>` holding just the card, in the search grid the `<ul>` directly. This decides what the filters hide.
- The bounding boxes of Prime Video's own labels (`metadata-badge`, `status-badge`) relative to the poster: all in the top-right corner, so the extension's top-left badges do not overlap them.

## Virtualized grids (2026-11-14)

The user reported that with a filter on, the "Więcej do odkrycia" grid on the search page flashed its cards and then showed nothing, while without the filter the matching titles were there. The probes, all with `eval` on `/search?phrase=komedia` and `/search?phrase=Rambo`:

- Logging every second the number of cards in the grid, how many were hidden or dimmed, and `document.documentElement.scrollHeight` while scrolling to the bottom: the card count stayed at about 70 while the page grew from about 4,500 to 18,000 px. So the grid keeps only a window of cards in the DOM.
- Listing the children of `[data-testid="grid-container"]` with their inline styles: a title, a spacer `<div style="height: ...">`, the `grid-mini-details-controller`, a second spacer and `page-pagination-marker` (structure in PRIME_VIDEO_DATA.md).
- At card position ~510 with the audio filter on, 30 of the 70 cards were hidden: the rendered window shrank to a few rows, and the screen below it was empty down to the footer. The spacers still assumed full rows. Hiding cards with `display: none` cannot work with this.
- Logging the marker while scrolling to the end of the Rambo grid (357 titles): it disappeared after a few loads, well before the end, while one spacer always stayed above 0.

## Noise seen during the analysis

- Chrome's console showed many `net::ERR_ADDRESS_INVALID` errors and one HTTP 413. They come from the page's own third-party/telemetry requests (likely blocked by the user's setup) and are unrelated to the extension.
- Request headers shown by `request <id>` include the user's session cookies. They must never be copied into files or commits.

## Not verified yet

- The extension itself has not been loaded and run in Chrome yet. Only the individual data probes above were run, by hand.
- Whether language names change when the Prime Video UI language is not Polish. They looked like native names ("Polski", "Italiano", "日本語"), which suggests they do not.
- How Prime Video reacts to many detail requests in a row (rate limiting).
- Exactly which requests the "Więcej do odkrycia" grid uses to load further pages (it has pagination tokens). The extension does not depend on them: it just watches the DOM. How the grid is rendered is known: see "Virtualized grids" below.
