const DEFAULT_SETTINGS = {
  autoCloseEnabled: false,
  inactivityMinutes: 240,
  discardInsteadOfClose: true,
  skipPinned: true,
  skipAudible: true,
  skipGrouped: false,
  skipInternalUrls: true,
  maxSessions: 25,
  lastAutoCloseRun: 0
};

const ALARM_AUTO_CLOSE = "smart-tab-manager:auto-close";
const TAB_GROUP_NONE = -1;
const DUPLICATE_PARAM_PREFIXES = ["utm_"];
const DUPLICATE_PARAMS = new Set(["fbclid", "gclid", "mc_cid", "mc_eid", "igshid", "ref", "ref_src"]);

const CATEGORY_RULES = [
  {
    key: "developer",
    label: "Code",
    color: "purple",
    domains: ["github.com", "gitlab.com", "bitbucket.org", "stackoverflow.com", "stackexchange.com", "npmjs.com", "developer.mozilla.org", "vercel.com", "netlify.app", "localhost", "127.0.0.1"],
    terms: ["api", "docs", "typescript", "javascript", "python", "react", "node", "docker", "kubernetes", "repository", "pull request"]
  },
  {
    key: "documents",
    label: "Docs",
    color: "blue",
    domains: ["docs.google.com", "drive.google.com", "notion.so", "office.com", "sharepoint.com", "dropbox.com", "confluence", "figma.com"],
    terms: ["document", "spreadsheet", "sheet", "slides", "notion", "proposal", "brief", "spec"]
  },
  {
    key: "work",
    label: "Work",
    color: "cyan",
    domains: ["slack.com", "teams.microsoft.com", "zoom.us", "meet.google.com", "jira", "asana.com", "trello.com", "linear.app", "monday.com"],
    terms: ["meeting", "calendar", "project", "ticket", "task", "sprint", "roadmap"]
  },
  {
    key: "mail",
    label: "Mail",
    color: "green",
    domains: ["mail.google.com", "outlook.live.com", "outlook.office.com", "mail.yahoo.com", "proton.me"],
    terms: ["inbox", "email", "mail"]
  },
  {
    key: "research",
    label: "Research",
    color: "yellow",
    domains: ["wikipedia.org", "medium.com", "arxiv.org", "scholar.google.com", "researchgate.net", "jstor.org", "substack.com"],
    terms: ["paper", "article", "study", "research", "journal", "guide", "tutorial", "learn"]
  },
  {
    key: "shopping",
    label: "Shopping",
    color: "orange",
    domains: ["amazon.", "flipkart.com", "ebay.", "etsy.com", "shopify.com", "myntra.com", "walmart.com", "target.com"],
    terms: ["cart", "checkout", "price", "buy", "order", "deal", "coupon"]
  },
  {
    key: "media",
    label: "Media",
    color: "red",
    domains: ["youtube.com", "netflix.com", "spotify.com", "twitch.tv", "primevideo.com", "hotstar.com", "hulu.com", "vimeo.com"],
    terms: ["video", "watch", "playlist", "stream", "episode", "music", "podcast"]
  },
  {
    key: "social",
    label: "Social",
    color: "pink",
    domains: ["x.com", "twitter.com", "facebook.com", "instagram.com", "linkedin.com", "reddit.com", "discord.com", "threads.net"],
    terms: ["feed", "profile", "post", "messages", "comments", "community"]
  },
  {
    key: "finance",
    label: "Finance",
    color: "green",
    domains: ["paypal.com", "stripe.com", "tradingview.com", "zerodha.com", "coinbase.com", "binance.com", "moneycontrol.com"],
    terms: ["bank", "invoice", "payment", "stock", "portfolio", "crypto", "tax"]
  },
  {
    key: "travel",
    label: "Travel",
    color: "blue",
    domains: ["maps.google.com", "booking.com", "airbnb.com", "makemytrip.com", "uber.com", "ola"],
    terms: ["hotel", "flight", "route", "trip", "travel", "map"]
  },
  {
    key: "news",
    label: "News",
    color: "grey",
    domains: ["news.google.com", "bbc.com", "cnn.com", "nytimes.com", "theguardian.com", "reuters.com", "indiatimes.com"],
    terms: ["news", "breaking", "latest", "headline"]
  }
];

const QUERY_ALIASES = {
  code: ["code", "github", "developer", "programming", "repo", "repository", "api"],
  docs: ["docs", "document", "drive", "notion", "sheet", "spreadsheet", "slides"],
  work: ["work", "office", "meeting", "project", "task", "ticket", "jira", "slack"],
  mail: ["mail", "email", "inbox"],
  research: ["research", "reading", "learn", "paper", "article", "tutorial"],
  shopping: ["shopping", "shop", "cart", "buy", "order", "deal"],
  media: ["media", "video", "youtube", "music", "podcast", "stream"],
  social: ["social", "reddit", "twitter", "linkedin", "instagram"],
  finance: ["finance", "money", "bank", "invoice", "stock", "crypto"],
  travel: ["travel", "flight", "hotel", "map", "trip"],
  news: ["news", "headline"]
};

chrome.runtime.onInstalled.addListener(async () => {
  await ensureStorage();
  await seedActivityForOpenTabs();
  await scheduleAutoCloseAlarm();
  await updateBadge();
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureStorage();
  await seedActivityForOpenTabs();
  await scheduleAutoCloseAlarm();
  await updateBadge();
});

chrome.tabs.onActivated.addListener((info) => {
  recordTabActivity(info.tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "complete" || changeInfo.url || changeInfo.audible !== undefined) {
    recordTabActivity(tabId);
    updateBadge();
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const { tabActivity } = await storageGet({ tabActivity: {} });
  delete tabActivity[String(tabId)];
  await storageSet({ tabActivity });
  await updateBadge();
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    return;
  }
  const tabs = await callChrome(chrome.tabs.query.bind(chrome.tabs), { active: true, windowId });
  if (tabs && tabs[0]) {
    await recordTabActivity(tabs[0].id);
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_AUTO_CLOSE) {
    await runAutoCloseSweep({ manual: false });
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
  return true;
});

async function handleMessage(message = {}) {
  switch (message.type) {
    case "getSnapshot":
      return buildSnapshot();
    case "groupTabs":
      return groupTabsSmart();
    case "closeDuplicateTabs":
      return closeDuplicateTabs();
    case "focusTab":
      return focusTab(message.tabId, message.windowId);
    case "discardTab":
      return discardTab(message.tabId);
    case "closeTabs":
      return closeTabs(message.tabIds || []);
    case "searchTabs":
      return searchTabs(message.query || "");
    case "saveSession":
      return saveSession(message.name || "");
    case "deleteSession":
      return deleteSession(message.sessionId);
    case "restoreSession":
      return restoreSession(message.sessionId);
    case "getSettings":
      return getSettings();
    case "saveSettings":
      return saveSettings(message.settings || {});
    case "runAutoCloseNow":
      return runAutoCloseSweep({ manual: true });
    case "exportData":
      return exportData();
    case "importData":
      return importData(message.payload);
    default:
      throw new Error(`Unknown message type: ${message.type}`);
  }
}

async function callChrome(fn, ...args) {
  return new Promise((resolve) => {
    try {
      const maybePromise = fn(...args);
      if (maybePromise && typeof maybePromise.then === "function") {
        maybePromise.then(resolve).catch((error) => {
          console.warn(error.message || error);
          resolve(null);
        });
        return;
      }
      resolve(maybePromise ?? null);
    } catch (_promiseStyleError) {
      try {
        fn(...args, (result) => {
          const error = chrome.runtime.lastError;
          if (error) {
            console.warn(error.message);
            resolve(null);
            return;
          }
          resolve(result);
        });
      } catch (callbackStyleError) {
        console.warn(callbackStyleError.message || callbackStyleError);
        resolve(null);
      }
    }
  });
}

async function storageGet(defaults) {
  return (await callChrome(chrome.storage.local.get.bind(chrome.storage.local), defaults)) || defaults;
}

async function storageSet(value) {
  return callChrome(chrome.storage.local.set.bind(chrome.storage.local), value);
}

async function ensureStorage() {
  const data = await storageGet({
    settings: null,
    tabActivity: null,
    savedSessions: null
  });

  const next = {};
  next.settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
  next.tabActivity = data.tabActivity || {};
  next.savedSessions = Array.isArray(data.savedSessions) ? data.savedSessions : [];
  await storageSet(next);
  return next;
}

async function getSettings() {
  const { settings } = await ensureStorage();
  return settings;
}

async function saveSettings(partial) {
  const settings = { ...DEFAULT_SETTINGS, ...(await getSettings()), ...partial };
  settings.inactivityMinutes = clampInteger(settings.inactivityMinutes, 15, 10080, DEFAULT_SETTINGS.inactivityMinutes);
  settings.maxSessions = clampInteger(settings.maxSessions, 1, 100, DEFAULT_SETTINGS.maxSessions);
  await storageSet({ settings });
  await scheduleAutoCloseAlarm();
  return settings;
}

async function scheduleAutoCloseAlarm() {
  await callChrome(chrome.alarms.create.bind(chrome.alarms), ALARM_AUTO_CLOSE, {
    periodInMinutes: 5
  });
}

async function seedActivityForOpenTabs() {
  const now = Date.now();
  const [tabs, data] = await Promise.all([
    callChrome(chrome.tabs.query.bind(chrome.tabs), {}),
    storageGet({ tabActivity: {} })
  ]);
  const tabActivity = data.tabActivity || {};
  for (const tab of tabs || []) {
    if (tab.id !== undefined && !tabActivity[String(tab.id)]) {
      tabActivity[String(tab.id)] = now;
    }
  }
  await storageSet({ tabActivity });
}

async function recordTabActivity(tabId) {
  if (tabId === undefined || tabId === null) {
    return;
  }
  const { tabActivity } = await storageGet({ tabActivity: {} });
  tabActivity[String(tabId)] = Date.now();
  await storageSet({ tabActivity });
}

async function updateBadge() {
  const tabs = (await callChrome(chrome.tabs.query.bind(chrome.tabs), {})) || [];
  const text = tabs.length > 99 ? "99+" : String(tabs.length);
  await callChrome(chrome.action.setBadgeText.bind(chrome.action), { text });
  await callChrome(chrome.action.setBadgeBackgroundColor.bind(chrome.action), { color: "#0f8b8d" });
}

async function buildSnapshot() {
  const [tabs, groups, memoryReport, data] = await Promise.all([
    callChrome(chrome.tabs.query.bind(chrome.tabs), {}),
    queryGroups(),
    getMemoryReport(),
    storageGet({
      tabActivity: {},
      settings: DEFAULT_SETTINGS,
      savedSessions: []
    })
  ]);

  const openTabs = tabs || [];
  const tabActivity = data.tabActivity || {};
  const settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
  const duplicates = buildDuplicateGroups(openTabs, tabActivity, memoryReport.byTab);
  const duplicateKeyCounts = new Map(duplicates.map((group) => [group.key, group.tabs.length]));
  const now = Date.now();
  const enrichedTabs = openTabs.map((tab) => {
    const normalizedUrl = normalizeUrl(tab.url || "");
    const category = classifyTab(tab);
    const lastAccessed = tabActivity[String(tab.id)] || now;
    return {
      id: tab.id,
      windowId: tab.windowId,
      index: tab.index,
      groupId: tab.groupId ?? TAB_GROUP_NONE,
      title: tab.title || tab.url || "Untitled",
      url: tab.url || "",
      favIconUrl: tab.favIconUrl || "",
      pinned: Boolean(tab.pinned),
      active: Boolean(tab.active),
      audible: Boolean(tab.audible),
      discarded: Boolean(tab.discarded),
      domain: getDomain(tab.url || ""),
      baseDomain: getBaseDomain(getDomain(tab.url || "")),
      category,
      lastAccessed,
      normalizedUrl,
      duplicateCount: duplicateKeyCounts.get(normalizedUrl) || 0,
      memoryBytes: memoryReport.byTab[String(tab.id)] || null
    };
  });

  const inactiveCutoff = settings.inactivityMinutes * 60 * 1000;
  const inactiveTabs = enrichedTabs.filter((tab) => !tab.active && now - tab.lastAccessed >= inactiveCutoff);

  return {
    generatedAt: now,
    settings,
    tabs: enrichedTabs,
    groups: groups || [],
    duplicates,
    sessions: data.savedSessions || [],
    memory: memoryReport,
    stats: {
      totalTabs: enrichedTabs.length,
      windowCount: new Set(enrichedTabs.map((tab) => tab.windowId)).size,
      groupCount: (groups || []).length,
      duplicateGroups: duplicates.length,
      duplicateTabs: duplicates.reduce((sum, group) => sum + Math.max(0, group.tabs.length - 1), 0),
      inactiveTabs: inactiveTabs.length,
      systemMemoryUsedPercent: memoryReport.system ? memoryReport.system.usedPercent : null,
      tabMemoryBytes: Object.values(memoryReport.byTab).reduce((sum, value) => sum + value, 0)
    }
  };
}

async function queryGroups() {
  if (!chrome.tabGroups || !chrome.tabGroups.query) {
    return [];
  }
  return (await callChrome(chrome.tabGroups.query.bind(chrome.tabGroups), {})) || [];
}

async function getMemoryReport() {
  const [system, tabProcessMemory] = await Promise.all([getSystemMemory(), getTabProcessMemory()]);
  return {
    system,
    byTab: tabProcessMemory.byTab,
    processTotalBytes: tabProcessMemory.processTotalBytes,
    perTabAvailable: tabProcessMemory.available,
    note: tabProcessMemory.note
  };
}

async function getSystemMemory() {
  if (!chrome.system || !chrome.system.memory || !chrome.system.memory.getInfo) {
    return null;
  }
  const info = await callChrome(chrome.system.memory.getInfo.bind(chrome.system.memory));
  if (!info) {
    return null;
  }
  const capacity = Number(info.capacity || 0);
  const available = Number(info.availableCapacity || 0);
  const used = Math.max(0, capacity - available);
  return {
    capacity,
    available,
    used,
    usedPercent: capacity > 0 ? Math.round((used / capacity) * 100) : null
  };
}

async function getTabProcessMemory() {
  if (!chrome.processes || !chrome.processes.getProcessIdForTab || !chrome.processes.getProcessInfo) {
    return {
      available: false,
      byTab: {},
      processTotalBytes: 0,
      note: "Per-tab memory requires Chrome's Dev-channel processes API."
    };
  }

  const tabs = (await callChrome(chrome.tabs.query.bind(chrome.tabs), {})) || [];
  const tabIds = tabs.map((tab) => tab.id).filter((id) => Number.isInteger(id));
  const processByTab = {};
  for (const tabId of tabIds) {
    const processId = await callChrome(chrome.processes.getProcessIdForTab.bind(chrome.processes), tabId);
    if (Number.isInteger(processId)) {
      processByTab[String(tabId)] = processId;
    }
  }

  const processIds = [...new Set(Object.values(processByTab))];
  if (processIds.length === 0) {
    return {
      available: false,
      byTab: {},
      processTotalBytes: 0,
      note: "Chrome did not expose per-tab memory for these tabs."
    };
  }

  const processInfo = (await callChrome(chrome.processes.getProcessInfo.bind(chrome.processes), processIds, true)) || {};
  const byTab = {};
  let processTotalBytes = 0;
  const knownTabSet = new Set(tabIds.map(String));

  for (const process of Object.values(processInfo)) {
    const privateMemory = Number(process.privateMemory || 0);
    if (!privateMemory) {
      continue;
    }
    processTotalBytes += privateMemory;
    const processTabs = Array.isArray(process.tabs)
      ? process.tabs.map(String).filter((id) => knownTabSet.has(id))
      : Object.entries(processByTab)
          .filter(([, processId]) => processId === process.id)
          .map(([tabId]) => tabId);
    const share = Math.round(privateMemory / Math.max(1, processTabs.length));
    for (const tabId of processTabs) {
      byTab[tabId] = (byTab[tabId] || 0) + share;
    }
  }

  return {
    available: Object.keys(byTab).length > 0,
    byTab,
    processTotalBytes,
    note: "Tab memory is estimated from shared Chrome renderer processes."
  };
}

async function groupTabsSmart() {
  const tabs = (await callChrome(chrome.tabs.query.bind(chrome.tabs), {})) || [];
  const groupableTabs = tabs.filter((tab) => Number.isInteger(tab.id) && isGroupableUrl(tab.url || ""));
  const byWindow = groupBy(groupableTabs, (tab) => String(tab.windowId));
  const results = [];
  let groupedTabCount = 0;

  for (const windowTabs of Object.values(byWindow)) {
    const domainCounts = countBy(windowTabs, (tab) => getBaseDomain(getDomain(tab.url || "")));
    const buckets = {};
    for (const tab of windowTabs) {
      const category = classifyTab(tab);
      const domain = getBaseDomain(getDomain(tab.url || ""));
      const shouldUseDomain = domain && domainCounts[domain] >= 3 && !isGenericDomain(domain);
      const key = shouldUseDomain ? `domain:${domain}` : category.key;
      const title = shouldUseDomain ? prettyDomain(domain) : category.label;
      const color = category.color || "grey";
      if (!buckets[key]) {
        buckets[key] = { title, color, tabIds: [] };
      }
      buckets[key].tabIds.push(tab.id);
    }

    for (const bucket of Object.values(buckets)) {
      if (bucket.tabIds.length < 2) {
        continue;
      }
      const groupId = await callChrome(chrome.tabs.group.bind(chrome.tabs), { tabIds: bucket.tabIds });
      if (Number.isInteger(groupId)) {
        await callChrome(chrome.tabGroups.update.bind(chrome.tabGroups), groupId, {
          title: bucket.title.slice(0, 28),
          color: bucket.color,
          collapsed: false
        });
        groupedTabCount += bucket.tabIds.length;
        results.push({
          groupId,
          title: bucket.title,
          color: bucket.color,
          tabCount: bucket.tabIds.length
        });
      }
    }
  }

  await updateBadge();
  return {
    groupCount: results.length,
    groupedTabCount,
    skippedTabCount: tabs.length - groupableTabs.length,
    groups: results
  };
}

async function closeDuplicateTabs() {
  const snapshot = await buildSnapshot();
  const idsToClose = [];
  let skippedPinned = 0;

  for (const group of snapshot.duplicates) {
    const sorted = [...group.tabs].sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.lastAccessed - a.lastAccessed;
    });
    for (const tab of sorted.slice(1)) {
      if (tab.pinned) {
        skippedPinned += 1;
        continue;
      }
      idsToClose.push(tab.id);
    }
  }

  await closeTabs(idsToClose);
  return {
    closed: idsToClose.length,
    skippedPinned
  };
}

async function closeTabs(tabIds) {
  const ids = [...new Set((tabIds || []).filter((id) => Number.isInteger(id)))];
  if (ids.length === 0) {
    return { closed: 0 };
  }
  await callChrome(chrome.tabs.remove.bind(chrome.tabs), ids);
  await updateBadge();
  return { closed: ids.length };
}

async function discardTab(tabId) {
  if (!Number.isInteger(tabId)) {
    throw new Error("Missing tab id.");
  }
  await callChrome(chrome.tabs.discard.bind(chrome.tabs), tabId);
  return { discarded: 1 };
}

async function focusTab(tabId, windowId) {
  if (!Number.isInteger(tabId) || !Number.isInteger(windowId)) {
    throw new Error("Missing tab or window id.");
  }
  await callChrome(chrome.windows.update.bind(chrome.windows), windowId, { focused: true });
  await callChrome(chrome.tabs.update.bind(chrome.tabs), tabId, { active: true });
  await recordTabActivity(tabId);
  return { focused: true };
}

async function runAutoCloseSweep({ manual }) {
  const settings = await getSettings();
  if (!manual && !settings.autoCloseEnabled) {
    return {
      closed: 0,
      discarded: 0,
      skipped: 0,
      reason: "Auto-close is disabled."
    };
  }

  const tabs = (await callChrome(chrome.tabs.query.bind(chrome.tabs), {})) || [];
  const { tabActivity } = await storageGet({ tabActivity: {} });
  const now = Date.now();
  const cutoffMs = settings.inactivityMinutes * 60 * 1000;
  const candidates = [];
  let skipped = 0;

  for (const tab of tabs) {
    const lastAccessed = tabActivity[String(tab.id)] || now;
    const inactive = !tab.active && now - lastAccessed >= cutoffMs;
    const protectedByUrl = settings.skipInternalUrls && isInternalUrl(tab.url || "");
    const protectedByGroup = settings.skipGrouped && tab.groupId !== undefined && tab.groupId !== TAB_GROUP_NONE;
    if (
      !inactive ||
      (settings.skipPinned && tab.pinned) ||
      (settings.skipAudible && tab.audible) ||
      protectedByGroup ||
      protectedByUrl
    ) {
      skipped += 1;
      continue;
    }
    candidates.push(tab);
  }

  let closed = 0;
  let discarded = 0;
  if (settings.discardInsteadOfClose) {
    for (const tab of candidates) {
      if (!tab.discarded) {
        await callChrome(chrome.tabs.discard.bind(chrome.tabs), tab.id);
        discarded += 1;
      }
    }
  } else {
    await closeTabs(candidates.map((tab) => tab.id));
    closed = candidates.length;
  }

  await saveSettings({ lastAutoCloseRun: now });
  await updateBadge();
  return {
    closed,
    discarded,
    skipped,
    candidateCount: candidates.length
  };
}

async function searchTabs(rawQuery) {
  const query = normalizeSearch(rawQuery);
  const snapshot = await buildSnapshot();
  if (!query) {
    return {
      query: rawQuery,
      results: snapshot.tabs
        .sort((a, b) => b.lastAccessed - a.lastAccessed)
        .slice(0, 20)
        .map((tab) => ({ ...tab, score: 0, reasons: ["recent"] }))
    };
  }

  const parsed = parseNaturalQuery(query);
  const duplicateKeys = new Set(snapshot.duplicates.map((group) => group.key));
  const now = Date.now();
  const results = [];

  for (const tab of snapshot.tabs) {
    const haystack = normalizeSearch([tab.title, tab.url, tab.domain, tab.category.label, tab.category.key].join(" "));
    let score = 0;
    const reasons = [];

    if (haystack.includes(query)) {
      score += 12;
      reasons.push("phrase");
    }

    for (const token of parsed.tokens) {
      if (haystack.includes(token)) {
        score += token.length > 3 ? 4 : 2;
      }
    }

    for (const categoryKey of parsed.categoryKeys) {
      if (tab.category.key === categoryKey) {
        score += 10;
        reasons.push(tab.category.label);
      }
    }

    if (parsed.duplicatesOnly) {
      if (duplicateKeys.has(tab.normalizedUrl)) {
        score += 15;
        reasons.push("duplicate");
      } else {
        continue;
      }
    }

    if (parsed.pinnedOnly) {
      if (tab.pinned) {
        score += 8;
        reasons.push("pinned");
      } else {
        continue;
      }
    }

    if (parsed.audibleOnly) {
      if (tab.audible) {
        score += 8;
        reasons.push("audio");
      } else {
        continue;
      }
    }

    if (parsed.inactiveMs !== null) {
      if (!tab.active && now - tab.lastAccessed >= parsed.inactiveMs) {
        score += 12;
        reasons.push("inactive");
      } else {
        continue;
      }
    }

    if (parsed.memoryOnly) {
      if (tab.memoryBytes) {
        score += Math.min(20, tab.memoryBytes / (1024 * 1024 * 50));
        reasons.push("memory");
      } else {
        score += 1;
      }
    }

    if (score > 0) {
      results.push({ ...tab, score, reasons: [...new Set(reasons)].slice(0, 3) });
    }
  }

  results.sort((a, b) => {
    if (parsed.memoryOnly) {
      return (b.memoryBytes || 0) - (a.memoryBytes || 0);
    }
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return b.lastAccessed - a.lastAccessed;
  });

  return {
    query: rawQuery,
    results: results.slice(0, 50)
  };
}

async function saveSession(rawName) {
  const [windows, groups, settingsData] = await Promise.all([
    callChrome(chrome.windows.getAll.bind(chrome.windows), { populate: true, windowTypes: ["normal"] }),
    queryGroups(),
    storageGet({ savedSessions: [], settings: DEFAULT_SETTINGS })
  ]);
  const groupInfo = new Map((groups || []).map((group) => [String(group.id), group]));
  const name = rawName.trim() || defaultSessionName();
  const sessionWindows = [];
  let tabCount = 0;

  for (const win of windows || []) {
    const tabs = (win.tabs || []).filter((tab) => tab.url);
    if (tabs.length === 0) {
      continue;
    }
    const savedTabs = tabs.map((tab) => {
      const group = tab.groupId !== undefined && tab.groupId !== TAB_GROUP_NONE ? groupInfo.get(String(tab.groupId)) : null;
      return {
        title: tab.title || tab.url || "Untitled",
        url: tab.url || "",
        pinned: Boolean(tab.pinned),
        active: Boolean(tab.active),
        group: group
          ? {
              title: group.title || classifyTab(tab).label,
              color: group.color || classifyTab(tab).color,
              collapsed: Boolean(group.collapsed)
            }
          : null
      };
    });
    tabCount += savedTabs.length;
    sessionWindows.push({
      focused: Boolean(win.focused),
      tabs: savedTabs
    });
  }

  const session = {
    id: `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    createdAt: Date.now(),
    tabCount,
    windowCount: sessionWindows.length,
    windows: sessionWindows
  };

  const savedSessions = [session, ...(settingsData.savedSessions || [])].slice(0, settingsData.settings.maxSessions || DEFAULT_SETTINGS.maxSessions);
  await storageSet({ savedSessions });
  return session;
}

async function deleteSession(sessionId) {
  const { savedSessions } = await storageGet({ savedSessions: [] });
  const next = (savedSessions || []).filter((session) => session.id !== sessionId);
  await storageSet({ savedSessions: next });
  return { deleted: savedSessions.length - next.length };
}

async function restoreSession(sessionId) {
  const { savedSessions } = await storageGet({ savedSessions: [] });
  const session = (savedSessions || []).find((item) => item.id === sessionId);
  if (!session) {
    throw new Error("Session not found.");
  }

  let openedTabs = 0;
  let skippedTabs = 0;
  let firstWindowId = null;

  for (const savedWindow of session.windows || []) {
    const restorableTabs = [];
    for (const savedTab of savedWindow.tabs || []) {
      if (isRestorableUrl(savedTab.url)) {
        restorableTabs.push(savedTab);
      } else {
        skippedTabs += 1;
      }
    }
    if (restorableTabs.length === 0) {
      continue;
    }

    const createdWindow = await callChrome(chrome.windows.create.bind(chrome.windows), {
      url: restorableTabs.map((tab) => tab.url),
      focused: false
    });
    if (!createdWindow || !createdWindow.id) {
      skippedTabs += restorableTabs.length;
      continue;
    }
    if (firstWindowId === null) {
      firstWindowId = createdWindow.id;
    }

    let createdTabs = createdWindow.tabs || [];
    if (createdTabs.length === 0) {
      createdTabs = (await callChrome(chrome.tabs.query.bind(chrome.tabs), { windowId: createdWindow.id })) || [];
    }
    createdTabs.sort((a, b) => a.index - b.index);

    const groupBuckets = {};
    for (let index = 0; index < createdTabs.length; index += 1) {
      const createdTab = createdTabs[index];
      const savedTab = restorableTabs[index];
      if (!createdTab || !savedTab) {
        continue;
      }
      openedTabs += 1;
      if (savedTab.pinned) {
        await callChrome(chrome.tabs.update.bind(chrome.tabs), createdTab.id, { pinned: true });
      }
      if (savedTab.active) {
        await callChrome(chrome.tabs.update.bind(chrome.tabs), createdTab.id, { active: true });
      }
      if (savedTab.group) {
        const key = `${savedTab.group.title}:${savedTab.group.color}`;
        if (!groupBuckets[key]) {
          groupBuckets[key] = {
            ...savedTab.group,
            tabIds: []
          };
        }
        groupBuckets[key].tabIds.push(createdTab.id);
      }
    }

    for (const bucket of Object.values(groupBuckets)) {
      if (bucket.tabIds.length < 2) {
        continue;
      }
      const groupId = await callChrome(chrome.tabs.group.bind(chrome.tabs), { tabIds: bucket.tabIds });
      if (Number.isInteger(groupId)) {
        await callChrome(chrome.tabGroups.update.bind(chrome.tabGroups), groupId, {
          title: (bucket.title || "Session").slice(0, 28),
          color: bucket.color || "grey",
          collapsed: Boolean(bucket.collapsed)
        });
      }
    }
  }

  if (firstWindowId !== null) {
    await callChrome(chrome.windows.update.bind(chrome.windows), firstWindowId, { focused: true });
  }

  await seedActivityForOpenTabs();
  await updateBadge();
  return {
    openedTabs,
    skippedTabs,
    windowCount: (session.windows || []).length
  };
}

async function exportData() {
  const data = await storageGet({
    settings: DEFAULT_SETTINGS,
    savedSessions: []
  });
  return {
    exportedAt: Date.now(),
    app: "Smart Tab Manager",
    version: "1.0.0",
    settings: data.settings,
    savedSessions: data.savedSessions
  };
}

async function importData(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Import file is not valid JSON.");
  }
  const settings = { ...DEFAULT_SETTINGS, ...(payload.settings || {}) };
  const savedSessions = Array.isArray(payload.savedSessions) ? payload.savedSessions : [];
  await storageSet({ settings, savedSessions });
  return {
    settings,
    sessionCount: savedSessions.length
  };
}

function buildDuplicateGroups(tabs, tabActivity = {}, memoryByTab = {}) {
  const byUrl = {};
  for (const tab of tabs) {
    const key = normalizeUrl(tab.url || "");
    if (!key || isBlankTab(tab.url || "")) {
      continue;
    }
    if (!byUrl[key]) {
      byUrl[key] = [];
    }
    byUrl[key].push(tab);
  }

  return Object.entries(byUrl)
    .filter(([, groupTabs]) => groupTabs.length > 1)
    .map(([key, groupTabs]) => ({
      key,
      title: groupTabs[0].title || key,
      domain: getDomain(groupTabs[0].url || ""),
      tabs: groupTabs.map((tab) => ({
        id: tab.id,
        windowId: tab.windowId,
        title: tab.title || tab.url || "Untitled",
        url: tab.url || "",
        pinned: Boolean(tab.pinned),
        active: Boolean(tab.active),
        lastAccessed: tabActivity[String(tab.id)] || 0,
        memoryBytes: memoryByTab[String(tab.id)] || null
      }))
    }));
}

function classifyTab(tab) {
  const url = tab.url || "";
  const host = getDomain(url);
  const text = normalizeSearch(`${host} ${tab.title || ""} ${url}`);

  if (isLocalUrl(url)) {
    return {
      key: "developer",
      label: "Code",
      color: "purple"
    };
  }

  for (const rule of CATEGORY_RULES) {
    if (rule.domains.some((domain) => domainMatches(host, domain)) || rule.terms.some((term) => text.includes(term))) {
      return {
        key: rule.key,
        label: rule.label,
        color: rule.color
      };
    }
  }

  return {
    key: "general",
    label: "General",
    color: "grey"
  };
}

function parseNaturalQuery(query) {
  const tokens = query.split(/\s+/).filter((token) => token.length > 1);
  const categoryKeys = new Set();

  for (const [category, aliases] of Object.entries(QUERY_ALIASES)) {
    if (aliases.some((alias) => query.includes(alias))) {
      categoryKeys.add(category === "docs" ? "documents" : category);
    }
  }

  return {
    tokens,
    categoryKeys,
    duplicatesOnly: /\b(duplicate|duplicates|same)\b/.test(query),
    pinnedOnly: /\bpinned\b/.test(query),
    audibleOnly: /\b(audible|playing|audio|sound|music)\b/.test(query),
    memoryOnly: /\b(memory|ram|heavy|hungry|slow)\b/.test(query),
    inactiveMs: parseInactiveQuery(query)
  };
}

function parseInactiveQuery(query) {
  if (!/\b(inactive|idle|unused|old|older|stale|sleeping)\b/.test(query)) {
    return null;
  }
  const match = query.match(/(\d+)\s*(minute|minutes|min|hour|hours|hr|hrs|day|days|d)\b/);
  if (!match) {
    return 60 * 60 * 1000;
  }
  const amount = Number(match[1]);
  const unit = match[2];
  if (unit.startsWith("min")) {
    return amount * 60 * 1000;
  }
  if (unit.startsWith("day") || unit === "d") {
    return amount * 24 * 60 * 60 * 1000;
  }
  return amount * 60 * 60 * 1000;
}

function normalizeUrl(rawUrl) {
  if (!rawUrl) {
    return "";
  }
  try {
    const url = new URL(rawUrl);
    url.hash = "";
    url.hostname = url.hostname.replace(/^www\./i, "").toLowerCase();
    const params = [...url.searchParams.entries()]
      .filter(([key]) => !DUPLICATE_PARAMS.has(key.toLowerCase()) && !DUPLICATE_PARAM_PREFIXES.some((prefix) => key.toLowerCase().startsWith(prefix)))
      .sort(([a], [b]) => a.localeCompare(b));
    url.search = "";
    for (const [key, value] of params) {
      url.searchParams.append(key, value);
    }
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.toString().replace(/\/$/, "");
  } catch (_error) {
    return rawUrl.trim().toLowerCase();
  }
}

function normalizeSearch(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9:/._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getDomain(rawUrl) {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./i, "").toLowerCase();
  } catch (_error) {
    return "";
  }
}

function getBaseDomain(host) {
  if (!host) {
    return "";
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host === "localhost") {
    return host;
  }
  const parts = host.split(".");
  if (parts.length <= 2) {
    return host;
  }
  const secondLevelDomains = new Set(["co", "com", "net", "org", "gov", "ac"]);
  const maybeCountry = parts[parts.length - 1];
  const maybeSecondLevel = parts[parts.length - 2];
  if (maybeCountry.length === 2 && secondLevelDomains.has(maybeSecondLevel) && parts.length >= 3) {
    return parts.slice(-3).join(".");
  }
  return parts.slice(-2).join(".");
}

function prettyDomain(domain) {
  if (!domain) {
    return "Site";
  }
  const first = domain.split(".")[0];
  return first.charAt(0).toUpperCase() + first.slice(1);
}

function domainMatches(host, pattern) {
  if (!host) {
    return false;
  }
  if (pattern.endsWith(".")) {
    return host.includes(pattern);
  }
  return host === pattern || host.endsWith(`.${pattern}`) || host.includes(pattern);
}

function isGenericDomain(domain) {
  return ["google.com", "bing.com", "office.com", "microsoft.com"].includes(domain);
}

function isGroupableUrl(url) {
  return Boolean(url) && !isInternalUrl(url);
}

function isRestorableUrl(url) {
  return /^(https?:\/\/|chrome:\/\/newtab\/?$)/i.test(url || "");
}

function isInternalUrl(url) {
  return /^(chrome|edge|brave|vivaldi|opera|about|devtools|chrome-extension):/i.test(url || "") || isBlankTab(url);
}

function isLocalUrl(url) {
  return /^(http:\/\/localhost|http:\/\/127\.0\.0\.1|https:\/\/localhost|https:\/\/127\.0\.0\.1)/i.test(url || "");
}

function isBlankTab(url) {
  return !url || url === "about:blank" || /^chrome:\/\/newtab\/?$/i.test(url);
}

function groupBy(items, getKey) {
  return items.reduce((groups, item) => {
    const key = getKey(item);
    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push(item);
    return groups;
  }, {});
}

function countBy(items, getKey) {
  return items.reduce((counts, item) => {
    const key = getKey(item);
    if (!key) {
      return counts;
    }
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function clampInteger(value, min, max, fallback) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, number));
}

function defaultSessionName() {
  return `Session ${new Date().toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  })}`;
}
