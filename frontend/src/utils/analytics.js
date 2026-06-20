export function trackResearchEvent(name, payload = {}) {
  if (typeof window === 'undefined') return
  const event = { name, payload, ts: new Date().toISOString() }
  window.dispatchEvent(new CustomEvent('shizuha:research-intent', { detail: event }))
  window.dataLayer?.push?.({ event: name, ...payload })
  window.gtag?.('event', name, payload)
  if (import.meta.env.DEV) {
    console.debug('[research-intent]', event)
  }
}
