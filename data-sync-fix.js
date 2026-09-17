(() => {
  // Supabase is the source of truth. If it is reachable and empty,
  // clear stale browser data so old local places cannot reappear.
  const STORAGE_KEY = 'my-place-map-places-v2';
  let syncing = false;

  async function resetStaleLocalData() {
    if (syncing) return;
    syncing = true;
    try {
      const res = await fetch('/api/places', { headers: { Accept: 'application/json' } });
      if (!res.ok) return;
      const data = await res.json();
      const remote = Array.isArray(data.places) ? data.places : [];

      if (remote.length === 0) {
        const local = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
        if (Array.isArray(local) && local.length > 0) {
          localStorage.removeItem(STORAGE_KEY);
          location.reload();
        }
      }
    } catch (_) {
      // If the API is unavailable, keep local data untouched.
    }
  }

  resetStaleLocalData();
})();
