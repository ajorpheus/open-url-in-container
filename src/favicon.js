
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Replaces the page favicon with the icon configured for this tab's container.
// Registered dynamically by background.js, only for origins the user granted.

;(async () => {
    let icon = await browser.runtime.sendMessage({ type: 'getContainerIcon' })
    if (!icon) return   // not a configured container

    const MARK = 'data-ouic-container-icon'   // marks our own <link>
    const started = performance.now()
    let observer = null
    let overwrites = 0

    function apply() {
        let head = document.head
        if (!head) return   // document_start: wait for the observer to see it appear

        // Mutating the DOM would re-trigger the observer, so stop listening
        // first; disconnect() also discards already-queued records, which is
        // what keeps this from looping against a page that rewrites its own
        // favicon (any SPA with an unread badge does).
        if (observer) observer.disconnect()
        try {
            // Drop the page's icons rather than merely appending ours. Firefox
            // resolves competing <link rel="icon"> by document order, so a page
            // that appends one later would silently win.
            let theirs = head.querySelectorAll(`link[rel~="icon"]:not([${MARK}])`)
            for (let link of theirs) link.remove()
            if (theirs.length && ++overwrites > 1) {
                // Only interesting after the first pass — the first is just the
                // page's static markup, later ones are the app fighting back.
                console.debug('open-url-in-container: page reset its favicon ' +
                              `(${overwrites - 1}x, ${Math.round(performance.now() - started)}ms in)`)
            }

            let ours = head.querySelector(`link[${MARK}]`)
            if (!ours) {
                ours = document.createElement('link')
                ours.setAttribute('rel', 'icon')
                ours.setAttribute(MARK, '1')
            }
            if (ours.getAttribute('href') !== icon) ours.setAttribute('href', icon)
            // Keep ours last so it wins on document order regardless.
            if (ours !== head.lastElementChild) head.appendChild(ours)
        } finally {
            if (observer) {
                // Watch the whole document, not just head: a page that replaces
                // <head> outright would otherwise leave the observer bound to a
                // detached node and silently stop firing.
                observer.observe(document.documentElement, {
                    childList: true, subtree: true,
                    attributes: true, attributeFilter: ['href', 'rel'],
                })
            }
        }
    }

    function start() {
        observer = new MutationObserver(apply)
        apply()
    }

    // At document_start <html> may not exist yet, and there is nothing to
    // observe until it does.
    if (document.documentElement) start()
    else document.addEventListener('readystatechange', function once() {
        if (!document.documentElement) return
        document.removeEventListener('readystatechange', once)
        start()
    })
})()
