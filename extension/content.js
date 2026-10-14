// Twitch's own public web client id, same one twitch.tv uses.
const CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';

let channel, startedAt, vodUrl, variants, pre, dvr;

// Channels the timeline is switched off for, from the top-nav toggle
let off;
try { off = new Set(JSON.parse(localStorage.getItem('tt-off')) || []); } catch { off = new Set(); }

const toggle = document.createElement('button');
toggle.className = 'tt-toggle';
toggle.type = 'button';
toggle.innerHTML = `<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M3.5 10a6.5 6.5 0 1 0 1.9-4.6"/><path d="M3 3v4h4"/><path d="M10 6.5V10l2.5 1.5"/><path class="tt-slash" d="M2 18L18 2"/></svg>`;
toggle.onclick = () => {
  off.has(channel) ? off.delete(channel) : off.add(channel);
  try { localStorage.setItem('tt-off', JSON.stringify([...off])); } catch {}
  goLive();
};

const bar = document.createElement('div');
bar.className = 'tt-bar';
bar.innerHTML = `
  <div class="tt-row">
    <span class="tt-time"></span>
    <button class="tt-live" type="button" data-tip="Skip to Live">
      <span>LIVE</span>
      <svg viewBox="0 0 11 11" width="11" height="11"><path d="M0 0v11l8-5.5z M9.5 0H11v11H9.5z" fill="currentColor"/></svg>
    </button>
  </div>
  <div class="tt-track-wrap">
    <div class="tt-track"><div class="tt-fill"></div><div class="tt-dot"></div><div class="tt-knob"></div></div>
  </div>
  <div class="tt-tip"></div>`;
// "Chat is Live" notice at the top of chat while rewound; the (i) expands it
const info = '<svg viewBox="0 0 20 20" width="20" height="20"><path fill="currentColor" fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9 9h2v5H9zm0-3h2v2H9z"/></svg>';
const notice = document.createElement('div');
notice.className = 'tt-notice';
notice.innerHTML = `
  <div class="tt-notice-head">
    <button class="tt-notice-info" type="button" aria-label="More info">${info}</button>
    <span class="tt-notice-title">Chat is Live</span>
    <button class="tt-notice-close" type="button" aria-label="Close">
      <svg viewBox="0 0 20 20" width="20" height="20"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
    </button>
  </div>
  <p class="tt-notice-body">Chat is live and ahead of the content you are watching. To see what's happening live, <a href="#" class="tt-notice-link">skip ahead to live</a>.</p>`;
notice.querySelector('.tt-notice-info').onclick = () => notice.classList.add('tt-open');
notice.querySelector('.tt-notice-close').onclick = () => notice.classList.remove('tt-open');
notice.querySelector('.tt-notice-link').onclick = e => { e.preventDefault(); goLive(); };

const time = bar.querySelector('.tt-time');
const track = bar.querySelector('.tt-track');
const fill = bar.querySelector('.tt-fill');
const knob = bar.querySelector('.tt-knob');
const tip = bar.querySelector('.tt-tip');
const wrap = bar.querySelector('.tt-track-wrap');
const fraction = e => {
  const r = track.getBoundingClientRect();
  return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
};
bar.querySelector('.tt-live').onclick = goLive;
wrap.onclick = e => seek(fraction(e));
wrap.onmouseenter = prepare; // start loading the VOD as soon as a click looks likely
wrap.onmousemove = e => {
  const f = fraction(e);
  const r = track.getBoundingClientRect();
  tip.textContent = '-' + fmt(uptime() * (1 - f));
  tip.style.left = r.left - bar.getBoundingClientRect().left + f * r.width + 'px';
};

async function gql(query, variables) {
  const r = await fetch('https://gql.twitch.tv/gql', {
    method: 'POST',
    headers: { 'Client-ID': CLIENT_ID },
    body: JSON.stringify({ query, variables }),
  });
  return (await r.json()).data;
}

const uptime = () => (Date.now() - startedAt) / 1000;
const twitchVideo = () => document.querySelector('.video-ref video:not(.tt-video)');
// Stream time of the frame on screen, which the clock and knob show. It only
// advances while the video plays, so pausing, loading or a stall stops it.
// (VOD time = stream time: its playlist's length matches uptime to within ~2s.)
let watched, lastTime, movedAt = 0;

const spinner = document.createElement('div');
spinner.className = 'tt-spinner';

// "03:18:24" for uptime, "1:43:49" / "43:49" for time behind live
function fmt(s, padHours) {
  s = Math.max(0, Math.floor(s));
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, sec = s % 60;
  const mmss = `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return padHours ? `${String(h).padStart(2, '0')}:${mmss}` : h ? `${h}:${mmss}` : `${m}:${String(sec).padStart(2, '0')}`;
}

async function load(name) {
  const d = await gql('query($l:String!){user(login:$l){stream{createdAt archiveVideo{id}}}}', { l: name }).catch(() => null);
  const s = d?.user?.stream;
  if (name !== channel || !s) return;
  startedAt = Date.parse(s.createdAt);
  const id = s.archiveVideo?.id; // null when the streamer has VODs disabled
  if (!id) return;
  // ponytail: token is valid ~20h; reload the page if a tab outlives that
  const t = (await gql(
    'query($id:ID!){videoPlaybackAccessToken(id:$id,params:{platform:"web",playerBackend:"mediaplayer",playerType:"site"}){value signature}}',
    { id },
  ).catch(() => null))?.videoPlaybackAccessToken;
  // Safari plays HLS natively; the in-progress VOD is an EVENT playlist that keeps growing.
  if (name !== channel || !t) return;
  vodUrl = `https://usher.ttvnw.net/vod/${id}.m3u8?` + new URLSearchParams({ sig: t.signature, token: t.value, allow_source: 'true' });
  // Quality variants, best first, known by group ID ("720p60", "chunked") and
  // name ("1080p60"): Twitch saves its quality setting as one or the other.
  const lines = (await fetch(vodUrl).then(r => r.text()).catch(() => '')).split('\n');
  const names = {};
  for (const l of lines) {
    const m = l.match(/^#EXT-X-MEDIA:.*GROUP-ID="([^"]+)".*NAME="([^"]+)"/);
    if (m) names[m[1]] = m[2];
  }
  if (name === channel) variants = lines.flatMap((l, i) => {
    if (!l.startsWith('#EXT-X-STREAM-INF')) return [];
    const group = l.match(/VIDEO="([^"]+)"/)?.[1];
    return [{ ids: [group, names[group]], height: +l.match(/RESOLUTION=\d+x(\d+)/)?.[1] || 0, url: lines[i + 1] }];
  });
}

// The VOD playlist for the quality picked in Twitch's player settings.
// Auto plays the master playlist so Safari adapts; a fixed one plays that
// variant directly so Safari can't drop below it.
function qualityUrl() {
  let q;
  try { q = JSON.parse(localStorage.getItem('video-quality'))?.default; } catch {}
  if (!variants?.length || !q || q === 'auto') return vodUrl;
  return (variants.find(v => v.ids.includes(q)) || variants.find(v => v.height && v.height <= parseInt(q)) || variants[0]).url;
}

function unload(v) {
  v?.removeAttribute('src');
  v?.load();
}

function prepare() {
  const src = qualityUrl();
  if (pre && pre.ttSrc !== src) {
    unload(pre);
    pre = null;
  }
  if (pre || dvr || !src) return;
  pre = Object.assign(document.createElement('video'), { className: 'tt-video', playsInline: true, preload: 'auto', src, ttSrc: src });
  pre.onplay = () => movedAt = Date.now(); // no spinner flash on resume
}

// Live audio is routed through a gain node so Twitch's own volume/mute
// controls keep working (we mirror them) while the live feed is silent.
function liveAudio(tv, on) {
  if (!tv.ttGain) {
    const ctx = new AudioContext();
    tv.ttGain = ctx.createGain();
    ctx.createMediaElementSource(tv).connect(tv.ttGain).connect(ctx.destination);
    tv.addEventListener('play', () => dvr?.play());
    tv.addEventListener('pause', () => dvr?.pause());
    tv.addEventListener('volumechange', () => dvr && Object.assign(dvr, { volume: tv.volume, muted: tv.muted }));
  }
  tv.ttGain.gain.value = on ? 1 : 0;
}

function seek(f) {
  if (f > 0.995 || !vodUrl) return goLive();
  const target = f * uptime();
  if (!dvr) {
    const tv = twitchVideo();
    prepare();
    dvr = pre;
    pre = null;
    Object.assign(dvr, { volume: tv.volume, muted: tv.muted });
    tv.after(dvr);
    liveAudio(tv, false);
    if (!tv.paused) dvr.play().catch(() => {});
  }
  // Seeking right after src is set is fastest in Safari. The VOD trails the
  // live edge a little, so clamp to what's available.
  const end = dvr.seekable.length ? dvr.seekable.end(0) - 10 : target;
  const pos = Math.min(target, end);
  dvr.currentTime = lastTime = watched = pos; // shows the clicked spot until it plays
}

function goLive() {
  if (!dvr) return;
  dvr.pause();
  dvr.remove();
  spinner.remove();
  pre = dvr; // keep it loaded so the next rewind is instant
  dvr = watched = null;
  const tv = twitchVideo();
  if (tv?.ttGain) liveAudio(tv, true);
}

function tick() {
  const name = location.pathname.split('/')[1].toLowerCase();
  if (name !== channel) {
    channel = name;
    goLive();
    unload(pre);
    startedAt = vodUrl = variants = pre = watched = null;
    load(name);
  }
  // Leftmost of the top nav's right-hand icons, on live channels only
  const nav = document.querySelector('.top-nav__menu > :last-child');
  if (!startedAt || !nav) toggle.remove();
  else if (toggle.parentElement !== nav) nav.prepend(toggle);
  const enabled = !off.has(channel);
  toggle.classList.toggle('tt-off', !enabled);
  toggle.setAttribute('aria-pressed', enabled);
  toggle.dataset.tip = `Timeline ${enabled ? 'on' : 'off'} for this channel`;
  toggle.setAttribute('aria-label', toggle.dataset.tip);
  if (!enabled) {
    bar.remove();
    notice.remove();
    return;
  }
  // Just above the message box, which overlaps its bottom edge
  const input = document.querySelector('.chat-input > div');
  if (!dvr || !input) {
    notice.remove();
    notice.classList.remove('tt-open');
  } else if (notice.parentElement !== input) input.prepend(notice);
  if (dvr) {
    // Quality changed in Twitch's settings: same spot, new variant
    const src = qualityUrl();
    if (src !== dvr.ttSrc) {
      const t = dvr.currentTime, playing = !dvr.paused;
      dvr.src = dvr.ttSrc = src;
      dvr.currentTime = t;
      if (playing) dvr.play().catch(() => {});
    }
    // Moving position = playing (Safari's HLS readyState isn't reliable for that)
    if (dvr.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && dvr.currentTime !== lastTime) {
      watched = lastTime = dvr.currentTime;
      movedAt = Date.now();
    }
    // Twitch's spinner while it should be playing but isn't moving
    if (dvr.paused || Date.now() - movedAt < 400) spinner.remove();
    else if (spinner.previousSibling !== dvr) dvr.after(spinner);
  } else if (startedAt && (watched == null || !twitchVideo()?.paused)) watched = uptime();
  const overlay = [...document.querySelectorAll('.video-player .video-player__overlay')].find(o => o.offsetHeight);
  if (!startedAt || !overlay) return bar.remove();
  if (bar.parentElement !== overlay) overlay.append(bar);
  bar.classList.toggle('tt-dvr', !!dvr);
  time.textContent = fmt(watched, true);
  fill.style.width = knob.style.left = Math.min(100, (watched / uptime()) * 100) + '%';
}

setInterval(tick, 250);
