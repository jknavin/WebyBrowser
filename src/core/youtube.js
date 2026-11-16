'use strict';
// Built-in YouTube focus tool: ad removal + distraction toggles.
// Everything is CSS/JS injected locally into youtube.com pages. No extension involved.

function isYouTube(url) {
  try {
    const h = new URL(url).hostname;
    return h === 'youtube.com' || h.endsWith('.youtube.com') || h === 'youtube-nocookie.com';
  } catch (_) { return false; }
}

function css(opts) {
  const o = opts || {};
  const rules = [
    // Ads: always removed, not a toggle.
    `#masthead-ad, #player-ads, ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer,
     ytd-banner-promo-renderer, ytd-statement-banner-renderer, ytd-promoted-sparkles-web-renderer,
     ytd-display-ad-renderer, ytd-promoted-video-renderer, ytd-companion-slot-renderer,
     ytd-action-companion-ad-renderer, ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"],
     .ytp-ad-module, .ytp-ad-overlay-container, .ytp-ad-image-overlay, .video-ads,
     ytd-merch-shelf-renderer, ytd-primetime-promo-renderer, #premium-upsell-link, ytd-mealbar-promo-renderer,
     tp-yt-paper-dialog:has(ytd-enforcement-message-view-model)
     { display: none !important; }`,
  ];
  if (o.hideShorts) rules.push(`ytd-reel-shelf-renderer, ytd-rich-shelf-renderer[is-shorts], a[title="Shorts"], ytd-guide-entry-renderer:has(a[title="Shorts"]), ytd-mini-guide-entry-renderer[aria-label="Shorts"], ytm-shorts-lockup-view-model, grid-shelf-view-model:has(ytm-shorts-lockup-view-model) { display: none !important; }`);
  if (o.hideHomeFeed) rules.push(`ytd-browse[page-subtype="home"] #primary ytd-rich-grid-renderer { display: none !important; }`);
  if (o.hideRelated) rules.push(`#related, ytd-watch-next-secondary-results-renderer { display: none !important; }`);
  if (o.hideComments) rules.push(`ytd-comments#comments { display: none !important; }`);
  if (o.hideEndCards) rules.push(`.ytp-ce-element, .ytp-endscreen-content, .ytp-ce-covering-overlay, .ytp-cards-teaser, .ytp-suggested-action { display: none !important; }`);
  if (o.hideExplore) rules.push(`ytd-guide-section-renderer:has(a[href^="/feed/trending"]), ytd-guide-entry-renderer:has(a[href^="/gaming"]), ytd-guide-entry-renderer:has(a[href^="/feed/explore"]) { display: none !important; }`);
  if (o.grayscale) rules.push(`html { filter: grayscale(1) !important; }`);
  return rules.join('\n');
}

// Runs inside the page: skips/removes ad playback and optionally stops autoplay.
function script() {
  return `(() => {
    if (window.__webyYT) return; window.__webyYT = true;
    const q = (s) => document.querySelector(s);
    const tick = () => {
      const player = q('#movie_player');
      const video = q('video.html5-main-video, video');
      const adShowing = player && (player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting'));
      if (adShowing && video) {
        try { video.muted = true; } catch (_) {}
        if (isFinite(video.duration) && video.duration > 0) { try { video.currentTime = video.duration; } catch (_) {} }
        video.playbackRate = 16;
      }
      const skip = q('.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button, button.ytp-ad-skip-button-container');
      if (skip) skip.click();
      const close = q('.ytp-ad-overlay-close-button');
      if (close) close.click();
      if (window.__webyOpts && window.__webyOpts.noAutoplay) {
        const ap = q('.ytp-autonav-toggle-button[aria-checked="true"]');
        if (ap) ap.click();
      }
    };
    setInterval(tick, 300);
    // Strip ad payloads from player responses before the page uses them.
    const strip = (o) => {
      if (!o || typeof o !== 'object') return o;
      for (const k of ['adPlacements', 'playerAds', 'adSlots', 'adBreakHeartbeatParams']) if (k in o) delete o[k];
      return o;
    };
    try {
      const origParse = JSON.parse;
      JSON.parse = function (...a) { return strip(origParse.apply(this, a)); };
      const origJson = Response.prototype.json;
      Response.prototype.json = function () { return origJson.call(this).then(strip); };
    } catch (_) {}
  })();`;
}

module.exports = { isYouTube, css, script };
