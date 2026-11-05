declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    TURN_KEY_ID?: string;
    TURN_API_TOKEN?: string;
  }
}
