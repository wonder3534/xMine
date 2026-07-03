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

/**
 * HTML DOM 节点 → Markdown 文本转换器
 * 用于保留 X Notes 等长篇文章的标题、粗体、代码块等格式
 * @param {Element} el - 要转换的 DOM 元素
 * @param {string[]} [inlineImages] - 可选：若传入，遇到推文媒体图片时会将 URL 推入此数组（按出现顺序）
 */
function htmlToMarkdown(el, inlineImages) {
  if (!el) return ''

  function normalizeMediaUrl(src) {
    if (!src) return ''
    let u = src
    if (u.includes('name=')) {
      u = u.replace(/name=(small|medium|large|orig|4096x4096|900x900|360x360|240x240)/i, 'name=large')
    } else if (u.includes('?')) {
      u += '&name=large'
    } else {
      u += '?name=large'
    }
    return u
  }

  function isTweetMedia(src) {
    return src && (src.includes('twimg.com/media') || src.includes('pbs.twimg.com/media'))
  }

  function processNode(node) {
    // 文本节点
    if (node.nodeType === 3) return node.textContent
    if (node.nodeType !== 1) return ''

    const tag = (node.tagName || '').toLowerCase()
    // 跳过图标、按钮、SVG 等非内容元素（img 移至 switch 单独处理）
    if (['svg', 'button', 'script', 'style'].includes(tag)) return ''
    // 跳过操作栏区域
    if (node.closest('[role="group"]') || node.closest('[data-testid="reply"]')) return ''

    const children = Array.from(node.childNodes).map(processNode).join('')

    switch (tag) {
      // --- 媒体图片：按出现顺序嵌入 Markdown ---
      case 'img': {
        const src = node.src || node.getAttribute('src') || node.getAttribute('data-src') || ''
        if (!isTweetMedia(src)) return ''
        const imgUrl = normalizeMediaUrl(src)
        if (inlineImages && !inlineImages.includes(imgUrl)) inlineImages.push(imgUrl)
        return `\n\n![image](${imgUrl})\n\n`
      }
      // figure / picture：递归子节点即可（内部 img 会被上面捕获）
      case 'figure': case 'picture': return children
      // video：忽略（只取 poster 封面图）
      case 'video': {
        const poster = node.getAttribute('poster') || ''
        if (isTweetMedia(poster)) {
          const imgUrl = normalizeMediaUrl(poster)
          if (inlineImages && !inlineImages.includes(imgUrl)) inlineImages.push(imgUrl)
          return `\n\n![video-poster](${imgUrl})\n\n`
        }
        return ''
      }
      // 粗体
      case 'strong': case 'b': {
        const t = children.trim()
        return t ? `**${t}**` : ''
      }
      // 斜体
      case 'em': case 'i': {
        const t = children.trim()
        return t ? `_${t}_` : ''
      }
      // 标题
      case 'h1': return `\n\n# ${children.trim()}\n\n`
      case 'h2': return `\n\n## ${children.trim()}\n\n`
      case 'h3': return `\n\n### ${children.trim()}\n\n`
      case 'h4': case 'h5': case 'h6': return `\n\n#### ${children.trim()}\n\n`
      // 段落
      case 'p': {
        const t = children.trim()
        return t ? `\n\n${t}\n\n` : ''
      }
      // 换行
      case 'br': return '\n'
      // 代码块：pre 包裹 code
      case 'pre': {
        const codeEl = node.querySelector('code')
        const raw = ((codeEl ? codeEl.innerText : node.innerText) || '').trim()
        return raw ? `\n\n\`\`\`\n${raw}\n\`\`\`\n\n` : ''
      }
      // 行内代码（不在 pre 里）
      case 'code': {
        if (node.closest('pre')) return children  // 在 pre 里就不再包裹
        return `\`${children.trim()}\``
      }
      // 无序列表
      case 'ul': {
        const items = Array.from(node.children)
          .filter(c => c.tagName.toLowerCase() === 'li')
          .map(li => `- ${Array.from(li.childNodes).map(processNode).join('').trim()}`)
          .join('\n')
        return items ? `\n\n${items}\n\n` : ''
      }
      // 有序列表
      case 'ol': {
        let idx = 1
        const items = Array.from(node.children)
          .filter(c => c.tagName.toLowerCase() === 'li')
          .map(li => `${idx++}. ${Array.from(li.childNodes).map(processNode).join('').trim()}`)
          .join('\n')
        return items ? `\n\n${items}\n\n` : ''
      }
      case 'li': return children
      // 引用块
      case 'blockquote': {
        const t = children.trim().replace(/\n/g, '\n> ')
        return t ? `\n\n> ${t}\n\n` : ''
      }
      // 分隔线
      case 'hr': return '\n\n---\n\n'
      // 链接：只保留文字（URL 单独提取）
      case 'a': return children
      // div / span 等：默认递归处理子节点
      default: return children
    }
  }

  const raw = Array.from(el.childNodes).map(processNode).join('')
  // 清理连续空行（超过 2 个换行的压缩为 2 个）
  return raw.replace(/\n{3,}/g, '\n\n').trim()
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
  for (let i = 0; i < 3; i += 1) {
    const btns = findShowMoreButtons(article)
    if (!btns || btns.length === 0) return
    try {
      btns[0].click()
    } catch { }

    // X Notes / 长篇推文点击“显示更多”后内容通过 API 异步加载，
    // 轮询等待直到 tweetText 内容稳定（不再变化），最长等 3000ms
    const tweetTextEl = article.querySelector('[data-testid="tweetText"]')
    if (tweetTextEl) {
      let prevLen = -1
      let stableCount = 0
      for (let w = 0; w < 15; w++) {
        await sleep(200)
        const curLen = (tweetTextEl.innerText || '').length
        if (curLen === prevLen) {
          stableCount++
          if (stableCount >= 2) break  // 连续 2 次相同则认为稳定
        } else {
          stableCount = 0
        }
        prevLen = curLen
      }
    } else {
      // 找不到 tweetText，等待较长时间让内容加载
      await sleep(1500)
    }
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
  // 使用 htmlToMarkdown 保留粗体、标题、代码块等格式
  let text = textEl ? htmlToMarkdown(textEl) : ''

  // --- 对于 X Notes / 长篇文章类推文，始终尝试从更大容器补充全文 ---
  // 传入 inlineImages 收集器，图片会按内容出现顺序嵌入 Markdown
  const articleInlineImages = []
  const noteSelectors = [
    '[data-testid="article"]',        // X Notes 文章容器
    '[data-testid="tweetArticle"]',   // 备用
    'div[data-contents="true"]',      // Draft.js / ProseMirror 内容
    '[data-testid="articleContent"]', // 其他可能的容器
  ]
  for (const sel of noteSelectors) {
    const el = article.querySelector(sel)
    if (el && el !== textEl) {
      const noteText = htmlToMarkdown(el, articleInlineImages)
      if (noteText.length > text.length) {
        text = noteText
        break
      } else {
        // 内容没更长，清空收集器
        articleInlineImages.length = 0
      }
    }
  }

  // --- 标题提取：专为 X Notes 等文章型推文（四层策略）---
  let postTitle = ''
  try {
    let titleText = ''
    let titleNode = null

    // 策略0：推文文本第一行以 # 开头（用户用 Markdown 标题格式书写的推文），提取整行作为标题
    if (!titleText && text) {
      const firstLine = text.split('\n')[0].trim()
      if (firstLine.startsWith('#')) {
        titleText = firstLine.replace(/^#+\s*/, '').trim()
      }
    }

    // 策略1：标准语义标签 + role="heading"] + X 专属 testid
    const titleCandidateSelectors = [
      'h1', 'h2',
      '[role="heading"]',
      '[data-testid*="title"]',
      '[data-testid*="heading"]',
      '[data-testid*="article-title"]',
    ]
    if (!titleText) {
      for (const sel of titleCandidateSelectors) {
        const els = article.querySelectorAll(sel)
        for (const el of els) {
          if (textEl && textEl.contains(el)) continue
          if (el.closest('[data-testid="User-Name"]')) continue
          if (el.closest('[role="group"]')) continue
          if (el.closest('[data-testid="reply"]')) continue
          const t = (el.innerText || '').trim()
          if (t && t.length > 5 && !text.includes(t)) {
            titleText = t
            titleNode = el
            break
          }
        }
        if (titleText) break
      }
    }

    // 策略2：若语义标签无结果，用 DOM 位置比较找 tweetText 之前的最长文本块
    if (!titleText && textEl) {
      const allEls = Array.from(article.querySelectorAll('*'))
      let bestLen = 0

      for (const el of allEls) {
        // 必须在 tweetText 之前（DOM 顺序）
        const pos = textEl.compareDocumentPosition(el)
        const isBefore = !!(pos & Node.DOCUMENT_POSITION_PRECEDING)
        if (!isBefore) continue

        // 跳过排除区域
        if (el.closest('[data-testid="User-Name"]')) continue
        if (el.closest('[role="group"]')) continue
        if (el.closest('[data-testid="reply"]')) continue
        const tag = (el.tagName || '').toLowerCase()
        if (['svg', 'img', 'picture', 'figure', 'video', 'button', 'time', 'script', 'style'].includes(tag)) continue

        // 只取有直接文本节点的元素（不只是包装容器）
        const directTextLen = Array.from(el.childNodes)
          .filter(n => n.nodeType === 3 && n.textContent.trim().length > 0)
          .reduce((sum, n) => sum + n.textContent.trim().length, 0)
        if (directTextLen < 8) continue

        const t = (el.innerText || '').trim()
        // 找最长的、还没出现在 text 里的文本块
        if (t.length > bestLen && t.length > 8 && !text.includes(t)) {
          bestLen = t.length
          titleText = t
          titleNode = el
        }
      }
    }

    // --- 提取标题之上的封面图片（Cover Images） ---
    let coverImagesMd = ''
    const referenceNode = titleNode || textEl
    if (referenceNode) {
      const allImages = Array.from(article.querySelectorAll('img'))
      const coverImages = []
      for (const img of allImages) {
        if (img.closest('[data-testid="User-Name"]')) continue
        const pos = referenceNode.compareDocumentPosition(img)
        if (pos & Node.DOCUMENT_POSITION_PRECEDING) {
          const src = img.src || img.getAttribute('src') || img.getAttribute('data-src') || ''
          if (src && (src.includes('twimg.com/media') || src.includes('pbs.twimg.com/media'))) {
            let imgUrl = src
            if (imgUrl.includes('name=')) {
              imgUrl = imgUrl.replace(/name=(small|medium|large|orig|4096x4096|900x900|360x360|240x240)/i, 'name=large')
            } else if (imgUrl.includes('?')) {
              imgUrl += '&name=large'
            } else {
              imgUrl += '?name=large'
            }
            if (!coverImages.includes(imgUrl)) {
              coverImages.push(imgUrl)
              if (!articleInlineImages.includes(imgUrl)) {
                articleInlineImages.push(imgUrl)
              }
            }
          }
        }
      }
      if (coverImages.length > 0) {
        coverImagesMd = coverImages.map(url => `![image](${url})`).join('\n\n')
      }
    }

    // 找到标题后记录（策略0的情况标题已在text内，不重复prepend）
    if (titleText) {
      postTitle = titleText
      // 策略1/2 找到的外部标题才需要前置到正文；策略0的标题已在 text 首行，不重复
      const alreadyInText = text.trimStart().replace(/^#+\s*/, '').startsWith(titleText)
      if (!alreadyInText) {
        text = `# ${titleText}\n\n${coverImagesMd ? coverImagesMd + '\n\n' : ''}${text}`.trim()
      } else if (coverImagesMd) {
        const lines = text.split('\n')
        lines.splice(1, 0, '\n' + coverImagesMd)
        text = lines.join('\n').trim()
      }
    } else if (coverImagesMd) {
      text = `${coverImagesMd}\n\n${text}`.trim()
    }
  } catch (e) { /* 标题提取失败不影响正文 */ }

  // 最终 fallback：取文本第一个非空行作为标题（不按标点截断，保留完整行内容）
  if (!postTitle && text) {
    const lines = text.split('\n')
    for (const line of lines) {
      const stripped = line.replace(/^#+\s*/, '').trim()
      if (stripped.length > 0) {
        // 限制超长行（> 80字符）截断，避免文件名过长
        postTitle = stripped.length > 80 ? stripped.slice(0, 80).trim() : stripped
        break
      }
    }
  }

  // 最后备选：收集语义化元素（仃用于 text 仍不足 50 字符的情况）
  if (!text || text.length < 50) {
    const richEls = article.querySelectorAll('h1, h2, h3, h4, p, li')
    const richParts = []
    richEls.forEach((el) => {
      if (el.closest('[data-testid="User-Name"]')) return
      if (el.closest('[data-testid="reply"]')) return
      if (el.closest('[role="group"]')) return
      const t = htmlToMarkdown(el).trim()
      if (t && !richParts.includes(t)) richParts.push(t)
    })
    if (richParts.length > 0) {
      const combined = richParts.join('\n\n').trim()
      if (combined.length > text.length) {
        text = combined
      }
    }
  }

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

  // --- 图片收集：优先使用内联顺序（X Notes 内容），否则按 DOM 顺序收集 ---
  const images = []

  function normalizeAndAdd(src) {
    if (!src) return
    if (!src.includes('twimg.com/media') && !src.includes('pbs.twimg.com/media')) return
    let imgUrl = src
    if (imgUrl.includes('name=')) {
      imgUrl = imgUrl.replace(/name=(small|medium|large|orig|4096x4096|900x900|360x360|240x240)/i, 'name=large')
    } else if (imgUrl.includes('?')) {
      imgUrl += '&name=large'
    } else {
      imgUrl += '?name=large'
    }
    if (!images.includes(imgUrl)) images.push(imgUrl)
  }

  if (articleInlineImages.length > 0) {
    // X Notes / 长文：内联图片已按内容顺序收集
    articleInlineImages.forEach(u => { if (!images.includes(u)) images.push(u) })
    // 补充 DOM 中可能漏掉的图片（不重复）
    article.querySelectorAll('img').forEach(img => normalizeAndAdd(img.src))
  } else {
    // 普通推文：按 DOM 顺序收集媒体图片
    article.querySelectorAll('img').forEach(img => normalizeAndAdd(img.src))
  }

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
      title: postTitle,
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
      // 用户只选择了主推文，不自动收集评论
      // 之前的 collectRepliesForStatus 会把页面上所有后续 article 都当成 replies，
      // 导致用户未选择的评论也被抓取，这里改为不自动填充。
      parsedMain.replies = []
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
  // 收到后台 tab 抓取结果，分发给对应 pending promise
  if (type === 'X_SCRAPER_NOTE_RESULT') {
    const resolve = pendingNoteRequests.get(msg.requestId)
    if (resolve) {
      pendingNoteRequests.delete(msg.requestId)
      resolve(msg)
    }
    return
  }
  // 后台静默标签页加载完成后，自动解析当前页面的推文内容
  if (type === 'X_SCRAPER_AUTO_SCRAPE') {
    ;(async () => {
      let article = null
      for (let i = 0; i < 40; i++) {
        const arts = Array.from(document.querySelectorAll('article'))
        for (const a of arts) {
          if (a.querySelector('time') && !(a.parentElement && a.parentElement.closest('article'))) {
            article = a
            break
          }
        }
        if (article) break
        await sleep(200)
      }
      if (!article) {
        sendResponse({ ok: false, error: '找不到推文内容（页面加载超时）' })
        return
      }
      await expandArticleText(article)
      const parsed = parseArticle(article)
      if (!parsed.tweet || (!parsed.tweet.text && !parsed.tweet.authorHandle)) {
        sendResponse({ ok: false, error: '无法解析推文内容' })
        return
      }
      sendResponse({ ok: true, item: parsed })
    })()
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

// Toast 通知样式（用于 X Notes 后台抓取反馈）
const xmineToastStyle = `
.xmine-toast {
  position: fixed;
  bottom: 80px;
  left: 50%;
  transform: translateX(-50%) translateY(8px);
  padding: 10px 22px;
  border-radius: 99px;
  font-size: 14px;
  font-weight: 500;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  z-index: 2147483647;
  box-shadow: 0 4px 20px rgba(0,0,0,0.5);
  pointer-events: none;
  white-space: nowrap;
  opacity: 0;
  transition: opacity 0.25s ease, transform 0.25s ease;
}
.xmine-toast.xmine-toast-show {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
}
.xmine-toast.xmine-toast-success {
  background: rgba(10, 10, 10, 0.95);
  color: #4ade80;
  border: 1px solid rgba(74, 222, 128, 0.3);
}
.xmine-toast.xmine-toast-error {
  background: rgba(10, 10, 10, 0.95);
  color: #f87171;
  border: 1px solid rgba(248, 113, 113, 0.3);
}
`
styleEl.textContent += xmineToastStyle

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

  // 如果没找到，或者 target 本身就是 main，
  // 或者 target 是 main 的子元素（X Notes 嵌套 article 结构），则只抓单条
  const mainArticle = mainIndex >= 0 ? all[mainIndex] : null
  const targetIsMainOrChild = mainArticle && (mainArticle === targetArticle || mainArticle.contains(targetArticle))
  if (mainIndex === -1 || targetIsMainOrChild) {
    // 用 mainArticle（若存在）解析，以获取更完整的内容（外层 article 有 status 链接等元数据）
    const artToParse = mainArticle || targetArticle
    await expandArticleText(artToParse)
    const parsed = parseArticle(artToParse)
    const hasContent = parsed.tweet && (parsed.tweet.text || parsed.tweet.authorHandle)
    return hasContent ? [parsed] : []
  }
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

// 在页面上显示一个短暂的 toast 通知
function showNotification(message, type = 'success') {
  const existing = document.querySelector('.xmine-toast')
  if (existing) existing.remove()
  const toast = document.createElement('div')
  toast.className = `xmine-toast xmine-toast-${type}`
  toast.textContent = type === 'success' ? `✓ ${message}` : `✕ ${message}`
  document.documentElement.appendChild(toast)
  requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('xmine-toast-show')))
  setTimeout(() => {
    toast.classList.remove('xmine-toast-show')
    setTimeout(() => toast.remove(), 300)
  }, 3000)
}

// 检测 article 内是否有 X Notes 长文卡片，并返回其完整 URL（否则返回 null）
function getXNotesCardUrl(article) {
  const card = article.querySelector('[data-testid="card.wrapper"]')
  if (!card) return null
  const links = Array.from(card.querySelectorAll('a[href]'))
  for (const link of links) {
    const href = link.href || ''
    const m = href.match(/https?:\/\/(x|twitter)\.com\/[^/?#]+\/status\/\d+/)
    if (m) return m[0]
  }
  return null
}

// 待回调的后台抓取请求 Map（requestId → resolve）
const pendingNoteRequests = new Map()

// 向 background.js 发起后台静默标签页抓取，返回 Promise<{ ok, error? }>
function fetchNoteInBackground(noteUrl) {
  return new Promise((resolve) => {
    const requestId = `xmine_${Date.now()}_${Math.random().toString(36).slice(2)}`
    pendingNoteRequests.set(requestId, resolve)
    try {
      chrome.runtime.sendMessage({
        type: 'X_SCRAPER_FETCH_NOTE',
        noteUrl,
        sourceUrl: location.href,
        requestId,
      })
    } catch (e) {
      pendingNoteRequests.delete(requestId)
      resolve({ ok: false, error: String(e.message || e) })
    }
    // 客户端侧超时保护（比后台 15s 略长）
    setTimeout(() => {
      if (pendingNoteRequests.has(requestId)) {
        pendingNoteRequests.delete(requestId)
        resolve({ ok: false, error: '请求超时，请稍后重试' })
      }
    }, 20000)
  })
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

  // X Notes / 长文卡片：通过后台静默标签页获取完整内容
  const notesUrl = getXNotesCardUrl(article)
  if (notesUrl && !isStatusPage()) {
    const result = await fetchNoteInBackground(notesUrl)
    if (result.ok) {
      btn.classList.add('saved')
      btn.innerHTML = `
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      `
      showNotification('已保存', 'success')
      setTimeout(() => {
        btn.classList.remove('saved', 'saving')
        btn.innerHTML = PICKAXE_ICON
      }, 2000)
    } else {
      btn.classList.remove('saving')
      btn.innerHTML = originalIcon
      showNotification(`抓取失败：${result.error || '未知错误'}`, 'error')
    }
    return
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

  // 【关键】只对顶层 article 添加按钮
  // X Notes 等内容区可能嵌套 article，需排除子层 article
  // 使用 parentElement.closest('article') 可靠地检测是否有祖先 article
  if (article.parentElement && article.parentElement.closest('article')) {
    return
  }

  // Find the action bar (Reply, Retweet, Like, Share group)
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

