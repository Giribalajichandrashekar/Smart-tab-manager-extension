const controls = {};

document.addEventListener("DOMContentLoaded", async () => {
  for (const id of [
    "settingsForm",
    "status",
    "autoCloseEnabled",
    "inactivityMinutes",
    "discardInsteadOfClose",
    "skipPinned",
    "skipAudible",
    "skipGrouped",
    "skipInternalUrls",
    "maxSessions",
    "exportButton",
    "importFile",
    "runNowButton"
  ]) {
    controls[id] = document.getElementById(id);
  }

  controls.settingsForm.addEventListener("submit", saveOptions);
  controls.exportButton.addEventListener("click", exportData);
  controls.importFile.addEventListener("change", importData);
  controls.runNowButton.addEventListener("click", runAutoCloseNow);

  await loadOptions();
});

async function loadOptions() {
  setStatus("Loading...");
  const settings = await sendMessage("getSettings");
  controls.autoCloseEnabled.checked = Boolean(settings.autoCloseEnabled);
  controls.inactivityMinutes.value = String(settings.inactivityMinutes || 240);
  controls.discardInsteadOfClose.checked = Boolean(settings.discardInsteadOfClose);
  controls.skipPinned.checked = Boolean(settings.skipPinned);
  controls.skipAudible.checked = Boolean(settings.skipAudible);
  controls.skipGrouped.checked = Boolean(settings.skipGrouped);
  controls.skipInternalUrls.checked = Boolean(settings.skipInternalUrls);
  controls.maxSessions.value = String(settings.maxSessions || 25);
  setStatus("Options");
}

async function saveOptions(event) {
  event.preventDefault();
  setStatus("Saving...");
  const settings = {
    autoCloseEnabled: controls.autoCloseEnabled.checked,
    inactivityMinutes: Number(controls.inactivityMinutes.value),
    discardInsteadOfClose: controls.discardInsteadOfClose.checked,
    skipPinned: controls.skipPinned.checked,
    skipAudible: controls.skipAudible.checked,
    skipGrouped: controls.skipGrouped.checked,
    skipInternalUrls: controls.skipInternalUrls.checked,
    maxSessions: Number(controls.maxSessions.value)
  };
  await sendMessage("saveSettings", { settings });
  setStatus("Saved");
}

async function exportData() {
  setStatus("Exporting...");
  const data = await sendMessage("exportData");
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `smart-tab-manager-export-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
  setStatus("Exported");
}

async function importData(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) {
    return;
  }
  setStatus("Importing...");
  try {
    const text = await file.text();
    const payload = JSON.parse(text);
    await sendMessage("importData", { payload });
    await loadOptions();
    setStatus("Imported");
  } catch (error) {
    setStatus(error.message || "Import failed");
  } finally {
    event.target.value = "";
  }
}

async function runAutoCloseNow() {
  setStatus("Running...");
  const result = await sendMessage("runAutoCloseNow");
  const count = result.discarded || result.closed || 0;
  setStatus(`Handled ${count} tabs`);
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
  controls.status.textContent = text;
}
