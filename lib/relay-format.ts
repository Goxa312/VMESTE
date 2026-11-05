// Only these fixed containers/codecs may be announced on the private relay.
export const relayFormats = [
  "video/webm;codecs=vp8,opus", "video/webm;codecs=vp8",
  "video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4;codecs=avc1.42E01E",
] as const;
export const relayMaxPacket = 2 * 1024 * 1024;
