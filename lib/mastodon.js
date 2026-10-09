import { IndiekitError } from "@indiekit/error";
import { getCanonicalUrl, isSameOrigin } from "@indiekit/util";
import { createRestAPIClient } from "masto";

import {
  createStatus,
  createLikeStatus,
  createRepostStatus,
  getStatusIdFromUrl,
} from "./utils.js";

export class Mastodon {
  /**
   * @param {object} options - Mastodon options
   * @param {string} options.accessToken - Access token
   * @param {string} options.serverUrl - Server URL
   * @param {number} options.characterLimit - Server character limit
   * @param {boolean} [options.includeCategories] - Add categories as hashtags
   * @param {boolean} [options.includePermalink] - Include permalink in status
   * @param {boolean} [options.syndicateExternalLikes] - Syndicate likes of external URLs
   * @param {boolean} [options.syndicateExternalReposts] - Syndicate reposts of external URLs
   */
  constructor(options) {
    this.accessToken = options.accessToken;
    this.characterLimit = options.characterLimit;
    this.serverUrl = options.serverUrl;
    this.includeCategories = options.includeCategories || false;
    this.includePermalink = options.includePermalink || false;
    this.syndicateExternalLikes = options.syndicateExternalLikes !== false; // Default true
    this.syndicateExternalReposts = options.syndicateExternalReposts !== false; // Default true
  }

  /**
   * Initialise Mastodon client
   * @access private
   * @returns {object} Mastodon client
   */
  #client() {
    return createRestAPIClient({
      accessToken: this.accessToken,
      url: this.serverUrl,
    });
  }

  /**
   * Get the status ID on this server for a status URL, wherever it lives
   * @param {string} statusUrl - URL of the status
   * @returns {Promise<string>} Status ID on this server
   */
  async #getLocalStatusId(statusUrl) {
    if (isSameOrigin(statusUrl, this.serverUrl)) {
      return getStatusIdFromUrl(statusUrl);
    }

    const statusId = await this.resolveRemoteStatus(statusUrl);
    if (!statusId) {
      throw new Error(`Could not resolve remote status: ${statusUrl}`);
    }

    return statusId;
  }

  /**
   * Resolve the URL of a status on another server to a status ID on this one
   *
   * Searching with `resolve` asks the server to fetch the status over
   * ActivityPub if it hasn’t seen it before.
   * @param {string} statusUrl - URL of status on another server
   * @returns {Promise<string|undefined>} Status ID, if resolved
   * @see {@link https://docs.joinmastodon.org/methods/search/}
   */
  async resolveRemoteStatus(statusUrl) {
    const { v2 } = this.#client();
    const { statuses } = await v2.search.list({
      q: statusUrl,
      type: "statuses",
      resolve: true,
      limit: 1,
    });

    return statuses[0]?.id;
  }

  /**
   * Post a favourite
   * @param {string} statusUrl - URL of status to favourite
   * @returns {Promise<string>} Mastodon status URL
   */
  async postFavourite(statusUrl) {
    const { v1 } = this.#client();
    const statusId = await this.#getLocalStatusId(statusUrl);
    const status = await v1.statuses.$select(statusId).favourite();
    return status.url;
  }

  /**
   * Post a reblog
   * @param {string} statusUrl - URL of status to reblog
   * @returns {Promise<string>} Mastodon status URL
   */
  async postReblog(statusUrl) {
    const { v1 } = this.#client();
    const statusId = await this.#getLocalStatusId(statusUrl);
    const status = await v1.statuses.$select(statusId).reblog();
    return status.url;
  }

  /**
   * Post a status
   * @param {object} parameters - Status parameters
   * @returns {Promise<string>} Mastodon status URL
   */
  async postStatus(parameters) {
    const { v1 } = this.#client();
    const status = await v1.statuses.create(parameters);
    return status.url;
  }

  /**
   * Upload media and return Mastodon media id
   * @param {object} media - JF2 media object
   * @param {string} me - Publication URL
   * @returns {Promise<string|undefined>} Mastodon media id
   */
  async uploadMedia(media, me) {
    const { alt, url } = media;

    if (typeof url !== "string") {
      return;
    }

    const mediaUrl = getCanonicalUrl(url, me);
    const mediaResponse = await fetch(mediaUrl);

    if (!mediaResponse.ok) {
      throw await IndiekitError.fromFetch(mediaResponse);
    }

    const { v2 } = this.#client();
    const blob = await mediaResponse.blob();
    const attachment = await v2.media.create({
      file: new Blob([blob]),
      description: alt,
    });

    return attachment.id;
  }

  /**
   * Post to Mastodon
   * @param {object} properties - JF2 properties
   * @param {string} me - Publication URL
   * @returns {Promise<string|undefined>} URL of syndicated status
   */
  async post(properties, me) {
    let mediaIds = [];

    // Upload photos
    if (properties.photo) {
      const uploads = [];
      const photos = properties.photo.slice(0, 4);
      for await (const photo of photos) {
        uploads.push(this.uploadMedia(photo, me));
      }

      const uploadedIds = await Promise.all(uploads);
      mediaIds = uploadedIds.filter((id) => id !== undefined);
    }

    // Handle reposts
    if (properties["repost-of"]) {
      if (
        isSameOrigin(properties["repost-of"], this.serverUrl) &&
        properties.content
      ) {
        const status = createStatus(properties, {
          characterLimit: this.characterLimit,
          mediaIds,
          serverUrl: this.serverUrl,
        });
        return this.postStatus(status);
      }

      if (isSameOrigin(properties["repost-of"], this.serverUrl)) {
        return this.postReblog(properties["repost-of"]);
      }

      // Syndicate reposts of external URLs as statuses
      if (this.syndicateExternalReposts) {
        const status = createRepostStatus(properties, properties["repost-of"], {
          characterLimit: this.characterLimit,
          mediaIds,
          serverUrl: this.serverUrl,
        });
        if (status.status) {
          return this.postStatus(status);
        }
      }

      return;
    }

    // Handle likes
    if (properties["like-of"]) {
      // Native Mastodon favourite for Mastodon URLs
      if (isSameOrigin(properties["like-of"], this.serverUrl)) {
        return this.postFavourite(properties["like-of"]);
      }

      // NEW: Syndicate likes of external URLs as statuses
      if (this.syndicateExternalLikes) {
        const status = createLikeStatus(properties, properties["like-of"], {
          characterLimit: this.characterLimit,
          mediaIds,
          serverUrl: this.serverUrl,
        });
        if (status.status) {
          return this.postStatus(status);
        }
      }

      // Don't syndicate if option is disabled
      return;
    }

    // Regular post
    const status = createStatus(properties, {
      characterLimit: this.characterLimit,
      includeCategories: this.includeCategories,
      mediaIds,
      serverUrl: this.serverUrl,
    });

    // Thread reply to a status on another server, if it can be resolved
    const inReplyTo = properties["in-reply-to"];
    if (status && inReplyTo && !isSameOrigin(inReplyTo, this.serverUrl)) {
      const statusId = await this.resolveRemoteStatus(inReplyTo);
      if (statusId) {
        status.inReplyToId = statusId;
      }
    }

    if (status) {
      return this.postStatus(status);
    }
  }
}
