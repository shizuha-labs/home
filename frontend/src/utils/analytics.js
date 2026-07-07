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

export function trackPlausibleEvent(name, props = {}, options = {}) {
  if (typeof window === 'undefined' || typeof window.plausible !== 'function') return
  const cleanProps = Object.fromEntries(
    Object.entries(props).filter(([, value]) => value !== undefined && value !== null && value !== '')
  )
  try {
    window.plausible(name, {
      ...options,
      props: cleanProps,
    })
  } catch {
    // Best-effort analytics only; never block user flows.
  }
}
