function createId(prefix) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const rand = Math.random().toString(16).slice(2, 10)
  return `${prefix}_${stamp}_${rand}`
}

async function getItems() {
  const res = await chrome.storage.local.get(['x_scraper_items'])
  return Array.isArray(res.x_scraper_items) ? res.x_scraper_items : []
}

async function setItems(items) {
  await chrome.storage.local.set({ x_scraper_items: items })
}

function safeRuntimeBroadcast(message) {
  try {
    chrome.runtime.sendMessage(message, () => {
      void chrome.runtime.lastError
    })
  } catch (e) { }
}

async function openDashboard() {
  const url = chrome.runtime.getURL('dashboard.html')
  const tabs = await chrome.tabs.query({ url })
  if (tabs && tabs.length > 0) {
    const t = tabs[0]
    if (t.id) await chrome.tabs.update(t.id, { active: true })
    return
  }
  await chrome.tabs.create({ url })
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const type = msg && msg.type

  if (type === 'X_SCRAPER_OPEN_DASHBOARD') {
    openDashboard()
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: String(e && e.message ? e.message : e) }))
    return true
  }

  if (type === 'X_SCRAPER_SAVE_ITEMS') {
    const sourceUrl = typeof msg.sourceUrl === 'string' ? msg.sourceUrl : ''
    const mainTweetUrl = typeof msg.mainTweetUrl === 'string' ? msg.mainTweetUrl : null
    const incoming = Array.isArray(msg.items) ? msg.items : []
    const capturedAt = new Date().toISOString()

    getItems()
      .then(async (existing) => {
        const next = existing.slice()
        const newItems = []
        for (const it of incoming) {
          const incomingUrl = it.tweet.url || ''
          const incomingId = it.tweet.id || ''

          // 1. Logic to merge reply into existing main tweet
          let handled = false
          if (mainTweetUrl && incomingUrl) {
            // Try to find the parent item
            const parentIndex = next.findIndex(x => x.tweet.url && x.tweet.url.includes(mainTweetUrl))

            if (parentIndex >= 0) {
              // Check if this incoming item is the parent itself (Update/Dedupe)
              if (incomingUrl.includes(mainTweetUrl)) {
                // It is the main tweet. It already exists. Do nothing or update?
                handled = true
              } else {
                // It is a REPLY. Merge it.
                const parent = next[parentIndex]
                const replyExists = (parent.replies || []).some(r => r.id === it.tweet.id || (r.text === it.tweet.text && r.authorHandle === it.tweet.authorHandle))

                if (!replyExists) {
                  const replyObj = {
                    id: it.tweet.id,
                    authorName: it.tweet.authorName,
                    authorHandle: it.tweet.authorHandle,
                    publishedAt: it.tweet.publishedAt,
                    text: it.tweet.text,
                    images: it.tweet.images
                  }
                  const newReplies = [...(parent.replies || []), replyObj]
                  next[parentIndex] = { ...parent, replies: newReplies }
                }
                handled = true
              }
            }
          }

          if (handled) continue

          // 2. Check if this tweet already exists (by URL or ID)
          const existingIndex = next.findIndex(x => {
            if (incomingUrl && x.tweet.url === incomingUrl) return true
            if (incomingId && x.tweet.id === incomingId) return true
            return false
          })

          if (existingIndex >= 0) {
            // Tweet already exists, merge replies
            const existing = next[existingIndex]
            const incomingReplies = Array.isArray(it.replies) ? it.replies : (Array.isArray(it.comments) ? it.comments : [])

            if (incomingReplies.length > 0) {
              const existingReplies = existing.replies || []
              const mergedReplies = [...existingReplies]

              for (const newReply of incomingReplies) {
                const replyExists = mergedReplies.some(r =>
                  r.id === newReply.id ||
                  (r.text === newReply.text && r.authorHandle === newReply.authorHandle)
                )
                if (!replyExists) {
                  mergedReplies.push(newReply)
                }
              }

              next[existingIndex] = { ...existing, replies: mergedReplies }
            }
            handled = true
            continue
          }

          // 3. This is a new tweet, add it
          const item = {
            id: createId('item'),
            sourceUrl,
            capturedAt,
            tweet: it.tweet || it,
            replies: Array.isArray(it.replies) ? it.replies : (Array.isArray(it.comments) ? it.comments : []),
          }
          newItems.push(item)
        }
        // Unshift in reverse so DOM order is preserved (first selected = first in list)
        for (let i = newItems.length - 1; i >= 0; i--) {
          next.unshift(newItems[i])
        }
        await setItems(next)
        await openDashboard()
        safeRuntimeBroadcast({ type: 'X_SCRAPER_ITEMS_UPDATED' })
        sendResponse({ ok: true, count: next.length })
      })
      .catch((e) => sendResponse({ ok: false, error: String(e && e.message ? e.message : e) }))

    return true
  }

  return false
})

chrome.action.onClicked.addListener(() => {
  openDashboard()
})
