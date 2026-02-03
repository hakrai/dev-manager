// background.js (Chrome Extension Manifest V3 service worker)
// - Opens DevManager in a new tab when the extension icon is clicked
// - Shows a badge timer (minutes/hours) for Pomodoro (work vs break colors)
// - Falls back to Clockify elapsed badge if no Pomodoro is running (requires host permissions)

/* global chrome */

const BADGE_ALARM = 'devmanager-badge-tick';
let _clockifyUserIdCache = null;

function pChromeGet(keys) {
    return new Promise((resolve) => {
        try {
            chrome.storage.local.get(keys, (res) => resolve(res || {}));
        } catch {
            resolve({});
        }
    });
}

function pFetch(url, options) {
    return fetch(url, options);
}

function formatBadgeTime(ms) {
    const totalMin = Math.max(0, Math.floor(ms / 60000));
    if (totalMin < 60) return String(totalMin);
    const h = Math.floor(totalMin / 60);
    const m = String(totalMin % 60).padStart(2, '0');
    return `${h}:${m}`;
}

async function setBadge({ text = '', color = '#64748b' } = {}) {
    try {
        await chrome.action.setBadgeBackgroundColor({ color });
        await chrome.action.setBadgeText({ text });
    } catch {
        // ignore
    }
}

function computePomodoroRemaining(active) {
    const now = Date.now();
    const pausedMs = (active.accumulatedPausedMs || 0) + (active.paused && active.pausedAt ? (now - active.pausedAt) : 0);
    const elapsed = (now - active.startTime) - pausedMs;
    return Math.max(0, (active.duration || 0) - elapsed);
}

async function clockifyGetUserId(apiKey) {
    if (_clockifyUserIdCache) return _clockifyUserIdCache;
    const resp = await pFetch('https://api.clockify.me/api/v1/user', {
        headers: { 'X-Api-Key': apiKey }
    });
    if (!resp.ok) throw new Error('Clockify user fetch failed');
    const user = await resp.json();
    _clockifyUserIdCache = user?.id || null;
    return _clockifyUserIdCache;
}

async function clockifyGetInProgress(apiKey, workspaceId, userId) {
    const url = `https://api.clockify.me/api/v1/workspaces/${workspaceId}/user/${userId}/time-entries?in-progress=true`;
    const resp = await pFetch(url, { headers: { 'X-Api-Key': apiKey } });
    if (!resp.ok) throw new Error('Clockify active entry fetch failed');
    const entries = await resp.json();
    return Array.isArray(entries) ? entries[0] : null;
}

async function updateBadgeFromStorage() {
    const data = await pChromeGet(['pomodoro_active', 'clockify_key', 'clockify_workspace_id']);
    const p = data.pomodoro_active;

    // Prefer Pomodoro badge
    if (p && p.startTime && p.duration) {
        const remaining = computePomodoroRemaining(p);
        const text = formatBadgeTime(remaining);
        const isWork = (p.phase || 'work') === 'work';
        const isBreak = !isWork;

        // Colors: work = red, break = blue, paused = gray
        const color = p.paused
            ? '#6b7280'
            : (isWork ? '#ef4444' : '#3b82f6');

        await setBadge({ text, color });
        return;
    }

    // Otherwise try Clockify elapsed badge
    const apiKey = data.clockify_key;
    const workspaceId = data.clockify_workspace_id;

    if (apiKey && workspaceId) {
        try {
            const userId = await clockifyGetUserId(apiKey);
            if (!userId) throw new Error('No Clockify user id');
            const entry = await clockifyGetInProgress(apiKey, workspaceId, userId);
            if (entry?.timeInterval?.start) {
                const start = new Date(entry.timeInterval.start).getTime();
                const elapsed = Math.max(0, Date.now() - start);
                await setBadge({ text: formatBadgeTime(elapsed), color: '#0ea5e9' });
                return;
            }
        } catch {
            // ignore clockify errors
        }
    }

    // Nothing running
    await setBadge({ text: '', color: '#64748b' });
}

// Open app in a new tab when clicking the extension action.
// NOTE: This requires manifest.json action WITHOUT default_popup.
chrome.action?.onClicked?.addListener(() => {
    try {
        chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
    } catch {
        // ignore
    }
});

chrome.runtime.onInstalled.addListener(() => {
    try {
        chrome.alarms.create(BADGE_ALARM, { periodInMinutes: 1 });
    } catch {
        // ignore
    }
    updateBadgeFromStorage().catch(() => { });
});

chrome.alarms?.onAlarm?.addListener((alarm) => {
    if (alarm?.name === BADGE_ALARM) {
        updateBadgeFromStorage().catch(() => { });
    }
});

// Optional: page can force a badge refresh
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === 'devmanager-badge-refresh') {
        updateBadgeFromStorage().then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
        return true;
    }
    sendResponse({ ok: false });
    return false;
});
