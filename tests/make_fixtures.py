# Builds the same balance sheet as .xlsx, .docx and two differently laid-out .pdf files, from balance_sheet_with_errors.csv
import csv, os, subprocess
here = os.path.dirname(os.path.abspath(__file__)); out = os.path.join(here, "fixtures")
rows = list(csv.reader(open(os.path.join(here, "balance_sheet_with_errors.csv"))))
rows = [r for r in rows if r]
def num(x):
    try: return int(x)
    except ValueError: return x
# Excel: numbers as numbers, blanks empty, N/A as text, plus a second sheet and a date/percent column to exercise the reader
import openpyxl
wb = openpyxl.Workbook(); ws = wb.active; ws.title = "Balance Sheet"
for r in rows: ws.append([num(x) if i in (2, 3) else x for i, x in enumerate(r)])
for r in range(2, ws.max_row + 1):
    for c in (3, 4): ws.cell(r, c).number_format = "#,##0"
for col, w in zip("ABCDE", (22, 30, 18, 18, 14)): ws.column_dimensions[col].width = w
ws.page_setup.orientation = "landscape"; ws.page_setup.fitToWidth = 1; ws.sheet_properties.pageSetUpPr = openpyxl.worksheet.properties.PageSetupProperties(fitToPage=True)
ws2 = wb.create_sheet("Notes"); ws2.append(["Prepared", "2026-10-01"]); ws2.append(["Rate", 0.075]); ws2["B2"].number_format = "0.0%"
import datetime; ws2["B1"] = datetime.date(2026, 10, 1)
wb.save(os.path.join(out, "balance.xlsx"))
# Word: a title paragraph, then the table
import docx
d = docx.Document(); d.add_paragraph("Quarterly balance sheet"); t = d.add_table(rows=len(rows), cols=len(rows[0]))
for i, r in enumerate(rows):
    for j, x in enumerate(r): t.cell(i, j).text = x
d.add_paragraph("Prepared by finance."); d.save(os.path.join(out, "balance.docx"))
# PDF 1: reportlab table with right-aligned numbers and a title line above
from reportlab.lib.pagesizes import A4, landscape
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
from reportlab.lib.styles import getSampleStyleSheet
doc = SimpleDocTemplate(os.path.join(out, "balance_reportlab.pdf"), pagesize=landscape(A4))
tb = Table([[Paragraph(x, getSampleStyleSheet()["BodyText"]) if i == 0 else x for x in r] for i, r in enumerate(rows)], colWidths=[110, 170, 100, 100, 70])
tb.setStyle(TableStyle([("ALIGN", (2, 0), (3, -1), "RIGHT"), ("GRID", (0, 0), (-1, -1), .3, "#999999"), ("FONTSIZE", (0, 0), (-1, -1), 9)]))
doc.build([Paragraph("Quarterly Balance Sheet", getSampleStyleSheet()["Title"]), Spacer(1, 8), tb])
# PDF 2: LibreOffice turns the xlsx into a PDF (different engine, different fonts and spacing)
subprocess.run(["soffice", "--headless", "--convert-to", "pdf", "--outdir", out, os.path.join(out, "balance.xlsx")], check=True, capture_output=True)
os.rename(os.path.join(out, "balance.pdf"), os.path.join(out, "balance_libreoffice.pdf"))
print(sorted(os.listdir(out)))
