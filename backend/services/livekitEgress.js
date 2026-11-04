'use strict';

const {
  EgressClient,
  EncodedFileOutput,
  EncodedFileType,
  S3Upload,
} = require('livekit-server-sdk');
const { livekitHttpUrl } = require('./liveRtc/livekitProvider');

function spacesEndpointHttps() {
  const ep = String(process.env.SPACES_ENDPOINT || '').trim().replace(/\/+$/, '');
  if (!ep) return null;
  if (/^https?:\/\//i.test(ep)) return ep;
  return `https://${ep}`;
}

function isEgressConfigured() {
  return Boolean(
    livekitHttpUrl() &&
      process.env.LIVEKIT_API_KEY &&
      process.env.LIVEKIT_API_SECRET &&
      process.env.SPACES_BUCKET &&
      process.env.SPACES_KEY &&
      process.env.SPACES_SECRET &&
      spacesEndpointHttps()
  );
}

function getClient() {
  const host = livekitHttpUrl();
  if (!host) throw new Error('LIVEKIT_URL is not configured');
  return new EgressClient(host, process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET);
}

function buildS3Upload() {
  const endpoint = spacesEndpointHttps();
  if (!endpoint) throw new Error('SPACES_ENDPOINT must be set for LiveKit egress upload');
  return new S3Upload({
    accessKey: process.env.SPACES_KEY,
    secret: process.env.SPACES_SECRET,
    bucket: process.env.SPACES_BUCKET,
    region: process.env.SPACES_REGION || 'us-east-1',
    endpoint,
    forcePathStyle: true,
  });
}

/**
 * @param {{ roomName: string, filepath: string }} p
 */
async function startRoomCompositeMp4({ roomName, filepath }) {
  const client = getClient();
  const output = new EncodedFileOutput({
    fileType: EncodedFileType.MP4,
    filepath,
    output: {
      case: 's3',
      value: buildS3Upload(),
    },
  });
  const info = await client.startRoomCompositeEgress(roomName, { file: output });
  const egressId = info?.egressId || info?.egress_id;
  if (!egressId) throw new Error('LiveKit egress did not return egressId');
  return { egressId, info };
}

async function stopEgress(egressId) {
  if (!egressId) return null;
  const client = getClient();
  const stopPromise = client.stopEgress(egressId);
  const timeout = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('LiveKit egress stop timed out')), 12_000);
  });
  return Promise.race([stopPromise, timeout]);
}

function playbackUrlForFilepath(filepath) {
  const cdn = String(process.env.SPACES_CDN_BASE_URL || '').trim().replace(/\/+$/, '');
  const key = String(filepath || '').replace(/^\/+/, '');
  if (cdn) return `${cdn}/${key}`;
  const ep = spacesEndpointHttps();
  const bucket = process.env.SPACES_BUCKET;
  if (!ep || !bucket || !key) return null;
  const host = ep.replace(/^https?:\/\//, '');
  return `https://${bucket}.${host}/${key}`;
}

module.exports = {
  isEgressConfigured,
  startRoomCompositeMp4,
  stopEgress,
  playbackUrlForFilepath,
};
