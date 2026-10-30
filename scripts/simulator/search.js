"use strict";

// Native controlled result ordering, verified on October 17, 2026:
// inspect direct children before recursively visiting each child branch.
// This is a model traversal, not a measurement of native engine steps.
function* descendants(root) {
    const parents = [root];
    while (parents.length) {
        const children = parents.pop()._children;
        for (const child of children) yield child;
        for (let i = children.length - 1; i >= 0; i--) parents.push(children[i]);
    }
}
module.exports = { descendants };
