# Prime Video Filters & Languages

**Find out what you can actually watch on Prime Video - before you click.**

Prime Video mixes titles included in your subscription with ones you have to rent or buy, and it hides which audio and subtitle languages a title has until you open its page. This Chrome extension puts that information right on the title cards and lets you filter by it.

![A search results page with icons-only badges on the cards and the filter panel open](images/hero.png)

## What you get

### Badges on every card

- **In my subscription** or not: no more clicking a title only to find out it costs extra.
- **Audio** in your language (or not): is there a dub or voice-over?
- **Subtitles** in your language (or not).

![Title cards with the "Included", audio and subtitles badges](images/badges.png)

Works on search results, the home page, Movies, TV, genres, collections, the watchlist and the carousels on title pages. That covers regular cards, the tall posters of the "super carousel" and the rotating banner at the top.

### Filters

A panel in the bottom-right corner hides what you do not want to see: titles outside your subscription, titles without audio and/or without subtitles in your language.

![The filter panel (Polish interface) with two filters on and the cards that do not match hidden](images/filters.png)

Would you rather keep them in sight? The **"grey out instead of hiding"** switch leaves the non-matching titles in place, grey and faded, with their badges still in colour; hover over one to see it normally.

![Search results with the non-matching titles greyed out and their badges still in colour](images/grey-out.png)

When the panel is in the way, the **minus button** in its header collapses it to a small icon in the corner; click the icon to bring the panel back. The filters keep working while it is collapsed. While a video is playing, the panel steps aside on its own.

![The expanded panel with the minus button in its header](images/panel-collapse-button.png) ![The collapsed panel: just the extension's icon in the corner](images/panel-collapsed.png)

### Your language

Pick **EN, PL, DE, ES, FR, IT or CS**. It sets the language looked for in audio and subtitles and the language of the panel and badges. Until you pick one, your browser's language is used if it is on the list, otherwise English.

![The language picker in the panel](images/language-picker.png)

### Icons-only view

Prefer a calmer page? The **"show icons only"** switch turns every badge into a small coloured square: a padlock for the subscription, a speaker for audio, "CC" for subtitles, a bookmark (filled once saved) for watch later and a crossed-out eye for hide. Green means yes, red means no, grey means not known yet.

![A card in the normal view, with the "+ Watch later" button below the badges](images/card-full.png) ![The same card in the icons-only view](images/card-icons.png)

### Details page banner

On a title's own page the same three checks appear as a large banner above the title art.

![The banner above the title art on a detail page](images/detail-banner.png)

### Watch later

A **"+ Watch later"** button below the badges (on cards, posters, the top banner and a title's page; a bookmark in the icons-only view) saves the title to a simple "watch later" list. The list is shown in the panel: click a title to open its page, or "×" to remove it; clicking the button again removes it too.

This feature is simple by design. Prime Video already has its own watchlist; this is just a very quick way to remember a title for a short while. The list is kept locally in your browser, not in your Prime Video account, so it does not show up on another computer or in another browser. Don't need it? Untick **"show the watch later list"** in the panel to hide the list and the buttons; your saved titles stay.

![The panel with two titles on the watch later list and, below it, the hidden titles count with the "Manage" button](images/watch-later-panel.png)

### Hide titles

Seen it, or just not interested? The **"Hide"** button after "watch later" (a crossed-out eye in the icons-only view) hides the title for good: its cards and posters disappear from every Prime Video page. The rotating banner at the top skips it: when its turn comes, the banner moves straight on to the next title (it may flash for a moment, blurred). On the title's own page the large preview is blurred, darkened and shrunk to a low strip with a "Hidden title" label; there the button reads **"Unhide"** (an open eye) and brings the title back.

![A card in the icons-only view; the crossed-out eye at the end hides the title](images/hide-button.png)

![A hidden title's own page: the preview shrunk to a blurred strip with the "Hidden title" label and the open eye that brings it back](images/hidden-detail.png)

The panel shows only how many titles you have hidden. **"Manage"** opens a window with all of them, newest first, and a search field, handy once the list grows to hundreds: click a title to open its page, or "×" to show it again. Like the watch later list, it is kept locally in your browser.

![The window with the hidden titles and its search field](images/hidden-dialog.png)

Your settings (filters, language, grey out, watch later on or off, simplified view, collapsed panel), the watch later list and the hidden titles are remembered.

## Installation

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked** and pick this directory.
4. Open (or reload) a Prime Video page.

![The extensions page with Developer mode on and the extension loaded](images/install.png)

After changing the code, click the reload icon on the extension's card in `chrome://extensions` and reload the Prime Video tab.

## Good to know

- It relies on Prime Video's undocumented page structure, which can change at any time.
- Audio and subtitle lists are what Prime Video's detail data says, cached for up to 14 days.
- Its only permission is `storage`, used for that cache.
