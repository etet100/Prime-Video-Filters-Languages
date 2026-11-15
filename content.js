// Prime Video Filters & Languages - content script.
//
// On every Prime Video page that shows title cards (search, home, movies, TV,
// genres, collections, watchlist, carousels on detail pages) it adds three badges
// to each card:
//   - whether the title is included in the user's subscription
//     (read from the card's `data-card-entitlement` attribute when the card has one,
//     otherwise from the title's detail page JSON),
//   - whether the title has audio in the chosen language
//     (read from `audioTracks` in the title's detail page JSON, fetched per title),
//   - whether the title has subtitles in the chosen language
//     (read from `subtitles` in the same JSON).
// On a title's own detail page the same three checks are shown as a large banner
// at the top of the page.
// A small panel lets the user hide titles that fail any of the checks, choose
// the language (used for the audio and subtitles checks and for the panel's own texts)
// and switch to a simplified view, where the badges show only icons.
// A "watch later" button, the fourth badge, saves a title to a simple local "watch later" list,
// which the panel shows with links to the titles.
// When the detail requests mostly fail or an expected JSON field is never found, the panel
// shows a warning that Prime Video probably changed (see findProblems).
(() => {
  'use strict';

  // The card types the extension knows. For each one:
  //   link       - the link to the title's detail page (gives the detail id),
  //   badgeHost  - the element the badges are appended to,
  //   inline     - badges flow with the content instead of sitting on the image,
  //   domEntitlement - the card carries its subscription status in the DOM,
  //   hideable   - the filters may hide the card.
  const CARD_KINDS = [
    {
      // Regular cards: search results, carousels and grids on all pages.
      selector: 'article[data-testid="card"]',
      link: 'a[href*="/detail/"]',
      badgeHost: '[data-testid="packshot"]',
      inline: false,
      domEntitlement: true,
      hideable: true,
    },
    {
      // Tall posters in the "super carousel" on home, movies, TV and collection pages.
      selector: 'article[data-testid="super-carousel-card"]',
      link: 'a[data-testid="poster-link"]',
      badgeHost: 'a[data-testid="poster-link"]',
      inline: false,
      domEntitlement: false,
      hideable: true,
    },
    {
      // The rotating banner at the top of home, movies, TV and collection pages.
      // Not hideable: its cards are stacked and faded in turn, and removing one
      // would break the rotation.
      selector: 'article[data-testid="top-hero-card"]',
      link: 'a[data-testid="image-link"]',
      badgeHost: '[data-testid="title-metadata-main"]',
      inline: true,
      domEntitlement: false,
      hideable: false,
    },
  ];
  const ALL_CARDS_SELECTOR = CARD_KINDS.map((kind) => kind.selector).join(', ');

  // Detail data is cached in the extension's storage (chrome.storage.local),
  // one key per title: `audio:<detail id>` -> {tracks, subtitles, entitled, time}.
  const CACHE_PREFIX = 'audio:';
  const CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
  const FILTERS_KEY = 'apbs:filters';
  const MAX_PARALLEL_REQUESTS = 3;
  const SETTINGS_KEY = 'apbs:settings';
  // The user's "watch later" list, also in chrome.storage.local, so every Prime Video tab
  // shares it: one key holding [{id, title, time}], newest first. Not tied to the account.
  const WATCH_LATER_KEY = 'apbs:watchLater';
  const DETAIL_MAIN_SELECTOR = 'main[data-testid="detailpage-main"]';
  // Samples needed before the response statistics are trusted (see findProblems).
  const FAILURE_MIN_SAMPLE = 6;
  const MISSING_DATA_MIN_SAMPLE = 10;

  // Languages the user can choose. `track` matches the start of an audio or subtitles
  // track name, which Prime Video writes in the language's own name.
  const TRACK_LANGUAGES = {
    pl: { code: 'PL', name: 'Polski', track: /^polski/i },
    en: { code: 'EN', name: 'English', track: /^english/i },
    de: { code: 'DE', name: 'Deutsch', track: /^deutsch/i },
    es: { code: 'ES', name: 'Español', track: /^espa[ñn]ol/i },
    fr: { code: 'FR', name: 'Français', track: /^fran[çc]ais/i },
    it: { code: 'IT', name: 'Italiano', track: /^italiano/i },
    cs: { code: 'CS', name: 'Čeština', track: /^(čeština|česky|cesky)/i },
  };
  const DEFAULT_LANGUAGE = 'en';

  // Texts of the panel and badges, per language. `c` is the language's code.
  const TEXTS = {
    pl: {
      entitled: 'W pakiecie',
      notEntitled: 'Poza pakietem',
      entitledUnknown: 'Pakiet ?',
      audio: (c) => `${c} audio`,
      noAudio: (c) => `Brak ${c} audio`,
      subtitles: (c) => `${c} napisy`,
      noSubtitles: (c) => `Brak ${c} napisów`,
      filterEntitled: 'Tylko w pakiecie',
      filterAudio: (c) => `Tylko z audio ${c}`,
      filterSubtitles: (c) => `Tylko z napisami ${c}`,
      language: 'Język panelu',
      compact: 'Pokazuj tylko ikony',
      dim: 'Wyszarzaj zamiast ukrywać',
      collapse: 'Zwiń panel',
      expand: 'Rozwiń panel',
      watchLaterToggle: 'Pokazuj listę do obejrzenia',
      watchLater: 'Do obejrzenia',
      watchLaterAdd: 'Dodaj do obejrzenia',
      watchLaterRemove: 'Usuń z listy do obejrzenia',
      watchLaterEmpty: 'Brak zapisanych tytułów',
      hidden: 'Ukryte',
      checking: 'sprawdzanie',
      warnRequests: 'Sprawdzanie często zawodzi - Prime Video jest niedostępne albo się zmieniło',
      warnData: (f) => `Prime Video zmieniło format danych (${f}) - wyniki mogą być błędne`,
    },
    en: {
      entitled: 'Included',
      notEntitled: 'Not included',
      entitledUnknown: 'Included ?',
      audio: (c) => `${c} audio`,
      noAudio: (c) => `No ${c} audio`,
      subtitles: (c) => `${c} subtitles`,
      noSubtitles: (c) => `No ${c} subtitles`,
      filterEntitled: 'Included only',
      filterAudio: (c) => `Only with ${c} audio`,
      filterSubtitles: (c) => `Only with ${c} subtitles`,
      language: 'Panel language',
      compact: 'Show icons only',
      dim: 'Grey out instead of hiding',
      collapse: 'Collapse panel',
      expand: 'Expand panel',
      watchLaterToggle: 'Show the watch later list',
      watchLater: 'Watch later',
      watchLaterAdd: 'Add to watch later',
      watchLaterRemove: 'Remove from watch later',
      watchLaterEmpty: 'No saved titles',
      hidden: 'Hidden',
      checking: 'checking',
      warnRequests: 'Checks keep failing - Prime Video is unreachable or has changed',
      warnData: (f) => `Prime Video changed its data format (${f}) - results may be wrong`,
    },
    de: {
      entitled: 'Im Abo',
      notEntitled: 'Nicht im Abo',
      entitledUnknown: 'Abo ?',
      audio: (c) => `${c} Audio`,
      noAudio: (c) => `Kein ${c}-Audio`,
      subtitles: (c) => `${c} Untertitel`,
      noSubtitles: (c) => `Keine ${c}-Untertitel`,
      filterEntitled: 'Nur im Abo',
      filterAudio: (c) => `Nur mit ${c}-Audio`,
      filterSubtitles: (c) => `Nur mit ${c}-Untertiteln`,
      language: 'Sprache des Panels',
      compact: 'Nur Symbole anzeigen',
      dim: 'Ausgrauen statt ausblenden',
      collapse: 'Panel einklappen',
      expand: 'Panel ausklappen',
      watchLaterToggle: 'Liste „Später ansehen“ anzeigen',
      watchLater: 'Später ansehen',
      watchLaterAdd: 'Für später merken',
      watchLaterRemove: 'Aus der Liste entfernen',
      watchLaterEmpty: 'Keine gespeicherten Titel',
      hidden: 'Ausgeblendet',
      checking: 'Prüfung',
      warnRequests: 'Prüfungen schlagen oft fehl - Prime Video ist nicht erreichbar oder wurde geändert',
      warnData: (f) => `Prime Video hat sein Datenformat geändert (${f}) - Ergebnisse können falsch sein`,
    },
    es: {
      entitled: 'En tu plan',
      notEntitled: 'Fuera del plan',
      entitledUnknown: 'Plan ?',
      audio: (c) => `Audio ${c}`,
      noAudio: (c) => `Sin audio ${c}`,
      subtitles: (c) => `Subtítulos ${c}`,
      noSubtitles: (c) => `Sin subtítulos ${c}`,
      filterEntitled: 'Solo en el plan',
      filterAudio: (c) => `Solo con audio ${c}`,
      filterSubtitles: (c) => `Solo con subtítulos ${c}`,
      language: 'Idioma del panel',
      compact: 'Mostrar solo iconos',
      dim: 'Atenuar en vez de ocultar',
      collapse: 'Contraer el panel',
      expand: 'Expandir el panel',
      watchLaterToggle: 'Mostrar la lista para ver más tarde',
      watchLater: 'Para ver más tarde',
      watchLaterAdd: 'Guardar para ver más tarde',
      watchLaterRemove: 'Quitar de la lista',
      watchLaterEmpty: 'No hay títulos guardados',
      hidden: 'Ocultos',
      checking: 'comprobando',
      warnRequests: 'Las comprobaciones fallan a menudo - Prime Video no responde o ha cambiado',
      warnData: (f) => `Prime Video ha cambiado su formato de datos (${f}) - los resultados pueden ser incorrectos`,
    },
    fr: {
      entitled: 'Inclus',
      notEntitled: 'Non inclus',
      entitledUnknown: 'Inclus ?',
      audio: (c) => `Audio ${c}`,
      noAudio: (c) => `Pas d'audio ${c}`,
      subtitles: (c) => `Sous-titres ${c}`,
      noSubtitles: (c) => `Pas de sous-titres ${c}`,
      filterEntitled: 'Seulement les inclus',
      filterAudio: (c) => `Seulement avec audio ${c}`,
      filterSubtitles: (c) => `Seulement avec sous-titres ${c}`,
      language: 'Langue du panneau',
      compact: 'Afficher uniquement les icônes',
      dim: 'Griser au lieu de masquer',
      collapse: 'Réduire le panneau',
      expand: 'Développer le panneau',
      watchLaterToggle: 'Afficher la liste à regarder plus tard',
      watchLater: 'À regarder plus tard',
      watchLaterAdd: 'Ajouter à regarder plus tard',
      watchLaterRemove: 'Retirer de la liste',
      watchLaterEmpty: 'Aucun titre enregistré',
      hidden: 'Masqués',
      checking: 'vérification',
      warnRequests: 'Les vérifications échouent souvent - Prime Video est inaccessible ou a changé',
      warnData: (f) => `Prime Video a changé son format de données (${f}) - les résultats peuvent être faux`,
    },
    it: {
      entitled: 'Incluso',
      notEntitled: 'Non incluso',
      entitledUnknown: 'Incluso ?',
      audio: (c) => `Audio ${c}`,
      noAudio: (c) => `Senza audio ${c}`,
      subtitles: (c) => `Sottotitoli ${c}`,
      noSubtitles: (c) => `Senza sottotitoli ${c}`,
      filterEntitled: 'Solo inclusi',
      filterAudio: (c) => `Solo con audio ${c}`,
      filterSubtitles: (c) => `Solo con sottotitoli ${c}`,
      language: 'Lingua del pannello',
      compact: 'Mostra solo le icone',
      dim: 'In grigio invece di nascondere',
      collapse: 'Comprimi il pannello',
      expand: 'Espandi il pannello',
      watchLaterToggle: 'Mostra la lista Da guardare',
      watchLater: 'Da guardare',
      watchLaterAdd: 'Aggiungi a Da guardare',
      watchLaterRemove: 'Rimuovi dalla lista',
      watchLaterEmpty: 'Nessun titolo salvato',
      hidden: 'Nascosti',
      checking: 'verifica',
      warnRequests: 'I controlli falliscono spesso - Prime Video non è raggiungibile o è cambiato',
      warnData: (f) => `Prime Video ha cambiato il formato dei dati (${f}) - i risultati potrebbero essere errati`,
    },
    cs: {
      entitled: 'V předplatném',
      notEntitled: 'Mimo předplatné',
      entitledUnknown: 'Předplatné ?',
      audio: (c) => `${c} zvuk`,
      noAudio: (c) => `Bez ${c} zvuku`,
      subtitles: (c) => `${c} titulky`,
      noSubtitles: (c) => `Bez ${c} titulků`,
      filterEntitled: 'Jen v předplatném',
      filterAudio: (c) => `Jen s ${c} zvukem`,
      filterSubtitles: (c) => `Jen s ${c} titulky`,
      language: 'Jazyk panelu',
      compact: 'Zobrazovat jen ikony',
      dim: 'Zašednout místo skrytí',
      collapse: 'Sbalit panel',
      expand: 'Rozbalit panel',
      watchLaterToggle: 'Zobrazovat seznam ke zhlédnutí',
      watchLater: 'Ke zhlédnutí',
      watchLaterAdd: 'Přidat ke zhlédnutí',
      watchLaterRemove: 'Odebrat ze seznamu',
      watchLaterEmpty: 'Žádné uložené tituly',
      hidden: 'Skryto',
      checking: 'kontrola',
      warnRequests: 'Kontroly často selhávají - Prime Video je nedostupné nebo se změnilo',
      warnData: (f) => `Prime Video změnilo formát dat (${f}) - výsledky mohou být chybné`,
    },
  };

  // Fresh cache entries per detail id: {tracks, subtitles, entitled, time}.
  const cache = new Map();
  // Titles being fetched or whose fetch failed: detail id -> 'loading' | 'error'.
  const pending = new Map();
  // Titles waiting to be fetched, most urgent first. Rebuilt on every update from the
  // cards on or near the screen, so titles that scrolled away or left the page drop out.
  let queue = [];
  let queued = new Set();
  let runningRequests = 0;
  // What this tab's detail requests returned, used to notice that Prime Video changed:
  //   ok            - responses that had the audio tracks,
  //   failed        - requests that failed for any reason,
  //   noTracks      - responses (valid JSON) without any audio tracks list,
  //   withEntitlement / withSubtitles - of the `ok` responses, those that had that data.
  const stats = { ok: 0, failed: 0, noTracks: 0, withEntitlement: 0, withSubtitles: 0 };
  // Problems found in `stats` (see findProblems): 'requests', 'audioTracks', 'entitlementType'
  // or 'subtitles'. Recomputed on every update; each one is logged to the console once.
  let problems = new Set();
  const loggedProblems = new Set();
  // Cards on the screen or within 200 px of it, and cards within one screen height of it.
  const nearCards = new Set();
  const aheadCards = new Set();
  // Grid containers known to be virtualized (see isVirtualGrid).
  const virtualGrids = new WeakSet();
  let filters = loadFilters();
  let settings = loadSettings();
  let texts = TEXTS[settings.language];
  let panel = null;
  let scheduled = false;
  // The "watch later" list, and whether the panel's copy of it must be redrawn. The panel
  // is redrawn only on a change: it is inside the observed body, so redrawing it on every
  // update would never let the MutationObserver settle.
  let watchLater = [];
  let watchLaterChanged = true;

  const nearObserver = new IntersectionObserver((entries) => trackCards(entries, nearCards), {
    rootMargin: '200px',
  });
  const aheadObserver = new IntersectionObserver((entries) => trackCards(entries, aheadCards), {
    rootMargin: '100% 0px',
  });

  // ---------- storage ----------

  function loadFilters() {
    try {
      const saved = JSON.parse(localStorage.getItem(FILTERS_KEY) || '{}');
      return { entitled: !!saved.entitled, audio: !!(saved.audio ?? saved.polish), subtitles: !!saved.subtitles };
    } catch (e) {
      return { entitled: false, audio: false, subtitles: false };
    }
  }

  // The browser's language if the extension supports it, otherwise English.
  function browserLanguage() {
    const code = (navigator.language || '').toLowerCase().split('-')[0];
    return TRACK_LANGUAGES[code] ? code : DEFAULT_LANGUAGE;
  }

  // A saved choice wins; a missing or no longer supported one follows the browser.
  function loadSettings() {
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    } catch (e) {
      // Storage unavailable - fall back to the browser's language.
    }
    return {
      language: TRACK_LANGUAGES[saved.language] ? saved.language : browserLanguage(),
      compact: !!saved.compact,
      dim: !!saved.dim,
      collapsed: !!saved.collapsed,
      // The "watch later" feature is on unless the user turned it off.
      watchLater: saved.watchLater !== false,
    };
  }

  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (e) {
      // Storage unavailable - settings just won't be remembered.
    }
  }

  function saveFilters() {
    try {
      localStorage.setItem(FILTERS_KEY, JSON.stringify(filters));
    } catch (e) {
      // Storage unavailable - filters just won't be remembered.
    }
  }

  function isFresh(entry) {
    // Entries cached before subtitles were added have no `subtitles` and count as expired.
    return (
      !!entry &&
      Array.isArray(entry.tracks) &&
      Array.isArray(entry.subtitles) &&
      Date.now() - entry.time < CACHE_TTL_MS
    );
  }

  // Loads every cached title into memory and deletes expired entries.
  async function loadCache() {
    try {
      const all = await chrome.storage.local.get(null);
      const expired = [];
      for (const [key, entry] of Object.entries(all)) {
        if (!key.startsWith(CACHE_PREFIX)) {
          continue;
        }
        if (isFresh(entry)) {
          cache.set(key.slice(CACHE_PREFIX.length), entry);
        } else {
          expired.push(key);
        }
      }
      if (expired.length > 0) {
        await chrome.storage.local.remove(expired);
      }
    } catch (e) {
      console.warn('[Prime Video Filters & Languages] cache could not be loaded:', e);
    }
  }

  function writeCache(id, entry) {
    cache.set(id, entry);
    try {
      chrome.storage.local.set({ [CACHE_PREFIX + id]: entry }).catch((e) => {
        console.warn('[Prime Video Filters & Languages] cache write failed:', e);
      });
    } catch (e) {
      // The extension was reloaded while this tab stayed open - the cache is not reachable.
    }
  }

  // Keeps only well-formed entries of a stored "watch later" list.
  function readWatchLater(value) {
    return Array.isArray(value) ? value.filter((item) => item && typeof item.id === 'string') : [];
  }

  async function loadWatchLater() {
    try {
      const saved = await chrome.storage.local.get(WATCH_LATER_KEY);
      watchLater = readWatchLater(saved[WATCH_LATER_KEY]);
    } catch (e) {
      console.warn('[Prime Video Filters & Languages] watch later list could not be loaded:', e);
    }
  }

  function isWatchLater(id) {
    return watchLater.some((item) => item.id === id);
  }

  // Adds the title at the top of the list, or removes it if it is already there.
  function toggleWatchLater(id, title) {
    if (isWatchLater(id)) {
      watchLater = watchLater.filter((item) => item.id !== id);
    } else {
      watchLater = [{ id, title, time: Date.now() }, ...watchLater];
    }
    watchLaterChanged = true;
    try {
      chrome.storage.local.set({ [WATCH_LATER_KEY]: watchLater }).catch((e) => {
        console.warn('[Prime Video Filters & Languages] watch later list could not be saved:', e);
      });
    } catch (e) {
      // The extension was reloaded while this tab stayed open - the storage is not reachable.
    }
    scheduleUpdate();
  }

  // Titles fetched in another Prime Video tab become known here too, and so do
  // changes to the "watch later" list.
  function onStorageChanged(changes, area) {
    if (area !== 'local') {
      return;
    }
    let changed = false;
    for (const [key, change] of Object.entries(changes)) {
      if (key === WATCH_LATER_KEY) {
        watchLater = readWatchLater(change.newValue);
        watchLaterChanged = true;
        changed = true;
        continue;
      }
      if (!key.startsWith(CACHE_PREFIX)) {
        continue;
      }
      const id = key.slice(CACHE_PREFIX.length);
      if (isFresh(change.newValue)) {
        cache.set(id, change.newValue);
        pending.delete(id);
      } else {
        cache.delete(id);
      }
      changed = true;
    }
    if (changed) {
      scheduleUpdate();
    }
  }

  // ---------- detail lookup ----------

  // Returns the cache entry of a title if it is still fresh.
  function getEntry(id) {
    const entry = cache.get(id);
    if (entry && !isFresh(entry)) {
      cache.delete(id);
      return undefined;
    }
    return entry;
  }

  // Status of the chosen language in a list of track names: 'yes', 'no', 'loading', 'error' or 'unknown'.
  function getLanguageStatus(id, field) {
    const entry = getEntry(id);
    if (entry) {
      // While the subtitles data looks broken, "no subtitles" cannot be trusted.
      if (field === 'subtitles' && problems.has('subtitles')) {
        return 'unknown';
      }
      const pattern = TRACK_LANGUAGES[settings.language].track;
      return entry[field].some((name) => pattern.test(name)) ? 'yes' : 'no';
    }
    return pending.get(id) || (queued.has(id) ? 'loading' : 'unknown');
  }

  // Fetches the detail page the same way the Prime Video web app does on in-app
  // navigation: the JSON variant is much lighter than the HTML page.
  // The `dvWebAppClientVersion` parameter must be present, but its value is not checked.
  async function fetchDetail(id) {
    const response = await fetch(`/detail/${encodeURIComponent(id)}?dvWebAppClientVersion=1`, {
      headers: { accept: 'application/json', 'x-requested-with': 'WebAppSPA' },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json();
    const source = findTrackSource(data);
    if (!source) {
      stats.noTracks++;
      throw new Error('audioTracks not found in the response');
    }
    // A title without subtitles may have no such key, which counts as an empty list.
    // The statistics tell that apart from a renamed key (see findProblems).
    const hasSubtitles = isNameList(source.subtitles);
    const entitled = findEntitlement(data);
    stats.ok++;
    stats.withSubtitles += hasSubtitles ? 1 : 0;
    stats.withEntitlement += entitled === null ? 0 : 1;
    return { tracks: source.audioTracks, subtitles: hasSubtitles ? source.subtitles : [], entitled, time: Date.now() };
  }

  // A list of track names, e.g. ["Polski", "English"].
  function isNameList(list) {
    return Array.isArray(list) && list.every((name) => typeof name === 'string');
  }

  // The object that holds the audio tracks, and next to them the subtitles. It is
  // body.atf.state.detail.headerDetail[<title id>]; fall back to a deep search in case
  // the layout changes.
  function findTrackSource(data) {
    const header = data?.body?.atf?.state?.detail?.headerDetail;
    if (header) {
      for (const item of Object.values(header)) {
        if (isNameList(item?.audioTracks)) {
          return item;
        }
      }
    }
    return deepFindTrackSource(data);
  }

  function deepFindTrackSource(node) {
    if (!node || typeof node !== 'object') {
      return null;
    }
    if (isNameList(node.audioTracks)) {
      return node;
    }
    for (const value of Object.values(node)) {
      const found = deepFindTrackSource(value);
      if (found) {
        return found;
      }
    }
    return null;
  }

  // The subscription status lives in body.atf.state.action.atf[<title id>].messages,
  // under the same title id as headerDetail. Returns true, false, or null if not found.
  function findEntitlement(data) {
    const state = data?.body?.atf?.state;
    const header = state?.detail?.headerDetail;
    const titleId = header ? Object.keys(header)[0] : null;
    const type = titleId ? state?.action?.atf?.[titleId]?.messages?.entitlementType : undefined;
    if (type === 'Entitled') {
      return true;
    }
    if (type === 'Unentitled') {
      return false;
    }
    return null;
  }

  // Notices that Prime Video changed from what this tab's requests returned. A few
  // failures are normal, so each rule needs a minimum number of responses:
  //   requests        - more than half of the requests failed (HTTP error, not JSON, offline),
  //   audioTracks     - more than half of the valid responses had no audio tracks list,
  //   entitlementType - none of the responses had the subscription status,
  //   subtitles       - none of the responses had a subtitles list (a title without
  //                     subtitles is rare, so a long run of them means the key moved).
  function findProblems() {
    const found = new Set();
    const total = stats.ok + stats.failed;
    const transportFailed = stats.failed - stats.noTracks;
    const parsed = stats.ok + stats.noTracks;
    if (total >= FAILURE_MIN_SAMPLE && transportFailed * 2 > total) {
      found.add('requests');
    }
    if (parsed >= FAILURE_MIN_SAMPLE && stats.noTracks * 2 > parsed) {
      found.add('audioTracks');
    }
    if (stats.ok >= MISSING_DATA_MIN_SAMPLE && stats.withEntitlement === 0) {
      found.add('entitlementType');
    }
    if (stats.ok >= MISSING_DATA_MIN_SAMPLE && stats.withSubtitles === 0) {
      found.add('subtitles');
    }
    for (const problem of found) {
      if (!loggedProblems.has(problem)) {
        loggedProblems.add(problem);
        console.warn(`[Prime Video Filters & Languages] problem detected: ${problem}`, { ...stats });
      }
    }
    return found;
  }

  // Rebuilds the queue, in this order: the title of the detail page being viewed, then
  // the cards on or near the screen, then - only when a filter needs their data - the
  // cards within one screen of it. Each group is in page order. With a filter on, hidden
  // cards make the next ones move up into these zones, so they get checked in turn
  // (except in virtualized grids, where hidden cards leave empty slots, and with the
  // grey out setting, where failing cards stay in place).
  function rebuildQueue(pageId, cards) {
    const wanted = new Set();
    if (pageId) {
      wanted.add(pageId);
    }
    for (const info of cards) {
      if (nearCards.has(info.card)) {
        wanted.add(info.id);
      }
    }
    for (const info of cards) {
      if (aheadCards.has(info.card) && filtersNeedDetail(info)) {
        wanted.add(info.id);
      }
    }
    queue = [...wanted].filter((id) => !getEntry(id) && !pending.has(id));
    queued = new Set(queue);
  }

  function pumpQueue() {
    while (runningRequests < MAX_PARALLEL_REQUESTS && queue.length > 0) {
      const id = queue.shift();
      queued.delete(id);
      pending.set(id, 'loading');
      runningRequests++;
      fetchDetail(id)
        .then((entry) => {
          writeCache(id, entry);
          pending.delete(id);
        })
        .catch((error) => {
          console.warn(`[Prime Video Filters & Languages] check failed for ${id}:`, error);
          stats.failed++;
          pending.set(id, 'error');
        })
        .finally(() => {
          runningRequests--;
          scheduleUpdate();
          pumpQueue();
        });
    }
  }

  // Keeps `set` in sync with the cards inside an observer's zone.
  function trackCards(entries, set) {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        set.add(entry.target);
      } else {
        set.delete(entry.target);
      }
    }
    scheduleUpdate();
  }

  // Cards removed from the page may not get a final "not intersecting" entry.
  function forgetRemovedCards() {
    for (const set of [nearCards, aheadCards]) {
      for (const card of set) {
        if (!card.isConnected) {
          set.delete(card);
        }
      }
    }
  }

  // ---------- cards ----------

  function getKind(card) {
    return CARD_KINDS.find((kind) => card.matches(kind.selector));
  }

  function getDetailId(card, kind) {
    const link = card.querySelector(kind.link);
    const match = link && link.getAttribute('href').match(/\/detail\/([^/?#]+)/);
    return match ? match[1] : null;
  }

  // The title's name, for the "watch later" list: from a card or from the detail page's
  // main element. Regular cards have `data-card-title`; the other places are tried in turn.
  function getTitleName(root) {
    const titleArt = root.querySelector('[data-testid="title-art"]');
    const candidates = [
      root.getAttribute('data-card-title'),
      titleArt?.querySelector('img[alt]')?.getAttribute('alt'),
      titleArt?.textContent,
      root.querySelector('a[aria-label]')?.getAttribute('aria-label'),
      root.querySelector('img[alt]')?.getAttribute('alt'),
    ];
    return candidates.map((text) => (text || '').trim()).find((text) => text !== '') || '';
  }

  // Returns true / false, or null when the status is not known yet.
  function getEntitlement(card, kind, id) {
    if (kind.domEntitlement) {
      const value = card.getAttribute('data-card-entitlement');
      if (value === 'Entitled') {
        return true;
      }
      if (value === 'Unentitled') {
        return false;
      }
    }
    const entry = getEntry(id);
    return entry && typeof entry.entitled === 'boolean' ? entry.entitled : null;
  }

  // The cards on the page that link to a title, in page order: {card, kind, id, entitled}.
  function collectCards(elements) {
    const cards = [];
    for (const card of elements) {
      const kind = getKind(card);
      const id = getDetailId(card, kind);
      if (id) {
        cards.push({ card, kind, id, entitled: getEntitlement(card, kind, id) });
      }
    }
    return cards;
  }

  // Whether the active filters need the title's detail data to decide if the card is hidden.
  function filtersNeedDetail({ kind, entitled }) {
    return kind.hideable && (filters.audio || filters.subtitles || (filters.entitled && entitled === null));
  }

  function processCard(info) {
    const { card, kind, id, entitled } = info;
    nearObserver.observe(card);
    aheadObserver.observe(card);

    const status = getLanguageStatus(id, 'tracks');
    const subtitleStatus = getLanguageStatus(id, 'subtitles');
    renderBadges(card, kind, id, entitled, status, subtitleStatus);

    if (kind.hideable) {
      const hidden = (filters.entitled && entitled === false) || (filters.audio && status === 'no') ||
        (filters.subtitles && subtitleStatus === 'no');
      // A card the filters cannot decide on yet is dimmed until its check finishes.
      // A failed check counts as finished, so the card does not stay dimmed.
      const unchecked = !hidden && filtersNeedDetail(info) && !getEntry(id) && pending.get(id) !== 'error';
      // With the grey out setting on, a failing card stays in place, greyed out, instead of being hidden.
      const dimmed = hidden && settings.dim;
      const removed = hidden && !settings.dim;
      const virtual = isVirtualGrid(card);
      setClass(getHideTarget(card), 'apbs-hidden', removed && !virtual);
      setClass(card, 'apbs-empty-slot', removed && virtual);
      // A data attribute, not a class: Prime Video rewrites the card's class attribute when
      // the pointer enters and leaves it, which would drop a class until the next update.
      if (card.hasAttribute('data-apbs-dimmed') !== dimmed) {
        card.toggleAttribute('data-apbs-dimmed', dimmed);
      }
      setClass(card, 'apbs-unchecked', unchecked);
    }
  }

  // Prime Video virtualizes long grids (e.g. "Więcej do odkrycia" in search): only a window
  // of cards is in the DOM, between two spacer <div>s whose heights assume every card is
  // shown. Removing cards from the layout there shrinks the window and leaves the screen
  // empty, so in these grids a hidden card keeps its slot, empty. A grid counts as
  // virtualized once it has a pagination marker or a spacer taller than 0, and stays so,
  // so its cards do not jump between the two modes.
  function isVirtualGrid(card) {
    const container = card.closest('[data-testid="grid-container"]');
    if (!container) {
      return false;
    }
    if (virtualGrids.has(container)) {
      return true;
    }
    const paginated = !!container.querySelector(':scope > [data-testid="page-pagination-marker"]');
    const spaced = [...container.children].some(
      (child) => child.matches('div[style*="height"]') && parseFloat(child.style.height) > 0,
    );
    if (paginated || spaced) {
      virtualGrids.add(container);
      return true;
    }
    return false;
  }

  // In carousels each card sits alone in an <li>: hiding just the card would leave
  // an empty slot, so the <li> is hidden instead. In grids the card is a direct child.
  function getHideTarget(card) {
    const parent = card.parentElement;
    if (parent && parent.tagName === 'LI' && parent.childElementCount === 1) {
      return parent;
    }
    return card;
  }

  function setClass(element, className, on) {
    if (element.classList.contains(className) !== on) {
      element.classList.toggle(className, on);
    }
  }

  function renderBadges(card, kind, id, entitled, status, subtitleStatus) {
    const host = card.querySelector(kind.badgeHost);
    if (!host) {
      return;
    }
    let box = host.querySelector(':scope > .apbs-badges');
    if (!box) {
      box = createBadgeGroup(kind.inline ? 'apbs-inline' : 'apbs-corner');
      host.append(box);
    }
    setBadges(box, entitled, status, subtitleStatus);
    setWatchLaterButton(box, id);
  }

  // A badge group: the extension's icon, a separator line, the three badges and, as a
  // fourth badge, the "watch later" button (see onWatchLaterClick): a text in the full view,
  // a bookmark in the simplified view.
  // Each badge's `data-icon` picks its icon in the simplified view (see content.css).
  function createBadgeGroup(variant) {
    const box = document.createElement('div');
    box.className = `apbs-badges ${variant}`;
    const logo = document.createElement('span');
    logo.className = 'apbs-logo';
    const list = document.createElement('span');
    list.className = 'apbs-badge-list';
    for (const icon of ['entitled', 'audio', 'subtitles']) {
      const badge = document.createElement('span');
      badge.dataset.icon = icon;
      list.append(badge);
    }
    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'apbs-badge apbs-save';
    list.append(save);
    box.append(logo, list);
    return box;
  }

  // Shows whether the title is on the "watch later" list ("+" or "✓" before the list's name),
  // or hides the button while the feature is turned off. The tooltip says what a click does.
  // Only touches the DOM when something changed.
  function setWatchLaterButton(box, id) {
    const button = box.querySelector('.apbs-save');
    if (button.hidden === settings.watchLater) {
      button.hidden = !settings.watchLater;
    }
    const saved = isWatchLater(id);
    const text = saved ? texts.watchLaterRemove : texts.watchLaterAdd;
    const label = `${saved ? '✓' : '+'} ${texts.watchLater}`;
    if (button.textContent !== label) {
      button.textContent = label;
    }
    if (button.dataset.id !== id) {
      button.dataset.id = id;
    }
    if (button.getAttribute('aria-pressed') !== String(saved)) {
      button.setAttribute('aria-pressed', String(saved));
    }
    if (button.title !== text) {
      button.title = text;
      button.setAttribute('aria-label', text);
    }
  }

  // Clicks on a "watch later" button. Listened to on `window` in the capture phase, so the
  // click is stopped before it reaches the card's link or Prime Video's own handlers.
  function onWatchLaterClick(event) {
    const button = event.target instanceof Element ? event.target.closest('.apbs-save') : null;
    if (!button) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const root = button.closest(`${ALL_CARDS_SELECTOR}, ${DETAIL_MAIN_SELECTOR}`);
    toggleWatchLater(button.dataset.id, root ? getTitleName(root) : '');
  }

  // In the simplified view (`apbs-compact`) the badges show only an icon on their colour;
  // the text stays in the DOM, hidden by content.css.
  function setBadges(box, entitled, status, subtitleStatus) {
    setClass(box, 'apbs-compact', settings.compact);
    const badges = box.querySelector('.apbs-badge-list').children;
    if (entitled === null) {
      setBadge(badges[0], 'pending', texts.entitledUnknown);
    } else {
      setBadge(badges[0], entitled ? 'yes' : 'no', entitled ? texts.entitled : texts.notEntitled);
    }
    const code = TRACK_LANGUAGES[settings.language].code;
    setBadge(badges[1], ...languageBadge(status, code, texts.audio, texts.noAudio));
    setBadge(badges[2], ...languageBadge(subtitleStatus, code, texts.subtitles, texts.noSubtitles));
  }

  // [badge kind, badge text] for a language status.
  function languageBadge(status, code, yesText, noText) {
    switch (status) {
      case 'yes':
        return ['yes', yesText(code)];
      case 'no':
        return ['no', noText(code)];
      case 'loading':
        return ['pending', `${yesText(code)}…`];
      default:
        return ['pending', `${yesText(code)} ?`];
    }
  }

  // Only touches the DOM when something changed, so the MutationObserver settles.
  function setBadge(element, kind, text) {
    const className = `apbs-badge apbs-${kind}`;
    if (element.className !== className) {
      element.className = className;
    }
    if (element.textContent !== text) {
      element.textContent = text;
    }
  }

  // ---------- panel ----------

  function ensurePanel() {
    if (panel && panel.isConnected) {
      if (panel.hidden) {
        panel.hidden = false;
      }
      return;
    }
    panel = document.createElement('div');
    panel.className = 'apbs-panel';
    panel.classList.toggle('apbs-collapsed', settings.collapsed);
    const code = TRACK_LANGUAGES[settings.language].code;
    const title = document.createElement('div');
    title.className = 'apbs-title';
    const name = document.createElement('span');
    name.textContent = 'Prime Video Filters & Languages';
    title.append(name, createPanelButton('apbs-collapse', texts.collapse, true));
    panel.append(
      // Collapsed, the panel shows only this button: the extension's icon.
      createPanelButton('apbs-expand', texts.expand, false),
      title,
      createLanguageSelect(),
      createCheckbox('entitled', texts.filterEntitled),
      createCheckbox('audio', texts.filterAudio(code)),
      createCheckbox('subtitles', texts.filterSubtitles(code)),
    );
    const warning = document.createElement('div');
    warning.className = 'apbs-warning';
    warning.hidden = true;
    const status = document.createElement('div');
    status.className = 'apbs-status';
    // The "watch later" list, below a separator line, shown while the feature is on.
    const watchLaterSection = document.createElement('div');
    watchLaterSection.className = 'apbs-watch-later apbs-separated';
    watchLaterSection.hidden = !settings.watchLater;
    const watchLaterTitle = document.createElement('div');
    watchLaterTitle.className = 'apbs-watch-later-title';
    const watchLaterList = document.createElement('ul');
    watchLaterSection.append(watchLaterTitle, watchLaterList);
    watchLaterChanged = true;
    // The least important settings go last, below a separator line, with the icons' legend under them.
    const legend = createLegend(code);
    panel.append(
      warning,
      status,
      watchLaterSection,
      createDimCheckbox(),
      createWatchLaterCheckbox(watchLaterSection),
      createCompactCheckbox(legend),
      legend,
    );
    document.body.append(panel);
  }

  // Redraws the panel's "watch later" list, only after the list changed (see watchLaterChanged).
  // Each title links to its page and has a "×" button that removes it.
  function renderWatchLater() {
    const section = panel && panel.querySelector('.apbs-watch-later');
    if (!section || !watchLaterChanged) {
      return;
    }
    watchLaterChanged = false;
    section.querySelector('.apbs-watch-later-title').textContent = `${texts.watchLater} (${watchLater.length})`;
    const list = section.querySelector('ul');
    list.replaceChildren();
    if (watchLater.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'apbs-watch-later-empty';
      empty.textContent = texts.watchLaterEmpty;
      list.append(empty);
    }
    for (const item of watchLater) {
      const row = document.createElement('li');
      const link = document.createElement('a');
      link.href = `/detail/${encodeURIComponent(item.id)}`;
      link.textContent = item.title || item.id;
      link.title = link.textContent;
      const remove = document.createElement('button');
      remove.type = 'button';
      // The "×" is drawn by content.css, so it is centred exactly whatever the font.
      remove.className = 'apbs-remove';
      remove.title = texts.watchLaterRemove;
      remove.setAttribute('aria-label', texts.watchLaterRemove);
      remove.addEventListener('click', () => toggleWatchLater(item.id, item.title));
      row.append(link, remove);
      list.append(row);
    }
  }

  // A button that collapses the panel to the extension's icon or expands it again; the state is remembered.
  function createPanelButton(className, text, collapse) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.title = text;
    button.setAttribute('aria-label', text);
    button.addEventListener('click', () => {
      settings = { ...settings, collapsed: collapse };
      saveSettings();
      panel.classList.toggle('apbs-collapsed', collapse);
    });
    return button;
  }

  // What each icon of the simplified view means, shown only while that view is on.
  function createLegend(code) {
    const legend = document.createElement('div');
    legend.className = 'apbs-legend';
    legend.hidden = !settings.compact;
    const items = [
      ['entitled', texts.entitled],
      ['not-entitled', texts.notEntitled],
      ['audio', texts.audio(code)],
      ['subtitles', texts.subtitles(code)],
    ];
    for (const [icon, text] of items) {
      const item = document.createElement('span');
      item.dataset.icon = icon;
      item.textContent = text;
      legend.append(item);
    }
    return legend;
  }

  function createCheckbox(key, text) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = filters[key];
    input.addEventListener('change', () => {
      filters = { ...filters, [key]: input.checked };
      saveFilters();
      scheduleUpdate();
    });
    label.append(input, document.createTextNode(text));
    return label;
  }

  // The grey out switch: cards that fail a filter stay on the page, greyed out, instead of being hidden.
  function createDimCheckbox() {
    const label = document.createElement('label');
    label.className = 'apbs-separated';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = settings.dim;
    input.addEventListener('change', () => {
      settings = { ...settings, dim: input.checked };
      saveSettings();
      scheduleUpdate();
    });
    label.append(input, document.createTextNode(texts.dim));
    return label;
  }

  // The "watch later" switch: off, the panel's list and the bookmark buttons are hidden.
  // The saved list itself is kept.
  function createWatchLaterCheckbox(section) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = settings.watchLater;
    input.addEventListener('change', () => {
      settings = { ...settings, watchLater: input.checked };
      section.hidden = !settings.watchLater;
      saveSettings();
      scheduleUpdate();
    });
    label.append(input, document.createTextNode(texts.watchLaterToggle));
    return label;
  }

  // The simplified view switch: icons only, without texts or the language code.
  function createCompactCheckbox(legend) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = settings.compact;
    input.addEventListener('change', () => {
      settings = { ...settings, compact: input.checked };
      legend.hidden = !settings.compact;
      saveSettings();
      scheduleUpdate();
    });
    label.append(input, document.createTextNode(texts.compact));
    return label;
  }

  // The language picker. Changing the language rebuilds the panel so its texts follow.
  function createLanguageSelect() {
    const label = document.createElement('label');
    label.className = 'apbs-select';
    const select = document.createElement('select');
    for (const [key, language] of Object.entries(TRACK_LANGUAGES)) {
      const option = document.createElement('option');
      option.value = key;
      option.textContent = language.name;
      select.append(option);
    }
    select.value = settings.language;
    select.setAttribute('aria-label', texts.language);
    select.addEventListener('change', () => {
      settings = { ...settings, language: select.value };
      texts = TEXTS[settings.language];
      saveSettings();
      panel.remove();
      panel = null;
      scheduleUpdate();
    });
    label.append(select);
    return label;
  }

  // The warning about a changed Prime Video: one line for failing requests, one naming
  // the data fields that were not found.
  function updatePanelWarning() {
    const warning = panel && panel.querySelector('.apbs-warning');
    if (!warning) {
      return;
    }
    const lines = [];
    if (problems.has('requests')) {
      lines.push(texts.warnRequests);
    }
    const fields = ['audioTracks', 'entitlementType', 'subtitles'].filter((field) => problems.has(field));
    if (fields.length > 0) {
      lines.push(texts.warnData(fields.join(', ')));
    }
    const text = lines.join('\n');
    if (warning.textContent !== text) {
      warning.textContent = text;
    }
    warning.hidden = text === '';
  }

  function updatePanelStatus() {
    updatePanelWarning();
    const status = panel && panel.querySelector('.apbs-status');
    if (!status) {
      return;
    }
    // Greyed out cards are counted as hidden too (agreed: the same text in both modes).
    const hiddenCount = document.querySelectorAll('.apbs-hidden, .apbs-empty-slot, [data-apbs-dimmed]').length;
    const waiting = queue.length + runningRequests;
    let text = `${texts.hidden}: ${hiddenCount}`;
    if (waiting > 0) {
      text += ` · ${texts.checking}: ${waiting}`;
    }
    if (status.textContent !== text) {
      status.textContent = text;
    }
  }

  // ---------- main loop ----------

  // ---------- detail page banner ----------

  // The detail id when the page is a title's detail page, otherwise null.
  function getPageDetailId() {
    const match = location.pathname.match(/^\/(?:[^/]+\/)*detail\/([^/?#]+)/);
    return match ? match[1] : null;
  }

  // A large banner at the top of the title's own page with the same three checks as the card badges.
  function renderDetailBanner(id) {
    const main = document.querySelector('main[data-testid="detailpage-main"]');
    let banner = document.querySelector('.apbs-detail-banner');
    if (!id || !main) {
      banner?.remove();
      return;
    }
    if (banner && banner.parentElement !== main) {
      banner.remove();
      banner = null;
    }
    if (!banner) {
      banner = document.createElement('div');
      banner.className = 'apbs-detail-banner';
      banner.append(createBadgeGroup('apbs-large'));
      main.prepend(banner);
    }
    if (banner.dataset.id !== id) {
      banner.dataset.id = id;
    }
    const entry = getEntry(id);
    const entitled = entry && typeof entry.entitled === 'boolean' ? entry.entitled : null;
    const box = banner.querySelector('.apbs-badges');
    setBadges(box, entitled, getLanguageStatus(id, 'tracks'), getLanguageStatus(id, 'subtitles'));
    setWatchLaterButton(box, id);
  }

  function update() {
    scheduled = false;
    forgetRemovedCards();
    problems = findProblems();
    const pageId = getPageDetailId();
    const elements = document.querySelectorAll(ALL_CARDS_SELECTOR);
    const cards = collectCards(elements);
    rebuildQueue(pageId, cards);
    pumpQueue();
    renderDetailBanner(pageId);
    // The panel is shown only on pages that have title cards.
    if (elements.length === 0) {
      if (panel && !panel.hidden) {
        panel.hidden = true;
      }
      return;
    }
    ensurePanel();
    cards.forEach(processCard);
    updatePanelStatus();
    renderWatchLater();
  }

  function scheduleUpdate() {
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(update);
    }
  }

  async function start() {
    await Promise.all([loadCache(), loadWatchLater()]);
    chrome.storage.onChanged.addListener(onStorageChanged);
    window.addEventListener('click', onWatchLaterClick, true);
    // Prime Video is a single-page app: cards load lazily and get re-rendered,
    // so re-apply badges whenever the DOM changes.
    new MutationObserver(scheduleUpdate).observe(document.body, { childList: true, subtree: true });
    scheduleUpdate();
  }

  start();
})();
