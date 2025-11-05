const STORAGE_KEYS = {
  login: "twitch_user_login",
  userId: "twitch_user_id",
  sessionToken: "app_session_token",
  tokenUser: "token_user",
  tokenChannel: "token_channel"
};
function logout(redirectTo = "index.html") {
  Object.values(STORAGE_KEYS).forEach((key) => localStorage.removeItem(key));
  window.location.href = redirectTo;
}
function getStoredSessionToken() {
  return localStorage.getItem(STORAGE_KEYS.sessionToken);
}
function getStoredUser() {
  const login = localStorage.getItem(STORAGE_KEYS.login);
  const id = localStorage.getItem(STORAGE_KEYS.userId);
  if (!login || !id) return null;
  return {
    login,
    id,
    displayName: login
  };
}
function storeSessionData({ login, id, sessionToken, tokenUser, tokenChannel }) {
  if (login) localStorage.setItem(STORAGE_KEYS.login, login);
  if (id) localStorage.setItem(STORAGE_KEYS.userId, id);
  if (sessionToken) localStorage.setItem(STORAGE_KEYS.sessionToken, sessionToken);
  if (tokenUser) localStorage.setItem(STORAGE_KEYS.tokenUser, tokenUser);
  if (tokenChannel) localStorage.setItem(STORAGE_KEYS.tokenChannel, tokenChannel);
}
export {
  getStoredSessionToken,
  getStoredUser,
  logout,
  storeSessionData
};
//# sourceMappingURL=auth.js.map
