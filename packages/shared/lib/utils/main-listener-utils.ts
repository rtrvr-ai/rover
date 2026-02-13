export type FrameworkName = 'react' | 'vue' | 'angular' | 'svelte' | 'jquery';
export type ListenerSource =
  | 'inline'
  | 'native'
  | 'delegated'
  | 'jquery'
  | 'react'
  | 'vue'
  | 'angular'
  | 'svelte'
  | 'other';

export interface FrameworkElementMetadata {
  frameworks?: string[]; // from rtrvr-framework
  listenersRaw?: string; // from rtrvr-listeners
  role?: string | null;
  pattern?: string;
  value?: any;
}
