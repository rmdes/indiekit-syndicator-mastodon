# CLAUDE.md - Mastodon Syndicator Plugin

## Package Overview

**Package:** `@rmdes/indiekit-syndicator-mastodon`
**Version:** 1.0.5
**Purpose:** Mastodon syndicator plugin for Indiekit with support for cross-posting IndieWeb content to Mastodon, including native interactions (favourite, reblog) and external like/repost syndication

## Architecture

This is an **Indiekit syndicator plugin** that bridges the IndieWeb and the Fediverse. It handles:

1. **Standard post syndication** - Cross-posts articles, notes, photos from your IndieWeb site to Mastodon
2. **Native Mastodon interactions** - When you like or repost a Mastodon URL, it uses Mastodon's native favourite/reblog APIs
3. **External interaction syndication** - When you like or repost a non-Mastodon URL (e.g., someone's blog post), it creates a Mastodon status announcing the interaction
4. **Media uploads** - Fetches images from your site and uploads them to Mastodon with alt text
5. **Reply threading** - Preserves reply chains when replying to Mastodon posts
6. **Content truncation** - Automatically truncates long posts to fit Mastodon's character limit while preserving permalinks

## Key Files

```
indiekit-syndicator-mastodon/
├── index.js                    # Plugin entry point and config
├── lib/
│   ├── mastodon.js            # Mastodon API client and post orchestration
│   └── utils.js               # Status creation, media handling, URL parsing
└── package.json
```

### index.js - Plugin Configuration

**Responsibilities:**
- Plugin registration and initialization
- Configuration defaults and validation
- Environment variable management (`MASTODON_ACCESS_TOKEN`)
- User identity info (`@user@instance.hostname`)

**Key Options:**
- `accessToken` (string) - Mastodon access token (from env or config)
- `url` (string) - Mastodon instance URL (default: `https://mastodon.social`)
- `user` (string) - Mastodon username (without @)
- `characterLimit` (number) - Server character limit (default: 500)
- `includePermalink` (boolean) - Include post permalink in status (default: false, but **always true in utils.js** - this option is vestigial)
- `syndicateExternalLikes` (boolean) - Syndicate likes of non-Mastodon URLs as statuses (default: true)
- `syndicateExternalReposts` (boolean) - Syndicate reposts of non-Mastodon URLs as statuses (default: true)
- `checked` (boolean) - Pre-check syndicator in Micropub UI (default: false)

**Syndicator UID Format:**
```
https://mastodon.social/@username
```

### lib/mastodon.js - API Client

**Responsibilities:**
- Mastodon API interactions via `masto` npm package (REST API client)
- Media upload orchestration
- Post type routing (regular post vs like vs repost)
- Origin checking (`isSameOrigin`) to distinguish native Mastodon URLs from external URLs

**Key Methods:**

#### `postStatus(parameters)`
Creates a regular Mastodon status. Parameters:
- `status` (string) - Status text
- `mediaIds` (array) - Mastodon media attachment IDs
- `inReplyToId` (string) - Reply parent status ID
- `visibility` (string) - Post visibility (public, unlisted, private, direct)

#### `postFavourite(statusUrl)`
Favourites a Mastodon status (native like). Extracts status ID from URL, calls `v1.statuses.$select(statusId).favourite()`.

#### `postReblog(statusUrl)`
Reblogs a Mastodon status (native repost). Extracts status ID from URL, calls `v1.statuses.$select(statusId).reblog()`.

#### `uploadMedia(media, me)`
Uploads media from your IndieWeb site to Mastodon:
1. Gets canonical media URL via `getCanonicalUrl(url, me)` (resolves relative paths against `publication.me`)
2. Fetches media file via `fetch(mediaUrl)`
3. Converts response to Blob
4. Uploads to Mastodon via `v2.media.create()` with alt text from JF2 `alt` property
5. Returns Mastodon media attachment ID

**Error handling:** Throws `IndiekitError.fromFetch()` on fetch failures.

#### `post(properties, me)` - Main Entry Point

Routes JF2 properties to appropriate syndication method:

1. **Photo upload** (if `properties.photo` exists):
   - Upload first 4 photos in parallel via `Promise.all()`
   - Store resulting `mediaIds` array

2. **Repost handling** (if `properties["repost-of"]` exists):
   - **Same origin + has content:** Create quoted repost via `createStatus()` + `postStatus()`
   - **Same origin, no content:** Native reblog via `postReblog()`
   - **External URL + `syndicateExternalReposts` enabled:** Create announcement post via `createRepostStatus()` + `postStatus()` (format: `🔁 URL`)
   - **External URL + option disabled:** Return early (no syndication)

3. **Like handling** (if `properties["like-of"]` exists):
   - **Same origin:** Native favourite via `postFavourite()`
   - **External URL + `syndicateExternalLikes` enabled:** Create announcement post via `createLikeStatus()` + `postStatus()` (format: `❤️ URL`)
   - **External URL + option disabled:** Return early (no syndication)

4. **Regular post:** Create status via `createStatus()` + `postStatus()`

**Return value:** Mastodon status URL (string) or `undefined` if syndication was skipped.

### lib/utils.js - Status Creation

**Responsibilities:**
- Convert JF2 properties to Mastodon status parameters
- HTML to plain text conversion
- Character limit truncation with permalink preservation
- Status ID extraction from Mastodon URLs

#### `createStatus(properties, options)`

Creates standard Mastodon status parameters from JF2 properties.

**Logic:**
1. Extract text:
   - If `content.html`: Convert via `htmlToStatusText()` (strips HTML, appends last external link)
   - Else if `content.text`: Use plain text
2. Format status:
   - If repost-of: `${text} ${repost-of}` (quoted repost with comment)
   - Else if name exists: `${name} ${url}` (article title + link)
   - Else: Just text (note)
3. **Always append permalink** (despite `includePermalink` option):
   - If permalink not already in text: Append `\n\n${url}`
   - Truncate to fit character limit: `status.slice(0, available - 1) + "…" + "\n\n" + url`
4. Add reply handling:
   - If `in-reply-to` is same origin as Mastodon server: Extract status ID, set `inReplyToId`
5. Add visibility:
   - If `visibility` property exists: Pass through to parameters

**Parameters:**
```javascript
{
  status: "Status text\n\nhttps://example.com/post",
  mediaIds: ["12345", "67890"],
  inReplyToId: "111222333444555666",
  visibility: "public"
}
```

#### `createLikeStatus(properties, likedUrl, options)`

Creates status parameters for external like syndication (non-Mastodon URLs).

**Format:**
```
[optional comment]

❤️ https://external-site.com/post
```

**Logic:**
1. Extract comment from `content.html` or `content.text` (optional)
2. Append `❤️ ${likedUrl}` with double newline separator
3. Truncate if needed while preserving the `❤️ URL` suffix

#### `createRepostStatus(properties, repostUrl, options)`

Creates status parameters for external repost syndication (non-Mastodon URLs).

**Format:**
```
[optional comment]

🔁 https://external-site.com/post
```

**Logic:** Same as `createLikeStatus()` but uses 🔁 emoji and `repostUrl`.

#### `getStatusIdFromUrl(url)`

Extracts Mastodon status ID from URL.

**Examples:**
```javascript
getStatusIdFromUrl("https://mastodon.social/@user/123456789")
// Returns: "123456789"

getStatusIdFromUrl("https://fosstodon.org/@username/111222333444555")
// Returns: "111222333444555"
```

**Implementation:** Uses `path.basename(new URL(url).pathname)` to get the last path segment.

#### `htmlToStatusText(html, serverUrl)`

Converts HTML content to plain text suitable for Mastodon.

**Logic:**
1. Extract all `href` attributes via regex: `/href="(https?:\/\/.+?)"/g`
2. Filter out links to the Mastodon server itself (usernames, hashtags)
3. Get the last external link
4. Convert HTML to text via `html-to-text`:
   - Ignore `href` attributes (we append manually)
   - Skip `<img>` tags
   - No word wrapping
5. Append last external link (if any): `${text} ${lastHref}`

**Why append last link?** Mastodon automatically generates link previews for the last URL in a status. This ensures external links are clickable even after HTML conversion.

## Mastodon API Integration

Uses the **`masto`** npm package (v6.0.0) which provides a typed REST API client for Mastodon.

### Authentication

**Access Token:** Required. Set via:
- Environment variable: `MASTODON_ACCESS_TOKEN`
- Plugin option: `accessToken` in `indiekit.config.js`

**How to get an access token:**
1. Go to your Mastodon instance → Settings → Development → New Application
2. Set application name (e.g., "My IndieWeb Site")
3. Required scopes: `read`, `write`
4. Copy the access token

### API Endpoints Used

#### v1.statuses.create(parameters)
Creates a new status.

**Parameters:**
- `status` (string, required) - Status text
- `mediaIds` (array) - Media attachment IDs
- `inReplyToId` (string) - Parent status ID for replies
- `visibility` (string) - `public`, `unlisted`, `private`, `direct`

**Returns:** Status object with `url` property

#### v1.statuses.$select(id).favourite()
Favourites a status (like).

**Returns:** Status object with `url` property (your favourite action's URL)

#### v1.statuses.$select(id).reblog()
Reblogs a status (boost/repost).

**Returns:** Status object with `url` property (your reblog's URL)

#### v2.media.create({ file, description })
Uploads media attachment.

**Parameters:**
- `file` (Blob) - Media file
- `description` (string) - Alt text

**Returns:** Media object with `id` property

## Post Type Handling

### Regular Posts (articles, notes, photos)

**Input JF2:**
```json
{
  "type": "entry",
  "name": "Article Title",
  "content": {
    "html": "<p>Article content with <a href='https://example.com'>link</a>.</p>"
  },
  "url": "https://mysite.com/2025/01/article-slug",
  "photo": [
    { "url": "https://mysite.com/media/photo.jpg", "alt": "Photo description" }
  ]
}
```

**Mastodon Status:**
```
Article Title https://mysite.com/2025/01/article-slug

[Photo attachment with alt text]
```

**Notes without name:**
```json
{
  "type": "entry",
  "content": { "text": "This is a short note." },
  "url": "https://mysite.com/2025/01/note-slug"
}
```

**Mastodon Status:**
```
This is a short note.

https://mysite.com/2025/01/note-slug
```

### Native Mastodon Likes

**Input JF2:**
```json
{
  "type": "entry",
  "like-of": "https://mastodon.social/@user/123456789",
  "url": "https://mysite.com/2025/01/like-of-mastodon"
}
```

**Action:** Calls `v1.statuses.$select("123456789").favourite()`

**Result:** Native Mastodon favourite (no new status created, just a favourite action on the existing status)

### External Likes (syndicateExternalLikes: true)

**Input JF2:**
```json
{
  "type": "entry",
  "like-of": "https://someones-blog.com/cool-post",
  "content": { "text": "Great post about IndieWeb!" },
  "url": "https://mysite.com/2025/01/like-of-blog"
}
```

**Mastodon Status:**
```
Great post about IndieWeb!

❤️ https://someones-blog.com/cool-post
```

### Native Mastodon Reposts (simple reblog)

**Input JF2:**
```json
{
  "type": "entry",
  "repost-of": "https://mastodon.social/@user/123456789",
  "url": "https://mysite.com/2025/01/repost-of-mastodon"
}
```

**Action:** Calls `v1.statuses.$select("123456789").reblog()`

**Result:** Native Mastodon reblog (boosts the original status to your followers)

### Quoted Mastodon Reposts (with comment)

**Input JF2:**
```json
{
  "type": "entry",
  "repost-of": "https://mastodon.social/@user/123456789",
  "content": { "text": "This is so true!" },
  "url": "https://mysite.com/2025/01/repost-with-comment"
}
```

**Mastodon Status:**
```
This is so true! https://mastodon.social/@user/123456789
```

**Note:** This creates a new status (not a native reblog) because you added a comment. The original URL is included in the text.

### External Reposts (syndicateExternalReposts: true)

**Input JF2:**
```json
{
  "type": "entry",
  "repost-of": "https://someones-blog.com/cool-post",
  "url": "https://mysite.com/2025/01/repost-of-blog"
}
```

**Mastodon Status:**
```
🔁 https://someones-blog.com/cool-post
```

### Replies to Mastodon Posts

**Input JF2:**
```json
{
  "type": "entry",
  "in-reply-to": "https://mastodon.social/@user/123456789",
  "content": { "text": "Great point!" },
  "url": "https://mysite.com/2025/01/reply"
}
```

**Mastodon Status:**
```
Great point!

https://mysite.com/2025/01/reply
```

**Parameters:**
```javascript
{
  status: "Great point!\n\nhttps://mysite.com/2025/01/reply",
  inReplyToId: "123456789"
}
```

**Result:** Status appears in the reply chain on Mastodon.

## Configuration

### Minimal Configuration

```javascript
// indiekit.config.js
import MastodonSyndicator from "@rmdes/indiekit-syndicator-mastodon";

export default {
  plugins: [
    new MastodonSyndicator({
      url: "https://mastodon.social",
      user: "yourusername",
      // accessToken read from MASTODON_ACCESS_TOKEN env var
    }),
  ],
};
```

### Full Configuration

```javascript
import MastodonSyndicator from "@rmdes/indiekit-syndicator-mastodon";

export default {
  plugins: [
    new MastodonSyndicator({
      url: "https://fosstodon.org", // Your Mastodon instance
      user: "yourusername",          // Without @
      accessToken: process.env.MASTODON_ACCESS_TOKEN,
      characterLimit: 500,           // Server default
      checked: true,                 // Pre-select in Micropub UI
      syndicateExternalLikes: true,  // Create statuses for non-Mastodon likes
      syndicateExternalReposts: true, // Create statuses for non-Mastodon reposts
    }),
  ],
};
```

### Environment Variables

```bash
# .env
MASTODON_ACCESS_TOKEN=your_access_token_here
```

## Inter-Plugin Relationships

### Used By

- **`@rmdes/indiekit-endpoint-syndicate`** - Calls `syndicator.syndicate(properties, publication)` to cross-post after publishing
- **`@indiekit/endpoint-micropub`** - Provides syndication targets to Micropub clients

### Uses

- **`@indiekit/error`** - `IndiekitError` for standardized error handling
- **`@indiekit/util`** - `getCanonicalUrl()`, `isSameOrigin()` helpers

### Related Plugins

- **`@rmdes/indiekit-syndicator-bluesky`** - Similar architecture, different protocol (AT Protocol)
- **`@rmdes/indiekit-syndicator-linkedin`** - Similar architecture, LinkedIn API

## Gotchas

### 1. Permalink Always Appended (Despite includePermalink Option)

**Issue:** The `includePermalink` option in `index.js` defaults to `false`, but `createStatus()` in `utils.js` **always appends the permalink** regardless of this setting.

**Why:** The logic in `utils.js` (lines 35-50) has no conditional check for `includePermalink`. It always checks if `permalink` exists and appends it if not already in the status.

**Impact:** Users cannot disable permalink inclusion even if they set `includePermalink: false`.

**Fix (if needed):** Pass `includePermalink` option to `createStatus()` and wrap lines 38-49 in:
```javascript
if (options.includePermalink && permalink && !status.includes(permalink)) {
  // ...
}
```

**Current behavior:** Treat `includePermalink` as vestigial/deprecated. Permalinks are always included.

### 2. External Interaction Syndication Defaults to TRUE

**Issue:** `syndicateExternalLikes` and `syndicateExternalReposts` default to `true` in `index.js` (lines 12-13), but the check in `mastodon.js` uses `!== false` (lines 22-23), which means `undefined` also evaluates to `true`.

**Impact:** If users don't explicitly set these options, external interactions WILL be syndicated. This may surprise users who expect no syndication (like upstream Mastodon syndicators).

**Rationale:** This is intentional design for `@rmdes/` fork. External interaction syndication is a feature, not a bug.

**To disable:** Explicitly set to `false` in config:
```javascript
new MastodonSyndicator({
  syndicateExternalLikes: false,
  syndicateExternalReposts: false,
})
```

### 3. Character Limit Truncation Preserves Permalink

**Issue:** When truncating long content, the code prioritizes preserving the full permalink over content.

**Logic (lines 39-49 in utils.js):**
```javascript
const suffix = `\n\n${permalink}`;
const available = limit - suffix.length;
if (status.length > available) {
  status = status.slice(0, available - 1).trim() + "…" + suffix;
}
```

**Impact:** Long articles get truncated to fit `characterLimit - permalink.length - 3` characters. Users see truncated content but always get the full URL.

**Why:** Ensures Mastodon link previews always work (requires full URL). Content can be read by clicking through.

**Alternative approach (NOT implemented):** Truncate URL to domain only. Would lose link previews.

### 4. HTML Link Extraction Appends Last External Link

**Issue:** `htmlToStatusText()` extracts all `href` attributes and appends the **last external link** to the plain text, even though HTML may contain multiple links.

**Rationale:** Mastodon generates link previews for the last URL in a status. This ensures the "most important" link (assumed to be last) gets a preview card.

**Impact:** If your HTML has multiple links, only the last one appears explicitly in the status text. Other links are lost during HTML to text conversion.

**Example:**
```html
<p>Check out <a href="https://a.com">site A</a> and <a href="https://b.com">site B</a>.</p>
```

**Result:**
```
Check out site A and site B. https://b.com
```

**Workaround:** Structure your HTML so the most important link is last, or use plain text content instead.

### 5. Media Upload Limit (4 Photos)

**Code (line 119 in mastodon.js):**
```javascript
const photos = properties.photo.slice(0, 4);
```

**Issue:** Mastodon supports up to 4 media attachments per status. The plugin silently truncates `properties.photo` array to first 4 items.

**Impact:** If your IndieWeb post has 5+ photos, only the first 4 are syndicated. No error or warning.

**Why:** Mastodon API limitation. Attempting to upload 5+ would return 422 Unprocessable Entity.

### 6. Reply Threading Only Works for Same-Origin Replies

**Code (lines 61-73 in utils.js):**
```javascript
if (properties["in-reply-to"]) {
  const inReplyToHostname = new URL(inReplyTo).hostname;
  const serverHostname = new URL(serverUrl).hostname;
  if (inReplyToHostname === serverHostname) {
    parameters.inReplyToId = statusId;
  }
}
```

**Impact:** Replies to posts on your own Mastodon instance are threaded correctly. Replies to posts on other instances appear as standalone statuses (no threading).

**Why:** Mastodon's `inReplyToId` parameter requires the status to exist on your local instance (federated copy). Cross-instance threading via URL alone is not supported by Mastodon API.

**Workaround:** None at plugin level. This is a Mastodon protocol limitation.

### 7. Status ID Extraction Assumes Numeric ID in URL Path

**Code (line 198 in utils.js):**
```javascript
const statusId = path.basename(parsedUrl.pathname);
```

**Assumption:** Mastodon status URLs follow the format `https://instance/@user/STATUS_ID`.

**Issue:** Works for standard Mastodon instances, but may break if:
- Instance uses non-standard URL format
- URL has trailing slash: `https://instance/@user/123456/` → returns empty string
- URL has query params or anchors (handled by `pathname`, so OK)

**Robustness:** Should validate that `statusId` is numeric and non-empty before API calls.

### 8. Media Upload Errors Are Thrown, Not Logged

**Code (lines 102-104 in mastodon.js):**
```javascript
} catch (error) {
  throw new Error(error.message);
}
```

**Issue:** If a single photo fails to upload (404, network error, etc.), the entire syndication fails. `Promise.all()` on line 123 will reject.

**Impact:** A single broken image URL prevents syndication of an otherwise valid post.

**Alternative approach:** Log errors and skip failed uploads:
```javascript
mediaIds = (await Promise.allSettled(uploads))
  .filter(result => result.status === "fulfilled")
  .map(result => result.value);
```

**Current behavior:** Fail fast. User sees error in Indiekit UI and can fix the broken image URL.

## Development

### Install Dependencies

```bash
npm install
```

### Test Configuration

Create a test Indiekit config:

```javascript
// test.config.js
import MastodonSyndicator from "./index.js";

export default {
  plugins: [
    new MastodonSyndicator({
      url: "https://mastodon.social",
      user: "testuser",
    }),
  ],
};
```

### Manual Testing Checklist

- [ ] Regular note syndication
- [ ] Article with title syndication
- [ ] Photo post (single photo)
- [ ] Photo post (multiple photos, verify 4-photo limit)
- [ ] Like of Mastodon URL (native favourite)
- [ ] Like of external URL (create status with ❤️)
- [ ] Repost of Mastodon URL (native reblog)
- [ ] Repost of external URL (create status with 🔁)
- [ ] Quoted repost of Mastodon URL (with comment)
- [ ] Reply to Mastodon URL (verify threading)
- [ ] Long post (verify character limit truncation)
- [ ] HTML content (verify link extraction and appending)

## Publishing Workflow

1. Edit code
2. Bump version in `package.json`
3. Commit and push to GitHub
4. **USER MUST RUN:** `npm publish` (requires OTP)
5. Update `indiekit-cloudron/Dockerfile` with new version
6. Update deployment config files (`.template` and `.rmendes`)
7. Run `make prepare` in `indiekit-cloudron/`
8. Run `cloudron build --no-cache && cloudron update --app rmendes.net --no-backup`

## Related Files

- Upstream reference: `/home/rick/code/indiekit-dev/indiekit/packages/syndicator-mastodon/` (if present)
- Bluesky equivalent: `/home/rick/code/indiekit-dev/indiekit-syndicator-bluesky/`
- LinkedIn equivalent: `/home/rick/code/indiekit-dev/indiekit-syndicator-linkedin/`

## Future Enhancements

1. **Make `includePermalink` functional** - Pass option through to `createStatus()` and respect user preference
2. **Graceful media upload failures** - Use `Promise.allSettled()` instead of `Promise.all()` to skip broken images
3. **Configurable media limit** - Allow users to set max photos (1-4)
4. **Emoji customization** - Allow users to customize ❤️ and 🔁 emojis for external interactions
5. **Multiple link handling** - Append all external links, not just last one (may clutter status)
6. **Status ID validation** - Verify numeric ID before API calls
7. **Cross-instance reply threading** - Search for federated status ID before replying (requires additional API call)
8. **Content-Type detection** - Use HTML content only for articles, plain text for notes (current logic always prefers HTML)
