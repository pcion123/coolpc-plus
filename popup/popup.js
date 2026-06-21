/**
 * Popup Settings Page
 */

const STORAGE_KEY = 'ai_advisor_settings';
const DEFAULT_THEME = 'dark';

const MODEL_OPTIONS = {
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

const providerEl = document.getElementById('provider');
const modelEl = document.getElementById('model');
const themeEl = document.getElementById('theme');
const apiKeyEl = document.getElementById('api-key');
const saveKeyEl = document.getElementById('save-key');
const statusEl = document.getElementById('status');

function applyTheme(theme) {
  const normalizedTheme = theme === 'light' ? 'light' : DEFAULT_THEME;
  document.body.dataset.theme = normalizedTheme;
  themeEl.value = normalizedTheme;
}

function saveTheme(theme) {
  chrome.storage.sync.get(STORAGE_KEY, result => {
    const settings = {
      ...(result[STORAGE_KEY] || {}),
      theme: theme === 'light' ? 'light' : DEFAULT_THEME,
    };
    chrome.storage.sync.set({ [STORAGE_KEY]: settings });
  });
}

function updateModelList() {
  const provider = providerEl.value;
  const options = MODEL_OPTIONS[provider] || [];
  modelEl.innerHTML = options
    .map(o => `<option value="${o.value}">${o.label}</option>`)
    .join('');
  toggleApiKeySection(provider);
}

function toggleApiKeySection(provider) {
  const apiKeySection = document.getElementById('apikey-section');
  const chromeAiNote = document.getElementById('chrome-ai-note');
  const isChromeAi = provider === 'chrome-ai';
  apiKeySection.classList.toggle('hidden', isChromeAi);
  chromeAiNote.classList.toggle('visible', isChromeAi);
}

providerEl.addEventListener('change', updateModelList);
themeEl.addEventListener('change', () => {
  applyTheme(themeEl.value);
  saveTheme(themeEl.value);
});

document.getElementById('toggle-eye').addEventListener('click', () => {
  apiKeyEl.type = apiKeyEl.type === 'password' ? 'text' : 'password';
});

document.getElementById('save-btn').addEventListener('click', () => {
  chrome.storage.sync.get(STORAGE_KEY, result => {
    const settings = {
      ...(result[STORAGE_KEY] || {}),
      provider: providerEl.value,
      model: modelEl.value,
      theme: themeEl.value,
      saveKey: saveKeyEl.checked,
      apiKey: saveKeyEl.checked ? apiKeyEl.value : '',
    };
    chrome.storage.sync.set({ [STORAGE_KEY]: settings }, () => {
      statusEl.textContent = '設定已儲存';
      statusEl.className = 'status';
      setTimeout(() => { statusEl.textContent = ''; }, 2000);
    });
  });
});

// 讀取已儲存的設定
chrome.storage.sync.get(STORAGE_KEY, result => {
  updateModelList();
  const s = result[STORAGE_KEY] || {};
  applyTheme(s.theme || DEFAULT_THEME);
  if (s.provider) {
    providerEl.value = s.provider;
    updateModelList();
  }
  if (s.model) modelEl.value = s.model;
  if (s.saveKey) {
    saveKeyEl.checked = true;
    if (s.apiKey) apiKeyEl.value = s.apiKey;
  }
});