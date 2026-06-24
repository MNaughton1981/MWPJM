/**
 * Microsoft Graph / Entra (Azure AD) configuration for cross-device sync.
 *
 * These IDs come from the app registration the user created in the
 * MathWorks tenant (Entra admin centre → App registrations). They are
 * NOT secrets — the client ID and tenant ID are safe to ship in a
 * public bundle. A browser single-page app authenticates with the
 * Authorization Code flow + PKCE and never holds a client secret.
 *
 * `authority` is pinned to the specific tenant (single-tenant app), so
 * only MathWorks accounts can sign in.
 *
 * If the app is ever re-registered, only these two IDs change.
 */
export const GRAPH_CLIENT_ID = 'dc05d185-0ee9-405b-94a7-b8c623661daf';
export const GRAPH_TENANT_ID = '99dd3a11-4348-4468-9bdd-e5072b1dc1e6';

export const GRAPH_AUTHORITY = `https://login.microsoftonline.com/${GRAPH_TENANT_ID}`;

/**
 * Delegated scopes requested at sign-in. `User.Read` lets us show who's
 * signed in; `Files.ReadWrite` lets the app read/write its own sync
 * file in the user's OneDrive for Business. Both are user-consentable
 * (no tenant admin approval required).
 */
export const GRAPH_SCOPES = ['User.Read', 'Files.ReadWrite'];

/**
 * Folder + file the sync snapshot is stored under, relative to the
 * signed-in user's OneDrive root. Kept in a dedicated, human-visible
 * folder (rather than a hidden app folder) so the user can see and
 * back up the file themselves in OneDrive.
 */
export const GRAPH_SYNC_FOLDER = 'MWPJM';
export const GRAPH_SYNC_FILENAME = 'mwpjm-state.json';
