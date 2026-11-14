# Prime Video page structure and data

Reference of what the extension reads from `www.primevideo.com`, as observed on 2026-11-14 (logged in, Polish UI, PL region). How this was found is in [ANALYSIS.md](ANALYSIS.md). None of it is a public API, so verify against the live site when something breaks.

## Identifiers

- **Detail id**: the path segment in `/detail/<id>`, e.g. `0MNNJQM8AWU2MYTWXF9D000KEA`. Card links add `?ref_=...` (and on other pages `jic=...`), which can be dropped. The extension uses this id as its cache key.
- **GTI**: catalog id, e.g. `amzn1.dv.gti.7eb4772c-f9ea-c84f-8726-caebc4377742`. It is used as the key inside the detail JSON and as `titleID` in search entities.

## Search page DOM (`/search?phrase=...`)

Each result card:

```html
<article data-testid="card" role="listitem"
         data-card-title="Rambo: First Blood"
         data-card-entity-type="Movie"            <!-- or "TV Show" -->
         data-card-entitlement="Entitled"         <!-- or "Unentitled" -->
         data-card-position="0" ...>
  <section data-testid="card-section">
    <div data-testid="packshot">                  <!-- position: relative; overflow: hidden -->
      <button aria-label="Rambo: First Blood"></button>
      <a href="/detail/0ME5SP2M6G7RTZC6TFMCNL2X9U?ref_=...">Rambo: First Blood</a>
      <div><picture>...</picture></div>
    </div>
    ...
```

- Cards sit in lists under `[data-testid="grid-mini-details-controller"]` (grids, the card is a direct child of the `<ul>`) or `[data-testid="card-container-list"]` (carousels, each card alone in an `<li>`).
- Grids are virtualized. The structure is:

  ```html
  <div data-testid="grid-container">
    <span>...<span data-testid="carousel-title">Więcej do odkrycia</span>...</span>
    <div style="height: 15116.7px;"></div>       <!-- spacer for the rows above the window -->
    <div data-testid="grid-mini-details-controller"><ul>...about 70 cards...</ul></div>
    <div style="height: 1566.7px;"></div>        <!-- spacer for the rows below the window -->
    <div data-testid="page-pagination-marker"></div>   <!-- while more pages can be loaded -->
  </div>
  ```

  Only a window of about 70 cards (about 12 rows of 6) is in the DOM; the spacers' heights assume every row is full. Cards carry `data-card-position` (their index in the whole grid). A short grid such as "Najlepsze wyniki" has the same structure with both spacers at `height: 0`. The pagination marker can disappear while scrolling, before the end of the list, so it alone does not identify a long grid.
- CSS class names are hashed (e.g. `ulDoOY`) and change between builds, so use the `data-*` attributes only.
- `Entitled` = "W pakiecie z Prime". `Unentitled` covers "Wypożycz lub kup", "Wypróbuj bezpłatnie, wypożycz lub kup" and "Bezpłatny okres próbny" (channel subscriptions).
- The page is a single-page app: results load lazily and cards may be re-rendered, which can remove injected nodes.

## Other pages with cards

Checked on 2026-11-14 on `/storefront`, `/movie`, `/tv`, `/genre/action`, `/collection/newandupcoming`, `/mystuff/watchlist` and a detail page:

| Page | regular cards | super carousel cards | top banner cards |
|---|---|---|---|
| `/storefront` | 64 | 13 | 5 |
| `/movie`, `/tv` | 65 | 13 | 5 |
| `/genre/action` | 91 | 0 | 0 |
| `/collection/newandupcoming` | 52 | 23 | 5 |
| `/mystuff/watchlist` | 3 (grid) | 0 | 0 |
| `/detail/...` (carousels below the title) | 14 | 1 | 0 |

Counts are for the initial load. More rows load while scrolling.

### Regular cards

Identical to the search page cards above: `data-card-entitlement`, a `/detail/` link and a `packshot`. Very few lack `data-card-entitlement` (1 of 52 on the collection page). Prime Video's own labels (`[data-testid="metadata-badge"]`, e.g. "NOWY FILM", "WKRÓTCE ZNIKNIE") sit in the **top-right** corner of the packshot.

On hover a card expands in place: the details panel (`[data-testid="standard-mini-details"]`, with the play, watchlist and hide buttons) is rendered **inside** the `<article>`. When the pointer enters and leaves, React rewrites the article's whole `class` attribute, dropping any class added to it; added `data-*` attributes survive.

### Super carousel card

Tall posters, each alone in an `<li>` of a `card-container-list`:

```html
<article data-testid="super-carousel-card">          <!-- position: relative -->
  <button data-testid="poster-focus-button"></button>
  <div data-testid="expanded-background-art">
    <div><picture>...</picture></div>
    <a data-testid="poster-link" href="/detail/<id>?jic=...&ref_=...">   <!-- position: relative -->
      <div><div><picture>...</picture>
        <span data-testid="status-badge">NOWY SERIAL</span>   <!-- top-right corner -->
```

No `data-card-*` attributes, so the subscription status is not in the DOM.

### Top banner card

The rotating banner at the top. All its cards are in the DOM at once, absolutely positioned on top of each other:

```html
<article data-testid="top-hero-card">                <!-- position: absolute -->
  ...<a data-testid="image-link" href="/detail/<id>?...">...</a>
  <div data-testid="title-metadata-main">            <!-- title art, synopsis, buttons -->
    <h2 data-testid="title-art"><a href="/detail/<id>?...">...</a></h2>
    <div data-testid="hero-synopsis">...</div>
    <div data-testid="action-box">
      <a data-testid="play" href="/detail/<another id>?autoplay=1...">   <!-- a different id! -->
      ...
    <div>
      <span data-testid="entitlement-icon"><svg><title>Entitled</title>...</svg></span>
      <span data-testid="entitlement-message">W pakiecie z Prime</span>
```

Use `image-link` for the detail id: the play button can link to a different id.

## Video player

The player opens on top of the page it was started from (the URL does not change), so the cards of that page stay in the DOM behind it. It lives in `div#dv-web-player`, which is always in the page:

```html
<div id="dv-web-player" class="dv-player-fullscreen">   <!-- open: position: fixed, z-index 9999, whole window -->
<div id="dv-web-player" class="">                       <!-- closed: display: none -->
```

The extension hides its panel while `#dv-web-player.dv-player-fullscreen` exists (a CSS `:has()` rule in `content.css`).

## Hydration data (`script#dv-web-page-hydration-data`)

Every page has `<script type="application/json" id="dv-web-page-hydration-data">` with the initial state.

### Search page

`init.preparations.body.containers[]`. The containers observed for "Rambo":

| containerType | title | entities | estimatedTotal | notes |
|---|---|---|---|---|
| Grid | Najlepsze wyniki | 10 | 0 | |
| StandardCarousel | Podobne do: ... | 38 | 99 | |
| Grid | Więcej do odkrycia | 30 | 357 | has `paginationServiceToken`, `paginationStartIndex`, `paginationTargetId` |

Entity keys include `titleID` (GTI), `displayTitle`, `title`, `link`, `entityType`, `entitlementCues`, `releaseYear`, `runtime`, `synopsis`. `entitlementCues.entitlementType` is `Entitled` / `Unentitled`, and `entitlementCues.focusMessage.message` holds the localized text. **There is no `audioTracks` on the search page.**

### Detail page

The main title's object has `audioTracks`, `entitlementCues`, `isPrime`, `isUhd`, `isDolby51`, `isDolbyAtmos`, `isHdr`, `isXRay`, `releaseYear`, `runtime`, `ratingBadge`, `contributors`, and more. The page also contains `entitlementCues` for every title in its recommendation carousels, so do not just grab the first match in the raw text.

## Detail JSON request (used by the extension)

```
GET /detail/<id>?dvWebAppClientVersion=<any non-empty value>
accept: application/json
x-requested-with: WebAppSPA
```

- Same origin as the page, so the session cookies are sent automatically.
- Response: `application/json`, about 200 KB, about 0.5 to 1 s. The full HTML page is about 600 KB and about 1.5 s.
- Without `dvWebAppClientVersion` the response is a 58-byte stub with no data. Any value works (the web app sends e.g. `1.0.136034.0`).
- Top-level keys: `head`, `body`, `globalStore`, `config`.
- Audio tracks: `body.atf.state.detail.headerDetail[<gti>].audioTracks`. `headerDetail` has a single key. The same array is also at `body.btf.state.detail.detail[<gti>]` and `body.btf.state.detail.btfMoreDetails[<gti>]`.
- The entitlement of the title: `body.atf.state.action.atf[<gti>].messages.entitlementType` (`Entitled` / `Unentitled`), with the localized text in `messages.focusMessage.dvMessage.string` (e.g. "W pakiecie z Prime", "Bezpłatny okres próbny", "Dostępne do wypożyczenia lub zakupu"). `<gti>` is the same key as in `headerDetail` (also `body.atf.state.pageTitleId`). `headerDetail[<gti>]` itself has no `entitlementCues`, only `isPrime`, which is not the same thing.

### `audioTracks` format

An array of display names in the language's own name, which may contain duplicates and variants:

- Rambo: First Blood Part II: `["English", "English Dialogue Boost: Medium", "English Dialogue Boost: High", "Italiano", "日本語"]`
- Rambo: First Blood: `["Polski", "English", "English Dialogue Boost: Medium", "English Dialogue Boost: High", "Italiano", "日本語"]`
- Reacher (series): 24 entries, including `"Polski"`, `"English"` (twice), `"English [Audio Description]"`, `"Español (España)"`, `"Français (Canada)"`.

The extension treats a track as the chosen language when its name starts with that language's own name (`English` by default; also `Polski`, `Deutsch`, `Español`, `Français`, `Italiano`, `Čeština`, case-insensitive). All seven names were verified on the live site (25 titles from the home page); other variants seen: `English [Audio Description]`, `English Dialogue Boost: <level>`, `Español (España)`, `Français (Canada)`, and subtitle names such as `English [CC]`, `Polski [CC]`, `Deutsch [UT]`.

### `subtitles` format

Next to `audioTracks`, `headerDetail[<gti>]` has `subtitles` (an array of names, e.g. Rambo: First Blood: `["Polski", "Dansk", "Italiano", "Norsk Nynorsk", "Suomi", "Svenska", "日本語"]`), `enhancedSubtitles` (the same as `[{text: "Polski"}, ...]`) and `isClosedCaption`. The same data is also in `body.btf.state.detail.detail[<gti>]` and `btfMoreDetails[<gti>]`. The extension reads `subtitles` and matches the names the same way as audio tracks. Not yet checked: series, and whether a title without subtitles has an empty array or no key (the extension treats both as no subtitles). If no response in a session has the key, the extension warns that `subtitles` moved (see HOW_IT_WORKS.md).
