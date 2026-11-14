# Decisions

## Agreed with the user (2026-11-14)

- **Form**: a Chrome extension. A Tampermonkey userscript and a console snippet were the other options.
- **Behaviour**: badges on every search result card **plus** filters to hide titles. Badges alone was the other option.
- **Scope**: originally the search page only. Extended later the same day to every page with title cards, with badges and filters: home (`/storefront`), `/movie`, `/tv`, `/genre/...`, `/collection/...`, the watchlist and detail page carousels, including the super carousel posters and the top banner.
- **Location**: a separate project in `/home/andrzej/projekty/AmazonPrimeBetterSearch`.
- **Cache**: each title is requested at most once per 14 days. The cache lives in `chrome.storage.local`, which needs the `storage` permission. Plain `localStorage` without expiry was the other option. Refreshing on a 14-day TTL was the user's choice over a "clear cache" button or never refreshing.
- **Title page banner**: on `/detail/<id>` a large banner at the top shows the same three checks (subscription, audio, subtitles in the chosen language), read from the same cached detail data as the card badges.
- **Empty carousels**: when the filters hide every card of a carousel, the carousel (its title) stays on the page. Hiding the whole row was the other option.

## Implementation choices

- **Plain JavaScript, no build step.** The extension is one content script and one stylesheet, so it can be loaded unpacked straight from the directory. If the code grows, moving to TypeScript with a bundler is an option. That would be a user decision.
- **Only the `storage` permission.** The detail requests are same-origin from the content script, so no `host_permissions` or background worker are needed. `storage` does not show a warning when the extension is installed.
- **Subscription status from the DOM** (`data-card-entitlement`) rather than from the hydration JSON. It is simpler and also covers cards loaded later by scrolling. Cards without the attribute (super carousel posters, top banner, the odd regular card) take it from the detail JSON instead, so it is cached with the audio list and can be up to 14 days old.
- **Audio language from the lightweight detail JSON** (about 200 KB) instead of the HTML page (about 600 KB). See [ANALYSIS.md](ANALYSIS.md), steps 5 to 7.
- **Polish subtitles as a separate badge and filter** (agreed with the user), not merged with audio into one three-state badge. The data is the `subtitles` array in the same detail JSON, so it costs no extra request. Cache entries without `subtitles` count as expired.
- **Lazy checking.** Only cards near the viewport are checked (`IntersectionObserver`, 200 px margin), with at most 3 requests at once. When the audio or subtitles filter is on, all cards are queued: otherwise off-screen titles without the chosen language would never get hidden.
- **Cache** in `chrome.storage.local`: keys `audio:<detail id>` with `{tracks, subtitles, entitled, time}`, valid for 14 days. The whole cache is read into memory when a page loads, and expired entries are deleted then. A `chrome.storage.onChanged` listener shares results between open Prime Video tabs. Failed checks are not cached and show "<code> audio ?" and a "?" on the subtitles badge. They are not retried until the page is reloaded.
- **Filters** are stored in the page's `localStorage` under `apbs:filters` (an old `polish` key is read as `audio`).
- **Language choice** (agreed with the user): one language for both audio and subtitles, from a fixed list of seven (PL, EN, DE, ES, FR, IT, CS). It is not a free choice because each language needs a checked track-name pattern. The cache already holds every track name, so switching language costs no requests. Stored in `localStorage` under `apbs:settings`.
- **One language setting** (agreed with the user) for both the language to look for and the language of the panel and badges; a picker at the top of the panel. It defaults to the browser's language (`navigator.language`) when supported, otherwise Polish. A saved choice always wins.
- **Titles that are not checked yet stay visible** when a filter is on. They are hidden only once known to lack the chosen audio or subtitles language, or to be outside the subscription.
- **UI texts** are in a `TEXTS` dictionary in `content.js` (agreed with the user), not in `chrome.i18n`: the content script could then only follow the browser's language, not the panel's picker, and it would add `_locales` files and a manifest entry.
- **Re-rendering**: a `MutationObserver` on `document.body` re-applies badges and filter classes, batched with `requestAnimationFrame`. DOM writes happen only when something changed, so the observer settles.
- **Hiding in carousels**: a carousel card sits alone in an `<li>`, so the `<li>` is hidden instead of the card, otherwise an empty slot would remain. Grid cards are hidden directly.
- **The top banner is never hidden.** Its cards are stacked and faded in turn, and removing one would likely break the rotation. It only gets badges, placed below the title's text.
- **Branding** (agreed with the user): the extension's icon is shown in the panel header (with the name) and once per badge group: the badges sit in a dark frame with the icon on the left and a thin separator line between them (design from the user), so everything added to the page is clearly not Prime Video's own. The icon is a data URI in `content.css` (`--apbs-icon`), which avoids `web_accessible_resources`; if `icons/icon48.png` changes, regenerate the URI.
- **The panel** is shown on every page that has title cards, and hidden elsewhere.

## Open questions / next steps

- The extension has not been fully tested in Chrome yet.
- Should failed checks be retried automatically?
- Is the badge position (top-left of the image) and look right?
