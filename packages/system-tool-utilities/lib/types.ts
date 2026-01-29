// packages/system-tools/lib/types.ts - Comprehensive System Tool Type Definitions

import { SystemToolNames } from '@rover/shared';

/**
 * ==========================================================================
 * CORE INTERACTION & FORM ACTION ARGUMENT TYPES
 * ==========================================================================
 *
 * These argument types define the parameters for basic interactive elements
 * like clicking, typing, and form manipulation.
 */

/** Arguments for the click_element tool */
export interface ClickElementArgs {
  /** The ID of the browser tab containing the element. */
  tab_id: number;
  /** The numerical ID of the element to click. */
  element_id: number;
}

/** Arguments for the type_into_element tool */
export interface TypeIntoElementArgs {
  /** The ID of the browser tab containing the element. */
  tab_id: number;
  /** The numerical ID of the input element. */
  element_id: number;
  /** The text content to type into the field. */
  text: string;
}

/** Arguments for the select_dropdown_value tool */
export interface SelectDropdownValueArgs {
  /** The ID of the browser tab containing the element. */
  tab_id: number;
  /** The numerical ID of the select (dropdown) element. */
  element_id: number;
  /** The exact value or text of the option to select. */
  value: string;
}

/** Arguments for the type_and_enter tool */
export interface TypeAndEnterArgs {
  /** The ID of the browser tab containing the element. */
  tab_id: number;
  /** The numerical ID of the input element. */
  element_id: number;
  /** The text content to type before pressing Enter. */
  text: string;
}

/** Arguments for the describe_images tool */
export interface DescribeImagesArgs {
  /** The ID of the browser tab containing the elements. */
  tab_id: number;
  /** Array of numerical ID of the image elements. */
  element_ids: number[];
  /**  Numerical ID of the image element. */
  element_id: number;
}

/** Arguments for the scroll_page tool */
export interface ScrollPageArgs {
  /** The ID of the browser tab to scroll. */
  tab_id: number;
  /** Optional: The numerical ID of the specific element to scroll within. If omitted, scrolls the main window. */
  element_id?: number;
  /** Optional: The global ID of any element inside the iframe. */
  iframe_id?: number;
  /** The direction to scroll. */
  direction: ScrollDirectionEnum;
}

/** Arguments for the wait_action tool */
export interface WaitActionArgs {
  /** The ID of the browser tab to apply the wait. */
  tab_id: number;
  /** [FIXED] Optional: Time to wait in milliseconds. */
  duration?: number;
}

// ============================================
// NAVIGATION TOOLS
// ============================================

/** Arguments for the go_back tool */
export interface GoBackArgs {
  /** The ID of the browser tab to navigate back. */
  tab_id: number;
}

/** Arguments for the go_forward tool */
export interface GoForwardArgs {
  /** The ID of the browser tab to navigate forward. */
  tab_id: number;
}

/** Arguments for the goto_url tool */
export interface GotoUrlArgs {
  /** The ID of the browser tab to navigate. */
  tab_id: number;
  /** The full URL to navigate to. */
  url: string;
}

/** Arguments for the open_new_tab system tool - direct URL navigation */
export interface OpenNewTabArgs {
  /** The full URL to navigate to (must include protocol) */
  url: string;
}

/** Arguments for the google_search tool */
export interface GoogleSearchArgs {
  /** The ID of the browser tab to perform the search in. */
  tab_id: number;
  /** The search query text. */
  query: string;
}

/** Arguments for the refresh_page tool */
export interface RefreshPageArgs {
  /** The ID of the browser tab to refresh. */
  tab_id: number;
  /** Optional: Force hard refresh ignoring cache (default: false). */
  hard_refresh?: boolean;
}

// ============================================
// TAB MANAGEMENT
// ============================================

/** Arguments for the switch_tab tool */
export interface SwitchTabArgs {
  /** The tab_id to switch to. */
  tab_id: number;
}

/** Arguments for the close_tab tool */
export interface CloseTabArgs {
  /** The tab_id of the tab to close. */
  tab_id: number;
}

// ============================================
// MOUSE & KEYBOARD ACTIONS
// ============================================

/** Arguments for the hover_element tool */
export interface HoverElementArgs {
  /** The ID of the browser tab containing the element. */
  tab_id: number;
  /** The numerical ID of the element to hover over. */
  element_id: number;
  /** Optional: Duration to maintain hover in milliseconds (default: 500). */
  duration?: number;
}

/** Arguments for the right_click_element tool */
export interface RightClickElementArgs {
  /** The ID of the browser tab containing the element. */
  tab_id: number;
  /** The numerical ID of the element to right-click. */
  element_id: number;
}

/** Arguments for the double_click_element tool */
export interface DoubleClickElementArgs {
  /** The ID of the browser tab containing the element. */
  tab_id: number;
  /** The numerical ID of the element to double-click. */
  element_id: number;
}

/** Arguments for the press_key tool */
export interface PressKeyArgs {
  /** The ID of the browser tab for the key press. */
  tab_id: number;
  /** The key to press (e.g., 'Enter', 'Escape', 'ArrowDown'). */
  key: string;
  /** Optional: Modifier keys to hold while pressing. */
  modifiers?: KeyModifierEnum[];
  /** Optional: Element to focus before pressing key. */
  element_id?: number;
  /** Optional: The global ID of any element inside the iframe. */
  iframe_id?: number;
}

/** Arguments for the mouse_wheel tool */
export interface MouseWheelArgs {
  /** The ID of the browser tab containing the element. */
  tab_id: number;
  /** The element to perform wheel action on. */
  element_id: number;
  /** Horizontal wheel delta (negative = left, positive = right). */
  delta_x: number;
  /** Vertical wheel delta (negative = up, positive = down). */
  delta_y: number;
}

// ============================================
// DRAG, DROP & SCROLL
// ============================================

/** Arguments for the drag_element tool */
export interface DragElementArgs {
  /** The ID of the browser tab containing the element. */
  tab_id: number;
  /** The numerical ID of the element to drag. */
  element_id: number;
  /** Direction to drag: UP, DOWN, LEFT, or RIGHT. */
  direction: DragDirectionEnum;
  /** Distance to drag in pixels. */
  distance: number;
}

/** Arguments for the drag_and_drop tool */
export interface DragAndDropArgs {
  /** The ID of the browser tab containing the elements. */
  tab_id: number;
  /** The numerical ID of the element to drag. */
  source_element_id: number;
  /** Optional: The numerical ID of the target element to drop onto. */
  target_element_id?: number;
  /** Optional: X coordinate to drop at (if target_element_id not provided). */
  target_x?: number;
  /** Optional: Y coordinate to drop at (if target_element_id not provided). */
  target_y?: number;
}

/** Arguments for the scroll_to_element tool */
export interface ScrollToElementArgs {
  /** The ID of the browser tab containing the element. */
  tab_id: number;
  /** The numerical ID of the element to scroll to. */
  element_id: number;
  /** Optional: Where to align the element in the viewport (default: 'center'). */
  position?: ScrollPositionEnum;
}

// ============================================
// FORM & WIDGET ACTIONS
// ============================================

/** Arguments for the clear_element tool */
export interface ClearElementArgs {
  /** The ID of the browser tab containing the element. */
  tab_id: number;
  /** The numerical ID of the input element to clear. */
  element_id: number;
}

/** Arguments for the adjust_slider tool */
export interface AdjustSliderArgs {
  /** The ID of the browser tab containing the element. */
  tab_id: number;
  /** The numerical ID of the slider element. */
  element_id: number;
  /** The target value to set the slider to. */
  value: number;
}

/** Arguments for the check_field_validity tool */
export interface CheckFieldValidityArgs {
  /** The ID of the browser tab containing the element. */
  tab_id: number;
  /** The numerical ID of the form field to check. */
  element_id: number;
}

/** Arguments for the focus_element tool */
export interface FocusElementArgs {
  /** The ID of the browser tab containing the element. */
  tab_id: number;
  /** The numerical ID of the element to focus. */
  element_id: number;
}

/** Arguments for the select_text tool */
export interface SelectTextArgs {
  /** The ID of the browser tab containing the element. */
  tab_id: number;
  /** The element containing the text to select. */
  element_id: number;
  /** Optional: Character offset to start selection (default: 0). */
  start_offset?: number;
  /** Optional: Character offset to end selection (default: all text). */
  end_offset?: number;
}

// ============================================
// TOUCH, GESTURES & CLIPBOARD
// ============================================

/** Arguments for the swipe_element tool */
export interface SwipeElementArgs {
  /** The ID of the browser tab containing the element. */
  tab_id: number;
  /** The numerical ID of the element to swipe. */
  element_id: number;
  /** Direction to swipe: LEFT, RIGHT, UP, or DOWN. */
  direction: SwipeDirectionEnum;
  /** Optional: Distance to swipe in pixels (default: element width/height). */
  distance?: number;
}

/** Arguments for the long_press_element tool */
export interface LongPressElementArgs {
  /** The ID of the browser tab containing the element. */
  tab_id: number;
  /** The numerical ID of the element to long press. */
  element_id: number;
  /** Optional: Duration to hold in milliseconds (default: 800). */
  duration?: number;
}

/** Arguments for the pinch_zoom tool */
export interface PinchZoomArgs {
  /** The ID of the browser tab for the gesture. */
  tab_id: number;
  /** Zoom scale factor (>1.0 zooms in, <1.0 zooms out). */
  scale: number;
  /** Optional: Element to center zoom on. */
  center_element_id?: number;
  /** Optional: The global ID of any element inside the iframe. */
  iframe_id?: number;
}

/** Arguments for the copy_text tool */
export interface CopyTextArgs {
  /** The ID of the browser tab for the copy action. */
  tab_id: number;
  /** Optional: Element containing text to copy. If omitted, copies current selection. */
  element_id?: number;
  /** Optional: The global ID of any element inside the iframe. */
  iframe_id?: number;
}

/** Arguments for the paste_text tool */
export interface PasteTextArgs {
  /** The ID of the browser tab for the paste action. */
  tab_id: number;
  /** Optional: Element to paste into. If omitted, uses current focus. */
  element_id?: number;
  /** Optional: The global ID of any element inside the iframe. */
  iframe_id?: number;
}

// ============================================
// FILE ACTIONS
// ============================================
export interface UploadFileArgsMetadata {
  /** 0-based index of the file (used by LLM) */
  file_index: number;
  /** The stable unique ID of the file (from LLMDataInput.id) */
  file_id: string;
  /** The Firebase Storage URL for client-side download/upload */
  file_url?: string;
  /** The resolved filename */
  file_name?: string;
  /** The MIME type of the file */
  mime_type?: string;
  /** Error message if resolution failed */
  _error?: string;
}

/**
 * Arguments for the upload_file system tool
 */
export interface UploadFileArgs extends UploadFileArgsMetadata {
  /** The ID of the file input element from the accessibility tree */
  element_id: number;
  /** The 0-based index of the tab containing the element */
  tab_id: number;
}

// ============================================
// WAIT & VERIFY ACTIONS
// ============================================

/** Arguments for the wait_for_element tool */
export interface WaitForElementArgs {
  /** The ID of the browser tab to watch. */
  tab_id: number;
  /** Text content or role to wait for (e.g., 'Submit', 'button'). */
  selector: string;
  /** Optional: Maximum time to wait in milliseconds (default: 5000). */
  timeout?: number;
  /** Optional: The global ID of any element inside the iframe. */
  iframe_id?: number;
}

/** Arguments for the answer_task tool */
export interface AnswerTaskArgs {
  /** A concise justification for why the task is considered complete. */
  reason: string;
}

/**
 * ==========================================================================
 * UNIFIED SYSTEM TOOL ARGUMENTS TYPE
 * ==========================================================================
 *
 * Union type representing all possible system tool argument structures.
 * Used for type safety when processing any system tool call.
 */
export type SystemToolArgs =
  // Existing
  | ClickElementArgs
  | TypeIntoElementArgs
  | SelectDropdownValueArgs
  | TypeAndEnterArgs
  | DescribeImagesArgs
  | ScrollPageArgs
  | WaitActionArgs
  | GoBackArgs
  | GotoUrlArgs
  | GoogleSearchArgs
  // New
  | HoverElementArgs
  | RightClickElementArgs
  | DoubleClickElementArgs
  | DragElementArgs
  | DragAndDropArgs
  | PressKeyArgs
  | ScrollToElementArgs
  | ClearElementArgs
  | AdjustSliderArgs
  | SwipeElementArgs
  | LongPressElementArgs
  | WaitForElementArgs
  | CopyTextArgs
  | PasteTextArgs
  | RefreshPageArgs
  | GoForwardArgs
  // Newly Added
  | FocusElementArgs
  | PinchZoomArgs
  | SelectTextArgs
  | SwitchTabArgs
  | OpenNewTabArgs
  | CloseTabArgs
  | CheckFieldValidityArgs
  | MouseWheelArgs
  // Final
  | AnswerTaskArgs;

/**
 * Tools that require a target element to function properly
 * These tools will fail if no element_id is provided
 */
export const toolsRequiringTargetElement: SystemToolNames[] = [
  SystemToolNames.click_element,
  SystemToolNames.type_into_element,
  SystemToolNames.type_and_enter,
  SystemToolNames.select_dropdown_value,
  SystemToolNames.clear_element,
  SystemToolNames.focus_element,
  SystemToolNames.hover_element,
  SystemToolNames.right_click_element,
  SystemToolNames.double_click_element,
  SystemToolNames.long_press_element,
  SystemToolNames.drag_element,
  SystemToolNames.drag_and_drop,
  SystemToolNames.swipe_element,
  SystemToolNames.adjust_slider,
  SystemToolNames.describe_images,
  SystemToolNames.scroll_to_element,
  SystemToolNames.paste_text,
  // Note: scroll_page and press_key have optional element targeting
];

/**
 * ==========================================================================
 * ENUMERATION DEFINITIONS
 * ==========================================================================
 */

/** Scroll direction options for scroll_page system tool */
export enum ScrollDirectionEnum {
  UP = 'UP',
  DOWN = 'DOWN',
  LEFT = 'LEFT',
  RIGHT = 'RIGHT',
  TOP = 'TOP',
  BOTTOM = 'BOTTOM',
}

/** Scroll position alignment options for scroll_to_element system tool */
export enum ScrollPositionEnum {
  START = 'START',
  CENTER = 'CENTER',
  END = 'END',
  NEAREST = 'NEAREST',
}

/** Keyboard modifier keys for press_key system tool */
export enum KeyModifierEnum {
  CTRL = 'CTRL',
  ALT = 'ALT',
  SHIFT = 'SHIFT',
  META = 'META',
}

/** Drag direction options for drag_element system tool */
export enum DragDirectionEnum {
  UP = 'UP',
  DOWN = 'DOWN',
  LEFT = 'LEFT',
  RIGHT = 'RIGHT',
}

/** Swipe direction options for touch gesture system tools */
export enum SwipeDirectionEnum {
  LEFT = 'LEFT',
  RIGHT = 'RIGHT',
  UP = 'UP',
  DOWN = 'DOWN',
}
