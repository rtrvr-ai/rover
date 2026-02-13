// packages/shared/lib/firebase/config.ts
import { getApps, initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth/web-extension';
import { getFirestore } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';
import { getStorage } from 'firebase/storage';
// import { connectFunctionsEmulator } from "firebase/functions";

// Firebase configuration
export const firebaseConfig = {
  apiKey: 'AIzaSyB1a_BcU6iTNSNBwUEv5DTLx4G2aB1pAtM',
  authDomain: 'rtrvr-extension-functions.firebaseapp.com',
  projectId: 'rtrvr-extension-functions',
  databaseURL: 'https://rtrvr-extension-functions-default-rtdb.firebaseio.com',
  storageBucket: 'rtrvr-extension-functions.firebasestorage.app',
  messagingSenderId: '714736390407',
  appId: '1:714736390407:web:bc339025267ae7fc71f5a2',
};

export const WEB_OAUTH_CLIENT_ID = '714736390407-ahou09122d521h77e5amg76oik61paav.apps.googleusercontent.com';

// Base scopes for initial login (minimal permissions)
export const BASE_AUTH_SCOPES = [
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];

// Additional scopes requested incrementally when needed
export const DRIVE_SCOPES = ['https://www.googleapis.com/auth/drive.file'];

// Full scopes (for backward compatibility and reference)
export const AUTH_SCOPES = [...BASE_AUTH_SCOPES, ...DRIVE_SCOPES];

// Helper to check if a scope set includes drive permissions
export const hasDriveScope = (scopes: string[]): boolean => {
  return DRIVE_SCOPES.some(ds => scopes.includes(ds));
};

export const CLOUD_FUNCTIONS_URL =
  'http://127.0.0.1:5002/rtrvr-extension-functions/us-central1';
  // Production URL:
  // 'https://us-central1-rtrvr-extension-functions.cloudfunctions.net';

export const RTRVR_WEBSITE =
  // 'http://localhost:3000';
  // Production URL:
  'https://www.rtrvr.ai';

export const RTRVR_MCP_URL = 'https://mcp.rtrvr.ai';

// FCM Configuration
export const FCM_SENDER_ID = '714736390407';

export const RTRVRAI_DATABASE = 'rtrvrai';
export const RTRVRAI_EXCHANGE_DATABASE = 'rtrvr-exchange';

// Initialize Firebase app if it hasn't been already
export const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

export const defaultDb = getFirestore(app);
export const rtrvraiDb = getFirestore(app, RTRVRAI_DATABASE);
export const storage = getStorage(app);
export const auth = getAuth(app);
export const functions = getFunctions(app);
// connectFunctionsEmulator(functions, '127.0.0.1', 5002);
