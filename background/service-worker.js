/**
 * Background Service Worker
 * 負責中繼 LLM API 請求，解決 content script 的 CORS 限制。
 */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'LLM_REQUEST') {
    handleLLMRequest(message.payload)
      .then(data => sendResponse({ success: true, data }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // 保持 message channel 開啟等待非同步回應
  }

});

async function handleLLMRequest({ provider, apiKey, model, messages, maxTokens }) {
  switch (provider) {
    case 'openai':
      return callOpenAI(apiKey, model, messages, maxTokens);
    case 'gemini':
      return callGemini(apiKey, model, messages, maxTokens);
    case 'claude':
      return callClaude(apiKey, model, messages, maxTokens);
    default:
      throw new Error(`不支援的 Provider: ${provider}`);
  }
}

async function callOpenAI(apiKey, model, messages, maxTokens = 16384) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`OpenAI 錯誤 ${res.status}: ${err?.error?.message || res.statusText}`);
  }
  const data = await res.json();
  return { content: data.choices[0].message.content };
}

async function callGemini(apiKey, model, messages, maxTokens = 16384) {
  const geminiModel = model || 'gemini-3.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${apiKey}`;

  // 轉換 OpenAI 格式的 messages 為 Gemini 格式
  const contents = messages
    .filter(m => m.role !== 'system')
    .map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

  // 將 system prompt 插入第一個 user message
  const systemMsg = messages.find(m => m.role === 'system');
  if (systemMsg && contents.length > 0) {
    contents[0].parts[0].text = `${systemMsg.content}\n\n${contents[0].parts[0].text}`;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents,
      generationConfig: { maxOutputTokens: maxTokens },
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Gemini 錯誤 ${res.status}: ${err?.error?.message || res.statusText}`);
  }
  const data = await res.json();
  return { content: data.candidates[0].content.parts[0].text };
}

async function callClaude(apiKey, model, messages, maxTokens = 16384) {
  const systemMsg = messages.find(m => m.role === 'system');
  const userMessages = messages.filter(m => m.role !== 'system');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: systemMsg?.content || '',
      messages: userMessages,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Claude 錯誤 ${res.status}: ${err?.error?.message || res.statusText}`);
  }
  const data = await res.json();
  return { content: data.content[0].text };
}



