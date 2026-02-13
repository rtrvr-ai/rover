// packages/shared/lib/pricing/utils.ts
import { FirebaseManager } from '../firebase/firebase-manager.js';
import { collection, addDoc, onSnapshot, getDocs, query, where, getDoc, doc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import type { Timestamp } from 'firebase/firestore';
import { Timestamp as FirestoreTimestamp } from 'firebase/firestore';

export const INITIALIZATION_CREDITS = 500;
export const REFERRAL_CREDIT_AWARD = 500;
export const MAX_REFERRALS_PER_USER = 10;

export enum CREDTS_EXPIRY_REASON {
  NO_PLAN_FOUND = 'noPlanFound',
  PLAN_ENDED = 'planEnded',
  CREDIT_BALANCE_ZERO = 'creditBalanceZero',
}

// User Tier Enum
export enum USER_TIER {
  FREE = 'free',
  STARTER = 'starter',
  PRO = 'pro',
  ENTERPRISE = 'enterprise',
  SCALE = 'scale',
}

export const TIER_PRICING: Record<USER_TIER, string> = {
  [USER_TIER.FREE]: '$0',
  [USER_TIER.STARTER]: '$9.99',
  [USER_TIER.PRO]: '$29.99',
  [USER_TIER.ENTERPRISE]: '$99.99',
  [USER_TIER.SCALE]: '$499.99',
};

export const TIER_CREDITS: Record<USER_TIER, number> = {
  [USER_TIER.FREE]: 250,
  [USER_TIER.STARTER]: 1500,
  [USER_TIER.PRO]: 4000,
  [USER_TIER.ENTERPRISE]: 125000,
  [USER_TIER.SCALE]: 600000,
};

export const PROD_PRICEID_TIERS: Record<string, USER_TIER> = {
  ['price_1QV1fuCT0lPpb1N5suUARnbJ']: USER_TIER.STARTER,
  ['price_1QV92HCT0lPpb1N5VisDEbNj']: USER_TIER.PRO,
  ['price_1QV93mCT0lPpb1N5vdizZQLz']: USER_TIER.ENTERPRISE,
  ['price_1RxADgCT0lPpb1N5gVOvaYTy']: USER_TIER.SCALE,
};

export const PROD_TIER_PRICEIDS: Record<USER_TIER, string> = {
  [USER_TIER.FREE]: '',
  [USER_TIER.STARTER]: 'price_1QV1fuCT0lPpb1N5suUARnbJ',
  [USER_TIER.PRO]: 'price_1QV92HCT0lPpb1N5VisDEbNj',
  [USER_TIER.ENTERPRISE]: 'price_1QV93mCT0lPpb1N5vdizZQLz',
  [USER_TIER.SCALE]: 'price_1RxADgCT0lPpb1N5gVOvaYTy',
};

// User Usage Data Types
export interface UserUsageData {
  plan: USER_TIER;
  currentCredits: number;
  currentCreditsUsed: number;
  creditsLeft: number;
  renewalDate: Timestamp | null;
  redeemedInviteCode: string | null;
  referralsMadeCount: number;
  creditsUsed: number;
  expiryReason?: string;
}

export interface PricingPlan {
  name: string;
  tier: USER_TIER;
  priceId: string;
  price: string;
  credits: number;
  features: string[];
  recommended?: boolean;
}

// Pricing Plans Definition
export const pricingPlans: PricingPlan[] = [
  {
    name: 'Basic',
    tier: USER_TIER.STARTER,
    priceId: PROD_TIER_PRICEIDS[USER_TIER.STARTER],
    price: TIER_PRICING[USER_TIER.STARTER],
    credits: TIER_CREDITS[USER_TIER.STARTER],
    features: ['1,000 Credits/Month', 'rtrvr.ai/exchange', 'Custom Artifact Support', 'Discord Support'],
  },
  {
    name: 'Pro',
    tier: USER_TIER.PRO,
    priceId: PROD_TIER_PRICEIDS[USER_TIER.PRO],
    price: TIER_PRICING[USER_TIER.PRO],
    credits: TIER_CREDITS[USER_TIER.PRO],
    features: ['3,000 Credits/Month', 'Hands On Debug Support', 'Priority Support Calls', 'Future: Cloud/API Platform'],
    recommended: true,
  },
  {
    name: 'Enterprise',
    tier: USER_TIER.ENTERPRISE,
    priceId: PROD_TIER_PRICEIDS[USER_TIER.ENTERPRISE],
    price: TIER_PRICING[USER_TIER.ENTERPRISE],
    credits: TIER_CREDITS[USER_TIER.ENTERPRISE],
    features: [
      '10,000 Credits/Month',
      'Everything in Pro',
      'Custom Integrations',
      'Dedicated Support',
      'SLA Guarantees',
      'Training Sessions',
    ],
  },
];

// Constants
export const CUSTOMER_PAYMENT_DELAY = 60000;
export const USER_USAGE_COLLECTION = 'user_usage';
export const DEFAULT_USER_FREE_CREDITS = 500;

// Firebase Manager instance
const firebaseManager = FirebaseManager.getInstance();

/**
 * Helper function to convert serialized timestamp from Firebase Functions
 * to a proper Firestore Timestamp object
 */
function convertSerializedTimestamp(serialized: any): Timestamp | null {
  if (!serialized) return null;

  // Check if it's already a Timestamp object
  if (serialized.toDate && typeof serialized.toDate === 'function') {
    return serialized;
  }

  // Check if it's a serialized timestamp from Firebase Functions
  if (serialized._seconds !== undefined) {
    return new FirestoreTimestamp(serialized._seconds, serialized._nanoseconds || 0);
  }

  // If it's a string date, convert to Timestamp
  if (typeof serialized === 'string') {
    return FirestoreTimestamp.fromDate(new Date(serialized));
  }

  return null;
}

// Check if user has active subscription
export async function isActiveSubscriber(userId: string): Promise<boolean> {
  try {
    const db = firebaseManager.getDefaultDb();
    const q = query(collection(db, 'customers', userId, 'subscriptions'), where('status', 'in', ['active']));
    const querySnapshot = await getDocs(q);
    return !querySnapshot.empty;
  } catch (error) {
    console.error('Error checking subscription status:', error);
    return false;
  }
}

/**
 * Real-time listener for user usage data
 * Sets up Firestore listener that calls callback on every update
 */
export function subscribeToUserUsage(
  userId: string,
  callback: (data: UserUsageData | null) => void,
  onError?: (error: Error) => void,
): () => void {
  const db = firebaseManager.getRtrvraiDb();
  const userDocRef = doc(db, USER_USAGE_COLLECTION, userId);

  // Set up real-time Firestore listener
  return onSnapshot(
    userDocRef,
    snapshot => {
      if (!snapshot.exists()) {
        callback(null);
        return;
      }

      const userData = snapshot.data();
      const currentDate = new Date();
      const renewalDate = userData.renewalDate ? convertSerializedTimestamp(userData.renewalDate) : null;

      // Check if needs renewal
      const creditsExpired = renewalDate !== null && renewalDate.toDate() < currentDate;

      if (creditsExpired) {
        // Trigger backend renewal asynchronously in background
        callBackendGetUserUsage().catch(console.error);
      }

      const creditsRemaining = Math.max(0, userData.currentCredits - userData.currentCreditsUsed);

      // Call callback with updated data
      callback({
        plan: userData.plan || USER_TIER.FREE,
        currentCredits: userData.currentCredits || INITIALIZATION_CREDITS,
        currentCreditsUsed: userData.currentCreditsUsed || 0,
        creditsLeft: creditsRemaining,
        renewalDate: renewalDate,
        redeemedInviteCode: userData.redeemedInviteCode || null,
        referralsMadeCount: userData.referralsMadeCount || 0,
        creditsUsed: userData.currentCreditsUsed || 0,
        expiryReason: creditsRemaining === 0 ? CREDTS_EXPIRY_REASON.CREDIT_BALANCE_ZERO : undefined,
      });
    },
    error => {
      console.error('[subscribeToUserUsage] Error in subscription:', error);
      if (onError) onError(error);
    },
  );
}

/**
 * Get user usage data by calling backend function
 * This ensures proper initialization and credit renewal
 */
export async function getUserUsageData(userId: string): Promise<UserUsageData | null> {
  try {
    const db = firebaseManager.getRtrvraiDb();

    // 1. Try direct Firestore read first (FAST & CHEAP)
    const userDocRef = doc(db, USER_USAGE_COLLECTION, userId);
    const userDoc = await getDoc(userDocRef);

    // 2. Edge Case: User doesn't exist - needs initialization
    if (!userDoc.exists()) {
      // console.log('[getUserUsageData] User not found, calling backend');
      return await callBackendGetUserUsage(); // Only call backend when needed
    }

    const userData = userDoc.data();
    const currentDate = new Date();
    const renewalDate = userData.renewalDate ? convertSerializedTimestamp(userData.renewalDate) : null;

    // 3. Edge Case: Credits expired - needs renewal
    const creditsExpired = renewalDate !== null && renewalDate.toDate() < currentDate;
    if (creditsExpired) {
      // console.log('[getUserUsageData] Credits expired, calling backend');
      return await callBackendGetUserUsage();
    }

    // 4. Calculate credits
    const creditsRemaining = Math.max(0, userData.currentCredits - userData.currentCreditsUsed);

    // 5. Edge Case: Credits depleted - needs cleanup
    if (creditsRemaining === 0 && userData.currentCredits > 0) {
      // console.log('[getUserUsageData] Credits depleted, calling backend');
      return await callBackendGetUserUsage();
    }

    // 6. Normal case: Return Firestore data directly (NO BACKEND CALL!)
    return {
      plan: userData.plan || USER_TIER.FREE,
      currentCredits: userData.currentCredits || INITIALIZATION_CREDITS,
      currentCreditsUsed: userData.currentCreditsUsed || 0,
      creditsLeft: creditsRemaining,
      renewalDate: renewalDate,
      redeemedInviteCode: userData.redeemedInviteCode || null,
      referralsMadeCount: userData.referralsMadeCount || 0,
      creditsUsed: userData.currentCreditsUsed || 0,
      expiryReason: creditsRemaining === 0 ? CREDTS_EXPIRY_REASON.CREDIT_BALANCE_ZERO : undefined,
    };
  } catch (error) {
    console.error('[getUserUsageData] Error, falling back to backend:', error);
    // Fallback to backend on any error
    return await callBackendGetUserUsage();
  }
}

// New helper function - extracted for reuse
async function callBackendGetUserUsage(): Promise<UserUsageData> {
  const functions = firebaseManager.getFunctions();
  const getUserUsage = httpsCallable(functions, 'getuserusage');
  const result = await getUserUsage();
  const data = result.data as any;
  return data;
}

// Create Stripe checkout session
export async function createCheckoutSession(
  userId: string,
  priceId: string,
  userEmail?: string,
): Promise<{ url?: string; error?: string }> {
  return new Promise(resolve => {
    const db = firebaseManager.getDefaultDb();
    const checkoutSessionRef = collection(db, 'customers', userId, 'checkout_sessions');

    const sessionData = {
      price: priceId,
      success_url: 'https://rtrvr.ai/',
      cancel_url: 'https://rtrvr.ai',
      client_reference_id: userId,
      mode: 'subscription',
      metadata: {
        userId: userId,
        userEmail: userEmail || '',
        priceId: priceId,
      },
      allow_promotion_codes: true,
    };

    addDoc(checkoutSessionRef, sessionData)
      .then(docRef => {
        const unsubscribe = onSnapshot(
          docRef,
          snap => {
            const data = snap.data() || {};
            if (data?.error) {
              console.error('Checkout error:', data.error);
              unsubscribe();
              resolve({ error: data.error.message || 'Checkout failed' });
            }
            if (data?.url) {
              unsubscribe();
              resolve({ url: data.url });
            }
          },
          error => {
            console.error('Snapshot listener error:', error);
            unsubscribe();
            resolve({ error: 'Failed to create checkout session' });
          },
        );
      })
      .catch(error => {
        console.error('Error creating checkout session:', error);
        resolve({ error: 'Failed to create checkout session' });
      });
  });
}

// Get billing portal URL
export async function getBillingPortalUrl(): Promise<string | null> {
  try {
    const firebaseManager = FirebaseManager.getInstance();
    const functions = firebaseManager.getFunctions();
    const getBillingPortal = httpsCallable(functions, 'billingportal');
    const result = await getBillingPortal({ returnUrl: 'https://rtrvr.ai' });
    const data = result.data as any;
    return data?.url || null;
  } catch (error) {
    console.error('Error getting billing portal:', error);
    return null;
  }
}
