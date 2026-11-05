# Business Calculator

A small website you can install on your phone like an app (a PWA). 71 tools in five sections: GST filing (for Indian shops), Profit and price, Sales and stock, Table analysis, Balance sheet. Amounts are in rupees (₹). Open a balance sheet from CSV, Excel (.xlsx), Word (.docx), a PDF with real text, or pasted text. Fix any cell by hand, delete rows or columns, then press a button:

- **Check**: do the totals match their lines, and does Assets = Liabilities + Equity?
- **Why?**: which single mistake (swapped digits, slipped decimal, counted twice, wrong sign...) explains a gap.
- **Find**: work out a blank figure from the others.
- **Compare**: two periods side by side, with the changes.
- **29 buttons in all**: Check, Why?, Find, Compare, All ratios, Common-size, plus 23 single measures (working capital, current, quick and cash ratios, debt-to-equity, debt ratio, net debt, ROE, ROA, margins, stock and collection days, interest cover...). Profit-based ones ask you to type sales or profit, because a balance sheet does not contain them.

Everything runs in the browser. No file is uploaded anywhere.

## Put it online in 5 steps (GitHub + Vercel, no coding)

1. On github.com press **New repository**, give it a name, press **Create**.
2. Press **uploading an existing file**, drag in everything inside this folder (keep the folders `vendor` and `tests` as they are), press **Commit changes**.
3. On vercel.com sign in with GitHub, press **Add New → Project**, pick your repository.
4. Leave every setting empty (Framework: **Other**, no build command, no output folder), press **Deploy**.
5. Open the link Vercel gives you. On a phone choose **Add to Home Screen** (or **Install app**).

After you change any file, open `sw.js` and change the number after `bsc-v` to the next one (and so on) so phones fetch the new version.

## Limits (honest)

- The accounting rules (what is an asset, a total, a balance) are written by the author and guessed from the words in your table. Change a row's **Type** if a guess is wrong.
- PDF and Word tables are read by a best guess. Always look at the table after importing.
- Not supported: old `.xls`/`.doc`/`.ods` (save as .xlsx/.docx/.csv), and scanned PDFs or photos (no text to read).
- "This would make it balance" is arithmetic. It shows what fits, not what really happened.

## Tests

`node --test tests/*.test.mjs` (engine and importers). `tests/e2e.cjs` drives a real browser (needs Playwright).

## Third-party code (in `vendor/`)

PDF.js (Apache-2.0), JSZip (MIT or GPLv3). See `vendor/README.txt`.
