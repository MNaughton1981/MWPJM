# Workboard Setup Guide

Quick onboarding for a new user or new device.

## 1. Install the app

- **Desktop (Chrome/Edge):** Open the Workboard URL, click the install icon in the address bar.
- **Android (Chrome):** Open the URL, menu -> "Add to Home screen."
- **iPhone (Safari):** Open the URL, Share -> "Add to Home Screen."

No app store, no account, no credentials stored.

## 2. Create your Data folder

In your OneDrive, create a folder for Workboard's data. Example:

```
C:\Users\<you>\OneDrive - MathWorks\...\Workboard\Data
```

The app uses three subfolders inside it:

| Subfolder | Purpose |
|-----------|---------|
| `reports/` | Nuvolo CSV/Excel exports land here (daily active WOs) |
| `photos/` | Photo backups from workboards |
| `meeting-reports/` | Closed-WO exports for 1:1 meeting prep |

## 3. Connect the folder (desktop only)

**Reports -> Connect folder** -> pick the **`Data` parent folder** (not a subfolder) -> grant permission.

> Mobile browsers (iOS Safari, Android Chrome) can't connect a folder. Use **Reports -> Pick file** to import manually on mobile.

## 4. One-tap setup

**Settings -> Storage layout -> "Set up folders"** creates `photos/`, `reports/`, and `meeting-reports/` subfolders and seeds `MWPJM-Data.xlsx` in one tap.

Or create those three subfolders manually in File Explorer -- the app uses them either way.

## 5. Configure

**Settings ->** fill in:
- Technician name (used in update sign-offs)
- Your email (for the To Do / self-email feature)
- Storage layout: confirm subfolder names (defaults are `photos` / `reports`)

## 6. Get Nuvolo reports flowing

**Manual:** Export "Open Work Orders" from Nuvolo -> save into `Data\reports\` -> **Reports -> Refresh from folder.**

**Automated (Power Automate):** Set up the email-to-OneDrive flow so Nuvolo's scheduled report drops into `Data\reports\` automatically. See the in-app help text at Reports -> "How to refresh from Nuvolo."

## Important notes

- **Each person uses their own Data folder** -- don't share one between people (no concurrent-edit support).
- **Mobile can't connect a folder** (browser limitation) -- use the file picker to import.
- **The app is local-first:** your data lives in your browser's storage. The OneDrive folder is a backup + cross-device sync channel, not the primary store (yet -- Excel-only cutover is coming in a future update).
- **Photos stay on the device that took them** until backed up via the "Back up to folder" button on desktop.
