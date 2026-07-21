
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

    let missed = []
    for (let pattern of wanted) {
        if (registered.has(pattern)) continue
        if (!await browser.permissions.contains({ origins: [pattern] })) {
            // Permission state can read back empty very early in startup, before
            // it has been restored from disk. Treat that as "try again", not as
            // "the user revoked it" — otherwise a cold start silently ends with
            // nothing registered and only a save from the options page (which
            // re-fires this via storage.onChanged) ever recovers it.
            missed.push(pattern)
            continue
        }
        try {
            registered.set(pattern, await browser.contentScripts.register({
                matches: [pattern],
                js: [{ file: '/favicon.js' }],
                // document_start, so the icon is in place before the page's own
                // scripts boot and set theirs. At document_idle the app has
                // already painted its favicon and the swap is visible.
                runAt: 'document_start',
                allFrames: false,
            }))
            injectIntoOpenTabs(pattern)
        } catch (e) {
            console.error(`open-url-in-container: could not register ${pattern}:`, e)
            missed.push(pattern)
        }
    }
    return missed
}

// contentScripts.register() only affects FUTURE navigations. Tabs that were
// already loaded — restored pinned tabs, or anything open when the icon was
// first configured — would keep the page's own favicon until manually
// reloaded, so inject into them directly.
async function injectIntoOpenTabs(pattern) {
    let tabs = []
    try { tabs = await browser.tabs.query({ url: pattern }) } catch (e) { return }
    for (let tab of tabs) {
        if (tab.discarded) continue
        browser.tabs.executeScript(tab.id, { file: '/favicon.js', runAt: 'document_idle' })
            .catch(() => { /* privileged page, or navigating; the registration covers it */ })
    }
}

// Retry a cold start until everything configured is actually registered.
// Bounded, and each pass is idempotent.
async function syncWithRetry(attempt = 0) {
    let missed = await syncRegistrations()
    if (!missed.length || attempt >= 5) {
        if (missed.length) {
            console.error('open-url-in-container: gave up registering', missed)
        }
        return
    }
    setTimeout(() => syncWithRetry(attempt + 1), 250 * Math.pow(2, attempt))
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
    if (area === 'local' && changes.containerIcons) syncWithRetry()
})
browser.permissions.onAdded.addListener(() => syncWithRetry())
browser.permissions.onRemoved.addListener(() => syncWithRetry())

// Script load alone is not enough. onStartup fires on a cold browser start,
// where the load-time pass can lose the race against permission state being
// read back from disk; onInstalled covers install and upgrade, where the
// previous version's registrations are already gone.
browser.runtime.onStartup.addListener(() => syncWithRetry())
browser.runtime.onInstalled.addListener(() => syncWithRetry())

syncWithRetry()
