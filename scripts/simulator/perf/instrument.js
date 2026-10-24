// scripts/simulator/perf/instrument.js
// =============================================================================
// Patches selected simulator Panel/Document operations for attributed counts.
// This is partial API coverage, not all engine-facing work; see READ_COVERAGE.
// =============================================================================
// This monkey-patches the classes exported by ../panel.js rather than
// subclassing them, because ../index.js constructs Panels internally and we want
// the instrumentation to be invisible to the mod, the game model and the
// existing behavioral tests. Node's module cache makes the patch global for the
// process, so `install()` is idempotent and the counters are inert until
// `counters.enabled` is set.
//
// FIDELITY NOTE: the node counts here come from the simulator's own tree, so
// they are only as realistic as that tree. hud_tree.js imports the supplied
// native capture; it does not compose XML or seed synthetic native panels.
// Absolute numbers describe modeled operations only. Before/after deltas require the
// same inputs and coverage; they do not establish ratios of native CPU cost.
// =============================================================================

"use strict";

const { Panel, Document } = require("../panel.js");
const { descendants } = require("../search.js");
const { Counters } = require("./counters.js");

const counters = new Counters();
let _installed = false;
const PANEL_READ_PROPERTIES = ["visible", "enabled", "actuallayoutwidth", "actuallayoutheight", "actualxoffset", "actualyoffset"];
const READ_COVERAGE = {
    styleReads: "String-key panel.style[property] gets; panel.style itself and setter comparisons are excluded",
    classReads: ["BHasClass"],
    propertyReads: ["text", ...PANEL_READ_PROPERTIES],
    aggregation: "Owner/kind/property (class name for BHasClass), pooled across panels; no panel identity or repeated-value evidence",
    unavailable: ["native getter/setter cost and CSS normalization", "unlisted panel properties/APIs", "color computation and other pure JavaScript work", "visual changes, layout, frame times and FPS"],
};

/** Count model visits using the same search order as the plain simulator. */
function walkCount(root, id) {
    let visited = 0;
    for (const node of descendants(root)) {
        visited++;
        if (node.id === id) return { found: node, visited };
    }
    return { found: null, visited };
}

function install() {
    if (_installed) return counters;
    _installed = true;

    // ── Tree traversal ────────────────────────────────────────────────────
    Panel.prototype.FindChildTraverse = function (id) {
        this._assertValid("FindChildTraverse");
        if (!id) return null;
        const { found, visited } = walkCount(this, id);
        counters.recordTraverse(id, visited, !!found);
        if (counters.enabled && typeof counters.onTraverse === "function") {
            counters.onTraverse({
                type: "FindChildTraverse",
                target: id,
                label: counters.label,
                rootPanel: this,
                found,
                visited
            });
        }
        return found;
    };

    Panel.prototype.FindChildrenWithClassTraverse = function (className) {
        this._assertValid("FindChildrenWithClassTraverse");
        if (!className) return [];
        const out = [];
        let visited = 0;
        for (const node of descendants(this)) {
            visited++;
            if (node._classes.has(className)) out.push(node);
        }
        counters.recordClassTraverse(visited);
        if (counters.enabled && typeof counters.onClassTraverse === "function") {
            counters.onClassTraverse({
                type: "FindChildrenWithClassTraverse",
                target: className,
                label: counters.label,
                rootPanel: this,
                matches: out.length,
                results: out.slice(),
                found: out[0] || null,
                visited
            });
        }
        return out;
    };

    // FindChild is a direct-children scan — cheap, but still worth counting so a
    // feature that scans 12 player panels' children every tick shows up.
    Panel.prototype.FindChild = function (id) {
        this._assertValid("FindChild");
        let visited = 0;
        let res = null;
        for (const child of this._children) {
            visited++;
            if (child.id === id) { res = child; break; }
        }
        counters.recordTraverse(id, visited, !!res);
        if (counters.enabled && typeof counters.onFindChild === "function") {
            counters.onFindChild({
                type: "FindChild",
                target: id,
                label: counters.label,
                rootPanel: this,
                found: res,
                visited
            });
        }
        return res;
    };

    // ── Classes ───────────────────────────────────────────────────────────
    const origHasClass = Panel.prototype.BHasClass;
    Panel.prototype.BHasClass = function (className) {
        counters.recordRead("classReads", typeof className === "string" ? className : "<non-string>");
        return origHasClass.call(this, className);
    };

    Panel.prototype.AddClass = function (className) {
        this._assertValid("AddClass");
        if (!className) return;
        const had = this._classes.has(className);
        counters.add(had ? "classWritesRedundant" : "classWritesChanged", 1);
        this._classes.add(className);
    };

    Panel.prototype.RemoveClass = function (className) {
        this._assertValid("RemoveClass");
        const had = this._classes.has(className);
        counters.add(had ? "classWritesChanged" : "classWritesRedundant", 1);
        this._classes.delete(className);
    };

    // SetHasClass must not double-count through AddClass/RemoveClass.
    Panel.prototype.SetHasClass = function (className, has) {
        this._assertValid("SetHasClass");
        if (!className) return;
        const had = this._classes.has(className);
        const want = !!has;
        counters.add(had === want ? "classWritesRedundant" : "classWritesChanged", 1);
        if (want) this._classes.add(className);
        else this._classes.delete(className);
    };
    // ToggleClass's model implementation calls BHasClass internally. Native
    // ToggleClass is one setter call, not a production BHasClass request.
    Panel.prototype.ToggleClass = function (className) {
        this._assertValid("ToggleClass");
        this.SetHasClass(className, !this._classes.has(className));
    };

    // ── Attributes ────────────────────────────────────────────────────────
    Panel.prototype.GetAttributeString = function (key, fallback) {
        this._assertValid("GetAttributeString");
        const has = this._attrs.has(key);
        const value = has ? String(this._attrs.get(key)) : (typeof fallback === "undefined" ? "" : fallback);
        counters.add("attrReads", 1);
        counters.add("attrReadBytes", typeof value === "string" ? value.length : 0);
        return value;
    };

    Panel.prototype.SetAttributeString = function (key, value) {
        this._assertValid("SetAttributeString");
        const str = String(value);
        counters.add("attrWrites", 1);
        counters.add("attrWriteBytes", str.length);
        this._attrs.set(key, str);
    };

    // ── Text ──────────────────────────────────────────────────────────────
    // `text` is a plain data property on the unpatched Panel. Convert it to an
    // accessor so assignment is observable. The backing field is `_text` and the
    // constructor's `this.text = text` runs through the setter, which is fine.
    Object.defineProperty(Panel.prototype, "text", {
        configurable: true,
        get() {
            counters.recordRead("propertyReads", "text");
            return this._text === undefined ? "" : this._text;
        },
        set(v) {
            const next = v === undefined || v === null ? "" : String(v);
            const changed = this._text !== next;
            // Counting the constructor's initial assignment would charge tree
            // construction to whoever happens to be on the stack; skip it.
            if (this._textInit) {
                counters.add(changed ? "textWritesChanged" : "textWritesRedundant", 1);
            }
            this._textInit = true;
            this._text = next;
        },
    });

    for (const property of PANEL_READ_PROPERTIES) {
        Object.defineProperty(Panel.prototype, property, {
            configurable: true,
            get() {
                counters.recordRead("propertyReads", property);
                return this["_prof_" + property];
            },
            set(value) { this["_prof_" + property] = value; },
        });
    }

    // ── Style ─────────────────────────────────────────────────────────────
    // The unpatched Panel exposes `style` as a plain object. Swap it for a Proxy
    // that traps reads/writes so we can separate changed from redundant. Created lazily
    // per panel: most panels in a 4000-node tree are never styled by the mod, and
    // a Proxy each would be pure harness overhead.
    Object.defineProperty(Panel.prototype, "style", {
        configurable: true,
        get() {
            if (this._styleProxy) return this._styleProxy;
            const store = this._styleStore || (this._styleStore = {});
            this._styleProxy = new Proxy(store, {
                get(target, prop, receiver) {
                    if (typeof prop === "string") counters.recordRead("styleReads", prop);
                    // Fixture proxies can wrap an earlier instrumented style.
                    // Count the outer request once, not nested model traps.
                    return silently(() => Reflect.get(target, prop, receiver));
                },
                set(target, prop, value) {
                    const next = value === undefined || value === null ? "" : String(value);
                    const changed = silently(() => target[prop] !== next);
                    counters.recordStyleWrite(String(prop), changed);
                    silently(() => { target[prop] = next; });
                    return true;
                },
                deleteProperty(target, prop) {
                    // ClearStyleSafe's `delete panel.style.x` path. Treat as a
                    // write: the engine recomputes the cascaded value.
                    const had = Object.prototype.hasOwnProperty.call(target, prop);
                    counters.recordStyleWrite(String(prop) + ":clear", had);
                    silently(() => { delete target[prop]; });
                    return true;
                },
            });
            return this._styleProxy;
        },
        set(v) {
            // Panel's constructor does `this.style = {}`; honour that by seeding
            // the backing store rather than replacing the accessor.
            this._styleStore = v && typeof v === "object" ? v : {};
            this._styleProxy = null;
        },
    });

    // ── Panel churn ───────────────────────────────────────────────────────
    const origCreate = Document.prototype.create;
    Document.prototype.create = function (type, opts) {
        counters.add("panelCreates", 1);
        return origCreate.call(this, type, opts);
    };

    const origDestroy = Panel.prototype._destroy;
    Panel.prototype._destroy = function () {
        counters.add("panelDeletes", 1);
        return origDestroy.call(this);
    };

    return counters;
}

/**
 * Build a tree without charging its construction to anyone. The tree builder
 * creates thousands of panels and would otherwise dwarf every real finding.
 */
function silently(fn) {
    const was = counters.enabled;
    counters.enabled = false;
    try {
        return fn();
    } finally {
        counters.enabled = was;
    }
}

module.exports = { install, counters, silently, walkCount, READ_COVERAGE };
