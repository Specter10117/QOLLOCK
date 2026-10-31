"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { Panel, Document } = require("../scripts/simulator/panel");
const { Clock } = require("../scripts/simulator/clock");
const { Sandbox } = require("../scripts/simulator/sandbox");
const { comparisonIssues } = require("../scripts/capture_tree");
const plainFind = Panel.prototype.FindChildTraverse;
const plainClasses = Panel.prototype.FindChildrenWithClassTraverse;
const { install, counters } = require("../scripts/simulator/perf/instrument");
install();
const evidence = JSON.parse(fs.readFileSync(path.join(__dirname,"fixtures/native-search/probe_mvbsz986-1.json"),"utf8"));

test("native evidence retains exact packet integrity and explicit observation limits", () => {
    assert.equal(evidence.rawPacketSha256,"81d2636019fa7f31a6f41bf8dc3a9d43f9b0e31db90e9f58d41e865a424a9e7f");
    assert.equal(crypto.createHash("sha256").update(evidence.rawPacket).digest("hex"),evidence.rawPacketSha256);
    assert.deepEqual(JSON.parse(evidence.rawPacket.slice("GRIMOIRE_TRACE_PROBE|".length)),evidence.report);
    assert.equal(evidence.report.fullModCoverage,false);
    assert.equal(evidence.report.nativeTraversalMeasured,false);
    assert.equal(evidence.report.searchOrder.distinctDuplicates,true);
    assert.ok(evidence.report.searchOrder.topology.every(row=>row.valid));
});

test("plain and instrumented searches match native duplicate selection and full class result order", () => {
    const doc=new Document(new Clock());
    const root=doc.root; root.id="GrimoireTraceProbeOrderRoot";root.AddClass("order");
    const named=new Map([[root.id,root]]);
    for(const row of evidence.report.searchOrder.topology){
        const panel=doc.create("Panel",{id:row.id,classes:["order"]});
        named.get(row.parent).addChild(panel);named.set(row.id,panel);
    }
    for(const [find,classes] of [[plainFind,plainClasses],[Panel.prototype.FindChildTraverse,Panel.prototype.FindChildrenWithClassTraverse]]){
        assert.equal(find.call(root,"GrimoireTraceProbeOrderDuplicate").GetParent().id,evidence.report.searchOrder.selectedParent);
        assert.deepEqual(classes.call(root,"order").map(panel=>({id:panel.id,parent:panel.GetParent().id})),evidence.report.searchOrder.classResult);
        const branch=root.addChild(doc.create("Panel",{id:"duplicateBranch"}));
        branch.addChild(doc.create("Panel",{id:"duplicate"}));
        const direct=root.addChild(doc.create("Panel",{id:"duplicate"}));
        assert.equal(find.call(root,"duplicate"),direct);
        branch.DeleteAsync(0);direct.DeleteAsync(0);doc.clock.advance(1);
    }
    let observed;
    const previous=counters.onClassTraverse;
    try{
        counters.enabled=true;counters.onClassTraverse=event=>{observed=event;};
        const results=root.FindChildrenWithClassTraverse("order");
        assert.deepEqual(observed.results,results);
        assert.equal(observed.visited,5);
    }finally{counters.enabled=false;counters.onClassTraverse=previous;}
});

test("native API shape does not expose an invented class getter or selector result", () => {
    const sandbox=new Sandbox();
    assert.equal(sandbox.eval("typeof $"),evidence.report.semantics.dollarType);
    assert.equal(sandbox.eval("typeof $.GetContextPanel().GetClasses"),evidence.report.semantics.getClassesType);
    sandbox.eval("try{$('#missing')}catch(e){}");
    assert.equal(sandbox.unsupportedCalls[0].operation,"$(...) selector");
});

test("saved profile comparisons reject old/different simulator semantics and caught unsupported calls", () => {
    const run={meta:{modelFingerprint:"model-a",treeSource:"captured",treeFingerprint:"tree",captureFidelity:{fingerprint:"capture"},configMode:"defaults",configFingerprint:"config",warmupMs:1000},enabledEnd:[]};
    assert.deepEqual(comparisonIssues(run,run),[]);
    const retired={...run,meta:{...run.meta,treeSource:"modelled"}};delete retired.meta.captureFidelity;
    assert.ok(comparisonIssues(retired,retired).some(issue=>issue.includes("captured hierarchy")));
    const missing={...run,meta:{...run.meta}};delete missing.meta.modelFingerprint;
    assert.ok(comparisonIssues(run,missing).some(issue=>issue.includes("modelFingerprint")));
    assert.ok(comparisonIssues(run,{...run,meta:{...run.meta,modelFingerprint:"model-b"}}).some(issue=>issue.includes("modelFingerprint")));
    assert.ok(comparisonIssues(run,{...run,meta:{...run.meta,unsupportedCalls:[{operation:"selector"}]}}).some(issue=>issue.includes("unsupported")));
});
