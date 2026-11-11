/**
 * What a mouse or keyboard event happened on, for handlers that listen on a
 * whole page, such as the footnote popup's "click outside closes me".
 *
 * A note popped out into a window of its own lives on another page, and
 * every window has classes of its own: an element there is never an
 * instance of the main window's Element, so "instanceof Element" says no.
 * Obsidian's instanceOf() asks the node's own window as well, so these
 * checks work in every window (bug-popup-ignores-popout-window-events,
 * 2026-11-10).
 */

/** The element an event happened on, or null when it was not an element. */
export function eventTargetElement(evt: UIEvent): Element | null {
    const node = evt.targetNode;
    return node?.instanceOf(Element) ? node : null;
}

/**
 * The node an event happened on, or null when there was none. An event
 * heard on a page happened on that page or on a node inside it, and both
 * are nodes.
 */
export function eventTargetNode(evt: UIEvent): Node | null {
    return evt.targetNode;
}
