import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// Execute the shipped handlers in an isolated DOM harness. Deferred Promises
// make completion order deterministic; the browser suite covers real events.
const root = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/u, '');
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve};}
async function core(api){
 const source=await fs.readFile(`${root}/apps/api/ui/app.js`,'utf8');
 const node={innerHTML:'',hidden:false,disabled:false,value:'',textContent:'',setAttribute(){},addEventListener(){}};
 const ctx=vm.createContext({URL,URLSearchParams,console,localStorage:{getItem(){return null},setItem(){}},document:{querySelector(){return node},querySelectorAll(){return []},dispatchEvent(){}},CustomEvent:class {constructor(type,options){this.type=type;this.detail=options?.detail}},window:{},requestAnimationFrame(){},crypto:{randomUUID:()=> 'test'},Map,Set});
 ctx.window=ctx;
 new vm.Script(source.slice(0,source.indexOf('const initialViewHash ='))).runInContext(ctx);
 ctx.testApi=api;
 new vm.Script(`api=testApi;renderSpaces=()=>{};renderEmployeeList=()=>{};renderKnowledge=()=>{};updateMetrics=()=>{};updateHomeEmployeeState=()=>{};setEmployeeWorkspaceState=()=>{};setConnection=()=>{};renderEmployeeSuccess=()=>{};notify=()=>{};selectView=()=>{};setStatus=(kind,icon,title,detail,retry)=>{state.retry=retry;};state.currentSpaceId='A';state.data.spaces=[{id:'A',name:'A'},{id:'B',name:'B'}];publishCurrentSpace();`).runInContext(ctx);
 return {ctx,state:vm.runInContext('state',ctx)};
}
test('late employee read must not replace selected space',async()=>{
 const held=deferred(); const seen=[];
 const {ctx,state}=await core(async url=>{seen.push(url); if(url.includes('/A/employees'))return held.promise; return {data:url.includes('/B/employees')?[{id:'B',displayName:'B'}]:[]};});
 const old=ctx.loadEmployees(); await ctx.selectSpace('B'); held.resolve({data:[{id:'A',displayName:'A'}]}); await old;
 assert.equal(state.data.employees[0]?.id,'B');assert.ok(seen.some(u=>u.includes('/B/employees')));
});
test('failed space clears foreign rows and retry really fetches',async()=>{
 let failures=1, count=0;
 const {ctx,state}=await core(async url=>{if(url.includes('/B/entities')){count++; if(failures-->0)throw new Error('unavailable');}return {data:[]};});
 state.data.spaceEntities=[{entityId:'A'}];state.data.groups=[{id:'A'}];state.data.snapshots=[{id:'A'}];
 await ctx.selectSpace('B'); assert.equal(state.data.spaceEntities.length,0);assert.equal(state.data.groups.length,0);assert.equal(state.data.snapshots.length,0);
 assert.equal(typeof state.retry,'function');await state.retry();assert.equal(count,2);
});
test('late catalog must not replace selected space',async()=>{
 const held=deferred();
 const {ctx,state}=await core(async url=>url.includes('/A/active-templates')?held.promise:{data:url.includes('/B/active-templates')?[{id:'B'}]:[]});
 const old=ctx.loadActiveTemplates();await ctx.selectSpace('B');held.resolve({data:[{id:'A'}]});await old;
 assert.equal(state.data.activeTemplates[0]?.id,'B');
});
test('visual enrichment must not replace a live binding form',async()=>{
 const source=await fs.readFile(`${root}/apps/api/ui/template-placement-guidance.js`,'utf8');
 const held=deferred();const report={format:'docx',sourceSha256:'same'};let renders=0;
 const ctx=vm.createContext({structureReport:report,structureDraft:{id:'draft'},structureWizardArtifacts:()=>({}),docomatorTemplateWizard:{spaceId:()=> 'A'},visualLayoutRequestVersion:1,selectedStructureElement:{id:'selected'},fieldBusy:false,document:{querySelector:()=>({})},structureFetchJson:()=>held.promise,renderVisualDocxStructure:()=>renders++,renderVisualXlsxStructure:()=>renders++,renderStructureElementList(){}});
 new vm.Script(source.slice(source.indexOf('{\n  loadVisualLayout = async'))).runInContext(ctx);
 const task=ctx.loadVisualLayout(report,'op',1);held.resolve({data:{format:'docx',sourceSha256:'same'}});await task;assert.equal(renders,0);
});
test('reset invalidates an old visual response',async()=>{
 const source=await fs.readFile(`${root}/apps/api/ui/template-placement-guidance.js`,'utf8');
 const held=deferred();const report={format:'docx',sourceSha256:'same'};let renders=0;
 const ctx=vm.createContext({structureReport:report,structureDraft:{id:'draft'},structureWizardArtifacts:()=>({}),docomatorTemplateWizard:{spaceId:()=> 'A'},visualLayoutRequestVersion:1,selectedStructureElement:null,fieldBusy:false,document:{querySelector:()=>null},structureFetchJson:()=>held.promise,renderVisualDocxStructure:()=>renders++,renderVisualXlsxStructure:()=>renders++,renderStructureElementList(){}});
 new vm.Script(source.slice(source.indexOf('{\n  loadVisualLayout = async'))).runInContext(ctx);
 const task=ctx.loadVisualLayout(report,'op',1);ctx.structureReport=null;held.resolve({data:{format:'docx',sourceSha256:'same'}});await task;assert.equal(renders,0);
});
async function operator(api){
 const result=await core(api);const {ctx}=result;
 const nodes=new Map();
 const node=(id)=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',value:'',textContent:'',disabled:false,hidden:false,open:false,dataset:{},append(){},setAttribute(){},addEventListener(){},reset(){},focus(){},showModal(){this.open=true},close(){this.open=false},querySelector(){return null},querySelectorAll(){return []}});return nodes.get(id);};
 ctx.document={querySelector:node,querySelectorAll:()=>[],dispatchEvent(){},createElement:()=>node('created')};
 ctx.operatorApplicableProperties=()=>[];ctx.operatorRenderEmployeeFields=()=>{node('#employeeFields').innerHTML='ready'};
 ctx.operatorInputValue=value=>value;ctx.operatorProfileValue=()=>'';ctx.requestAnimationFrame=()=>{};
 const source=await fs.readFile(`${root}/apps/api/ui/operator-workflows.js`,'utf8');
 const stateEnd=source.indexOf('const operatorEmployeeValueTypes');
 const begin=source.indexOf('async function operatorLoadSuggestions('); const end=source.indexOf('function operatorControlJsonValue(',begin);
 new vm.Script(source.slice(0,stateEnd)+'\n'+source.slice(begin,end)).runInContext(ctx);
 return {...result,node};
}
test('closed card response cannot overwrite the next employee',async()=>{
 const held=deferred();const {ctx,node}=await operator(async url=>url.endsWith('/employees/one')?held.promise:{data:url.endsWith('/employees/two')?{id:'two',displayName:'Second'}:[]});
 const first=ctx.operatorOpenEmployeeDialog('one');ctx.closeEmployeeDialog();await ctx.operatorOpenEmployeeDialog('two');
 held.resolve({data:{id:'one',displayName:'First'}});await first;
 assert.equal(node('#employeeDisplayName').value,'Second');assert.equal(node('#employeeFields').innerHTML,'ready');
});
test('a card cannot be submitted before its profile is loaded',async()=>{
 const held=deferred();const {ctx,node}=await operator(async url=>url.endsWith('/employees/one')?held.promise:{data:[]});
 const task=ctx.operatorOpenEmployeeDialog('one');
 const disabled=node('#employeeSubmitButton').disabled;held.resolve({data:{id:'one',displayName:'First'}});await task;
 assert.equal(disabled,true);assert.equal(node('#employeeSubmitButton').disabled,false);
});
async function generation(api){
 const result=await core(api);const {ctx}=result;
 const node={innerHTML:'',classList:{contains:()=>true},replaceChildren(){this.innerHTML=''},querySelector:()=>null};
 ctx.document.querySelector=()=>node;ctx.document.getElementById=()=>node;
 const source=await fs.readFile(`${root}/apps/api/ui/document-generation.js`,'utf8');
 new vm.Script(source.slice(0,source.lastIndexOf('if (generationView) {'))).runInContext(ctx);
 ctx.testGenerationApi=api;
 new vm.Script('generationFetchJson=testGenerationApi;createGenerationPanel=()=>{};setGenerationStep=()=>{};renderGenerationWorkspace=()=>{};renderGenerationHistory=()=>{};').runInContext(ctx);
 return result;
}
test('late generation workspace cannot replace the new space',async()=>{
 const held=deferred();const {ctx}=await generation(async url=>url.includes('/A/active-templates')?held.promise:{data:url.includes('/B/active-templates')?[{id:'B'}]:[]});
 const old=ctx.loadGenerationWorkspace();await ctx.selectSpace('B');ctx.handleGenerationSpaceChanged({detail:{spaceId:'B'}});await ctx.loadGenerationWorkspace();
 held.resolve({data:[{id:'A'}]});await old;
 assert.equal(vm.runInContext('generationTemplates[0]?.id',ctx),'B');
});
test('late generation history cannot replace the new space',async()=>{
 const held=deferred();const {ctx}=await generation(async url=>url.includes('/A/document-jobs')?held.promise:{data:url.includes('/B/document-jobs')?[{job:{id:'B'}}]:[]});
 const old=ctx.loadGenerationHistory();await ctx.selectSpace('B');await ctx.loadGenerationHistory();held.resolve({data:[{job:{id:'A'}}]});await old;
 assert.equal(vm.runInContext('generationJobs[0]?.job.id',ctx),'B');
});
test('concurrent reads in one space share the in-flight employee request',async()=>{
 const held=deferred();let calls=0;
 const {ctx}=await core(async()=>{calls++;return held.promise});
 const first=ctx.loadEmployees(),second=ctx.loadEmployees();held.resolve({data:[]});await Promise.all([first,second]);assert.equal(calls,1);
});
async function persistence(api){
 const result=await operator(api);const {ctx,node}=result;
 ctx.CSS={escape:x=>x};ctx.operatorRememberEmployeeDraft=()=>{};ctx.operatorValueEmpty=x=>x===''||x==null;
 const source=await fs.readFile(`${root}/apps/api/ui/operator-workflows.js`,'utf8');
 const start=source.indexOf('function operatorControlJsonValue('),end=source.indexOf('function operatorSubmitEmployee(',start);
 new vm.Script(source.slice(start,end)).runInContext(ctx);
 await ctx.operatorOpenEmployeeDialog();node('#employeeDisplayName').value='First';
 node('[data-staged-id="new-field"]').value='Value';
 new vm.Script(`operatorState.employeeStagedFields.push({stagedId:'new-field',label:'Field',valueType:'string',validation:{},value:'Value'});`).runInContext(ctx);
 return result;
}
test('retry of card write reuses already confirmed field identity',async()=>{
 let definitions=0,writes=0;
 const {ctx}=await persistence(async(url,options)=>{
  if(options?.method==='POST'&&url.includes('/property-definitions'))return {data:{key:`field${++definitions}`,label:'Field',valueType:'string'}};
  if(options?.method==='POST'&&url.endsWith('/employees')){if(++writes===1)throw new Error('temporary');return {data:{id:'saved'}};}
  return {data:[]};
 });
 await ctx.operatorPersistEmployee();await ctx.operatorPersistEmployee();assert.equal(writes,2);assert.equal(definitions,1);
});
test('pending card creation stays open and keeps its original space and identity',async()=>{
 const held=deferred();const writes=[];
 const {ctx}=await persistence(async(url,options)=>{
  if(options?.method==='POST'&&url.includes('/property-definitions'))return held.promise;
  if(options?.method==='POST'&&url.endsWith('/employees'))writes.push(url);
  return {data:[]};
 });
 const old=ctx.operatorPersistEmployee();ctx.closeEmployeeDialog();await ctx.selectSpace('B');await ctx.operatorOpenEmployeeDialog();
 assert.equal(vm.runInContext('state.currentSpaceId',ctx),'A');
 assert.equal(vm.runInContext('operatorState.employeeSaving',ctx),true);
 held.resolve({data:{key:'fieldA',label:'Field',valueType:'string'}});await old;
 assert.deepEqual(writes,['/api/v1/spaces/A/employees']);
});
async function formatting(api) {
  const result = await core(async () => ({ data: [] }));
  const { ctx } = result;
  ctx.testFormattingApi = api;
  ctx.clearTimeout = () => {};
  ctx.setTimeout = () => { throw new Error('stale poll scheduled'); };
  const source = await fs.readFile(`${root}/apps/api/ui/gost-formatting.js`, 'utf8');
  const ending = '  gostInstallShell();';
  assert.ok(source.includes(ending));
  new vm.Script(source.replace(ending, `
    gostJson = testFormattingApi;
    gostCurrentSettings = () => ({ profile: 'custom' });
    gostRenderFiles = () => {};
    gostRenderResults = () => {};
    gostStatus = () => {};
    globalThis.formattingTest = { state: gostUi, prepare: gostPrepareItem, poll: gostPoll };
  `)).runInContext(ctx);
  vm.runInContext(`state.view = 'gost-formatting';`, ctx);
  return result;
}

test('formatting analysis cannot save an old-space file after a switch', async () => {
  const held = deferred();
  const writes = [];
  const { ctx } = await formatting(async (url) => {
    if (url.includes('/analyze?')) return held.promise;
    writes.push(url);
    return { id: 'source' };
  });
  const item = { file: { name: 'fixture.docx' }, state: 'new' };
  ctx.formattingTest.state.files.push(item);
  const context = ctx.captureSpaceContext();
  const pending = ctx.formattingTest.prepare(item, context, 0);
  await ctx.selectSpace('B');
  held.resolve({ findings: [] });
  await pending;
  assert.deepEqual(writes, [], 'a subsequent quarantine write must not cross spaces');
});

test('late formatting polling cannot reintroduce another space result', async () => {
  const held = deferred();
  const { ctx } = await formatting(async () => held.promise);
  const old = { id: 'job-A', spaceId: 'A', state: 'running', items: [] };
  const current = { id: 'job-B', spaceId: 'B', state: 'completed', items: [] };
  ctx.formattingTest.state.job = old;
  const pending = ctx.formattingTest.poll();
  await ctx.selectSpace('B');
  ctx.formattingTest.state.job = current;
  held.resolve({ ...old, state: 'completed' });
  await pending;
  assert.equal(ctx.formattingTest.state.job.id, 'job-B');
});


test('newest group selection wins within the same space', async () => {
  const held = deferred();
  const { ctx, state } = await core(async (url) => url.includes('/old/members') ? held.promise : { data: [{ entityId: 'new-member' }] });
  vm.runInContext('renderMembers=()=>{};setSpaceTab=()=>{};', ctx);
  const old = ctx.loadGroupSelection('old');
  await ctx.loadGroupSelection('new');
  held.resolve({ data: [{ entityId: 'old-member' }] });
  await old;
  assert.deepEqual([...state.selectedEntityIds], ['new-member']);
});

test('newest snapshot wins within the same space', async () => {
  const held = deferred();
  const latest = { snapshot: { id: 'new', memberCount: 1 }, plan: { documentCount: 1 } };
  const { ctx, state } = await core(async (url) => url.endsWith('/old') ? held.promise : { data: latest });
  vm.runInContext('renderPlan=(result)=>{state.lastPlan=result;};setSpaceTab=()=>{};', ctx);
  const old = ctx.openSnapshot('old');
  await ctx.openSnapshot('new');
  held.resolve({ data: { snapshot: { id: 'old', memberCount: 2 }, plan: { documentCount: 2 } } });
  await old;
  assert.equal(state.lastPlan.snapshot.id, 'new');
});

async function groupHarness(api) {
  const result = await operator(api);
  const { ctx, node, state } = result;
  ctx.groupManagerEmployees = () => state.data.employees;
  ctx.operatorRenderGroupSelect = () => {};
  ctx.groupMemberResult = null;
  ctx.operatorRenderGroupMembers = (members) => { ctx.groupMemberResult = members; };
  ctx.window.dispatchEvent = () => {};
  node('#operatorGroupDialog').open = true;
  const source = await fs.readFile(`${root}/apps/api/ui/operator-workflows.js`, 'utf8');
  new vm.Script(source.slice(source.indexOf('async function operatorSelectGroup('), source.indexOf('function operatorInstallEmployeeToolbar('))).runInContext(ctx);
  vm.runInContext('operatorState.groupContext=captureSpaceContext();', ctx);
  return result;
}

test('group dialog rejects old membership response and blocks saving an unread composition', async () => {
  const held = deferred();
  const { ctx, node } = await groupHarness(async (url) => url.includes('/old/members') ? held.promise : { data: [{ entityId: 'new-member' }] });
  const old = ctx.operatorSelectGroup('old');
  assert.equal(node('#operatorGroupSave').disabled, true);
  await ctx.operatorSelectGroup('new');
  held.resolve({ data: [{ entityId: 'old-member' }] });
  await old;
  assert.deepEqual([...ctx.groupMemberResult], ['new-member']);
  assert.equal(node('#operatorGroupSave').disabled, false);
});

test('group retry reuses the confirmed group when membership persistence fails', async () => {
  let creates = 0, memberWrites = 0;
  const { ctx, node, state } = await groupHarness(async (url, options) => {
    if (url.endsWith('/groups') && options?.method === 'POST') {
      creates += 1;
      return { data: { id: 'confirmed-group' } };
    }
    if (url.endsWith('/confirmed-group/members') && options?.method === 'PUT') {
      memberWrites += 1;
      if (memberWrites === 1) throw new Error('temporary failure');
    }
    return { data: [] };
  });
  state.data.employees = [{ id: 'one', displayName: 'One' }];
  vm.runInContext("operatorState.groupMemberIds=new Set(['one']);", ctx);
  node('#operatorGroupName').value = 'Group';
  const event = { preventDefault() {}, stopImmediatePropagation() {} };
  await ctx.operatorSaveGroup(event);
  assert.equal(node('#operatorGroupDialog').open, true);
  assert.equal(node('#operatorGroupSave').disabled, false);
  assert.equal(vm.runInContext('operatorState.groupEditingId', ctx), 'confirmed-group');
  await ctx.operatorSaveGroup(event);
  assert.equal(creates, 1);
  assert.equal(memberWrites, 2);
  assert.equal(node('#operatorGroupDialog').open, false);
});

test('late PDF polling cannot replace the current space', async () => {
  const held = deferred();
  const result = await core(async () => ({ data: [] }));
  const { ctx } = result;
  let rendered = 0;
  ctx.testPreviewFetch = () => held.promise;
  ctx.testPreviewRender = () => { rendered += 1; };
  const source = await fs.readFile(`${root}/apps/api/ui/template-activation.js`, 'utf8');
  const part = source.slice(source.indexOf('async function refreshPreviewState('), source.indexOf('async function requestTemplatePreview('));
  new vm.Script('let activationPollToken=0;let activationPollTimer=null;activationFetchJson=testPreviewFetch;renderPreviewReady=testPreviewRender;renderPreviewFailure=testPreviewRender;renderPreviewPending=testPreviewRender;clearActivationPolling=()=>{activationPollToken++;};\n'+part).runInContext(ctx);
  const pending = ctx.refreshPreviewState('old-preview', 'old-version');
  await ctx.selectSpace('B');
  held.resolve({ data: { request: { state: 'ready' } } });
  await pending;
  assert.equal(rendered, 0);
});


test('late snapshot creation cannot display a foreign-space plan', async () => {
  const held = deferred();
  const { ctx, state } = await core(async (url, options) => options?.method === 'POST' ? held.promise : { data: [] });
  vm.runInContext("estimatedAudienceCount=()=>1;renderPlan=(result)=>{state.lastPlan=result;};", ctx);
  const pending = ctx.createAudienceSnapshot();
  await ctx.selectSpace('B');
  held.resolve({ data: { snapshot: { id: 'old', memberCount: 1 }, plan: { documentCount: 1 } } });
  await pending;
  assert.equal(state.lastPlan, null);
});
