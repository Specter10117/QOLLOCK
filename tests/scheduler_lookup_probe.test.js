"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const path=require("node:path");
const {Sandbox}=require("../scripts/simulator/sandbox");

function setup(){
    const sandbox=new Sandbox();
    sandbox.global.QOL={core:{},state:{}};
    sandbox.global.QOL_UTILS={PerfNowMs:()=>sandbox.clock.now(),IsPanelValid:panel=>panel.IsValid()};
    sandbox.load(path.resolve(__dirname,"../panorama/scripts/core/ql_scheduler.js"));
    assert.deepEqual(sandbox.loadErrors,[]);
    return {sandbox,S:sandbox.global.QOL.core.Scheduler};
}
function panel(id,children=[],{readonly=false,prototype=null}={}){
    const p=Object.create(prototype);
    Object.assign(p,{id,IsValid:()=>true,GetChildCount:()=>children.length,GetChild:i=>children[i]});
    if(!prototype)Object.defineProperty(p,"FindChildTraverse",{value:function(target){if(target==="throws")throw Error("native failure");return children.find(child=>child.id===target)||null;},writable:!readonly,configurable:!readonly,enumerable:true});
    return p;
}

test("own native-like panel bindings are intercepted independently and restored exactly",()=>{
    const {sandbox,S}=setup();const child=panel("child"),root=panel("root",[child]);
    const descriptor=Object.getOwnPropertyDescriptor(root,"FindChildTraverse");
    const originalAlias=root.FindChildTraverse;let stats;
    S.startBenchmark(1,(_report,result)=>{stats=result;},{capturePanelLookups:true,panelRoot:root});
    const retainedWrapper=root.FindChildTraverse;
    assert.equal(root.FindChildTraverse("child"),child);
    assert.equal(child.FindChildTraverse("missing"),null);
    assert.equal(originalAlias.call(root,"child"),child);
    assert.throws(()=>root.FindChildTraverse("throws"),/native failure/);
    sandbox.clock.advance(1100);
    const observed=stats.lookupStats;
    assert.equal(observed.totalCalls,3,"cached original bypasses the observer; thrown calls are still attempts");
    assert.equal(observed.panelsCovered,2);assert.equal(observed.prototypesHooked,0);
    assert.equal(observed.status,"partial-tree");assert.equal(observed.fullModCoverage,false);
    assert.equal(observed.restoreErrors,0);
    assert.deepEqual(Object.getOwnPropertyDescriptor(root,"FindChildTraverse"),descriptor);
    retainedWrapper.call(root,"child");assert.equal(observed.totalCalls,3,"late wrapper aliases cannot mutate finished data");
});

test("readonly bindings remain unobserved and inherited shadows are removed on early stop",()=>{
    const {sandbox,S}=setup();const readonly=panel("readonly",[],{readonly:true});let stats;
    S.startBenchmark(1,(_report,result)=>{stats=result;},{capturePanelLookups:true,panelRoot:readonly});
    sandbox.clock.advance(1100);
    assert.equal(stats.lookupStats.status,"unavailable");assert.equal(stats.lookupStats.panelsCovered,0);
    const prototype={FindChildTraverse(){return null;}};
    const inherited=panel("inherited",[],{prototype});
    const benchmark=S.startBenchmark(5,null,{capturePanelLookups:true,panelRoot:inherited});
    assert.equal(Object.hasOwn(inherited,"FindChildTraverse"),true);
    benchmark.stop();benchmark.stop();
    assert.equal(Object.hasOwn(inherited,"FindChildTraverse"),false);
    assert.equal(inherited.FindChildTraverse,prototype.FindChildTraverse);
});

test("completion preserves another owner's replacement and reports the displaced hook",()=>{
    const {sandbox,S}=setup();const root=panel("root");let stats;
    S.startBenchmark(1,(_report,result)=>{stats=result;},{capturePanelLookups:true,panelRoot:root});
    const replacement=()=>null;root.FindChildTraverse=replacement;
    sandbox.clock.advance(1100);
    assert.equal(root.FindChildTraverse,replacement);
    assert.equal(stats.lookupStats.displacedBindings,1);
});

