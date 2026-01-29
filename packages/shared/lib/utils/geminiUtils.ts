// packages/shared/lib/utils/geminiUtils.ts

export const validateGeminiApiKey = async (apiKey: string): Promise<{ valid: boolean; error?: string }> => {
  if (!apiKey || !apiKey.trim()) {
    return { valid: false, error: 'API key is required' };
  }

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (response.ok) {
      // Successfully connected - key is valid
      return { valid: true };
    } else if (response.status === 400 || response.status === 403) {
      // Invalid API key
      const errorData = await response.json().catch(() => ({}));
      return {
        valid: false,
        error: errorData.error?.message || 'Invalid API key',
      };
    } else if (response.status === 429) {
      // Rate limited but key might be valid
      return {
        valid: false,
        error: 'Rate limited - please try again later',
      };
    } else {
      // Other error
      return {
        valid: false,
        error: `Connection failed (${response.status})`,
      };
    }
  } catch (error) {
    console.error('Failed to validate Gemini API key:', error);
    return {
      valid: false,
      error: 'Network error - please check your connection',
    };
  }
};
