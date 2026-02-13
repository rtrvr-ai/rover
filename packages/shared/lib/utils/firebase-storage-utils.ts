// packages/shared/lib/utils/firebase-storage-utils.ts (or /services)
import type { AuthManager } from '../firebase/auth-manager.js';
import type { StorageError } from 'firebase/storage';

export enum ServiceType {
  FUNCTION_SERVICE = 'functionService',
  TASK_HISTORY_SERVICE = 'taskHistoryService',
  RECORDING_SERVICE = 'recordingService',
}

/**
 * Handles Firebase storage errors, attempting to refresh auth if needed
 * @param error The error to handle
 * @param serviceType The service type for logging
 * @param authManager The auth manager instance
 * @returns True if the error was handled and operation should be retried
 */
export async function handleStorageError(
  error: StorageError | Error,
  serviceType: ServiceType,
  authManager: AuthManager,
  options: { allowInteractiveAuth?: boolean } = {},
): Promise<boolean> {
  // Check if it's a StorageError with a code
  if (error && typeof error === 'object' && 'code' in error) {
    const storageError = error as StorageError;

    // Check for authentication errors
    if (
      storageError.code === 'storage/unauthorized' ||
      storageError.code === 'storage/unauthenticated' ||
      storageError.code === 'storage/invalid-auth' ||
      storageError.code === 'storage/invalid-user-token' ||
      storageError.code === 'storage/user-token-expired'
    ) {
      console.warn(`[${serviceType}] Authentication error, attempting to refresh tokens`);

      try {
        // Try to refresh authentication silently
        const result = await authManager.authenticateSilently();

        if (result !== null) {
          // console.log(`[${serviceType}] Authentication refreshed successfully`);
          return true; // Return true if tokens were refreshed successfully
        } else {
          console.warn(`[${serviceType}] Failed to refresh authentication silently`);
          if (options.allowInteractiveAuth) {
            try {
              await authManager.authenticateWithGoogle();
              return true;
            } catch (e) {
              console.warn(`[${serviceType}] Interactive auth failed`, e);
            }
          }
          return false;
        }
      } catch (authError) {
        console.error(`[${serviceType}] Error refreshing authentication:`, authError);
        return false;
      }
    }

    // Check for rate limiting errors
    if (storageError.code === 'storage/retry-limit-exceeded') {
      console.warn(`[${serviceType}] Rate limit exceeded, will not retry`);
      return false;
    }

    // Check for quota errors
    if (storageError.code === 'storage/quota-exceeded') {
      console.error(`[${serviceType}] Storage quota exceeded`);
      return false;
    }
  }

  // Log other errors but don't retry
  console.error(`[${serviceType}] Storage error:`, error);
  return false;
}

/**
 * Executes a storage operation with automatic retry on auth errors
 * @param operation The storage operation to execute
 * @param serviceType The service type for logging
 * @param authManager The auth manager instance
 * @param maxRetries Maximum number of retry attempts (default: 1)
 * @returns The result of the operation or null/throws based on throwOnError
 */
export async function executeWithRetry<T>(
  operation: () => Promise<T>,
  serviceType: ServiceType,
  authManager: AuthManager,
  options: {
    maxRetries?: number;
    throwOnError?: boolean;
    allowInteractiveAuth?: boolean;
  } = {},
): Promise<T | null> {
  const { maxRetries = 1, throwOnError = false, allowInteractiveAuth = false } = options;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Try to execute the operation
      const result = await operation();

      // If successful, return the result
      if (attempt > 0) {
        // console.log(`[${serviceType}] Operation succeeded on retry attempt ${attempt}`);
      }
      return result;
    } catch (error) {
      lastError = error as Error;

      // Check if this is the last attempt
      if (attempt === maxRetries) {
        console.error(`[${serviceType}] Operation failed after ${maxRetries + 1} attempts:`, error);
        break;
      }

      // Check if we should retry
      const shouldRetry = await handleStorageError(error as Error, serviceType, authManager, {
        allowInteractiveAuth,
      });

      if (!shouldRetry) {
        // Error is not retryable, break the loop
        console.error(`[${serviceType}] Non-retryable error, stopping attempts:`, error);
        break;
      }

      // Log retry attempt
      // console.log(`[${serviceType}] Retrying operation (attempt ${attempt + 1}/${maxRetries})...`);

      // Add a small delay before retry to avoid hammering the service
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }

  // If we get here, all attempts failed
  if (throwOnError && lastError) {
    throw lastError;
  }

  return null;
}

/**
 * Helper function to batch operations for better performance
 * @param items Items to process
 * @param batchSize Size of each batch
 * @param processor Function to process each batch
 * @returns Array of results from all batches
 */
export async function processBatches<T, R>(
  items: T[],
  batchSize: number,
  processor: (batch: T[]) => Promise<R[]>,
): Promise<R[]> {
  const results: R[] = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await processor(batch);
    results.push(...batchResults);
  }

  return results;
}

/**
 * Helper function to handle concurrent operations with limit
 * @param operations Array of operations to execute
 * @param concurrencyLimit Maximum number of concurrent operations
 * @returns Array of results (including nulls for failed operations)
 */
export async function executeConcurrent<T>(
  operations: (() => Promise<T>)[],
  concurrencyLimit: number = 5,
): Promise<(T | null)[]> {
  const results: (T | null)[] = new Array(operations.length).fill(null);
  const executing: Promise<void>[] = [];

  for (let i = 0; i < operations.length; i++) {
    const operation = operations[i];
    const promise = operation()
      .then(result => {
        results[i] = result;
      })
      .catch(error => {
        console.error(`Operation ${i} failed:`, error);
        results[i] = null;
      });

    executing.push(promise);

    if (executing.length >= concurrencyLimit) {
      await Promise.race(executing);
      executing.splice(
        executing.findIndex(p => p),
        1,
      );
    }
  }

  await Promise.all(executing);
  return results;
}

/**
 * Validates Firebase Storage path
 * @param path The storage path to validate
 * @returns True if the path is valid
 */
export function isValidStoragePath(path: string): boolean {
  // Firebase Storage path restrictions
  const invalidChars = ['#', '[', ']', '*', '?'];
  const invalidSequences = ['//', '/.', '/.'];

  // Check for invalid characters
  for (const char of invalidChars) {
    if (path.includes(char)) {
      return false;
    }
  }

  // Check for invalid sequences
  for (const seq of invalidSequences) {
    if (path.includes(seq)) {
      return false;
    }
  }

  // Check path length (max 1024 bytes when UTF-8 encoded)
  if (new Blob([path]).size > 1024) {
    return false;
  }

  return true;
}

/**
 * Sanitizes a string for use as a Firebase Storage path segment
 * @param input The string to sanitize
 * @returns Sanitized string safe for use in storage paths
 */
export function sanitizeStoragePathSegment(input: string): string {
  // Remove or replace invalid characters
  let sanitized = input
    .replace(/[#\[\]\*\?]/g, '_') // Replace invalid chars with underscore
    .replace(/\s+/g, '_') // Replace whitespace with underscore
    .replace(/\/+/g, '_') // Replace slashes with underscore
    .replace(/\.+$/g, '') // Remove trailing dots
    .replace(/^\.+/g, ''); // Remove leading dots

  // Ensure it's not empty after sanitization
  if (!sanitized) {
    sanitized = 'unnamed';
  }

  // Truncate if too long (keeping under 200 chars to be safe)
  if (sanitized.length > 200) {
    sanitized = sanitized.substring(0, 200);
  }

  return sanitized;
}
