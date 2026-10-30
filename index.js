/**
 * 白鲸台 Host 半边 v0.4
 * 学习：A 关注动态 / B 公开合集 / C 手动话题；D 评论区回复学习
 * 推荐：按 @ 概率抽样决定这一条要不要 @ 主人号
 * 留言区：长期使用后沉淀的想法，等主人反馈
 * 桥：POST /whale-panel/api { action, ... }
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'

const API_PATH = '/whale-panel/api'
const EMPTY_LOGIN = { status: 'idle', qr: '', key: '', message: '' }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* 监测台：宿主内存里的事件流（不落盘，重启即清） */
const events = []
let eventSeq = 0
// 预算日志去重：反复点「确认」但换算结果没变时不再刷事件流
let lastBudgetLog = { tokens: -1, at: 0 }

/** 当前阶段：给监测台显示“它现在在干什么” */
const phase = { name: '空闲', detail: '', since: Date.now() }

function setPhase(name, detail) {
  phase.name = name
  phase.detail = detail || ''
  phase.since = Date.now()
}

function log(kind, text) {
  eventSeq += 1
  events.push({ seq: eventSeq, t: Date.now(), kind, text: String(text).slice(0, 300) })
  if (events.length > 240) events.splice(0, events.length - 240)
  return eventSeq
}

const DEFAULT_STATE = {
  platform: 'bilibili',
  accountUid: '',
  cookies: {},
  login: { ...EMPTY_LOGIN },
  masterUid: '',
  masterName: '',
  /** 昵称是照着哪个 UID 解析出来的（UID 一变就重解析） */
  masterNameUid: '',
  masterNameAt: '',
  /** 关注列表总结出来的「共有属性」（比 UP 主名高一层的兴趣信号） */
  followTraits: [],
  followTraitsAt: '',
  /** 看到哪儿了（判断「最后一条弹幕之后静默多久」要用；history.report 顺手记） */
  watchPosition: null,
  manualTopics: '',
  seedLinks: '',
  interest: [],
  learnedAt: '',
  learnedFrom: '',
  learnedSamples: 0,
  learnedSources: [],
  /** 评论区学习结果 */
  commentLearn: { at: '', count: 0, avgLen: 0, emojiRate: 0, phrases: [], samples: [] },
  dailyBudget: 2,
  perRunBudget: 0.2,
  /** 峰谷模式：谷时单价打折，同样的钱能跑更多内容 */
  peakValley: true,
  priceInput: 2,
  priceOutput: 8,
  offPeakDiscount: 0.5,
  /** 每条推荐折算的 token 消耗（估算值） */
  tokenPerItem: 1200,
  /** 每轮目标条数 */
  targetCount: 12,
  /** 「正在看」是何时换上的（看它在一部片子上停留多久） */
  currentSince: 0,
  /** 看过的 bvid（防重复，也方便回看它到底刷了什么） */
  watchedBvids: [],
  /** 插件自己看过的台账（带标题与时间，source 恒为 plugin）：本机说清"哪条是它看的" */
  watchLog: [],
  /** 没跑完时最多续接几次 */
  maxResume: 2,
  tokensUsedToday: 0,
  tokensUsedThisRun: 0,
  pending: null,
  commentMode: 'off',
  commentDailyCap: 3,
  commentedToday: 0,
  /** 待发草稿 */
  drafts: [],
  /** 发送记录 */
  commentLog: [],
  /** 发送失败的条目，单独归档，不留在草稿区 */
  failedComments: [],
  /** 因为属于「不评论领域」（政治/政府/前沿科学）而跳过的视频 */
  scopeSkipped: [],
  lastCommentAt: 0,
  /** 当前正在看的内容（null = 空闲） */
  current: null,
  /** 轮转游标：看完一个就换下一个 */
  cursor: 0,
  /** 看到内容时决定要不要评论的概率 */
  commentChance: 0.6,
  /** 有人回复我的评论时，去接这条回复的概率 */
  replyChance: 0.5,
  /** 已经接过的回复 rpid，避免重复 */
  repliedRpids: [],
  /** 自动巡航：定时自己跑一轮，不需要点按钮 */
  autoRun: false,
  /** 兼容旧字段（分钟），新逻辑用 cruiseGapSec */
  autoRunMinutes: 60,
  /** 连播间隔（秒）：一趟跑完隔这么久就自己开下一趟 */
  cruiseGapSec: 45,
  /** 下一趟预计开跑的时间戳 */
  nextRunAt: 0,
  /** 评论日上限用完的那一天（YYYY-MM-DD）：连播睡到次日 0 点，这个字段用来每天只记一条日志 */
  capBlockedDay: '',
  /** 正在跑的那一轮的开始时间戳（0 = 空闲），用于防止叠加与死锁回收 */
  runningSince: 0,
  lastAutoRunAt: 0,
  /** @ 主人号的概率（0-1） */
  mentionChance: 0.5,
  /** 没人在的时候也自己往下换片子（配合连播，形成一直刷） */
  autoWatch: true,
  /** 同一部片子上最多停留多少秒 */
  dwellSec: 300,
  /** 强制最短观看时长（秒）：评论发完也不许马上跳下一条；视频本身比它短就要求看完 */
  minWatchSec: 60,
  /** 没字幕没弹幕时抽帧给多模态模型看画面 */
  visionFallback: true,
  /** 一条视频最多抽几张画面快照（1–4，默认 1；每多一张就多花 token） */
  visionShots: 1,
  /** 发言号看的内容中，最多允许多少比例与主人兴趣无关（0-1，越小越专一） */
  offTopicShare: 0.3,
  /** 与主人兴趣的契合度达到这个值才 @ 主人（0-1） */
  mentionThreshold: 0.7,
  /** 每次运行自动去学的概率（0-1） */
  learnChance: 0.35,
  /** 只挑最近几天的视频（0 = 不限）；交给 B站 服务端筛，不然搜出来的全是老爆款 */
  daysBack: 7,
  /** 风格闸：发之前拦掉 AI 腔 / 鱼八股 */
  styleGate: true,
  /** 画像记忆半衰期（天）：越久没被重新提到的词权重越低 */
  decayDays: 7,
  /** 低于这个权重就从画像里删掉 */
  decayFloor: 1,
  /** 留言区 */
  notes: [],
  paused: false,
  spentToday: 0,
  runsToday: 0,
  day: '',
  lastRunAt: '',
  lastRun: [],
  mentionPlanned: 0,
}

const STOP = new Set(['视频', '官方', '合集', '第一', '最后', '我们', '这个', '那个', '一个', '什么', '怎么', '可以', '没有'])

const stateDir = () => path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'whale-panel')
const statePath = () => path.join(stateDir(), 'state.json')

function today() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function loadState() {
  // 只有"文件真不存在"才回落到默认值。
  // 文件存在但一时读不出来（正在被写）必须重试后报错，绝不能拿默认值把登录态和画像冲掉。
  for (let attempt = 0; attempt < 4; attempt += 1) {
    let raw
    try {
      raw = await fs.readFile(statePath(), 'utf8')
    } catch (error) {
      if (error?.code === 'ENOENT') return { ...DEFAULT_STATE, day: today() }
      await sleep(50)
      continue
    }
    try {
      const state = { ...DEFAULT_STATE, ...JSON.parse(raw) }
      if (state.day !== today()) {
        // ⚠️ 跨天必须把 token 也清零：以前漏了 tokensUsedToday，
        //    第二天一启动额度就被前一天用光了（预算怎么改都没反应，就是这个原因）。
        state.day = today()
        state.spentToday = 0
        state.runsToday = 0
        state.commentedToday = 0
        state.tokensUsedToday = 0
        state.tokensUsedThisRun = 0
        state.exhausted = false
        state.pending = null
      }
      return state
    } catch {
      await sleep(60 + attempt * 60)
    }
  }
  throw new Error('state.json 暂时读不出来（可能正在写入），过一下再试')
}

/** 备份上一版 state.json —— 每次进程启动后的第一次保存会留一份 .bak，出事故可回滚 */
let backupDone = false
async function backupOnce(file) {
  if (backupDone) return
  backupDone = true
  try {
    await fs.access(file)
    await fs.copyFile(file, `${file}.bak`)
  } catch {}
}

async function saveState(state, power = false) {
  await fs.mkdir(stateDir(), { recursive: true })
  const file = statePath()
  // 总开关是"粘性"的：除了 power / 显式改 paused 的那次 save，其它任何一次保存
  // 都不许把「用户已经关掉」这个事实写回去。
  // ⚠️ 真事故：连播那一拍在开关拨动**之前**就把 state 读进内存了，等它落盘时
  //    会把 paused 覆盖成旧值 —— 表现就是"我明明关了，它又自己开起来了"。
  if (!power) {
    const diskPaused = await readPausedFlag()
    if (diskPaused === true && !state.paused) {
      state.paused = true
      state.runningSince = 0
      state.nextRunAt = 0
    }
  }
  // 先写临时文件再原子替换：读的一方永远只会看到完整内容
  await backupOnce(file)
  const tmp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`
  await fs.writeFile(tmp, JSON.stringify(state, null, 2), { mode: 0o600 })
  try {
    await fs.rename(tmp, file)
  } catch (error) {
    // ⚠️ Windows 上如果目标文件此刻被别的句柄打开（杀软/另一个读），MoveFileEx 会失败，
    //    以前就这么把临时文件留在盘上 —— 实测攒了 66 个，每个都是**一份完整的明文 cookie**。
    //    失败就把这个临时文件删掉再重试一次，绝不留在盘上。
    try { await fs.unlink(tmp) } catch {}
    const tmp2 = `${file}.${process.pid}.${Date.now().toString(36)}b.tmp`
    await fs.writeFile(tmp2, JSON.stringify(state, null, 2), { mode: 0o600 })
    try {
      await fs.rename(tmp2, file)
    } catch (error2) {
      try { await fs.unlink(tmp2) } catch {}
      throw error2
    }
  }
  try { await fs.chmod(file, 0o600) } catch {}
}

/** 只读一下磁盘上的 paused，用来防"旧快照覆盖开关" */
async function readPausedFlag() {
  try {
    const j = JSON.parse(await fs.readFile(statePath(), 'utf8'))
    return j?.paused === true
  } catch { return null }
}

/** 清掉历史遗留的 state.json.<pid>.<ts>.tmp（启动时跑一次） */
async function cleanupStaleTmp() {
  try {
    const dir = stateDir()
    const names = await fs.readdir(dir)
    let n = 0
    for (const name of names) {
      if (!/^state\.json\..+\.tmp$/.test(name)) continue
      try { await fs.unlink(path.join(dir, name)); n += 1 } catch {}
    }
    if (n) console.warn(`[whale-panel] 清掉 ${n} 个遗留状态临时文件（每个都含明文 cookie）`)
  } catch {}
}

const logged = (c) => Boolean(c && c.SESSDATA)

/** 进程内的一次性运行锁：防止两个 run 并发抢同一个账号 */
const runLock = { busySince: 0 }

function publicView(state) {
  const { cookies, ...rest } = state
  return {
    ...rest,
    loggedIn: logged(cookies),
    quota: quotaView(state),
    // ⚠️ 不要把 cookies 带出去（含 SESSDATA/bili_jct，等于账号）；
    //    qr 是给前端画二维码用的，必须带；key 只在服务端用，不回传。
    login: {
      status: state.login?.status || 'idle', qr: state.login?.qr || '',
      message: state.login?.message || '',
    },
  }
}

async function readJsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 1024 * 1024) throw new Error('body too large')
    chunks.push(chunk)
  }
  if (!chunks.length) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function sendJson(res, status, payload) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(payload))
}

/** 只允许本机页面调用：挡住其它网站对 localhost 接口的跨站请求 */
function sameOrigin(req) {
  const origin = req.headers.origin || req.headers.referer
  if (!origin) return true
  try {
    const host = new URL(origin).hostname
    return host === '127.0.0.1' || host === 'localhost' || host === '::1'
  } catch {
    return false
  }
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

let anonCookie = ''
let anonAt = 0

async function anonCookies() {
  if (anonCookie && Date.now() - anonAt < 30 * 60 * 1000) return anonCookie
  try {
    const res = await fetch('https://api.bilibili.com/x/frontend/finger/spi', {
      headers: { 'user-agent': UA, referer: 'https://www.bilibili.com/' },
      signal: AbortSignal.timeout(12000),
    })
    const j = await res.json()
    if (j?.data?.b_3) {
      anonCookie = `buvid3=${j.data.b_3}; buvid4=${j.data.b_4 || ''}`
      anonAt = Date.now()
    }
  } catch {}
  return anonCookie
}

const MIXIN_TAB = [46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52]
let wbiKey = ''
let wbiAt = 0

async function mixinKey() {
  if (wbiKey && Date.now() - wbiAt < 6 * 60 * 60 * 1000) return wbiKey
  const j = await getJson('https://api.bilibili.com/x/web-interface/nav', {})
  const img = j?.data?.wbi_img?.img_url || ''
  const sub = j?.data?.wbi_img?.sub_url || ''
  const a = img.split('/').pop().split('.')[0]
  const b = sub.split('/').pop().split('.')[0]
  if (!a || !b) throw new Error('拿不到 WBI 密钥')
  wbiKey = MIXIN_TAB.map((i) => (a + b)[i]).join('').slice(0, 32)
  wbiAt = Date.now()
  return wbiKey
}

function signQuery(params, mk) {
  const p = { ...params, wts: Math.floor(Date.now() / 1000) }
  const q = Object.keys(p).sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(p[k]).replace(/[!'()*]/g, ''))}`)
    .join('&')
  return `${q}&w_rid=${crypto.createHash('md5').update(q + mk).digest('hex')}`
}

async function headersFor(cookies) {
  const headers = {
    'user-agent': UA, referer: 'https://www.bilibili.com/',
    accept: 'application/json, text/plain, */*', 'accept-language': 'zh-CN,zh;q=0.9',
  }
  const parts = []
  if (logged(cookies)) parts.push(Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; '))
  const anon = await anonCookies()
  if (anon) parts.push(anon)
  if (parts.length) headers.cookie = parts.join('; ')
  return headers
}

async function getJson(url, cookies, timeoutMs = 15000) {
  let res
  try {
    res = await fetch(url, { headers: await headersFor(cookies), signal: AbortSignal.timeout(timeoutMs) })
  } catch (error) {
    throw new Error(error?.name === 'TimeoutError' || error?.name === 'AbortError'
      ? 'B站 接口超时'
      : `网络错误：${error?.message || error}`)
  }
  const text = await res.text()
  if (text.trimStart().startsWith('<')) throw new Error('被 B站 风控拦了（HTML 拦截页），降频再试')
  try { return JSON.parse(text) } catch { throw new Error(`接口返回非 JSON（${res.status}）`) }
}

function tokenize(text) {
  const clean = String(text || '').replace(/[^\u4e00-\u9fa5A-Za-z0-9+#.]+/g, ' ')
  const out = []
  for (const part of clean.split(/\s+/)) {
    if (!part) continue
    if (/^[A-Za-z0-9+#.]{2,}$/.test(part)) { out.push(part.toLowerCase()); continue }
    const cjk = part.replace(/[^\u4e00-\u9fa5]/g, '')
    if (cjk.length >= 2 && cjk.length <= 6 && !STOP.has(cjk)) out.push(cjk)
  }
  return out
}

function buildProfile(samples, manual) {
  const weight = new Map()
  const bump = (k, w) => { if (k) weight.set(k, (weight.get(k) || 0) + w) }
  for (const t of manual) bump(t.trim(), 6)
  for (const s of samples) {
    for (const tag of s.tags || []) bump(tag.trim(), 3)
    for (const tok of tokenize(s.title)) bump(tok, 1)
  }
  return [...weight.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14)
    .map(([tag, w]) => ({ tag, weight: w }))
}

/* ---------------- 学习 ---------------- */

async function masterCard(uid, cookies) {
  const j = await getJson(`https://api.bilibili.com/x/web-interface/card?mid=${encodeURIComponent(uid)}`, cookies)
  if (j?.code !== 0) throw new Error(`读不到这个 UID：${j?.message || j?.code}`)
  return { name: j.data?.card?.name || '', sign: j.data?.card?.sign || '', followers: j.data?.follower }
}

async function masterUploads(uid, cookies) {
  const mk = await mixinKey()
  const q = signQuery({ mid: uid, ps: 30, pn: 1, order: 'pubdate', platform: 'web', web_location: 1550101 }, mk)
  const j = await getJson(`https://api.bilibili.com/x/space/wbi/arc/search?${q}`, cookies)
  if (j?.code === -799) throw new Error('投稿列表限频（-799），等几分钟')
  if (j?.code === -352) throw new Error('投稿列表触发风控（-352）')
  if (j?.code !== 0) throw new Error(`投稿列表失败：${j?.message || j?.code}`)
  return (j.data?.list?.vlist || []).map((v) => ({ bvid: v.bvid, title: v.title || '', tags: [] }))
}

async function masterFavorites(uid, cookies) {
  const folders = await getJson(`https://api.bilibili.com/x/v3/fav/folder/created/list?up_mid=${encodeURIComponent(uid)}`, cookies)
  if (folders?.code !== 0) throw new Error(`收藏夹不可读：${folders?.message || folders?.code}`)
  const list = folders?.data?.list || []
  if (!list.length) throw new Error('这个号没有公开收藏夹')
  const samples = []
  for (const folder of list.slice(0, 3)) {
    try {
      const res = await getJson(
        `https://api.bilibili.com/x/v3/fav/resource/list?media_id=${folder.id}&ps=20&pn=1&platform=web`, cookies)
      for (const it of res?.data?.medias || []) samples.push({ bvid: it.bvid, title: it.title || '', tags: [] })
    } catch {}
    await sleep(400)
  }
  return samples
}

async function samplesFromLinks(text, cookies) {
  const bvids = [...new Set((String(text || '').match(/BV[0-9A-Za-z]{10}/g) || []))]
  const out = []
  for (const bvid of bvids.slice(0, 20)) {
    try {
      const view = await getJson(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, cookies)
      if (view?.code === 0) out.push({ bvid, title: view.data?.title || '', tags: [] })
    } catch {}
    await sleep(300)
  }
  return out
}

async function samplesFromFollowingFeed(state, masterUid) {
  const j = await getJson(
    'https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/all?type=video&page=1&features=itemOpusStyle',
    state.cookies,
  )
  if (j?.code !== 0) throw new Error(`关注动态不可读：${j?.message || j?.code}（发言号没登录）`)
  const items = j?.data?.items || []
  if (!items.length) throw new Error('关注动态是空的')
  const out = []
  for (const it of items) {
    const author = it?.modules?.module_author || {}
    // 有主人号就只要主人号的；没有就用全部关注（那时它就是这个号的兴趣来源）
    if (masterUid && String(author.mid) !== String(masterUid)) continue
    const av = it?.modules?.module_dynamic?.major?.archive
    if (!av?.bvid) continue
    out.push({ bvid: av.bvid, title: av.title || '', tags: [], author: author.name || '' })
  }
  if (!out.length && masterUid) {
    // ⚠️ 主人号是普通用户、根本不发视频时这里会空 —— 这**不是错误**，
    //    让调用方继续走别的线（关注列表 / 收藏夹 / 手动话题），不要整条学习失败。
    return []
  }
  return out
}

/**
 * 主人号**关注了谁** —— 这是最省事也最准的偏好信号：
 * 他关注的都是他想看的 up 主，把这些 up 主的视频标题当样本，比猜关键词靠谱得多。
 * 老接口 `relation/followings` 免签名、实测能拿到。
 */
/* ---------------- 关注列表共性分析 ---------------- */

const TRAIT_SYSTEM = [
  '你在分析一个人关注的一批 B站 UP 主，目的是总结出这些 UP 主的**共同特点**，',
  '以便判断这个人喜欢什么样的内容。',
  '要求：',
  '1. 只看给定的名单和签名，不要臆测这个人的年龄性别身份；',
  '2. 输出 3–6 个「共同属性」，每个用短语，例如「游戏实况」「硬核评测」「二次元舞蹈」「搞笑整活」；',
  '3. 每个属性后面用括号标注依据的 UP 主数量，如「游戏实况(7)」；',
  '4. 只输出用顿号或换行分隔的属性列表，不要解释、不要开场白。',
  '5. 如果这批 UP 主实在没有共同点，只输出一行：无明显共性。',
].join('\n')

/**
 * 总结关注列表的「共有属性」——这是比"UP 主名字"更高一层的兴趣信号。
 * 拿每位 UP 的 名字 + 签名 + 分区 喂给模型，让它吐出共同标签；
 * 这些标签会以较高权重进画像，并且当关键词去搜索，比只搜 UP 主名有效得多。
 */
async function summarizeFollowingTraits(llm, route, ups) {
  if (!llm || !route?.provider || !route?.model) return []
  if (!ups.length) return []
  const lines = ups.slice(0, 30).map((u) => {
    const zone = u.tname || u.tag || ''
    return `- ${u.name}${zone ? `｜${zone}` : ''}${u.sign ? `｜${u.sign.slice(0, 40)}` : ''}`
  })
  const parts = []
  try {
    for await (const chunk of meteredStream(llm, {
      provider: route.provider,
      model: route.model,
      system: TRAIT_SYSTEM,
      messages: [{ role: 'user', content: [{ type: 'text', text: `关注的 UP 主名单：\n${lines.join('\n')}` }] }],
      maxTokens: 200,
      temperature: 0.5,
    })) {
      if (chunk?.type === 'text-delta') parts.push(chunk.text)
    }
  } catch {
    return []
  }
  const out = parts.join('').replace(/\s+/g, ' ').trim()
  if (!out || /无明显共性/.test(out)) return []
  // 拆成短语：换行 / 顿号 / 逗号 / 分号 / 编号都能切
  const traits = out
    .split(/[\n、，,；;]|^\s*\d+[.、)]\s*/gm)
    .map((s) => s.replace(/^[-•\d.\s)]+/, '').replace(/[（(]\s*\d+\s*[)）]$/, '').replace(/[。.]$/, '').trim())
    .filter((s) => s.length >= 2 && s.length <= 12)
  return [...new Set(traits)].slice(0, 6)
}

async function samplesFromMasterFollowings(state, masterUid) {
  const j = await getJson(
    `https://api.bilibili.com/x/relation/followings?vmid=${encodeURIComponent(masterUid)}&ps=30&pn=1`,
    state.cookies,
  )
  if (j?.code !== 0) throw new Error(`关注列表不可读：${j?.message || j?.code}`)
  const ups = (j?.data?.list || []).map((u) => ({
    mid: u.mid, name: u.uname, sign: u.sign || '', tname: u.official_verify?.desc || '',
  }))
  if (!ups.length) return []
  // 样本带 _ups，好让 learn() 顺手拿去总结「共有属性」
  const out = ups.map((u) => ({
    bvid: '', title: `${u.name} ${u.sign}`.trim(),
    // ⚠️ 不要把 UP 主名当 tag 进画像：名字会污染关键词表（出现过 "rrere'm热门" 这种东西）。
    // 只留签名——签名里写的才是"这个 UP 做什么内容"，让它进 tokenize 被正常切词。
    tags: [], author: u.name,
  }))
  out._ups = ups
  return out
}

async function fillTags(cookies, samples) {
  for (const s of samples.slice(0, 20)) {
    if (!s.bvid || (s.tags && s.tags.length)) continue
    try {
      const j = await getJson(`https://api.bilibili.com/x/tag/archive/tags?bvid=${encodeURIComponent(s.bvid)}`, cookies)
      s.tags = (j?.data || []).map((t) => t.tag_name).filter(Boolean).slice(0, 6)
    } catch {}
    await sleep(250)
  }
  return samples
}

/** 按半衰期给旧权重打折；掉到地板以下就丢弃 */
function decayProfile(list, now, halfLifeDays, floor) {
  const out = []
  for (const it of list || []) {
    if (!it || !it.tag) continue
    const last = it.lastSeen ? Date.parse(it.lastSeen) : now
    const days = Math.max(0, (now - (Number.isFinite(last) ? last : now)) / 86400000)
    const weight = Number(it.weight || 0) * Math.pow(0.5, days / halfLifeDays)
    if (weight >= floor) out.push({ tag: it.tag, weight, lastSeen: it.lastSeen })
  }
  return out
}

/** 新观察 + 衰减后的旧画像合并，以最新状态为主 */
function mergeProfile(oldList, freshList, now, halfLifeDays, floor) {
  const iso = new Date(now).toISOString()
  const map = new Map()
  for (const it of decayProfile(oldList, now, halfLifeDays, floor)) {
    map.set(it.tag, { ...it })
  }
  for (const it of freshList) {
    const tag = String(it.tag || '').trim()
    if (!tag) continue
    const cur = map.get(tag)
    if (cur) cur.weight += it.weight
    else map.set(tag, { tag, weight: it.weight, lastSeen: iso })
    map.get(tag).lastSeen = iso
  }
  return [...map.values()]
    .filter((it) => it.weight >= floor)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 14)
    .map((it) => ({ tag: it.tag, weight: Math.round(it.weight * 10) / 10, lastSeen: it.lastSeen }))
}

async function learn(state, llm, route) {
  const manual = (state.manualTopics || '').split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean)
  const uid = String(state.masterUid || '').trim()
  const sources = []
  let samples = []
  let lastFollowings = []
  const tasks = []

  if (logged(state.cookies)) {
    tasks.push(samplesFromFollowingFeed(state, uid)
      .then((l) => { if (l.length) sources.push(`关注动态 ${l.length} 条${uid ? '（主人号）' : ''}`); return l })
      .catch((e) => { sources.push(`关注动态失败：${e.message}`); return [] }))
  }
  if (uid) {
    tasks.push(masterUploads(uid, state.cookies)
      .then((l) => { if (l.length) sources.push(`投稿 ${l.length} 条`); return l })
      .catch((e) => { sources.push(`投稿失败：${e.message}`); return [] }))
    tasks.push(masterFavorites(uid, state.cookies)
      .then((l) => { if (l.length) sources.push(`收藏 ${l.length} 条`); return l })
      .catch((e) => { sources.push(`收藏失败：${e.message}`); return [] }))
    // 主人号关注了谁 —— 普通用户最靠谱的偏好来源（他不发视频也不一定建收藏夹）
    tasks.push(samplesFromMasterFollowings(state, uid)
      .then((l) => {
        if (l.length) sources.push(`主人号关注 ${l.length} 位 UP 主`)
        lastFollowings = l
        return l
      })
      .catch((e) => { sources.push(`关注列表失败：${e.message}`); return [] }))
  }
  if (state.seedLinks) {
    tasks.push(samplesFromLinks(state.seedLinks, state.cookies)
      .then((l) => { if (l.length) sources.push(`手动链接 ${l.length} 条`); return l })
      .catch(() => []))
  }

  for (const part of await Promise.all(tasks)) samples = samples.concat(part)
  if (manual.length) sources.push(`手动话题 ${manual.length} 个`)

  // 关注列表的「共有属性」：比 UP 主名字高一层的兴趣信号，交给模型总结
  let traits = []
  if (lastFollowings._ups?.length) {
    try {
      traits = await summarizeFollowingTraits(llm, route, lastFollowings._ups)
      if (traits.length) sources.push(`关注共性 ${traits.length} 个：${traits.slice(0, 4).join('、')}`)
    } catch (e) {
      sources.push(`关注共性失败：${e.message}`)
    }
  }
  state.followTraits = traits
  state.followTraitsAt = traits.length ? new Date().toISOString() : ''

  if (!samples.length && !manual.length && !traits.length) {
    throw new Error('四条线都没料：① 发言号登录且已关注主人号 ② 填主人号 UID ③ 手动话题')
  }

  await fillTags(state.cookies, samples)
  // 共性属性以较高权重进画像（每个 4 分，高于普通标题词 1 分，低于手动话题 6 分）
  const traitSamples = traits.map((t) => ({ bvid: '', title: '', tags: [t] }))
  const fresh = buildProfile(samples.concat(traitSamples), manual)
    // 过滤噪音：UP 主名字不是"兴趣词"，进了画像只会污染搜索
    .filter((x) => {
      const t = String(x.tag || '')
      if (!t || t.length < 2) return false
      if (/['"`]/.test(t)) return false
      if (/^(热门|视频|官方|合集|直播)$/.test(t)) return false
      // 已经是关注列表里的某个 UP 主名 → 不是内容标签，丢掉
      if ((lastFollowings._ups || []).some((u) => u.name === t)) return false
      return true
    })
  if (!fresh.length && !(state.interest || []).length) {
    throw new Error('抓到了内容但没提炼出兴趣词')
  }

  const now = Date.now()
  const halfLife = Math.max(0.5, Number(state.decayDays ?? 7))
  const floor = Math.max(0.1, Number(state.decayFloor ?? 1))
  const beforeTags = new Set((state.interest || []).map((i) => i.tag))
  state.interest = mergeProfile(state.interest, fresh, now, halfLife, floor)
    // 合并时也要过一遍噪音过滤：老画像里可能存着以前的 UP 主名
    .filter((x) => !(lastFollowings._ups || []).some((u) => u.name === x.tag))
    .filter((x) => !/['"`]/.test(String(x.tag || '')))
  const afterTags = new Set(state.interest.map((i) => i.tag))
  const faded = [...beforeTags].filter((t) => !afterTags.has(t)).length

  state.learnedAt = new Date(now).toISOString()
  state.learnedFrom = uid ? `UID ${uid}` : (logged(state.cookies) ? '关注动态' : '手动')
  state.learnedSamples = samples.length
  state.learnedSources = sources
  const fadedTotal = faded
  return {
    profile: state.interest, sources, samples: samples.length,
    fresh: fresh.length, faded: fadedTotal,
  }
}

/* ---------------- 评论区学习 ---------------- */

const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u

async function learnComments(state) {
  const vids = (state.lastRun || []).slice(0, 2)
  if (!vids.length) throw new Error('先跑一轮选片，才有评论区可学')

  const samples = []
  for (const v of vids) {
    try {
      const view = await getJson(`https://api.bilibili.com/x/web-interface/view?bvid=${v.bvid}`, state.cookies)
      if (view?.code !== 0) continue
      const aid = view.data?.aid
      const rep = await getJson(
        `https://api.bilibili.com/x/v2/reply?type=1&oid=${aid}&pn=1&ps=20&sort=2`, state.cookies)
      for (const r of rep?.data?.replies || []) {
        const text = r?.content?.message || ''
        if (!text) continue
        samples.push({ text, like: r.like || 0, author: r?.member?.uname || '', bvid: v.bvid })
      }
    } catch {}
    await sleep(500)
  }
  if (!samples.length) throw new Error('没读到评论（可能被风控，或该视频无评论）')

  const total = samples.length
  const avgLen = Math.round(samples.reduce((a, s) => a + s.text.length, 0) / total)
  const emojiCount = samples.filter((s) => EMOJI_RE.test(s.text)).length
  const freq = new Map()
  for (const s of samples) for (const t of tokenize(s.text)) freq.set(t, (freq.get(t) || 0) + 1)
  const phrases = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([tag, n]) => ({ tag, n }))

  state.commentLearn = {
    at: new Date().toISOString(),
    count: total,
    avgLen,
    emojiRate: Number((emojiCount / total).toFixed(2)),
    phrases,
    samples: samples.slice(0, 12).map((s) => ({ text: s.text.slice(0, 120), like: s.like, author: s.author })),
  }
  return state.commentLearn
}

/* ---------------- 登录 ---------------- */

async function qrGenerate(state) {
  const j = await getJson('https://passport.bilibili.com/x/passport-login/web/qrcode/generate', {})
  if (j?.code !== 0) throw new Error(`二维码生成失败：${j?.message}`)
  state.login = { status: 'waiting', key: j.data.qrcode_key, qr: j.data.url, message: '用发言号扫码' }
  return { qr: state.login.qr, key: state.login.key }
}

async function qrPoll(state) {
  if (!state.login?.key) return { status: 'idle' }
  const res = await fetch(
    `https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key=${encodeURIComponent(state.login.key)}`,
    { headers: await headersFor({}), signal: AbortSignal.timeout(12000) },
  )
  const j = await res.json()
  const code = j?.data?.code
  if (code === 0) {
    const cookies = {}
    const url = j.data.url || ''
    const q = url.includes('?') ? url.slice(url.indexOf('?') + 1) : ''
    for (const pair of q.split('&')) {
      const [k, v] = pair.split('=')
      // 注意：cookie 值必须保持 URL 编码原样（SESSDATA 里的 %2C 是它的一部分），
      // 解码会让登录态与 csrf 对不上，B站 返回 -111。
      if (k && v) cookies[k] = v
    }
    for (const line of res.headers.getSetCookie?.() || []) {
      const [pair] = line.split(';')
      const idx = pair.indexOf('=')
      if (idx > 0) {
        const k = pair.slice(0, idx).trim()
        const v = pair.slice(idx + 1).trim()
        if (k && !(k in cookies)) cookies[k] = v
      }
    }
    state.cookies = { ...state.cookies, ...cookies }
    if (cookies.DedeUserID) state.accountUid = cookies.DedeUserID
    state.login = { status: 'ok', message: '登录成功', qr: '', key: '' }
    return { status: 'ok', accountUid: state.accountUid }
  }
  if (code === 86101) { state.login.message = '已扫码，等手机确认'; return { status: 'waiting', message: state.login.message } }
  if (code === 86090) { state.login.message = '二维码未扫描'; return { status: 'waiting', message: state.login.message } }
  if (code === 86038) { state.login = { status: 'expired', message: '二维码过期', qr: '', key: '' }; return { status: 'expired' } }
  state.login.message = j?.message || `状态码 ${code}`
  return { status: 'waiting', message: state.login.message }
}

/* ---------------- 选片 ---------------- */

function mentionRoll(state) {
  const chance = Math.min(1, Math.max(0, Number(state.mentionChance ?? 0.5)))
  return Math.random() < chance
}

/** 近 N 天的时间窗（秒）。交给 B站 服务端筛，不是拉下来再本地砍 —— 本地砍完常常一条不剩 */
function recentWindow(days) {
  const d = Math.max(0, Number(days ?? 7))
  if (!d) return null
  const now = Math.floor(Date.now() / 1000)
  return { start: now - d * 86400, end: now }
}

/** 每个来源最多取多少条候选（扩大浏览池用） */
const POOL_PER_SOURCE = 40

async function pickVideos(state, limit = 20) {
  const queries = (state.interest || []).slice(0, 6).map((x) => x.tag)
  const win = recentWindow(state.daysBack ?? 7)
  const items = []
  const push = (v, source) => {
    if (!v?.bvid) return
    if (items.some((x) => x.bvid === v.bvid)) return
    items.push({
      bvid: v.bvid,
      title: String(v.title || '').replace(/<[^>]+>/g, ''),
      author: v.author || v.owner?.name || '',
      url: `https://www.bilibili.com/video/${v.bvid}`,
      play: v.play || v.stat?.view,
      source,
    })
  }

  // ── 来源①：热门榜，翻 5 页（每页 20）= 100 条底池
  for (const pn of [1, 2, 3, 4, 5]) {
    try {
      const pj = await getJson(
        `https://api.bilibili.com/x/web-interface/popular?ps=20&pn=${pn}`, state.cookies)
      for (const v of pj?.data?.list || []) push(v, '热门')
    } catch {}
    await sleep(250)
  }

  // ── 来源②：分区排行榜（动画/游戏/知识/科技/生活/音乐/舞蹈/影视/鬼畜）
  const zones = [
    [1, '动画'], [4, '游戏'], [36, '知识'], [188, '科技'],
    [160, '生活'], [3, '音乐'], [129, '舞蹈'], [181, '影视'], [119, '鬼畜'],
  ]
  for (const [rid, name] of zones) {
    try {
      const zj = await getJson(
        `https://api.bilibili.com/x/web-interface/ranking/v2?rid=${rid}&type=all`, state.cookies)
      for (const v of (zj?.data?.list || []).slice(0, 10)) push(v, `排行:${name}`)
    } catch {}
    await sleep(200)
  }

  // ── 来源③：关键词搜索，每个词翻 2 页
  for (const word of queries) {
    for (const page of ['1', '2']) {
      try {
        // order=pubdate 按最新 + time_start/time_end 交给服务端筛时间窗
        const qs = new URLSearchParams({
          search_type: 'video', keyword: word, page,
          order: win ? 'pubdate' : 'totalrank',
        })
        if (win) { qs.set('time_start', String(win.start)); qs.set('time_end', String(win.end)) }
        const j = await getJson(
          `https://api.bilibili.com/x/web-interface/search/type?${qs.toString()}`,
          state.cookies)
        for (const v of (j?.data?.result || []).slice(0, 12)) push(v, `兴趣:${word}`)
      } catch {}
      await sleep(300)
    }
  }

  // 选片配额：发言号可以看点无关内容，但要有上限（offTopicShare）。
  // 与主人兴趣沾边的优先；无关的只在配额内放行，超了就丢——
  // 这样它不会变成「只刷同一种东西」，也不会飘成「见啥看啥」。
  const share = Math.min(1, Math.max(0, Number(state.offTopicShare ?? 0.3)))
  const maxOff = Math.floor(limit * share)
  // 已经看过的不再进队。**不拿旧条目凑数**——以前这里有个"队列不够就把旧的补回去"的
  // 回退，结果补进来的全被 nextUnwatched 过滤掉，队列看起来永远空、current 永远是 null。
  const seen = new Set([
    ...(state.watchedBvids || []),
    ...(state.commentLog || []).map((x) => x.bvid).filter(Boolean),
  ])
  const pool = items.filter((x) => !seen.has(x.bvid))
  const onTopic = []
  const offTopic = []
  for (const it of pool) {
    const isInterest = String(it.source).startsWith('兴趣')
    const fit = fitScore(state, { title: it.title, desc: '' }, null)
    // 没画像时 fitScore 返回 null：那条路径按"老逻辑"当作可能相关
    const related = fit ? fit.score >= Number(state.mentionThreshold ?? 0.7) * 0.7 : isInterest
    ;(related ? onTopic : offTopic).push(it)
  }
  // 两个桶各自打乱：不然每轮顺序都一样，永远先从同一批开始
  const shuffle = (arr) => {
    const a = arr.slice()
    for (let i = a.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[a[i], a[j]] = [a[j], a[i]]
    }
    return a
  }
  // 相关的那桶按契合度降序再打乱（高分优先，但同档内随机），避免天天同几条
  const scored = onTopic.map((it) => {
    const f = fitScore(state, { title: it.title, desc: '' }, null)
    return { it, s: f ? f.score : 0.5 }
  }).sort((a, b) => b.s - a.s).map((x) => x.it)
  const head = shuffle(scored.slice(0, Math.max(limit, 20)))
  const picked = head.concat(shuffle(offTopic.slice(0, maxOff)))

  // @ 计划：只对"兴趣"来源的条目掷骰子（真正要不要 @ 由 decideMention 再按契合度把关）
  let planned = 0
  // 最后再过一遍去重：前面的 seen 是选片开始时的快照，
  // 但热门榜翻 5 页 + 9 个分区榜 + 搜索会拿到大量条目，
  // 期间别的流程可能已经把某条写进 watchedBvids，这里用最新值兜一次。
  const seenNow = new Set([
    ...(state.watchedBvids || []),
    ...(state.commentLog || []).map((x) => x.bvid).filter(Boolean),
  ])
  const finalPicked = picked.filter((it) => !seenNow.has(it.bvid))
  const out = finalPicked.slice(0, limit).map((it) => {
    const isInterest = String(it.source).startsWith('兴趣')
    const mention = isInterest && mentionRoll(state)
    if (mention) planned += 1
    return { ...it, mention }
  })
  return { items: out, queries, planned, poolSize: pool.length }
}

/**
 * 评论区额度：日上限用完了就别再空转。
 * ⚠️ 以前只拦「发评论」这一步，连播照样一轮轮选片换片 —— 实测一天空转 119 轮，
 *    每轮都白向 B站 发请求，用户看到的就是「它一直卡着不动 / 白跑」。
 * 现在提到 run 的入口拦：额度满了整轮不开，连播直接睡到第二天 00:00。
 */
function commentQuota(state) {
  const cap = Math.max(0, Number(state.commentDailyCap ?? 0))
  const used = Math.max(0, Number(state.commentedToday || 0))
  const enabled = Boolean(state.commentMode && state.commentMode !== 'off')
  return { cap, used, left: Math.max(0, cap - used), enabled, reached: enabled && used >= cap }
}

/** 下一个北京时间 0 点的时间戳（跨天重置就发生在这之后） */
function nextBeijingMidnight() {
  const bj = new Date(Date.now() + 8 * 3600 * 1000)
  const nextBj = Date.UTC(
    bj.getUTCFullYear(), bj.getUTCMonth(), bj.getUTCDate() + 1, 0, 0, 30, 0,
  )
  return nextBj - 8 * 3600 * 1000
}

function guardBudget(state) {
  if (state.paused) return '已暂停'
  if (state.commentMode && state.commentMode !== 'off' && !logged(state.cookies)) {
    return '还没登录 B站：去「学习」页扫码'
  }
  const cq = commentQuota(state)
  if (cq.reached) {
    return `评论额度用完（今日已发 ${cq.used} / 上限 ${cq.cap} 条）：明天 00:00 自动继续`
  }
  const q = quotaView(state)
  // 预算为 0 = 用户主动关掉（不是"用完"），提示要说清楚，别让人以为改预算没用
  if (!(q.dailyTokens > 0)) {
    return '日预算为 0：在「运行」页把日上限调大才会跑'
  }
  // 真实计量后，剩余额度只要 > 0 就还能跑一点，不必硬卡"够不够一条"
  if (q.remainingTokens <= 0) {
    return `今日额度用完（已用 ${q.used} / 日额度 ${q.dailyTokens} tokens）`
  }
  return null
}

/* ---------------- 评论：草稿与发送 ---------------- */

const DRAFT_TPL = [
  (core) => `刷到${core}相关的内容就停下来了，讲得挺清楚`,
  (core) => `这个选题我喜欢，${core}确实值得聊聊`,
  (core) => `${core}这块讲得挺实在，先收藏了`,
  (core) => `正好在找${core}相关的东西，来得刚好`,
]

function makeDraftId() {
  return `c${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`
}

function buildDraftText(state, video) {
  const tags = (state.interest || []).map((i) => i.tag)
  const core = tags[0] || '这个'
  const tpl = DRAFT_TPL[Math.floor(Math.random() * DRAFT_TPL.length)]
  let text = tpl(core)
  const avg = Number(state.commentLearn?.avgLen || 0)
  if (avg > 30 && tags[1]) text += `，${tags[1]}也能顺带看看`
  return text.slice(0, 90)
}

/* ---------------- 不评论的领域：政治 / 政府 / 前沿科学 ---------------- */

/**
 * 本地硬规则：评论里**一概不评价**这三类话题。
 * 理由不是「模型说了算」——这几类一旦说错，代价不可逆，
 * 所以先用词表兜一遍（不花 token、不受模型心情影响），再过模型自检。
 */
const NO_COMMENT_RULES = [
  {
    name: '政治敏感',
    words: [
      '政治', '党政', '执政', '政权', '体制', '意识形态', '专制', '民主', '独裁', '自由世界',
      '国家机器', '维稳', '上访', '异见', '敏感词', '封杀', '审查', '墙外', '翻墙',
      '钦点', '上面有人', '高层', '内斗', '派系',
    ],
  },
  {
    name: '政府话题',
    words: [
      '政府', '官方回应', '国务院', '人大', '政协', '两会', '政策', '文件出台', '监管',
      '部委', '地方政府', '公务', '官员', '信访', '外交', '涉台', '涉外', '两会代表',
    ],
  },
  {
    name: '前沿科学',
    words: [
      '量子计算', '量子纠缠', '可控核聚变', '核聚变', '基因编辑', 'CRISPR', '端到端构型',
      '大模型', '通用人工智能', 'AGI', '脑机接口', '室温超导', '超导', '纳米材料',
      '合成生物', 'mRNA疫苗', '论文造假', '同行评议', '科学结论', '科研伦理',
    ],
  },
]

/**
 * 判断一条文本碰没碰这三类话题。
 * 返回 { blocked: boolean, field: string, hit: string }
 */
function noCommentScope(text) {
  const t = String(text || '')
  if (!t) return { blocked: false, field: '', hit: '' }
  for (const rule of NO_COMMENT_RULES) {
    const hit = rule.words.find((w) => t.includes(w))
    if (hit) return { blocked: true, field: rule.name, hit }
  }
  return { blocked: false, field: '', hit: '' }
}

/** 标题/简介命中这三类，就别在这个视频下面说话 */
function videoOutOfScope(video, digest) {
  const bag = [video?.title, video?.desc, digest?.subtitle, digest?.vision].filter(Boolean).join(' ')
  return noCommentScope(bag)
}

const CHECK_SYSTEM = [
  '你是内容合规检查员。判断一条准备发到 B站 的评论是否可以发布。',
  '不可发布的情形：广告引流、辱骂攻击、引战、涉黄、泄露隐私、与视频完全无关的刷屏内容。',
  '**另外这三种领域一律不许出现评价性内容，出现就 FAIL**：',
  '① 政治敏感话题；② 政府/政策/官方表态；③ 前沿科学领域的研究结论（量子、核聚变、基因编辑、大模型、AGI 等）。',
  '这几类只需描述事实都不行 —— 要评价就是 FAIL。',
  '只输出一行：PASS 或 FAIL，若 FAIL 再跟一个冒号和简短原因。不要解释，不要多余的话。',
].join('\n')

/** 合规自检：模型不可用时不拦截（返回 ok） */
async function selfCheck(llm, route, text, video) {
  if (!llm || !route?.provider || !route?.model) return { ok: true, reason: '' }
  const parts = []
  try {
    for await (const chunk of meteredStream(llm, {
      provider: route.provider,
      model: route.model,
      system: CHECK_SYSTEM,
      messages: [{
        role: 'user',
        content: [{ type: 'text', text: `视频标题：${video.title}\n待发布评论：${text}` }],
      }],
      maxTokens: 60,
      temperature: 0,
    })) {
      if (chunk?.type === 'text-delta') parts.push(chunk.text)
    }
  } catch {
    return { ok: true, reason: '' }
  }
  const out = parts.join('').trim()
  if (/^PASS/i.test(out)) return { ok: true, reason: '' }
  const reason = out.replace(/^FAIL[:：]?\s*/i, '').slice(0, 60)
  return { ok: false, reason: reason || '未通过自检' }
}

/* ---------------- 风格闸：拦掉一看就不是真人写的 AI 腔 ---------------- */

/** 套话开头：真人很少这么起句 */
const AI_OPENERS = [
  '这条我认', '不得不说', '说实话', '讲真', '作为一个', '在我看来',
  '首先', '总而言之', '总的来说', '综上所述', '简单来说', '值得一提的是',
]
/** 总结升华式收尾 */
const AI_CLOSERS = [
  /(值得|需要)(我们)?(每个人|每个人去|大家)?(思考|反思|深思)$/,
  /(这|它)?(不仅|不止)是.{0,12}(更|而是)/,
  /(让人|令人)(深思|回味|感慨)的?$/,
  /(期待|希望)(作者|up主|UP主)?(后续|更多)(的)?(作品|内容)?[！!。]?$/,
]
/** 面面俱到的 AI 指纹：工整排比、爱总结、爱升华 */
const AI_MARKERS = [
  '总而言之', '综上所述', '总的来说', '值得注意的是', '不仅能', '更像是一种',
  '从某种意义上', '在某种程度上', '这不仅', '某种程度上',
]
/** 署名式结尾 */
const AI_SIGNOFF = /(——|--|-)\s*[^—\n]{0,12}$/

/** 工整但空洞的词：一条评论里出现两个以上，基本就是在写作文 */
const AI_WORDS = ['不仅', '更是', '而是', '值得', '体现了', '展现了', '传达', '态度', '意义', '内涵', '共鸣', '心灵', '灵魂']
/** 句尾：判排比时要知道"有效句"到哪结束 */
const TAIL = /[！!？?。.~～]*$/

/**
 * 本地规则闸：不花 token，先把明显的 AI 腔筛出来。
 * 返回 { bad: boolean, reason: string }；reason 会原样交回给模型让它照着改。
 */
/* ---------------- 真实 token 计量 ---------------- */

/**
 * 这一轮真实花掉的 token。以前是「选中几条 × 1200」估的，跟实际差很远
 * （连播跑 98 轮、每轮都记一笔，额度就莫名烧光了）。
 * `llm.stream` 会发 `{ type: 'usage', usage: { inputTokens, outputTokens } }`，
 * 每次调用都丢进来累加，账就对得上。
 */
const tokenMeter = {
  run: { input: 0, output: 0, calls: 0 },
  reset() { this.run = { input: 0, output: 0, calls: 0 } },
  add(usage) {
    if (!usage) return
    this.run.input += Number(usage.inputTokens || 0)
    this.run.output += Number(usage.outputTokens || 0)
    this.run.calls += 1
  },
  total() { return this.run.input + this.run.output },
  snapshot() { return { ...this.run, total: this.total() } },
}

/** 包一层：把一次模型调用真实消耗记进 tokenMeter */
async function* meteredStream(llm, options) {
  let reported = false
  for await (const chunk of llm.stream(options)) {
    if (chunk?.type === 'usage') {
      tokenMeter.add(chunk.usage)
      reported = true
    }
    yield chunk
  }
  // 有些适配器不发 usage：按字符数粗估（中文字符约 1 token），至少不是一条 1200 的死数
  if (!reported) {
    const inChars = JSON.stringify(options.messages || []).length + String(options.system || '').length
    tokenMeter.add({ inputTokens: Math.ceil(inChars / 2), outputTokens: 0 })
  }
}

function styleCheck(text) {
  const t = String(text || '').trim()
  if (!t) return { bad: true, reason: '空内容' }
  const bare = t.replace(/\[[^\]]*\]/g, '').replace(TAIL, '').trim()
  const open = AI_OPENERS.find((w) => t.startsWith(w))
  if (open) return { bad: true, reason: `开头「${open}」是套话，直接说这条视频里的具体东西` }
  const closer = AI_CLOSERS.find((re) => re.test(bare.replace(/\s+/g, '')))
  if (closer) return { bad: true, reason: '结尾在总结升华，真人不会这么收尾' }
  const marker = AI_MARKERS.find((w) => t.includes(w))
  if (marker) return { bad: true, reason: `「${marker}」像在写作文，换成口语` }
  const hits = AI_WORDS.filter((w) => bare.includes(w))
  if (hits.length >= 2) {
    return { bad: true, reason: `「${hits.slice(0, 3).join('、')}」堆在一起太像作文，只说一件具体的事` }
  }
  // 排比：短句为主、整段一口气四个以上分句（真人不会这么工整）
  const clauses = t.split(/[，,。.！!？?、；;：:]/).map((x) => x.trim()).filter((x) => x.length > 1)
  if (clauses.length >= 4) {
    const lens = clauses.map((c) => c.replace(/\[[^\]]*\]/g, '').length)
    const avg = lens.reduce((a, b) => a + b, 0) / lens.length
    const even = lens.every((n) => Math.abs(n - avg) <= 6)
    if (even && avg >= 5) return { bad: true, reason: '四个分句一样长，像排比；砍成两句，只留最有劲的那句' }
  }
  if (AI_SIGNOFF.test(bare) && bare.length > 18) {
    return { bad: true, reason: '结尾像在署名，去掉那个破折号尾巴' }
  }
  if (/[\u4e00-\u9fa5]/.test(t) && t.length > 60) {
    return { bad: true, reason: '太长了，真人评论一般一两句话' }
  }
  return { bad: false, reason: '' }
}

const REWRITE_SYSTEM = [
  '你在改写一条要在 B站 发的评论，让它更像真人随手打的。',
  '硬性要求：',
  '1. 只输出改写后的评论正文，不要解释、不要引号、不要 @、不要链接。',
  '2. 12–45 个汉字，一到两句，不要排比，不要总结升华，不要署名。',
  '3. 别用「不得不说/说实话/总而言之/不仅…更是…」这类套话。',
  '4. 必须提到那条视频里的具体东西（人、情节、梗、槽点），不能空泛。',
  '5. 保留原评论的核心意思，只换说法。',
].join('\n')

/** 让模型按闸门给的理由改写一次；失败返回 null */
async function rewriteByStyle(llm, route, text, reason, digest) {
  if (!llm || !route?.provider || !route?.model) return null
  const hints = []
  if (digest?.subtitle) hints.push(`视频里说的：${digest.subtitle.slice(0, 300)}`)
  else if (digest?.danmaku?.length) hints.push(`弹幕里在聊：${digest.danmaku.slice(0, 10).map((d) => d.text).join('、')}`)
  const parts = []
  try {
    for await (const chunk of meteredStream(llm, {
      provider: route.provider,
      model: route.model,
      system: REWRITE_SYSTEM,
      messages: [{
        role: 'user',
        content: [{
          type: 'text',
          text: [
            `被拦的原因：${reason}`,
            `原评论：${text}`,
            ...hints,
          ].join('\n'),
        }],
      }],
      maxTokens: 160,
      temperature: 1,
    })) {
      if (chunk?.type === 'text-delta') parts.push(chunk.text)
    }
  } catch {
    return null
  }
  const out = parts.join('').replace(/^["“'']|["”'']$/g, '').replace(/\s+/g, ' ').trim()
  return out ? out.slice(0, 90) : null
}

/**
 * 过闸：本地规则 → 命中就让模型改一次 → 再验一次。
 * 改完还不过就不发（宁可这轮不发，也不发一句 AI 腔）。
 */
async function passStyleGate(llm, route, text, digest) {
  const first = styleCheck(text)
  if (!first.bad) return { ok: true, text, rewrote: false }
  const fixed = await rewriteByStyle(llm, route, text, first.reason, digest)
  if (!fixed) return { ok: false, reason: first.reason, text }
  const second = styleCheck(fixed)
  if (second.bad) return { ok: false, reason: second.reason, text: fixed }
  return { ok: true, text: fixed, rewrote: true }
}

/**
 * 评论发出后复核「别人到底看不看得见」——参考 c1overzz/dsh-bili-scroll 的做法：
 * 接口回 code 0 只代表 B站 收下了，新号/敏感内容会被折叠或送审，而**不公开时连通知都不会推**。
 * 复核用只读接口：顶层评论拉「按时间第一页」，楼中楼按 root 拉那一串。
 * ⚠️ 看不到 ≠ 没发出去（翻页/热度排序都会漏），所以结论只说「没查到」。
 */
async function verifyVisibility(state, entry) {
  if (!entry?.aid || !entry?.rpid) return
  try {
    let hit = null
    if (!entry.root) {
      const j = await getJson(
        `https://api.bilibili.com/x/v2/reply/main?type=1&oid=${entry.aid}&mode=2&next=0&ps=20`,
        state.cookies,
      )
      hit = (j?.data?.replies || []).find((r) => Number(r.rpid) === Number(entry.rpid)) || null
    } else {
      const j = await getJson(
        `https://api.bilibili.com/x/v2/reply/reply?type=1&oid=${entry.aid}&root=${entry.root}&ps=20&pn=1`,
        state.cookies,
      )
      hit = (j?.data?.replies || []).find((r) => Number(r.rpid) === Number(entry.rpid)) || null
    }
    const rec = (state.commentLog || []).find((x) => Number(x.rpid) === Number(entry.rpid))
    if (!rec) return
    if (hit) {
      rec.visible = hit.invisible ? 'hidden' : 'public'
      rec.likes = Number(hit.like || 0)
      log(rec.visible === 'public' ? 'ok' : 'warn',
        rec.visible === 'public' ? `复核：这条公开可见（${rec.likes} 赞）` : '复核：接口标成不可见，可能被折叠了')
    } else {
      rec.visible = 'unknown'
      log('info', '复核：最新一页没查到，可能还在审核（不代表没发出去）')
    }
    rec.checkedAt = new Date().toISOString()
  } catch (error) {
    log('info', `复核没做成：${error?.message || error}`)
  }
}

/** 统一的发送入口：闸门 + 发送 + 记账 */
async function deliverComment(state, draft) {
  if (state.commentMode === 'off') return { ok: false, error: '评论区开关是关的，先打开' }
  const cap = Number(state.commentDailyCap ?? 3)
  if (Number(state.commentedToday || 0) >= cap) {
    return { ok: false, error: `今日已达上限 ${cap} 条` }
  }
  const gap = Date.now() - Number(state.lastCommentAt || 0)
  if (gap < 8000) {
    return { ok: false, error: `太频繁，等 ${Math.ceil((8000 - gap) / 1000)} 秒` }
  }
  // 去掉 @ 之后没实际内容的，绝不发出去（曾经发过一条只有 "@昵称 " 的）
  const visible = String(draft.text || '').replace(/^@\S+\s*/, '').replace(/\[[^\]]*\]/g, '').trim()
  if (visible.length < 5) {
    return { ok: false, error: '内容太短，不发了' }
  }
  try {
    const sent = await postComment(state, {
      aid: draft.aid, bvid: draft.bvid, message: draft.text,
      root: draft.root, parent: draft.parent,
    })
    state.commentedToday = Number(state.commentedToday || 0) + 1
    state.lastCommentAt = Date.now()
    state.drafts = (state.drafts || []).filter((x) => x.id !== draft.id)
    state.commentLog = [{
      at: new Date().toISOString(), bvid: draft.bvid, aid: draft.aid,
      rpid: sent.rpid || 0, text: draft.text, title: draft.title || '',
      kind: draft.root ? 'reply' : 'comment',
    }, ...(state.commentLog || [])].slice(0, 30)
    log('ok', `已发评论：${draft.text.slice(0, 24)}…（rpid ${sent.rpid || '?'}）`)

    // 单独那条 @ 提醒：只表达“想让你看看”，与正文完全分开
    const atName = String(draft.atName || '')
    if (atName && Number(state.commentedToday || 0) < cap) {
      await sleep(10000)
      const mt = mentionText(atName)
      try {
        const extra = await postComment(state, {
          aid: draft.aid, bvid: draft.bvid, message: mt, atName,
        })
        state.commentedToday = Number(state.commentedToday || 0) + 1
        state.lastCommentAt = Date.now()
        state.commentLog = [{
          at: new Date().toISOString(), bvid: draft.bvid, aid: draft.aid,
          rpid: extra.rpid || 0, text: mt, title: draft.title || '', kind: 'mention',
        }, ...(state.commentLog || [])].slice(0, 30)
        log('ok', `已单独 @ 提醒：${mt}（rpid ${extra.rpid || '?'}）`)
      } catch (error) {
        log('warn', `@ 提醒没发出去：${error?.message || error}`)
      }
    }
    // 发完 2 分钟回来核对：别人到底看不看得见
    if (sent.rpid) {
      const checking = {
        aid: draft.aid, rpid: Number(sent.rpid),
        root: draft.root ? Number(draft.root) : 0,
      }
      sleep(120_000)
        .then(() => verifyVisibility(state, checking))
        .then(() => saveState(state))
        .catch(() => {})
    }
    return { ok: true, rpid: sent.rpid || 0 }
  } catch (error) {
    log('err', `发送失败：${error?.message || error}`)
    return { ok: false, error: String(error?.message || error) }
  }
}

/** 把「正在看」换成某条内容（统一入口，保证 currentSince / watchedBvids 都被记上） */
function switchTo(state, it) {
  state.current = {
    bvid: it.bvid,
    title: it.title || '',
    author: it.author || '',
    source: it.source || '',
    at: new Date().toISOString(),
  }
  state.currentSince = Date.now()
  state.watchedBvids = [it.bvid, ...(state.watchedBvids || []).filter((b) => b !== it.bvid)].slice(0, 500)
  // 本地台账：插件自己看的每一条都打上 source=plugin。
  // ⚠️ B站 那边的观看历史改不了（记录是人家服务端的），所以「哪条是它看的」只能在本机说清楚。
  state.watchLog = [
    { bvid: it.bvid, title: it.title || '', author: it.author || '', source: 'plugin', at: Date.now() },
    ...(state.watchLog || []).filter((x) => x.bvid !== it.bvid),
  ].slice(0, 300)
  return state.current
}

/**
 * 从队列里挑下一条，**尽量不重复**：
 * ① 先排除已经看过的（watchedBvids + 发送记录里的 bvid）
 * ② 从游标往后找第一个没看过的，而不是 `% length` 从头循环
 * ③ 全都看过了 → 返回 null（交调用方去跑新一轮选片）
 * ④ 实在要重播时，优先挑最久以前看过的那条，而不是刚放完的这条
 */
function nextUnwatched(state, items) {
  if (!items || !items.length) return null
  const seen = new Set([
    ...(state.watchedBvids || []),
    ...(state.commentLog || []).map((x) => x.bvid).filter(Boolean),
  ])
  const cur = state.current?.bvid
  if (cur) seen.add(cur)
  const n = items.length
  const from = Math.abs(Number(state.cursor || 0)) % n
  for (let i = 0; i < n; i += 1) {
    const it = items[(from + i) % n]
    if (!seen.has(it.bvid)) {
      state.cursor = (from + i + 1) % n
      return it
    }
  }
  return null
}

/** 当前这条已经看了多久（秒）：从换上它那一刻算起 */
function currentWatchProgress(state) {
  const since = Number(state.currentSince || 0) || Date.parse(state.current?.at || '') || 0
  if (!since) return 0
  // 时间戳在未来（时钟被改过 / 换机）→ 当成"已经看够"，否则会永远卡在这一条
  if (since > Date.now() + 5_000) return Number.MAX_SAFE_INTEGER / 2
  return Math.max(0, (Date.now() - since) / 1000)
}

/**
 * 这条还得再看多少秒才允许换下一条。
 * 规则（主人定的）：至少看 `minWatchSec`（默认 60 秒）；视频本身不到 60 秒，就要求**看完**。
 * @returns {number} 0 = 可以换；>0 = 还要等这么多秒
 */
function remainingMinWatch(state, duration) {
  const want = Math.max(0, Number(state.minWatchSec ?? 60))
  if (!want) return 0
  const dur = Number(duration || state.current?.duration || 0)
  const need = dur > 0 ? Math.min(want, dur) : want
  return Math.max(0, Math.ceil(need - currentWatchProgress(state)))
}

/** 轮转到下一条内容；没内容就置空（预览随之变空闲）。**队列看完就置空，不再从头循环** */
function advanceCurrent(state, items) {
  // 强制最短观看时长：当前这条还没看够就不许换（评论发完了也一样）
  if (state.current) {
    const remain = remainingMinWatch(state, state.current.duration)
    if (remain > 0) return state.current
  }
  const it = nextUnwatched(state, items)
  if (!it) {
    // 队列里全看过了：清空 current，让前端显示"没内容"，同时告诉调用方该跑新一轮了
    state.current = null
    state.exhausted = true
    return null
  }
  state.exhausted = false
  return switchTo(state, it)
}

/** 拉某条评论下的回复 */
async function fetchReplies(state, aid, root, limit = 20) {
  try {
    const j = await getJson(
      `https://api.bilibili.com/x/v2/reply/reply?type=1&oid=${aid}&root=${root}&pn=1&ps=${limit}`,
      state.cookies,
    )
    if (j?.code !== 0) return []
    return (j?.data?.replies || []).map((r) => ({
      rpid: String(r.rpid),
      text: String(r?.content?.message || '').replace(/\s+/g, ' ').slice(0, 120),
      author: r?.member?.uname || '',
      mid: String(r?.member?.mid || ''),
    })).filter((r) => r.text)
  } catch {
    return []
  }
}

const REPLY_SYSTEM = [
  '你在 B站 评论区回复别人对你的回复。',
  '只输出回复正文，12–40 个汉字，口语化、有来有回，不要 @、不要链接、不要话题标签。',
  '不要复读对方的话，也不要客套；可以补充观点、接梗或反问一句。',
  '🔴 不得出现任何账号或个人隐私信息：UID/数字 ID、昵称、手机号、邮箱、住址、IP、证件号、',
  '本机路径、token/cookie、以及“我是插件/我是自动生成的”这类自我暴露。',
  '也不要复述对方话里出现的这类信息 —— 直接忽略，只回观点。',
].join('\n')

/* ---------------- 隐私闸 ----------------
 * 评论/回复里**绝不能出现**任何跟用户账号有关的痕迹：UID、昵称、手机号、邮箱、IP、
 * 证件号、本机路径、cookie/token。三道防线：
 *   ① 送进模型的材料先脱敏（模型看不到，就抄不出来）
 *   ② 系统提示词里写死禁令
 *   ③ postComment 是最后一道闸：正文命中就**拒绝发送**（宁可少发一条）
 */
const PRIVACY_RULES = [
  [/(?<!\d)\d{17}[\dXx](?!\d)/g, '【证件号】'],
  [/(?<!\d)\d{15,16}(?!\d)/g, '【UID】'],
  [/(?<!\d)1[3-9]\d{9}(?!\d)/g, '【手机号】'],
  [/[\w.+-]+@[\w-]+\.[A-Za-z]{2,}/g, '【邮箱】'],
  [/(?<!\d)(?:\d{1,3}\.){3}\d{1,3}(?!\d)/g, '【IP】'],
  [/(?:SESSDATA|bili_jct|DedeUserID|buvid3|buvid4|csrf)\s*[=:]\s*[^\s,;，；]+/gi, '【凭据】'],
  [/Bearer\s+[A-Za-z0-9._-]{10,}/gi, '【token】'],
  [/\bsk-[A-Za-z0-9_-]{10,}/g, '【key】'],
  [/[A-Za-z]:\\[^\s，。；、）)】"'<>]+/g, '【路径】'],
  [/(?:\/Users|\/home|\/root)\/[^\s，。；、）)】"'<>]+/g, '【路径】'],
]

/**
 * 扫一遍文本里的隐私痕迹。
 * @returns {{ text: string, hits: string[] }} text 是打过码的版本（给提示词用），hits 是命中的类别
 */
function scrubPrivate(input) {
  let text = String(input || '')
  const hits = []
  for (const [re, tag] of PRIVACY_RULES) {
    re.lastIndex = 0
    if (re.test(text)) {
      hits.push(tag)
      re.lastIndex = 0
      text = text.replace(re, tag)
    }
  }
  return { text, hits: [...new Set(hits)] }
}

/** 送给模型的材料：先脱敏，再把链接换掉（链接里可能带签名/私有地址） */
function promptSafe(input) {
  return scrubPrivate(input).text.replace(/https?:\/\/[^\s]+/g, '【链接】')
}

async function composeReply(llm, route, myText, theirText, theirName) {
  if (!llm || !route?.provider || !route?.model) return null
  const parts = []
  try {
    for await (const chunk of meteredStream(llm, {
      provider: route.provider,
      model: route.model,
      system: REPLY_SYSTEM,
      messages: [{
        role: 'user',
        content: [{
          type: 'text',
          text: `我之前的评论：${promptSafe(myText)}\n${promptSafe(theirName) || '有人'} 回复我：${promptSafe(theirText)}\n请写我的回复。`,
        }],
      }],
      maxTokens: 150,
      temperature: 0.85,
    })) {
      if (chunk?.type === 'text-delta') parts.push(chunk.text)
    }
  } catch {
    return null
  }
  const text = parts.join('').replace(/^["“'']|["”'']$/g, '').replace(/\s+/g, ' ').trim()
  return text ? text.slice(0, 80) : null
}

/** 有人回复了我的评论时，按概率去接一条 */
async function runReplyFlow(state, llm, route) {
  const mode = state.commentMode
  if (!mode || mode === 'off') return null
  const cap = Number(state.commentDailyCap ?? 3)
  if (Number(state.commentedToday || 0) >= cap) return { skipped: '今日已达上限' }
  const chance = Math.min(1, Math.max(0, Number(state.replyChance ?? 0.5)))
  const mine = (state.commentLog || []).slice(0, 8)
    .filter((x) => x.rpid && x.aid && x.kind !== 'mention')
  if (!mine.length) return null

  for (const rec of mine) {
    const replies = await fetchReplies(state, rec.aid, rec.rpid)
    const seen = new Set(state.repliedRpids || [])
    const fresh = replies.filter((r) => !seen.has(r.rpid) && r.text)
    if (!fresh.length) continue
    if (Math.random() > chance) return { skipped: '这次没接回复' }

    const target = fresh[0]
    let text = await composeReply(llm, route, rec.text, target.text, target.author)
    if (!text) {
      // 兜底模板也不能把对方话里的隐私带出来
      const safe = scrubPrivate(target.text)
      text = safe.hits.length ? '确实，这个点我也想过' : `确实，${target.text.slice(0, 12)}这点我也想过`
    }
    try {
      const sent = await postComment(state, {
        aid: rec.aid, bvid: rec.bvid, message: text,
        root: Number(rec.rpid), parent: Number(target.rpid),
      })
      state.repliedRpids = [target.rpid, ...(state.repliedRpids || [])].slice(0, 100)
      state.commentedToday = Number(state.commentedToday || 0) + 1
      state.lastCommentAt = Date.now()
      log('ok', `接了 ${target.author || '某人'} 的回复：${text.slice(0, 20)}…`)
      return { replied: sent.rpid || 0, to: target.author, text }
    } catch (error) {
      log('err', `接回复失败：${error?.message || error}`)
      return { error: String(error?.message || error) }
    }
  }
  return { skipped: '没有新回复' }
}

/**
 * 主人号昵称（用于真实 @）。
 * 缓存策略：只有「UID 没变」才用缓存；UID 一变立刻重新解析。
 * ⚠️ 以前只判 `if (state.masterName) return` —— 换了主人号 UID 之后昵称还是旧的，
 *    @ 会 @ 到上一个号；而且手动点「查」才会更新，不点就一直是旧的。
 */
async function masterName(state) {
  const uid = String(state.masterUid || '').trim()
  if (!uid) return ''
  // UID 没变 + 已有昵称 → 直接用缓存
  if (state.masterName && String(state.masterNameUid || '') === uid) return state.masterName
  try {
    const card = await masterCard(uid, state.cookies)
    const name = card.name || ''
    if (name) {
      state.masterName = name
      state.masterNameUid = uid
      state.masterNameAt = new Date().toISOString()
    }
    return name
  } catch {
    // 解析失败就用旧缓存兜底（有缓存总比空着好），但下次还会再试
    return state.masterName || ''
  }
}

/**
 * 一条内容与「主人兴趣画像」的契合度（0–1）。
 *
 * 注意：不能直接拿 tokenize 的切词去比对 —— 它会把「原神新角色PV」整串切成一个词，
 * 跟画像里的「原神」永远对不上。这里用两条通道：
 *   ① 画像词在文本里的**包含式命中**（标题、简介、字幕、画面描述、弹幕都算）
 *   ② 反向包含：文本切出来的词反过来包含画像词（防「原神」写成「原神的」这种）
 * 再按画像权重累加，用 sigmoid 压到 0–1。
 * 没学到画像时返回 null（表示"无从判断"，不是"不匹配"）。
 */
function fitScore(state, video, digest) {
  const profile = (state.interest || []).filter((x) => Number(x.weight) > 0)
  if (!profile.length) return null

  // 不同来源的可信度不同：标题最直接，字幕/画面是内容本身，弹幕只是反应
  const sources = [
    { text: String(video.title || ''), w: 2 },
    { text: String(video.desc || ''), w: 1 },
    { text: String(digest?.subtitle || ''), w: 1.5 },
    { text: String(digest?.vision || ''), w: 1 },
    { text: (digest?.danmaku || []).map((d) => d.text).join(' '), w: 0.6 },
  ]
  const hay = sources.map((s) => s.text.toLowerCase())
  const words = sources.map((s) => tokenize(s.text))

  let raw = 0
  const hits = []
  let matchedWeight = 0
  let totalWeight = 0
  for (const { tag, weight } of profile) {
    const t = String(tag).toLowerCase()
    if (!t) continue
    totalWeight += weight
    let w = 0
    for (let i = 0; i < hay.length; i += 1) {
      const hit = hay[i].includes(t) || words[i].some((x) => x.includes(t) || t.includes(x))
      if (hit) w += sources[i].w
    }
    if (!w) continue
    raw += Math.min(weight, 12) * Math.min(1, w / 2)
    matchedWeight += weight
    hits.push(tag)
  }
  if (!raw) return { score: 0, hits: [], ratio: 0 }
  const score = 1 - Math.exp(-raw / 6)
  return {
    score: Math.min(1, score),
    hits: hits.slice(0, 5),
    ratio: totalWeight ? matchedWeight / totalWeight : 0,
  }
}

/** 按概率决定要不要单独发一条 @ 提醒（不写进正文）。
 *  但「主人可能喜欢」这一刀是先决条件：契合度不到阈值，掷骰子都不掷。 */
async function decideMention(state, video, digest) {
  const chance = Math.min(1, Math.max(0, Number(state.mentionChance ?? 0.5)))
  if (Math.random() > chance) return ''
  const name = await masterName(state)
  if (!name) return ''
  const fit = fitScore(state, video, digest)
  if (!fit) return name // 还没有画像，保留原来的概率行为
  const need = Math.min(1, Math.max(0, Number(state.mentionThreshold ?? 0.7)))
  if (fit.score < need) {
    log('info', `契合度 ${(fit.score * 100).toFixed(0)}% < 阈值 ${(need * 100).toFixed(0)}%，这次不打扰主人`)
    return ''
  }
  log('ok', `契合度 ${(fit.score * 100).toFixed(0)}%（${fit.hits.join('、') || '—'}），决定 @ 主人`)
  return name
}

/** 单独那条 @ 提醒的文案：只表达“想让你看看” */
const MENTION_LINES = [
  (n) => `@${n} 这个想让你看看`,
  (n) => `@${n} 看到这个，想让你也看看`,
  (n) => `@${n} 这条你可能会喜欢`,
]

function mentionText(name) {
  const pick = MENTION_LINES[Math.floor(Math.random() * MENTION_LINES.length)]
  return pick(name)
}

/** 草稿生成后按当前模式收尾：draft 留着等确认 / check-auto 自检后自动发 / auto 直接发 */
async function finalizeDraft(state, llm, route, video, draft) {
  const mode = state.commentMode
  if (!mode || mode === 'off') return { drafted: true, id: draft.id }

  if (mode === 'draft') {
    log('info', `草稿已备好，等你确认：${draft.text.slice(0, 20)}…`)
    return { drafted: true, id: draft.id }
  }

  // 三条不评论的领域：政治 / 政府 / 前沿科学。
  // 这是硬闸，**不交给模型判断**——本地词表先过一遍，命中就改写一次，改不掉就不发。
  const scope = noCommentScope(draft.text)
  if (scope.blocked) {
    const rewritten = await rewriteByStyle(
      llm, route, draft.text,
      `这条碰了「${scope.field}」（出现「${scope.hit}」），这三类话题一律不评价；换成只聊视频本身的内容`,
      draft.digest || null,
    )
    if (rewritten && !noCommentScope(rewritten).blocked) {
      log('warn', `不评论领域改写：${draft.text.slice(0, 14)}… → ${rewritten.slice(0, 14)}…`)
      draft.text = rewritten
      draft.scopeRewrote = true
    } else {
      draft.status = 'held'
      draft.reason = `涉「${scope.field}」不评价`
      log('warn', `不评论领域（${scope.field}：${scope.hit}），这条不发`)
      return { held: draft.reason, id: draft.id }
    }
  }

  // 出门前先照镜子：AI 腔一律拦下，改一次还不过就这轮不发
  if (state.styleGate !== false) {
    const gated = await passStyleGate(llm, route, draft.text, draft.digest || null)
    if (!gated.ok) {
      draft.status = 'held'
      draft.reason = gated.reason
      log('warn', `风格闸拦下：${gated.reason}`)
      return { held: gated.reason, id: draft.id }
    }
    if (gated.rewrote) {
      log('ok', `风格闸改写：${draft.text.slice(0, 14)}… → ${gated.text.slice(0, 14)}…`)
      draft.text = gated.text
      draft.rewrote = true
    }
  }

  if (mode === 'check-auto') {
    const check = await selfCheck(llm, route, draft.text, video)
    if (!check.ok) {
      draft.status = 'held'
      draft.reason = check.reason
      log('warn', `自检未过，压在草稿里：${check.reason}`)
      return { held: check.reason, id: draft.id }
    }
    log('info', '自检通过，自动发送')
  }

  const sent = await deliverComment(state, draft)
  if (!sent.ok) {
    // 发不出去就归档到“未发出”，不再堆在草稿区
    state.drafts = (state.drafts || []).filter((x) => x.id !== draft.id)
    state.failedComments = [{
      at: new Date().toISOString(), bvid: draft.bvid, title: draft.title || '',
      text: draft.text, reason: sent.error,
    }, ...(state.failedComments || [])].slice(0, 20)
    return { error: sent.error, id: draft.id }
  }
  return { sent: sent.rpid, text: draft.text }
}

/** 按当前模式跑一次自动评论流程 */
async function runAutoComment(state, llm, route, item, attachments) {
  const mode = state.commentMode
  if (!mode || mode === 'off') return null
  const cap = Number(state.commentDailyCap ?? 3)
  if (Number(state.commentedToday || 0) >= cap) return { skipped: '今日已达上限' }

  // 非“起草确认”档：先把队列里积压的草稿自己处理掉，不再等用户点
  if (mode !== 'draft') {
    const pending = (state.drafts || []).find((d) => d.status === 'ready')
    if (pending) {
      let v = null
      try { v = await videoBrief(state, pending.bvid) } catch { v = { title: pending.title || pending.bvid, author: '' } }
      log('info', `处理积压草稿：${pending.text.slice(0, 18)}…`)
      return finalizeDraft(state, llm, route, v, pending)
    }
  }

  if (!item) return { skipped: '没有正在看的内容' }

  const cand = item
  if ((state.commentLog || []).some((x) => x.bvid === cand.bvid && x.kind !== 'mention')) {
    return { skipped: '这条已经评过了' }
  }
  if ((state.drafts || []).some((x) => x.bvid === cand.bvid)) {
    return { skipped: '这条已有草稿' }
  }

  let v = null
  try { v = await videoBrief(state, cand.bvid) } catch { return { skipped: '详情读取失败' } }

  // 视频本身就属于「不评论领域」→ 这条只说"看过了"，不在下面说话
  const outOfScope = videoOutOfScope(v, null)
  if (outOfScope.blocked) {
    log('info', `这类不评（${outOfScope.field}）：${String(v.title).slice(0, 16)}`)
    state.scopeSkipped = [{
      at: new Date().toISOString(), bvid: v.bvid, title: v.title || '',
      field: outOfScope.field, hit: outOfScope.hit,
    }, ...(state.scopeSkipped || [])].slice(0, 30)
    return { skipped: `涉「${outOfScope.field}」，不在下面说话` }
  }

  const comments = await fetchComments(state, v.aid, 12)
  // 素材：字幕 > 弹幕 > 画面抽帧；评论区作为「整体看法」最后一起给模型
  // 带上"已经看到哪儿"，画面快照要按这个位置判断后面有没有弹幕
  v.watchedAt = Number(state.watchPosition?.bvid === v.bvid ? state.watchPosition.at : 0)
  const digest = await videoDigest(state, v, llm, route, attachments)
  log('info', `取材：${digest.layer}`)
  let text = buildDraftText(state, v)
  const ai = await composeComment(llm, route, state, v, comments, digest)
  if (ai) text = ai

  // 只有「主人可能喜欢」（契合度过阈值）才会单独发一条 @ 提醒
  const atName = await decideMention(state, v, digest)

  const draft = {
    id: makeDraftId(), bvid: v.bvid, aid: v.aid, title: v.title, author: v.author,
    text, at: new Date().toISOString(), status: 'ready',
    source: ai ? 'model' : 'template', seenComments: comments.length,
    atName, material: digest.layer, digest,
  }

  // 草稿永远自动生成；概率只决定「要不要真发」
  if (mode !== 'draft') {
    const chance = Math.min(1, Math.max(0, Number(state.commentChance ?? 0.6)))
    if (Math.random() > chance) {
      log('info', `这轮决定不评（${Math.round(chance * 100)}% 档）：${text.slice(0, 18)}…`)
      return { skipped: '这轮决定不评', text }
    }
  }

  state.drafts = [draft, ...(state.drafts || [])].slice(0, 20)
  return finalizeDraft(state, llm, route, v, draft)
}

const COMMENT_SYSTEM = [
  '你在替一个普通 B站 用户写一条视频评论。',
  '要求：只输出评论正文，不要解释、不要引号、不要 @、不要链接、不要话题标签。',
  '必须先看“评论区现状”，顺着大家正在聊的方向说，不能脱离讨论自说自话。',
  '不要复读别人已经说过的话，也不要说“说得好”“同感”这类空话；如果你同意某一点，就点出那一点再补自己的看法。',
  '语气和长度要向该评论区靠拢：大家短你就短，大家爱开玩笑你就别端着。',
  '长度控制在 12–45 个汉字。',
  '🔴 硬性禁区（违反就算失败）：**不评价政治敏感话题、不评价政府/政策/官方表态、不评价前沿科学领域的研究结论**',
  '（如量子、核聚变、基因编辑、大模型/AGI 等）。碰到这些就只聊视频里跟它们无关的部分，聊不了就写一句最普通的话。',
  '这几类话题在这个账号上一律不表态、不站队、不调侃。',
  '🔴 隐私禁令（同样算失败）：**不得出现任何账号 ID、昵称、手机号、邮箱、住址、IP、证件号、',
  '本机路径、token/cookie**，也不要说“我是插件/我是 AI/自动生成”这类自我暴露；',
  '评论区里别人写出来的这类信息也不要复述。',
].join('\n')

/** 拉一条视频的热门评论，供拟评论参考 */
async function fetchComments(state, aid, limit = 15) {
  try {
    const j = await getJson(
      `https://api.bilibili.com/x/v2/reply?type=1&oid=${aid}&pn=1&ps=${limit}&sort=2`,
      state.cookies,
    )
    if (j?.code !== 0) return []
    return (j?.data?.replies || [])
      .map((r) => ({
        text: String(r?.content?.message || '').replace(/\s+/g, ' ').slice(0, 120),
        like: Number(r.like || 0),
        author: r?.member?.uname || '',
      }))
      .filter((c) => c.text)
      .sort((a, b) => b.like - a.like)
  } catch {
    return []
  }
}

/** 用宿主模型结合视频与评论区现状拟一条评论；失败返回 null 交给模板兜底 */
async function composeComment(llm, route, state, video, comments, digest = null) {
  if (!llm || !route?.provider || !route?.model) return null
  const tags = (state.interest || []).map((i) => i.tag).slice(0, 5)
  const lines = [`视频标题：${video.title}`, `UP主：${video.author || '未知'}`]
  if (video.desc) lines.push(`简介：${video.desc.slice(0, 120)}`)
  if (tags.length) lines.push(`我最近常看的方向：${tags.join('、')}`)

  // 材料按重要性排：①字幕（视频本人说了什么，最可靠）②弹幕（现场反应）
  // ③画面（主播不放弹幕/字幕时的补充）④评论区（观众的整体看法，放最后当参照）
  if (digest?.subtitle) {
    lines.push('')
    lines.push('【①视频字幕（内容最准，优先依据这个）】')
    lines.push(digest.subtitle)
  }
  if (digest?.danmaku?.length) {
    lines.push('')
    lines.push('【②弹幕（现场实时反应，能看出大家在笑什么、吐槽什么）】')
    lines.push(digest.danmaku.slice(0, 20).map((d) => `· ${d.text}`).join('\n'))
  }
  if (digest?.vision) {
    lines.push('')
    lines.push('【③画面（没有字幕和弹幕，根据抽帧看到的画面）】')
    lines.push(digest.vision)
  }

  if (comments.length) {
    const total = comments.length
    const avg = Math.round(comments.reduce((a, c) => a + c.text.length, 0) / total)
    const emoji = comments.filter((c) => /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(c.text)).length
    const freq = new Map()
    for (const c of comments) for (const t of tokenize(c.text)) freq.set(t, (freq.get(t) || 0) + 1)
    const phrases = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t]) => t)

    lines.push('')
    lines.push(`【④评论区（观众对这条的整体看法；${total} 条热门，平均 ${avg} 字，带表情 ${emoji} 条，高频词：${phrases.join('、') || '无'}）】`)
    for (const c of comments.slice(0, 6)) {
      lines.push(`- 「${c.text}」（${c.like} 赞）`)
    }
    lines.push('')
    lines.push('请顺着上面这些讨论的方向写一条自己的评论，可以补充角度、接个梗，或对不同看法给出理由。')
  } else {
    lines.push('')
    lines.push('评论区暂时没有可参考的讨论，请围绕视频本身写一条具体、不空洞的评论。')
  }

  const parts = []
  try {
    for await (const chunk of meteredStream(llm, {
      provider: route.provider,
      model: route.model,
      system: COMMENT_SYSTEM,
      messages: [{ role: 'user', content: [{ type: 'text', text: lines.join('\n') }] }],
      maxTokens: 200,
      temperature: 0.9,
    })) {
      if (chunk?.type === 'text-delta') parts.push(chunk.text)
      if (chunk?.type === 'finish' && (chunk.reason?.kind === 'error' || chunk.reason?.kind === 'aborted')) {
        throw new Error(chunk.reason?.failure?.message || 'model call failed')
      }
    }
  } catch {
    return null
  }
  const text = parts.join('').replace(/^["“'']|["”'']$/g, '').replace(/\s+/g, ' ').trim()
  if (!text) return null
  return text.slice(0, 90)
}

async function videoBrief(state, bvid) {
  const j = await getJson(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, state.cookies)
  if (j?.code !== 0) throw new Error(`读不到视频：${j?.message || j?.code}`)
  return {
    bvid,
    aid: j.data.aid,
    cid: j.data.cid || j.data.pages?.[0]?.cid || 0,
    title: j.data.title || '',
    author: j.data.owner?.name || '',
    desc: String(j.data.desc || '').slice(0, 200),
    // 时长要用于判断「最后一条弹幕之后静默了多久」
    duration: Number(j.data.duration || 0),
  }
}

/* ---------------- 视频内容取材（字幕 / 弹幕） ---------------- */

/** 字幕列表：wbi/v2 新接口不通时退回 player/wbi/v2 */
async function subtitleList(state, aid, cid) {
  const urls = [
    `https://api.bilibili.com/x/player/wbi/v2?aid=${aid}&cid=${cid}`,
    `https://api.bilibili.com/x/player/v2?aid=${aid}&cid=${cid}`,
  ]
  for (const url of urls) {
    try {
      const j = await getJson(url, state.cookies)
      if (j?.code !== 0) continue
      const subs = j?.data?.subtitle?.subtitles || []
      if (subs.length) return subs
    } catch {}
    await sleep(120)
  }
  return []
}

/** 拉一份字幕正文；优先中文（ai-zh 优先），截到 maxChars */
async function fetchSubtitleText(state, subs, maxChars = 1200) {
  if (!subs || !subs.length) return ''
  const rank = (s) => {
    const l = String(s.lan || '')
    if (l === 'ai-zh') return 0
    if (/^zh/.test(l)) return 1
    if (l === 'ai-en') return 3
    return 2
  }
  const sorted = [...subs].sort((a, b) => rank(a) - rank(b))
  for (const s of sorted.slice(0, 3)) {
    let u = String(s.subtitle_url || '')
    if (!u) continue
    if (u.startsWith('//')) u = `https:${u}`
    try {
      const r = await fetch(u, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(12000) })
      const j = await r.json()
      const body = (j?.body || [])
        .map((x) => String(x?.content || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .join(' ')
      if (body.length >= 30) return body.slice(0, maxChars)
    } catch {}
    await sleep(150)
  }
  return ''
}

/** 弹幕池：没有字幕时的兜底，观众会把重点和梗打在屏幕上 */
async function fetchDanmaku(state, cid, maxItems = 40) {
  if (!cid) return []
  try {
    const res = await fetch(`https://api.bilibili.com/x/v1/dm/list.so?oid=${cid}`, {
      headers: { 'user-agent': UA, referer: 'https://www.bilibili.com/' },
      signal: AbortSignal.timeout(12000),
    })
    const xml = await res.text()
    const out = []
    // <d p="出现时间,模式,字号,颜色,时间戳,...">正文</d> —— 第一个字段就是秒数
    for (const m of xml.matchAll(/<d p="([^"]*)"[^>]*>([\s\S]*?)<\/d>/g)) {
      const time = Number(String(m[1]).split(',')[0]) || 0
      const t = m[2].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim()
      if (t.length >= 2 && t.length <= 40) out.push({ text: t, time })
      if (out.length >= maxItems * 3) break
    }
    const clean = out.filter((d) => /[\u4e00-\u9fa5A-Za-z]/.test(d.text))
    const seen = new Set()
    return clean
      .slice(-maxItems)
      .filter((d) => (seen.has(d.text) ? false : (seen.add(d.text), true)))
      .slice(0, maxItems)
  } catch {
    return []
  }
}

/**
 * 一条视频「讲了什么」。材料按重要性排：
 * ①B站字幕（视频本人说了什么，最可靠；实测未登录时常返回空）
 * ②弹幕池（现场实时反应，默认就有）
 * ③画面快照（**只在真的没料时才用**，见下面）
 * 评论区不在这里取，由调用方单独取，作为「整体看法」放在最后。
 *
 * ⚠️ 画面快照的触发条件（主人定的，为省 token）：
 *   - 一条视频**最多 4 张**，默认只抽 **1 张**；
 *   - 只有「既没字幕、弹幕也几乎为零」才抽 —— 也就是主播关了弹幕/没字幕的纯画面视频；
 *   - 抽一张就够，不按时间轮询、不按秒抽。
 *   快照确实能帮模型理解内容，但每一张都要花 token，宁少勿多。
 */
const VISION_MAX_SHOTS = 4
/** 开播后多少秒内一条弹幕都没有，就认为"没有实时动态"（触发画面快照） */
const DANMAKU_WINDOW_SEC = 30
/** 一条视频的弹幕少到这个数，就认为"没有参考价值" */
const DANMAKU_MIN = 5

async function videoDigest(state, video, llm, route, attachments) {
  const aid = video.aid || 0
  const cid = video.cid || 0
  const out = { subtitle: '', danmaku: [], vision: '', layer: '标题', visionSkipped: '', visionShots: 0 }
  if (!cid) return out
  try {
    const subs = await subtitleList(state, aid, cid)
    if (subs.length) {
      out.subtitle = await fetchSubtitleText(state, subs)
      if (out.subtitle) out.layer = '字幕'
    }
  } catch {}
  if (!out.subtitle) {
    out.danmaku = await fetchDanmaku(state, cid, 40)
    if (out.danmaku.length) out.layer = '弹幕'
  }

  // 触发条件（主人定的口径，为省 token）：
  //   ① 没有字幕（有字幕就以字幕为准，图片一律不看）；
  //   ② **最后一条弹幕之后，已经过去 30 秒没有新弹幕** ——
  //      参照的是弹幕自己的时间轴：一条弹幕打在 03:20，到 04:00 都没人再说话 ⇒ 空了 40 秒 ⇒ 触发。
  //   ③ 一条视频最多 4 张、默认只 1 张。
  //
  // ⚠️ 这里有个坑：B站 弹幕接口**每次最多只给 1200 条**（长视频的后面直接没有）。
  //    所以不能拿"下载到的最晚时间"当"最后一条弹幕"——实测星穹铁道那条
  //    下载到的最后一条在 216s，但视频有 874s，后面其实还有弹幕，一减就成了"静默 658s"，纯误判。
  //    正确做法：以**我们已经看到的位置**为参照（播放进度 / 已上报进度），
  //    算「从那个位置往后，弹幕轴上有没有人说话」。
  const dmTimes = out.danmaku.map((d) => Number(d.time || 0)).filter((t) => t > 0).sort((a, b) => a - b)
  const dur = Number(video.duration || 0)
  // 我们"走到"的位置：优先用调用方给的播放进度，没有就用已下载弹幕覆盖到的区间
  const watchedAt = Math.max(0, Number(video.watchedAt || 0))
  const tail = dmTimes.length ? dmTimes[dmTimes.length - 1] : 0
  // 参照点：看到了哪儿（不超过视频总长）
  const point = dur > 0 ? Math.min(dur, watchedAt || tail) : (watchedAt || tail)
  const after = dmTimes.filter((t) => t > point)
  // 从参照点往后，下一个弹幕出现的位置（没有就算静默到底）
  const nextDm = after.length ? after[0] : 0
  const silent = nextDm ? nextDm - point : (dur > 0 ? dur - point : DANMAKU_WINDOW_SEC)
  const quietAfterLast = !out.subtitle && (out.danmaku.length < DANMAKU_MIN || silent >= DANMAKU_WINDOW_SEC)
  if (quietAfterLast && state.visionFallback !== false) {
    try {
      const want = Math.min(VISION_MAX_SHOTS, Math.max(1, Number(state.visionShots ?? 1)))
      const v = await lookAtFrames(state, video, llm, route, attachments, want)
      if (v.ok) {
        out.vision = v.text
        out.layer = out.danmaku.length ? '弹幕+画面' : '画面'
        log('info', `看到 ${Math.round(point)}s，之后 ${Math.round(silent)}s 没弹幕，抽 1 张画面看`)
      } else {
        out.visionSkipped = v.reason
        log('info', `画面分析没做成：${v.reason}`)
      }
    } catch (error) {
      out.visionSkipped = String(error?.message || error)
    }
  }
  return out
}

/* ---------------- 抽帧看画面（多模态兜底） ---------------- */

/**
 * B站 故事板（videoshot）给的是一张 10×10 的雪碧图，每格 480×270。
 * 这张图本身就能直接给多模态模型看 —— 不用解码、不用装 sharp/pngjs。
 * 取第 index 张（一般就一张），挑中间几个格子尽量分散。
 */
async function storyboardOf(state, video) {
  const { aid, cid } = video
  if (!aid || !cid) return null
  const j = await getJson(
    `https://api.bilibili.com/x/player/videoshot?aid=${aid}&cid=${cid}&index=1`,
    state.cookies,
  )
  if (j?.code !== 0) throw new Error(`故事板不可用：${j?.message || j?.code}`)
  const list = j?.data?.image || []
  const first = list[0]
  if (!first) throw new Error('这条视频没有故事板')
  const url = first.startsWith('//') ? `https:${first}` : first
  return {
    url,
    cols: Number(j.data.img_x_len || 10),
    rows: Number(j.data.img_y_len || 10),
    cellW: Number(j.data.img_x_size || 480),
    cellH: Number(j.data.img_y_size || 270),
    count: list.length,
  }
}

const VISION_SYSTEM = [
  '你在看一条 B站 视频的抽帧截图（一张图里按网格排列了很多帧，每格是视频的一个时间点）。',
  '请用 2–4 句中文说清楚：这条视频在讲什么、画面里是谁/什么东西、在做什么。',
  '只描述画面能直接看到的事实，不要猜测，不要评价视频好坏，不要写“建议”“总之”。',
  '如果画面里根本看不出来（比如纯黑、纯色、晃动糊成一片），就只回两个字：看不出。',
].join('\n')

/**
 * 抽帧 → 交给模型看。宿主支持 attachments（存图）+ 当前模型能看图才行，
 * 缺任何一个就明确跳过（不静默降级），返回 { ok, text } 或 { ok:false, reason }。
 * 第三个参数 attachments 由调用方从宿主编排里传进来（插件本身不强依赖这个服务）。
 */
async function lookAtFrames(state, video, llm, route, attachments, shots = 1) {
  if (!llm || !route?.provider || !route?.model) return { ok: false, reason: '模型不可用' }
  if (!attachments?.saveImage) return { ok: false, reason: '宿主没有 attachments 服务，存不了图' }

  // 先确认这个模型到底能不能看图；不能就直接放过，别浪费一次请求
  try {
    const info = await llm.resolveModelInfo?.(route.provider, route.model)
    const mods = info?.inputModalities
    if (mods && !mods.includes('image')) {
      return { ok: false, reason: `${route.model} 不支持读图` }
    }
  } catch {}

  const sb = await storyboardOf(state, video)
  const res = await fetch(sb.url, {
    headers: { 'user-agent': UA, referer: `https://www.bilibili.com/video/${video.bvid}` },
    signal: AbortSignal.timeout(20000),
  })
  if (!res.ok) return { ok: false, reason: `故事板下载失败 ${res.status}` }
  const buf = new Uint8Array(await res.arrayBuffer())
  if (buf.length > 8 * 1024 * 1024) return { ok: false, reason: '故事板太大' }

  let ref = null
  try {
    ref = await attachments.saveImage({
      data: buf, mediaType: 'image/jpeg',
      name: `whale-frames-${video.bvid}.jpg`,
    })
  } catch (error) {
    return { ok: false, reason: `存图失败：${error?.message || error}` }
  }

  // ⚠️ 只发**一张**图（整张雪碧图），让模型自己在网格里找信息。
  //    以前是把整张图当一次请求发，token 就够用了；
  //    绝不为了一张快照发 shots 次请求 —— 那才是烧 token 的真正原因。
  const n = Math.min(VISION_MAX_SHOTS, Math.max(1, Number(shots) || 1))
  const parts = []
  try {
    const msgs = [{
      role: 'user',
      content: [
        {
          type: 'text',
          text: `这是《${video.title}》的抽帧截图，UP主是 ${video.author || '未知'}。`
            + `网格是 ${sb.cols}×${sb.rows} 格（${n > 1 ? `只挑其中 ${n} 帧看即可` : '按顺序看即可'}），`
            + `请说清这条视频在讲什么。`,
        },
        { type: 'image', attachment: ref },
      ],
    }]
    for await (const chunk of meteredStream(llm, {
      provider: route.provider,
      model: route.model,
      system: VISION_SYSTEM,
      messages: msgs,
      maxTokens: 200,
      temperature: 0.3,
    })) {
      if (chunk?.type === 'text-delta') parts.push(chunk.text)
    }
  } catch (error) {
    return { ok: false, reason: `看图失败：${error?.message || error}` }
  }

  const text = parts.join('').replace(/\s+/g, ' ').trim()
  if (!text) return { ok: false, reason: '模型没返回内容' }
  if (/^看不出/.test(text)) return { ok: false, reason: '画面看不出内容' }
  log('ok', `抽帧看画面：${text.slice(0, 24)}…`)
  return { ok: true, text: text.slice(0, 300) }
}

/** 真正写评论：需要 SESSDATA + bili_jct；Referer 必须是视频页，否则 B站 判 CSRF 失败 */
async function postComment(state, { aid, bvid, message, root, parent, atName }) {
  const jct = state.cookies?.bili_jct
  if (!jct) throw new Error('缺少 csrf（bili_jct），请重新扫码登录')

  // 🔴 最后一道隐私闸：任何来源（模型、模板、手动草稿）的正文，命中隐私痕迹一律不发。
  //    评论本身很短，出现 UID/手机号/邮箱 基本都是模型从材料里抄的，宁可少发一条。
  const priv = scrubPrivate(message)
  if (priv.hits.length) {
    throw new Error(`评论里出现疑似隐私信息（${priv.hits.join('、')}），已拦下不发送`)
  }

  const form = new URLSearchParams()
  form.set('type', '1')
  form.set('oid', String(aid))
  form.set('message', message)
  form.set('csrf', jct)
  form.set('plat', '1')
  if (root) form.set('root', String(root))
  if (parent) form.set('parent', String(parent))
  if (atName) form.set('at_name', atName)

  const page = bvid ? `https://www.bilibili.com/video/${bvid}` : 'https://www.bilibili.com/'
  // 注意：不要带 accept-language —— 实测带上它 B站 会稳定返回 -111（CSRF 校验失败）
  const anon = await anonCookies()
  const cookieStr = Object.entries(state.cookies).map(([k, v]) => `${k}=${v}`).join('; ')
  const headers = {
    'user-agent': UA,
    origin: 'https://www.bilibili.com',
    referer: page,
    accept: 'application/json, text/plain, */*',
    'content-type': 'application/x-www-form-urlencoded',
    cookie: anon ? `${cookieStr}; ${anon}` : cookieStr,
  }
  const res = await fetch('https://api.bilibili.com/x/v2/reply/add', {
    method: 'POST', headers, body: form.toString(), signal: AbortSignal.timeout(15000),
  })
  const text = await res.text()
  if (text.trimStart().startsWith('<')) throw new Error('被风控拦截（HTML），今天先别发了')
  let out = null
  try { out = JSON.parse(text) } catch { throw new Error('接口返回非 JSON') }

  // -111：CSRF 不认。常见于 cookie 里混入了过期/多余字段，用最小集合重试一次
  if (out.code === -111) {
    const minimal = ['SESSDATA', 'bili_jct', 'DedeUserID']
      .filter((k) => state.cookies[k])
      .map((k) => `${k}=${state.cookies[k]}`)
      .join('; ')
    const anon = await anonCookies()
    try {
      const retry = await fetch('https://api.bilibili.com/x/v2/reply/add', {
        method: 'POST',
        headers: { ...headers, cookie: anon ? `${minimal}; ${anon}` : minimal },
        body: form.toString(),
        signal: AbortSignal.timeout(15000),
      })
      const t2 = await retry.text()
      const o2 = JSON.parse(t2)
      if (o2.code === 0) return o2.data || {}
      out = o2
    } catch {}
  }

  if (out.code !== 0) {
    const msg = out.message || `code ${out.code}`
    if (out.code === -101) throw new Error('登录态失效，重新扫码')
    if (out.code === -412) throw new Error('触发风控（-412），换个时间再试')
    if (out.code === 12002) throw new Error('评论太频繁，等一会儿')
    throw new Error(`发送失败：${msg}`)
  }
  return out.data || {}
}

/* ---------------- 峰谷 与预算换算 ---------------- */

/** 北京时间（不依赖本机时区） */
function beijingClock() {
  const d = new Date(Date.now() + 8 * 3600 * 1000)
  return { minutes: d.getUTCHours() * 60 + d.getUTCMinutes(), label: `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}` }
}

/** DeepSeek 谷时：北京时间 00:30–08:30 */
function isOffPeak() {
  const { minutes } = beijingClock()
  return minutes >= 30 && minutes < 510
}

function priceInfo(state) {
  const off = isOffPeak()
  const discounted = state.peakValley !== false && off
  const factor = discounted ? Math.max(0.1, Math.min(1, Number(state.offPeakDiscount ?? 0.5))) : 1
  // 混合单价：输出占七成（¥/百万 token）
  const mixed = Number(state.priceInput ?? 2) * 0.3 + Number(state.priceOutput ?? 8) * 0.7
  const effective = mixed * factor
  return {
    offPeak: off,
    discounted,
    factor,
    clock: beijingClock().label,
    mixedPerM: Number(mixed.toFixed(2)),
    effectivePerM: Number(effective.toFixed(2)),
    perToken: effective / 1e6,
  }
}

/** 把金额上限换算成 token 额度，再据此分配 */
function quotaView(state) {
  const info = priceInfo(state)
  const perToken = info.perToken || 1e-6
  const dailyTokens = Math.floor(Number(state.dailyBudget ?? 0) / perToken)
  const runTokens = Math.floor(Number(state.perRunBudget ?? 0) / perToken)
  const used = Number(state.tokensUsedToday ?? 0)
  return {
    ...info,
    dailyTokens,
    runTokens,
    used,
    remainingTokens: Math.max(0, dailyTokens - used),
  }
}

/* ---------------- 留言区 ---------------- */

let noteSeq = 0
function makeNote(text, key) {
  noteSeq += 1
  return {
    id: `n${Date.now().toString(36)}${noteSeq}`,
    key: key || '', text, at: new Date().toISOString(),
    status: 'pending', reply: '',
  }
}

/** 用久了会自己攒想法：按已观察到的使用痕迹追加，不重复 */
function autoNotes(state) {
  const has = (key) => (state.notes || []).some((n) => n.key === key)
  const add = (key, text) => {
    if (has(key)) return false
    state.notes = [makeNote(text, key), ...(state.notes || [])]
    return true
  }
  let changed = false
  if (state.runsToday >= 3) {
    changed = add('cron', '跑了这么多轮都是我手动点的。要不要我加个定时：每晚固定时间自己刷一轮，结果早上给你？') || changed
  }
  if (state.commentLearn?.count > 0) {
    changed = add('style', `我读了 ${state.commentLearn.count} 条评论：平均 ${state.commentLearn.avgLen} 字，表情率 ${Math.round(state.commentLearn.emojiRate * 100)}%。要不要我照着这个长度和语气起草回复？`) || changed
  }
  if (logged(state.cookies) && state.commentMode === 'off') {
    changed = add('draft', '发言号已经登上了。要不要先把「起草后我确认」接通，让我把评论草稿推到浮窗里？') || changed
  }
  if ((state.interest || []).length && !has('tune')) {
    changed = add('tune', '画像有了，但我只会按权重排。要不要让你能点掉不想要的词？') || changed
  }
  return changed
}

/* ---------------- 路由 ---------------- */

export const inject = ['webServer']

export function apply(ctx) {
  const llm = ctx.get('llm')
  const modelService = ctx.get('agentDefaultModel')
  // 可选服务：宿主没有 attachments 时抽帧看画面会明确跳过（不静默降级）
  const attachments = ctx.get('attachments') || null

  const currentRoute = () => {
    try {
      const sel = modelService?.currentSelection?.()
      const provider = sel?.provider || sel?.value?.provider
      const model = sel?.model || sel?.value?.model
      return provider && model ? { provider, model } : null
    } catch {
      return null
    }
  }

  const handler = async (req, res) => {
    try {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' })
      if (!sameOrigin(req)) return sendJson(res, 403, { error: 'cross-origin blocked' })
      const body = await readJsonBody(req)
      const action = String(body.action || 'state')
      const state = await loadState()

      // ---------------- 总开关 ----------------
      // 插件装着 ≠ 插件在干活。paused 一开，自动动作（选片/评论/@/学习/换片/上报/心跳）
      // 全部停手，但界面还能打开、还能把开关拨回去。state / save / login / power 自己不受限。
      const POWER_FREE = new Set([
        'state', 'save', 'power', 'monitor', 'video.info',
        'login.start', 'login.poll', 'logout', 'master.lookup', 'diag',
      ])
      if (state.paused && !POWER_FREE.has(action)) {
        return sendJson(res, 200, {
          ok: false, paused: true,
          error: '总开关已关闭：把浮窗最上面的开关拨开才会继续',
          state: publicView(state),
        })
      }

      if (action === 'power') {
        const on = body.on === undefined ? Boolean(state.paused) : Boolean(body.on)
        state.paused = !on
        if (state.paused) {
          state.runningSince = 0
          state.nextRunAt = 0
          setPhase('已关闭', '总开关关着，什么都不做')
          log('warn', '总开关：已关闭（自动动作全部停止）')
        } else {
          state.nextRunAt = 0 // 立刻允许下一拍开跑
          state.capBlockedDay = ''
          setPhase('空闲', '总开关：已开启')
          log('ok', '总开关：已开启')
        }
        await saveState(state, true) // 开关自己这次可以改 paused
        return sendJson(res, 200, { ok: true, paused: state.paused, state: publicView(state) })
      }

      if (action === 'state') {
        if (autoNotes(state)) await saveState(state)
        return sendJson(res, 200, { ok: true, state: publicView(state) })
      }

      if (action === 'save') {
        const patch = body.patch || {}
        for (const k of [
          'platform', 'accountUid', 'masterUid', 'manualTopics', 'seedLinks',
          'dailyBudget', 'perRunBudget', 'commentMode', 'commentDailyCap',
          'mentionChance', 'learnChance', 'decayDays', 'decayFloor', 'paused',
          'commentChance', 'replyChance', 'autoRun', 'autoRunMinutes', 'cruiseGapSec',
          'daysBack', 'styleGate', 'autoWatch', 'dwellSec', 'minWatchSec', 'visionFallback',
          'offTopicShare', 'mentionThreshold', 'visionShots',
          'peakValley', 'priceInput', 'priceOutput', 'offPeakDiscount',
          'tokenPerItem', 'targetCount', 'maxResume', 'tokensUsedToday',
        ]) if (k in patch) state[k] = patch[k]
        state.dailyBudget = Math.max(0, Number(state.dailyBudget) || 0)
        state.perRunBudget = Math.max(0, Number(state.perRunBudget) || 0)
        state.commentDailyCap = Math.max(0, Math.min(20, Number(state.commentDailyCap) || 0))
        state.mentionChance = Math.min(1, Math.max(0, Number(state.mentionChance ?? 0.5)))
        state.learnChance = Math.min(1, Math.max(0, Number(state.learnChance ?? 0.35)))
        state.decayDays = Math.min(60, Math.max(0.5, Number(state.decayDays ?? 7)))
        state.decayFloor = Math.min(6, Math.max(0.2, Number(state.decayFloor ?? 1)))
        state.commentChance = Math.min(1, Math.max(0, Number(state.commentChance ?? 0.6)))
        state.replyChance = Math.min(1, Math.max(0, Number(state.replyChance ?? 0.5)))
        state.autoRunMinutes = Math.min(720, Math.max(5, Number(state.autoRunMinutes ?? 60)))
        state.cruiseGapSec = Math.min(600, Math.max(10, Number(state.cruiseGapSec ?? 45)))
        state.daysBack = Math.min(365, Math.max(0, Number(state.daysBack ?? 7)))
        state.dwellSec = Math.min(3600, Math.max(30, Number(state.dwellSec ?? 300)))
        state.minWatchSec = Math.min(600, Math.max(0, Number(state.minWatchSec ?? 60)))
        state.offTopicShare = Math.min(1, Math.max(0, Number(state.offTopicShare ?? 0.3)))
        state.mentionThreshold = Math.min(1, Math.max(0, Number(state.mentionThreshold ?? 0.7)))
        state.visionShots = Math.min(4, Math.max(1, Number(state.visionShots ?? 1)))

        // 总开关也能从普通 save 进来（前端「确认制」走的都是 save）
        if ('paused' in patch) {
          state.paused = Boolean(patch.paused)
          if (state.paused) {
            state.runningSince = 0
            state.nextRunAt = 0
            setPhase('已关闭', '总开关关着，什么都不做')
            log('warn', '总开关：已关闭（自动动作全部停止）')
          } else {
            state.nextRunAt = 0
            state.capBlockedDay = ''
            setPhase('空闲', '总开关：已开启')
            log('ok', '总开关：已开启')
          }
        }

        // 预算一变就立刻解除「额度用完」的封锁，不用等 10 分钟
        if ('dailyBudget' in patch || 'perRunBudget' in patch ||
            'priceInput' in patch || 'priceOutput' in patch || 'offPeakDiscount' in patch) {
          const qq = quotaView(state)
          if (qq.remainingTokens > 0) {
            state.budgetBlockedAt = 0
            state.nextRunAt = 0 // 让连播下一拍（5 秒内）就开跑
            // 同一秒里反复点「确认」会刷屏（实测一口气 16 条），只在换算结果真变了才记
            if (lastBudgetLog.tokens !== qq.dailyTokens || Date.now() - lastBudgetLog.at > 10 * 60_000) {
              lastBudgetLog = { tokens: qq.dailyTokens, at: Date.now() }
              log('ok', `预算已更新：日额度 ${qq.dailyTokens} tokens，剩 ${qq.remainingTokens}，连播恢复`)
            }
          } else {
            log('info', `预算已更新，但额度仍不足：已用 ${qq.used} / 日额度 ${qq.dailyTokens}`)
          }
        }

        // 把评论上限调大（或模式重新打开）→ 立刻解除"睡到明天"的封锁
        if ('commentDailyCap' in patch || 'commentMode' in patch) {
          const cq = commentQuota(state)
          if (!cq.reached && String(state.capBlockedDay || '')) {
            state.capBlockedDay = ''
            state.nextRunAt = 0
            log('ok', `评论额度恢复（今日 ${cq.used} / 上限 ${cq.cap}），连播继续`)
          }
        }

        // 主人号 UID 一变就自己解析昵称并缓存 —— 不再依赖手动点「查」，
        // 否则换了号之后 @ 还 @ 到上一个号（旧缓存永远不失效）。
        const uidNow = String(state.masterUid || '').trim()
        if (uidNow !== String(state.masterNameUid || '')) {
          state.masterName = ''
          if (uidNow) {
            try {
              const card = await masterCard(uidNow, state.cookies)
              state.masterName = card.name || ''
              state.masterNameUid = uidNow
              state.masterNameAt = new Date().toISOString()
              log('ok', `主人号已解析：${state.masterName}（UID ${uidNow}）`)
            } catch (error) {
              log('warn', `主人号解析失败：${error?.message || error}`)
            }
          } else {
            state.masterNameUid = ''
          }
        }
        state.priceInput = Math.max(0, Number(state.priceInput ?? 2))
        state.priceOutput = Math.max(0, Number(state.priceOutput ?? 8))
        state.offPeakDiscount = Math.min(1, Math.max(0.1, Number(state.offPeakDiscount ?? 0.5)))
        state.tokenPerItem = Math.max(100, Number(state.tokenPerItem ?? 1200))
        state.targetCount = Math.min(30, Math.max(3, Number(state.targetCount ?? 12)))
        state.maxResume = Math.min(5, Math.max(0, Number(state.maxResume ?? 2)))
        state.tokensUsedToday = Math.max(0, Number(state.tokensUsedToday ?? 0))
        await saveState(state, 'paused' in patch)
        return sendJson(res, 200, { ok: true, state: publicView(state) })
      }

      if (action === 'learn') {
        log('info', '开始学习：关注动态 / 投稿 / 收藏 / 手动话题')
        setPhase('学习中', '四条线并行')
        try {
          const learned = await learn(state, llm, currentRoute())
          await saveState(state)
          log('ok', `学习完成：${learned.samples} 条样本 · ${learned.sources.join('；')}`)
          setPhase('空闲', `刚学完：${learned.samples} 条样本`)
          return sendJson(res, 200, { ok: true, learned, state: publicView(state) })
        } catch (error) {
          await saveState(state)
          log('err', `学习失败：${error?.message || error}`)
          setPhase('空闲', '学习没成功')
          return sendJson(res, 200, { ok: false, error: String(error?.message || error), state: publicView(state) })
        }
      }

      if (action === 'monitor') {
        const since = Number(body.since || 0)
        // 总开关关着的时候，阶段就固定显示「已关闭」，别让残留的「选片中」误导人
        const ph = state.paused
          ? { name: '已关闭', detail: '总开关关着，什么都不做', since: phase.since }
          : phase
        return sendJson(res, 200, {
          ok: true, seq: eventSeq, now: Date.now(),
          phase: { ...ph, elapsed: Date.now() - ph.since },
          events: events.filter((e) => e.seq > since).slice(-120),
        })
      }

      // 界面在放的时候每 20 秒报一次心跳：宿主节奏器看到心跳就**让位**，
      // 避免「界面刚开播 10 秒、宿主按自己的计时把它换掉」这种两边抢
      if (action === 'watch.ping') {
        state.watchPingAt = Date.now()
        await saveState(state)
        return sendJson(res, 200, { ok: true })
      }

      // 播完了 → 换下一条（界面自动播放、以及宿主自己的观看节奏器都走这里）
      if (action === 'next.video') {
        const items = state.lastRun || []
        if (!items.length) return sendJson(res, 200, { ok: false, error: '还没有选片，先跑一轮' })
        // 强制最短观看时长：没看够就先不换。
        // ⚠️ 短于门槛的片子**不重播**：门槛取 min(minWatchSec, 片子时长)，看满片子本就放行。
        const remain = remainingMinWatch(state, state.current?.duration)
        if (remain > 0) {
          return sendJson(res, 200, {
            ok: false, needMore: remain,
            error: `这条还没看够（还差 ${remain} 秒）`,
            state: publicView(state),
          })
        }
        // 只在「没看过的」里挑；队列真看完了就返回需要新一轮，绝不再从头循环重播
        const next = nextUnwatched(state, items)
        if (!next) {
          state.exhausted = true
          await saveState(state)
          log('info', '这一批都看过了，等下一轮选片')
          setPhase('空闲', '这一批看完了，等下一轮')
          return sendJson(res, 200, {
            ok: false, exhausted: true, error: '这一批都看过了', state: publicView(state),
          })
        }
        switchTo(state, next)
        await saveState(state)
        log('info', `换到下一个：${String(next.title).slice(0, 22)}`)
        setPhase('空闲', `正在看：${String(next.title).slice(0, 16)}`)
        return sendJson(res, 200, { ok: true, current: state.current, state: publicView(state) })
      }

      if (action === 'comments.learn') {
        log('info', '开始读评论区')
        setPhase('读评论中', '两条视频的评论区')
        try {
          const learned = await learnComments(state)
          await saveState(state)
          log('ok', `评论区：${learned.count} 条，平均 ${learned.avgLen} 字`)
          setPhase('空闲', `刚读完 ${learned.count} 条评论`)
          return sendJson(res, 200, { ok: true, commentLearn: learned, state: publicView(state) })
        } catch (error) {
          log('err', `读评论失败：${error?.message || error}`)
          setPhase('空闲', '读评论没成功')
          return sendJson(res, 200, { ok: false, error: String(error?.message || error), state: publicView(state) })
        }
      }

      if (action === 'master.lookup') {
        try {
          const card = await masterCard(String(state.masterUid || '').trim(), state.cookies)
          return sendJson(res, 200, { ok: true, card })
        } catch (error) {
          return sendJson(res, 200, { ok: false, error: String(error?.message || error) })
        }
      }

      if (action === 'interest.clear') {
        Object.assign(state, { interest: [], learnedAt: '', learnedFrom: '', learnedSamples: 0, learnedSources: [] })
        await saveState(state)
        return sendJson(res, 200, { ok: true, state: publicView(state) })
      }

      if (action === 'notes.add') {
        const text = String(body.text || '').trim()
        if (!text) return sendJson(res, 400, { error: '留言不能为空' })
        // 留言也加上限，否则长期使用会让 state.json 无限膨胀（200 条足够回溯）
        state.notes = [makeNote(text, ''), ...(state.notes || [])].slice(0, 200)
        await saveState(state)
        return sendJson(res, 200, { ok: true, state: publicView(state) })
      }

      if (action === 'notes.update') {
        const id = String(body.id || '')
        const note = (state.notes || []).find((n) => n.id === id)
        if (!note) return sendJson(res, 404, { error: '没有这条留言' })
        const p = body.patch || {}
        if (p.status) note.status = String(p.status)
        if ('reply' in p) note.reply = String(p.reply)
        await saveState(state)
        return sendJson(res, 200, { ok: true, state: publicView(state) })
      }

      if (action === 'notes.remove') {
        const id = String(body.id || '')
        state.notes = (state.notes || []).filter((n) => n.id !== id)
        await saveState(state)
        return sendJson(res, 200, { ok: true, state: publicView(state) })
      }

      if (action === 'login.start') {
        const qr = await qrGenerate(state)
        await saveState(state)
        log('info', '已生成发言号登录二维码，等扫码')
        return sendJson(res, 200, { ok: true, ...qr, state: publicView(state) })
      }

      if (action === 'login.poll') {
        const result = await qrPoll(state)
        await saveState(state)
        if (result.status === 'ok') log('ok', `发言号登录成功：UID ${result.accountUid || '?'}`)
        if (result.status === 'expired') log('warn', '二维码过期了')
        return sendJson(res, 200, { ok: true, result, state: publicView(state) })
      }

      if (action === 'logout') {
        state.cookies = {}
        state.login = { ...EMPTY_LOGIN }
        await saveState(state)
        log('info', '发言号已退出')
        return sendJson(res, 200, { ok: true, state: publicView(state) })
      }

      if (action === 'run') {
        // 连播自己发起的那一轮：锁是它自己先占好的，跳过检查，别自己挡自己
        const fromCruise = body.cruise === true
        // 防叠加：进程内锁优先（内存里的判定是同步的，不会被并发绕过）
        if (!fromCruise) {
          if (runLock.busySince && Date.now() - runLock.busySince < 6 * 60_000) {
            return sendJson(res, 200, {
              ok: false, error: `上一轮还在跑（${Math.round((Date.now() - runLock.busySince) / 1000)} 秒）`,
              state: publicView(state),
            })
          }
          const since = Number(state.runningSince || 0)
          if (since && Date.now() - since < 6 * 60_000) {
            return sendJson(res, 200, {
              ok: false, error: `上一轮还在跑（${Math.round((Date.now() - since) / 1000)} 秒）`,
              state: publicView(state),
            })
          }
        }
        runLock.busySince = Date.now()
        state.runningSince = Date.now()
        // 立刻落盘占位，跨重启也能看出上一轮没跑完
        try { await saveState(state) } catch {}
        try {
        const blocked = guardBudget(state)
        if (blocked) {
          log('warn', `本轮被拦：${blocked}`)
          if (/评论额度/.test(blocked)) {
            const cqb = commentQuota(state)
            setPhase('评论额度用完', `今日 ${cqb.used}/${cqb.cap} 条 · 明日 00:00 继续`)
          }
          return sendJson(res, 200, { ok: false, error: blocked, state: publicView(state) })
        }
        const q = quotaView(state)
        const perItem = Number(state.tokenPerItem ?? 1200)
        const maxResume = Number(state.maxResume ?? 2)
        const runTokens = Math.min(q.runTokens || q.remainingTokens, q.remainingTokens)
        let target = Math.max(1, Math.min(
          Number(state.targetCount ?? 12),
          Math.floor(runTokens / perItem),
        ))

        // 续接：上一轮没跑完就补缺口，超过 maxResume 就放弃重来
        let resumed = false
        let attempts = 0
        if (state.pending) {
          attempts = Number(state.pending.attempts || 0)
          if (attempts < maxResume) {
            resumed = true
            attempts += 1
            target = Math.max(1, Math.min(target, Number(state.pending.remaining || target)))
            log('info', `续接上一轮：还差 ${state.pending.remaining} 条（第 ${attempts}/${maxResume} 次）`)
          } else {
            log('warn', `续接已 ${attempts}/${maxResume} 次到顶，放弃缺口重新开始`)
            state.pending = null
            attempts = 0
          }
        }

        log('info', `开始选片（${q.discounted ? '谷时' : '峰时'} ${q.clock} · 目标 ${target} 条 · 单次额度 ${runTokens} tokens）`)
        setPhase('选片中', `目标 ${target} 条 · ${q.discounted ? '谷时' : '峰时'}`)
        const { items, queries, planned } = await pickVideos(state, target)
        state.lastRun = items
        state.lastRunAt = new Date().toISOString()
        state.runsToday += 1
        state.mentionPlanned = planned

        // 轮转到下一条内容：看完就换，没内容就置空
        const cur = advanceCurrent(state, items)
        if (cur) log('info', `正在看：${cur.title.slice(0, 22)}`)

        // ⚠️ 记账改成「真实用量」：等这轮所有模型调用都跑完，在 finally 里统一结算
        //    （以前是 items.length × 1200 估算，连播每 45 秒跑一轮也在记账，
        //     98 轮就把额度烧光了，而且和真实花费差很远）。
        //    这一轮的记账在下面 finally 里做，见 settleRun 注释。

        // 没跑够就挂起，下次接着补；够数就清掉
        if (items.length >= target) {
          state.pending = null
        } else {
          state.pending = {
            remaining: Math.max(0, target - items.length),
            // 新一轮从 0 起算；续接过的次数在下次进入时 +1
            attempts: resumed ? attempts : 0,
            at: new Date().toISOString(),
          }
        }

        // 按概率自动去学，不需要人工触发
        let autoLearned = null
        if (Math.random() < Number(state.learnChance ?? 0.35)) {
          try {
            const l = await learn(state, llm, currentRoute())
            autoLearned = { samples: l.samples, sources: l.sources }
            log('ok', `自动学习命中：${l.samples} 条样本 · ${l.sources.join('；')}`)
          } catch (e) {
            log('warn', `自动学习没学成：${e.message}`)
          }
        }

        // 评论区语气：每轮自动刷新一次
        let tone = null
        try {
          const c = await learnComments(state)
          tone = { count: c.count, avgLen: c.avgLen, emojiRate: c.emojiRate }
          log('ok', `评论语气已更新：${c.count} 条 · 平均 ${c.avgLen} 字`)
        } catch (e) {
          log('info', `评论语气暂不可用：${e.message}`)
        }

        // 按评论区模式走一遍（draft=只备草稿 / auto=直接发 / check-auto=自检后发）
        let autoComment = null
        if (state.commentMode && state.commentMode !== 'off') {
          setPhase('评论流程中', state.commentMode)
          try {
            autoComment = await runAutoComment(state, llm, currentRoute(), cur, attachments)
            if (autoComment?.sent) log('ok', `自动评论已发出（rpid ${autoComment.sent}）`)
            else if (autoComment?.held) log('warn', `自检未过：${autoComment.held}`)
            else if (autoComment?.error) log('err', `自动评论失败：${autoComment.error}`)
            else if (autoComment?.skipped) log('info', `本轮不评：${autoComment.skipped}`)
          } catch (e) {
            log('warn', `自动评论流程异常：${e.message}`)
          }
        }

        // 有人回复我的评论 → 按概率接一条
        let replyFlow = null
        if (state.commentMode && state.commentMode !== 'off') {
          try {
            replyFlow = await runReplyFlow(state, llm, currentRoute())
            if (replyFlow?.replied) log('ok', `已接回复（rpid ${replyFlow.replied}）`)
            else if (replyFlow?.skipped) log('info', `回复处理：${replyFlow.skipped}`)
            else if (replyFlow?.error) log('warn', `接回复失败：${replyFlow.error}`)
          } catch (e) {
            log('warn', `回复流程异常：${e.message}`)
          }
        }

        autoNotes(state)
        await saveState(state)
        setPhase('空闲', `上一轮 ${items.length} 条${state.pending ? `，还差 ${state.pending.remaining}` : ''}`)
        log('ok', `选到 ${items.length} 条（目标 ${target}），计划 @ ${planned} 条，今日 ${state.tokensUsedToday} tokens ≈ ¥${state.spentToday.toFixed(2)}${state.pending ? ` · 还差 ${state.pending.remaining} 条待续` : ''}`)
        return sendJson(res, 200, {
          ok: true, items, queries, planned, autoLearned, tone, autoComment, replyFlow, state: publicView(state),
        })
        } finally {
          // 无论成功失败都要收尾，否则下一轮永远被"还在跑"挡住
          runLock.busySince = 0
          state.runningSince = 0

          // 结算这一轮**真实**花掉的 token（由 meteredStream 累加）
          const used = tokenMeter.snapshot()
          tokenMeter.reset()
          state.tokensUsedThisRun = used.total
          if (used.total > 0) {
            state.tokensUsedToday = Number(state.tokensUsedToday || 0) + used.total
            state.spentToday = Number((state.tokensUsedToday * priceInfo(state).perToken).toFixed(4))
            state.lastRunUsage = {
              input: used.input, output: used.output, total: used.total,
              calls: used.calls, at: new Date().toISOString(),
            }
            log('info', `本轮真实消耗 ${used.total} tokens（输入 ${used.input} / 输出 ${used.output}，${used.calls} 次调用）`)
          } else {
            // 一次模型都没调（比如额度用完了、没选到新片）→ 不记账
            state.lastRunUsage = { input: 0, output: 0, total: 0, calls: 0, at: new Date().toISOString() }
          }

          const gapMs = Math.max(10, Number(state.cruiseGapSec ?? 45)) * 1000
          // 被"评论额度用完"拦下来的，别把下一拍设成 45 秒后（那会立刻又空跑一趟），直接排到明天
          const cqNow = commentQuota(state)
          if (cqNow.reached) {
            state.nextRunAt = nextBeijingMidnight()
            state.capBlockedDay = today()
          } else {
            state.nextRunAt = Date.now() + gapMs
          }
          try { await saveState(state) } catch {}
          if (String(phase.name) === '选片中' || String(phase.name) === '连播中') {
            setPhase('空闲', '这一趟结束了')
          }
        }
      }

      if (action === 'video.info') {
        const bvid = String(body.bvid || '').trim()
        if (!/^BV[0-9A-Za-z]{10}$/.test(bvid)) return sendJson(res, 400, { error: 'bad bvid' })
        try {
          const j = await getJson(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, state.cookies)
          if (j?.code !== 0) throw new Error(j?.message || j?.code)
          const d = j.data || {}
          return sendJson(res, 200, {
            ok: true,
            video: {
              bvid,
              title: d.title || '',
              cover: d.pic || '',
              author: d.owner?.name || '',
              duration: d.duration || 0,
              cid: d.cid || d.pages?.[0]?.cid || 0,
              play: d.stat?.view || 0,
              like: d.stat?.like || 0,
              desc: String(d.desc || '').slice(0, 120),
            },
          })
        } catch (error) {
          return sendJson(res, 200, { ok: false, error: String(error?.message || error) })
        }
      }

      if (action === 'diag') {
        let electron = null
        try {
          const mod = await import('electron')
          const api = mod.default || mod
          electron = {
            hasBrowserWindow: Boolean(api.BrowserWindow),
            hasWebContentsView: Boolean(api.WebContentsView),
            hasSession: Boolean(api.session),
            hasApp: Boolean(api.app),
            sample: Object.keys(api).slice(0, 10),
          }
        } catch (error) {
          electron = { error: String(error?.message || error) }
        }
        return sendJson(res, 200, {
          ok: true,
          node: process.versions.node,
          electronVersion: process.versions.electron || null,
          chrome: process.versions.chrome || null,
          platform: process.platform,
          electron,
        })
      }

      if (action === 'comment.draft') {
        const bvid = String(body.bvid || '').trim()
          || (state.lastRun?.[0]?.bvid ?? '')
        if (!/^BV[0-9A-Za-z]{10}$/.test(bvid)) {
          return sendJson(res, 200, { ok: false, error: '先跑一轮，或指定一个 bvid' })
        }
        try {
          const v = await videoBrief(state, bvid)
          setPhase('拟评论中', '读评论区')
          const comments = await fetchComments(state, v.aid, 15)
          setPhase('拟评论中', '看视频讲了什么')
          const digest = await videoDigest(state, v, llm, currentRoute(), attachments)
          setPhase('拟评论中', `素材 ${digest.layer} · 结合 ${comments.length} 条评论`)
          let text = buildDraftText(state, v)
          let source = 'template'
          const ai = await composeComment(llm, currentRoute(), state, v, comments, digest)
          if (ai) { text = ai; source = 'model' }
          const atName = await decideMention(state, v, digest)
          setPhase('空闲', source === 'model' ? '评论已拟好' : '模型不可用，用了模板')
          const draft = {
            id: makeDraftId(), bvid, aid: v.aid, title: v.title, author: v.author,
            text, at: new Date().toISOString(), status: 'ready', source,
            seenComments: comments.length, atName, material: digest.layer, digest,
          }
          state.drafts = [draft, ...(state.drafts || [])].slice(0, 20)
          log('info', `生成草稿（${source === 'model' ? '模型' : '模板'}）：${draft.text.slice(0, 24)}…`)
          const outcome = await finalizeDraft(state, llm, currentRoute(), v, draft)
          await saveState(state)
          setPhase('空闲', outcome.sent ? '已自动发出' : (outcome.held ? '自检未过' : '草稿待确认'))
          return sendJson(res, 200, { ok: !outcome.error, ...outcome, draft, state: publicView(state) })
        } catch (error) {
          setPhase('空闲', '草稿生成失败')
          return sendJson(res, 200, { ok: false, error: String(error?.message || error) })
        }
      }

      if (action === 'comment.update') {
        const d = (state.drafts || []).find((x) => x.id === body.id)
        if (!d) return sendJson(res, 404, { error: '草稿不存在' })
        d.text = String(body.text ?? d.text).slice(0, 200)
        await saveState(state)
        return sendJson(res, 200, { ok: true, state: publicView(state) })
      }

      if (action === 'comment.drop') {
        state.drafts = (state.drafts || []).filter((x) => x.id !== body.id)
        await saveState(state)
        return sendJson(res, 200, { ok: true, state: publicView(state) })
      }

      if (action === 'comment.clearDrafts') {
        const n = (state.drafts || []).length
        state.drafts = []
        await saveState(state)
        log('info', `清空草稿队列（${n} 条）`)
        return sendJson(res, 200, { ok: true, cleared: n, state: publicView(state) })
      }

      if (action === 'comment.send') {
        const d = (state.drafts || []).find((x) => x.id === body.id)
        if (!d) return sendJson(res, 404, { error: '草稿不存在' })
        const r = await deliverComment(state, d)
        await saveState(state)
        return sendJson(res, 200, { ...r, state: publicView(state) })
      }

      if (action === 'comment.dryrun') {
        const d = (state.drafts || [])[0]
        return sendJson(res, 200, {
          ok: true,
          hasJct: Boolean(state.cookies?.bili_jct),
          hasSess: Boolean(state.cookies?.SESSDATA),
          draft: d ? { id: d.id, bvid: d.bvid, aid: d.aid, text: d.text } : null,
          mode: state.commentMode,
          sentToday: state.commentedToday || 0,
          cap: state.commentDailyCap ?? 3,
        })
      }

      if (action === 'comment.debug') {
        const keys = Object.keys(state.cookies || {})
        let nav = null
        try {
          const j = await getJson('https://api.bilibili.com/x/web-interface/nav', state.cookies)
          nav = { code: j?.code, isLogin: j?.data?.isLogin, mid: j?.data?.mid, uname: j?.data?.uname }
        } catch (error) {
          nav = { error: String(error?.message || error) }
        }
        return sendJson(res, 200, {
          ok: true,
          nav,
          jctLength: String(state.cookies?.bili_jct || '').length,
          sessdataHasPercent: String(state.cookies?.SESSDATA || '').includes('%'),
          sessdataHasComma: String(state.cookies?.SESSDATA || '').includes(','),
          keys: keys.map((k) => ({
            key: k,
            len: String(state.cookies[k] || '').length,
            hasPercent: String(state.cookies[k] || '').includes('%'),
          })),
        })
      }

      if (action === 'comment.csrfcheck') {
        // 用一个几乎不可能存在的 rpid 调删除接口：csrf 通就会得到 code 0，不通才是 -111
        const aid = Number(body.aid || 0)
        if (!aid) return sendJson(res, 400, { error: 'need aid' })
        try {
          const form = new URLSearchParams()
          form.set('type', '1')
          form.set('oid', String(aid))
          form.set('rpid', '999999999999')
          form.set('csrf', String(state.cookies?.bili_jct || ''))
          const page = body.bvid
            ? `https://www.bilibili.com/video/${body.bvid}`
            : 'https://www.bilibili.com/'
          const anon = await anonCookies()
          const cookieStr = Object.entries(state.cookies).map(([k, v]) => `${k}=${v}`).join('; ')
          const headers = {
            'user-agent': UA,
            origin: 'https://www.bilibili.com',
            referer: page,
            accept: 'application/json, text/plain, */*',
            'content-type': 'application/x-www-form-urlencoded',
            cookie: anon ? `${cookieStr}; ${anon}` : cookieStr,
          }
          const resp = await fetch('https://api.bilibili.com/x/v2/reply/del', {
            method: 'POST', headers, body: form.toString(),
            signal: AbortSignal.timeout(15000),
          })
          const j = await resp.json()
          return sendJson(res, 200, {
            ok: j?.code !== -111,
            code: j?.code,
            message: j?.message,
            verdict: j?.code === -111 ? 'csrf 仍然不通过' : 'csrf 通过（这个错误来自 rpid 不存在，属正常）',
          })
        } catch (error) {
          return sendJson(res, 200, { ok: false, error: String(error?.message || error) })
        }
      }

      if (action === 'comment.csrfprobe') {
        const aid = Number(body.aid || 0)
        if (!aid) return sendJson(res, 400, { error: 'need aid' })
        const jct = String(state.cookies?.bili_jct || '')
        const anon = await anonCookies()
        const results = []

        const run = async (label, { cookieOverride, extraQuery, extraHeaders } = {}) => {
          try {
            const form = new URLSearchParams()
            form.set('type', '1')
            form.set('oid', String(aid))
            form.set('rpid', '999999999999')
            form.set('csrf', jct)
            let url = 'https://api.bilibili.com/x/v2/reply/del'
            if (extraQuery) url += `?${extraQuery}`
            const headers = {
              'user-agent': UA,
              origin: 'https://www.bilibili.com',
              referer: `https://www.bilibili.com/video/BV1xx411c7mD`,
              accept: 'application/json, text/plain, */*',
              'content-type': 'application/x-www-form-urlencoded',
              cookie: cookieOverride || `${Object.entries(state.cookies).map(([k, v]) => `${k}=${v}`).join('; ')}${anon ? `; ${anon}` : ''}`,
              ...(extraHeaders || {}),
            }
            const resp = await fetch(url, { method: 'POST', headers, body: form.toString(), signal: AbortSignal.timeout(15000) })
            const j = await resp.json()
            results.push({ label, code: j?.code, message: j?.message })
          } catch (error) {
            results.push({ label, error: String(error?.message || error) })
          }
        }

        const full = Object.entries(state.cookies).map(([k, v]) => `${k}=${v}`).join('; ')
        const minimal = ['SESSDATA', 'bili_jct', 'DedeUserID']
          .filter((k) => state.cookies[k])
          .map((k) => `${k}=${state.cookies[k]}`)
          .join('; ')

        await run('A 当前实现')
        await run('B csrf 也放 query', { extraQuery: `csrf=${encodeURIComponent(jct)}` })
        await run('C 只发三个 cookie + buvid', { cookieOverride: `${minimal}${anon ? `; ${anon}` : ''}` })
        await run('D 只发三个 cookie 不带 buvid', { cookieOverride: minimal })
        await run('E 完整 cookie 不带 buvid', { cookieOverride: full })

        return sendJson(res, 200, { ok: true, jctLength: jct.length, results })
      }

      if (action === 'focus.set') {
        const bvid = String(body.bvid || '').trim()
        if (!/^BV[0-9A-Za-z]{10}$/.test(bvid)) return sendJson(res, 400, { error: 'bad bvid' })
        const it = (state.lastRun || []).find((x) => x.bvid === bvid)
        state.current = it
          ? { bvid: it.bvid, title: it.title || '', author: it.author || '', source: it.source || '', at: new Date().toISOString() }
          : { bvid, title: '', author: '', source: 'manual', at: new Date().toISOString() }
        const idx = (state.lastRun || []).findIndex((x) => x.bvid === bvid)
        if (idx >= 0) state.cursor = idx + 1
        await saveState(state)
        return sendJson(res, 200, { ok: true, current: state.current, state: publicView(state) })
      }

      if (action === 'focus.clear') {
        state.current = null
        await saveState(state)
        return sendJson(res, 200, { ok: true, state: publicView(state) })
      }

      if (action === 'history.report') {
        const bvid = String(body.bvid || '').trim()
        const progress = Math.max(1, Math.round(Number(body.progress || 0)))
        if (!/^BV[0-9A-Za-z]{10}$/.test(bvid)) return sendJson(res, 400, { error: 'bad bvid' })
        // 顺带记下「看到哪儿了」——画面快照要靠它判断后面还有没有弹幕，不额外发请求
        state.watchPosition = { bvid, at: progress, ts: Date.now() }
        if (!state.cookies?.bili_jct) {
          await saveState(state)
          return sendJson(res, 200, { ok: false, error: '未登录' })
        }
        try {
          const view = await videoBrief(state, bvid)
          const full = await getJson(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, state.cookies)
          const cid = full?.data?.cid
          if (!cid) throw new Error('拿不到 cid')
          const form = new URLSearchParams()
          form.set('aid', String(view.aid))
          form.set('cid', String(cid))
          form.set('progress', String(progress))
          form.set('type', '3')
          form.set('csrf', String(state.cookies.bili_jct))
          // 与评论写入同理：不要带 accept-language，否则 B站 判参数非法
          const anon = await anonCookies()
          const cookieStr = Object.entries(state.cookies).map(([k, v]) => `${k}=${v}`).join('; ')
          const headers = {
            'user-agent': UA,
            origin: 'https://www.bilibili.com',
            referer: `https://www.bilibili.com/video/${bvid}`,
            accept: 'application/json, text/plain, */*',
            'content-type': 'application/x-www-form-urlencoded',
            cookie: anon ? `${cookieStr}; ${anon}` : cookieStr,
          }
          const r = await fetch('https://api.bilibili.com/x/v2/history/report', {
            method: 'POST', headers, body: form.toString(),
            signal: AbortSignal.timeout(15000),
          })
          const j = await r.json()
          if (j?.code !== 0) throw new Error(j?.message || `code ${j?.code}`)
          return sendJson(res, 200, { ok: true, progress })
        } catch (error) {
          return sendJson(res, 200, { ok: false, error: String(error?.message || error) })
        }
      }

      return sendJson(res, 400, { error: `unknown action: ${action}` })
    } catch (error) {
      return sendJson(res, 500, { error: String(error?.message || error) })
    }
  }

  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: API_PATH, handler }))

  // 连播巡航：一趟跑完只隔 cruiseGapSec 秒就自己开下一趟，不再整小时空等
  ctx.effect(() => {
    // 上一次进程被杀时留下的"运行中"标记，开机清掉，否则会被当成一直在跑
    ;(async () => {
      try {
        await cleanupStaleTmp()
        const st = await loadState()
        if (st.runningSince) {
          st.runningSince = 0
          st.nextRunAt = 0
          await saveState(st)
        }
      } catch {}
    })()
    const id = setInterval(async () => {
      try {
        const state = await loadState()
        if (!state.autoRun || state.paused) return
        const gap = Math.max(10, Number(state.cruiseGapSec ?? 45))
        const gapMs = gap * 1000

        // 有一轮在跑：没超时就等着，超时（6 分钟）判定卡死并回收
        const running = Number(state.runningSince || 0)
        if (running && Date.now() - running < 6 * 60_000) return
        if (running) {
          log('warn', '上一轮卡超过 6 分钟，判定卡死，清掉重来')
          state.runningSince = 0
          state.nextRunAt = 0
          await saveState(state)
        }

        // 评论额度满了：整轮都不开，直接睡到明天 0 点。
        // 以前这里只拦"发评论"，连播仍然每 45 秒选一次片 —— 一天空转上百轮、全是白请求。
        const cq = commentQuota(state)
        if (cq.reached) {
          const next = nextBeijingMidnight()
          const firstTimeToday = state.capBlockedDay !== today()
          if (Number(state.nextRunAt || 0) !== next || firstTimeToday) {
            state.nextRunAt = next
            state.capBlockedDay = today()
            await saveState(state)
            setPhase('评论额度用完', `今日 ${cq.used}/${cq.cap} 条 · 明日 00:00 继续`)
            // 一天只记一条，别每 5 秒刷一次事件流
            if (firstTimeToday) log('info', `评论额度用完（${cq.used}/${cq.cap}），连播睡到明天 00:00，不再空转`)
          }
          return
        }

        const due = Number(state.nextRunAt || 0)
          || (Number(state.lastAutoRunAt || 0) + gapMs)
        if (Date.now() < due) return

        let base = ''
        try { base = ctx.webServer.getOrigin() } catch {}
        if (!base) return

        // 先占位再发请求：即使请求挂掉，也不会下一拍又重复触发
        state.lastAutoRunAt = Date.now()
        state.runningSince = Date.now()
        state.nextRunAt = Date.now() + gapMs
        await saveState(state)
        setPhase('连播中', '自己开跑下一趟')

        let out = null
        try {
          const r = await fetch(`${base}${API_PATH}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: 'run', cruise: true }),
            signal: AbortSignal.timeout(180_000),
          })
          out = await r.json().catch(() => null)
        } catch (error) {
          log('warn', `连播请求没回来：${error?.message || error}`)
        }

        const fresh = await loadState()
        fresh.runningSince = 0
        fresh.nextRunAt = Date.now() + gapMs
        if (out?.error && /评论额度/.test(out.error)) {
          fresh.nextRunAt = nextBeijingMidnight()
          fresh.capBlockedDay = today()
          await saveState(fresh)
          setPhase('评论额度用完', out.error)
          log('info', `连播睡到明天 00:00：${out.error}`)
          return
        }
        // ⚠️ 这里以前是「额度用完就 autoRun=false 永久停下」——
        //    然后你调大预算，却没人把它重新打开，插件就一直躺着不动，
        //    表现就是"改了预算没有任何正向反馈"。现在改成：
        //    不关连播，只把下一次推迟到 10 分钟后，期间随时改预算/到点自动恢复。
        if (out?.error && /额度/.test(out.error)) {
          fresh.nextRunAt = Date.now() + 10 * 60_000
          fresh.budgetBlockedAt = Date.now()
          await saveState(fresh)
          setPhase('额度用完', out.error)
          log('warn', `额度用完，10 分钟后再试（改大预算会立刻恢复）：${out.error}`)
          return
        }
        // 没登录也一样等，但不关连播：扫码成功后自己接着跑（每 5 分钟探一次，别刷屏）
        if (out?.error && /登录/.test(out.error)) {
          fresh.nextRunAt = Date.now() + 5 * 60_000
          await saveState(fresh)
          setPhase('等登录', out.error)
          log('warn', `连播暂停：${out.error}`)
          return
        }
        await saveState(fresh)
        if (out?.error) log('warn', `连播被拦：${out.error}`)
        if (String(phase.name) === '连播中') {
          setPhase('空闲', `下次 ${gap} 秒后接着跑`)
        }
      } catch (error) {
        log('warn', `连播异常：${error?.message || error}`)
        try { setPhase('空闲', '连播出错，已恢复') } catch {}
      }
    }, 5_000)
    return () => clearInterval(id)
  })

  // 观看节奏器：没人盯着的时候也不能一直停在同一部片子上。
  // ⚠️ 以前这里要求 `items.length >= 2`，队列只剩 1 条时**压根不换**，
  //    加上「只在播到真正片尾才换」，长视频就会一直播下去 —— 这是"超过 5 分钟还没换"的成因之一。
  ctx.effect(() => {
    const id = setInterval(async () => {
      try {
        const state = await loadState()
        if (!state.autoRun || state.paused) return
        if (!state.autoWatch) return
        if (!state.current) return
        // 界面正在播（20 秒内有心跳）→ 让位，交给界面自己到点换，别两边抢
        if (Date.now() - Number(state.watchPingAt || 0) < 25_000) return
        const dwell = Math.max(30, Number(state.dwellSec ?? 300)) * 1000
        const since = Number(state.currentSince || 0) || Date.parse(state.current.at || '') || 0
        if (!since || Date.now() - since < dwell) return

        // 到点了先看这批里还有没有没看过的
        const items = state.lastRun || []
        // 最短观看时长同样约束这里：节奏器也不能比门槛更早把片子换掉
        if (remainingMinWatch(state, state.current?.duration) > 0) return
        const next = nextUnwatched(state, items)
        if (next) {
          switchTo(state, next)
          await saveState(state)
          log('info', `换到下一个：${String(next.title).slice(0, 22)}`)
          return
        }
        // 这批看光了：不重播，标记"当前为空"，等连播跑下一轮选片
        state.exhausted = true
        state.current = null
        state.currentSince = 0
        await saveState(state)
        log('info', '这一批都看过了，等下一轮选片')
      } catch {}
    }, 5_000)
    return () => clearInterval(id)
  })
}
