
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const ICON_PX = 64          // favicons render at 16-32px; 64 covers HiDPI
const MAX_UPLOAD = 2 * 1024 * 1024

let statusEl = document.getElementById('status')
let statusTimer = null

function status(text, kind) {
    statusEl.textContent = text
    statusEl.className = `status ${kind || ''}`
    clearTimeout(statusTimer)
    if (text) statusTimer = setTimeout(() => status(''), 6000)
}

async function loadConfig() {
    let { containerIcons } = await browser.storage.local.get('containerIcons')
    return containerIcons || {}
}

// Downscale to a square PNG data URI. Storing the original would put a
// multi-hundred-KB string into storage and into every page we inject.
function toIconDataURL(file) {
    return new Promise((resolve, reject) => {
        if (file.size > MAX_UPLOAD) return reject(new Error('image is larger than 2 MB'))
        let reader = new FileReader()
        reader.onerror = () => reject(new Error('could not read the file'))
        reader.onload = () => {
            let img = new Image()
            img.onerror = () => reject(new Error('that file is not a readable image'))
            img.onload = () => {
                let canvas = document.createElement('canvas')
                canvas.width = canvas.height = ICON_PX
                let ctx = canvas.getContext('2d')
                // Fit, don't stretch — non-square source keeps its aspect ratio.
                let scale = Math.min(ICON_PX / img.width, ICON_PX / img.height)
                let w = img.width * scale, h = img.height * scale
                ctx.drawImage(img, (ICON_PX - w) / 2, (ICON_PX - h) / 2, w, h)
                resolve(canvas.toDataURL('image/png'))
            }
            img.src = reader.result
        }
        reader.readAsDataURL(file)
    })
}

// Best-effort default for the "Apply on" pattern: the origin of a tab already
// open in this container, so the common case needs no typing.
async function suggestMatch(cookieStoreId) {
    try {
        let tabs = await browser.tabs.query({ cookieStoreId })
        for (let tab of tabs) {
            if (!tab.url) continue
            let u = new URL(tab.url)
            if (u.protocol === 'http:' || u.protocol === 'https:') return `${u.origin}/*`
        }
    } catch (e) { /* fall through */ }
    return ''
}

function validMatch(pattern) {
    return /^https?:\/\/[^/*]+\/\*$/.test(pattern) || /^https?:\/\/[^/]+\/.*$/.test(pattern)
}

async function render() {
    let [containers, config] = await Promise.all([
        browser.contextualIdentities.query({}),
        loadConfig(),
    ])

    let tbody = document.getElementById('rows')
    tbody.textContent = ''

    if (!containers.length) {
        let tr = tbody.insertRow()
        let td = tr.insertCell()
        td.colSpan = 4
        td.className = 'empty-note'
        td.textContent = 'No containers exist yet. Create one in Firefox first.'
        return
    }

    for (let c of containers) {
        let cfg = config[c.cookieStoreId] || {}
        let tr = tbody.insertRow()

        let nameCell = tr.insertCell()
        nameCell.className = 'name'
        let swatch = document.createElement('span')
        swatch.className = 'swatch'
        swatch.style.background = c.colorCode
        nameCell.append(swatch, document.createTextNode(c.name))

        let iconCell = tr.insertCell()
        let preview = document.createElement('img')
        preview.className = cfg.icon ? 'preview' : 'preview empty'
        if (cfg.icon) preview.src = cfg.icon
        preview.alt = ''
        iconCell.append(preview)

        let matchCell = tr.insertCell()
        let match = document.createElement('input')
        match.type = 'text'
        match.placeholder = 'https://example.com/*'
        match.value = cfg.match || await suggestMatch(c.cookieStoreId)
        matchCell.append(match)

        let actions = tr.insertCell()
        actions.className = 'actions'
        let file = document.createElement('input')
        file.type = 'file'
        file.accept = 'image/*'
        let choose = document.createElement('button')
        choose.className = 'primary'
        choose.textContent = cfg.icon ? 'Replace…' : 'Choose…'
        let clear = document.createElement('button')
        clear.textContent = 'Clear'
        clear.disabled = !cfg.icon
        actions.append(file, choose, clear)

        choose.addEventListener('click', async () => {
            let pattern = match.value.trim()
            if (!validMatch(pattern)) {
                return status('Enter a site pattern first, e.g. https://web.whatsapp.com/*', 'err')
            }
            // permissions.request() must be the first thing the click handler
            // does — awaiting the file read first would spend the user gesture
            // and Firefox would reject the prompt.
            let granted
            try {
                granted = await browser.permissions.request({ origins: [pattern] })
            } catch (e) {
                return status(`That site pattern was rejected: ${e.message}`, 'err')
            }
            if (!granted) return status('Permission declined — icon not set.', 'err')
            file.value = ''
            file.click()
        })

        file.addEventListener('change', async () => {
            let chosen = file.files && file.files[0]
            if (!chosen) return
            try {
                let icon = await toIconDataURL(chosen)
                let config = await loadConfig()
                config[c.cookieStoreId] = { icon, match: match.value.trim() }
                await browser.storage.local.set({ containerIcons: config })
                status(`Icon set for ${c.name}. Reload the tab to see it.`, 'ok')
                render()
            } catch (e) {
                status(`Could not use that image: ${e.message}`, 'err')
            }
        })

        clear.addEventListener('click', async () => {
            let config = await loadConfig()
            let pattern = config[c.cookieStoreId] && config[c.cookieStoreId].match
            delete config[c.cookieStoreId]
            await browser.storage.local.set({ containerIcons: config })
            // Hand back the host permission if no other container still needs it.
            if (pattern && !Object.values(config).some(x => x.match === pattern)) {
                try { await browser.permissions.remove({ origins: [pattern] }) } catch (e) { /* best effort */ }
            }
            status(`Icon cleared for ${c.name}. Reload the tab to see it.`, 'ok')
            render()
        })
    }
}

render()
