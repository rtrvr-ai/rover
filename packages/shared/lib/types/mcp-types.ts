// packages/shared/lib/types/mcp-types.ts
export enum MCP_TOOLS {
  // snake_case values
  GET_BROWSER_TABS = 'get_browser_tabs',
  GET_PAGE_DATA = 'get_page_data',
  TAKE_PAGE_ACTION = 'take_page_action',
  LIST_DEVICES = 'list_devices',
  GET_CURRENT_CREDITS = 'get_current_credits',
  PLANNER = 'planner',
  ACT = 'act_on_tab',
  CRAWL = 'crawl_and_extract_from_tab',
  EXTRACT = 'extract_from_tab',
  USER_FUNCTION = 'user_function',
  EXECUTE_JAVASCRIPT = 'execute_javascript',
  REPLAY_WORKFLOW = 'replay_workflow',
}

/**
 * Valid agentic tool names that the extension can execute
 */
export type AgenticToolName =
  | MCP_TOOLS.PLANNER
  | MCP_TOOLS.ACT
  | MCP_TOOLS.EXTRACT
  | MCP_TOOLS.CRAWL
  | MCP_TOOLS.GET_BROWSER_TABS
  | MCP_TOOLS.GET_PAGE_DATA
  | MCP_TOOLS.TAKE_PAGE_ACTION
  | MCP_TOOLS.USER_FUNCTION
  | MCP_TOOLS.EXECUTE_JAVASCRIPT
  | MCP_TOOLS.REPLAY_WORKFLOW;

export const validAgenticTools: string[] = [
  MCP_TOOLS.PLANNER,
  MCP_TOOLS.ACT,
  MCP_TOOLS.EXTRACT,
  MCP_TOOLS.CRAWL,
  MCP_TOOLS.GET_BROWSER_TABS,
  MCP_TOOLS.GET_PAGE_DATA,
  MCP_TOOLS.TAKE_PAGE_ACTION,
  MCP_TOOLS.USER_FUNCTION,
  MCP_TOOLS.EXECUTE_JAVASCRIPT,
  MCP_TOOLS.REPLAY_WORKFLOW,
];
