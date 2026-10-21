"use strict";
// Dispatch the native Button contract directly. No fabricated cursor API or
// JavaScript canvas picker: the simulator cannot establish native hit testing.
function begin(env, source, event = {}) {
    env.global.$.DispatchEvent("DragStart", source, event);
    return event.displayPanel;
}
function end(env, source, droppedPanel) {
    env.global.$.DispatchEvent("DragEnd", source, droppedPanel);
}
function startDrag(env, source) {
    const proxy = begin(env, source);
    if (!proxy) return proxy;
    const layer = env.em.addChild(env.doc.create("Panel", { id: "NativeDragLayer" }));
    layer.actualxoffset = 500; layer.actualyoffset = 300;
    proxy.SetParent(layer);
    proxy.actualxoffset = 350; proxy.actualyoffset = 220;
    env.clock.advance(1);
    return proxy;
}
module.exports = Object.assign(startDrag, { begin, end });
