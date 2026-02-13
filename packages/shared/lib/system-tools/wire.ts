// system-tools/wire.ts

import type { FunctionCall } from '@google/genai';
import { SystemToolNames } from './tools.js';
import { FrameworkName, ListenerSource } from '../utils/main-listener-utils.js';
import type { UploadFilePayload } from '../page/file-upload-utils.js';
export type { UploadFilePayload } from '../page/file-upload-utils.js';

/**
 * Numeric codes are the canonical wire representation.
 * Mapping tables keep everything type-safe and avoid stringly-typed logic.
 */

export enum FrameworkCode {
  Unknown = 0,
  React = 1,
  Vue = 2,
  Angular = 3,
  Svelte = 4,
  JQuery = 5,
}

export const FrameworkCodeToName: Record<FrameworkCode, FrameworkName | 'unknown'> = {
  [FrameworkCode.Unknown]: 'unknown',
  [FrameworkCode.React]: 'react',
  [FrameworkCode.Vue]: 'vue',
  [FrameworkCode.Angular]: 'angular',
  [FrameworkCode.Svelte]: 'svelte',
  [FrameworkCode.JQuery]: 'jquery',
} as const;

export const FrameworkNameToCode: Record<FrameworkName, FrameworkCode> = {
  react: FrameworkCode.React,
  vue: FrameworkCode.Vue,
  angular: FrameworkCode.Angular,
  svelte: FrameworkCode.Svelte,
  jquery: FrameworkCode.JQuery,
};

/**
 * ListenerSource codes mirror your earlier string union:
 * 'inline' | 'native | 'delegated' | 'react' | 'vue' | 'angular' | 'svelte' | 'jquery' | 'other'
 */
export enum ListenerSourceCode {
  Other = 0,
  Inline = 1,
  Delegated = 2,
  React = 3,
  Vue = 4,
  Angular = 5,
  Svelte = 6,
  JQuery = 7,
  Native = 8,
}

export const ListenerSourceCodeToName: Record<ListenerSourceCode, ListenerSource | 'other'> = {
  [ListenerSourceCode.Other]: 'other',
  [ListenerSourceCode.Inline]: 'inline',
  [ListenerSourceCode.Delegated]: 'delegated',
  [ListenerSourceCode.React]: 'react',
  [ListenerSourceCode.Vue]: 'vue',
  [ListenerSourceCode.Angular]: 'angular',
  [ListenerSourceCode.Svelte]: 'svelte',
  [ListenerSourceCode.JQuery]: 'jquery',
  [ListenerSourceCode.Native]: 'native',
} as const;

export const ListenerSourceNameToCode: Record<ListenerSource, ListenerSourceCode> = {
  inline: ListenerSourceCode.Inline,
  delegated: ListenerSourceCode.Delegated,
  react: ListenerSourceCode.React,
  vue: ListenerSourceCode.Vue,
  angular: ListenerSourceCode.Angular,
  svelte: ListenerSourceCode.Svelte,
  jquery: ListenerSourceCode.JQuery,
  other: ListenerSourceCode.Other,
  native: ListenerSourceCode.Native,
};

/**
 * Tool opcodes: these are the wire-level IDs matching SystemToolNames.
 * Keep this in strict 1:1 sync with your SystemToolNames enum/union.
 */
export enum SystemToolOpcode {
  click_element = 1,
  type_into_element = 2,
  type_and_enter = 3,
  select_dropdown_value = 4,
  clear_element = 5,
  focus_element = 6,

  hover_element = 7,
  right_click_element = 8,
  double_click_element = 9,
  long_press_element = 10,
  drag_element = 11,
  drag_and_drop = 12,
  swipe_element = 13,
  adjust_slider = 14,

  describe_images = 15,
  scroll_to_element = 16,
  paste_text = 17,

  check_field_validity = 18,
  select_text = 19,
  mouse_wheel = 20,
  copy_text = 21,

  upload_file = 22,

  go_back = 23,
  go_forward = 24,
  refresh_page = 25,

  press_key = 26,
  scroll_page = 27,
  wait_action = 28,
  wait_for_element = 29,
  pinch_zoom = 30,

  // Added missing tools from robust definition
  goto_url = 31,
  google_search = 32,
  open_new_tab = 33,
  switch_tab = 34,
  close_tab = 35,
  solve_captcha = 36,
  answer_task = 37,
  dispatch_pointer_path = 38,
  network_run_recipe = 40,
}

// skipped tools: google_search, close_tab, switch_tab, answer_task doesn't go through content script
export const ToolNameToOpcode: Record<SystemToolNames, SystemToolOpcode> = {
  [SystemToolNames.click_element]: SystemToolOpcode.click_element,
  [SystemToolNames.type_into_element]: SystemToolOpcode.type_into_element,
  [SystemToolNames.type_and_enter]: SystemToolOpcode.type_and_enter,
  [SystemToolNames.select_dropdown_value]: SystemToolOpcode.select_dropdown_value,
  [SystemToolNames.clear_element]: SystemToolOpcode.clear_element,
  [SystemToolNames.focus_element]: SystemToolOpcode.focus_element,
  [SystemToolNames.hover_element]: SystemToolOpcode.hover_element,
  [SystemToolNames.right_click_element]: SystemToolOpcode.right_click_element,
  [SystemToolNames.double_click_element]: SystemToolOpcode.double_click_element,
  [SystemToolNames.long_press_element]: SystemToolOpcode.long_press_element,
  [SystemToolNames.drag_element]: SystemToolOpcode.drag_element,
  [SystemToolNames.drag_and_drop]: SystemToolOpcode.drag_and_drop,
  [SystemToolNames.swipe_element]: SystemToolOpcode.swipe_element,
  [SystemToolNames.adjust_slider]: SystemToolOpcode.adjust_slider,
  [SystemToolNames.describe_images]: SystemToolOpcode.describe_images,
  [SystemToolNames.scroll_to_element]: SystemToolOpcode.scroll_to_element,
  [SystemToolNames.paste_text]: SystemToolOpcode.paste_text,
  [SystemToolNames.check_field_validity]: SystemToolOpcode.check_field_validity,
  [SystemToolNames.select_text]: SystemToolOpcode.select_text,
  [SystemToolNames.mouse_wheel]: SystemToolOpcode.mouse_wheel,
  [SystemToolNames.copy_text]: SystemToolOpcode.copy_text,
  [SystemToolNames.upload_file]: SystemToolOpcode.upload_file,
  [SystemToolNames.go_back]: SystemToolOpcode.go_back,
  [SystemToolNames.go_forward]: SystemToolOpcode.go_forward,
  [SystemToolNames.refresh_page]: SystemToolOpcode.refresh_page,
  [SystemToolNames.press_key]: SystemToolOpcode.press_key,
  [SystemToolNames.scroll_page]: SystemToolOpcode.scroll_page,
  [SystemToolNames.wait_action]: SystemToolOpcode.wait_action,
  [SystemToolNames.wait_for_element]: SystemToolOpcode.wait_for_element,
  [SystemToolNames.pinch_zoom]: SystemToolOpcode.pinch_zoom,

  // Added mappings
  [SystemToolNames.goto_url]: SystemToolOpcode.goto_url,
  [SystemToolNames.google_search]: SystemToolOpcode.google_search,
  [SystemToolNames.open_new_tab]: SystemToolOpcode.open_new_tab,
  [SystemToolNames.switch_tab]: SystemToolOpcode.switch_tab,
  [SystemToolNames.close_tab]: SystemToolOpcode.close_tab,
  [SystemToolNames.solve_captcha]: SystemToolOpcode.solve_captcha,
  [SystemToolNames.answer_task]: SystemToolOpcode.answer_task,
  [SystemToolNames.dispatch_pointer_path]: SystemToolOpcode.dispatch_pointer_path,
  [SystemToolNames.network_run_recipe]: SystemToolOpcode.network_run_recipe,
} as Record<SystemToolNames, SystemToolOpcode>;

export const ToolOpcodeToName: Record<SystemToolOpcode, SystemToolNames> = Object.fromEntries(
  Object.entries(ToolNameToOpcode).map(([name, code]) => [code, name as SystemToolNames]),
) as Record<SystemToolOpcode, SystemToolNames>;

export interface FrameworkElementMetadataWire {
  // same logical shape as your FrameworkElementMetadata, but thriftier on the wire
  frameworks?: FrameworkCode[]; // numeric codes instead of strings
  listenersRaw?: string; // eventType:code|code;...
  role?: string | null;
  pattern?: string;
  value?: string | number | null;
}

export interface MainWorldToolRequest {
  opcode: SystemToolOpcode;
  call: FunctionCall;
  elementData?: FrameworkElementMetadataWire;
  tabIndex: number;
  payload?: UploadFilePayload;
}

export interface MainWorldToolResponse {
  // Thin wrapper around your LLMFunction['response']
  success: boolean;
  error?: string;
  allowFallback?: boolean;
  method?: string;
}

// keep this in sync with ListenerSourceBit in main-world-interactive-detector.ts
export function decodeListenerSourceMask(mask: number): ListenerSource[] {
  const out: ListenerSource[] = [];
  if (!mask) return out;

  if (mask & (1 << 0)) out.push('native');
  if (mask & (1 << 1)) out.push('inline');
  if (mask & (1 << 2)) out.push('react');
  if (mask & (1 << 3)) out.push('vue');
  if (mask & (1 << 4)) out.push('angular');
  if (mask & (1 << 5)) out.push('svelte');
  if (mask & (1 << 6)) out.push('jquery');
  if (mask & (1 << 7)) out.push('delegated');
  if (mask & (1 << 8)) out.push('other');
  // bit 9 = inferred flag; no specific source label

  return out;
}
