'use strict';
/**= Version 0.9.0-alpha.5. Service Desk tickets share the Autotask session, not CRM To-Do semantics. */
function ticketId(value,allowZero=false){if(!new RegExp(allowZero?'^(0|[1-9]\\d*)$':'^[1-9]\\d*$').test(String(value))||!Number.isSafeInteger(Number(value)))throw new Error('Enter a valid numeric Autotask ID.');return Number(value);}
function ticketStatusIds(value=''){return [...new Set(String(value).split(/[\s,;]+/).filter(Boolean).map(v=>String(ticketId(v,true))))];}
class AutotaskTicketProvider {
  constructor(source,config={},journal=null,digest=null,log=()=>{}){
    if(typeof source!=='function')throw new Error('A shared Autotask connection is required.');
    this.id='autotask-tickets';this.source=source;this.enableWrites=config.enableWrites===true;this.closedStatusIds=ticketStatusIds(config.closedStatusIds);this.journal=journal;this.digest=digest;this.log=log;this.pending=new Set();this.disposed=false;
    this.capabilities=Object.freeze({read:true,create:false,update:this.enableWrites,complete:false,reopen:false,comment:this.enableWrites});
  }
  dispose(){this.disposed=true;}
  connection(){const source=this.source();if(this.disposed||!source?.credentials)throw new Error('Connect Autotask first, then refresh Tickets.');return source;}
  assertConnection(source){if(source!==this.connection())throw new Error('Autotask connection changed. Refresh Tickets before continuing.');}
  async request(path,method='GET',body,readOnly=true,source=this.connection()){
    this.assertConnection(source);const base=new URL(source.base),url=new URL(path,base);const relative=url.pathname.slice(base.pathname.length);
    if(url.origin!==base.origin||!url.pathname.startsWith(base.pathname)||url.username||url.password||url.hash||!(/^(Tickets(?:\/(?:query|entityInformation\/fields|\d+(?:\/Notes)?))?|TicketNotes\/(?:query|entityInformation\/fields|\d+)|(?:ResourceServiceDeskRoles|ResourceRoleQueues|TicketSecondaryResources)\/query|Roles\/(?:query|\d+))$/.test(relative)))throw new Error('Rejected unexpected ticket API URL.');
    if(!readOnly&&!((method==='PATCH'&&relative==='Tickets')||(method==='POST'&&/^Tickets\/\d+\/Notes$/.test(relative))))throw new Error('Unsupported ticket write.');
    const result=await source.request(url.href,method,body,readOnly);this.assertConnection(source);return result;
  }
  async fields(entity='Tickets',source=this.connection()){const result=await this.request(entity+'/entityInformation/fields','GET',undefined,true,source);if(!Array.isArray(result.fields))throw new Error('Autotask did not return ticket field metadata.');return result.fields;}
  choices(fields,name){const field=fields.find(f=>f.name===name);if(!field||!Array.isArray(field.picklistValues))return[];return field.picklistValues.filter(v=>v.isActive===true).map(v=>({id:String(ticketId(v.value,true)),label:String(v.label||'#'+v.value),parentValue:v.parentValue==null?'':String(v.parentValue)}));}
  async collection(path,filter,source=this.connection()){
    let url=path,method='POST',body={filter,MaxRecords:500};const rows=[],pages=new Set(),ids=new Set();
    for(let page=0;page<100;page++){const absolute=new URL(url,source.base).href;if(pages.has(absolute))throw new Error('Repeated ticket pagination URL.');pages.add(absolute);const result=await this.request(url,method,body,true,source);if(!Array.isArray(result.items))throw new Error('Autotask did not return a ticket collection.');for(const item of result.items){const id=ticketId(item.id);if(ids.has(id))throw new Error('Repeated ticket/note ID in pagination.');ids.add(id);rows.push(item);}if(!result.pageDetails?.nextPageUrl)return rows;url=result.pageDetails.nextPageUrl;method='GET';body=undefined;}
    throw new Error('Ticket pagination limit reached; incomplete data was not shown.');
  }
  normalize(raw,fields=[]){const id=ticketId(raw.id),status=String(ticketId(raw.status,true)),label=name=>this.choices(fields,name).find(v=>v.id===String(raw[name]))?.label||`${name} #${raw[name]??'unknown'}`;
    return{provider:this.id,remoteId:String(id),ticketNumber:raw.ticketNumber||String(id),title:raw.title||'',description:raw.description||'',companyId:raw.companyID,assigneeId:raw.assignedResourceID,creatorId:raw.creatorResourceID,due:raw.dueDateTime,completed:this.closedStatusIds.length?this.closedStatusIds.includes(status):!!raw.completedDate,statusId:status,statusName:label('status'),priorityId:String(raw.priority??''),priorityName:label('priority'),queueName:label('queueID'),completedAt:raw.completedDate,modified:raw.lastActivityDate,raw};}
  /**= Explicit primary-assignee scopes are fetched remotely; never broaden an empty selection. */
  async list(resourceIDs=null){
    const source=this.connection();let ids;
    if(resourceIDs===null)ids=[ticketId(source.resourceId)];
    else{
      if(!Array.isArray(resourceIDs)||!resourceIDs.length||resourceIDs.length>50)throw new Error('Select between 1 and 50 ticket assignees.');
      ids=[...new Set(resourceIDs.map(v=>ticketId(v)))];
      const users=await this.resources();if(ids.some(id=>!users.some(u=>String(u.id)===String(id))))throw new Error('A selected assignee is no longer available. Edit the assignment filter.');
    }
    const fields=await this.fields('Tickets',source),result=[],seen=new Set();
    for(const resourceID of ids){
      const rows=await this.collection('Tickets/query',[{op:'eq',field:'assignedResourceID',value:resourceID}],source);
      for(const raw of rows){
        if(Number(raw.assignedResourceID)!==resourceID)throw new Error('Returned ticket is outside the selected primary assignment. Refresh first.');
        if(seen.has(ticketId(raw.id)))throw new Error('Ticket assignment changed during retrieval. Refresh before continuing.');seen.add(ticketId(raw.id));
        const item=this.normalize(raw,fields);item.organizationName=await source.resolveName('Companies',raw.companyID);item.assigneeName=await source.resolveName('Resources',raw.assignedResourceID);this.assertConnection(source);result.push(item);
      }
    }
    return result;
  }
  async get(id,fields=null,source=this.connection()){id=ticketId(typeof id==='object'?id.remoteId:id);const result=await this.request('Tickets/'+id,'GET',undefined,true,source);if(!result.item||Number(result.item.id)!==id)throw new Error('Ticket identity could not be verified.');return this.normalize(result.item,fields||await this.fields('Tickets',source));}
  signature(item){const raw=item.raw||{};return JSON.stringify(['id','status','priority','assignedResourceID','assignedResourceRoleID','assignedResourceroleID','queueID','companyID','title','description','dueDateTime','lastActivityDate','lastTrackedModificationDateTime','resolution'].map(k=>[k,raw[k]??null]));}
  /**= Resolve current assignment options; queue membership and service desk roles are separate entities. */
  async resources(){const source=this.connection(),users=await source.listResources();this.assertConnection(source);return users;}
  async assignmentOptions(resourceID,fields=null,source=this.connection()){
    const id=ticketId(resourceID),filter=[{op:'eq',field:'resourceID',value:id}];
    const memberships=await this.collection('ResourceRoleQueues/query',filter,source),associations=await this.collection('ResourceServiceDeskRoles/query',filter,source);
    if([...memberships,...associations].some(v=>Number(v.resourceID)!==id))throw new Error('Assignment catalog returned another resource.');
    const roles=[];for(const roleID of [...new Set(associations.filter(v=>v.isActive===true).map(v=>ticketId(v.roleID)))]){const role=(await this.request('Roles/'+roleID,'GET',undefined,true,source)).item;if(!role||Number(role.id)!==roleID)throw new Error('Role identity could not be verified.');if(role.isActive===true)roles.push({id:String(roleID),label:String(role.name||'#'+roleID)});}
    const queues=this.choices(fields||await this.fields('Tickets',source),'queueID').filter(q=>memberships.some(v=>String(v.queueID)===q.id));
    return{roles,queues};
  }
  async update(snapshot,changes,options={}){
    if(!this.enableWrites)throw new Error('Enable ticket updates in Autotask Tickets settings.');
    const id=ticketId(snapshot.remoteId),keys=Object.keys(changes),allowed=['status','priority','title','description','dueDateTime','assignedResourceID','assignedResourceroleID','queueID'];
    if(!keys.length||keys.some(k=>!allowed.includes(k)))throw new Error('Unsupported ticket edit field.');
    if(this.pending.has(id))throw new Error('A ticket action is already running.');this.pending.add(id);
    try{
      const source=this.connection(),fields=await this.fields('Tickets',source),fresh=await this.get(id,fields,source);
      if(this.signature(fresh)!==this.signature(snapshot))throw new Error('Ticket changed remotely. Refresh before editing.');
      const patch={id};
      for(const key of keys){
        let value=changes[key];const field=fields.find(f=>f.name===key);
        if(field?.isReadOnly!==false)throw new Error('Ticket '+key+' is not writable.');
        if(['status','priority','queueID'].includes(key)){
          value=ticketId(value,true);if(!this.choices(fields,key).some(v=>v.id===String(value)))throw new Error('Choose an active, writable ticket '+key+'.');
        }else if(['assignedResourceID','assignedResourceroleID'].includes(key))value=ticketId(value);
        else if(key==='dueDateTime'){
          if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?Z$/.test(value)||!Number.isFinite(Date.parse(value)))throw new Error('Enter a valid UTC due date/time.');
          const parsed=new Date(value);if(parsed.toISOString().slice(0,16)!==value.slice(0,16))throw new Error('Enter a valid UTC due date/time.');value=parsed.toISOString();
        }else{
          const limit=key==='title'?255:8000;
          if(typeof value!=='string'||(key==='title'&&!value.trim())||value.length>Math.min(limit,Number(field.length)>0?Number(field.length):limit))throw new Error('Enter a valid ticket '+key+'.');
          if(key==='title')value=value.trim();
        }
        const old=fresh.raw[key];const equal=key==='dueDateTime'?Date.parse(old)===Date.parse(value):['status','priority','queueID','assignedResourceID','assignedResourceroleID'].includes(key)?old!=null&&Number(old)===value:old===value;
        if(!equal)patch[key]=value;
      }
      if(Object.hasOwn(patch,'description')&&options.confirmPlainTextReplacement!==true)throw new Error('Confirm plain-text description replacement: Autotask formatting and embedded images will be lost.');
      if(['assignedResourceID','assignedResourceroleID','queueID'].some(k=>Object.hasOwn(patch,k))){
        const resource=ticketId(patch.assignedResourceID??fresh.raw.assignedResourceID),role=ticketId(patch.assignedResourceroleID??fresh.raw.assignedResourceroleID),queue=ticketId(patch.queueID??fresh.raw.queueID,true);
        const users=await source.listResources();this.assertConnection(source);if(!users.some(u=>String(u.id)===String(resource)))throw new Error('Choose an active named resource.');
        const available=await this.assignmentOptions(resource,fields,source);
        if(!available.roles.some(v=>v.id===String(role))||!available.queues.some(v=>v.id===String(queue)))throw new Error('Choose an active service desk role and a queue belonging to the selected resource.');
        const secondary=await this.collection('TicketSecondaryResources/query',[{op:'eq',field:'ticketID',value:id}],source);
        if(secondary.some(v=>Number(v.ticketID)!==id))throw new Error('Secondary assignment catalog returned another ticket.');
        if(secondary.some(v=>Number(v.resourceID)===resource))throw new Error('Selected resource is already secondary. Resolve that assignment in Autotask first.');
      }
      if(Object.keys(patch).length===1)return fresh;
      //= Recheck after assignment lookups; this is optimistic detection, not an atomic API condition.
      if(this.signature(await this.get(id,fields,source))!==this.signature(fresh))throw new Error('Ticket changed remotely. Refresh before editing.');
      await this.request('Tickets','PATCH',patch,false,source);
      const checked=await this.get(id,fields,source);
      for(const key of Object.keys(patch).filter(k=>k!=='id')){const actual=checked.raw[key],expected=patch[key],same=key==='dueDateTime'?Date.parse(actual)===Date.parse(expected):typeof expected==='number'?actual!=null&&Number(actual)===expected:actual===expected;if(!same)throw new Error('Ticket update readback differs. Inspect Autotask and refresh before retrying.');}
      this.log({event:'autotask.ticket-update-verified'});return checked;
    }finally{this.pending.delete(id);}
  }
  async notes(id){const source=this.connection(),ticketID=ticketId(typeof id==='object'?id.remoteId:id);await this.get(ticketID,null,source);const rows=await this.collection('TicketNotes/query',[{op:'eq',field:'ticketID',value:ticketID}],source);if(rows.some(n=>Number(n.ticketID)!==ticketID))throw new Error('Autotask returned a note from another ticket.');return rows.sort((a,b)=>String(b.createDateTime||'').localeCompare(String(a.createDateTime||''))||b.id-a.id);}
  async loadJournal(){if(!this.journal||typeof this.digest!=='function')throw new Error('Ticket note journal is unavailable.');const raw=await this.journal.read();let value={schemaVersion:1,records:{}};if(raw){try{value=JSON.parse(raw);}catch{throw new Error('Ticket note journal is not valid JSON. Restore it before writing notes.');}}if(value.schemaVersion!==1||!value.records||typeof value.records!=='object'||Array.isArray(value.records))throw new Error('Unsupported ticket note journal.');return{raw,value};}
  async saveJournal(loaded){const next=JSON.stringify(loaded.value,null,2)+'\n';await this.journal.write(next,loaded.raw);loaded.raw=next;}
  noteHash(payload){const hash=this.digest(JSON.stringify([ticketId(payload.ticketID),String(payload.title||'').trim(),String(payload.description||'').replace(/\r\n?/g,'\n'),ticketId(payload.noteType,true),ticketId(payload.publish,true)]));if(!/^[a-f0-9]{64}$/.test(hash))throw new Error('Invalid ticket-note fingerprint.');return hash;}
  async noteState(id){const source=this.connection(),loaded=await this.loadJournal();return loaded.value.records[source.base+'#'+ticketId(id)]||null;}
  async addNote(snapshot,values){if(!this.enableWrites)throw new Error('Enable ticket updates before adding notes.');const id=ticketId(snapshot.remoteId);if(this.pending.has(id))throw new Error('A ticket action is already running.');this.pending.add(id);let loaded,key,record,submitted=false;
    try{const source=this.connection(),fields=await this.fields('TicketNotes',source);await this.get(id,null,source);const payload={ticketID:id};for(const [name,max]of [['title',250],['description',32000]]){const field=fields.find(f=>f.name===name);if(field?.isReadOnly!==false||typeof values[name]!=='string'||!values[name].trim()||values[name].length>Math.min(max,Number(field.length)||max))throw new Error('Enter a valid note '+name+'.');payload[name]=values[name];}for(const name of ['noteType','publish']){const field=fields.find(f=>f.name===name);if(field?.isReadOnly!==false||!this.choices(fields,name).some(v=>v.id===String(values[name])))throw new Error('Explicitly choose note type and visibility from current Autotask values.');payload[name]=ticketId(values[name],true);}
      loaded=await this.loadJournal();key=source.base+'#'+id;const old=loaded.value.records[key];if(old&&old.status!=='verified')throw new Error('An earlier ticket note needs reconciliation. Inspect Autotask; no creation retry is allowed.');record={status:'submitting',ticketID:id,fingerprint:this.noteHash(payload),startedAt:new Date().toISOString()};loaded.value.records[key]=record;await this.saveJournal(loaded);submitted=true;
      const response=await this.request('Tickets/'+id+'/Notes','POST',payload,false,source);record.noteID=ticketId(response.itemId);await this.saveJournal(loaded);const note=(await this.request('TicketNotes/'+record.noteID,'GET',undefined,true,source)).item;if(!note||Number(note.id)!==record.noteID||this.noteHash(note)!==record.fingerprint)throw new Error('Ticket note creation readback differs. Reconcile before creating another.');record.status='verified';await this.saveJournal(loaded);this.log({event:'autotask.ticket-note-verified'});return note;
    }catch(e){if(submitted&&record){record.status='needs-review';try{await this.saveJournal(loaded);}catch{}e.message+=' Inspect Autotask before retrying; the note intent remains recorded.';}throw e;}finally{this.pending.delete(id);}
  }
  async reconcileNote(ticketID,noteID){const source=this.connection(),id=ticketId(ticketID);if(this.pending.has(id))throw new Error('A ticket action is already running.');this.pending.add(id);try{const loaded=await this.loadJournal(),record=loaded.value.records[source.base+'#'+id];if(!record||record.status==='verified')throw new Error('No unresolved note exists for this ticket.');const requested=ticketId(noteID),note=(await this.request('TicketNotes/'+requested,'GET',undefined,true,source)).item;if(!note||Number(note.id)!==requested||Number(note.ticketID)!==id||this.noteHash(note)!==record.fingerprint)throw new Error('This note does not match the recorded ticket-note intent.');record.noteID=requested;record.status='verified';record.reconciledAt=new Date().toISOString();await this.saveJournal(loaded);}finally{this.pending.delete(id);}}
}
module.exports={AutotaskTicketProvider,ticketStatusIds};
