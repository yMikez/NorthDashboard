/*!
 * VTurb / Smartplayer — revela .esconder após N segundos de vídeo (copy black)
 * Configure: window.VSL_REVEAL_DELAY = 237; (antes deste script)
 */
(function () {
  'use strict';

  if (!window._copyBlack) return;

  var SECONDS_TO_DISPLAY = typeof window.VSL_REVEAL_DELAY === 'number'
    ? window.VSL_REVEAL_DELAY
    : 237;
  var SELECTOR = '#copyb .esconder';
  var STORAGE_KEY = 'vslRevealShown_' + SECONDS_TO_DISPLAY + '_' + (window.location.pathname || '');

  var revealed = false;
  var countdownStarted = false;
  var countdownTimerId = null;
  var watchAttempts = 0;

  function formatTime(seconds) {
    var m = Math.floor(seconds / 60);
    var s = seconds % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  function startCountdown() {
    if (countdownStarted) return;
    countdownStarted = true;
    var total = 3 * 60;
    var els = document.querySelectorAll('#copyb .js-countdown');
    if (!els.length) return;

    function setAll(text) {
      for (var i = 0; i < els.length; i++) els[i].textContent = text;
    }

    function tick() {
      setAll(formatTime(total));
      if (total <= 0) {
        if (countdownTimerId) clearInterval(countdownTimerId);
        setAll('LAST CHANCE!');
        for (var j = 0; j < els.length; j++) els[j].classList.add('lc-lastchance');
        return;
      }
      total--;
    }

    tick();
    countdownTimerId = setInterval(tick, 1000);
  }

  function hideAll() {
    var nodes = document.querySelectorAll(SELECTOR);
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].style.display = 'none';
    }
  }

  function revealAll() {
    if (revealed) return;
    revealed = true;

    var nodes = document.querySelectorAll(SELECTOR);
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].classList.remove('esconder');
      nodes[i].style.display = 'block';
    }

    try {
      localStorage.setItem(STORAGE_KEY, 'true');
    } catch (e) {}

    // Desce a página automaticamente até a oferta assim que ela aparece
    if (nodes.length) {
      setTimeout(function () {
        nodes[0].scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 150);
    }

    startCountdown();
  }

  function getSmartInstance() {
    if (typeof smartplayer === 'undefined') return null;
    if (!smartplayer.instances || !smartplayer.instances.length) return null;
    return smartplayer.instances[0];
  }

  function watchVideoProgress() {
    var instance = getSmartInstance();
    if (!instance) {
      if (watchAttempts >= 15) return;
      watchAttempts += 1;
      setTimeout(watchVideoProgress, 1000);
      return;
    }

    instance.on('timeupdate', function () {
      if (revealed) return;
      var current = instance.video && instance.video.currentTime;
      if (typeof current !== 'number') return;
      if (current < SECONDS_TO_DISPLAY) return;
      revealAll();
    });
  }

  function bindVturbElement(player) {
    if (!player) return;

    player.addEventListener('player:ready', function () {
      try {
        if (typeof player.displayHiddenElements === 'function') {
          player.displayHiddenElements(SECONDS_TO_DISPLAY, ['.esconder'], { persist: true });
        }
      } catch (e) {}
    });

    player.addEventListener('player:play', function () {
      setTimeout(function () {
        if (!revealed) revealAll();
      }, (SECONDS_TO_DISPLAY + 15) * 1000);
    });
  }

  function init() {
    hideAll();

    try {
      if (localStorage.getItem(STORAGE_KEY) === 'true') {
        setTimeout(revealAll, 100);
        return;
      }
    } catch (e) {}

    watchVideoProgress();
    bindVturbElement(document.querySelector('vturb-smartplayer'));

    setTimeout(function () {
      if (!revealed && !getSmartInstance()) {
        revealAll();
      }
    }, (SECONDS_TO_DISPLAY + 60) * 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
