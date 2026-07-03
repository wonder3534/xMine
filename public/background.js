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

  if (type === 'X_SCRAPER_FETCH_NOTE') {
    const { noteUrl, sourceUrl, requestId } = msg
    const senderTabId = (sender.tab && sender.tab.id) ? sender.tab.id : null

    const TIMEOUT_MS = 15000
    let bgTabId = null
    let timedOut = false

    ;(async () => {
      try {
        // 后台静默打开目标 tab，不夺取焦点
        const tab = await chrome.tabs.create({ url: noteUrl, active: false })
        bgTabId = tab.id

        // 超时保护：15 秒后强制关闭后台 tab 并回传错误
        const timeoutHandle = setTimeout(async () => {
          timedOut = true
          if (bgTabId !== null) {
            try { await chrome.tabs.remove(bgTabId) } catch {}
            bgTabId = null
          }
          if (senderTabId) {
            try {
              chrome.tabs.sendMessage(senderTabId, {
                type: 'X_SCRAPER_NOTE_RESULT',
                requestId,
                ok: false,
                error: '抓取超时（15秒），请检查网络连接后重试'
              })
            } catch {}
          }
        }, TIMEOUT_MS)

        // 等待 tab 加载完成（status === 'complete'）
        await new Promise((resolve) => {
          function onUpdated(tabId, changeInfo) {
            if (tabId === bgTabId && changeInfo.status === 'complete') {
              chrome.tabs.onUpdated.removeListener(onUpdated)
              resolve()
            }
          }
          chrome.tabs.onUpdated.addListener(onUpdated)
        })

        if (timedOut) return

        // 额外等待 2.5s，确保 content.js 已完全初始化并可以接收消息
        await new Promise(r => setTimeout(r, 2500))
        if (timedOut) return

        // 向后台 tab 发送自动抓取指令，等待解析结果
        const scrapeResult = await new Promise((resolve) => {
          try {
            chrome.tabs.sendMessage(bgTabId, { type: 'X_SCRAPER_AUTO_SCRAPE' }, (response) => {
              if (chrome.runtime.lastError) {
                resolve({ ok: false, error: chrome.runtime.lastError.message })
              } else {
                resolve(response || { ok: false, error: '内容脚本无响应' })
              }
            })
          } catch (e) {
            resolve({ ok: false, error: String(e.message || e) })
          }
        })

        clearTimeout(timeoutHandle)
        if (timedOut) return

        // 关闭后台 tab
        if (bgTabId !== null) {
          try { await chrome.tabs.remove(bgTabId) } catch {}
          bgTabId = null
        }

        if (!scrapeResult.ok || !scrapeResult.item) {
          throw new Error(scrapeResult.error || '内容解析失败')
        }

        // 去重检查并保存
        const existing = await getItems()
        const next = existing.slice()
        const incomingTweet = scrapeResult.item.tweet
        const isDuplicate = next.some(x =>
          (incomingTweet.url && x.tweet && x.tweet.url === incomingTweet.url) ||
          (incomingTweet.id && x.tweet && x.tweet.id === incomingTweet.id)
        )

        if (!isDuplicate) {
          const newItem = {
            id: createId('item'),
            sourceUrl: sourceUrl || noteUrl,
            capturedAt: new Date().toISOString(),
            tweet: incomingTweet,
            replies: Array.isArray(scrapeResult.item.replies) ? scrapeResult.item.replies : [],
          }
          next.unshift(newItem)
          await setItems(next)
          safeRuntimeBroadcast({ type: 'X_SCRAPER_ITEMS_UPDATED' })
        }

        // 通知发起方 tab 成功
        if (senderTabId) {
          try {
            chrome.tabs.sendMessage(senderTabId, {
              type: 'X_SCRAPER_NOTE_RESULT',
              requestId,
              ok: true,
              isDuplicate,
            })
          } catch {}
        }

      } catch (e) {
        if (bgTabId !== null) {
          try { await chrome.tabs.remove(bgTabId) } catch {}
        }
        if (senderTabId && !timedOut) {
          try {
            chrome.tabs.sendMessage(senderTabId, {
              type: 'X_SCRAPER_NOTE_RESULT',
              requestId,
              ok: false,
              error: String(e.message || e),
            })
          } catch {}
        }
      }
    })()

    sendResponse({ ok: true, queued: true })
    return true
  }

  return false
})

chrome.action.onClicked.addListener(() => {
  openDashboard()
})
