import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ChevronDown, Coffee, Edit3, Filter, LogIn, LogOut, MapPin, Plus, Search, ShieldCheck, Trash2, X } from 'lucide-react'
import { AttributionControl, LngLatBounds, Map, Marker, NavigationControl, Popup } from 'maplibre-gl'
import type { Map as MapLibreMap } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import './App.css'

const mugTypes = ['Country', 'State', 'City', 'Places', 'Film', 'Old Collection', 'Special'] as const
const mugsPerPage = 10
type MugType = (typeof mugTypes)[number]
type Mug = { id: string; title: string; type: MugType; series: number | 'N/A'; additionalInfo?: string; locationName?: string; latitude?: number; longitude?: number; primaryImageUrl: string; secondaryImageUrl?: string }
type AdminSession = { authenticated: boolean; authorized: boolean; email?: string }
type MugDraft = { title: string; type: MugType; series: string; additionalInfo: string; locationName: string; latitude: string; longitude: string }
type GeocodeResult = { id: string; label: string; latitude: number; longitude: number; confidence?: string; type?: string }

const emptyDraft: MugDraft = { title: '', type: 'City', series: '', additionalInfo: '', locationName: '', latitude: '', longitude: '' }

function GitHubIcon() {
  return <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .7a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2.23c-3.22.7-3.9-1.37-3.9-1.37-.52-1.34-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.57-.29-5.27-1.28-5.27-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.47.11-3.05 0 0 .97-.31 3.16 1.18a10.9 10.9 0 0 1 5.76 0c2.2-1.49 3.16-1.18 3.16-1.18.63 1.58.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.71 5.38-5.29 5.67.42.36.79 1.06.79 2.14v3.26c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .7Z" /></svg>
}

function CollectionMap({ mugs }: { mugs: Mug[] }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const markersRef = useRef<Marker[]>([])
  const mappedMugs = useMemo(() => mugs.filter((mug) => mug.latitude !== undefined && mug.longitude !== undefined), [mugs])

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = new Map({
      container: containerRef.current,
      center: [0, 20],
      zoom: 1.15,
      minZoom: 1,
      attributionControl: false,
      style: { version: 8, sources: { streets: { type: 'raster', tileSize: 256, tiles: ['/api/maps/tiles/{z}/{x}/{y}?language=en-US'], attribution: 'Map data &copy; Microsoft' } }, layers: [{ id: 'streets', type: 'raster', source: 'streets' }] },
    })
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right')
    map.addControl(new AttributionControl({ compact: true }))
    mapRef.current = map
    return () => { mapRef.current?.remove(); mapRef.current = null }
  }, [])

  useEffect(() => {
    if (!mapRef.current) return
    markersRef.current.forEach((marker) => marker.remove())
    markersRef.current = mappedMugs.map((mug) => {
      const element = document.createElement('button')
      element.className = 'map-marker'
      element.type = 'button'
      element.title = `${mug.title}, ${mug.locationName ?? mug.type}`
      element.setAttribute('aria-label', element.title)
      element.innerHTML = '<span></span>'
      return new Marker({ element }).setLngLat([mug.longitude!, mug.latitude!]).setPopup(new Popup({ offset: 18 }).setText(`${mug.title} - ${mug.locationName ?? mug.type}`)).addTo(mapRef.current!)
    })
    if (mappedMugs.length === 1) mapRef.current.flyTo({ center: [mappedMugs[0].longitude!, mappedMugs[0].latitude!], zoom: 4 })
    if (mappedMugs.length > 1) {
      const bounds = new LngLatBounds()
      mappedMugs.forEach((mug) => bounds.extend([mug.longitude!, mug.latitude!]))
      mapRef.current.fitBounds(bounds, { padding: 72, maxZoom: 5 })
    }
  }, [mappedMugs])

  return <section className="map-band" aria-labelledby="map-heading"><div className="section-heading"><div><p className="eyebrow">From shelf to skyline</p><h2 id="map-heading">Collected around the world</h2></div><span className="map-count"><MapPin size={17} /> {mappedMugs.length} mapped</span></div><div className="map-shell"><div ref={containerRef} className="map" aria-label="Interactive map of mug locations" />{mappedMugs.length === 0 && <div className="map-empty"><MapPin size={24} /><span>Locations will appear here as mugs are added.</span></div>}</div></section>
}

function MugDetails({ mug, onClose }: { mug: Mug; onClose: () => void }) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  return <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}><section className="dialog mug-details-dialog" role="dialog" aria-modal="true" aria-labelledby="mug-details-title" onMouseDown={(event) => event.stopPropagation()}><header className="dialog-header"><div><p className="eyebrow">Mug details</p><h2 id="mug-details-title">{mug.title}</h2></div><button className="icon-button" type="button" onClick={onClose} title="Close mug details" aria-label="Close mug details"><X /></button></header><div className={`mug-details-gallery${mug.secondaryImageUrl ? ' has-secondary' : ''}`}><figure><img src={mug.primaryImageUrl} alt={`${mug.title} coffee mug, primary view`} /></figure>{mug.secondaryImageUrl && <figure><img src={mug.secondaryImageUrl} alt={`${mug.title} coffee mug, secondary view`} /></figure>}</div><div className="mug-details-content"><dl><div><dt>Type</dt><dd>{mug.type}</dd></div><div><dt>Series</dt><dd>{mug.series}</dd></div></dl>{mug.additionalInfo && <section className="mug-details-notes" aria-labelledby="mug-details-notes-heading"><h3 id="mug-details-notes-heading">Additional information</h3><p>{mug.additionalInfo}</p></section>}</div></section></div>
}

function MugForm({ mug, onClose, onSaved }: { mug?: Mug; onClose: () => void; onSaved: () => void }) {
  const [draft, setDraft] = useState<MugDraft>(() => mug ? { title: mug.title, type: mug.type, series: String(mug.series), additionalInfo: mug.additionalInfo ?? '', locationName: mug.locationName ?? '', latitude: mug.latitude?.toString() ?? '', longitude: mug.longitude?.toString() ?? '' } : emptyDraft)
  const [primaryImage, setPrimaryImage] = useState<File>()
  const [secondaryImage, setSecondaryImage] = useState<File>()
  const [locationResults, setLocationResults] = useState<GeocodeResult[]>([])
  const [resolvedLocation, setResolvedLocation] = useState(mug?.latitude !== undefined && mug.longitude !== undefined ? mug.locationName : undefined)
  const [locating, setLocating] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const locationSearchVersion = useRef(0)
  const locationRequired = draft.type !== 'Film'
  const update = <K extends keyof MugDraft>(key: K, value: MugDraft[K]) => setDraft((current) => ({ ...current, [key]: value }))

  function updateLocationName(value: string) {
    locationSearchVersion.current += 1
    setDraft((current) => ({ ...current, locationName: value, latitude: '', longitude: '' }))
    setLocationResults([])
    setResolvedLocation(undefined)
    setError('')
  }

  async function findLocation() {
    const query = draft.locationName.trim()
    if (query.length < 2) { setError('Enter at least two characters to find a location.'); return }
    const searchVersion = ++locationSearchVersion.current
    setLocating(true); setLocationResults([]); setResolvedLocation(undefined); setError('')
    try {
      const response = await fetch(`/api/maps/geocode?query=${encodeURIComponent(query)}`, { cache: 'no-store' })
      const body = await response.json() as { results?: GeocodeResult[]; message?: string }
      if (!response.ok) throw new Error(body.message ?? 'Unable to search for this location.')
      if (searchVersion !== locationSearchVersion.current) return
      const results = body.results ?? []
      setLocationResults(results)
      if (!results.length) setError('No matching locations were found. Try adding a state, region, or country.')
    } catch (locationError) {
      if (searchVersion === locationSearchVersion.current) setError(locationError instanceof Error ? locationError.message : 'Unable to search for this location.')
    } finally {
      if (searchVersion === locationSearchVersion.current) setLocating(false)
    }
  }

  function selectLocation(result: GeocodeResult) {
    setDraft((current) => ({ ...current, latitude: String(result.latitude), longitude: String(result.longitude) }))
    setResolvedLocation(result.label)
    setLocationResults([])
    setError('')
  }

  async function submit(event: FormEvent) {
    event.preventDefault(); setError('')
    if ((locationRequired || draft.locationName.trim()) && (!draft.latitude || !draft.longitude)) {
      setError('Find and select the matching location before saving.')
      return
    }
    setSaving(true)
    const form = new FormData()
    Object.entries(draft).forEach(([key, value]) => form.append(key, value))
    if (primaryImage) form.append('primaryImage', primaryImage)
    if (secondaryImage) form.append('secondaryImage', secondaryImage)
    try {
      const response = await fetch(mug ? `/api/mugs/${mug.id}` : '/api/mugs', { method: mug ? 'PUT' : 'POST', body: form })
      if (!response.ok) throw new Error((await response.json()).message ?? 'Unable to save this mug.')
      onSaved(); onClose()
    } catch (submissionError) { setError(submissionError instanceof Error ? submissionError.message : 'Unable to save this mug.') }
    finally { setSaving(false) }
  }

  return <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="mug-form-title" onMouseDown={(event) => event.stopPropagation()}><header className="dialog-header"><div><p className="eyebrow">Collection editor</p><h2 id="mug-form-title">{mug ? 'Edit mug' : 'Register a mug'}</h2></div><button className="icon-button" type="button" onClick={onClose} title="Close"><X /></button></header><form className="mug-form" onSubmit={submit}>
    <label>Title<input required maxLength={120} value={draft.title} onChange={(event) => update('title', event.target.value)} /></label>
    <div className="field-row"><label>Type<select value={draft.type} onChange={(event) => update('type', event.target.value as MugType)}>{mugTypes.map((type) => <option key={type}>{type}</option>)}</select></label><label>Series<input required pattern="(?:N/A|[0-9]{4})" placeholder="2025 or N/A" value={draft.series} onChange={(event) => update('series', event.target.value)} /></label></div>
    <div className="form-field"><label htmlFor="mug-location">Location name {locationRequired && <span aria-hidden="true">*</span>}</label><div className="location-search-control"><input id="mug-location" required={locationRequired} maxLength={160} placeholder="City, region, country, or landmark" value={draft.locationName} onChange={(event) => updateLocationName(event.target.value)} /><button className="button secondary" type="button" disabled={locating || draft.locationName.trim().length < 2} onClick={() => void findLocation()}><Search size={16} /> {locating ? 'Searching...' : 'Find location'}</button></div></div>
    {locationResults.length > 0 && <div className="location-results" aria-live="polite"><strong>Select the matching location</strong>{locationResults.map((result) => <button key={result.id} type="button" onClick={() => selectLocation(result)}><MapPin size={17} /><span>{result.label}<small>{[result.type, result.confidence && `${result.confidence} confidence`].filter(Boolean).join(' · ')}</small></span></button>)}</div>}
    {resolvedLocation && <div className="location-confirmation" role="status"><MapPin size={19} /><span><strong>Mapped to {resolvedLocation}</strong><small>{Number(draft.latitude).toFixed(5)}, {Number(draft.longitude).toFixed(5)}</small></span></div>}
    <label>Additional info<textarea maxLength={2000} rows={4} value={draft.additionalInfo} onChange={(event) => update('additionalInfo', event.target.value)} /></label>
    <div className="field-row"><label>Primary photo<input required={!mug} type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setPrimaryImage(event.target.files?.[0])} /></label><label>Second photo <span className="muted">optional</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setSecondaryImage(event.target.files?.[0])} /></label></div>
    {error && <p className="form-error" role="alert">{error}</p>}<footer className="dialog-actions"><button className="button secondary" type="button" onClick={onClose}>Cancel</button><button className="button primary" type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save mug'}</button></footer>
  </form></section></div>
}

function App() {
  const [mugs, setMugs] = useState<Mug[]>([])
  const [session, setSession] = useState<AdminSession>({ authenticated: false, authorized: false })
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<MugType | 'All'>('All')
  const [visibleMugCount, setVisibleMugCount] = useState(mugsPerPage)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [sessionError, setSessionError] = useState('')
  const [editingMug, setEditingMug] = useState<Mug | null | undefined>(undefined)
  const [selectedMug, setSelectedMug] = useState<Mug | undefined>()

  async function loadMugs() {
    setLoading(true); setLoadError('')
    try { const response = await fetch('/api/mugs'); if (!response.ok) throw new Error('The collection is temporarily unavailable.'); setMugs((await response.json()).items) }
    catch (error) { setLoadError(error instanceof Error ? error.message : 'The collection is temporarily unavailable.') }
    finally { setLoading(false) }
  }

  useEffect(() => {
    void fetch('/api/mugs')
      .then((response) => { if (!response.ok) throw new Error('The collection is temporarily unavailable.'); return response.json() })
      .then(({ items }: { items: Mug[] }) => setMugs(items))
      .catch((error: unknown) => setLoadError(error instanceof Error ? error.message : 'The collection is temporarily unavailable.'))
      .finally(() => setLoading(false))
    void fetch('/api/management/session', { cache: 'no-store' })
      .then((response) => { if (!response.ok) throw new Error(`Admin session check failed (${response.status}).`); return response.json() })
      .then(setSession)
      .catch((error: unknown) => setSessionError(error instanceof Error ? error.message : 'Admin session check failed.'))
  }, [])
  const filteredMugs = useMemo(() => { const term = query.trim().toLowerCase(); return mugs.filter((mug) => (typeFilter === 'All' || mug.type === typeFilter) && (!term || [mug.title, mug.type, mug.locationName, mug.additionalInfo].filter(Boolean).some((value) => value!.toLowerCase().includes(term)))) }, [mugs, query, typeFilter])
  const visibleMugs = filteredMugs.slice(0, visibleMugCount)
  const counts = useMemo(() => mugTypes.map((type) => ({ type, count: mugs.filter((mug) => mug.type === type).length })), [mugs])
  function filterByType(type: MugType | 'All') { setTypeFilter(type); setVisibleMugCount(mugsPerPage) }
  async function deleteMug(mug: Mug) { if (!window.confirm(`Remove “${mug.title}” from the collection?`)) return; if ((await fetch(`/api/mugs/${mug.id}`, { method: 'DELETE' })).ok) await loadMugs() }

  return <div className="site-shell"><header className="site-header"><a className="brand" href="#top" aria-label="V and M Coffee Mug Collection home"><span className="brand-mark"><Coffee aria-hidden="true" /></span><span><strong>V&amp;M</strong><small>Coffee Mug Collection</small></span></a><nav aria-label="Main navigation"><a href="#map">Map</a><a href="#collection">Collection</a>{session.authorized ? <><button className="button primary" type="button" onClick={() => setEditingMug(null)}><Plus size={17} /> Add mug</button><a className="icon-button" href="/.auth/logout?post_logout_redirect_uri=/" title="Sign out"><LogOut /></a></> : <a className="button secondary" href="/.auth/login/aad?post_login_redirect_uri=/"><LogIn size={17} /> Admin sign in</a>}<a className="icon-button" href="https://github.com/vrapolinario/mug-collection" target="_blank" rel="noreferrer" title="View source on GitHub" aria-label="View source on GitHub"><GitHubIcon /></a></nav></header>
    <main id="top"><section className="intro-band"><div><p className="eyebrow">An unofficial collector archive</p><h1>Every mug holds<br />a place in our story.</h1><p className="intro-text">A personal catalogue of coffee mugs gathered across countries, cities, films, and special collections.</p><a className="text-link" href="#collection">Browse the collection <ChevronDown size={18} /></a></div><div className="total-lockup" aria-label={`${mugs.length} mugs in the collection`}><span>{mugs.length}</span><p>mugs collected</p></div></section>
    <section className="summary-strip" aria-label="Collection counts by type">{counts.map(({ type, count }) => <button key={type} type="button" onClick={() => filterByType(type)}><span>{count}</span>{type}</button>)}</section>
    <div id="map"><CollectionMap mugs={mugs} /></div>
    <section className="collection-band" id="collection" aria-labelledby="collection-heading"><div className="section-heading"><div><p className="eyebrow">The cabinet</p><h2 id="collection-heading">The collection</h2></div><p>{filteredMugs.length} of {mugs.length} mugs</p></div><div className="collection-tools"><label className="search-box"><Search size={18} /><span className="sr-only">Search collection</span><input type="search" placeholder="Search mugs or places" value={query} onChange={(event) => { setQuery(event.target.value); setVisibleMugCount(mugsPerPage) }} /></label><label className="select-box"><Filter size={17} /><span className="sr-only">Filter by type</span><select value={typeFilter} onChange={(event) => filterByType(event.target.value as MugType | 'All')}><option>All</option>{mugTypes.map((type) => <option key={type}>{type}</option>)}</select></label></div>
    {loading && <div className="status-panel">Opening the cabinet...</div>}{loadError && <div className="status-panel error" role="alert">{loadError}<button className="text-link" onClick={() => void loadMugs()}>Try again</button></div>}{!loading && !loadError && filteredMugs.length === 0 && <div className="status-panel"><Coffee size={32} /><h3>{mugs.length ? 'No mugs match these filters.' : 'The first mug is waiting.'}</h3><p>{session.authorized ? 'Use Add mug to start the collection.' : 'Check back after the collection has been catalogued.'}</p></div>}
    <div className="mug-grid">{visibleMugs.map((mug) => <article className="mug-card" key={mug.id}><button className="mug-card-open" type="button" onClick={() => setSelectedMug(mug)} aria-label={`View details for ${mug.title}`}><div className="mug-image"><img src={mug.primaryImageUrl} alt={`${mug.title} coffee mug`} loading="lazy" /></div><div className="mug-card-body"><div className="mug-meta"><span>{mug.type}</span><span>{mug.series}</span></div><h3>{mug.title}</h3>{mug.locationName && <p><MapPin size={15} /> {mug.locationName}</p>}</div></button>{session.authorized && <div className="card-actions mug-card-admin-actions"><button className="icon-button" type="button" title={`Edit ${mug.title}`} onClick={() => setEditingMug(mug)}><Edit3 /></button><button className="icon-button danger" type="button" title={`Delete ${mug.title}`} onClick={() => void deleteMug(mug)}><Trash2 /></button></div>}</article>)}</div>{visibleMugs.length < filteredMugs.length && <div className="collection-pagination"><button className="button secondary" type="button" onClick={() => setVisibleMugCount((count) => count + mugsPerPage)}><ChevronDown size={18} /> Load more mugs</button><span>{visibleMugs.length} of {filteredMugs.length} shown</span></div>}</section></main>
    <footer><div className="brand"><span className="brand-mark"><Coffee /></span><span><strong>V&amp;M</strong><small>Coffee Mug Collection</small></span></div><p>This is an independent, unofficial collector site. It is not affiliated with or endorsed by any coffee company or trademark owner.</p>{sessionError ? <p className="access-note form-error" role="alert">{sessionError}</p> : session.authenticated && !session.authorized && <p className="access-note"><ShieldCheck size={16} /> Signed in as {session.email}. This account is not an administrator.</p>}</footer>
    {selectedMug && <MugDetails mug={selectedMug} onClose={() => setSelectedMug(undefined)} />}
    {editingMug !== undefined && <MugForm mug={editingMug ?? undefined} onClose={() => setEditingMug(undefined)} onSaved={() => void loadMugs()} />}</div>
}

export default App