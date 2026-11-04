"""Render report/report.md to report/report.pdf via headless Edge.

Run from the repo root:  .venv/Scripts/python.exe report/build_pdf.py
"""
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import markdown
from pypdf import PdfReader

REPORT_DIR = Path(__file__).resolve().parent
SRC = REPORT_DIR / (sys.argv[1] if len(sys.argv) > 1 else "report.md")  # optional source name
HTML = REPORT_DIR / "_report_tmp.html"  # inside report/ so relative image paths resolve
PDF = SRC.with_suffix(".pdf")

EDGE_PATHS = [
    Path("C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"),
    Path("C:/Program Files/Microsoft/Edge/Application/msedge.exe"),
]

CSS = """
@page { size: letter; margin: 0.9in;
  @bottom-center { content: counter(page); font: 9pt Georgia, serif; } }
body { font: 11pt/1.45 Georgia, 'Times New Roman', serif; }
h1, h2, h3 { font-family: Georgia, serif; break-after: avoid; }
h1 { break-before: page; }
h1:first-of-type { break-before: auto; }
table { border-collapse: collapse; margin: 1em auto; break-inside: avoid; font-size: 10pt; }
th, td { border: 0.5pt solid #444; padding: 3pt 7pt; }
th { background: #eee; }
img { display: block; max-width: 100%; margin: 1em auto 0; break-inside: avoid; }
p:has(> img) { break-inside: avoid; margin-bottom: 0; }
p:has(> img) + p { font-style: italic; text-align: center; font-size: 10pt; margin-top: 0.3em; }
pre { background: #f5f5f5; padding: 6pt; font-size: 9pt; white-space: pre-wrap; break-inside: avoid; }
code { font-size: 0.9em; }
"""


def find_edge():
    for p in EDGE_PATHS:
        if p.exists():
            return p
    sys.exit("msedge.exe not found")


def main():
    body = markdown.markdown(
        SRC.read_text(encoding="utf-8"),
        extensions=["tables", "fenced_code", "toc"],
    )
    HTML.write_text(
        f"<!DOCTYPE html><html><head><meta charset='utf-8'><title>Predicting College Football Upsets</title><style>{CSS}</style></head>"
        f"<body>{body}</body></html>",
        encoding="utf-8",
    )
    PDF.unlink(missing_ok=True)
    try:
        # throwaway profile so a running Edge doesn't swallow the headless launch
        with tempfile.TemporaryDirectory() as profile:
            subprocess.run(
                [str(find_edge()), "--headless", "--disable-gpu", "--no-pdf-header-footer",
                 f"--user-data-dir={profile}", f"--print-to-pdf={PDF}", HTML.as_uri()],
                check=True, timeout=120,
            )
            # msedge.exe can return before the PDF is written: wait for a stable file
            size, deadline = -1, time.time() + 60
            while time.time() < deadline:
                time.sleep(1)
                now = PDF.stat().st_size if PDF.exists() else 0
                if now and now == size:
                    break
                size = now
            else:
                sys.exit("PDF was not produced")
    finally:
        HTML.unlink(missing_ok=True)
    print(f"{PDF.name}: {len(PdfReader(PDF).pages)} pages, {PDF.stat().st_size} bytes")


if __name__ == "__main__":
    main()
