const state = {
  snapshot: null,
  searchTimer: null,
  activeView: "overview"
};

const elements = {};

document.addEventListener("DOMContentLoaded", () => {
  cacheElements();
  bindEvents();
  loadSnapshot();
});

function cacheElements() {
  for (const id of [
    "syncStatus",
    "refreshButton",
    "optionsButton",
    "totalTabs",
    "duplicateTabs",
    "inactiveTabs",
    "memoryUsed",
    "searchInput",
    "searchButton",
    "searchResults",
    "groupTabsButton",
    "closeDuplicatesButton",
    "duplicateSummary",
    "duplicateList",
    "memorySummary",
    "memoryMeter",
    "memoryList",
    "saveSessionForm",
    "sessionName",
    "sessionList",
    "autoCloseState",
    "autoCloseThreshold",
    "autoCloseBehavior",
    "runAutoCloseButton",
    "openAutoOptionsButton"
  ]) {
    elements[id] = document.getElementById(id);
  }
  elements.viewTabs = [...document.querySelectorAll(".view-tab")];
  elements.viewPanels = [...document.querySelectorAll(".view-panel")];
}

function bindEvents() {
  elements.refreshButton.addEventListener("click", () => loadSnapshot());
  elements.optionsButton.addEventListener("click", () => chrome.runtime.openOptionsPage());
  elements.openAutoOptionsButton.addEventListener("click", () => chrome.runtime.openOptionsPage());
  elements.groupTabsButton.addEventListener("click", () => groupTabs());
  elements.closeDuplicatesButton.addEventListener("click", () => closeDuplicates());
  elements.searchButton.addEventListener("click", () => runSearch());
  elements.searchInput.addEventListener("input", () => {
    window.clearTimeout(state.searchTimer);
    state.searchTimer = window.setTimeout(runSearch, 180);
  });
  elements.searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      runSearch();
    }
  });
  elements.saveSessionForm.addEventListener("submit", (event) => {
    event.preventDefault();
    saveSession();
  });
  elements.runAutoCloseButton.addEventListener("click", () => runAutoCloseNow());
  for (const tab of elements.viewTabs) {
    tab.addEventListener("click", () => setActiveView(tab.dataset.view));
  }
}

async function loadSnapshot() {
  setStatus("Refreshing...");
  try {
    state.snapshot = await sendMessage("getSnapshot");
    renderSnapshot();
    await runSearch();
    setStatus("Ready");
  } catch (error) {
    setStatus(error.message || "Could not load");
  }
}

async function groupTabs() {
  await runButtonTask(elements.groupTabsButton, async () => {
    const result = await sendMessage("groupTabs");
    setStatus(`Grouped ${result.groupedTabCount || 0} tabs`);
    await loadSnapshot();
  });
}

async function closeDuplicates() {
  await runButtonTask(elements.closeDuplicatesButton, async () => {
    const result = await sendMessage("closeDuplicateTabs");
    const skipped = result.skippedPinned ? `, skipped ${result.skippedPinned} pinned` : "";
    setStatus(`Closed ${result.closed || 0}${skipped}`);
    await loadSnapshot();
  });
}

async function runAutoCloseNow() {
  await runButtonTask(elements.runAutoCloseButton, async () => {
    const result = await sendMessage("runAutoCloseNow");
    const changed = result.discarded ? `Discarded ${result.discarded}` : `Closed ${result.closed || 0}`;
    setStatus(changed);
    await loadSnapshot();
  });
}

async function saveSession() {
  await runButtonTask(document.getElementById("saveSessionButton"), async () => {
    await sendMessage("saveSession", { name: elements.sessionName.value });
    elements.sessionName.value = "";
    setStatus("Session saved");
    await loadSnapshot();
    setActiveView("sessions");
  });
}

async function restoreSession(sessionId) {
  const result = await sendMessage("restoreSession", { sessionId });
  setStatus(`Opened ${result.openedTabs || 0} tabs`);
  await loadSnapshot();
}

async function deleteSession(sessionId) {
  await sendMessage("deleteSession", { sessionId });
  setStatus("Session deleted");
  await loadSnapshot();
}

async function runSearch() {
  const query = elements.searchInput.value.trim();
  try {
    const data = await sendMessage("searchTabs", { query });
    renderSearchResults(data.results || [], query);
  } catch (error) {
    renderEmpty(elements.searchResults, error.message || "Search failed");
  }
}

function renderSnapshot() {
  const snapshot = state.snapshot;
  if (!snapshot) {
    return;
  }

  elements.totalTabs.textContent = formatCompact(snapshot.stats.totalTabs);
  elements.duplicateTabs.textContent = formatCompact(snapshot.stats.duplicateTabs);
  elements.inactiveTabs.textContent = formatCompact(snapshot.stats.inactiveTabs);
  elements.memoryUsed.textContent = snapshot.stats.systemMemoryUsedPercent === null ? "--" : `${snapshot.stats.systemMemoryUsedPercent}%`;

  renderDuplicates(snapshot.duplicates || []);
  renderMemory(snapshot);
  renderSessions(snapshot.sessions || []);
  renderAutomation(snapshot.settings);
}

function renderDuplicates(duplicates) {
  elements.duplicateSummary.textContent = duplicates.length ? `${duplicates.length} sets` : "Clean";
  elements.closeDuplicatesButton.disabled = duplicates.length === 0;
  elements.duplicateList.replaceChildren();

  if (duplicates.length === 0) {
    renderEmpty(elements.duplicateList, "No duplicate tabs found.");
    return;
  }

  for (const group of duplicates.slice(0, 5)) {
    const item = createResultItem({
      title: group.title,
      meta: `${group.tabs.length} copies · ${group.domain || "unknown site"}`,
      actions: [
        {
          label: "Open",
          onClick: () => focusTab(group.tabs[0])
        }
      ]
    });
    elements.duplicateList.append(item);
  }
}

function renderMemory(snapshot) {
  const memory = snapshot.memory || {};
  const percent = memory.system && memory.system.usedPercent !== null ? memory.system.usedPercent : 0;
  elements.memorySummary.textContent = memory.perTabAvailable ? formatBytes(snapshot.stats.tabMemoryBytes) : "System only";
  elements.memoryMeter.style.width = `${Math.min(100, Math.max(0, percent))}%`;
  elements.memoryList.replaceChildren();

  const topTabs = [...(snapshot.tabs || [])]
    .filter((tab) => tab.memoryBytes)
    .sort((a, b) => (b.memoryBytes || 0) - (a.memoryBytes || 0))
    .slice(0, 5);

  if (topTabs.length === 0) {
    const note = memory.note || "Chrome did not expose per-tab memory.";
    renderEmpty(elements.memoryList, note);
    return;
  }

  for (const tab of topTabs) {
    elements.memoryList.append(
      createResultItem({
        title: tab.title,
        meta: `${formatBytes(tab.memoryBytes)} · ${tab.domain || "local"} · ${formatAgo(tab.lastAccessed)}`,
        actions: [
          {
            label: "Open",
            onClick: () => focusTab(tab)
          },
          {
            label: "Sleep",
            onClick: () => discardTab(tab)
          }
        ]
      })
    );
  }
}

function renderSessions(sessions) {
  elements.sessionList.replaceChildren();
  if (sessions.length === 0) {
    renderEmpty(elements.sessionList, "No saved sessions yet.");
    return;
  }

  for (const session of sessions) {
    const item = createResultItem({
      title: session.name,
      meta: `${session.tabCount || 0} tabs · ${session.windowCount || 0} windows · ${formatDate(session.createdAt)}`,
      actions: [
        {
          label: "Restore",
          onClick: () => restoreSession(session.id)
        },
        {
          label: "Delete",
          danger: true,
          onClick: () => deleteSession(session.id)
        }
      ]
    });
    elements.sessionList.append(item);
  }
}

function renderAutomation(settings) {
  const hours = Math.round((settings.inactivityMinutes / 60) * 10) / 10;
  elements.autoCloseState.textContent = settings.autoCloseEnabled ? "On" : "Off";
  elements.autoCloseThreshold.textContent = `Threshold: ${hours} ${hours === 1 ? "hour" : "hours"}`;
  elements.autoCloseBehavior.textContent = settings.discardInsteadOfClose ? "Inactive tabs sleep first" : "Inactive tabs close";
}

function renderSearchResults(results, query) {
  elements.searchResults.replaceChildren();
  if (!query && results.length === 0) {
    return;
  }
  if (results.length === 0) {
    renderEmpty(elements.searchResults, "No matching tabs.");
    return;
  }
  for (const tab of results.slice(0, query ? 12 : 5)) {
    const reason = tab.reasons && tab.reasons.length ? ` · ${tab.reasons.join(", ")}` : "";
    const item = createResultItem({
      title: tab.title,
      meta: `${tab.domain || "local"} · ${formatAgo(tab.lastAccessed)}${reason}`,
      actions: [
        {
          label: "Open",
          onClick: () => focusTab(tab)
        }
      ]
    });
    elements.searchResults.append(item);
  }
}

function createResultItem({ title, meta, actions }) {
  const item = document.createElement("article");
  item.className = "result-item";

  const main = document.createElement("div");
  main.className = "result-main";

  const titleNode = document.createElement("div");
  titleNode.className = "result-title";
  titleNode.textContent = title || "Untitled";

  const metaNode = document.createElement("div");
  metaNode.className = "result-meta";
  metaNode.textContent = meta || "";

  main.append(titleNode, metaNode);
  item.append(main);

  const actionWrap = document.createElement("div");
  actionWrap.className = "result-actions";
  for (const action of actions || []) {
    const button = document.createElement("button");
    button.className = action.danger ? "mini-button danger" : "mini-button";
    button.type = "button";
    button.textContent = action.label;
    button.addEventListener("click", action.onClick);
    actionWrap.append(button);
  }
  item.append(actionWrap);
  return item;
}

function renderEmpty(parent, text) {
  parent.replaceChildren();
  const empty = document.createElement("div");
  empty.className = "empty-state";
  empty.textContent = text;
  parent.append(empty);
}

async function focusTab(tab) {
  await sendMessage("focusTab", { tabId: tab.id, windowId: tab.windowId });
  window.close();
}

async function discardTab(tab) {
  await sendMessage("discardTab", { tabId: tab.id });
  setStatus("Tab sent to sleep");
  await loadSnapshot();
}

function setActiveView(view) {
  state.activeView = view;
  for (const tab of elements.viewTabs) {
    tab.classList.toggle("active", tab.dataset.view === view);
  }
  for (const panel of elements.viewPanels) {
    panel.classList.toggle("active", panel.id === `${view}View`);
  }
}

async function runButtonTask(button, task) {
  button.classList.add("is-busy");
  button.disabled = true;
  try {
    await task();
  } catch (error) {
    setStatus(error.message || "Action failed");
  } finally {
    button.disabled = false;
    button.classList.remove("is-busy");
  }
}

function sendMessage(type, payload = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, ...payload }, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      if (!response || !response.ok) {
        reject(new Error((response && response.error) || "Request failed"));
        return;
      }
      resolve(response.data);
    });
  });
}

function setStatus(text) {
  elements.syncStatus.textContent = text;
}

function formatBytes(bytes) {
  if (!bytes) {
    return "--";
  }
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value >= 10 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
}

function formatCompact(value) {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value || 0);
}

function formatAgo(timestamp) {
  if (!timestamp) {
    return "unknown";
  }
  const seconds = Math.max(1, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function formatDate(timestamp) {
  if (!timestamp) {
    return "unknown";
  }
  return new Date(timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}
