# GitHub application
The `app/` folder is a standalone FastAPI prototype. It accepts a phone camera upload, stores the original image, allows reviewed transcription, validates the record, appends a row to a copied workbook, and generates a summary PDF.

It does not contain a Nuvolo API connector or cloud OCR credentials. Add those only through approved organizational integration patterns. Treat OCR output as draft evidence requiring review.
