// packages/shared/lib/firebase/firebase-manager.ts
import { CLOUD_FUNCTIONS_URL, RTRVR_MCP_URL, functions, auth, defaultDb, rtrvraiDb, storage } from './config.js';
import { validAgenticTools } from '../types/mcp-types.js';
import { STORAGE_KEYS, StorageManager } from '../utils/storageUtils.js';
import { onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut, getIdToken } from 'firebase/auth';
import {
  doc,
  setDoc,
  updateDoc,
  serverTimestamp as firestoreServerTimestamp,
  onSnapshot,
  Timestamp,
  FieldValue,
  getDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import type { SUB_AGENTS } from '../types/agent-types.js';
import type { Auth, User } from 'firebase/auth';
import type { Firestore, DocumentReference, Unsubscribe } from 'firebase/firestore';
import type { Functions, HttpsCallable } from 'firebase/functions';
import { getDownloadURL, ref, uploadBytes, UploadMetadata, type FirebaseStorage } from 'firebase/storage';
import { RemoteBrowserToolsConfig } from '../types/remoteBrowserTools.js';
import { USER_MCP_SETTINGS_DOCUMENT_ID, USER_SETTINGS_SUBCOLLECTION, USERS_COLLECTION } from '../utils/constants.js';
import { CloudFileDescriptor } from '../types/workflow-types.js';
import { toGcsUri } from './utils.js';
import { ArtifactKind } from '../types/artifact-types.js';

interface GenerateApiKeyResponse {
  apiKey: string;
  keyId: string;
  expiresAt: string | null;
}

export class FirebaseManager {
  private static instance: FirebaseManager | null = null;
  private auth: Auth;
  private functions: Functions;
  private defaultDb: Firestore;
  private rtrvraiDb: Firestore;
  private storage: FirebaseStorage;
  private storageManager: StorageManager;
  private currentUser: User | null = null;
  private listeners: Unsubscribe[] = [];
  private initialized = false;
  private manuallyDisconnected = false;
  private deviceRef: DocumentReference | null = null;
  private deviceId: string | null = null;
  private authStateChangedCallbacks: ((user: User | null) => void)[] = [];

  private authReady = false;
  private authReadyPromise: Promise<User | null>;
  private resolveAuthReady: ((user: User | null) => void) | null = null;

  public generateApiKeyCallable: HttpsCallable<
    { label: string; environment: string; ttlDays?: number },
    GenerateApiKeyResponse
  >;
  public rotateApiKeyCallable: HttpsCallable<
    { keyId: string; label?: string; ttlDays?: number },
    { apiKey: string; newKeyId: string; expiresAt: string | null }
  >;
  public redeemInviteCodeCallable: HttpsCallable<{ inviteCode: string }, { success: boolean; message?: string }>;
  public listApiKeysCallable: HttpsCallable<void, any[]>;
  public deleteApiKeyCallable: HttpsCallable<{ keyId: string }, { success: boolean }>;
  public toggleApiKeyCallable: HttpsCallable<{ keyId: string; active: boolean }, { success: boolean; active: boolean }>;
  public getApiKeyStatsCallable: HttpsCallable<void, any>;

  private constructor() {
    this.auth = auth;
    this.functions = functions;
    this.defaultDb = defaultDb;
    this.rtrvraiDb = rtrvraiDb;
    this.storage = storage;
    this.generateApiKeyCallable = httpsCallable(this.functions, 'generateApiKey');
    this.rotateApiKeyCallable = httpsCallable(this.functions, 'rotateApiKey');
    this.redeemInviteCodeCallable = httpsCallable(this.functions, 'redeemInviteCode');
    this.listApiKeysCallable = httpsCallable(this.functions, 'listApiKeys');
    this.deleteApiKeyCallable = httpsCallable(this.functions, 'deleteApiKey');
    this.toggleApiKeyCallable = httpsCallable(this.functions, 'toggleApiKey');
    this.getApiKeyStatsCallable = httpsCallable(this.functions, 'getApiKeyStats');

    // Initialize StorageManager
    this.storageManager = StorageManager.getInstance();

    // Resolves once Firebase auth emits at least one state (user or null).
    // MV3 SW can start handling events before auth hydration completes.
    this.authReadyPromise = new Promise<User | null>(resolve => {
      this.resolveAuthReady = resolve;
    });

    onAuthStateChanged(this.auth, user => {
      this.currentUser = user;
      // When auth state changes, also update connection status,
      // unless someone explicitly called disconnect().
      if (!this.manuallyDisconnected) {
        this.initialized = !!user;
      }

      // Mark auth as ready after first emission.
      if (!this.authReady) {
        this.authReady = true;
        this.resolveAuthReady?.(user);
        this.resolveAuthReady = null;
      }
      // console.log('[FirebaseManager] Auth state changed:', user?.uid);
      // Notify all listeners
      this.authStateChangedCallbacks.forEach(cb => cb(user));
    });
  }

  /**
   * Sync cached currentUser from the SDK's live auth.currentUser to avoid
   * race conditions where signInWithCredential resolved but onAuthStateChanged
   * hasn't fired yet.
   */
  private syncFromSdkAuth(): void {
    const sdkUser = this.auth.currentUser;
    this.currentUser = sdkUser ?? null;
    if (!this.manuallyDisconnected) {
      this.initialized = !!sdkUser;
    }
  }

  /**
   * Wait for Firebase Auth to finish hydrating (first onAuthStateChanged emission).
   * Returns immediately if auth.currentUser is already available.
   */
  async waitForAuthReady(options: { timeoutMs?: number } = {}): Promise<User | null> {
    const { timeoutMs = 10_000 } = options;

    // Fast path: SDK already has a user (post sign-in, or persisted session).
    this.syncFromSdkAuth();
    if (this.currentUser) return this.currentUser;

    if (this.authReady) {
      this.syncFromSdkAuth();
      return this.currentUser;
    }

    if (timeoutMs <= 0) {
      await this.authReadyPromise;
      this.syncFromSdkAuth();
      return this.currentUser;
    }

    await Promise.race([this.authReadyPromise, new Promise<void>(resolve => setTimeout(resolve, timeoutMs))]);
    this.syncFromSdkAuth();
    return this.currentUser;
  }

  static getInstance(): FirebaseManager {
    if (!FirebaseManager.instance) {
      FirebaseManager.instance = new FirebaseManager();
    }
    return FirebaseManager.instance;
  }

  // --- NEW: Direct Authentication Methods ---
  async login(): Promise<User> {
    const provider = new GoogleAuthProvider();
    try {
      const result = await signInWithPopup(this.auth, provider);
      this.currentUser = result.user;
      this.manuallyDisconnected = false;
      this.initialized = true;
      return result.user;
    } catch (error) {
      console.error('[FirebaseManager] Login failed:', error);
      throw error;
    }
  }

  async logout(): Promise<void> {
    try {
      await signOut(this.auth);
      this.currentUser = null;
      this.manuallyDisconnected = false;
      this.initialized = false;
    } catch (error) {
      console.error('[FirebaseManager] Logout failed:', error);
      throw error;
    }
  }

  // NEW: Subscribe to auth changes from React components
  onAuthStateChange(callback: (user: User | null) => void): () => void {
    this.syncFromSdkAuth();
    this.authStateChangedCallbacks.push(callback);
    // Immediately call with current user
    callback(this.currentUser);

    // Return an unsubscribe function
    return () => {
      this.authStateChangedCallbacks = this.authStateChangedCallbacks.filter(cb => cb !== callback);
    };
  }

  // Method to get the current user synchronously after initial check
  getCurrentUser(): User | null {
    this.syncFromSdkAuth();
    return this.currentUser;
  }

  async getMcpUrl(): Promise<string> {
    // Avoid MV3 false negatives during auth hydration
    if (!this.currentUser) {
      await this.waitForAuthReady({ timeoutMs: 10_000 });
    }
    this.syncFromSdkAuth();

    if (!this.isConnected() || !this.currentUser) {
      throw new Error('User not authenticated. Cannot generate MCP URL.');
    }

    const userId = this.currentUser.uid;

    // Use StorageManager to check for stored API key
    const storedApiKey = await this.storageManager.getUserMcpApiKey(userId);
    const storedKeyId = await this.storageManager.getUserMcpApiKeyId(userId);

    if (storedApiKey && storedKeyId) {
      return this.constructMcpUrl(storedApiKey);
    }

    // Call Firebase Function to generate a new key
    try {
      const result = await this.generateApiKeyCallable({
        label: 'Chrome Extension MCP Key',
        environment: 'production',
      });
      const newApiKey = result.data.apiKey;
      const newKeyId = result.data.keyId;

      // Save both API key and keyId
      await this.storageManager.setUserMcpApiKey(userId, newApiKey);
      await this.storageManager.setUserMcpApiKeyId(userId, newKeyId);

      return this.constructMcpUrl(newApiKey);
    } catch (error) {
      console.error('[FirebaseManager] Failed to generate API key:', error);
      throw new Error('Could not generate the MCP API key.');
    }
  }

  async constructMcpUrl(apiKey: string): Promise<string> {
    // Load deviceId from storage
    const deviceId = await this.storageManager.getValue<string>(STORAGE_KEYS.DEVICE_ID);

    // Construct URL with deviceId if available
    let url = `${RTRVR_MCP_URL}?apiKey=${apiKey}`;
    if (deviceId) {
      url += `&deviceId=${encodeURIComponent(deviceId)}`;
    }

    return url;
  }

  // --- NEW: Method to call Firebase APIs ---
  async callFirebaseAPI(api: string, body: any): Promise<any> {
    if (!this.currentUser) await this.waitForAuthReady({ timeoutMs: 10_000 });
    this.syncFromSdkAuth();
    if (!this.currentUser) throw new Error('Authentication required.');

    const idToken = await getIdToken(this.currentUser);
    const apiEndpoint = `${CLOUD_FUNCTIONS_URL}/${api}`;

    try {
      const response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${idToken}`,
          'Content-Type': 'application/json',
        },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      throw new Error(`Error calling API ${api}: ${error}`);
    }
  }

  /**
   * Call the unified extension router
   * @param action - The action type: 'enhance', 'plan', or 'processTabWorkflows'
   * @param data - The request data specific to the action
   */
  async callExtensionRouter(action: SUB_AGENTS, data: any): Promise<any> {
    if (!this.currentUser) await this.waitForAuthReady({ timeoutMs: 10_000 });
    this.syncFromSdkAuth();
    if (!this.currentUser) throw new Error('Authentication required.');

    const idToken = await getIdToken(this.currentUser);
    const apiEndpoint = `${CLOUD_FUNCTIONS_URL}/extensionRouter`;
    // console.log('apiEndpoint: ', apiEndpoint);
    try {
      const response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${idToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action,
          data,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error: any) {
      throw new Error(`Error calling ${action}: ${error.message}`);
    }
  }

  async getRemoteToolsConfig(userId: string): Promise<RemoteBrowserToolsConfig | null> {
    try {
      const docRef = doc(
        this.rtrvraiDb,
        USERS_COLLECTION,
        userId,
        USER_SETTINGS_SUBCOLLECTION,
        USER_MCP_SETTINGS_DOCUMENT_ID,
      );
      const docSnap = await getDoc(docRef);

      if (docSnap.exists()) {
        return docSnap.data() as RemoteBrowserToolsConfig;
      }
      return null;
    } catch (error) {
      console.error('[FirebaseManager] Error getting remote tools config:', error);
      return null;
    }
  }

  async saveRemoteToolsConfig(userId: string, config: RemoteBrowserToolsConfig): Promise<void> {
    try {
      const docRef = doc(
        this.rtrvraiDb,
        USERS_COLLECTION,
        userId,
        USER_SETTINGS_SUBCOLLECTION,
        USER_MCP_SETTINGS_DOCUMENT_ID,
      );
      await setDoc(docRef, {
        ...config,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      console.error('[FirebaseManager] Error saving remote tools config:', error);
      throw error;
    }
  }

  /**
   * Upload a file to Firebase Storage
   */
  async uploadFile(
    storagePath: string,
    file: File | Blob,
    opts: {
      id: string;
      displayName: string;
      kind?: ArtifactKind;
    },
  ): Promise<CloudFileDescriptor | null> {
    try {
      const storageRef = ref(this.storage, storagePath);

      // Ensure Firebase download URL works reliably:
      // In web SDK this is set via customMetadata.
      // Bhavani TO_DO: Check in future if this is needed and
      // const downloadToken = crypto.randomUUID();

      const contentType = (file instanceof File ? file.type : (file as any).type) || 'application/octet-stream';

      const metadata: UploadMetadata = {
        contentType,
        // customMetadata: {
        //   firebaseStorageDownloadTokens: downloadToken,
        // },
      };

      const snapshot = await uploadBytes(storageRef, file, metadata);
      const storageUrl = await getDownloadURL(snapshot.ref);

      const bucket = snapshot.ref.bucket; // e.g. "myproj.appspot.com"
      const fullPath = snapshot.ref.fullPath; // matches your storagePath

      const desc: CloudFileDescriptor = {
        id: opts.id,
        displayName: opts.displayName,
        mimeType: contentType,
        sizeBytes: (file as any).size ?? undefined,
        storageUrl,
        gcsUri: toGcsUri(bucket, fullPath),
        kind: opts.kind,
      };

      return desc;
    } catch (error) {
      console.error('[FirebaseManager] Error uploading file:', error);
      return null;
    }
  }

  async connect(userId: string, deviceId: string): Promise<void> {
    // console.log('[FirebaseManager] Connecting for user:', userId);

    this.manuallyDisconnected = false;
    await this.waitForAuthReady({ timeoutMs: 10_000 });
    this.syncFromSdkAuth();

    if (!this.currentUser || this.currentUser.uid !== userId) {
      throw new Error(`User mismatch or not authenticated`);
    }

    this.deviceId = deviceId;
    this.initialized = true;
    // console.log('[FirebaseManager] Connected successfully');
  }

  async disconnect(): Promise<void> {
    // Clean up listeners
    this.listeners.forEach(unsubscribe => unsubscribe());
    this.listeners = [];

    // Clear device reference
    this.deviceRef = null;
    this.deviceId = null;

    this.manuallyDisconnected = true;
    this.initialized = false;
    // console.log('[FirebaseManager] Disconnected');
  }

  /**
   * Set device presence and FCM token in Firestore (rtrvrai database)
   */
  async setDevicePresence(userId: string, deviceId: string, fcmToken: string, online: boolean): Promise<void> {
    this.syncFromSdkAuth();
    if (!this.initialized) throw new Error('Not initialized');

    // Use rtrvrai database for device data
    this.deviceRef = doc(this.rtrvraiDb, 'user_devices', userId, 'devices', deviceId);

    const deviceData = {
      fcmToken,
      deviceId,
      deviceType: 'chrome_extension',
      lastUpdated: firestoreServerTimestamp(),
      lastSeen: firestoreServerTimestamp(),
      chromeVersion: navigator.userAgent,
      extensionVersion: chrome.runtime.getManifest().version,
      online,
      deviceName: `Chrome on ${navigator.platform}`,
      capabilities: {
        tools: validAgenticTools,
      },
    };

    await setDoc(this.deviceRef, deviceData, { merge: true });
    // console.log('[FirebaseManager] Device presence set in rtrvrai database');
  }

  /**
   * Update device online status
   */
  async updateDeviceStatus(userId: string, deviceId: string, online: boolean): Promise<void> {
    this.syncFromSdkAuth();
    if (!this.initialized) throw new Error('Not initialized');

    const deviceRef = doc(this.rtrvraiDb, 'user_devices', userId, 'devices', deviceId);

    // Use setDoc with merge to create document if it doesn't exist
    await setDoc(
      deviceRef,
      {
        online,
        lastSeen: firestoreServerTimestamp(),
        deviceId, // Include deviceId to ensure document has minimum required data
      },
      { merge: true },
    );
  }

  /**
   * Listen for MCP executions in rtrvrai database
   */
  async listenForMCPExecutions(
    userId: string,
    executionId: string,
    callback: (data: any) => void,
  ): Promise<Unsubscribe> {
    this.syncFromSdkAuth();
    if (!this.initialized) throw new Error('Not initialized');

    const executionRef = doc(this.rtrvraiDb, 'executions', userId, 'mcpExecutions', executionId);

    // console.log('[FirebaseManager] Listening for MCP execution:', executionId);

    const unsubscribe = onSnapshot(
      executionRef,
      snapshot => {
        if (snapshot.exists()) {
          callback(snapshot.data());
        }
      },
      error => {
        console.error('[FirebaseManager] Execution listener error:', error);
      },
    );

    this.listeners.push(unsubscribe);
    return unsubscribe;
  }

  /**
   * Recursively remove undefined values from an object
   * Firestore doesn't accept undefined values, so we need to clean them
   */
  private cleanUndefinedValues(obj: any): any {
    if (obj === undefined) {
      return null; // Convert undefined to null for Firestore
    }

    if (obj === null || typeof obj !== 'object') {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.cleanUndefinedValues(item));
    }

    if (obj instanceof Date || obj instanceof Timestamp || obj instanceof FieldValue) {
      // Don't modify Date objects or Firestore server timestamps
      return obj;
    }

    const cleaned: any = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        const value = obj[key];
        if (value !== undefined) {
          cleaned[key] = this.cleanUndefinedValues(value);
        }
        // If value is undefined, we simply don't include it in the cleaned object
      }
    }

    return cleaned;
  }

  /**
   * Update MCP execution with automatic data cleaning
   */
  async updateMCPExecution(userId: string, executionId: string, updates: Record<string, any>): Promise<void> {
    this.syncFromSdkAuth();
    if (!this.initialized) throw new Error('Not initialized');

    const executionRef = doc(this.rtrvraiDb, 'executions', userId, 'mcpExecutions', executionId);

    // Add timestamp to updates
    const updatesWithTimestamp = {
      ...updates,
      updatedAt: firestoreServerTimestamp(),
    };
    const cleanedUpdates = this.cleanUndefinedValues(updatesWithTimestamp);
    await updateDoc(executionRef, cleanedUpdates);
  }

  isConnected(): boolean {
    this.syncFromSdkAuth();
    return this.initialized && this.currentUser !== null;
  }

  getUserId(): string | null {
    this.syncFromSdkAuth();
    return this.currentUser?.uid || null;
  }

  getAuth(): Auth {
    return this.auth;
  }

  getFunctions(): Functions {
    return this.functions;
  }

  /**
   * Get the Firebase Storage instance
   */
  getStorage(): FirebaseStorage {
    return this.storage;
  }

  /**
   * Get the rtrvrai Firestore database instance
   */
  getRtrvraiDb(): Firestore {
    return this.rtrvraiDb;
  }

  /**
   * Get the default Firestore database instance
   */
  getDefaultDb(): Firestore {
    return this.defaultDb;
  }

  // Get Firebase Id Token for API calls
  async getFirebaseIdToken(): Promise<string | null> {
    if (!this.currentUser) await this.waitForAuthReady({ timeoutMs: 10_000 });
    this.syncFromSdkAuth();
    if (!this.currentUser) return null;

    try {
      // You might need to implement this based on your auth setup
      // For now, return the ID token which may be sufficient
      return await getIdToken(this.currentUser);
    } catch (error) {
      console.error('Failed to get access token:', error);
      return null;
    }
  }
}
