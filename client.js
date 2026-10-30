window.__ModuleLoader__.load({
  id: 'dsh-whale-panel',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useRef, useCallback, useMemo } = React

    const API = '/whale-panel/api'
    const KEYS = {
      pos: 'dsh-whale-panel:pos',
      open: 'dsh-whale-panel:open',
      tab: 'dsh-whale-panel:tab',
      theme: 'dsh-whale-panel:theme',
      monitor: 'dsh-whale-panel:monitor',
      autoPlay: 'dsh-whale-panel:autoplay',
    }
    /* localStorage 可能被浏览器禁用（隐私模式 / 配额满），所有读写都走这两个保险函数 */
    const lsGet = (k) => { try { return window.localStorage.getItem(k) } catch { return null } }
    const lsSet = (k, v) => { try { window.localStorage.setItem(k, v) } catch {} }


    /* 只用一个色相（蓝）+ 中性，另加一个琥珀做警示，不引入第三种彩色 */
    const PALETTE = {
      light: {
        accent: '#2563EB',
        deep: '#1E3A8A',
        ink: '#0F172A',
        sub: '#475569',
        faint: '#94A3B8',
        line: 'rgba(15,23,42,.10)',
        glass: 'rgba(255,255,255,.58)',
        glassEdge: 'rgba(255,255,255,.85)',
        wash: ['#E8F0FF', '#F6F9FF', '#FDFEFF'],
        shadow: '0 18px 48px rgba(15,23,42,.18), 0 2px 8px rgba(15,23,42,.08)',
      },
      dark: {
        accent: '#60A5FA',
        deep: '#1E3A8A',
        ink: '#E7EDF8',
        sub: '#9DAEC6',
        faint: '#6B7C93',
        line: 'rgba(255,255,255,.12)',
        glass: 'rgba(17,25,40,.55)',
        glassEdge: 'rgba(255,255,255,.14)',
        wash: ['#0A1018', '#101A2B', '#070C14'],
        shadow: '0 18px 48px rgba(0,0,0,.5), 0 2px 8px rgba(0,0,0,.35)',
      },
    }
    const AMBER = '#D97706'

    const rgba = (hex, a) => {
      const n = parseInt(hex.slice(1), 16)
      return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
    }

    const TABS = [
      ['learn', '学习', 'M5 4.8A1.8 1.8 0 0 1 6.8 3H19v18H6.8A1.8 1.8 0 0 1 5 19.2V4.8Zm3 1.2v13'],
      ['run', '运行', 'M9 6.4v11.2L18.4 12 9 6.4Z'],
      ['monitor', '监测', 'M3 12h3.6l2.1-5.2 3 10.4 2.4-5.2H21'],
      ['notes', '留言', 'M4 5.5h16v10.5H9.6L4 20V5.5Z'],
      ['history', '记录', 'M4 6h16M4 12h16M4 18h10'],
    ]

    const ICON_SUN = 'M12 4.5v2M12 17.5v2M4.5 12h2M17.5 12h2M6.7 6.7l1.4 1.4M15.9 15.9l1.4 1.4M17.3 6.7l-1.4 1.4M8.1 15.9l-1.4 1.4M12 8.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8Z'
    const ICON_MOON = 'M20 14.2A8 8 0 1 1 9.8 4a6.4 6.4 0 0 0 10.2 10.2Z'
    const ICON_AUTO = 'M12 3.5A8.5 8.5 0 0 1 12 20.5V3.5Zm0 0A8.5 8.5 0 0 0 12 20.5'

    function buildCss(C) {
      const glass = {
        background: C.glass,
        backdropFilter: 'blur(18px) saturate(160%)',
        WebkitBackdropFilter: 'blur(18px) saturate(160%)',
        border: `1px solid ${C.glassEdge}`,
      }
      return {
        card: {
          position: 'fixed', width: 366, borderRadius: 18, color: C.ink,
          background: `linear-gradient(180deg, ${C.wash[0]} 0%, ${C.wash[1]} 46%, ${C.wash[2]} 100%)`,
          border: `1px solid ${C.line}`, boxShadow: C.shadow,
          font: '12.5px/1.55 system-ui, -apple-system, "Segoe UI", "PingFang SC", sans-serif',
          zIndex: 9998, overflow: 'hidden', pointerEvents: 'auto', display: 'flex',
          flexDirection: 'column', maxHeight: '80vh',
        },
        head: {
          display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px 9px',
          cursor: 'grab', userSelect: 'none',
          ...glass,
          background: `linear-gradient(180deg, ${rgba(C.accent, 0.16)}, ${rgba(C.accent, 0.02)})`,
          border: 'none', borderBottom: `1px solid ${C.line}`,
        },
        brand: { display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 },
        logo: { width: 22, height: 22, borderRadius: 7, flex: '0 0 auto' },
        title: { fontWeight: 650, letterSpacing: '.2px' },
        pill: {
          padding: '1px 7px', borderRadius: 99, fontSize: 10.5, lineHeight: '16px',
          background: rgba(C.accent, 0.10), color: C.sub, whiteSpace: 'nowrap',
          border: `1px solid ${rgba(C.accent, 0.18)}`,
        },
        iconBtn: {
          border: 'none', background: 'transparent', color: C.faint, cursor: 'pointer',
          fontSize: 15, padding: '2px 4px', lineHeight: 1, borderRadius: 6,
        },
        tabs: {
          display: 'flex', gap: 2, padding: '6px 8px 0', borderBottom: `1px solid ${C.line}`,
          ...glass, border: 'none', borderBottom: `1px solid ${C.line}`,
        },
        tab: {
          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
          padding: '6px 4px 7px', border: 'none', background: 'transparent', cursor: 'pointer',
          color: C.sub, font: 'inherit', fontSize: 11.5, borderRadius: '9px 9px 0 0',
          borderBottom: '2px solid transparent', transition: 'color .15s ease, background .15s ease',
        },
        tabOn: {
          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
          padding: '6px 4px 7px', border: 'none', cursor: 'pointer',
          color: C.accent, font: 'inherit', fontSize: 11.5, fontWeight: 650,
          background: rgba(C.accent, 0.12), borderBottom: `2px solid ${C.accent}`,
          borderRadius: '9px 9px 0 0',
        },
        body: {
          padding: 10, display: 'grid', gap: 8, overflowY: 'auto', flex: 1,
          alignContent: 'start', minHeight: 210,
        },
        card2: {
          display: 'grid', gap: 7, padding: '10px 11px', borderRadius: 14,
          background: C.glass, backdropFilter: 'blur(14px) saturate(150%)',
          WebkitBackdropFilter: 'blur(14px) saturate(150%)',
          border: `1px solid ${C.glassEdge}`,
          boxShadow: `inset 0 1px 0 ${rgba('#FFFFFF', 0.35)}`,
        },
        secTitle: { fontWeight: 650, fontSize: 11.5, letterSpacing: '.2px', color: C.ink },
        row: { display: 'grid', gap: 4 },
        label: { color: C.sub, fontSize: 11 },
        input: {
          width: '100%', boxSizing: 'border-box', padding: '6px 9px', borderRadius: 10,
          border: `1px solid ${C.line}`, background: rgba(C.ink, 0.03), color: C.ink,
          font: 'inherit', fontSize: 12, outline: 'none',
        },
        area: {
          width: '100%', boxSizing: 'border-box', padding: '6px 9px', borderRadius: 10,
          minHeight: 40, border: `1px solid ${C.line}`, background: rgba(C.ink, 0.03),
          color: C.ink, font: 'inherit', fontSize: 12, resize: 'vertical', outline: 'none',
        },
        two: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 },
        btn: {
          padding: '5px 9px', borderRadius: 9, border: `1px solid ${C.line}`,
          background: rgba(C.ink, 0.03), color: C.ink, font: 'inherit', fontSize: 11.5,
          cursor: 'pointer', whiteSpace: 'nowrap',
        },
        btnOn: {
          padding: '5px 9px', borderRadius: 9, border: `1px solid ${rgba(C.accent, 0.5)}`,
          background: rgba(C.accent, 0.14), color: C.accent, font: 'inherit', fontSize: 11.5,
          cursor: 'pointer', whiteSpace: 'nowrap', fontWeight: 650,
        },
        primary: {
          padding: '9px 10px', borderRadius: 12, border: 'none',
          background: `linear-gradient(180deg, ${rgba(C.accent, 0.92)}, ${rgba(C.deep, 0.92)})`,
          color: '#fff', font: 'inherit', fontSize: 12, fontWeight: 650, cursor: 'pointer',
          boxShadow: `0 6px 18px ${rgba(C.accent, 0.35)}`,
        },
        meta: { color: C.sub, fontSize: 11 },
        faint: { color: C.faint, fontSize: 10.5 },
        item: {
          display: 'grid', gap: 2, padding: '7px 9px', borderRadius: 11,
          border: `1px solid ${C.line}`, textDecoration: 'none', color: C.ink,
          cursor: 'pointer', background: rgba(C.ink, 0.02),
        },
        chip: {
          padding: '2px 8px', borderRadius: 99, fontSize: 11, color: C.ink,
          background: rgba(C.accent, 0.13), border: `1px solid ${rgba(C.accent, 0.24)}`,
        },
        qr: { display: 'grid', gap: 6, justifyItems: 'center', padding: 8 },
        qrImg: { width: 148, height: 148, borderRadius: 12, background: '#fff' },
        logBox: {
          height: 172, overflowY: 'auto', display: 'grid', gap: 2,
          fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
          fontSize: 10.5, lineHeight: 1.5, padding: '8px 9px', borderRadius: 12,
          background: rgba(C.ink, 0.05), border: `1px solid ${C.line}`,
        },
        foot: {
          display: 'grid', gap: 5, padding: '8px 12px 10px',
          ...glass, border: 'none', borderTop: `1px solid ${C.line}`,
        },
        bar: { height: 5, borderRadius: 99, background: rgba(C.ink, 0.12), overflow: 'hidden' },
        seg: { display: 'flex', gap: 4, flexWrap: 'wrap' },
        noteBox: {
          display: 'grid', gap: 4, padding: '8px 9px', borderRadius: 12,
          border: `1px solid ${C.glassEdge}`, background: C.glass,
          backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
        },
        empty: {
          display: 'grid', placeItems: 'center', padding: '18px 10px', borderRadius: 12,
          border: `1px dashed ${C.line}`, color: C.faint, fontSize: 11.5, textAlign: 'center',
        },
        fab: {
          position: 'fixed', right: 22, bottom: 96, width: 46, height: 46, borderRadius: 99,
          border: `1px solid ${C.glassEdge}`,
          background: `linear-gradient(180deg, ${rgba(C.accent, 0.95)}, ${rgba(C.deep, 0.95)})`,
          color: '#fff', fontSize: 19, cursor: 'pointer', zIndex: 9998, pointerEvents: 'auto',
          boxShadow: `0 10px 26px ${rgba(C.accent, 0.4)}`, fontWeight: 700,
          backdropFilter: 'blur(10px)',
        },
      }
    }

    function TabIcon({ d, size }) {
      return h('svg', {
        width: size || 13, height: size || 13, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round',
        strokeLinejoin: 'round', 'aria-hidden': true,
      }, h('path', { d }))
    }

    /** 插件市场那种滑动开关：轨道 + 滑块，键盘可操作 */
    function Switch({ on, onChange, C, title }) {
      const track = {
        position: 'relative', width: 38, height: 21, borderRadius: 99, padding: 0,
        border: 'none', flex: '0 0 auto', cursor: 'pointer',
        background: on ? C.accent : rgba(C.ink, 0.20),
        boxShadow: on ? `0 0 0 3px ${rgba(C.accent, 0.16)}` : 'none',
        transition: 'background .18s ease, box-shadow .18s ease',
        outline: 'none',
      }
      const knob = {
        position: 'absolute', top: 2, left: 2, width: 17, height: 17, borderRadius: 99,
        background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,.35)',
        transform: `translateX(${on ? 17 : 0}px)`,
        transition: 'transform .18s cubic-bezier(.16,1,.3,1)',
      }
      return h('button', {
        type: 'button', role: 'switch', 'aria-checked': on ? 'true' : 'false',
        'aria-label': title || '开关', style: track,
        onClick: onChange,
        onKeyDown: (e) => {
          if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); onChange() }
        },
      }, h('span', { style: knob }))
    }

    function readPos() {
      try {
        const raw = lsGet(KEYS.pos)
        if (raw) return JSON.parse(raw)
      } catch {}
      return { x: Math.max(16, window.innerWidth - 402), y: 84 }
    }

    function Panel() {
      // ⚠️ 收起状态**不持久化**：以前点过「收起」，刷新后仍然只剩右下角一颗小按钮，
      //    很容易被当成"插件没显示"。现在每次打开页面都默认展开，收起只在本次会话内有效。
      const [open, setOpen] = useState(true)
      const [pos, setPos] = useState(readPos)
      const [tab, setTab] = useState(() => lsGet(KEYS.tab) || 'learn')
      const [themeMode, setThemeMode] = useState(() => lsGet(KEYS.theme) || 'auto')
      const [sysDark, setSysDark] = useState(() =>
        window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
      const [st, setSt] = useState(null)
      // 打字缓冲：{ [key]: 本地值 }。用它做受控输入，且**存盘后不灌回服务端 state**，
      // 避免"打一个字就被旧值覆盖"。改它时必须同步触发一次重渲染（见 editTyping 里的 bump）。
      const [edits, setEdits] = useState({})
      const bumpEdits = (k, v) => setEdits((prev) => {
        const next = { ...prev }
        if (v === undefined) delete next[k]
        else next[k] = v
        return next
      })
      // 定时器里要读最新的 dwellSec，但它不该让 interval 重建，所以放 ref
      const stRef = useRef(null)
      useEffect(() => { stRef.current = st }, [st])
      const [busy, setBusy] = useState('')
      const [note, setNote] = useState('')
      const [items, setItems] = useState([])
      const [draft, setDraft] = useState('')
      const [card, setCard] = useState(null)
      const [monitorOn, setMonitorOn] = useState(() => lsGet(KEYS.monitor) === '1')
      // 真自动播放：默认开。开了就自动切到试播、静音播放、播完自动换下一条
      const [autoPlay, setAutoPlay] = useState(() => lsGet(KEYS.autoPlay) !== '0')
      const [mView, setMView] = useState(() => (
        lsGet(KEYS.autoPlay) !== '0' ? 'play' : 'log'
      ))
      const [videoInfo, setVideoInfo] = useState(null)
      const [watchAt, setWatchAt] = useState(0)
      const [playerOn, setPlayerOn] = useState(false)
      const [playBase, setPlayBase] = useState(0)
      const [playStart, setPlayStart] = useState(0)
      const [ended, setEnded] = useState(false)
      const [logs, setLogs] = useState([])
      const [phaseInfo, setPhaseInfo] = useState(null)
      const seqRef = useRef(0)
      const logBox = useRef(null)
      const drag = useRef(null)
      const timer = useRef(null)

      useEffect(() => {
        if (!window.matchMedia) return
        const mq = window.matchMedia('(prefers-color-scheme: dark)')
        const on = (e) => setSysDark(e.matches)
        mq.addEventListener('change', on)
        return () => mq.removeEventListener('change', on)
      }, [])

      useEffect(() => { lsSet(KEYS.theme, themeMode) }, [themeMode])

      const dark = themeMode === 'dark' || (themeMode === 'auto' && sysDark)
      const C = PALETTE[dark ? 'dark' : 'light']
      const css = useMemo(() => buildCss(C), [dark])

      const call = useCallback(async (action, extra) => {
        const res = await fetch(API, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action, ...(extra || {}) }),
        })
        const data = await res.json()
        if (data?.state) setSt(data.state)
        return data
      }, [])

      useEffect(() => {
        call('state').then((d) => { if (d?.error) setNote(d.error) })
          .catch((e) => setNote(String(e.message || e)))
      }, [call])

      // 面板开着就每 12 秒拉一次权威 state：
      // 以前只有「监测」页才有轮询，停在「运行」页时整屏数字（已用/轮次/上限文案）一直不动，
      // 看着就像「调完了没反应」。这是本地 HTTP，不花 token。
      useEffect(() => {
        if (!open) return undefined
        const id = setInterval(() => {
          if (document.hidden) return
          call('state').catch(() => {})
        }, 12000)
        return () => clearInterval(id)
      }, [open, call])

      useEffect(() => { lsSet(KEYS.tab, tab) }, [tab])
      useEffect(() => { lsSet(KEYS.pos, JSON.stringify(pos)) }, [pos])
      useEffect(() => {
        lsSet(KEYS.monitor, monitorOn ? '1' : '0')
      }, [monitorOn])
      useEffect(() => {
        lsSet(KEYS.autoPlay, autoPlay ? '1' : '0')
      }, [autoPlay])

      const waiting = st?.login?.status === 'waiting'
      useEffect(() => {
        if (!open || !waiting) return
        timer.current = setInterval(() => { call('login.poll').catch(() => {}) }, 2000)
        return () => clearInterval(timer.current)
      }, [open, waiting, call])

      useEffect(() => {
        if (!open || !monitorOn || tab !== 'monitor' || st?.paused) return
        let stopped = false
        const tick = async () => {
          try {
            const d = await call('monitor', { since: seqRef.current })
            if (stopped || !d) return
            if (typeof d.seq === 'number') seqRef.current = d.seq
            if (d.phase) setPhaseInfo(d.phase)
            if (d.events && d.events.length) setLogs((prev) => prev.concat(d.events).slice(-160))
          } catch {}
        }
        tick()
        const id = setInterval(tick, 1000)
        return () => { stopped = true; clearInterval(id) }
      }, [open, monitorOn, tab, call, st?.paused])

      useEffect(() => {
        if (logBox.current) logBox.current.scrollTop = logBox.current.scrollHeight
      }, [logs])

      // 状态条常驻：不管停在哪一页、监测开没开，都定时刷一次阶段。
      // 以前只在「监测关着」时拉一次，于是关掉监测后倒计时/阶段就冻住了。
      useEffect(() => {
        if (!open) return
        let stopped = false
        const tick = async () => {
          try {
            const d = await call('monitor', { since: 0 })
            if (stopped || !d?.phase) return
            setPhaseInfo(d.phase)
          } catch {}
        }
        tick()
        const id = setInterval(tick, 3000)
        return () => { stopped = true; clearInterval(id) }
      }, [open, call])

      // 预览卡：切到该视频时拉一次公开信息
      const liveBvid = (st?.current && st.current.bvid) || ''
      useEffect(() => {
        if (!liveBvid) { setVideoInfo(null); setWatchAt(0); return }
        let stopped = false
        setVideoInfo(null)
        try {
          const raw = lsGet(`dsh-whale-panel:watch:${liveBvid}`)
          setWatchAt(raw ? Number(JSON.parse(raw).at || 0) : 0)
        } catch { setWatchAt(0) }
        setPlayerOn(false)
        setEnded(false)
        call('video.info', { bvid: liveBvid })
          .then((d) => { if (!stopped && d?.ok) setVideoInfo(d.video) })
          .catch(() => {})
        return () => { stopped = true }
      }, [liveBvid, call])

      const saveWatch = (sec) => {
        if (!liveBvid) return
        try {
          lsSet(
            `dsh-whale-panel:watch:${liveBvid}`,
            JSON.stringify({ at: Math.max(0, Math.floor(sec)), ts: Date.now() }),
          )
        } catch {}
      }

      // 进入试播页就自动开播；切走则暂停并记住进度。
      // 开了自动播放时：不在试播视图也继续放；但「监测开关关着」时试播不自动开
      //（开关就是开关 —— 关掉监测，试播这一块也一起停，但预览和日志照旧能看）
      useEffect(() => {
        if (mView !== 'play' && !autoPlay) {
          if (playerOn) {
            const dur = Number(videoInfo?.duration || 1e9)
            const pos = Math.min(dur, playBase + (Date.now() - playStart) / 1000)
            saveWatch(pos)
            setWatchAt(pos)
            setPlayerOn(false)
          }
          return
        }
        if (!liveBvid || playerOn || ended) return
        if (mView === 'play' && !monitorOn) return
        setPlayBase(Number(watchAt || 0))
        setPlayStart(Date.now())
        setPlayerOn(true)
      }, [mView, autoPlay, monitorOn, liveBvid, playerOn, ended, playBase, playStart, watchAt, videoInfo?.duration])

      // 自动播放：勾上后，一有新的正在看的内容就自动切到试播页开播（静音），
      // 播完自动叫宿主换下一条——这样它才真的在"刷"，不是停在页面上。
      // ⚠️ 只对「监测页面」生效，且**只在新内容出现时切一次**：
      //    用户在监测页里点什么视图就停在什么视图，绝不被抢走（这是 1.13.1 之前的病根）。
      const autoPlayWanted = autoPlay && open && !st?.paused
      const lastAutoBvid = useRef('')
      useEffect(() => {
        if (!autoPlayWanted) return
        if (tab !== 'monitor') {
          // 不在监测页时后台继续播（不切视图），保持"一直在刷"
          if (liveBvid && !playerOn && !ended) {
            setPlayBase(Number(watchAt || 0))
            setPlayStart(Date.now())
            setPlayerOn(true)
          }
          return
        }
        // 监测页：只有「换了新视频」才自动切到试播；用户手动切视图不干预
        if (!liveBvid) return
        if (lastAutoBvid.current !== liveBvid) {
          lastAutoBvid.current = liveBvid
          setMView('play')
        }
        if (!playerOn && !ended) {
          setPlayBase(Number(watchAt || 0))
          setPlayStart(Date.now())
          setPlayerOn(true)
        }
      }, [autoPlayWanted, tab, liveBvid, playerOn, ended, watchAt])

      const stopPlay = () => {
        if (playerOn) {
          const dur = Number(videoInfo?.duration || 1e9)
          const pos = Math.min(dur, playBase + (Date.now() - playStart) / 1000)
          saveWatch(pos)
          setWatchAt(pos)
        }
        setPlayerOn(false)
      }

      // 每秒刷新一次进度；到 5 分钟上限就换下一条；每 15 秒向 B站 上报一次
      // ⚠️ 这里有三道自己保险：
      //   ① 本地 `dwellSec` 到点就换，**不管视频多长**（以前只在播到真正片尾才换，长视频会一直播下去）
      //   ② 播放器可能根本没起来（被拦、加载失败）→ 计时照走，仍然会到点换，不会卡死在一个不动的地方
      //   ③ 换不动（队列看光）时必须把 ended 复位，否则会永远停在"已播完"的壳子里
      useEffect(() => {
        if (!playerOn) return
        let lastReport = 0
        const id = setInterval(() => {
          const dur = Number(videoInfo?.duration || 0)
          const pos = playBase + (Date.now() - playStart) / 1000
          const dwell = Math.max(30, Number(stRef.current?.dwellSec ?? 300))
          const bucket = Math.floor(pos / 15)
          if (bucket > lastReport && liveBvid) {
            lastReport = bucket
            call('history.report', { bvid: liveBvid, progress: Math.floor(pos) }).catch(() => {})
          }
          const hitDwell = pos >= dwell
          const hitEnd = dur > 0 && pos >= dur - 0.5
          if (hitDwell || hitEnd) {
            const at = hitEnd ? dur : Math.min(dur || pos, dwell)
            saveWatch(at)
            setWatchAt(at)
            setPlayerOn(false)
            setEnded(true)
            call('history.report', { bvid: liveBvid, progress: Math.floor(at) }).catch(() => {})
            if (hitDwell && !hitEnd) setNote(`看了 ${Math.round(dwell / 60)} 分钟，换下一条`)
          } else {
            setWatchAt(Math.floor(pos))
          }
        }, 1000)
        return () => clearInterval(id)
      }, [playerOn, playBase, playStart, videoInfo?.duration, liveBvid])

      // 播放期间每 20 秒给宿主报一次心跳：宿主节奏器看到心跳就让位，
      // 不会出现「界面刚开播、宿主按自己的计时把它换掉」这种两边抢
      useEffect(() => {
        if (!playerOn || !liveBvid || st?.paused) return
        const ping = () => { call('watch.ping').catch(() => {}) }
        ping()
        const id = setInterval(ping, 20_000)
        return () => clearInterval(id)
      }, [playerOn, liveBvid, call, st?.paused])

      // 播完了 → 叫宿主把「正在看」换成下一条，形成连播。
      // 换不动时（队列看光 / 请求失败 / 还没看够时长）必须**复位 ended**，然后过一会儿重试，
      // 否则界面会永远卡在"已播完"那一屏 —— 这是"卡住"的直接原因。
      // ⚠️ 改成「间隔轮询」而不是一套 setTimeout 链：以前在回调里 setEnded(false) 会触发
      //    本 effect 的 cleanup，把刚排好的 retry 一起清掉 → 定时器丢了就再也不换片。
      //    现在只要 ended 还是 true，interval 就会一直试，换成功了才停。
      useEffect(() => {
        if (!ended || !autoPlay || !liveBvid || st?.paused) return
        let stopped = false
        let busy = false
        const go = async () => {
          if (stopped || busy) return
          busy = true
          try {
            const d = await call('next.video')
            if (stopped) return
            if (d && d.ok) {
              setEnded(false)
              setPlayBase(0)
              setWatchAt(0)
              return
            }
            if (d && d.exhausted) {
              // 这一批都看过了：不重播，等下一轮；但必须把 ended 复位，否则壳子留在"已播完"
              setEnded(false)
              setPlayBase(0)
              setWatchAt(0)
              setNote('这一批都看过了，等下一轮挑新的')
              return
            }
            if (d && d.needMore) {
              // 最短观看时长没到：**不重播这条**，等它自己走够时间再来换
              setNote(`这条还没看够，${d.needMore} 秒后再换`)
              return
            }
          } catch {
            // 网络抖动：什么都别做，下一拍继续试
          } finally {
            busy = false
          }
        }
        const first = setTimeout(go, 2500)
        const id = setInterval(go, 5_000)
        return () => {
          stopped = true
          clearTimeout(first)
          clearInterval(id)
        }
      }, [ended, autoPlay, liveBvid, call, st?.paused])

      useEffect(() => {
        const onMove = (e) => {
          if (!drag.current) return
          setPos({
            x: Math.max(0, Math.min(window.innerWidth - 380, e.clientX - drag.current.dx)),
            y: Math.max(0, Math.min(window.innerHeight - 70, e.clientY - drag.current.dy)),
          })
        }
        const onUp = () => { drag.current = null }
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
        return () => {
          window.removeEventListener('mousemove', onMove)
          window.removeEventListener('mouseup', onUp)
        }
      }, [])

      // ⚠️ 输入框里的 onChange 千万不能直接走 patch：
      //    patch → save → setSt(服务端 state) 会把输入框**回写成服务端旧值**，
      //    而服务端是异步回来的，于是你多打一个字就被旧值覆盖 → 表现为"重复/多字/吃字"。
      //    所以打字类的输入一律用受控 draft：本地先记着，停 400ms 再存，期间输入框永远由 draft 说了算。
      const editBuf = useRef({})
      const editTimer = useRef({})
      const pendingClear = useRef({})
      const editValue = (k, serverVal) => (
        Object.prototype.hasOwnProperty.call(edits, k) ? edits[k] : serverVal
      )
      // 存盘：**不把服务端返回的整份 state 灌回来**（灌回来 = 输入框被旧值覆盖）。
      // 但要把刚存的那几个字段**本地乐观合并**进 st —— 否则页面上其它读同一字段的文案
      // 会一直停在旧值（真事故：评论上限从 7 调到 10，输入框是 10，上面还写着「上限 7 条已满」）。
      const saveQuietly = async (p) => {
        setSt((prev) => (prev ? { ...prev, ...p } : prev))
        try {
          await fetch(API, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: 'save', patch: p }),
          })
        } catch (e) { setNote(String(e.message || e)) }
      }
      const editTyping = (k, v, mapTo) => {
        editBuf.current[k] = v
        bumpEdits(k, v) // 受控输入的关键：把新值放进 state 才会立刻回显
        clearTimeout(editTimer.current[k])
        editTimer.current[k] = setTimeout(async () => {
          const raw = editBuf.current[k]
          if (raw === undefined) return
          delete editBuf.current[k]
          await saveQuietly(mapTo ? mapTo(raw) : raw)
          // ⚠️ 存完先**不**清缓冲：此刻服务端 state 还没刷到前端，清了会让输入框闪回旧值。
          //    等下次 state 从服务端回来、且值已经一致了，再在下面那个 effect 里清掉。
          pendingClear.current[k] = String(raw)
        }, 400)
      }
      // 服务端 state 回来后，把已经存进去的缓冲清掉。
      // 判定要**双条件**：服务端值已经等于存下去的值，且用户此刻手里没有更新的输入
      //（只看服务端值会在"打字正好跨过存盘那一刻"时把后面几个字吞掉）。
      useEffect(() => {
        if (!st) return
        for (const [k, saved] of Object.entries(pendingClear.current)) {
          const serverNow = String(st[k] ?? '')
          const live = Object.prototype.hasOwnProperty.call(edits, k)
            ? String(edits[k])
            : serverNow
          if (live !== saved) continue // 用户还在往后打，先别动
          if (serverNow === saved || serverNow === '') {
            delete pendingClear.current[k]
            bumpEdits(k, undefined)
          }
        }
      }, [st, edits])

      const patch = async (p) => {
        try { await call('save', { patch: p }) } catch (e) { setNote(String(e.message || e)) }
      }

      /**
       * 带「确认」的数字输入：去掉上下箭头（`type=text` + 自己校验），
       * 改完按确认（或回车）才存。比自动保存准，也不会因为滚轮/方向键误改数值。
       */
      const numField = (k, serverVal, { min, max, step, width = 72, unit } = {}) => {
        const raw = String(editValue(k, serverVal ?? ''))
        const n = Number(raw)
        const invalid = raw !== '' && !Number.isFinite(n)
        const commit = () => {
          const v = Number(String(editValue(k, serverVal ?? '')).trim())
          if (!Number.isFinite(v)) { setNote('请输入数字'); return }
          let out = v
          if (typeof min === 'number') out = Math.max(min, out)
          if (typeof max === 'number') out = Math.min(max, out)
          if (typeof step === 'number' && step > 0) {
            out = Math.round(out / step) * step
            out = Number(out.toFixed(4))
          }
          bumpEdits(k, String(out))
          saveQuietly({ [k]: out }).then(() => {
            pendingClear.current[k] = String(out)
            setNote('')
          }).catch(() => {})
        }
        return h('div', { style: { display: 'flex', gap: 4, alignItems: 'center' } },
          h('input', {
            style: { ...css.input, width, borderColor: invalid ? AMBER : undefined },
            type: 'text',
            inputMode: 'decimal',
            value: raw,
            placeholder: String(serverVal ?? ''),
            onChange: (e) => bumpEdits(k, e.target.value),
            onKeyDown: (e) => {
              if (e.key === 'Enter') { e.preventDefault(); commit() }
              if (e.key === 'Escape') { bumpEdits(k, undefined); setNote('') }
            },
          }),
          h('button', {
            style: { ...css.btnOn, fontSize: 10.5, padding: '3px 8px' },
            title: '确认（回车）',
            onClick: commit,
          }, '确认'),
          unit ? h('span', { style: css.faint }, unit) : null,
        )
      }

      const lookup = async () => {
        setBusy('lookup'); setNote('')
        try {
          const d = await call('master.lookup')
          if (d?.ok) { setCard(d.card); setNote(`主人号：${d.card.name}`) }
          else setNote(d.error || '查不到')
        } catch (e) { setNote(String(e.message || e)) } finally { setBusy('') }
      }

      const startLogin = async () => {
        setBusy('login')
        try { await call('login.start') } catch (e) { setNote(String(e.message || e)) } finally { setBusy('') }
      }

      const makeDraft = async () => {
        setBusy('draft'); setNote('')
        try {
          const d = await call('comment.draft')
          if (d?.error) setNote(d.error)
          else setNote('草稿已生成，改完点「发送」')
        } catch (e) { setNote(String(e.message || e)) } finally { setBusy('') }
      }

      const sendDraft = async (id) => {
        setBusy('send'); setNote('')
        try {
          const d = await call('comment.send', { id })
          setNote(d?.ok ? `已发出（rpid ${d.rpid}）` : (d?.error || '发送失败'))
        } catch (e) { setNote(String(e.message || e)) } finally { setBusy('') }
      }

      const run = async () => {
        setBusy('run'); setNote('')
        try {
          const d = await call('run')
          if (d?.items) setItems(d.items)
          if (d?.error) setNote(d.error)
          if (d?.ok) {
            const bits = [`本轮 ${d.items.length} 条`]
            if (d.autoLearned) bits.push(`自学 ${d.autoLearned.samples} 条样本`)
            if (d.tone) bits.push(`语气 ${d.tone.count} 条`)
            setNote(bits.join(' · '))
          }
        } catch (e) { setNote(String(e.message || e)) } finally { setBusy('') }
      }

      const cycleTheme = () => {
        setThemeMode(themeMode === 'auto' ? 'light' : (themeMode === 'light' ? 'dark' : 'auto'))
      }
      const themeIcon = themeMode === 'auto' ? ICON_AUTO : (dark ? ICON_MOON : ICON_SUN)
      const themeLabel = themeMode === 'auto' ? '跟随系统' : (dark ? '夜间' : '日间')

      if (!open) {
        // 收起状态只剩这颗小按钮 —— 它容易被当成"插件没了"，所以给个明确的提示
        return h('button', {
          style: css.fab,
          title: '打开白鲸台（已收起）',
          'aria-label': '打开白鲸台',
          onClick: () => { setOpen(true); lsSet(KEYS.open, '1') },
        }, '鲸')
      }

      const s = st || {}
      const spent = Number(s.spentToday || 0)
      const daily = Number(s.dailyBudget || 0)
      const ratio = daily > 0 ? Math.min(1, spent / daily) : 0
      const interest = s.interest || []
      const mode = s.commentMode || 'off'
      const modeOn = mode !== 'off'
      const pendingNotes = (s.notes || []).filter((n) => n.status === 'pending').length
      // 总开关：插件装着 ≠ 插件在干活。关着时宿主会拒绝所有自动动作，前端也停掉自己的轮询/自动播放。
      const power = !s.paused
      const togglePower = async () => {
        const on = !power
        setNote(on ? '总开关：已开启' : '总开关：已关闭，所有自动动作停止')
        try {
          const d = await call('power', { on })
          if (d?.error) setNote(d.error)
        } catch (e) { setNote(String(e.message || e)) }
      }
      // 评论日上限是否已用完（用完 = 宿主整轮不开、连播睡到明天 0 点）
      const capCount = Number(s.commentDailyCap ?? 0)
      const capUsed = Number(s.commentedToday || 0)
      const capBlocked = modeOn && capUsed >= capCount

      const opts = [
        ['auto', '自动发'],
        ['draft', '起草后我确认'],
        ['check-auto', '自检 → 少量自主'],
      ]

      /* ---------------- 学习页 ---------------- */

      const learnPage = h('div', { style: { display: 'grid', gap: 8 } },
        h('div', { style: css.card2 },
          h('div', { style: css.secTitle }, '主人号 · 公开学习'),
          h('div', { style: css.row },
            h('span', { style: css.label }, 'UID（不需要登录）'),
            h('div', { style: { display: 'flex', gap: 6 } },
              h('input', {
                style: css.input, value: editValue('masterUid', s.masterUid || ''), placeholder: '例如 14430149',
                onChange: (e) => bumpEdits('masterUid', e.target.value.trim()),
                onKeyDown: (e) => {
                  if (e.key !== 'Enter') return
                  const uid = String(editValue('masterUid', s.masterUid || '')).trim()
                  if (!/^\d{1,20}$/.test(uid)) { setNote('UID 应该是纯数字'); return }
                  saveQuietly({ masterUid: uid })
                    .then(() => { pendingClear.current.masterUid = uid; setNote('') })
                    .catch(() => {})
                },
              }),
              h('button', {
                style: { ...css.btnOn, fontSize: 10.5, padding: '3px 8px' },
                title: '确认（回车）',
                onClick: () => {
                  const uid = String(editValue('masterUid', s.masterUid || '')).trim()
                  if (!/^\d{1,20}$/.test(uid)) { setNote('UID 应该是纯数字'); return }
                  saveQuietly({ masterUid: uid })
                    .then(() => { pendingClear.current.masterUid = uid; setNote('') })
                    .catch(() => {})
                },
              }, '确认'),
            ),
            // 昵称由插件自己解析并缓存：改完 UID 停手 0.4 秒，服务端就会自动去查，
            // 按钮只用来"立刻重查一次"，不点也能自动生效
            s.masterName
              ? h('span', { style: { ...css.faint, color: C.accent } }, `→ ${s.masterName}`)
              : (s.masterUid
                  ? h('span', { style: { ...css.faint, color: AMBER } }, '解析中…')
                  : h('span', { style: css.faint }, '填了 UID 会自动查昵称')),
            h('button', { style: css.btn, disabled: busy === 'lookup', onClick: lookup },
              busy === 'lookup' ? '…' : '重查'),
            card
              ? h('span', { style: css.faint },
                  `${card.name}${card.followers ? ` · ${card.followers} 粉` : ''}`)
              : null,
          ),
          h('div', { style: css.row },
            h('span', { style: css.label }, '手动话题（权重最高，逗号分隔）'),
            h('div', { style: { display: 'flex', gap: 4, alignItems: 'center', flex: 1 } },
              h('input', {
                style: css.input, value: editValue('manualTopics', s.manualTopics || ''), placeholder: '独立游戏, 显卡, 硬核测评',
                onChange: (e) => bumpEdits('manualTopics', e.target.value),
                onKeyDown: (e) => {
                  if (e.key !== 'Enter') return
                  const v = String(editValue('manualTopics', s.manualTopics || ''))
                  saveQuietly({ manualTopics: v })
                    .then(() => { pendingClear.current.manualTopics = v }).catch(() => {})
                },
              }),
              h('button', {
                style: { ...css.btnOn, fontSize: 10.5, padding: '3px 8px' },
                title: '确认（回车）',
                onClick: () => {
                  const v = String(editValue('manualTopics', s.manualTopics || ''))
                  saveQuietly({ manualTopics: v })
                    .then(() => { pendingClear.current.manualTopics = v }).catch(() => {})
                },
              }, '确认'),
            ),
          ),
          h('div', { style: css.row },
            h('span', { style: css.label }, '补充视频链接（可留空）'),
            h('div', { style: { display: 'flex', gap: 4, alignItems: 'flex-start', flex: 1 } },
              h('textarea', {
                style: css.area, value: editValue('seedLinks', s.seedLinks || ''),
                placeholder: '一行一个 BV 号或链接，最多 20 个',
                onChange: (e) => bumpEdits('seedLinks', e.target.value),
              }),
              h('button', {
                style: { ...css.btnOn, fontSize: 10.5, padding: '3px 8px' },
                title: '确认',
                onClick: () => {
                  const v = String(editValue('seedLinks', s.seedLinks || ''))
                  saveQuietly({ seedLinks: v })
                    .then(() => { pendingClear.current.seedLinks = v }).catch(() => {})
                },
              }, '确认'),
            ),
          ),
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 } },
            h('span', { style: { ...css.label, flex: 1 } }, '每轮自动去学的概率'),
            h('span', { style: { ...css.meta, color: C.accent, fontWeight: 650 } },
              `${Math.round((s.learnChance ?? 0.35) * 100)}%`),
          ),
          h('input', {
            type: 'range', min: 0, max: 100, step: 5, style: { width: '100%', accentColor: C.accent },
            value: Math.round((s.learnChance ?? 0.35) * 100),
            onChange: (e) => patch({ learnChance: Number(e.target.value) / 100 }),
          }),
          h('span', { style: css.faint },
            s.learnedAt
              ? `上次学习 ${new Date(s.learnedAt).toLocaleString('zh-CN', { hour12: false })} · ${s.learnedFrom || ''}`
              : '还没学过：下一轮运行按这个概率自己决定'),
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 } },
            h('span', { style: { ...css.label, flex: 1 } }, '旧兴趣淡出的半衰期（天）'),
            numField('decayDays', s.decayDays ?? 7, { min: 0.5, max: 60, step: 0.5, width: 60 }),
          ),
          h('span', { style: css.faint },
            `越久没被重新提到的词权重越低，掉到 ${s.decayFloor ?? 1} 以下自动删掉；以最新状态为主`),
        ),

        h('div', { style: css.card2 },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
            h('span', { style: { ...css.secTitle, flex: 1 } }, '兴趣画像'),
            interest.length
              ? h('button', {
                  style: { ...css.btn, fontSize: 10.5, padding: '2px 7px' },
                  onClick: async () => { await call('interest.clear'); setItems([]) },
                }, '清空')
              : null,
          ),
          interest.length
            ? h('div', { style: { display: 'grid', gap: 6 } },
                h('span', { style: css.faint }, `${s.learnedSamples || 0} 条样本 · ${s.learnedFrom || ''}`),
                h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 5 } },
                  (() => {
                    const maxW = Math.max(...interest.map((i) => Number(i.weight) || 1), 1)
                    return interest.map((it) => h('span', {
                      key: it.tag,
                      style: {
                        ...css.chip,
                        opacity: 0.5 + 0.5 * (Number(it.weight) / maxW),
                        fontSize: 10.5 + 1.5 * (Number(it.weight) / maxW),
                      },
                      title: `权重 ${it.weight}${it.lastSeen ? ` · 最近 ${new Date(it.lastSeen).toLocaleDateString('zh-CN')}` : ''}`,
                    }, it.tag))
                  })(),
                ),
                (s.learnedSources || []).length
                  ? h('span', { style: css.faint }, s.learnedSources.join('；'))
                  : null,
              )
            : h('span', { style: css.meta }, '还没有画像。填 UID 或写几个话题，运行时会自己学。'),
        ),

        h('div', { style: css.card2 },
          h('div', { style: css.secTitle }, '评论区语气 · 实时'),
          s.commentLearn?.count > 0
            ? h('div', { style: { display: 'grid', gap: 5 } },
                h('span', { style: css.faint },
                  `${s.commentLearn.count} 条 · 平均 ${s.commentLearn.avgLen} 字 · 表情率 ${Math.round(s.commentLearn.emojiRate * 100)}%`),
                h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 5 } },
                  (s.commentLearn.phrases || []).map((p) =>
                    h('span', { key: p.tag, style: css.chip }, `${p.tag}×${p.n}`))),
              )
            : h('span', { style: css.meta }, '每轮运行自动读两条视频的评论区'),
          h('span', { style: css.faint },
            s.commentLearn?.at
              ? `上次更新 ${new Date(s.commentLearn.at).toLocaleTimeString('zh-CN', { hour12: false })}`
              : '实时学习，不需要手动点'),
        ),
      )

      /* ---------------- 运行页 ---------------- */

      const runPage = h('div', { style: { display: 'grid', gap: 8 } },
        h('div', { style: css.card2 },
          h('div', { style: css.secTitle }, '平台与账号'),
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
            h('span', {
              style: {
                width: 8, height: 8, borderRadius: 99, flex: '0 0 auto',
                background: (s.platform === 'xiaohongshu' ? '#FF2442'
                  : s.platform === 'douyin' ? '#111827' : '#FB7299'),
                boxShadow: `0 0 0 3px ${rgba(C.accent, 0.14)}`,
              },
            }),
            h('select', {
              style: { ...css.input, flex: 1 }, value: editValue('platform', s.platform || 'bilibili'),
              onChange: (e) => editTyping('platform', e.target.value, (v) => (v)),
            },
              h('option', { value: 'bilibili' }, 'B站（已接入）'),
              h('option', { value: 'xiaohongshu' }, '小红书（未接入）'),
              h('option', { value: 'douyin' }, '抖音（未接入）'),
            ),
          ),
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
            h('span', { style: { ...css.meta, flex: 1 } },
              s.loggedIn ? `发言号 ${s.accountUid || '已登录'}` : '发言号未登录'),
            h('button', { style: css.btn, disabled: busy === 'login', onClick: startLogin },
              busy === 'login' ? '生成中…' : (s.loggedIn ? '重扫' : '扫码')),
            s.loggedIn ? h('button', { style: css.btn, onClick: () => call('logout') }, '退出') : null,
          ),
          waiting && s.login?.qr
            ? h('div', { style: css.qr },
                h('img', {
                  style: css.qrImg, alt: '登录二维码',
                  src: `https://api.qrserver.com/v1/create-qr-code/?size=148x148&data=${encodeURIComponent(s.login.qr)}`,
                  onError: (e) => { e.currentTarget.style.display = 'none' },
                }),
                h('span', { style: css.faint }, s.login.message || '用 B站 App 扫码'),
              )
            : null,
        ),

        h('div', { style: css.card2 },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
            h('span', { style: { ...css.secTitle, flex: 1 } }, '峰谷模式'),
            h('span', {
              style: { ...css.faint, color: s.quota?.discounted ? C.accent : C.faint },
            }, s.quota ? (s.quota.discounted ? `谷时 ${Math.round(s.quota.factor * 100)}% 价` : '峰时原价') : ''),
            h(Switch, {
              on: s.peakValley !== false, C, title: '峰谷模式',
              onChange: () => patch({ peakValley: s.peakValley === false }),
            }),
          ),
          s.quota
            ? h('span', { style: css.faint },
                `${s.quota.clock}（北京）· 有效单价 ¥${s.quota.effectivePerM}/百万 tokens · 原价 ¥${s.quota.mixedPerM}`)
            : null,
          h('span', { style: css.faint }, '谷时（00:30–08:30）自动按折扣算，同样的钱能跑更多内容'),
        ),

        h('div', { style: css.card2 },
          h('div', { style: css.secTitle }, '预算'),
          h('div', { style: css.two },
            h('div', { style: css.row },
              h('span', { style: css.label }, '日上限 ¥'),
              numField('dailyBudget', s.dailyBudget ?? 2, { min: 0, step: 0.1 }),
            ),
            h('div', { style: css.row },
              h('span', { style: css.label }, '单次上限 ¥'),
              numField('perRunBudget', s.perRunBudget ?? 0.2, { min: 0, step: 0.05 }),
            ),
          ),
          h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
            h('span', { style: css.faint }, `日 ≈ ${(s.quota?.dailyTokens || 0).toLocaleString()} tokens`),
            h('span', { style: css.faint }, `单次 ≈ ${(s.quota?.runTokens || 0).toLocaleString()}`),
            h('span', { style: { ...css.faint, color: C.accent } },
              `已用 ${(s.quota?.used || 0).toLocaleString()}`),
            h('span', { style: css.faint },
              `剩 ${(s.quota?.remainingTokens || 0).toLocaleString()}`),
          ),
          // 剩余额度条：改动预算后这里应该立刻变长，一眼能看出有没有生效
          h('div', { style: css.bar },
            h('div', {
              style: {
                width: `${Math.min(100, ((s.quota?.used || 0) / Math.max(1, s.quota?.dailyTokens || 1)) * 100)}%`,
                background: `linear-gradient(90deg, ${rgba(C.accent, 0.75)}, ${C.accent})`,
              },
            })),
          s.lastRunUsage
            ? h('span', { style: css.faint },
                `上一轮真实消耗 ${Number(s.lastRunUsage.total || 0).toLocaleString()} tokens`
                + `（输入 ${Number(s.lastRunUsage.input || 0).toLocaleString()} / 输出 ${Number(s.lastRunUsage.output || 0).toLocaleString()}）`
                + (s.spentToday ? ` · 今日约 ¥${Number(s.spentToday).toFixed(3)}` : ''))
            : null,
          h('div', { style: css.two },
            h('div', { style: css.row },
              h('span', { style: css.label }, '每轮目标条数'),
              numField('targetCount', s.targetCount ?? 12, { min: 3, max: 30, step: 1 }),
            ),
            h('div', { style: css.row },
              h('span', { style: css.label }, '最多续接次数'),
              numField('maxResume', s.maxResume ?? 2, { min: 0, max: 5, step: 1 }),
            ),
          ),
          h('span', { style: css.faint }, '日上限用不完没关系，剩下的不结转也不浪费'),
        ),

        h('div', { style: css.card2 },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
            h('span', { style: { ...css.secTitle, flex: 1 } }, '连播（自动接着跑）'),
            h('span', { style: { ...css.faint, color: s.autoRun ? C.accent : C.faint } },
              s.autoRun ? '运行中' : '已关闭'),
            h(Switch, {
              on: Boolean(s.autoRun), C, title: '连播',
              onChange: () => patch({ autoRun: !s.autoRun }),
            }),
          ),
          s.autoRun
            ? h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
                h('span', { style: { ...css.faint, flex: 1 } }, '一条跑完隔几秒开下一条'),
                numField('cruiseGapSec', s.cruiseGapSec ?? 45, { min: 10, max: 600, step: 1, width: 64 }),
              )
            : h('span', { style: css.faint }, '关闭时只有你点「刷一轮」才会动'),
          h('span', { style: css.faint },
            capBlocked
              ? `今日评论 ${capUsed} / 上限 ${capCount} 条已满：整轮不再开，明天 00:00 自动继续（想让它接着干就调大上限）`
              : (s.autoRun && s.nextRunAt
                  ? `下一条 ${Math.max(0, Math.round((s.nextRunAt - Date.now()) / 1000))} 秒后开跑 · 上次自动：${
                      s.lastAutoRunAt ? new Date(s.lastAutoRunAt).toLocaleTimeString('zh-CN', { hour12: false }) : '—'}`
                  : (s.lastAutoRunAt
                      ? `上次自动：${new Date(s.lastAutoRunAt).toLocaleString('zh-CN', { hour12: false })}`
                      : '还没自动跑过'))),
        ),

        s.pending
          ? h('div', { style: css.card2 },
              h('span', { style: css.faint },
                `上一轮还差 ${s.pending.remaining} 条没跑完 · 已续接 ${s.pending.attempts}/${s.maxResume ?? 2} 次`),
              h('span', { style: css.faint }, '下次「刷一轮」先补这个缺口，补不上就放弃重开'),
            )
          : null,

        h('div', { style: css.card2 },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
            h('span', { style: { ...css.secTitle, flex: 1 } }, '评论区'),
            h('span', { style: { ...css.faint, color: modeOn ? C.accent : C.faint } },
              modeOn ? '已开启' : '已关闭'),
            h(Switch, {
              on: modeOn, C, title: '评论区开关',
              onChange: () => patch({ commentMode: modeOn ? 'off' : 'draft' }),
            }),
          ),
          modeOn
            ? h('div', { style: { display: 'grid', gap: 6 } },
                h('div', { style: css.seg },
                  opts.map(([k, t]) => h('button', {
                    key: k, style: mode === k ? css.btnOn : css.btn,
                    onClick: () => patch({ commentMode: k }),
                  }, t))),
                mode === 'check-auto'
                  ? h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
                      h('span', { style: { ...css.faint, flex: 1 } }, '每天最多自主发几条'),
                      numField('commentDailyCap', s.commentDailyCap ?? 3, { min: 0, max: 20, step: 1, width: 60 }),
                    )
                  : null,
                h('span', { style: css.faint },
                  mode === 'draft'
                    ? '每轮跑完生成 1 条草稿，等你点「发送」'
                    : mode === 'auto'
                      ? '每轮跑完自动生成并直接发出（受每日上限约束）'
                      : '每轮跑完生成 → 合规自检 → 通过就自动发，不通过压成草稿'),
                h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 } },
                  h('span', { style: { ...css.label, flex: 1 } }, '单条视频最多看多久（分钟）'),
                  // 界面填分钟、存的秒：用 numField 但换一套键名，写盘前 ×60
                  h('input', {
                    style: { ...css.input, width: 60 },
                    type: 'text', inputMode: 'decimal',
                    value: String(Number(editValue('dwellMin', s.dwellSec ?? 300)) / 60),
                    onChange: (e) => bumpEdits('dwellMin', e.target.value),
                    onKeyDown: (e) => {
                      if (e.key !== 'Enter') return
                      const m = Number(editValue('dwellMin', s.dwellSec ?? 300))
                      if (!Number.isFinite(m)) { setNote('请输入数字'); return }
                      const sec = Math.round(Math.min(60, Math.max(0.5, m)) * 60)
                      bumpEdits('dwellMin', String(sec / 60))
                      saveQuietly({ dwellSec: sec }).catch(() => {})
                    },
                  }),
                  h('button', {
                    style: { ...css.btnOn, fontSize: 10.5, padding: '3px 8px' },
                    title: '确认（回车）',
                    onClick: () => {
                      const m = Number(editValue('dwellMin', s.dwellSec ?? 300))
                      if (!Number.isFinite(m)) { setNote('请输入数字'); return }
                      const sec = Math.round(Math.min(60, Math.max(0.5, m)) * 60)
                      bumpEdits('dwellMin', String(sec / 60))
                      saveQuietly({ dwellSec: sec }).catch(() => {})
                    },
                  }, '确认'),
                ),
                h('span', { style: css.faint },
                  '到点就换下一条，不管它本来多长；界面不在这一页时也按这个时间换，保证一直在刷'),
                h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 } },
                  h('span', { style: { ...css.label, flex: 1 } }, '最少看够多久才许换（秒）'),
                  numField('minWatchSec', s.minWatchSec ?? 60, { min: 0, max: 600, step: 5, width: 64 }),
                ),
                h('span', { style: css.faint },
                  '评论发完了也不许马上跳；视频本身比这个短就按"看完"算（不会重播它来凑时间）。填 0 = 不限制'),
                h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 } },
                  h('span', { style: { ...css.label, flex: 1 } }, '只挑最近几天的片子'),
                  numField('daysBack', s.daysBack ?? 7, { min: 0, max: 365, step: 1, width: 60 }),
                ),
                h('span', { style: css.faint },
                  `交给 B站 服务端按发布时间筛；填 0 = 不限（不然搜到的全是老爆款，口味会飘）`),
                h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 } },
                  h('span', { style: { ...css.label, flex: 1 } }, '发之前拦 AI 腔'),
                  h('span', { style: { ...css.faint, color: s.styleGate !== false ? C.accent : C.faint } },
                    s.styleGate !== false ? '开着' : '关了'),
                  h(Switch, {
                    on: s.styleGate !== false, C, title: '风格闸',
                    onChange: () => patch({ styleGate: s.styleGate === false }),
                  }),
                ),
                h('span', { style: css.faint },
                  '套话开头 / 总结升华 / 排比工整 / 署名式结尾一律拦下，让模型改一次；改完还不过就不发'),
                h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 } },
                  h('span', { style: { ...css.label, flex: 1 } }, '没字幕没弹幕时抽帧看画面'),
                  h('span', { style: { ...css.faint, color: s.visionFallback !== false ? C.accent : C.faint } },
                    s.visionFallback !== false ? '开着' : '关了'),
                  h(Switch, {
                    on: s.visionFallback !== false, C, title: '抽帧看画面',
                    onChange: () => patch({ visionFallback: s.visionFallback === false }),
                  }),
                ),
                h('span', { style: css.faint },
                  '主播既不开字幕也不放弹幕时，拿 B站 故事板抽帧丢给能看图的模型，让它说清楚这条在讲什么；模型看不了就跳过'),
                h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 } },
                  h('span', { style: { ...css.label, flex: 1 } }, '每条视频最多几张快照'),
                  numField('visionShots', s.visionShots ?? 1, { min: 1, max: 4, step: 1, width: 60 }),
                ),
                h('span', { style: css.faint },
                  '触发条件：没字幕、且**最后一条弹幕之后 30 秒没有新弹幕**才抽；每多一张都多花 token，默认 1 张'),
                h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                  h('span', { style: { ...css.label, flex: 1 } }, '看到内容时去评论的概率'),
                  h('span', { style: { ...css.meta, color: C.accent } },
                    `${Math.round((s.commentChance ?? 0.6) * 100)}%`),
                ),
                h('input', {
                  type: 'range', min: 0, max: 100, step: 5,
                  style: { width: '100%', accentColor: C.accent },
                  value: Math.round((s.commentChance ?? 0.6) * 100),
                  onChange: (e) => patch({ commentChance: Number(e.target.value) / 100 }),
                }),
                h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                  h('span', { style: { ...css.label, flex: 1 } }, '有人回我时去接的概率'),
                  h('span', { style: { ...css.meta, color: C.accent } },
                    `${Math.round((s.replyChance ?? 0.5) * 100)}%`),
                ),
                h('input', {
                  type: 'range', min: 0, max: 100, step: 5,
                  style: { width: '100%', accentColor: C.accent },
                  value: Math.round((s.replyChance ?? 0.5) * 100),
                  onChange: (e) => patch({ replyChance: Number(e.target.value) / 100 }),
                }),
                h('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } },
                  h('span', { style: { ...css.faint, flex: 1 } },
                    `今日已发 ${s.commentedToday || 0} / ${s.commentDailyCap ?? 3}`),
                  (s.drafts || []).length
                    ? h('button', {
                        style: { ...css.btn, fontSize: 10.5, padding: '2px 7px' },
                        onClick: () => call('comment.clearDrafts'),
                      }, '清空草稿')
                    : null,
                  h('button', {
                    style: { ...css.btn, fontSize: 10.5, padding: '2px 7px' },
                    disabled: busy === 'draft', onClick: makeDraft,
                  }, busy === 'draft' ? '生成中…' : '手动补一条'),
                ),
                (s.drafts || []).length
                  ? h('div', { style: { display: 'grid', gap: 6 } },
                      (s.drafts || []).slice(0, 3).map((d) => h('div', {
                        key: d.id,
                        style: {
                          display: 'grid', gap: 4, padding: '7px 8px',
                          borderRadius: 10, border: `1px solid ${C.line}`, background: C.bg,
                        },
                      },
                        h('span', { style: css.faint },
                          `${String(d.title || '').slice(0, 22)} · ${d.author || ''}`),
                        d.atName
                          ? h('span', { style: { ...css.faint, color: C.accent } },
                              `发出后再单独发一条「@${d.atName} 想让你看看这个」`)
                          : null,
                        d.status === 'held'
                          ? h('span', { style: { ...css.faint, color: AMBER } },
                              `自检未过：${d.reason || '未通过'}`)
                          : null,
                        h('textarea', {
                          style: { ...css.area, minHeight: 42 },
                          defaultValue: d.text,
                          onBlur: (e) => call('comment.update', { id: d.id, text: e.target.value }),
                        }),
                        h('div', { style: { display: 'flex', gap: 6 } },
                          h('button', {
                            style: css.btnOn, disabled: busy === 'send',
                            onClick: () => sendDraft(d.id),
                          }, busy === 'send' ? '发送中…' : '发送'),
                          h('button', {
                            style: css.btn,
                            onClick: () => call('comment.drop', { id: d.id }),
                          }, '丢弃'),
                        ),
                      )),
                    )
                  : h('span', { style: css.faint }, '没有草稿：点上面「生成一条草稿」'),
              )
            : h('span', { style: css.faint }, '关闭时只选片，不碰评论区'),
        ),

        h('div', { style: css.card2 },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
            h('span', { style: { ...css.secTitle, flex: 1 } }, '另发一条 @ 主人号的概率'),
            h('span', { style: css.meta }, `${Math.round((s.mentionChance ?? 0.5) * 100)}%`),
          ),
          h('input', {
            type: 'range', min: 0, max: 100, step: 5,
            style: { width: '100%', accentColor: C.accent },
            value: Math.round((s.mentionChance ?? 0.5) * 100),
            onChange: (e) => patch({ mentionChance: Number(e.target.value) / 100 }),
          }),
          h('span', { style: css.faint },
            `正文评完后再单独补一条只带 @ 的提醒（只表达"想让你看看"，不和正文混在一起）`),
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 } },
            h('span', { style: { ...css.label, flex: 1 } }, '契合度达到多少才 @ 你'),
            h('span', { style: { ...css.meta, color: C.accent } },
              `${Math.round((s.mentionThreshold ?? 0.7) * 100)}%`),
          ),
          h('input', {
            type: 'range', min: 0, max: 100, step: 5,
            style: { width: '100%', accentColor: C.accent },
            value: Math.round((s.mentionThreshold ?? 0.7) * 100),
            onChange: (e) => patch({ mentionThreshold: Number(e.target.value) / 100 }),
          }),
          h('span', { style: css.faint },
            '它自己会照常刷，但只有判定「你可能喜欢」的内容才会 @ 你；低于这个值连骰子都不掷'),
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 } },
            h('span', { style: { ...css.label, flex: 1 } }, '发言号可看无关内容的上限'),
            h('span', { style: { ...css.meta, color: C.accent } },
              `${Math.round((s.offTopicShare ?? 0.3) * 100)}%`),
          ),
          h('input', {
            type: 'range', min: 0, max: 100, step: 5,
            style: { width: '100%', accentColor: C.accent },
            value: Math.round((s.offTopicShare ?? 0.3) * 100),
            onChange: (e) => patch({ offTopicShare: Number(e.target.value) / 100 }),
          }),
          h('span', { style: css.faint },
            '每轮选片里，跟你的兴趣不沾边的占多少；0% = 只看你爱看的，太高就会飘成见啥看啥'),
        ),

        h('button', { style: css.primary, disabled: busy === 'run', onClick: run },
          busy === 'run' ? '跑着呢…' : '刷一轮并挑推荐'),

        items.length
          ? h('div', { style: { display: 'grid', gap: 6 } },
              items.slice(0, 10).map((it) => h('a', {
                key: it.bvid, style: css.item, href: it.url, target: '_blank', rel: 'noreferrer',
                onClick: (e) => {
                  e.preventDefault()
                  call('focus.set', { bvid: it.bvid })
                  // 点结果 → 去监测页看预览（不要抢成试播；旧代码这里写的是不存在的 'live'）
                  lastAutoBvid.current = it.bvid
                  setMView('preview')
                  setMonitorOn(true)
                  setTab('monitor')
                },
              },
                h('span', { style: { fontWeight: 600, fontSize: 11.5 } }, it.title),
                h('span', { style: css.faint },
                  `${it.source}${it.mention ? ' · @你' : ''} · ${it.author || ''}`),
              )),
            )
          : h('div', { style: css.empty }, '还没有推荐结果。点上面「刷一轮」试试。'),
      )

      /* ---------------- 监测页 ---------------- */

      const fmtTime = (sec) => {
        const s = Math.max(0, Math.floor(Number(sec) || 0))
        return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
      }

      const savedPos = Number(watchAt || 0)
      const livePos = playerOn
        ? Math.min(
            Number(videoInfo?.duration || 1e9),
            playBase + (Date.now() - playStart) / 1000,
          )
        : savedPos

      const monitorPage = h('div', { style: { display: 'grid', gap: 8 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
          h('div', { style: css.seg },
            h('button', {
              style: mView === 'log' ? css.btnOn : css.btn, onClick: () => setMView('log'),
            }, '干了什么'),
            h('button', {
              style: mView === 'preview' ? css.btnOn : css.btn, onClick: () => setMView('preview'),
            }, '预览'),
            h('button', {
              style: mView === 'play' ? css.btnOn : css.btn, onClick: () => setMView('play'),
            }, '试播'),
          ),
          h('button', {
            style: autoPlay ? css.btnOn : css.btn,
            title: '开了就自动切到试播、静音播放、播完自动换下一条',
            onClick: () => setAutoPlay(!autoPlay),
          }, autoPlay ? '自动播放 · 开' : '自动播放 · 关'),
          h('span', { style: { flex: 1 } }),
          monitorOn ? h('span', { style: { ...css.faint, color: C.accent } }, '● 实时') : null,
          h('span', { style: { ...css.faint, fontSize: 10.5 } }, '事件流'),
          h(Switch, {
            on: monitorOn, C, title: '事件流开关（只管日志，不影响播放）',
            onChange: () => {
              setMonitorOn(!monitorOn)
              if (!monitorOn) { setLogs([]); seqRef.current = 0 }
            },
          }),
        ),

        mView === 'log'
          ? (monitorOn
              ? h('div', { ref: logBox, style: css.logBox },
                  logs.length
                    ? logs.map((l) => h('div', {
                        key: l.seq,
                        style: {
                          color: l.kind === 'err' ? AMBER : (l.kind === 'ok' ? C.accent : C.sub),
                          wordBreak: 'break-all',
                        },
                      },
                        h('span', { style: { opacity: 0.5 } },
                          new Date(l.t).toLocaleTimeString('zh-CN', { hour12: false }) + ' '),
                        l.text,
                      ))
                    : h('span', { style: css.faint }, '等待事件…'))
              : h('div', { style: { display: 'grid', gap: 8 } },
                  h('div', { style: css.empty }, '事件流关着（不拉日志、不占资源）。点右上角开关打开。'),
                  // 关着也要能看它当前状态，不能整块空白
                  h('div', { style: css.card2 },
                    h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
                      h('span', {
                        style: {
                          width: 7, height: 7, borderRadius: 99, flex: '0 0 auto',
                          background: phaseInfo?.name === '空闲' ? C.faint : C.accent,
                        },
                      }),
                      h('span', { style: { fontWeight: 650 } }, phaseInfo?.name || '空闲'),
                      h('span', { style: { ...css.faint, flex: 1 } }, phaseInfo?.detail || ''),
                    ),
                    h('span', { style: css.faint },
                      liveBvid ? `正在看：《${videoInfo?.title || liveBvid}》` : '没有正在看的内容'),
                  ),
                ))
          : mView === 'preview'
              ? h('div', { style: { display: 'grid', gap: 8 } },
                  h('div', { style: css.card2 },
                    h('div', { style: css.secTitle }, '白鲸台现在在哪'),
                    h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
                      h('span', {
                        style: {
                          width: 7, height: 7, borderRadius: 99, flex: '0 0 auto',
                          background: phaseInfo?.name === '空闲' ? C.faint : C.accent,
                          boxShadow: phaseInfo?.name === '空闲' ? 'none' : `0 0 0 3px ${rgba(C.accent, 0.18)}`,
                        },
                      }),
                      h('span', { style: { fontWeight: 650 } }, phaseInfo?.name || '空闲'),
                      h('span', { style: { ...css.faint, flex: 1 } }, phaseInfo?.detail || ''),
                    ),
                    h('span', { style: css.faint },
                      liveBvid
                        ? `位置：B站 · 视频页 · 《${videoInfo?.title || liveBvid}》`
                        : '位置：没有正在看的视频'),
                    h('span', { style: { ...css.faint, color: s.autoRun ? C.accent : C.faint } },
                      capBlocked
                        ? '连播：评论额度用完，明天 00:00 继续'
                        : (s.autoRun
                            ? (s.runningSince
                                ? '连播：这一趟在跑'
                                : (s.nextRunAt
                                    ? `连播：下一条 ${Math.max(0, Math.round((s.nextRunAt - Date.now()) / 1000))} 秒后开跑`
                                    : '连播：等待第一次开跑'))
                            : '连播关着：不会自己换下一条')),
                  ),
                  liveBvid
                    ? h('div', {
                        title: '点封面去 B站',
                        onClick: () => window.open(`https://www.bilibili.com/video/${liveBvid}`, '_blank', 'noopener'),
                        style: {
                          position: 'relative', width: '100%', aspectRatio: '16 / 9',
                          borderRadius: 12, overflow: 'hidden', background: '#000',
                          border: `1px solid ${C.glassEdge}`, cursor: 'pointer',
                          boxShadow: `0 10px 28px ${rgba(C.accent, 0.18)}`,
                        },
                      },
                        videoInfo?.cover
                          ? h('img', {
                              src: videoInfo.cover, alt: '', referrerPolicy: 'no-referrer',
                              style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
                            })
                          : h('div', {
                              style: {
                                display: 'grid', placeItems: 'center', height: '100%',
                                color: '#fff', fontSize: 12,
                              },
                            }, '封面加载中…'),
                      )
                    : h('div', { style: { ...css.empty, gap: 6 } },
                        h('span', { style: { fontSize: 22, lineHeight: 1 } }, '🌊'),
                        h('span', null, '目前还没有播放视频哦'),
                        h('span', { style: { ...css.faint } },
                          '去「运行」刷一轮，点结果里的标题就会出现在这里'),
                      ),
                )
              : h('div', { style: { display: 'grid', gap: 8 } },
                  h('div', { style: css.card2 },
                    h('div', { style: css.secTitle }, '播放状态'),
                    h('span', { style: css.meta },
                      !liveBvid
                        ? '当前没有在播'
                        : ended
                          ? '已播完，等下一个视频'
                          : playerOn
                            ? `正在播《${videoInfo?.title || liveBvid}》`
                            : '等待自动开播…'),
                    playerOn || ended || savedPos > 0
                      ? h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
                          h('div', { style: css.bar, },
                            h('div', {
                              style: {
                                width: `${Math.min(100, (livePos / Math.max(1, Number(videoInfo?.duration || 1))) * 100)}%`,
                                background: `linear-gradient(90deg, ${rgba(C.accent, 0.75)}, ${C.accent})`,
                              },
                            })),
                          h('span', { style: css.faint },
                            `${fmtTime(livePos)} / ${fmtTime(videoInfo?.duration || 0)}`),
                        )
                      : null,
                    h('span', { style: css.faint },
                      `上次停在 ${fmtTime(savedPos)}${ended ? '（已播完）' : ''}`),
                  ),
                  !liveBvid
                    ? h('div', { style: { ...css.empty, gap: 6 } },
                        h('span', { style: { fontSize: 22, lineHeight: 1 } }, '🌊'),
                        h('span', null, '目前还没有播放视频哦'),
                      )
                    : ended
                      ? h('div', {
                          style: {
                            width: '100%', aspectRatio: '16 / 9', borderRadius: 12,
                            background: '#000', border: `1px solid ${C.line}`,
                            display: 'grid', placeItems: 'center', gap: 4,
                          },
                        },
                          h('span', { style: { color: '#6b7280', fontSize: 12 } }, '视频已结束'),
                          h('span', { style: { color: '#4b5563', fontSize: 10.5 } },
                            '等下一个视频出现'),
                        )
                      : playerOn
                        ? h('div', { style: { display: 'grid', gap: 6 } },
                            h('iframe', {
                              key: liveBvid,
                              src: `https://player.bilibili.com/player.html?bvid=${liveBvid}&autoplay=1&muted=1&danmaku=0&high_quality=1`,
                              style: {
                                width: '100%', aspectRatio: '16 / 9', border: 'none',
                                borderRadius: 12, background: '#000',
                              },
                              allow: 'autoplay; fullscreen; picture-in-picture',
                              allowFullScreen: true,
                            }),
                            h('div', { style: { display: 'flex', gap: 6 } },
                              h('button', { style: css.btn, onClick: stopPlay }, '停止'),
                              h('span', { style: { ...css.faint, flex: 1 } },
                                '画面是真的在放（静音）；进度条按本地计时估算，跨域读不到播放器内部'),
                            ),
                          )
                        : h('div', { style: { display: 'grid', gap: 6 } },
                            h('div', {
                              style: {
                                width: '100%', aspectRatio: '16 / 9', borderRadius: 12,
                                background: '#000', border: `1px solid ${C.line}`,
                                display: 'grid', placeItems: 'center', gap: 6,
                              },
                            },
                              h('span', { style: { color: '#6b7280', fontSize: 11.5 } },
                                ended ? '这条播完了' : '播放器已停'),
                              h('button', {
                                style: { ...css.btnOn, fontSize: 11 },
                                onClick: () => {
                                  setEnded(false)
                                  setPlayBase(0)
                                  setPlayStart(Date.now())
                                  setPlayerOn(true)
                                },
                              }, '从头再放一次'),
                            ),
                          ),
                ),
      )

      /* ---------------- 留言页 ---------------- */

      const notesPage = h('div', { style: { display: 'grid', gap: 8 } },
        h('div', { style: css.card2 },
          h('div', { style: css.secTitle }, '我想说的'),
          h('div', { style: { display: 'flex', gap: 6 } },
            h('input', {
              style: css.input, value: draft, placeholder: '写点什么，或者回我的话…',
              onChange: (e) => setDraft(e.target.value),
              onKeyDown: async (e) => {
                if (e.key !== 'Enter' || !draft.trim()) return
                await call('notes.add', { text: draft.trim() })
                setDraft('')
              },
            }),
            h('button', {
              style: css.btn,
              onClick: async () => {
                if (!draft.trim()) return
                await call('notes.add', { text: draft.trim() })
                setDraft('')
              },
            }, '留'),
          ),
        ),
        (s.notes || []).length
          ? h('div', { style: { display: 'grid', gap: 6 } },
              s.notes.map((n) => h('div', { key: n.id, style: css.noteBox },
                h('span', { style: { fontSize: 11.5 } }, n.text),
                h('div', { style: { display: 'flex', gap: 5, alignItems: 'center' } },
                  h('span', {
                    style: {
                      ...css.faint, flex: 1,
                      color: n.status === 'accepted' ? C.accent
                        : (n.status === 'dismissed' ? C.faint : AMBER),
                    },
                  }, n.status === 'accepted' ? '已采纳' : (n.status === 'dismissed' ? '先不用' : '待你反馈')),
                  h('button', {
                    style: { ...css.btn, fontSize: 10.5, padding: '2px 7px' },
                    onClick: () => call('notes.update', { id: n.id, patch: { status: 'accepted' } }),
                  }, '采纳'),
                  h('button', {
                    style: { ...css.btn, fontSize: 10.5, padding: '2px 7px' },
                    onClick: () => call('notes.update', { id: n.id, patch: { status: 'dismissed' } }),
                  }, '先不用'),
                  h('button', {
                    style: { ...css.btn, fontSize: 10.5, padding: '2px 7px' },
                    onClick: () => call('notes.remove', { id: n.id }),
                  }, '×'),
                ),
                h('input', {
                  style: css.input, defaultValue: n.reply, placeholder: '我的想法…（失焦即存）',
                  onBlur: (e) => call('notes.update', { id: n.id, patch: { reply: e.target.value } }),
                }),
              )),
            )
          : h('div', { style: css.empty }, '还没留言。用久了我在这儿攒想法等你点头。'),
      )

      /* ---------------- 记录页 ---------------- */

      const historyPage = h('div', { style: { display: 'grid', gap: 8 } },
        // 它自己刷过什么：B站 那边改不了观看历史，所以至少在本机标清楚「哪条是它看的」
        h('div', { style: css.card2 },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
            h('span', { style: { ...css.secTitle, flex: 1 } }, '它看过的'),
            h('span', { style: css.faint }, `${(s.watchLog || []).length} 条 · 本机台账`),
          ),
          h('span', { style: css.faint },
            'B站 的观看历史改不了，这些是插件自己记的 source: plugin。看过的片子不会再推给你。'),
          (s.watchLog || []).length
            ? h('div', { style: { display: 'grid', gap: 4, marginTop: 4 } },
                (s.watchLog || []).slice(0, 12).map((w) => h('div', {
                  key: w.bvid,
                  style: { display: 'flex', gap: 6, alignItems: 'center', fontSize: 11.5 },
                },
                  h('span', {
                    style: {
                      ...css.pill, flexShrink: 0, fontSize: 10,
                      color: C.accent, background: rgba(C.accent, 0.1),
                      borderColor: rgba(C.accent, 0.26),
                    },
                  }, 'plugin'),
                  h('span', {
                    style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
                  }, String(w.title || w.bvid).slice(0, 40)),
                  h('a', {
                    href: `https://www.bilibili.com/video/${w.bvid}`,
                    target: '_blank', rel: 'noreferrer',
                    style: { ...css.faint, color: C.accent, flexShrink: 0 },
                  }, '看'),
                )),
              )
            : h('div', { style: css.empty }, '还没看过——它开跑之后这里会一条条记下来'),
        ),
        h('div', { style: css.card2 },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
            h('span', { style: { ...css.secTitle, flex: 1 } }, '已发送的评论'),
            h('span', { style: css.faint },
              `今日 ${s.commentedToday || 0} / ${s.commentDailyCap ?? 3}`),
          ),
          h('span', { style: css.faint }, '只在这里留档；草稿区只放还没发出去的'),
        ),
        (s.commentLog || []).length
          ? h('div', { style: { display: 'grid', gap: 6 } },
              (s.commentLog || []).map((c) => h('div', {
                key: `${c.rpid || c.at}`,
                style: {
                  display: 'grid', gap: 3, padding: '7px 9px', borderRadius: 10,
                  border: `1px solid ${C.line}`, background: C.soft,
                },
              },
                h('span', { style: { fontWeight: 650, fontSize: 11.5 } },
                  String(c.title || c.bvid || '').slice(0, 28)),
                h('span', { style: { fontSize: 11.5 } }, c.text),
                h('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } },
                  c.kind === 'mention'
                    ? h('span', { style: { ...css.faint, color: C.accent, flexShrink: 0 } }, '@ 提醒')
                    : null,
                  h('span', {
                    style: {
                      ...css.faint, flex: 1, overflow: 'hidden',
                      textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    },
                  }, `${new Date(c.at).toLocaleString('zh-CN', { hour12: false })} · rpid ${c.rpid || '?'}`),
                  h('a', {
                    href: `https://www.bilibili.com/video/${c.bvid}`,
                    target: '_blank', rel: 'noreferrer',
                    style: { ...css.faint, color: C.accent },
                  }, '去视频'),
                ),
              )),
            )
          : h('div', { style: css.empty }, '还没有发过评论'),
        (s.failedComments || []).length
          ? h('div', { style: css.card2 },
              h('div', { style: css.secTitle }, `未发出（${(s.failedComments || []).length}）`),
              h('div', { style: { display: 'grid', gap: 6 } },
                (s.failedComments || []).slice(0, 8).map((c) => h('div', {
                  key: c.at,
                  style: { display: 'grid', gap: 2, padding: '6px 8px', borderRadius: 10, border: `1px solid ${C.line}` },
                },
                  h('span', { style: { fontSize: 11.5 } }, c.text),
                  h('span', { style: { ...css.faint, color: AMBER } }, c.reason || '发送失败'),
                )),
              ),
            )
          : null,
      )

      const pages = { learn: learnPage, run: runPage, monitor: monitorPage, notes: notesPage, history: historyPage }

      return h('div', { style: { ...css.card, left: pos.x, top: pos.y } },
        h('div', {
          style: css.head,
          onMouseDown: (e) => { drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y } },
        },
          h('div', { style: css.brand },
            h('svg', { style: css.logo, viewBox: '0 0 32 32', 'aria-hidden': true },
              h('defs', null,
                h('linearGradient', { id: 'wp-grad', x1: '0', y1: '0', x2: '0', y2: '1' },
                  h('stop', { offset: '0%', stopColor: C.accent }),
                  h('stop', { offset: '100%', stopColor: C.deep }),
                ),
              ),
              h('rect', { width: 32, height: 32, rx: 9, fill: 'url(#wp-grad)' }),
              h('path', {
                d: 'M7 17c0-3.6 2.9-6.2 6.4-6.2 2.6 0 4.4 1.2 5.5 3.1l3.9-2.7c.9-.6 2 0 2 1.1v1.6c1.8.4 3.2 1.3 3.7 2.8-1.5.2-2.8-.1-3.9-.8-.5 2.5-2.8 4.3-5.7 4.3H12c-2.8 0-5-1.9-5-3.2Z',
                fill: '#fff', opacity: 0.95,
              }),
            ),
            h('span', { style: css.title }, '白鲸台'),
            // 总开关：放在最上面，一眼能看到、一下就能关掉整个插件
            h('button', {
              style: {
                ...css.pill,
                cursor: 'pointer',
                fontFamily: 'inherit',
                display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: '3px 8px 3px 6px',
                color: power ? C.accent : AMBER,
                background: power ? rgba(C.accent, 0.12) : rgba(AMBER, 0.14),
                borderColor: power ? rgba(C.accent, 0.32) : rgba(AMBER, 0.36),
              },
              title: power ? '总开关：开着（点一下让插件彻底停下）' : '总开关：关着（点一下恢复）',
              onClick: togglePower,
              onMouseDown: (e) => e.stopPropagation(), // 别触发拖动
            },
              // 小滑块
              h('span', {
                style: {
                  width: 22, height: 12, borderRadius: 99, position: 'relative', flex: '0 0 auto',
                  background: power ? C.accent : rgba(AMBER, 0.55),
                  transition: 'background .18s ease',
                },
              },
                h('span', {
                  style: {
                    position: 'absolute', top: 1.5, left: power ? 11.5 : 1.5,
                    width: 9, height: 9, borderRadius: 99, background: '#fff',
                    transition: 'left .18s ease',
                  },
                }),
              ),
              power ? '运行中' : '已关闭',
            ),
            h('span', { style: { ...css.pill, color: s.loggedIn ? C.accent : C.sub } },
              s.loggedIn ? '在线' : '未登录'),
            pendingNotes
              ? h('span', { style: { ...css.pill, color: AMBER, background: rgba(AMBER, 0.12), borderColor: rgba(AMBER, 0.28) } }, `${pendingNotes} 条待回`)
              : null,
          ),
          h('button', {
            style: css.iconBtn, title: `主题：${themeLabel}（点一下切换）`, onClick: cycleTheme,
          }, h(TabIcon, { d: themeIcon, size: 14 })),
          h('button', {
            style: css.iconBtn, title: '收起',
            onClick: () => { setOpen(false); lsSet(KEYS.open, '0') },
          }, '—'),
        ),

        h('div', { style: css.tabs },
          TABS.map(([key, label, d]) => h('button', {
            key, style: tab === key ? css.tabOn : css.tab, onClick: () => setTab(key),
          }, h(TabIcon, { d }), label))),

        // 常驻状态条：不管停在哪一页，都知道它现在在干什么
        h('div', {
          style: {
            display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px',
            borderBottom: `1px solid ${C.line}`,
            fontSize: 11, background: C.soft, color: C.sub,
          },
        },
          h('span', {
            style: {
              width: 6, height: 6, borderRadius: 99, flex: '0 0 auto',
              background: phaseInfo?.name === '空闲' ? C.faint : C.accent,
              boxShadow: phaseInfo?.name === '空闲' ? 'none' : `0 0 0 3px ${rgba(C.accent, 0.16)}`,
            },
          }),
          h('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
            `${phaseInfo?.name || '空闲'}${phaseInfo?.detail ? ` · ${phaseInfo.detail}` : ''}`),
          s.autoRun
            ? (capBlocked
                // 评论日上限用完 → 连播已经在宿主那边睡到明天 0 点，这里别显示成"0s 后"像卡住
                ? h('span', { style: { color: AMBER, flexShrink: 0 }, title: `今日已发 ${capUsed} / 上限 ${capCount} 条` },
                    '评论额度用完 · 明日继续')
                : h('span', {
                    style: { color: C.accent, flexShrink: 0 },
                  }, s.runningSince
                    ? '连播中'
                    : (s.nextRunAt
                        ? (() => {
                            const sec = Math.max(0, Math.round((s.nextRunAt - Date.now()) / 1000))
                            return sec >= 3600 ? `${Math.floor(sec / 3600)} 小时后` : `${sec}s 后`
                          })()
                        : '连播')))
            : h('span', { style: { ...css.faint, flexShrink: 0 } }, '连播关'),
        ),

        h('div', { style: css.body },
          power
            ? (pages[tab] || learnPage)
            : h('div', {
                style: {
                  display: 'grid', gap: 8, placeItems: 'center',
                  padding: '28px 14px', textAlign: 'center',
                },
              },
                h('div', { style: { ...css.secTitle, fontSize: 13, color: C.sub } }, '总开关已关闭'),
                h('div', { style: { ...css.faint, lineHeight: 1.7, maxWidth: 330 } },
                  '插件装着，但什么都不做：不选片、不评论、不 @、不上报、不自动换片，也不会花 token。'),
                h('button', {
                  style: { ...css.btnOn, marginTop: 4 },
                  onClick: togglePower,
                }, '点这里恢复'),
              ),
        ),

        h('div', { style: css.foot },
          h('div', { style: css.bar },
            h('div', {
              style: {
                width: `${ratio * 100}%`, height: '100%',
                background: ratio >= 0.9
                  ? `linear-gradient(90deg, ${rgba(AMBER, 0.8)}, ${AMBER})`
                  : `linear-gradient(90deg, ${rgba(C.accent, 0.75)}, ${C.accent})`,
                transition: 'width .25s ease',
              },
            })),
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
            h('span', { style: css.faint },
              `今日 ¥${spent.toFixed(2)} / ¥${daily.toFixed(2)} · ${s.runsToday || 0} 轮`),
            h('span', { style: { flex: 1 } }),
            note
              ? h('span', {
                  style: {
                    ...css.faint, maxWidth: 200, overflow: 'hidden',
                    textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  },
                  title: note,
                }, note)
              : null,
          ),
        ),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay', id: 'whale-panel', order: 60, label: '白鲸台',
        }, Panel))
      },
    }
  },
})
