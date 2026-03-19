const styleEl = document.createElement('style')
styleEl.textContent = `
.x-scraper-checkbox {
  position: absolute;
  top: 10px;
  right: 10px;
  width: 16px;
  height: 16px;
  border: 1.5px solid rgba(255, 255, 255, 0.3);
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  z-index: 9999;
  cursor: pointer;
  opacity: 0;
  pointer-events: none;
  transform: translateX(10px);
  transition: all 0.2s ease;
}

.x-scraper-checkbox.anchored {
  position: relative;
  top: 0;
  right: 0;
  margin-left: 8px;
  transform: none;
}

body.x-scraper-selecting .x-scraper-checkbox,
article:hover .x-scraper-checkbox {
  opacity: 1;
  pointer-events: auto;
  transform: translateX(0);
}

.x-scraper-checkbox.selected {
  background: #FFFFFF;
  border-color: #FFFFFF;
  box-shadow: 0 0 8px rgba(255, 255, 255, 0.4);
}

.x-scraper-confirm {
  position: fixed;
  right: 24px;
  bottom: 24px;
  z-index: 2147483647;
  display: none;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  background: rgba(0, 0, 0, 0.9);
  backdrop-filter: blur(12px);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  animation: x-scraper-fade-in 0.2s ease;
}

@keyframes x-scraper-fade-in {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

.x-scraper-confirm .count {
  color: #FFFFFF;
  font-size: 14px;
  font-weight: 500;
}

.x-scraper-confirm button {
  border: none;
  border-radius: 8px;
  padding: 8px 16px;
  font-weight: 600;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
}

.x-scraper-confirm button.primary {
  background: #FFFFFF;
  color: #000000;
  box-shadow: 0 0 12px rgba(255, 255, 255, 0.3);
}

.x-scraper-confirm button.primary:hover {
  background: #F0F0F0;
  transform: translateY(-1px);
}

.x-scraper-confirm button.ghost {
  background: transparent;
  color: #A3A3A3;
  border: 1px solid rgba(255, 255, 255, 0.2);
}

.x-scraper-confirm button.ghost:hover {
  color: #FFFFFF;
  border-color: #FFFFFF;
}

.xmine-quick-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 999px;
  cursor: pointer;
  transition: all 0.2s ease;
  color: #71767b;
  margin-left: 0px;
  border: none;
  background: transparent;
  outline: none;
}
.xmine-quick-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #FFFFFF;
}
.xmine-quick-btn.saved {
  color: #FFFFFF;
  animation: xmine-pop 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
}
@keyframes xmine-pop {
  0% { transform: scale(1); }
  50% { transform: scale(1.3); }
  100% { transform: scale(1); }
}
`
document.documentElement.appendChild(styleEl)

const selectedArticles = new Set()
let mouseSelecting = false
let selectionMode = false

const confirmEl = document.createElement('div')
confirmEl.className = 'x-scraper-confirm'
confirmEl.innerHTML = `
  <span class="count" id="xScraperCount">已选择 0 条</span>
  <button class="ghost" id="xScraperCancel" type="button">取消</button>
  <button class="primary" id="xScraperConfirm" type="button">确认抓取</button>
`
document.documentElement.appendChild(confirmEl)

function updateConfirm() {
  const countEl = document.getElementById('xScraperCount')
  if (!countEl) return
  const n = selectedArticles.size
  if (isStatusPage() && n > 0) {
    countEl.textContent = `已选择 ${n} 条（将合并为 1 条推文）`
    return
  }
  countEl.textContent = `已选择 ${n} 条`
}

function showConfirm() {
  updateConfirm()
  confirmEl.style.display = 'flex'
}

function hideConfirm() {
  confirmEl.style.display = 'none'
}

function clearSelectionUI() {
  selectedArticles.clear()
  document.querySelectorAll('.x-scraper-checkbox.selected').forEach((el) => el.classList.remove('selected'))
  updateConfirm()
}

async function confirmCapture() {
  const items = await getSelectedItems()
  if (!items || items.length === 0) {
    hideConfirm()
    return
  }
  await new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(
        { type: 'X_SCRAPER_SAVE_ITEMS', items, sourceUrl: location.href },
        () => resolve(undefined),
      )
    } catch {
      resolve(undefined)
    }
  })
  hideConfirm()
  clearSelectionUI()
}

document.getElementById('xScraperCancel')?.addEventListener('click', (e) => {
  e.preventDefault()
  e.stopPropagation()
  selectionMode = false
  mouseSelecting = false
  document.body.classList.remove('x-scraper-selecting')
  hideConfirm()
  clearSelectionUI()
})

document.getElementById('xScraperConfirm')?.addEventListener('click', (e) => {
  e.preventDefault()
  e.stopPropagation()
  confirmCapture()
})

function isInteractiveTarget(target) {
  if (!(target instanceof Element)) return false
  return Boolean(target.closest('a,button,input,textarea,select,[role="button"],time'))
}

function getArticleFromEventTarget(target) {
  if (!(target instanceof Element)) return null
  return target.closest('article')
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const SHOW_MORE_TEXTS = new Set(['显示更多', 'Show more', 'Read more', '展开'])

function cleanTweetText(text) {
  const raw = String(text || '')
  if (!raw) return ''
  const lines = raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => !SHOW_MORE_TEXTS.has(l))
  return lines.join('\n').trim()
}

function findShowMoreButtons(article) {
  if (!article) return []
  const buttons = Array.from(article.querySelectorAll('[role="button"]'))
  return buttons.filter((el) => {
    const t = (el.textContent || '').trim()
    if (!t) return false
    if (!SHOW_MORE_TEXTS.has(t)) return false
    if (el.closest('.x-scraper-confirm')) return false
    if (el.closest('.x-scraper-checkbox')) return false
    return true
  })
}

async function expandArticleText(article) {
  for (let i = 0; i < 4; i += 1) {
    const btns = findShowMoreButtons(article)
    if (!btns || btns.length === 0) return
    try {
      btns[0].click()
    } catch { }
    await sleep(60)
  }
}

function ensureCheckbox(article) {
  if (!article || article.querySelector('.x-scraper-checkbox')) return
  const box = document.createElement('div')
  box.className = 'x-scraper-checkbox'

  box.addEventListener('mousedown', (e) => {
    e.stopPropagation()
    e.preventDefault()
    if (!selectionMode) {
      hideConfirm()
      clearSelectionUI()
      selectionMode = true
      mouseSelecting = true
      document.body.classList.add('x-scraper-selecting')
    }
    toggleArticle(article, box)
    updateConfirm()
  })

  box.addEventListener('click', (e) => {
    e.stopPropagation()
    e.preventDefault()
  })

  box.addEventListener('mouseenter', () => {
    if (!mouseSelecting) return
    toggleArticle(article, box, true)
  })

  const caretButton = article.querySelector('[data-testid="caret"], button[aria-label="More"], div[aria-label="More"], button[aria-label="更多"], div[aria-label="更多"], button[aria-label="More options"], div[aria-label="More options"], button[aria-label="更多选项"], div[aria-label="更多选项"], button[aria-label="更多選項"], div[aria-label="更多選項"]')
  if (caretButton && caretButton.parentElement) {
    box.classList.add('anchored')
    caretButton.insertAdjacentElement('afterend', box)
  } else {
    const computed = getComputedStyle(article)
    if (computed.position === 'static') article.style.position = 'relative'
    article.appendChild(box)
  }
}

document.addEventListener(
  'click',
  (e) => {
    if (e.target instanceof Element) {
      if (e.target.closest('.x-scraper-confirm')) return
      if (e.target.closest('.x-scraper-checkbox')) return
    }

    if (selectionMode) {
      e.preventDefault()
      e.stopPropagation()

      if (isInteractiveTarget(e.target)) {
        return
      }

      const art = getArticleFromEventTarget(e.target)
      if (art) {
        ensureCheckbox(art)
        const box = art.querySelector('.x-scraper-checkbox')
        if (box) toggleArticle(art, box, true)
        updateConfirm()
      }

      selectionMode = false
      mouseSelecting = false
      document.body.classList.remove('x-scraper-selecting')
      if (selectedArticles.size > 0) showConfirm()
      else hideConfirm()
      return
    }

    const art = getArticleFromEventTarget(e.target)
    if (!art) return
    if (isInteractiveTarget(e.target)) return

    return
  },
  true,
)

document.addEventListener(
  'mousemove',
  (e) => {
    if (!selectionMode || !mouseSelecting) return
    const art = getArticleFromEventTarget(e.target)
    if (!art) return
    ensureCheckbox(art)
    const box = art.querySelector('.x-scraper-checkbox')
    if (box) toggleArticle(art, box, true)
    updateConfirm()
  },
  true,
)

function toggleArticle(article, box, forceOn) {
  const has = selectedArticles.has(article)
  if (forceOn === true) {
    if (!has) {
      selectedArticles.add(article)
      box.classList.add('selected')
    }
    return
  }
  if (has) {
    selectedArticles.delete(article)
    box.classList.remove('selected')
  } else {
    selectedArticles.add(article)
    box.classList.add('selected')
  }
}

document.addEventListener('mouseup', () => {
  if (!selectionMode) mouseSelecting = false
})

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return
  selectionMode = false
  mouseSelecting = false
  document.body.classList.remove('x-scraper-selecting')
  hideConfirm()
  clearSelectionUI()
})

function parseArticle(article) {
  const nameEl = article.querySelector('[data-testid="User-Name"]')
  const nameText = (nameEl && nameEl.textContent) ? nameEl.textContent.trim() : ''
  const parts = nameText.split('@')
  const authorName = (parts[0] || 'Unknown').trim()
  const authorHandle = parts.length > 1 ? `@${parts[1].trim()}` : ''

  const avatarImg = article.querySelector('img[src*="profile_images"], img[alt*="头像"], img[alt*="Avatar"]')
  const authorAvatar = avatarImg && avatarImg.src ? avatarImg.src : ''

  const textEl = article.querySelector('[data-testid="tweetText"]')
  const textRaw = textEl && textEl.innerText ? textEl.innerText.trim() : ''
  let text = cleanTweetText(textRaw)

  // --- 提取链接：包括 tweetText 内的 <a> 和链接预览卡片（card.wrapper）---
  const collectedLinks = []

  // 1. 提取 tweetText 内所有外部链接（过滤 hashtag/mention 等 x.com 站内链接）
  //    判断依据：优先用 data-expanded-url，它存储了 t.co 展开后的真实 URL
  //    只有展开后的 URL 是外部地址（非 twitter.com / x.com）才算外链
  if (textEl) {
    textEl.querySelectorAll('a[href]').forEach((a) => {
      const expandedUrl = a.getAttribute('data-expanded-url') || ''
      if (expandedUrl) {
        // data-expanded-url 存在，用它判断是否为外链
        if (!expandedUrl.includes('twitter.com') && !expandedUrl.includes('x.com')) {
          collectedLinks.push(expandedUrl)
        }
      }
      // 没有 data-expanded-url 的 <a>（如 hashtag / mention）不处理，
      // 因为它们本身显示在 innerText 里，不需要额外追加
    })
  }

  // 2. 提取链接预览卡片（card.wrapper）中的链接
  //    X 平台 card 的选择器：[data-testid="card.wrapper"] 内的顶层 <a>
  const cardWrappers = article.querySelectorAll('[data-testid="card.wrapper"]')
  cardWrappers.forEach((card) => {
    const cardLink = card.querySelector('a[href]')
    if (cardLink && cardLink.href) {
      collectedLinks.push(cardLink.href)
    }
  })

  // 3. 备用：card.wrapper 未命中时，尝试其他 card 选择器
  if (cardWrappers.length === 0) {
    const altCardLinks = article.querySelectorAll('[data-testid^="card"] a[href]')
    altCardLinks.forEach((a) => {
      const href = a.href || ''
      // 排除推文状态链接和 X 内部链接
      if (href && !href.includes('/status/') && !href.match(/x\.com\/(i|home|search|explore|notifications|messages)/) && !href.match(/twitter\.com\/(i|home)/)) {
        collectedLinks.push(href)
      }
    })
  }

  // 4. 将未在文字中出现的链接追加到文本末尾
  const uniqueLinks = [...new Set(collectedLinks)]
  const linksToAppend = uniqueLinks.filter((link) => !text.includes(link))
  if (linksToAppend.length > 0) {
    text = text ? `${text}\n${linksToAppend.join('\n')}` : linksToAppend.join('\n')
  }
  // --- 链接提取结束 ---

  const timeEl = article.querySelector('time')
  const datetime = timeEl ? (timeEl.getAttribute('datetime') || '') : ''
  const publishedAt = datetime || ''

  const linkEl = article.querySelector('a[href*="/status/"]')
  const url = linkEl && linkEl.href ? linkEl.href : ''

  const images = []
  const imgEls = article.querySelectorAll('img')
  imgEls.forEach((img) => {
    if (!img || !img.src) return
    if (img.src.includes('twimg.com/media') || img.src.includes('pbs.twimg.com/media')) {
      // Normalize image URL to use consistent size (large)
      let imgUrl = img.src
      // Replace any existing name parameter with name=large
      if (imgUrl.includes('name=')) {
        imgUrl = imgUrl.replace(/name=(small|medium|large|orig|4096x4096|900x900|360x360|240x240)/i, 'name=large')
      } else if (imgUrl.includes('?')) {
        imgUrl += '&name=large'
      } else {
        imgUrl += '?name=large'
      }
      images.push(imgUrl)
    }
  })

  // id 生成优先级：推文 URL > 时间+作者 > 作者+文字摘要
  // 注意：即使 text 为空（纯图推文），也要保证 id 不为空
  const id = url || (publishedAt
    ? `${publishedAt}_${authorHandle}`
    : `${authorHandle}_${text.slice(0, 24) || images[0] || Date.now()}`)

  /* Metrics extraction */
  function getCount(selector, fallbackSelectors = []) {
    let el = article.querySelector(selector)
    if (!el && fallbackSelectors.length) {
      for (const sel of fallbackSelectors) {
        el = article.querySelector(sel)
        if (el) break
      }
    }

    if (!el) return 0

    // Priority 1: aria-label on the element itself or closest button
    // Often format: "123 replies" or "Reply" (implied 0)
    const btn = el.closest('[role="button"]') || el.closest('a') || el
    const aria = btn.getAttribute('aria-label') || ''

    // Look for numbers in aria-label
    // Matches: "105 replies", "2,305 Retweets", "14K Likes"
    // Note: X uses "K" or "M" in text content, but usually full numbers in aria-label? 
    // Actually aria-label often has full numbers: "1356 likes".
    // Sometimes it says "Like" -> 0.

    if (aria) {
      const m = aria.match(/(\d+(?:,\d+)*)/)
      if (m) {
        return parseInt(m[1].replace(/,/g, ''), 10)
      }
      // If aria-label exists but no number found (e.g. "Like", "Reply"), assume 0
      return 0
    }

    // Priority 2: Text content (often "14K", "200")
    // This is less reliable due to potential hidden text, but useful fallback
    const text = el.textContent.trim()
    if (text) {
      return parseKMB(text)
    }

    return 0
  }

  function parseKMB(str) {
    if (!str) return 0
    const s = str.toUpperCase().replace(/,/g, '')
    if (s.includes('K')) {
      return parseFloat(s) * 1000
    }
    if (s.includes('M')) {
      return parseFloat(s) * 1000000
    }
    return parseInt(s, 10) || 0
  }

  const replyCount = getCount('[data-testid="reply"]')
  const retweetCount = getCount('[data-testid="retweet"]') || getCount('[data-testid="unretweet"]')
  const likeCount = getCount('[data-testid="like"]') || getCount('[data-testid="unlike"]')

  // Views: often in an anchor with href containing /analytics
  const viewCount = getCount('a[href*="/analytics"]', ['[data-testid="app-text-transition-container"]'])

  return {
    tweet: {
      id,
      authorName,
      authorHandle,
      authorAvatar,
      publishedAt,
      text,
      images,
      url,
      replyCount,
      retweetCount,
      likeCount,
      viewCount,
    },
    replies: [],
  }
}

function isStatusPage() {
  return /\/status\//.test(location.pathname)
}

function getStatusId() {
  const m = location.pathname.match(/\/status\/(\d+)/)
  return m ? m[1] : ''
}

function findMainStatusArticle(selected) {
  const statusId = getStatusId()
  if (statusId) {
    for (const a of selected) {
      const linkEl = a.querySelector('a[href*="/status/"]')
      const href = linkEl && linkEl.getAttribute('href') ? String(linkEl.getAttribute('href')) : ''
      if (href && href.includes(`/status/${statusId}`)) return a
    }
  }
  return selected[0] || null
}

async function collectRepliesForStatus(mainArticle) {
  const replies = []
  const all = Array.from(document.querySelectorAll('article'))
  let afterMain = false
  for (const art of all) {
    if (art === mainArticle) {
      afterMain = true
      continue
    }
    if (!afterMain) continue

    await expandArticleText(art)
    const parsed = parseArticle(art)
    if (!parsed.tweet.text) continue
    replies.push({
      id: parsed.tweet.id,
      authorName: parsed.tweet.authorName,
      authorHandle: parsed.tweet.authorHandle,
      publishedAt: parsed.tweet.publishedAt,
      text: parsed.tweet.text,
      images: parsed.tweet.images,
    })
  }
  return replies
}

async function getSelectedItems() {
  const articles = Array.from(selectedArticles).sort((a, b) => {
    return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
  })
  if (articles.length === 0) return []

  for (const art of articles) {
    await expandArticleText(art)
  }

  if (isStatusPage()) {
    const main = findMainStatusArticle(articles)
    if (!main) return []
    await expandArticleText(main)
    const parsedMain = parseArticle(main)
    // 只要有作者信息就视为有效（纯图推文可能没有文字）
    if (!parsedMain.tweet || (!parsedMain.tweet.text && !parsedMain.tweet.authorHandle && parsedMain.tweet.images.length === 0)) return []

    const others = articles.filter((a) => a !== main)
    if (others.length > 0) {
      const replies = []
      for (const art of others) {
        await expandArticleText(art)
        const parsed = parseArticle(art)
        if (!parsed.tweet.text) continue
        replies.push({
          id: parsed.tweet.id,
          authorName: parsed.tweet.authorName,
          authorHandle: parsed.tweet.authorHandle,
          publishedAt: parsed.tweet.publishedAt,
          text: parsed.tweet.text,
          images: parsed.tweet.images,
        })
      }
      parsedMain.replies = replies
    } else {
      parsedMain.replies = await collectRepliesForStatus(main)
    }

    return [parsedMain]
  }

  // 只要有作者信息就保留（纯图推文可能没有文字）
  return articles.map((a) => parseArticle(a)).filter((i) => i.tweet && (i.tweet.text || i.tweet.authorHandle || (i.tweet.images && i.tweet.images.length > 0)))
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const type = msg && msg.type
  if (type === 'X_SCRAPER_PING') {
    sendResponse({ ok: true })
    return
  }
  if (type === 'X_SCRAPER_GET_SELECTED') {
    getSelectedItems()
      .then((items) => sendResponse({ ok: true, items, sourceUrl: location.href }))
      .catch(() => sendResponse({ ok: true, items: [], sourceUrl: location.href }))
    return true
  }
})

// Add styles for the quick mine button
const quickMineStyle = `
.xmine-quick-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 999px;
  cursor: pointer;
  transition: all 0.2s ease;
  color: #71767b;
  margin-left: 0px;
  border: none;
  background: transparent;
  outline: none;
}
.xmine-quick-btn:hover {
  background: rgba(239, 183, 0, 0.1);
  color: #efb700;
}
.xmine-quick-btn.saved {
  color: #efb700;
  animation: xmine-pop 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
}
@keyframes xmine-pop {
  0% { transform: scale(1); }
  50% { transform: scale(1.3); }
  100% { transform: scale(1); }
}
`
styleEl.textContent += quickMineStyle

// ... existing code ...

const PICKAXE_ICON = `
<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M14.5 5.5L19.5 10.5" />
  <path d="M3 21L12 12" />
  <path d="M13 3L21 11L12 20L4 12L13 3Z" />
</svg>
`

async function captureThreadToTarget(targetArticle) {
  const root = targetArticle.closest('[role="main"]') || document
  const all = Array.from(root.querySelectorAll('article'))

  if (all.length === 0) return []

  // 【修复】优先使用当前页面 URL 中的 status ID 精确定位主推文 article。
  // X 状态页会在主推文上方显示父级上下文推文（如引用链中的上级推文），
  // 这些父级推文同样有 time 标签，如果只用"第一个有 time 的 article"
  // 会误选父级推文作为主推文，导致线程顺序混乱。
  let mainIndex = -1
  const statusId = getStatusId()

  if (statusId) {
    // 策略1：通过 URL 中的 statusId 精确找到主推文 article
    for (let i = 0; i < all.length; i++) {
      const art = all[i]
      // 主推文的 <a href> 会包含当前页面的 statusId
      const linkEl = art.querySelector(`a[href*="/status/${statusId}"]`)
      if (linkEl) {
        mainIndex = i
        break
      }
    }
  }

  if (mainIndex === -1) {
    // 回退策略：找第一个有 time 标签的 article
    for (let i = 0; i < all.length; i++) {
      if (all[i].querySelector('time')) {
        mainIndex = i
        break
      }
    }
  }

  // 如果没找到，或者 target 本身就是 main，则只抓 target 单条
  if (mainIndex === -1 || all[mainIndex] === targetArticle) {
    await expandArticleText(targetArticle)
    const parsed = parseArticle(targetArticle)
    const hasContent = parsed.tweet && (parsed.tweet.text || parsed.tweet.authorHandle)
    return hasContent ? [parsed] : []
  }

  const mainArticle = all[mainIndex]
  const targetIndex = all.indexOf(targetArticle)

  // 安全检查：target 必须在 main 之后
  if (targetIndex <= mainIndex) {
    await expandArticleText(targetArticle)
    const parsed = parseArticle(targetArticle)
    const hasContent = parsed.tweet && (parsed.tweet.text || parsed.tweet.authorHandle)
    return hasContent ? [parsed] : []
  }

  // 截取从 main 到 target 之间的所有 articles（含两端）
  const threadArticles = all.slice(mainIndex, targetIndex + 1)

  // 处理主推文：只要有作者信息就视为有效（纯图推文可能没有文字）
  await expandArticleText(mainArticle)
  const parsedMain = parseArticle(mainArticle)
  if (!parsedMain.tweet || (!parsedMain.tweet.text && !parsedMain.tweet.authorHandle)) return []

  // 处理回复（从 index 1 开始，跳过主推文）
  const replies = []
  for (let i = 1; i < threadArticles.length; i++) {
    const art = threadArticles[i]
    // 跳过没有 time 标签的（广告等）
    if (!art.querySelector('time')) continue

    await expandArticleText(art)
    const p = parseArticle(art)
    if (p.tweet && p.tweet.text) {
      replies.push({
        id: p.tweet.id,
        authorName: p.tweet.authorName,
        authorHandle: p.tweet.authorHandle,
        publishedAt: p.tweet.publishedAt,
        text: p.tweet.text,
        images: p.tweet.images
      })
    }
  }

  parsedMain.replies = replies
  return [parsedMain]
}

async function handleQuickMine(article, btn) {
  if (btn.classList.contains('saved')) return

  btn.classList.add('saving')

  // Change icon to spinner/loading manually if needed, or rely on css
  const originalIcon = btn.innerHTML
  btn.innerHTML = `<svg class="animate-spin" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>`

  // Add rotation animation just for this session if not in css
  if (!document.getElementById('xmine-spin-style')) {
    const s = document.createElement('style')
    s.id = 'xmine-spin-style'
    s.textContent = `@keyframes xmine-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } } .animate-spin { animation: xmine-spin 1s linear infinite; }`
    document.head.appendChild(s)
  }

  let itemsToSave = []

  if (isStatusPage()) {
    try {
      itemsToSave = await captureThreadToTarget(article)
    } catch (e) {
      console.error('xMine: Thread capture failed, falling back to single', e)
    }
  }

  // Fallback or Non-Status Page: Single Item
  // 只要有作者信息就视为有效（纯图推文 text 可以为空）
  if (itemsToSave.length === 0) {
    await expandArticleText(article)
    const parsed = parseArticle(article)
    if (parsed.tweet && (parsed.tweet.text || parsed.tweet.authorHandle || (parsed.tweet.images && parsed.tweet.images.length > 0))) {
      itemsToSave = [parsed]
    }
  }

  if (itemsToSave.length === 0) {
    console.warn('xMine: Failed to parse tweet')
    btn.classList.remove('saving')
    btn.innerHTML = originalIcon
    return
  }

  // Determine Main Tweet URL context (metadata only)
  let mainTweetUrl = null
  if (isStatusPage() && itemsToSave.length === 1 && itemsToSave[0].replies.length === 0) {
    const urlObj = new URL(location.href)
    mainTweetUrl = `${urlObj.origin}${urlObj.pathname}`
  }

  try {
    await new Promise((resolve) => {
      chrome.runtime.sendMessage(
        {
          type: 'X_SCRAPER_SAVE_ITEMS',
          items: itemsToSave,
          sourceUrl: location.href,
          mainTweetUrl: mainTweetUrl
        },
        () => resolve(undefined),
      )
    })

    // Success feedback
    btn.classList.add('saved')
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    `
    // Revert after 2 seconds
    setTimeout(() => {
      btn.classList.remove('saved')
      btn.classList.remove('saving')
      btn.innerHTML = PICKAXE_ICON
    }, 2000)

  } catch (e) {
    console.error('xMine: Save failed', e)
    btn.classList.remove('saving')
    btn.innerHTML = PICKAXE_ICON

    // Handle context invalidation (extension reloaded)
    const msg = e.message || String(e)
    if (msg.includes('Extension context invalidated')) {
      alert('xMine 插件已更新/重新加载。请刷新当前页面以继续使用。')
    }
  }
}

function ensureQuickMineBtn(article) {
  if (!article || article.querySelector('.xmine-quick-btn')) return

  // Find the action bar (Repy, Retweet, Like, Share group)
  // It usually has role="group"
  const group = article.querySelector('div[role="group"]')
  if (!group) return

  // Create button
  const btn = document.createElement('div')
  btn.className = 'xmine-quick-btn'
  btn.setAttribute('role', 'button')
  btn.setAttribute('aria-label', '保存到 xMine')
  btn.setAttribute('title', '保存到 xMine')
  btn.innerHTML = PICKAXE_ICON

  btn.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    handleQuickMine(article, btn)
  })

  // Append to the group (usually as last item)
  // Sometimes Share is the last one.
  group.appendChild(btn)
}

const observer = new MutationObserver(() => {
  document.querySelectorAll('article').forEach((a) => {
    ensureCheckbox(a)
    ensureQuickMineBtn(a)
  })
})

observer.observe(document.body, { childList: true, subtree: true })
setTimeout(() => {
  document.querySelectorAll('article').forEach((a) => {
    ensureCheckbox(a)
    ensureQuickMineBtn(a)
  })
}, 1500)

