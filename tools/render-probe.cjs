#!/usr/bin/env node
/**
 * 渲染探针：不开浏览器、不重载插件，直接在 Node 里跑一遍 Panel()，
 * 把整棵元素树走一遍，抓「元素类型非法 / 渲染抛错」这类会让槽位 active:false 的问题。
 *
 * 用法：node tools/render-probe.cjs [场景]
 *   场景：empty（默认，st 为空）、full（什么字段都有，条件分支全开）、cap（评论额度用完）
 *
 * 原理：客户端半用 window.__ModuleLoader__.load({ id, factory }) 导出，
 * 组件通过 ctx.slots.register(opts, Comp) 拿到。用假的 h / hooks 跑 Comp() 即可。
 */
const fs = require('fs')
const path = require('path')

const CLIENT = path.join(__dirname, '..', 'client.js')
const scene = process.argv[2] || 'empty'
const code = fs.readFileSync(CLIENT, 'utf8')

const now = Date.now()
const FULL = {
  loggedIn: true, autoRun: true, runningSince: now - 60_000, nextRunAt: now + 30_000,
  dailyBudget: 6, perRunBudget: 0.2, spentToday: 1.2345, runsToday: 12,
  tokensUsedToday: 1180, dailyTokens: 967741,
  commentMode: 'check-auto', commentDailyCap: 10, commentedToday: 7,
  masterName: 'demo-owner', masterUid: '10000', masterNameUid: '10000',
  interest: [{ tag: '美食探店', weight: 9 }, { tag: '旅行Vlog', weight: 7 }],
  learnedSamples: 40, learnedFrom: '关注列表+历史', learnedAt: now - 3_600_000,
  learnChance: 0.35, decayDays: 7, decayFloor: 1,
  login: { status: 'idle' }, loginText: '',
  notes: [{ id: 'a', status: 'pending', text: '待回', key: 'x' }],
  commentLog: [{ rpid: '1', at: now, text: '评论内容', bvid: 'BV1xx', title: '标题', kind: 'mention' }],
  failedComments: [{ at: now, text: '失败了', reason: '-111' }],
  history: [{ bvid: 'BV1zz', title: '看过', at: now }],
  lastRun: [{ bvid: 'BV1aa', title: '池内', aid: 1, cid: 2, duration: 300 }],
  current: { bvid: 'BV1aa', title: '当前视频', aid: 1, cid: 2, duration: 300 },
  watched: [{ bvid: 'BV1bb', title: '看过B' }],
  watchLog: [{ bvid: 'BV1aa', title: '它看过的一条', author: 'UP', source: 'plugin', at: now }],
  pending: { attempts: 1, done: 3, target: 12 },
  targetCount: 12, maxResume: 2, cruiseGapSec: 45, daysBack: 7, visionShots: 1,
  dwellSec: 300, mentionThreshold: 0.7, mentionChance: 0.7, offTopicShare: 0.3,
  followTraits: ['美食探店', '游戏电竞'], manualTopics: ['原神'],
  seedLinks: ['https://www.bilibili.com/video/BV1xx'],
  exhausted: false, paused: false, lastError: '出错了',
  priceInput: 2, priceOutput: 8, peakValley: true, offPeakDiscount: 0.5,
  styleGate: true, selfCheck: true, commentChance: 0.6, replyChance: 0.5,
  commentLearn: { count: 40, avgLen: 22, emojiRate: 0.2 },
}
const CAP = { ...FULL, commentedToday: 10, commentDailyCap: 10, nextRunAt: now + 3_600_000, capBlockedDay: '2026-10-29' }
const PAUSED = { ...FULL, paused: true, runningSince: 0, nextRunAt: 0 }
const ST = scene === 'cap' ? CAP : (scene === 'paused' ? PAUSED : (scene === 'full' ? FULL : null))

const store = {}
global.window = {
  localStorage: {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v) },
    removeItem: (k) => { delete store[k] },
  },
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
}
global.document = { hidden: false }

const h = (type, props, ...children) => {
  if (typeof type !== 'string' && typeof type !== 'function') {
    throw new Error('元素类型非法：' + String(type) + '（props: ' + JSON.stringify(Object.keys(props || {})) + '）')
  }
  const flat = []
  const push = (c) => { if (Array.isArray(c)) c.forEach(push); else flat.push(c) }
  push(children)
  return { $$el: true, type, props: props || {}, children: flat }
}

let nullCount = 0
const fakeNulls = [
  ST,                                             // st
  { name: 'demo-owner', mid: 10000, face: '' },          // card
  { bvid: 'BV1aa', title: '视频', aid: 1, cid: 2, duration: 300, danmaku: 9 },
  { name: '选片中', detail: '目标 12 条 · 峰时' }, // phaseInfo
]
const React = {
  createElement: h,
  useState: (init) => {
    let v
    if (typeof init === 'function') v = init()
    else if (init === null) { v = fakeNulls[nullCount] ?? null; nullCount += 1 }
    else if (Array.isArray(init)) {
      v = init.length ? init : (ST ? [{ bvid: 'BV1aa', title: '条目', aid: 1, cid: 2, duration: 300, at: now, text: '日志行', kind: 'info', level: 'info' }] : [])
    } else v = init
    return [v, () => {}]
  },
  useRef: (v) => ({ current: v }),
  useEffect: () => {},
  useMemo: (f) => f(),
  useCallback: (f) => f,
  Fragment: 'fragment',
}

let Comp = null
global.window.__ModuleLoader__ = {
  load: ({ factory }) => {
    const mod = factory((name) => {
      if (name === 'react') return React
      throw new Error('意外的 require: ' + name)
    })
    mod.apply({
      slots: {
        inject: (name, fn) => fn(),
        register: (opts, C) => { Comp = C },
      },
    })
  },
}
global.fetch = async () => ({ json: async () => ({ state: ST }) })

try {
  new Function('window', code)(global.window)
} catch (e) {
  console.error('模块加载就抛了：\n' + e.stack)
  process.exit(1)
}
if (!Comp) { console.error('没抓到组件（slots.register 没被调用？）'); process.exit(1) }

let tree
try {
  tree = Comp({})
} catch (e) {
  console.error('Panel() 渲染抛错：\n' + e.stack)
  process.exit(1)
}

let nodes = 0
const seen = new Set()
const bad = []
const walk = (n, trail) => {
  if (n === null || n === undefined || typeof n === 'boolean' || typeof n === 'string' || typeof n === 'number') return
  if (Array.isArray(n)) { n.forEach((c, i) => walk(c, trail + '[' + i + ']')); return }
  if (!n.$$el) { bad.push(trail + ' → 不是元素：' + typeof n); return }
  nodes += 1
  if (seen.has(n)) return
  seen.add(n)
  const kids = [...(n.children || [])]
  if (n.props && n.props.children !== undefined) kids.push(n.props.children)
  kids.forEach((c) => walk(c, trail + '>' + String(n.type)))
}
walk(tree, 'root')

if (bad.length) {
  console.error('发现非法节点：\n' + bad.join('\n'))
  process.exit(1)
}
console.log(`OK [${scene}] 元素节点 ${nodes} 个，无非法类型`)
