
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Replaces the page favicon with the icon configured for this tab's container.
// Registered dynamically by background.js, only for origins the user granted.

;(async () => {
    let icon = await browser.runtime.sendMessage({ type: 'getContainerIcon' })
    if (!icon) return   // not a configured container

    const MARK_ATTR = 'data-ouic-container-icon'   // marks our own <link>
    let observer = null

    function apply() {
        let head = document.head
        if (!head) return

        // Mutating the head would re-trigger the observer, so stop listening
        // first; disconnect() also discards any already-queued records, which
        // is what keeps this from looping against a page that rewrites its own
        // favicon (SPAs do this constantly for unread badges).
        if (observer) observer.disconnect()
        try {
            // Drop the page's icons rather than merely appending ours. Firefox
            // picks the last <link rel="icon"> in document order, but a page
            // that appends a new one later would silently win.
            for (let link of head.querySelectorAll('link[rel~="icon"]')) {
                if (!link.hasAttribute(MARK_ATTR)) link.remove()
            }

            let ours = head.querySelector(`link[${MARK_ATTR}]`)
            if (!ours) {
                ours = document.createElement('link')
                ours.rel = 'icon'
                ours.setAttribute(MARK_ATTR, '1')
            }
            if (ours.getAttribute('href') !== icon) ours.setAttribute('href', icon)
            // Keep ours last so it wins regardless of how Firefox resolves ties.
            if (ours !== head.lastElementChild) head.appendChild(ours)
        } finally {
            if (observer) observer.observe(head, {
                childList: true, subtree: true,
                attributes: true, attributeFilter: ['href', 'rel'],
            })
        }
    }

    observer = new MutationObserver(apply)
    apply()
})()
