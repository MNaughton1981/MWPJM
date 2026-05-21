# MWPJM

**Lean Project Manager for Facilities Technicians and Engineers**

A local-first Progressive Web App that helps a facilities tech run small,
trade-coordinated projects (carpentry / plumbing / electrical) and post
updates back to a Nuvolo (ServiceNow) work order via email — no API
integration required.

## Why it's lean

- **No backend.** Data lives in your browser's storage on each device.
- **No Nuvolo API.** Updates ride on top of your existing email — the app
  builds a `mailto:` link to `mathworks@service-now.com` with the FWKD
  work order ID + a timestamp in the subject. Your default mail client
  (Outlook on desktop, Gmail / Mail on phone) sends it from your existing
  authenticated session.
- **No app stores.** Install to your home screen on Android (Chrome) or
  iOS (Safari) as a PWA. One codebase, all platforms.
- **No cloud account to manage.** Sync between your laptop and phone by
  exporting a JSON backup file into a OneDrive-synced folder; OneDrive
  handles the cross-device part for free.

## How it talks to Nuvolo

When you write an update on a project, the app composes:

```
To:       mathworks@service-now.com
Subject:  RE: FWKD0000000 — Update 2026-05-21 14:32
Body:     <your update>

          — <your name>
          [Posted 2026-05-21 14:32 via MWPJM]
```

You hit Send in your mail client. ServiceNow ingests the message because
the FWKD ID is in the subject and posts the body as a work order note.

## Features

- Projects list with status, work order ID, milestone progress.
- **Trade Coordination Tracker** — plumbing / electrical / carpentry (and
  others), each with status, scheduled date, contact, phone, notes.
- **Timetable** — simple checklist of dated milestones (no Gantt overhead).
- **Activity Log** — every update you post is stored locally even if the
  email never gets sent.
- **Templates** — seeded "Kitchenette Dishwasher Upgrade (18" + 24")"
  template with the standard task list.
- **Work Order Dashboard** — import a CSV exported from a Nuvolo
  open-work-orders report. Auto-detects ServiceNow column names. Shows
  totals, overdue counts, and a searchable table. One click to "Start
  project from this WO" — pre-fills FWKD ID, location, and description.
- **Export to OneNote** — generates a Markdown summary you can paste into
  OneNote for the long-term record.

## Local development

```bash
npm install
npm run dev
```

Open <http://localhost:5173>.

## Deployment

Pushing to `main` triggers `.github/workflows/deploy.yml` which builds and
deploys to GitHub Pages. The published URL will be:

```
https://<your-github-username>.github.io/MWPJM/
```

> One-time setup: in the repo on github.com, go to **Settings → Pages**
> and set **Source** to **GitHub Actions**.

## Installing on your devices

- **Pixel 7 (Chrome):** open the published URL, tap the menu → "Add to
  Home screen." It will install as a standalone app.
- **iPhone (Safari):** open the URL, tap Share → "Add to Home Screen."
- **Desktop (Chrome / Edge):** click the install icon in the address bar.

## Sync between devices

1. On the laptop, **Settings → Export backup (.json)**. Save the file to
   `OneDrive/MWPJM/mwpjm.json`.
2. OneDrive syncs the file to your phone automatically.
3. On the phone, open the OneDrive app, share the file to the MWPJM PWA's
   Settings → Import backup, or download it locally and pick it from the
   file picker.

(For automatic two-way sync, we can layer Supabase on top later. Not
needed for v1.)
