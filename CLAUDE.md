# Prime Video Filters & Languages - Project Guide

## Rules for This Project

- **Chat with the user in Polish**; write all documentation, code comments and commit messages in English
- Keep it simple and clear
- Never do more than asked
- Asking is always better than assuming: if anything is unclear or ambiguous, ask before proceeding, unless the matter is truly trivial
- Always use braces `{}` for control statements (if/for/while/etc.), even for single-line bodies
- In user-facing texts (badges, panel), use a plain " - " instead of an em dash "—"
- Update all documentation affected by a change in the same change: `README.md`, `CLAUDE.md`, `docs/*` and code comments. A comment that says something is "not done yet" is wrong as soon as it is done, so search for the claim and fix every copy
- Never write session cookies, tokens or other account data seen in request headers into files, docs or commits
- `README.md` is for ordinary users (what the extension does, screenshots, installation). Keep developer-only material out of it (release process, CI, build, internals) and put it in `docs/` instead

## Quick Reference

**What it is**: a Chrome extension (Manifest V3) that adds "in my subscription" and "has audio" and "has subtitles" badges (language chosen from PL, EN, DE, ES, FR, IT, CS) plus filters (hiding or greying out non-matching titles) and an icons-only simplified view to the title cards on Prime Video pages (search, home, movies, TV, genres, collections, watchlist, detail page carousels).
**Tech**: plain JavaScript content script, no build step, only the `storage` permission (cache in `chrome.storage.local`). Loaded via "Load unpacked" in `chrome://extensions`.
**Files**: `manifest.json`, `content.js` (all logic), `content.css` (badges + panel), `icons/` (extension icon, PNG 16/48/128: a magnifier with a play triangle), `.github/workflows/release.yml` (on a `v*` tag push: checks the tag against the manifest version, zips the extension files, creates a GitHub Release). A new file the extension needs at runtime must also be added to the `zip` command in that workflow. `images/` holds the screenshots used by `README.md`; it is not part of the extension and is not zipped.

## Documentation

- [README.md](README.md) - marketing-style overview (features, screenshots), installation
- [docs/HOW_IT_WORKS.md](docs/HOW_IT_WORKS.md) - where the data comes from, requests, cache, on-page behaviour, limitations
- [docs/ANALYSIS.md](docs/ANALYSIS.md) - how the Prime Video pages were analysed (steps, tools, measurements)
- [docs/PRIME_VIDEO_DATA.md](docs/PRIME_VIDEO_DATA.md) - reference of the page structure and data the extension relies on
- [docs/DECISIONS.md](docs/DECISIONS.md) - decisions agreed with the user, and open questions
- [docs/RELEASING.md](docs/RELEASING.md) - how to publish a release (version tag, GitHub Actions workflow)

## Working with the live site

The analysis was done with Browser MCP (`mcp__browsermcp__browser`) driving the user's own Chrome, which is logged in to Prime Video (Polish UI, PL region). Useful commands: `eval` (run JS in the page), `requests --filter <text>` and `request <id>` (inspect network traffic), `get text main --max all`. See [docs/ANALYSIS.md](docs/ANALYSIS.md) for the exact probes.

Prime Video's markup and data are undocumented and can change. Before debugging the extension's logic, check that the selectors and JSON paths in [docs/PRIME_VIDEO_DATA.md](docs/PRIME_VIDEO_DATA.md) still match the live site.
