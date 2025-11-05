import { showToast } from "../common/ui.js";
function initIgnoreListModule(context, services) {
  const { botApiBaseUrl, testMode } = context;
  const { getLoggedInUser, getSessionToken } = services;
  let onChangeCallback = null;
  const addTtsIgnoreBtn = document.getElementById("add-tts-ignore-btn");
  const addMusicIgnoreBtn = document.getElementById("add-music-ignore-btn");
  function authHeaders() {
    const headers = { "Content-Type": "application/json" };
    const token = getSessionToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
    return headers;
  }
  function displayIgnoreList(type, users) {
    const listEl = document.getElementById(`${type}-ignore-list`);
    if (!listEl) return;
    listEl.innerHTML = "";
    if (!users || users.length === 0) {
      const li = document.createElement("li");
      li.className = "list-group-item";
      li.innerHTML = '<span class="text-muted fst-italic">No ignored users</span>';
      listEl.appendChild(li);
      return;
    }
    users.forEach((username) => {
      const li = document.createElement("li");
      li.className = "list-group-item d-flex justify-content-between align-items-center";
      const nameSpan = document.createElement("span");
      nameSpan.textContent = username;
      const btn = document.createElement("button");
      btn.className = "btn btn-outline-danger btn-sm";
      btn.type = "button";
      btn.textContent = "Remove";
      btn.addEventListener("click", () => removeFromIgnoreList(type, username));
      li.appendChild(nameSpan);
      li.appendChild(btn);
      listEl.appendChild(li);
    });
  }
  async function addToIgnoreList(type) {
    const inputEl = document.getElementById(`${type}-ignore-username`);
    const username = inputEl?.value?.trim();
    if (!username) {
      showToast("Please enter a username", "warning");
      return;
    }
    if (testMode) {
      const listEl = document.getElementById(`${type}-ignore-list`);
      if (listEl) {
        const current = Array.from(listEl.querySelectorAll("li span")).map((s) => s.textContent || "");
        current.push(username);
        displayIgnoreList(type, current);
      }
      inputEl.value = "";
      onChangeCallback?.();
      return;
    }
    const user = getLoggedInUser();
    if (!user?.login) {
      showToast("Not logged in", "error");
      return;
    }
    try {
      const channelName = user.login.toLowerCase();
      const response = await fetch(`${botApiBaseUrl}/${type}/ignore/channel/${channelName}`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ username })
      });
      if (response.ok) {
        inputEl.value = "";
        onChangeCallback?.();
      } else if (response.status === 500 || response.status === 404) {
        showToast("Settings management is not available yet. The bot needs the latest REST API endpoints.", "warning");
      } else {
        const errorData = await response.json().catch(() => ({ error: "Unknown error" }));
        showToast(`Failed to add user: ${errorData.error}`, "error");
      }
    } catch (error) {
      console.error(`Failed to add user to ${type} ignore list:`, error);
      showToast("Failed to add user to ignore list", "error");
    }
  }
  async function removeFromIgnoreList(type, username) {
    if (testMode) {
      const listEl = document.getElementById(`${type}-ignore-list`);
      if (listEl) {
        const remaining = Array.from(listEl.querySelectorAll("li span")).map((s) => s.textContent || "").filter((u) => u !== username);
        displayIgnoreList(type, remaining);
      }
      onChangeCallback?.();
      return;
    }
    const user = getLoggedInUser();
    if (!user?.login) {
      showToast("Not logged in", "error");
      return;
    }
    try {
      const channelName = user.login.toLowerCase();
      const response = await fetch(`${botApiBaseUrl}/${type}/ignore/channel/${channelName}`, {
        method: "DELETE",
        headers: authHeaders(),
        body: JSON.stringify({ username })
      });
      if (response.ok) {
        onChangeCallback?.();
      } else if (response.status === 500 || response.status === 404) {
        showToast("Settings management is not available yet. The bot needs the latest REST API endpoints.", "warning");
      } else {
        const errorData = await response.json().catch(() => ({ error: "Unknown error" }));
        showToast(`Failed to remove user: ${errorData.error}`, "error");
      }
    } catch (error) {
      console.error(`Failed to remove user from ${type} ignore list:`, error);
      showToast("Failed to remove user from ignore list", "error");
    }
  }
  if (addTtsIgnoreBtn) {
    addTtsIgnoreBtn.addEventListener("click", () => addToIgnoreList("tts"));
  }
  if (addMusicIgnoreBtn) {
    addMusicIgnoreBtn.addEventListener("click", () => addToIgnoreList("music"));
  }
  return {
    displayIgnoreList,
    setOnChange(fn) {
      onChangeCallback = typeof fn === "function" ? fn : null;
    }
  };
}
export {
  initIgnoreListModule
};
//# sourceMappingURL=ignore-list.js.map
