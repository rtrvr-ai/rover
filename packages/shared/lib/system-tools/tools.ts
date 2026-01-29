/**
 * ==========================================================================
 * SYSTEM TOOL NAMES ENUMERATION
 * ==========================================================================
 *
 * Enumeration of all valid system tool function names.
 * These string values are used by LLMs and must remain stable.
 *
 * IMPORTANT: Do not change these string values as they are the interface
 * contract with the LLM system. Only modify comments and organization.
 */
export enum SystemToolNames {
  // ============================================
  // CORE INTERACTION & FORM ACTIONS
  // ============================================
  click_element = 'click_element',
  type_into_element = 'type_into_element',
  type_and_enter = 'type_and_enter',
  select_dropdown_value = 'select_dropdown_value',
  clear_element = 'clear_element',
  focus_element = 'focus_element',
  check_field_validity = 'check_field_validity',
  select_text = 'select_text',

  // ============================================
  // ADVANCED MOUSE & KEYBOARD ACTIONS
  // ============================================
  hover_element = 'hover_element',
  right_click_element = 'right_click_element',
  double_click_element = 'double_click_element',
  press_key = 'press_key',
  mouse_wheel = 'mouse_wheel',
  dispatch_pointer_path = 'dispatch_pointer_path',

  // ============================================
  // DRAG, DROP & COMPLEX WIDGETS
  // ============================================
  drag_element = 'drag_element',
  drag_and_drop = 'drag_and_drop',
  adjust_slider = 'adjust_slider',

  // ============================================
  // SCROLL & VIEWPORT
  // ============================================
  scroll_page = 'scroll_page',
  scroll_to_element = 'scroll_to_element',

  // ============================================
  // TOUCH GESTURES
  // ============================================
  swipe_element = 'swipe_element',
  long_press_element = 'long_press_element',
  pinch_zoom = 'pinch_zoom',

  // ============================================
  // NAVIGATION & TAB MANAGEMENT
  // ============================================
  go_back = 'go_back',
  go_forward = 'go_forward',
  goto_url = 'goto_url',
  refresh_page = 'refresh_page',
  open_new_tab = 'open_new_tab',
  switch_tab = 'switch_tab',
  close_tab = 'close_tab',

  // ============================================
  // INFORMATION & EXTERNAL ACTIONS
  // ============================================
  describe_images = 'describe_images',
  google_search = 'google_search',
  network_run_recipe = 'network_run_recipe',
  rover_external_read_context = 'rover_external_read_context',
  rover_external_act_context = 'rover_external_act_context',

  // ============================================
  // CLIPBOARD ACTIONS
  // ============================================
  copy_text = 'copy_text',
  paste_text = 'paste_text',

  // ============================================
  // WAIT & CONTROL FLOW
  // ============================================
  wait_action = 'wait_action',
  wait_for_element = 'wait_for_element',
  answer_task = 'answer_task',

  // ============================================
  // FILE OPERATIONS
  // ============================================
  upload_file = 'upload_file',

  // ============================================
  // CAPTCHA SOLVER
  // ============================================
  solve_captcha = 'solve_captcha',
}

/** Set of system tool names for efficient lookup and validation */
export const systemToolNamesSet = new Set<string>(Object.values(SystemToolNames));

export const SYSTEM_TOOLS_ELEMENT_ID_KEYS = [
  'element_id',
  'source_element_id',
  'target_element_id',
  'center_element_id',
  'element_ids', // ✅ batch
];

export const DESCRIBE_IMAGES_MAX = 40;

export function normalizeDescribeImageIds(args: Record<string, any>): number[] {
  const raw = Array.isArray(args?.element_ids) ? args.element_ids : args?.element_id != null ? [args.element_id] : [];

  const ids = Array.from(new Set(raw.map((x: any) => Math.trunc(Number(x))))).filter(n => Number.isFinite(n) && n > 0);

  // Cap to avoid huge payloads + runaway LLM calls
  return ids.slice(0, DESCRIBE_IMAGES_MAX);
}
