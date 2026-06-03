# Excel Database Schema

This document defines the structure of `MWPJM-Data.xlsx`, the Excel workbook used as the data store for MWPJM.

## Workbook Structure

```
MWPJM-Data.xlsx
├── Meta (versioning, sync metadata)
├── Projects (workboards)
├── Activity (activity log entries)
├── Milestones (timetable tasks)
├── Trades (trade coordination tracker)
├── Vendors (on-site contacts)
├── Photos (photo metadata, files in /photos/ subfolder)
├── Settings (user preferences)
├── WorkOrders (imported Nuvolo CSV data)
├── MeetingNotesOrders (separate meeting notes CSV)
└── SavedVendors (vendor "book")
```

---

## Sheet: Meta

Stores versioning and sync metadata for conflict detection.

| Column | Type | Description |
|--------|------|-------------|
| **Key** | TEXT | Setting key (e.g., "version", "lastSyncDevice") |
| **Value** | TEXT | Setting value |
| **UpdatedAt** | DATETIME | When this setting was last modified |

**Example:**
```
┌────────────────┬────────┬─────────────────────┐
│ Key            │ Value  │ UpdatedAt           │
├────────────────┼────────┼─────────────────────┤
│ version        │ 1      │ 2026-06-03T10:30Z   │
│ lastSyncDevice │ iPhone │ 2026-06-03T10:30Z   │
└────────────────┴────────┴─────────────────────┘
```

---

## Sheet: Projects

Main workboard records.

| Column | Type | Description |
|--------|------|-------------|
| **ID** | TEXT | Unique project ID (e.g., "proj-abc123") |
| **Name** | TEXT | Project name |
| **Status** | TEXT | One of: planning, in_progress, on_hold, complete |
| **WorkOrderID** | TEXT | Nuvolo FWKD number (e.g., "FWKD0001234") |
| **Location** | TEXT | Building/room location |
| **Description** | TEXT | Project description/notes |
| **CreatedAt** | DATETIME | ISO timestamp when created |
| **UpdatedAt** | DATETIME | ISO timestamp when last modified |
| **ArchivedAt** | NUMBER | Unix timestamp (ms) when archived, or blank if active |
| **PinnedAt** | NUMBER | Unix timestamp (ms) when pinned, or blank if not pinned |

**Example:**
```
┌──────────────┬────────────────┬─────────────┬──────────────┬──────────┬─────────────────┬─────────────────────┬─────────────────────┬────────────┬──────────┐
│ ID           │ Name           │ Status      │ WorkOrderID  │ Location │ Description     │ CreatedAt           │ UpdatedAt           │ ArchivedAt │ PinnedAt │
├──────────────┼────────────────┼─────────────┼──────────────┼──────────┼─────────────────┼─────────────────────┼─────────────────────┼────────────┼──────────┤
│ proj-abc123  │ Kitchen DW     │ in_progress │ FWKD0001234  │ Bldg 3   │ Install pilot   │ 2026-06-01T09:00Z   │ 2026-06-03T10:30Z   │            │          │
│ proj-def456  │ HVAC Repair    │ complete    │ FWKD0001235  │ Bldg 5   │ Fix AC unit     │ 2026-05-28T14:00Z   │ 2026-06-02T16:00Z   │ 1717347600 │          │
└──────────────┴────────────────┴─────────────┴──────────────┴──────────┴─────────────────┴─────────────────────┴─────────────────────┴────────────┴──────────┘
```

---

## Sheet: Activity

Activity log entries (updates posted to workboards).

| Column | Type | Description |
|--------|------|-------------|
| **ID** | TEXT | Unique entry ID |
| **ProjectID** | TEXT | Foreign key to Projects.ID |
| **Timestamp** | DATETIME | When the entry was created |
| **Text** | TEXT | Update text |
| **PostedToNuvolo** | BOOLEAN | TRUE if sent via email, FALSE otherwise |
| **Author** | TEXT | Technician name (optional) |

**Example:**
```
┌──────────────┬──────────────┬─────────────────────┬─────────────────────┬─────────────────┬────────────┐
│ ID           │ ProjectID    │ Timestamp           │ Text                │ PostedToNuvolo  │ Author     │
├──────────────┼──────────────┼─────────────────────┼─────────────────────┼─────────────────┼────────────┤
│ act-001      │ proj-abc123  │ 2026-06-03T10:00Z   │ Measured space      │ TRUE            │ Matt N.    │
│ act-002      │ proj-abc123  │ 2026-06-03T10:30Z   │ Ordered parts       │ FALSE           │ Matt N.    │
└──────────────┴──────────────┴─────────────────────┴─────────────────────┴─────────────────┴────────────┘
```

---

## Sheet: Milestones

Timetable tasks for projects.

| Column | Type | Description |
|--------|------|-------------|
| **ID** | TEXT | Unique milestone ID |
| **ProjectID** | TEXT | Foreign key to Projects.ID |
| **Title** | TEXT | Milestone name |
| **Date** | DATE | Target date (YYYY-MM-DD) |
| **Done** | BOOLEAN | TRUE if completed |
| **Trade** | TEXT | Related trade (optional): plumbing, electrical, carpentry, hvac, general, other |
| **Notes** | TEXT | Additional notes (optional) |

---

## Sheet: Trades

Trade coordination tracker.

| Column | Type | Description |
|--------|------|-------------|
| **ID** | TEXT | Unique trade ID |
| **ProjectID** | TEXT | Foreign key to Projects.ID |
| **Key** | TEXT | Trade key: plumbing, electrical, carpentry, hvac, general, other |
| **Label** | TEXT | Display label (e.g., "Plumbing") |
| **Contact** | TEXT | Contact name |
| **Phone** | TEXT | Contact phone |
| **Status** | TEXT | One of: not_scheduled, scheduled, on_site, completed, blocked |
| **ScheduledDate** | DATE | When trade is scheduled (YYYY-MM-DD) |
| **Notes** | TEXT | Additional notes |

---

## Sheet: Vendors

On-site vendor contacts.

| Column | Type | Description |
|--------|------|-------------|
| **ID** | TEXT | Unique vendor ID |
| **ProjectID** | TEXT | Foreign key to Projects.ID |
| **Name** | TEXT | Contact name |
| **Company** | TEXT | Company name |
| **Role** | TEXT | Role/title |
| **Phone** | TEXT | Phone number |
| **Email** | TEXT | Email address |
| **VisitDate** | DATE | Scheduled visit date |
| **VisitTime** | TEXT | Scheduled visit time (e.g., "9:00 AM") |
| **IsPrimaryContact** | BOOLEAN | TRUE if primary contact for project |
| **Notes** | TEXT | Additional notes |
| **BadgeOrFOBNeeded** | BOOLEAN | TRUE if security badge required |

---

## Sheet: Photos

Photo metadata (actual image files stored in `/photos/` subfolder).

| Column | Type | Description |
|--------|------|-------------|
| **ID** | TEXT | Unique photo ID |
| **ProjectID** | TEXT | Foreign key to Projects.ID |
| **Filename** | TEXT | Display filename |
| **Path** | TEXT | Relative path in OneDrive (e.g., "photos/proj-abc123-001.jpg") |
| **Caption** | TEXT | User-provided caption |
| **CapturedAt** | DATETIME | When photo was taken |

---

## Sheet: Settings

User preferences (stored as key-value pairs).

| Column | Type | Description |
|--------|------|-------------|
| **Key** | TEXT | Setting key |
| **Value** | TEXT | Setting value (serialized as JSON if complex) |

**Example:**
```
┌─────────────────────────────┬──────────────────────────────────────┐
│ Key                         │ Value                                │
├─────────────────────────────┼──────────────────────────────────────┤
│ technicianName              │ Matt Naughton                        │
│ nuvoloEmail                 │ mathworks@service-now.com            │
│ photoNamingPattern          │ {fwkd}-{location}-{timestamp}        │
│ calendarProvider            │ outlook                              │
│ meetingNotesFilename        │ ClosedWOs-May2026.csv                │
└─────────────────────────────┴──────────────────────────────────────┘
```

---

## Sheet: WorkOrders

Imported Nuvolo CSV data (daily active work orders).

| Column | Type | Description |
|--------|------|-------------|
| **Number** | TEXT | Work order number (e.g., "FWKD0001234") |
| **ShortDescription** | TEXT | Brief description |
| **State** | TEXT | Work order state |
| **Priority** | TEXT | Priority level |
| **AssignedTo** | TEXT | Assigned technician |
| **OpenedAt** | DATETIME | When opened |
| **DueDate** | DATE | Due date |
| **Location** | TEXT | Location |
| **AssignmentGroup** | TEXT | Assignment group |
| **Extra** | TEXT | JSON string of additional CSV columns |
| **ImportedAt** | DATETIME | When this row was imported |

---

## Sheet: MeetingNotesOrders

Separate import for closed/historical work orders (used for 1:1 meeting prep).

Same columns as WorkOrders sheet.

---

## Sheet: SavedVendors

User's persistent vendor "book" (global, not per-project).

| Column | Type | Description |
|--------|------|-------------|
| **ID** | TEXT | Unique vendor ID |
| **Name** | TEXT | Contact name |
| **Company** | TEXT | Company name |
| **Role** | TEXT | Role/title |
| **Phone** | TEXT | Phone number |
| **Email** | TEXT | Email address |
| **GeneralNotes** | TEXT | General notes about this vendor |

---

## Sheet: SavedVendorEvents

Recurring vendor service/event templates.

| Column | Type | Description |
|--------|------|-------------|
| **ID** | TEXT | Unique event ID |
| **Name** | TEXT | Event name (e.g., "Quarterly Drain Service") |
| **Cadence** | TEXT | How often (e.g., "Quarterly", "Annual") |
| **VendorName** | TEXT | Default vendor name |
| **VendorCompany** | TEXT | Default vendor company |
| **VendorRole** | TEXT | Default vendor role |
| **VendorPhone** | TEXT | Default vendor phone |
| **VendorEmail** | TEXT | Default vendor email |
| **ServiceDescription** | TEXT | What service is performed |
| **DefaultVisitNotes** | TEXT | Template notes for visits |
| **CreatedAt** | NUMBER | Unix timestamp when created |
| **UpdatedAt** | NUMBER | Unix timestamp when last modified |

---

## File Storage Structure

```
OneDrive/MWPJM/
├── MWPJM-Data.xlsx          # Main database
└── photos/                   # Photo storage
    ├── proj-abc123-001.jpg
    ├── proj-abc123-002.jpg
    └── proj-def456-001.jpg
```

---

## Migration Notes

1. **Version 1.0 Schema** - Initial Excel migration from JSON localStorage
2. **Photos are NOT embedded** - Stored as separate files to avoid bloating the workbook
3. **JSON fields** - Complex fields (Settings values, WorkOrders.Extra) stored as JSON strings
4. **Date formats** - Excel dates for columns marked DATE, ISO strings for DATETIME
5. **Boolean values** - TRUE/FALSE (Excel native)
6. **Timestamps** - Unix milliseconds for ArchivedAt/PinnedAt (backwards compat with existing code)

---

## Conflict Resolution Strategy

1. **Version field in Meta sheet** - Incremented on every write
2. **Last-write-wins by default** - OneDrive conflict files created if simultaneous saves
3. **Future:** Implement operation-based conflict resolution per sheet
