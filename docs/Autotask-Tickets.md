---
title: Task2Do — Autotask Tickets Preview
description: Setup, behavior, limits and merge instructions for the first Service Desk ticket integration.
slug: task2do-autotask-tickets
author: LaurentFough
type: software-runbook
date-created: 2026-11-06
date-modified: 2026-11-06
date-published: null
source: [Task2Do tickets.cjs and tests, Autotask Tickets documentation, Autotask TicketNotes documentation, Autotask entityInformation documentation]
domain: IT
url: https://github.com/LaurentFough/obsTask2Do
draft: true
tags: [task2do, obsidian, autotask, tickets, preview]
keywords: [Service Desk, status, priority, notes, visibility, reconciliation, handoff]
plugin-version: 0.9.0-alpha.4
baseline-version: 0.8.0-alpha.2
---

# Autotask Tickets preview

This preview adds Service Desk Tickets as a separate provider (`autotask-tickets`) alongside CRM To-Dos (`autotask-todo`). It shares the configured API connection, credentials and human Assigned Resource ID. Its own write switch defaults off. No additional credential copy is saved.

The implementation is on `feature/autotask-tickets-merge`, based on the owner's updated `main` commit `2bdac131f0a9765e7dce74b7b3fbb320b1bf7403`. The original preview came from baseline `0.8.0-alpha.2`; the owner's subsequent labels and both Guide files have now been reconciled and retained.

## Setup and first read

1. Install/reload the preview assets in `.obsidian/plugins/task2do`, preserving data.json, credentials.enc and task/state files.
2. Configure or unlock the existing **Autotask** connection. Confirm the zone REST URL and the human Assigned Resource ID. The API user must have Service Desk ticket permissions.
3. Run **Task2Do: Open Autotask Tickets**, or select **Autotask Tickets** from Providers.
4. Verify ticket numbers, company, assignee, status, priority, queue and dates against Autotask. Retrieval covers **primary assignments** for that configured resource. Secondary-resource assignments and delegated/creator scopes are not included.
5. Use the status, priority and queue dropdowns to filter the retrieved list, plus the existing state/search/due-sort controls. Search includes the human ticket number, title, description, names and ticket metadata. Queue filters do not retrieve other resources' queues or tickets.

The panel queries all matching primary assignments with pagination and refuses incomplete/cyclic results. Historical assignments can make the first load slow in a large tenant. It does not cache or preload the full ticket-note history; notes are loaded on demand.

## Completion classification

The **Autotask Tickets** settings pane has an optional **Completed ticket status IDs** field. Configure the numeric IDs your organization considers completed, separated by commas or whitespace. Hover the ticket's status/priority details to see its current IDs and labels.

If no IDs are configured, the panel uses the ticket's completion timestamp for its open/completed presentation. Named status labels remain visible independently. No fixed status ID, English label or translation is treated as authoritative. Use All states and the explicit status filter if your workflow's classification has not yet been configured.

## Enable updates

Enable **Autotask Tickets → Enable ticket updates** after validating reads. This switch is independent of **Enable To-Do updates**; enabling CRM writes alone does not enable ticket writes.

**Update ticket** edits title, due date/time, status and priority. Calendar inputs use the local timezone and hours/minutes; unchanged date precision is preserved. Changed dates are sent in UTC. Due-date clearing is not supported. Title and description lengths and writability are checked against tenant metadata and documented limits (255 and 8,000 characters respectively).

**Replace ticket description** is optional. It reveals the plain-text editor and a separate acceptance toggle for losing formatting and embedded images. Unchanged descriptions are never sent. Changed descriptions require acceptance in both the UI and provider layer; use native ticket notes if replacement is inappropriate.

**Change ticket assignment** loads active named resources, active service-desk roles and queue memberships. Choose the resource, role and queue explicitly. The provider revalidates these against fresh catalogs and checks secondary assignments before writing. This editor conservatively requires the selected queue to belong to the resource. It does not remove a secondary assignment or support unassigning the primary resource/role/queue. Missing catalog permissions block reassignment without blocking unrelated text/status edits. Role changes can affect billing rates; reassignment can change co-managed behavior under Autotask rules. A ticket reassigned away from the configured resource leaves this list after refresh.

Saving sends only changed supported fields with the ticket ID, checks the source snapshot again after catalog lookups, and verifies readback. Company, resolution, billing fields and existing notes are not sent. Failed or uncertain writes are not automatically retried; inspect Autotask and refresh before another attempt.

To close or reopen a ticket, choose the appropriate tenant status rather than expecting a universal Complete/Reopen transition. Autotask still enforces permissions and required fields. A workflow requiring a resolution, work type or other unsupported field may reject the minimal update; complete that operation in Autotask.

The vendor documents that ticket API updates can overwrite rich-text fields with plain text and that API completion can bypass incomplete Important checklist items. Description replacement is opt-in; review checklist/workflow requirements in Autotask before selecting a completion status. The fresh comparison is optimistic protection, not a server-side conditional transaction. If an update fails or its readback differs, inspect the source and refresh before submitting again.

## Native ticket notes

**Ticket notes** reads the ticket's native notes and displays their IDs, creation time, title, description and visibility. Creating a note additionally requires enabled ticket writes.

1. Enter a note title and text. The preview always requires a title to accommodate ticket-category title requirements.
2. Explicitly select a **Note type** and **Note visibility** from the tenant's metadata. Neither is preselected.
3. Review visibility and workflow implications. A public/customer-visible choice is not the same as an internal note; tenant workflows may notify people or change the ticket.
4. Select **Add ticket note** once, then verify it directly in Autotask.

The writer uses the ticket's Notes child collection and verifies the created note identity/content. It does not impersonate a contact or resource and does not edit prior notes. New notes are attributed according to the connected API account and server policy. The tenant's precise endpoint, fields and permission behavior still need live acceptance testing against its Swagger/API.

### Uncertain outcomes and reconciliation

Before a note POST, `ticket-note-journal.json` records an intent in the configured sync/state folder. It contains source/ticket identity, a SHA-256 content fingerprint, timestamps, outcome and any accepted note ID; it does not store the note body or credentials. The journal is ordinary vault data, not part of credential encryption.

If a response is lost or verification fails, another note creation for that ticket is blocked, including after restarting the plugin. Close/reopen Ticket notes, inspect Autotask, and enter the existing note ID under **Reconcile ticket note**. The adapter verifies the ticket and recorded content fingerprint before clearing the block. It does not issue another POST during reconciliation.

A matching fingerprint alone is not proof of which of several identical notes was the original request; the operator must inspect and select the actual note. If no matching note can be established, investigate the provider outcome and journal before any deliberate reset. Do not delete the journal just to enable another creation attempt. Back it up with the existing task/state documents. Changing the sync folder does not migrate it.

## Current limits

| Included | Deferred |
| --- | --- |
| Primary-assigned tickets and company/resource display names | Secondary assignments, all-queue and delegated scopes |
| Ticket-number search, state/status/priority/queue filters, due sorting | Server-side full-tenant search or custom query builder |
| Title, explicit plain-text description replacement, due date, status/priority and validated primary reassignment | Creation, company editing, unassignment and broader web-app parity |
| Native note retrieval and journaled creation/reconciliation | Existing-note edits, attachments and time entries |
| Optional Markdown snapshot on panel refresh | Ticket import into todo.txt, publishing and scheduled cross-sync |

No live Autotask request was made with the owner's credentials while building this preview. Automated fixtures and host mocks validate the implementation, not your Service Desk permissions or workflow. Start with disposable tickets and internal-only notes before operational use.

## Original integration history and publication

Version **0.9.0-alpha.2** merges the ticket integration onto the owner's supplied repository history at `2bdac131f0a9765e7dce74b7b3fbb320b1bf7403`. The earlier preview used the saved 0.8.0-alpha.2 baseline; the updated source was subsequently supplied on GitHub main. Existing labels, capitalization and both Guide files are preserved. Their ticket sections link to this addendum.

The branch is `feature/autotask-tickets-merge`. Review its changes before merging. No unrelated history or existing tag is replaced. A local alpha package can be tested while GitHub review/publication is pending.

The current release workflow uses the manifest version (**0.9.0-alpha.4**) by default for manual runs; exact-version tag pushes remain supported without a v prefix. Creating a review branch does not itself publish a release; appcast URLs remain prepared asset locations until the release workflow uploads the assets.

Validation commands:

```sh
npm run build
npm run check
npm test
npm run release
git diff --check
```

The merged source passes **174 automated tests**. Live Autotask tenant/Swagger acceptance testing remains pending. Retain credentials, task files and note/sync journals when installing assets. Do not replace an unrelated updated checkout with the complete package.

## References

```bibtex
@online{autotaskTickets2026,
  author = {{Kaseya}},
  title = {Autotask REST API: Tickets},
  url = {https://www.autotask.net/help/developerhelp/content/apis/REST/Entities/TicketsEntity.htm},
  urldate = {2026-11-06}
}
@online{autotaskTicketNotes2026,
  author = {{Kaseya}},
  title = {Autotask REST API: TicketNotes},
  url = {https://autotask.net/help/developerhelp/content/apis/rest/Entities/TicketNotesEntity.htm},
  urldate = {2026-11-06}
}
@online{autotaskFields2026,
  author = {{Kaseya}},
  title = {The entityInformation REST API call},
  url = {https://www.autotask.net/help/Developerhelp/Content/APIs/REST/API_Calls/REST_EntityInformationCall.htm},
  urldate = {2026-11-06}
}
@online{autotaskSwagger2026,
  author = {{Kaseya}},
  title = {Using Swagger UI to explore REST API requests},
  url = {https://autotask.net/help/developerhelp/content/apis/rest/General_Topics/REST_Swagger_UI.htm},
  urldate = {2026-11-06}
}
```

## Editor acceptance checklist

Use disposable tickets to check: title-only updates preserve rich text; changed due times agree with Autotask after local/UTC conversion; unchanged timestamps retain precision; description replacement requires explicit acceptance; reassignment offers active named resources and valid roles/queues; secondary-resource collisions refuse writes; reassigned tickets disappear from the primary-assigned panel as expected. Test API permissions, work-type requirements and tenant workflows before operational use. Live tenant validation remains pending.

```bibtex
@online{autotaskServiceDeskRoles2026, author={Kaseya}, title={ResourceServiceDeskRoles}, url={https://www.autotask.net/help/developerhelp/content/apis/REST/Entities/ResourceServiceDeskRolesEntity.htm}, urldate={2026-11-06}}
@online{autotaskResourceQueues2026, author={Kaseya}, title={ResourceRoleQueues}, url={https://www.autotask.net/help/developerhelp/content/apis/REST/Entities/ResourceRoleQueuesEntity.htm}, urldate={2026-11-06}}
@online{autotaskTicketSecondary2026, author={Kaseya}, title={TicketSecondaryResources}, url={https://www.autotask.net/help/developerhelp/content/apis/REST/Entities/TicketSecondaryResourcesEntity.htm}, urldate={2026-11-06}}
```
