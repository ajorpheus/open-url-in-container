
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Per-container tab icons.
//
// There is no WebExtension API to set a tab's favicon, so the only route is a
// content script that rewrites <link rel="icon"> in the page (the same
// mechanism sites use themselves to show unread badges). That needs host
// permission, which a URL-routing extension has no business holding by
// default — so nothing here is registered until the user configures a
// container in the options page and grants that one origin.
//
// Config shape in storage.local:
//   containerIcons: {
//     "firefox-container-6": { icon: "data:image/png;base64,...", match: "https://web.whatsapp.com/*" }
//   }

const registered = new Map()   // match pattern -> RegisteredContentScript

async function loadConfig() {
    let { containerIcons } = await browser.storage.local.get('containerIcons')
    return containerIcons || {}
}

// Register a content script for every configured pattern we actually hold
// permission for, and drop registrations that are no longer wanted or whose
// permission was revoked. Safe to call repeatedly.
async function syncRegistrations() {
    let config = await loadConfig()

    let wanted = new Set()
    for (let cfg of Object.values(config)) {
        if (cfg && cfg.icon && cfg.match) wanted.add(cfg.match)
    }

    for (let [pattern, reg] of registered) {
        if (wanted.has(pattern) && await browser.permissions.contains({ origins: [pattern] })) continue
        try { await reg.unregister() } catch (e) { /* already gone */ }
        registered.delete(pattern)
    }

    for (let pattern of wanted) {
        if (registered.has(pattern)) continue
        if (!await browser.permissions.contains({ origins: [pattern] })) continue
        try {
            registered.set(pattern, await browser.contentScripts.register({
                matches: [pattern],
                js: [{ file: '/favicon.js' }],
                runAt: 'document_idle',
                allFrames: false,
            }))
        } catch (e) {
            console.error(`open-url-in-container: could not register ${pattern}:`, e)
        }
    }
}

// The content script cannot see its own container, so it asks. sender.tab is
// trustworthy here in a way a message payload would not be.
browser.runtime.onMessage.addListener((msg, sender) => {
    if (!msg || msg.type !== 'getContainerIcon') return
    return loadConfig().then(config => {
        let cfg = sender.tab && config[sender.tab.cookieStoreId]
        return (cfg && cfg.icon) || null
    })
})

browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.containerIcons) syncRegistrations()
})
browser.permissions.onAdded.addListener(syncRegistrations)
browser.permissions.onRemoved.addListener(syncRegistrations)

syncRegistrations()
