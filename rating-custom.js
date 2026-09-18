(() => {
  // Double-clicking the current rating removes it.
  let activePlaceId = null;

  document.addEventListener('click', e => {
    const trigger = e.target.closest('.rating-badge, .place-address-button, .popup-rate');
    if (trigger) activePlaceId = trigger.dataset.ratingId || trigger.dataset.id || null;
  }, true);

  document.addEventListener('dblclick', async e => {
    const option = e.target.closest('.rating-option');
    if (!option || !activePlaceId) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const error = document.getElementById('ratingError');
    if (error) error.textContent = '';
    try {
      const res = await fetch('/api/places/' + encodeURIComponent(activePlaceId), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ rating: null })
      });
      if (!res.ok) throw new Error('Không thể bỏ đánh giá');
      location.reload();
    } catch (_) {
      if (error) error.textContent = 'Không thể bỏ đánh giá lúc này. Thử lại nhé.';
    }
  }, true);
})();