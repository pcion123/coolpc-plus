/**
 * LLM Client — 統一介面封裝
 * 此模組在 content script 中僅作為型別/常數參考，
 * 實際 API 呼叫透過 background/service-worker.js 中繼。
 * Chrome 內建 AI（chrome-ai）例外：直接在 content script 呼叫 window.ai。
 */

/**
 * @typedef {Object} LLMConfig
 * @property {'openai'|'gemini'|'claude'|'chrome-ai'} provider
 * @property {string} apiKey
 * @property {string} model
 * @property {number} [maxTokens]
 */

/**
 * @typedef {Object} Message
 * @property {'system'|'user'|'assistant'} role
 * @property {string} content
 */

/**
 * 透過 chrome.runtime.sendMessage 委派給 background service worker 執行 LLM 請求。
 * chrome-ai provider 例外：直接呼叫 window.ai.languageModel。
 *
 * @param {Message[]} messages
 * @param {LLMConfig} config
 * @returns {Promise<{content: string}>}
 */
export async function chat(messages, config) {
  if (config.provider === 'chrome-ai') {
    return callChromeAI(messages);
  }
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        type: 'LLM_REQUEST',
        payload: {
          provider: config.provider,
          apiKey: config.apiKey,
          model: config.model,
          messages,
          maxTokens: config.maxTokens || 16384,
        },
      },
      response => {
        if (chrome.runtime.lastError) {
          return reject(new Error(chrome.runtime.lastError.message));
        }
        if (response?.success) {
          resolve(response.data);
        } else {
          reject(new Error(response?.error || '未知錯誤'));
        }
      }
    );
  });
}

/**
 * 呼叫 Chrome 內建 AI（Gemini Nano），不需要 API Key。
 * - Chrome 136+：使用頂層 window.LanguageModel
 * - Chrome 127–135：使用 window.ai.languageModel
 *
 * @param {Message[]} messages
 * @returns {Promise<{content: string}>}
 */
async function callChromeAI(messages) {
  // Chrome 136+ 使用頂層 LanguageModel；舊版使用 window.ai.languageModel
  const api = self.LanguageModel ?? self.ai?.languageModel ?? null;

  if (!api) {
    throw new Error(
      'Chrome 內建 AI 不可用。請確認：\n' +
      '1. Chrome 版本 ≥ 127\n' +
      '2. 開啟 chrome://flags/#optimization-guide-on-device-model 設為 Enabled\n' +
      '3. 開啟 chrome://flags/#prompt-api-for-gemini-nano 設為 Enabled\n' +
      '4. 重新啟動 Chrome'
    );
  }

  const availability = await api.availability();
  if (availability === 'no') {
    throw new Error('Chrome 內建 AI 目前不可用（availability: no）。');
  }
  if (availability === 'after-download') {
    throw new Error('Chrome 內建 AI 模型正在下載中，請稍後再試。');
  }

  const systemMsg = messages.find(m => m.role === 'system');
  const userMessages = messages.filter(m => m.role !== 'system');
  const userPrompt = userMessages.map(m => m.content).join('\n\n');

  const session = await api.create({
    systemPrompt: systemMsg?.content || '',
  });

  try {
    const result = await session.prompt(userPrompt);
    return { content: result };
  } finally {
    session.destroy();
  }
}

/** 各 Provider 支援的模型列表 */
export const PROVIDER_MODELS = {
  openai: [
    { value: 'gpt-4o-mini', label: 'gpt-4o-mini（快速/省費）' },
    { value: 'gpt-4o', label: 'gpt-4o（高品質）' },
    { value: 'gpt-4-turbo', label: 'gpt-4-turbo' },
  ],
  gemini: [
    { value: 'gemini-3.5-flash', label: 'gemini-3.5-flash' },
    { value: 'gemini-3.1-pro-preview', label: 'gemini-3.1-pro-preview' },
  ],
  claude: [
    { value: 'claude-3-haiku-20240307', label: 'claude-3-haiku（快速）' },
    { value: 'claude-3-5-sonnet-20241022', label: 'claude-3.5-sonnet（推薦）' },
    { value: 'claude-3-opus-20240229', label: 'claude-3-opus（旗艦）' },
  ],
  'chrome-ai': [
    { value: 'gemini-nano', label: 'Gemini Nano（Chrome 內建）' },
  ],
};
