# How it works

The extension is a single content script (`content.js` + `content.css`), with no build step. Its icon (a magnifier with a play triangle) is in `icons/`. Its only permission is `storage`, for the cache.

## Where the checks come from

- **Subscription**: a regular card is an `article[data-testid="card"]` with a `data-card-entitlement` attribute: `Entitled` means "included with Prime", `Unentitled` means rent/buy or a channel trial. No request is needed. Super carousel posters and banner cards do not have this attribute, so their status comes from the detail JSON below (`body.atf.state.action.atf[<title id>].messages.entitlementType`).
- **Audio language**: listing pages do not include audio languages. The script fetches each title's detail page in its JSON form, the same request the Prime Video web app makes when you navigate in-app:

  ```
  GET /detail/<id>?dvWebAppClientVersion=<any>
  accept: application/json
  x-requested-with: WebAppSPA
  ```

  The language list is at `body.atf.state.detail.headerDetail[<title id>].audioTracks`, for example `["Polski", "English", ...]`. A track counts as the chosen language if its name starts with that language's own name (`Polski`, `English`, `Deutsch`, `Español`, `Français`, `Italiano`, `Čeština`, case-insensitive), so variants such as "English [Audio Description]" or "Español (España)" match too. The cache keeps the full list, so changing the language needs no new requests.
- **Subtitles**: they come from the same response, at `headerDetail[<title id>].subtitles` (for example `["Polski", "Dansk", ...]`), so they need no extra request. They are matched the same way as audio tracks. A missing key counts as no subtitles, unless it is missing from every response (see "When Prime Video changes").

## Requests and cache

- Requests are made only for cards that are on the screen or within 200 px of it, at most 3 at a time. When a filter needs a card's data (the audio or subtitles filter, or the "included only" filter for cards whose status is not in the DOM), cards up to one screen height above and below are checked too, with the cards on the screen first. Hidden cards make the next ones move up (except in long grids, where they leave empty slots, and with "grey out instead of hiding" on, where they stay in place), so they are checked in turn. Titles that scroll away or leave the page before their request starts are dropped from the queue.
- **Cache**: each title is fetched at most once every 14 days. The result (audio list, subtitle list, subscription status, time) is kept in the extension's storage (`chrome.storage.local`, keys `audio:<detail id>`), shared by all Prime Video tabs. Expired entries, and entries saved before subtitles were added, are deleted when a page loads. Removing the extension clears the cache.

## What is added to the page

- Everything the extension adds carries its icon, so it is clear what is not Prime Video's own: the panel has the icon and the name in its header and a blue border, and the badges (including the large ones on a title's page) sit in a dark frame with the icon on the left, separated from them by a thin line. The icon is embedded in `content.css` as a data URI, so the extension needs no `web_accessible_resources`.
- **Filters**: while a filter is on, a card that is not checked yet is dimmed until it is either hidden or shown normally. In long grids that Prime Video loads in parts (such as "Więcej do odkrycia" in search), a hidden card leaves an empty slot instead of the next cards moving up, otherwise the grid would scroll into an empty screen. The banner at the top is never hidden, and a carousel whose cards are all hidden stays on the page, empty.
- **Grey out instead of hiding**: with this setting on, a card that fails a filter is not hidden but stays in place, grey and faded (unlike a card not checked yet, which keeps its colours), while its badges keep their colours; hovering over it shows it normally. The panel's "hidden" count includes these cards.
- **Language picker**: it sets both the language looked for in audio and subtitles and the language of the panel and badges. Until the user picks one, the browser's language is used if it is on the list, otherwise English.
- **Simplified view**: every badge becomes a small coloured square with an icon only: a padlock for the subscription (open when included, closed when not), a speaker for audio, "CC" for subtitles. Green means yes, red means no, grey means not known yet.
- **While a video plays**, the panel is hidden (the player opens on top of the page, whose cards stay in the DOM), and it comes back when the player is closed.
- **Collapsing the panel**: the minus button in the panel header shrinks the panel to a small square with the extension's icon; a click on the icon expands it again. The filters keep working while the panel is collapsed, but its hidden count and its warning are not visible.
- The filter, language, grey out, simplified view and collapsed panel settings are remembered.

## When Prime Video changes

The extension counts what its detail requests return in the current tab and, when the numbers look wrong, shows a red warning at the top of the panel (and logs the problem once to the console, with the counters). Each rule waits for a minimum number of responses, because a few failures are normal:

- **Requests failing**: more than half of at least 6 requests failed (HTTP error, response not JSON, offline). The warning says Prime Video is unreachable or has changed.
- **`audioTracks`**: more than half of at least 6 valid responses had no audio tracks list.
- **`entitlementType`**: none of at least 10 responses had the subscription status.
- **`subtitles`**: none of at least 10 responses had a subtitles list. A title without subtitles is rare, so a long run of them means the key moved. While this is flagged, the subtitles badge shows "?" instead of "no subtitles" and the subtitles filter hides nothing.

The data warning names the JSON fields that were not found, for example `subtitles`. The warning is shown where the panel is shown, so a changed card markup (selectors that no longer match) is not reported: the panel is simply not there. The counters cover only this tab's requests, not results taken over from other tabs or the cache.

## Limitations

- It relies on Prime Video's undocumented page structure and data, which can change at any time.
- Matching is by name prefix, so an "English [Audio Description]" track alone would count as English audio. If a language is ever not detected, check its name in `audioTracks` and fix its pattern in `TRACK_LANGUAGES`.
- Hiding cards inside a horizontal carousel can leave the carousel's scroll arrows slightly off.
- In long grids such as "Więcej do odkrycia", hidden cards leave empty slots, so with a strict filter you scroll past gaps.
- With a filter on, the "hidden" count in the panel covers only the cards checked so far (those that have been near the screen), not the whole page.
- The audio and subtitle lists come from the title's detail page. For a series, that is the season the card links to, and other seasons may differ.
- The audio and subtitle lists are what Prime Video's detail data says. They can list a track that the player does not offer when you press play (seen once on a title that was about to leave Prime); the extension cannot detect that.
- Cached results can be up to 14 days old: a dub in your language added in the meantime, or a title that left Prime, shows up only after that. For regular cards, the subscription status is always read live from the page.
