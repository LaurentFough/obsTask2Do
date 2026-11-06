'use strict';
/**= Version 0.9.0-alpha.2. Reusable, plain-text help for local UI controls. */
const FIELD_HINTS = Object.freeze({
  'Autotask Zone REST URL':'Use the official REST URL for your Autotask Zone, ending /atservicesrest/v1.0/. The example zone is not auto-discovery.',
  'Assigned Resource ID':'The human resource whose assigned tasks should be listed; this is normally different from the API account.',
  'Creator Resource ID (optional)':'Your human Autotask Resource ID for delegated tasks. Blank uses Assigned Resource ID.',
  'API user Resource ID (optional)':'Include tasks created by the API account. Blank attempts username-based resource lookup.',
  'Remember credentials':'Retain the current connection credentials for restart. General → Encrypted credential vault protects saved secrets.',
  'Enable ticket updates':'Separately allow native ticket notes and status/priority changes. The CRM To-Do write switch does not enable ticket writes.',
  'Completed ticket status IDs':'Optional tenant-specific completed statuses. Blank uses the completion timestamp; hover ticket status details to see IDs.',
  'Enable To-Do updates':'Allow Autotask creation and explicit/scheduled updates. Enabling this does not itself modify any task.',
  'todo.txt path':'Vault-relative .txt path, for example Task2Do/todo.txt. Selecting a different path does not move the previous file or its bindings.',
  'Task file':'Choose a visible vault-relative .txt file. Existing tasks are retained and receive stable uid: tokens.',
  'Publish searchable Markdown indexes':'Generate searchable task snapshots on provider refresh. Editing their checkboxes does not update the source.',
  'Index folder':'Visible vault-relative folder for generated Markdown snapshots. User-owned notes are not overwritten.',
  'Sync catalog/state folder':'Stores catalogs, reviewed mappings and the write journal. Changing this path does not migrate existing bindings.',
  'Automatic sync':'Run sync cycles while Obsidian is open. New destination tasks still require a reviewed manual push.',
  'Write updates to already-bound tasks':'Separately allow scheduled updates to existing counterparts. Never creates unbound tasks or propagates deletions.',
  'Sync interval (minutes)':'Whole minutes from 5 to 1440. Cycles stop when Obsidian closes or encrypted credentials are locked.',
  'Entra application client ID':'Application (client) ID of your public-client Entra registration. Use device-code sign-in; no client secret is required.',
  'Tenant ID/domain (or common)':'Use your tenant GUID/domain or an account-audience alias matching the registration. Planner requires a work/school account.',
  'Remember Microsoft sign-in':'Retain access/refresh tokens. Microsoft To Do and Planner share this sign-in.',
  'Basic Planner plan IDs':'Exact basic, group-owned plan IDs separated by commas or whitespace. Re-consent after adding plans for membership access.',
  'Instance URL':'Final HTTPS OpenProject URL, including an installation subpath if used. Redirects are not followed.',
  'API URL':'Supported Moovila origin: https://api.moovila.com. Other API hosts are not accepted by this adapter.',
  'API key':'Your OpenProject account API token. This help never displays the token value.',
  'Bearer access token':'Vendor-approved Moovila access token. Refresh is manual; this help never displays the token.',
  'Trusted CA / self-signed certificate (PEM)':'Public CA chain or self-signed server certificate for this instance only. Hostname/expiry checks remain enabled. Never paste a private key.',
  'Project ID (optional)':'Numeric OpenProject project ID. Blank retrieves all accessible work packages.',
  'Remember connection credentials':'Retain this provider credential for restart. Credential encryption is configured in General.',
  'Enable OpenProject writes':'Allow work-package creation and edits permitted by the server forms and workflow.',
  'Master passphrase':'Unlock remembered credentials; the passphrase is not stored. Use at least 12 characters when enabling encryption.',
  'Title':'Task name. Use the description field for longer notes; saving applies the change to the current task provider.',
  'Description':'Task notes. Native local tasks keep this separate from the title; Autotask uses its description as the task name and text.',
  'Priority':'A is highest; choose None for no priority. Priority is retained locally and is not automatically mapped to Microsoft.',
  'Created date':'Local calendar date recorded on the todo.txt task.',
  'Start date':'Local calendar start date. Future starts appear in Upcoming.',
  'Due date':'Calendar deadline. A date-only local deadline publishes at the end of that local day.',
  'Projects':'Project tags, separated by spaces or commas. Each project name is a single token, stored with +.',
  'Contexts':'Context tags, separated by spaces or commas. Each context name is a single token, stored with @.',
  'Task line':'Advanced todo.txt syntax. Preserve uid: and source metadata to retain task identity and sync bindings.',
  'Save raw line instead':'Save the raw task line rather than the structured fields. Do not remove or replace the existing uid: token.'
});
const ACTION_HINTS = Object.freeze({
  'Create task':'Submit a new task to the chosen provider. Check the destination and required fields before creating.',
  'Save reviewed mappings':'Save the selected company destination and any reviewed user identity mapping; this does not create tasks.',
  'Use or create task file':'Use the chosen file without replacing its contents, assign stable task IDs and open the local task panel.',
  'Change company':'Review reassociation with another Autotask company. Save other pending edits first.',
  'Reload users':'Refresh eligible Autotask resource choices without changing the task assignment.',
  'Search':'Look up matching Autotask companies; select a returned company before submitting.',
  'Check task':'Read this Autotask CRM To-Do by ID without modifying it.',
  'Append note':'Append the entered timestamped note to the Autotask description and verify the update.',
  'Attach file':'Upload the chosen vault file to this Microsoft To Do task. The file must be smaller than 3 MB.',
  'Save to vault':'Download this attachment into the configured Attachments folder. Existing files are not overwritten.',
  'Sign in to Microsoft':'Start shared Microsoft To Do/Planner device-code authentication; no client secret is needed.',
  'Start sign-in':'Request a Microsoft device code, then complete sign-in at the displayed Microsoft URL.',
  'New task':'Open the creation form for this panel’s provider; no task is created until you submit it.',
  'Refresh':'Reload this panel from its provider and rebuild its enabled Markdown snapshot. This does not submit task edits.',
  'Connect':'Open connection settings for this provider.',
  'Sign in':'Start Microsoft device-code sign-in. To Do and Planner share the session.',
  'Edit':'Open this task’s editor. Review and save changes to apply them to its source.',
  'Complete':'Mark this task complete in its source, subject to permissions and verification.',
  'Reopen':'Return this task to an open state in its source; unsupported workflow/API transitions may be refused.',
  'Note':'Append a timestamped text note to the Autotask description. This is not a native threaded comment.',
  'Ticket notes':'Read native ticket notes and their visibility; add a note only with explicit type/visibility and ticket writes enabled.',
  'Update ticket':'Review status and priority changes. This does not edit the ticket description or assignment.',
  'Save ticket changes':'PATCH only changed status/priority fields and verify them. Tenant workflow rules still apply.',
  'Add ticket note':'Create one native note with the selected type and visibility. An uncertain result blocks duplicate retries.',
  'Reconcile ticket note':'Match an existing note to the recorded fingerprint before permitting another note creation.',
  'Attachments':'List Microsoft To Do attachments; upload a small vault file or save an attachment into the vault.',
  'Publish…':'Review a destination mapping and exact values before creating or updating a Microsoft counterpart.',
  'Task file':'Select an existing task file or create a new one; task files are not moved automatically.',
  'Providers':'Open the provider chooser. Local tasks remain available without connecting an account.',
  'Pull Autotask':'Import the configured assigned/created scope plus company/user catalogs; retain local edits for conflict review.',
  'Mappings':'Review company destinations and resource-to-Entra identities. Matching names alone are not identity verification.',
  'Refresh destinations':'Read bound Microsoft tasks and merge non-conflicting edits locally. Conflicts remain for review.',
  'Build preview':'Recheck task, mappings and destination, then show the exact proposed write. No remote write is submitted.',
  'Preview push':'Inspect proposed destination values before a remote write.',
  'Push reviewed task':'Revalidate the preview and submit once. An uncertain result blocks retries until reconciliation.',
  'Save mapping and preview':'Save the reviewed destination choice, then open the preview. This does not create a remote task.',
  'Map and preview':'Choose and review a destination for this local task before publishing.',
  'Review mapping':'Review the destination choices for this local task; changing a bound destination requires reconciliation.',
  'Push local to Autotask':'Update the existing source To-Do using the local row. Requires enabled Autotask writes and a current source snapshot.',
  'Keep local values':'Acknowledge the conflict and keep local values for a later reviewed push; inspect the competing versions first.',
  'Use destination values':'Resolve this conflict using its recorded destination values after checking the destination has not changed again.',
  'Use Autotask values':'Replace the local representation with the current Autotask source values.',
  'Verify and bind existing task':'Verify an existing remote identity and record it as this task’s counterpart. No new task is created.',
  'Check task by ID':'Read a CRM To-Do directly and explain how its creator/assignee relates to your configured list filters.',
  'Enable encryption':'Create a password-encrypted vault for remembered secrets; retain the passphrase for future unlocks.',
  'Unlock credentials':'Unlock saved secrets for this session. The passphrase is not stored.',
  'Forget Microsoft sign-in':'Remove saved Microsoft tokens and disconnect both To Do and Planner. Remote tasks are retained.',
  'Cancel':'Close this dialog without submitting its pending form changes.',
  'Save task':'Save this task to todo.txt. External changes invalidate the editor snapshot.',
  'Save changes':'Submit the reviewed changes to this task’s provider.',
  'Select or create task file':'Choose an existing vault task file or create a new one without replacing existing contents.'
});
function fieldHint(name,description='',type='input') {
  const label=String(name||'').trim();
  return [label,FIELD_HINTS[label]||(/^Search/i.test(label)?'Filter the displayed tasks immediately without modifying source tasks.':'')||String(description||'').trim()||(type==='dropdown'?'Choose a value from the available options.':type==='toggle'?'Enable or disable this option.':'Enter a value for this field.')].filter(Boolean).join(': ');
}
function actionHint(label,settingName='') {
  const text=String(label||'').trim();if(ACTION_HINTS[text])return ACTION_HINTS[text];
  if(/^Reconcile /.test(text))return 'Inspect the provider first, then bind the existing task identity to avoid a duplicate creation.';
  if(/^Forget /.test(text))return 'Remove this provider’s current saved credential and connection. Remote tasks and historical credential backups are retained.';
  if(/^Connect /.test(text))return 'Configure and validate this provider connection before opening its tasks.';
  if(/^Open /.test(text)||text==='Open')return `Open ${settingName||text.replace(/^Open /,'')||'the selected view'}.`;
  if(['General','todo.txt','Autotask','Autotask Tickets','Microsoft To Do','Microsoft Planner','OpenProject','Moovila'].includes(text))return 'Show the '+text+' settings pane.';
  return String(settingName||'').trim()?fieldHint(settingName):text?text+'. Review the form before submitting.':'Review this action before submitting.';
}
/**= Tooltip text is static help or visible task context; never input values or HTML. */
function hintElement(element,text,nativeTooltip) {
  if(!element||typeof text!=='string'||!text.trim())return element;
  const hint=text.slice(0,1600);element.classList?.add('task2do-has-hint');element.title=hint;element.setAttribute?.('aria-description',hint);
  if(typeof nativeTooltip==='function'){element.removeAttribute?.('title');nativeTooltip(element,hint);}
  return element;
}
/**= Wrap this plugin’s Setting class only; do not modify Obsidian prototypes. */
function dropdownHelp(control){const values=control.selectEl?.options?Array.from(control.selectEl.options).map(o=>o.value):Object.keys(control.options||{});if(values.includes('due-asc'))return 'Due-date sorting: choose earliest, latest or original order; undated tasks stay last.';if(values.includes('inbox'))return 'Local task view: Inbox, Today including overdue, Upcoming, Completed or All tasks.';if(values.includes('delegated'))return 'Autotask scope: assigned tasks, delegated tasks or their deduplicated union.';if(values.includes('completed')&&values.includes('open'))return 'Task state filter: open, completed or all. This changes the view only.';return '';}
function createHintedSetting(Base,nativeTooltip) {
  return class HintedSetting extends Base {
    setName(value){this.hintName=typeof value==='string'?value:'';return super.setName(value);}
    setDesc(value){this.hintDescription=typeof value==='string'?value:'';return super.setDesc(value);}
    addText(callback){return super.addText(control=>{callback(control);hintElement(control.inputEl,fieldHint(this.hintName||control.inputEl?.placeholder,this.hintDescription),nativeTooltip);});}
    addTextArea(callback){return super.addTextArea(control=>{callback(control);hintElement(control.inputEl,fieldHint(this.hintName||control.inputEl?.placeholder,this.hintDescription),nativeTooltip);});}
    addDropdown(callback){return super.addDropdown(control=>{callback(control);hintElement(control.selectEl||control.inputEl,this.hintName?fieldHint(this.hintName,this.hintDescription,'dropdown'):dropdownHelp(control)||fieldHint('',this.hintDescription,'dropdown'),nativeTooltip);});}
    addToggle(callback){return super.addToggle(control=>{callback(control);hintElement(control.toggleEl||control.inputEl,fieldHint(this.hintName,this.hintDescription,'toggle'),nativeTooltip);});}
    addButton(callback){return super.addButton(control=>{callback(control);const el=control.buttonEl;hintElement(el,el?.getAttribute?.('title')||el?.title||actionHint(el?.textContent||control.text,this.hintName),nativeTooltip);});}
  };
}
function hintDate(value){if(!value)return '';if(/^\d{4}-\d{2}-\d{2}$/.test(value))return value+' (date only)';const date=new Date(value);return Number.isFinite(date.getTime())?date.toLocaleString(undefined,{year:'numeric',month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit',timeZoneName:'short'}):'Invalid date';}
function taskHint(item,editable=true) {
  if(!item||typeof item!=='object')return '';
  const labels={'todotxt':'Local todo.txt','autotask-todo':'Autotask','autotask-tickets':'Autotask Tickets','microsoft-todo':'Microsoft To Do','microsoft-planner':'Microsoft Planner','openproject':'OpenProject','moovila':'Moovila'};
  const edits={'autotask-tickets':'Update ticket status and priority; use Ticket notes for native notes. Description and assignment stay unchanged.','todotxt':'Edit title, description, priority, dates, projects and contexts.','autotask-todo':'Edit task text, assignee and schedule. Change company is inside Edit; creator attribution is read-only.','microsoft-todo':'Edit title, description and deadline.','microsoft-planner':'Edit title, description, dates, bucket and assignments.','openproject':'Edit fields allowed by this project’s forms and workflow.'};
  return [labels[item.provider]||'Task',item.remoteId?'ID '+item.remoteId:'',item.listName||item.source||'',item.organizationName||'',item.assigneeName?'Assigned to '+item.assigneeName:'',item.creatorName?'Created by '+item.creatorName:item.creatorId!=null?'Created by resource #'+item.creatorId:'',item.start?'Start: '+hintDate(item.start):'',item.dueDate||item.due?'Due: '+hintDate(item.dueDate||item.due):'',item.description?String(item.description).slice(0,500):'',editable?(edits[item.provider]||'Use Edit to change supported fields.')+(item.provider==='autotask-tickets'?' Use Update ticket; the title is not a direct-edit control.':' Use the Edit button; the title is not a direct-edit control.'):'Read-only source; editing is not available in this panel.'].filter(Boolean).join('\n');
}
module.exports={fieldHint,actionHint,hintElement,createHintedSetting,taskHint};
