/**
 * Microsoft Entra (Azure AD) sign-in via MSAL, redirect flow.
 *
 * Why redirect and not popup: popup sign-in is unreliable inside an
 * installed mobile PWA (standalone windows can't manage the popup, so
 * the auth response gets orphaned — the browser may even try to
 * "download" the response). Redirect flow navigates the app's own
 * window to the Microsoft login page and back, which is the supported
 * path for mobile / installed PWAs.
 *
 * The trade-off with the app's HashRouter is handled by consuming the
 * redirect response (`handleRedirectPromise`) during MSAL init, BEFORE
 * the router mounts (see getMsal + main.tsx), so the `#code=...` in the
 * return URL is never mistaken for an app route.
 *
 * Tokens are cached in localStorage so a signed-in session survives PWA
 * restarts. `acquireTokenSilent` refreshes access tokens in the
 * background; we only fall back to an interactive redirect when the
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
    // Process a returning sign-in/token redirect FIRST. When the user
    // comes back from the Microsoft login page, the auth response is in
    // the URL; handleRedirectPromise consumes it and hands us the
    // account. Doing this before the router mounts (see main.tsx) keeps
    // the HashRouter from mis-reading the `#code=...` response as a route.
    const redirectResult = await instance.handleRedirectPromise();
    if (redirectResult?.account) {
      instance.setActiveAccount(redirectResult.account);
    } else {
      // Restore the previously active account if MSAL has one cached.
      const active = instance.getActiveAccount();
      if (!active) {
        const all = instance.getAllAccounts();
        if (all.length > 0) instance.setActiveAccount(all[0]);
      }
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

/**
 * Start interactive sign-in. Navigates the whole window to the
 * Microsoft login page; control returns to the app at the redirect URI,
 * where getMsal()'s handleRedirectPromise picks up the account. Because
 * the page navigates away, this never resolves in the normal flow —
 * callers should not await a result from it.
 */
export async function signIn(): Promise<void> {
  const msal = await getMsal();
  await msal.loginRedirect({ scopes: GRAPH_SCOPES });
}

/** Sign out and clear the cached session for this account. */
export async function signOut(): Promise<void> {
  const msal = await getMsal();
  const account = msal.getActiveAccount() ?? undefined;
  msal.setActiveAccount(null);
  // logoutRedirect clears MSAL's cache; account hint avoids the
  // account-picker step on the way out.
  await msal.logoutRedirect({ account });
}

/**
 * Acquire a Graph access token. Tries silent refresh first; only falls
 * back to an interactive redirect when MSAL says interaction is
 * required (expired refresh token, new consent needed). Throws if
 * nobody is signed in. The redirect fallback navigates away; on return,
 * auto-sync runs again and the silent path succeeds.
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
      await msal.acquireTokenRedirect(request as RedirectRequest);
      // Navigation is underway; this line is effectively unreachable,
      // but satisfies the return type.
      throw new Error('Redirecting to Microsoft to refresh sign-in…');
    }
    throw e;
  }
}
