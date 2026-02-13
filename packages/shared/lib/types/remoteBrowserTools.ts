// shared/types/remoteBrowserTools.ts
import { MCP_TOOLS } from './mcp-types.js';

// Define union types for each category
export type FreeToolName =
  | MCP_TOOLS.EXECUTE_JAVASCRIPT
  | MCP_TOOLS.GET_BROWSER_TABS
  | MCP_TOOLS.GET_PAGE_DATA
  | MCP_TOOLS.TAKE_PAGE_ACTION;

export type CreditToolName = MCP_TOOLS.PLANNER | MCP_TOOLS.ACT | MCP_TOOLS.EXTRACT | MCP_TOOLS.CRAWL;

export interface RemoteBrowserToolsConfig {
  enabled: boolean;
  freeTools: {
    enabled: boolean;
    tools: Record<FreeToolName, boolean>;
  };
  creditTools: {
    enabled: boolean;
    tools: Record<CreditToolName, boolean>;
  };
  lastUpdated?: number;
  syncedToCloud?: boolean;
}

export const DEFAULT_REMOTE_TOOLS_CONFIG: RemoteBrowserToolsConfig = {
  enabled: true,
  freeTools: {
    enabled: true,
    tools: {
      [MCP_TOOLS.EXECUTE_JAVASCRIPT]: true,
      [MCP_TOOLS.GET_BROWSER_TABS]: true,
      [MCP_TOOLS.GET_PAGE_DATA]: true,
      [MCP_TOOLS.TAKE_PAGE_ACTION]: true,
    },
  },
  creditTools: {
    enabled: true,
    tools: {
      [MCP_TOOLS.PLANNER]: true,
      [MCP_TOOLS.ACT]: true,
      [MCP_TOOLS.EXTRACT]: true,
      [MCP_TOOLS.CRAWL]: true,
    },
  },
};

export const FREE_BROWSER_TOOLS: readonly FreeToolName[] = [
  MCP_TOOLS.EXECUTE_JAVASCRIPT,
  MCP_TOOLS.GET_BROWSER_TABS,
  MCP_TOOLS.GET_PAGE_DATA,
  MCP_TOOLS.TAKE_PAGE_ACTION,
];

export const CREDIT_BROWSER_TOOLS: readonly CreditToolName[] = [
  MCP_TOOLS.PLANNER,
  MCP_TOOLS.ACT,
  MCP_TOOLS.EXTRACT,
  MCP_TOOLS.CRAWL,
];

// Type guard functions
export function isFreeTool(tool: MCP_TOOLS): tool is FreeToolName {
  return FREE_BROWSER_TOOLS.includes(tool as FreeToolName);
}

export function isCreditTool(tool: MCP_TOOLS): tool is CreditToolName {
  return CREDIT_BROWSER_TOOLS.includes(tool as CreditToolName);
}

export const getRemoteToolDescription = (tool: string): string => {
  const descriptions: Record<MCP_TOOLS, string> = {
    [MCP_TOOLS.EXECUTE_JAVASCRIPT]: 'Execute JS code in browser sandbox',
    [MCP_TOOLS.GET_BROWSER_TABS]: 'Returns browser tab info',
    [MCP_TOOLS.GET_PAGE_DATA]: "Retrieves selected tabs' webpages trees",
    [MCP_TOOLS.TAKE_PAGE_ACTION]: 'Takes actions, and returns updated page trees',
    [MCP_TOOLS.PLANNER]: 'Complex multi-step workflow automation',
    [MCP_TOOLS.ACT]: 'Interact with web pages and forms',
    [MCP_TOOLS.EXTRACT]: 'Extract data from websites into Sheets',
    [MCP_TOOLS.CRAWL]: 'Crawl and scrape multiple pages',
    [MCP_TOOLS.LIST_DEVICES]: 'Lists available user devices to trigger',
    [MCP_TOOLS.GET_CURRENT_CREDITS]: 'Gives user credit amount',
    [MCP_TOOLS.USER_FUNCTION]: 'Execute user defined tools in browser sandbox',
    [MCP_TOOLS.REPLAY_WORKFLOW]: 'Re-executes prior workflow with exact same steps',
  };
  return descriptions[tool as MCP_TOOLS] || tool;
};
