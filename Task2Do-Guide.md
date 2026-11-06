---
title: Task2Do — Design, Setup and Operations Guide
description: Complete guide to local-first task management, provider configuration, reviewed publishing, security and recovery.
slug: task2do-guide
author: Laurent OF Fough
type: software-runbook
date-created: 2026-10-14
date-modified: 2026-10-14
date-published: null
source: [Task2Do source code and automated tests, todo.txt project, Obsidian developer documentation, Microsoft Learn, Autotask developer documentation, OpenProject documentation, Moovila PublicAPI]
domain: IT
url: https://github.com/LaurentFough/obsTask2Do
draft: true
tags: [task2do, obsidian, todo-txt, task-management, autotask, microsoft-graph, planner, openproject, moovila]
keywords: [local-first, provider, mapping, preview, synchronization, credentials, configuration, recovery]
plugin-version: 0.8.0-alpha.2
---

# Task2Do Guide

[TOC]

This guide describes **Task2Do 0.8.0-alpha.2**, an alpha desktop plugin for Obsidian. It covers implemented behavior; future work is identified explicitly. Check the version at the top of **Settings → Task2Do** when comparing your installation with this guide.

## 1. Design and operating philosophy

### 1.1 A useful task manager before connecting anything

Task2Do uses **todo.txt as its default local task manager**. You can create, edit, prioritize, organize, complete and search tasks without an account, API key or network connection. Optional providers add access to tasks held in other systems.

Plain text keeps local tasks accessible to editors, scripts, version control and other todo.txt clients. The base format represents one task per line, with conventional priority, project, context and completion syntax. Task2Do adds optional extension tokens for stable identity and richer fields. Other clients may display these extensions rather than interpret them. The [todo.txt format primer](https://github.com/todotxt/todo.txt) is the upstream reference.

### 1.2 Local-first does not mean overwriting every remote system

There are three distinct task surfaces:

| Surface | Role | How changes are applied |
| --- | --- | --- |
| Native local task in todo.txt | Primary record for a standalone task | Local editor/file changes; optional reviewed publishing to Microsoft |
| Provider panel | Direct view of an external system | Explicit provider actions write to that system, subject to its permissions |
| Autotask-imported row in todo.txt | Local working representation with a tracked source | Pull, conflict review and explicit/scheduled updates to existing source/bound destinations |
| Generated Markdown index | Searchable Obsidian snapshot | Rebuilt on provider refresh; edits to its checkboxes do not write back |

A remote provider remains authoritative for access rights, valid assignments, required fields and workflow rules. A local company label cannot grant access to a Planner plan. A cached user name cannot establish identity across tenants.

### 1.3 Why the provider adapters are separate

The providers share panel conventions, filtering, scheduling presentation and registration. Each adapter owns its authentication, endpoints, field validation and write verification. Planner is separate from Microsoft To Do even though they share sign-in: plans, buckets, assignments and ETags differ from personal lists and To Do tasks.

Companies/users stay in JSON catalogs rather than becoming task lines. Explicit mappings bridge Autotask Resource IDs to Entra identities and companies to destination lists/plans/buckets. Local tasks can use task-specific mappings without Autotask catalogs.

### 1.4 Why publishing is previewed and journaled

A push follows **map → preview → submit once → read back → record binding**. The preview names the destination and shows the values to be sent. The engine checks the task, mapping and destination again before writing.

Before a remote write, a durable journal records the intent. Once a counterpart exists, later pushes update its saved remote ID. If a response is lost or verification disagrees with the preview, another creation is blocked until reconciliation. This reduces duplicate creation; it is not a distributed transaction across providers.

Scheduled writes are a separate opt-in. Automatic cycles update already-bound tasks; they do not automatically create counterparts for every local row and do not propagate deletions.

## 2. Installation and upgrades

### 2.1 Requirements

- Obsidian desktop **1.7.2 or later**, on macOS, Linux or Windows. The current manifest is desktop-only; mobile is not supported.
- A writable vault for local task files and optional indexes/state.
- Network access and appropriate provider permissions only for integrations you use.
- No npm install or build step for the packaged plugin.

### 2.2 Install

1. Extract the release ZIP. The archive's `Task2Do/` directory contains the plugin assets, source, tests and this guide.
2. Create `.obsidian/plugins/task2do/` inside your vault.
3. Copy `main.js`, `manifest.json` and `styles.css` into that directory.
4. Enable Task2Do under Obsidian's community plugins. Reload Obsidian if needed.
5. On a fresh installation, select an existing `.txt` task file or create `Task2Do/todo.txt` through the setup dialog.
6. Open **Settings → Task2Do**. Confirm the displayed version.

The settings General pane is the starting point. Provider configuration is separated into **todo.txt**, **Autotask**, **Microsoft To Do**, **Microsoft Planner**, **OpenProject** and **Moovila** panes.

### 2.3 Upgrade

Disable Task2Do, replace the three assets, then re-enable it. Preserve `data.json`, `credentials.enc` when present, your task file and the sync documents. An upgrade retains existing configured task paths; it does not move an existing `todo.txt` into `Task2Do/` automatically.

If migrating an installation that still uses the old `autotask-todo` plugin ID, preserve its settings first and copy its `data.json` into the `task2do` installation before enabling the replacement. Do not run both installations against the same task/state files.

## 3. General settings

### 3.1 Contextual hints

Hover over settings inputs, dropdowns, toggles and action buttons for concise help. Provider connection dialogs use the same hints. Tooltips explain scope and consequences, such as whether an action opens a preview, writes to a source, appends text or reads data.

Task titles, priority/project/context badges, due/status rows and expandable descriptions expose useful context where available. Task-title hints identify supported editor fields, show source/assignee/creator and schedule context, and distinguish read-only providers. They do not turn a static field into an inline editor; use **Edit** to change supported values. **Details** explains how to inspect metadata and raw task lines.

Hints are generated locally from static help and already-loaded task information. They do not request extra provider data on hover. Input hints never include entered credential/token/passphrase values. The Obsidian tooltip API is used when available, with native title fallback and accessible descriptions; visual tooltip behavior can vary with the host/theme.

### 3.2 Settings

| Setting | Purpose and behavior |
| --- | --- |
| Encrypted credential vault | Enable password encryption or unlock an existing credential vault |
| Publish searchable Markdown indexes | Produce provider snapshots on refresh; defaults on for new installs and preserves an existing explicit preference |
| Index folder | Relative, visible vault folder; default `Task2Do` |
| Sync catalog/state folder | Location for catalogs, mappings and write journal; default `Task2Do` |
| Automatic sync | Run cycles while this Obsidian session remains open; defaults off |
| Write updates to already-bound tasks | Separately allow scheduled remote updates; defaults off |
| Sync interval (minutes) | Integer from 5 to 1440; default 15 |
| Open task sync | Open pull, mapping, preview, destination-refresh and reconciliation controls |

A local-only automatic cycle can refresh existing Microsoft bindings without Autotask. If Autotask is connected, a cycle also attempts its pull. A provider error can stop that cycle; inspect the notice and refresh manually before assuming every task was processed. Closing Obsidian stops scheduled work; there is no separate server or background daemon.

Changing the sync folder does not migrate its existing files. A new empty state folder loses knowledge of existing remote bindings and uncertain writes. Preserve or deliberately migrate the complete set before changing this path.

## 4. Task Providers

### 4.1 Provider: todo.txt (Default)

#### 4.1.1 Configure and use

1. Select **todo.txt** in Task2Do settings.
2. Use **Select or create task file** to choose an existing visible `.txt` file or enter a relative path. An existing-file dropdown appears when suitable files are available.
3. Use `Task2Do/todo.txt` if the file is in the vault's `Task2Do` folder. Paths are relative to the vault, not to the plugin's installation directory.
4. Click **Open todo.txt tasks**, or use the ribbon after setup.
5. Use **New task** for structured editing. The panel's **Task file** control reopens setup; **Providers** opens the other panels.

Absolute paths, traversal such as `../`, and hidden configuration folders are rejected. The plugin does not overwrite an existing file when selecting it.

#### 4.1.2 Fields and views

The editor provides title, multiline description, priority A–Z, created/start/due dates, projects and contexts. A is conventionally the highest priority. Project/context names accept spaces or commas as separators; individual names cannot contain spaces. Advanced raw-line editing is optional and must retain the task UID.

| View | Included tasks |
| --- | --- |
| Inbox | Open tasks without a due date, unless their start is in the future |
| Today | Open tasks due today/overdue, or starting today |
| Upcoming | Open tasks with a future deadline or future start |
| Completed | Completed tasks |
| All tasks | Open and completed tasks, subject to the state/search filters |

State filters, search and due-date sorting are saved per panel. Undated tasks sort after dated tasks. Dates use the computer's local calendar; changing the machine timezone can change local date boundaries. Date-only deadlines publish as that local day's end. Imported exact timestamps are retained in metadata; displayed controls use dates or minute precision as appropriate.

#### 4.1.3 Format and identity

A basic line is compatible with ordinary todo.txt syntax:

>```text
>(A) 2026-10-14 Call client +Work @phone due:2026-10-18
>```

When opened by Task2Do, non-empty rows receive unique `uid:` extensions. Structured editing can add `titleEnd:1`, percent-encoded `details:`, `t:` start dates and other extensions. Exact remote times can use `startDateTime:` / `endDateTime:`. Completed tasks begin with `x` and a completion date; priorities can be retained as `pri:` when completed.

UIDs identify tasks independently of line position or repeated names. Do not copy a full identified line to make a new task without giving the copy a new identity. The plugin blocks duplicate/invalid IDs. Creating a task through its UI assigns a fresh UUID.

Identity assignment preserves task text, unknown fields, BOM, blank lines and existing line endings. Structured edits preserve unknown extension tokens, including duplicates, while normalizing fields owned by the editor. Other clients must preserve optional metadata if you want descriptions and remote bindings to remain usable.

External edits trigger a panel refresh. An editor opened before an external change is stale and cannot overwrite the file. Refresh and reopen it. If a bound file is renamed, the original file namespace is still recorded in sync state; restore the original path or deliberately reconcile the migration rather than treating the renamed file as a new source.

### 4.2 Provider: Autotask

#### 4.2.1 What it manages

This provider manages **CRM CompanyToDos**, associated with a company and assigned to a resource. These are different from project `Tasks`, tickets and CompanyNotes. The first line of `activityDescription` functions as the displayed task name; Autotask has no separate title field exposed by this provider. Renaming edits that description.

The supported actions include retrieval, creation, description/assignment/schedule edits, validated company change, completion, guarded reopening, and a timestamped text note appended to the description. Note is not a native threaded comment. Native To-Do attachment handling is not implemented.

#### 4.2.2 Configure

| Field | What to enter |
| --- | --- |
| Autotask zone REST URL | Your actual official zone, e.g. `https://webservices4.autotask.net/atservicesrest/v1.0/` |
| Assigned Resource ID | The human/user resource whose assigned tasks you want to view |
| Creator Resource ID (optional) | Human creator identity for delegated tasks; blank uses Assigned Resource ID |
| API user Resource ID (optional) | Numeric API account Resource ID; blank attempts resolution from the connected API username |
| Remember credentials | Retain credentials and restore the connection after restart |
| Enable To-Do updates | Required for creation and writes, including scheduled source updates |

1. Have an Autotask administrator provision a dedicated API user and appropriate CRM/resource/company access.
2. Obtain its username, secret and integration tracking code.
3. Enter the zone and resource fields in the **Autotask** pane, then click **Connect Autotask**.
4. Enter all three credential values in Connect. Choose whether to remember them.
5. Open the task panel and confirm the returned names and tasks before enabling writes.

The example zone is not auto-discovery. Use the zone assigned to your account. Resource IDs and API user credentials serve different purposes; do not substitute the API user's ID for the human resource merely to make the query return data.

**My Tasks** contains assigned items, including tasks you created for yourself. **Delegated by Me** includes tasks created by the configured human/API creator identities and assigned elsewhere. **All Tasks** combines the scopes without duplicating self-assigned tasks. Creator attribution reflects what Autotask stored; it is not inferred from the assignee.

If a task is missing, use **Check task by ID**, clear search/state filters and inspect creator/assignee IDs. Restricted Resources access may prevent automatic API-user resolution; enter its explicit ID when appropriate.

#### 4.2.3 Write behavior

Assignments use named resource choices. Start/end controls use calendar/time inputs with local/UTC conversion and minute precision. Existing hidden seconds are retained for unchanged fields. Creation requires a company, assignee, action type and start/end schedule.

**Change company** is inside Edit. Save pending edits before changing the company; linked-record and company checks can reject reassociation. Completion is verified by readback. Reopening requires compatible field metadata and a verified cleared completion date; tenant/API behavior may reject it. Do not assume metadata alone guarantees successful reopening. See the official [CompanyToDos entity reference](https://autotask.net/help/developerhelp/content/apis/rest/entities/CompanyToDosEntity.htm).

### 4.3 Provider: Microsoft To Do

#### 4.3.1 Register the public client

Use an Entra app registration you control. For a single organization, a single-tenant registration and its tenant ID are the clearest starting point. Personal-account use requires a registration configured for the corresponding account audience.

1. In Microsoft Entra app registrations, create the application and record its **Application (client) ID** and tenant ID.
2. Enable **Allow public client flows** in Authentication. Task2Do uses device authorization; it does not require a client secret or a redirect callback.
3. Configure delegated Microsoft Graph `Tasks.ReadWrite`. The plugin also requests `offline_access` for refresh tokens.
4. Obtain administrator consent when your tenant policy requires it. Consent does not bypass Conditional Access.

These steps follow Microsoft's [public-client configuration](https://learn.microsoft.com/en-us/entra/identity-platform/scenario-desktop-app-configuration) and [device authorization flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-device-code) documentation. The implementation is interactive delegated sign-in, not application-only/client-credentials authentication.

#### 4.3.2 Connect

In **Microsoft To Do**, enter the client ID and tenant ID/domain. `common`, `organizations` and `consumers` are accepted aliases, but must match the app's audience and the account you intend to use. Choose whether to remember Microsoft sign-in, then select **Sign in to Microsoft**. Open the displayed Microsoft URL, enter the code and complete consent.

Use the provider panel to select lists and create/edit tasks, including title, description and deadline. Completion/reopening are supported. Small file attachments can be uploaded from visible vault paths; uploads must be below 3 MB. Downloads go into the sync folder's `Attachments` directory, refuse overwrites, and have a 10 MB client limit.

Task2Do currently targets Microsoft's global public cloud endpoints. Sovereign clouds, account switching, recurrence/checklist editing and full mailbox-style To Do features are outside this implementation. Microsoft To Do destinations belong to the signed-in account; they cannot retain another user's Autotask assignment.

### 4.4 Provider: Microsoft Planner

Planner shares Microsoft To Do's client, tenant, tokens and consent. Configure those values in the **Microsoft To Do** pane. Forgetting the Microsoft sign-in disconnects both providers.

1. Use a work/school account with access to the intended **basic, group-owned** plans.
2. In **Microsoft Planner**, enter plan IDs separated by commas, whitespace or newlines. Use exact plan IDs, not plan titles, task IDs or full URLs. Obtain them from the plan's link where exposed or from an administrator/API lookup.
3. Add delegated `GroupMember.Read.All` to the app's approved permissions for group-member selection. Its delegated permission requires administrator consent according to Microsoft's permissions reference.
4. Sign in again after configuring plans so the requested scopes include group membership access.
5. Open Planner tasks and verify plan, bucket and assignee choices with a disposable task.

Task2Do supports task title, description, start/deadline, bucket, assignments, completion and reopening. The editor can preserve existing multiple assignments; choosing a replacement user replaces that assignment set. Planner task fields and task-description details use separate ETags. A remote concurrent change requires refresh. Premium plans are not exposed by this Graph Planner API, as documented by [Microsoft](https://learn.microsoft.com/en-us/graph/api/resources/planner-overview?view=graph-rest-1.0).

The current adapter requires configured plan IDs and group-backed membership. It does not discover every possible plan/container. Planner labels, checklist editing, reference/attachment editing and plan creation are not implemented. Some directory permissions expose member IDs with limited profile information; names/email may fall back to IDs. Do not grant broad directory permissions merely to work around an unexplained error; check the [group-member API permissions](https://learn.microsoft.com/en-us/graph/api/group-list-members?view=graph-rest-1.0) and tenant consent first.

### 4.5 Provider: OpenProject

OpenProject supports cloud and self-hosted HTTPS installations, including installation subpaths. It works with API v3 work packages and uses the user's API token with Basic authentication (`apikey` as the literal username internally). API keys are generated through the account's access-token settings; instance administrators can restrict token creation. See [OpenProject authentication](https://www.openproject.org/docs/api/introduction/) and [access tokens](https://www.openproject.org/docs/user-guide/account-settings/access-tokens/).

1. In the **OpenProject** pane, select **Connect OpenProject**.
2. Enter the final HTTPS instance URL, e.g. `https://projects.example.org` or `https://projects.example.org/openproject`.
3. Enter the API key. Optionally enter a numeric Project ID; blank lists all accessible work packages.
4. For a private CA or self-signed deployment, paste the administrator-provided **public CA chain or public server certificate** in PEM format. Leave it blank for ordinary public certificate trust.
5. Choose **Enable OpenProject writes** and **Remember connection credentials** as appropriate, then Connect.

Custom trust applies only to the configured instance origin. Hostname and validity verification remain enabled; there is no global insecure-TLS switch. Do not paste a private key. A hostname mismatch is not fixed by trusting the certificate: use the correct DNS name/certificate. Requests do not follow redirects; enter the final URL. The desktop HTTPS transport does not implement a configurable HTTP proxy.

Creation/editing use server forms, allowed values and optimistic lock versions. Completing/reopening selects an allowed workflow status rather than assuming every project uses the same status IDs. Required custom fields or project-specific forms outside the implemented editor may block creation. On-premises connectivity/VPN/DNS must already work from the machine running Obsidian.

Direct provider operations remain available. Cross-provider publishing/sync into OpenProject is deferred ahead of further Moovila integration work.

### 4.6 Provider: Moovila

This adapter reads the published PublicAPI Report endpoints. It is **read-only** in this release.

1. Obtain a valid bearer access token through your vendor-approved Moovila integration. Task2Do does not provide a full vendor OAuth onboarding or automatic token refresh.
2. Open **Moovila → Connect Moovila**.
3. Use `https://api.moovila.com` and enter the bearer token.
4. Optionally remember the credential, then Connect and verify accessible projects/tasks.

The adapter restricts the host to the supported public API origin. It displays project/task names, available assignee information, dates and completion. HTTP 401 means the token expired or was rejected; reconnect with a valid token. Creation, updates, comments, attachments and cross-sync are not supported. The vendor's [PublicAPI Swagger](https://api.moovila.com/PublicAPI/Swagger/index.html) is the integration reference; access/onboarding details should be confirmed with Moovila.

## 5. Mapping, publishing and synchronization

### 5.1 Publish a native local task

1. Connect Microsoft To Do or Planner; Autotask is not required.
2. In todo.txt, click **Publish…**.
3. Choose a provider and named destination. Planner additionally requires a bucket and optionally a group-member assignment.
4. Save the reviewed mapping, build the preview, inspect the values and push.
5. Confirm the counterpart in its source application. Later pushes update the saved binding.

Local descriptions remain distinct from local titles when published. Priority/projects/contexts and provider-specific attributes without a supported mapping stay local. A task-specific mapping does not create a company/user directory in Microsoft.

### 5.2 Import and publish Autotask tasks

1. Connect Autotask and open **Task Sync**.
2. **Pull Autotask** imports the configured assigned/created scope, companies and users.
3. Use **Mappings** to review company-to-list/plan/bucket and resource-to-Entra mappings.
4. Preview selected pushes. IDs from different providers are not interchangeable; identical display names are not identity proof.
5. For Microsoft To Do, explicitly accept personal-list ownership when publishing a task assigned to another resource, or use Planner to retain a mapped user assignment.

Autotask source account/instance identity is retained. Imported descriptions preserve the full source text. Existing source updates are available through **Push local to Autotask** when writes are enabled; company reassociation stays in Autotask Edit. New native-local-task creation in Autotask is not implemented by this sync workflow, even though direct Autotask creation is supported in its panel.

### 5.3 Bring back changes and resolve conflicts

**Refresh destinations** compares remote snapshots with the last verified values. Non-conflicting edits merge into local rows. Competing edits remain visible for review. Changed Planner assignment/bucket mappings require explicit review instead of silently applying a guessed mapping.

Use **Keep local values**, **Use destination values** or **Use Autotask values** only after inspecting the versions shown. Options depend on the task's origin and conflict type. Multiple conflicting destinations may require keeping local values and reviewing mappings separately.

For an uncertain creation, inspect the remote service before doing anything else. If the counterpart exists, use **Reconcile [provider]** with its existing task and list/plan IDs. Binding acknowledges that counterpart; it does not create another. If no counterpart can be established, investigate the journal and provider before resetting anything. Do not delete sync state merely to enable a retry.

### 5.4 Automatic operation

Enable **Automatic sync** only after manual operations work. Enable **Write updates to already-bound tasks** separately if remote updates are desired. Autotask's own write switch must also be enabled for source writes. Only bound tasks are considered for scheduled writes. Local deletion is not propagated to remote deletion, and remote disappearance is not treated as proof of an intentional delete.

Concurrent Obsidian instances should not write the same task/state files. Optimistic local checks and remote guards detect many conflicts, but do not provide distributed locking between vault-sync clients. Pause automatic writes during migrations and restore a consistent backup when recovering.

## 6. Search, Tasks and Dataview

Indexes are ordinary Markdown notes under the configured index folder, one per refreshed provider. Local `todo.txt` is not itself a Markdown task note. Its generated `todotxt.md` exposes readable task text, description, completion, deadline and inline metadata including stable `remote_id`.

Search a task title with Obsidian Search. For the Tasks plugin, enable compatible task recognition/global filter (`#task` is emitted), then use a query such as:

```tasks
not done
path includes Task2Do
```

For Dataview:

```dataview
TASK FROM "Task2Do"
WHERE !completed
```

Adapt paths to your index folder. These are index queries, not live API queries. Refresh the relevant Task2Do panel to update its snapshot. An existing user-owned Markdown note is not overwritten as an index. Checkbox edits in generated notes are overwritten on refresh and never trigger provider actions.

## 7. Credentials, files and backups

| File/location | Contents | Backup considerations |
| --- | --- | --- |
| `.obsidian/plugins/task2do/data.json` | Configuration and optionally plaintext saved secrets | Preserve on upgrades; inspect vault-sync policy |
| `.obsidian/plugins/task2do/credentials.enc` | Password-encrypted remembered secrets, if enabled | Retain with its passphrase; passphrase is not saved |
| Configured todo.txt file | Tasks, UUIDs, optional descriptions/source metadata | Keep stable IDs and relative path |
| `catalogs.json` in sync folder | Company/resource cache | Contains organizational data; not encrypted by credential encryption |
| `mappings.json` in sync folder | Reviewed identities/destinations | Retain with the task file |
| `sync-state.json` in sync folder | Source/destination baselines, IDs, uncertain write intents | Essential to duplicate prevention and recovery |
| Provider Markdown indexes | Readable generated snapshots | Rebuildable; can contain task/customer information |
| Sync-folder `Attachments/` | Downloaded To Do files | Normal vault data, not encrypted by credential encryption |

The optional credential vault uses PBKDF2-SHA256 (310,000 iterations) and AES-256-GCM. Its passphrase must be at least 12 characters. Unlock after startup/reload. It is portable password encryption, not an OS keychain; unlocked secrets remain in process memory. Task and catalog/index content is not encrypted by this feature.

Encryption migration saves and verifies encrypted secrets before saving public settings without those secrets. Old backups or synced historical versions of data.json can still contain prior plaintext credentials. Provider “remember” switches determine which credentials are retained; forgetting removes the current saved value, not historical backups or server-issued credentials.

If the passphrase is lost, the encrypted secrets cannot be recovered. Preserve a backup, disable the plugin, change only `encryptCredentials` to `false` in data.json, and move the inaccessible credentials.enc aside before re-enabling and re-entering credentials. Do not replace the entire settings file with a one-field JSON object. You can then enable a new encrypted credential vault. This resets credential storage, not remote task bindings.

Back up the task file, mappings and state together. Local multi-file sync writes are not one atomic database transaction. An interrupted save can require orphan/conflict review. Restoring only an old state file while retaining new remote tasks can reintroduce duplicate risk.

## 8. Troubleshooting and acceptance checks

| Symptom | Check/action |
| --- | --- |
| Plugin fails to load | Correct installation folder/assets, desktop host version, reload, developer console |
| Version differs from expected | Confirm all three assets were replaced and reload; settings shows installed manifest version |
| Task file missing | Use todo.txt → Select or create task file; restore bound tasks' original relative path when applicable |
| Duplicate/invalid UID | Find copied/corrupted uid: tokens; resolve deliberately before retrying |
| File changed / stale editor | Refresh and reopen; do not discard external edits |
| Index missing/stale | General index switch/folder, provider refresh, file ownership notice |
| Autotask read-only | Enable To-Do updates; verify API user permissions |
| Autotask missing created task | Actual human/API creator IDs, resource access, filters, Check task by ID |
| Microsoft device sign-in fails | Correct client/tenant/audience, public-client flow, consent, tenant device-code policy |
| Planner missing/403 | Basic group-owned plan ID, membership, Tasks.ReadWrite and GroupMember.Read.All consent; sign in again |
| Planner member names missing | Directory limited-information behavior; IDs may remain selectable |
| OpenProject TLS error | Correct hostname, certificate validity, public PEM CA/server certificate, final HTTPS URL |
| OpenProject creation rejected | Form-required fields, writable allowed values, project/workflow permissions, custom-field limitation |
| Moovila 401 | Obtain a fresh approved bearer token; refresh is manual |
| Push needs review | Inspect source/destination and reconcile known existing IDs; do not repeatedly create |
| Scheduled updates do nothing | Obsidian open, credentials unlocked, automatic and write toggles, bound records, provider connection and conflict notices |

Logs use structured `[Task2Do]` events in Obsidian's developer console. This release does not provide dedicated log-file or syslog configuration. Request logs omit credentials and task text; notices can contain useful source IDs and errors. Redact customer/task information before sharing screenshots or logs.

Before using scheduled writes, validate a disposable local task, a disposable task in each connected provider, a repeated push, a remote-only edit, a competing edit and recovery from a failed/uncertain write. Verify changes directly in the provider. Automated host mocks and API fixtures do not establish that your tenant, roles, certificates or project forms permit every operation.

## 9. Updates, development and current limits

The release contains the source modules and tests. Developers can run:

```sh
npm run build
npm run check
npm test
npm run release
```

The build embeds providers into main.js. Release preparation emits standard assets and an appcast JSON with hashes and exact-version GitHub URLs. The GitHub workflow expects a tag exactly matching the manifest version, without a `v` prefix. Alpha versions are prereleases.

BRAT can serve as the external updater once GitHub releases are published. It uses GitHub releases, not this custom appcast. Task2Do has no built-in appcast installer/poller, and publishing an appcast alone does not enable native Obsidian updates. At packaging time, this project's GitHub Contents-write connection was blocked; no new remote release was published.

Remaining work includes live provider acceptance testing, richer Planner fields, native local-task publishing into additional providers, verified native Autotask comment/attachment APIs, and deliberate file/state migration tooling. Further OpenProject integration precedes further Moovila integration. Do not treat these as implemented features.

## 10. References

Implementation details in this guide come from the versioned Task2Do source and tests. Provider requirements use the primary references below. Vendor APIs, tenant policies and licensing can change; check the linked current documentation when onboarding.

```bibtex
@software{task2do080,
  author = {Laurent OF Fough},
  title = {Task2Do},
  version = {0.8.0-alpha.2},
  url = {https://github.com/LaurentFough/obsTask2Do},
  note = {Local release; remote publication pending}
}
@online{todotxtFormat,
  author = {{todo.txt project}},
  title = {todo.txt format primer},
  url = {https://github.com/todotxt/todo.txt},
  urldate = {2026-10-14}
}
@online{obsidianTooltipApi,
  author = {{Obsidian}},
  title = {Public API type declarations: setTooltip},
  url = {https://github.com/obsidianmd/obsidian-api/blob/master/obsidian.d.ts},
  urldate = {2026-10-14}
}
@online{obsidianPlugins,
  author = {{Obsidian}},
  title = {Developer Documentation: Plugins},
  url = {https://docs.obsidian.md/Plugins},
  urldate = {2026-10-14}
}
@online{autotaskCompanyToDos,
  author = {{Kaseya}},
  title = {Autotask REST API: CompanyToDos},
  url = {https://autotask.net/help/developerhelp/content/apis/rest/entities/CompanyToDosEntity.htm},
  urldate = {2026-10-14}
}
@online{microsoftDeviceCode,
  author = {{Microsoft}},
  title = {Microsoft identity platform: OAuth 2.0 device authorization grant flow},
  url = {https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-device-code},
  urldate = {2026-10-14}
}
@online{microsoftPublicClient,
  author = {{Microsoft}},
  title = {Desktop app that calls web APIs: Configuration},
  url = {https://learn.microsoft.com/en-us/entra/identity-platform/scenario-desktop-app-configuration},
  urldate = {2026-10-14}
}
@online{microsoftPermissions,
  author = {{Microsoft}},
  title = {Microsoft Graph permissions reference},
  url = {https://learn.microsoft.com/en-us/graph/permissions-reference},
  urldate = {2026-10-14}
}
@online{microsoftPlanner,
  author = {{Microsoft}},
  title = {Use the Planner REST API},
  url = {https://learn.microsoft.com/en-us/graph/api/resources/planner-overview?view=graph-rest-1.0},
  urldate = {2026-10-14}
}
@online{microsoftGroupMembers,
  author = {{Microsoft}},
  title = {List group members},
  url = {https://learn.microsoft.com/en-us/graph/api/group-list-members?view=graph-rest-1.0},
  urldate = {2026-10-14}
}
@online{openprojectApi,
  author = {{OpenProject}},
  title = {API introduction},
  url = {https://www.openproject.org/docs/api/introduction/},
  urldate = {2026-10-14}
}
@online{openprojectTokens,
  author = {{OpenProject}},
  title = {Access tokens},
  url = {https://www.openproject.org/docs/user-guide/account-settings/access-tokens/},
  urldate = {2026-10-14}
}
@online{moovilaPublicApi,
  author = {{Moovila}},
  title = {PublicAPI Swagger},
  url = {https://api.moovila.com/PublicAPI/Swagger/index.html},
  urldate = {2026-10-14},
  note = {Interactive reference; token onboarding must be confirmed with vendor}
}
@online{brat,
  author = {TfTHacker},
  title = {BRAT: Beta Reviewer's Auto-update Tool},
  url = {https://github.com/TfTHacker/obsidian42-brat},
  urldate = {2026-10-14}
}
```
