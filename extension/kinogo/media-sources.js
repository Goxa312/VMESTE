(() => {
  function publicMedia(value) {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password || value.length > 4000 ||
          !url.hostname.includes('.') || /^\[|^\d+\.\d+\.\d+\.\d+$|\.(?:local|internal|localhost)\.?$/i.test(url.hostname)) return null;
      return url;
    } catch { return null; }
  }
  function isPlaylist(url, contentType) {
    return /\.m3u8$/i.test(url.pathname) || /(?:mpegurl|vnd\.apple\.mpegurl)/i.test(contentType || '');
  }
  // Called only for the explicitly selected host video. Read URLs, never headers or cookies.
  globalThis.vmesteFilmSources = (video, resources) => {
    if (!video?.isConnected || video.mediaKeys) return [];
    const direct = publicMedia(video.currentSrc);
    if (direct) {
      const source = [...(video.querySelectorAll?.('source') || [])].find(item => item.src === video.currentSrc);
      return [{ url: direct.href, format: isPlaylist(direct, source?.type) ? 'hls' : 'file' }];
    }
    if (!video.currentSrc?.startsWith('blob:')) return [];
    const manifests = new Set();
    for (const entry of [...resources].reverse()) {
      if (!['fetch', 'xmlhttprequest', 'video', 'other'].includes(entry.initiatorType)) continue;
      const url = publicMedia(entry.name);
      if (url && isPlaylist(url, entry.contentType)) manifests.add(url.href);
      if (manifests.size >= 8) break;
    }
    return [...manifests].map(url => ({ url, format: 'hls' }));
  };
})();
