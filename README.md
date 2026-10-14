# Twitch Timeline

Rewind live Twitch streams. Adds a timeline under the player: click anywhere on it to jump back to that point in the stream, then **LIVE ▶|** to skip back to live.

This replicates the rewind timeline bar Twitch gives subscribers on live streams. It doesn't replace Twitch's native bar: if you're subscribed to a channel and Twitch shows its own, this one is placed on top of it. That's why it can be switched off per channel from the toggle in Twitch's top bar, for the channels you're actually subscribed to.

- Uptime clock, hover time ("-1:43:49" behind live) and a knob that follows what's playing
- Plays the stream's in-progress VOD in the quality picked in Twitch's player settings, switching with it
- "Chat is Live" notice above the chat box while you're behind, with a link back to live
- Per-channel on/off toggle in Twitch's top bar

Needs the streamer to have VODs (past broadcasts) on. On streams without a playable VOD (VODs off, or sub-only) the bar and toggle don't appear.

## Userscript (Tampermonkey, Violentmonkey…)

[Install twitch-timeline.user.js](https://raw.githubusercontent.com/zex0s/twitch-timeline/main/twitch-timeline.user.js). Your userscript manager offers to install it and keeps it updated.

It plays the VOD with [hls.js](https://github.com/video-dev/hls.js), so it works in Chrome, Firefox, Edge and Safari.

## Safari extension

Open `Twitch Timeline/Twitch Timeline.xcodeproj` in Xcode, set your own signing team, build, run the app once, then enable **Twitch Timeline** in Safari › Settings › Extensions. It uses Safari's built-in HLS playback.

## Development

The userscript (`twitch-timeline.user.js`) and the Safari extension (`extension/content.js` and `content.css`) are separate copies of the same code. They differ only in playback: the userscript uses hls.js, the extension Safari's native HLS. Keep fixes in sync by hand, and bump `@version` in the userscript or installed copies won't update.
