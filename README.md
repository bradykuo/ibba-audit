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
  - 擇一規則偵測（核心：Technology Marketing / Marketing in Daily
    Life；Supply Chain Management / Strategic Supply Chain
    Management）。
  - 進階擇一群組（ISS 409500 / ISS 507700）：只計一門，另一門自動
    改計自由選修。
  - 進階學分上限（ISS 581700 最多 1 學分）與不可認列課程
    （EAP/ESP）自動處理。
  - 核心修滿 9 門後，多修課程自動溢出計入進階選修。
  - 每學期 TSE 認列課程內建，於新增進階時可快速帶入。
- **校定必修自動帶入**：直接讀取審查表底部「Compulsory courses」
  彙總欄（通識 Total、Mandarin Course、English、體育完成狀態），
  依國際生・僑生身分別調整門檻，不需人工輸入。
- **IBP / 通識辨識**：內建 IBP 表列課程清單，解析時辨識通識課程並
  列出核對清單。
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
  （別名或更名後名稱，供 PDF 比對）、`codeAliases`（其他學期的
  課號，例如 OB 更名後的 IPMT201000）。
- `exclusiveGroup`：標記核心擇一群組，同組僅一門可列核心
  （Technology Marketing／Marketing in Daily Life；Supply Chain
  Management／Strategic Supply Chain Management）。
- `advancedDeptCodes`：可認列進階選修的科號前綴
  （ECON／QF／IPMT／ISS／TM／LST／CTM／IMBA）。
- `tseCourses`：每學期公告之 TSE 認列課程，請依當學期分類表更新。
  目前已載入 114-2（2026 Spring）的 4 門 TSE 課程。在「新增進階
  選修」科號欄輸入或選取 TSE 課號，名稱與學分會自動帶入。
- `advancedExclusivePairs`：進階選修擇一群組。同組課程（如 ISS
  409500 與 ISS 507700）只有一門可計入進階選修，另一門自動改計為
  自由選修，系統會在進階區塊提示並自動扣除。
- `advancedCapped`：進階選修有學分上限的課程（如 ISS 581700 最多
  計 1 學分），系統自動套用上限。
- `excludeFromAdvanced`：不可列為進階選修的課程（如 EAP/ESP 的
  IPMT100200／100300，國際生只能列自由選修）；嘗試新增時會被擋下。
- `currentSemester` / `currentSemesterCourses`：當學期開課清單，供
  核對參考。
- `ibpCourses` / `geDeptCodes`：IBP 表列通識課程與通識科號前綴
  （GEC／GE／IBP），供 PDF 解析辨識通識課程。
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
