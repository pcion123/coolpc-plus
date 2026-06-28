# coolpc-plus

Coolpc Plus 是一個 Chrome Extension，專為 [原價屋線上估價](https://www.coolpc.com.tw/evaluate.php) 頁面設計。它會在估價頁右側加入「CoolPC AI 配單助手」側邊欄，讀取目前頁面上已公開顯示的零件清單，依照使用者的預算、用途與補充需求，透過 AI 推薦合適的電腦組裝配置，並自動高亮推薦零件。

> 本專案僅供學習參考，不代表原價屋官方服務；不進行自動化爬取、批次下載或非公開資料存取。使用時請尊重網站服務條款與站方資源。

## 主要功能

- 在 CoolPC 估價頁注入右側 AI 配單側邊欄
- 依照預算、主要用途與補充說明產生組裝建議
- 從頁面實際零件清單中挑選推薦品項，避免編造不存在的選項
- 自動高亮 AI 推薦的 CPU、主機板、記憶體、SSD、硬碟、顯示卡、散熱器、機殼與電源供應器
- 支援 Markdown 格式渲染，讓分析結果更容易閱讀
- 支援深色與亮色主題切換
- 支援 sidebar 內設定，也支援 Chrome extension popup 設定頁
- 長內容區塊支援 scrollbar，避免 AI 回覆或使用者輸入被截斷

## Demo

下方示範在 CoolPC 估價頁開啟 AI 配單側邊欄、輸入需求並取得推薦結果，推薦零件會同步高亮在原頁面上。

![CoolPC AI 配單助手 Demo](assets/coolpc-extension-demo.webp)

## 支援的 AI Provider

目前支援以下 Provider 與模型：

| Provider | 模型 |
|---|---|
| OpenAI | `gpt-4o-mini`, `gpt-4o`, `gpt-4-turbo` |
| Google Gemini | `gemini-3.5-flash`, `gemini-3.1-pro-preview` |
| Anthropic Claude | `claude-3-haiku-20240307`, `claude-3-5-sonnet-20241022`, `claude-3-opus-20240229` |
| Chrome 內建 AI | `gemini-nano` |

Chrome 內建 AI 不需要 API Key，但需要瀏覽器版本與實驗功能支援。其他 Provider 需要在設定中輸入對應 API Key。

## 使用方式

1. 開啟 Chrome 的擴充功能頁面：`chrome://extensions/`
2. 開啟右上角的「開發人員模式」
3. 點選「載入未封裝項目」
4. 選擇本專案資料夾
5. 前往 `https://www.coolpc.com.tw/evaluate.php`
6. 在右側「CoolPC AI 配單助手」輸入預算、用途與補充說明
7. 選擇 AI Provider、模型與 API Key
8. 點選「分析並推薦零件」

分析完成後，側邊欄會顯示 AI 推薦理由，並在 CoolPC 表格中高亮推薦零件。若要取消標記，可以點選「清除高亮」。

## 回覆格式

專案內建統一 prompt 樣板，讓 AI 回覆維持穩定格式。一般回覆會包含：

- 配置摘要
- 推薦配置
- 選擇理由
- 注意事項
- 最後一段 JSON 結構，用於自動高亮頁面上的推薦零件

JSON 會使用 CoolPC 頁面上的 `selectName` 與 `optionValue`，例如：

```json
{
	"recommendations": [
		{ "selectName": "n4", "optionValue": 25, "reason": "符合多工與預算需求" }
	],
	"totalEstimate": 25000,
	"summary": "整體配置說明"
}
```

## 專案結構

```text
coolpc_explorer/
├── manifest.json                    # Chrome Extension MV3 設定
├── background/
│   └── service-worker.js             # LLM API 請求中繼，處理 CORS 與 Provider 呼叫
├── content/
│   ├── content.js                    # 注入 sidebar、讀取零件、建立 prompt、處理 AI 回覆
│   ├── main-world-interceptor.js      # 攔截 CoolPC 頁面主世界事件
│   └── sidebar.css                   # sidebar UI、主題、scrollbar 與 Markdown 樣式
├── popup/
│   ├── index.html                    # 擴充功能 popup 設定介面
│   └── popup.js                      # popup 設定儲存與模型切換邏輯
├── shared/
│   └── llm-client.js                 # LLM client 型別與共用模型常數
├── icons/                            # extension 圖示
└── plans/                            # 開發計畫文件
```

## 設定儲存

使用者設定會儲存在 `chrome.storage.sync`，包含：

- 主題：深色 / 亮色
- AI Provider
- 模型
- 是否記住 API Key
- 預算、用途與補充說明

若使用者選擇記住 API Key，API Key 會儲存在瀏覽器同步儲存空間。若不想保存，請取消勾選「記住 API Key」。

## 開發說明

此專案目前不需要額外 build step。修改檔案後，回到 `chrome://extensions/` 重新載入擴充功能，再刷新 CoolPC 估價頁即可看到變更。

常用檢查指令：

```powershell
node --check content/content.js
node --check popup/popup.js
node --check background/service-worker.js
git diff --check
```

## 注意事項

- 本工具僅提供組裝建議，實際購買前仍需確認庫存、價格、相容性、機殼尺寸與電源瓦數。
- CoolPC 頁面結構若更新，零件擷取或高亮邏輯可能需要同步調整。
- AI 回覆品質會受 Provider、模型、API 狀態與頁面零件清單完整度影響。
