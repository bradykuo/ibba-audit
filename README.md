# IBBA 畢業學分審查輔助系統

清華大學科技管理學院 — 跨院國際學士班（IBBA）畢業學分審查工具。

純前端網頁，無後端、無資料庫。上傳學生的「graduation credit
review form」PDF 後自動帶入修課狀況，再依 IBBA 規則計算各類學分
是否達標。可直接部署於 GitHub Pages。

---

## 功能

- **PDF 自動解析**：以 `pdf.js` 在瀏覽器端解析審查表，自動勾選已修
  / 修課中的課程，並抓取學號、姓名、身分別。
- **三類學分審查**：專業必修 30、核心選修 27（9 門）、進階選修 27。
- **規則內建**：
  - 課程更名對照（Business Ethics & CSR ↔ Business Ethics and
    Sustainability；Organizational Behavior ↔ Fundamentals of
    Organizational Behavior）。
  - 擇一規則偵測（Technology Marketing / Marketing in Daily
    Life；Supply Chain Management / Strategic Supply Chain
    Management）。
  - 核心修滿 9 門後，多修課程自動溢出計入進階選修。
- **校定必修**：中文 / 英文 / 通識 / 體育，依國際生・僑生身分別調整門檻。
- **校定必修自動帶入**：直接讀取審查表底部「Compulsory courses」
  彙總欄的數字（GE 通識 Total、Mandarin Course、English、體育
  完成狀態），不需人工輸入。
- **IBP / 通識辨識**：內建 IBP 表列課程清單（`data/courses.json`
  的 `ibpCourses`）。解析時會辨識審查表中的 IBP / GE 課程並列出
  核對清單。
- **人工修正**：自動帶入的列標示「自動」，可逐門以「已修畢 / 修課中 /
  未修」三鍵覆寫；未能對應的課程會列在頂端清單，由職員指派去向。
- **列印 / 匯出**：可直接列印或匯出 PDF 作為審查紀錄。

---

## 目錄結構

```
ibba-audit/
├── index.html          主頁面
├── .nojekyll           （GitHub Pages 必要，避免 Jekyll 處理）
├── assets/
│   ├── style.css       樣式
│   └── app.js          解析與審查邏輯
└── data/
    └── courses.json    課程分類表 ← 每學期由職員維護
```

---

## 部署到 GitHub Pages

1. 在 GitHub 建立新 repository（例如 `ibba-audit`）。
2. 將 `ibba-audit/` 內的所有檔案（含 `.nojekyll`）上傳到 repo 根目錄。
3. 進入 repo 的 **Settings → Pages**。
4. **Source** 選擇 `Deploy from a branch`，Branch 選 `main` /
   `(root)`，按 Save。
5. 約一分鐘後，網站會發佈於
   `https://<帳號>.github.io/<repo 名稱>/`。

> 注意：本工具須透過網址（http/https）開啟，不能直接以
> `file://` 雙擊 `index.html`，否則瀏覽器會擋下 `courses.json`
> 的讀取。本機測試可在資料夾內執行 `python3 -m http.server`
> 後開啟 `http://localhost:8000`。

---

## 每學期維護：更新 `data/courses.json`

職員只需編輯 `data/courses.json`，**不需改動程式碼**。

- `required` / `core` / `advanced`：三類課程清單，每門含
  `code`（科號）、`name`（課名）、`cr`（學分）、`aliases`
  （別名或更名後名稱，供 PDF 比對）。
- `exclusiveGroup`：標記擇一群組，同組課程僅一門可列核心。
- `advancedDeptCodes`：可認列進階選修的科號前綴。
- `tseCourses`：每學期公告之 TSE 認列課程，請依當學期分類表更新。
- `ibpCourses`：IBP 表列通識課程清單（依 IBP 開課分類 PDF 維護），
  供 PDF 解析辨識通識課程。
- `geDeptCodes`：可認列為通識的科號前綴（GEC／GE／IBP）。
- `thresholds`：各類學分門檻，原則上不需更動。

編輯後請確認 JSON 格式正確（可貼到 <https://jsonlint.com> 檢查），
再 commit 並 push，GitHub Pages 會自動更新。

---

## PDF 解析的限制（請務必閱讀）

審查表 PDF 排版複雜（課名換行、中英混排、科號偶爾空白、不同學生
版面略有差異），**自動解析無法保證 100% 準確**。本工具的設計原則
是「有把握的自動帶入、沒把握的明確標示」：

- 標示「自動」的列務必人工核對。
- 頂端「未能自動對應」清單中的課程，需由職員逐一指派。
- 表上沒有成績的課程視為「未修」，不會自動帶入。

審查結論仍應以系所辦公室與註冊組的人工複核為準；本工具僅為輔助。
