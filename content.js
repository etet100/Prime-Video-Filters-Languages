// Prime Video Better Search - content script.
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
// A small panel lets the user hide titles that fail any of the checks, and choose
// the language (used for the audio and subtitles checks and for the panel's own texts).
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
  const DEFAULT_LANGUAGE = 'pl';

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
      hidden: 'Ukryte',
      checking: 'sprawdzanie',
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
      hidden: 'Hidden',
      checking: 'checking',
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
      hidden: 'Ausgeblendet',
      checking: 'Prüfung',
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
      hidden: 'Ocultos',
      checking: 'comprobando',
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
      hidden: 'Masqués',
      checking: 'vérification',
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
      hidden: 'Nascosti',
      checking: 'verifica',
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
      hidden: 'Skryto',
      checking: 'kontrola',
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

  // The browser's language if the extension supports it, otherwise Polish.
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
    return { language: TRACK_LANGUAGES[saved.language] ? saved.language : browserLanguage() };
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
      console.warn('[Prime Video Better Search] cache could not be loaded:', e);
    }
  }

  function writeCache(id, entry) {
    cache.set(id, entry);
    try {
      chrome.storage.local.set({ [CACHE_PREFIX + id]: entry }).catch((e) => {
        console.warn('[Prime Video Better Search] cache write failed:', e);
      });
    } catch (e) {
      // The extension was reloaded while this tab stayed open - the cache is not reachable.
    }
  }

  // Titles fetched in another Prime Video tab become known here too.
  function onStorageChanged(changes, area) {
    if (area !== 'local') {
      return;
    }
    let changed = false;
    for (const [key, change] of Object.entries(changes)) {
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
    const tracks = findAudioTracks(data);
    if (!tracks) {
      throw new Error('audioTracks not found in the response');
    }
    return { tracks, subtitles: findSubtitles(data), entitled: findEntitlement(data), time: Date.now() };
  }

  // The tracks live in body.atf.state.detail.headerDetail[<title id>].audioTracks;
  // fall back to a deep search in case the layout changes.
  function findAudioTracks(data) {
    const header = data?.body?.atf?.state?.detail?.headerDetail;
    if (header) {
      for (const item of Object.values(header)) {
        if (Array.isArray(item?.audioTracks)) {
          return item.audioTracks;
        }
      }
    }
    return deepFindAudioTracks(data);
  }

  // The subtitles live next to the audio tracks, in headerDetail[<title id>].subtitles.
  // A title without subtitles may have no such key, which counts as an empty list.
  function findSubtitles(data) {
    const header = data?.body?.atf?.state?.detail?.headerDetail;
    if (header) {
      for (const item of Object.values(header)) {
        if (Array.isArray(item?.audioTracks)) {
          return Array.isArray(item.subtitles) ? item.subtitles : [];
        }
      }
    }
    return [];
  }

  function deepFindAudioTracks(node) {
    if (!node || typeof node !== 'object') {
      return null;
    }
    if (Array.isArray(node.audioTracks)) {
      return node.audioTracks;
    }
    for (const value of Object.values(node)) {
      const found = deepFindAudioTracks(value);
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

  // Rebuilds the queue, in this order: the title of the detail page being viewed, then
  // the cards on or near the screen, then - only when a filter needs their data - the
  // cards within one screen of it. Each group is in page order. With a filter on, hidden
  // cards make the next ones move up into these zones, so they get checked in turn
  // (except in virtualized grids, where hidden cards leave empty slots).
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
          console.warn(`[Prime Video Better Search] check failed for ${id}:`, error);
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
    renderBadges(card, kind, entitled, status, subtitleStatus);

    if (kind.hideable) {
      const hidden = (filters.entitled && entitled === false) || (filters.audio && status === 'no') ||
        (filters.subtitles && subtitleStatus === 'no');
      // A card the filters cannot decide on yet is dimmed until its check finishes.
      // A failed check counts as finished, so the card does not stay dimmed.
      const unchecked = !hidden && filtersNeedDetail(info) && !getEntry(id) && pending.get(id) !== 'error';
      const virtual = isVirtualGrid(card);
      setClass(getHideTarget(card), 'apbs-hidden', hidden && !virtual);
      setClass(card, 'apbs-empty-slot', hidden && virtual);
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

  function renderBadges(card, kind, entitled, status, subtitleStatus) {
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
  }

  // A badge group: the extension's icon, a separator line and the three badges.
  function createBadgeGroup(variant) {
    const box = document.createElement('div');
    box.className = `apbs-badges ${variant}`;
    const logo = document.createElement('span');
    logo.className = 'apbs-logo';
    const list = document.createElement('span');
    list.className = 'apbs-badge-list';
    list.append(
      document.createElement('span'),
      document.createElement('span'),
      document.createElement('span'),
    );
    box.append(logo, list);
    return box;
  }

  function setBadges(box, entitled, status, subtitleStatus) {
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
    const code = TRACK_LANGUAGES[settings.language].code;
    const title = document.createElement('div');
    title.className = 'apbs-title';
    title.textContent = 'Prime Video Better Search';
    panel.append(
      title,
      createLanguageSelect(),
      createCheckbox('entitled', texts.filterEntitled),
      createCheckbox('audio', texts.filterAudio(code)),
      createCheckbox('subtitles', texts.filterSubtitles(code)),
    );
    const status = document.createElement('div');
    status.className = 'apbs-status';
    panel.append(status);
    document.body.append(panel);
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
      settings = { language: select.value };
      texts = TEXTS[settings.language];
      saveSettings();
      panel.remove();
      panel = null;
      scheduleUpdate();
    });
    label.append(select);
    return label;
  }

  function updatePanelStatus() {
    const status = panel && panel.querySelector('.apbs-status');
    if (!status) {
      return;
    }
    const hiddenCount = document.querySelectorAll('.apbs-hidden, .apbs-empty-slot').length;
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
    setBadges(banner, entitled, getLanguageStatus(id, 'tracks'), getLanguageStatus(id, 'subtitles'));
  }

  function update() {
    scheduled = false;
    forgetRemovedCards();
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
  }

  function scheduleUpdate() {
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(update);
    }
  }

  async function start() {
    await loadCache();
    chrome.storage.onChanged.addListener(onStorageChanged);
    // Prime Video is a single-page app: cards load lazily and get re-rendered,
    // so re-apply badges whenever the DOM changes.
    new MutationObserver(scheduleUpdate).observe(document.body, { childList: true, subtree: true });
    scheduleUpdate();
  }

  start();
})();
