/**
 * Microsoft Entra (Azure AD) sign-in via MSAL, popup flow.
 *
 * Why popup and not redirect: the app uses a HashRouter, and MSAL's
 * redirect flow also round-trips state through the URL hash — the two
 * fight over the hash and make redirect handling brittle on GitHub
 * Pages. Popup sign-in sidesteps that entirely: the OAuth dance happens
 * in a child window and the main app's URL is never touched. Sign-in is
 * an explicit button press (a user gesture), so popup blockers aren't a
 * problem.
 *
 * Tokens are cached in localStorage so a signed-in session survives PWA
 * restarts — important on the Pixel where the app launches from a
 * home-screen shortcut. `acquireTokenSilent` refreshes access tokens in
 * the background; we only fall back to an interactive popup when the
 * refresh token is gone or consent is required.
 */

import {
  PublicClientApplication,
  InteractionRequiredAuthError,
  type AccountInfo,
  type RedirectRequest,
} from '@azure/msal-browser';
import {
  GRAPH_AUTHORITY,
  GRAPH_CLIENT_ID,
  GRAPH_SCOPES,
} from './graphConfig';

let msalInstance: PublicClientApplication | null = null;
let initPromise: Promise<PublicClientApplication> | null = null;

/** Redirect URI must match the SPA redirect registered in Entra. */
function redirectUri(): string {
  // BASE_URL is '/MWPJM/' in production (see vite.config base), so this
  // resolves to https://<host>/MWPJM/ — exactly what's registered.
  return `${window.location.origin}${import.meta.env.BASE_URL}`;
}

/**
 * Lazily create + initialize the MSAL instance. MSAL v3+ requires an
 * explicit `initialize()` call before any other API; we memoize the
 * promise so concurrent callers share one initialization.
 */
export async function getMsal(): Promise<PublicClientApplication> {
  if (msalInstance) return msalInstance;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const instance = new PublicClientApplication({
      auth: {
        clientId: GRAPH_CLIENT_ID,
        authority: GRAPH_AUTHORITY,
        redirectUri: redirectUri(),
      },
      cache: {
        // Persist the session across app restarts (home-screen PWA).
        cacheLocation: 'localStorage',
      },
    });
    await instance.initialize();
    // Restore the previously active account if MSAL has one cached.
    const active = instance.getActiveAccount();
    if (!active) {
      const all = instance.getAllAccounts();
      if (all.length > 0) instance.setActiveAccount(all[0]);
    }
    msalInstance = instance;
    return instance;
  })();

  return initPromise;
}

/** The currently signed-in account, or null if nobody is signed in. */
export async function getAccount(): Promise<AccountInfo | null> {
  const msal = await getMsal();
  return msal.getActiveAccount() ?? msal.getAllAccounts()[0] ?? null;
}

/** Friendly display name / username for the signed-in account. */
export async function getAccountLabel(): Promise<string | null> {
  const acct = await getAccount();
  if (!acct) return null;
  return acct.name || acct.username || null;
}

/** Interactive sign-in via popup. Returns the signed-in account. */
export async function signIn(): Promise<AccountInfo> {
  const msal = await getMsal();
  const result = await msal.loginPopup({ scopes: GRAPH_SCOPES });
  msal.setActiveAccount(result.account);
  return result.account;
}

/** Sign out and clear the cached session for this account. */
export async function signOut(): Promise<void> {
  const msal = await getMsal();
  const account = msal.getActiveAccount() ?? undefined;
  // logoutPopup clears MSAL's cache; account hint avoids the
  // account-picker step on the way out.
  await msal.logoutPopup({ account });
  msal.setActiveAccount(null);
}

/**
 * Acquire a Graph access token. Tries silent refresh first; only opens
 * an interactive popup when MSAL says interaction is required (expired
 * refresh token, new consent needed). Throws if nobody is signed in.
 */
export async function getGraphToken(): Promise<string> {
  const msal = await getMsal();
  const account = msal.getActiveAccount() ?? msal.getAllAccounts()[0];
  if (!account) {
    throw new Error('Not signed in to Microsoft. Sign in first.');
  }
  const request = { scopes: GRAPH_SCOPES, account };
  try {
    const result = await msal.acquireTokenSilent(request);
    return result.accessToken;
  } catch (e) {
    if (e instanceof InteractionRequiredAuthError) {
      const result = await msal.acquireTokenPopup(
        request as RedirectRequest,
      );
      return result.accessToken;
    }
    throw e;
  }
}
