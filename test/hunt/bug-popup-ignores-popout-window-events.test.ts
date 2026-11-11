import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { eventTargetElement, eventTargetNode } from "../../src/editor/event-target";

// Bug: the footnote popup, opened on a note in a popped-out window, did not
// close on a click outside it or on Escape. Both page listeners asked
// "instanceof Element" and "instanceof Node" of what was clicked, and every
// window has classes of its own, so a node of a popped-out window is never
// an instance of the main window's Element. The handlers took the click
// for "not an element" and did nothing. Obsidian's own check,
// node.instanceOf(Element), asks the node's own window too.
//
// Found by eslint-plugin-obsidianmd 0.5.1's prefer-instanceof rule
// (2026-11-10); Jason chose to fix it now.
//
// The tests build two windows, each with its own Node and Element, and give
// Node the instanceOf of Obsidian 1.15.1's app.js: true when the node is an
// instance of the class itself, or of the class of the same name in the
// node's own window. An event's targetNode is its target, as in app.js.

type AnyClass = new () => object;

/** Obsidian's instanceOf: an instance of `type` itself, or of the class of that name in the node's own window. */
function isInstance(node: object, type: { name: string }, win: Record<string, unknown>): boolean {
    if (node instanceof (type as unknown as AnyClass)) return true;
    const own = win[type.name] as AnyClass | undefined;
    return !!own && node instanceof own;
}

/** A window of its own: fresh Node and Element classes, with Obsidian's instanceOf. */
function makeWindow() {
    const win: Record<string, unknown> = {};
    class Node {
        instanceOf(type: { name: string }): boolean {
            return isInstance(this, type, win);
        }
    }
    class Element extends Node {}
    win.Node = Node;
    win.Element = Element;
    return { Node, Element };
}

/** An event on `target`. Obsidian's targetNode is the target itself. */
function eventOn(target: unknown): UIEvent {
    const evt = { target, targetNode: target };
    return evt as unknown as UIEvent;
}

const main = makeWindow();
const popout = makeWindow();

describe("the popup's page listeners read events from every window", () => {
    // the plugin's code runs in the main window, so its Element and Node are the main window's
    beforeEach(() => {
        vi.stubGlobal("Element", main.Element);
        vi.stubGlobal("Node", main.Node);
    });
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("a click on an element of the main window is a click on that element", () => {
        const el = new main.Element();
        expect(eventTargetElement(eventOn(el))).toBe(el);
    });

    it("a click on an element of a popped-out window is a click on that element", () => {
        const el = new popout.Element();
        expect(eventTargetElement(eventOn(el))).toBe(el);
    });

    it("a key pressed on a node of a popped-out window is pressed on that node", () => {
        const node = new popout.Node();
        expect(eventTargetNode(eventOn(node))).toBe(node);
    });

    it("a click on a node that is not an element, in either window, is no element", () => {
        expect(eventTargetElement(eventOn(new main.Node()))).toBeNull();
        expect(eventTargetElement(eventOn(new popout.Node()))).toBeNull();
    });

    it("an event on nothing is on no node", () => {
        expect(eventTargetElement(eventOn(null))).toBeNull();
        expect(eventTargetNode(eventOn(null))).toBeNull();
    });
});
