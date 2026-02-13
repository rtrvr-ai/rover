// packages/shared/lib/utils/storageUtils.ts
import {
  DEFAULT_CONSECUTIVE_SCROLL_DELAY,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_MAX_PARALLEL_TABS,
  DEFAULT_PAGE_LOAD_DELAY,
} from '../utils/constants.js';
import { createStorage, StorageEnum } from '@rover/storage';
import type {
  ChatOptions,
  PastWorkflowEvent,
  StoredScheduledWorkflow,
  StoredFunctionCall,
} from '../types/workflow-types.js';
import type { BaseStorageType } from '@rover/storage';
import type { LLMIntegration, PageConfig } from '../types/index.js';

// Centralized storage keys
export const STORAGE_KEYS = {
  // Chat related
  CHATS: 'chats',
  CURRENT_CHAT_ID: 'currentChatId',
  CHAT_OPTIONS: 'chatOptions',

  // MCP related
  MCP_EXECUTIONS_ENABLED: 'mcpExecutionsEnabled',
  REQUIRE_MCP_CONFIRMATION: 'requireMcpConfirmation',
  MCP_API_KEY: 'mcpApiKey',
  MCP_API_KEY_ID: 'mcpApiKeyId',
  REMOTE_BROWSER_TOOLS_CONFIG: 'remoteBrowserToolsConfig',

  // API Keys
  GEMINI_API_KEY: 'geminiApiKey',
  GEMINI_API_KEY_ENABLED: 'geminiApiKeyEnabled',
  GEMINI_API_KEYS: 'geminiApiKeys', // NEW: Array of GeminiApiKeyConfig

  // Browser Settings
  DISABLE_AUTO_SCROLL: 'disableAutoScroll',
  PAGE_LOAD_DELAY: 'pageLoadDelay',
  CONSECUTIVE_SCROLL_DELAY: 'consecutiveScrollDelay',
  MAX_PARALLEL_TABS: 'maxParallelTabs',

  // User related
  USER_CONTEXT: 'userContext',
  REDEEMED_REFERRAL_CODE: 'redeemedReferralCode',
  THEME: 'theme',

  // Auth related
  USER: 'user',
  USER_ID: 'userId',
  AUTH_TOKEN: 'authToken',
  FCM_TOKEN: 'fcmToken',
  DEVICE_ID: 'deviceId',

  // Artifacts
  LOCAL_FUNCTIONS_KEY: 'userFunctions',
  LOCAL_TASKS_KEY: 'rtrvr_task_history',
  WORKFLOW_SHORTCUTS: 'workflowShortcuts',

  // Scheduled Workflows
  SCHEDULED_WORKFLOWS: 'scheduledWorkflows',
  PAST_WORKFLOW_EVENTS: 'pastWorkflowEvents',

  // Permission explainer only on first sign in
  PERMISSIONS_POPUP_SHOWN: 'permissionsPopupShown',
  ONBOARDING_COMPLETED: 'ONBOARDING_COMPLETED',
};

// Settings interface that combines all app settings
export interface AppSettings extends PageConfig {
  // Chat options
  chatOptions: ChatOptions;

  // MCP settings
  mcpExecutionsEnabled: boolean;
  requireMcpConfirmation: boolean;
  mcpApiKey?: string;
  mcpApiKeyId?: string;

  // API settings
  geminiApiKey?: string;
  geminiApiKeyEnabled: boolean;
  geminiApiKeys?: string[];

  // User settings
  userContext?: string;
  redeemedReferralCode?: string;
  theme?: 'auto' | 'light' | 'dark';

  // Scheduled workflows
  scheduledWorkflows?: StoredScheduledWorkflow[];
  pastWorkflowEvents?: PastWorkflowEvent[];
}

// Default values
export const DEFAULT_SETTINGS: AppSettings = {
  chatOptions: {
    model: DEFAULT_GEMINI_MODEL,
    proxyMode: 'none',
  },
  mcpExecutionsEnabled: true,
  requireMcpConfirmation: false,
  geminiApiKeyEnabled: false,
  geminiApiKeys: [],
  disableAutoScroll: false,
  pageLoadDelay: DEFAULT_PAGE_LOAD_DELAY,
  consecutiveScrollDelay: DEFAULT_CONSECUTIVE_SCROLL_DELAY,
  maxParallelTabs: DEFAULT_MAX_PARALLEL_TABS,
  theme: 'auto',
};

// Create storage instances for each key
const storageInstances = {
  // Chat related
  chats: createStorage(STORAGE_KEYS.CHATS, [], {
    storageEnum: StorageEnum.Local,
    liveUpdate: true,
  }),
  currentChatId: createStorage<string | null>(STORAGE_KEYS.CURRENT_CHAT_ID, null, {
    storageEnum: StorageEnum.Local,
    liveUpdate: true,
  }),
  chatOptions: createStorage<ChatOptions>(STORAGE_KEYS.CHAT_OPTIONS, DEFAULT_SETTINGS.chatOptions, {
    storageEnum: StorageEnum.Local,
    liveUpdate: true,
  }),

  // MCP related
  mcpExecutionsEnabled: createStorage<boolean>(
    STORAGE_KEYS.MCP_EXECUTIONS_ENABLED,
    DEFAULT_SETTINGS.mcpExecutionsEnabled,
    {
      storageEnum: StorageEnum.Local,
      liveUpdate: true,
    },
  ),
  requireMcpConfirmation: createStorage<boolean>(
    STORAGE_KEYS.REQUIRE_MCP_CONFIRMATION,
    DEFAULT_SETTINGS.requireMcpConfirmation,
    {
      storageEnum: StorageEnum.Local,
      liveUpdate: true,
    },
  ),
  mcpApiKey: createStorage<string | undefined>(STORAGE_KEYS.MCP_API_KEY, undefined, {
    storageEnum: StorageEnum.Local,
    liveUpdate: true,
  }),
  mcpApiKeyId: createStorage<string | undefined>(STORAGE_KEYS.MCP_API_KEY_ID, undefined, {
    storageEnum: StorageEnum.Local,
    liveUpdate: true,
  }),

  // API Keys
  geminiApiKey: createStorage<string | undefined>(STORAGE_KEYS.GEMINI_API_KEY, undefined, {
    storageEnum: StorageEnum.Local,
    liveUpdate: true,
  }),

  geminiApiKeyEnabled: createStorage<boolean>(
    STORAGE_KEYS.GEMINI_API_KEY_ENABLED,
    DEFAULT_SETTINGS.geminiApiKeyEnabled,
    {
      storageEnum: StorageEnum.Local,
      liveUpdate: true,
    },
  ),
  geminiApiKeys: createStorage<string[]>(STORAGE_KEYS.GEMINI_API_KEYS, [], {
    storageEnum: StorageEnum.Local,
    liveUpdate: true,
  }),

  // Page Config & Extraction Config
  // Browser Settings
  disableAutoScroll: createStorage<boolean>(STORAGE_KEYS.DISABLE_AUTO_SCROLL, DEFAULT_SETTINGS.disableAutoScroll!, {
    storageEnum: StorageEnum.Local,
    liveUpdate: true,
  }),

  pageLoadDelay: createStorage<number>(STORAGE_KEYS.PAGE_LOAD_DELAY, DEFAULT_SETTINGS.pageLoadDelay!, {
    storageEnum: StorageEnum.Local,
    liveUpdate: true,
  }),

  consecutiveScrollDelay: createStorage<number>(
    STORAGE_KEYS.CONSECUTIVE_SCROLL_DELAY,
    DEFAULT_SETTINGS.consecutiveScrollDelay!,
    {
      storageEnum: StorageEnum.Local,
      liveUpdate: true,
    },
  ),

  maxParallelTabs: createStorage<number>(STORAGE_KEYS.MAX_PARALLEL_TABS, DEFAULT_SETTINGS.maxParallelTabs!, {
    storageEnum: StorageEnum.Local,
    liveUpdate: true,
  }),

  // User related
  userContext: createStorage<string | undefined>(STORAGE_KEYS.USER_CONTEXT, undefined, {
    storageEnum: StorageEnum.Local,
    liveUpdate: true,
  }),
  redeemedReferralCode: createStorage<string | undefined>(STORAGE_KEYS.REDEEMED_REFERRAL_CODE, undefined, {
    storageEnum: StorageEnum.Local,
    liveUpdate: true,
  }),
  theme: createStorage<'auto' | 'light' | 'dark'>(STORAGE_KEYS.THEME, DEFAULT_SETTINGS.theme!, {
    storageEnum: StorageEnum.Local,
    liveUpdate: true,
  }),

  // Auth related
  user: createStorage<any>(STORAGE_KEYS.USER, null, {
    storageEnum: StorageEnum.Local,
    liveUpdate: true,
  }),
  userId: createStorage<string | null>(STORAGE_KEYS.USER_ID, null, {
    storageEnum: StorageEnum.Local,
    liveUpdate: true,
  }),
  authToken: createStorage<string | null>(STORAGE_KEYS.AUTH_TOKEN, null, {
    storageEnum: StorageEnum.Local,
    liveUpdate: true,
  }),
  fcmToken: createStorage<string | null>(STORAGE_KEYS.FCM_TOKEN, null, {
    storageEnum: StorageEnum.Local,
    liveUpdate: true,
  }),
  deviceId: createStorage<string | null>(STORAGE_KEYS.DEVICE_ID, null, {
    storageEnum: StorageEnum.Local,
    liveUpdate: true,
  }),

  // Artifacts
  localFunctions: createStorage<any[]>(STORAGE_KEYS.LOCAL_FUNCTIONS_KEY, [], {
    storageEnum: StorageEnum.Local,
    liveUpdate: true,
  }),
  localTasks: createStorage<StoredFunctionCall[]>(STORAGE_KEYS.LOCAL_TASKS_KEY, [], {
    storageEnum: StorageEnum.Local,
    liveUpdate: true,
  }),
  workflowShortcuts: createStorage<any[]>(STORAGE_KEYS.WORKFLOW_SHORTCUTS, [], {
    storageEnum: StorageEnum.Local,
    liveUpdate: true,
  }),

  // Scheduled Workflows
  scheduledWorkflows: createStorage<StoredScheduledWorkflow[]>(STORAGE_KEYS.SCHEDULED_WORKFLOWS, [], {
    storageEnum: StorageEnum.Local,
    liveUpdate: true,
  }),
  pastWorkflowEvents: createStorage<PastWorkflowEvent[]>(STORAGE_KEYS.PAST_WORKFLOW_EVENTS, [], {
    storageEnum: StorageEnum.Local,
    liveUpdate: true,
  }),
};

// Map for dynamic user-specific storage instances
const userSpecificStorageMap = new Map<string, BaseStorageType<any>>();

// Storage utility class
export class StorageManager {
  private static instance: StorageManager;

  static getInstance(): StorageManager {
    if (!StorageManager.instance) {
      StorageManager.instance = new StorageManager();
    }
    return StorageManager.instance;
  }

  // Load all settings
  async loadSettings(): Promise<AppSettings> {
    const [
      chatOptions,
      mcpExecutionsEnabled,
      requireMcpConfirmation,
      mcpApiKey,
      mcpApiKeyId,
      geminiApiKey,
      geminiApiKeyEnabled,
      geminiApiKeys,
      disableAutoScroll,
      pageLoadDelay,
      consecutiveScrollDelay,
      maxParallelTabs,
      userContext,
      redeemedReferralCode,
      theme,
      scheduledWorkflows,
      pastWorkflowEvents,
    ] = await Promise.all([
      storageInstances.chatOptions.get(),
      storageInstances.mcpExecutionsEnabled.get(),
      storageInstances.requireMcpConfirmation.get(),
      storageInstances.mcpApiKey.get(),
      storageInstances.mcpApiKeyId.get(),
      storageInstances.geminiApiKey.get(),
      storageInstances.geminiApiKeyEnabled.get(),
      storageInstances.geminiApiKeys.get(),
      storageInstances.disableAutoScroll.get(),
      storageInstances.pageLoadDelay.get(),
      storageInstances.consecutiveScrollDelay.get(),
      storageInstances.maxParallelTabs.get(),
      storageInstances.userContext.get(),
      storageInstances.redeemedReferralCode.get(),
      storageInstances.theme.get(),
      storageInstances.scheduledWorkflows.get(),
      storageInstances.pastWorkflowEvents.get(),
    ]);

    return {
      chatOptions,
      mcpExecutionsEnabled,
      requireMcpConfirmation,
      mcpApiKey,
      mcpApiKeyId,
      geminiApiKey,
      geminiApiKeyEnabled,
      geminiApiKeys,
      disableAutoScroll,
      pageLoadDelay,
      consecutiveScrollDelay,
      maxParallelTabs,
      userContext,
      redeemedReferralCode,
      theme,
      scheduledWorkflows,
      pastWorkflowEvents,
    };
  }

  // Save a single setting
  async saveSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): Promise<void> {
    const storageKey = this.getStorageKey(key);
    const storage = (storageInstances as any)[key];
    if (storage) {
      await storage.set(value);
    }
  }

  // Save multiple settings
  async saveSettings(settings: Partial<AppSettings>): Promise<void> {
    const promises = Object.entries(settings).map(([key, value]) => {
      const storage = (storageInstances as any)[key];
      if (storage) {
        return storage.set(value);
      }
      return Promise.resolve();
    });

    await Promise.all(promises);
  }

  // ========== NEW: User-specific storage methods ==========

  /**
   * Get a user-specific storage key
   */
  getUserSpecificKey(baseKey: string, userId: string): string {
    return `${baseKey}_${userId}`;
  }

  /**
   * Get or create a user-specific storage instance
   */
  private getUserSpecificStorage<T>(baseKey: string, userId: string, fallback: T): BaseStorageType<T> {
    const key = this.getUserSpecificKey(baseKey, userId);

    if (!userSpecificStorageMap.has(key)) {
      const storage = createStorage<T>(key, fallback, {
        storageEnum: StorageEnum.Local,
        liveUpdate: true,
      });
      userSpecificStorageMap.set(key, storage);
    }

    return userSpecificStorageMap.get(key) as BaseStorageType<T>;
  }

  /**
   * Get a value from storage using a user-specific key
   */
  async getUserSpecificValue<T = any>(baseKey: string, userId: string, fallback?: T): Promise<T | undefined> {
    const storage = this.getUserSpecificStorage<T>(baseKey, userId, fallback as T);
    return storage.get();
  }

  /**
   * Set a value in storage using a user-specific key
   */
  async setUserSpecificValue<T = any>(baseKey: string, userId: string, value: T): Promise<void> {
    const storage = this.getUserSpecificStorage<T>(baseKey, userId, value);
    await storage.set(value);
  }

  /**
   * Remove a user-specific value from storage
   */
  async removeUserSpecificValue(baseKey: string, userId: string): Promise<void> {
    const storage = this.getUserSpecificStorage(baseKey, userId, null);
    await storage.set(null);
  }

  /**
   * Get the MCP API key for a specific user
   */
  async getUserMcpApiKey(userId: string): Promise<string | undefined> {
    return this.getUserSpecificValue<string>('mcp_api_key', userId);
  }

  /**
   * Get the MCP API key id for a specific user
   */
  async getUserMcpApiKeyId(userId: string): Promise<string | undefined> {
    return this.getUserSpecificValue<string>('mcp_api_key_id', userId);
  }

  /**
   * Set the MCP API key for a specific user
   */
  async setUserMcpApiKey(userId: string, apiKey: string): Promise<void> {
    return this.setUserSpecificValue('mcp_api_key', userId, apiKey);
  }

  /**
   * Set the MCP API key for a specific user
   */
  async setUserMcpApiKeyId(userId: string, apiKey: string): Promise<void> {
    return this.setUserSpecificValue('mcp_api_key_id', userId, apiKey);
  }

  /**
   * Generic method to get any value using a storage instance
   */
  async getValue<T = any>(key: string): Promise<T | undefined> {
    // Check if we have a predefined storage instance
    const storageKey = Object.keys(STORAGE_KEYS).find(k => (STORAGE_KEYS as any)[k] === key);
    if (storageKey) {
      const storage = (storageInstances as any)[storageKey.toLowerCase()];
      if (storage) {
        return storage.get();
      }
    }

    // Fallback to creating a new storage instance
    const storage = createStorage<T>(key, undefined as any, {
      storageEnum: StorageEnum.Local,
      liveUpdate: true,
    });
    return storage.get();
  }

  /**
   * Generic method to set any value
   */
  async setValue<T = any>(key: string, value: T): Promise<void> {
    // Check if we have a predefined storage instance
    const storageKey = Object.keys(STORAGE_KEYS).find(k => (STORAGE_KEYS as any)[k] === key);
    if (storageKey) {
      const storage = (storageInstances as any)[storageKey.toLowerCase()];
      if (storage) {
        return storage.set(value);
      }
    }

    // Fallback to creating a new storage instance
    const storage = createStorage<T>(key, value, {
      storageEnum: StorageEnum.Local,
      liveUpdate: true,
    });
    await storage.set(value);
  }

  /**
   * Generic method to get multiple values
   */
  async getValues<T = any>(keys: string[]): Promise<Record<string, T>> {
    const result: Record<string, T> = {};

    await Promise.all(
      keys.map(async key => {
        result[key] = (await this.getValue<T>(key))!;
      }),
    );

    return result;
  }

  /**
   * Generic method to set multiple values
   */
  async setValues(data: Record<string, any>): Promise<void> {
    await Promise.all(Object.entries(data).map(([key, value]) => this.setValue(key, value)));
  }

  /**
   * Remove value(s) from storage
   */
  async removeValues(keys: string | string[]): Promise<void> {
    const keysArray = Array.isArray(keys) ? keys : [keys];
    await Promise.all(keysArray.map(key => this.setValue(key, null)));
  }

  // Get storage key for a setting
  private getStorageKey(settingKey: keyof AppSettings): string {
    const keyMap: Record<keyof AppSettings, string> = {
      chatOptions: STORAGE_KEYS.CHAT_OPTIONS,
      mcpExecutionsEnabled: STORAGE_KEYS.MCP_EXECUTIONS_ENABLED,
      requireMcpConfirmation: STORAGE_KEYS.REQUIRE_MCP_CONFIRMATION,
      mcpApiKey: STORAGE_KEYS.MCP_API_KEY,
      mcpApiKeyId: STORAGE_KEYS.MCP_API_KEY_ID,
      geminiApiKey: STORAGE_KEYS.GEMINI_API_KEY,
      geminiApiKeyEnabled: STORAGE_KEYS.GEMINI_API_KEY_ENABLED,
      geminiApiKeys: STORAGE_KEYS.GEMINI_API_KEYS,
      disableAutoScroll: STORAGE_KEYS.DISABLE_AUTO_SCROLL,
      pageLoadDelay: STORAGE_KEYS.PAGE_LOAD_DELAY,
      consecutiveScrollDelay: STORAGE_KEYS.CONSECUTIVE_SCROLL_DELAY,
      maxParallelTabs: STORAGE_KEYS.MAX_PARALLEL_TABS,
      userContext: STORAGE_KEYS.USER_CONTEXT,
      redeemedReferralCode: STORAGE_KEYS.REDEEMED_REFERRAL_CODE,
      theme: STORAGE_KEYS.THEME,
      scheduledWorkflows: STORAGE_KEYS.SCHEDULED_WORKFLOWS,
      pastWorkflowEvents: STORAGE_KEYS.PAST_WORKFLOW_EVENTS,
    } as Record<keyof AppSettings, string>;

    return keyMap[settingKey];
  }

  // Legacy compatibility functions
  async loadChatOptions(): Promise<ChatOptions | null> {
    return storageInstances.chatOptions.get();
  }

  async saveChatOptions(options: ChatOptions): Promise<void> {
    await storageInstances.chatOptions.set(options);
  }

  // Get specific setting
  async getSetting<K extends keyof AppSettings>(key: K): Promise<AppSettings[K]> {
    const storage = (storageInstances as any)[key];
    if (storage) {
      return storage.get();
    }
    const settings = await this.loadSettings();
    return settings[key];
  }

  // Listen for storage changes
  onSettingsChange(callback: (changes: Partial<AppSettings>) => void): () => void {
    const unsubscribers: Array<() => void> = [];

    // Subscribe to all storage instances
    Object.entries(storageInstances).forEach(([key, storage]) => {
      const unsubscribe = storage.subscribe(() => {
        // When a storage value changes, get the new value and call the callback
        storage.get().then(value => {
          const changes: any = {};
          changes[key] = value;
          callback(changes);
        });
      });
      unsubscribers.push(unsubscribe);
    });

    // Return cleanup function
    return () => {
      unsubscribers.forEach(unsub => unsub());
    };
  }

  // Scheduled Workflows Methods
  async loadScheduledWorkflows(): Promise<StoredScheduledWorkflow[]> {
    return storageInstances.scheduledWorkflows.get();
  }

  async saveScheduledWorkflows(workflows: StoredScheduledWorkflow[]): Promise<void> {
    await storageInstances.scheduledWorkflows.set(workflows);
  }

  async addScheduledWorkflow(workflow: StoredScheduledWorkflow): Promise<void> {
    const workflows = await this.loadScheduledWorkflows();
    const existingIndex = workflows.findIndex(w => w.id === workflow.id);

    if (existingIndex !== -1) {
      workflows[existingIndex] = workflow;
    } else {
      workflows.push(workflow);
    }

    await this.saveScheduledWorkflows(workflows);
  }

  async deleteScheduledWorkflow(id: string): Promise<void> {
    const workflows = await this.loadScheduledWorkflows();
    const filtered = workflows.filter(w => w.id !== id);
    await this.saveScheduledWorkflows(filtered);
  }

  // Past Workflow Events Methods
  async loadPastWorkflowEvents(): Promise<PastWorkflowEvent[]> {
    return storageInstances.pastWorkflowEvents.get();
  }

  async savePastWorkflowEvents(events: PastWorkflowEvent[]): Promise<void> {
    await storageInstances.pastWorkflowEvents.set(events);
  }

  async addPastWorkflowEvent(event: PastWorkflowEvent): Promise<void> {
    const events = await this.loadPastWorkflowEvents();
    events.unshift(event); // Add to beginning

    // Keep only last 100 events
    const trimmedEvents = events.slice(0, 100);
    await this.savePastWorkflowEvents(trimmedEvents);
  }

  async deletePastWorkflowEvents(ids: string[]): Promise<void> {
    const events = await this.loadPastWorkflowEvents();
    const filtered = events.filter(e => !ids.includes(e.id));
    await this.savePastWorkflowEvents(filtered);
  }

  // Tasks Methods (for TaskManagerService)
  async getLocalTasks(): Promise<StoredFunctionCall[]> {
    return storageInstances.localTasks.get();
  }

  async setLocalTasks(tasks: StoredFunctionCall[]): Promise<void> {
    await storageInstances.localTasks.set(tasks);
  }

  subscribeToLocalTasks(callback: () => void): () => void {
    return storageInstances.localTasks.subscribe(callback);
  }
}

// Export singleton instance methods for convenience
export const storageManager = StorageManager.getInstance();

// Export legacy functions for backward compatibility
export const loadChatOptions = () => storageManager.loadChatOptions();
export const saveChatOptions = (options: ChatOptions) => storageManager.saveChatOptions(options);
export const loadSettings = () => storageManager.loadSettings();
export const saveSettings = (settings: Partial<AppSettings>) => storageManager.saveSettings(settings);
export const saveSetting = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) =>
  storageManager.saveSetting(key, value);
export const getSetting = <K extends keyof AppSettings>(key: K) => storageManager.getSetting(key);

// Get LLM configuration
export const getLlmConfig = async (chatOptions?: ChatOptions): Promise<LLMIntegration> => {
  const storageManager = StorageManager.getInstance();
  const settings = await storageManager.loadSettings();
  let model: any;
  if (!chatOptions) {
    model = settings.chatOptions.model;
  } else {
    model = chatOptions.model;
  }
  const llmConfig: LLMIntegration = {
    model: model || DEFAULT_GEMINI_MODEL,
  };
  if (settings.geminiApiKeyEnabled) {
    llmConfig.enableGoogleAiStudioApiKey = true;

    // Build array of valid API keys
    const validKeys: string[] = [];

    // Add keys from the new array storage (primary source)
    if (settings.geminiApiKeys && settings.geminiApiKeys.length > 0) {
      validKeys.push(...settings.geminiApiKeys.filter(k => k && k.trim()));
    }

    // Add legacy single key if it exists and isn't already in array
    // This handles migration from old single-key format
    if (settings.geminiApiKey && settings.geminiApiKey.trim()) {
      const legacyKey = settings.geminiApiKey.trim();
      if (!validKeys.includes(legacyKey)) {
        validKeys.push(legacyKey);
      }
    }

    if (validKeys.length > 0) {
      // New format: array of keys for cycling
      llmConfig.apiKeys = validKeys;
    }
  }
  return llmConfig;
};
