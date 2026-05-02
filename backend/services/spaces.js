const path = require('path');
const { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } = require('@aws-sdk/client-s3');

function isSpacesConfigured() {
  return Boolean(
    process.env.SPACES_ENDPOINT &&
      process.env.SPACES_BUCKET &&
      process.env.SPACES_KEY &&
      process.env.SPACES_SECRET
  );
}

let s3Client = null;

function getSpacesClient() {
  if (!isSpacesConfigured()) return null;
  if (s3Client) return s3Client;
  s3Client = new S3Client({
    region: process.env.SPACES_REGION || 'us-east-1',
    endpoint: `https://${process.env.SPACES_ENDPOINT}`,
    credentials: {
      accessKeyId: process.env.SPACES_KEY,
      secretAccessKey: process.env.SPACES_SECRET,
    },
    forcePathStyle: false,
  });
  return s3Client;
}

function sanitizeName(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

function buildPublicUrl(key) {
  const cdnBase = process.env.SPACES_CDN_BASE_URL;
  if (cdnBase) return `${cdnBase.replace(/\/+$/, '')}/${key}`;
  const endpoint = process.env.SPACES_ENDPOINT;
  const bucket = process.env.SPACES_BUCKET;
  return `https://${bucket}.${endpoint}/${key}`;
}

async function uploadLessonVideoToSpaces({ buffer, mimeType, originalName, courseId, lessonId }) {
  const client = getSpacesClient();
  if (!client) {
    throw new Error('DigitalOcean Spaces is not configured in backend env');
  }

  const ext = path.extname(originalName || '').toLowerCase() || '.mp4';
  const safeBase = sanitizeName(path.basename(originalName || 'lesson-video', ext)) || 'lesson-video';
  const key = `pre-recorded/course-${courseId}/lesson-${lessonId}/${Date.now()}-${safeBase}${ext}`;

  await client.send(
    new PutObjectCommand({
      Bucket: process.env.SPACES_BUCKET,
      Key: key,
      Body: buffer,
      ACL: process.env.SPACES_OBJECT_ACL || 'public-read',
      ContentType: mimeType || 'application/octet-stream',
    })
  );

  return {
    key,
    publicUrl: buildPublicUrl(key),
  };
}

async function uploadLessonTemplateVideoToSpaces({ buffer, mimeType, originalName, templateId }) {
  return uploadLessonVideoToSpaces({
    buffer,
    mimeType,
    originalName,
    courseId: 'library',
    lessonId: `template-${templateId}`,
  });
}

const MEDIA_PREFIXES = ['pre-recorded/', 'live-recordings/'];

/**
 * Delete every object under known media prefixes (lesson videos + assignment PDFs).
 * @returns {{ deleted: number, prefixes: string[] }}
 */
async function deleteAllMediaObjectsInSpaces() {
  const client = getSpacesClient();
  if (!client) {
    throw new Error('DigitalOcean Spaces is not configured in backend env');
  }
  const bucket = process.env.SPACES_BUCKET;
  let deleted = 0;
  for (const prefix of MEDIA_PREFIXES) {
    let continuationToken;
    do {
      const listed = await client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        })
      );
      const keys = (listed.Contents || []).map((c) => c.Key).filter(Boolean);
      for (let i = 0; i < keys.length; i += 1000) {
        const chunk = keys.slice(i, i + 1000);
        if (chunk.length === 0) continue;
        await client.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true },
          })
        );
        deleted += chunk.length;
      }
      continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
    } while (continuationToken);
  }
  return { deleted, prefixes: [...MEDIA_PREFIXES] };
}

async function uploadToSpaces({ buffer, mimeType, key }) {
  const client = getSpacesClient();
  if (!client) {
    throw new Error('DigitalOcean Spaces is not configured in backend env');
  }
  await client.send(
    new PutObjectCommand({
      Bucket: process.env.SPACES_BUCKET,
      Key: key,
      Body: buffer,
      ACL: process.env.SPACES_OBJECT_ACL || 'public-read',
      ContentType: mimeType || 'application/octet-stream',
    })
  );
  return { key, publicUrl: buildPublicUrl(key) };
}

module.exports = {
  isSpacesConfigured,
  uploadLessonVideoToSpaces,
  uploadLessonTemplateVideoToSpaces,
  uploadToSpaces,
  deleteAllMediaObjectsInSpaces,
  MEDIA_PREFIXES,
};
