// packages/shared/lib/firebase/auth-manager.ts
// TODO(@arjunchint): Refresh token via secure code. Will need to spin up new firebase function with client id.
//     This will be useful for non-Chrome browsers to reduce authentication rates
import { WEB_OAUTH_CLIENT_ID, BASE_AUTH_SCOPES, DRIVE_SCOPES } from './config.js';
import { FirebaseManager } from './firebase-manager.js';
import { STORAGE_KEYS, storageManager } from '../utils/storageUtils.js';
import { GoogleAuthProvider, signInWithCredential, signOut } from 'firebase/auth';
import type { User } from 'firebase/auth';

export type AuthStrategyType = 'chrome' | 'webAuth';

interface CachedWebAuthTokens {
  idToken: string;
  accessToken: string;
  expiresAt: number;
  email?: string;
  grantedScopes?: string[];
}

export class AuthManager {
  private firebaseManager: FirebaseManager;
  private currentUser: User | null = null;
  private preferredStrategy: AuthStrategyType;
  private webAuthTokenCache: CachedWebAuthTokens | null = null;
  private webAuthCacheLoaded: Promise<void>;
  private grantedScopes: Set<string> = new Set();

  constructor() {
    this.firebaseManager = FirebaseManager.getInstance();
    this.preferredStrategy = this.detectPreferredStrategy();

    const auth = this.firebaseManager.getAuth();
    auth.onAuthStateChanged(user => {
      this.currentUser = user;
      if (user) {
        this.storeUserData(user);
      }
    });

    this.webAuthCacheLoaded = this.loadCachedWebAuthTokens();
  }

  private detectPreferredStrategy(): AuthStrategyType {
    const isChrome =
      navigator.userAgent.includes('Chrome/') &&
      !navigator.userAgent.includes('Edg/') &&
      !navigator.userAgent.includes('OPR/') &&
      !(globalThis as any).navigator?.brave &&
      !navigator.userAgent.includes('Brave/');

    const hasChromeIdentity = !!chrome?.identity?.getAuthToken;

    // console.log('[AuthManager] Browser detection:', { isChrome, hasChromeIdentity, userAgent: navigator.userAgent, });

    return isChrome && hasChromeIdentity ? 'chrome' : 'webAuth';
  }

  /**
   * Load cached web auth tokens from storage
   */
  private async loadCachedWebAuthTokens(): Promise<void> {
    try {
      const cached = await storageManager.getValue<CachedWebAuthTokens>('webAuthTokenCache');
      if (cached && cached.expiresAt > Date.now()) {
        this.webAuthTokenCache = cached;
        if (cached.grantedScopes) {
          this.grantedScopes = new Set(cached.grantedScopes);
        }
      } else if (cached) {
        await storageManager.removeValues('webAuthTokenCache');
        this.webAuthTokenCache = null;
      }

      // Also load persisted granted scopes
      const storedScopes = await storageManager.getValue<string[]>('grantedOAuthScopes');
      if (storedScopes) {
        storedScopes.forEach(s => this.grantedScopes.add(s));
      }
    } catch (error) {
      console.error('[AuthManager] Failed to load cached tokens:', error);
    }
  }

  private async saveCachedWebAuthTokens(tokens: CachedWebAuthTokens): Promise<void> {
    try {
      this.webAuthTokenCache = tokens;
      await storageManager.setValue('webAuthTokenCache', tokens);
    } catch (error) {
      console.error('[AuthManager] Failed to save tokens to cache:', error);
    }
  }

  private async saveGrantedScopes(): Promise<void> {
    try {
      await storageManager.setValue('grantedOAuthScopes', Array.from(this.grantedScopes));
    } catch (error) {
      console.error('[AuthManager] Failed to save granted scopes:', error);
    }
  }

  private async clearCachedWebAuthTokens(): Promise<void> {
    try {
      this.webAuthTokenCache = null;
      this.grantedScopes.clear();
      await storageManager.removeValues('webAuthTokenCache');
      await storageManager.removeValues('grantedOAuthScopes');
    } catch (error) {
      console.error('[AuthManager] Failed to clear cached tokens:', error);
    }
  }

  /**
   * Check if specific scopes have been granted
   */
  hasScopes(scopes: string[]): boolean {
    return scopes.every(scope => this.grantedScopes.has(scope));
  }

  /**
   * Check if drive permissions have been granted
   */
  hasDrivePermission(): boolean {
    return this.hasScopes(DRIVE_SCOPES);
  }

  /**
   * Get currently granted scopes
   */
  getGrantedScopes(): string[] {
    return Array.from(this.grantedScopes);
  }

  /**
   * Initial authentication with base scopes only
   */
  async authenticateWithGoogle(): Promise<{ user: any }> {
    try {
      await this.webAuthCacheLoaded;
      // Use BASE_AUTH_SCOPES for initial login
      const credential = await this.getGoogleCredential(BASE_AUTH_SCOPES);
      if (!credential) {
        throw new Error('Failed to get Google credential');
      }

      const auth = this.firebaseManager.getAuth();
      const userCredential = await signInWithCredential(auth, credential);
      const user = userCredential.user;

      if (!user) {
        throw new Error('Failed to sign in');
      }

      // Mark base scopes as granted
      BASE_AUTH_SCOPES.forEach(s => this.grantedScopes.add(s));
      await this.saveGrantedScopes();

      const userData = {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
        photoURL: user.photoURL,
      };

      await this.storeUserData(user);
      return { user: userData };
    } catch (error) {
      console.error('[AuthManager] Authentication failed:', error);
      throw error;
    }
  }

  /**
   * Request additional drive permissions incrementally
   * Returns true if permissions were granted, false otherwise
   */
  async requestDrivePermission(): Promise<boolean> {
    if (this.hasDrivePermission()) {
      return true;
    }

    try {
      await this.webAuthCacheLoaded;

      if (this.preferredStrategy === 'chrome') {
        try {
          return await this.requestIncrementalChromeScopes(DRIVE_SCOPES);
        } catch (error: any) {
          const errorMessage = error?.message || String(error);

          // Fall back to webAuth if Chrome Identity isn't available/working
          // (not if the user simply declined the permission)
          const shouldFallback =
            errorMessage.includes('not signed in') ||
            errorMessage.includes('turned off browser signin') ||
            errorMessage.includes('OAuth2 not granted') ||
            errorMessage.includes('not available');

          if (shouldFallback) {
            console.warn('[AuthManager] Chrome Identity not available, falling back to web auth:', error);
            return await this.requestIncrementalWebAuthScopes(DRIVE_SCOPES);
          }

          console.error('[AuthManager] Chrome incremental scope request failed:', error);
          return false;
        }
      } else {
        return await this.requestIncrementalWebAuthScopes(DRIVE_SCOPES);
      }
    } catch (error) {
      console.error('[AuthManager] Failed to request drive permission:', error);
      return false;
    }
  }

  /**
   * Request additional scopes using Chrome Identity API
   */
  private async requestIncrementalChromeScopes(additionalScopes: string[]): Promise<boolean> {
    if (!chrome?.identity?.getAuthToken) {
      throw new Error('Chrome Identity API not available');
    }

    const allScopes = [...Array.from(this.grantedScopes), ...additionalScopes];

    const { token } = await new Promise<{ token?: string }>((resolve, reject) => {
      chrome.identity.getAuthToken(
        {
          interactive: true,
          scopes: allScopes,
        },
        token => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve({ token } as { token: string });
          }
        },
      );
    });

    if (token) {
      additionalScopes.forEach(s => this.grantedScopes.add(s));
      await this.saveGrantedScopes();
      return true;
    }
    return false;
  }

  /**
   * Request additional scopes using Web Auth Flow with include_granted_scopes
   */
  private async requestIncrementalWebAuthScopes(additionalScopes: string[]): Promise<boolean> {
    if (!chrome?.identity?.launchWebAuthFlow) {
      throw new Error('Web Auth Flow API not available');
    }

    const redirectUri = chrome.identity.getRedirectURL();
    const nonce = this.generateNonce(16);

    // Combine existing granted scopes with new ones
    const allScopes = ['openid', ...Array.from(this.grantedScopes), ...additionalScopes];

    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', WEB_OAUTH_CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'id_token token');
    authUrl.searchParams.set('scope', allScopes.join(' '));
    authUrl.searchParams.set('nonce', nonce);
    // Critical: include_granted_scopes enables incremental auth
    authUrl.searchParams.set('include_granted_scopes', 'true');
    // Use consent prompt to ensure user sees the new scope request
    authUrl.searchParams.set('prompt', 'consent');

    // If we have a cached email, use login_hint for better UX
    if (this.webAuthTokenCache?.email) {
      authUrl.searchParams.set('login_hint', this.webAuthTokenCache.email);
    }

    try {
      const resultUrl = await chrome.identity.launchWebAuthFlow({
        url: authUrl.href,
        interactive: true,
      });

      if (!resultUrl) {
        return false;
      }

      const url = new URL(resultUrl);
      const params = new URLSearchParams(url.hash.substring(1));
      const idToken = params.get('id_token');
      const accessToken = params.get('access_token');
      const expiresIn = params.get('expires_in');
      const scopeParam = params.get('scope');

      if (!idToken || !accessToken) {
        return false;
      }

      // Parse returned scopes
      const returnedScopes = scopeParam ? scopeParam.split(' ') : [];

      // Verify nonce and update cache
      try {
        const tokenPayload = JSON.parse(atob(idToken.split('.')[1]));
        if (tokenPayload.nonce !== nonce) {
          throw new Error('Nonce mismatch');
        }

        const expiresInSeconds = expiresIn ? parseInt(expiresIn, 10) : 3600;
        const expiresAt = Date.now() + expiresInSeconds * 1000;

        // Update granted scopes
        returnedScopes.forEach(s => this.grantedScopes.add(s));
        additionalScopes.forEach(s => this.grantedScopes.add(s));
        await this.saveGrantedScopes();

        // Update token cache
        await this.saveCachedWebAuthTokens({
          idToken,
          accessToken,
          expiresAt,
          email: tokenPayload.email,
          grantedScopes: Array.from(this.grantedScopes),
        });

        return true;
      } catch (error) {
        console.warn('[AuthManager] Token processing failed:', error);
        return false;
      }
    } catch (error) {
      console.error('[AuthManager] Web auth incremental scope request failed:', error);
      return false;
    }
  }

  async authenticateSilently(): Promise<{ user: any } | null> {
    try {
      await this.webAuthCacheLoaded;
      const auth = this.firebaseManager.getAuth();

      if (auth.currentUser) {
        const userData = {
          uid: auth.currentUser.uid,
          email: auth.currentUser.email,
          displayName: auth.currentUser.displayName,
          photoURL: auth.currentUser.photoURL,
        };
        return { user: userData };
      }

      const credential = await this.getGoogleCredentialSilently();
      if (!credential) {
        return null;
      }

      const userCredential = await signInWithCredential(auth, credential);
      const user = userCredential.user;

      if (user) {
        const userData = {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName,
          photoURL: user.photoURL,
        };
        await this.storeUserData(user);
        return { user: userData };
      }

      return null;
    } catch (error) {
      console.warn('[AuthManager] Silent authentication failed:', error);
      return null;
    }
  }

  private async getGoogleCredential(scopes: string[] = BASE_AUTH_SCOPES): Promise<any> {
    if (this.preferredStrategy === 'chrome') {
      try {
        return await this.getChromeIdentityCredential(scopes);
      } catch (error) {
        console.warn('[AuthManager] Chrome Identity failed, falling back to web auth:', error);
        return await this.getWebAuthFlowCredential(scopes);
      }
    } else {
      return await this.getWebAuthFlowCredential(scopes);
    }
  }

  private async getGoogleCredentialSilently(): Promise<any> {
    if (this.preferredStrategy === 'chrome') {
      try {
        return await this.getChromeIdentityCredentialSilently();
      } catch (error) {
        console.warn('[AuthManager] Silent Chrome Identity failed:', error);
        return await this.getWebAuthFlowCredentialSilently();
      }
    } else {
      return await this.getWebAuthFlowCredentialSilently();
    }
  }

  private async getChromeIdentityCredential(scopes: string[] = BASE_AUTH_SCOPES): Promise<any> {
    if (!chrome?.identity?.getAuthToken) {
      throw new Error('Chrome Identity API not available');
    }

    await this.clearChromeTokens();

    const { token } = await new Promise<{ token?: string }>((resolve, reject) => {
      chrome.identity.getAuthToken(
        {
          interactive: true,
          scopes: scopes,
        },
        token => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve({ token } as { token: string });
          }
        },
      );
    });

    if (!token) {
      throw new Error('No token received from Chrome Identity');
    }

    // Mark scopes as granted
    scopes.forEach(s => this.grantedScopes.add(s));
    await this.saveGrantedScopes();

    return GoogleAuthProvider.credential(null, token);
  }

  private async getChromeIdentityCredentialSilently(): Promise<any> {
    if (!chrome?.identity?.getAuthToken) {
      throw new Error('Chrome Identity API not available');
    }

    const { token } = await new Promise<{ token?: string }>((resolve, reject) => {
      chrome.identity.getAuthToken(
        {
          interactive: false,
          scopes: Array.from(this.grantedScopes).length > 0 ? Array.from(this.grantedScopes) : BASE_AUTH_SCOPES,
        },
        token => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve({ token } as { token: string });
          }
        },
      );
    });

    if (!token) {
      throw new Error('No token received silently');
    }

    return GoogleAuthProvider.credential(null, token);
  }

  private async getWebAuthFlowCredentialSilently(): Promise<any> {
    await this.webAuthCacheLoaded;
    if (this.webAuthTokenCache && this.webAuthTokenCache.expiresAt > Date.now()) {
      return GoogleAuthProvider.credential(this.webAuthTokenCache.idToken, this.webAuthTokenCache.accessToken);
    }
    return null;
  }

  private async getWebAuthFlowCredential(
    scopes: string[] = BASE_AUTH_SCOPES,
    forceInteractive: boolean = false,
  ): Promise<any> {
    if (!chrome?.identity?.launchWebAuthFlow) {
      throw new Error('Web Auth Flow API not available');
    }

    await this.webAuthCacheLoaded;

    if (!forceInteractive && this.webAuthTokenCache && this.webAuthTokenCache.expiresAt > Date.now()) {
      return GoogleAuthProvider.credential(this.webAuthTokenCache.idToken, this.webAuthTokenCache.accessToken);
    }

    const redirectUri = chrome.identity.getRedirectURL();
    const nonce = this.generateNonce(16);

    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', WEB_OAUTH_CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'id_token token');
    authUrl.searchParams.set('scope', ['openid', ...scopes].join(' '));
    authUrl.searchParams.set('nonce', nonce);

    if (forceInteractive || !this.webAuthTokenCache) {
      authUrl.searchParams.set('prompt', 'select_account');
    } else {
      authUrl.searchParams.set('prompt', 'none');
    }

    try {
      const resultUrl = await chrome.identity.launchWebAuthFlow({
        url: authUrl.href,
        interactive: true,
      });

      if (!resultUrl) {
        throw new Error('Authentication was cancelled');
      }

      const url = new URL(resultUrl);
      const params = new URLSearchParams(url.hash.substring(1));
      const idToken = params.get('id_token');
      const accessToken = params.get('access_token');
      const expiresIn = params.get('expires_in');

      if (!idToken || !accessToken) {
        throw new Error('Failed to extract tokens from redirect');
      }

      try {
        const tokenPayload = JSON.parse(atob(idToken.split('.')[1]));
        if (tokenPayload.nonce !== nonce) {
          throw new Error('Nonce mismatch. Potential security issue.');
        }

        const expiresInSeconds = expiresIn ? parseInt(expiresIn, 10) : 3600;
        const expiresAt = Date.now() + expiresInSeconds * 1000;

        // Mark scopes as granted
        scopes.forEach(s => this.grantedScopes.add(s));
        await this.saveGrantedScopes();

        await this.saveCachedWebAuthTokens({
          idToken,
          accessToken,
          expiresAt,
          email: tokenPayload.email,
          grantedScopes: Array.from(this.grantedScopes),
        });
      } catch (error) {
        console.warn('[AuthManager] Token processing failed:', error);
      }

      return GoogleAuthProvider.credential(idToken, accessToken);
    } catch (error: any) {
      if (error.message?.includes('interaction_required') && !forceInteractive) {
        return this.getWebAuthFlowCredential(scopes, true);
      }
      throw error;
    }
  }

  /**
   * Get an OAuth token for Google APIs
   * @param requireDrive - If true, will request drive permission if not already granted
   */
  async getOAuthToken(requireDrive: boolean = false): Promise<string | undefined> {
    try {
      await this.webAuthCacheLoaded;

      // If drive is required but not granted, request it first
      if (requireDrive && !this.hasDrivePermission()) {
        const granted = await this.requestDrivePermission();
        if (!granted) {
          throw new Error('Drive permission was not granted');
        }
      }

      if (this.preferredStrategy === 'chrome') {
        try {
          return await this.getChromeOAuthToken();
        } catch (error) {
          console.warn('[AuthManager] Chrome OAuth token failed, trying web flow:', error);
          const credential = await this.getWebAuthFlowCredential(Array.from(this.grantedScopes));
          return credential.accessToken;
        }
      } else {
        if (this.webAuthTokenCache && this.webAuthTokenCache.expiresAt > Date.now()) {
          return this.webAuthTokenCache.accessToken;
        }
        const credential = await this.getWebAuthFlowCredential(Array.from(this.grantedScopes));
        return credential.accessToken;
      }
    } catch (error) {
      console.error('[AuthManager] Failed to get OAuth token:', error);
      return undefined;
    }
  }

  private async getChromeOAuthToken(): Promise<string> {
    if (!chrome?.identity?.getAuthToken) {
      throw new Error('Chrome Identity API not available');
    }

    const currentScopes = Array.from(this.grantedScopes);
    const scopesToRequest = currentScopes.length > 0 ? currentScopes : BASE_AUTH_SCOPES;

    const { token } = await new Promise<{ token?: string }>((resolve, reject) => {
      chrome.identity.getAuthToken(
        {
          interactive: true,
          scopes: scopesToRequest,
        },
        token => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve({ token } as { token: string });
          }
        },
      );
    });

    if (!token) {
      throw new Error('No OAuth token received');
    }

    return token;
  }

  private generateNonce(length: number): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  private async clearChromeTokens(): Promise<void> {
    if (this.preferredStrategy === 'chrome' && chrome?.identity?.clearAllCachedAuthTokens) {
      try {
        await new Promise<void>(resolve => {
          chrome.identity.clearAllCachedAuthTokens(() => resolve());
        });
      } catch (error) {
        console.warn('[AuthManager] Failed to clear Chrome tokens:', error);
      }
    }
  }

  private async storeUserData(user: User): Promise<void> {
    const userData = {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName,
      photoURL: user.photoURL,
    };

    await storageManager.setValues({
      [STORAGE_KEYS.USER_ID]: user.uid,
      [STORAGE_KEYS.USER]: userData,
    });
  }

  async getFirebaseIdToken(forceRefresh: boolean = false): Promise<string | null> {
    try {
      const auth = this.firebaseManager.getAuth();
      if (!auth.currentUser) return null;
      return await auth.currentUser.getIdToken(forceRefresh);
    } catch (error) {
      console.error('[AuthManager] Error getting ID token:', error);
      return null;
    }
  }

  async clearAuth(): Promise<void> {
    try {
      const auth = this.firebaseManager.getAuth();
      if (auth.currentUser) {
        await signOut(auth);
      }

      if (this.preferredStrategy === 'chrome') {
        await this.clearChromeTokens();
      } else {
        await this.clearCachedWebAuthTokens();
        try {
          await chrome.identity.launchWebAuthFlow({
            url: 'https://accounts.google.com/logout',
            interactive: false,
          });
        } catch (error) {
          console.warn('[AuthManager] Web logout flow failed:', error);
        }
      }

      this.grantedScopes.clear();
      await storageManager.removeValues([STORAGE_KEYS.USER_ID, STORAGE_KEYS.USER, 'grantedOAuthScopes']);
    } catch (error) {
      console.error('[AuthManager] Error during logout:', error);
    }
  }

  async isAuthenticated(): Promise<boolean> {
    const auth = this.firebaseManager.getAuth();
    return !!auth.currentUser;
  }

  getCurrentUser() {
    return this.currentUser;
  }

  getPreferredStrategy(): AuthStrategyType {
    return this.preferredStrategy;
  }

  async ensureAuthenticated(options: { allowInteractive?: boolean } = {}): Promise<{ user: any } | null> {
    const { allowInteractive = false } = options;

    await this.firebaseManager.waitForAuthReady?.({ timeoutMs: 10_000 }).catch(() => {});

    const auth = this.firebaseManager.getAuth();
    if (auth.currentUser) {
      return {
        user: {
          uid: auth.currentUser.uid,
          email: auth.currentUser.email,
          displayName: auth.currentUser.displayName,
          photoURL: auth.currentUser.photoURL,
        },
      };
    }

    const silent = await this.authenticateSilently();
    if (silent) return silent;

    if (allowInteractive) {
      return await this.authenticateWithGoogle();
    }

    return null;
  }

  async forceReauthentication(): Promise<{ user: any }> {
    if (this.preferredStrategy === 'webAuth') {
      await this.clearCachedWebAuthTokens();
    }
    return this.authenticateWithGoogle();
  }
}
