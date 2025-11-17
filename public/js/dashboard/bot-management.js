import { fetchWithAuth } from "../common/api.js";
import { showToast } from "../common/ui.js";
function initBotManagement({ botStatusEl, addBotBtn, removeBotBtn }, context, services) {
  const { apiBaseUrl, testMode } = context;
  const { getSessionToken } = services;
  function updateBotStatusUI(isActive) {
    if (isActive) {
      if (botStatusEl) {
        botStatusEl.textContent = "Active";
        botStatusEl.className = "fw-semibold text-success";
      }
      if (addBotBtn) addBotBtn.style.display = "none";
      if (removeBotBtn) removeBotBtn.style.display = "inline-block";
    } else {
      if (botStatusEl) {
        botStatusEl.textContent = "Inactive";
        botStatusEl.className = "fw-semibold text-secondary";
      }
      if (addBotBtn) addBotBtn.style.display = "inline-block";
      if (removeBotBtn) removeBotBtn.style.display = "none";
    }
  }
  async function refreshStatus() {
    if (testMode) {
      updateBotStatusUI(false);
      return;
    }
    if (!getSessionToken()) {
      if (botStatusEl) botStatusEl.textContent = "Not authenticated";
      return;
    }
    try {
      const statusRes = await fetchWithAuth(`${apiBaseUrl}/api/bot/status`, { method: "GET" });
      const statusData = await statusRes.json();
      if (statusData.success) {
        updateBotStatusUI(statusData.isActive);
      } else {
        showToast(`Error: ${statusData.message}`, "error");
        if (botStatusEl) botStatusEl.textContent = "Error";
      }
    } catch (error) {
      console.error("Error fetching bot status:", error);
      const err = error;
      showToast(`Failed to load bot status. ${err.message}`, "error");
      if (botStatusEl) botStatusEl.textContent = "Error";
    }
  }
  if (addBotBtn) {
    addBotBtn.addEventListener("click", async () => {
      if (testMode) {
        showToast("TTS Service activated! (test mode)", "success");
        updateBotStatusUI(true);
        return;
      }
      if (!getSessionToken()) {
        showToast("Authentication token missing. Please log in again.", "error");
        return;
      }
      showToast("Activating TTS Service...", "info");
      try {
        const res = await fetchWithAuth(`${apiBaseUrl}/api/bot/add`, { method: "POST" });
        const data = await res.json();
        if (data.success) {
          showToast(data.message || "TTS Service activated!", "success");
          updateBotStatusUI(true);
        } else if (data.code === "not_allowed") {
          const errorText = data.details || data.message || "Channel not authorized.";
          const html = errorText.includes("https://detekoi.github.io/#contact-me") ? errorText.replace("https://detekoi.github.io/#contact-me", '<a href="https://detekoi.github.io/#contact-me" target="_blank" class="link-light">this link</a>') : `${errorText} <a href="https://detekoi.github.io/#contact-me" target="_blank" class="link-light">Request access here</a>.`;
          showToast(html, "error");
        } else {
          showToast(data.message || "Failed to activate TTS Service.", "error");
        }
      } catch (error) {
        console.error("Error activating TTS Service:", error);
        showToast("Failed to activate TTS Service.", "error");
      }
    });
  }
  if (removeBotBtn) {
    removeBotBtn.addEventListener("click", async () => {
      if (testMode) {
        showToast("TTS Service deactivated. (test mode)", "success");
        updateBotStatusUI(false);
        return;
      }
      if (!getSessionToken()) {
        showToast("Authentication token missing. Please log in again.", "error");
        return;
      }
      showToast("Deactivating TTS Service...", "info");
      try {
        const res = await fetchWithAuth(`${apiBaseUrl}/api/bot/remove`, { method: "POST" });
        const data = await res.json();
        showToast(data.message || "TTS Service deactivated.", data.success ? "success" : "error");
        if (data.success) updateBotStatusUI(false);
      } catch (error) {
        console.error("Error deactivating TTS Service:", error);
        showToast("Failed to deactivate TTS Service.", "error");
      }
    });
  }
  return { refreshStatus, updateBotStatusUI };
}
export {
  initBotManagement
};
//# sourceMappingURL=bot-management.js.map
