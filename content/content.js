/**
 * AI Build Advisor — Content Script
 * 注入 Right Sidebar，讀取頁面零件資料，呼叫 LLM 並高亮推薦零件。
 */

(function () {
  'use strict';

  // ===== 常數 =====
  const SIDEBAR_ID = 'ai-advisor-sidebar';
  const TOGGLE_ID = 'ai-advisor-toggle';
  const STORAGE_KEY = 'ai_advisor_settings';
  const DEFAULT_THEME = 'dark';
  const USAGE_LABELS = {
    gaming: '電競遊戲',
    office: '文書辦公',
    video: '影音剪輯',
    '3d': '3D 繪圖/設計',
    ai: 'AI/機器學習',
    general: '日常使用',
    server: '伺服器/NAS',
  };
  const CORE_CATEGORIES = new Set(['n4', 'n5', 'n6', 'n7', 'n8', 'n9', 'n10', 'n11', 'n12']);
  const RESPONSE_FORMAT_TEMPLATE = [
    '## 配置摘要',
    '用 2 到 3 句話說明這套配置適合的使用情境、預算策略與整體取向。',
    '',
    '## 推薦配置',
    '用有序清單列出主要零件，每項格式固定為：**分類名稱**：型號重點與選擇原因。',
    '',
    '## 選擇理由',
    '用 3 到 5 個 bullet 說明效能、相容性、升級性、散熱/電源與預算取捨。',
    '',
    '## 注意事項',
    '列出仍需使用者確認的事項，例如機殼尺寸、電源瓦數、是否需要獨顯、庫存或價格波動。',
    '',
    '```json',
    '{',
    '  "recommendations": [',
    '    { "selectName": "n4", "optionValue": 25, "reason": "範例原因" }',
    '  ],',
    '  "totalEstimate": 25000,',
    '  "summary": "整體說明"',
    '}',
    '```',
  ].join('\n');
  const ADVISOR_SYSTEM_PROMPT = `你是 CoolPC AI 配單助手，熟悉台灣原價屋零件清單、電腦組裝相容性與預算取捨。

你的任務是根據使用者需求，只從使用者提供的零件清單中選出合適配置。不得編造零件、selectName 或 optionValue。

回覆必須使用繁體中文，並嚴格遵守以下固定格式與順序：

${RESPONSE_FORMAT_TEMPLATE}

輸出規則：
1. Markdown 正文只能包含上述四個區塊，不要在正文提到 JSON、程式碼區塊或資料格式。
2. JSON 必須是回覆最後一段，而且只能有一個 \`\`\`json fenced code block，JSON 後面不得再輸出任何文字。
3. recommendations 只能放實際推薦並需要高亮的項目；selectName 必須使用清單標題中的值，例如 "n4"；optionValue 必須使用選項前方 [] 內的數字。
4. 如果某個分類沒有合適選項，就不要在 recommendations 放該分類，改在「注意事項」說明。
5. totalEstimate 請估算 recommendations 的總價；無法精準計算時用最接近的整數。
6. 請將格式說明與範例值替換成實際分析內容，不要照抄「範例原因」或說明文字。
7. 保持內容精簡、可掃讀，每個段落避免超過 4 行。`;
  let analysisLoadingTimer = null;
  let currentRecommendations = [];

  // 分類名稱對照（row index → 人類可讀名稱）
  const CATEGORY_NAMES = {
    n4: '處理器 CPU',
    n5: '主機板 MB',
    n6: '記憶體 RAM',
    n7: '固態硬碟 SSD/M.2',
    n8: '傳統硬碟 HDD',
    n9: '顯示卡 VGA',
    n10: '散熱器',
    n11: '機殼 CASE',
    n12: '電源供應器 PSU',
    n13: '螢幕 Monitor',
    n14: '鍵盤/滑鼠',
    n15: '筆記型電腦',
  };

  function getSelectCategoryName(select, fallbackName) {
    const row = select?.closest('tr');
    const categoryCell = row?.querySelector('td.t');
    if (categoryCell) {
      const clonedCell = categoryCell.cloneNode(true);
      clonedCell.querySelectorAll('.ai-advisor-highlight-badge').forEach(el => el.remove());
      const categoryText = clonedCell.textContent
        .replace(/\s+/g, ' ')
        .replace(/[：:]+$/g, '')
        .trim();
      if (categoryText) return categoryText;
    }
    return CATEGORY_NAMES[fallbackName] || fallbackName || '未知分類';
  }

  function getRecommendationCategoryName(recommendation) {
    const select = document.querySelector(`select[name="${recommendation.selectName}"]`);
    return getSelectCategoryName(select, recommendation.selectName);
  }

  function getIconSvg(name) {
    const icons = {
      sun: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2"></path><path d="M12 20v2"></path><path d="m4.93 4.93 1.41 1.41"></path><path d="m17.66 17.66 1.41 1.41"></path><path d="M2 12h2"></path><path d="M20 12h2"></path><path d="m6.34 17.66-1.41 1.41"></path><path d="m19.07 4.93-1.41 1.41"></path></svg>',
      moon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 7.2A9 9 0 1 1 12 3Z"></path></svg>',
      settings: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.51a2 2 0 0 1 1-1.72l.15-.1a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z"></path><circle cx="12" cy="12" r="3"></circle></svg>',
    };
    return icons[name] || '';
  }

  // ===== 建立 Sidebar DOM =====
  function createSidebar() {
    if (document.getElementById(SIDEBAR_ID)) return;

    const sidebar = document.createElement('div');
    sidebar.id = SIDEBAR_ID;
    sidebar.dataset.theme = DEFAULT_THEME;
    sidebar.innerHTML = getSidebarHTML();
    document.body.appendChild(sidebar);

    const toggle = document.createElement('button');
    toggle.id = TOGGLE_ID;
    toggle.title = '開啟 / 關閉 CoolPC AI 配單助手';
    const toggleSpan = document.createElement('span');
    toggleSpan.textContent = '關閉';
    toggle.appendChild(toggleSpan);
    document.body.appendChild(toggle);

    // 調整主頁面寬度避免被遮擋
    document.body.style.marginRight = '320px';
    document.body.style.transition = 'margin-right 0.3s';

    bindEvents();
    setSettingsControlsEnabled(false);
    loadSettings();
  }

  function getSidebarHTML() {
    return `
      <div id="ai-advisor-header">
        <div class="advisor-header-title">
          <h2>CoolPC AI 配單助手</h2>
        </div>
        <div class="advisor-header-actions">
          <button id="ui-theme-toggle" class="advisor-icon-button advisor-round-button" type="button" title="切換為亮色" aria-label="切換為亮色">
            <span class="advisor-button-icon" aria-hidden="true">${getIconSvg('sun')}</span>
          </button>
          <button id="ai-settings-open" class="advisor-icon-button advisor-round-button" type="button" title="開啟設定" aria-label="開啟設定" aria-expanded="false">
            <span class="advisor-button-icon" aria-hidden="true">${getIconSvg('settings')}</span>
          </button>
        </div>
      </div>

      <div id="ai-settings-popover" class="advisor-settings-popover" role="region" aria-labelledby="ai-settings-title" aria-hidden="true">
        <div class="advisor-settings-header">
          <h3 id="ai-settings-title">AI 設定</h3>
          <button id="ai-settings-close" class="advisor-icon-button" type="button" title="關閉設定">關閉</button>
        </div>
        <div class="advisor-settings-body">

          <label class="advisor-label">AI 提供商</label>
          <select id="ai-provider" class="advisor-select">
            <option value="openai">OpenAI (GPT)</option>
            <option value="gemini">Google Gemini</option>
            <option value="claude">Anthropic Claude</option>
            <option value="chrome-ai">Chrome 內建 AI（免 API Key）</option>
          </select>

          <label class="advisor-label">模型</label>
          <select id="ai-model" class="advisor-select">
            <option value="gpt-4o-mini">gpt-4o-mini（快速/省費）</option>
            <option value="gpt-4o">gpt-4o（高品質）</option>
            <option value="gpt-4-turbo">gpt-4-turbo</option>
          </select>

          <label class="advisor-label">API Key</label>
          <div id="ai-apikey-section">
            <div class="advisor-apikey-wrapper">
              <input id="ai-api-key" type="password" class="advisor-input apikey"
                placeholder="貼上你的 API Key..." autocomplete="off" />
              <button class="advisor-apikey-toggle" id="ai-apikey-toggle" title="顯示/隱藏">顯示</button>
            </div>

            <label class="advisor-inline-check">
              <input type="checkbox" id="ai-save-key" />
              <span>記住 API Key（存於瀏覽器本機）</span>
            </label>
          </div>

          <div id="ai-chrome-ai-note" class="advisor-note">
            Chrome 內建 AI（Gemini Nano），無需 API Key。<br/>需 Chrome 127+ 且已啟用 Built-in AI。
          </div>
        </div>
      </div>

      <div id="ai-advisor-body">

        <!-- 需求輸入區 -->
        <div class="advisor-section">
          <div class="advisor-section-title">你的需求</div>

          <label class="advisor-label">預算上限（NT$）</label>
          <input id="req-budget" type="number" class="advisor-input"
            placeholder="例如：30000" min="0" step="1000" />

          <label class="advisor-label">主要用途</label>
          <select id="req-usage" class="advisor-select">
            <option value="">請選擇...</option>
            <option value="gaming">電競遊戲</option>
            <option value="office">文書辦公</option>
            <option value="video">影音剪輯</option>
            <option value="3d">3D 繪圖 / 設計</option>
            <option value="ai">AI / 機器學習</option>
            <option value="general">日常使用</option>
            <option value="server">伺服器 / NAS</option>
          </select>

          <label class="advisor-label">補充說明（可選）</label>
          <textarea id="req-notes" class="advisor-textarea"
            placeholder="例如：需要安靜、不需要獨立顯卡、想要高 CP 值..."></textarea>
        </div>

        <!-- 分析按鈕 -->
        <button id="ai-advisor-analyze-btn">分析並推薦零件</button>

        <!-- 推薦結果區 -->
        <div class="advisor-section" id="ai-advisor-result">
          <div class="advisor-section-title">AI 推薦結果</div>
          <div id="ai-advisor-result-content"></div>
          <div class="advisor-chips" id="ai-advisor-chips"></div>
          <label class="advisor-enhance-toggle">
            <input type="checkbox" id="ai-advisor-enhance-toggle" checked />
            <span>強化顯示推薦項目</span>
          </label>
        </div>

      </div>
    `;
  }

  // ===== 事件綁定 =====
  function bindEvents() {
    // Toggle sidebar
    document.getElementById(TOGGLE_ID).addEventListener('click', toggleSidebar);

    // Provider 切換時更新模型列表
    document.getElementById('ai-provider').addEventListener('change', updateModelOptions);

    document.getElementById('ui-theme-toggle').addEventListener('click', () => {
      const sidebar = document.getElementById(SIDEBAR_ID);
      const nextTheme = sidebar?.dataset.theme === 'light' ? 'dark' : 'light';
      applyTheme(nextTheme);
      saveSettings();
    });

    document.getElementById('ai-settings-open').addEventListener('click', toggleSettingsPopover);
    document.getElementById('ai-settings-close').addEventListener('click', closeSettingsPopover);
    document.getElementById('ai-settings-popover').addEventListener('keydown', e => {
      if (e.key === 'Escape') closeSettingsPopover();
    });

    // API Key 顯示/隱藏
    document.getElementById('ai-apikey-toggle').addEventListener('click', () => {
      const input = document.getElementById('ai-api-key');
      input.type = input.type === 'password' ? 'text' : 'password';
    });

    // 分析按鈕
    document.getElementById('ai-advisor-analyze-btn').addEventListener('click', runAnalysis);

    document.getElementById('ai-advisor-enhance-toggle').addEventListener('change', event => {
      if (event.target.checked) {
        showRecommendationHighlights(currentRecommendations);
      } else {
        clearHighlightMarkers();
      }
    });

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'sync') return;
      const nextSettings = changes[STORAGE_KEY]?.newValue;
      if (nextSettings?.theme) applyTheme(nextSettings.theme);
    });

    // 阻止 sidebar 內鍵盤與滑鼠事件冒泡到頁面，防止頁面全域 handler 攔截
    // keydown: 確保 Ctrl+A 等快捷鍵正常運作
    // mousedown/mouseup/mousemove: 確保 textarea resize 拖曳不被頁面攔截
    const sidebarEl = document.getElementById(SIDEBAR_ID);
    ['mousedown', 'mouseup', 'mousemove', 'click'].forEach(type => {
      sidebarEl.addEventListener(type, e => e.stopPropagation());
    });

    sidebarEl.querySelectorAll('input, textarea').forEach(el => {
      el.addEventListener('keydown', e => {
        e.stopImmediatePropagation();
        if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
          e.preventDefault();
          el.select();
        }
      });
    });

    // 自動儲存設定
    ['ai-provider', 'ai-model', 'ai-api-key', 'ai-save-key', 'req-budget', 'req-usage', 'req-notes']
      .forEach(id => {
        const el = document.getElementById(id);
        el && el.addEventListener('change', saveSettings);
      });
  }

  function applyTheme(theme) {
    const normalizedTheme = theme === 'light' ? 'light' : DEFAULT_THEME;
    const sidebar = document.getElementById(SIDEBAR_ID);
    const themeToggle = document.getElementById('ui-theme-toggle');
    if (sidebar) sidebar.dataset.theme = normalizedTheme;
    if (themeToggle) {
      const nextThemeLabel = normalizedTheme === 'light' ? '深色' : '亮色';
      const nextThemeIcon = normalizedTheme === 'light' ? 'moon' : 'sun';
      const iconContainer = themeToggle.querySelector('.advisor-button-icon');
      if (iconContainer) iconContainer.innerHTML = getIconSvg(nextThemeIcon);
      themeToggle.title = `切換為${nextThemeLabel}`;
      themeToggle.setAttribute('aria-label', `切換為${nextThemeLabel}`);
    }
  }

  function openSettingsPopover() {
    const popover = document.getElementById('ai-settings-popover');
    const openButton = document.getElementById('ai-settings-open');
    if (!popover) return;
    popover.classList.add('open');
    popover.setAttribute('aria-hidden', 'false');
    setSettingsControlsEnabled(true);
    if (openButton) {
      openButton.setAttribute('aria-expanded', 'true');
      openButton.title = '收合設定';
      openButton.setAttribute('aria-label', '收合設定');
      openButton.classList.add('active');
    }
    document.getElementById('ai-provider')?.focus();
  }

  function toggleSettingsPopover() {
    const popover = document.getElementById('ai-settings-popover');
    if (!popover || !popover.classList.contains('open')) {
      openSettingsPopover();
      return;
    }
    closeSettingsPopover();
  }

  function closeSettingsPopover() {
    const popover = document.getElementById('ai-settings-popover');
    const openButton = document.getElementById('ai-settings-open');
    if (!popover) return;
    popover.classList.remove('open');
    popover.setAttribute('aria-hidden', 'true');
    setSettingsControlsEnabled(false);
    if (openButton) {
      openButton.setAttribute('aria-expanded', 'false');
      openButton.title = '開啟設定';
      openButton.setAttribute('aria-label', '開啟設定');
      openButton.classList.remove('active');
    }
  }

  function setSettingsControlsEnabled(enabled) {
    const popover = document.getElementById('ai-settings-popover');
    if (!popover) return;
    popover.querySelectorAll('input, select, button').forEach(control => {
      if (control.id === 'ai-settings-close') {
        control.disabled = !enabled;
        return;
      }
      control.disabled = !enabled;
    });
  }

  function toggleSidebar() {
    const sidebar = document.getElementById(SIDEBAR_ID);
    const isCollapsed = sidebar.classList.toggle('collapsed');
    document.body.style.marginRight = isCollapsed ? '0' : '320px';
    document.getElementById(TOGGLE_ID).querySelector('span').textContent = isCollapsed ? '開啟' : '關閉';
  }

  // ===== 模型列表 =====
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

  function updateModelOptions() {
    const provider = document.getElementById('ai-provider').value;
    const modelSelect = document.getElementById('ai-model');
    const options = MODEL_OPTIONS[provider] || [];
    modelSelect.innerHTML = options
      .map(o => `<option value="${o.value}">${o.label}</option>`)
      .join('');
    toggleApiKeySection(provider);
  }

  function toggleApiKeySection(provider) {
    const apiKeySection = document.getElementById('ai-apikey-section');
    const chromeAiNote = document.getElementById('ai-chrome-ai-note');
    const isChromeAi = provider === 'chrome-ai';
    if (apiKeySection) apiKeySection.style.display = isChromeAi ? 'none' : '';
    if (chromeAiNote) chromeAiNote.style.display = isChromeAi ? 'block' : 'none';
  }

  // ===== 設定儲存/讀取 =====
  function saveSettings() {
    const saveKey = document.getElementById('ai-save-key').checked;
    const settings = {
      provider: document.getElementById('ai-provider').value,
      model: document.getElementById('ai-model').value,
      theme: document.getElementById(SIDEBAR_ID)?.dataset.theme || DEFAULT_THEME,
      saveKey,
      apiKey: saveKey ? document.getElementById('ai-api-key').value : '',
      budget: document.getElementById('req-budget').value,
      usage: document.getElementById('req-usage').value,
      notes: document.getElementById('req-notes').value,
    };
    chrome.storage.sync.set({ [STORAGE_KEY]: settings });
  }

  function loadSettings() {
    chrome.storage.sync.get(STORAGE_KEY, result => {
      const s = result[STORAGE_KEY] || {};
      applyTheme(s.theme || DEFAULT_THEME);
      if (s.provider) {
        document.getElementById('ai-provider').value = s.provider;
        updateModelOptions();
      }
      if (s.model) document.getElementById('ai-model').value = s.model;
      if (s.saveKey) {
        document.getElementById('ai-save-key').checked = true;
        if (s.apiKey) document.getElementById('ai-api-key').value = s.apiKey;
      }
      if (s.budget) document.getElementById('req-budget').value = s.budget;
      if (s.usage) document.getElementById('req-usage').value = s.usage;
      if (s.notes) document.getElementById('req-notes').value = s.notes;
    });
  }

  // ===== 頁面零件資料擷取 =====
  function extractPartsData() {
    const parts = [];

    // 找所有分類 SELECT（name=n4, n5, ... n30）
    const selects = document.querySelectorAll('select[name^="n"]');
    selects.forEach(select => {
      const name = select.getAttribute('name');
      if (!name) return;

      // 找對應的分類名稱（同一 TR 下的 TD.t）
      const row = select.closest('tr');
      if (!row) return;
      const categoryName = getSelectCategoryName(select, name);

      // 收集所有可選項目（跳過 value=0 的預設空白選項）
      const options = [];
      select.querySelectorAll('option').forEach(opt => {
        const val = parseInt(opt.value, 10);
        if (!val || opt.disabled) return;
        const text = opt.textContent.trim();

        // 從文字中提取價格（格式：..., $XXXXX ...）
        const priceMatch = text.match(/\$\s*([\d,]+)/);
        const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, ''), 10) : 0;

        options.push({ value: val, text, price });
      });

      if (options.length > 0) {
        parts.push({ selectName: name, categoryName, options });
      }
    });

    return parts;
  }

  // ===== 建立 LLM Prompt =====
  function buildPrompt(partsData, requirements) {
    const { budget, usage, notes } = requirements;
    const usageText = USAGE_LABELS[usage] || usage || '未指定';
    const budgetNum = parseInt(budget, 10) || 0;

    const partsText = partsData
      .filter(cat => CORE_CATEGORIES.has(cat.selectName))
      .map(cat => {
        let opts = [...cat.options];

        // 依預算過濾（單件最多占整體預算 60%，避免顯示 10 萬顯卡）
        if (budgetNum > 0) {
          const maxPrice = budgetNum * 0.6;
          const filtered = opts.filter(o => o.price > 0 && o.price <= maxPrice);
          opts = filtered.length >= 3 ? filtered : opts;
        }

        // 依價格由低到高排序，取前 100 筆，並精簡文字（移除括號內冗長規格）
        const top = opts
          .sort((a, b) => a.price - b.price)
          .slice(0, 100)
          .map(o => {
            // 保留品牌型號與價格，裁去過長後綴
            const shortText = o.text.replace(/【.*?】/g, '').replace(/\s{2,}/g, ' ').trim().slice(0, 60);
            return `  [${o.value}] ${shortText}`;
          })
          .join('\n');

        return `【${cat.categoryName}】(selectName="${cat.selectName}")\n${top}`;
      })
      .join('\n\n') || '未擷取到核心零件清單。';

    const userPrompt = `[使用者需求]
- 預算上限：NT$${budget || '未指定'}
- 主要用途：${usageText}
- 補充說明：${notes || '無'}

[配單任務]
請依照 system prompt 的固定格式輸出一套最適合的配置。優先控制在預算內；若為了需求必須超出預算，請在「注意事項」明確說明原因。

[可選零件清單]
${partsText}`;

    return { systemPrompt: ADVISOR_SYSTEM_PROMPT, userPrompt };
  }

  // ===== 執行分析 =====
  async function runAnalysis() {
    const provider = document.getElementById('ai-provider').value;
    const model = document.getElementById('ai-model').value;
    const apiKey = document.getElementById('ai-api-key').value.trim();
    const budget = document.getElementById('req-budget').value;
    const usage = document.getElementById('req-usage').value;
    const notes = document.getElementById('req-notes').value;

    const isChromeAi = provider === 'chrome-ai';

    if (!isChromeAi && !apiKey) {
      showError('請輸入 API Key！');
      return;
    }
    if (!usage) {
      showError('請選擇主要用途！');
      return;
    }

    const btn = document.getElementById('ai-advisor-analyze-btn');
    btn.disabled = true;
    clearHighlights();
    showLoading();

    try {
      const partsData = extractPartsData();
      const { systemPrompt, userPrompt } = buildPrompt(partsData, { budget, usage, notes });

      let rawContent;
      if (isChromeAi) {
        rawContent = await callChromeAIDirectly(systemPrompt, userPrompt);
      } else {
        const response = await chrome.runtime.sendMessage({
          type: 'LLM_REQUEST',
          payload: {
            provider,
            apiKey,
            model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            maxTokens: 16384,
          },
        });
        if (!response.success) {
          throw new Error(response.error || 'LLM 請求失敗');
        }
        rawContent = response.data.content;
      }

      processLLMResponse(rawContent);
      saveSettings();

    } catch (err) {
      showError(`分析失敗：${err.message}`);
    } finally {
      stopLoading();
      btn.disabled = false;
      btn.textContent = '分析並推薦零件';
    }
  }

  // ===== Chrome 內建 AI 直接呼叫（不走 background service worker）=====
  async function callChromeAIDirectly(systemPrompt, userPrompt) {
    // Chrome 136+ 將 API 提升至頂層 window.LanguageModel
    // Chrome 127–135 則在 window.ai.languageModel
    const api = self.LanguageModel ?? window.LanguageModel ?? self.ai?.languageModel ?? window.ai?.languageModel ?? null;

    if (!api) {
      throw new Error(
        'Chrome 內建 AI 不可用。請確認：\n' +
        '① Chrome ≥ 127\n' +
        '② chrome://flags/#optimization-guide-on-device-model 設為 Enabled\n' +
        '③ chrome://flags/#prompt-api-for-gemini-nano 設為 Enabled\n' +
        '④ 重新啟動 Chrome'
      );
    }

    const availability = await api.availability();
    if (availability === 'no') {
      throw new Error('Chrome 內建 AI 目前不可用（availability: no）。');
    }
    if (availability === 'after-download') {
      throw new Error('Chrome 內建 AI 模型正在下載中，請稍後再試。');
    }

    const session = await api.create({ systemPrompt });
    try {
      return await session.prompt(userPrompt);
    } finally {
      session.destroy();
    }
  }

  // ===== 解析 LLM 回應 =====
  function processLLMResponse(rawContent) {
    const resultSection = document.getElementById('ai-advisor-result');
    const resultContent = document.getElementById('ai-advisor-result-content');
    const chipsContainer = document.getElementById('ai-advisor-chips');
    const enhanceToggle = document.getElementById('ai-advisor-enhance-toggle');
    const enhanceToggleLabel = enhanceToggle?.closest('.advisor-enhance-toggle');

    resultSection.classList.add('visible');

    // 提取 JSON 區塊
    let recommendations = [];
    let summary = '';
    const jsonMatch = rawContent.match(/```json\s*([\s\S]*?)```/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        recommendations = parsed.recommendations || [];
        summary = parsed.summary || '';
      } catch (_) { /* JSON 解析失敗則只顯示文字 */ }
    }

    // 顯示純文字回應（移除 JSON 區塊後）
    const textContent = rawContent.replace(/```json[\s\S]*?```/g, '').trim();
    resultContent.innerHTML = formatMarkdown(textContent);

    // 顯示推薦 chips
    currentRecommendations = recommendations;
    chipsContainer.innerHTML = '';
    if (enhanceToggleLabel) enhanceToggleLabel.hidden = recommendations.length === 0;
    if (recommendations.length > 0) {
      applyRecommendedParts(recommendations);
      if (enhanceToggle?.checked) {
        showRecommendationHighlights(recommendations);
      }
      recommendations.forEach(rec => {
        const chip = document.createElement('span');
        chip.className = 'advisor-chip';
        chip.textContent = `✓ ${getRecommendationCategoryName(rec)}`;
        chip.title = rec.reason || '';
        chipsContainer.appendChild(chip);
      });
    }
  }

  // 輕量 Markdown renderer：先 escape HTML，再渲染常用 Markdown 語法。
  function formatMarkdown(text) {
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    const htmlParts = [];
    let currentListType = '';
    let isInCodeBlock = false;
    let codeLanguage = '';
    let codeLines = [];

    const closeList = () => {
      if (!currentListType) return;
      htmlParts.push(`</${currentListType}>`);
      currentListType = '';
    };

    const openList = listType => {
      if (currentListType === listType) return;
      closeList();
      currentListType = listType;
      htmlParts.push(`<${listType}>`);
    };

    lines.forEach(rawLine => {
      const fenceMatch = rawLine.match(/^```\s*([\w-]*)\s*$/);
      if (fenceMatch) {
        if (isInCodeBlock) {
          const languageClass = codeLanguage ? ` class="language-${escapeHtml(codeLanguage)}"` : '';
          htmlParts.push(`<pre><code${languageClass}>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
          codeLines = [];
          codeLanguage = '';
          isInCodeBlock = false;
        } else {
          closeList();
          isInCodeBlock = true;
          codeLanguage = fenceMatch[1] || '';
        }
        return;
      }

      if (isInCodeBlock) {
        codeLines.push(rawLine);
        return;
      }

      const line = rawLine.trim();
      if (!line) {
        closeList();
        return;
      }

      if (/^(---|\*\*\*|___)$/.test(line)) {
        closeList();
        htmlParts.push('<hr>');
        return;
      }

      const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
      if (headingMatch) {
        closeList();
        const headingLevel = headingMatch[1].length;
        htmlParts.push(`<h${headingLevel}>${formatInlineMarkdown(headingMatch[2])}</h${headingLevel}>`);
        return;
      }

      const blockquoteMatch = line.match(/^>\s?(.+)$/);
      if (blockquoteMatch) {
        closeList();
        htmlParts.push(`<blockquote>${formatInlineMarkdown(blockquoteMatch[1])}</blockquote>`);
        return;
      }

      const orderedListMatch = line.match(/^\d+\.\s+(.+)$/);
      if (orderedListMatch) {
        openList('ol');
        htmlParts.push(`<li>${formatInlineMarkdown(orderedListMatch[1])}</li>`);
        return;
      }

      const unorderedListMatch = line.match(/^[-*+]\s+(.+)$/);
      if (unorderedListMatch) {
        openList('ul');
        htmlParts.push(`<li>${formatInlineMarkdown(unorderedListMatch[1])}</li>`);
        return;
      }

      closeList();
      htmlParts.push(`<p>${formatInlineMarkdown(line)}</p>`);
    });

    if (isInCodeBlock) {
      htmlParts.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
    }
    closeList();

    return htmlParts.join('');
  }

  function formatInlineMarkdown(text) {
    const codePlaceholders = [];
    let html = escapeHtml(text).replace(/`([^`]+)`/g, (matchedText, codeText) => {
      const placeholder = `@@CODE_${codePlaceholders.length}@@`;
      codePlaceholders.push(`<code>${codeText}</code>`);
      return placeholder;
    });

    html = html
      .replace(/\[([^\]]+)]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/__([^_]+)__/g, '<strong>$1</strong>')
      .replace(/(^|\s)\*([^*]+)\*(?=\s|$)/g, '$1<em>$2</em>')
      .replace(/(^|\s)_([^_]+)_(?=\s|$)/g, '$1<em>$2</em>');

    codePlaceholders.forEach((codeHtml, index) => {
      html = html.replace(`@@CODE_${index}@@`, codeHtml);
    });

    return html;
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ===== 高亮推薦零件 =====
  function applyRecommendedParts(recommendations) {
    recommendations.forEach(rec => {
      const select = document.querySelector(`select[name="${rec.selectName}"]`);
      if (!select) return;

      const option = select.querySelector(`option[value="${rec.optionValue}"]`);
      if (option) {
        // 自動選中推薦的選項
        select.value = rec.optionValue;

        // 觸發頁面的 onchange 事件更新計價
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
  }

  function showRecommendationHighlights(recommendations) {
    clearHighlightMarkers();

    recommendations.forEach(rec => {
      const select = document.querySelector(`select[name="${rec.selectName}"]`);
      if (!select) return;

      select.classList.add('ai-advisor-highlight');

      const option = select.querySelector(`option[value="${rec.optionValue}"]`);
      if (option) {
        if (!option.dataset.originalText) {
          option.dataset.originalText = option.textContent;
        }
        option.textContent = `AI推薦 - ${option.dataset.originalText}`;
        option.style.backgroundColor = '#ffe08a';
        option.style.color = '#363636';
        option.style.fontWeight = 'bold';
      }

      const row = select.closest('tr');
      if (row) {
        const categoryCell = row.querySelector('td.t');
        if (categoryCell && !categoryCell.querySelector('.ai-advisor-highlight-badge')) {
          categoryCell.classList.add('ai-advisor-highlight-cell');
          const badge = document.createElement('span');
          badge.className = 'ai-advisor-highlight-badge';
          badge.textContent = 'AI推薦';
          badge.title = rec.reason || '';
          categoryCell.appendChild(badge);
        }
      }
    });
  }

  function clearHighlightMarkers() {
    document.querySelectorAll('select.ai-advisor-highlight').forEach(el => {
      el.classList.remove('ai-advisor-highlight');
    });

    document.querySelectorAll('option[data-original-text]').forEach(opt => {
      opt.textContent = opt.dataset.originalText;
      delete opt.dataset.originalText;
      opt.style.backgroundColor = '';
      opt.style.color = '';
      opt.style.fontWeight = '';
    });

    document.querySelectorAll('.ai-advisor-highlight-badge').forEach(el => el.remove());
    document.querySelectorAll('.ai-advisor-highlight-cell').forEach(el => el.classList.remove('ai-advisor-highlight-cell'));
  }

  // ===== 清除高亮 =====
  function clearHighlights() {
    currentRecommendations = [];
    clearHighlightMarkers();

    // 隱藏結果區
    const resultSection = document.getElementById('ai-advisor-result');
    if (resultSection) resultSection.classList.remove('visible');
  }

  // ===== UI 輔助函式 =====
  function showLoading() {
    const resultSection = document.getElementById('ai-advisor-result');
    const resultContent = document.getElementById('ai-advisor-result-content');
    const chipsContainer = document.getElementById('ai-advisor-chips');
    const enhanceToggleLabel = document.getElementById('ai-advisor-enhance-toggle')?.closest('.advisor-enhance-toggle');
    const analyzeButton = document.getElementById('ai-advisor-analyze-btn');
    const startedAt = Date.now();
    const loadingMessages = [
      '正在讀取頁面零件清單',
      '正在整理預算與用途條件',
      '正在請 AI 分析相容性',
      '正在產生推薦配置',
      '回應較久，仍在等待模型完成',
    ];

    stopLoading();

    resultSection.classList.add('visible');
    if (enhanceToggleLabel) enhanceToggleLabel.hidden = true;
    resultContent.innerHTML = `
      <div class="advisor-loading">
        <div class="advisor-loading-main">
          <div class="advisor-spinner"></div>
          <div>
            <div class="advisor-loading-title">AI 正在分析中<span class="advisor-loading-dots" aria-hidden="true"></span></div>
            <div id="ai-advisor-loading-message" class="advisor-loading-message">${loadingMessages[0]}</div>
          </div>
        </div>
        <div class="advisor-loading-progress" aria-hidden="true"><span></span></div>
        <div class="advisor-loading-meta">已等待 <span id="ai-advisor-loading-elapsed">0 秒</span></div>
      </div>`;
    chipsContainer.innerHTML = '';

    const updateLoadingState = () => {
      const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
      const messageIndex = Math.min(Math.floor(elapsedSeconds / 8), loadingMessages.length - 1);
      const messageEl = document.getElementById('ai-advisor-loading-message');
      const elapsedEl = document.getElementById('ai-advisor-loading-elapsed');
      if (messageEl) messageEl.textContent = loadingMessages[messageIndex];
      if (elapsedEl) elapsedEl.textContent = `${elapsedSeconds} 秒`;
      if (analyzeButton) analyzeButton.textContent = `分析中 ${elapsedSeconds} 秒`;
    };

    updateLoadingState();
    analysisLoadingTimer = window.setInterval(updateLoadingState, 1000);
  }

  function stopLoading() {
    if (!analysisLoadingTimer) return;
    window.clearInterval(analysisLoadingTimer);
    analysisLoadingTimer = null;
  }

  function showError(msg) {
    const resultSection = document.getElementById('ai-advisor-result');
    const resultContent = document.getElementById('ai-advisor-result-content');

    resultSection.classList.add('visible');
    resultContent.innerHTML = `<div class="advisor-error">${msg}</div>`;
  }

  // ===== 初始化 =====
  createSidebar();

  // 監聽 main-world-interceptor.js 攔截 Clear()/FReset() 後派發的 CustomEvent
  document.addEventListener('ai-advisor-clear', clearHighlights);

})();
