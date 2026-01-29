// packages/shared/lib/types/recording-types.ts
import type { Timestamp } from './index.js';

/** Observed event types */
export enum OBSERVED_DOM_EVENT {
  PAGE_LOAD = 'PAGE_LOAD',
  SEARCH = 'SEARCH',
  SCROLL = 'SCROLL',
  KEYBOARD = 'KEYBOARD',
  MOUSE = 'MOUSE',
  WAIT = 'WAIT',
  CHANGE = 'CHANGE',
  BACK = 'BACK',
  STOP = 'STOP',
  UNKNOWN = 'UNKNOWN',
}

export enum MOUSE_EVENT {
  MOUSE_UP = 'MOUSE_UP',
  MOUSE_DOWN = 'MOUSE_DOWN',
  MOUSE_MOVE = 'MOUSE_MOVE',
  UNKNOWN = 'UNKNOWN',
}

export enum MOUSE_BUTTON {
  MAIN = 'MAIN',
  AUXILIARY = 'AUXILIARY',
  SECONDARY = 'SECONDARY',
  FOURTH = 'FOURTH',
  FIFTH = 'FIFTH',
  UNKNOWN = 'UNKNOWN',
}

export enum FUNCTION_KEY {
  ENTER = 'ENTER',
  UNKNOWN = 'UNKNOWN',
}

export enum KEY_EVENT {
  KEYUP = 'KEYUP',
  KEYDOWN = 'KEYDOWN',
  KEYPRESS = 'KEYPRESS',
  UNKNOWN = 'UNKNOWN',
}

/** Bhavani TO_DO: See what all additional metadata needed for
 * Shadow Roots and add them, may be like mode: open/closed etc */
export interface ShadowRoot {
  css_selector: string;
}

// Bhavani TO_DO: The typecase with _ hopefully is better for readibility for model, if not switch to camelcase for consistency
export interface RecordMouseEvent {
  type: MOUSE_EVENT;
  button: MOUSE_BUTTON;
  modifier_key_states: ModifierKeyStates;
  slider_value?: number;
  is_scrollbar: boolean;
}

export interface RecordScrollEvent {
  x_offset: number;
  y_offset: number;
}

export interface RecordChangeEvent {
  options: { value: string }[];
  selected_indices: number[];
}

export interface RecordKeyboardEvent {
  key_type?: { text: string } | { function_key: FUNCTION_KEY };
  modifier_key_states: ModifierKeyStates;
  followed_by_enter: boolean;
}

export interface ModifierKeyStates {
  alt_key: boolean;
  ctrl_key: boolean;
  meta_key: boolean;
  shift_key: boolean;
}

export interface RecordEvent {
  type: OBSERVED_DOM_EVENT;
  mouse_event?: RecordMouseEvent;
  keyboard_event?: RecordKeyboardEvent;
  change_event?: RecordChangeEvent;
  scroll_event?: RecordScrollEvent;
  event_index: number;
  time_from_start: Timestamp;
  shadow_roots: ShadowRoot[];
  url: string;
  attributes?: { [key: string]: string };
  tag_name?: string;
  role?: string;
  name?: string;
  checkBoxIsChecked?: boolean;
  value?: string;
  placeholder?: string;
  iframeProps?: iframeProps;
  // Bhavani TO_DO: See if more metadata such as description are needed in the future
}

interface iframeProps {
  isIframe?: boolean;
  isInsideIframe?: boolean;
  iframeId?: string;
}

export interface Recording {
  recordingId: string;
  recordingName: string;
  events: RecordEvent[];
  captureTimestamp: Timestamp;
  displayName?: string; // Add displayName to Shared Artifact metadata
  photoURL?: string; // Add photoURL to Shared Artifact metadata
}

export interface RecordingMetadata {
  recordingId: string;
  recordingName: string;
  captureTimestamp: Timestamp;
}

export enum RecordingState {
  IDLE = 'idle',
  STARTING = 'starting',
  RECORDING = 'recording',
  PAUSED = 'paused',
  STOPPING = 'stopping',
  COMPLETED = 'completed',
}
