import { IndiekitError } from "@indiekit/error";
import { getCanonicalUrl, isSameOrigin } from "@indiekit/util";
import { createRestAPIClient } from "masto";

import { createStatus, createLikeStatus, getStatusIdFromUrl } from "./utils.js";

export class Mastodon {
  /**
   * @param {object} options - Mastodon options
   * @param {string} options.accessToken - Access token
   * @param {string} options.serverUrl - Server URL
   * @param {number} options.characterLimit - Server character limit
   * @param {boolean} [options.includePermalink] - Include permalink in status
   * @param {boolean} [options.syndicateExternalLikes] - Syndicate likes of external URLs
   */
  constructor(options) {
    this.accessToken = options.accessToken;
    this.characterLimit = options.characterLimit;
    this.serverUrl = options.serverUrl;
    this.includePermalink = options.includePermalink || false;
    this.syndicateExternalLikes = options.syndicateExternalLikes !== false; // Default true
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
   * Post a favourite
   * @param {string} statusUrl - URL of status to favourite
   * @returns {Promise<string>} Mastodon status URL
   */
  async postFavourite(statusUrl) {
    const { v1 } = this.#client();
    const statusId = getStatusIdFromUrl(statusUrl);
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
    const statusId = getStatusIdFromUrl(statusUrl);
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
   * @returns {Promise<string>} Mastodon media id
   */
  async uploadMedia(media, me) {
    const { alt, url } = media;

    if (typeof url !== "string") {
      return;
    }

    try {
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
    } catch (error) {
      throw new Error(error.message);
    }
  }

  /**
   * Post to Mastodon
   * @param {object} properties - JF2 properties
   * @param {string} me - Publication URL
   * @returns {Promise<string|boolean>} URL of syndicated status
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
      mediaIds = await Promise.all(uploads);
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

      // Do not syndicate reposts of other URLs
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
      mediaIds,
      serverUrl: this.serverUrl,
    });

    if (status.status) {
      return this.postStatus(status);
    }
  }
}
