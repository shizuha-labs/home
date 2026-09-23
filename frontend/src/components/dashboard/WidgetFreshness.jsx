/** Observation time belongs to the retained snapshot, never the failed refresh. */
export default function WidgetFreshness({ widget, compact = false }) {
  if (widget?.status !== 'stale') return null
  const date = widget.as_of && new Date(widget.as_of)
  const asOf = date && Number.isFinite(date.getTime()) ? date.toLocaleString() : null
  return (
    <span className="text-xs text-gray-500 dark:text-gray-400" title={asOf ? `Cached data as of ${asOf}` : 'Last available data'}>
      {compact ? ' · cached' : 'Last available data'}
      {!compact && asOf && <> · <time dateTime={widget.as_of}>{asOf}</time></>}
    </span>
  )
}
