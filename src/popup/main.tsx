import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css' // Ensure CSS is imported

type TabLike = { id?: number; url?: string }

type RuntimeOk = { ok?: boolean; error?: string }

function toErrorMessage(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e && typeof (e as { message: unknown }).message === 'string') {
    return (e as { message: string }).message
  }
  return String(e)
}

function tabsQuery(queryInfo: Record<string, unknown>): Promise<TabLike[]> {
  return new Promise((resolve) => {
    try {
      chrome.tabs.query(queryInfo, (tabs: unknown) => {
        void chrome.runtime.lastError
        resolve(Array.isArray(tabs) ? (tabs as TabLike[]) : [])
      })
    } catch {
      resolve([])
    }
  })
}

function sendMessageToTab(tabId: number, message: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, message, (resp: unknown) => {
        void chrome.runtime.lastError
        resolve(resp)
      })
    } catch {
      resolve(undefined)
    }
  })
}

function sendMessageToRuntime(message: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (resp: unknown) => {
        void chrome.runtime.lastError
        resolve(resp)
      })
    } catch {
      resolve(undefined)
    }
  })
}

async function pingActiveTab(): Promise<boolean> {
  const [tab] = await tabsQuery({ active: true, currentWindow: true })
  if (!tab || !tab.id) return false
  if (typeof tab.url === 'string' && !tab.url.includes('://x.com/')) return false
  const resp = await sendMessageToTab(tab.id, { type: 'X_SCRAPER_PING' })
  return Boolean(resp && typeof resp === 'object' && 'ok' in resp && (resp as { ok: unknown }).ok)
}

async function requestSelectedAndSave() {
  const [tab] = await tabsQuery({ active: true, currentWindow: true })
  if (!tab || !tab.id) throw new Error('未找到活动标签页')
  const resp = await sendMessageToTab(tab.id, { type: 'X_SCRAPER_GET_SELECTED' })
  if (!resp || typeof resp !== 'object') throw new Error('未获取到选中项')
  const ok = 'ok' in resp && Boolean((resp as { ok: unknown }).ok)
  if (!ok) throw new Error('未获取到选中项')
  const items = (resp as { items?: unknown }).items
  const sourceUrl = (resp as { sourceUrl?: unknown }).sourceUrl
  if (!Array.isArray(items) || items.length === 0) throw new Error('未选择任何推文')
  const saved = await sendMessageToRuntime({
    type: 'X_SCRAPER_SAVE_ITEMS',
    items,
    sourceUrl: typeof sourceUrl === 'string' ? sourceUrl : '',
  })
  const savedOk = Boolean(saved && typeof saved === 'object' && 'ok' in saved && (saved as RuntimeOk).ok)
  if (!savedOk) throw new Error((saved as RuntimeOk | undefined)?.error || '保存失败，请重新加载扩展后重试')
}

async function openDashboard() {
  const resp = await sendMessageToRuntime({ type: 'X_SCRAPER_OPEN_DASHBOARD' })
  const ok = Boolean(resp && typeof resp === 'object' && 'ok' in resp && (resp as RuntimeOk).ok)
  if (!ok) throw new Error((resp as RuntimeOk | undefined)?.error || '无法打开列表页，请重新加载扩展')
}

export default function PopupApp() {
  const [status, setStatus] = useState<'checking' | 'connected' | 'not_connected'>('checking')
  const [reason, setReason] = useState('')

  useEffect(() => {
    let done = false
    const timeout = setTimeout(() => {
      if (done) return
      setStatus('not_connected')
      setReason('未检测到 X.com 标签页或脚本未注入，请在 X.com 刷新后重试。')
    }, 2000)
    pingActiveTab().then((ok) => {
      done = true
      clearTimeout(timeout)
      setStatus(ok ? 'connected' : 'not_connected')
      if (!ok) setReason('未检测到 X.com 标签页或脚本未注入，请在 X.com 刷新后重试。')
    })
  }, [])

  const handleCheck = async () => {
    setStatus('checking')
    setReason('')
    const ok = await pingActiveTab()
    setStatus(ok ? 'connected' : 'not_connected')
    if (!ok) setReason('未检测到 X.com 标签页或脚本未注入，请在 X.com 刷新后重试。')
  }

  const handleCapture = async () => {
    try {
      await requestSelectedAndSave()
      window.close()
    } catch (e: unknown) {
      setReason(toErrorMessage(e))
    }
  }

  const handleOpenList = async () => {
    try {
      await openDashboard()
      window.close()
    } catch (e: unknown) {
      setReason(toErrorMessage(e))
    }
  }

  return (
    <div className="w-80 min-h-[240px] p-4 bg-[var(--ui-bg)] text-[var(--ui-fg)] border border-[var(--ui-border)] font-sans antialiased text-sm">
      <div className="flex items-center gap-3 mb-4 pb-3 border-b border-[var(--ui-border)]">
        <img src="/logo_64.png" alt="Logo" className="w-8 h-8 object-contain" onError={(e) => e.currentTarget.style.display = 'none'} />
        <div className="font-bold text-lg tracking-tight text-[var(--ui-primary)] glow-text">xMine</div>
      </div>

      <div className="mb-4 flex items-center justify-between">
        <span className="text-[var(--ui-muted)]">状态:</span>
        <span className={`font-medium ${status === 'connected' ? 'text-[var(--ui-fg)] glow-text' : 'text-[var(--ui-muted)]'}`}>
          {status === 'checking' ? '检查中...' : status === 'connected' ? '已连接' : '未连接'}
        </span>
      </div>

      <button
        onClick={status === 'connected' ? handleCapture : handleCheck}
        className={`w-full py-2.5 px-4 rounded-lg font-bold tracking-wide transition-all duration-200 mb-3 
          ${status === 'connected'
            ? 'bg-[var(--ui-primary)] text-black shadow-[var(--glow-strong)] hover:bg-[var(--ui-primary-hover)]'
            : 'bg-[var(--ui-surface)] text-[var(--ui-fg)] border border-[var(--ui-border)] hover:border-[var(--ui-primary)]'
          }`}
      >
        {status === 'connected' ? '抓取选中项' : '检查连接'}
      </button>

      <button
        onClick={handleOpenList}
        className="w-full py-2.5 px-4 rounded-lg font-semibold bg-transparent border border-[var(--ui-border)] text-[var(--ui-muted)] hover:text-[var(--ui-fg)] hover:border-[var(--ui-fg)] transition-all duration-200 hover:shadow-[var(--glow-subtle)]"
      >
        打开推文列表
      </button>

      <div className="mt-4 text-xs text-[var(--ui-muted)] leading-relaxed text-center">
        请在 X.com 页面使用复选框选择推文，然后点击抓取。
      </div>

      {reason && (
        <div className="mt-3 p-3 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-surface-alt)] text-[var(--ui-fg)] text-xs">
          {reason}
        </div>
      )}
    </div>
  )
}
const root = document.getElementById('root')!
createRoot(root).render(<PopupApp />)

