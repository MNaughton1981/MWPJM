# Asset Registry Assistant

Phone-friendly field-audit prototype plus a reusable Copilot Skill.

## Run locally

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Open `http://localhost:8000`. On a phone connected to the same approved development network, use the computer's reachable HTTPS address or deploy through your organization's approved hosting process.

## Design boundaries
- Original photos are preserved in `data/`.
- Photo text is entered/reviewed by a person in this initial version. No cloud OCR credentials are included.
- Spreadsheet writes target a copy and the `Proposed Updates` sheet.
- Nuvolo integration is not included. Add an approved API adapter after the record and attachment contract is confirmed.
- Panel, circuit, rack, location, and barcode values must remain `NEEDS_VERIFICATION` until supported by evidence.

## GitHub
Initialize and push with your normal organizational GitHub process. Do not commit live asset photos, internal floor plans, manuals, workbooks, credentials, or generated packages. The included `.gitignore` excludes working data.
