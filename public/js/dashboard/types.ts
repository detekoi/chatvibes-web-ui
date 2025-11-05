/**
 * Shared TypeScript types for dashboard modules
 */

/**
 * User information stored in session
 */
export interface UserInfo {
  login: string;
  id: string;
  displayName: string;
}

/**
 * Dashboard context shared across modules
 */
export interface DashboardContext {
  apiBaseUrl: string;
  testMode: boolean;
}

/**
 * Services provided to dashboard modules
 */
export interface DashboardServices {
  getSessionToken: () => string | null;
  getLoggedInUser: () => UserInfo | null;
}
