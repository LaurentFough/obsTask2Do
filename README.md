---
title: Task2Do Obsidian Plugin
description: Local-first todo.txt tasks with optional modular task integrations
slug: task2do
author: LaurentFough
type: software-runbook
date-created: 2026-10-13
date-modified: 2026-11-06
date-published: null
source: [Autotask official REST documentation, Microsoft Learn, Obsidian developer documentation]
domain: IT
url: https://github.com/LaurentFough/obsTask2Do
draft: true
tags: [obsidian, todo-txt, autotask, microsoft-graph, integrations]
keywords: [CompanyToDos, Microsoft To Do, device code, modular providers]
---

# Task2Do — 0.9.0-alpha.6 (ticket preview)

Desktop task manager with todo.txt as its local default and optional Autotask, Microsoft To Do and Planner integrations. The plugin ID is now task2do. Existing settings fields, view identifiers, provider identifiers, command suffixes and saved credentials are retained. All providers are embedded in main.js; no dependency installation is needed to use the release.

## New in 0.9.0-alpha.6 — Autotask Tickets preview

A separate **Task2Do: Autotask Tickets** panel shares the Autotask API connection and supports Me, a selected user or a selected set of users. It lists ticket numbers, company/assignee names, status, priority, queue and deadlines; supports status/priority/queue filters, search and due sorting; and provides title, description, due date, status/priority and validated primary-assignment updates, plus native ticket notes. Ticket writes default off and have their own settings pane. Status/priority/publish/note-type values come from tenant metadata; no completed status ID or note visibility is assumed. Uncertain note creations are journaled and must be reconciled before another creation. Ticket descriptions can be explicitly replaced with plain text after acknowledging formatting/image loss; existing notes remain unchanged.

See [Autotask Tickets setup and merge notes](docs/Autotask-Tickets.md). This build is reconciled with the owner's updated main at 2bdac131f0a9765e7dce74b7b3fbb320b1bf7403 on feature/autotask-tickets-merge. Revised labels and capitalization are preserved, and both Guide files now link to the ticket addendum. Publication/review status is tracked separately from local validation; a review branch is not a published release.

Validation: **196 tests pass**, including primary-assignment queries, status PATCH/readback, write gates, note visibility, persistent uncertain-write handling, note reconciliation and ticket UI flows. Live Autotask tenant/Swagger acceptance testing remains pending. Creation, secondary-assignment management, time entries, attachments and ticket cross-sync are deferred.

## New in 0.8.0-alpha.2 — contextual hover hints

Settings controls and provider connection forms now show value-free guidance. Panel/confirmation buttons explain their scope and write behavior, including preview/reconciliation actions. Task titles, due/status rows, local priority/project/context badges and Details provide loaded task context and explain which fields Edit supports. Read-only sources remain explicit, and static titles are not presented as inline editors. Hints use Obsidian's native tooltip API with native title fallback and accessible descriptions; no extra provider requests are made on hover. Existing disabled-action explanations are retained. The complete guide includes the new behavior.

Validation: **158 automated tests pass**, covering settings/input kinds, action hints, plain-text safety, credential-value exclusion, task context and unchanged control callbacks. Build, syntax and release-asset checks pass. Live theme/hover acceptance testing remains pending.

## New in 0.8.0-alpha.1 — settings and documentation

Settings now use a General pane and separate todo.txt, Autotask, Microsoft To Do, Microsoft Planner, OpenProject and Moovila panes. The installed manifest version appears above every pane. Existing setting keys, credentials, task paths and provider/panel IDs are retained. General contains credential encryption, Markdown indexing and sync controls. Provider-specific connection/configuration controls live in their respective panes. Microsoft sign-out now removes both adapters that share its authentication session.

The complete [Task2Do guide](docs/Task2Do-Guide.md) documents the local-first philosophy, source ownership, provider boundaries, installation/upgrades, every provider's configuration, mappings/previews/publishing, scheduled sync, conflicts and uncertain writes, credential recovery, backups, indexes, troubleshooting, current limits and primary references in BibTeX. Use it as the current operational guide; older sections below are release history and can describe superseded behavior.

Validation: **152 automated tests pass**, including provider-pane isolation, persistent installed-version display and shared Microsoft sign-out. Live Obsidian/theme and tenant acceptance testing remain necessary. GitHub publication is still blocked by the previously reported Contents-write permission error.

## New in 0.7.0-alpha.1 — local-first tasks and publishing

Both stages are included. No account, API credentials or network service is needed for standalone tasks. Existing configured paths, saved credentials and remote providers are retained.

| Area | Included behavior |
| --- | --- |
| First launch | Choose an existing vault-relative .txt file or create Task2Do/todo.txt, then open its panel |
| Editing | Title, multiline description, A–Z priority, created/start/due dates, projects and contexts; optional advanced raw-line editing |
| Views | Inbox, Today (including overdue), Upcoming, Completed and All tasks; saved search, state filters and due-date sorting |
| Identity | Persisted UUID uid: tokens; task identity survives insertion, reordering and repeated titles |
| File handling | Preserve custom extension tokens, detect duplicate IDs, check stale snapshots, verify writes and refresh on external file events |
| Obsidian access | Optional Markdown snapshot for Search, Tasks and Dataview, enabled by default for new installations |
| Publishing | Review task-specific Microsoft To Do/Planner destinations and preview exact values before creating/updating a bound counterpart |

### Stage 1: standalone setup

1. Install the three plugin assets into .obsidian/plugins/task2do and reload Obsidian. Retain data.json and credentials.enc if present.
2. On a fresh installation, choose or create the task file. Existing installations retain their configured path; use **Task file** or the command **Select or create todo.txt task file** to change it.
3. The ribbon opens the local task panel. **Providers** opens the provider chooser; existing provider commands also remain available.
4. Add tasks with structured controls. Project/context names accept spaces or commas as separators. Dates use calendar controls and local calendar days. Date-only deadlines fall at the end of that local day when published.
5. Inbox contains open undated tasks whose start is not in the future. Today includes overdue/today deadlines and tasks starting today. Upcoming includes future deadlines or future starts. All tasks can show both open and completed items.
6. Enable/disable Markdown snapshots under **Publish searchable Markdown indexes**. The default note is Task2Do/todotxt.md. It includes task checkboxes, due dates, priority/project/context fields and stable remote_id values. It is a generated index: checkbox edits there do not change todo.txt and are overwritten on refresh.

Opening an existing file appends uid: tokens to non-empty task rows. Existing task text, custom tokens, BOM, blank lines and line endings remain intact during identity assignment. Structured edits retain unknown extension tokens, including duplicates. A titleEnd:1 boundary token protects literal +/@/colon text in structured titles. Descriptions use optional percent-encoded details: extensions. Standard todo.txt tools can still read the task lines; they may display these optional extensions. Keep those extensions to retain Task2Do descriptions and sync identity.

Duplicate/invalid IDs stop editing rather than merge unrelated tasks. External edits invalidate open editor snapshots; refresh and reopen the editor. File events refresh the local panel. If the file is deleted or renamed, choose/restore it with **Task file**. Bound tasks retain the original file namespace; moving a bound file requires deliberate reconciliation rather than automatic rebinding. Conflict checks use Vault.process for indexed files and readback verification elsewhere; they are not a cross-process filesystem transaction.

### Stage 2: publish local tasks

1. Optionally connect Microsoft To Do or basic Microsoft Planner in settings. Autotask catalogs and credentials are not required for local publishing.
2. Click **Publish…** on a local task. Select a named To Do list, or a Planner plan/bucket and optional group member. Save the reviewed mapping.
3. Click **Build preview**, inspect the exact values, then **Push reviewed task**. The local file remains the source of the task; the remote ID is recorded separately.
4. A repeated push updates the bound counterpart instead of creating another task. Changing its list/plan requires reconciliation. Membership and destination availability are rechecked before writes.
5. **Task Sync → Refresh destinations** brings back non-conflicting title, description, deadline and completion edits, plus Planner start dates. Exact remote timestamps remain in optional metadata even when the editor shows date-only controls. Competing edits, changed assignments or changed buckets require review.
6. Scheduled sync remains opt-in. Its separate write option affects already-bound tasks only; it never creates unbound tasks or propagates deletions. Uncertain writes and mismatched readbacks block retries and retain known remote IDs for reconciliation.

Local tasks publish to Microsoft To Do and Planner through the existing preview/journal mechanism. Creating new Autotask, OpenProject or Moovila counterparts from local tasks is not included in this release. Existing Autotask-imported task publishing and source updates remain available. OpenProject and Moovila follow their deferred backlog order.

Validation: **150 automated checks pass** across standalone setup, identity migration, structured editing, named views, external events, Markdown indexing, local Microsoft publishing, conflict resolution and uncertain-write protection. Live Microsoft tenant acceptance testing remains pending. Source and tests are included. The earlier Contents-write blocker has been resolved; see the current publishing workflow below. Generated asset URLs work only after the corresponding release is published.

## New in 0.6.0-alpha.1

Microsoft Planner is a separate provider sharing Microsoft sign-in. Configure explicit basic, group-owned plan IDs. It supports plan/bucket/user selection, task creation, title/description/schedule/assignment editing, completion and reopening. Writes use fresh ETags and readback. Premium plans and personal Microsoft accounts are outside this Planner scope. Reconnect Microsoft after configuring plans to consent to GroupMember.Read.All alongside Tasks.ReadWrite.

Open **Task2Do task sync** from the ribbon or command palette. Pull Autotask into the configured todo.txt file; catalogs.json, mappings.json and sync-state.json are stored in the configured sync folder (default Task2Do). Companies/users are catalogs, not task rows. Imported tasks have stable UUID/source references. Review company-to-To Do-list or Planner-plan/bucket mappings and Autotask-resource-to-Entra mappings, then preview selected pushes. Microsoft To Do cannot retain another user's assignment; personal-list ownership requires an explicit selection.

Sync operates on Autotask-imported tasks. Ordinary todo.txt tasks remain local. Destination refresh merges non-conflicting edits and exposes competing changes for review. Local edits can be pushed back to existing Autotask tasks; company reassociation stays in Autotask Edit. Optional automatic cycles run while Obsidian is open. Automatic remote writes require a separate opt-in and only affect previously bound tasks. Deletion propagation and automatic creation are excluded. Uncertain writes are journaled and block retries until manually reconciled. Multi-file local writes are not a database transaction; interrupted updates can require conflict review. Keep a backup of todo.txt and the sync documents.

Microsoft To Do now supports description/due-date editing and small file attachments (upload under 3 MB; download to the vault). Autotask **Note** appends timestamped plain text to the existing description; this is not a native threaded comment. Native Autotask To-Do attachments/comments remain pending where no verified API has been implemented.

Optional password-encrypted credential storage uses PBKDF2-SHA256 and AES-256-GCM in credentials.enc. Enable it in settings and unlock after restart. The passphrase stays in memory and must be at least 12 characters. Retain credentials.enc and the passphrase when moving installations. Forgotten passphrases cannot recover secrets; credentials can be re-entered. This is portable password encryption, not an OS keychain. Historical data.json backups may still contain previously saved plaintext credentials.

The ribbon includes Planner and task sync. OpenProject follows the Microsoft/local providers; Moovila is last. Further OpenProject work is deferred immediately before Moovila work.

### Releases and updates

Install through **BRAT** using `LaurentFough/obsTask2Do` after the first GitHub release is published. BRAT downloads the separate release assets and can manage future updates. Task2Do is currently a desktop-only alpha.

Maintainers: open **Actions → Release Task2Do → Run workflow**, select the release branch and leave the version field blank to use the manifest version. An optional entered version must match (no `v` prefix). The workflow validates, builds and tests, creates the tag, uploads installation assets to a draft and publishes it. Exact-version tag pushes remain supported. Source pushes alone do not publish updates.

See the [BRAT publishing and installation runbook](docs/BRAT-Publishing.md) for version preparation, user setup, update channels and recovery. BRAT uses GitHub releases; the custom appcast is additional metadata and is not consumed by BRAT or a built-in Task2Do updater.

### Remaining backlog

Live provider acceptance testing; richer Planner checklists/labels/references; native threaded Autotask comments/attachments when a verified endpoint is available; native local-task adoption and deletion propagation; then OpenProject custom-field/proxy support and sync; finally Moovila authentication/write support. Existing OpenProject and Moovila providers are retained.

## New in 0.5.0-alpha.6

Autotask To-Do **Edit** now includes **Task text / description**. CompanyToDos has no independent title/name property: activityDescription is the native visible task text. To rename a task, change the first line, retaining any further details you want to keep. The compact task list uses the first line as its summary. The editor loads the entire original string and sends it only when changed; it does not automatically truncate, strip HTML, convert markup or discard later lines.

Saving replaces activityDescription with the text in this editor. If an existing record contains formatting/images represented by markup, retain that source markup when editing; this is a source-text editor, not a WYSIWYG rich-text editor. The Edit dialog explains this before saving. Task text must be nonblank and at most 32,000 characters. As with existing Autotask edits, enable writes first; completed tasks must be reopened before editing.

The provider checks a fresh snapshot for remote changes and confirms activityDescription is writable through field metadata. It PATCHes only the changed fields plus the task ID to the existing company child collection. Description changes require a readback confirming the exact text and any assignment/schedule changes submitted with it before success is reported. Writes are not retried automatically, and uncertain outcomes require checking Autotask. Text is not included in logs. Company changes remain a separate operation; pending text edits must be saved before opening Change company. Dates, creator attribution and links are not rewritten merely to rename a task.

Microsoft To Do and OpenProject already support title editing; todo.txt already supports task-line editing. Moovila remains read-only because published Report endpoints expose no write operations.

**110 automated checks pass**, including minimal rename PATCH/readback, blank/oversized validation, read-only metadata rejection, unconfirmed server changes, and UI text changes leaving schedule seconds untouched. Live acceptance: use Edit on a disposable open Autotask To-Do, change its first line while keeping the remaining description, save, and verify both text and dates in Autotask. Replace main.js, manifest.json and styles.css when upgrading; retain data.json and task files.

## New in 0.5.0-alpha.5

The Autotask panel now has a saved list selector:

| View | Membership |
| --- | --- |
| My Tasks | Currently assigned to the configured Assigned Resource ID, regardless of creator. Includes self-created/self-assigned tasks. |
| Delegated by Me | Created by the actual user or API account and currently assigned to someone other than the configured Assigned Resource ID. |
| All Tasks | Combined fetched records, deduplicated by remote task ID. |

My Tasks and Delegated by Me have exclusive membership. All Tasks is their combined view, not a third ownership category. Only the selected view is rendered, so tasks are not repeated within the panel. All Tasks is the initial selection for existing installations; subsequent selections are saved. Existing creator/API identity lookups are retained. Search, open/completed/all state and due sorting apply within the selected list. The API still fetches the full assigned/human-creator/API-creator union on refresh, so changing lists locally does not require reconnecting. Markdown indexes publish the full deduplicated fetched union rather than only the selected list.

Diagnostic wording now identifies My Tasks or Delegated by Me, and it checks the selected list along with the state/search filters. Existing view/command IDs, provider configuration, saved credentials and provider behavior are retained. **105 automated checks pass**, including exclusive personal/delegated membership, API-origin delegation, All Tasks deduplication, selector switching and saved preferences.

Upgrade main.js, manifest.json and styles.css while retaining data.json. In the Autotask panel, use the new My Tasks / Delegated by Me / All Tasks dropdown beside the other filters. Confirm a self-assigned task is present in My Tasks and All Tasks but absent from Delegated by Me.

## New in 0.5.0-alpha.4

Assigned by Me now includes both the actual user's Creator Resource ID (falling back to Assigned Resource ID) **and the connected API user's Resource ID**. This captures tasks created within Autotask and tasks whose creatorResourceID is the API account used by Task2Do. It queries each distinct creator separately, with existing pagination and permission enforcement, and deduplicates task records across all scopes before enrichment/indexing. Assigned to Me retains its assigned resource filter.

The API identity is resolved once per connection through Resources/query using an exact userName match to the API credential username. Exactly one matching resource is required; names, email addresses and license labels are not used as guesses. Reconnecting or changing creator/API configuration rebuilds the connection and its identity cache. The optional **API user Resource ID** setting bypasses discovery when your API account cannot query Resources. Set it to the API account's numeric Resource ID from Autotask. It is a lookup filter, not an impersonation setting. If discovery fails, refresh stops with instructions to enter this ID rather than returning a misleading partial created-task list.

Keep **Creator Resource ID** set to the actual human user's Resource ID (or leave blank if Assigned Resource ID is already that user). Leave API user Resource ID blank for automatic lookup, or enter the known service account ID. Refresh after upgrading. Check Autotask To-Do by ID now compares the recorded creator with both creator identities and displays the resolved/configured API Resource ID.

A shared API account can create tasks for multiple people or integrations. As requested, this scope includes **all accessible tasks created by that API account**, not just records proven to originate from this particular Task2Do installation. There is no reliable installation-specific attribution marker on earlier tasks. No assignment-history or impersonator field is substituted for creatorResourceID.

**105 automated checks pass**, including API username resolution/caching, human/API creator unions, identical-ID deduplication, ambiguous identity rejection, manual API resource configuration and both creator origins appearing in the panel. Live validation still needs the user's tenant. Upgrade main.js, manifest.json and styles.css while retaining data.json and task files.

## New in 0.5.0-alpha.3

Assigned by Me no longer excludes tasks assigned to the configured assignee. It shows all tasks whose creatorResourceID matches the configured creator resource. A task can appear in both sections when it matches both relationships; the top summary counts unique tasks, and Markdown indexes remain deduplicated. This supersedes 0.5.0-alpha.2's exclusive section placement.

A new **Creator Resource ID (optional)** setting separates creator identity from the existing Assigned Resource ID. Set this to your own Autotask Resource ID when the assigned resource filter belongs to another user. Leave it blank to retain the previous default of using Assigned Resource ID for both queries. Changing it preserves an active connection's credentials and rebuilds the provider automatically. Saved credentials and all existing settings remain compatible. Names are not used to infer identities, and the API service account is not assumed to be the human creator.

Use **Task2Do: Check Autotask To-Do by ID** (also available in settings) for a missing record. It makes a read-only direct CRM CompanyToDos lookup outside the list queries, verifies the returned ID, and displays the recorded creator/assignee names and IDs, configured IDs, which sections match, and whether the current state/search filters allow the task. It does not edit the record, automatically change identity settings, log record contents or expose credentials. An impersonator creator ID, when returned, is shown separately and is not treated as the creator. A failed lookup may mean the account cannot access that CRM To-Do, the ID is wrong, or the item belongs to a different entity (for example a ticket/project Task).

To investigate a specific missing task:

1. Install this release, retaining data.json.
2. Choose All and clear search in the Autotask panel, then Refresh.
3. If your Assigned Resource ID belongs to another user, set Creator Resource ID to your own Resource ID.
4. Run Check Autotask To-Do by ID with the numeric CRM To-Do ID. Compare the returned creator with the creator configuration and note the section/filter result.
5. If the record matches a section but remains absent after refresh, report that diagnostic result and the task ID (without credentials). Further investigation can then target query visibility rather than guessing at attribution.

Validation: **101 automated checks pass**, including independent creator query IDs, overlapping section membership, direct read-only inspection and UI reporting of creator/filter mismatches. The particular user-reported live task has not been read here; these changes remove confirmed implementation exclusions and provide an evidence-based check for remaining API/configuration issues.

## New in 0.5.0-alpha.2

Every panel places New task first, followed by a noticeable gap, Refresh, and Connect/Sign in where applicable. Controls stay on one line; narrow panels can scroll the toolbar horizontally. Moovila's New task button is disabled because the published API is read-only. todo.txt needs no connection control.

The Autotask panel now fetches both assignedToResourceID and creatorResourceID matching the configured Resource ID. It displays two separate sections:

- **Assigned to Me:** tasks currently assigned to that resource, including self-created tasks.
- **Assigned by Me:** tasks created by that resource and currently assigned to someone else. This uses creatorResourceID, not assignment-history audit events; a later reassignment performed by the user does not itself make them the creator.

The two query results are deduplicated by remote task ID before enrichment/index publication. Self-created/self-assigned tasks appear once in Assigned to Me. A failure in either query stops the refresh instead of presenting a partial personal listing. Both sections use the same saved open/completed/all filter, search and due sort, and show counts and empty states. Assignee/company names and existing Edit/Complete/Reopen actions remain available in both sections, subject to API permissions. The opening command now says Open Autotask Tasks (assigned and created); its internal command ID is retained.

The configured Resource ID defines Me for both lists. It does not automatically resolve from the API service account. Autotask may record a service account as the creator of API-created records; verify attribution in your tenant before expecting those records in Assigned by Me. The plugin does not fabricate creator attribution or use impersonation automatically. Optional Markdown indexes now include the union of the assigned and created queries, with no duplicated task records.

Upgrade by replacing main.js, manifest.json and styles.css, retaining data.json and task files. **97 automated checks pass**, including toolbar ordering, both API query scopes, overlap deduplication, failure handling and shared filters across the two sections. Live acceptance: verify one task assigned to you, one task created by you for another resource, and one self-created/self-assigned task. Confirm the counts and that changing the assignee moves a self-created task between the appropriate sections after refresh.

## New in 0.5.0-alpha.1

Moovila and OpenProject now have separate providers, panels, commands, connection settings and optional remembered credentials. All providers share filters, search, sorting, urgency styling and optional Markdown indexes. Existing saved credentials/configuration, provider IDs and view IDs are retained. Microsoft Planner and cross-sync are deferred.

| Feature | Moovila | OpenProject |
| --- | --- | --- |
| Read tasks | PublicAPI Report tasks and projects | API v3 work packages, optionally one project |
| Display names | Project, owner and status | Project, assignee and status |
| Create | Unavailable in published reporting API | Project/type, title, Markdown description, dates and optional assignee |
| Edit | Read-only | Title, Markdown description, dates, assignee and allowed workflow status |
| Complete/reopen | Read-only | Choose an allowed closed/open workflow status |
| Credentials | Vendor-issued bearer token | API key with Basic apikey authentication |
| Private/self-signed HTTPS | Public Moovila host only | Per-instance public CA/self-signed PEM certificate trust |
| Comments/attachments | Not implemented | Not implemented |

### Moovila onboarding

1. Obtain PublicAPI access and a bearer access token through your Moovila administrator/vendor-approved OAuth integration. No password-grant or browser-token extraction workflow is implemented. The published Swagger documents Report GET endpoints; no creation/update endpoints are exposed there, even though its auth metadata mentions writeAccess.
2. Open Task2Do Settings → Moovila → Connect Moovila (or the command with that name). Use https://api.moovila.com and paste the access token. Choose Remember connection credentials if desired.
3. Open Task2Do: Moovila Tasks. Task/project reports are paginated with offset/limit. All accessible tasks are retrieved; deleted tasks are omitted. Owner/project/status names are displayed. Completion is derived from completionDate or percentageComplete >= 100. No critical-path, assignment editing or remote writes are attempted.
4. Tokens are not automatically refreshed. If rejected/expired, connect with a newly issued token. Remembered tokens are plaintext in data.json, consistent with the interim credential design. The provider does not log tokens or task bodies.

### OpenProject cloud and on-premises onboarding

1. In the target OpenProject instance, generate an API token under your account's access-token settings. Your account needs access to the projects/work packages and the corresponding create/edit/workflow permissions.
2. Open Task2Do Settings → OpenProject → Connect OpenProject. Enter the final HTTPS instance URL, for example https://projects.example.org or https://projects.example.org/openproject. Ports and installation subpaths are supported. An /api/v3 suffix is optional and normalized. Plain HTTP is not accepted because the API key would otherwise be sent without TLS protection.
3. Paste the API key. Optionally enter a numeric Project ID to restrict task retrieval; leave it blank for all accessible work packages. Creation still offers a project selector.
4. For a normal publicly trusted certificate, leave the PEM field blank. For on-premises private PKI, paste the public issuing CA chain. For a self-signed server certificate, paste that public certificate. Get these from your administrator or another verified channel. The field accepts CERTIFICATE PEM blocks, not private keys. Certificate validation is scoped to requests for this configured instance; hostname/SAN, validity and certificate-chain checks stay enabled. There is no global trust-all setting or process-level TLS change.
5. Ensure the certificate SAN matches the configured DNS name (or IP when using an IP URL). Supplying a certificate does not override a hostname mismatch. When the self-signed certificate is replaced, update the PEM configuration. Private CA trust can continue to validate new certificates issued by that CA.
6. Enable OpenProject writes if needed, and choose whether to remember the API key. Connect verifies project access before retaining the session. The public certificate and connection options are saved; the API key is saved only when remembering is enabled. Without remembering, the key stays in the session and must be entered after restart.
7. Open Task2Do: OpenProject Tasks. Use New task for creation or Edit/Complete/Reopen on a task. Dates use date-only calendar controls because OpenProject's work-package start/due dates are date-only. Completion depends on status.isClosed, not a hardcoded status ID/name or 100% progress.

OpenProject forms determine available types, assignees and statuses. Type/project changes reload form choices. Required custom fields that are not represented in this initial UI cause creation to stop with the affected field names; complete those fields in OpenProject. Do not assume every type supports every edit; the server's form/workflow permissions are authoritative. Creation includes the returned validated form payload. Updates send only requested changes with the freshly verified lockVersion. Task readback is required after writes. Unknown creation results must be inspected before another attempt; writes are never automatically retried.

OpenProject uses a dedicated Node HTTPS transport in the desktop plugin, with request-specific certificate trust, 30-second timeout, response-size limit and redirect refusal. Configure the final instance URL rather than an HTTP or redirected login URL. This transport does not inherit browser cookies, browser proxy settings or every platform-specific trust-store entry; use a PEM CA bundle when private trust is needed. Explicit corporate proxy support is not implemented in this release. The default OpenProject network trust follows Node's trust configuration.

### Upgrade and verification

Disable Task2Do; replace main.js, manifest.json and styles.css in .obsidian/plugins/task2do; retain data.json and your configured task files. Restart or re-enable Task2Do. Provider sources/tests and Git history are included for development.

Automated validation: **93 checks pass**, covering report pagination, provider URL confinement, HAL collections, embedded workflow values, forms, minimal lockVersion PATCH, no write retries, saved-session restoration, onboarding fields and provider actions. TLS integration tests use a local HTTPS server and prove self-signed certificates are rejected without configured trust, accepted with the configured certificate, rejected on hostname mismatch, and redirects are not followed. Development TLS tests require openssl; using the plugin does not.

Live acceptance: connect Moovila and compare a project's task/owner/status/due data with the web app. Connect your OpenProject instance, verify a project-filtered list, then create a disposable work package, edit title/dates/assignee, complete and reopen through allowed statuses. Make an external edit while a task dialog is open: the stale update should be rejected. Test self-signed trust against your own instance. No authenticated vendor/instance test has been performed here, so differences in installed version, required custom fields, API permissions or token provisioning may need follow-up.

Cross-sync remains deferred until these providers have passed live validation. Moovila currently supports source-side reads only; bidirectional writes need vendor-supported endpoints before they can be added.

## New in 0.4.0-alpha.2

Panel/tab titles now read **Task2Do: Autotask Tasks**, **Task2Do: Microsoft To Do Tasks**, and **Task2Do: todo.txt Tasks**. Matching opening commands read Open Autotask Tasks (assigned To-Dos), Open Microsoft To Do Tasks, and Open todo.txt Tasks. Obsidian adds the Task2Do command prefix. Internal view/command IDs, saved view preferences and credentials remain compatible.

todo.txt rows now separate the readable description from extension tokens. Priority, projects and contexts appear as compact badges. Company/resource names appear together; IDs are used as fallbacks when names are absent. Underscores or percent-encoded spaces in names are rendered as spaces. Start/end extensions appear as local minute-resolution schedule values. The due date remains beside status and ID. A collapsed Details section contains all extension fields, creation/completion dates, the file path and the original line; unknown and duplicate extensions remain accessible. All rendering uses text nodes. Raw task lines are retained for editing and writing. This change does not add cross-provider sync or interpret extension IDs as remote identities.

Validation: 75 automated checks pass, including provider-specific panel/command labels and separation of task text from metadata. Test your Obsidian theme after replacing main.js, manifest.json and styles.css; retain data.json and the configured todo.txt file.

### Proposed next steps — discussion only

**Planner:** add a separate microsoft-planner provider, reusing the Microsoft authentication/transport infrastructure. Begin with explicit plan selection and bucket/task retrieval, followed by task creation, title/description/dates, assignment, completion and reopening. Work/school accounts are required for delegated Planner task creation. Basic plans are supported by the Graph API; premium plans are outside this adapter. Task details and ETags require separate handling; do not treat a To Do list as a Planner plan. Least-privilege permission requirements should be checked for each chosen endpoint, including plan discovery and user lookup, before expanding consent.

**Cross-sync:** keep todo.txt as one task per line. An initial Autotask pull can add stable task UUIDs and source IDs to task extensions, with company/user catalogs in separate JSON files. Catalog files should store provider-scoped IDs and lookup timestamps. Match Autotask resources to Entra users explicitly, using validated email/UPN as a candidate and reviewed mappings as the authority. Names and numeric IDs are insufficient for cross-provider identity. Map Autotask companies to intended Planner plans/buckets explicitly; neither Microsoft To Do nor Planner offers a native Autotask company entity.

A separate sync-state store should retain the last synchronized values, provider IDs, versions/ETags, timestamps and write outcomes. Row numbers are not stable identities. On first pull, preserve existing local tasks and avoid creating duplicates. On push, refresh destination identities, membership and permissions; cached company/user catalogs cannot guarantee authorization. Start with explicit preview-and-push for selected tasks, readback verification and durable tracking of uncertain creation outcomes. Then add incremental pull and three-way conflict detection using the previous synchronized state. Decide which fields each provider owns, how rich descriptions are represented, and whether completion propagates before allowing automatic bidirectional writes. Deletion propagation should be opt-in and treated separately from completion.

Suggested implementation sequence: Planner read support → Autotask pull plus identity catalogs → explicit reviewed pushes → conflict-aware incremental sync. Planner and cross-sync are not implemented in this release.

## New in 0.4.0-alpha.1

- **Autotask creation:** use New task in the Autotask sidebar, or Task2Do: Create Autotask To-Do. Enable To-Do updates first. Search and select an active company, choose a named assignee and action type, enter description and local start/end times. Creation uses the company child collection and verifies the returned task. Autotask has no separate task title. New tasks assigned to another resource will not appear under your configured resource filter. Unknown results are never retried automatically; inspect Autotask before another creation attempt.
- **todo.txt:** a separate modular provider, not an automatic cross-provider sync. Set a relative vault path (default todo.txt), then Task2Do: Open todo.txt. Create/edit one task line; complete/reopen explicitly. Supports `(A)` priority, creation/completion dates, `+projects`, `@contexts`, and the common `due:YYYY-MM-DD` extension. Original unknown extensions, BOM, blank lines and newline styles are retained. Completion uses `x YYYY-MM-DD` and saves priority as `pri:A`; reopening restores it. Existing files are read without rewriting; a missing file is created only on first task creation. External changes require Refresh before editing. No automatic done.txt archive.
- **Indexing:** sidebar data was previously only in memory and unavailable to other plugins. Enable Publish searchable Markdown indexes, then refresh each provider. All fetched tasks (before sidebar filters) are written to separate notes under Task2Do by default. As of 0.4.0-alpha.1, Autotask indexed only the configured assigned resource (0.5.0-alpha.2 adds tasks created by that resource); this is not an organization-wide export. Markdown checkboxes, `#task`, due-date emoji and Dataview inline fields allow Obsidian Search, Tasks and Dataview to discover snapshots. Configure another plugin's global filter or excluded folders accordingly. Source IDs and list IDs are included; todo.txt row IDs change when lines move. Indexes are **one-way**: checking a box or editing a snapshot does not update its source, and refresh overwrites such edits. Existing notes without Task2Do ownership metadata are never overwritten. Disabling publishing leaves existing snapshots in place.
- **Compact styling:** smaller padding, metadata and action buttons; long descriptions expand on demand. Status, ID and minute-only due date remain together in the first line. Date-only todo.txt deadlines stay date-only and use local end-of-day for urgency. Colours follow due proximity: overdue red, today orange, next 1–3 calendar days amber, days 4–7 muted blue, later/default muted. Completed tasks do not display overdue urgency. Explicit urgency labels accompany colours. Styling takes inspiration from Todoist's compact task presentation and priority colours; urgency does not replace provider priority data.
- **Graph scope:** Microsoft To Do only (`/me/todo/lists`), with list retrieval, task creation (including editor selection), title editing, completion and reopening. Planner now has a separate basic-plan provider; labels and checklists remain pending. Microsoft's Graph Planner API supports basic plans; premium plans are not exposed by that API. See the 0.6.0-alpha.1 Planner setup above.
- Credential saving, plugin ID task2do, existing view IDs and saved settings remain compatible. No data.json is included in the release.

### Upgrade and acceptance checks

Disable Task2Do and replace main.js, manifest.json and styles.css in `.obsidian/plugins/task2do/`; retain your existing data.json. Restart or re-enable the plugin. The archive also includes source modules, tests and version history for development.

1. Create a disposable Autotask To-Do assigned to your configured resource; verify company, description, assignee, action type and schedule in Autotask. Create another for a different resource and check it in Autotask rather than expecting it in your filtered view.
2. Open an existing todo.txt or create a new task, then edit, complete and reopen it. Make an external file change while a task dialog is open: saving should be blocked until refreshed.
3. Enable index publishing and refresh the sidebars. Search for a task title in Obsidian. Example Tasks query: `not done` with `path includes Task2Do`. Example Dataview query: `TASK FROM "Task2Do" WHERE !completed`. For a Tasks global filter, use #task or adjust it to match. These are snapshots; use Task2Do's actions to change source tasks.
4. Test Microsoft sign-in and create/edit/complete/reopen with a disposable To Do task. Live Graph validation remains outstanding, as does live testing of this release's Autotask creation. Test Planner with a disposable basic plan and verify edits in Microsoft.
5. Review the compact layout in your Obsidian theme and check overdue/today/3-day/week/later examples. Urgency is calculated on refresh/render; refresh after a date boundary or changed due date.

Validation: 72 automated checks cover provider requests, no duplicate POST retry, Vault conflict checking, file format preservation, Markdown ownership, urgency boundaries and UI commands. Host UI tests use an Obsidian mock; they do not substitute for testing your tenant or theme.

## Release features

| Feature | Autotask | Microsoft To Do |
| --- | --- | --- |
| Read and refresh | Assigned resource filter | Signed-in user's lists |
| Open/completed/all filter | Yes | Yes |
| Text search | Description, names and remote ID | Title, description, list and remote ID |
| Due-date sorting | Earliest/latest, undated last | Earliest/latest, undated last |
| Display names | Organization and assignee lookups | List name |
| Create task | New-task form (writes enabled) | New-task form and selected-note-text command |
| Edit | Assignee, schedule and validated company change | Title |
| Complete | Explicit completion date | Explicit completed status |
| Reopen | Guarded null clearing with metadata and readback verification | Explicit notStarted status |
| Remember connection | Optional API credentials | Optional access/refresh tokens |
| Comments and attachments | Deferred | Deferred |

Filters, search text and sorting are saved independently for each sidebar. Switching presentation options does not issue a remote write. Autotask name lookups use Companies/{id} and Resources/{id}, cache results for five minutes, and fall back to labeled IDs if access is unavailable. Names are display values; remote IDs remain the stable identifiers used for updates.

## Install or upgrade

1. Disable the installed plugin.
2. Extract the archive. Copy main.js, manifest.json and styles.css from its task2do folder into `.obsidian/plugins/task2do/`. When migrating from the old ID, copy the existing `.obsidian/plugins/autotask-todo/data.json` into `.obsidian/plugins/task2do/data.json` before enabling the new plugin.
3. Preserve your existing data.json. The archive does not contain credentials or replace that file.
4. Re-enable the plugin. Existing remembered Autotask credentials restore automatically.
5. Run **Task2Do: Open assigned To-Dos**.

For a new installation, configure the actual zone REST URL (for example `https://webservices4.autotask.net/atservicesrest/v1.0/`) and your assigned Resource ID. The example URL is not zone discovery. The Resource ID is your user, not the API-only account. Connect with the dedicated API username, secret and integration tracking ID. Enable **Remember credentials** if desired. Enable **To-Do updates** for editing, completion and guarded reopening. Existing settings and credentials survive this upgrade.

## Autotask reopen verification

Official documentation says setting completedDate completes a To-Do and that completed To-Dos remain queryable. The public documentation does not explicitly guarantee that clearing completedDate reopens an item. This implementation therefore checks and verifies the operation at runtime rather than treating a successful PATCH response as proof.

1. Select **Completed** or **All** in the Autotask sidebar.
2. Use a disposable completed To-Do and click **Reopen**.
3. The plugin fetches the current record and rejects stale snapshots.
4. It reads CompanyToDos field metadata and requires completedDate to be writable and optional.
5. It sends a minimal PATCH to `Companies/{companyID}/ToDos` containing only id and completedDate: null.
6. It reads the original To-Do back and reports success only if the same record has a null completion date.
7. Verify that it appears as open in Autotask directly.

Metadata writability does not prove semantic support. Live reopening has not been verified against your tenant. If Autotask refuses null clearing or leaves the record complete, the plugin reports that reopening was not confirmed. No replacement To-Do is created and no CRM note is deleted. If no completed items are returned by CompanyToDos, do not invent a mapping from CompanyNotes; those records have different fields, and the completion timestamp on CompanyNotes is read-only. Investigate the tenant's completed-item query behavior first.

Remote comparison is best-effort conflict detection, not an atomic server-side conditional update. Another user could modify a record between the check and PATCH. Writes are never automatically retried. If the outcome is unknown, inspect Autotask and refresh before submitting another action.

## Microsoft To Do setup

This provider uses Graph v1.0 and delegated authorization. It does not use an application client secret, your Microsoft password, or application-only permissions.

1. In Microsoft Entra ID, register an application. For a work account, a single-tenant registration with your Directory (tenant) ID is the simplest starting point. For a personal or multi-tenant application, choose the matching supported account type and tenant alias.
2. Record **Application (client) ID** and **Directory (tenant) ID**.
3. Under Authentication → Advanced settings, set **Allow public client flows** to **Yes**. Device code flow needs no local callback listener.
4. Add Microsoft Graph **delegated** permission **Tasks.ReadWrite**. Consent according to your tenant policy. The plugin also requests offline_access for refresh tokens.
5. In Obsidian plugin settings → Microsoft To Do, enter the client ID and tenant ID. Use common/organizations/consumers only when the app's supported account type matches.
6. Optionally enable **Remember Microsoft sign-in**.
7. Click **Sign in to Microsoft**, then **Start sign-in**. Open the displayed Microsoft link, enter the displayed code and complete authentication/consent. Closing the dialog cancels polling.
8. Run **Task2Do: Open Microsoft To Do**. Read the signed-in user's task lists.
9. Click **New task** to choose a list, title, description and optional local calendar due date/time. Alternatively, select text in a note and run **Create Microsoft To Do task from selection**. The selected first line becomes the editable title; the description includes the selected text and source note path.
10. Test title editing, completion and reopening on a disposable task. Changes should appear in Microsoft's own app.

Supported deployment: Microsoft's global public cloud. National/sovereign clouds, account switching and recurrence editing are deferred. See the new Planner and sync scope above. Tenant Conditional Access may block device-code flow; the plugin cannot override that policy. Microsoft sign-in and Graph changes still need live acceptance testing with your account.

Due dates entered in the creation form include an explicit timezone and are sent to Graph in UTC. Returned UTC/IANA timezones and common Microsoft timezone labels are converted for sorting using the runtime timezone database. Unknown labels use the service-supplied wall-clock date/time at minute precision for display and are treated as unsortable/undated rather than guessed. Description content is displayed as text, including any HTML returned by Microsoft; it is never injected as executable HTML.

## Credential persistence

**Remember credentials** retains the Autotask username, secret and integration tracking ID. **Remember Microsoft sign-in** independently retains access and refresh tokens. Both are temporary plaintext storage in the plugin's data.json and may sync with the vault. Do not share that file.

Turning an option off removes its saved secrets from the current settings file while retaining the active session. **Disconnect** ends the Autotask session without forgetting saved credentials. **Forget Microsoft sign-in** ends the Microsoft session and removes saved tokens. Changing the Microsoft client/tenant configuration clears the old tokens and disconnects that provider. Disabling remembering does not erase backup or sync history. Platform-protected credential storage is a future improvement.

Microsoft tokens refresh when needed; rotated tokens are persisted only when remembering is enabled. Settings writes are serialized so simultaneous token refresh and presentation changes do not race on disk. Logs contain HTTP status, operation and attempt only. Credentials, tokens and task content are excluded from logs. A resource display filter is not an authorization boundary; restrict the dedicated Autotask API user appropriately.

## Architecture and development

| File | Responsibility |
| --- | --- |
| core.cjs | Autotask transport, normalized records, names, edits and guarded reopening |
| graph.cjs | Microsoft authentication, token refresh and To Do provider |
| task-core.cjs | Shared provider registry and presentation filtering/sorting |
| main.js | Obsidian settings, commands, dialogs and sidebars; generated provider blocks |
| build.cjs | Embed editable providers into main.js without external dependencies |
| tests/ | Provider, authentication, persistence, loading and host/UI regression tests |

To add another integration, implement a provider with id, capabilities, list and dispose; register it in ProviderRegistry. Optional actions include create, update, complete and reopen. Keep authentication and provider-specific fields inside the adapter. Autotask actions retain provider-specific schedule and assignment validation. Microsoft creation and status changes use their own task/list model.

With Node.js 20 or later, run:

```sh
npm run build
npm test
npm run check
```

The release has 58 passing automated tests, including host-loader/UI simulations. These are not a substitute for live Obsidian or account testing. User-confirmed live behavior to date: plugin loading, Autotask retrieval and Autotask editing. Completion, reopening, name resolution and Microsoft sign-in/actions need live confirmation. Source history is included as history.bundle; restore with `git clone history.bundle restored-project`.

## Acceptance checklist

- [ ] Existing remembered Autotask connection survives upgrade.
- [ ] Open/Completed/All and search change the displayed subset immediately.
- [ ] Earliest/latest due sorting is correct; undated items remain last.
- [ ] Names resolve with appropriate permissions; restricted lookups display labeled IDs.
- [ ] Completion is visible in Autotask.
- [ ] Reopening clears completion in the tenant and is verified by readback.
- [ ] Microsoft device sign-in completes and remembered tokens survive restart.
- [ ] A selected note produces one task in the selected Microsoft list.
- [ ] Microsoft edit/complete/reopen changes appear in the native app.
- [ ] Forgetting credentials/tokens removes them from the current settings file.

## Release history

- 0.1.0-alpha.1: original read-only prototype.
- 0.1.0-alpha.2: embedded provider to fix Obsidian loading.
- 0.2.0-alpha.1: optional assignment/schedule updates and completion.
- 0.2.0-alpha.2: optional credential persistence and session restoration.
- 0.3.0-alpha.1: filters/search/sort, organization/resource names, guarded reopen verification, provider registry and Microsoft To Do.

## References

```bibtex
@misc{autotaskTodos,
  author = {{Kaseya}},
  title = {Autotask REST API: CompanyToDos},
  url = {https://autotask.net/help/developerhelp/content/apis/rest/Entities/CompanyToDosEntity.htm},
  urldate = {2026-10-13}
}
@misc{autotaskNotes,
  author = {{Kaseya}},
  title = {Autotask REST API: CompanyNotes},
  url = {https://autotask.net/help/developerhelp/content/apis/rest/Entities/CompanyNotesEntity.htm},
  urldate = {2026-10-13}
}
@misc{autotaskUi,
  author = {{Kaseya}},
  title = {Adding or editing To-dos},
  url = {https://autotask.net/help/Content/3_Features/3_CRM/ToDosNotes/AddEditToDo.htm},
  urldate = {2026-10-13}
}
@misc{microsoftDeviceCode,
  author = {{Microsoft}},
  title = {OAuth 2.0 device authorization grant},
  url = {https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-device-code},
  urldate = {2026-10-13}
}
@misc{microsoftPublicClient,
  author = {{Microsoft}},
  title = {Desktop app that calls web APIs: Code configuration},
  url = {https://learn.microsoft.com/en-us/entra/identity-platform/scenario-desktop-app-configuration},
  urldate = {2026-10-13}
}
@misc{microsoftTaskCreate,
  author = {{Microsoft}},
  title = {Create todoTask: Microsoft Graph v1.0},
  url = {https://learn.microsoft.com/en-us/graph/api/todotasklist-post-tasks?view=graph-rest-1.0},
  urldate = {2026-10-13}
}
@misc{microsoftTaskUpdate,
  author = {{Microsoft}},
  title = {Update todoTask: Microsoft Graph v1.0},
  url = {https://learn.microsoft.com/en-us/graph/api/todotask-update?view=graph-rest-1.0},
  urldate = {2026-10-13}
}
```

## Edit dialog cleanup — 0.3.0-alpha.2

Assigned resource is now a dropdown of active Autotask resources, displaying first and last names. Duplicate names include an ID suffix. API-only accounts are excluded when the resource field metadata exposes their license labels. The API still enforces CRM assignment permissions; an active resource is not automatically eligible for every To-Do. If user-list retrieval fails, the current assignment is retained and schedule edits remain available. Reload users retries the lookup without touching the task.

Start and end use native calendar/time controls with minute precision. The default timezone is the machine's local IANA timezone, shown together with the applicable UTC offset for each selected date. The dropdown can switch both controls to UTC. Timezone conversion is automatic; you do not type offsets into date fields. A timezone display change alone does not update the record, and unchanged fields retain existing seconds and fractional seconds. Invalid dates and local times skipped by clock changes are rejected. Use UTC when selecting a repeated clock-change hour that is ambiguous in local time.

### Additional editable fields

| Field | Assessment |
| --- | --- |
| Name/title | CompanyToDos has no separate title/name field. The visible activity text is activityDescription. A plugin-only display title could be added, but would not create a native Autotask title. |
| Description | API supports activityDescription (up to 32,000 characters). A future explicit editor should disclose potential replacement of rich text/images with plain text. Description editing was deferred at that release; it is supported from 0.5.0-alpha.6. |
| Linked company | companyID is editable in the schema, but related contacts/contracts/opportunities/tickets must belong to the same company. Implement as a separately validated reassociation flow, with a fresh read and readback verification. Use the separate Change company action; destination and link compatibility are checked, and the result is read back. Live parent reassignment still needs tenant verification. |

- 0.3.0-alpha.2: named resource selector, native calendar/time controls, Local/UTC conversion and 49 passing tests. Credential saving and Microsoft To Do are retained.

- 0.3.0-alpha.3: start/end controls use minutes only, per corrected requirement. Hidden seconds are preserved for unchanged dates; an explicitly changed date/time uses zero seconds.

## Company reassociation — 0.3.0-alpha.3

On an open Autotask To-Do card, click **Edit**, then **Change company** in the edit dialog. Search for at least two characters of an active company name, choose the destination, then submit. Results are bounded to 50; refine the search if more matches exist. Current settings, remembered credentials and Graph support are retained.

Before the change, the provider performs a fresh record comparison, checks the companyID field is writable, and confirms that the destination exists and is active. Each linked contact, ticket, contract and opportunity is fetched and must belong to the destination. A linked contact must also be active. The contact rule is deliberately conservative: a parent-company contact exception is not assumed automatically. If any linked record cannot be verified, or belongs to another company, the operation stops and asks you to update that link in Autotask first. No links are silently cleared or remapped.

The change is a separate operation from schedule or assignment edits. It PATCHes the existing source-parent collection (`Companies/{originalCompanyID}/ToDos`) with only the To-Do id and destination companyID. If Autotask rejects cross-parent reassignment, no alternate write or create/delete fallback is attempted. Public field metadata does not prove cross-parent move semantics; this needs a live test with a disposable unlinked To-Do.

Success requires a readback of the original To-Do ID showing the destination company and unchanged contact/ticket/contract/opportunity IDs. An uncertain outcome must be checked in Autotask before another attempt. Fresh checks/readback are not atomic isolation from edits by other users. The internal organization ID zero is supported for company lookup and reassociation.

Acceptance: first test a disposable To-Do with no linked records; confirm its ID is unchanged and its company changes in Autotask. Then test a To-Do linked to a record in its original company; a move to another company should be blocked, with all links retained. If the server rejects the first test, capture the exact error before trying another operation.

This release also removes seconds from start/end input controls. Existing seconds and fractional seconds remain untouched for unchanged date/time fields. Explicitly changed dates use zero seconds. All 56 tests pass.

## Task-card layout — 0.3.0-alpha.4

Change company is available only inside the Autotask Edit dialog. It is no longer a task-card action. If assignment or date changes are pending, save those first; the company action does not discard them. Canceling the company dialog returns to Edit. A successful company change closes the stale edit dialog and refreshes the list.

The first line of each task card is `Open #<Task-ID> · Due: YYYY-MM-DD HH:MM` (or Completed). Due appears once, alongside status and ID. Known timestamps are displayed in the machine's local timezone with 24-hour hours/minutes. Raw API timestamps, seconds, fractions, T and Z suffixes are not shown in date metadata. The underlying records retain their full timestamps. Microsoft task titles are displayed on the next line. Credential saving, provider behavior and validation are unchanged. All 58 tests pass.

## Plugin rename — 0.3.0-alpha.5

The display name is now Task2Do. Obsidian settings and command-palette prefixes use Task2Do. The internal plugin ID and installation directory remain autotask-todo to preserve existing settings, saved credentials, view state and shortcuts. Install into the existing folder and retain data.json. Provider names (Autotask To-Dos and Microsoft To Do) continue identifying their respective backends.

## Internal ID migration — 0.3.0-alpha.6

This release supersedes the earlier decision to retain the legacy plugin ID. The internal ID and installation directory are now **task2do**. No settings schema migration is necessary.

1. Disable the existing Task2Do plugin whose folder is autotask-todo, then quit Obsidian.
2. Extract the new task2do directory into `.obsidian/plugins/`.
3. Copy `.obsidian/plugins/autotask-todo/data.json` to `.obsidian/plugins/task2do/data.json`. Copy the entire file locally; do not paste it into chat or share it. If the source file is absent or credentials were not remembered, enter them once in the new plugin.
4. Restart Obsidian and enable Task2Do. Do not enable both IDs simultaneously.
5. Confirm the zone URL/Resource ID, saved credentials, write setting, Microsoft app configuration/sign-in and sidebar filters are restored.
6. Keep the old folder disabled until verification succeeds. You may then remove it locally.

The data.json copy preserves Autotask credentials, Microsoft access/refresh tokens, application and tenant settings, write/remember preferences and per-view filters. OAuth tokens can still expire or be revoked independently of this migration. Existing view IDs remain registered so workspace panes and their preference keys stay compatible.

Obsidian keyboard shortcuts are stored separately, in `.obsidian/hotkeys.json`. Reassign plugin shortcuts in Obsidian, or while Obsidian is closed make a backup and change the key prefix `autotask-todo:` to `task2do:` for this plugin's entries only. Keep the command suffixes and all assigned keys unchanged. The old community-plugin enable entry should be disabled; enable the new ID through Obsidian settings rather than copying an old manifest over the new release.

## Additional references — 0.4.0-alpha.1

```bibtex
@online{todotxt2026, title={The todo.txt format}, author={todo.txt project}, url={https://github.com/todotxt/todo.txt}, urldate={2026-10-14}}
@online{planner2026, title={Use the Planner REST API}, author={Microsoft}, url={https://learn.microsoft.com/en-us/graph/api/resources/planner-overview?view=graph-rest-1.0}, urldate={2026-10-14}}
@online{tasks2026, title={Getting Started}, author={Obsidian Tasks contributors}, url={https://github.com/obsidian-tasks-group/obsidian-tasks/blob/main/docs/Getting%20Started/Getting%20Started.md}, urldate={2026-10-14}}
@online{todoist2026, title={Set a priority in Todoist}, author={Doist}, url={https://www.todoist.com/help/todoist/features/set-a-priority-in-todoist-Wy82Jp}, urldate={2026-10-14}}
```

```bibtex
@online{plannerCreate2026, title={Create plannerTask}, author={Microsoft}, url={https://learn.microsoft.com/en-us/graph/api/planner-post-tasks?view=graph-rest-1.0}, urldate={2026-10-14}}
```

## Provider references — 0.5.0-alpha.1

```bibtex
@online{moovilaAPI2026, author={Moovila}, title={PublicAPI API v1 Swagger}, url={https://api.moovila.com/PublicAPI/Swagger/index.html}, urldate={2026-10-14}}
@online{openprojectAuth2026, author={OpenProject}, title={API Introduction}, url={https://www.openproject.org/docs/api/introduction/}, urldate={2026-10-14}}
@online{openprojectForms2026, author={OpenProject}, title={Forms}, url={https://www.openproject.org/docs/api/forms/}, urldate={2026-10-14}}
@online{openprojectWorkPackages2026, author={OpenProject}, title={API Work Packages}, url={https://www.openproject.org/docs/api/endpoints/work-packages/}, urldate={2026-10-14}}
@online{openprojectStatuses2026, author={OpenProject}, title={API Statuses}, url={https://www.openproject.org/docs/api/endpoints/statuses/}, urldate={2026-10-14}}
```

```bibtex
@online{autotaskResources2026, author={Kaseya}, title={Autotask REST API: Resources}, url={https://autotask.net/help/developerhelp/content/apis/rest/Entities/ResourcesEntity.htm}, urldate={2026-10-14}}
```

```bibtex
@online{obsidianRelease2026, author={Obsidian}, title={Submit your plugin}, url={https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin}, urldate={2026-10-14}}
@online{obsidianVersions2026, author={Obsidian}, title={Versions}, url={https://docs.obsidian.md/Reference/Versions}, urldate={2026-10-14}}
@online{brat2026, author={TfTHacker}, title={BRAT: Beta Reviewer's Auto-update Tool}, url={https://github.com/TfTHacker/obsidian42-brat}, urldate={2026-10-14}}
```
