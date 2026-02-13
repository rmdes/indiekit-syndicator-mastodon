# @rmdes/indiekit-syndicator-mastodon

> Mastodon syndicator plugin for Indiekit with external like/repost support

[![npm version](https://img.shields.io/npm/v/@rmdes/indiekit-syndicator-mastodon.svg)](https://www.npmjs.com/package/@rmdes/indiekit-syndicator-mastodon)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

Cross-post your IndieWeb content to Mastodon with support for native interactions and external URL syndication.

## Features

- **Standard post syndication** - Cross-post articles, notes, and photos to Mastodon
- **Native Mastodon interactions** - Like and boost Mastodon posts using native API actions
- **External interaction syndication** - Share likes and reposts of non-Mastodon URLs (blogs, articles, etc.) as Mastodon statuses
- **Media uploads** - Automatically upload images with alt text support (up to 4 photos)
- **Reply threading** - Preserve reply chains when responding to Mastodon posts
- **Character limit handling** - Automatic truncation with permalink preservation
- **HTML content support** - Convert HTML posts to plain text with link extraction

## Installation

```bash
npm install @rmdes/indiekit-syndicator-mastodon
```

## Configuration

### Get Your Mastodon Access Token

1. Log in to your Mastodon instance
2. Go to **Settings** → **Development** → **New Application**
3. Set an application name (e.g., "My IndieWeb Site")
4. Required scopes: `read`, `write`
5. Copy the generated access token

### Add to Indiekit Config

```javascript
// indiekit.config.js
import MastodonSyndicator from "@rmdes/indiekit-syndicator-mastodon";

export default {
  plugins: [
    new MastodonSyndicator({
      url: "https://mastodon.social",  // Your Mastodon instance
      user: "yourusername",             // Without the @ symbol
    }),
  ],
};
```

### Environment Variables

```bash
# .env
MASTODON_ACCESS_TOKEN=your_access_token_here
```

### Advanced Configuration

```javascript
new MastodonSyndicator({
  url: "https://fosstodon.org",      // Your Mastodon instance
  user: "yourusername",               // Without @
  accessToken: process.env.MASTODON_ACCESS_TOKEN,
  characterLimit: 500,                // Server character limit
  checked: true,                      // Pre-select in Micropub UI
  syndicateExternalLikes: true,       // Create statuses for non-Mastodon likes
  syndicateExternalReposts: true,     // Create statuses for non-Mastodon reposts
})
```

## Supported Post Types

### Regular Posts (Notes, Articles, Photos)

Your IndieWeb posts are cross-posted to Mastodon with automatic formatting:

- **Notes** → Plain text with permalink appended
- **Articles** → Title + permalink with automatic truncation
- **Photos** → Image attachments with alt text (up to 4 photos)

**Example:**
```
Article Title https://mysite.com/2025/01/article-slug

[Photo attachments]
```

### Likes

#### Like a Mastodon Post

When you like a Mastodon URL, it uses the native Mastodon favourite API:

```json
{
  "like-of": "https://mastodon.social/@user/123456789"
}
```

**Result:** Native Mastodon favourite (appears in the original poster's notifications)

#### Like an External URL

When you like a non-Mastodon URL (blog post, article, etc.), it creates a Mastodon status announcing your like:

```json
{
  "like-of": "https://someones-blog.com/cool-post",
  "content": "Great post about IndieWeb!"
}
```

**Mastodon status:**
```
Great post about IndieWeb!

❤️ https://someones-blog.com/cool-post
```

To disable external like syndication:
```javascript
new MastodonSyndicator({
  syndicateExternalLikes: false,
})
```

### Reposts (Boosts)

#### Repost a Mastodon Status

When you repost a Mastodon URL without a comment, it uses the native reblog API:

```json
{
  "repost-of": "https://mastodon.social/@user/123456789"
}
```

**Result:** Native Mastodon reblog (boosts to your followers)

#### Repost with Comment (Quote Post)

When you add a comment to a Mastodon repost, it creates a new status with the original URL:

```json
{
  "repost-of": "https://mastodon.social/@user/123456789",
  "content": "This is so true!"
}
```

**Mastodon status:**
```
This is so true! https://mastodon.social/@user/123456789
```

#### Repost an External URL

When you repost a non-Mastodon URL, it creates a Mastodon status announcing your repost:

```json
{
  "repost-of": "https://someones-blog.com/cool-post"
}
```

**Mastodon status:**
```
🔁 https://someones-blog.com/cool-post
```

To disable external repost syndication:
```javascript
new MastodonSyndicator({
  syndicateExternalReposts: false,
})
```

### Replies

When you reply to a Mastodon post, the plugin preserves the reply thread:

```json
{
  "in-reply-to": "https://mastodon.social/@user/123456789",
  "content": "Great point!"
}
```

**Result:** Your reply appears in the conversation thread on Mastodon

**Note:** Reply threading only works for posts on your own Mastodon instance due to API limitations.

## How It Works

1. **Post Detection** - When you publish a post via Micropub, Indiekit checks for syndication targets
2. **Content Processing** - The plugin converts your post to Mastodon-compatible format
3. **Media Uploads** - Images are fetched from your site and uploaded to Mastodon
4. **Status Creation** - The formatted status is posted to your Mastodon account
5. **URL Return** - The Mastodon status URL is returned and stored in your post metadata

## Character Limit Handling

Mastodon has a character limit (typically 500 characters). This plugin automatically handles truncation:

- Permalinks are always preserved (appended to every post)
- Long content is truncated to fit the limit
- Truncation prioritizes the permalink over content
- Ellipsis (…) is added when content is cut

**Example:**
```
[Long article content truncated]…

https://mysite.com/2025/01/article-slug
```

## Media Uploads

- Supports up to **4 photos** per post (Mastodon API limit)
- Alt text is preserved from your post's `photo[].alt` property
- Images are fetched from your site and uploaded to Mastodon
- Failed uploads prevent the entire syndication (fail-fast behavior)

## Related Plugins

- **[@rmdes/indiekit-syndicator-bluesky](https://github.com/rmdes/indiekit-syndicator-bluesky)** - Similar functionality for Bluesky
- **[@rmdes/indiekit-syndicator-linkedin](https://github.com/rmdes/indiekit-syndicator-linkedin)** - Similar functionality for LinkedIn
- **[@rmdes/indiekit-endpoint-syndicate](https://github.com/rmdes/indiekit-endpoint-syndicate)** - Manages syndication workflow

## Differences from Upstream

This plugin is a fork of `@indiekit/syndicator-mastodon` with the following enhancements:

1. **External like syndication** - Likes of non-Mastodon URLs are cross-posted as statuses
2. **External repost syndication** - Reposts of non-Mastodon URLs are cross-posted as statuses
3. **Always includes permalinks** - Every cross-posted status includes your original post URL
4. **Emoji indicators** - Uses ❤️ for likes and 🔁 for reposts of external URLs

## License

MIT

## Author

[@rmdes](https://github.com/rmdes)

## Support

- **Issues:** [GitHub Issues](https://github.com/rmdes/indiekit-syndicator-mastodon/issues)
- **Documentation:** See [CLAUDE.md](./CLAUDE.md) for technical details
