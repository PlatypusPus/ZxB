import { useEffect, useRef, useState } from 'react'

// Live auction state over one WebSocket. Every server message carries the full snapshot,
// so a dropped phone recovers on reconnect with one message. server_now fixes wrong phone clocks.
let offset = 0
export const serverNow = () => Date.now() + offset

export function useAuction() {
  const [snap, setSnap] = useState(null)
  const [event, setEvent] = useState(null)
  const [online, setOnline] = useState(false)
  useEffect(() => {
    let ws, dead = false, retry = 0, timer
    const connect = () => {
      ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/v1/ws`)
      ws.onopen = () => { retry = 0; setOnline(true) }
      ws.onmessage = e => {
        const m = JSON.parse(e.data)
        offset = m.snapshot.server_now * 1000 - Date.now()
        setSnap(m.snapshot)
        setEvent({ ...m, snapshot: undefined, at: performance.now() })
      }
      ws.onclose = () => {
        setOnline(false)
        if (!dead) timer = setTimeout(connect, Math.min(5000, 400 * 2 ** retry++))
      }
    }
    connect()
    return () => { dead = true; clearTimeout(timer); ws?.close() }
  }, [])
  return { snap, event, online }
}

// Seconds left on the open lot, re-rendered 10x a second.
export function useCountdown(lot) {
  const [, tick] = useState(0)
  useEffect(() => { const id = setInterval(() => tick(n => n + 1), 100); return () => clearInterval(id) }, [])
  if (!lot) return null
  if (lot.paused_remaining != null) return lot.paused_remaining
  if (!lot.timer_end) return null
  return Math.max(0, lot.timer_end - serverNow() / 1000)
}

// Remember the last value across renders (for "was I outbid?" style comparisons).
export function usePrevious(v) {
  const r = useRef()
  useEffect(() => { r.current = v })
  return r.current
}
