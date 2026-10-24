// scripts/simulator/perf/counters.js
// =============================================================================
// Attributed operation counters for the Panorama simulator.
// =============================================================================
// Counts supported replay operations by the active owner label. Native setter,
// traversal, allocation and rendering costs are unmeasured. Identical writes are
// classified by simulated value equality, not by assumed native invalidation.
//
// WEIGHTS are historical ranking estimates, not timings or engine contracts.
// Inspect raw counters alongside weighted totals; do not infer FPS from them.

"use strict";

const WEIGHTS = {
    traverseNode: 1,
    styleWriteChanged: 25,
    styleWriteRedundant: 20,
    classWriteChanged: 30,
    classWriteRedundant: 2,
    attrRead: 5,
    attrWrite: 5,
    attrByte: 0.02,
    textWriteChanged: 40,
    textWriteRedundant: 2,
    panelCreate: 400,
    panelDelete: 200,
};

const OP_KEYS = [
    "traverseCalls",
    "traverseNodes",
    "traverseMisses",
    "classTraverseCalls",
    "classTraverseNodes",
    "styleWritesChanged",
    "styleWritesRedundant",
    "classWritesChanged",
    "classWritesRedundant",
    "attrReads",
    "attrReadBytes",
    "attrWrites",
    "attrWriteBytes",
    "textWritesChanged",
    "textWritesRedundant",
    "panelCreates",
    "panelDeletes",
];

const UNATTRIBUTED = "<unattributed>";

function blankBucket() {
    const b = { label: "", calls: 0 };
    for (const k of OP_KEYS) b[k] = 0;
    return b;
}

class Counters {
    constructor() {
        this.enabled = false;
        this.buckets = new Map();       // label -> bucket
        this._stack = [];
        /**
         * Traversals that missed, keyed by the id searched for, with the node
         * count they burned. A miss is the single most valuable thing this
         * harness can surface: it means the mod is walking the entire HUD tree
         * to find a panel that is not there, every single tick. Usually the fix
         * is "cache the negative result" or "stop looking when not in a match".
         */
        this.missesById = new Map();    // id -> {count, nodes, labels:Set}
        /** Style properties written redundantly, keyed "label|prop". */
        this.redundantStyleProps = new Map();
    }

    reset() {
        this.buckets.clear();
        this._stack.length = 0;
        this.missesById.clear();
        this.redundantStyleProps.clear();
    }

    /** Current attribution label. */
    get label() {
        return this._stack.length > 0 ? this._stack[this._stack.length - 1] : UNATTRIBUTED;
    }

    enter(label) {
        this._stack.push(label);
    }

    exit() {
        this._stack.pop();
    }

    /**
     * Run `fn` attributed to `label`. Restores the stack even if `fn` throws,
     * because the mod's own error boundaries swallow exceptions and we must not
     * leak a label into the next feature's budget.
     */
    around(label, fn) {
        this._stack.push(label);
        try {
            return fn();
        } finally {
            this._stack.pop();
        }
    }

    bucket(label) {
        let b = this.buckets.get(label);
        if (!b) {
            b = blankBucket();
            b.label = label;
            this.buckets.set(label, b);
        }
        return b;
    }

    add(key, n = 1) {
        if (!this.enabled) return;
        const b = this.bucket(this.label);
        b[key] += n;
    }

    /** Record a completed id traversal. */
    recordTraverse(id, nodes, hit) {
        if (!this.enabled) return;
        const b = this.bucket(this.label);
        b.traverseCalls += 1;
        b.traverseNodes += nodes;
        if (!hit) {
            b.traverseMisses += 1;
            const key = String(id);
            let m = this.missesById.get(key);
            if (!m) {
                m = { id: key, count: 0, nodes: 0, labels: new Set() };
                this.missesById.set(key, m);
            }
            m.count += 1;
            m.nodes += nodes;
            m.labels.add(this.label);
        }
    }

    recordClassTraverse(nodes) {
        if (!this.enabled) return;
        const b = this.bucket(this.label);
        b.classTraverseCalls += 1;
        b.classTraverseNodes += nodes;
    }

    recordStyleWrite(prop, changed) {
        if (!this.enabled) return;
        const b = this.bucket(this.label);
        if (changed) {
            b.styleWritesChanged += 1;
            return;
        }
        b.styleWritesRedundant += 1;
        const key = this.label + "|" + prop;
        this.redundantStyleProps.set(key, (this.redundantStyleProps.get(key) || 0) + 1);
    }

    /** Composite cost for one bucket, in "visited node" units. See WEIGHTS. */
    static costOf(b) {
        return (
            (b.traverseNodes + b.classTraverseNodes) * WEIGHTS.traverseNode +
            b.styleWritesChanged * WEIGHTS.styleWriteChanged +
            b.styleWritesRedundant * WEIGHTS.styleWriteRedundant +
            b.classWritesChanged * WEIGHTS.classWriteChanged +
            b.classWritesRedundant * WEIGHTS.classWriteRedundant +
            b.attrReads * WEIGHTS.attrRead +
            b.attrWrites * WEIGHTS.attrWrite +
            (b.attrReadBytes + b.attrWriteBytes) * WEIGHTS.attrByte +
            b.textWritesChanged * WEIGHTS.textWriteChanged +
            b.textWritesRedundant * WEIGHTS.textWriteRedundant +
            b.panelCreates * WEIGHTS.panelCreate +
            b.panelDeletes * WEIGHTS.panelDelete
        );
    }

    /** Flat, JSON-serializable snapshot. `seconds` normalizes to per-second. */
    snapshot(seconds) {
        const secs = seconds > 0 ? seconds : 1;
        const rows = [];
        const total = blankBucket();
        total.label = "<TOTAL>";

        for (const b of this.buckets.values()) {
            for (const k of OP_KEYS) total[k] += b[k];
            total.calls += b.calls;
            const cost = Counters.costOf(b);
            rows.push({ ...b, costUnits: cost, costPerSec: cost / secs });
        }
        rows.sort((x, y) => y.costUnits - x.costUnits);

        const misses = Array.from(this.missesById.values())
            .map((m) => ({ id: m.id, count: m.count, nodes: m.nodes, labels: Array.from(m.labels) }))
            .sort((a, b) => b.nodes - a.nodes);

        const redundant = Array.from(this.redundantStyleProps.entries())
            .map(([key, count]) => {
                const cut = key.lastIndexOf("|");
                return { label: key.slice(0, cut), prop: key.slice(cut + 1), count };
            })
            .sort((a, b) => b.count - a.count);

        return {
            seconds: secs,
            total: { ...total, costUnits: Counters.costOf(total), costPerSec: Counters.costOf(total) / secs },
            rows,
            misses,
            redundantStyleProps: redundant,
            weights: WEIGHTS,
        };
    }
}

module.exports = { Counters, WEIGHTS, OP_KEYS, UNATTRIBUTED };
