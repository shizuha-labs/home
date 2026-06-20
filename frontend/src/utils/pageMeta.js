export function setPageMeta({ title, description, ogTitle = title, ogDescription = description }) {
  if (typeof document === 'undefined') return
  document.title = title

  const setMeta = (selector, attrs) => {
    let el = document.head.querySelector(selector)
    if (!el) {
      el = document.createElement('meta')
      Object.entries(attrs.create || {}).forEach(([k, v]) => el.setAttribute(k, v))
      document.head.appendChild(el)
    }
    Object.entries(attrs.set || {}).forEach(([k, v]) => el.setAttribute(k, v))
  }

  setMeta('meta[name="description"]', { create: { name: 'description' }, set: { content: description } })
  setMeta('meta[property="og:title"]', { create: { property: 'og:title' }, set: { content: ogTitle } })
  setMeta('meta[property="og:description"]', { create: { property: 'og:description' }, set: { content: ogDescription } })
  setMeta('meta[name="twitter:title"]', { create: { name: 'twitter:title' }, set: { content: ogTitle } })
  setMeta('meta[name="twitter:description"]', { create: { name: 'twitter:description' }, set: { content: ogDescription } })
}
