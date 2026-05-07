'use strict';

/**
 * Agora Cloud Recording REST API (composite / mix mode).
 * @see https://docs.agora.io/en/cloud-recording/reference/restful-api
 */

function getRecordingAuthHeader() {
  const id = process.env.AGORA_CUSTOMER_ID;
  const secret = process.env.AGORA_CUSTOMER_SECRET;
  if (!id || !secret) return null;
  return `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`;
}

function recordingApiBase() {
  const host = process.env.AGORA_RECORDING_API_HOST || 'api.agora.io';
  const appId = process.env.AGORA_APP_ID;
  if (!appId) throw new Error('AGORA_APP_ID is required for cloud recording');
  return { host, appId };
}

async function recordingFetch(relPath, opts = {}) {
  const auth = getRecordingAuthHeader();
  if (!auth) throw new Error('AGORA_CUSTOMER_ID and AGORA_CUSTOMER_SECRET must be set for cloud recording');
  const { host, appId } = recordingApiBase();
  const url = `https://${host}/v1/apps/${appId}/cloud_recording/${relPath}`;
  const res = await fetch(url, {
    method: opts.method || 'GET',
    headers: {
      Authorization: auth,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
    body: opts.body != null ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.message || data.reason || data.error || JSON.stringify(data);
    throw new Error(`Agora Cloud Recording ${opts.method || 'GET'} ${relPath}: HTTP ${res.status} ${msg}`);
  }
  return data;
}

function isRecordingApiConfigured() {
  return Boolean(
    process.env.AGORA_CUSTOMER_ID &&
      process.env.AGORA_CUSTOMER_SECRET &&
      process.env.AGORA_APP_ID &&
      process.env.SPACES_BUCKET &&
      process.env.SPACES_KEY &&
      process.env.SPACES_SECRET &&
      process.env.SPACES_ENDPOINT
  );
}

/**
 * @param {{ cname: string, uid: string }} p
 */
function acquire({ cname, uid }) {
  return recordingFetch('acquire', {
    method: 'POST',
    body: { cname, uid: String(uid), clientRequest: {} },
  });
}

/**
 * @param {{ resourceId: string, cname: string, uid: string, clientRequest: object }} p
 */
function startMix({ resourceId, cname, uid, clientRequest }) {
  const path = `resourceid/${encodeURIComponent(resourceId)}/mode/mix/start`;
  return recordingFetch(path, {
    method: 'POST',
    body: { cname, uid: String(uid), clientRequest },
  });
}

/**
 * @param {{ resourceId: string, sid: string, cname: string, uid: string, asyncStop?: boolean }} p
 */
function stopMix({ resourceId, sid, cname, uid, asyncStop = false }) {
  const path = `resourceid/${encodeURIComponent(resourceId)}/sid/${encodeURIComponent(sid)}/mode/mix/stop`;
  return recordingFetch(path, {
    method: 'POST',
    body: {
      cname,
      uid: String(uid),
      clientRequest: { async_stop: Boolean(asyncStop) },
    },
  });
}

function queryMix({ resourceId, sid }) {
  const path = `resourceid/${encodeURIComponent(resourceId)}/sid/${encodeURIComponent(sid)}/mode/mix/query`;
  return recordingFetch(path, { method: 'GET' });
}

/** DigitalOcean Spaces via vendor 11 (S3-compatible). */
function buildSpacesStorageConfig(fileNamePrefixArr) {
  const bucket = process.env.SPACES_BUCKET;
  const accessKey = process.env.SPACES_KEY;
  const secretKey = process.env.SPACES_SECRET;
  const endpoint = process.env.SPACES_ENDPOINT;
  if (!bucket || !accessKey || !secretKey || !endpoint) {
    throw new Error('SPACES_BUCKET, SPACES_KEY, SPACES_SECRET, SPACES_ENDPOINT must be set for recording upload');
  }
  const ep = String(endpoint).replace(/^https?:\/\//, '').replace(/\/+$/, '');
  return {
    vendor: 11,
    region: 0,
    bucket,
    accessKey,
    secretKey,
    fileNamePrefix: fileNamePrefixArr,
    extensionParams: {
      endpoint: ep,
      // Hint ACLs for S3-compatible backends; bucket policy remains source of truth.
      acl: 'public-read',
      'x-amz-acl': 'public-read',
    },
  };
}

/** Composite recording ~480p landscape. */
function buildMixRecordingConfig480p() {
  return {
    channelType: 0,
    streamTypes: 2,
    videoStreamType: 0,
    maxIdleTime: 120,
    streamMode: 'default',
    transcodingConfig: {
      width: 854,
      height: 480,
      fps: 15,
      bitrate: 1000,
      mixedVideoLayout: 1,
    },
  };
}

module.exports = {
  isRecordingApiConfigured,
  acquire,
  startMix,
  stopMix,
  queryMix,
  buildSpacesStorageConfig,
  buildMixRecordingConfig480p,
};
