(() => {
  const originalMap = L.map;
  L.map = function (...args) {
    const instance = originalMap.apply(this, args);
    if (args[0] === 'map') window.__myPlaceMapMain = instance;
    return instance;
  };
  window.__myPlaceMapSetView = (lat, lng) => {
    if (window.__myPlaceMapMain) window.__myPlaceMapMain.setView([lat, lng], 18, { animate: true });
  };
})();
