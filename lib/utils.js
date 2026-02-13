import path from "node:path";
import { htmlToText } from "html-to-text";

/**
 * Get status parameters from given JF2 properties
 * @param {object} properties - JF2 properties
 * @param {object} [options] - Options
 * @param {number} [options.characterLimit] - Character limit
 * @param {Array} [options.mediaIds] - Mastodon media IDs
 * @param {string} [options.serverUrl] - Server URL
 * @returns {object} Status parameters
 */
export const createStatus = (properties, options = {}) => {
  const { characterLimit, mediaIds, serverUrl } = options;
  const parameters = {};

  let status;
  let statusText;

  if (properties.content?.html) {
    statusText = htmlToStatusText(properties.content.html, serverUrl);
  } else if (properties.content?.text) {
    statusText = properties.content.text;
  }

  if (statusText && properties["repost-of"]) {
    status = `${statusText} ${properties["repost-of"]}`;
  } else if (properties.name && properties.name !== "") {
    status = `${properties.name} ${properties.url}`;
  } else if (statusText) {
    status = statusText;
  }

  // Always include permalink and truncate content to fit character limit
  if (status) {
    const limit = characterLimit || 500;
    const permalink = properties.url;

    if (permalink && !status.includes(permalink)) {
      const suffix = `\n\n${permalink}`;
      const available = limit - suffix.length;
      if (status.length > available) {
        status = status.slice(0, available - 1).trim() + "\u2026" + suffix;
      } else {
        status = status + suffix;
      }
    } else if (status.length > limit) {
      // Permalink already in text, just truncate
      status = status.slice(0, limit - 1).trim() + "\u2026";
    }

    parameters.status = status;
  }

  // Add media IDs
  if (mediaIds) {
    parameters.mediaIds = mediaIds;
  }

  // If post is in reply to a status, add respective parameter
  if (properties["in-reply-to"]) {
    const inReplyTo = properties["in-reply-to"];
    try {
      const inReplyToHostname = new URL(inReplyTo).hostname;
      const serverHostname = new URL(serverUrl).hostname;
      if (inReplyToHostname === serverHostname) {
        const statusId = getStatusIdFromUrl(inReplyTo);
        parameters.inReplyToId = statusId;
      }
    } catch {
      // Invalid URL, skip reply handling
    }
  }

  // If post visibility set, use the same setting
  if (properties.visibility) {
    parameters.visibility = properties.visibility;
  }

  return parameters;
};

/**
 * Create status parameters for a like of an external URL
 * @param {object} properties - JF2 properties
 * @param {string} likedUrl - The URL being liked
 * @param {object} [options] - Options
 * @param {number} [options.characterLimit] - Character limit
 * @param {Array} [options.mediaIds] - Mastodon media IDs
 * @param {string} [options.serverUrl] - Server URL
 * @returns {object} Status parameters
 */
export const createLikeStatus = (properties, likedUrl, options = {}) => {
  const { characterLimit, mediaIds, serverUrl } = options;
  const parameters = {};

  let status = "";

  // Get the content/comment
  if (properties.content?.html) {
    status = htmlToStatusText(properties.content.html, serverUrl);
  } else if (properties.content?.text) {
    status = properties.content.text;
  }

  // Append the liked URL
  if (status) {
    if (!status.includes(likedUrl)) {
      status = `${status}\n\n❤️ ${likedUrl}`;
    }
  } else {
    status = `❤️ ${likedUrl}`;
  }

  // Truncate if needed
  const limit = characterLimit || 500;
  if (status.length > limit) {
    const suffix = `\n\n❤️ ${likedUrl}`;
    const maxLen = limit - suffix.length - 3;
    const contentPart = status.replace(suffix, "").slice(0, maxLen).trim();
    status = contentPart + "..." + suffix;
  }

  parameters.status = status;

  if (mediaIds) {
    parameters.mediaIds = mediaIds;
  }

  if (properties.visibility) {
    parameters.visibility = properties.visibility;
  }

  return parameters;
};

/**
 * Create status parameters for a repost of an external URL
 * @param {object} properties - JF2 properties
 * @param {string} repostUrl - The URL being reposted
 * @param {object} [options] - Options
 * @param {number} [options.characterLimit] - Character limit
 * @param {Array} [options.mediaIds] - Mastodon media IDs
 * @param {string} [options.serverUrl] - Server URL
 * @returns {object} Status parameters
 */
export const createRepostStatus = (properties, repostUrl, options = {}) => {
  const { characterLimit, mediaIds, serverUrl } = options;
  const parameters = {};

  let status = "";

  // Get the content/comment
  if (properties.content?.html) {
    status = htmlToStatusText(properties.content.html, serverUrl);
  } else if (properties.content?.text) {
    status = properties.content.text;
  }

  // Append the reposted URL
  if (status) {
    if (!status.includes(repostUrl)) {
      status = `${status}\n\n🔁 ${repostUrl}`;
    }
  } else {
    status = `🔁 ${repostUrl}`;
  }

  // Truncate if needed
  const limit = characterLimit || 500;
  if (status.length > limit) {
    const suffix = `\n\n🔁 ${repostUrl}`;
    const maxLen = limit - suffix.length - 3;
    const contentPart = status.replace(suffix, "").slice(0, maxLen).trim();
    status = contentPart + "..." + suffix;
  }

  parameters.status = status;

  if (mediaIds) {
    parameters.mediaIds = mediaIds;
  }

  if (properties.visibility) {
    parameters.visibility = properties.visibility;
  }

  return parameters;
};

/**
 * Get status ID from Mastodon status URL
 * @param {string} url - Mastodon status URL
 * @returns {string} Status ID
 */
export const getStatusIdFromUrl = (url) => {
  const parsedUrl = new URL(url);
  const statusId = path.basename(parsedUrl.pathname);
  return statusId;
};

/**
 * Convert HTML to plain text, appending all external link hrefs
 * @param {string} html - HTML
 * @param {string} serverUrl - Server URL
 * @returns {string} Text
 */
export const htmlToStatusText = (html, serverUrl) => {
  let hrefs = [...html.matchAll(/href="(https?:\/\/.+?)"/g)];

  // Remove any links to Mastodon server (usernames/hashtags)
  if (serverUrl) {
    hrefs = hrefs.filter((href) => {
      try {
        const hrefHostname = new URL(href[1]).hostname;
        const serverHostname = new URL(serverUrl).hostname;
        return hrefHostname !== serverHostname;
      } catch {
        return true;
      }
    });
  }

  const urls = [...new Set(hrefs.map((h) => h[1]))];

  const text = htmlToText(html, {
    selectors: [
      { selector: "a", options: { ignoreHref: true } },
      { selector: "img", format: "skip" },
    ],
    wordwrap: false,
  });

  // Append URLs that aren't already visible in the text
  const missingUrls = urls.filter((url) => !text.includes(url));
  if (missingUrls.length > 0) {
    return `${text}\n\n${missingUrls.join("\n")}`;
  }
  return text;
};
