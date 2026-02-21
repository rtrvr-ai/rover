// packages/shared/lib/utils/constants.ts

import { GEMINI_MODEL, PageConfig, type ExtractionConfig } from '../types/index.js';

export const RTRVR_DRIVE_FOLDER_NAME = `rtrvr.ai Extracted Data`;
export const RTRVR_IN_MEM_SHEET_ID_PREFIX = 'rtrvr_mem_';
export const allowedImageTypes = ['image/png', 'image/jpeg', 'image/webp'];
export const allowedFileTypes = ['application/pdf', 'text/plain'];
export const allowedMimeTypes = [...allowedImageTypes, ...allowedFileTypes];
export type AllowedMimeType = (typeof allowedMimeTypes)[number];

export const DISCORD_INVITE_URL = 'https://rtrvr.ai/discord';
export const TWITTER_URL = 'https://x.com/rtrvrai';
export const LINKEDIN_URL = 'https://www.linkedin.com/company/rtrvr-ai/';
export const SUPPORT_EMAIL = 'support@rtrvr.ai';
export const GITHUB_LINK = 'https://github.com/rtrvr-ai';
export const WHATSAPP_NUMBER = 'https://wa.me/14152753317';
export const EXTENSION_LINK = 'https://chromewebstore.google.com/detail/rtrvrai/jldogdgepmcedfdhgnmclgemehfhpomg';

export const POPUP_HEIGHT = 1100;
export const POPUP_WIDTH = 1200;

// Message types for clipboard operations
export const CLIPBOARD_MESSAGES = {
  REQUEST: 'CLIPBOARD_REQUEST',
  RESPONSE: 'CLIPBOARD_RESPONSE',
};

export const OFFSCREEN_FUNC_MESSAGES = {
  REQUEST: 'OFFSCREEN_FUNC_EXECUTE_REQUEST',
  RESPONSE: 'OFFSCREEN_FUNC_EXECUTE_RESPONSE',
};

export const USER_FUNCTION_EXECUTION_MESSAGE = 'EXECUTE_USER_FUNCTION';

export const FUNCTION_EXECUTION_TIMEOUT = 60000; // 1 Minute timeout
export const DYNAMIC_CONTENT_URL = 'dynamic-content/index.html';

export const CONCURRENT_LIMIT = 500;
// --- Planner Request/Response (camelCase) ---
export enum PLANNER_FUNCTION_CALLS {
  // snake_case values
  ACT = 'act_on_tab',
  CRAWL = 'crawl_and_extract_from_tab',
  EXTRACT = 'extract_from_tab',
  SHEETS_WORKFLOW = 'sheets_workflow',
  INFER_SHEET_DATA = 'infer_sheet_data',
  GRAPHBOT = 'graph_bot',
  PDF_FILLER = 'pdf_filler',
  CUSTOM_TOOL_GENERATOR = 'custom_tool_generator',
  WEBPAGE_GENERATOR = 'webpage_generator',
  GOOGLE_DOC_GENERATOR = 'google_doc_generator',
  GOOGLE_SLIDES_GENERATOR = 'google_slides_generator',
  PROCESS_TEXT = 'process_text',
  CREATE_SHEET_FROM_DATA = 'create_sheet_from_data',
  ROVER_EXTERNAL_READ_CONTEXT = 'rover_external_read_context',
  ROVER_EXTERNAL_ACT_CONTEXT = 'rover_external_act_context',
  CONFIGURE_API_KEY = 'configure_api_key', // Only on client side for API key addition
  // TASK_COMPLETE, ASK_USER won't be used on client side
  TASK_COMPLETE = 'task_complete', // To signal task completion
  ASK_USER = 'ask_user', // For asking questions
  EXECUTE_MULTIPLE_TOOLS = 'execute_multiple_tools', // Execute multiple user defined tools
  QUERY_RTRVR_AI_DOCUMENTATION = 'query_rtrvr_ai_documentation', // to get rtrvr.ai/docs
}

export enum FUNCTION_CALLS {
  PLANNER = 'Planner',
  AGENTIC_SEEK = 'Agentic Action',
  CRAWL_PAGES = 'Crawl Pages',
  EXTRACT_PAGE = 'Extract Page',
  SHEETS_WORKFLOW = 'Sheets Workflow',
  INFER_SHEET_DATA = 'Infer Sheet Data',
  MULTI_STEPS = 'Multi Steps',
  PDF_FILLER = 'PDF Filler',
  CUSTOM_TOOL_GENERATOR = 'Custom Tool Generator',
  WEBPAGE_GENERATOR = 'WebPage Generator',
  GOOGLE_DOC_GENERATOR = 'Google Doc Generator',
  GOOGLE_SLIDES_GENERATOR = 'Google Slides Generator',
  PROCESS_TEXT = 'Process Text',
  CREATE_SHEET_FROM_DATA = 'Create Sheet From Data',
  ROVER_EXTERNAL_READ_CONTEXT = 'Rover External Read Context',
  ROVER_EXTERNAL_ACT_CONTEXT = 'Rover External Act Context',
  EXECUTE_MULTIPLE_TOOLS = 'Execute Multiple User Tools',
  CONFIGURE_API_KEY = 'Configure Gemini API Key', // Only on client side doesn't map with planner
  QUERY_RTRVR_AI_DOCUMENTATION = 'query_rtrvr_ai_documentation', // to get rtrvr.ai/docs
}

// (Ensure this map is complete and up-to-date with backend PLANNER_FUNCTION_CALLS)
export const plannerFunctionCallValueToFunctionCallValueMap: {
  [key in PLANNER_FUNCTION_CALLS]?: FUNCTION_CALLS;
} = {
  [PLANNER_FUNCTION_CALLS.ACT]: FUNCTION_CALLS.AGENTIC_SEEK,
  [PLANNER_FUNCTION_CALLS.CRAWL]: FUNCTION_CALLS.CRAWL_PAGES,
  [PLANNER_FUNCTION_CALLS.EXTRACT]: FUNCTION_CALLS.EXTRACT_PAGE,
  [PLANNER_FUNCTION_CALLS.SHEETS_WORKFLOW]: FUNCTION_CALLS.SHEETS_WORKFLOW,
  [PLANNER_FUNCTION_CALLS.INFER_SHEET_DATA]: FUNCTION_CALLS.INFER_SHEET_DATA,
  [PLANNER_FUNCTION_CALLS.PDF_FILLER]: FUNCTION_CALLS.PDF_FILLER,
  [PLANNER_FUNCTION_CALLS.CUSTOM_TOOL_GENERATOR]: FUNCTION_CALLS.CUSTOM_TOOL_GENERATOR,
  [PLANNER_FUNCTION_CALLS.WEBPAGE_GENERATOR]: FUNCTION_CALLS.WEBPAGE_GENERATOR,
  [PLANNER_FUNCTION_CALLS.GOOGLE_DOC_GENERATOR]: FUNCTION_CALLS.GOOGLE_DOC_GENERATOR,
  [PLANNER_FUNCTION_CALLS.GOOGLE_SLIDES_GENERATOR]: FUNCTION_CALLS.GOOGLE_SLIDES_GENERATOR,
  [PLANNER_FUNCTION_CALLS.PROCESS_TEXT]: FUNCTION_CALLS.PROCESS_TEXT,
  [PLANNER_FUNCTION_CALLS.CREATE_SHEET_FROM_DATA]: FUNCTION_CALLS.CREATE_SHEET_FROM_DATA,
  [PLANNER_FUNCTION_CALLS.ROVER_EXTERNAL_READ_CONTEXT]: FUNCTION_CALLS.ROVER_EXTERNAL_READ_CONTEXT,
  [PLANNER_FUNCTION_CALLS.ROVER_EXTERNAL_ACT_CONTEXT]: FUNCTION_CALLS.ROVER_EXTERNAL_ACT_CONTEXT,
  [PLANNER_FUNCTION_CALLS.EXECUTE_MULTIPLE_TOOLS]: FUNCTION_CALLS.EXECUTE_MULTIPLE_TOOLS,
  [PLANNER_FUNCTION_CALLS.CONFIGURE_API_KEY]: FUNCTION_CALLS.CONFIGURE_API_KEY,
  [PLANNER_FUNCTION_CALLS.QUERY_RTRVR_AI_DOCUMENTATION]: FUNCTION_CALLS.QUERY_RTRVR_AI_DOCUMENTATION,
};

export const MAX_PREV_STEPS = 20;
export const DEFAULT_MAX_PAGINATION = 500;
export const DEFAULT_PAGE_LOAD_DELAY = 1000;
export const ADDITIONAL_PDF_PAGE_LOAD_DELAY = 200; //plus 200 ms on base page load
export const DEFAULT_CONSECUTIVE_SCROLL_DELAY = 500;
export const DEFAULT_ADAPTIVE_SETTLE_DEBOUNCE_MS = 30;
export const DEFAULT_ADAPTIVE_SETTLE_MAX_WAIT_MS = 320;
export const DEFAULT_ADAPTIVE_SETTLE_RETRIES = 0;
export const DEFAULT_SPARSE_TREE_RETRY_DELAY_MS = 50;
export const DEFAULT_SPARSE_TREE_RETRY_MAX_ATTEMPTS = 1;
export const DEFAULT_GEMINI_MODEL = GEMINI_MODEL.FLASH;
export const DEFAULT_MAX_PARALLEL_TABS = 6; // Match Gemini API Free Tier RPM Quota + Schema
export const DEFAULT_EXTRACTION_CONFIG: ExtractionConfig = {
  llmIntegration: { model: DEFAULT_GEMINI_MODEL },
  maxParallelTabs: DEFAULT_MAX_PARALLEL_TABS,
  pageLoadDelay: DEFAULT_PAGE_LOAD_DELAY,
};
export const AGENTIC_TAB_GROUP_TITLE = 'Agentic Tabs';
export const AGENTIC_TAB_GROUP_COLOR = 'orange';

export const VALID_FUNCTION_NAME_REGEX = /^[a-zA-Z_][a-zA-Z0-9_.-]{0,63}$/;

export const USER_FUNCTIONS_STORAGE_PATH = 'user/Functions';
export const USER_TASKS_STORAGE_PATH = 'user/Tasks';
export const USER_RECORDINGS_STORAGE_PATH = 'user/Recordings';
export const USER_FILES_STORAGE_PATH = 'user/Files';

export const SHARED_FUNCTIONS_STORAGE_PATH = 'shared/Functions';
export const SHARED_TASKS_STORAGE_PATH = 'shared/Tasks';
export const SHARED_RECORDINGS_STORAGE_PATH = 'shared/Recordings';

export const PREDEFINED_FUNCTIONS_STORAGE_PATH = 'predefined/Functions';
export const PREDEFINED_TASKS_STORAGE_PATH = 'predefined/Tasks';
export const PREDEFINED_RECORDINGS_STORAGE_PATH = 'predefined/Recordings';

export const SHARED_FUNCTIONS_URL = 'shared/Functions';
export const SHARED_TASKS_URL = 'shared/Tasks';
export const SHARED_RECORDINGS_URL = 'shared/Recordings';

export const FIREBASE_PROJECT_URL =
  'https://firebasestorage.googleapis.com/v0/b/rtrvr-extension-functions.firebasestorage.app/o';

export const FUNCTION_CALLING_PARAMETER_TYPES = ['string', 'number', 'integer', 'boolean', 'array', 'object'];

export const PLANNER = FUNCTION_CALLS.PLANNER; //Just sharing the string but keeping them separate for toolName in StoredFunctionCall
export const PLANNER_SCHEMA_SYSTEM_STATUS = 'system_status';

export const CONTENT_SCRIPT_MESSAGE_RETRIES = 1; // 1 original + 1 retry

export const CONTENT_SCRIPT_RETRY_DELAY = 250;
export const HTML_CONTENT_TYPE = 'text/html';
export const TEXT_MIME_TYPE = 'text/plain';
export const PDF_MIME_TYPE = 'application/pdf';
export const GOOGLE_SHEET_MIME_TYPE = 'application/gsheet';
export const JSON_MIME_TYPE = 'application/json';
export const GOOGLE_URL = 'https://www.google.com/';
export const FILE_URL_PREFIX = 'file:///';
export const NATIVE_HOST_ID = 'rtrvr.ai.webagent';
export const RECONNECT_DELAY_MS = 5000;
export const MAX_RECONNECT_ATTEMPTS = 5;
export const CLIPBOARD_REQUEST_TIMEOUT = 7000;
export const STALE_REQUEST_TIMEOUT = 10000;
export const CLEANUP_INTERVAL = 30000;
export const OFFSCREEN_PING_TIMEOUT = 3000;
export const maxFileSizeInBytes = 20 * 1024 * 1024; // 20MB in bytes

export const USERS_COLLECTION = 'users';
export const USER_SETTINGS_SUBCOLLECTION = 'settings';
export const USER_SETTINGS_DOCUMENT_ID = 'config';
export const USER_MCP_SETTINGS_DOCUMENT_ID = 'remote_browser_tools';
export const BLANK_URL = 'about:blank';

export const DEFAULT_PAGE_CONFIG: PageConfig = {
  maxParallelTabs: 4,
  pageLoadDelay: 2000,
  disableAutoScroll: false,
  makeNewTabsActive: false,
  writeRowProcessingTime: false,

  // ✅ new
  totalBudgetMs: 25000,
  pageDataTimeoutMs: 22000,
  adaptiveSettleDebounceMs: DEFAULT_ADAPTIVE_SETTLE_DEBOUNCE_MS,
  adaptiveSettleMaxWaitMs: DEFAULT_ADAPTIVE_SETTLE_MAX_WAIT_MS,
  adaptiveSettleRetries: DEFAULT_ADAPTIVE_SETTLE_RETRIES,
  sparseTreeRetryDelayMs: DEFAULT_SPARSE_TREE_RETRY_DELAY_MS,
  sparseTreeRetryMaxAttempts: DEFAULT_SPARSE_TREE_RETRY_MAX_ATTEMPTS,

  // PDF-specific
  pdfTextSelectionTimeoutMs: 12000,
  onlyTextContent: false,
} as const;
