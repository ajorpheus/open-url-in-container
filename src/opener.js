
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { parse, required, url, integer, boolean, fallback, oneOf, atLeastOneRequired} from './parser.js'

const hashPrefix = '#ext+container:'
const allowedContainerColors = ['blue', 'turquoise', 'green', 'yellow', 'orange', 'red', 'pink', 'purple']
const allowedContainerIcons = ['fingerprint', 'briefcase', 'dollar', 'cart', 'circle', 'gift', 'vacation', 'food', 'fruit', 'pet', 'tree', 'chill']


const schema = {
	// container params
	id: [],
	name: [],
	color: [fallback('yellow'), oneOf(allowedContainerColors)],
	icon: [fallback('fingerprint'), oneOf(allowedContainerIcons)],


	// url params
	url: [required, url],
	index: [integer],
	pinned: [boolean],
	openInReaderMode: [boolean],
	reuse: [boolean],
    
    // global validators
    __validators: [atLeastOneRequired(['id', 'name'])],
}

function error(e) {
	console.error(e)

	document.getElementById('errorBody').textContent = e;
	document.getElementById('errorPageContainer').classList.remove('hidden');
}

async function main() {
	let params, container;
	try {
		params = parseQuery()
	} catch(e) {
		error(`Error opening URL: ${e}.`)
		return
	}

	try {
		container = await getContainer(params)
	} catch (e) {
		error(`Error getting container: ${e}.`)
		return
	}
	
	if (!container) {
		try {
			container = await createContainer(params)
		} catch (e) {
			error(`Error creating container: ${e}.`)
			return 
		}
	}

	try {
		await newTab(container, params)
	} catch (e) {
		error(`Error creating new tab: ${e}.`)
		return
	}
}

function parseQuery() {
	let hash = decodeURIComponent(window.location.hash)
	if (!hash.startsWith(hashPrefix)) {
		throw('cannot parse url')
	}

	let query = hash.substr(hashPrefix.length)
	let params = parse(query, schema)

	return params
}

async function getContainer(params) {
	if (params.id) {
		return await browser.contextualIdentities.get(params.id)
	}
	
	let containers = await browser.contextualIdentities.query({
		name: params.name,
	})
	return containers[0]
}

async function createContainer(params) {
	return await browser.contextualIdentities.create({
		name: params.name,
		color: params.color,
		icon: params.icon,
	})
}

// Strip the fragment so single-page apps that rewrite location.hash after
// load still match the URL they were originally opened with.
function stripHash(u) {
	try {
		let parsed = new URL(u)
		parsed.hash = ''
		return parsed.toString()
	} catch (e) {
		return u
	}
}

// Find an already-open tab for this URL within the same container.
async function findExistingTab(container, params) {
	let tabs = await browser.tabs.query({ cookieStoreId: container.cookieStoreId })
	let wanted = stripHash(params.url)

	return tabs.find(t => t.url && stripHash(t.url) === wanted)
}

async function newTab(container, params) {
	let browserInfo = await browser.runtime.getBrowserInfo()
	let currentTab = await browser.tabs.getCurrent()

	// With reuse=true, focus a matching tab in this container instead of
	// opening a duplicate. Useful for OS-level launchers (dock icons, shortcuts)
	// that fire the same URL on every activation.
	if (params.reuse) {
		let existing = await findExistingTab(container, params)

		if (existing && existing.id !== currentTab.id) {
			await browser.tabs.update(existing.id, { active: true })

			if (existing.windowId !== undefined) {
				await browser.windows.update(existing.windowId, { focused: true })
			}

			await browser.tabs.remove(currentTab.id)
			return
		}
	}

	let createTabParams = {
		cookieStoreId: container.cookieStoreId,
		url: params.url,
		index: params.index,
		pinned: params.pinned,
	}

	if (browserInfo.version >= 58) {
		createTabParams.openInReaderMode = params.openInReaderMode
	} else {
		console.warn('openInReaderMode parameter is not supported in Firefox < 58')
	}

	await browser.tabs.create(createTabParams)
	await browser.tabs.remove(currentTab.id)
}

main()
