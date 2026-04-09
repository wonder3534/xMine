import '../index.css'
import { useEffect, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createRoot } from 'react-dom/client'
import { FileText, Settings, Database, ExternalLink, Trash2, FileDown, Search, PanelLeftClose, PanelLeftOpen, LayoutGrid, LayoutList, Layers, ChevronDown, Download, Copy, FileSpreadsheet, FileIcon, X, Eye, Repeat2, Heart, MessageCircle, Filter, Calendar, Users, Image, MessageSquare, ChevronUp, Tag, Plus, Pencil, Save } from 'lucide-react'
import JSZip from 'jszip'
import { saveAs } from 'file-saver'
import { jsPDF } from 'jspdf'
import html2canvas from 'html2canvas'

type Item = {
  id: string
  sourceUrl: string
  capturedAt: string
  tweet: {
    id: string
    title?: string
    authorName: string
    authorHandle: string
    authorAvatar: string
    publishedAt?: string
    text: string
    images: string[]
    url?: string
    replyCount?: number
    retweetCount?: number
    likeCount?: number
    viewCount?: number
  }
  replies: Array<{ id: string; authorName: string; authorHandle: string; publishedAt?: string; text: string; images?: string[] }>
  tags?: string[]
  category?: string
}

type PermDesc = { mode: 'readwrite' }
type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: (options?: { id?: string }) => Promise<FileSystemDirectoryHandle>
}

type HandleWithPerm = FileSystemDirectoryHandle & {
  queryPermission?: (desc: PermDesc) => Promise<PermissionState>
  requestPermission?: (desc: PermDesc) => Promise<PermissionState>
}

function formatDateTime(v: string) {
  const s = String(v || '').trim()
  if (!s) return ''
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${y}-${m}-${day} ${hh}:${mm}`
}

function toErrorMessage(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e && typeof (e as { message: unknown }).message === 'string') {
    return (e as { message: string }).message
  }
  return String(e)
}

const OB_VAULT_PATH_KEY = 'obsidianVaultPath'
const LIST_WIDTH_KEY = 'xScraperDashboardListWidth'
const THEME_BG_KEY = 'xScraperDashboardThemeBg'
const TWEET_TABLE_COLS = '60px 160px 80px minmax(200px, 1fr) 90px 70px 50px 50px 50px 50px 50px 130px'
const CUSTOM_CATEGORIES_KEY = 'xScraperDashboardCustomCategories'
const MENU_WIDTH = 220
const PREVIEW_MIN_WIDTH = 400
const RESIZER_WIDTH = 12

function getObsidianVaultPath() {
  return localStorage.getItem(OB_VAULT_PATH_KEY) || ''
}

function setObsidianVaultPath(p: string) {
  localStorage.setItem(OB_VAULT_PATH_KEY, p || '')
}

function getInitialListWidth() {
  const raw = localStorage.getItem(LIST_WIDTH_KEY)
  if (!raw) return 820
  const n = Number(raw)
  return Number.isFinite(n) && n >= 380 && n <= 1600 ? n : 820
}

function getThemeBgColor() {
  const raw = localStorage.getItem(THEME_BG_KEY) || ''
  return raw || 'dark'
}

async function idbOpen(): Promise<IDBDatabase> {
  return await new Promise((resolve, reject) => {
    const req = indexedDB.open('x-scraper-db', 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore('fs-handles')
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function setObsidianVaultHandle(handle: FileSystemDirectoryHandle) {
  const db = await idbOpen()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('fs-handles', 'readwrite')
    tx.objectStore('fs-handles').put(handle, 'obsidianVaultHandle')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function getObsidianVaultHandle(): Promise<FileSystemDirectoryHandle | undefined> {
  const db = await idbOpen()
  return await new Promise((resolve, reject) => {
    const tx = db.transaction('fs-handles', 'readonly')
    const req = tx.objectStore('fs-handles').get('obsidianVaultHandle')
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

const sanitizeFileName = (name: string) => {
  return name.replace(/[^\w\-\s@\u4e00-\u9fa5]/g, '_').trim().slice(0, 120)
}

function normalizeXImageUrl(url: string) {
  const u = String(url || '').trim()
  if (!u) return ''
  if (!u.startsWith('http://') && !u.startsWith('https://')) return u
  try {
    const parsed = new URL(u)
    if (parsed.hostname.endsWith('twimg.com') && parsed.searchParams.has('name')) {
      const name = parsed.searchParams.get('name')
      if (name && (name === 'small' || name === 'thumb' || name === '240x240' || name === '360x360')) {
        parsed.searchParams.set('name', 'medium')
      }
    }
    return parsed.toString()
  } catch {
    return u
  }
}

function ImageGrid({ urls }: { urls: string[] }) {
  const list = (urls || []).map(normalizeXImageUrl).filter(Boolean)
  if (list.length === 0) return null
  return (
    <div className="grid grid-cols-1 gap-3 mt-3">
      {list.map((u) => (
        <a
          key={u}
          href={u}
          target="_blank"
          rel="noreferrer"
          className="block rounded-lg overflow-hidden border border-[var(--ui-border)] bg-[var(--ui-chrome-bg)] glow-border transition-all hover:scale-[1.01]"
        >
          <img
            src={u}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            className="w-full max-w-full h-auto block"
            onError={(e) => {
              const img = e.currentTarget
              img.style.display = 'none'
            }}
          />
        </a>
      ))}
    </div>
  )
}

/**
 * 将 tweet.text 中的 ![image](url) / ![video-poster](url) 渲染为内联图片，
 * 其余文字保持 whitespace-pre-wrap 格式。
 * 若文本中无内联图片，则回退为普通文字 + ImageGrid。
 */
function TweetTextWithImages({ text, images, textClassName = '' }: { text: string; images?: string[]; textClassName?: string }) {
  const IMG_PATTERN = /!\[(?:image|video-poster)\]\((https?:\/\/[^)]+)\)/g
  const hasInline = IMG_PATTERN.test(text)

  if (!hasInline) {
    return (
      <>
        <div className={`leading-relaxed whitespace-pre-wrap ${textClassName}`}>{text}</div>
        {images && images.length > 0 && <ImageGrid urls={images} />}
      </>
    )
  }

  const SPLIT = /(!\[(?:image|video-poster)\]\(https?:\/\/[^)]+\))/g
  const parts = text.split(SPLIT)
  const URL_EXTRACT = /!\[(?:image|video-poster)\]\((https?:\/\/[^)]+)\)/

  return (
    <div className="space-y-3">
      {parts.map((part, i) => {
        const m = part.match(URL_EXTRACT)
        if (m) {
          const imgUrl = normalizeXImageUrl(m[1])
          return (
            <a key={i} href={imgUrl} target="_blank" rel="noreferrer"
              className="block rounded-lg overflow-hidden border border-[var(--ui-border)] bg-[var(--ui-chrome-bg)] hover:opacity-95 transition-opacity">
              <img
                src={imgUrl}
                alt=""
                loading="lazy"
                referrerPolicy="no-referrer"
                className="w-full max-w-full h-auto block"
                onError={(e) => { e.currentTarget.style.display = 'none' }}
              />
            </a>
          )
        }
        const trimmed = part.trim()
        if (!trimmed) return null
        return (
          <div key={i} className={`leading-relaxed whitespace-pre-wrap ${textClassName}`}>
            {trimmed}
          </div>
        )
      })}
    </div>
  )
}

function ImageThumbs({ urls, compact }: { urls: string[], compact?: boolean }) {
  const limit = compact ? 1 : 3
  const list = (urls || []).map(normalizeXImageUrl).filter(Boolean).slice(0, limit)
  if (list.length === 0) return <span className="text-[var(--ui-muted)]">-</span>

  const sizeClass = compact ? 'w-8 h-8' : 'w-10 h-10'
  const gapClass = compact ? 'gap-1' : 'gap-1.5'

  return (
    <div className={`flex ${gapClass} justify-start`}>
      {list.map((u) => (
        <img
          key={u}
          src={u}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          className={`${sizeClass} rounded border border-[var(--ui-border)] bg-[var(--ui-chrome-bg)] object-cover`}
          onError={(e) => {
            e.currentTarget.style.display = 'none'
          }}
        />
      ))}
      {(urls || []).length > limit && (
        <div className={`${sizeClass} rounded border border-[var(--ui-border)] bg-[var(--ui-surface)] flex items-center justify-center text-xs text-[var(--ui-muted)]`}>
          +{urls.length - limit}
        </div>
      )}
    </div>
  )
}

function NewCategoryModal({
  isOpen,
  onClose,
  onConfirm,
  existingCategories
}: {
  isOpen: boolean
  onClose: () => void
  onConfirm: (name: string) => void
  existingCategories: string[]
}) {
  const [input, setInput] = useState('')

  if (!isOpen) return null

  const handleConfirm = () => {
    const trimmedName = input.trim()
    if (!trimmedName) {
      return
    }
    if (existingCategories.includes(trimmedName)) {
      return
    }
    onConfirm(trimmedName)
    setInput('')
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/10"
      onClick={() => {
        onClose()
        setInput('')
      }}
    >
      <div
        className="absolute bg-[var(--ui-bg)] rounded-lg shadow-xl border border-[var(--ui-border)] p-0"
        style={{ top: '185px', left: '60px' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 p-2 w-[320px]">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleConfirm()
              } else if (e.key === 'Escape') {
                onClose()
                setInput('')
              }
            }}
            placeholder="文件夹名称"
            className="flex-1 bg-[var(--ui-bg)] border border-[var(--ui-border)] rounded-md px-3 py-2 text-sm text-[var(--ui-fg)] outline-none focus:border-[var(--ui-primary)] transition-colors placeholder:text-[var(--ui-muted)]"
            autoFocus
          />
          <button
            onClick={handleConfirm}
            className="p-2 bg-[var(--ui-surface)] hover:bg-[var(--ui-border)] border border-[var(--ui-border)] text-[var(--ui-fg)] rounded-md transition-colors"
            title="保存"
          >
            <Save size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}

function CategoryPickerModal({
  isOpen,
  onClose,
  allCategories,
  currentCategory,
  categoryCount,
  onSelectCategory
}: {
  isOpen: boolean
  onClose: () => void
  allCategories: string[]
  currentCategory?: string
  categoryCount: (cat: string) => number
  onSelectCategory: (category: string) => void
}) {
  const [input, setInput] = useState('')

  if (!isOpen) return null

  const filteredCategories = allCategories.filter(c => c.toLowerCase().includes(input.toLowerCase()))
  const isNewCategory = input.trim() && !allCategories.includes(input.trim())

  const handleSelect = (category: string) => {
    onSelectCategory(category)
    onClose()
    setInput('')
  }

  const handleCreateAndSelect = () => {
    if (isNewCategory) {
      handleSelect(input.trim())
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-[var(--ui-bg)] rounded-lg shadow-2xl p-6 w-full max-w-md max-h-[80vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-[var(--ui-fg)]">选择分类</h3>
          <button onClick={onClose} className="text-[var(--ui-muted)] hover:text-[var(--ui-fg)]">
            <X size={20} />
          </button>
        </div>

        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && isNewCategory) {
              handleCreateAndSelect()
            }
          }}
          placeholder="搜索或创建新分类..."
          className="w-full px-3 py-2 rounded border border-[var(--ui-border)] bg-[var(--ui-surface)] text-[var(--ui-fg)] mb-4"
          autoFocus
        />

        <div className="flex-1 overflow-y-auto space-y-1">
          {isNewCategory && (
            <button
              onClick={handleCreateAndSelect}
              className="w-full flex items-center justify-between px-3 py-2 rounded hover:bg-[var(--ui-surface)] text-[var(--ui-primary)] font-medium"
            >
              <div className="flex items-center gap-2">
                <Plus size={16} />
                <span>创建 "{input.trim()}"</span>
              </div>
            </button>
          )}

          {filteredCategories.map(cat => (
            <button
              key={cat}
              onClick={() => handleSelect(cat)}
              className={`w-full flex items-center justify-between px-3 py-2 rounded hover:bg-[var(--ui-surface)] transition-colors ${cat === currentCategory ? 'bg-[var(--ui-active-bg)] text-[var(--ui-primary)]' : 'text-[var(--ui-fg)]'
                }`}
            >
              <div className="flex items-center gap-2">
                <Layers size={14} />
                <span>{cat}</span>
              </div>
              <span className="text-xs text-[var(--ui-muted)]">{categoryCount(cat)}</span>
            </button>
          ))}

          {filteredCategories.length === 0 && !isNewCategory && (
            <div className="text-center py-8 text-[var(--ui-muted)] text-sm">
              {allCategories.length === 0 ? '暂无分类' : '无匹配的分类'}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function useItems() {
  const [items, setItems] = useState<Item[]>([])
  useEffect(() => {
    const load = () => {
      chrome.storage.local.get(['x_scraper_items'], (res: unknown) => {
        const v = (res && typeof res === 'object' ? (res as Record<string, unknown>).x_scraper_items : undefined)
        const loaded = Array.isArray(v) ? (v as Item[]) : []
        // 确保每个 item 都有 tags 数组，但不设置 category 默认值
        setItems(loaded.map((it: any) => ({ ...it, tags: it.tags || [] })))
      })
    }
    load()
    const handler = (msg: unknown) => {
      if (msg && typeof msg === 'object' && 'type' in msg && (msg as { type: unknown }).type === 'X_SCRAPER_ITEMS_UPDATED') {
        load()
      }
    }
    chrome.runtime.onMessage.addListener(handler)
    return () => chrome.runtime.onMessage.removeListener(handler)
  }, [])

  const persistItems = async (next: Item[]) => {
    await new Promise<void>((resolve) => {
      try {
        chrome.storage.local.set({ x_scraper_items: next }, () => resolve())
      } catch {
        resolve()
      }
    })
    setItems(next)
  }

  return { items, setItems, persistItems }
}

function ListRow({
  index,
  it,
  selected,
  onToggleSelect,
  onClick,
  compact,
  onChangeCategory,
  onChangeTags,
}: {
  index: number
  it: Item
  selected: boolean
  onToggleSelect: () => void
  onClick: () => void
  compact?: boolean
  onChangeCategory: () => void
  onChangeTags?: () => void
}) {
  const createdAt = formatDateTime(it.tweet.publishedAt || it.capturedAt)
  return (
    <div
      onClick={onClick}
      className={`grid gap-4 items-center px-4 py-3 border-b border-[var(--ui-border)] cursor-pointer transition-colors duration-150 ${selected ? 'bg-[var(--ui-active-bg)]' : 'hover:bg-[var(--ui-surface-alt)]'
        }`}
      style={{
        gridTemplateColumns: TWEET_TABLE_COLS,
      }}
    >
      <div className="flex items-center justify-center gap-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => {
            e.stopPropagation()
            onToggleSelect()
          }}
          onClick={(e) => e.stopPropagation()}
          className="w-4 h-4 accent-[var(--ui-primary)] cursor-pointer shrinking-0"
        />
        <span className="text-[var(--ui-fg)] text-sm opacity-90 w-8 text-center">{index}</span>
      </div>

      <div className="flex items-center gap-3 min-w-0">
        <div
          className="w-11 h-11 rounded-full bg-cover flex-shrink-0 border border-[var(--ui-border)] shadow-sm"
          style={{ backgroundImage: `url(${it.tweet.authorAvatar || 'https://api.dicebear.com/7.x/avataaars/svg?seed=Anon'})` }}
        />
        <div className="flex flex-col min-w-0">
          <div className="text-sm font-semibold text-[var(--ui-fg)] truncate">{it.tweet.authorName}</div>
          <div className="text-xs text-[var(--ui-muted)] truncate">{it.tweet.authorHandle}</div>
        </div>
      </div>

      {/* Category Column */}
      <div
        onClick={(e) => {
          e.stopPropagation()
          onChangeCategory()
        }}
        className="text-sm text-[var(--ui-fg)] cursor-pointer hover:text-[var(--ui-primary)] transition-colors truncate"
        title={it.category ? "点击修改分类" : "点击添加分类"}
      >
        {it.category || '-'}
      </div>

      <div className="min-w-0">
        <div className="text-sm text-[var(--ui-fg)] line-clamp-2 break-words leading-normal opacity-90">
          {it.tweet.text}
        </div>
      </div>

      {/* Tags Column */}
      <div
        onClick={(e) => {
          e.stopPropagation()
          onChangeTags && onChangeTags()
        }}
        className="flex flex-wrap gap-1 cursor-pointer group min-h-[24px] items-center"
      >
        {(it.tags && it.tags.length > 0) ? (
          it.tags.slice(0, 3).map(tag => (
            <span key={tag} className="px-1.5 py-0.5 rounded-md bg-[var(--ui-surface)] border border-[var(--ui-border)] text-sm text-[var(--ui-muted)] group-hover:border-[var(--ui-primary)] group-hover:text-[var(--ui-primary)] transition-colors truncate max-w-[100px]">
              {tag}
            </span>
          ))
        ) : (
          <span className="text-sm text-[var(--ui-muted)] opacity-0 group-hover:opacity-50 transition-opacity flex items-center gap-1"><Plus size={14} /> 标签</span>
        )}
        {(it.tags?.length || 0) > 3 && <span className="text-sm text-[var(--ui-muted)]">+{it.tags!.length - 3}</span>}
      </div>

      <ImageThumbs urls={it.tweet.images} compact={compact} />

      <div className="flex justify-center">
        {it.tweet.url && (
          <a
            href={it.tweet.url}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="flex items-center justify-center w-8 h-8 rounded-full bg-[var(--ui-surface)] border border-[var(--ui-border)] text-[var(--ui-muted)] transition-all hover:text-[var(--ui-primary)] hover:border-[var(--ui-primary)]"
            title="查看原推文"
          >
            <ExternalLink size={14} />
          </a>
        )}
      </div>

      <div className="text-center text-sm text-[var(--ui-fg)] opacity-90">
        {it.tweet.viewCount !== undefined ? new Intl.NumberFormat('en-US', { notation: "compact", maximumFractionDigits: 1 }).format(it.tweet.viewCount) : '-'}
      </div>
      <div className="text-center text-sm text-[var(--ui-fg)] opacity-90">
        {it.tweet.retweetCount !== undefined ? new Intl.NumberFormat('en-US', { notation: "compact", maximumFractionDigits: 1 }).format(it.tweet.retweetCount) : '-'}
      </div>
      <div className="text-center text-sm text-[var(--ui-fg)] opacity-90">
        {it.tweet.likeCount !== undefined ? new Intl.NumberFormat('en-US', { notation: "compact", maximumFractionDigits: 1 }).format(it.tweet.likeCount) : '-'}
      </div>
      <div className="text-center text-sm text-[var(--ui-fg)] opacity-90">
        {it.tweet.replyCount !== undefined ? new Intl.NumberFormat('en-US', { notation: "compact", maximumFractionDigits: 1 }).format(it.tweet.replyCount) : '-'}
      </div>

      <div className="text-center text-sm text-[var(--ui-fg)] opacity-90">
        {createdAt || '-'}
      </div>
    </div>
  )
}

function CardItem({
  it,
  selected,
  onToggleSelect,
  onClick,
}: {
  it: Item
  selected: boolean
  onToggleSelect: () => void
  onClick: () => void
}) {
  const createdAt = formatDateTime(it.tweet.publishedAt || it.capturedAt)
  const firstImage = (it.tweet.images || []).map(normalizeXImageUrl).filter(Boolean)[0]

  return (
    <div
      onClick={onClick}
      className={`relative rounded-xl border bg-[var(--ui-surface)] cursor-pointer transition-all duration-200 overflow-hidden group ${selected
        ? 'border-[var(--ui-primary)] ring-1 ring-[var(--ui-primary)] shadow-[var(--glow-strong)]'
        : 'border-[var(--ui-border)] hover:border-[var(--ui-primary)] hover:shadow-lg'
        }`}
    >
      {/* Checkbox */}
      <div className="absolute top-3 right-3 z-10">
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => {
            e.stopPropagation()
            onToggleSelect()
          }}
          onClick={(e) => e.stopPropagation()}
          className="w-4 h-4 accent-[var(--ui-primary)] cursor-pointer"
        />
      </div>

      {/* Image Thumbnail */}
      {firstImage && (
        <div className="w-full h-40 overflow-hidden bg-[var(--ui-chrome-bg)]">
          <img
            src={firstImage}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover object-top transition-transform duration-300 group-hover:scale-105"
            onError={(e) => {
              e.currentTarget.parentElement!.style.display = 'none'
            }}
          />
        </div>
      )}

      {/* Content */}
      <div className="p-4">
        {/* User Info */}
        <div className="flex items-center gap-3 mb-3">
          <div
            className="w-10 h-10 rounded-full bg-cover flex-shrink-0 border border-[var(--ui-border)]"
            style={{ backgroundImage: `url(${it.tweet.authorAvatar || 'https://api.dicebear.com/7.x/avataaars/svg?seed=Anon'})` }}
          />
          <div className="flex flex-col min-w-0 flex-1">
            <div className="text-sm font-semibold text-[var(--ui-fg)] truncate">{it.tweet.authorName}</div>
            <div className="text-xs text-[var(--ui-muted)] truncate">{it.tweet.authorHandle}</div>
          </div>
        </div>

        {/* Tweet Text */}
        <div className="text-sm text-[var(--ui-fg)] leading-relaxed line-clamp-3 mb-3 opacity-90">
          {it.tweet.text}
        </div>

        {/* Stats Row */}
        <div className="flex items-center gap-4 text-xs text-[var(--ui-muted)] mb-2">
          <div className="flex items-center gap-1" title="浏览量">
            <Eye size={12} />
            <span>{it.tweet.viewCount !== undefined ? new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(it.tweet.viewCount) : '-'}</span>
          </div>
          <div className="flex items-center gap-1" title="转发">
            <Repeat2 size={12} />
            <span>{it.tweet.retweetCount !== undefined ? new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(it.tweet.retweetCount) : '-'}</span>
          </div>
          <div className="flex items-center gap-1" title="点赞">
            <Heart size={12} />
            <span>{it.tweet.likeCount !== undefined ? new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(it.tweet.likeCount) : '-'}</span>
          </div>
          <div className="flex items-center gap-1" title="回复">
            <MessageCircle size={12} />
            <span>{it.tweet.replyCount !== undefined ? new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(it.tweet.replyCount) : '-'}</span>
          </div>
        </div>

        {/* Time */}
        <div className="text-xs text-[var(--ui-muted)]">
          {createdAt || '-'}
        </div>
      </div>
    </div>
  )
}


function TagPickerModal({
  isOpen,
  onClose,
  allTags,
  currentTags,
  onUpdateTags
}: {
  isOpen: boolean
  onClose: () => void
  allTags: string[]
  currentTags: string[]
  onUpdateTags: (tags: string[]) => void
}) {
  const [input, setInput] = useState('')

  if (!isOpen) return null

  const handleAddTag = (tag: string) => {
    const t = tag.trim()
    if (!t) return
    if (!currentTags.includes(t)) {
      onUpdateTags([...currentTags, t])
    }
    setInput('')
  }

  const handleRemoveTag = (tag: string) => {
    onUpdateTags(currentTags.filter(t => t !== tag))
  }

  const filteredTags = allTags.filter(t => t.toLowerCase().includes(input.toLowerCase()) && !currentTags.includes(t))

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/50"
      onClick={onClose}
    >
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] bg-[#1a1a1a] border border-[#333] rounded-xl shadow-2xl overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-3 border-b border-[#333]">
          <h3 className="text-sm font-bold text-gray-200">编辑标签</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300"><X size={16} /></button>
        </div>

        <div className="p-4 flex flex-col gap-4">
          {/* Current Tags */}
          <div className="flex flex-wrap gap-2 min-h-[32px]">
            {currentTags.length === 0 && <span className="text-xs text-gray-500 italic">暂无标签</span>}
            {currentTags.map(tag => (
              <span key={tag} className="flex items-center gap-1 px-2 py-1 rounded bg-[var(--ui-primary)]/10 text-[var(--ui-primary)] text-xs border border-[var(--ui-primary)]/20">
                {tag}
                <button onClick={() => { handleRemoveTag(tag) }} className="hover:text-white"><X size={12} /></button>
              </span>
            ))}
          </div>

          {/* Input */}
          <div className="relative">
            <Tag size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleAddTag(input)
              }}
              placeholder="输入新标签并回车..."
              className="w-full bg-[#232323] border border-[#333] rounded-lg pl-9 pr-3 py-2 text-sm text-gray-200 focus:border-[var(--ui-primary)] outline-none"
              autoFocus
            />
          </div>

          {/* Suggestions */}
          {filteredTags.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="text-xs text-gray-500 font-medium">推荐标签</span>
              <div className="flex flex-wrap gap-2 max-h-[150px] overflow-y-auto custom-scrollbar">
                {filteredTags.map(tag => (
                  <button
                    key={tag}
                    onClick={() => handleAddTag(tag)}
                    className="px-2 py-1 rounded bg-[#2a2a2a] hover:bg-[#333] border border-[#333] text-gray-300 text-xs transition-colors"
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function DashboardApp() {
  const { items, persistItems } = useItems()
  const [active, setActive] = useState<any | null>(null)
  const [viewMode, setViewMode] = useState<'list' | 'card' | 'gallery'>('list')
  const [mode, setMode] = useState<'list' | 'settings'>('list')
  const [toast, setToast] = useState<string>('')
  const [vaultPath, setVaultPath] = useState<string>(getObsidianVaultPath())
  const [themeBg, setThemeBg] = useState<string>(getThemeBgColor())
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showPreview, setShowPreview] = useState<boolean>(false)
  const [listWidth, setListWidth] = useState<number>(getInitialListWidth())
  const [searchQuery, setSearchQuery] = useState('')
  const [isCollapsed, setIsCollapsed] = useState(false)

  // Export State
  const [showExportModal, setShowExportModal] = useState(false)
  const [exportFormat, setExportFormat] = useState<'csv' | 'json' | 'markdown' | 'pdf'>('csv')
  const [exportMergeMode, setExportMergeMode] = useState(true) // true: 合并成一个文件, false: 每条推文单独文件
  const [isExporting, setIsExporting] = useState(false)

  // Category Management State
  const [selectedCategory, setSelectedCategory] = useState<string>('全部')
  const [showCategoryPicker, setShowCategoryPicker] = useState(false)
  const [editingCategoryItemId, setEditingCategoryItemId] = useState<string | null>(null)
  const [showNewCategoryInput, setShowNewCategoryInput] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')
  const [showTagPicker, setShowTagPicker] = useState(false)
  const [editingTagItemId, setEditingTagItemId] = useState<string | null>(null)
  const [customCategories, setCustomCategories] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(CUSTOM_CATEGORIES_KEY) || '[]')
    } catch {
      return []
    }
  })

  useEffect(() => {
    localStorage.setItem(CUSTOM_CATEGORIES_KEY, JSON.stringify(customCategories))
  }, [customCategories])

  const menuWidth = isCollapsed ? 72 : MENU_WIDTH

  useEffect(() => {
    // Apply theme class to body
    if (themeBg === 'light') {
      document.body.classList.add('light-mode')
    } else {
      document.body.classList.remove('light-mode')
    }
  }, [themeBg])

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(''), 3000)
      return () => clearTimeout(timer)
    }
  }, [toast])

  const handleImportToObsidian = async () => {
    if (selectedIds.size === 0) {
      setToast('请先选择要导入的推文')
      return
    }

    const textPath = getObsidianVaultPath().trim()
    if (!textPath) {
      setMode('settings')
      setTimeout(() => setToast('未配置 Obsidian 库目录路径，请先设置'), 100)
      return
    }

    let handle = await getObsidianVaultHandle()
    if (!handle) {
      setMode('settings')
      setTimeout(() => setToast('未授权目录，请点击“更改”授权目录'), 100)
      return
    }

    // Check permissions
    const h = handle as unknown as HandleWithPerm
    let perm: PermissionState = h.queryPermission ? await h.queryPermission({ mode: 'readwrite' }) : 'granted'
    if (perm !== 'granted') perm = h.requestPermission ? await h.requestPermission({ mode: 'readwrite' }) : perm

    if (perm !== 'granted') {
      setMode('settings')
      setToast('目录权限不可用，请重新授权')
      return
    }

    const selectedItems = items.filter(it => selectedIds.has(it.id))
    let successCount = 0

    for (const it of selectedItems) {
      const dateStr = formatDateTime(it.tweet.publishedAt || it.capturedAt).replace(/[: ]/g, '_')
      const baseName = it.tweet.title || `${dateStr}_${it.tweet.authorHandle}_${it.tweet.id.slice(-6)}`
      const fileName = sanitizeFileName(baseName) + '.md'

      const getHighResUrl = (url: string) => {
        try {
          const u = new URL(url)
          if (u.hostname.includes('twimg.com')) {
            u.searchParams.set('name', 'large')
          }
          return u.toString()
        } catch {
          return url
        }
      }

      let content = it.tweet.text.replace(/@(\w+)/g, '[[@$1]]').replace(/\n/g, '  \n')
      // 若正文已含内联图片（X Notes 长文），不再末尾重复追加
      const hasInlineImgs = content.includes('![image](')

      const frontmatter = `---
title: "${(it.tweet.title || `Thread by @${it.tweet.authorHandle}`).replace(/"/g, '\\"')}"
link: ${it.tweet.url || ''}
author: "@${it.tweet.authorHandle}"
published: ${formatDateTime(it.tweet.publishedAt).split(' ')[0].replace(/-/g, '/')}
created: ${formatDateTime(it.capturedAt).split(' ')[0].replace(/-/g, '/')}
tags: [${(it.tags || []).map(t => `"${t}"`).join(', ')}]
---`

      const imgSection = hasInlineImgs ? '' : it.tweet.images.map(img => `![image](${getHighResUrl(img)})`).join('\n\n')

      const finalContent = `
${frontmatter}

${content}

${imgSection}

${it.replies && it.replies.length > 0 ? `
${it.replies.map(r => {
  const rContent = r.text.replace(/@(\w+)/g, '[[@$1]]').replace(/\n/g, '  \n')
  const rHasInline = rContent.includes('![image](')
  const rImgs = rHasInline ? '' : (r.images || []).map(img => `![image](${getHighResUrl(img)})`).join('\n\n')
  return `${rContent}\n\n${rImgs}`
}).join('\n\n')}
` : ''}
      `.trim()

      try {
        const fileHandle = await handle.getFileHandle(fileName, { create: true })
        const writable = await fileHandle.createWritable()
        await writable.write(finalContent)
        await writable.close()
        successCount++
      } catch (e) {
        console.error(`Failed to write ${fileName}`, e)
        setToast(`写入失败: ${fileName}`)
      }
    }

    if (successCount > 0) {
      setToast(`成功导入 ${successCount} 条推文到 Obsidian`)
      setSelectedIds(new Set())
    }
  }

  const handleDownloadMarkdown = async (mergeMode: boolean = true) => {
    const selectedItems = items.filter(it => selectedIds.has(it.id))
    if (selectedItems.length === 0) return

    const getHighResUrl = (url: string) => {
      try {
        const u = new URL(url)
        if (u.hostname.includes('twimg.com')) {
          u.searchParams.set('name', 'large')
        }
        return u.toString()
      } catch {
        return url
      }
    }

    if (mergeMode) {
      // 合并成一个文件 - 使用统一的 frontmatter
      const globalFrontmatter = `---
title: "Twitter Threads Collection"
created: ${formatDateTime(new Date().toISOString()).split(' ')[0].replace(/-/g, '/')}
total_tweets: ${selectedItems.length}
tags: []
---`

      const tweetsContent = selectedItems.map((it, idx) => {
        const content = it.tweet.text.replace(/@(\w+)/g, '[[@$1]]').replace(/\n/g, '  \n')
        const hasInlineImgs = content.includes('![image](')

        // 每条推文的元数据以普通文本格式展示
        const metadata = `**Author:** @${it.tweet.authorHandle} (${it.tweet.authorName})  
**Link:** ${it.tweet.url || 'N/A'}  
**Published:** ${formatDateTime(it.tweet.publishedAt).split(' ')[0]}  
**Captured:** ${formatDateTime(it.capturedAt).split(' ')[0]}`

        const images = hasInlineImgs ? '' : it.tweet.images.map(img => `![image](${getHighResUrl(img)})`).join('\n\n')

        const replies = it.replies && it.replies.length > 0
          ? `\n\n${it.replies.map(r => {
            const rContent = r.text.replace(/@(\w+)/g, '[[@$1]]').replace(/\n/g, '  \n')
            const rHasInline = rContent.includes('![image](')
            const rImgs = rHasInline ? '' : (r.images || []).map(img => `![image](${getHighResUrl(img)})`).join('\n\n')
            return `${rContent}\n\n${rImgs}`
          }).join('\n\n')}`
          : ''

        return `## Tweet ${idx + 1}

${metadata}

### Content

${content}

${images}${replies}`
      }).join('\n\n---\n\n')

      const allContent = `${globalFrontmatter}\n\n${tweetsContent}`

      const blob = new Blob([allContent], { type: 'text/markdown' })
      saveAs(blob, `tweets_merged_${new Date().toISOString().slice(0, 10)}.md`)
    } else {
      // 每条推文单独文件 - 使用独立的 frontmatter
      const zip = new JSZip()
      selectedItems.forEach(it => {
        const dateStr = formatDateTime(it.tweet.publishedAt || it.capturedAt).replace(/[: ]/g, '_')
        const baseName = it.tweet.title || `${dateStr}_${it.tweet.authorHandle}_${it.tweet.id.slice(-6)}`
        const fileName = sanitizeFileName(baseName) + '.md'

        let content = it.tweet.text.replace(/@(\w+)/g, '[[@$1]]').replace(/\n/g, '  \n')
        const hasInlineImgs = content.includes('![image](')
        const frontmatter = `---
title: "${(it.tweet.title || `Thread by @${it.tweet.authorHandle}`).replace(/"/g, '\\"')}"
link: ${it.tweet.url || ''}
author: "@${it.tweet.authorHandle}"
published: ${formatDateTime(it.tweet.publishedAt).split(' ')[0].replace(/-/g, '/')}
created: ${formatDateTime(it.capturedAt).split(' ')[0].replace(/-/g, '/')}
tags: []
---`

        const imgSection = hasInlineImgs ? '' : it.tweet.images.map(img => `![image](${getHighResUrl(img)})`).join('\n\n')

        const finalContent = `
${frontmatter}

${content}

${imgSection}

${it.replies && it.replies.length > 0 ? `
${it.replies.map(r => {
  const rContent = r.text.replace(/@(\w+)/g, '[[@$1]]').replace(/\n/g, '  \n')
  const rHasInline = rContent.includes('![image](')
  const rImgs = rHasInline ? '' : (r.images || []).map(img => `![image](${getHighResUrl(img)})`).join('\n\n')
  return `${rContent}\n\n${rImgs}`
}).join('\n\n')}
` : ''}
        `.trim()

        zip.file(fileName, finalContent)
      })

      const blob = await zip.generateAsync({ type: 'blob' })
      saveAs(blob, `tweets_markdown_${new Date().toISOString().slice(0, 10)}.zip`)
    }
  }

  const handleDownloadCSV = (mergeMode: boolean = true) => {
    const selectedItems = items.filter(it => selectedIds.has(it.id))
    if (selectedItems.length === 0) return

    if (mergeMode) {
      // 合并成一个CSV文件
      const headers = ['Content', 'Author Name', 'Author Handle', 'Created Time', 'URL', 'Images', 'Reply Content']
      const rows = selectedItems.map(it => {
        const replyContent = (it.replies || [])
          .map(r => r.text)
          .join('\n---\n')

        return [
          `"${(it.tweet.text || '').replace(/"/g, '""')}"`,
          `"${(it.tweet.authorName || '').replace(/"/g, '""')}"`,
          `"${(it.tweet.authorHandle || '').replace(/"/g, '""')}"`,
          `"${formatDateTime(it.tweet.publishedAt || it.capturedAt)}"`,
          `"${it.tweet.url || ''}"`,
          `"${it.tweet.images.join('; ')}"`,
          `"${replyContent.replace(/"/g, '""')}"`
        ].join(',')
      })

      const csvContent = [headers.join(','), ...rows].join('\n')
      const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8' })
      saveAs(blob, `tweets_merged_${new Date().toISOString().slice(0, 10)}.csv`)
    } else {
      // 每条推文单独CSV文件
      const zip = new JSZip()
      const headers = ['Content', 'Author Name', 'Author Handle', 'Created Time', 'URL', 'Images', 'Reply Content']

      selectedItems.forEach(it => {
        const replyContent = (it.replies || [])
          .map(r => r.text)
          .join('\n---\n')

        const row = [
          `"${(it.tweet.text || '').replace(/"/g, '""')}"`,
          `"${(it.tweet.authorName || '').replace(/"/g, '""')}"`,
          `"${(it.tweet.authorHandle || '').replace(/"/g, '""')}"`,
          `"${formatDateTime(it.tweet.publishedAt || it.capturedAt)}"`,
          `"${it.tweet.url || ''}"`,
          `"${it.tweet.images.join('; ')}"`,
          `"${replyContent.replace(/"/g, '""')}"`
        ].join(',')

        const csvContent = [headers.join(','), row].join('\n')
        const dateStr = formatDateTime(it.tweet.publishedAt || it.capturedAt).replace(/[: ]/g, '_')
        const baseName = it.tweet.title || `${dateStr}_${it.tweet.authorHandle}_${it.tweet.id.slice(-6)}`
        const fileName = sanitizeFileName(baseName) + '.csv'
        zip.file(fileName, '\uFEFF' + csvContent)
      })

      zip.generateAsync({ type: 'blob' }).then(blob => {
        saveAs(blob, `tweets_csv_${new Date().toISOString().slice(0, 10)}.zip`)
      })
    }
  }

  const handleDownloadJSON = (mergeMode: boolean = true) => {
    const selectedItems = items.filter(it => selectedIds.has(it.id))
    if (selectedItems.length === 0) return

    if (mergeMode) {
      // 合并成一个JSON文件
      const cleanData = selectedItems.map(it => ({
        author: `${it.tweet.authorName} (@${it.tweet.authorHandle})`,
        content: it.tweet.text,
        images: it.tweet.images || [],
        replies: (it.replies || []).map(r => r.text)
      }))

      const jsonStr = JSON.stringify(cleanData, null, 2)
      const blob = new Blob([jsonStr], { type: 'application/json' })
      saveAs(blob, `tweets_merged_${new Date().toISOString().slice(0, 10)}.json`)
    } else {
      // 每条推文单独JSON文件
      const zip = new JSZip()

      selectedItems.forEach(it => {
        const cleanData = {
          author: `${it.tweet.authorName} (@${it.tweet.authorHandle})`,
          content: it.tweet.text,
          images: it.tweet.images || [],
          replies: (it.replies || []).map(r => r.text)
        }

        const jsonStr = JSON.stringify(cleanData, null, 2)
        const dateStr = formatDateTime(it.tweet.publishedAt || it.capturedAt).replace(/[: ]/g, '_')
        const baseName = it.tweet.title || `${dateStr}_${it.tweet.authorHandle}_${it.tweet.id.slice(-6)}`
        const fileName = sanitizeFileName(baseName) + '.json'
        zip.file(fileName, jsonStr)
      })

      zip.generateAsync({ type: 'blob' }).then(blob => {
        saveAs(blob, `tweets_json_${new Date().toISOString().slice(0, 10)}.zip`)
      })
    }
  }

  const handleDownloadPDF = async (mergeMode: boolean = true) => {
    const selectedItems = items.filter(it => selectedIds.has(it.id))
    if (selectedItems.length === 0) return

    setIsExporting(true)

    const container = document.createElement('div')
    Object.assign(container.style, {
      position: 'absolute', left: '-9999px', top: '0', width: '760px', background: '#ffffff'
    })
    document.body.appendChild(container)

    const getHighResUrl = (url: string) => {
      try {
        const u = new URL(url)
        if (u.hostname.includes('twimg.com')) u.searchParams.set('name', 'large')
        return u.toString()
      } catch { return url }
    }

    const renderImages = (images: string[]) => {
      if (!images || images.length === 0) return ''
      return `<div style="display:flex;flex-direction:column;gap:16px;margin:20px 0;">${images.map(img => `<img src="${getHighResUrl(img)}" style="width:100%;height:auto;border-radius:8px;border:1px solid #eee;display:block;" crossorigin="anonymous"/>`).join('')}</div>`
    }

    const renderReplies = (replies: Item['replies']) => {
      if (!replies || replies.length === 0) return ''
      return `<div style="margin-top:20px;padding-top:10px;border-top:1px solid #eee;">
        ${replies.map(r => `<div style="margin-bottom:16px;font-size:15px;line-height:1.6;color:#000000;white-space:pre-wrap;">${r.text}</div>`).join('')}
      </div>`
    }

    const generatePDF = async (items: Item[], fileName: string) => {
      const doc = new jsPDF('p', 'mm', 'a4')
      const pageWidth = 210
      const pageHeight = 297
      let cursorY = 0

      for (let i = 0; i < items.length; i++) {
        const it = items[i]
        container.innerHTML = `
             <div style="padding: 40px; background: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #000000;">
                <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
                    <img src="${it.tweet.authorAvatar}" style="width:48px;height:48px;border-radius:50%;" crossorigin="anonymous"/>
                    <div>
                        <div style="font-weight:bold;font-size:18px;color:#000000;">${it.tweet.authorName}</div>
                        <div style="color:#536471;font-size:15px;">${it.tweet.authorHandle}</div>
                    </div>
                </div>
                <div style="white-space:pre-wrap;margin-bottom:16px;font-size:16px;line-height:1.6;color:#000000;">${it.tweet.text}</div>
                ${renderImages(it.tweet.images)}
                ${renderReplies(it.replies)}
            </div>`

        const canvas = await html2canvas(container, {
          useCORS: true, scale: 3, logging: false, backgroundColor: '#ffffff', windowWidth: 760
        })

        const imgData = canvas.toDataURL('image/jpeg', 0.95)
        const imgHeight = (canvas.height * pageWidth) / canvas.width

        if (cursorY + imgHeight > pageHeight - 10) {
          if (imgHeight < pageHeight - 20) {
            doc.addPage()
            doc.setFillColor(255, 255, 255)
            doc.rect(0, 0, pageWidth, pageHeight, 'F')
            cursorY = 0
            doc.addImage(imgData, 'JPEG', 0, cursorY, pageWidth, imgHeight)
            cursorY += imgHeight
          } else {
            if (cursorY > 10) {
              doc.addPage()
              doc.setFillColor(255, 255, 255)
              doc.rect(0, 0, pageWidth, pageHeight, 'F')
              cursorY = 0
            }
            let heightLeft = imgHeight
            let position = 0
            if (doc.getNumberOfPages() === 1 && cursorY === 0) {
              doc.setFillColor(255, 255, 255)
              doc.rect(0, 0, pageWidth, pageHeight, 'F')
            }
            doc.addImage(imgData, 'JPEG', 0, position, pageWidth, imgHeight)
            heightLeft -= pageHeight
            position -= pageHeight
            while (heightLeft > 0) {
              doc.addPage()
              doc.setFillColor(255, 255, 255)
              doc.rect(0, 0, pageWidth, pageHeight, 'F')
              doc.addImage(imgData, 'JPEG', 0, position, pageWidth, imgHeight)
              heightLeft -= pageHeight
              position -= pageHeight
            }
            cursorY = 0
          }
        } else {
          if (cursorY === 0) {
            doc.setFillColor(255, 255, 255)
            doc.rect(0, 0, pageWidth, pageHeight, 'F')
          }
          doc.addImage(imgData, 'JPEG', 0, cursorY, pageWidth, imgHeight)
          cursorY += imgHeight
        }
        if (cursorY < pageHeight) cursorY += 10
      }

      return doc.output('blob')
    }

    try {
      if (mergeMode) {
        // 合并成一个PDF文件
        const pdfBlob = await generatePDF(selectedItems, 'merged')
        saveAs(pdfBlob, `tweets_merged_${new Date().toISOString().slice(0, 10)}.pdf`)
      } else {
        // 每条推文单独PDF文件
        const zip = new JSZip()

        for (const it of selectedItems) {
          const pdfBlob = await generatePDF([it], 'single')
          const dateStr = formatDateTime(it.tweet.publishedAt || it.capturedAt).replace(/[: ]/g, '_')
          const baseName = it.tweet.title || `${dateStr}_${it.tweet.authorHandle}_${it.tweet.id.slice(-6)}`
          const fileName = sanitizeFileName(baseName) + '.pdf'
          zip.file(fileName, pdfBlob)
        }

        const zipBlob = await zip.generateAsync({ type: 'blob' })
        saveAs(zipBlob, `tweets_pdf_${new Date().toISOString().slice(0, 10)}.zip`)
      }
    } catch (err) {
      console.error(err)
      setToast('导出 PDF 失败')
    } finally {
      document.body.removeChild(container)
      setIsExporting(false)
      setShowExportModal(false)
    }
  }

  const executeExport = async () => {
    setIsExporting(true)
    try {
      if (exportFormat === 'csv') handleDownloadCSV(exportMergeMode)
      else if (exportFormat === 'json') handleDownloadJSON(exportMergeMode)
      else if (exportFormat === 'markdown') await handleDownloadMarkdown(exportMergeMode)
      else if (exportFormat === 'pdf') await handleDownloadPDF(exportMergeMode)
    } catch (err) {
      console.error(err)
      setToast('导出失败')
    } finally {
      setIsExporting(false)
      setShowExportModal(false)
    }
  }

  const handleCopyPreview = async (it: Item) => {
    // 1. Prepared Plain Text version
    const repliesText = (it.replies && it.replies.length > 0)
      ? '\n\n---\n' + it.replies.map(r => r.text).join('\n---\n')
      : '';
    const text = `${it.tweet.authorName} (@${it.tweet.authorHandle})\n\n${it.tweet.text}${repliesText}`

    // 2. Prepare Rich HTML version - simple structure
    const mainImagesHtml = it.tweet.images.map(img => `
      <p><img src="${img}" style="max-width:100%;height:auto;" /></p>
    `).join('');

    const repliesHtml = (it.replies && it.replies.length > 0)
      ? it.replies.map(r => {
        const replyImgs = (r.images || []).map(img => `
          <p><img src="${img}" style="max-width:100%;height:auto;" /></p>
        `).join('');
        return `
          <p style="padding-left:12px;border-left:2px solid #ccc;margin:16px 0;">${r.text}</p>
          ${replyImgs}
        `;
      }).join('')
      : '';

    const html = `
      <div>
        <p><b>${it.tweet.authorName}</b> @${it.tweet.authorHandle}</p>
        <p>${it.tweet.text}</p>
        ${mainImagesHtml}
        ${repliesHtml}
      </div>
    `;

    try {
      const textBlob = new Blob([text], { type: 'text/plain' });
      const htmlBlob = new Blob([html], { type: 'text/html' });
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': textBlob,
          'text/html': htmlBlob
        })
      ]);
      setToast('富文本已复制');
    } catch (err) {
      console.error('Copy failed', err);
      try {
        await navigator.clipboard.writeText(text);
        setToast('已复制纯文本');
      } catch (e2) {
        setToast('复制失败');
      }
    }
  }

  useEffect(() => { if (!active && items.length > 0) setActive(items[0]) }, [items])

  useEffect(() => {
    setSelectedIds((prev) => {
      if (!prev || prev.size === 0) return prev
      const existing = new Set(items.map((x) => x.id))
      const next = new Set<string>()
      for (const id of prev) if (existing.has(id)) next.add(id)
      return next
    })
  }, [items])

  useEffect(() => {
    localStorage.setItem(LIST_WIDTH_KEY, String(listWidth))
  }, [listWidth])

  useEffect(() => {
    localStorage.setItem(THEME_BG_KEY, themeBg)
  }, [themeBg])

  const chooseVaultPath = async () => {
    try {
      const w = window as unknown as DirectoryPickerWindow
      if (!w.showDirectoryPicker) {
        setToast('当前浏览器不支持目录授权，请手动输入绝对路径')
        return
      }
      const handle = await w.showDirectoryPicker({ id: 'obsidian-vault' })
      const h = handle as unknown as HandleWithPerm
      let perm: PermissionState = h.queryPermission ? await h.queryPermission({ mode: 'readwrite' }) : 'granted'
      if (perm !== 'granted') perm = h.requestPermission ? await h.requestPermission({ mode: 'readwrite' }) : perm
      if (perm !== 'granted') {
        setToast('未获得目录写入权限')
        return
      }
      await setObsidianVaultHandle(handle)
      setVaultPath(handle.name)
      setObsidianVaultPath(handle.name)
      setToast(`权限已授予，已选择: ${handle.name}`)
    } catch (e: unknown) {
      const msg = toErrorMessage(e)
      if (msg.includes('user aborted') || msg.includes('User aborted')) return
      setToast(msg)
    }
  }

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const isAllSelected = items.length > 0 && selectedIds.size === items.length

  const toggleSelectAll = () => {
    if (items.length === 0) return
    if (isAllSelected) {
      setSelectedIds(new Set())
      return
    }
    setSelectedIds(new Set(items.map((x) => x.id)))
  }

  const deleteSelected = async () => {
    if (selectedIds.size === 0) {
      setToast('请先选择要删除的推文')
      return
    }
    const ok = window.confirm(`确定删除选中的 ${selectedIds.size} 条吗？此操作不可撤销。`)
    if (!ok) return
    const next = items.filter((x) => !selectedIds.has(x.id))
    await persistItems(next)
    if (active && selectedIds.has(active.id)) setActive(next[0] || null)
    if (active && selectedIds.has(active.id)) setShowPreview(false)
    setSelectedIds(new Set())
    setToast('已删除选中项')
  }

  // Category Management Functions
  // 获取所有自定义分类（排除空值/undefined）
  // 获取所有自定义分类（排除空值/undefined）
  const allCategories = [...new Set([...items.map(it => it.category).filter(Boolean), ...customCategories])].filter(Boolean).sort()

  const categoryCount = (cat: string) => items.filter(it => it.category === cat).length

  const updateItemCategory = (itemId: string, category: string) => {
    const next = items.map(it => {
      if (it.id !== itemId) return it
      return { ...it, category }
    })
    persistItems(next)
  }

  const updateItemTags = (itemId: string, tags: string[]) => {
    const next = items.map(it => {
      if (it.id !== itemId) return it
      return { ...it, tags }
    })
    persistItems(next)
  }
  const allTags = [...new Set(items.flatMap(it => it.tags || []))].filter(Boolean).sort()

  const createNewCategory = () => {
    const trimmedName = newCategoryName.trim()
    if (!trimmedName) {
      setToast('分类名称不能为空')
      return
    }
    if (allCategories.includes(trimmedName)) {
      setToast('该分类已存在')
      return
    }
    // 创建成功，选中新分类
    setCustomCategories(prev => [...prev, trimmedName])
    setSelectedCategory(trimmedName)
    setShowNewCategoryInput(false)
    setNewCategoryName('')
    setToast(`已创建分类"${trimmedName}"`)
  }

  // 过滤推文列表
  const [showFilterPanel, setShowFilterPanel] = useState(false)
  const [isAuthorDropdownOpen, setIsAuthorDropdownOpen] = useState(false) // Deprecated by new UI but kept to prevent break if referenced elsewhere, though not needed in new UI
  const [authorSearch, setAuthorSearch] = useState('') // Search input for author list
  const [filters, setFilters] = useState({
    authors: [] as string[], // Changed to array for multi-select
    dateStart: '', // YYYY-MM
    dateEnd: '',   // YYYY-MM
    hasImages: false,
    hasReplies: false
  })

  // 提取所有作者
  const allAuthors = [...new Set(items.map(it => JSON.stringify({ name: it.tweet.authorName, handle: it.tweet.authorHandle })))].map(s => JSON.parse(s)).sort((a, b) => a.name.localeCompare(b.name))

  // 重置筛选
  const resetFilters = () => {
    setFilters({
      authors: [],
      dateStart: '',
      dateEnd: '',
      hasImages: false,
      hasReplies: false
    })
  }

  // 检查是否有生效的筛选条件
  const hasActiveFilters = filters.authors.length > 0 || filters.dateStart || filters.dateEnd || filters.hasImages || filters.hasReplies

  const displayItems = items.filter(it => {
    // 1. 搜索过滤
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      if (!it.tweet.text.toLowerCase().includes(q) &&
        !it.tweet.authorName.toLowerCase().includes(q) &&
        !it.tweet.authorHandle.toLowerCase().includes(q)) {
        return false
      }
    }

    // 2. 分类过滤
    if (selectedCategory !== '全部') {
      if (it.category !== selectedCategory) return false
    }

    // 3. 高级筛选
    // 3.0 作者筛选 (多选)
    if (filters.authors.length > 0 && !filters.authors.includes(it.tweet.authorHandle)) {
      return false
    }

    // 3.1 是否有图
    if (filters.hasImages && (!it.tweet.images || it.tweet.images.length === 0)) {
      return false
    }

    // 3.2 是否有回复
    if (filters.hasReplies && (!it.replies || it.replies.length === 0)) {
      return false
    }

    // 3.3 日期范围 (YYYY-MM)
    if (filters.dateStart || filters.dateEnd) {
      const dateStr = (it.tweet.publishedAt || it.capturedAt || '').slice(0, 7) // 取 "YYYY-MM"
      if (!dateStr) return false // 没有日期的项在筛选日期时被排除

      if (filters.dateStart && dateStr < filters.dateStart) return false
      if (filters.dateEnd && dateStr > filters.dateEnd) return false
    }

    return true
  })

  const onListItemClick = (it: Item) => {
    if (active && active.id === it.id && showPreview) {
      setShowPreview(false)
      return
    }
    setActive(it)
    setShowPreview(true)
    setMode('list')
  }

  // Handle clicking outside author dropdown
  useEffect(() => {
    const closeDropdown = () => setIsAuthorDropdownOpen(false)
    if (isAuthorDropdownOpen) {
      document.addEventListener('click', closeDropdown)
    }
    return () => document.removeEventListener('click', closeDropdown)
  }, [isAuthorDropdownOpen])

  return (
    <>
      <NewCategoryModal
        isOpen={showNewCategoryInput}
        onClose={() => {
          setShowNewCategoryInput(false)
          setNewCategoryName('')
        }}
        onConfirm={(name) => {
          setCustomCategories(prev => [...prev, name])
          setSelectedCategory(name)
          setShowNewCategoryInput(false)
          setNewCategoryName('')
          setToast(`已创建分类"${name}"`)
        }}
        existingCategories={allCategories}
      />

      <CategoryPickerModal
        isOpen={showCategoryPicker}
        onClose={() => {
          setShowCategoryPicker(false)
          setEditingCategoryItemId(null)
        }}
        allCategories={allCategories}
        currentCategory={editingCategoryItemId ? items.find(it => it.id === editingCategoryItemId)?.category : undefined}
        categoryCount={categoryCount}
        onSelectCategory={(category) => {
          if (editingCategoryItemId) {
            updateItemCategory(editingCategoryItemId, category)
          }
          setShowCategoryPicker(false)
          setEditingCategoryItemId(null)
          setToast(`已设置分类为 "${category}"`)
        }}
      />
      <TagPickerModal
        isOpen={showTagPicker}
        onClose={() => {
          setShowTagPicker(false)
          setEditingTagItemId(null)
        }}
        allTags={allTags}
        currentTags={editingTagItemId ? items.find(it => it.id === editingTagItemId)?.tags || [] : []}
        onUpdateTags={(tags) => {
          if (editingTagItemId) {
            updateItemTags(editingTagItemId, tags)
          }
        }}
      />
      <div className="flex w-full h-screen overflow-hidden bg-[var(--ui-bg)] text-[var(--ui-fg)] font-sans antialiased text-sm">
        {/* Sidebar */}
        <div
          className="flex flex-col gap-1 border-r border-[var(--ui-border)] bg-[var(--ui-bg)] transition-all duration-300 relative z-20"
          style={{ width: menuWidth }}
        >
          <div className="flex items-center justify-between h-16 px-4 mb-2">
            {!isCollapsed && (
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full flex items-center justify-center overflow-hidden">
                  <img src="/logo_64.png" alt="Logo" className="w-full h-full object-contain" onError={(e) => e.currentTarget.style.display = 'none'} />
                </div>
                <span className="font-bold text-lg tracking-tight text-[var(--ui-fg)] glow-text">xMine</span>
              </div>
            )}
            <button
              onClick={() => setIsCollapsed(!isCollapsed)}
              className={`text-[var(--ui-muted)] hover:text-[var(--ui-fg)] p-1 rounded-md transition-colors ${isCollapsed ? 'mx-auto' : ''}`}
              title={isCollapsed ? "展开" : "收起"}
            >
              {isCollapsed ? <PanelLeftOpen size={20} /> : <PanelLeftClose size={20} />}
            </button>
          </div>

          <div
            onClick={() => setMode('list')}
            className={`flex items-center gap-3 px-3 py-2.5 mx-2 rounded-lg cursor-pointer transition-colors ${mode === 'list' ? 'bg-[var(--ui-active-bg)] text-[var(--ui-primary)] font-semibold' : 'text-[var(--ui-muted)] hover:text-[var(--ui-fg)] hover:bg-[var(--ui-surface)]'
              } ${isCollapsed ? 'justify-center' : ''}`}
            title={isCollapsed ? "推文列表" : ""}
          >
            <FileText size={18} />
            {!isCollapsed && <span>推文列表</span>}
          </div>

          {/* Category Navigation */}
          {!isCollapsed && mode === 'list' && (
            <div className="mx-2 mt-4">
              <div className="flex items-center justify-between px-3 mb-2">
                <span className="text-xs font-medium text-[var(--ui-muted)] uppercase tracking-wider">分类</span>
                <button
                  onClick={() => {
                    setShowNewCategoryInput(true)
                    setNewCategoryName('')
                  }}
                  className="p-1 rounded hover:bg-[var(--ui-surface)] text-[var(--ui-muted)] hover:text-[var(--ui-primary)] transition-colors"
                  title="新建分类"
                >
                  <Plus size={14} />
                </button>
              </div>
              <div className="space-y-0.5 max-h-[300px] overflow-y-auto">

                <div
                  onClick={() => setSelectedCategory('全部')}
                  className={`flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer transition-all text-sm ${selectedCategory === '全部'
                    ? 'bg-[var(--ui-active-bg)] text-[var(--ui-primary)] font-medium'
                    : 'text-[var(--ui-fg)] hover:bg-[var(--ui-surface)]'
                    }`}
                >
                  <div className="flex items-center gap-2">
                    <Layers size={14} />
                    <span>全部</span>
                  </div>
                  <span className="text-xs text-[var(--ui-muted)]">{items.length}</span>
                </div>
                {allCategories.map(cat => (
                  <div
                    key={cat}
                    className={`group flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer transition-all text-sm ${selectedCategory === cat
                      ? 'bg-[var(--ui-active-bg)] text-[var(--ui-primary)] font-medium'
                      : 'text-[var(--ui-fg)] hover:bg-[var(--ui-surface)]'
                      }`}
                  >
                    <div className="flex items-center gap-2 flex-1 min-w-0" onClick={() => setSelectedCategory(cat)}>
                      <Layers size={14} />
                      <span className="truncate">{cat}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-[var(--ui-muted)] shrink-0 mr-1">{categoryCount(cat)}</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          const newName = window.prompt(`请输入新的分类名称：`, cat)
                          if (newName && newName.trim() && newName !== cat) {
                            const trimmedName = newName.trim()
                            if (allCategories.includes(trimmedName)) {
                              setToast('该分类名称已存在')
                              return
                            }
                            const itemsInCat = items.filter(it => it.category === cat)
                            itemsInCat.forEach(it => updateItemCategory(it.id, trimmedName))
                            // Update custom categories
                            if (customCategories.includes(cat)) {
                              setCustomCategories(prev => prev.map(c => c === cat ? trimmedName : c))
                            } else {
                              setCustomCategories(prev => [...prev, trimmedName])
                            }
                            if (selectedCategory === cat) {
                              setSelectedCategory(trimmedName)
                            }
                            setToast(`已将"${cat}"重命名为"${trimmedName}"`)
                          }
                        }}
                        className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-[var(--ui-bg)] text-[var(--ui-muted)] hover:text-[var(--ui-primary)] transition-opacity"
                        title="重命名分类"
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          if (window.confirm(`确定删除分类"${cat}"吗？该分类下的推文将变为无分类状态。`)) {
                            const itemsInCat = items.filter(it => it.category === cat)
                            const updatedItems = items.map(item =>
                              itemsInCat.some(it => it.id === item.id)
                                ? { ...item, category: undefined }
                                : item
                            )
                            persistItems(updatedItems)

                            // Remove from custom categories
                            setCustomCategories(prev => prev.filter(c => c !== cat))

                            if (selectedCategory === cat) {
                              setSelectedCategory('全部')
                            }
                            setToast(`已删除分类"${cat}"`)
                          }
                        }}
                        className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-[var(--ui-bg)] text-[var(--ui-muted)] hover:text-red-500 transition-opacity"
                        title="删除分类"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}


          <div
            onClick={() => setMode('settings')}
            className={`flex items-center gap-3 px-3 py-2.5 mx-2 rounded-lg cursor-pointer transition-colors ${mode === 'settings' ? 'bg-[var(--ui-active-bg)] text-[var(--ui-primary)] font-semibold' : 'text-[var(--ui-muted)] hover:text-[var(--ui-fg)] hover:bg-[var(--ui-surface)]'
              } ${isCollapsed ? 'justify-center' : ''}`}
            title={isCollapsed ? "设置" : ""}
          >
            <Settings size={18} />
            {!isCollapsed && <span>设置</span>}
          </div>
        </div>

        {mode === 'list' && (
          <div className="flex-1 flex min-w-0 bg-[var(--ui-bg)]">
            {/* List Area */}
            <div className="flex-1 min-w-[360px] flex flex-col border-r border-[var(--ui-border)]">
              {/* Toolbar */}
              <div className="h-16 flex items-center gap-6 px-4 border-b border-[var(--ui-border)] bg-[var(--ui-bg)] z-30 sticky top-0 backdrop-blur-md bg-opacity-95">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-[var(--ui-border)] bg-[var(--ui-surface)]">
                    <FileText size={14} className="text-[var(--ui-primary)]" />
                    <span className="font-semibold text-[var(--ui-fg)]">推文</span>
                    <span className="bg-[var(--ui-fg)] text-[var(--ui-bg)] text-xs font-bold px-1.5 rounded-full min-w-[20px] text-center">{items.length}</span>
                  </div>
                </div>

                <div className="relative w-64">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ui-muted)]" />
                  <input
                    type="text"
                    placeholder="搜索..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full h-9 pl-9 pr-3 rounded-full bg-[var(--ui-surface)] border border-[var(--ui-border)] text-[var(--ui-fg)] placeholder-[var(--ui-muted)] focus:border-[var(--ui-primary)] focus:bg-[var(--ui-surface-alt)] focus:outline-none transition-all text-sm"
                  />

                  {/* Filter Button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setShowFilterPanel(!showFilterPanel)
                    }}
                    className={`absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full transition-colors ${hasActiveFilters
                      ? 'text-[var(--ui-primary)] bg-[var(--ui-active-bg)]'
                      : 'text-[var(--ui-muted)] hover:text-[var(--ui-fg)] hover:bg-[var(--ui-border)]'
                      }`}
                    title="筛选"
                  >
                    <Filter size={14} />
                  </button>

                  {/* Filter Panel - Positioned relative to search bar */}
                  {/* Filter Panel - Mega Menu Style */}
                  {showFilterPanel && (
                    <>
                      {/* Invisible backdrop to close panel when clicking outside */}
                      <div className="fixed inset-0 z-40" onClick={() => setShowFilterPanel(false)} />

                      <div
                        className="absolute right-0 top-full mt-3 w-[340px] bg-[#1a1a1a] border border-[#333] rounded-xl shadow-2xl p-5 z-50 text-sm flex flex-col gap-5"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {/* 1. Date Range - Screenshot Style */}
                        <div className="flex flex-col gap-4">
                          {/* Row 1: Labels */}
                          <div className="flex justify-between px-1">
                            <label className="text-sm text-gray-200 font-bold">开始时间</label>
                            <label className="text-sm text-gray-200 font-bold">结束时间</label>
                          </div>

                          {/* Row 2: Selects Input */}
                          <div className="grid grid-cols-2 gap-6">
                            {/* Start Selects */}
                            <div className="flex gap-2">
                              <div className="relative flex-1">
                                <select
                                  className="w-full appearance-none bg-black border border-zinc-700 rounded-md text-gray-200 text-xs pl-2 pr-6 py-2 outline-none cursor-pointer hover:border-zinc-500 transition-colors"
                                  value={filters.dateStart ? filters.dateStart.split('-')[0] : ''}
                                  onChange={(e) => {
                                    const y = e.target.value
                                    if (!y) { setFilters(prev => ({ ...prev, dateStart: '' })); return }
                                    const m = filters.dateStart ? filters.dateStart.split('-')[1] : '01'
                                    setFilters(prev => ({ ...prev, dateStart: `${y}-${m}` }))
                                  }}
                                >
                                  <option value="">年份</option>
                                  {Array.from({ length: 21 }, (_, i) => 2006 + i).reverse().map(y => (
                                    <option key={y} value={y}>{y}</option>
                                  ))}
                                </select>
                                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-zinc-500">
                                  <svg className="fill-current h-3 w-3" viewBox="0 0 20 20"><path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" /></svg>
                                </div>
                              </div>
                              <div className="relative w-16">
                                <select
                                  className="w-full appearance-none bg-black border border-zinc-700 rounded-md text-gray-200 text-xs pl-2 pr-6 py-2 outline-none cursor-pointer hover:border-zinc-500 transition-colors"
                                  value={filters.dateStart ? filters.dateStart.split('-')[1] : ''}
                                  onChange={(e) => {
                                    const m = e.target.value
                                    if (!m) return
                                    const y = filters.dateStart ? filters.dateStart.split('-')[0] : new Date().getFullYear()
                                    setFilters(prev => ({ ...prev, dateStart: `${y}-${m}` }))
                                  }}
                                >
                                  <option value="">月</option>
                                  {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')).map(m => (
                                    <option key={m} value={m}>{m}</option>
                                  ))}
                                </select>
                                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-1 text-zinc-500">
                                  <svg className="fill-current h-3 w-3" viewBox="0 0 20 20"><path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" /></svg>
                                </div>
                              </div>
                            </div>

                            {/* End Selects */}
                            <div className="flex gap-2">
                              <div className="relative flex-1">
                                <select
                                  className="w-full appearance-none bg-black border border-zinc-700 rounded-md text-gray-200 text-xs pl-2 pr-6 py-2 outline-none cursor-pointer hover:border-zinc-500 transition-colors"
                                  value={filters.dateEnd ? filters.dateEnd.split('-')[0] : ''}
                                  onChange={(e) => {
                                    const y = e.target.value
                                    if (!y) { setFilters(prev => ({ ...prev, dateEnd: '' })); return }
                                    const m = filters.dateEnd ? filters.dateEnd.split('-')[1] : '12'
                                    setFilters(prev => ({ ...prev, dateEnd: `${y}-${m}` }))
                                  }}
                                >
                                  <option value="">年份</option>
                                  {Array.from({ length: 21 }, (_, i) => 2006 + i).reverse().map(y => (
                                    <option key={y} value={y}>{y}</option>
                                  ))}
                                </select>
                                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-zinc-500">
                                  <svg className="fill-current h-3 w-3" viewBox="0 0 20 20"><path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" /></svg>
                                </div>
                              </div>
                              <div className="relative w-16">
                                <select
                                  className="w-full appearance-none bg-black border border-zinc-700 rounded-md text-gray-200 text-xs pl-2 pr-6 py-2 outline-none cursor-pointer hover:border-zinc-500 transition-colors"
                                  value={filters.dateEnd ? filters.dateEnd.split('-')[1] : ''}
                                  onChange={(e) => {
                                    const m = e.target.value
                                    if (!m) return
                                    const y = filters.dateEnd ? filters.dateEnd.split('-')[0] : new Date().getFullYear()
                                    setFilters(prev => ({ ...prev, dateEnd: `${y}-${m}` }))
                                  }}
                                >
                                  <option value="">月</option>
                                  {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')).map(m => (
                                    <option key={m} value={m}>{m}</option>
                                  ))}
                                </select>
                                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-1 text-zinc-500">
                                  <svg className="fill-current h-3 w-3" viewBox="0 0 20 20"><path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" /></svg>
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Row 3: Text Display */}
                          <div className="text-xs text-[#888] pl-1">
                            已选择: <span className="text-[#ccc]">
                              {filters.dateStart ? `${filters.dateStart}-01` : '不限'}
                            </span> - <span className="text-[#ccc]">
                              {filters.dateEnd ? (() => {
                                const [y, m] = filters.dateEnd.split('-');
                                const lastDay = new Date(parseInt(y), parseInt(m), 0).getDate();
                                return `${y}-${m}-${lastDay}`;
                              })() : '不限'}
                            </span>
                          </div>

                          {/* Row 4: Quick Buttons */}
                          <div className="grid grid-cols-4 gap-3">
                            {[
                              {
                                label: '本周', action: () => {
                                  const now = new Date();
                                  const m = String(now.getMonth() + 1).padStart(2, '0');
                                  const y = now.getFullYear();
                                  setFilters(prev => ({ ...prev, dateStart: `${y}-${m}`, dateEnd: `${y}-${m}` }));
                                }
                              },
                              {
                                label: '本月', action: () => {
                                  const now = new Date();
                                  const m = String(now.getMonth() + 1).padStart(2, '0');
                                  const y = now.getFullYear();
                                  setFilters(prev => ({ ...prev, dateStart: `${y}-${m}`, dateEnd: `${y}-${m}` }));
                                }
                              },
                              {
                                label: '上周', action: () => {
                                  const now = new Date();
                                  // Simple logic: just map to current month for now as filter is month-based
                                  const m = String(now.getMonth() + 1).padStart(2, '0');
                                  const y = now.getFullYear();
                                  setFilters(prev => ({ ...prev, dateStart: `${y}-${m}`, dateEnd: `${y}-${m}` }));
                                }
                              },
                              {
                                label: '上月', action: () => {
                                  const now = new Date();
                                  now.setMonth(now.getMonth() - 1);
                                  const m = String(now.getMonth() + 1).padStart(2, '0');
                                  const y = now.getFullYear();
                                  setFilters(prev => ({ ...prev, dateStart: `${y}-${m}`, dateEnd: `${y}-${m}` }));
                                }
                              }
                            ].map((btn, idx) => (
                              <button
                                key={idx}
                                onClick={btn.action}
                                className="bg-[#0a0a0a] hover:bg-[#202020] text-gray-300 hover:text-white border border-zinc-700 rounded-md py-2 text-xs font-medium transition-colors"
                              >
                                {btn.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* 2. Attributes */}
                        <div className="flex flex-col gap-2">
                          <label className="text-sm text-gray-200 font-bold">内容属性</label>
                          <div className="flex gap-2">
                            <label className="flex-1 flex items-center justify-between cursor-pointer group p-2 bg-[#232323] border border-[#333] rounded-lg hover:border-[#444] transition-colors">
                              <span className="text-xs text-gray-300">有图</span>
                              <div className={`w-8 h-4 rounded-full relative transition-colors ${filters.hasImages ? 'bg-[var(--ui-primary)]' : 'bg-[#444]'}`}>
                                <input
                                  type="checkbox"
                                  checked={filters.hasImages}
                                  onChange={(e) => setFilters(prev => ({ ...prev, hasImages: e.target.checked }))}
                                  className="sr-only"
                                />
                                <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${filters.hasImages ? 'left-4.5 translate-x-0' : 'left-0.5'}`} style={{ left: filters.hasImages ? '18px' : '2px' }} />
                              </div>
                            </label>

                            <label className="flex-1 flex items-center justify-between cursor-pointer group p-2 bg-[#232323] border border-[#333] rounded-lg hover:border-[#444] transition-colors">
                              <span className="text-xs text-gray-300">有回复</span>
                              <div className={`w-8 h-4 rounded-full relative transition-colors ${filters.hasReplies ? 'bg-[var(--ui-primary)]' : 'bg-[#444]'}`}>
                                <input
                                  type="checkbox"
                                  checked={filters.hasReplies}
                                  onChange={(e) => setFilters(prev => ({ ...prev, hasReplies: e.target.checked }))}
                                  className="sr-only"
                                />
                                <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${filters.hasReplies ? 'left-4.5 translate-x-0' : 'left-0.5'}`} style={{ left: filters.hasReplies ? '18px' : '2px' }} />
                              </div>
                            </label>
                          </div>
                        </div>

                        {/* 3. Author Selection */}
                        <div className="flex flex-col gap-2 min-w-0">
                          <div className="flex items-center justify-between">
                            <label className="text-sm text-gray-200 font-bold">发布账号</label>
                            {filters.authors.length > 0 && (
                              <button
                                onClick={() => setFilters(prev => ({ ...prev, authors: [] }))}
                                className="text-xs text-[var(--ui-primary)] hover:underline"
                              >
                                清空 ({filters.authors.length})
                              </button>
                            )}
                          </div>

                          {/* Search */}
                          <div className="relative">
                            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
                            <input
                              type="text"
                              placeholder="搜索账号..."
                              value={authorSearch}
                              onChange={(e) => setAuthorSearch(e.target.value)}
                              className="w-full bg-[#232323] border border-[#333] rounded-lg pl-8 pr-3 py-2 text-xs text-gray-200 focus:border-[var(--ui-primary)] outline-none placeholder-gray-600 transition-colors"
                            />
                          </div>

                          {/* List */}
                          <div className="h-[200px] overflow-y-auto bg-[#232323] border border-[#333] rounded-lg p-1 custom-scrollbar">
                            <div className="flex flex-col gap-1">
                              {allAuthors
                                .filter(a =>
                                  !authorSearch ||
                                  a.name.toLowerCase().includes(authorSearch.toLowerCase()) ||
                                  a.handle.toLowerCase().includes(authorSearch.toLowerCase())
                                )
                                .map(a => {
                                  const isSelected = filters.authors.includes(a.handle)
                                  return (
                                    <div
                                      key={a.handle}
                                      className={`flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer transition-all ${isSelected ? 'bg-[var(--ui-active-bg)]' : 'hover:bg-[#2a2a2a]'}`}
                                      onClick={() => {
                                        setFilters(prev => {
                                          const newAuthors = isSelected
                                            ? prev.authors.filter(h => h !== a.handle)
                                            : [...prev.authors, a.handle]
                                          return { ...prev, authors: newAuthors }
                                        })
                                      }}
                                    >
                                      <div className={`shrink-0 w-3.5 h-3.5 rounded border flex items-center justify-center transition-colors ${isSelected ? 'bg-[var(--ui-primary)] border-[var(--ui-primary)]' : 'border-[#555] bg-transparent'}`}>
                                        {isSelected && <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="black" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>}
                                      </div>
                                      <div className="flex flex-col min-w-0">
                                        <span className={`text-xs truncate font-medium ${isSelected ? 'text-[var(--ui-primary)]' : 'text-gray-300'}`}>{a.name}</span>
                                        <span className="text-xs text-gray-500 truncate">@{a.handle}</span>
                                      </div>
                                    </div>
                                  )
                                })}
                              {allAuthors.filter(a => !authorSearch || a.name.toLowerCase().includes(authorSearch.toLowerCase()) || a.handle.toLowerCase().includes(authorSearch.toLowerCase())).length === 0 && (
                                <div className="text-center py-8 text-gray-500 text-xs">无匹配账号</div>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* 4. Actions */}
                        <div className="flex items-center gap-3 mt-2 pt-4 border-t border-[#333]">
                          <button
                            onClick={resetFilters}
                            className="flex-1 bg-[#2a2a2a] hover:bg-[#333] text-gray-400 hover:text-white font-medium py-2 rounded-lg transition-colors border border-[#333] text-xs"
                          >
                            重置
                          </button>
                          <button
                            onClick={() => setShowFilterPanel(false)}
                            className="flex-[1.5] bg-[var(--ui-primary)] hover:bg-[var(--ui-primary-hover)] text-[var(--ui-bg)] font-medium py-2 rounded-lg transition-colors text-xs shadow-lg shadow-yellow-500/20"
                          >
                            确认
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Actions Bar */}
              <div className="h-12 flex items-center px-4 border-b border-[var(--ui-border)] bg-[var(--ui-bg)] sticky top-16 z-10">
                <div className="flex items-center p-1 rounded-lg bg-[var(--ui-surface)] border border-[var(--ui-border)] mr-4">
                  <button
                    onClick={() => setViewMode('list')}
                    className={`p-1.5 rounded-md transition-all ${viewMode === 'list' ? 'bg-[var(--ui-active-bg)] text-[var(--ui-primary)] shadow-sm' : 'text-[var(--ui-muted)] hover:text-[var(--ui-fg)]'}`}
                    title="列表视图"
                  >
                    <LayoutList size={16} />
                  </button>
                  <button
                    onClick={() => setViewMode('card')}
                    className={`p-1.5 rounded-md transition-all ${viewMode === 'card' ? 'bg-[var(--ui-active-bg)] text-[var(--ui-primary)] shadow-sm' : 'text-[var(--ui-muted)] hover:text-[var(--ui-fg)]'}`}
                    title="卡片视图"
                  >
                    <Layers size={16} />
                  </button>
                  <button
                    onClick={() => setViewMode('gallery')}
                    className={`p-1.5 rounded-md transition-all ${viewMode === 'gallery' ? 'bg-[var(--ui-active-bg)] text-[var(--ui-primary)] shadow-sm' : 'text-[var(--ui-muted)] hover:text-[var(--ui-fg)]'}`}
                    title="画廊视图"
                  >
                    <LayoutGrid size={16} />
                  </button>
                </div>

                <div className="h-5 w-px bg-[var(--ui-border)] mr-4" />

                <div className="flex items-center gap-2">
                  <button
                    disabled={selectedIds.size === 0}
                    onClick={deleteSelected}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold uppercase tracking-wider border transition-all ${selectedIds.size > 0
                      ? 'border-[var(--ui-fg)] text-[var(--ui-fg)] hover:bg-[var(--ui-fg)] hover:text-[var(--ui-bg)]'
                      : 'border-[var(--ui-border)] text-[var(--ui-muted)] cursor-default opacity-50'
                      }`}
                  >
                    <Trash2 size={13} />
                    删除
                  </button>

                  <button
                    disabled={selectedIds.size === 0}
                    onClick={handleImportToObsidian}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold uppercase tracking-wider border transition-all ${selectedIds.size > 0
                      ? 'border-[var(--ui-border)] text-[var(--ui-fg)] hover:border-[var(--ui-fg)] hover:shadow-[var(--glow-subtle)]'
                      : 'border-[var(--ui-border)] text-[var(--ui-muted)] cursor-default opacity-50'
                      }`}
                  >
                    <FileDown size={13} />
                    导出
                  </button>

                  <button
                    disabled={selectedIds.size === 0}
                    onClick={() => {
                      setExportFormat('markdown')
                      setExportMergeMode(true)
                      setShowExportModal(true)
                    }}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold uppercase tracking-wider border transition-all ${selectedIds.size > 0
                      ? 'bg-[var(--ui-primary)] border-[var(--ui-primary)] text-[var(--ui-bg)] hover:bg-[var(--ui-primary-hover)] shadow-[var(--glow-strong)]'
                      : 'border-[var(--ui-border)] text-[var(--ui-muted)] cursor-default opacity-50'
                      }`}
                  >
                    <Download size={13} />
                    下载
                  </button>
                </div>
              </div>

              {/* List Content */}
              <div className="flex-1 overflow-auto">
                {viewMode === 'list' && (
                  <div style={{ minWidth: '1160px' }}>
                    <>
                      <div
                        className="sticky top-0 z-10 grid gap-4 items-center px-4 py-3 bg-[var(--ui-bg)] border-b border-[var(--ui-border)] text-sm font-bold text-[var(--ui-muted)] uppercase tracking-wider"
                        style={{ gridTemplateColumns: TWEET_TABLE_COLS }}
                      >
                        <div className="flex items-center justify-center gap-3 whitespace-nowrap">
                          <input type="checkbox" checked={isAllSelected} onChange={toggleSelectAll} className="w-4 h-4 accent-[var(--ui-primary)] shrinking-0" />
                          <span className="w-8 text-center">序号</span>
                        </div>
                        <div>用户</div>
                        <div>分类</div>
                        <div>推文内容</div>
                        <div>标签</div>
                        <div>媒体</div>
                        <div className="text-center">原链接</div>
                        <div className="text-center">浏览</div>
                        <div className="text-center">转发</div>
                        <div className="text-center">点赞</div>
                        <div className="text-center">回复</div>
                        <div className="text-center">创建时间</div>
                      </div>

                      <div className="pb-20">
                        {displayItems.map((it, idx) => (
                          <ListRow
                            key={it.id}
                            index={idx + 1}
                            it={it}
                            selected={selectedIds.has(it.id)}
                            onToggleSelect={() => toggleSelect(it.id)}
                            onClick={() => onListItemClick(it)}
                            compact={true}
                            onChangeCategory={() => {
                              setEditingCategoryItemId(it.id)
                              setShowCategoryPicker(true)
                            }}
                            onChangeTags={() => {
                              setEditingTagItemId(it.id)
                              setShowTagPicker(true)
                            }}
                          />
                        ))}
                      </div>
                    </>
                  </div>
                )}

                {viewMode === 'card' && (
                  <div className="p-6">
                    {/* Select All Checkbox */}
                    <div className="flex items-center gap-3 mb-4 px-2">
                      <input type="checkbox" checked={isAllSelected} onChange={toggleSelectAll} className="w-4 h-4 accent-[var(--ui-primary)]" />
                      <span className="text-sm text-[var(--ui-muted)]">全选</span>
                    </div>

                    {/* Responsive Card Grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4 pb-20">
                      {items.filter(it => {
                        if (!searchQuery) return true
                        const q = searchQuery.toLowerCase()
                        return it.tweet.text?.toLowerCase().includes(q) || it.tweet.authorName?.toLowerCase().includes(q) || it.tweet.authorHandle?.toLowerCase().includes(q)
                      }).map((it) => (
                        <CardItem
                          key={it.id}
                          it={it}
                          selected={selectedIds.has(it.id)}
                          onToggleSelect={() => toggleSelect(it.id)}
                          onClick={() => onListItemClick(it)}
                        />
                      ))}
                    </div>

                    {items.length === 0 && (
                      <div className="flex flex-col items-center justify-center py-20 text-[var(--ui-muted)]">
                        <div className="text-lg">暂无推文</div>
                      </div>
                    )}
                  </div>
                )}

                {viewMode === 'gallery' && (
                  <div className="p-6 columns-xs md:columns-sm lg:columns-md xl:columns-lg gap-4 space-y-4">
                    {items
                      .filter(it => it.tweet.images && it.tweet.images.length > 0)
                      .flatMap(it => it.tweet.images.map((img: string, i: number) => ({ item: it, src: img, id: it.id + '_' + i })))
                      .map((entry) => (
                        <div
                          key={entry.id}
                          onClick={() => { setActive(entry.item); setShowPreview(true); }}
                          className="group break-inside-avoid mb-4 rounded-xl overflow-hidden cursor-pointer bg-[var(--ui-surface)] border border-[var(--ui-border)] hover:border-[var(--ui-primary)] transition-all hover:shadow-[var(--glow-strong)]"
                        >
                          <img src={entry.src} loading="lazy" className="w-full h-auto block transition-transform duration-300 group-hover:scale-105" />
                        </div>
                      ))}
                    {items.filter(it => it.tweet.images && it.tweet.images.length > 0).length === 0 && (
                      <div className="flex flex-col items-center justify-center py-20 text-[var(--ui-muted)]">
                        <div className="text-lg">暂无包含图片的推文</div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Preview Panel - Side-by-side flex layout */}
            {showPreview && active && (
              <div className="w-[400px] xl:w-[420px] 2xl:w-[480px] 3xl:w-[600px] flex-none border-l border-[var(--ui-border)] bg-[var(--ui-surface)] flex flex-col shadow-[-10px_0_30px_rgba(0,0,0,0.2)] z-30 transition-all duration-300">
                <div className="h-14 flex items-center justify-between px-5 border-b border-[var(--ui-border)] bg-[var(--ui-surface-alt)]">
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-[var(--ui-primary)] glow-text" />
                    <h3 className="font-bold text-sm uppercase tracking-widest text-[var(--ui-fg)]">预览</h3>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleCopyPreview(active)}
                      className="p-2 rounded-md hover:bg-[var(--ui-active-bg)] text-[var(--ui-muted)] hover:text-[var(--ui-fg)] transition-all flex items-center gap-2 text-xs font-bold"
                      title="复制 HTML/文本"
                    >
                      <Copy size={16} />
                      <span>复制</span>
                    </button>
                    <div className="w-px h-4 bg-[var(--ui-border)] mx-1" />
                    <button
                      onClick={() => setShowPreview(false)}
                      className="p-2 rounded-md hover:bg-[#CC0000] hover:text-white text-[var(--ui-muted)] transition-all"
                      title="关闭"
                    >
                      <X size={18} />
                    </button>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-5">
                  <div className="flex items-center gap-4 mb-5">
                    <div className="w-12 h-12 rounded-full border border-[var(--ui-border)] bg-cover" style={{ backgroundImage: `url(${active.tweet.authorAvatar || 'https://api.dicebear.com/7.x/avataaars/svg?seed=Anon'})` }} />
                    <div>
                      <div className="font-bold text-lg text-[var(--ui-fg)]">{active.tweet.authorName}</div>
                      <div className="text-[var(--ui-muted)]">{active.tweet.authorHandle}</div>
                    </div>
                  </div>

                  <TweetTextWithImages
                    text={active.tweet.text}
                    images={active.tweet.images}
                    textClassName="text-[15px] text-[var(--ui-fg)] opacity-90 mb-4"
                  />

                  {active.replies && active.replies.length > 0 && (
                    <div className="mt-8 pt-6 border-t border-[var(--ui-border)]">
                      <div className="space-y-6">
                        {active.replies.map((r) => (
                          <div key={r.id} className="pl-4 border-l-2 border-[var(--ui-border)]">
                            <TweetTextWithImages
                              text={r.text}
                              images={r.images}
                              textClassName="text-sm text-[var(--ui-fg)] opacity-90"
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {mode === 'settings' && (
          <div className="flex-1 overflow-y-auto p-10 bg-[var(--ui-bg)]">
            <div className="max-w-2xl mx-auto">
              <h2 className="text-2xl font-bold mb-6 text-[var(--ui-fg)] flex items-center gap-3">
                <Settings size={28} className="text-[var(--ui-primary)]" />
                设置
              </h2>

              <div className="glass-panel rounded-2xl p-6 mb-8">
                <h3 className="text-lg font-bold mb-3 text-[var(--ui-fg)]">Obsidian 库路径</h3>
                <p className="text-[var(--ui-muted)] text-sm mb-4">配置写入 Obsidian 库的目录。出于浏览器安全限制，<b>此处仅显示文件夹名称</b>。建议选择库内的“Inbox”或“Resources”等子文件夹。</p>

                <div className="flex gap-3">
                  <div className={`flex-1 px-4 py-2.5 rounded-lg border bg-[var(--ui-surface)] text-sm ${vaultPath ? 'border-[var(--ui-border)] text-[var(--ui-fg)]' : 'border-[var(--ui-fg)] text-[var(--ui-fg)] font-bold'}`}>
                    {vaultPath || '未配置（请点击选择目录）'}
                  </div>
                  <button onClick={chooseVaultPath} className="px-5 py-2.5 rounded-lg bg-[var(--ui-primary)] text-[var(--ui-bg)] font-bold hover:bg-[var(--ui-primary-hover)] transition-colors shadow-[var(--glow-strong)]">
                    {vaultPath ? '更改目录' : '选择目录'}
                  </button>
                </div>
              </div>

              <div className="glass-panel rounded-2xl p-6">
                <h3 className="text-lg font-bold mb-3 text-[var(--ui-fg)]">主题颜色</h3>
                <p className="text-[var(--ui-muted)] text-sm mb-4">选择界面外观。深色模式更适合长时间阅读，浅色模式更适合明亮环境。</p>

                <div className="grid grid-cols-2 gap-4">
                  {[
                    { name: '深色', value: 'dark', color: '#000000' },
                    { name: '浅色', value: 'light', color: '#FFFFFF' },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setThemeBg(opt.value)}
                      className={`flex items-center gap-4 p-4 rounded-xl border transition-all text-left ${themeBg === opt.value
                        ? 'border-[var(--ui-primary)] bg-[var(--ui-active-bg)] ring-1 ring-[var(--ui-primary)]'
                        : 'border-[var(--ui-border)] bg-[var(--ui-surface)] hover:border-[var(--ui-primary)]'
                        }`}
                    >
                      <div className="w-10 h-10 rounded-lg shadow-sm border border-[var(--ui-border)]" style={{ background: opt.color }} />
                      <div>
                        <div className="font-bold text-[var(--ui-fg)]">{opt.name}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {toast && (
          <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-top-4 duration-300">
            <div className="px-6 py-3 rounded-full bg-[var(--ui-bg)] border border-[var(--ui-fg)] shadow-[var(--glow-strong)] text-[var(--ui-fg)] text-sm font-bold flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-[var(--ui-fg)] animate-pulse" />
              {toast}
            </div>
          </div>
        )}

        {showExportModal && (
          <div className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="glass-panel w-full max-w-md rounded-2xl p-6 shadow-2xl scale-100 animate-in zoom-in-95 duration-200 bg-[var(--ui-bg)]">
              <h3 className="text-xl font-bold text-[var(--ui-fg)] mb-6">选择下载格式</h3>

              <div className="grid grid-cols-1 gap-3 mb-8">
                {[
                  { id: 'markdown', label: 'Markdown', desc: '纯文本标记语言 (.md)' },
                  { id: 'pdf', label: 'PDF', desc: '便携式文档格式' },
                  { id: 'json', label: 'JSON', desc: '数据交换格式' },
                  { id: 'csv', label: 'CSV', desc: '电子表格通用格式' },
                ].map((opt) => (
                  <div
                    key={opt.id}
                    onClick={() => setExportFormat(opt.id as any)}
                    className={`flex items-center gap-4 p-3 rounded-xl border cursor-pointer transition-all ${exportFormat === opt.id
                      ? 'border-[var(--ui-primary)] bg-[var(--ui-active-bg)]'
                      : 'border-[var(--ui-border)] bg-[var(--ui-surface)] hover:bg-[var(--ui-surface-alt)]'
                      }`}
                  >
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${exportFormat === opt.id ? 'border-[var(--ui-primary)]' : 'border-[var(--ui-muted)]'}`}>
                      {exportFormat === opt.id && <div className="w-2.5 h-2.5 rounded-full bg-[var(--ui-primary)]" />}
                    </div>
                    <div>
                      <div className="font-semibold text-[var(--ui-fg)]">{opt.label}</div>
                      <div className="text-xs text-[var(--ui-muted)]">{opt.desc}</div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Merge Mode Selection */}
              <div className="mb-8 p-4 rounded-xl bg-[var(--ui-surface)] border border-[var(--ui-border)]">
                <h4 className="text-sm font-semibold text-[var(--ui-fg)] mb-3">文件输出方式</h4>
                <div className="space-y-2">
                  <label
                    className="flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all hover:bg-[var(--ui-surface-alt)] group"
                  >
                    <input
                      type="radio"
                      name="mergeMode"
                      checked={exportMergeMode}
                      onChange={() => setExportMergeMode(true)}
                      className="w-4 h-4 accent-[var(--ui-primary)] cursor-pointer"
                    />
                    <div>
                      <div className="text-sm font-medium text-[var(--ui-fg)]">合并成一个文件</div>
                      <div className="text-xs text-[var(--ui-muted)]">将所有选中的推文合并导出为单个文件</div>
                    </div>
                  </label>
                  <label
                    className="flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all hover:bg-[var(--ui-surface-alt)] group"
                  >
                    <input
                      type="radio"
                      name="mergeMode"
                      checked={!exportMergeMode}
                      onChange={() => setExportMergeMode(false)}
                      className="w-4 h-4 accent-[var(--ui-primary)] cursor-pointer"
                    />
                    <div>
                      <div className="text-sm font-medium text-[var(--ui-fg)]">每条推文单独文件</div>
                      <div className="text-xs text-[var(--ui-muted)]">每条推文导出为独立的文件（共 {selectedIds.size} 个文件）</div>
                    </div>
                  </label>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setShowExportModal(false)}
                  className="flex-1 py-3 rounded-lg border border-[var(--ui-border)] text-[var(--ui-muted)] font-medium hover:text-[var(--ui-fg)] hover:bg-[var(--ui-surface)] transition-all"
                >
                  取消
                </button>
                <button
                  onClick={executeExport}
                  disabled={isExporting}
                  className="flex-1 py-3 rounded-lg bg-[var(--ui-primary)] text-[var(--ui-bg)] font-bold hover:bg-[var(--ui-primary-hover)] shadow-[var(--glow-strong)] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isExporting ? '下载中...' : '确认下载'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

createRoot(document.getElementById('root')!).render(<DashboardApp />)
