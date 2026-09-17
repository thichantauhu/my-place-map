(() => {
  const ICONS = { like: '❤️', neutral: '😶', dislike: '💔' };
  let activePlaceId = null;

  function patchRatingUI() {
    document.querySelectorAll('.rating-option').forEach(btn => {
      const type = btn.dataset.rating;
      const span = btn.querySelector('span');
      if (span && ICONS[type]) span.textContent = ICONS[type];
    });

    document.querySelectorAll('.place-marker').forEach(marker => {
      const title = marker.getAttribute('title');
      if (title === 'Thích') marker.textContent = ICONS.like;
      else if (title === 'Bình thường') marker.textContent = ICONS.neutral;
      else if (title === 'Không thích') marker.textContent = ICONS.dislike;
    });

    document.querySelectorAll('.popup-rating').forEach(el => {
      const text = el.textContent || '';
      if (text.includes('Thích')) el.textContent = `❤️ Thích`;
      else if (text.includes('Bình thường')) el.textContent = `😶 Bình thường`;
      else if (text.includes('Không thích')) el.textContent = `💔 Không thích`;
    });
  }

  document.addEventListener('click', e => {
    const trigger = e.target.closest('.rating-badge, .place-address-button, .popup-rate');
    if (trigger) {
      activePlaceId = trigger.dataset.ratingId || trigger.dataset.id || null;
    }
  }, true);

  document.addEventListener('dblclick', async e => {
    const option = e.target.closest('.rating-option');
    if (!option || !activePlaceId) return;

    e.preventDefault();
    e.stopImmediatePropagation();

    const error = document.getElementById('ratingError');
    if (error) error.textContent = '';

    try {
      const res = await fetch(`/api/places/${encodeURIComponent(activePlaceId)}`, {
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

  patchRatingUI();
  const observer = new MutationObserver(patchRatingUI);
  observer.observe(document.body, { childList: true, subtree: true });
})();