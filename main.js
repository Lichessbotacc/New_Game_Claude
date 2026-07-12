/**
 * main.js — application bootstrap. Loaded last; wires up UI + Game and shows the title screen
 * once everything is ready. No external assets are fetched, so "loading" is a short synthetic
 * progress animation that also warms up the WebGL context.
 */
(function boot() {
  function start() {
    UI.init();
    GameApp.init();

    // prevent iOS bounce/scroll and pinch-zoom which would break the fixed layout
    document.addEventListener('touchmove', e => { if (e.target.closest('.char-grid,.cup-grid,.stats-body,.results-table')) return; e.preventDefault(); }, { passive: false });
    document.addEventListener('gesturestart', e => e.preventDefault());

    UI.playLoading(() => {
      UI.show('screen-title', false);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
