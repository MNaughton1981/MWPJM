---
name: asset-registry-assistant
description: capture equipment data-plate photos, validate visible identity fields against an asset audit workbook, classify audit outcomes, stage spreadsheet updates, associate floor-plan and utility evidence, and generate reviewable asset article PDF packages. use for lsc servery field audits, new or replacement equipment, nuvolo preparation, and per-asset documentation packages.
---
# Asset Registry Assistant

Use the submitted equipment photo, field observations, audit workbook, floor plan, and manuals as evidence.

## Workflow
1. Transcribe only clearly visible values. Mark uncertain values as `NEEDS_VERIFICATION`.
2. Match in this order: exact asset barcode, exact serial number, then manufacturer + model + location.
3. Assign one outcome: `EXISTING_RECORD_VERIFIED`, `TAGGED_NOT_IN_NUVOLO`, `REPLACEMENT_FOUND`, `NEW_UNCATALOGED_ASSET`, or `REVIEW_REQUIRED`.
4. Run `scripts/validate_record.py` before staging an update.
5. Preserve source files and write only to a copied workbook.
6. Add floor-plan and utility fields. Do not infer a panel, circuit, remote rack, or location code.
7. Generate the article package only after the staged record passes validation.
8. Present proposed changes for human review before any Nuvolo entry.

## Resources
- Follow `references/schema.md` for fields and allowed values.
- Follow `references/github-app.md` for the included phone-friendly prototype.
- Use `scripts/validate_record.py` for deterministic validation.
- Use `scripts/update_workbook.py` for spreadsheet staging.
- Use `scripts/generate_article.py` for a summary PDF.
